// tests/scrapers/facebook-group-search.test.js
// Story 7.3 — scrapeFacebookGroupSearch (in-group keyword search).
// by nichxbt
import { describe, it, expect } from 'vitest';
import { scrapeFacebookGroupSearch } from '../../src/scrapers/facebook/index.js';
import { scrape } from '../../src/scrapers/index.js';

// ============================================================================
// Helpers
// ============================================================================

function makeGroupSearchPage(postResults, { restricted = false, noResults = false } = {}) {
  let hydrationCall = 0;
  let fallbackCall = 0;
  const visitedUrls = [];
  const userAgents = [];
  const viewports = [];

  return {
    goto: async (url) => { visitedUrls.push(url); },
    url: () => 'https://m.facebook.com/groups/xyz/search',
    setUserAgent: async (ua) => { userAgents.push(ua); },
    setViewport: async (vp) => { viewports.push(vp); },
    waitForSelector: async () => {
      if (restricted) throw new Error('timeout');
      return undefined;
    },
    evaluate: async (fn, ...args) => {
      const fnStr = fn.toString();

      // scroll
      if (fnStr.includes('scrollTo')) return undefined;

      // No-arg evaluate: assertNoCheckpoint, content unavailability checks
      if (args.length === 0) {
        if (fnStr.includes('checkpoint') || fnStr.includes('security check')) return false;
        if (fnStr.includes('content') && fnStr.includes('unavailable')) return noResults;
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
// Story 7.3 — scrapeFacebookGroupSearch
// ============================================================================

describe('scrapeFacebookGroupSearch', () => {
  it('sets mobile UA and viewport before goto', async () => {
    const page = makeGroupSearchPage([
      { id: 'g1', text: 'Macbook post', likes: '10', comments: '2', postUrl: 'https://www.facebook.com/groups/xyz/posts/1' },
    ]);
    await scrapeFacebookGroupSearch(page, 'https://www.facebook.com/groups/xyz', {
      query: 'macbook pro 14 32gb',
      delay: () => {},
      maxRetries: 1,
      limit: 5,
    });
    expect(page.getUserAgents()).toHaveLength(1);
    expect(page.getUserAgents()[0]).toMatch(/iPhone/);
    expect(page.getViewports()).toHaveLength(1);
    expect(page.getViewports()[0]).toEqual({ width: 390, height: 844, isMobile: true });
  });

  it('navigates to group search URL with encoded query', async () => {
    const page = makeGroupSearchPage([
      { id: 'g1', text: 'match', likes: '1', comments: '0' },
    ]);
    await scrapeFacebookGroupSearch(page, 'https://www.facebook.com/groups/xyz', {
      query: 'macbook pro 14 32gb',
      delay: () => {},
      maxRetries: 1,
      limit: 5,
    });
    const visited = page.getVisitedUrls();
    expect(visited[0]).toMatch(/^https:\/\/m\.facebook\.com\/groups\/xyz\/search\//);
    expect(visited[0]).toMatch(/q=macbook(%20|\+)pro(%20|\+)14(%20|\+)32gb/);
  });

  it('returns normalized posts matching the query', async () => {
    const page = makeGroupSearchPage([
      { id: 'g1', text: 'Selling macbook pro 14 32gb 1tb', likes: '10', comments: '2', postUrl: 'https://www.facebook.com/groups/xyz/posts/1' },
      { id: 'g2', text: 'Another match', likes: '3', comments: '0', postUrl: 'https://www.facebook.com/groups/xyz/posts/2' },
    ]);
    const result = await scrapeFacebookGroupSearch(page, 'https://www.facebook.com/groups/xyz', {
      query: 'macbook pro 14 32gb',
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
    const page = makeGroupSearchPage([
      { id: 'g1', text: 'One' },
      { id: 'g1', text: 'One again' },
      { id: 'g2', text: 'Two' },
    ]);
    const result = await scrapeFacebookGroupSearch(page, 'https://www.facebook.com/groups/xyz', {
      query: 'macbook',
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
    const page = makeGroupSearchPage(raw);
    const result = await scrapeFacebookGroupSearch(page, 'https://www.facebook.com/groups/xyz', {
      query: 'macbook',
      delay: () => {},
      maxRetries: 1,
      limit: 3,
    });
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('returns { note, platform } for restricted/private groups', async () => {
    const page = makeGroupSearchPage([], { restricted: true });
    const result = await scrapeFacebookGroupSearch(page, 'https://www.facebook.com/groups/private', {
      query: 'macbook',
      delay: () => {},
      maxRetries: 1,
    });
    expect(result).toHaveProperty('note');
    expect(result).toHaveProperty('platform', 'facebook');
  });

  it('returns { note, platform } when search yields no results', async () => {
    const page = makeGroupSearchPage([], { noResults: true });
    const result = await scrapeFacebookGroupSearch(page, 'https://www.facebook.com/groups/xyz', {
      query: 'nonexistentkeyword12345',
      delay: () => {},
      maxRetries: 1,
    });
    expect(result).toHaveProperty('note');
    expect(result).toHaveProperty('platform', 'facebook');
  });

  it('throws for non-group URLs', async () => {
    await expect(
      scrapeFacebookGroupSearch(makeGroupSearchPage([]), 'https://www.facebook.com/zuck/posts/1', {
        query: 'macbook',
        delay: () => {},
      })
    ).rejects.toThrow(/groups/);
  });

  it('throws for non-facebook URLs (SSRF)', async () => {
    await expect(
      scrapeFacebookGroupSearch(makeGroupSearchPage([]), 'https://evil.com/groups/xyz', {
        query: 'macbook',
        delay: () => {},
      })
    ).rejects.toThrow(/facebook\.com/);
  });

  it('throws when query is missing or empty', async () => {
    await expect(
      scrapeFacebookGroupSearch(makeGroupSearchPage([]), 'https://www.facebook.com/groups/xyz', {
        delay: () => {},
      })
    ).rejects.toThrow(/query/);

    await expect(
      scrapeFacebookGroupSearch(makeGroupSearchPage([]), 'https://www.facebook.com/groups/xyz', {
        query: '   ',
        delay: () => {},
      })
    ).rejects.toThrow(/query/);
  });

  it('calls onProgress with { scraped, limit }', async () => {
    const progressCalls = [];
    const page = makeGroupSearchPage([{ id: 'g1', text: 'x' }]);
    await scrapeFacebookGroupSearch(page, 'https://www.facebook.com/groups/xyz', {
      query: 'macbook',
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

describe('dispatcher scrape() group search routing', () => {
  it('scrape("facebook","group_search",...) routes to scrapeFacebookGroupSearch with url as target and query in options', async () => {
    const page = makeGroupSearchPage([{ id: 'g1', text: 'Routed search post', likes: '5', comments: '0' }]);
    const result = await scrape('facebook', 'group_search', {
      page,
      url: 'https://www.facebook.com/groups/xyz',
      query: 'macbook pro 14 32gb',
      delay: () => {},
      maxRetries: 1,
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].text).toBe('Routed search post');
    expect(result[0].platform).toBe('facebook');
    // Verify the search URL was visited (not the plain group URL)
    expect(page.getVisitedUrls()[0]).toMatch(/\/search\//);
  });
});
