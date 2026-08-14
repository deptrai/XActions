// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
// XActions — Facebook Automation Integration Tests (likeSinglePost real stack)
// by nichxbt

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { likeFacebookPosts } from '../../api/services/facebookAutomation.js';

const noDelay = () => {};

// Build a fake Puppeteer page that drives likeSinglePost through its real branches.
// likedSelector: the aria-label text for an unliked Like button
// alreadyLikedSelector: the aria-label text for an already-liked (Remove Like) button
// waitSelectorFails: if true, waitForSelector rejects (simulates timeout)
const makeRealPage = ({
  likedSelector = null,
  alreadyLikedSelector = null,
  waitSelectorFails = false,
} = {}) => {
  const clickSpy = vi.fn();
  const el = {
    click: clickSpy,
    boundingBox: vi.fn().mockResolvedValue({ x: 0, y: 0, width: 100, height: 50 }),
  };
  const labelFrom = (selector) => selector ? (selector.match(/"([^"]+)"/) || [])[1] : null;
  const likedLabel = labelFrom(likedSelector);
  const alreadyLikedLabel = labelFrom(alreadyLikedSelector);
  return {
    _clickSpy: clickSpy,
    mouse: { move: vi.fn(), click: vi.fn() },
    goto: vi.fn().mockResolvedValue(null),
    waitForSelector: waitSelectorFails
      ? vi.fn().mockRejectedValue(new Error('timeout'))
      : vi.fn().mockResolvedValue(null),
    // Match the implementation's *= (substring) attribute selectors.
    $: vi.fn(async (sel) => {
      if (alreadyLikedLabel && sel.includes('"' + alreadyLikedLabel + '"')) return el;
      if (likedLabel && sel.includes('"' + likedLabel + '"')) return el;
      return null;
    }),
    boundingBox: vi.fn().mockResolvedValue({ x: 0, y: 0, width: 100, height: 50 }),
    evaluate: vi.fn().mockResolvedValue(false),
  };
};

// ============================================================================
// likeFacebookPosts — real likeSinglePost integration (no likeFn override)
// Exercises the full: likeFacebookPosts → likeSinglePost → findLikeButton stack.
// vi.useFakeTimers() skips the 500ms + 3000ms sleep() inside likeSinglePost.
// ============================================================================

describe('likeFacebookPosts — likeSinglePost real stack integration', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('navigates to post URL and clicks English Like button', async () => {
    const page = makeRealPage({ likedSelector: '[aria-label="Like"]' });
    const url = 'https://www.facebook.com/post/1';

    const promise = likeFacebookPosts(page, [url], { dryRun: false, delay: noDelay });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(page.goto).toHaveBeenCalledWith(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    expect(page.mouse.click).toHaveBeenCalledTimes(1);
    expect(result.results[0]).toMatchObject({ target: url, ok: true, alreadyLiked: false });
  });

  it('navigates to post URL and clicks Vietnamese Like button (Thích)', async () => {
    const page = makeRealPage({ likedSelector: '[aria-label="Thích"]' });
    const url = 'https://www.facebook.com/post/2';

    const promise = likeFacebookPosts(page, [url], { dryRun: false, delay: noDelay });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(page.mouse.click).toHaveBeenCalledTimes(1);
    expect(result.results[0]).toMatchObject({ target: url, ok: true, alreadyLiked: false });
  });

  it('detects already-liked state (en: Remove Like) — no click, alreadyLiked:true', async () => {
    const page = makeRealPage({ alreadyLikedSelector: '[aria-label="Remove Like"]' });
    const url = 'https://www.facebook.com/post/3';

    const promise = likeFacebookPosts(page, [url], { dryRun: false, delay: noDelay });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(page.mouse.click).not.toHaveBeenCalled();
    expect(result.results[0]).toMatchObject({ target: url, ok: true, alreadyLiked: true });
  });

  it('detects already-liked state (vi: Bỏ thích) — no click, alreadyLiked:true', async () => {
    const page = makeRealPage({ alreadyLikedSelector: '[aria-label="Bỏ thích"]' });
    const url = 'https://www.facebook.com/post/4';

    const promise = likeFacebookPosts(page, [url], { dryRun: false, delay: noDelay });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(page.mouse.click).not.toHaveBeenCalled();
    expect(result.results[0]).toMatchObject({ target: url, ok: true, alreadyLiked: true });
  });

  it('Like button not found → result ok:false, clear error message', async () => {
    const page = makeRealPage({ waitSelectorFails: true });
    const url = 'https://www.facebook.com/post/5';

    const promise = likeFacebookPosts(page, [url], { dryRun: false, delay: noDelay, maxRetry: 0 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(page.mouse.click).not.toHaveBeenCalled();
    expect(result.results[0].ok).toBe(false);
    expect(result.results[0].error).toMatch(/Like button not found/i);
  });

  it('dry-run: does NOT navigate or click (safety gate enforced end-to-end)', async () => {
    const page = makeRealPage({ likedSelector: '[aria-label="Like"]' });

    const result = await likeFacebookPosts(page, ['https://www.facebook.com/post/6']);

    expect(page.goto).not.toHaveBeenCalled();
    expect(page.mouse.click).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
  });
});
