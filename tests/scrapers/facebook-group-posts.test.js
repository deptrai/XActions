// tests/scrapers/facebook-group-posts.test.js
// Story 7.3 — scrapeFacebookGroupPosts and normalizeGroupPost.
// by nichxbt
import { describe, it, expect } from 'vitest';
import { normalizeGroupPost, scrapeFacebookGroupPosts } from '../../src/scrapers/facebook/index.js';
import { scrape } from '../../src/scrapers/index.js';

// ============================================================================
// Helpers
// ============================================================================

function makeGroupPostsPage(postResults, { restricted = false } = {}) {
  let hydrationCall = 0;
  let fallbackCall = 0;
  const visitedUrls = [];
  const userAgents = [];
  const viewports = [];

  return {
    goto: async (url) => { visitedUrls.push(url); },
    url: () => 'https://m.facebook.com/groups/xyz',
    setUserAgent: async (ua) => { userAgents.push(ua); },
    setViewport: async (vp) => { viewports.push(vp); },
    waitForSelector: async () => {
      if (restricted) throw new Error('timeout');
      return undefined;
    },
    evaluate: async (fn, ...args) => {
      const fnStr = fn.toString();

      if (fnStr.includes('scrollTo')) return undefined;

      // No-arg evaluate: assertNoCheckpoint, content unavailability checks
      if (args.length === 0) {
        if (fnStr.includes('checkpoint') || fnStr.includes('security check')) return false;
        return undefined;
      }

      // extractHydrationJson: array of typenames and script selector
      if (fnStr.includes('data-content-len') && Array.isArray(args[0])) {
        hydrationCall++;
        return hydrationCall === 1 ? postResults : [];
      }

      // extractGroupPostsFromDom fallback: no args, uses div.m.displayed
      if (fnStr.includes('div.m.displayed')) {
        fallbackCall++;
        return fallbackCall === 1 ? postResults : [];
      }

      return [];
    },
    getVisitedUrls: () => visitedUrls,
    getUserAgents: () => userAgents,
    getViewports: () => viewports,
  };
}

// ============================================================================
// Story 7.3 — normalizeGroupPost
// ============================================================================

describe('normalizeGroupPost', () => {
  it('reuses the standard post shape', () => {
    const raw = {
      id: 'g1',
      text: 'Group post text',
      timestamp: '2026-08-14T10:00:00Z',
      likes: '42',
      comments: '7',
      postUrl: 'https://www.facebook.com/groups/xyz/posts/1',
      images: ['https://fb.com/img.jpg'],
      hasVideo: false,
    };
    const result = normalizeGroupPost(raw);
    expect(result.id).toBe('g1');
    expect(result.text).toBe('Group post text');
    expect(result.likes).toBe('42');
    expect(result.comments).toBe('7');
    expect(result.url).toBe('https://www.facebook.com/groups/xyz/posts/1');
    expect(result.media.images).toEqual(['https://fb.com/img.jpg']);
    expect(result.platform).toBe('facebook');
  });

  it('falls back to url when postUrl is absent', () => {
    const raw = {
      id: 'g2',
      text: 'Another',
      likes: '5',
      url: 'https://www.facebook.com/groups/xyz/posts/2',
    };
    const result = normalizeGroupPost(raw);
    expect(result.url).toBe('https://www.facebook.com/groups/xyz/posts/2');
  });
});

// ============================================================================
// Story 7.3 — scrapeFacebookGroupPosts
// ============================================================================

describe('scrapeFacebookGroupPosts', () => {
  it('sets mobile UA and viewport before goto', async () => {
    const page = makeGroupPostsPage([
      { id: 'g1', text: 'Post one', likes: '10', comments: '2', postUrl: 'https://www.facebook.com/groups/xyz/posts/1' },
    ]);
    await scrapeFacebookGroupPosts(page, 'https://www.facebook.com/groups/xyz', {
      delay: () => {},
      maxRetries: 1,
      limit: 5,
    });
    expect(page.getUserAgents()).toHaveLength(1);
    expect(page.getUserAgents()[0]).toMatch(/iPhone/);
    expect(page.getViewports()).toHaveLength(1);
    expect(page.getViewports()[0]).toEqual({ width: 390, height: 844, isMobile: true });
    expect(page.getVisitedUrls()[0]).toMatch(/^https:\/\/m\.facebook\.com\/groups\/xyz/);
  });

  it('returns normalized group posts', async () => {
    const page = makeGroupPostsPage([
      { id: 'g1', text: 'Group post 1', likes: '10', comments: '2', postUrl: 'https://www.facebook.com/groups/xyz/posts/1' },
      { id: 'g2', text: 'Group post 2', likes: '3', comments: '0', postUrl: 'https://www.facebook.com/groups/xyz/posts/2' },
    ]);
    const result = await scrapeFacebookGroupPosts(page, 'https://www.facebook.com/groups/xyz', {
      delay: () => {},
      maxRetries: 1,
      limit: 5,
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    expect(result[0].platform).toBe('facebook');
    expect(result[0].url).toBe('https://www.facebook.com/groups/xyz/posts/1');
  });

  it('deduplicates posts by id', async () => {
    const page = makeGroupPostsPage([
      { id: 'g1', text: 'One' },
      { id: 'g1', text: 'One again' },
      { id: 'g2', text: 'Two' },
    ]);
    const result = await scrapeFacebookGroupPosts(page, 'https://www.facebook.com/groups/xyz', {
      delay: () => {},
      maxRetries: 1,
      limit: 5,
    });
    expect(result.length).toBe(2);
    expect(result.map((p) => p.id)).toEqual(['g1', 'g2']);
  });

  it('respects limit', async () => {
    const raw = Array.from({ length: 10 }, (_, i) => ({
      id: `g${i}`,
      text: `Post ${i}`,
      likes: `${i}`,
      comments: '0',
    }));
    const page = makeGroupPostsPage(raw);
    const result = await scrapeFacebookGroupPosts(page, 'https://www.facebook.com/groups/xyz', {
      delay: () => {},
      maxRetries: 1,
      limit: 3,
    });
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('returns { note, platform } for restricted groups', async () => {
    const page = makeGroupPostsPage([], { restricted: true });
    const result = await scrapeFacebookGroupPosts(page, 'https://www.facebook.com/groups/private', {
      delay: () => {},
      maxRetries: 1,
    });
    expect(result).toHaveProperty('note');
    expect(result).toHaveProperty('platform', 'facebook');
  });

  it('throws for non-group URLs', async () => {
    await expect(
      scrapeFacebookGroupPosts(makeGroupPostsPage([]), 'https://www.facebook.com/zuck/posts/1', { delay: () => {} })
    ).rejects.toThrow(/groups/);
  });

  it('throws for non-facebook URLs (SSRF)', async () => {
    await expect(
      scrapeFacebookGroupPosts(makeGroupPostsPage([]), 'https://evil.com/groups/xyz', { delay: () => {} })
    ).rejects.toThrow(/facebook\.com/);
  });

  it('calls onProgress with { scraped, limit }', async () => {
    const progressCalls = [];
    const page = makeGroupPostsPage([{ id: 'g1', text: 'x' }]);
    await scrapeFacebookGroupPosts(page, 'https://www.facebook.com/groups/xyz', {
      delay: () => {},
      maxRetries: 1,
      onProgress: (p) => progressCalls.push(p),
    });
    expect(progressCalls.length).toBeGreaterThan(0);
    expect(progressCalls[0]).toHaveProperty('scraped');
    expect(progressCalls[0]).toHaveProperty('limit');
  });
});

// ============================================================================
// Story 7.3 — dispatcher routing
// ============================================================================

describe('dispatcher scrape() group posts routing', () => {
  it('scrape("facebook","group_posts",...) routes to scrapeFacebookGroupPosts', async () => {
    const page = makeGroupPostsPage([{ id: 'g1', text: 'Routed post', likes: '5', comments: '0' }]);
    const result = await scrape('facebook', 'group_posts', {
      page,
      url: 'https://www.facebook.com/groups/xyz',
      delay: () => {},
      maxRetries: 1,
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].text).toBe('Routed post');
    expect(result[0].platform).toBe('facebook');
  });
});
