// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for word-frequency.js — N-gram keyword & hashtag extraction.
 * No mocks — real implementations only.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { describe, it, expect } from 'vitest';
import { extractKeywordFrequency } from '../../src/analytics/word-frequency.js';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create a minimal PostItem-like object.
 * @param {string} content
 * @returns {{ content: string }}
 */
function makeItem(content) {
  return { content };
}

// ============================================================================
// Unigrams
// ============================================================================

describe('extractKeywordFrequency — unigrams', () => {
  it('counts unigram frequencies across items', () => {
    const items = [
      makeItem('hello world hello'),
      makeItem('hello again world'),
    ];
    const result = extractKeywordFrequency(items, { lang: 'en' });
    const hello = result.unigrams.find(u => u.term === 'hello');
    const world = result.unigrams.find(u => u.term === 'world');
    expect(hello).toBeDefined();
    expect(hello.count).toBe(3);
    expect(world).toBeDefined();
    expect(world.count).toBe(2);
  });

  it('filters English stopwords when lang=en', () => {
    const items = [makeItem('the quick brown fox is the best')];
    const result = extractKeywordFrequency(items, { lang: 'en' });
    const terms = result.unigrams.map(u => u.term);
    expect(terms).not.toContain('the');
    expect(terms).not.toContain('is');
    expect(terms).toContain('quick');
    expect(terms).toContain('brown');
    expect(terms).toContain('fox');
    expect(terms).toContain('best');
  });

  it('filters Vietnamese stopwords when lang=vi', () => {
    const items = [makeItem('của tôi là đây thị_trường tăng')];
    const result = extractKeywordFrequency(items, { lang: 'vi' });
    const terms = result.unigrams.map(u => u.term);
    expect(terms).not.toContain('của');
    expect(terms).not.toContain('tôi');
    expect(terms).not.toContain('là');
    expect(terms).not.toContain('đây');
    expect(terms).toContain('thị_trường');
    expect(terms).toContain('tăng');
  });

  it('skips stopword filtering for unsupported language', () => {
    const items = [makeItem('the quick brown fox')];
    const result = extractKeywordFrequency(items, { lang: 'fr' });
    const terms = result.unigrams.map(u => u.term);
    // No stopword file for 'fr' — all tokens kept
    expect(terms).toContain('the');
  });

  it('respects minLength filter', () => {
    const items = [makeItem('I am a big cat')];
    const result = extractKeywordFrequency(items, { lang: 'en', minLength: 3 });
    const terms = result.unigrams.map(u => u.term);
    expect(terms).not.toContain('i');
    expect(terms).not.toContain('am');
    expect(terms).not.toContain('a');
    expect(terms).toContain('big');
    expect(terms).toContain('cat');
  });
});

// ============================================================================
// Bigrams
// ============================================================================

describe('extractKeywordFrequency — bigrams', () => {
  it('generates bigrams from filtered token stream', () => {
    const items = [makeItem('quick brown fox jumps')];
    const result = extractKeywordFrequency(items, { lang: 'en' });
    const bigrams = result.bigrams.map(b => b.term);
    expect(bigrams).toContain('quick brown');
    expect(bigrams).toContain('brown fox');
    expect(bigrams).toContain('fox jumps');
  });

  it('does not span bigrams across stopwords', () => {
    const items = [makeItem('quick and brown fox')];
    const result = extractKeywordFrequency(items, { lang: 'en' });
    const bigrams = result.bigrams.map(b => b.term);
    // 'and' is a stopword, so 'quick brown' should NOT be a bigram
    expect(bigrams).not.toContain('quick brown');
    // 'brown fox' should still be a bigram (after 'and' is removed)
    expect(bigrams).toContain('brown fox');
  });

  it('does not span bigrams across item boundaries', () => {
    const items = [
      makeItem('hello world'),
      makeItem('foo bar'),
    ];
    const result = extractKeywordFrequency(items, { lang: 'en' });
    const bigrams = result.bigrams.map(b => b.term);
    expect(bigrams).toContain('hello world');
    expect(bigrams).toContain('foo bar');
    expect(bigrams).not.toContain('world foo');
  });

  it('recovers Vietnamese compound words as bigrams', () => {
    const items = [makeItem('thị trường chứng khoán tăng mạnh')];
    const result = extractKeywordFrequency(items, { lang: 'vi' });
    const bigrams = result.bigrams.map(b => b.term);
    expect(bigrams).toContain('thị trường');
    expect(bigrams).toContain('chứng khoán');
    expect(bigrams).toContain('khoán tăng');
    expect(bigrams).toContain('tăng mạnh');
  });
});

// ============================================================================
// Hashtags
// ============================================================================

describe('extractKeywordFrequency — hashtags', () => {
  it('extracts hashtags with correct counts', () => {
    const items = [
      makeItem('Love #tech and #coding'),
      makeItem('More #tech stuff'),
    ];
    const result = extractKeywordFrequency(items);
    const techTag = result.hashtags.find(h => h.tag === 'tech');
    expect(techTag).toBeDefined();
    expect(techTag.count).toBe(2);
    const codingTag = result.hashtags.find(h => h.tag === 'coding');
    expect(codingTag).toBeDefined();
    expect(codingTag.count).toBe(1);
  });

  it('lowercases and NFC-normalizes hashtags', () => {
    const items = [makeItem('Check #CàPhê and #TECH')];
    const result = extractKeywordFrequency(items);
    const tags = result.hashtags.map(h => h.tag);
    expect(tags).toContain('càphê');
    expect(tags).toContain('tech');
  });

  it('excludes pure-numeric hashtags like #123', () => {
    const items = [makeItem('Item #123 is great #real')];
    const result = extractKeywordFrequency(items);
    const tags = result.hashtags.map(h => h.tag);
    expect(tags).not.toContain('123');
    expect(tags).toContain('real');
  });

  it('excludes URL fragments with #', () => {
    const items = [makeItem('Visit https://example.com#section and #topic')];
    const result = extractKeywordFrequency(items);
    const tags = result.hashtags.map(h => h.tag);
    // The regex should not match '#section' inside a URL
    // (the URL has '://example.com#section' — '#' follows '.com' not whitespace)
    expect(tags).toContain('topic');
  });
});

// ============================================================================
// Sorting & output shape
// ============================================================================

describe('extractKeywordFrequency — output shape', () => {
  it('returns the expected shape', () => {
    const items = [makeItem('hello world #test')];
    const result = extractKeywordFrequency(items);
    expect(result).toHaveProperty('unigrams');
    expect(result).toHaveProperty('bigrams');
    expect(result).toHaveProperty('hashtags');
    expect(result).toHaveProperty('totalTokens');
    expect(result).toHaveProperty('lang');
    expect(Array.isArray(result.unigrams)).toBe(true);
    expect(Array.isArray(result.bigrams)).toBe(true);
    expect(Array.isArray(result.hashtags)).toBe(true);
    expect(typeof result.totalTokens).toBe('number');
  });

  it('sorts by count desc then term asc', () => {
    const items = [
      makeItem('zebra apple mango apple zebra apple'),
    ];
    const result = extractKeywordFrequency(items, { topN: 10 });
    // apple:3, zebra:2, mango:1 — sorted by count desc
    expect(result.unigrams[0].term).toBe('apple');
    expect(result.unigrams[0].count).toBe(3);
    expect(result.unigrams[1].term).toBe('zebra');
    expect(result.unigrams[1].count).toBe(2);
    expect(result.unigrams[2].term).toBe('mango');
    expect(result.unigrams[2].count).toBe(1);
  });

  it('sorts ties alphabetically', () => {
    const items = [makeItem('banana cherry apple')];
    const result = extractKeywordFrequency(items, { topN: 10 });
    // All have count=1, sorted by term asc
    expect(result.unigrams[0].term).toBe('apple');
    expect(result.unigrams[1].term).toBe('banana');
    expect(result.unigrams[2].term).toBe('cherry');
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe('extractKeywordFrequency — edge cases', () => {
  it('returns zero-result for empty items array', () => {
    const result = extractKeywordFrequency([]);
    expect(result.unigrams).toEqual([]);
    expect(result.bigrams).toEqual([]);
    expect(result.hashtags).toEqual([]);
    expect(result.totalTokens).toBe(0);
  });

  it('returns zero-result for null items', () => {
    const result = extractKeywordFrequency(null);
    expect(result.unigrams).toEqual([]);
    expect(result.totalTokens).toBe(0);
  });

  it('returns zero-result for undefined items', () => {
    const result = extractKeywordFrequency(undefined);
    expect(result.unigrams).toEqual([]);
    expect(result.totalTokens).toBe(0);
  });

  it('skips items with missing content', () => {
    const items = [{ id: 'x' }, { content: 'valid text' }];
    const result = extractKeywordFrequency(items, { lang: 'en' });
    expect(result.totalTokens).toBeGreaterThan(0);
    const terms = result.unigrams.map(u => u.term);
    expect(terms).toContain('valid');
  });

  it('skips items with non-string content', () => {
    const items = [{ content: 42 }, { content: 'valid text' }];
    const result = extractKeywordFrequency(items, { lang: 'en' });
    expect(result.totalTokens).toBeGreaterThan(0);
  });

  it('skips items with empty/whitespace content', () => {
    const items = [{ content: '' }, { content: '   ' }, { content: 'real' }];
    const result = extractKeywordFrequency(items, { lang: 'en' });
    expect(result.totalTokens).toBe(1);
  });

  it('clamps minLength to >= 1', () => {
    const items = [makeItem('a bb ccc')];
    const result = extractKeywordFrequency(items, { minLength: 0 });
    // minLength clamped to 1 — all tokens included
    expect(result.totalTokens).toBe(3);
  });

  it('clamps minLength negative to >= 1', () => {
    const items = [makeItem('a bb ccc')];
    const result = extractKeywordFrequency(items, { minLength: -5 });
    expect(result.totalTokens).toBe(3);
  });

  it('clamps topN to >= 0', () => {
    const items = [makeItem('hello world')];
    const result = extractKeywordFrequency(items, { topN: -3 });
    expect(result.unigrams).toEqual([]);
    expect(result.bigrams).toEqual([]);
  });

  it('topN=0 returns empty arrays', () => {
    const items = [makeItem('hello world')];
    const result = extractKeywordFrequency(items, { topN: 0 });
    expect(result.unigrams).toEqual([]);
    expect(result.bigrams).toEqual([]);
    expect(result.hashtags).toEqual([]);
  });

  it('topN limits results', () => {
    const items = [makeItem('a b c d e f g h i j k l')];
    const result = extractKeywordFrequency(items, { topN: 3 });
    expect(result.unigrams.length).toBeLessThanOrEqual(3);
  });

  it('does not throw on null item in array', () => {
    const items = [null, makeItem('hello'), undefined, 42];
    const result = extractKeywordFrequency(items);
    expect(result.totalTokens).toBe(1);
  });
});

// ============================================================================
// totalTokens
// ============================================================================

describe('extractKeywordFrequency — totalTokens', () => {
  it('counts only filtered tokens', () => {
    const items = [makeItem('the quick brown fox')];
    const result = extractKeywordFrequency(items, { lang: 'en' });
    // 'the' is a stopword → 3 tokens
    expect(result.totalTokens).toBe(3);
  });

  it('counts tokens across multiple items', () => {
    const items = [
      makeItem('hello world'),
      makeItem('foo bar baz'),
    ];
    const result = extractKeywordFrequency(items, { lang: 'en' });
    expect(result.totalTokens).toBe(5);
  });
});

// ============================================================================
// includeBuzzwords integration (AbstractCrawler)
// ============================================================================

describe('extractKeywordFrequency — includeBuzzwords integration', () => {
  it('injects summary.buzzwords when includeBuzzwords is true', async () => {
    const { AbstractCrawler } = await import('../../src/core/base-crawler.js');

    class TestCrawler extends AbstractCrawler {
      name = 'test-buzz';
    }

    const crawler = new TestCrawler({ includeBuzzwords: true });
    crawler.registerAction('scrape', async () => ({
      posts: [
        { content: 'hello world #test' },
        { content: 'hello again #test' },
      ],
      pageInfo: { hasNext: false },
    }), { description: 'Test scrape', requiresAuth: false });

    const result = await crawler.start({ action: 'scrape', args: {}, session: {} });
    expect(result.summary).toBeDefined();
    expect(result.summary.buzzwords).toBeDefined();
    expect(result.summary.buzzwords.unigrams).toBeInstanceOf(Array);
    expect(result.summary.buzzwords.hashtags).toBeInstanceOf(Array);
    const hello = result.summary.buzzwords.unigrams.find(u => u.term === 'hello');
    expect(hello).toBeDefined();
    expect(hello.count).toBe(2);
    const testTag = result.summary.buzzwords.hashtags.find(h => h.tag === 'test');
    expect(testTag).toBeDefined();
    expect(testTag.count).toBe(2);
  });

  it('does not inject summary.buzzwords when includeBuzzwords is false (default)', async () => {
    const { AbstractCrawler } = await import('../../src/core/base-crawler.js');

    class TestCrawler extends AbstractCrawler {
      name = 'test-nobuzz';
    }

    const crawler = new TestCrawler({});
    crawler.registerAction('scrape', async () => ({
      posts: [{ content: 'hello world' }],
    }), { description: 'Test scrape', requiresAuth: false });

    const result = await crawler.start({ action: 'scrape', args: {}, session: {} });
    expect(result.summary).toBeUndefined();
  });

  it('injects empty buzzwords result when crawl returns no text items', async () => {
    const { AbstractCrawler } = await import('../../src/core/base-crawler.js');

    class TestCrawler extends AbstractCrawler {
      name = 'test-empty';
    }

    const crawler = new TestCrawler({ includeBuzzwords: true });
    crawler.registerAction('scrape', async () => ({
      posts: [],
      pageInfo: { hasNext: false },
    }), { description: 'Empty scrape', requiresAuth: false });

    const result = await crawler.start({ action: 'scrape', args: {}, session: {} });
    expect(result.summary.buzzwords).toBeDefined();
    expect(result.summary.buzzwords.unigrams).toEqual([]);
    expect(result.summary.buzzwords.totalTokens).toBe(0);
  });

  it('preserves existing summary fields when adding buzzwords', async () => {
    const { AbstractCrawler } = await import('../../src/core/base-crawler.js');

    class TestCrawler extends AbstractCrawler {
      name = 'test-preserve';
    }

    const crawler = new TestCrawler({ includeBuzzwords: true });
    crawler.registerAction('scrape', async () => ({
      posts: [{ content: 'hello' }],
      summary: { existingField: 'preserved' },
    }), { description: 'Scrape with summary', requiresAuth: false });

    const result = await crawler.start({ action: 'scrape', args: {}, session: {} });
    expect(result.summary.existingField).toBe('preserved');
    expect(result.summary.buzzwords).toBeDefined();
  });

  it('caps at 500 items', async () => {
    const { AbstractCrawler } = await import('../../src/core/base-crawler.js');

    class TestCrawler extends AbstractCrawler {
      name = 'test-cap';
    }

    const items = Array.from({ length: 600 }, (_, i) => ({ content: `post ${i}` }));
    const crawler = new TestCrawler({ includeBuzzwords: true });
    crawler.registerAction('scrape', async () => ({
      posts: items,
    }), { description: 'Large scrape', requiresAuth: false });

    const result = await crawler.start({ action: 'scrape', args: {}, session: {} });
    // 500 items max, each with 2 tokens = 1000 totalTokens
    expect(result.summary.buzzwords.totalTokens).toBe(1000);
  });
});

describe('extractKeywordFrequency — hashtag URL/email exclusion', () => {
  it('excludes hashtags inside URLs', () => {
    const items = [makeItem('Visit https://example.com/page#section for details #realtag')];
    const result = extractKeywordFrequency(items);
    const tags = result.hashtags.map(h => h.tag);
    expect(tags).toContain('realtag');
    expect(tags).not.toContain('section');
  });

  it('excludes hashtags after dots (domain fragments)', () => {
    const items = [makeItem('Check example.com#fragment and #valid')];
    const result = extractKeywordFrequency(items);
    const tags = result.hashtags.map(h => h.tag);
    expect(tags).toContain('valid');
    expect(tags).not.toContain('fragment');
  });

  it('excludes hashtags in email addresses', () => {
    const items = [makeItem('Email user@domain#tag and #real')];
    const result = extractKeywordFrequency(items);
    const tags = result.hashtags.map(h => h.tag);
    expect(tags).toContain('real');
    expect(tags).not.toContain('tag');
  });
});
