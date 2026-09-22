// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 42.9 — tweetGenerator × JevVariantJudge wiring.
 *
 * No-network: `fetch` is stubbed at the HTTP boundary for the LLM provider
 * call (callLLM → OpenRouter-shaped payload), and a real JevBrain is injected
 * via the `jevBrain` option with `decide` stubbed — the same
 * fakes-at-IO-boundary convention as tests/automation/jevUnfollowGuard.test.js.
 * Covers selected annotation, the bounded re-roll path, degraded passthrough,
 * and the kill-switch.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateTweet, generateReply, rewriteTweet } from '../../src/ai/tweetGenerator.js';
import { analyzeVoice } from '../../src/ai/voiceAnalyzer.js';
import { JevBrain } from '../../src/agents/jevBrain.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const sampleTweets = Array.from({ length: 30 }, (_, i) => ({
  text: `shipping fast beats perfection — build ${i} things and ship them today`,
  likes: 100 - i,
  retweets: 20 - (i % 5),
  replies: 5,
  createdAt: new Date(2026, 0, i + 1).toISOString(),
}));

const voiceProfile = analyzeVoice('nirholas', sampleTweets, { minTweets: 1 });

const VARIANTS = [
  { text: 'variant one', estimatedEngagement: 'high', reasoning: 'r1' },
  { text: 'variant two', estimatedEngagement: 'medium', reasoning: 'r2' },
  { text: 'variant three', estimatedEngagement: 'low', reasoning: 'r3' },
];

const VARIANTS_V2 = [
  { text: 'rerolled one', estimatedEngagement: 'high', reasoning: 'rr1' },
  { text: 'rerolled two', estimatedEngagement: 'medium', reasoning: 'rr2' },
];

const REPLY_VARIANTS = [
  { text: 'reply one', tone: 'agree', reasoning: 'r1' },
  { text: 'reply two', tone: 'add-on', reasoning: 'r2' },
];

/**
 * fetch stub for callLLM — returns successive payloads from `bodies`
 * (last one repeats if exhausted). Each body is JSON.stringify'ed into the
 * OpenAI-compatible `choices[0].message.content` envelope.
 */
function stubLLMFetch(bodies) {
  let calls = 0;
  const fetchMock = vi.fn().mockImplementation(async () => {
    const body = bodies[Math.min(calls, bodies.length - 1)];
    calls++;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(body) } }],
        model: 'test-model',
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }),
      text: async () => '',
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const jevResult = (pick, nouls) => {
  const answers = {};
  if (pick) answers.pick = { type: 'choice', choice: pick.choice, confidence: pick.confidence };
  nouls.forEach((n, i) => {
    answers[`cringe_${i + 1}`] = { type: 'noul', noul: n };
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

/** Injected brain: real JevBrain with decide stubbed at the IO boundary. */
function makeBrain(result) {
  const brain = new JevBrain({ apiKey: 'test-jev-key' });
  brain.decide = vi.fn().mockImplementation(async () => {
    if (result instanceof Error) throw result;
    if (typeof result === 'function') return result();
    return result;
  });
  return brain;
}

beforeEach(() => {
  // vitest.config sets JEV_VARIANT_JUDGE=0 — re-enable per test.
  vi.stubEnv('JEV_VARIANT_JUDGE', '1');
  vi.stubEnv('TYPESAFE_API_KEY', '');
  vi.stubEnv('JEV_VARIANT_JUDGE_MAX_REROLL', '1');
  // Ambient provider keys would flip resolveProvider off 'openrouter' and
  // break provider assertions (mirrors tweetWriter.test.js env hygiene).
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('XAI_API_KEY', '');
  vi.stubEnv('GROK_API_KEY', '');
  vi.stubEnv('OPENROUTER_API_KEY', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// generateTweet — happy path + annotation
// ---------------------------------------------------------------------------

describe('generateTweet — Jev variant judge wiring', () => {
  it('HAPPY_PATH: winner gets selected:true, every item gets cringe, jevJudge meta exposed', async () => {
    stubLLMFetch([VARIANTS]);
    const brain = makeBrain(jevResult({ choice: 'variant_2', confidence: 0.87 }, [0.2, 0.1, 0.3]));

    const result = await generateTweet(voiceProfile, { topic: 'shipping', apiKey: 'k', jevBrain: brain });

    expect(brain.decide).toHaveBeenCalledTimes(1); // one decide per generation
    expect(result.tweets).toHaveLength(3);
    expect(result.tweets[0].selected).toBe(false);
    expect(result.tweets[1].selected).toBe(true);
    expect(result.tweets[2].selected).toBe(false);
    expect(result.tweets[0].cringe).toBe(0.2);
    expect(result.tweets[1].cringe).toBe(0.1);
    expect(result.tweets[2].cringe).toBe(0.3);
    expect(result.jevJudge).toMatchObject({
      selectedIndex: 1,
      confidence: 0.87,
      pick: 'variant_2',
    });
    // Backward-compat: pre-story fields intact
    expect(result.tone).toBe(null);
    expect(result.model).toBe('test-model');
    expect(result.provider).toBe('openrouter');
  });

  it('WINNER_CRINGE: picked variant fails the gate → clean argmin wins', async () => {
    stubLLMFetch([VARIANTS]);
    const brain = makeBrain(jevResult({ choice: 'variant_1', confidence: 0.95 }, [0.8, 0.1, 0.2]));

    const result = await generateTweet(voiceProfile, { topic: 'shipping', apiKey: 'k', jevBrain: brain });

    expect(result.tweets[1].selected).toBe(true);
    expect(result.jevJudge.selectedIndex).toBe(1);
    expect(result.jevJudge.pick).toBe('variant_1'); // raw pick still exposed
  });

  it('PARSE_EDGE: non-array LLM payload is normalized before judging', async () => {
    stubLLMFetch([{ text: 'solo object', estimatedEngagement: 'low', reasoning: 'r' }]);
    const brain = makeBrain(jevResult(null, [0.1]));

    const result = await generateTweet(voiceProfile, { topic: 'shipping', apiKey: 'k', jevBrain: brain });

    expect(result.tweets).toHaveLength(1);
    expect(result.tweets[0].cringe).toBe(0.1);
    expect(result.tweets[0].selected).toBe(true);
    expect(result.jevJudge.selectedIndex).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// generateTweet — all-cringe bounded re-roll
// ---------------------------------------------------------------------------

describe('generateTweet — all-cringe re-roll', () => {
  it('ALL_CRINGE → re-rolls the LLM once, re-judges, selects a clean variant', async () => {
    const fetchMock = stubLLMFetch([VARIANTS, VARIANTS_V2]);
    const verdicts = [
      jevResult({ choice: 'variant_1', confidence: 0.9 }, [0.9, 0.8, 0.7]), // all cringe
      jevResult({ choice: 'variant_2', confidence: 0.8 }, [0.4, 0.1]),      // clean after reroll
    ];
    const brain = new JevBrain({ apiKey: 'test-jev-key' });
    brain.decide = vi.fn().mockImplementation(async () => verdicts.shift());

    const result = await generateTweet(voiceProfile, { topic: 'shipping', apiKey: 'k', jevBrain: brain });

    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 initial + 1 reroll
    expect(brain.decide).toHaveBeenCalledTimes(2);
    expect(result.tweets).toHaveLength(2); // the rerolled set
    expect(result.tweets[0].text).toBe('rerolled one');
    expect(result.tweets[1].selected).toBe(true);
    expect(result.jevJudge).toMatchObject({ selectedIndex: 1, rerolls: 1 });
    expect(result.jevJudge.allCringe).toBeUndefined();
    // Usage accumulates across the re-roll — the discarded attempt's tokens count.
    expect(result.usage.prompt_tokens).toBe(20);
    expect(result.usage.completion_tokens).toBe(40);
  });

  it('unusable re-roll (empty/non-array payload) → no wasted re-judge, allCringe on original set', async () => {
    const fetchMock = stubLLMFetch([VARIANTS, []]); // reroll returns an empty array
    const brain = makeBrain(jevResult(null, [0.9, 0.8, 0.7])); // always all-cringe

    const result = await generateTweet(voiceProfile, { topic: 'shipping', apiKey: 'k', jevBrain: brain });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(brain.decide).toHaveBeenCalledTimes(1); // NOT re-judged — the set never changed
    expect(result.tweets).toHaveLength(3); // original variants kept
    expect(result.jevJudge.allCringe).toBe(true);
  });

  it('primitive (bare-string) variants pass through unchanged — scores observable via jevJudge.cringe', async () => {
    stubLLMFetch([['bare one', 'bare two']]);
    const brain = makeBrain(jevResult({ choice: 'variant_2', confidence: 0.8 }, [0.2, 0.1]));

    const result = await generateTweet(voiceProfile, { topic: 'shipping', apiKey: 'k', jevBrain: brain });

    expect(result.tweets).toEqual(['bare one', 'bare two']); // element types preserved — no wrapping
    expect(result.jevJudge.cringe).toEqual([0.2, 0.1]);
    expect(result.jevJudge.selectedIndex).toBe(1);
  });

  it('still all-cringe after the single re-roll → allCringe:true, nothing selected, bounded', async () => {
    const fetchMock = stubLLMFetch([VARIANTS, VARIANTS_V2, VARIANTS]);
    const brain = makeBrain(jevResult({ choice: 'variant_1', confidence: 0.9 }, [0.9, 0.8, 0.7]));

    const result = await generateTweet(voiceProfile, { topic: 'shipping', apiKey: 'k', jevBrain: brain });

    // Exactly one re-roll — JEV_VARIANT_JUDGE_MAX_REROLL default is 1.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(brain.decide).toHaveBeenCalledTimes(2);
    expect(result.jevJudge.allCringe).toBe(true);
    expect(result.jevJudge.selectedIndex).toBe(-1);
    expect(result.tweets.every((t) => !t.selected)).toBe(true);
  });

  it('JEV_VARIANT_JUDGE_MAX_REROLL=0 → no re-roll at all', async () => {
    vi.stubEnv('JEV_VARIANT_JUDGE_MAX_REROLL', '0');
    const fetchMock = stubLLMFetch([VARIANTS]);
    const brain = makeBrain(jevResult(null, [0.9, 0.8, 0.7]));

    const result = await generateTweet(voiceProfile, { topic: 'shipping', apiKey: 'k', jevBrain: brain });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(brain.decide).toHaveBeenCalledTimes(1);
    expect(result.jevJudge.allCringe).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generateTweet — degraded + kill-switch
// ---------------------------------------------------------------------------

describe('generateTweet — degrade safety', () => {
  it('DEGRADED: variants untouched + jevJudge.degraded:true, never throws', async () => {
    stubLLMFetch([VARIANTS]);
    const brain = makeBrain(jevDegraded('timeout'));

    const result = await generateTweet(voiceProfile, { topic: 'shipping', apiKey: 'k', jevBrain: brain });

    expect(result.jevJudge).toEqual({ degraded: true });
    expect(result.tweets).toEqual(VARIANTS); // pristine — no cringe/selected fields
  });

  it('KILL_SWITCH: JEV_VARIANT_JUDGE=0 → zero decide calls, byte-identical pre-story shape', async () => {
    vi.stubEnv('JEV_VARIANT_JUDGE', '0');
    stubLLMFetch([VARIANTS]);
    const brain = makeBrain(jevResult({ choice: 'variant_1', confidence: 0.99 }, [0.1, 0.1, 0.1]));

    const result = await generateTweet(voiceProfile, { topic: 'shipping', apiKey: 'k', jevBrain: brain });

    expect(brain.decide).not.toHaveBeenCalled();
    expect(result).toEqual({
      tweets: VARIANTS,
      tone: null,
      model: 'test-model',
      provider: 'openrouter',
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    });
    expect('jevJudge' in result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generateReply — same judge wiring on the reply surface
// ---------------------------------------------------------------------------

describe('generateReply — Jev variant judge wiring', () => {
  it('annotates replies with cringe + selected and exposes jevJudge', async () => {
    stubLLMFetch([REPLY_VARIANTS]);
    const brain = makeBrain(jevResult({ choice: 'variant_1', confidence: 0.9 }, [0.1, 0.2]));

    const result = await generateReply(voiceProfile, 'original tweet text', {
      apiKey: 'k',
      jevBrain: brain,
    });

    expect(result.originalTweet).toBe('original tweet text');
    expect(result.replies[0].selected).toBe(true);
    expect(result.replies[1].selected).toBe(false);
    expect(result.replies[0].cringe).toBe(0.1);
    expect(result.jevJudge.selectedIndex).toBe(0);
  });

  it('re-roll path works on replies too', async () => {
    const fetchMock = stubLLMFetch([REPLY_VARIANTS, REPLY_VARIANTS]);
    const brain = makeBrain(jevResult(null, [0.9, 0.9])); // always all-cringe

    const result = await generateReply(voiceProfile, 'original tweet text', {
      apiKey: 'k',
      jevBrain: brain,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2); // bounded at 1 re-roll
    expect(result.jevJudge.allCringe).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// rewriteTweet — same judge wiring on the rewrite surface
// ---------------------------------------------------------------------------

const REWRITE_VARIANTS = [
  { text: 'rewrite one', improvement: 'tighter hook' },
  { text: 'rewrite two', improvement: 'more casual' },
];

describe('rewriteTweet — Jev variant judge wiring', () => {
  it('annotates rewrites with cringe + selected and exposes jevJudge', async () => {
    stubLLMFetch([REWRITE_VARIANTS]);
    const brain = makeBrain(jevResult({ choice: 'variant_2', confidence: 0.9 }, [0.4, 0.1]));

    const result = await rewriteTweet(voiceProfile, 'original draft', { apiKey: 'k', jevBrain: brain });

    expect(result.original).toBe('original draft');
    expect(result.rewrites[0].selected).toBe(false); // pick gated by cringe 0.4 > 0.3 → argmin wins
    expect(result.rewrites[1].selected).toBe(true);
    expect(result.rewrites[0].cringe).toBe(0.4);
    expect(result.rewrites[1].cringe).toBe(0.1);
    expect(result.jevJudge).toMatchObject({ selectedIndex: 1, confidence: 0.9, pick: 'variant_2' });
    expect(result.jevJudge.cringe).toEqual([0.4, 0.1]);
  });

  it('KILL_SWITCH: JEV_VARIANT_JUDGE=0 → byte-identical pre-story shape', async () => {
    vi.stubEnv('JEV_VARIANT_JUDGE', '0');
    stubLLMFetch([REWRITE_VARIANTS]);
    const brain = makeBrain(jevResult({ choice: 'variant_1', confidence: 0.99 }, [0.1, 0.1]));

    const result = await rewriteTweet(voiceProfile, 'original draft', { apiKey: 'k', jevBrain: brain });

    expect(brain.decide).not.toHaveBeenCalled();
    expect(result).toEqual({
      original: 'original draft',
      goal: 'more_engaging',
      rewrites: REWRITE_VARIANTS,
      model: 'test-model',
      provider: 'openrouter',
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    });
    expect('jevJudge' in result).toBe(false);
  });
});
