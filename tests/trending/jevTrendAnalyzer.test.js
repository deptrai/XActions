// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// XActions — jevTrendAnalyzer Tests (Story 42.6)
// by nichxbt

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { analyzeTrend, analyzeTrends, clearTrendCache } from '../../src/trending/jevTrendAnalyzer.js';
import { JevBrain } from '../../src/agents/jevBrain.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockJevSuccess(answers) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ answers, usage: { input_tokens: 50, output_tokens: 20 } }),
    text: async () => JSON.stringify({ answers }),
  };
}

function makeBrain() {
  return new JevBrain({ apiKey: 'test-jev-key' });
}

describe('jevTrendAnalyzer.analyzeTrend', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    clearTrendCache();
  });

  it('classifies a tech trend correctly', async () => {
    mockFetch.mockResolvedValueOnce(mockJevSuccess({
      vertical: { type: 'choice', choice: 'tech_ai', confidence: 0.95 },
      brandSafe: { type: 'noul', noul: 0.05 },
      opportunity: { type: 'score', score: 3, confidence: 0.88 },
    }));
    const result = await analyzeTrend('OpenAI releases new agent framework', { brain: makeBrain() });
    expect(result).not.toBeNull();
    expect(result.vertical).toBe('tech_ai');
    expect(result.brandSafeNoul).toBe(0.05);
    expect(result.opportunityScore).toBe(3);
  });

  it('flags unsafe trends (tragic events)', async () => {
    mockFetch.mockResolvedValueOnce(mockJevSuccess({
      vertical: { type: 'choice', choice: 'other', confidence: 0.7 },
      brandSafe: { type: 'noul', noul: 0.92 },
      opportunity: { type: 'score', score: 0, confidence: 0.9 },
    }));
    const result = await analyzeTrend('Earthquake death toll rises', { brain: makeBrain() });
    expect(result).not.toBeNull();
    expect(result.brandSafeNoul).toBeGreaterThan(0.5);
    expect(result.opportunityScore).toBe(0);
  });

  it('returns null when Jev degraded', async () => {
    const prevKey = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    const noKeyBrain = new JevBrain({ apiKey: '' });
    const result = await analyzeTrend('some topic', { brain: noKeyBrain });
    process.env.TYPESAFE_API_KEY = prevKey;
    expect(result).toBeNull();
  });

  it('caches results — second call within TTL skips fetch', async () => {
    mockFetch.mockResolvedValueOnce(mockJevSuccess({
      vertical: { type: 'choice', choice: 'tech_ai', confidence: 0.9 },
      brandSafe: { type: 'noul', noul: 0.1 },
      opportunity: { type: 'score', score: 2, confidence: 0.8 },
    }));
    const brain = makeBrain();
    const r1 = await analyzeTrend('AI agents', { brain });
    const r2 = await analyzeTrend('AI agents', { brain });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(r2).toEqual(r1);
  });

  it('returns null for empty/invalid topic', async () => {
    expect(await analyzeTrend('', { brain: makeBrain() })).toBeNull();
    expect(await analyzeTrend(null, { brain: makeBrain() })).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('jevTrendAnalyzer.analyzeTrends', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    clearTrendCache();
  });

  it('filters: keeps safe+good-hook, drops unsafe, drops low-opportunity', async () => {
    mockFetch
      // AI trend — keep
      .mockResolvedValueOnce(mockJevSuccess({
        vertical: { type: 'choice', choice: 'tech_ai', confidence: 0.9 },
        brandSafe: { type: 'noul', noul: 0.05 },
        opportunity: { type: 'score', score: 3, confidence: 0.85 },
      }))
      // Earthquake — unsafe
      .mockResolvedValueOnce(mockJevSuccess({
        vertical: { type: 'choice', choice: 'other', confidence: 0.8 },
        brandSafe: { type: 'noul', noul: 0.9 },
        opportunity: { type: 'score', score: 0, confidence: 0.9 },
      }))
      // Monday motivation — low opportunity
      .mockResolvedValueOnce(mockJevSuccess({
        vertical: { type: 'choice', choice: 'culture_meme', confidence: 0.7 },
        brandSafe: { type: 'noul', noul: 0.1 },
        opportunity: { type: 'score', score: 1, confidence: 0.8 },
      }));

    const { filtered, analyses, degraded } = await analyzeTrends(
      ['AI agents shipped', 'Earthquake death toll', 'Monday motivation'],
      { brain: makeBrain() },
    );
    expect(degraded).toBe(false);
    expect(filtered).toEqual(['AI agents shipped']);
    expect(analyses.size).toBe(3);
    expect(analyses.get('Earthquake death toll').brandSafeNoul).toBeGreaterThan(0.5);
    expect(analyses.get('Monday motivation').opportunityScore).toBe(1);
  });

  it('degraded=true when every topic returns null', async () => {
    const prevKey = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    const noKeyBrain = new JevBrain({ apiKey: '' });
    const { filtered, degraded } = await analyzeTrends(['a', 'b'], { brain: noKeyBrain });
    process.env.TYPESAFE_API_KEY = prevKey;
    expect(degraded).toBe(true);
    expect(filtered).toEqual([]);
  });

  it('returns empty for empty input', async () => {
    const { filtered, degraded } = await analyzeTrends([], { brain: makeBrain() });
    expect(filtered).toEqual([]);
    expect(degraded).toBe(true); // 0 degraded / 0 topics → vacuously true
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
