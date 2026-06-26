// by nichxbt
import { describe, it, expect } from 'vitest';

/**
 * Pure-logic tests for tweetStream.js
 *
 * pollTweets() requires real Puppeteer — not testable without a live browser.
 * We test the two pure computations that drive its behaviour:
 *   1. Deduplication  — filter out tweets already in lastSeenIds
 *   2. seenIds cap    — slice to last 500 IDs to bound memory
 */

// ---------------------------------------------------------------------------
// Inline copy of tweetStream dedup + seenIds logic
// ---------------------------------------------------------------------------
function computeTweetDiff({ tweets, lastSeenIds }) {
  const lastSet = new Set(lastSeenIds);
  const newTweets = tweets.filter((t) => t.id && !lastSet.has(t.id));
  const allIds = [...new Set([...lastSeenIds, ...tweets.map((t) => t.id).filter(Boolean)])];
  const seenIds = allIds.slice(-500);
  return { tweets: newTweets, seenIds };
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------
describe('tweetStream deduplication', () => {
  it('returns only tweets not in lastSeenIds', () => {
    const tweets = [
      { id: '1', text: 'hello' },
      { id: '2', text: 'world' },
      { id: '3', text: 'new' },
    ];
    const { tweets: newTweets } = computeTweetDiff({ tweets, lastSeenIds: ['1', '2'] });
    expect(newTweets).toHaveLength(1);
    expect(newTweets[0].id).toBe('3');
  });

  it('returns all tweets when lastSeenIds is empty', () => {
    const tweets = [{ id: 'a' }, { id: 'b' }];
    const { tweets: newTweets } = computeTweetDiff({ tweets, lastSeenIds: [] });
    expect(newTweets).toHaveLength(2);
  });

  it('returns empty array when all tweets already seen', () => {
    const tweets = [{ id: '1' }, { id: '2' }];
    const { tweets: newTweets } = computeTweetDiff({ tweets, lastSeenIds: ['1', '2'] });
    expect(newTweets).toHaveLength(0);
  });

  it('skips tweets without an id field', () => {
    const tweets = [{ text: 'no id' }, { id: 'x', text: 'has id' }];
    const { tweets: newTweets } = computeTweetDiff({ tweets, lastSeenIds: [] });
    // tweet without id is filtered out in newTweets (id falsy)
    expect(newTweets).toHaveLength(1);
    expect(newTweets[0].id).toBe('x');
  });
});

// ---------------------------------------------------------------------------
// seenIds accumulation and 500-ID cap
// ---------------------------------------------------------------------------
describe('tweetStream seenIds', () => {
  it('merges lastSeenIds with new tweet IDs', () => {
    const tweets = [{ id: 'c' }, { id: 'd' }];
    const { seenIds } = computeTweetDiff({ tweets, lastSeenIds: ['a', 'b'] });
    expect(seenIds).toEqual(expect.arrayContaining(['a', 'b', 'c', 'd']));
    expect(seenIds).toHaveLength(4);
  });

  it('deduplicates IDs that appear in both lastSeenIds and new tweets', () => {
    const tweets = [{ id: 'a' }, { id: 'b' }];
    const { seenIds } = computeTweetDiff({ tweets, lastSeenIds: ['a'] });
    expect(seenIds.filter((id) => id === 'a')).toHaveLength(1);
  });

  it('caps seenIds at 500 (keeps the last 500)', () => {
    // Build 490 old IDs + 20 new tweets → total 510 unique, should be capped at 500
    const lastSeenIds = Array.from({ length: 490 }, (_, i) => `old_${i}`);
    const tweets = Array.from({ length: 20 }, (_, i) => ({ id: `new_${i}` }));
    const { seenIds } = computeTweetDiff({ tweets, lastSeenIds });
    expect(seenIds).toHaveLength(500);
    // The newest IDs (new_*) should be at the tail after slice(-500)
    const last20 = seenIds.slice(-20);
    last20.forEach((id, i) => expect(id).toBe(`new_${i}`));
  });

  it('does not exceed 500 IDs even when all tweets are new', () => {
    const lastSeenIds = Array.from({ length: 500 }, (_, i) => `seen_${i}`);
    const tweets = Array.from({ length: 30 }, (_, i) => ({ id: `fresh_${i}` }));
    const { seenIds } = computeTweetDiff({ tweets, lastSeenIds });
    expect(seenIds.length).toBeLessThanOrEqual(500);
  });
});
