// by nichxbt
// Coverage expansion (TEA automate) — Story 4.2 shareFacebookPosts.
// Edge/negative paths + safety invariants not covered by facebook-share.test.js.
// Browser-free: fake page + injected shareFn/delay seams. No vi.mock.

import { describe, it, expect } from 'vitest';
import {
  shareFacebookPosts,
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
    waitForSelector: async () => ({}),
    evaluateHandle: async () => ({ asElement: () => null }),
  };
}

// Records each call; lets a test pick which URLs are alreadyShared / throw.
function makeShareFn({ alreadySharedOn = [], throwOn = [] } = {}) {
  const calls = [];
  const fn = async (page, postUrl) => {
    calls.push(postUrl);
    if (throwOn.includes(postUrl)) {
      throw new Error('❌ Share button not found; locale unsupported or post unreachable');
    }
    if (alreadySharedOn.includes(postUrl)) return { shared: true, alreadyShared: true };
    return { shared: true, alreadyShared: false };
  };
  fn.calls = calls;
  return fn;
}

const URL_A = 'https://www.facebook.com/p/aaa/posts/1';
const URL_B = 'https://www.facebook.com/p/bbb/posts/2';

describe('shareFacebookPosts — dry-run gate', () => {
  it('dryRun:null stays dry-run (no share, no browser)', async () => {
    const page = makeFakePage();
    const shareFn = makeShareFn();
    const result = await shareFacebookPosts(page, [URL_A, URL_B], { dryRun: null, shareFn });
    expect(result.dryRun).toBe(true);
    expect(shareFn.calls).toHaveLength(0);
    expect(page.calls.goto).toHaveLength(0);
    expect(result.preview).toEqual([
      { target: URL_A, action: 'pending' },
      { target: URL_B, action: 'pending' },
    ]);
  });
});

describe('shareFacebookPosts — input validation', () => {
  it('a non-string entry alongside valid strings → throws before browser', async () => {
    const page = makeFakePage();
    await expect(
      shareFacebookPosts(page, [URL_A, 42], { dryRun: false }),
    ).rejects.toThrow('every postUrl must be a non-empty string');
    expect(page.calls.goto).toHaveLength(0);
  });

  it('duplicate URLs → throws (capture-Map would collide)', async () => {
    await expect(
      shareFacebookPosts(makeFakePage(), [URL_A, URL_A], { dryRun: false }),
    ).rejects.toThrow('must not contain duplicates');
  });

  it('a non-facebook URL → throws before browser (SSRF guard)', async () => {
    const page = makeFakePage();
    await expect(
      shareFacebookPosts(page, ['https://evil.com/p/x'], { dryRun: false }),
    ).rejects.toThrow('facebook.com');
    expect(page.calls.goto).toHaveLength(0);
  });
});

describe('shareFacebookPosts — real run', () => {
  it('real-run result surfaces ACCOUNT_RISK_WARNING (NFR-8)', async () => {
    const result = await shareFacebookPosts(makeFakePage(), [URL_A], {
      dryRun: false, shareFn: makeShareFn(), delay: makeDelaySpy(), maxRetry: 0,
    });
    expect(result.warning).toBe(ACCOUNT_RISK_WARNING);
  });

  it('single-URL batch → no inter-item delay call', async () => {
    const delay = makeDelaySpy();
    await shareFacebookPosts(makeFakePage(), [URL_A], {
      dryRun: false, shareFn: makeShareFn(), delay, maxRetry: 0,
    });
    expect(delay.calls).toHaveLength(0); // delay only fires BETWEEN items
  });

  it('default inter-item delay range is (1000,3000) — share uses the helper defaults', async () => {
    const delay = makeDelaySpy();
    await shareFacebookPosts(makeFakePage(), [URL_A, URL_B], {
      dryRun: false, shareFn: makeShareFn(), delay, maxRetry: 0,
    });
    expect(delay.calls).toEqual([[1000, 3000]]);
  });

  it('alreadyShared:false is preserved on the result entry (merge of explicit-false)', async () => {
    const result = await shareFacebookPosts(makeFakePage(), [URL_A], {
      dryRun: false, shareFn: makeShareFn(), delay: makeDelaySpy(), maxRetry: 0,
    });
    const a = result.results.find((r) => r.target === URL_A);
    expect(a.ok).toBe(true);
    expect(a.alreadyShared).toBe(false);
  });

  it('alreadyShared:true is surfaced via the capture-Map merge', async () => {
    const result = await shareFacebookPosts(makeFakePage(), [URL_A, URL_B], {
      dryRun: false, shareFn: makeShareFn({ alreadySharedOn: [URL_B] }), delay: makeDelaySpy(), maxRetry: 0,
    });
    expect(result.results.find((r) => r.target === URL_A).alreadyShared).toBe(false);
    expect(result.results.find((r) => r.target === URL_B).alreadyShared).toBe(true);
  });

  it('a failed item is NOT mutated with an alreadyShared field (merge skips ok:false)', async () => {
    const result = await shareFacebookPosts(makeFakePage(), [URL_A, URL_B], {
      dryRun: false, shareFn: makeShareFn({ throwOn: [URL_A] }), delay: makeDelaySpy(), maxRetry: 0,
    });
    const a = result.results.find((r) => r.target === URL_A);
    expect(a.ok).toBe(false);
    expect(a).not.toHaveProperty('alreadyShared');
    expect(a.error).toContain('Share button not found');
    expect(a.error).not.toMatch(/c_user|xs=|cookie/i); // PII-free
    expect(result.results.find((r) => r.target === URL_B).ok).toBe(true);
  });

  it('default maxRetry (1) retries a failing share once (2 attempts for the failing URL)', async () => {
    const shareFn = makeShareFn({ throwOn: [URL_A] });
    await shareFacebookPosts(makeFakePage(), [URL_A], {
      dryRun: false, shareFn, delay: makeDelaySpy(), // maxRetry omitted → default 1
    });
    expect(shareFn.calls.filter((u) => u === URL_A)).toHaveLength(2);
  });

  it('maxBatch boundary: exactly maxBatch URLs succeeds; one over throws', async () => {
    const urls = (n) => Array.from({ length: n }, (_, i) => `https://www.facebook.com/p/g/posts/${i}`);
    const ok = await shareFacebookPosts(makeFakePage(), urls(3), {
      dryRun: false, shareFn: makeShareFn(), delay: makeDelaySpy(), maxRetry: 0, maxBatch: 3,
    });
    expect(ok.succeeded).toBe(3);
    await expect(
      shareFacebookPosts(makeFakePage(), urls(4), { dryRun: false, shareFn: makeShareFn(), maxBatch: 3 }),
    ).rejects.toThrow('exceeds maxBatch');
  });
});
