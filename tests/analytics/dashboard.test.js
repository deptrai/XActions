// by nichxbt
import { describe, it, expect } from 'vitest';
import {
  parseSnapshotData,
  computeRatio,
  computeEngagementRate,
  tweetEngagementScore,
  rankTopTweets,
  intervalKey,
  aggregateByInterval,
} from '../../api/services/analyticsDashboard.js';

// ============================================================================
// parseSnapshotData
// ============================================================================

describe('parseSnapshotData', () => {
  it('parses a well-formed snapshot with profile counts', () => {
    const row = {
      createdAt: '2026-06-01T12:00:00.000Z',
      data: JSON.stringify({ profile: { followers: 1000, following: 500, tweets: 300 } }),
    };
    const point = parseSnapshotData(row);
    expect(point.date).toBe('2026-06-01T12:00:00.000Z');
    expect(point.followers).toBe(1000);
    expect(point.following).toBe(500);
    expect(point.tweets).toBe(300);
  });

  it('falls back to followerCount/followingCount when profile is absent', () => {
    const row = {
      createdAt: '2026-06-01T12:00:00.000Z',
      data: JSON.stringify({ followerCount: 42, followingCount: 7 }),
    };
    const point = parseSnapshotData(row);
    expect(point.followers).toBe(42);
    expect(point.following).toBe(7);
    expect(point.tweets).toBe(0);
  });

  it('returns zeros when data is null', () => {
    const row = { createdAt: '2026-06-01T12:00:00.000Z', data: null };
    const point = parseSnapshotData(row);
    expect(point.followers).toBe(0);
    expect(point.following).toBe(0);
    expect(point.tweets).toBe(0);
  });

  it('returns zeros when data is malformed JSON', () => {
    const row = { createdAt: '2026-06-01T12:00:00.000Z', data: '{not json' };
    const point = parseSnapshotData(row);
    expect(point.followers).toBe(0);
    expect(point.following).toBe(0);
    expect(point.tweets).toBe(0);
  });

  it('accepts a Date object for createdAt', () => {
    const row = { createdAt: new Date('2026-06-01T12:00:00.000Z'), data: null };
    expect(parseSnapshotData(row).date).toBe('2026-06-01T12:00:00.000Z');
  });

  it('coerces string numeric counts to numbers', () => {
    const row = {
      createdAt: '2026-06-01T12:00:00.000Z',
      data: JSON.stringify({ profile: { followers: '1234', following: '56', tweets: '78' } }),
    };
    const point = parseSnapshotData(row);
    expect(point.followers).toBe(1234);
    expect(point.following).toBe(56);
    expect(point.tweets).toBe(78);
  });
});

// ============================================================================
// computeRatio
// ============================================================================

describe('computeRatio', () => {
  it('computes following/followers rounded to 4 decimals', () => {
    expect(computeRatio(500, 1000)).toBe(0.5);
    expect(computeRatio(1, 3)).toBe(0.3333);
    expect(computeRatio(2, 3)).toBe(0.6667);
  });

  it('returns 0 when followers is 0 (no NaN/Infinity)', () => {
    expect(computeRatio(500, 0)).toBe(0);
  });

  it('returns 0 when followers is undefined/NaN', () => {
    expect(computeRatio(500, undefined)).toBe(0);
    expect(computeRatio(500, NaN)).toBe(0);
  });

  it('returns 0 when following is non-finite', () => {
    expect(computeRatio(Infinity, 100)).toBe(0);
    expect(computeRatio(NaN, 100)).toBe(0);
  });

  it('treats missing following as 0', () => {
    expect(computeRatio(undefined, 100)).toBe(0);
  });
});

// ============================================================================
// computeEngagementRate
// ============================================================================

describe('computeEngagementRate', () => {
  it('computes engagements/impressions rounded to 4 decimals', () => {
    expect(computeEngagementRate(50, 1000)).toBe(0.05);
    expect(computeEngagementRate(1, 3)).toBe(0.3333);
  });

  it('returns 0 when impressions is 0 (no NaN/Infinity)', () => {
    expect(computeEngagementRate(50, 0)).toBe(0);
  });

  it('returns 0 when impressions is undefined/NaN', () => {
    expect(computeEngagementRate(50, undefined)).toBe(0);
    expect(computeEngagementRate(50, NaN)).toBe(0);
  });

  it('returns 0 when engagements is non-finite', () => {
    expect(computeEngagementRate(Infinity, 100)).toBe(0);
    expect(computeEngagementRate(NaN, 100)).toBe(0);
  });
});

// ============================================================================
// tweetEngagementScore + rankTopTweets
// ============================================================================

describe('tweetEngagementScore', () => {
  it('sums likes + retweets + replies + quotes', () => {
    expect(tweetEngagementScore({ likes: 10, retweets: 5, replies: 3, quotes: 2 })).toBe(20);
  });

  it('treats missing fields as 0', () => {
    expect(tweetEngagementScore({})).toBe(0);
    expect(tweetEngagementScore({ likes: 10 })).toBe(10);
  });

  it('coerces string numerics', () => {
    expect(tweetEngagementScore({ likes: '10', retweets: '5' })).toBe(15);
  });
});

describe('rankTopTweets', () => {
  it('ranks by engagement score descending', () => {
    const tweets = [
      { tweetId: 'a', likes: 10, retweets: 0, replies: 0, quotes: 0 },
      { tweetId: 'b', likes: 50, retweets: 0, replies: 0, quotes: 0 },
      { tweetId: 'c', likes: 30, retweets: 0, replies: 0, quotes: 0 },
    ];
    const ranked = rankTopTweets(tweets, 3);
    expect(ranked.map((t) => t.tweetId)).toEqual(['b', 'c', 'a']);
    expect(ranked[0].engagementScore).toBe(50);
  });

  it('respects the limit', () => {
    const tweets = Array.from({ length: 15 }, (_, i) => ({ tweetId: String(i), likes: i }));
    const ranked = rankTopTweets(tweets, 5);
    expect(ranked).toHaveLength(5);
    expect(ranked[0].likes).toBe(14);
  });

  it('breaks ties by views descending', () => {
    const tweets = [
      { tweetId: 'a', likes: 10, views: 100 },
      { tweetId: 'b', likes: 10, views: 500 },
      { tweetId: 'c', likes: 10, views: 300 },
    ];
    const ranked = rankTopTweets(tweets, 3);
    expect(ranked.map((t) => t.tweetId)).toEqual(['b', 'c', 'a']);
  });

  it('breaks ties on equal views by tweetId ascending (determinism)', () => {
    const tweets = [
      { tweetId: 'z', likes: 10, views: 100 },
      { tweetId: 'a', likes: 10, views: 100 },
      { tweetId: 'm', likes: 10, views: 100 },
    ];
    const ranked = rankTopTweets(tweets, 3);
    expect(ranked.map((t) => t.tweetId)).toEqual(['a', 'm', 'z']);
  });

  it('returns empty array for non-array input', () => {
    expect(rankTopTweets(null, 5)).toEqual([]);
    expect(rankTopTweets(undefined, 5)).toEqual([]);
  });

  it('handles limit of 0', () => {
    expect(rankTopTweets([{ tweetId: 'a', likes: 1 }], 0)).toEqual([]);
  });

  it('clamps limit above array length', () => {
    const tweets = [{ tweetId: 'a', likes: 1 }];
    expect(rankTopTweets(tweets, 100)).toHaveLength(1);
  });
});

// ============================================================================
// intervalKey
// ============================================================================

describe('intervalKey', () => {
  it('day: returns YYYY-MM-DD', () => {
    expect(intervalKey('2026-06-15T10:00:00.000Z', 'day')).toBe('2026-06-15');
  });

  it('month: returns YYYY-MM', () => {
    expect(intervalKey('2026-06-15T10:00:00.000Z', 'month')).toBe('2026-06');
  });

  it('week: returns the ISO Monday date', () => {
    // 2026-06-17 is a Wednesday → Monday is 2026-06-15
    expect(intervalKey('2026-06-17T10:00:00.000Z', 'week')).toBe('2026-06-15');
  });

  it('week: rolls back from Sunday to previous Monday', () => {
    // 2026-06-21 is a Sunday → Monday is 2026-06-15
    expect(intervalKey('2026-06-21T10:00:00.000Z', 'week')).toBe('2026-06-15');
  });

  it('week: handles Monday itself', () => {
    expect(intervalKey('2026-06-15T10:00:00.000Z', 'week')).toBe('2026-06-15');
  });

  it('defaults to day for unknown interval', () => {
    expect(intervalKey('2026-06-15T10:00:00.000Z', 'unknown')).toBe('2026-06-15');
  });
});

// ============================================================================
// aggregateByInterval
// ============================================================================

describe('aggregateByInterval', () => {
  const rows = [
    { date: '2026-06-01T00:00:00.000Z', followers: 100, following: 50, tweets: 10 },
    { date: '2026-06-02T00:00:00.000Z', followers: 110, following: 51, tweets: 11 },
    { date: '2026-06-03T00:00:00.000Z', followers: 125, following: 52, tweets: 12 },
    { date: '2026-06-10T00:00:00.000Z', followers: 200, following: 55, tweets: 15 },
  ];

  it('daily aggregation: one bucket per day with deltas', () => {
    const out = aggregateByInterval(rows, 'day');
    expect(out).toHaveLength(4);
    expect(out[0]).toMatchObject({ bucket: '2026-06-01', followers: 100, followerDelta: 0 });
    expect(out[1]).toMatchObject({ bucket: '2026-06-02', followers: 110, followerDelta: 10 });
    expect(out[2]).toMatchObject({ bucket: '2026-06-03', followers: 125, followerDelta: 15 });
    expect(out[3]).toMatchObject({ bucket: '2026-06-10', followers: 200, followerDelta: 75 });
  });

  it('weekly aggregation: buckets by ISO Monday', () => {
    const out = aggregateByInterval(rows, 'week');
    // 2026-06-01 (Mon), 2026-06-02, 2026-06-03 → week 2026-06-01
    // 2026-06-10 → week 2026-06-08
    expect(out).toHaveLength(2);
    expect(out[0].bucket).toBe('2026-06-01');
    expect(out[0].followers).toBe(125); // latest in that week
    expect(out[0].followerDelta).toBe(0);
    expect(out[1].bucket).toBe('2026-06-08');
    expect(out[1].followers).toBe(200);
    expect(out[1].followerDelta).toBe(75); // 200 - 125
  });

  it('monthly aggregation: buckets by YYYY-MM', () => {
    const out = aggregateByInterval(rows, 'month');
    expect(out).toHaveLength(1);
    expect(out[0].bucket).toBe('2026-06');
    expect(out[0].followers).toBe(200); // latest in month
    expect(out[0].followerDelta).toBe(0); // first bucket
  });

  it('keeps the latest snapshot per bucket when input is unordered', () => {
    const unordered = [
      { date: '2026-06-02T12:00:00.000Z', followers: 115, following: 51, tweets: 11 },
      { date: '2026-06-02T00:00:00.000Z', followers: 110, following: 51, tweets: 11 },
      { date: '2026-06-02T18:00:00.000Z', followers: 120, following: 51, tweets: 11 },
    ];
    const out = aggregateByInterval(unordered, 'day');
    expect(out).toHaveLength(1);
    expect(out[0].followers).toBe(120);
  });

  it('returns empty array for non-array input', () => {
    expect(aggregateByInterval(null, 'day')).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    expect(aggregateByInterval([], 'day')).toEqual([]);
  });

  it('preserves following and tweets fields in output', () => {
    const out = aggregateByInterval(rows, 'day');
    expect(out[0].following).toBe(50);
    expect(out[0].tweets).toBe(10);
  });
});
