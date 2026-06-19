// by nichxbt
import { describe, it, expect } from 'vitest';
import { alignTweetsWithPrices, computeCorrelationStats } from '../../src/analytics/priceCorrelation.js';

// Helper: build a sorted price series
function makePrices(startTs, count, startPrice, step = 0) {
  return Array.from({ length: count }, (_, i) => ({
    ts: startTs + i * 3600_000, // 1 hour apart
    price: startPrice + i * step,
  }));
}

// Helper: build tweet objects
function makeTweets(timestamps) {
  return timestamps.map((ts, i) => ({
    timestamp: ts,
    text: `tweet ${i}`,
    url: `https://x.com/test/status/${i}`,
  }));
}

describe('alignTweetsWithPrices', () => {
  const BASE_TS = 1_700_000_000_000; // fixed reference ms timestamp

  it('returns same number of items as input tweets', () => {
    const prices = makePrices(BASE_TS, 48, 100);
    const tweets = makeTweets([BASE_TS, BASE_TS + 3600_000, BASE_TS + 7200_000]);
    const result = alignTweetsWithPrices(tweets, prices);
    expect(result).toHaveLength(3);
  });

  it('attaches priceAtTweet for each tweet when price data exists', () => {
    const prices = makePrices(BASE_TS, 48, 100);
    const tweets = makeTweets([BASE_TS]);
    const result = alignTweetsWithPrices(tweets, prices);
    expect(result[0].priceAtTweet).toBe(100);
  });

  it('sets priceAtTweet to null when price array is empty', () => {
    const tweets = makeTweets([BASE_TS]);
    const result = alignTweetsWithPrices(tweets, []);
    expect(result[0].priceAtTweet).toBeNull();
    expect(result[0].impact).toEqual({});
  });

  it('computes 1h and 24h impact windows by default', () => {
    // Rising price: +1 per hour
    const prices = makePrices(BASE_TS, 72, 100, 1);
    const tweets = makeTweets([BASE_TS]);
    const result = alignTweetsWithPrices(tweets, prices, [1, 24]);
    expect(result[0].impact).toHaveProperty('1h');
    expect(result[0].impact).toHaveProperty('24h');
  });

  it('impact change is positive when price rises after tweet', () => {
    // Price rises: 100 → 200 over 48 hours (+1/hr)
    const prices = makePrices(BASE_TS, 72, 100, 1);
    const tweets = makeTweets([BASE_TS]);
    const result = alignTweetsWithPrices(tweets, prices, [24]);
    const change = result[0].impact['24h']?.change;
    expect(change).toBeGreaterThan(0);
  });

  it('impact change is negative when price falls after tweet', () => {
    // Price falls: 200 → 100 over 48 hours (-1/hr)
    const prices = makePrices(BASE_TS, 72, 200, -1);
    const tweets = makeTweets([BASE_TS]);
    const result = alignTweetsWithPrices(tweets, prices, [24]);
    const change = result[0].impact['24h']?.change;
    expect(change).toBeLessThan(0);
  });

  it('preserves original tweet fields in output', () => {
    const prices = makePrices(BASE_TS, 48, 100);
    const tweets = [{ timestamp: BASE_TS, text: 'gm frens', url: 'https://x.com/test/1' }];
    const result = alignTweetsWithPrices(tweets, prices);
    expect(result[0].text).toBe('gm frens');
    expect(result[0].url).toBe('https://x.com/test/1');
  });

  it('handles custom windows array', () => {
    const prices = makePrices(BASE_TS, 120, 50, 0.5);
    const tweets = makeTweets([BASE_TS]);
    const result = alignTweetsWithPrices(tweets, prices, [2, 6, 12]);
    expect(result[0].impact).toHaveProperty('2h');
    expect(result[0].impact).toHaveProperty('6h');
    expect(result[0].impact).toHaveProperty('12h');
  });

  it('does not include window if future price point is too far away', () => {
    // Only 1 price point, so future windows won't find a close match
    const prices = [{ ts: BASE_TS, price: 100 }];
    const tweets = makeTweets([BASE_TS]);
    const result = alignTweetsWithPrices(tweets, prices, [24]);
    // 24h future has no close price point
    expect(result[0].impact['24h']).toBeUndefined();
  });
});

describe('computeCorrelationStats', () => {
  const BASE_TS = 1_700_000_000_000;

  function makeAligned(overrides = []) {
    // Build aligned tweet objects with 24h impact data
    return overrides.map((change24h, i) => ({
      timestamp: BASE_TS + i * 3600_000,
      text: `tweet ${i}`,
      priceAtTweet: 100,
      impact: {
        '24h': { price: 100 + change24h, change: change24h },
        '1h': { price: 101, change: 1 },
      },
    }));
  }

  it('returns null when no tweets have 24h impact', () => {
    const aligned = [{ timestamp: BASE_TS, text: 'hi', priceAtTweet: 100, impact: {} }];
    expect(computeCorrelationStats(aligned)).toBeNull();
  });

  it('computes correct winRate when all changes are positive', () => {
    const aligned = makeAligned([5, 10, 15, 20]);
    const stats = computeCorrelationStats(aligned);
    expect(stats.winRate).toBe(100);
  });

  it('computes correct winRate for mixed changes', () => {
    const aligned = makeAligned([10, -5, 20, -3]);
    const stats = computeCorrelationStats(aligned);
    expect(stats.winRate).toBe(50);
  });

  it('computes avgChange24h correctly', () => {
    const aligned = makeAligned([10, 20, 30]);
    const stats = computeCorrelationStats(aligned);
    expect(stats.avgChange24h).toBe(20);
  });

  it('computes medianChange24h correctly for odd count', () => {
    const aligned = makeAligned([10, 30, 20]);
    const stats = computeCorrelationStats(aligned);
    expect(stats.medianChange24h).toBe(20);
  });

  it('counts bigMoves (changes >= 15%)', () => {
    const aligned = makeAligned([5, 20, -20, 3]);
    const stats = computeCorrelationStats(aligned);
    expect(stats.bigMoves).toBe(2); // 20 and -20
  });

  it('identifies bestTweet and worstTweet', () => {
    const aligned = makeAligned([5, 50, -30]);
    const stats = computeCorrelationStats(aligned);
    expect(stats.bestTweet.change24h).toBe(50);
    expect(stats.worstTweet.change24h).toBe(-30);
  });

  it('returns totalTweets and tweetsWithPriceData counts', () => {
    const aligned = [
      ...makeAligned([10, -5]),
      { timestamp: BASE_TS + 9999, text: 'no data', priceAtTweet: null, impact: {} },
    ];
    const stats = computeCorrelationStats(aligned);
    expect(stats.totalTweets).toBe(3);
    expect(stats.tweetsWithPriceData).toBe(2);
  });

  it('detects silence gaps >= 48h', () => {
    // Two tweets 72h apart
    const t1 = BASE_TS;
    const t2 = BASE_TS + 72 * 3600_000;
    const aligned = [
      { timestamp: t1, text: 'first', priceAtTweet: 100, impact: { '24h': { price: 105, change: 5 } } },
      { timestamp: t2, text: 'second', priceAtTweet: 110, impact: { '24h': { price: 115, change: 4.5 } } },
    ];
    const stats = computeCorrelationStats(aligned);
    expect(stats.silences).toHaveLength(1);
    expect(stats.silences[0].gapHours).toBe(72);
  });

  it('returns no silences when all tweets are within 48h of each other', () => {
    const aligned = makeAligned([5, 10, 15]);
    const stats = computeCorrelationStats(aligned);
    expect(stats.silences).toHaveLength(0);
  });
});
