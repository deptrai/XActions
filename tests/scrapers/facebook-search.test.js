// by nichxbt
import { describe, it, expect } from 'vitest';
import {
  normalizeSearchResult,
  searchTweets,
} from '../../src/scrapers/facebook/index.js';
import { scrape } from '../../src/scrapers/index.js';

// ============================================================================
// Story 1.5 — normalizeSearchResult
// ============================================================================

describe('normalizeSearchResult', () => {
  it('returns full normalized search result shape', () => {
    const raw = {
      id: 'https://www.facebook.com/zuck/posts/123',
      text: 'Hello world',
      author: 'zuck',
      timestamp: '2026-01-01T00:00:00Z',
      url: 'https://www.facebook.com/zuck/posts/123',
    };
    const result = normalizeSearchResult(raw);
    expect(result.id).toBe('https://www.facebook.com/zuck/posts/123');
    expect(result.text).toBe('Hello world');
    expect(result.author).toBe('zuck');
    expect(result.timestamp).toBe('2026-01-01T00:00:00Z');
    expect(result.url).toBe('https://www.facebook.com/zuck/posts/123');
    expect(result.platform).toBe('facebook');
  });

  it('sets null for missing text', () => {
    const result = normalizeSearchResult({ id: 'x', text: undefined, author: 'a', timestamp: null, url: null });
    expect(result.text).toBeNull();
  });

  it('sets null for missing author', () => {
    const result = normalizeSearchResult({ id: 'x', text: 'hi', author: undefined, timestamp: null, url: null });
    expect(result.author).toBeNull();
  });

  it('sets null for missing url', () => {
    const result = normalizeSearchResult({ id: 'x', text: 'hi', author: 'a', timestamp: null, url: undefined });
    expect(result.url).toBeNull();
  });

  it('always sets platform to "facebook"', () => {
    expect(normalizeSearchResult({ id: 'x', text: 'x', author: null, timestamp: null, url: null }).platform).toBe('facebook');
  });

  it('sets null for missing id', () => {
    const result = normalizeSearchResult({ id: '', text: 'hi', author: 'a', timestamp: null, url: null });
    expect(result.id).toBeNull();
  });
});

// ============================================================================
// Story 1.5 — searchTweets (browser-free via fake page + delay seam)
// ============================================================================

describe('searchTweets', () => {
  const makeEmptyPage = () => ({
    goto: async () => {},
    evaluate: async (fn) => {
      if (fn.toString().includes('scrollTo')) return undefined;
      return [];
    },
  });

  const makeResultsPage = (rawResults = []) => {
    let callCount = 0;
    return {
      goto: async () => {},
      evaluate: async (fn) => {
        if (fn.toString().includes('scrollTo')) return undefined;
        callCount++;
        return callCount === 1 ? rawResults : [];
      },
    };
  };

  it('returns empty array when no results', async () => {
    const result = await searchTweets(makeEmptyPage(), 'xactions test', { delay: () => {}, maxRetries: 2 });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  it('returns normalized results with platform: facebook', async () => {
    const rawResults = [
      { id: 'https://www.facebook.com/zuck/posts/1', text: 'Hello', author: 'zuck', timestamp: null, url: 'https://www.facebook.com/zuck/posts/1' },
    ];
    const result = await searchTweets(makeResultsPage(rawResults), 'hello', { delay: () => {}, maxRetries: 2 });
    expect(result.length).toBe(1);
    expect(result[0].platform).toBe('facebook');
    expect(result[0].author).toBe('zuck');
  });

  it('respects limit', async () => {
    const rawResults = Array.from({ length: 10 }, (_, i) => ({
      id: `https://www.facebook.com/x/posts/${i}`,
      text: `post ${i}`,
      author: 'user',
      timestamp: null,
      url: `https://www.facebook.com/x/posts/${i}`,
    }));
    const result = await searchTweets(makeResultsPage(rawResults), 'test', { limit: 3, delay: () => {}, maxRetries: 2 });
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('calls onProgress each iteration', async () => {
    const progressCalls = [];
    await searchTweets(makeEmptyPage(), 'test', {
      delay: () => {},
      maxRetries: 2,
      onProgress: (p) => progressCalls.push(p),
    });
    expect(progressCalls.length).toBeGreaterThan(0);
    expect(progressCalls[0]).toHaveProperty('scraped');
    expect(progressCalls[0]).toHaveProperty('limit');
  });

  it('deduplicates results with the same id', async () => {
    let callCount = 0;
    const page = {
      goto: async () => {},
      evaluate: async (fn) => {
        if (fn.toString().includes('scrollTo')) return undefined;
        callCount++;
        if (callCount <= 2) {
          return [{ id: 'dup-id', text: 'same', author: 'x', timestamp: null, url: 'https://www.facebook.com/x/posts/1' }];
        }
        return [];
      },
    };
    const result = await searchTweets(page, 'test', { delay: () => {}, maxRetries: 3 });
    expect(result.filter(r => r.id === 'dup-id').length).toBe(1);
  });
});

// ============================================================================
// Story 1.5 — dispatcher routing for search
// ============================================================================

describe('dispatcher scrape() search routing', () => {
  it('scrape("facebook","search",...) routes to searchTweets', async () => {
    const rawResults = [
      { id: 'https://www.facebook.com/x/posts/1', text: 'test post', author: 'x', timestamp: null, url: 'https://www.facebook.com/x/posts/1' },
    ];
    let callCount = 0;
    const page = {
      goto: async () => {},
      evaluate: async (fn) => {
        if (fn.toString().includes('scrollTo')) return undefined;
        callCount++;
        return callCount === 1 ? rawResults : [];
      },
    };
    const result = await scrape('facebook', 'search', { page, query: 'test', delay: () => {}, maxRetries: 2 });
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].platform).toBe('facebook');
  });

  it('default export contains searchTweets', () => {
    expect(typeof searchTweets).toBe('function');
  });
});

// ============================================================================
// TEA Round 2 — searchTweets edge cases
// ============================================================================

describe('[TEA] searchTweets — edge cases', () => {
  it('[P1] exports searchTweets as named export', () => {
    expect(typeof searchTweets).toBe('function');
  });

  it('[P1] encodes special characters in query URL', async () => {
    const visitedUrls = [];
    const page = {
      goto: async (url) => { visitedUrls.push(url); },
      evaluate: async (fn) => {
        if (fn.toString().includes('scrollTo')) return undefined;
        return [];
      },
    };
    await searchTweets(page, 'hello world & #test', { delay: () => {}, maxRetries: 1 });
    expect(visitedUrls[0]).toContain('hello%20world');
    expect(visitedUrls[0]).toContain('%23test');
  });

  it('[P1] stops at maxRetries and returns partial results', async () => {
    let callCount = 0;
    const page = {
      goto: async () => {},
      evaluate: async (fn) => {
        if (fn.toString().includes('scrollTo')) return undefined;
        callCount++;
        if (callCount === 1) {
          return [{ id: 'r1', text: 'first', author: 'x', timestamp: null, url: 'https://www.facebook.com/x/posts/1' }];
        }
        return [];
      },
    };
    const result = await searchTweets(page, 'test', { delay: () => {}, maxRetries: 3 });
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('r1');
  });
});

// ============================================================================
// TEA Round 2 — normalizeSearchResult edge cases
// ============================================================================

describe('[TEA] normalizeSearchResult — edge cases', () => {
  it('[P2] sets timestamp to null when missing', () => {
    const result = normalizeSearchResult({ id: 'x', text: 'hi', author: 'a', timestamp: undefined, url: null });
    expect(result.timestamp).toBeNull();
  });
});

// ============================================================================
// TEA Round 3 — normalizeSearchResult edge cases
// ============================================================================

describe('[TEA-R3] normalizeSearchResult — edge cases', () => {
  it('[P2] empty string text → null', () => {
    expect(normalizeSearchResult({ id: 'x', text: '', author: 'a', timestamp: null, url: null }).text).toBeNull();
  });

  it('[P2] empty string author → null', () => {
    expect(normalizeSearchResult({ id: 'x', text: 'hi', author: '', timestamp: null, url: null }).author).toBeNull();
  });
});

// ============================================================================
// TEA Round 3 — searchTweets edge cases
// ============================================================================

describe('[TEA-R3] searchTweets — edge cases', () => {
  it('[P2] encodes % in query', async () => {
    const visitedUrls = [];
    const page = {
      goto: async (url) => { visitedUrls.push(url); },
      evaluate: async (fn) => {
        if (fn.toString().includes('scrollTo')) return undefined;
        return [];
      },
    };
    await searchTweets(page, '50% off', { delay: () => {}, maxRetries: 1 });
    expect(visitedUrls[0]).toContain('50%25%20off');
  });
});
