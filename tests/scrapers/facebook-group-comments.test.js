// tests/scrapers/facebook-group-comments.test.js
// Story 7.3 — scrapeFacebookGroupComments thin-wrapper tests.
// by nichxbt
import { describe, it, expect } from 'vitest';
import { scrapeFacebookGroupComments } from '../../src/scrapers/facebook/index.js';

function makeGroupCommentsPage(results) {
  let hydrationCall = 0;
  return {
    goto: async () => {},
    url: () => 'https://www.facebook.com/groups/xyz/posts/1',
    setUserAgent: async () => {},
    setViewport: async () => {},
    evaluate: async (fn, ...args) => {
      const fnStr = fn.toString();
      if (fnStr.includes('scrollTo')) return undefined;
      if (args.length === 0) {
        if (fnStr.includes('this content isn') || fnStr.includes('unavailable')) return false;
        if (fnStr.includes('checkpoint') || fnStr.includes('security check')) return false;
        if (fnStr.includes('Most relevant') || fnStr.includes('All comments')) return undefined;
        if (fnStr.includes('View more comments') || fnStr.includes('replies')) return undefined;
        return undefined;
      }
      if (fnStr.includes('data-content-len') && Array.isArray(args[0])) {
        hydrationCall++;
        return hydrationCall === 1 ? results : [];
      }
      return [];
    },
  };
}

describe('scrapeFacebookGroupComments', () => {
  it('reuses scrapeFacebookComments and returns the same comment shape', async () => {
    const page = makeGroupCommentsPage([
      { id: 'gc1', author: { name: 'Member' }, message: 'Group comment', like_count: 4 },
    ]);
    const result = await scrapeFacebookGroupComments(page, 'https://www.facebook.com/groups/xyz/posts/1', {
      delay: () => {},
      maxRetries: 1,
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].id).toBe('gc1');
    expect(result[0].authorName).toBe('Member');
    expect(result[0].text).toBe('Group comment');
  });

  it('passes includeReplies to the underlying scraper', async () => {
    const page = makeGroupCommentsPage([
      {
        id: 'gc1',
        author: { name: 'Parent' },
        message: 'Top',
        like_count: 1,
        replies: [{ id: 'gc1.1', author: { name: 'Child' }, message: 'Reply', like_count: 0 }],
      },
    ]);
    const result = await scrapeFacebookGroupComments(page, 'https://www.facebook.com/groups/xyz/posts/1', {
      delay: () => {},
      maxRetries: 1,
      includeReplies: true,
    });
    expect(result[0].replies).toHaveLength(1);
    expect(result[0].replies[0].parentId).toBe('gc1');
  });

  it('throws for URLs without /groups/', async () => {
    await expect(
      scrapeFacebookGroupComments(makeGroupCommentsPage([]), 'https://www.facebook.com/pages/xyz/posts/1', {
        delay: () => {},
      })
    ).rejects.toThrow(/groups/);
  });

  it('throws for non-facebook URLs (SSRF)', async () => {
    await expect(
      scrapeFacebookGroupComments(makeGroupCommentsPage([]), 'https://evil.com/groups/xyz/posts/1', {
        delay: () => {},
      })
    ).rejects.toThrow(/facebook\.com/);
  });
});
