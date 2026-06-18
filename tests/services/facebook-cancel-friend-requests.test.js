// by nichxbt
// Tests for Story 4.8: cancelPendingFriendRequests (Cluster-2, FR-22, two-phase)
// Browser-free: fake page + injected collectFn/cancelFn/delay-spy seams. No vi.mock.

import { describe, it, expect } from 'vitest';
import {
  cancelPendingFriendRequests,
} from '../../api/services/facebookAutomation.js';

function makeDelaySpy() {
  const calls = [];
  const spy = async (min, max) => { calls.push([min, max]); };
  spy.calls = calls;
  return spy;
}

function makeFakePage() {
  const calls = { goto: [] };
  return {
    calls,
    goto: async (u) => { calls.goto.push(u); },
    click: async () => {},
    $: async () => null,
    $$eval: async () => [],
    evaluate: async () => {},
    waitForSelector: async () => ({}),
  };
}

// collectFn seam: returns a fixed pending list (Phase 1).
function makeCollectFn(items) {
  const calls = [];
  const fn = async (page, limit, delay) => {
    calls.push({ limit });
    return items;
  };
  fn.calls = calls;
  return fn;
}

// cancelFn seam: per-profile cancel; throwOn simulates a button-not-found.
function makeCancelFn({ throwOn = null } = {}) {
  const calls = [];
  const fn = async (page, profileUrl) => {
    calls.push(profileUrl);
    if (throwOn === profileUrl) throw new Error('❌ Cancel-request button not found; request already resolved');
    return { cancelled: true };
  };
  fn.calls = calls;
  return fn;
}

const URL_A = 'https://www.facebook.com/profile.php?id=2001';
const URL_B = 'https://www.facebook.com/profile.php?id=2002';
const URL_C = 'https://www.facebook.com/profile.php?id=2003';

const noDelay = makeDelaySpy();

function mkReq(url, dateSent = null, name = 'Person') {
  return { name, profileUrl: url, dateSent };
}

// ── dry-run ──────────────────────────────────────────────────────────────────

describe('cancelPendingFriendRequests — dry-run', () => {
  it('Phase 1 runs (collectFn called), preview returned, NO cancelFn called', async () => {
    const collectFn = makeCollectFn([mkReq(URL_A), mkReq(URL_B)]);
    const cancelFn = makeCancelFn();
    const result = await cancelPendingFriendRequests(makeFakePage(), {
      limit: 10, collectFn, cancelFn, delay: noDelay,
    });
    expect(result.dryRun).toBe(true);
    expect(result.count).toBe(2);
    expect(result.pending).toEqual([
      { name: 'Person', profileUrl: URL_A, dateSent: null },
      { name: 'Person', profileUrl: URL_B, dateSent: null },
    ]);
    expect(collectFn.calls).toHaveLength(1);
    expect(cancelFn.calls).toHaveLength(0);
  });

  it('empty pending list → { dryRun:true, pending:[], count:0 } (no throw)', async () => {
    const result = await cancelPendingFriendRequests(makeFakePage(), {
      limit: 10, collectFn: makeCollectFn([]), delay: noDelay,
    });
    expect(result.dryRun).toBe(true);
    expect(result.pending).toEqual([]);
    expect(result.count).toBe(0);
  });

  it('caps preview at limit', async () => {
    const items = Array.from({ length: 8 }, (_, i) => mkReq(`https://www.facebook.com/profile.php?id=${i}`));
    const result = await cancelPendingFriendRequests(makeFakePage(), {
      limit: 3, collectFn: makeCollectFn(items), delay: noDelay,
    });
    expect(result.count).toBe(3);
  });
});

// ── real-run ─────────────────────────────────────────────────────────────────

describe('cancelPendingFriendRequests — real run', () => {
  it('collectFn returns N → cancelFn called per item → { cancelled, failed, remaining }', async () => {
    const collectFn = makeCollectFn([mkReq(URL_A), mkReq(URL_B), mkReq(URL_C)]);
    const cancelFn = makeCancelFn();
    const result = await cancelPendingFriendRequests(makeFakePage(), {
      limit: 10, dryRun: false, collectFn, cancelFn, delay: makeDelaySpy(), maxRetry: 0,
    });
    expect(cancelFn.calls).toEqual([URL_A, URL_B, URL_C]);
    expect(result.dryRun).toBe(false);
    expect(result.cancelled).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.remaining).toBe(0);
  });

  it('cancel that throws → counted as failed, batch continues, remaining reflects it', async () => {
    const collectFn = makeCollectFn([mkReq(URL_A), mkReq(URL_B), mkReq(URL_C)]);
    const cancelFn = makeCancelFn({ throwOn: URL_B });
    const result = await cancelPendingFriendRequests(makeFakePage(), {
      limit: 10, dryRun: false, collectFn, cancelFn, delay: makeDelaySpy(), maxRetry: 0,
    });
    expect(cancelFn.calls).toHaveLength(3); // continued past failure
    expect(result.cancelled).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.remaining).toBe(0); // 3 total - 2 cancelled - 1 failed
  });

  it('empty pending list (real) → { cancelled:0, failed:0, remaining:0 } (no throw)', async () => {
    const result = await cancelPendingFriendRequests(makeFakePage(), {
      limit: 10, dryRun: false, collectFn: makeCollectFn([]), cancelFn: makeCancelFn(), delay: noDelay,
    });
    expect(result).toEqual({
      dryRun: false, platform: 'facebook', cancelled: 0, failed: 0, remaining: 0,
    });
  });
});

// ── olderThanDays filter ────────────────────────────────────────────────────

describe('cancelPendingFriendRequests — olderThanDays filter', () => {
  it('only requests older than N days are included', async () => {
    const items = [
      mkReq(URL_A, 'Sent 2 days ago'),    // 2 days — too recent (filter 7)
      mkReq(URL_B, 'Sent 10 days ago'),   // 10 days — included
      mkReq(URL_C, 'Sent 3 weeks ago'),   // 21 days — included
    ];
    const cancelFn = makeCancelFn();
    const result = await cancelPendingFriendRequests(makeFakePage(), {
      limit: 10, dryRun: false, olderThanDays: 7, collectFn: makeCollectFn(items), cancelFn,
      delay: makeDelaySpy(), maxRetry: 0,
    });
    expect(cancelFn.calls.sort()).toEqual([URL_B, URL_C].sort());
    expect(result.cancelled).toBe(2);
  });

  it('unparseable dateSent → INCLUDED (err toward cleanup)', async () => {
    const items = [
      mkReq(URL_A, null),               // unparseable → included
      mkReq(URL_B, 'weird text'),       // unparseable → included
      mkReq(URL_C, 'Sent 1 day ago'),   // 1 day — too recent (filter 30)
    ];
    const cancelFn = makeCancelFn();
    await cancelPendingFriendRequests(makeFakePage(), {
      limit: 10, dryRun: false, olderThanDays: 30, collectFn: makeCollectFn(items), cancelFn,
      delay: makeDelaySpy(), maxRetry: 0,
    });
    expect(cancelFn.calls.sort()).toEqual([URL_A, URL_B].sort());
  });

  it('dry-run with olderThanDays filter → preview reflects filtered list', async () => {
    const items = [
      mkReq(URL_A, 'Sent 1 day ago'),
      mkReq(URL_B, 'Sent 2 months ago'),
    ];
    const result = await cancelPendingFriendRequests(makeFakePage(), {
      limit: 10, olderThanDays: 7, collectFn: makeCollectFn(items), delay: noDelay,
    });
    expect(result.count).toBe(1);
    expect(result.pending[0].profileUrl).toBe(URL_B);
  });
});

// ── delay ────────────────────────────────────────────────────────────────────

describe('cancelPendingFriendRequests — 2-5s delay', () => {
  it('spy receives (2000, 5000) between cancels', async () => {
    const delay = makeDelaySpy();
    await cancelPendingFriendRequests(makeFakePage(), {
      limit: 10, dryRun: false, collectFn: makeCollectFn([mkReq(URL_A), mkReq(URL_B)]),
      cancelFn: makeCancelFn(), delay, maxRetry: 0,
    });
    // Phase-1 collect uses delay too (1000/3000 via the seam in real collect), but the
    // injected collectFn here does NOT call delay — so only Phase-2 batch delays are recorded.
    const batchDelays = delay.calls.filter(([min]) => min === 2000);
    expect(batchDelays.length).toBeGreaterThan(0);
    for (const [min, max] of batchDelays) {
      expect(min).toBe(2000);
      expect(max).toBe(5000);
    }
  });
});

// ── validation ───────────────────────────────────────────────────────────────

describe('cancelPendingFriendRequests — limit validation', () => {
  it('limit 0 → throws', async () => {
    await expect(
      cancelPendingFriendRequests(makeFakePage(), { limit: 0, collectFn: makeCollectFn([]) }),
    ).rejects.toThrow('positive integer');
  });

  it('negative limit → throws', async () => {
    await expect(
      cancelPendingFriendRequests(makeFakePage(), { limit: -5, collectFn: makeCollectFn([]) }),
    ).rejects.toThrow('positive integer');
  });

  it('non-finite limit (NaN/Infinity) → throws', async () => {
    await expect(
      cancelPendingFriendRequests(makeFakePage(), { limit: NaN, collectFn: makeCollectFn([]) }),
    ).rejects.toThrow('positive integer');
    await expect(
      cancelPendingFriendRequests(makeFakePage(), { limit: Infinity, collectFn: makeCollectFn([]) }),
    ).rejects.toThrow('positive integer');
  });

  it('non-integer limit (1.5) → throws', async () => {
    await expect(
      cancelPendingFriendRequests(makeFakePage(), { limit: 1.5, collectFn: makeCollectFn([]) }),
    ).rejects.toThrow('positive integer');
  });

  it('missing limit → throws', async () => {
    await expect(
      cancelPendingFriendRequests(makeFakePage(), { collectFn: makeCollectFn([]) }),
    ).rejects.toThrow('positive integer');
  });
});

// ── safety: no cancel under dry-run ──────────────────────────────────────────

describe('cancelPendingFriendRequests — safety', () => {
  it('dry-run: NO cancelFn click even with a populated pending list', async () => {
    const cancelFn = makeCancelFn();
    await cancelPendingFriendRequests(makeFakePage(), {
      limit: 10, collectFn: makeCollectFn([mkReq(URL_A), mkReq(URL_B)]), cancelFn, delay: noDelay,
    });
    expect(cancelFn.calls).toHaveLength(0);
  });

  it('dryRun:null stays dry-run (strict === false gate)', async () => {
    const cancelFn = makeCancelFn();
    const result = await cancelPendingFriendRequests(makeFakePage(), {
      limit: 10, dryRun: null, collectFn: makeCollectFn([mkReq(URL_A)]), cancelFn, delay: noDelay,
    });
    expect(result.dryRun).toBe(true);
    expect(cancelFn.calls).toHaveLength(0);
  });
});
