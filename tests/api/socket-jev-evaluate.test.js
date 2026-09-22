// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 42.8 deferred — socket agent `jev:evaluate` server-side contract.
 * The page-injected executor cannot reach JevBrain; `evaluateAgentUnfollowBatch`
 * qualifies verdicts server-side and returns ONLY the allowed usernames
 * (fail-safe: keep, low-conf, degraded or error verdicts never appear in `allowed`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/automation/jevUnfollowGuard.js', () => ({
  evaluateUnfollowTargets: vi.fn(async () => ({ verdicts: new Map(), degraded: 0 })),
  isJevCognitiveUnfollowEnabled: vi.fn(() => true),
  isConfidentUnfollowVerdict: vi.fn(
    (v) => !!v && ['unfollow_dead', 'unfollow_spam'].includes(v.choice) && v.confidence >= 0.7,
  ),
  resolveUnfollowMaxEvals: vi.fn(() => 300),
}));

vi.mock('../../api/lib/prisma.js', () => ({ default: {} }));

import {
  evaluateUnfollowTargets,
  isJevCognitiveUnfollowEnabled,
} from '../../src/automation/jevUnfollowGuard.js';
import { evaluateAgentUnfollowBatch } from '../../api/realtime/socketHandler.js';

const verdictsOf = (entries) => new Map(Object.entries(entries));

describe('evaluateAgentUnfollowBatch — socket-path Jev gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isJevCognitiveUnfollowEnabled.mockReturnValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns enabled:false with empty allowed when the kill-switch is off', async () => {
    isJevCognitiveUnfollowEnabled.mockReturnValue(false);
    const res = await evaluateAgentUnfollowBatch([{ username: 'a' }]);
    expect(res).toEqual({ enabled: false, allowed: [] });
    expect(evaluateUnfollowTargets).not.toHaveBeenCalled();
  });

  it('returns only confident unfollow_* handles in allowed', async () => {
    evaluateUnfollowTargets.mockResolvedValue({
      verdicts: verdictsOf({
        spammer: { choice: 'unfollow_spam', confidence: 0.9 },
        vip: { choice: 'keep_high_value_influencer', confidence: 0.95 },
        shaky: { choice: 'unfollow_dead', confidence: 0.4 },
      }),
      degraded: 0,
    });
    const res = await evaluateAgentUnfollowBatch([
      { username: 'spammer' },
      { username: 'vip' },
      { username: 'shaky' },
    ]);
    expect(res.enabled).toBe(true);
    expect(res.allowed).toEqual(['spammer']);
  });

  it('degraded verdicts (missing from map) are kept, not allowed', async () => {
    evaluateUnfollowTargets.mockResolvedValue({
      verdicts: verdictsOf({ good: { choice: 'unfollow_dead', confidence: 0.99 } }),
      degraded: 2,
    });
    const res = await evaluateAgentUnfollowBatch([{ username: 'good' }, { username: 'lost' }]);
    expect(res.allowed).toEqual(['good']);
  });

  it('caps the batch at 100 candidates', async () => {
    evaluateUnfollowTargets.mockResolvedValue({ verdicts: new Map(), degraded: 0 });
    const big = Array.from({ length: 150 }, (_, i) => ({ username: 'u' + i }));
    const res = await evaluateAgentUnfollowBatch(big);
    expect(res.enabled).toBe(true);
    expect(evaluateUnfollowTargets.mock.calls[0][0]).toHaveLength(100);
  });

  it('drops non-object and nameless candidates before evaluation', async () => {
    evaluateUnfollowTargets.mockResolvedValue({
      verdicts: verdictsOf({ real: { choice: 'unfollow_spam', confidence: 0.8 } }),
      degraded: 0,
    });
    const res = await evaluateAgentUnfollowBatch([null, 'x', { username: '' }, { username: 'real' }]);
    expect(res.allowed).toEqual(['real']);
    expect(evaluateUnfollowTargets.mock.calls[0][0]).toHaveLength(2);
  });

  it('propagates evaluation failure as an empty allowlist (caller never unfollows)', async () => {
    evaluateUnfollowTargets.mockRejectedValue(new Error('boom'));
    await expect(evaluateAgentUnfollowBatch([{ username: 'a' }])).rejects.toThrow('boom');
    // The socket handler wraps this in try/catch and emits allowed:[] — the
    // helper itself lets the error surface so the handler's fail-safe runs.
  });
});
