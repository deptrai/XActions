// by nichxbt
import { describe, it, expect } from 'vitest';
import { analyzeSentiment, analyzeBatch, aggregateResults } from '../../src/analytics/sentiment.js';

describe('analyzeSentiment (rules mode)', () => {
  it('returns neutral for empty string', async () => {
    const result = await analyzeSentiment('');
    expect(result.score).toBe(0);
    expect(result.label).toBe('neutral');
    expect(result.confidence).toBe(0);
  });

  it('returns neutral for whitespace-only string', async () => {
    const result = await analyzeSentiment('   ');
    expect(result.score).toBe(0);
    expect(result.label).toBe('neutral');
  });

  it('returns neutral for null input', async () => {
    const result = await analyzeSentiment(null);
    expect(result.score).toBe(0);
    expect(result.label).toBe('neutral');
  });

  it('detects positive sentiment from lexicon words', async () => {
    const result = await analyzeSentiment('This is amazing and fantastic!');
    expect(result.label).toBe('positive');
    expect(result.score).toBeGreaterThan(0.05);
  });

  it('detects negative sentiment from lexicon words', async () => {
    const result = await analyzeSentiment('This is terrible and awful');
    expect(result.label).toBe('negative');
    expect(result.score).toBeLessThan(-0.05);
  });

  it('handles negation — "not good" should not be positive', async () => {
    const positive = await analyzeSentiment('good');
    const negated = await analyzeSentiment('not good');
    expect(positive.score).toBeGreaterThan(0);
    expect(negated.score).toBeLessThan(positive.score);
  });

  it('handles intensifiers — "extremely bad" should score lower than "bad"', async () => {
    const base = await analyzeSentiment('bad');
    const intensified = await analyzeSentiment('extremely bad');
    expect(intensified.score).toBeLessThan(base.score);
  });

  it('scores positive emojis correctly', async () => {
    const result = await analyzeSentiment('🚀🔥💎');
    expect(result.label).toBe('positive');
    expect(result.score).toBeGreaterThan(0.05);
  });

  it('scores negative emojis correctly', async () => {
    const result = await analyzeSentiment('😡🤬');
    expect(result.label).toBe('negative');
    expect(result.score).toBeLessThan(-0.05);
  });

  it('returns score in [-1, 1] range', async () => {
    const texts = [
      'absolutely incredible amazing wonderful perfect brilliant outstanding superb',
      'horrible disgusting disastrous catastrophic abysmal atrocious dreadful',
      'ok fine alright',
    ];
    for (const text of texts) {
      const result = await analyzeSentiment(text);
      expect(result.score).toBeGreaterThanOrEqual(-1);
      expect(result.score).toBeLessThanOrEqual(1);
    }
  });

  it('returns label matching score thresholds', async () => {
    const cases = [
      { text: 'great product', expectedLabel: 'positive' },
      { text: 'worst experience ever', expectedLabel: 'negative' },
      { text: 'the meeting is at three pm tomorrow', expectedLabel: 'neutral' },
    ];
    for (const { text, expectedLabel } of cases) {
      const result = await analyzeSentiment(text);
      expect(result.label).toBe(expectedLabel);
    }
  });

  it('includes matched keywords in result', async () => {
    const result = await analyzeSentiment('amazing product love it');
    expect(result.keywords).toBeInstanceOf(Array);
    expect(result.keywords.length).toBeGreaterThan(0);
    expect(result.keywords.some(k => ['amazing', 'love'].includes(k))).toBe(true);
  });

  it('returns confidence between 0 and 1', async () => {
    const result = await analyzeSentiment('good great excellent');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});

describe('analyzeBatch', () => {
  it('processes array of texts and preserves original text (truncated to 280)', async () => {
    const texts = ['great product', 'terrible service'];
    const results = await analyzeBatch(texts);
    expect(results).toHaveLength(2);
    expect(results[0]).toHaveProperty('text');
    expect(results[0]).toHaveProperty('score');
    expect(results[0]).toHaveProperty('label');
    expect(results[1].label).toBe('negative');
  });

  it('returns empty array for empty input', async () => {
    const results = await analyzeBatch([]);
    expect(results).toEqual([]);
  });

  it('truncates text to 280 chars in result', async () => {
    const longText = 'good '.repeat(100); // 500 chars
    const results = await analyzeBatch([longText]);
    expect(results[0].text.length).toBeLessThanOrEqual(280);
  });

  it('handles batch of size 1 consistently with analyzeSentiment', async () => {
    const text = 'amazing work';
    const single = await analyzeSentiment(text);
    const batch = await analyzeBatch([text]);
    expect(batch[0].score).toBe(single.score);
    expect(batch[0].label).toBe(single.label);
  });
});

describe('aggregateResults', () => {
  it('returns zeros/stable for empty input', () => {
    const result = aggregateResults([]);
    expect(result.average).toBe(0);
    expect(result.median).toBe(0);
    expect(result.distribution).toEqual({ positive: 0, neutral: 0, negative: 0 });
    expect(result.trend).toBe('stable');
  });

  it('returns zeros/stable for null input', () => {
    const result = aggregateResults(null);
    expect(result.average).toBe(0);
    expect(result.trend).toBe('stable');
  });

  it('computes correct average', () => {
    const results = [
      { score: 0.5, label: 'positive' },
      { score: -0.5, label: 'negative' },
      { score: 0.0, label: 'neutral' },
    ];
    const agg = aggregateResults(results);
    expect(agg.average).toBe(0);
  });

  it('computes correct median for odd-length array', () => {
    const results = [
      { score: 0.1, label: 'positive' },
      { score: 0.9, label: 'positive' },
      { score: 0.5, label: 'positive' },
    ];
    const agg = aggregateResults(results);
    expect(agg.median).toBe(0.5);
  });

  it('computes correct median for even-length array', () => {
    const results = [
      { score: 0.2, label: 'positive' },
      { score: 0.4, label: 'positive' },
      { score: 0.6, label: 'positive' },
      { score: 0.8, label: 'positive' },
    ];
    const agg = aggregateResults(results);
    expect(agg.median).toBeCloseTo(0.5, 5);
  });

  it('counts distribution correctly', () => {
    const results = [
      { score: 0.5, label: 'positive' },
      { score: 0.6, label: 'positive' },
      { score: 0.0, label: 'neutral' },
      { score: -0.5, label: 'negative' },
    ];
    const agg = aggregateResults(results);
    expect(agg.distribution.positive).toBe(2);
    expect(agg.distribution.neutral).toBe(1);
    expect(agg.distribution.negative).toBe(1);
  });

  it('detects improving trend when second half is more positive', () => {
    const results = [
      { score: -0.5, label: 'negative' },
      { score: -0.4, label: 'negative' },
      { score: 0.4, label: 'positive' },
      { score: 0.5, label: 'positive' },
    ];
    const agg = aggregateResults(results);
    expect(agg.trend).toBe('improving');
  });

  it('detects declining trend when second half is more negative', () => {
    const results = [
      { score: 0.5, label: 'positive' },
      { score: 0.4, label: 'positive' },
      { score: -0.4, label: 'negative' },
      { score: -0.5, label: 'negative' },
    ];
    const agg = aggregateResults(results);
    expect(agg.trend).toBe('declining');
  });

  it('returns stable trend for uniform scores', () => {
    const results = Array.from({ length: 6 }, () => ({ score: 0.2, label: 'positive' }));
    const agg = aggregateResults(results);
    expect(agg.trend).toBe('stable');
  });

  it('rounds average and median to 3 decimal places', () => {
    const results = [
      { score: 0.333, label: 'positive' },
      { score: 0.666, label: 'positive' },
    ];
    const agg = aggregateResults(results);
    // Should be rounded to 3dp
    expect(String(agg.average)).toMatch(/^\d+\.\d{1,3}$/);
  });
});
