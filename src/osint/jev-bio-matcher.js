// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions — JevBioMatcher (Story 42.5)
 *
 * Semantic second opinion for cross-platform bio pairs in `x_social_find_profiles`
 * identity resolution. The free signals (username_exact, name_similar,
 * avatar_match, crosslink_bio) stay first-line; this module only asks Jev about
 * the pairs they could not merge — e.g. "Building AI tools @ XActions" vs
 * "Founder, dev tools. Prev: Cognition".
 *
 * Seam (mirrors Story 41.3's prefetchAvatarHashes): `scorePair`/`resolveIdentities`
 * are sync inside an O(n^2) loop, so Jev scoring runs as an async PRE-PASS that
 * returns `Map<pairKey, {score, confidence}>`; `scorePair` then adds +35
 * `bio_semantic` on a map hit. In-memory per-request only (Option D / AD-45):
 * nothing is persisted — the Map is GC'd with the response.
 *
 * Candidate gating (a paid decide call is earned, never default):
 *   - different `platform` (case-insensitive)
 *   - both `bio` fields >= 20 trimmed chars (truncated to 500 before sending)
 *   - cheap `scorePair` score < MERGE_THRESHOLD — already-merged pairs skip Jev,
 *     which also covers username_exact (+40 >= 40)
 * Candidates are ranked by that same cheap score descending — pairs at 30–39
 * are one signal short of merging, exactly where a second opinion pays off —
 * tie-broken by `pairKey` so the cap is deterministic. At most
 * `JEV_OSINT_BIO_MAX_PAIRS` pairs per run (default 30) are sent to Jev,
 * 8 concurrent via p-limit, each decide bounded by the JevBrain 5s timeout.
 * Qualify: `samePerson` score >= 2 AND confidence >= `JEV_THRESHOLD_SAMEPERSON`
 * (default 0.85). Degraded answers never enter the map. Never throws.
 *
 * Env:
 *   JEV_OSINT_BIO_MATCH      — kill-switch, default ON; only 0|false|off|no disables.
 *   JEV_THRESHOLD_SAMEPERSON — confidence threshold for the samePerson gate (default 0.85, clamped [0,1]).
 *   JEV_OSINT_BIO_MAX_PAIRS  — max candidate pairs scored per run (default 30; <=0 disables; clamped <=500).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { JevBrain } from '../agents/jevBrain.js';
import { bioPairKey, scorePair, MERGE_THRESHOLD } from '../mcp/entity-resolver.js';
import { getAvatarPHashThreshold, isAvatarPHashEnabled } from './phash.js';

const BIO_MIN_CHARS = 20;
const BIO_MAX_CHARS = 500; // bound paid-call payload — multi-KB bios can't inflate tokens
const SAME_PERSON_MIN_SCORE = 2;
const DEFAULT_SAMEPERSON_THRESHOLD = 0.85;
const DEFAULT_MAX_PAIRS = 30;
const MAX_PAIRS_CEILING = 500; // hard cap — a fat-fingered env can't open a paid-call flood
const BIO_MATCH_CONCURRENCY = 8;
const DECIDE_TIMEOUT_MS = 5000; // mirrors JevBrain's own default — bounded per paid call

/**
 * Jev Score question for same-person bio comparison.
 * `criteria` is the 0–3 legend: 0 clearly different people, 1 insufficient
 * evidence, 2 likely same person, 3 very likely same person. Only the two bio
 * texts are sent — no envelope, no metadata.raw, no names/usernames to judge
 * (those are separate, already-scored signals).
 * @type {import('../agents/jevBrain.js').JevQuestion}
 */
const SAME_PERSON_QUESTION = {
  type: 'score',
  instructions:
    'You are given two social-media bios from different platforms (state.bio1 and state.bio2). ' +
    'Score how likely they describe the same real person. Compare career, employer, projects, ' +
    'interests, location, and other self-identifiers in the bio text. Do NOT rely on display ' +
    'names or usernames — those are evaluated by separate signals; judge the bio content only.',
  criteria: [
    'clearly different people — conflicting or unrelated identities',
    'not enough evidence — too little overlap to tell either way',
    'likely the same person — meaningful overlap in role, employer, projects, or interests',
    'very likely the same person — distinctive details match across both bios',
  ],
};

/**
 * Kill-switch polarity: feature is ON by default and only an explicit
 * 0|false|off|no disables it. Same polarity as JEV_CHALLENGE_DIAG — deliberately
 * NOT a truthy check, which would default the feature OFF when unset.
 * @param {string | boolean | undefined | null} val
 * @returns {boolean}
 */
export function isJevOsintBioMatchEnabled(val = process.env.JEV_OSINT_BIO_MATCH) {
  if (typeof val === 'boolean') return val;
  if (val === undefined || val === null || val === '') return true;
  const normalized = String(val).trim().toLowerCase();
  return !(normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no');
}

/**
 * Resolve the samePerson confidence threshold from env, default 0.85.
 * Confidence is a probability — clamped to [0,1] so env typos can't move the gate.
 * @param {string | number | undefined | null} val
 * @returns {number}
 */
export function resolveSamePersonThreshold(val = process.env.JEV_THRESHOLD_SAMEPERSON) {
  let resolved;
  if (typeof val === 'number') {
    resolved = Number.isFinite(val) ? val : DEFAULT_SAMEPERSON_THRESHOLD;
  } else if (val === undefined || val === null || val === '') {
    resolved = DEFAULT_SAMEPERSON_THRESHOLD;
  } else {
    const parsed = parseFloat(String(val));
    resolved = Number.isFinite(parsed) ? parsed : DEFAULT_SAMEPERSON_THRESHOLD;
  }
  return Math.min(1, Math.max(0, resolved));
}

/**
 * Resolve the per-run cap on Jev-scored bio pairs from env, default 30.
 * Non-numeric input falls back to the default; <=0 disables the pre-pass
 * entirely (prefetchBioScores returns an empty Map without calling Jev).
 * @param {string | number | undefined | null} val
 * @returns {number}
 */
export function resolveMaxPairs(val = process.env.JEV_OSINT_BIO_MAX_PAIRS) {
  if (val === undefined || val === null || val === '') return DEFAULT_MAX_PAIRS;
  // Number() not parseInt: '1e2' → 100, '0.5' → 0 (disables) — both honored as written.
  const parsed = typeof val === 'number' ? val : Number(String(val));
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_PAIRS;
  return Math.min(Math.floor(parsed), MAX_PAIRS_CEILING);
}

/** @type {any} — lazily-constructed JevBrain shared across calls (null until first use) */
let _sharedBrain = null;

/**
 * Lazily resolve the Jev brain. Constructed on first use so importing this
 * module never requires TYPESAFE_API_KEY (degrade is JevBrain's job). An
 * injected brain (tests) is used as-is.
 * @param {any} [injected]
 * @returns {any}
 */
function resolveBrain(injected) {
  if (injected) return injected;
  // Rebuild when the first-use brain captured an empty key but one exists now —
  // a post-import/dotenv key must not leave the feature degraded for life.
  if (!_sharedBrain || (!_sharedBrain.apiKey && process.env.TYPESAFE_API_KEY)) {
    _sharedBrain = new JevBrain({
      confidenceThresholds: { samePerson: resolveSamePersonThreshold() },
    });
  }
  return _sharedBrain;
}

/**
 * Pre-fetch Jev same-person scores for candidate bio pairs across platforms.
 *
 * Returns `Map<pairKey, {score, confidence}>` containing ONLY pairs that
 * qualified (score >= 2 && confidence >= threshold && not degraded). Entries
 * let `scorePair` add +35 `bio_semantic`. Never throws: per-call errors are
 * swallowed via try/catch + Promise.allSettled, and every failure mode
 * (kill-switch off, no API key → degraded, decide rejects, no candidates)
 * resolves to an empty or partial Map.
 *
 * @param {Array<Record<string, any>>} profiles
 * @param {object} [options]
 * @param {Map<string, bigint>} [options.avatarHashMap] — pre-fetched avatar
 *        pHash map; feeds the cheap scorePair estimate used for gating/ranking
 * @param {any} [options.brain] — injected JevBrain (tests fake at this IO
 *        boundary); lazy-constructed when omitted
 * @param {boolean} [options.phashEnabled] — resolved pHash kill-switch for the
 *        cheap score (default: isAvatarPHashEnabled())
 * @param {number} [options.phashThreshold] — resolved Hamming threshold for the
 *        cheap score (default: getAvatarPHashThreshold())
 * @param {number} [options.timeoutMs] — caller's overall budget; the pre-pass
 *        stops scheduling new decide calls once the deadline passes
 * @returns {Promise<Map<string, {score: number, confidence: number}>>}
 */
export async function prefetchBioScores(profiles, options = {}) {
  const map = new Map();
  const opts = options && typeof options === 'object' ? options : {};
  const deadline = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
    ? Date.now() + opts.timeoutMs
    : null;

  // Kill-switch + spend cap resolve lazily per call — post-import `.env` loads
  // and runtime env flips are honored (same contract as the diagnoser).
  if (!isJevOsintBioMatchEnabled()) return map;
  const maxPairs = resolveMaxPairs();
  if (maxPairs <= 0) return map;
  const threshold = resolveSamePersonThreshold();

  const phashEnabled = opts.phashEnabled !== undefined
    ? isJevOsintBioMatchEnabled(opts.phashEnabled) // same disable-list coercion for non-boolean input
    : isAvatarPHashEnabled();
  const phashThreshold = Number.isFinite(opts.phashThreshold) ? opts.phashThreshold : getAvatarPHashThreshold();
  // Non-Map avatarHashMap would make scorePair throw on .get — degrade to none.
  const avatarHashMap = opts.avatarHashMap && typeof opts.avatarHashMap.get === 'function' ? opts.avatarHashMap : undefined;

  const list = Array.isArray(profiles) ? profiles.filter((p) => p && typeof p === 'object') : [];
  if (list.length < 2) return map;

  // ── Candidate gating — every paid decide call must be earned ────────────
  /** @type {Array<{ bioA: string, bioB: string, cheap: number, key: string }>} */
  const candidates = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      // (a) cross-platform only — same-platform pairs carry no entity signal.
      const platA = String(a.platform || '').trim().toLowerCase();
      const platB = String(b.platform || '').trim().toLowerCase();
      if (!platA || !platB || platA === platB) continue;
      // (b) both bios present and substantive (>= 20 trimmed chars).
      const bioA = String(a.bio || '').trim().slice(0, BIO_MAX_CHARS);
      const bioB = String(b.bio || '').trim().slice(0, BIO_MAX_CHARS);
      if (bioA.length < BIO_MIN_CHARS || bioB.length < BIO_MIN_CHARS) continue;
      try {
        // (c) cheap scorePair below MERGE_THRESHOLD — pairs the free signals
        // already merge never reach Jev; this also covers username_exact
        // (+40 >= 40). avatarHashMap included so the estimate matches what
        // resolveIdentities will compute.
        const cheap = scorePair(a, b, avatarHashMap, phashEnabled, phashThreshold).score;
        if (cheap >= MERGE_THRESHOLD) continue;
        const key = bioPairKey(a, b);
        if (!key) continue; // degenerate identity — no stable key, no map entry
        candidates.push({ bioA, bioB, cheap, key });
      } catch {
        // Throwing getter / malformed profile on an ad-hoc object — skip pair.
        continue;
      }
    }
  }
  if (candidates.length === 0) return map;

  // Dedupe by pairKey — duplicate profiles (same normalized id) must not burn
  // duplicate paid calls or cap slots. Keep the highest cheap score.
  const deduped = new Map();
  for (const c of candidates) {
    const prev = deduped.get(c.key);
    if (!prev || c.cheap > prev.cheap) deduped.set(c.key, c);
  }
  const uniqueCandidates = [...deduped.values()];

  // Rank by cheap score descending — near-merge pairs (30–39) are the most
  // valuable second opinions. Tie-break on pairKey keeps the cap deterministic.
  uniqueCandidates.sort((x, y) => (y.cheap - x.cheap) || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  const capped = uniqueCandidates.slice(0, maxPairs);
  if (uniqueCandidates.length > capped.length) {
    console.log(
      `[JevBioMatcher] ${uniqueCandidates.length} candidate bio pairs exceed JEV_OSINT_BIO_MAX_PAIRS=${maxPairs} — ` +
        `scoring top ${capped.length}, skipping ${uniqueCandidates.length - capped.length}`,
    );
  }

  let brain;
  try {
    brain = resolveBrain(opts.brain);
  } catch (err) {
    console.warn(
      `[JevBioMatcher] brain init failed — skipping bio second opinion: ${err instanceof Error ? err.message : String(err)}`,
    );
    return map;
  }

  let pLimit;
  try {
    ({ default: pLimit } = await import('p-limit'));
  } catch {
    // Module resolution failure must not take down the whole response.
    console.warn('[JevBioMatcher] p-limit unavailable — skipping bio second opinion');
    return map;
  }
  const limit = pLimit(BIO_MATCH_CONCURRENCY);

  const stats = { qualified: 0, unqualified: 0, degraded: 0, errors: 0, timedOut: 0 };
  await Promise.allSettled(
    capped.map((cand) =>
      limit(async () => {
        // Caller deadline — stop scheduling new paid calls once it passes.
        if (deadline && Date.now() > deadline) {
          stats.timedOut++;
          return;
        }
        // Deterministic bio order so identical pairs send identical payloads.
        const [bio1, bio2] = cand.bioA <= cand.bioB ? [cand.bioA, cand.bioB] : [cand.bioB, cand.bioA];
        try {
          const result = await brain.decide(
            { bio1, bio2 },
            { samePerson: SAME_PERSON_QUESTION },
            { timeoutMs: DECIDE_TIMEOUT_MS },
          );
          // Degraded plane (missing key / API error / budget) → no signal.
          if (!result || result.meta?.degraded) {
            stats.degraded++;
            return;
          }
          const answer = result.answers?.samePerson;
          const score = typeof answer?.score === 'number' ? answer.score : 0;
          const confidence = typeof answer?.confidence === 'number' ? answer.confidence : 0;
          if (score >= SAME_PERSON_MIN_SCORE && confidence >= threshold) {
            map.set(cand.key, { score, confidence });
            stats.qualified++;
          } else {
            stats.unqualified++;
          }
        } catch (err) {
          // decide() is designed not to throw — belt & suspenders anyway.
          // No pair key in the message — it embeds platform:username (PII-lite).
          stats.errors++;
          console.warn(
            `[JevBioMatcher] decide() threw — pair skipped: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }),
    ),
  );
  if (stats.degraded || stats.errors || stats.timedOut) {
    console.log(
      `[JevBioMatcher] ${capped.length} pairs scored — qualified=${stats.qualified} ` +
        `unqualified=${stats.unqualified} degraded=${stats.degraded} errors=${stats.errors} timedOut=${stats.timedOut}`,
    );
  }

  return map;
}

export default { prefetchBioScores, isJevOsintBioMatchEnabled, resolveSamePersonThreshold, resolveMaxPairs };
