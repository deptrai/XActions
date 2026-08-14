import { describe, it, expect, vi } from 'vitest';
import { findLikeButton } from '../../api/services/facebookAutomation.js';

// Build a fake Puppeteer page.
// found: the aria-label text that $() should return an element for (null = none)
// waitReject: if true, waitForSelector rejects (simulates timeout)
const makePage = (found = null, waitReject = false) => {
  const el = { click: vi.fn() };
  return {
    waitForSelector: waitReject
      ? vi.fn().mockRejectedValue(new Error('timeout'))
      : vi.fn().mockResolvedValue(null),
    // Match the implementation's *= (substring) attribute selectors.
    $: vi.fn(async (sel) => {
      const foundLabel = found ? (found.match(/"([^"]+)"/) || [])[1] : null;
      return foundLabel && sel.includes('"' + foundLabel + '"') ? el : null;
    }),
    _el: el,
  };
};

describe('findLikeButton', () => {
  it('returns { element, alreadyLiked: false } for English Like button', async () => {
    const page = makePage('[aria-label="Like"]');
    const result = await findLikeButton(page);
    expect(result).toEqual({ element: page._el, alreadyLiked: false });
  });

  it('returns { element, alreadyLiked: false } for Vietnamese Like button (Thích)', async () => {
    const page = makePage('[aria-label="Thích"]');
    const result = await findLikeButton(page);
    expect(result).toEqual({ element: page._el, alreadyLiked: false });
  });

  it('returns { element, alreadyLiked: true } for English already-liked button (Remove Like)', async () => {
    const page = makePage('[aria-label="Remove Like"]');
    const result = await findLikeButton(page);
    expect(result).toEqual({ element: page._el, alreadyLiked: true });
  });

  it('returns { element, alreadyLiked: true } for Vietnamese already-liked button (Bỏ thích)', async () => {
    const page = makePage('[aria-label="Bỏ thích"]');
    const result = await findLikeButton(page);
    expect(result).toEqual({ element: page._el, alreadyLiked: true });
  });

  it('throws matching /Like button not found/i when waitForSelector rejects', async () => {
    const page = makePage(null, true);
    await expect(findLikeButton(page)).rejects.toThrow(/Like button not found/i);
  });

  it('alreadyLiked state takes priority when both Remove Like and Like are present', async () => {
    const el = { click: vi.fn() };
    const page = {
      waitForSelector: vi.fn().mockResolvedValue(null),
      // Both unlike and like selectors return an element (implementation uses substring selectors)
      $: vi.fn(async (sel) =>
        (sel.includes('"Remove Like"') || sel.includes('"Like"')) ? el : null
      ),
    };
    const result = await findLikeButton(page);
    expect(result).toEqual({ element: el, alreadyLiked: true });
  });
});
