// by nichxbt
// Tests for Story 4.2: shareFacebookPosts (auto-share to timeline)
// Browser-free: fake page + injected shareFn seam. No vi.mock per project mandate.

import { describe, it, expect } from 'vitest';
import { shareFacebookPosts } from '../../api/services/facebookAutomation.js';

// Fake page that records every interaction — lets us assert dry-run touches nothing.
function makeFakePage() {
  const calls = { goto: [], click: [] };
  return {
    calls,
    goto: async (url) => { calls.goto.push(url); },
    click: async () => { calls.click.push(true); },
    $: async () => null,
    waitForSelector: async () => ({}),
  };
}

// Injected share executor seam: records calls, optionally throws or marks alreadyShared.
function makeShareFn({ throwOn = null, alreadyShared = false } = {}) {
  const calls = [];
  const fn = async (page, postUrl) => {
    calls.push({ page, postUrl });
    if (throwOn && postUrl === throwOn) {
      throw new Error('❌ Share button not found; locale unsupported or post unreachable');
    }
    return alreadyShared ? { shared: false, alreadyShared: true } : { shared: true };
  };
  fn.calls = calls;
  return fn;
}

const noDelay = () => {};

describe('shareFacebookPosts', () => {
  it('dry-run returns preview entries (action:pending), invokes neither shareFn nor page.goto', async () => {
    const page = makeFakePage();
    const shareFn = makeShareFn();

    const result = await shareFacebookPosts(page, ['https://facebook.com/p/1', 'https://facebook.com/p/2'], {
      shareFn,
      delay: noDelay,
    });

    expect(result.dryRun).toBe(true);
    expect(result.platform).toBe('facebook');
    expect(result.preview).toEqual([
      { target: 'https://facebook.com/p/1', action: 'pending' },
      { target: 'https://facebook.com/p/2', action: 'pending' },
    ]);
    // No DOM interaction in dry-run
    expect(shareFn.calls).toHaveLength(0);
    expect(page.calls.goto).toHaveLength(0);
    expect(page.calls.click).toHaveLength(0);
  });

  it('dryRun:false calls shareFn once per URL with (page, postUrl); success → ok:true', async () => {
    const page = makeFakePage();
    const shareFn = makeShareFn();
    const urls = ['https://facebook.com/p/1', 'https://facebook.com/p/2'];

    const result = await shareFacebookPosts(page, urls, { dryRun: false, shareFn, delay: noDelay });

    expect(result.dryRun).toBe(false);
    expect(shareFn.calls).toHaveLength(2);
    expect(shareFn.calls[0]).toEqual({ page, postUrl: urls[0] });
    expect(shareFn.calls[1].postUrl).toBe(urls[1]);
    expect(result.results.every((r) => r.ok === true)).toBe(true);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
  });

  it('a share that throws (button not found) → ok:false with PII-free error, batch continues', async () => {
    const page = makeFakePage();
    const urls = ['https://facebook.com/p/1', 'https://facebook.com/p/bad', 'https://facebook.com/p/3'];
    const shareFn = makeShareFn({ throwOn: 'https://facebook.com/p/bad' });

    const result = await shareFacebookPosts(page, urls, { dryRun: false, shareFn, delay: noDelay, maxRetry: 0 });

    // All three attempted — batch did NOT abort on the failing item (maxRetry:0 → one call each)
    expect(shareFn.calls).toHaveLength(3);
    expect(result.attempted).toBe(3);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);

    const failed = result.results.find((r) => r.target === 'https://facebook.com/p/bad');
    expect(failed.ok).toBe(false);
    expect(failed.error).toContain('Share button not found');
    // PII-free: no cookie/secret leakage in the error string
    expect(failed.error).not.toMatch(/c_user|xs=|cookie/i);
  });

  it('alreadyShared surfaces into the matching result entry', async () => {
    const page = makeFakePage();
    const shareFn = makeShareFn({ alreadyShared: true });

    const result = await shareFacebookPosts(page, ['https://facebook.com/p/1'], {
      dryRun: false,
      shareFn,
      delay: noDelay,
    });

    expect(result.results[0].ok).toBe(true);
    expect(result.results[0].alreadyShared).toBe(true);
  });

  it('empty postUrls → throws before any navigation', async () => {
    const page = makeFakePage();
    await expect(shareFacebookPosts(page, [], { dryRun: false })).rejects.toThrow(
      'postUrls must be a non-empty array',
    );
    expect(page.calls.goto).toHaveLength(0);
  });

  it('non-array postUrls → throws', async () => {
    const page = makeFakePage();
    await expect(shareFacebookPosts(page, 'not-an-array', { dryRun: false })).rejects.toThrow(
      'postUrls must be a non-empty array',
    );
  });

  it('non-string / blank entries → throws before navigation', async () => {
    const page = makeFakePage();
    await expect(
      shareFacebookPosts(page, ['https://facebook.com/p/1', '  '], { dryRun: false }),
    ).rejects.toThrow('every postUrl must be a non-empty string');
    expect(page.calls.goto).toHaveLength(0);
  });

  it('explicit shareFn:null falls back to default (does not NPE)', async () => {
    const page = makeFakePage();
    // dryRun default true → default shareFn is never invoked, so no real browser needed.
    const result = await shareFacebookPosts(page, ['https://facebook.com/p/1'], { shareFn: null });
    expect(result.dryRun).toBe(true);
    expect(result.preview).toHaveLength(1);
  });

  it('batch over maxBatch is bounded (inherited guardrail)', async () => {
    const page = makeFakePage();
    const urls = Array.from({ length: 21 }, (_, i) => `https://facebook.com/p/${i}`);
    await expect(
      shareFacebookPosts(page, urls, { dryRun: false, shareFn: makeShareFn(), delay: noDelay }),
    ).rejects.toThrow(/exceeds maxBatch/);
  });

  it('dryRun:true (explicit) also skips shareFn and page', async () => {
    const page = makeFakePage();
    const shareFn = makeShareFn();
    const result = await shareFacebookPosts(page, ['https://facebook.com/p/1'], {
      dryRun: true,
      shareFn,
      delay: noDelay,
    });
    expect(result.dryRun).toBe(true);
    expect(shareFn.calls).toHaveLength(0);
    expect(page.calls.goto).toHaveLength(0);
  });
});
