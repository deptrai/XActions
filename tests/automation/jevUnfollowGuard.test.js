// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 42.8 — JevUnfollowGuard: cognitive classification of non-followers
 * before unfollow. No-network: a real JevBrain instance is injected with
 * `decide` stubbed (fakes-at-IO-boundary convention). Covers every row of the
 * spec's I/O & edge-case matrix.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  evaluateUnfollowTargets,
  isJevCognitiveUnfollowEnabled,
  resolveUnfollowThreshold,
  resolveUnfollowMaxEvals,
  isConfidentUnfollowVerdict,
} from '../../src/automation/jevUnfollowGuard.js';
import { JevBrain } from '../../src/agents/jevBrain.js';

// ── Factories ────────────────────────────────────────────────────────────────

const user = (username, over = {}) => ({
  username,
  name: over.name ?? `${username} Name`,
  bio: over.bio ?? `${username} bio text`,
  verified: over.verified ?? false,
  followersCount: over.followersCount ?? 100,
  ...over,
});

const jevVerdict = (choice, confidence) => ({
  answers: { verdict: { type: 'choice', choice, confidence } },
  usage: { input_tokens: 10, output_tokens: 3 },
  meta: { degraded: false, source: 'jev' },
});

const jevDegraded = (reason = 'missing-key') => ({
  answers: {},
  usage: { input_tokens: 0, output_tokens: 0 },
  meta: { degraded: true, reason, source: 'llmbrain' },
});

/**
 * Injected brain: real JevBrain with decide stubbed at the IO boundary.
 * `result` may be a fixed payload, an Error to reject with, or a fn(state).
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
  // vitest.config sets JEV_COGNITIVE_UNFOLLOW=0 for the whole suite — re-enable
  // per test; the kill-switch test stubs it back to '0' explicitly.
  vi.stubEnv('JEV_COGNITIVE_UNFOLLOW', '1');
  vi.stubEnv('TYPESAFE_API_KEY', ''); // belt & suspenders: never a live key
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Env helpers — kill-switch polarity, threshold clamp, max-evals cap
// ---------------------------------------------------------------------------

describe('env helpers', () => {
  it('JEV_COGNITIVE_UNFOLLOW defaults ON; only 0|false|off|no disables', () => {
    vi.stubEnv('JEV_COGNITIVE_UNFOLLOW', '');
    expect(isJevCognitiveUnfollowEnabled()).toBe(true);
    vi.unstubAllEnvs();

    expect(isJevCognitiveUnfollowEnabled(null)).toBe(true);
    expect(isJevCognitiveUnfollowEnabled('')).toBe(true);
    expect(isJevCognitiveUnfollowEnabled('1')).toBe(true);
    expect(isJevCognitiveUnfollowEnabled('true')).toBe(true);
    expect(isJevCognitiveUnfollowEnabled('anything')).toBe(true);
    expect(isJevCognitiveUnfollowEnabled('0')).toBe(false);
    expect(isJevCognitiveUnfollowEnabled('false')).toBe(false);
    expect(isJevCognitiveUnfollowEnabled('OFF')).toBe(false);
    expect(isJevCognitiveUnfollowEnabled(' no ')).toBe(false);
    expect(isJevCognitiveUnfollowEnabled(false)).toBe(false);
  });

  it('JEV_THRESHOLD_UNFOLLOW parses floats, defaults 0.70, clamps [0,1]', () => {
    vi.stubEnv('JEV_THRESHOLD_UNFOLLOW', '');
    expect(resolveUnfollowThreshold()).toBe(0.7);
    vi.unstubAllEnvs();

    expect(resolveUnfollowThreshold('')).toBe(0.7);
    expect(resolveUnfollowThreshold('0.9')).toBe(0.9);
    expect(resolveUnfollowThreshold('garbage')).toBe(0.7);
    expect(resolveUnfollowThreshold(0.65)).toBe(0.65);
    expect(resolveUnfollowThreshold('1.5')).toBe(1);
    expect(resolveUnfollowThreshold('-0.2')).toBe(0);
  });

  it('JEV_UNFOLLOW_MAX_EVALS parses ints, defaults 300, <=0 evaluates nobody', () => {
    vi.stubEnv('JEV_UNFOLLOW_MAX_EVALS', '');
    expect(resolveUnfollowMaxEvals()).toBe(300);
    vi.unstubAllEnvs();

    expect(resolveUnfollowMaxEvals('')).toBe(300);
    expect(resolveUnfollowMaxEvals('45')).toBe(45);
    expect(resolveUnfollowMaxEvals('garbage')).toBe(300);
    expect(resolveUnfollowMaxEvals('0')).toBe(0);
    expect(resolveUnfollowMaxEvals('-5')).toBe(-5);
    expect(resolveUnfollowMaxEvals(12)).toBe(12);
    expect(resolveUnfollowMaxEvals('99999')).toBe(1000); // ceiling
  });
});

// ---------------------------------------------------------------------------
// isConfidentUnfollowVerdict — the fail-safe qualify rule
// ---------------------------------------------------------------------------

describe('isConfidentUnfollowVerdict — fail-safe polarity', () => {
  it('unfollow_* at confidence >= threshold → true', () => {
    expect(isConfidentUnfollowVerdict({ choice: 'unfollow_spam', confidence: 0.9 }, 0.7)).toBe(true);
    expect(isConfidentUnfollowVerdict({ choice: 'unfollow_dead', confidence: 0.7 }, 0.7)).toBe(true);
  });

  it('unfollow_* below threshold → false (keep, fail-safe)', () => {
    expect(isConfidentUnfollowVerdict({ choice: 'unfollow_spam', confidence: 0.69 }, 0.7)).toBe(false);
    expect(isConfidentUnfollowVerdict({ choice: 'unfollow_dead', confidence: 0 }, 0.7)).toBe(false);
  });

  it('keep_* at ANY confidence → false (gate() cannot distinguish — finding #2)', () => {
    expect(isConfidentUnfollowVerdict({ choice: 'keep_high_value_influencer', confidence: 0.99 }, 0.7)).toBe(false);
    expect(isConfidentUnfollowVerdict({ choice: 'keep_active_peer', confidence: 0.99 }, 0.7)).toBe(false);
  });

  it('missing/malformed verdict → false', () => {
    expect(isConfidentUnfollowVerdict(undefined, 0.7)).toBe(false);
    expect(isConfidentUnfollowVerdict(null, 0.7)).toBe(false);
    expect(isConfidentUnfollowVerdict({}, 0.7)).toBe(false);
    expect(isConfidentUnfollowVerdict({ choice: 'unfollow_spam' }, 0.7)).toBe(false);
    expect(isConfidentUnfollowVerdict({ confidence: 0.9 }, 0.7)).toBe(false);
  });

  it('hallucinated unfollow_* outside the fixed criteria → false (strict membership)', () => {
    expect(isConfidentUnfollowVerdict({ choice: 'unfollow_maybe', confidence: 0.99 }, 0.7)).toBe(false);
    expect(isConfidentUnfollowVerdict({ choice: 'unfollow_', confidence: 0.99 }, 0.7)).toBe(false);
    expect(isConfidentUnfollowVerdict({ choice: 'UNFOLLOW_SPAM', confidence: 0.99 }, 0.7)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// evaluateUnfollowTargets — verdict matrix
// ---------------------------------------------------------------------------

describe('evaluateUnfollowTargets — verdict matrix', () => {
  it('records every verdict choice verbatim in the map', async () => {
    const byUser = {
      dead: jevVerdict('unfollow_dead', 0.88),
      spam: jevVerdict('unfollow_spam', 0.91),
      vip: jevVerdict('keep_high_value_influencer', 0.93),
      peer: jevVerdict('keep_active_peer', 0.76),
    };
    const brain = makeBrain((state) => byUser[state.username]);
    const { verdicts, degraded } = await evaluateUnfollowTargets(
      [user('dead'), user('spam'), user('vip'), user('peer')],
      { brain },
    );

    expect(brain.decide).toHaveBeenCalledTimes(4);
    expect(degraded).toBe(0);
    expect(verdicts.get('dead')).toEqual({ choice: 'unfollow_dead', confidence: 0.88 });
    expect(verdicts.get('spam')).toEqual({ choice: 'unfollow_spam', confidence: 0.91 });
    expect(verdicts.get('vip')).toEqual({ choice: 'keep_high_value_influencer', confidence: 0.93 });
    expect(verdicts.get('peer')).toEqual({ choice: 'keep_active_peer', confidence: 0.76 });
  });

  it('low-confidence unfollow_* is recorded but does not qualify', async () => {
    const brain = makeBrain(jevVerdict('unfollow_spam', 0.5));
    const { verdicts } = await evaluateUnfollowTargets([user('spammy')], { brain });
    const v = verdicts.get('spammy');
    expect(v).toEqual({ choice: 'unfollow_spam', confidence: 0.5 });
    expect(isConfidentUnfollowVerdict(v)).toBe(false); // default threshold 0.70
  });

  it('sends a Choice(4) question with the fixed verdict criteria', async () => {
    const callLog = [];
    const brain = makeBrain(jevVerdict('unfollow_spam', 0.9), callLog);
    await evaluateUnfollowTargets([user('x')], { brain });

    const { questions } = callLog[0];
    expect(questions.verdict.type).toBe('choice');
    expect(Object.keys(questions.verdict.criteria).sort()).toEqual([
      'keep_active_peer',
      'keep_high_value_influencer',
      'unfollow_dead',
      'unfollow_spam',
    ]);
  });
});

// ---------------------------------------------------------------------------
// evaluateUnfollowTargets — state shaping & bio bound
// ---------------------------------------------------------------------------

describe('evaluateUnfollowTargets — state shaping', () => {
  it('sends {username, name, bio, verified, followersCount} state', async () => {
    const callLog = [];
    const brain = makeBrain(jevVerdict('keep_active_peer', 0.8), callLog);
    await evaluateUnfollowTargets(
      [user('nich', { name: 'Nich', bio: 'builds tools', verified: true, followersCount: 42000 })],
      { brain },
    );
    const { state } = callLog[0];
    expect(state).toEqual({
      username: 'nich',
      name: 'Nich',
      bio: 'builds tools',
      verified: true,
      followersCount: 42000,
    });
  });

  it('truncates bio to <=500 chars before the paid call', async () => {
    const callLog = [];
    const brain = makeBrain(jevVerdict('unfollow_dead', 0.9), callLog);
    await evaluateUnfollowTargets([user('fat', { bio: 'x'.repeat(2500) })], { brain });
    expect(callLog[0].state.bio).toHaveLength(500);
  });

  it('maps API-v2 fields: description→bio, public_metrics.followers_count→followersCount', async () => {
    const callLog = [];
    const brain = makeBrain(jevVerdict('keep_active_peer', 0.8), callLog);
    await evaluateUnfollowTargets(
      [{ username: 'apiuser', name: 'Api User', description: 'desc bio', verified: true, public_metrics: { followers_count: 777 } }],
      { brain },
    );
    const { state } = callLog[0];
    expect(state.bio).toBe('desc bio');
    expect(state.followersCount).toBe(777);
    expect(state.verified).toBe(true);
  });

  it('missing bio still evaluates — thin state, no skip; empty username is filtered out', async () => {
    const callLog = [];
    const brain = makeBrain(jevVerdict('keep_active_peer', 0.4), callLog);
    const { verdicts } = await evaluateUnfollowTargets(
      [{ username: 'bare' }, { name: 'nameless' }, {}],
      { brain },
    );
    // Only 'bare' is evaluated — nameless entries can't be keyed safely
    // (an '' verdict key would govern every nameless candidate).
    expect(brain.decide).toHaveBeenCalledTimes(1);
    expect(callLog[0].state).toMatchObject({ username: 'bare', name: '', bio: '', verified: false });
    expect(callLog[0].state.followersCount).toBeUndefined();
    expect(verdicts.size).toBe(1);
    expect(verdicts.has('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// evaluateUnfollowTargets — degraded, errors, kill-switch, cap
// ---------------------------------------------------------------------------

describe('evaluateUnfollowTargets — degrade safety', () => {
  it('DEGRADED: meta.degraded → no verdict entry, degraded count++, never throws', async () => {
    const brain = makeBrain(jevDegraded());
    const { verdicts, degraded } = await evaluateUnfollowTargets([user('a'), user('b')], { brain });
    expect(verdicts.size).toBe(0);
    expect(degraded).toBe(2);
  });

  it('degraded fallback answers are NOT minted into the map (no fake unfollow_dead)', async () => {
    // JevBrain._fallbackDecision would synthesize {choice: 'unfollow_dead',
    // confidence: 0} for our criteria — verify the guard drops it entirely.
    const brain = makeBrain(jevDegraded('budget'));
    const { verdicts } = await evaluateUnfollowTargets([user('a')], { brain });
    expect(verdicts.has('a')).toBe(false);
  });

  it('decide() rejects → allSettled swallows, degraded count++, never throws', async () => {
    const brain = makeBrain(new Error('network boom'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { verdicts, degraded } = await evaluateUnfollowTargets([user('a')], { brain });
    expect(verdicts.size).toBe(0);
    expect(degraded).toBe(1);
    warn.mockRestore();
  });

  it('partial degradation: only the failed candidate lacks a verdict', async () => {
    const brain = makeBrain((state) =>
      state.username === 'ok' ? jevVerdict('unfollow_spam', 0.9) : jevDegraded(),
    );
    const { verdicts, degraded } = await evaluateUnfollowTargets([user('ok'), user('bad')], { brain });
    expect(verdicts.get('ok')).toEqual({ choice: 'unfollow_spam', confidence: 0.9 });
    expect(verdicts.has('bad')).toBe(false);
    expect(degraded).toBe(1);
  });

  it('NO_API_KEY: real JevBrain without a key degrades — empty map, never throws', async () => {
    const brain = new JevBrain({ apiKey: '' }); // real decide → missing-key degrade, no fetch
    const { verdicts, degraded } = await evaluateUnfollowTargets([user('a')], { brain });
    expect(verdicts.size).toBe(0);
    expect(degraded).toBe(1);
  });

  it('KILL_SWITCH: JEV_COGNITIVE_UNFOLLOW=0 → empty result, 0 decide calls', async () => {
    vi.stubEnv('JEV_COGNITIVE_UNFOLLOW', '0');
    const brain = makeBrain(jevVerdict('unfollow_spam', 0.99));
    const { verdicts, degraded } = await evaluateUnfollowTargets([user('a'), user('b')], { brain });
    expect(verdicts.size).toBe(0);
    expect(degraded).toBe(0);
    expect(brain.decide).not.toHaveBeenCalled();
  });

  it('CAP: maxEvals bounds decide calls; beyond-cap users get no verdict', async () => {
    const brain = makeBrain(jevVerdict('unfollow_spam', 0.9));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { verdicts } = await evaluateUnfollowTargets(
      [user('u1'), user('u2'), user('u3'), user('u4'), user('u5')],
      { brain, maxEvals: 2 },
    );
    expect(brain.decide).toHaveBeenCalledTimes(2);
    expect(verdicts.size).toBe(2);
    expect(verdicts.has('u1')).toBe(true);
    expect(verdicts.has('u2')).toBe(true);
    log.mockRestore();
  });

  it('JEV_UNFOLLOW_MAX_EVALS env caps the spend; <=0 evaluates nobody', async () => {
    vi.stubEnv('JEV_UNFOLLOW_MAX_EVALS', '1');
    const brain1 = makeBrain(jevVerdict('unfollow_spam', 0.9));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const r1 = await evaluateUnfollowTargets([user('a'), user('b'), user('c')], { brain: brain1 });
    expect(brain1.decide).toHaveBeenCalledTimes(1);
    expect(r1.verdicts.size).toBe(1);

    vi.stubEnv('JEV_UNFOLLOW_MAX_EVALS', '0');
    const brain0 = makeBrain(jevVerdict('unfollow_spam', 0.9));
    const r0 = await evaluateUnfollowTargets([user('a')], { brain: brain0 });
    expect(brain0.decide).not.toHaveBeenCalled();
    expect(r0.verdicts.size).toBe(0);
    log.mockRestore();
  });

  it('empty/non-array input → empty result, never throws', async () => {
    const brain = makeBrain(jevVerdict('unfollow_spam', 0.9));
    expect((await evaluateUnfollowTargets(null, { brain })).verdicts.size).toBe(0);
    expect((await evaluateUnfollowTargets('nope', { brain })).verdicts.size).toBe(0);
    expect((await evaluateUnfollowTargets([], { brain })).verdicts.size).toBe(0);
    expect((await evaluateUnfollowTargets([null, 42], { brain })).degraded).toBe(0);
    expect(brain.decide).not.toHaveBeenCalled();
  });

  it('injected pLimit factory is honored', async () => {
    const calls = [];
    const fakePLimit = (n) => {
      calls.push(n);
      return (fn) => fn();
    };
    const brain = makeBrain(jevVerdict('unfollow_spam', 0.9));
    await evaluateUnfollowTargets([user('a')], { brain, pLimit: fakePLimit });
    expect(calls).toEqual([8]); // EVAL_CONCURRENCY
    expect(brain.decide).toHaveBeenCalledTimes(1);
  });
});
