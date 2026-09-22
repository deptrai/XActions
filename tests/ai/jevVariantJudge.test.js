// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 42.9 — JevVariantJudge: Jev-as-a-Judge post-variant selector + cringe
 * filter. No-network: a real JevBrain instance is injected with `decide`
 * stubbed (fakes-at-IO-boundary convention). Covers every row of the spec's
 * I/O & edge-case matrix.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  judgePostVariants,
  isJevVariantJudgeEnabled,
  resolveCringeThreshold,
  resolveVariantJudgeMaxReroll,
} from '../../src/ai/jevVariantJudge.js';
import { JevBrain } from '../../src/agents/jevBrain.js';

// ── Factories ────────────────────────────────────────────────────────────────

const TEXTS = ['variant one text', 'variant two text', 'variant three text'];

/**
 * Build a Jev decide() result. `pick` is {choice, confidence} or null (no pick
 * question answered); `noul` is an array of per-variant cringe scores (null =
 * missing answer for that variant).
 */
const jevResult = (pick, nouls) => {
  const answers = {};
  if (pick) answers.pick = { type: 'choice', choice: pick.choice, confidence: pick.confidence };
  nouls.forEach((n, i) => {
    if (n !== null && n !== undefined) answers[`cringe_${i + 1}`] = { type: 'noul', noul: n };
  });
  return {
    answers,
    usage: { input_tokens: 20, output_tokens: 8 },
    meta: { degraded: false, source: 'jev' },
  };
};

const jevDegraded = (reason = 'missing-key') => ({
  answers: {},
  usage: { input_tokens: 0, output_tokens: 0 },
  meta: { degraded: true, reason, source: 'llmbrain' },
});

/**
 * Injected brain: real JevBrain with decide stubbed at the IO boundary.
 * `result` may be a fixed payload, an Error to reject with, or a fn(state, questions).
 */
function makeBrain(result, callLog) {
  const brain = new JevBrain({ apiKey: 'test-jev-key' });
  brain.decide = vi.fn().mockImplementation(async (state, questions) => {
    callLog?.push({ state, questions });
    if (result instanceof Error) throw result;
    if (typeof result === 'function') return result(state, questions);
    return result;
  });
  return brain;
}

beforeEach(() => {
  // vitest.config sets JEV_VARIANT_JUDGE=0 for the whole suite — re-enable per
  // test; the kill-switch test stubs it back to '0' explicitly.
  vi.stubEnv('JEV_VARIANT_JUDGE', '1');
  vi.stubEnv('TYPESAFE_API_KEY', ''); // belt & suspenders: never a live key
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Env helpers — kill-switch polarity, threshold clamp, reroll cap
// ---------------------------------------------------------------------------

describe('env helpers', () => {
  it('JEV_VARIANT_JUDGE defaults ON; only 0|false|off|no disables', () => {
    vi.stubEnv('JEV_VARIANT_JUDGE', '');
    expect(isJevVariantJudgeEnabled()).toBe(true);
    vi.unstubAllEnvs();

    expect(isJevVariantJudgeEnabled(null)).toBe(true);
    expect(isJevVariantJudgeEnabled('')).toBe(true);
    expect(isJevVariantJudgeEnabled('1')).toBe(true);
    expect(isJevVariantJudgeEnabled('true')).toBe(true);
    expect(isJevVariantJudgeEnabled('anything')).toBe(true);
    expect(isJevVariantJudgeEnabled('0')).toBe(false);
    expect(isJevVariantJudgeEnabled('false')).toBe(false);
    expect(isJevVariantJudgeEnabled('OFF')).toBe(false);
    expect(isJevVariantJudgeEnabled(' no ')).toBe(false);
    expect(isJevVariantJudgeEnabled(false)).toBe(false);
  });

  it('JEV_THRESHOLD_CRINGE parses floats, defaults 0.30, clamps [0,1]', () => {
    vi.stubEnv('JEV_THRESHOLD_CRINGE', '');
    expect(resolveCringeThreshold()).toBe(0.3);
    vi.unstubAllEnvs();

    expect(resolveCringeThreshold('')).toBe(0.3);
    expect(resolveCringeThreshold('0.5')).toBe(0.5);
    expect(resolveCringeThreshold('garbage')).toBe(0.3);
    expect(resolveCringeThreshold(0.65)).toBe(0.65);
    expect(resolveCringeThreshold('1.5')).toBe(1);
    expect(resolveCringeThreshold('-0.2')).toBe(0);
  });

  it('JEV_VARIANT_JUDGE_MAX_REROLL parses ints, defaults 1, clamps [0,3]', () => {
    vi.stubEnv('JEV_VARIANT_JUDGE_MAX_REROLL', '');
    expect(resolveVariantJudgeMaxReroll()).toBe(1);
    vi.unstubAllEnvs();

    expect(resolveVariantJudgeMaxReroll('')).toBe(1);
    expect(resolveVariantJudgeMaxReroll(' ')).toBe(1); // whitespace must not parse as Number(' ') === 0
    expect(resolveVariantJudgeMaxReroll('2')).toBe(2);
    expect(resolveVariantJudgeMaxReroll('garbage')).toBe(1);
    expect(resolveVariantJudgeMaxReroll('0')).toBe(0);
    expect(resolveVariantJudgeMaxReroll('-5')).toBe(0);
    expect(resolveVariantJudgeMaxReroll(2)).toBe(2);
    expect(resolveVariantJudgeMaxReroll('99')).toBe(3); // ceiling — bounded spend
  });
});

// ---------------------------------------------------------------------------
// judgePostVariants — verdict matrix
// ---------------------------------------------------------------------------

describe('judgePostVariants — verdict matrix', () => {
  it('HAPPY_PATH: pick honored, cringe scores aligned, selectedIndex 0-based', async () => {
    const brain = makeBrain(jevResult({ choice: 'variant_2', confidence: 0.9 }, [0.2, 0.1, 0.3]));
    const r = await judgePostVariants(TEXTS, { brain });
    expect(r.degraded).toBe(false);
    expect(r.selectedIndex).toBe(1);
    expect(r.cringe).toEqual([0.2, 0.1, 0.3]);
    expect(r.pickChoice).toBe('variant_2');
    expect(r.pickConfidence).toBe(0.9);
  });

  it('WINNER_CRINGE: pick cringe > threshold → lowest-cringe clean variant wins', async () => {
    const brain = makeBrain(jevResult({ choice: 'variant_1', confidence: 0.95 }, [0.8, 0.1, 0.2]));
    const r = await judgePostVariants(TEXTS, { brain });
    expect(r.selectedIndex).toBe(1); // variant_2 — lowest cringe under T
    expect(r.pickChoice).toBe('variant_1'); // raw pick still exposed
  });

  it('ALL_CRINGE: every variant above threshold → selectedIndex -1 (caller re-rolls)', async () => {
    const brain = makeBrain(jevResult({ choice: 'variant_2', confidence: 0.9 }, [0.9, 0.5, 0.8]));
    const r = await judgePostVariants(TEXTS, { brain });
    expect(r.selectedIndex).toBe(-1);
    expect(r.cringe).toEqual([0.9, 0.5, 0.8]);
  });

  it('none_good escape hatch → fallback to lowest-cringe clean variant', async () => {
    const brain = makeBrain(jevResult({ choice: 'none_good', confidence: 0.7 }, [0.4, 0.2, 0.1]));
    const r = await judgePostVariants(TEXTS, { brain });
    expect(r.selectedIndex).toBe(2); // argmin cringe under T
  });

  it('low-confidence pick is still honored — confidence never gates', async () => {
    const brain = makeBrain(jevResult({ choice: 'variant_3', confidence: 0.05 }, [0.1, 0.2, 0.15]));
    const r = await judgePostVariants(TEXTS, { brain });
    expect(r.selectedIndex).toBe(2);
    expect(r.pickConfidence).toBe(0.05);
  });

  it('hallucinated/out-of-range pick → fallback argmin clean', async () => {
    const brain = makeBrain(jevResult({ choice: 'variant_9', confidence: 0.9 }, [0.2, 0.05, 0.3]));
    const r = await judgePostVariants(TEXTS, { brain });
    expect(r.selectedIndex).toBe(1);
  });

  it('pick is matched normalized — case/whitespace variants of variant_N still honor the pick', async () => {
    for (const choice of ['Variant_2', ' variant_2 ', 'VARIANT_2']) {
      const brain = makeBrain(jevResult({ choice, confidence: 0.9 }, [0.1, 0.2, 0.05]));
      const r = await judgePostVariants(TEXTS, { brain });
      expect(r.selectedIndex).toBe(1); // variant_2 honored, not demoted to argmin (variant_3)
    }
  });

  it('zero noul evidence → degraded (malformed judge output), NOT a false allCringe', async () => {
    const brain = makeBrain({
      answers: { pick: { type: 'choice', choice: 'variant_1', confidence: 0.9 } },
      usage: { input_tokens: 20, output_tokens: 8 },
      meta: { degraded: false, source: 'jev' },
    });
    const r = await judgePostVariants(TEXTS, { brain });
    expect(r.degraded).toBe(true);
    expect(r.selectedIndex).toBe(-1);
    expect(r.pickChoice).toBe('variant_1'); // pick still exposed for observability
  });

  it('boundary: noul == threshold is clean, noul > threshold is cringe', async () => {
    const brain = makeBrain(jevResult(null, [0.3, 0.31]));
    const r = await judgePostVariants(['a', 'b'], { brain, cringeThreshold: 0.3 });
    expect(r.selectedIndex).toBe(0); // 0.3 <= T wins; 0.31 gated out
  });

  it('cringeThreshold option overrides env', async () => {
    const brain = makeBrain(jevResult({ choice: 'variant_1', confidence: 0.9 }, [0.5, 0.6]));
    const r = await judgePostVariants(['a', 'b'], { brain, cringeThreshold: 0.6 });
    expect(r.selectedIndex).toBe(0); // 0.5 <= 0.6
  });

  it('missing noul answer is fail-closed — treated as cringe (1.0)', async () => {
    const brain = makeBrain(jevResult({ choice: 'variant_2', confidence: 0.9 }, [0.1, null, 0.2]));
    const r = await judgePostVariants(TEXTS, { brain });
    expect(r.cringe).toEqual([0.1, 1.0, 0.2]);
    expect(r.selectedIndex).toBe(0); // pick's variant_2 gated out → argmin clean is variant_1
  });
});

// ---------------------------------------------------------------------------
// judgePostVariants — question shape & state shaping
// ---------------------------------------------------------------------------

describe('judgePostVariants — decide call shape', () => {
  it('ONE decide call: pick Choice(variant_1..N, none_good) + cringe_i Noul per variant', async () => {
    const callLog = [];
    const brain = makeBrain(jevResult({ choice: 'variant_1', confidence: 0.9 }, [0.1, 0.2, 0.3]), callLog);
    await judgePostVariants(TEXTS, { brain });

    expect(brain.decide).toHaveBeenCalledTimes(1); // O(1) per generation, not O(N)
    const { state, questions } = callLog[0];
    expect(state.variants).toEqual([
      { index: 1, text: TEXTS[0] },
      { index: 2, text: TEXTS[1] },
      { index: 3, text: TEXTS[2] },
    ]);
    expect(questions.pick.type).toBe('choice');
    expect(Object.keys(questions.pick.criteria).sort()).toEqual([
      'none_good',
      'variant_1',
      'variant_2',
      'variant_3',
    ]);
    expect(questions.cringe_1.type).toBe('noul');
    expect(questions.cringe_2.type).toBe('noul');
    expect(questions.cringe_3.type).toBe('noul');
  });

  it('truncates variant text to <=500 chars before the paid call', async () => {
    const callLog = [];
    const brain = makeBrain(jevResult(null, [0.1]), callLog);
    await judgePostVariants(['x'.repeat(2500)], { brain });
    expect(callLog[0].state.variants[0].text).toHaveLength(500);
  });

  it('coerces non-string input via String — never throws on weird items', async () => {
    const brain = makeBrain(jevResult(null, [0.1, 0.2]));
    const r = await judgePostVariants([42, { text: 'obj' }], { brain });
    expect(r.degraded).toBe(false);
    expect(r.cringe).toEqual([0.1, 0.2]);
  });

  it('hostile toString/Symbol.toPrimitive item coerces to empty string — never throws', async () => {
    const hostile = { toString() { throw new Error('boom'); } };
    const callLog = [];
    const brain = makeBrain(jevResult(null, [0.1]), callLog);
    const r = await judgePostVariants([hostile], { brain });
    expect(r.degraded).toBe(false);
    expect(callLog[0].state.variants[0].text).toBe('');
  });

  it('caps the judged list at 5 variants — direct callers cannot emit N+1 questions unchecked', async () => {
    const callLog = [];
    const brain = makeBrain(jevResult(null, [0.1, 0.2, 0.3, 0.1, 0.2]), callLog);
    const r = await judgePostVariants(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], { brain });
    expect(callLog[0].state.variants).toHaveLength(5);
    expect(Object.keys(callLog[0].questions).sort()).toEqual([
      'cringe_1', 'cringe_2', 'cringe_3', 'cringe_4', 'cringe_5', 'pick',
    ]);
    expect(r.cringe).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// judgePostVariants — single variant, degraded, kill-switch, empty
// ---------------------------------------------------------------------------

describe('judgePostVariants — edge cases', () => {
  it('SINGLE_VARIANT: skips the pick question but still scores cringe', async () => {
    const callLog = [];
    const brain = makeBrain(jevResult(null, [0.1]), callLog);
    const r = await judgePostVariants(['only variant'], { brain });

    const { questions } = callLog[0];
    expect(questions.pick).toBeUndefined();
    expect(questions.cringe_1.type).toBe('noul');
    expect(r.selectedIndex).toBe(0); // clean → the only variant wins by argmin fallback
    expect(r.pickChoice).toBe(null);
  });

  it('SINGLE_VARIANT cringe → selectedIndex -1 (allCringe path for caller)', async () => {
    const brain = makeBrain(jevResult(null, [0.9]));
    const r = await judgePostVariants(['only variant'], { brain });
    expect(r.selectedIndex).toBe(-1);
  });

  it('DEGRADED: meta.degraded → degraded:true, never throws', async () => {
    const brain = makeBrain(jevDegraded('budget'));
    const r = await judgePostVariants(TEXTS, { brain });
    expect(r).toEqual({ selectedIndex: -1, cringe: [], pickChoice: null, pickConfidence: 0, degraded: true });
  });

  it('decide() rejects → degraded:true, never throws', async () => {
    const brain = makeBrain(new Error('network boom'));
    const r = await judgePostVariants(TEXTS, { brain });
    expect(r.degraded).toBe(true);
  });

  it('NO_API_KEY: real JevBrain without a key degrades — never throws', async () => {
    const brain = new JevBrain({ apiKey: '' }); // real decide → missing-key degrade, no fetch
    const r = await judgePostVariants(TEXTS, { brain });
    expect(r.degraded).toBe(true);
  });

  it('NO_INJECTION: production resolveBrain path — no brain option, empty key → degraded, no fetch', async () => {
    // Exercises the lazy shared JevBrain: TYPESAFE_API_KEY='' (stubbed in
    // beforeEach) → real decide() short-circuits to missing-key fallback
    // before any fetch — deterministic, no network.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const r = await judgePostVariants(TEXTS); // no brain option
      expect(r.degraded).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('KILL_SWITCH: JEV_VARIANT_JUDGE=0 → degraded result, zero decide calls', async () => {
    vi.stubEnv('JEV_VARIANT_JUDGE', '0');
    const brain = makeBrain(jevResult({ choice: 'variant_1', confidence: 0.99 }, [0.1, 0.1, 0.1]));
    const r = await judgePostVariants(TEXTS, { brain });
    expect(r.degraded).toBe(true);
    expect(brain.decide).not.toHaveBeenCalled();
  });

  it('empty/non-array input → no decide call, no selection, not degraded', async () => {
    const brain = makeBrain(jevResult({ choice: 'variant_1', confidence: 0.9 }, [0.1]));
    expect((await judgePostVariants([], { brain })).selectedIndex).toBe(-1);
    expect((await judgePostVariants(null, { brain })).degraded).toBe(false);
    expect((await judgePostVariants('nope', { brain })).selectedIndex).toBe(-1);
    expect(brain.decide).not.toHaveBeenCalled();
  });
});
