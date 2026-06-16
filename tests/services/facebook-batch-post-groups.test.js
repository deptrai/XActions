// by nichxbt
// Tests for Story 4.5: postToFacebookGroups
// Browser-free: fake page + injected postFn/delay-spy seams. No vi.mock.

import { describe, it, expect } from 'vitest';
import {
  postToFacebookGroups,
  GROUP_POST_BATCH_LIMIT,
  GROUP_ACTION_DELAY_FLOOR_MS,
} from '../../api/services/facebookAutomation.js';

// Delay spy: records every (min,max) it is called with; never actually sleeps.
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
    calls.push({ page, groupUrl, content });
    if (throwOn === groupUrl) throw new Error('❌ Group post composer not found; group unreachable or locale unsupported');
    return { posted: true };
  };
  fn.calls = calls;
  return fn;
}

const URL_A = 'https://www.facebook.com/groups/aaa';
const URL_B = 'https://www.facebook.com/groups/bbb';
const URL_C = 'https://www.facebook.com/groups/ccc';
const CONTENT = 'Hello from XActions 🎉';

const noDelay = makeDelaySpy();

// ── dry-run ──────────────────────────────────────────────────────────────────

describe('postToFacebookGroups — dry-run', () => {
  it('returns preview of group URLs + content echoed, no postFn call', async () => {
    const page = makeFakePage();
    const postFn = makePostFn();
    const result = await postToFacebookGroups(
      page,
      { groupUrls: [URL_A, URL_B], content: CONTENT },
      { postFn, delay: noDelay },
    );

    expect(result.dryRun).toBe(true);
    expect(result.preview).toEqual([
      { target: URL_A, action: 'pending' },
      { target: URL_B, action: 'pending' },
    ]);
    expect(result.previewContent).toBe(CONTENT);
    expect(postFn.calls).toHaveLength(0);
  });

  it('batchLimit enforced in dry-run: 11 groups without force → throws', async () => {
    const urls = Array.from({ length: 11 }, (_, i) => `https://www.facebook.com/groups/g${i}`);
    await expect(
      postToFacebookGroups(makeFakePage(), { groupUrls: urls, content: CONTENT }, { delay: noDelay }),
    ).rejects.toThrow(/exceeds the default cap/);
  });

  it('batchLimit: 11 groups with force:true in dry-run → proceeds (no throw)', async () => {
    const urls = Array.from({ length: 11 }, (_, i) => `https://www.facebook.com/groups/g${i}`);
    const postFn = makePostFn();
    const result = await postToFacebookGroups(
      makeFakePage(),
      { groupUrls: urls, content: CONTENT },
      { postFn, delay: noDelay, force: true },
    );
    expect(result.dryRun).toBe(true);
    expect(result.preview).toHaveLength(11);
    expect(postFn.calls).toHaveLength(0);
  });

  it('mediaUrls accepted in dry-run: echoes note about not-yet-implemented', async () => {
    const postFn = makePostFn();
    const result = await postToFacebookGroups(
      makeFakePage(),
      { groupUrls: [URL_A], content: CONTENT, mediaUrls: ['https://example.com/img.jpg'] },
      { postFn, delay: noDelay },
    );
    expect(result.dryRun).toBe(true);
    expect(result.mediaUrlsNote).toMatch(/reserved|not-yet-implemented|future/i);
    expect(postFn.calls).toHaveLength(0);
  });
});

// ── real run ─────────────────────────────────────────────────────────────────

describe('postToFacebookGroups — real run', () => {
  it('postFn called once per group with (page, groupUrl, content)', async () => {
    const page = makeFakePage();
    const postFn = makePostFn();
    const delay = makeDelaySpy();
    const result = await postToFacebookGroups(
      page,
      { groupUrls: [URL_A, URL_B], content: CONTENT },
      { dryRun: false, postFn, delay, maxRetry: 0 },
    );

    expect(postFn.calls.map((c) => c.groupUrl)).toEqual([URL_A, URL_B]);
    expect(postFn.calls.every((c) => c.content === CONTENT)).toBe(true);
    expect(postFn.calls.every((c) => c.page === page)).toBe(true);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
  });

  it('all groups ok → succeeded == N', async () => {
    const postFn = makePostFn();
    const result = await postToFacebookGroups(
      makeFakePage(),
      { groupUrls: [URL_A, URL_B, URL_C], content: CONTENT },
      { dryRun: false, postFn, delay: makeDelaySpy(), maxRetry: 0 },
    );
    expect(result.succeeded).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.results.every((r) => r.ok)).toBe(true);
  });

  it('one failing group → that entry ok:false, others succeed, batch NOT aborted', async () => {
    const postFn = makePostFn({ throwOn: URL_A });
    const result = await postToFacebookGroups(
      makeFakePage(),
      { groupUrls: [URL_A, URL_B, URL_C], content: CONTENT },
      { dryRun: false, postFn, delay: makeDelaySpy(), maxRetry: 0 },
    );

    expect(postFn.calls).toHaveLength(3); // continued past failure
    const a = result.results.find((r) => r.target === URL_A);
    expect(a.ok).toBe(false);
    expect(a.error).toContain('composer not found');
    expect(result.results.find((r) => r.target === URL_B).ok).toBe(true);
    expect(result.results.find((r) => r.target === URL_C).ok).toBe(true);
    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(2);
  });
});

// ── batchLimit / force ────────────────────────────────────────────────────────

describe('postToFacebookGroups — batchLimit', () => {
  it('GROUP_POST_BATCH_LIMIT constant equals 10', () => {
    expect(GROUP_POST_BATCH_LIMIT).toBe(10);
  });

  it('11 groups without force → throws with clear message', async () => {
    const urls = Array.from({ length: 11 }, (_, i) => `https://www.facebook.com/groups/g${i}`);
    await expect(
      postToFacebookGroups(
        makeFakePage(),
        { groupUrls: urls, content: CONTENT },
        { dryRun: false, postFn: makePostFn(), delay: makeDelaySpy() },
      ),
    ).rejects.toThrow(/exceeds the default cap of 10/);
  });

  it('11 groups with force:true → proceeds (≤20)', async () => {
    const urls = Array.from({ length: 11 }, (_, i) => `https://www.facebook.com/groups/g${i}`);
    const postFn = makePostFn();
    const result = await postToFacebookGroups(
      makeFakePage(),
      { groupUrls: urls, content: CONTENT },
      { dryRun: false, postFn, force: true, delay: makeDelaySpy(), maxRetry: 0 },
    );
    expect(result.attempted).toBe(11);
    expect(postFn.calls).toHaveLength(11);
  });

  it('10 groups without force → proceeds (at cap, no throw)', async () => {
    const urls = Array.from({ length: 10 }, (_, i) => `https://www.facebook.com/groups/g${i}`);
    const postFn = makePostFn();
    const result = await postToFacebookGroups(
      makeFakePage(),
      { groupUrls: urls, content: CONTENT },
      { dryRun: false, postFn, delay: makeDelaySpy(), maxRetry: 0 },
    );
    expect(result.attempted).toBe(10);
  });
});

// ── delay floor ──────────────────────────────────────────────────────────────

describe('postToFacebookGroups — delay floor', () => {
  it('delayMin: 5000 → spy receives >= 30000', async () => {
    const delay = makeDelaySpy();
    await postToFacebookGroups(
      makeFakePage(),
      { groupUrls: [URL_A, URL_B], content: CONTENT },
      { dryRun: false, postFn: makePostFn(), delay, delayMin: 5000, maxRetry: 0 },
    );
    expect(delay.calls.length).toBeGreaterThan(0);
    for (const [min] of delay.calls) {
      expect(min).toBeGreaterThanOrEqual(GROUP_ACTION_DELAY_FLOOR_MS);
    }
  });

  it('default delay range is 30000/90000 when caller omits it', async () => {
    const delay = makeDelaySpy();
    await postToFacebookGroups(
      makeFakePage(),
      { groupUrls: [URL_A, URL_B], content: CONTENT },
      { dryRun: false, postFn: makePostFn(), delay, maxRetry: 0 },
    );
    expect(delay.calls[0]).toEqual([30000, 90000]);
  });
});

// ── validation (before browser) ───────────────────────────────────────────────

describe('postToFacebookGroups — input validation', () => {
  it('duplicate group URLs → throws before browser', async () => {
    const page = makeFakePage();
    await expect(
      postToFacebookGroups(
        page,
        { groupUrls: [URL_A, URL_A], content: CONTENT },
        { dryRun: false },
      ),
    ).rejects.toThrow('duplicates');
  });

  it('empty content → throws before browser', async () => {
    const page = makeFakePage();
    await expect(
      postToFacebookGroups(page, { groupUrls: [URL_A], content: '' }, { dryRun: false }),
    ).rejects.toThrow('non-empty string');
    await expect(
      postToFacebookGroups(page, { groupUrls: [URL_A], content: '   ' }, { dryRun: false }),
    ).rejects.toThrow('non-empty string');
  });

  it('empty groupUrls → throws before browser', async () => {
    await expect(
      postToFacebookGroups(makeFakePage(), { groupUrls: [], content: CONTENT }, { dryRun: false }),
    ).rejects.toThrow('non-empty array');
  });

  it('invalid / non-facebook group URL → throws before browser', async () => {
    const page = makeFakePage();
    await expect(
      postToFacebookGroups(
        page,
        { groupUrls: ['https://evil.com/groups/x'], content: CONTENT },
        { dryRun: false },
      ),
    ).rejects.toThrow('facebook.com URL');
    await expect(
      postToFacebookGroups(
        page,
        { groupUrls: ['file:///etc/passwd'], content: CONTENT },
        { dryRun: false },
      ),
    ).rejects.toThrow(/valid URL|http\(s\) URL|facebook\.com URL/);
  });

  it('missing input object → throws', async () => {
    await expect(
      postToFacebookGroups(makeFakePage(), null, { dryRun: false }),
    ).rejects.toThrow();
    await expect(
      postToFacebookGroups(makeFakePage(), undefined, { dryRun: false }),
    ).rejects.toThrow();
  });

  it('mediaUrls non-array → throws', async () => {
    await expect(
      postToFacebookGroups(
        makeFakePage(),
        { groupUrls: [URL_A], content: CONTENT, mediaUrls: 'not-an-array' },
        { dryRun: false },
      ),
    ).rejects.toThrow('mediaUrls must be an array');
  });

  it('postFn: null → falls back to default (nullish-coalesce seam)', async () => {
    // With dryRun:true the seam isn't called regardless — just confirm no throw on null postFn.
    const result = await postToFacebookGroups(
      makeFakePage(),
      { groupUrls: [URL_A], content: CONTENT },
      { postFn: null, delay: noDelay },
    );
    expect(result.dryRun).toBe(true);
  });
});
