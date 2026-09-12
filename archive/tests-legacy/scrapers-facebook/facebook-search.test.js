// by nichxbt
import { describe, it, expect } from 'vitest';
import {
  normalizeSearchResult,
  searchTweets,
  searchFacebook,
  normalizePostSearchResult,
  normalizePeopleSearchResult,
  normalizePageSearchResult,
  normalizeGroupSearchResult,
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
    evaluate: async (fn, ...args) => {
      const fnStr = fn.toString();
      if (fnStr.includes('scrollTo')) return undefined;
      // No-arg evaluate calls are from assertNoCheckpoint body checks.
      if (args.length === 0) return false;
      return [];
    },
  });

  const makeResultsPage = (rawResults = []) => {
    let callCount = 0;
    return {
      goto: async () => {},
      evaluate: async (fn, ...args) => {
        const fnStr = fn.toString();
        if (fnStr.includes('scrollTo')) return undefined;
        // No-arg evaluate calls are from assertNoCheckpoint body checks.
        if (args.length === 0) return false;
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
      evaluate: async (fn, ...args) => {
        const fnStr = fn.toString();
        if (fnStr.includes('scrollTo')) return undefined;
        if (args.length === 0) return false;
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
  it('scrape("facebook","search",...) routes to searchFacebook', async () => {
    const rawResults = [
      { id: 'https://www.facebook.com/x/posts/1', text: 'test post', author: 'x', timestamp: null, url: 'https://www.facebook.com/x/posts/1' },
    ];
    let callCount = 0;
    const page = {
      goto: async () => {},
      evaluate: async (fn, ...args) => {
        const fnStr = fn.toString();
        if (fnStr.includes('scrollTo')) return undefined;
        if (args.length === 0) return false;
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
      evaluate: async (fn, ...args) => {
        const fnStr = fn.toString();
        if (fnStr.includes('scrollTo')) return undefined;
        if (args.length === 0) return false;
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

// ============================================================================
// Story 7.2 — Multi-Type Search Normalizers
// ============================================================================

describe('normalizePostSearchResult', () => {
  it('normalizes a hydrated Story object', () => {
    const raw = {
      id: 'p1',
      message: 'Hello world',
      actor: { name: 'zuck' },
      published_time: '2026-01-01T00:00:00Z',
      url: 'https://www.facebook.com/zuck/posts/1',
    };
    const result = normalizePostSearchResult(raw);
    expect(result).toEqual({
      id: 'p1',
      text: 'Hello world',
      author: 'zuck',
      timestamp: '2026-01-01T00:00:00Z',
      url: 'https://www.facebook.com/zuck/posts/1',
      platform: 'facebook',
    });
  });

  it('falls back to DOM-style fields', () => {
    const result = normalizePostSearchResult({
      id: 'p2',
      text: 'DOM text',
      author: 'user',
      timestamp: 't',
      url: 'https://www.facebook.com/user/posts/2',
    });
    expect(result.text).toBe('DOM text');
    expect(result.author).toBe('user');
    expect(result.platform).toBe('facebook');
  });

  it('derives id from url or text when missing', () => {
    const result = normalizePostSearchResult({
      text: 'No id here but a long sentence',
    });
    expect(result.id).toBe('No id here but a long sentence'.slice(0, 60));
  });
});

describe('normalizePeopleSearchResult', () => {
  it('normalizes a hydrated User object', () => {
    const raw = {
      id: 'u1',
      name: 'Mark Zuckerberg',
      username: 'zuck',
      url: 'https://www.facebook.com/zuck',
      profile_picture: 'https://fb.com/zuck.jpg',
    };
    const result = normalizePeopleSearchResult(raw);
    expect(result).toEqual({
      id: 'u1',
      name: 'Mark Zuckerberg',
      username: 'zuck',
      profileUrl: 'https://www.facebook.com/zuck',
      image: 'https://fb.com/zuck.jpg',
      platform: 'facebook',
    });
  });

  it('derives username from profile URL when missing', () => {
    const result = normalizePeopleSearchResult({
      name: 'Test User',
      url: 'https://www.facebook.com/testuser',
    });
    expect(result.username).toBe('testuser');
    expect(result.profileUrl).toBe('https://www.facebook.com/testuser');
  });
});

describe('normalizePageSearchResult', () => {
  it('normalizes a hydrated Page object', () => {
    const raw = {
      id: 'page1',
      name: 'Meta',
      category_name: 'Technology Company',
      fan_count: '1.2M',
      url: 'https://www.facebook.com/Meta',
      profile_picture: 'https://fb.com/meta.jpg',
    };
    const result = normalizePageSearchResult(raw);
    expect(result).toEqual({
      id: 'page1',
      name: 'Meta',
      category: 'Technology Company',
      likes: '1.2M',
      pageUrl: 'https://www.facebook.com/Meta',
      image: 'https://fb.com/meta.jpg',
      platform: 'facebook',
    });
  });
});

describe('normalizeGroupSearchResult', () => {
  it('normalizes a hydrated Group object', () => {
    const raw = {
      id: 'group1',
      name: 'Node.js Developers',
      member_count: '50K',
      privacy: 'Public',
      url: 'https://www.facebook.com/groups/group1',
      profile_picture: 'https://fb.com/group.jpg',
    };
    const result = normalizeGroupSearchResult(raw);
    expect(result).toEqual({
      id: 'group1',
      name: 'Node.js Developers',
      members: '50K',
      privacy: 'Public',
      groupUrl: 'https://www.facebook.com/groups/group1',
      image: 'https://fb.com/group.jpg',
      platform: 'facebook',
    });
  });
});

// ============================================================================
// Story 7.2 — searchFacebook dispatcher
// ============================================================================

describe('searchFacebook', () => {
  function makeSearchPage(resultsByType, domResultsByType = {}) {
    const byType = new Map();
    for (const [key, value] of Object.entries(resultsByType)) {
      byType.set(JSON.stringify([key]), value);
    }

    return {
      goto: async () => {},
      url: () => 'https://www.facebook.com/search/posts',
      evaluate: async (fn, ...args) => {
        const fnStr = fn.toString();
        if (fnStr.includes('scrollTo')) return undefined;
        if (args.length === 0) return false;
        // Hydration extraction: look for data-content-len script walk.
        if (fnStr.includes('data-content-len')) {
          return byType.get(JSON.stringify(args[0])) || [];
        }
        // DOM fallback: extractListItemsFromDom passes the search type string.
        if (fnStr.includes('[role="listitem"]')) {
          return domResultsByType[args[0]] || [];
        }
        // DOM fallback: extractPostsFromDom passes NON_PROFILE_SEGMENTS array.
        if (fnStr.includes('[role="article"]')) {
          return domResultsByType.posts || [];
        }
        return [];
      },
    };
  }

  it('throws for unsupported type', async () => {
    await expect(searchFacebook({}, 'test', { type: 'invalid' })).rejects.toThrow(/type must be one of/);
  });

  it('throws for non-string query', async () => {
    await expect(searchFacebook({}, 123)).rejects.toThrow(/query must be a non-empty string/);
  });

  it('throws for non-positive limit', async () => {
    await expect(searchFacebook({}, 'test', { limit: 0 })).rejects.toThrow(/limit must be a positive integer/);
    await expect(searchFacebook({}, 'test', { limit: -5 })).rejects.toThrow(/limit must be a positive integer/);
    await expect(searchFacebook({}, 'test', { limit: 'abc' })).rejects.toThrow(/limit must be a positive integer/);
  });

  it('defaults to posts when type is omitted', async () => {
    const page = makeSearchPage({
      Story: [{ id: 'p1', message: 'Hello', actor: { name: 'zuck' }, published_time: 't', url: 'u' }],
    });
    const result = await searchFacebook(page, 'hello', { delay: () => {}, limit: 1, maxRetries: 1 });
    expect(result[0].text).toBe('Hello');
  });

  it('appends location to query when provided', async () => {
    const visitedUrls = [];
    const page = {
      goto: async (url) => { visitedUrls.push(url); },
      url: () => 'https://www.facebook.com/search/posts',
      evaluate: async (fn) => {
        if (fn.toString().includes('scrollTo')) return undefined;
        return [];
      },
    };
    await searchFacebook(page, 'coffee', { type: 'posts', location: 'Seattle', delay: () => {}, limit: 1, maxRetries: 1 });
    expect(visitedUrls[0]).toContain('coffee%20near%20Seattle');
  });

  it('returns posts array for type: posts', async () => {
    const page = makeSearchPage({
      Story: [{ id: 'p1', message: 'Hello', actor: { name: 'zuck' }, published_time: 't', url: 'u' }],
    });
    const result = await searchFacebook(page, 'hello', { type: 'posts', delay: () => {}, limit: 1, maxRetries: 1 });
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Hello');
    expect(result[0].author).toBe('zuck');
    expect(result[0].platform).toBe('facebook');
  });

  it('returns merged object for type: all', async () => {
    const page = makeSearchPage({
      Story: [{ id: 'p1', message: 'post', actor: { name: 'a' }, published_time: 't', url: 'u' }],
      User: [{ id: 'u1', name: 'Person', username: 'person', url: 'https://www.facebook.com/person', profile_picture: 'i' }],
      Page: [{ id: 'page1', name: 'Page', category_name: 'C', fan_count: '1K', url: 'https://www.facebook.com/page', profile_picture: 'i' }],
      Group: [{ id: 'g1', name: 'Group', member_count: '100', privacy: 'Public', url: 'https://www.facebook.com/groups/g', profile_picture: 'i' }],
    });
    const result = await searchFacebook(page, 'hello', { type: 'all', delay: () => {}, limit: 1, maxRetries: 1 });
    expect(result).toHaveProperty('posts');
    expect(result).toHaveProperty('people');
    expect(result).toHaveProperty('pages');
    expect(result).toHaveProperty('groups');
    expect(result.posts[0].text).toBe('post');
    expect(result.people[0].name).toBe('Person');
    expect(result.pages[0].name).toBe('Page');
    expect(result.groups[0].name).toBe('Group');
  });

  it('returns empty arrays for all when no results', async () => {
    const page = makeSearchPage({});
    const result = await searchFacebook(page, 'hello', { type: 'all', delay: () => {}, limit: 1, maxRetries: 1 });
    expect(result).toEqual({ posts: [], people: [], pages: [], groups: [] });
  });

  it('returns a mixed all object when some categories are empty', async () => {
    const page = makeSearchPage(
      {
        Story: [{ id: 'p1', message: 'post', actor: { name: 'a' }, published_time: 't', url: 'u' }],
        User: [{ id: 'u1', name: 'Person', username: 'person', url: 'https://www.facebook.com/person', profile_picture: 'i' }],
      },
      {}
    );
    const result = await searchFacebook(page, 'hello', { type: 'all', delay: () => {}, limit: 1, maxRetries: 1 });
    expect(result.posts).toHaveLength(1);
    expect(result.people).toHaveLength(1);
    expect(result.pages).toHaveLength(0);
    expect(result.groups).toHaveLength(0);
  });

  it('falls back to DOM results for people', async () => {
    const domResults = [
      { id: 'alice', name: 'Alice Smith', profileUrl: 'https://www.facebook.com/alice' },
    ];
    const page = makeSearchPage({}, { people: domResults });
    const result = await searchFacebook(page, 'hello', { type: 'people', delay: () => {}, limit: 1, maxRetries: 1 });
    expect(result[0].name).toBe('Alice Smith');
    expect(result[0].username).toBe('alice');
    expect(result[0].platform).toBe('facebook');
  });

  it('falls back to DOM results for pages', async () => {
    const domResults = [
      { id: 'starbucks', name: 'Starbucks', category: 'Coffee Shop', likes: '1.2M', pageUrl: 'https://www.facebook.com/starbucks' },
    ];
    const page = makeSearchPage({}, { pages: domResults });
    const result = await searchFacebook(page, 'hello', { type: 'pages', delay: () => {}, limit: 1, maxRetries: 1 });
    expect(result[0].name).toBe('Starbucks');
    expect(result[0].pageUrl).toBe('https://www.facebook.com/starbucks');
  });

  it('falls back to DOM results for groups', async () => {
    const domResults = [
      { id: 'nodejs', name: 'Node.js Developers', members: '50K', privacy: 'Public', groupUrl: 'https://www.facebook.com/groups/nodejs' },
    ];
    const page = makeSearchPage({}, { groups: domResults });
    const result = await searchFacebook(page, 'hello', { type: 'groups', delay: () => {}, limit: 1, maxRetries: 1 });
    expect(result[0].name).toBe('Node.js Developers');
    expect(result[0].groupUrl).toBe('https://www.facebook.com/groups/nodejs');
  });

  it('falls back to DOM results for posts', async () => {
    const domResults = [
      { id: 'post1', text: 'DOM post text', author: 'author1', timestamp: 't', url: 'https://www.facebook.com/x/posts/1' },
    ];
    const page = makeSearchPage({}, { posts: domResults });
    const result = await searchFacebook(page, 'hello', { type: 'posts', delay: () => {}, limit: 1, maxRetries: 1 });
    expect(result[0].text).toBe('DOM post text');
    expect(result[0].author).toBe('author1');
  });

  it('extracts numeric profile ids from DOM people links', async () => {
    const domResults = [
      { id: '123', name: 'Numeric User', profileUrl: 'https://www.facebook.com/profile.php?id=123' },
    ];
    const page = makeSearchPage({}, { people: domResults });
    const result = await searchFacebook(page, 'hello', { type: 'people', delay: () => {}, limit: 1, maxRetries: 1 });
    expect(result[0].id).toBe('123');
    expect(result[0].username).toBe('123');
  });

  it('detects checkpoints and throws during the scroll loop', async () => {
    let calls = 0;
    const page = {
      goto: async () => {},
      url: () => 'https://www.facebook.com/search/posts',
      evaluate: async (fn, ...args) => {
        const fnStr = fn.toString();
        if (fnStr.includes('scrollTo')) return undefined;
        if (args.length === 0) {
          calls++;
          // Second body check simulates a checkpoint interstitial.
          return calls === 2;
        }
        return [{ id: 'p1', message: 'post', actor: { name: 'a' }, published_time: 't', url: 'u' }];
      },
    };
    await expect(searchFacebook(page, 'hello', { type: 'posts', delay: () => {}, limit: 2, maxRetries: 3 })).rejects.toThrow(/checkpoint/);
  });
});

// ============================================================================
// Story 7.2 — dispatcher routing
// ============================================================================

describe('dispatcher searchFacebook routing', () => {
  function makeRoutingPage(storyResults) {
    return {
      goto: async () => {},
      url: () => 'https://www.facebook.com/search/posts',
      evaluate: async (fn, ...args) => {
        const fnStr = fn.toString();
        if (fnStr.includes('scrollTo')) return undefined;
        if (args.length === 0) return false;
        if (Array.isArray(args[0]) && args[0][0] === 'Story') return storyResults;
        return [];
      },
    };
  }

  it('scrape("facebook","search",...) routes to searchFacebook', async () => {
    const page = makeRoutingPage([{ id: 'p1', message: 'Hello', actor: { name: 'zuck' }, published_time: 't', url: 'u' }]);
    const result = await scrape('facebook', 'search', { page, query: 'test', type: 'posts', delay: () => {}, limit: 1, maxRetries: 1 });
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].platform).toBe('facebook');
  });

  it('scrape("fb","search",...) alias routes to searchFacebook', async () => {
    const page = makeRoutingPage([{ id: 'p1', message: 'Hello', actor: { name: 'zuck' }, published_time: 't', url: 'u' }]);
    const result = await scrape('fb', 'search', { page, query: 'test', type: 'posts', delay: () => {}, limit: 1, maxRetries: 1 });
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].platform).toBe('facebook');
  });

  it('searchTweets is a thin wrapper that calls searchFacebook with type: posts', async () => {
    const domResults = [{ id: 'p1', text: 'wrapped', author: 'a', timestamp: 't', url: 'https://www.facebook.com/x/posts/1' }];
    const page = {
      goto: async () => {},
      url: () => 'https://www.facebook.com/search/posts',
      evaluate: async (fn, ...args) => {
        const fnStr = fn.toString();
        if (fnStr.includes('scrollTo')) return undefined;
        if (args.length === 0) return false;
        if (fnStr.includes('[role="article"]')) return domResults;
        return [];
      },
    };
    const result = await searchTweets(page, 'hello', { delay: () => {}, limit: 1, maxRetries: 1 });
    expect(result[0].text).toBe('wrapped');
    expect(result[0].platform).toBe('facebook');
  });
});
