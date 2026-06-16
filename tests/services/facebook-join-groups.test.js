// by nichxbt
// Tests for Story 4.4: joinFacebookGroups + runGuardedBatch delay-range extension
// Browser-free: fake page + injected joinFn/searchFn/delay-spy seams. No vi.mock.

import { describe, it, expect } from 'vitest';
import {
  runGuardedBatch,
  joinFacebookGroups,
  GROUP_ACTION_DELAY_FLOOR_MS,
} from '../../api/services/facebookAutomation.js';

// Delay spy: records every (min,max) it is called with; never actually sleeps.
function makeDelaySpy() {
  const calls = [];
  const spy = async (min, max) => { calls.push([min, max]); };
  spy.calls = calls;
  return spy;
}

const URL_A = 'https://www.facebook.com/groups/aaa';
const URL_B = 'https://www.facebook.com/groups/bbb';

// ── runGuardedBatch delay-range extension (AC1) ──────────────────────────────

describe('runGuardedBatch delay range', () => {
  it('default: inter-item delay uses (1000, 3000) — backward compatible', async () => {
    const delay = makeDelaySpy();
    await runGuardedBatch(['a', 'b'], async () => {}, { dryRun: false, delay, maxRetry: 0 });
    // one inter-item delay (between the 2 items)
    expect(delay.calls).toEqual([[1000, 3000]]);
  });

  it('explicit delayMin/delayMax are passed to the seam', async () => {
    const delay = makeDelaySpy();
    await runGuardedBatch(['a', 'b', 'c'], async () => {}, {
      dryRun: false, delay, maxRetry: 0, delayMin: 30000, delayMax: 90000,
    });
    expect(delay.calls).toEqual([[30000, 90000], [30000, 90000]]);
  });

  it('invalid delayMin (negative / non-finite) → throws', async () => {
    await expect(
      runGuardedBatch(['a'], async () => {}, { dryRun: false, delayMin: -1 }),
    ).rejects.toThrow('delayMin');
    await expect(
      runGuardedBatch(['a'], async () => {}, { dryRun: false, delayMin: Infinity }),
    ).rejects.toThrow('delayMin');
  });

  it('delayMax < delayMin → throws', async () => {
    await expect(
      runGuardedBatch(['a'], async () => {}, { dryRun: false, delayMin: 5000, delayMax: 1000 }),
    ).rejects.toThrow('delayMax');
  });
});

// ── joinFacebookGroups (AC2–AC6) ─────────────────────────────────────────────

function makeFakePage() {
  const calls = { goto: [], click: [] };
  return {
    calls,
    goto: async (u) => { calls.goto.push(u); },
    click: async () => { calls.click.push(true); },
    $: async () => null,
    $$eval: async () => [],
    evaluate: async () => {},
    waitForSelector: async () => ({}),
  };
}

function makeJoinFn({ pendingOn = null, throwOn = null } = {}) {
  const calls = [];
  const fn = async (page, groupUrl) => {
    calls.push({ page, groupUrl });
    if (throwOn === groupUrl) throw new Error('❌ Join button not found; locale unsupported or group unreachable');
    if (pendingOn === groupUrl) return { joined: true, status: 'pending' };
    return { joined: true, status: 'joined' };
  };
  fn.calls = calls;
  return fn;
}

const noDelay = makeDelaySpy();

describe('joinFacebookGroups', () => {
  it('URL-mode dry-run: preview of group URLs, no join, no browser', async () => {
    const page = makeFakePage();
    const joinFn = makeJoinFn();
    const result = await joinFacebookGroups(page, { groupUrls: [URL_A, URL_B] }, { joinFn, delay: noDelay });

    expect(result.dryRun).toBe(true);
    expect(result.preview).toEqual([
      { target: URL_A, action: 'pending' },
      { target: URL_B, action: 'pending' },
    ]);
    expect(joinFn.calls).toHaveLength(0);
    expect(page.calls.goto).toHaveLength(0);
  });

  it('URL-mode real: joinFn called once per URL; joined → ok', async () => {
    const page = makeFakePage();
    const joinFn = makeJoinFn();
    const delay = makeDelaySpy();
    const result = await joinFacebookGroups(page, { groupUrls: [URL_A, URL_B] }, {
      dryRun: false, joinFn, delay, maxRetry: 0,
    });

    expect(joinFn.calls.map((c) => c.groupUrl)).toEqual([URL_A, URL_B]);
    expect(result.results.every((r) => r.ok)).toBe(true);
    expect(result.results.find((r) => r.target === URL_A).status).toBe('joined');
  });

  it('pending join → ok:true with status:pending (NOT failed)', async () => {
    const page = makeFakePage();
    const joinFn = makeJoinFn({ pendingOn: URL_B });
    const result = await joinFacebookGroups(page, { groupUrls: [URL_A, URL_B] }, {
      dryRun: false, joinFn, delay: makeDelaySpy(), maxRetry: 0,
    });

    const b = result.results.find((r) => r.target === URL_B);
    expect(b.ok).toBe(true);
    expect(b.status).toBe('pending');
    expect(result.failed).toBe(0);
  });

  it('keyword-mode dry-run: returns empty preview + warning (does NOT drive browser to resolve URLs)', async () => {
    const page = makeFakePage();
    const searchFn = async () => [URL_A, URL_B];
    const result = await joinFacebookGroups(page, { keyword: 'crypto', limit: 5 }, {
      searchFn, joinFn: makeJoinFn(), delay: noDelay,
    });

    // Keyword dry-run does NOT call searchFn (would drive browser) — returns warning instead.
    expect(result.dryRun).toBe(true);
    expect(result.preview).toEqual([]);
    expect(result.warning).toContain('keyword-mode dry-run');
    expect(page.calls.goto).toHaveLength(0);
  });

  it('keyword-mode real: searchFn resolves URLs → those become batch items joined', async () => {
    const page = makeFakePage();
    const searchFn = async () => [URL_A, URL_B];
    const joinFn = makeJoinFn();
    const result = await joinFacebookGroups(page, { keyword: 'crypto', limit: 5 }, {
      dryRun: false, searchFn, joinFn, delay: makeDelaySpy(), maxRetry: 0,
    });

    expect(result.dryRun).toBe(false);
    expect(joinFn.calls.map((c) => c.groupUrl)).toEqual([URL_A, URL_B]);
    expect(result.results.every((r) => r.ok)).toBe(true);
  });

  it('keyword-mode empty results (real run) → empty result, no throw', async () => {
    const page = makeFakePage();
    const searchFn = async () => [];
    const result = await joinFacebookGroups(page, { keyword: 'nothing', limit: 5 }, {
      dryRun: false, searchFn, delay: noDelay,
    });
    expect(result.preview).toEqual([]);
    expect(result.results).toEqual([]);
  });

  it('delay floor: caller delayMin 5000 → seam receives >= 30000', async () => {
    const page = makeFakePage();
    const delay = makeDelaySpy();
    await joinFacebookGroups(page, { groupUrls: [URL_A, URL_B] }, {
      dryRun: false, joinFn: makeJoinFn(), delay, delayMin: 5000, maxRetry: 0,
    });
    expect(delay.calls.length).toBeGreaterThan(0);
    for (const [min] of delay.calls) {
      expect(min).toBeGreaterThanOrEqual(GROUP_ACTION_DELAY_FLOOR_MS);
    }
  });

  it('default delay range is 30000/90000 when caller omits it', async () => {
    const page = makeFakePage();
    const delay = makeDelaySpy();
    await joinFacebookGroups(page, { groupUrls: [URL_A, URL_B] }, {
      dryRun: false, joinFn: makeJoinFn(), delay, maxRetry: 0,
    });
    expect(delay.calls[0]).toEqual([30000, 90000]);
  });

  it('invalid input (neither groupUrls nor keyword) → throws', async () => {
    await expect(joinFacebookGroups(makeFakePage(), {}, { dryRun: false })).rejects.toThrow(
      /groupUrls.*keyword|either/,
    );
  });

  it('invalid / non-facebook group URL → throws before browser', async () => {
    const page = makeFakePage();
    await expect(
      joinFacebookGroups(page, { groupUrls: ['https://evil.com/groups/x'] }, { dryRun: false }),
    ).rejects.toThrow('facebook.com URL');
    await expect(
      joinFacebookGroups(page, { groupUrls: ['file:///etc/passwd'] }, { dryRun: false }),
    ).rejects.toThrow(/valid URL|http\(s\) URL|facebook\.com URL/);
    expect(page.calls.goto).toHaveLength(0);
  });

  it('a join that throws (button not found) → ok:false, PII-free error, batch continues', async () => {
    const page = makeFakePage();
    const joinFn = makeJoinFn({ throwOn: URL_A });
    const result = await joinFacebookGroups(page, { groupUrls: [URL_A, URL_B] }, {
      dryRun: false, joinFn, delay: makeDelaySpy(), maxRetry: 0,
    });

    expect(joinFn.calls).toHaveLength(2); // batch continued past the failure
    const a = result.results.find((r) => r.target === URL_A);
    expect(a.ok).toBe(false);
    expect(a.error).toContain('Join button not found');
    expect(a.error).not.toMatch(/c_user|xs=|cookie/i);
    expect(result.results.find((r) => r.target === URL_B).ok).toBe(true);
  });

  it('empty groupUrls array → throws', async () => {
    await expect(
      joinFacebookGroups(makeFakePage(), { groupUrls: [] }, { dryRun: false }),
    ).rejects.toThrow('non-empty array');
  });
});
