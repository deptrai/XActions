// by nichxbt
import { describe, it, expect } from 'vitest';
import {
  normalizeFollower,
  scrapeFollowers,
} from '../../src/scrapers/facebook/index.js';
import { scrape } from '../../src/scrapers/index.js';

// ============================================================================
// Story 1.4 — normalizeFollower
// ============================================================================

describe('normalizeFollower', () => {
  it('returns full normalized follower shape', () => {
    const raw = { name: 'Mark Zuckerberg', username: 'zuck', url: 'https://www.facebook.com/zuck' };
    const result = normalizeFollower(raw);
    expect(result.name).toBe('Mark Zuckerberg');
    expect(result.username).toBe('zuck');
    expect(result.url).toBe('https://www.facebook.com/zuck');
    expect(result.platform).toBe('facebook');
  });

  it('sets null for missing name', () => {
    const result = normalizeFollower({ name: undefined, username: 'x', url: 'https://www.facebook.com/x' });
    expect(result.name).toBeNull();
  });

  it('sets null for missing username', () => {
    const result = normalizeFollower({ name: 'X', username: undefined, url: 'https://www.facebook.com/x' });
    expect(result.username).toBeNull();
  });

  it('sets null for missing url', () => {
    const result = normalizeFollower({ name: 'X', username: 'x', url: undefined });
    expect(result.url).toBeNull();
  });

  it('always sets platform to facebook', () => {
    expect(normalizeFollower({ name: 'X', username: 'x', url: null }).platform).toBe('facebook');
  });
});

// ============================================================================
// Story 1.4 — scrapeFollowers (browser-free via fake page + delay seam)
// ============================================================================

describe('scrapeFollowers', () => {
  // Detection evaluate returns a COUNT of [role="listitem"] rows (number).
  // Extraction evaluate (contains NON_PROFILE) returns the raw follower rows.
  const makeRestrictedPage = () => ({
    goto: async () => {},
    evaluate: async (fn) => {
      const fnStr = fn.toString();
      if (fnStr.includes('scrollTo')) return undefined;
      if (fnStr.includes('NON_PROFILE')) return []; // extraction (not reached)
      return 0; // exposedCount: no listitem rows → restricted
    },
  });

  const makeExposedPage = (rawFollowers = []) => {
    let extractCalls = 0;
    return {
      goto: async () => {},
      evaluate: async (fn) => {
        const fnStr = fn.toString();
        if (fnStr.includes('scrollTo')) return undefined;
        if (fnStr.includes('NON_PROFILE')) {
          // extraction: return raw followers once, then empty (triggers maxRetries)
          extractCalls++;
          return extractCalls === 1 ? rawFollowers : [];
        }
        return rawFollowers.length || 1; // exposedCount: positive → exposed
      },
    };
  };

  it('returns note object when follower list is restricted', async () => {
    const page = makeRestrictedPage();
    const result = await scrapeFollowers(page, 'someuser', { delay: () => {} });
    expect(Array.isArray(result)).toBe(false);
    expect(result).toHaveProperty('note');
    expect(result.username).toBe('someuser');
    expect(result.platform).toBe('facebook');
    expect(result.note).toMatch(/not publicly exposed/i);
  });

  it('returns array when follower list is exposed', async () => {
    const rawFollowers = [
      { id: 'https://www.facebook.com/user1', name: 'User One', username: 'user1', url: 'https://www.facebook.com/user1' },
    ];
    const page = makeExposedPage(rawFollowers);
    const result = await scrapeFollowers(page, 'testpage', { delay: () => {}, maxRetries: 2 });
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].platform).toBe('facebook');
    expect(result[0].name).toBe('User One');
  });

  it('respects limit on exposed list', async () => {
    const rawFollowers = Array.from({ length: 10 }, (_, i) => ({
      id: `https://www.facebook.com/user${i}`,
      name: `User ${i}`,
      username: `user${i}`,
      url: `https://www.facebook.com/user${i}`,
    }));
    const page = makeExposedPage(rawFollowers);
    const result = await scrapeFollowers(page, 'testpage', { limit: 3, delay: () => {}, maxRetries: 2 });
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('builds &sk=followers URL for profile.php?id= (not a broken /followers path)', async () => {
    let navigated = null;
    const page = {
      goto: async (url) => { navigated = url; },
      evaluate: async (fn) => {
        const fnStr = fn.toString();
        if (fnStr.includes('scrollTo')) return undefined;
        if (fnStr.includes('NON_PROFILE')) return [];
        return 0;
      },
    };
    await scrapeFollowers(page, 'https://www.facebook.com/profile.php?id=100069', { delay: () => {} });
    expect(navigated).toBe('https://www.facebook.com/profile.php?id=100069&sk=followers');
    expect(navigated).not.toMatch(/id=100069\/followers/); // not the broken form
  });

  it('builds /<handle>/followers URL for vanity handles', async () => {
    let navigated = null;
    const page = {
      goto: async (url) => { navigated = url; },
      evaluate: async (fn) => {
        const fnStr = fn.toString();
        if (fnStr.includes('scrollTo')) return undefined;
        if (fnStr.includes('NON_PROFILE')) return [];
        return 0;
      },
    };
    await scrapeFollowers(page, 'zuck', { delay: () => {} });
    expect(navigated).toBe('https://www.facebook.com/zuck/followers');
  });
});

// ============================================================================
// Story 1.4 — dispatcher routing for followers
// ============================================================================

describe('dispatcher scrape() followers routing', () => {
  it('scrape("facebook","followers",...) routes to scrapeFollowers', async () => {
    const page = {
      goto: async () => {},
      evaluate: async (fn) => {
        const fnStr = fn.toString();
        if (fnStr.includes('scrollTo')) return undefined;
        if (fnStr.includes('NON_PROFILE')) return [];
        return 0; // restricted — returns note object quickly
      },
    };
    const result = await scrape('facebook', 'followers', { page, username: 'testuser' });
    expect(result).toHaveProperty('note');
    expect(result.platform).toBe('facebook');
  });
});

// ============================================================================
// TEA Expansion — scrapeFollowers edge cases
// ============================================================================

describe('[TEA] scrapeFollowers — edge cases', () => {
  it('[P2] calls onProgress during exposed-list scrolling', async () => {
    const progressCalls = [];
    let callCount = 0;
    const page = {
      goto: async () => {},
      evaluate: async (fn) => {
        const fnStr = fn.toString();
        if (fnStr.includes('scrollTo')) return undefined;
        callCount++;
        if (callCount === 1) return true; // isExposed
        return [{ id: 'https://www.facebook.com/u1', name: 'User', username: 'u1', url: 'https://www.facebook.com/u1' }];
      },
    };
    await scrapeFollowers(page, 'testpage', {
      delay: () => {},
      maxRetries: 2,
      onProgress: (p) => progressCalls.push(p),
    });
    expect(progressCalls.length).toBeGreaterThan(0);
    expect(progressCalls[0]).toHaveProperty('scraped');
    expect(progressCalls[0]).toHaveProperty('limit');
  });

  it('[P2] normalizeFollower handles null username in row gracefully', () => {
    const result = normalizeFollower({ name: 'Anonymous', username: null, url: 'https://www.facebook.com/anon' });
    expect(result.username).toBeNull();
    expect(result.name).toBe('Anonymous');
    expect(result.platform).toBe('facebook');
  });
});

// ============================================================================
// TEA Round 3 — normalizeFollower edge cases
// ============================================================================

describe('[TEA-R3] normalizeFollower — edge cases', () => {
  it('[P2] empty string url → null', () => {
    expect(normalizeFollower({ name: 'X', username: 'x', url: '' }).url).toBeNull();
  });

  it('[P2] empty string name → null', () => {
    expect(normalizeFollower({ name: '', username: 'x', url: 'https://www.facebook.com/x' }).name).toBeNull();
  });
});

// ============================================================================
// TEA Round 3 — dispatcher negative routing
// ============================================================================

describe('[TEA-R3] dispatcher — negative routing', () => {
  it('[P2] scrape("facebook","hashtag",...) throws "not available"', async () => {
    const page = { goto: async () => {}, evaluate: async () => ({}) };
    await expect(scrape('facebook', 'hashtag', { page, hashtag: 'test' }))
      .rejects.toThrow(/not available/i);
  });

  it('[P2] scrape("facebook","bookmarks",...) throws "not available"', async () => {
    const page = { goto: async () => {}, evaluate: async () => ({}) };
    await expect(scrape('facebook', 'bookmarks', { page }))
      .rejects.toThrow(/not available/i);
  });
});
