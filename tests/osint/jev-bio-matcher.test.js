// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 42.5 — JevBioMatcher: semantic second opinion on cross-platform bio
 * pairs for EntityResolver. No-network: a real JevBrain instance is injected
 * with `decide` stubbed (fakes-at-IO-boundary convention). Covers every row of
 * the spec's I/O & edge-case matrix.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  prefetchBioScores,
  isJevOsintBioMatchEnabled,
  resolveSamePersonThreshold,
  resolveMaxPairs,
} from '../../src/osint/jev-bio-matcher.js';
import { bioPairKey, scorePair, resolveIdentities, MERGE_THRESHOLD } from '../../src/mcp/entity-resolver.js';
import { JevBrain } from '../../src/agents/jevBrain.js';

// ── Factories ────────────────────────────────────────────────────────────────

// A ProfileItem factory — matches normalizeToProfileItems output shape.
const prof = (platform, over = {}) => ({
  id: `${platform}:${over.externalId || over.username || 'x'}`,
  platform,
  externalId: over.externalId || over.username || 'x',
  username: over.username,
  name: over.name,
  bio: over.bio,
  avatar: over.avatar,
  profileUrl: over.profileUrl,
  followersCount: over.followersCount,
  metadata: over.metadata || {},
  crawledAt: new Date('2026-01-01'),
  ...over,
});

const BIO_A = 'Building AI tools @ XActions — open-source scrapers & agents.';
const BIO_B = 'Founder, dev tools. Previously at Cognition. AI agent infra.';
const BIO_C = 'Weekend baker, amateur astronomer, tea over coffee always.';

const jevOk = (score, confidence) => ({
  answers: { samePerson: { type: 'score', score, confidence } },
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

// Cross-platform pair that is a candidate but needs a second opinion:
// name_similar alone = 30 < MERGE_THRESHOLD — exactly the +35 sweet spot.
const candidatePair = () => [
  prof('github', { username: 'nich_dev', name: 'Nicholas', bio: BIO_A }),
  prof('medium', { username: 'xbt_writes', name: 'Nicholas', bio: BIO_B }),
];

beforeEach(() => {
  // vitest.config sets JEV_OSINT_BIO_MATCH=0 for the whole suite — re-enable
  // per test; the kill-switch test stubs it back to '0' explicitly.
  vi.stubEnv('JEV_OSINT_BIO_MATCH', '1');
  vi.stubEnv('TYPESAFE_API_KEY', ''); // belt & suspenders: never a live key
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Env helpers — kill-switch polarity, threshold clamp, max-pairs cap
// ---------------------------------------------------------------------------

describe('env helpers', () => {
  it('JEV_OSINT_BIO_MATCH defaults ON; only 0|false|off|no disables', () => {
    vi.stubEnv('JEV_OSINT_BIO_MATCH', '');
    expect(isJevOsintBioMatchEnabled()).toBe(true);
    vi.unstubAllEnvs();

    expect(isJevOsintBioMatchEnabled(null)).toBe(true);
    expect(isJevOsintBioMatchEnabled('')).toBe(true);
    expect(isJevOsintBioMatchEnabled('1')).toBe(true);
    expect(isJevOsintBioMatchEnabled('true')).toBe(true);
    expect(isJevOsintBioMatchEnabled('anything')).toBe(true);
    expect(isJevOsintBioMatchEnabled('0')).toBe(false);
    expect(isJevOsintBioMatchEnabled('false')).toBe(false);
    expect(isJevOsintBioMatchEnabled('OFF')).toBe(false);
    expect(isJevOsintBioMatchEnabled(' no ')).toBe(false);
    expect(isJevOsintBioMatchEnabled(false)).toBe(false);
  });

  it('JEV_THRESHOLD_SAMEPERSON parses floats, defaults 0.85, clamps [0,1]', () => {
    vi.stubEnv('JEV_THRESHOLD_SAMEPERSON', '');
    expect(resolveSamePersonThreshold()).toBe(0.85);
    vi.unstubAllEnvs();

    expect(resolveSamePersonThreshold('')).toBe(0.85);
    expect(resolveSamePersonThreshold('0.9')).toBe(0.9);
    expect(resolveSamePersonThreshold('garbage')).toBe(0.85);
    expect(resolveSamePersonThreshold(0.65)).toBe(0.65);
    expect(resolveSamePersonThreshold('1.5')).toBe(1);
    expect(resolveSamePersonThreshold('-0.2')).toBe(0);
  });

  it('JEV_OSINT_BIO_MAX_PAIRS parses ints, defaults 30, <=0 disables', () => {
    vi.stubEnv('JEV_OSINT_BIO_MAX_PAIRS', '');
    expect(resolveMaxPairs()).toBe(30);
    vi.unstubAllEnvs();

    expect(resolveMaxPairs('')).toBe(30);
    expect(resolveMaxPairs('45')).toBe(45);
    expect(resolveMaxPairs('garbage')).toBe(30);
    expect(resolveMaxPairs('0')).toBe(0);
    expect(resolveMaxPairs('-5')).toBe(-5);
    expect(resolveMaxPairs(12)).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// prefetchBioScores — happy path & qualify gates
// ---------------------------------------------------------------------------

describe('prefetchBioScores — qualify gates', () => {
  it('HAPPY_MERGE: Jev score=3 conf=0.9 → map entry → +35 bio_semantic merges the cluster', async () => {
    const [a, b] = candidatePair();
    const brain = makeBrain(jevOk(3, 0.9));
    const map = await prefetchBioScores([a, b], { brain });

    expect(brain.decide).toHaveBeenCalledTimes(1);
    expect(map.get(bioPairKey(a, b))).toEqual({ score: 3, confidence: 0.9 });

    // Downstream: 30 (name_similar) + 35 (bio_semantic) = 65 ≥ 40 → merge.
    const clusters = resolveIdentities([a, b], 'nicholas', undefined, map);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].matchedSignals).toContain('bio_semantic');
    expect(clusters[0].matchedSignals).toContain('name_similar');
  });

  it('bio_semantic alone does NOT merge — +35 stays below MERGE_THRESHOLD', async () => {
    const a = prof('github', { username: 'nich_dev', name: 'Nicholas Ray', bio: BIO_A });
    const b = prof('medium', { username: 'xbt', name: 'Zelda Quill', bio: BIO_B }); // names differ → cheap 0
    const brain = makeBrain(jevOk(3, 0.99));
    const map = await prefetchBioScores([a, b], { brain });
    expect(map.size).toBe(1);

    const clusters = resolveIdentities([a, b], 'q', undefined, map);
    expect(clusters).toHaveLength(2); // 35 < 40 — needs a companion signal
  });

  it('BELOW_SCORE: Jev score=1 → no map entry, no signal', async () => {
    const [a, b] = candidatePair();
    const brain = makeBrain(jevOk(1, 0.9));
    const map = await prefetchBioScores([a, b], { brain });
    expect(brain.decide).toHaveBeenCalledTimes(1);
    expect(map.size).toBe(0);
  });

  it('BELOW_CONF: Jev score=3 conf=0.7 (< 0.85) → no map entry', async () => {
    const [a, b] = candidatePair();
    const brain = makeBrain(jevOk(3, 0.7));
    const map = await prefetchBioScores([a, b], { brain });
    expect(map.size).toBe(0);
  });

  it('JEV_THRESHOLD_SAMEPERSON env is honored lazily per call', async () => {
    vi.stubEnv('JEV_THRESHOLD_SAMEPERSON', '0.95');
    const [a, b] = candidatePair();
    const brain = makeBrain(jevOk(3, 0.9)); // 0.9 < 0.95 → no entry
    const map = await prefetchBioScores([a, b], { brain });
    expect(map.size).toBe(0);
  });

  it('DEGRADED: meta.degraded → pair skipped, resolves empty, never throws', async () => {
    const [a, b] = candidatePair();
    const brain = makeBrain(jevDegraded());
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const map = await prefetchBioScores([a, b], { brain });
    expect(map.size).toBe(0);
    expect(log).toHaveBeenCalled(); // one line per skipped pair
    log.mockRestore();
  });

  it('JEV_ERROR: decide() rejects → allSettled swallows, pair absent, never throws', async () => {
    const [a, b] = candidatePair();
    const brain = makeBrain(new Error('network boom'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(prefetchBioScores([a, b], { brain })).resolves.toBeInstanceOf(Map);
    const map = await prefetchBioScores([a, b], { brain });
    expect(map.size).toBe(0);
    warn.mockRestore();
  });

  it('sends exactly the two bio texts + a 0–3 Score question — no envelope, no metadata', async () => {
    const [a, b] = candidatePair();
    const callLog = [];
    const brain = makeBrain(jevOk(2, 0.9), callLog);
    await prefetchBioScores([a, b], { brain });

    const { state, questions } = callLog[0];
    expect(Object.keys(state).sort()).toEqual(['bio1', 'bio2']);
    expect(state.bio1 + state.bio2).toContain('XActions');
    expect(questions.samePerson.type).toBe('score');
    expect(questions.samePerson.criteria).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// prefetchBioScores — candidate gating (no Jev call when unearned)
// ---------------------------------------------------------------------------

describe('prefetchBioScores — candidate gating', () => {
  it('SAME_PLATFORM: a.platform === b.platform → 0 Jev calls', async () => {
    const a = prof('github', { username: 'u1', name: 'Nicholas', bio: BIO_A });
    const b = prof('github', { username: 'u2', name: 'Nicholas', bio: BIO_B });
    const brain = makeBrain(jevOk(3, 0.99));
    const map = await prefetchBioScores([a, b], { brain });
    expect(map.size).toBe(0);
    expect(brain.decide).not.toHaveBeenCalled();
  });

  it('NO_BIO: missing or <20-char bios → 0 Jev calls', async () => {
    const short = 'too short';
    const cases = [
      [prof('a', { username: 'u1', name: 'Nicholas', bio: undefined }), prof('b', { username: 'u2', name: 'Nicholas', bio: BIO_B })],
      [prof('a', { username: 'u1', name: 'Nicholas', bio: short }), prof('b', { username: 'u2', name: 'Nicholas', bio: BIO_B })],
      [prof('a', { username: 'u1', name: 'Nicholas', bio: '   padded   ' }), prof('b', { username: 'u2', name: 'Nicholas', bio: BIO_B })],
    ];
    for (const [a, b] of cases) {
      const brain = makeBrain(jevOk(3, 0.99));
      const map = await prefetchBioScores([a, b], { brain });
      expect(map.size).toBe(0);
      expect(brain.decide).not.toHaveBeenCalled();
    }
  });

  it('ALREADY_MERGED: cheap scorePair ≥ threshold (name+avatar) → 0 Jev calls', async () => {
    const a = prof('github', { username: 'u1', name: 'Nicholas', avatar: 'https://x/same.png', bio: BIO_A });
    const b = prof('medium', { username: 'u2', name: 'Nicholas', avatar: 'https://x/same.png', bio: BIO_B });
    // Sanity: the pair already merges on free signals (30+30=60 ≥ 40).
    expect(scorePair(a, b).score).toBeGreaterThanOrEqual(MERGE_THRESHOLD);

    const brain = makeBrain(jevOk(3, 0.99));
    const map = await prefetchBioScores([a, b], { brain });
    expect(map.size).toBe(0);
    expect(brain.decide).not.toHaveBeenCalled();
  });

  it('username_exact hit → 0 Jev calls (identical usernames merge for free)', async () => {
    const a = prof('github', { username: 'nichxbt', bio: BIO_A });
    const b = prof('medium', { username: 'nichxbt', bio: BIO_B });
    const brain = makeBrain(jevOk(3, 0.99));
    const map = await prefetchBioScores([a, b], { brain });
    expect(brain.decide).not.toHaveBeenCalled();
    expect(map.size).toBe(0);
  });

  it('fewer than 2 profiles / non-array input → empty Map, never throws', async () => {
    const brain = makeBrain(jevOk(3, 0.99));
    expect((await prefetchBioScores(null, { brain })).size).toBe(0);
    expect((await prefetchBioScores('nope', { brain })).size).toBe(0);
    expect((await prefetchBioScores([prof('a', { username: 'u1', bio: BIO_A })], { brain })).size).toBe(0);
    expect(brain.decide).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// prefetchBioScores — spend cap & deterministic ranking
// ---------------------------------------------------------------------------

describe('prefetchBioScores — cap & ranking', () => {
  function buildCapFixture() {
    // 9 'pa' profiles × 5 'pb' profiles = 45 cross-platform candidate pairs.
    // One pb profile ('Nicholas' + MARKER bio) forms 5 name_similar (+30) pairs
    // with the 5 'Nicholas' pa profiles — the highest-cheap-score candidates.
    const pa = [
      ...Array.from({ length: 5 }, (_, i) =>
        prof('pa', { username: `pa_n${i}`, name: 'Nicholas', bio: `Bio pa n${i} — builds dev tools and AI agents.` })),
      ...Array.from({ length: 4 }, (_, i) =>
        prof('pa', { username: `pa_p${i}`, name: `Person ${i}`, bio: `Bio pa p${i} — paints landscapes in oils.` })),
    ];
    const pb = [
      prof('pb', { username: 'pb_n0', name: 'Nicholas', bio: 'MARKER bio — founder of dev tools startup, ex big-tech.' }),
      ...Array.from({ length: 4 }, (_, i) =>
        prof('pb', { username: `pb_a${i}`, name: `Alias ${i}`, bio: `Bio pb a${i} — marathon runner and home baker.` })),
    ];
    return [...pa, ...pb];
  }

  it('CAP_HIT: 45 candidates, default MAX_PAIRS=30 → exactly 30 decide calls', async () => {
    const brain = makeBrain(jevOk(3, 0.9));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const map = await prefetchBioScores(buildCapFixture(), { brain });
    expect(brain.decide).toHaveBeenCalledTimes(30);
    expect(map.size).toBe(30);
    expect(log).toHaveBeenCalled(); // overflow skip logged once
    log.mockRestore();
  });

  it('CAP_HIT ranking: the 5 highest cheap-score pairs are scored first', async () => {
    const callLog = [];
    const brain = makeBrain(jevOk(3, 0.9), callLog);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await prefetchBioScores(buildCapFixture(), { brain });
    // pb_n0 pairs with all 9 pa profiles — but only the 5 against 'Nicholas'
    // pa profiles are cheap=30 (name_similar). Match BOTH bios to isolate
    // exactly those pairs: they must all land in the capped top-30.
    const markerCalls = callLog.filter((c) => {
      const b1 = String(c.state.bio1);
      const b2 = String(c.state.bio2);
      return (b1.includes('MARKER') && b2.includes('Bio pa n')) || (b2.includes('MARKER') && b1.includes('Bio pa n'));
    });
    expect(markerCalls).toHaveLength(5);
    console.log.mockRestore();
  });

  it('JEV_OSINT_BIO_MAX_PAIRS env caps the spend; <=0 disables the pre-pass', async () => {
    const [a, b] = candidatePair();
    const c = prof('reddit', { username: 'u3', name: 'Nicholas', bio: BIO_C });

    vi.stubEnv('JEV_OSINT_BIO_MAX_PAIRS', '1');
    const brain1 = makeBrain(jevOk(3, 0.9));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const map1 = await prefetchBioScores([a, b, c], { brain: brain1 });
    expect(brain1.decide).toHaveBeenCalledTimes(1); // 3 candidates, 1 scored
    expect(map1.size).toBe(1);
    console.log.mockRestore();

    vi.stubEnv('JEV_OSINT_BIO_MAX_PAIRS', '0');
    const brain0 = makeBrain(jevOk(3, 0.9));
    const map0 = await prefetchBioScores([a, b, c], { brain: brain0 });
    expect(brain0.decide).not.toHaveBeenCalled();
    expect(map0.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// prefetchBioScores — kill-switch, degraded plane, identity keys
// ---------------------------------------------------------------------------

describe('prefetchBioScores — kill-switch & degrade safety', () => {
  it('KILL_SWITCH: JEV_OSINT_BIO_MATCH=0 → empty Map, 0 Jev calls', async () => {
    vi.stubEnv('JEV_OSINT_BIO_MATCH', '0');
    const [a, b] = candidatePair();
    const brain = makeBrain(jevOk(3, 0.99));
    const map = await prefetchBioScores([a, b], { brain });
    expect(map.size).toBe(0);
    expect(brain.decide).not.toHaveBeenCalled();
  });

  it('NO_API_KEY: real JevBrain without a key degrades — empty Map, never throws', async () => {
    const [a, b] = candidatePair();
    const brain = new JevBrain({ apiKey: '' }); // real decide → missing-key degrade, no fetch
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const map = await prefetchBioScores([a, b], { brain });
    expect(map.size).toBe(0);
    log.mockRestore();
  });

  it('MISSING_ID: profiles without id still match via platform:username fallback key', async () => {
    const a = prof('github', { id: undefined, username: 'nich_dev', name: 'Nicholas', bio: BIO_A });
    const b = prof('medium', { id: undefined, username: 'xbt', name: 'Nicholas', bio: BIO_B });
    expect(a.id).toBeUndefined();
    expect(bioPairKey(a, b)).toBe('github:nich_dev||medium:xbt');

    const brain = makeBrain(jevOk(3, 0.9));
    const map = await prefetchBioScores([a, b], { brain });
    expect(map.get('github:nich_dev||medium:xbt')).toEqual({ score: 3, confidence: 0.9 });

    // The fallback key must line up between the pre-pass and scorePair.
    const clusters = resolveIdentities([a, b], 'q', undefined, map);
    expect(clusters).toHaveLength(1);
  });
});
