// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions — JevUnfollowGuard (Story 42.8)
 *
 * Cognitive second opinion before `unfollowNonFollowers` drops an account that
 * does not follow back. Each candidate is classified by Jev `Choice` into one
 * of four verdicts:
 *
 *   unfollow_dead               — abandoned/inactive account, safe to drop
 *   unfollow_spam               — spam/scam/promo-farming account, safe to drop
 *   keep_high_value_influencer  — influential account worth keeping
 *   keep_active_peer            — real, active peer worth keeping
 *
 * FAIL-SAFE POLARITY (unfollow is near-irreversible): an account is dropped
 * ONLY when the verdict is `unfollow_*` AND confidence >= threshold. Every
 * other outcome — `keep_*`, low confidence, degraded plane, thrown error —
 * keeps the account. Jev does not decide whether to act; it decides whether to
 * *permit* the act, biased toward preserving relationships.
 *
 * Seam (mirrors Story 42.5's prefetchBioScores): the browser executor runs this
 * as an async PRE-PASS over `nonFollowers.slice(0, limit)` and gets back a
 * `Map<username, {choice, confidence}>`; the API executor's fused loop calls it
 * per candidate (`evaluateUnfollowTargets([user])`) right before the delete.
 * In-memory per-job only — nothing is persisted (no DB, no bio log).
 *
 * Spend control: at most `JEV_UNFOLLOW_MAX_EVALS` decide calls per run
 * (default 300 — a paid-call budget, not tied to `maxUnfollows`), 8 concurrent
 * via p-limit, each decide bounded by a 5s timeout. Bios are truncated to 500
 * chars before they reach the paid endpoint. Candidates beyond the budget are
 * kept by the caller (deferred to a later run) — never unfollowed unevaluated.
 *
 * Env:
 *   JEV_COGNITIVE_UNFOLLOW   — kill-switch, default ON; only 0|false|off|no disables.
 *   JEV_THRESHOLD_UNFOLLOW   — confidence threshold for unfollow_* verdicts (default 0.70, clamped [0,1]).
 *   JEV_UNFOLLOW_MAX_EVALS   — max accounts evaluated per run (default 300; <=0 evaluates nobody; clamped <=1000).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { JevBrain } from '../agents/jevBrain.js';

const BIO_MAX_CHARS = 500; // bound paid-call payload — multi-KB bios can't inflate tokens
const DEFAULT_UNFOLLOW_THRESHOLD = 0.7;
const DEFAULT_MAX_EVALS = 300;
const MAX_EVALS_CEILING = 1000; // hard cap — a fat-fingered env can't open a paid-call flood
const EVAL_CONCURRENCY = 8;
const DECIDE_TIMEOUT_MS = 5000; // mirrors JevBrain's own default — bounded per paid call

/**
 * Jev Choice question for relationship classification. Criteria keys are fixed —
 * callers qualify on strict membership in `UNFOLLOW_VERDICTS`, so the
 * `unfollow_*` / `keep_*` split is part of the contract.
 * @type {import('../agents/jevBrain.js').JevQuestion}
 */
const UNFOLLOW_VERDICT_QUESTION = {
  type: 'choice',
  instructions:
    'You are pruning a Twitter/X following list. The account in `state` does NOT follow the user back. ' +
    'Classify whether unfollowing this account is safe, or whether the relationship/audience value is ' +
    'worth preserving. Judge the bio, display name, verification status, and follower count when present ' +
    '(some fields may be empty — work with what is given) — an account that does not follow back can ' +
    'still be valuable to keep.',
  criteria: {
    unfollow_dead:
      'Inactive, abandoned, or placeholder-looking account — no real presence, safe to unfollow.',
    unfollow_spam:
      'Spam, scam, bot, engagement-bait, or promo/airdrop-farming account — safe to unfollow.',
    keep_high_value_influencer:
      'High-value or influential account — e.g. a large audience when metrics are present, verified ' +
      'authority, notable figure or organization worth keeping in the feed even without a follow-back.',
    keep_active_peer:
      'A real, active person or plausible peer relationship — keep the follow; the connection may ' +
      'still convert or matter.',
  },
};

/** Verdicts that permit an unfollow when confidence clears the threshold. */
const UNFOLLOW_VERDICTS = ['unfollow_dead', 'unfollow_spam'];

/**
 * Kill-switch polarity: feature is ON by default and only an explicit
 * 0|false|off|no disables it. Same polarity as JEV_CHALLENGE_DIAG — deliberately
 * NOT a truthy check, which would default the feature OFF when unset.
 * @param {string | boolean | undefined | null} val
 * @returns {boolean}
 */
export function isJevCognitiveUnfollowEnabled(val = process.env.JEV_COGNITIVE_UNFOLLOW) {
  if (typeof val === 'boolean') return val;
  if (val === undefined || val === null || val === '') return true;
  const normalized = String(val).trim().toLowerCase();
  return !(normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no');
}

/**
 * Resolve the unfollow confidence threshold from env, default 0.70.
 * Confidence is a probability — clamped to [0,1] so env typos can't move the gate.
 * @param {string | number | undefined | null} val
 * @returns {number}
 */
export function resolveUnfollowThreshold(val = process.env.JEV_THRESHOLD_UNFOLLOW) {
  let resolved;
  if (typeof val === 'number') {
    resolved = Number.isFinite(val) ? val : DEFAULT_UNFOLLOW_THRESHOLD;
  } else if (val === undefined || val === null || val === '') {
    resolved = DEFAULT_UNFOLLOW_THRESHOLD;
  } else {
    const parsed = parseFloat(String(val));
    resolved = Number.isFinite(parsed) ? parsed : DEFAULT_UNFOLLOW_THRESHOLD;
  }
  return Math.min(1, Math.max(0, resolved));
}

/**
 * Resolve the per-run cap on Jev-evaluated accounts from env, default 300.
 * Non-numeric input falls back to the default; <=0 evaluates nobody (callers
 * treat an empty verdict set as "guard produced no signal"); clamped <=1000.
 * @param {string | number | undefined | null} val
 * @returns {number}
 */
export function resolveUnfollowMaxEvals(val = process.env.JEV_UNFOLLOW_MAX_EVALS) {
  if (val === undefined || val === null || val === '') return DEFAULT_MAX_EVALS;
  // Number() not parseInt: '1e2' → 100, '0.5' → 0 — both honored as written.
  const parsed = typeof val === 'number' ? val : Number(String(val));
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_EVALS;
  return Math.min(Math.floor(parsed), MAX_EVALS_CEILING);
}

/**
 * The single rule that permits an unfollow: a Jev verdict in the fixed
 * `unfollow_*` criteria set at confidence >= threshold. Strict membership —
 * a hallucinated choice outside the criteria (e.g. `unfollow_maybe`) does
 * NOT qualify. Everything else — `keep_*`, low-confidence, malformed,
 * missing (degraded/unevaluated) — returns false, so the caller keeps the
 * account. Deliberately NOT `brain.gate()`: gate() is confidence-only and
 * cannot distinguish a confident `keep_*` from a confident `unfollow_*`
 * (finding #2 from live verify 42.5).
 * @param {{choice?: string, confidence?: number} | undefined | null} verdict
 * @param {number} [threshold]
 * @returns {boolean}
 */
export function isConfidentUnfollowVerdict(verdict, threshold = resolveUnfollowThreshold()) {
  if (!verdict || typeof verdict !== 'object') return false;
  const choice = typeof verdict.choice === 'string' ? verdict.choice : '';
  const confidence = typeof verdict.confidence === 'number' ? verdict.confidence : 0;
  return UNFOLLOW_VERDICTS.includes(choice) && confidence >= threshold;
}

/**
 * Normalize a candidate (browser getFollowing shape, API v2 user shape, or a
 * caller-pre-mapped object) into the bounded state sent to Jev. Missing fields
 * stay empty — the candidate is still evaluated rather than skipped (a thin
 * state just earns a low-confidence answer → keep).
 * @param {Record<string, any>} user
 * @returns {Record<string, any>}
 */
function toTargetState(user) {
  const bio = user.bio ?? user.description ?? '';
  const followersCount = Number.isFinite(user.followersCount)
    ? user.followersCount
    : (Number.isFinite(user.public_metrics?.followers_count) ? user.public_metrics.followers_count : undefined);
  /** @type {{username: string, name: string, bio: string, verified: boolean, followersCount?: number}} */
  const state = {
    username: String(user.username || ''),
    name: String(user.name || user.displayName || ''),
    bio: String(bio).slice(0, BIO_MAX_CHARS),
    verified: Boolean(user.verified),
  };
  if (followersCount !== undefined) state.followersCount = followersCount;
  return state;
}

/** @type {any} — lazily-constructed JevBrain shared across calls (null until first use) */
let _sharedBrain = null;

/**
 * Lazily resolve the Jev brain. Constructed on first use so importing this
 * module never requires TYPESAFE_API_KEY (degrade is JevBrain's job). An
 * injected brain (tests) is used as-is. Mirrors jev-bio-matcher.js: rebuilds
 * when the first-use brain captured an empty key but one exists now — a
 * post-import/dotenv key must not leave the feature degraded for life.
 * @param {any} [injected]
 * @returns {any}
 */
function resolveBrain(injected) {
  if (injected) return injected;
  // Rebuild whenever the env key differs from what the cached brain captured —
  // a post-import/dotenv key must not leave the feature degraded for life, and
  // a rotated key must not stay frozen on the old credential either.
  const envKey = process.env.TYPESAFE_API_KEY || '';
  if (!_sharedBrain || _sharedBrain.apiKey !== envKey) {
    _sharedBrain = new JevBrain();
  }
  return _sharedBrain;
}

/**
 * Evaluate unfollow candidates via Jev `Choice` classification.
 *
 * Returns `{ verdicts, degraded }` where `verdicts` maps each evaluated
 * username → `{choice, confidence}` (raw Jev answer — including `keep_*` and
 * low-confidence entries, so callers can preview the full matrix) and
 * `degraded` counts candidates whose evaluation produced no signal (degraded
 * plane, thrown decide, missing key). Candidates absent from `verdicts` must
 * be kept by the caller — the qualify rule lives in
 * `isConfidentUnfollowVerdict`, never in this map's presence alone.
 *
 * Never throws: the kill-switch, a non-positive eval cap, brain-init failure,
 * and p-limit resolution failure all resolve to an empty/partial result, and
 * per-user failures are swallowed via try/catch + Promise.allSettled.
 *
 * @param {Array<Record<string, any>>} users
 * @param {object} [options]
 * @param {any} [options.brain] - injected JevBrain (tests fake at this IO boundary)
 * @param {number} [options.maxEvals] - per-run evaluation cap override (default: env / 300)
 * @param {any} [options.pLimit] - injected p-limit factory (tests)
 * @returns {Promise<{verdicts: Map<string, {choice: string, confidence: number}>, degraded: number}>}
 */
export async function evaluateUnfollowTargets(users, options = {}) {
  /** @type {Map<string, {choice: string, confidence: number}>} */
  const verdicts = new Map();
  let degraded = 0;

  const opts = options && typeof options === 'object' ? options : {};

  // Kill-switch + spend cap resolve lazily per call — post-import `.env` loads
  // and runtime env flips are honored (same contract as the diagnoser).
  if (!isJevCognitiveUnfollowEnabled()) return { verdicts, degraded };
  const maxEvals = typeof opts.maxEvals === 'number' && Number.isFinite(opts.maxEvals)
    ? opts.maxEvals
    : resolveUnfollowMaxEvals();
  if (maxEvals <= 0) return { verdicts, degraded };

  // Candidates need a non-empty username — verdicts are keyed by username, so
  // an empty key would let one verdict govern every nameless candidate.
  const list = Array.isArray(users)
    ? users.filter((u) => u && typeof u === 'object' && String(u.username || ''))
    : [];
  if (list.length === 0) return { verdicts, degraded };

  const capped = list.slice(0, maxEvals);
  if (list.length > capped.length) {
    console.log(
      `[JevUnfollowGuard] ${list.length} candidates exceed JEV_UNFOLLOW_MAX_EVALS=${maxEvals} — ` +
        `evaluating top ${capped.length}, remaining ${list.length - capped.length} are kept (deferred)`,
    );
  }

  let brain;
  try {
    brain = resolveBrain(opts.brain);
  } catch (err) {
    console.warn(
      `[JevUnfollowGuard] brain init failed — all ${capped.length} candidates kept: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { verdicts, degraded: capped.length };
  }

  let pLimitFactory;
  try {
    pLimitFactory = typeof opts.pLimit === 'function' ? opts.pLimit : (await import('p-limit')).default;
  } catch {
    // Module resolution failure must not take down the whole job.
    console.warn('[JevUnfollowGuard] p-limit unavailable — all candidates kept');
    return { verdicts, degraded: capped.length };
  }
  let limit;
  try {
    limit = pLimitFactory(EVAL_CONCURRENCY);
  } catch {
    // A throwing injected factory must not break the never-throws contract.
    console.warn('[JevUnfollowGuard] p-limit factory threw — all candidates kept');
    return { verdicts, degraded: capped.length };
  }

  await Promise.allSettled(
    capped.map((user) =>
      limit(async () => {
        const username = String(user.username || '');
        try {
          const result = await brain.decide(
            toTargetState(user),
            { verdict: UNFOLLOW_VERDICT_QUESTION },
            { timeoutMs: DECIDE_TIMEOUT_MS },
          );
          // Degraded plane (missing key / API error / budget) → no signal; the
          // caller keeps the account. Do NOT write a fallback entry into the
          // map — JevBrain's synthetic choice fallback would mint a fake
          // 'unfollow_dead' verdict.
          if (!result || result.meta?.degraded) {
            degraded++;
            return;
          }
          const answer = result.answers?.verdict;
          verdicts.set(username, {
            choice: typeof answer?.choice === 'string' ? answer.choice : '',
            confidence: typeof answer?.confidence === 'number' ? answer.confidence : 0,
          });
        } catch (err) {
          // decide() is designed not to throw — belt & suspenders anyway.
          // No username in the message — keep PII-lite out of logs.
          degraded++;
          console.warn(
            `[JevUnfollowGuard] decide() threw — candidate kept: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }),
    ),
  );

  return { verdicts, degraded };
}

export default {
  evaluateUnfollowTargets,
  isJevCognitiveUnfollowEnabled,
  resolveUnfollowThreshold,
  resolveUnfollowMaxEvals,
  isConfidentUnfollowVerdict,
};
