// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions — JevVariantJudge (Story 42.9)
 *
 * Jev-as-a-Judge for AI-generated post variants. `generateTweet` and
 * `generateReply` get back a raw array of variants from the LLM — this module
 * picks the most natural one and filters AI-tells ("cringe") in a SINGLE
 * `decide` call per generation:
 *
 *   pick       — Choice over {variant_1..N, none_good}
 *   cringe_1..N — Noul (0..1) cringe factor per variant
 *
 * Selection semantics (fail-closed on cringe only):
 *   1. If Jev's pick is a real variant AND its cringe <= threshold → it wins.
 *   2. Otherwise (pick is none_good / out-of-range / picked variant is cringe)
 *      → fall back to the lowest-cringe variant still under the threshold.
 *   3. No variant under the threshold → selectedIndex = -1 (allCringe — the
 *      caller may re-roll the LLM, bounded by JEV_VARIANT_JUDGE_MAX_REROLL).
 *
 * The pick is honored even at low confidence — confidence is exposed in the
 * result so the caller can see it; only cringe gates. This is a SELECTION
 * judge, not an action gate (inverse polarity of 42.8): a degraded plane
 * returns variants untouched, nothing selected — it never "keeps all".
 *
 * Never throws: kill-switch, missing key, degraded plane, malformed answers,
 * and thrown decide calls all resolve to `{degraded: true}` or a no-selection
 * verdict — the generator always returns usable variants.
 *
 * Env:
 *   JEV_VARIANT_JUDGE              — kill-switch, default ON; only 0|false|off|no disables.
 *   JEV_THRESHOLD_CRINGE           — cringe ceiling (default 0.30, clamped [0,1]).
 *   JEV_VARIANT_JUDGE_MAX_REROLL   — max LLM re-rolls on all-cringe (default 1, clamped [0,3]).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { JevBrain } from '../agents/jevBrain.js';

const TEXT_MAX_CHARS = 500; // bound paid-call payload — variants can't inflate tokens
const MAX_VARIANTS = 5; // same ceiling the generators apply — bounds the N+1 questions per decide
const DEFAULT_CRINGE_THRESHOLD = 0.3;
const DEFAULT_MAX_REROLL = 1;
const MAX_REROLL_CEILING = 3; // hard cap — bounded spend, a fat-fingered env can't loop the LLM
const DECIDE_TIMEOUT_MS = 5000; // mirrors JevBrain's own default — bounded per paid call

/**
 * Kill-switch polarity: feature is ON by default and only an explicit
 * 0|false|off|no disables it. Same polarity as JEV_COGNITIVE_UNFOLLOW —
 * deliberately NOT a truthy check, which would default the feature OFF
 * when unset.
 * @param {string | boolean | undefined | null} val
 * @returns {boolean}
 */
export function isJevVariantJudgeEnabled(val = process.env.JEV_VARIANT_JUDGE) {
  if (typeof val === 'boolean') return val;
  if (val === undefined || val === null || val === '') return true;
  const normalized = String(val).trim().toLowerCase();
  return !(normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no');
}

/**
 * Resolve the cringe threshold from env, default 0.30.
 * A variant with noul > threshold is cringe; <= threshold is clean.
 * Clamped to [0,1] so env typos can't move the gate.
 * @param {string | number | undefined | null} val
 * @returns {number}
 */
export function resolveCringeThreshold(val = process.env.JEV_THRESHOLD_CRINGE) {
  let resolved;
  if (typeof val === 'number') {
    resolved = Number.isFinite(val) ? val : DEFAULT_CRINGE_THRESHOLD;
  } else if (val === undefined || val === null || val === '') {
    resolved = DEFAULT_CRINGE_THRESHOLD;
  } else {
    const parsed = parseFloat(String(val));
    resolved = Number.isFinite(parsed) ? parsed : DEFAULT_CRINGE_THRESHOLD;
  }
  return Math.min(1, Math.max(0, resolved));
}

/**
 * Resolve the max LLM re-roll count for all-cringe outcomes, default 1.
 * Non-numeric input falls back to the default; <=0 disables re-rolls;
 * clamped <=3 — re-rolls are paid LLM calls, not free retries.
 * @param {string | number | undefined | null} val
 * @returns {number}
 */
export function resolveVariantJudgeMaxReroll(val = process.env.JEV_VARIANT_JUDGE_MAX_REROLL) {
  if (val === undefined || val === null) return DEFAULT_MAX_REROLL;
  // Trim before the empty check — ' ' would otherwise parse via Number(' ') === 0
  // and silently disable re-rolls.
  const normalized = typeof val === 'number' ? val : String(val).trim();
  if (normalized === '') return DEFAULT_MAX_REROLL;
  // Number() not parseInt: '1e1' → 10 → clamped to ceiling, '0.5' → 0.
  const parsed = typeof normalized === 'number' ? normalized : Number(normalized);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_REROLL;
  return Math.min(Math.max(Math.floor(parsed), 0), MAX_REROLL_CEILING);
}

/** @type {any} — lazily-constructed JevBrain shared across calls (null until first use) */
let _sharedBrain = null;

/**
 * Lazily resolve the Jev brain. Constructed on first use so importing this
 * module never requires TYPESAFE_API_KEY (degrade is JevBrain's job). An
 * injected brain (tests) is used as-is. Mirrors jevUnfollowGuard.js: rebuilds
 * when the cached brain's key differs from the env — a post-import/dotenv key
 * must not leave the feature degraded for life, and a rotated key must not
 * stay frozen on the old credential.
 * @param {any} [injected]
 * @returns {any}
 */
function resolveBrain(injected) {
  if (injected) return injected;
  const envKey = process.env.TYPESAFE_API_KEY || '';
  if (!_sharedBrain || _sharedBrain.apiKey !== envKey) {
    _sharedBrain = new JevBrain();
  }
  return _sharedBrain;
}

/**
 * Coerce a variant item to string without violating the never-throws contract —
 * a hostile toString/Symbol.toPrimitive on a direct-caller item resolves to ''.
 * @param {any} v
 * @returns {string}
 */
function safeText(v) {
  try {
    return String(v ?? '');
  } catch {
    return '';
  }
}

/**
 * Judge generated post variants via Jev — one `decide` call, N+1 questions.
 *
 * Returns `{selectedIndex, cringe, pickChoice, pickConfidence, degraded}`:
 *   - selectedIndex: 0-based winner, or -1 when every variant is cringe
 *     (caller treats -1 as allCringe → bounded re-roll).
 *   - cringe: per-variant noul scores aligned with `texts` ([] when degraded).
 *   - pickChoice / pickConfidence: Jev's raw pick (may be 'none_good' or an
 *     out-of-range/hallucinated key — exposed for observability, not trusted).
 *   - degraded: true on kill-switch, missing key, degraded plane, or any
 *     thrown error — caller returns variants untouched.
 *
 * @param {Array<string|any>} texts - variant texts (coerced via String)
 * @param {object} [options]
 * @param {any} [options.brain] - injected JevBrain (tests fake at this IO boundary)
 * @param {number} [options.cringeThreshold] - override (default: env / 0.30)
 * @returns {Promise<{selectedIndex: number, cringe: number[], pickChoice: string|null, pickConfidence: number, degraded: boolean}>}
 */
export async function judgePostVariants(texts, options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const { viralStats, platform, niche } = opts;
  const degradedResult = { selectedIndex: -1, cringe: [], pickChoice: null, pickConfidence: 0, degraded: true, viralBoostApplied: false };

  // Kill-switch resolves lazily per call — post-import `.env` loads and
  // runtime env flips are honored. Zero decide calls when disabled.
  if (!isJevVariantJudgeEnabled()) return degradedResult;

  const list = (Array.isArray(texts) ? texts.slice(0, MAX_VARIANTS) : []).map(safeText);
  if (list.length === 0) {
    return { selectedIndex: -1, cringe: [], pickChoice: null, pickConfidence: 0, degraded: false, viralBoostApplied: false };
  }

  const threshold = typeof opts.cringeThreshold === 'number' && Number.isFinite(opts.cringeThreshold)
    ? Math.min(1, Math.max(0, opts.cringeThreshold))
    : resolveCringeThreshold();

  let brain;
  try {
    brain = resolveBrain(opts.brain);
  } catch {
    return degradedResult;
  }

  // Bounded state — texts are truncated before they reach the paid endpoint.
  const state = {
    variants: list.map((text, i) => ({ index: i + 1, text: text.slice(0, TEXT_MAX_CHARS) })),
  };

  // One decide call: a Choice pick + a Noul cringe score per variant.
  // Single-variant input skips the pick (no choice to make) but still gets
  // its cringe scored.
  /** @type {Record<string, any>} */
  const questions = {};
  if (list.length > 1) {
    /** @type {Record<string, string>} */
    const criteria = {};
    list.forEach((_, i) => {
      criteria[`variant_${i + 1}`] = `Variant ${i + 1} is the most natural, human-sounding option.`;
    });
    criteria.none_good = 'None of the variants sound natural — all read as AI-generated, generic, or off-voice.';
    questions.pick = {
      type: 'choice',
      instructions:
        'You are a writing judge for social posts generated in a specific author voice. ' +
        'Pick the single variant that sounds the most natural and human — the one a real ' +
        'person would actually post. Penalize AI-tells, generic hype, and forced structure. ' +
        'If every variant reads as AI slop, choose none_good.',
      criteria,
    };
  }
  list.forEach((_, i) => {
    questions[`cringe_${i + 1}`] = {
      type: 'noul',
      instructions:
        `Cringe factor of variant ${i + 1}: AI-tells (e.g. "delve", "game-changer", "unlock"), ` +
        'forced or stacked emojis, hashtag spam, generic motivational hype, engagement bait, ' +
        'corporate/LinkedIn-bro energy. 0 = natural human writing, 1 = peak cringe.',
    };
  });

  let result;
  try {
    result = await brain.decide(state, questions, { timeoutMs: DECIDE_TIMEOUT_MS });
  } catch {
    // decide() is designed not to throw — belt & suspenders anyway.
    return degradedResult;
  }
  if (!result || result.meta?.degraded) return degradedResult;

  const answers = result.answers || {};

  const pickAnswer = answers.pick;
  const pickChoice = typeof pickAnswer?.choice === 'string' ? pickAnswer.choice : null;
  const pickConfidence = typeof pickAnswer?.confidence === 'number' && Number.isFinite(pickAnswer.confidence)
    ? pickAnswer.confidence
    : 0;

  const nouls = list.map((_, i) => answers[`cringe_${i + 1}`]?.noul);

  // Zero noul evidence = malformed judge output — degrade rather than mint a
  // false allCringe verdict that wastes a paid re-roll on clean text.
  // (Some-but-not-all missing stays fail-closed per variant below.)
  if (!nouls.some((n) => typeof n === 'number' && Number.isFinite(n))) {
    return { selectedIndex: -1, cringe: [], pickChoice, pickConfidence, degraded: true, viralBoostApplied: false };
  }

  // Fail-closed on cringe: a missing/malformed noul cannot prove the variant
  // is clean, so it scores 1.0 — better to re-roll than ship cringe.
  const cringe = nouls.map((n) =>
    typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1.0,
  );

  // Selection: the pick wins iff it names a real variant that clears the
  // cringe gate. Otherwise fall back to the lowest-cringe clean variant.
  // Confidence never gates — it's exposed, not enforced. Pick is matched
  // normalized (trim + lowercase) — 'Variant_2'/' variant_2 ' still counts.
  let selectedIndex = -1;
  const pickNorm = pickChoice ? pickChoice.trim().toLowerCase() : null;
  const pickMatch = pickNorm ? pickNorm.match(/^variant_(\d+)$/) : null;
  if (pickMatch) {
    const idx = parseInt(pickMatch[1], 10) - 1;
    if (idx >= 0 && idx < list.length && cringe[idx] <= threshold) {
      selectedIndex = idx;
    }
  }
  if (selectedIndex === -1) {
    let best = -1;
    for (let i = 0; i < list.length; i++) {
      if (cringe[i] <= threshold && (best === -1 || cringe[i] < cringe[best])) best = i;
    }
    selectedIndex = best;
  }

  // Apply viral stats boost if enabled
  let finalSelectedIndex = selectedIndex;
  let viralBoostApplied = false;
  
  if (process.env.USE_VIRAL_INTEL === 'true' && viralStats && selectedIndex >= 0) {
    const { topPerformingPatterns } = viralStats;
    if (topPerformingPatterns && topPerformingPatterns.length > 0) {
      // Check if selected variant matches top pattern
      const selectedText = list[selectedIndex] || '';
      const topPattern = topPerformingPatterns[0]?.attributes || {};
      
      // Simple pattern match — boost if text contains pattern attributes
      const patternMatch = Object.values(topPattern).some(v => 
        selectedText.toLowerCase().includes(String(v).toLowerCase())
      );
      
      if (patternMatch) {
        viralBoostApplied = true;
        // Boost is implicit — selected variant already matches top pattern
      }
    }
  }
  
  return { 
    selectedIndex: finalSelectedIndex, 
    cringe, 
    pickChoice, 
    pickConfidence, 
    degraded: false,
    viralBoostApplied,
  };;
}

export default {
  judgePostVariants,
  isJevVariantJudgeEnabled,
  resolveCringeThreshold,
  resolveVariantJudgeMaxReroll,
};
