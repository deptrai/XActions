// by nichxbt
// Coverage expansion (TEA automate) — Story 4.4 joinFacebookGroups.
// Edge/negative paths + NFR-6 floor branches not covered by facebook-join-groups.test.js.
// Browser-free: fake page + injected joinFn/searchFn/delay seams. No vi.mock.

import { describe, it, expect } from 'vitest';
import {
  joinFacebookGroups,
  GROUP_ACTION_DELAY_FLOOR_MS,
  ACCOUNT_RISK_WARNING,
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

function makeJoinFn({ pendingOn = null, noStatusOn = null } = {}) {
  const calls = [];
  const fn = async (page, groupUrl) => {
    calls.push(groupUrl);
    if (noStatusOn === groupUrl) return { joined: true }; // no status field
    if (pendingOn === groupUrl) return { joined: true, status: 'pending' };
    return { joined: true, status: 'joined' };
  };
  fn.calls = calls;
  return fn;
}

const URL_A = 'https://www.facebook.com/groups/aaa';
const URL_B = 'https://www.facebook.com/groups/bbb';

describe('joinFacebookGroups — input validation', () => {
  it('input not an object (null / string / number) → throws', async () => {
    for (const bad of [null, 'groups', 42]) {
      await expect(joinFacebookGroups(makeFakePage(), bad, { dryRun: false })).rejects.toThrow(
        /input must be|either/,
      );
    }
  });

  it('groupUrls present but not an array → falls through to the neither-mode throw', async () => {
    await expect(
      joinFacebookGroups(makeFakePage(), { groupUrls: URL_A }, { dryRun: false }),
    ).rejects.toThrow(/either|groupUrls.*keyword/);
  });

  it('keyword is whitespace-only → throws (neither mode satisfied)', async () => {
    await expect(
      joinFacebookGroups(makeFakePage(), { keyword: '   ' }, { dryRun: false }),
    ).rejects.toThrow(/either|groupUrls.*keyword/);
  });
});

describe('joinFacebookGroups — keyword mode', () => {
  it('default limit is 10 when omitted (searchFn receives 10)', async () => {
    const seen = [];
    const searchFn = async (page, keyword, limit) => { seen.push({ keyword, limit }); return [URL_A]; };
    await joinFacebookGroups(makeFakePage(), { keyword: 'crypto' }, {
      dryRun: false, searchFn, joinFn: makeJoinFn(), delay: makeDelaySpy(), maxRetry: 0,
    });
    expect(seen[0]).toEqual({ keyword: 'crypto', limit: 10 });
  });

  it('limit 0 / negative / non-integer falls back or floors (0→10, 1.7→1)', async () => {
    const seen = [];
    const searchFn = async (page, keyword, limit) => { seen.push(limit); return [URL_A]; };
    for (const lim of [0, -5]) {
      await joinFacebookGroups(makeFakePage(), { keyword: 'k', limit: lim }, {
        dryRun: false, searchFn, joinFn: makeJoinFn(), delay: makeDelaySpy(), maxRetry: 0,
      });
    }
    await joinFacebookGroups(makeFakePage(), { keyword: 'k', limit: 1.7 }, {
      dryRun: false, searchFn, joinFn: makeJoinFn(), delay: makeDelaySpy(), maxRetry: 0,
    });
    expect(seen).toEqual([10, 10, 1]); // 0→default10, -5→default10, 1.7→floor1
  });

  it('searchFn returns a non-array → empty result, no throw', async () => {
    const result = await joinFacebookGroups(makeFakePage(), { keyword: 'k', limit: 5 }, {
      dryRun: false, searchFn: async () => null, delay: makeDelaySpy(),
    });
    expect(result.results).toEqual([]);
    expect(result.attempted).toBe(0);
  });

  it('searchFn returns a non-facebook URL → throws before any join (SSRF guard on resolved URLs)', async () => {
    await expect(
      joinFacebookGroups(makeFakePage(), { keyword: 'k', limit: 5 }, {
        dryRun: false, searchFn: async () => ['https://evil.com/groups/x'], delay: makeDelaySpy(),
      }),
    ).rejects.toThrow('facebook.com');
  });
});

describe('joinFacebookGroups — NFR-6 delay floor', () => {
  it('delayMin NaN → floored to 30s (not a throw)', async () => {
    const delay = makeDelaySpy();
    await joinFacebookGroups(makeFakePage(), { groupUrls: [URL_A, URL_B] }, {
      dryRun: false, joinFn: makeJoinFn(), delay, delayMin: NaN, maxRetry: 0,
    });
    expect(delay.calls[0][0]).toBe(GROUP_ACTION_DELAY_FLOOR_MS);
  });

  it('delayMin Infinity → floored to 30s', async () => {
    const delay = makeDelaySpy();
    await joinFacebookGroups(makeFakePage(), { groupUrls: [URL_A, URL_B] }, {
      dryRun: false, joinFn: makeJoinFn(), delay, delayMin: Infinity, maxRetry: 0,
    });
    expect(delay.calls[0][0]).toBe(GROUP_ACTION_DELAY_FLOOR_MS);
  });

  it('delayMax below the floor is clamped up to delayMin (>= 30s)', async () => {
    const delay = makeDelaySpy();
    await joinFacebookGroups(makeFakePage(), { groupUrls: [URL_A, URL_B] }, {
      dryRun: false, joinFn: makeJoinFn(), delay, delayMax: 5000, maxRetry: 0,
    });
    const [min, max] = delay.calls[0];
    expect(min).toBe(GROUP_ACTION_DELAY_FLOOR_MS);
    expect(max).toBeGreaterThanOrEqual(min); // never max < min (would throw in runGuardedBatch)
  });
});

describe('joinFacebookGroups — capture-map + safety', () => {
  it('join result without a status field → no status merged onto the entry', async () => {
    const result = await joinFacebookGroups(makeFakePage(), { groupUrls: [URL_A] }, {
      dryRun: false, joinFn: makeJoinFn({ noStatusOn: URL_A }), delay: makeDelaySpy(), maxRetry: 0,
    });
    const a = result.results.find((r) => r.target === URL_A);
    expect(a.ok).toBe(true);
    expect(a).not.toHaveProperty('status');
  });

  it('real-run result surfaces ACCOUNT_RISK_WARNING (NFR-8)', async () => {
    const result = await joinFacebookGroups(makeFakePage(), { groupUrls: [URL_A] }, {
      dryRun: false, joinFn: makeJoinFn(), delay: makeDelaySpy(), maxRetry: 0,
    });
    expect(result.warning).toBe(ACCOUNT_RISK_WARNING);
  });

  it('keyword-mode default dry-run returns empty preview + explanatory warning (no browser)', async () => {
    const page = makeFakePage();
    const result = await joinFacebookGroups(page, { keyword: 'crypto', limit: 5 }, {
      searchFn: async () => [URL_A, URL_B], // must NOT be called in dry-run
    });
    expect(result.dryRun).toBe(true);
    expect(result.preview).toEqual([]);
    expect(result.warning).toMatch(/keyword-mode dry-run/);
    expect(page.calls.goto).toHaveLength(0);
  });
});
