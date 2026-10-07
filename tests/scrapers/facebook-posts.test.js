// by nichxbt
import { describe, it, expect } from 'vitest';
import {
  normalizePost,
  scrapeTweets,
} from '../../src/scrapers/facebook/index.js';
import { scrape } from '../../src/scrapers/index.js';

// ============================================================================
// Story 1.3 — normalizePost
// ============================================================================

describe('normalizePost', () => {
  it('returns full normalized post shape', () => {
    const raw = {
      id: 'post-123',
      text: 'Hello world',
      timestamp: '2026-01-01T00:00:00Z',
      likes: '42',
      comments: '7',
      postUrl: 'https://www.facebook.com/zuck/posts/123',
      images: ['https://cdn.fb.com/img1.jpg'],
      hasVideo: false,
    };
    const result = normalizePost(raw);
    expect(result.id).toBe('post-123');
    expect(result.text).toBe('Hello world');
    expect(result.timestamp).toBe('2026-01-01T00:00:00Z');
    expect(result.likes).toBe('42');
    expect(result.comments).toBe('7');
    expect(result.url).toBe('https://www.facebook.com/zuck/posts/123');
    expect(result.media.images).toEqual(['https://cdn.fb.com/img1.jpg']);
    expect(result.media.hasVideo).toBe(false);
    expect(result.platform).toBe('facebook');
  });

  it('sets hasVideo true when present', () => {
    const raw = { id: 'v1', text: 'vid', timestamp: null, likes: '0', comments: '0', postUrl: null, images: [], hasVideo: true };
    expect(normalizePost(raw).media.hasVideo).toBe(true);
  });

  it('defaults likes and comments to "0" when absent', () => {
    const raw = { id: 'p1', text: 'test', timestamp: null, likes: undefined, comments: undefined, postUrl: null, images: [], hasVideo: false };
    const result = normalizePost(raw);
    expect(result.likes).toBe('0');
    expect(result.comments).toBe('0');
  });

  it('sets images to empty array when absent', () => {
    const raw = { id: 'p2', text: 'test', timestamp: null, likes: '1', comments: '0', postUrl: null, images: undefined, hasVideo: false };
    expect(normalizePost(raw).media.images).toEqual([]);
  });

  it('always sets platform to "facebook"', () => {
    const raw = { id: 'p3', text: 'x', timestamp: null, likes: '0', comments: '0', postUrl: null, images: [], hasVideo: false };
    expect(normalizePost(raw).platform).toBe('facebook');
  });
});

// ============================================================================
// Story 1.3 — scrapeTweets (browser-free via fake page)
// ============================================================================

describe('scrapeTweets', () => {
  const makeFakePage = (rawPosts = []) => ({
    goto: async () => {},
    evaluate: async (fn) => {
      const fnStr = fn.toString();
      if (fnStr.includes('scrollTo')) return undefined;
      // assertNoOnboardingWall check — return false so it does not throw or consume posts
      if (fnStr.includes('find friends') || fnStr.includes('add friends')) return false;
      // Otherwise return canned raw posts
      return rawPosts;
    },
  });

  it('returns empty array when no posts', async () => {
    const page = makeFakePage([]);
    const result = await scrapeTweets(page, 'zuck', { limit: 10, maxRetries: 2, delay: () => {} });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  it('returns normalized posts with platform: facebook', async () => {
    const rawPosts = [
      { id: 'post-1', text: 'Hello', timestamp: null, likes: '5', comments: '2', postUrl: 'https://www.facebook.com/zuck/posts/1', images: [], hasVideo: false },
      { id: 'post-2', text: 'World', timestamp: null, likes: '10', comments: '3', postUrl: 'https://www.facebook.com/zuck/posts/2', images: [], hasVideo: false },
    ];
    const page = makeFakePage(rawPosts);
    const result = await scrapeTweets(page, 'zuck', { limit: 10, maxRetries: 2, delay: () => {} });
    expect(result.length).toBe(2);
    expect(result[0].platform).toBe('facebook');
    expect(result[0].id).toBe('post-1');
  });

  it('respects limit', async () => {
    const rawPosts = Array.from({ length: 10 }, (_, i) => ({
      id: `post-${i}`, text: `text ${i}`, timestamp: null, likes: '0', comments: '0',
      postUrl: `https://www.facebook.com/zuck/posts/${i}`, images: [], hasVideo: false,
    }));
    const page = makeFakePage(rawPosts);
    const result = await scrapeTweets(page, 'zuck', { limit: 3, delay: () => {} });
    expect(result.length).toBe(3);
  });

  it('calls onProgress each iteration', async () => {
    const progressCalls = [];
    const page = makeFakePage([]);
    await scrapeTweets(page, 'zuck', { limit: 5, maxRetries: 2, onProgress: (p) => progressCalls.push(p), delay: () => {} });
    expect(progressCalls.length).toBeGreaterThan(0);
    expect(progressCalls[0]).toHaveProperty('scraped');
    expect(progressCalls[0]).toHaveProperty('limit');
  });
});

// ============================================================================
// Story 1.3 — dispatcher routing for posts/tweets
// ============================================================================

describe('dispatcher scrape() posts/tweets routing', () => {
  const makeFakePage = (rawPosts = []) => ({
    goto: async () => {},
    evaluate: async (fn) => {
      const fnStr = fn.toString();
      if (fnStr.includes('scrollTo')) return undefined;
      if (fnStr.includes('find friends') || fnStr.includes('add friends')) return false;
      return rawPosts;
    },
  });

  it('scrape("facebook","posts",...) returns post array', async () => {
    const rawPosts = [
      { id: 'p1', text: 'Post 1', timestamp: null, likes: '1', comments: '0', postUrl: 'https://www.facebook.com/x/posts/1', images: [], hasVideo: false },
    ];
    const result = await scrape('facebook', 'posts', {
      page: makeFakePage(rawPosts),
      username: 'testpage',
      limit: 1,
      delay: () => {},
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].platform).toBe('facebook');
  });

  it('scrape("facebook","tweets",...) also routes to scrapeTweets', async () => {
    const result = await scrape('facebook', 'tweets', {
      page: makeFakePage([]),
      username: 'testpage',
      maxRetries: 1,
      delay: () => {},
    });
    expect(Array.isArray(result)).toBe(true);
  });
});

// ============================================================================
// TEA Expansion — normalizePost edge cases
// ============================================================================

describe('[TEA] normalizePost — edge cases', () => {
  it('[P2] sets url to null when postUrl is null', () => {
    const raw = { id: 'p1', text: 'x', timestamp: null, likes: '0', comments: '0', postUrl: null, images: [], hasVideo: false };
    expect(normalizePost(raw).url).toBeNull();
  });

  it('[P1] sets id to null when raw.id is falsy', () => {
    const raw = { id: '', text: 'x', timestamp: null, likes: '0', comments: '0', postUrl: null, images: [], hasVideo: false };
    expect(normalizePost(raw).id).toBeNull();
  });
});

// ============================================================================
// TEA Expansion — scrapeTweets scroll loop behavior
// ============================================================================

describe('[TEA] scrapeTweets — scroll loop behavior', () => {
  it('[P1] deduplicates posts with the same id', async () => {
    let callCount = 0;
    const page = {
      goto: async () => {},
      evaluate: async (fn) => {
        const fnStr = fn.toString();
        if (fnStr.includes('scrollTo')) return undefined;
        callCount++;
        // Return same post twice on first two scrape calls
        if (callCount <= 2) {
          return [{ id: 'dup-id', text: 'same post', timestamp: null, likes: '1', comments: '0', postUrl: 'https://www.facebook.com/x/posts/1', images: [], hasVideo: false }];
        }
        return [];
      },
    };
    const result = await scrapeTweets(page, 'zuck', { limit: 10, delay: () => {}, maxRetries: 3, useMbasic: false });
    expect(result.filter(p => p.id === 'dup-id').length).toBe(1);
  });

  it('[P1] stops when maxRetries exhausted and returns partial results', async () => {
    let callCount = 0;
    const page = {
      goto: async () => {},
      evaluate: async (fn) => {
        const fnStr = fn.toString();
        if (fnStr.includes('scrollTo')) return undefined;
        if (fnStr.includes('find friends') || fnStr.includes('add friends')) return false;
        callCount++;
        // Return 1 post on first call, then nothing
        if (callCount === 1) {
          return [{ id: 'p1', text: 'post', timestamp: null, likes: '0', comments: '0', postUrl: 'https://www.facebook.com/x/posts/1', images: [], hasVideo: false }];
        }
        return [];
      },
    };
    const result = await scrapeTweets(page, 'zuck', { limit: 50, delay: () => {}, maxRetries: 3, useMbasic: false });
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('p1');
  });
});

// ============================================================================
// TEA Round 3 — normalizePost edge cases
// ============================================================================

describe('[TEA-R3] normalizePost — edge cases', () => {
  it('[P2] hasVideo null/undefined → false', () => {
    const raw = { id: 'p1', text: 'hi', timestamp: null, likes: '0', comments: '0', postUrl: null, images: [], hasVideo: null };
    expect(normalizePost(raw).media.hasVideo).toBe(false);
  });

  it('[P2] images undefined → empty array', () => {
    const raw = { id: 'p1', text: 'hi', timestamp: null, likes: '0', comments: '0', postUrl: null, images: undefined, hasVideo: false };
    expect(normalizePost(raw).media.images).toEqual([]);
  });

  it('[P2] text null with postUrl → id from postUrl', () => {
    const raw = { id: 'https://www.facebook.com/x/posts/1', text: null, timestamp: null, likes: '0', comments: '0', postUrl: 'https://www.facebook.com/x/posts/1', images: [], hasVideo: false };
    expect(normalizePost(raw).url).toBe('https://www.facebook.com/x/posts/1');
  });
});

// ============================================================================
// TEA Round 3 — scrapeTweets edge cases
// ============================================================================

describe('[TEA-R3] scrapeTweets — edge cases', () => {
  it('[P1] uses normalizeHandle on username (strips @)', async () => {
    const visitedUrls = [];
    const page = {
      goto: async (url) => { visitedUrls.push(url); },
      evaluate: async (fn) => {
        if (fn.toString().includes('scrollTo')) return undefined;
        return [];
      },
    };
    await scrapeTweets(page, '@zuck', { delay: () => {}, maxRetries: 1 });
    expect(visitedUrls[0]).toContain('/zuck');
    expect(visitedUrls[0]).not.toContain('/@zuck');
  });
});
