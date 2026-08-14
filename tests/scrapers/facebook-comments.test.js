// tests/scrapers/facebook-comments.test.js
// Story 7.3 — scrapeFacebookComments, normalizeComment, and group-comments wrapper.
// by nichxbt
import { describe, it, expect } from 'vitest';
import {
  normalizeComment,
  scrapeFacebookComments,
  scrapeFacebookGroupComments,
} from '../../src/scrapers/facebook/index.js';
import { scrape } from '../../src/scrapers/index.js';

// ============================================================================
// Helpers
// ============================================================================

function makeCommentPage(commentResults, { unavailable = false, fallbackResults = null } = {}) {
  let hydrationCall = 0;
  let fallbackCall = 0;
  const visitedUrls = [];

  return {
    goto: async (url) => { visitedUrls.push(url); },
    url: () => 'https://www.facebook.com/zuck/posts/1',
    setUserAgent: async () => {},
    setViewport: async () => {},
    evaluate: async (fn, ...args) => {
      const fnStr = fn.toString();

      // Scroll calls
      if (fnStr.includes('scrollTo')) return undefined;

      // No-arg evaluate calls
      if (args.length === 0) {
        if (fnStr.includes("this content isn't") || fnStr.includes('unavailable')) {
          return unavailable;
        }
        if (fnStr.includes('checkpoint') || fnStr.includes('security check')) return false;
        if (fnStr.includes('Most relevant') || fnStr.includes('All comments')) return undefined;
        if (fnStr.includes('View more comments') || fnStr.includes('replies')) return undefined;
        return undefined;
      }

      // extractHydrationJson is identified by the script selector and array arg
      if (fnStr.includes('data-content-len') && Array.isArray(args[0])) {
        hydrationCall++;
        return hydrationCall === 1 ? commentResults : [];
      }

      // extractCommentsFromDom fallback: passed NON_PROFILE_SEGMENTS array
      if (fnStr.includes('role="article"') && Array.isArray(args[0])) {
        fallbackCall++;
        return fallbackCall === 1 ? (fallbackResults || []) : [];
      }

      return [];
    },
    getVisitedUrls: () => visitedUrls,
  };
}

// ============================================================================
// Story 7.3 — normalizeComment
// ============================================================================

describe('normalizeComment', () => {
  it('normalizes a hydrated Comment object', () => {
    const raw = {
      id: 'c1',
      author: { name: 'Alice Example', url: 'https://www.facebook.com/alice' },
      message: 'Great post!',
      timestamp: '2026-08-14T10:00:00Z',
      like_count: 5,
    };
    const result = normalizeComment(raw);
    expect(result.id).toBe('c1');
    expect(result.authorName).toBe('Alice Example');
    expect(result.authorUrl).toBe('https://www.facebook.com/alice');
    expect(result.text).toBe('Great post!');
    expect(result.timestamp).toBe('2026-08-14T10:00:00Z');
    expect(result.likes).toBe(5);
    expect(result.parentId).toBeNull();
    expect(result.replies).toBeUndefined();
  });

  it('normalizes a DOM-style comment with string likes', () => {
    const raw = {
      text: 'Nice work!',
      author: 'Bob Example',
      authorUrl: 'https://www.facebook.com/bob',
      timestamp: '2h',
      likes: '12',
    };
    const result = normalizeComment(raw);
    expect(result.text).toBe('Nice work!');
    expect(result.authorName).toBe('Bob Example');
    expect(result.authorUrl).toBe('https://www.facebook.com/bob');
    expect(result.likes).toBe(12);
    expect(result.platform).toBeUndefined();
  });

  it('strips phone numbers and emails from text and author name (NFR-11)', () => {
    const raw = {
      id: 'c2',
      author: { name: 'Spam 555-123-4567 spammer@example.com', url: 'https://www.facebook.com/spam' },
      message: 'Reach me at 555-123-4567 or spammer@example.com',
    };
    const result = normalizeComment(raw);
    expect(result.authorName).toBe('Spam');
    expect(result.text).not.toMatch(/\d{3}/);
    expect(result.text).not.toMatch(/@/);
  });

  it('recursively normalizes nested replies', () => {
    const raw = {
      id: 'c3',
      author: { name: 'Parent' },
      message: 'Parent comment',
      like_count: 1,
      replies: [
        { id: 'c3.1', author: { name: 'Child' }, message: 'Reply', like_count: 0 },
      ],
    };
    const result = normalizeComment(raw);
    expect(result.replies).toHaveLength(1);
    expect(result.replies[0].id).toBe('c3.1');
    expect(result.replies[0].parentId).toBe('c3');
  });

  it('returns null fields for empty input', () => {
    const result = normalizeComment({});
    expect(result.id).toBeNull();
    expect(result.authorName).toBeNull();
    expect(result.text).toBeNull();
    expect(result.likes).toBe(0);
    expect(result.parentId).toBeNull();
  });
});

// ============================================================================
// Story 7.3 — scrapeFacebookComments
// ============================================================================

describe('scrapeFacebookComments', () => {
  it('returns normalized comments from hydration', async () => {
    const page = makeCommentPage([
      { id: 'c1', author: { name: 'Alice' }, message: 'Nice!', timestamp: 't1', like_count: 3 },
    ]);
    const result = await scrapeFacebookComments(page, 'https://www.facebook.com/zuck/posts/1', {
      delay: () => {},
      maxRetries: 1,
      limit: 5,
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('c1');
    expect(result[0].authorName).toBe('Alice');
    expect(result[0].text).toBe('Nice!');
    expect(result[0].platform).toBeUndefined();
  });

  it('deduplicates comments by id', async () => {
    const page = makeCommentPage([
      { id: 'c1', author: { name: 'Alice' }, message: 'One' },
      { id: 'c1', author: { name: 'Alice' }, message: 'One again' },
      { id: 'c2', author: { name: 'Bob' }, message: 'Two' },
    ]);
    const result = await scrapeFacebookComments(page, 'https://www.facebook.com/zuck/posts/1', {
      delay: () => {},
      maxRetries: 1,
      limit: 5,
    });
    expect(result.length).toBe(2);
    expect(result.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('honors limit and stops early', async () => {
    const raw = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      author: { name: `User ${i}` },
      message: `Comment ${i}`,
    }));
    const page = makeCommentPage(raw);
    const result = await scrapeFacebookComments(page, 'https://www.facebook.com/zuck/posts/1', {
      delay: () => {},
      maxRetries: 1,
      limit: 3,
    });
    expect(result.length).toBeLessThanOrEqual(3);
    expect(result[0].text).toBe('Comment 0');
  });

  it('excludes replies when includeReplies is false', async () => {
    const page = makeCommentPage([
      {
        id: 'c1',
        author: { name: 'Parent' },
        message: 'Top',
        like_count: 1,
        replies: [{ id: 'c1.1', author: { name: 'Child' }, message: 'Reply', like_count: 0 }],
      },
    ]);
    const result = await scrapeFacebookComments(page, 'https://www.facebook.com/zuck/posts/1', {
      delay: () => {},
      maxRetries: 1,
      includeReplies: false,
    });
    expect(result[0].replies).toBeUndefined();
  });

  it('includes replies when includeReplies is true', async () => {
    const page = makeCommentPage([
      {
        id: 'c1',
        author: { name: 'Parent' },
        message: 'Top',
        like_count: 1,
        replies: [{ id: 'c1.1', author: { name: 'Child' }, message: 'Reply', like_count: 0 }],
      },
    ]);
    const result = await scrapeFacebookComments(page, 'https://www.facebook.com/zuck/posts/1', {
      delay: () => {},
      maxRetries: 1,
      includeReplies: true,
    });
    expect(result[0].replies).toHaveLength(1);
    expect(result[0].replies[0].parentId).toBe('c1');
  });

  it('falls back to DOM extraction when hydration is empty', async () => {
    const fallback = [
      { text: 'DOM comment', author: 'Dom', authorUrl: 'https://www.facebook.com/dom', timestamp: '1h', likes: '7' },
    ];
    const page = makeCommentPage([], { fallbackResults: fallback });
    const result = await scrapeFacebookComments(page, 'https://www.facebook.com/zuck/posts/1', {
      delay: () => {},
      maxRetries: 1,
      limit: 5,
    });
    expect(result.length).toBe(1);
    expect(result[0].text).toBe('DOM comment');
    expect(result[0].authorName).toBe('Dom');
    expect(result[0].likes).toBe(7);
  });

  it('returns { note, platform } for restricted/unavailable posts', async () => {
    const page = makeCommentPage([], { unavailable: true });
    const result = await scrapeFacebookComments(page, 'https://www.facebook.com/zuck/posts/1', {
      delay: () => {},
      maxRetries: 1,
    });
    expect(result).toHaveProperty('note');
    expect(result).toHaveProperty('platform', 'facebook');
  });

  it('throws for non-facebook URLs (SSRF)', async () => {
    await expect(
      scrapeFacebookComments(makeCommentPage([]), 'https://evil.com/zuck/posts/1', { delay: () => {} })
    ).rejects.toThrow(/facebook\.com/);
  });

  it('calls onProgress with { scraped, limit }', async () => {
    const progressCalls = [];
    const page = makeCommentPage([{ id: 'c1', author: { name: 'A' }, message: 'x' }]);
    await scrapeFacebookComments(page, 'https://www.facebook.com/zuck/posts/1', {
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
// Story 7.3 — scrapeFacebookGroupComments
// ============================================================================

describe('scrapeFacebookGroupComments', () => {
  it('delegates to scrapeFacebookComments for group post URLs', async () => {
    const page = makeCommentPage([
      { id: 'gc1', author: { name: 'Member' }, message: 'Group reply', like_count: 2 },
    ]);
    const result = await scrapeFacebookGroupComments(page, 'https://www.facebook.com/groups/xyz/posts/1', {
      delay: () => {},
      maxRetries: 1,
    });
    expect(result[0].text).toBe('Group reply');
  });

  it('throws for non-group URLs', async () => {
    await expect(
      scrapeFacebookGroupComments(makeCommentPage([]), 'https://www.facebook.com/zuck/posts/1', { delay: () => {} })
    ).rejects.toThrow(/groups/);
  });
});

// ============================================================================
// Story 7.3 — dispatcher routing
// ============================================================================

describe('dispatcher scrape() comment & group routing', () => {
  it('scrape("facebook","post_comments",...) routes to scrapeFacebookComments', async () => {
    const page = makeCommentPage([{ id: 'c1', author: { name: 'Routed' }, message: 'Via dispatcher', like_count: 0 }]);
    const result = await scrape('facebook', 'post_comments', {
      page,
      url: 'https://www.facebook.com/zuck/posts/1',
      delay: () => {},
      maxRetries: 1,
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].text).toBe('Via dispatcher');
  });

  it('scrape("facebook","group_comments",...) routes to scrapeFacebookGroupComments', async () => {
    const page = makeCommentPage([{ id: 'gc1', author: { name: 'Routed' }, message: 'Group comment', like_count: 0 }]);
    const result = await scrape('facebook', 'group_comments', {
      page,
      url: 'https://www.facebook.com/groups/xyz/posts/1',
      delay: () => {},
      maxRetries: 1,
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].text).toBe('Group comment');
  });
});
