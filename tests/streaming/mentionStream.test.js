// by nichxbt
import { describe, it, expect } from 'vitest';

/**
 * Pure-logic tests for mentionStream.js
 *
 * pollMentions() requires real Puppeteer — not testable without a live browser.
 * We test the two pure computations that drive its behaviour:
 *   1. Deduplication  — filter out mentions already in lastSeenIds
 *   2. seenIds cap    — slice to last 500 IDs to bound memory
 *
 * Logic is identical to tweetStream except the result key is `mentions`.
 */

// ---------------------------------------------------------------------------
// Inline copy of mentionStream dedup + seenIds logic
// ---------------------------------------------------------------------------
function computeMentionDiff({ tweets, lastSeenIds }) {
  const lastSet = new Set(lastSeenIds);
  const newMentions = tweets.filter((t) => t.id && !lastSet.has(t.id));
  const allIds = [...new Set([...lastSeenIds, ...tweets.map((t) => t.id).filter(Boolean)])];
  const seenIds = allIds.slice(-500);
  return { mentions: newMentions, seenIds };
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------
describe('mentionStream deduplication', () => {
  it('returns only mentions not in lastSeenIds', () => {
    const tweets = [
      { id: '10', text: '@user hello' },
      { id: '11', text: '@user hi' },
      { id: '12', text: '@user new' },
    ];
    const { mentions } = computeMentionDiff({ tweets, lastSeenIds: ['10', '11'] });
    expect(mentions).toHaveLength(1);
    expect(mentions[0].id).toBe('12');
  });

  it('returns all mentions when lastSeenIds is empty', () => {
    const tweets = [{ id: 'a' }, { id: 'b' }];
    const { mentions } = computeMentionDiff({ tweets, lastSeenIds: [] });
    expect(mentions).toHaveLength(2);
  });

  it('returns empty array when all mentions already seen', () => {
    const tweets = [{ id: '1' }, { id: '2' }];
    const { mentions } = computeMentionDiff({ tweets, lastSeenIds: ['1', '2'] });
    expect(mentions).toHaveLength(0);
  });

  it('excludes tweets without an id from new mentions', () => {
    const tweets = [{ text: 'no id mention' }, { id: 'z', text: '@user' }];
    const { mentions } = computeMentionDiff({ tweets, lastSeenIds: [] });
    expect(mentions).toHaveLength(1);
    expect(mentions[0].id).toBe('z');
  });
});

// ---------------------------------------------------------------------------
// seenIds accumulation and 500-ID cap
// ---------------------------------------------------------------------------
describe('mentionStream seenIds', () => {
  it('merges lastSeenIds with new mention IDs', () => {
    const tweets = [{ id: 'c' }, { id: 'd' }];
    const { seenIds } = computeMentionDiff({ tweets, lastSeenIds: ['a', 'b'] });
    expect(seenIds).toEqual(expect.arrayContaining(['a', 'b', 'c', 'd']));
    expect(seenIds).toHaveLength(4);
  });

  it('deduplicates IDs that appear in both lists', () => {
    const tweets = [{ id: 'a' }, { id: 'b' }];
    const { seenIds } = computeMentionDiff({ tweets, lastSeenIds: ['a'] });
    expect(seenIds.filter((id) => id === 'a')).toHaveLength(1);
  });

  it('caps seenIds at 500', () => {
    const lastSeenIds = Array.from({ length: 490 }, (_, i) => `old_${i}`);
    const tweets = Array.from({ length: 20 }, (_, i) => ({ id: `new_${i}` }));
    const { seenIds } = computeMentionDiff({ tweets, lastSeenIds });
    expect(seenIds).toHaveLength(500);
    const last20 = seenIds.slice(-20);
    last20.forEach((id, i) => expect(id).toBe(`new_${i}`));
  });

  it('never exceeds 500 IDs regardless of input size', () => {
    const lastSeenIds = Array.from({ length: 500 }, (_, i) => `seen_${i}`);
    const tweets = Array.from({ length: 30 }, (_, i) => ({ id: `fresh_${i}` }));
    const { seenIds } = computeMentionDiff({ tweets, lastSeenIds });
    expect(seenIds.length).toBeLessThanOrEqual(500);
  });
});
