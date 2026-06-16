// by nichxbt
// Coverage expansion (TEA automate) — Story 4.5 postToFacebookGroups.
// Edge/negative paths + NFR-6 floor branches not covered by facebook-batch-post-groups.test.js.
// Browser-free: fake page + injected postFn/delay seams. No vi.mock.

import { describe, it, expect } from 'vitest';
import {
  postToFacebookGroups,
  GROUP_POST_BATCH_LIMIT,
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
  return {
    goto: async () => {},
    $: async () => null,
    $$eval: async () => [],
    evaluate: async () => {},
    waitForSelector: async () => ({}),
    keyboard: { type: async () => {} },
    click: async () => {},
    url: () => 'https://www.facebook.com/groups/aaa',
  };
}

function makePostFn({ throwOn = null } = {}) {
  const calls = [];
  const fn = async (page, groupUrl, content) => {
    calls.push({ groupUrl, content });
    if (throwOn === groupUrl) throw new Error('❌ Group post composer not found; group unreachable or locale unsupported');
    return { posted: true };
  };
  fn.calls = calls;
  return fn;
}

const URL_A = 'https://www.facebook.com/groups/aaa';
const URL_B = 'https://www.facebook.com/groups/bbb';
const CONTENT = 'Hello from XActions 🎉';

// ── NFR-6 delay floor — invalid / boundary inputs ────────────────────────────

describe('postToFacebookGroups — NFR-6 delay floor edge cases', () => {
  it('delayMin: NaN → floored to 30s (not a throw)', async () => {
    const delay = makeDelaySpy();
    await postToFacebookGroups(
      makeFakePage(),
      { groupUrls: [URL_A, URL_B], content: CONTENT },
      { dryRun: false, postFn: makePostFn(), delay, delayMin: NaN, maxRetry: 0 },
    );
    expect(delay.calls[0][0]).toBe(GROUP_ACTION_DELAY_FLOOR_MS);
  });

  it('delayMin: Infinity → floored to 30s', async () => {
    const delay = makeDelaySpy();
    await postToFacebookGroups(
      makeFakePage(),
      { groupUrls: [URL_A, URL_B], content: CONTENT },
      { dryRun: false, postFn: makePostFn(), delay, delayMin: Infinity, maxRetry: 0 },
    );
    expect(delay.calls[0][0]).toBe(GROUP_ACTION_DELAY_FLOOR_MS);
  });

  it('delayMin: negative → floored to 30s', async () => {
    const delay = makeDelaySpy();
    await postToFacebookGroups(
      makeFakePage(),
      { groupUrls: [URL_A, URL_B], content: CONTENT },
      { dryRun: false, postFn: makePostFn(), delay, delayMin: -1000, maxRetry: 0 },
    );
    expect(delay.calls[0][0]).toBe(GROUP_ACTION_DELAY_FLOOR_MS);
  });

  it('delayMax: NaN → falls back to GROUP_ACTION_DELAY_MAX_MS (90s)', async () => {
    const delay = makeDelaySpy();
    await postToFacebookGroups(
      makeFakePage(),
      { groupUrls: [URL_A, URL_B], content: CONTENT },
      { dryRun: false, postFn: makePostFn(), delay, delayMax: NaN, maxRetry: 0 },
    );
    expect(delay.calls[0][1]).toBe(90000);
  });

  it('delayMax below floor → clamped up to delayMin (never max < min)', async () => {
    const delay = makeDelaySpy();
    await postToFacebookGroups(
      makeFakePage(),
      { groupUrls: [URL_A, URL_B], content: CONTENT },
      { dryRun: false, postFn: makePostFn(), delay, delayMax: 5000, maxRetry: 0 },
    );
    const [min, max] = delay.calls[0];
    expect(min).toBe(GROUP_ACTION_DELAY_FLOOR_MS);
    expect(max).toBeGreaterThanOrEqual(min);
  });

  it('explicit delayMin: 40000 (above floor) is respected; delayMax defaults to 90s', async () => {
    const delay = makeDelaySpy();
    await postToFacebookGroups(
      makeFakePage(),
      { groupUrls: [URL_A, URL_B], content: CONTENT },
      { dryRun: false, postFn: makePostFn(), delay, delayMin: 40000, maxRetry: 0 },
    );
    expect(delay.calls[0][0]).toBe(40000);
    expect(delay.calls[0][1]).toBe(90000);
  });
});

// ── strict dryRun gate ────────────────────────────────────────────────────────

describe('postToFacebookGroups — strict dryRun gate', () => {
  it('dryRun: null → stays in dry-run (not treated as false)', async () => {
    const postFn = makePostFn();
    const result = await postToFacebookGroups(
      makeFakePage(),
      { groupUrls: [URL_A], content: CONTENT },
      { dryRun: null, postFn, delay: makeDelaySpy() },
    );
    expect(result.dryRun).toBe(true);
    expect(postFn.calls).toHaveLength(0);
  });

  it('dryRun: undefined (omitted) → stays in dry-run', async () => {
    const postFn = makePostFn();
    const result = await postToFacebookGroups(
      makeFakePage(),
      { groupUrls: [URL_A], content: CONTENT },
      { postFn, delay: makeDelaySpy() },
    );
    expect(result.dryRun).toBe(true);
    expect(postFn.calls).toHaveLength(0);
  });

  it('dryRun: 0 → stays in dry-run (only explicit false triggers real writes)', async () => {
    const postFn = makePostFn();
    const result = await postToFacebookGroups(
      makeFakePage(),
      { groupUrls: [URL_A], content: CONTENT },
      { dryRun: 0, postFn, delay: makeDelaySpy() },
    );
    expect(result.dryRun).toBe(true);
    expect(postFn.calls).toHaveLength(0);
  });

  it('dryRun: "false" (string) → stays in dry-run', async () => {
    const postFn = makePostFn();
    const result = await postToFacebookGroups(
      makeFakePage(),
      { groupUrls: [URL_A], content: CONTENT },
      { dryRun: 'false', postFn, delay: makeDelaySpy() },
    );
    expect(result.dryRun).toBe(true);
    expect(postFn.calls).toHaveLength(0);
  });
});

// ── input validation — additional type guards ─────────────────────────────────

describe('postToFacebookGroups — input validation edge cases', () => {
  it('input not an object (string / number / null / undefined) → throws', async () => {
    for (const bad of [null, undefined, 'groups', 42, true]) {
      await expect(
        postToFacebookGroups(makeFakePage(), bad, { dryRun: false }),
      ).rejects.toThrow();
    }
  });

  it('groupUrls contains non-string items (null, number) → assertFacebookUrl throws', async () => {
    await expect(
      postToFacebookGroups(makeFakePage(), { groupUrls: [null], content: CONTENT }, { dryRun: false }),
    ).rejects.toThrow();
    await expect(
      postToFacebookGroups(makeFakePage(), { groupUrls: [123], content: CONTENT }, { dryRun: false }),
    ).rejects.toThrow();
  });

  it('content: number → throws (not a string)', async () => {
    await expect(
      postToFacebookGroups(makeFakePage(), { groupUrls: [URL_A], content: 42 }, { dryRun: false }),
    ).rejects.toThrow('non-empty string');
  });

  it('content: null → throws', async () => {
    await expect(
      postToFacebookGroups(makeFakePage(), { groupUrls: [URL_A], content: null }, { dryRun: false }),
    ).rejects.toThrow('non-empty string');
  });

  it('content: object → throws', async () => {
    await expect(
      postToFacebookGroups(makeFakePage(), { groupUrls: [URL_A], content: { text: 'hi' } }, { dryRun: false }),
    ).rejects.toThrow('non-empty string');
  });

  it('groupUrls: not an array (string) → throws non-empty array error', async () => {
    await expect(
      postToFacebookGroups(makeFakePage(), { groupUrls: URL_A, content: CONTENT }, { dryRun: false }),
    ).rejects.toThrow('non-empty array');
  });

  it('mediaUrls: empty array → valid (no throw, no mediaUrlsNote on real run)', async () => {
    const postFn = makePostFn();
    const result = await postToFacebookGroups(
      makeFakePage(),
      { groupUrls: [URL_A], content: CONTENT, mediaUrls: [] },
      { dryRun: false, postFn, delay: makeDelaySpy(), maxRetry: 0 },
    );
    expect(result.dryRun).toBe(false);
    expect(result).not.toHaveProperty('mediaUrlsNote');
  });

  it('mediaUrls: empty array in dry-run → mediaUrlsNote emitted', async () => {
    const result = await postToFacebookGroups(
      makeFakePage(),
      { groupUrls: [URL_A], content: CONTENT, mediaUrls: [] },
      { delay: makeDelaySpy() },
    );
    expect(result.dryRun).toBe(true);
    expect(result.mediaUrlsNote).toMatch(/reserved|not-yet-implemented|future/i);
  });

  it('content with leading/trailing whitespace → valid (has non-whitespace chars)', async () => {
    const postFn = makePostFn();
    const result = await postToFacebookGroups(
      makeFakePage(),
      { groupUrls: [URL_A], content: '  hello  ' },
      { dryRun: false, postFn, delay: makeDelaySpy(), maxRetry: 0 },
    );
    expect(result.succeeded).toBe(1);
    expect(postFn.calls[0].content).toBe('  hello  ');
  });
});

// ── batchLimit / force edge cases ─────────────────────────────────────────────

describe('postToFacebookGroups — batchLimit edge cases', () => {
  it('force: false explicit → same as omitting force (throws at 11)', async () => {
    const urls = Array.from({ length: 11 }, (_, i) => `https://www.facebook.com/groups/g${i}`);
    await expect(
      postToFacebookGroups(
        makeFakePage(),
        { groupUrls: urls, content: CONTENT },
        { dryRun: false, force: false, postFn: makePostFn(), delay: makeDelaySpy() },
      ),
    ).rejects.toThrow(/exceeds the default cap/);
  });

  it('20 groups with force:true → proceeds (runGuardedBatch maxBatch boundary)', async () => {
    const urls = Array.from({ length: 20 }, (_, i) => `https://www.facebook.com/groups/g${i}`);
    const postFn = makePostFn();
    const result = await postToFacebookGroups(
      makeFakePage(),
      { groupUrls: urls, content: CONTENT },
      { dryRun: false, postFn, force: true, delay: makeDelaySpy(), maxRetry: 0 },
    );
    expect(result.attempted).toBe(20);
    expect(postFn.calls).toHaveLength(20);
  });

  it('GROUP_POST_BATCH_LIMIT is strictly less than runGuardedBatch default maxBatch (20)', () => {
    expect(GROUP_POST_BATCH_LIMIT).toBeLessThan(20);
  });
});

// ── result shape + safety ─────────────────────────────────────────────────────

describe('postToFacebookGroups — result shape + safety', () => {
  it('real-run result has all required fields: attempted/succeeded/failed/results/warning', async () => {
    const result = await postToFacebookGroups(
      makeFakePage(),
      { groupUrls: [URL_A, URL_B], content: CONTENT },
      { dryRun: false, postFn: makePostFn(), delay: makeDelaySpy(), maxRetry: 0 },
    );
    expect(result).toHaveProperty('attempted');
    expect(result).toHaveProperty('succeeded');
    expect(result).toHaveProperty('failed');
    expect(result).toHaveProperty('results');
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.attempted).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
  });

  it('real-run result surfaces ACCOUNT_RISK_WARNING (NFR-8)', async () => {
    const result = await postToFacebookGroups(
      makeFakePage(),
      { groupUrls: [URL_A], content: CONTENT },
      { dryRun: false, postFn: makePostFn(), delay: makeDelaySpy(), maxRetry: 0 },
    );
    expect(result.warning).toBe(ACCOUNT_RISK_WARNING);
  });

  it('dry-run result warning is null (no real write → no risk warning)', async () => {
    const result = await postToFacebookGroups(
      makeFakePage(),
      { groupUrls: [URL_A, URL_B], content: CONTENT },
      { delay: makeDelaySpy() },
    );
    expect(result.dryRun).toBe(true);
    expect(result.warning == null).toBe(true);
  });

  it('single group (N=1) real run → attempted:1 succeeded:1', async () => {
    const postFn = makePostFn();
    const result = await postToFacebookGroups(
      makeFakePage(),
      { groupUrls: [URL_A], content: CONTENT },
      { dryRun: false, postFn, delay: makeDelaySpy(), maxRetry: 0 },
    );
    expect(result.attempted).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(postFn.calls[0].groupUrl).toBe(URL_A);
    expect(postFn.calls[0].content).toBe(CONTENT);
  });

  it('real-run result entries have target + ok fields', async () => {
    const result = await postToFacebookGroups(
      makeFakePage(),
      { groupUrls: [URL_A, URL_B], content: CONTENT },
      { dryRun: false, postFn: makePostFn(), delay: makeDelaySpy(), maxRetry: 0 },
    );
    for (const r of result.results) {
      expect(r).toHaveProperty('target');
      expect(r).toHaveProperty('ok');
      expect(typeof r.target).toBe('string');
      expect(typeof r.ok).toBe('boolean');
    }
  });

  it('dry-run: previewContent present, mediaUrlsNote absent when mediaUrls omitted', async () => {
    const result = await postToFacebookGroups(
      makeFakePage(),
      { groupUrls: [URL_A], content: CONTENT },
      { delay: makeDelaySpy() },
    );
    expect(result.previewContent).toBe(CONTENT);
    expect(result).not.toHaveProperty('mediaUrlsNote');
  });
});
