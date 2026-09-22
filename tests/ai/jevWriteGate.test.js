// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// XActions — jevWriteGate Tests (Story 43.2)
// by nichxbt

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { writeGate, checkToxic } from '../../src/ai/jevWriteGate.js';
import { JevBrain } from '../../src/agents/jevBrain.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockJevSuccess(answers) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ answers, usage: { input_tokens: 100, output_tokens: 40 } }),
    text: async () => JSON.stringify({ answers }),
  };
}

function makeBrain() {
  return new JevBrain({ apiKey: 'test-jev-key' });
}

describe('jevWriteGate.writeGate', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns send for high-quality safe content', async () => {
    mockFetch.mockResolvedValueOnce(mockJevSuccess({
      virality: { type: 'score', score: 3, confidence: 0.9 },
      clarity: { type: 'score', score: 3, confidence: 0.9 },
      onBrand: { type: 'score', score: 2, confidence: 0.85 },
      toxic: { type: 'noul', noul: 0.05 },
    }));
    const result = await writeGate('Great insight on AI automation — this changes everything', { brain: makeBrain() });
    expect(result.verdict).toBe('send');
    expect(result.scores.virality).toBe(3);
    expect(result.toxic.noul).toBe(0.05);
    expect(result.degraded).toBe(false);
  });

  it('returns block for toxic content', async () => {
    mockFetch.mockResolvedValueOnce(mockJevSuccess({
      virality: { type: 'score', score: 2, confidence: 0.8 },
      clarity: { type: 'score', score: 2, confidence: 0.8 },
      onBrand: { type: 'score', score: 2, confidence: 0.8 },
      toxic: { type: 'noul', noul: 0.85 },
    }));
    const result = await writeGate('hateful harmful content', { brain: makeBrain() });
    expect(result.verdict).toBe('block');
    expect(result.toxic.noul).toBeGreaterThanOrEqual(0.5);
  });

  it('returns review for low-quality content', async () => {
    mockFetch.mockResolvedValueOnce(mockJevSuccess({
      virality: { type: 'score', score: 1, confidence: 0.8 },
      clarity: { type: 'score', score: 1, confidence: 0.8 },
      onBrand: { type: 'score', score: 1, confidence: 0.8 },
      toxic: { type: 'noul', noul: 0.1 },
    }));
    const result = await writeGate('lol ok whatever', { brain: makeBrain() });
    expect(result.verdict).toBe('review');
  });

  it('returns block for empty content (no Jev call)', async () => {
    const result = await writeGate('', { brain: makeBrain() });
    expect(result.verdict).toBe('block');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns review with null scores when degraded', async () => {
    const prevKey = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    const noKeyBrain = new JevBrain({ apiKey: '' });
    const result = await writeGate('some text', { brain: noKeyBrain });
    process.env.TYPESAFE_API_KEY = prevKey;
    expect(result.verdict).toBe('review');
    expect(result.scores).toBeNull();
    expect(result.degraded).toBe(true);
  });
});

describe('jevWriteGate.checkToxic', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('blocks when toxic noul >= threshold', async () => {
    mockFetch.mockResolvedValueOnce(mockJevSuccess({
      toxic: { type: 'noul', noul: 0.9 },
    }));
    const result = await checkToxic('hateful content', { brain: makeBrain() });
    expect(result.blocked).toBe(true);
    expect(result.noul).toBe(0.9);
  });

  it('passes when toxic noul < threshold', async () => {
    mockFetch.mockResolvedValueOnce(mockJevSuccess({
      toxic: { type: 'noul', noul: 0.1 },
    }));
    const result = await checkToxic('safe content', { brain: makeBrain() });
    expect(result.blocked).toBe(false);
  });

  it('blocks empty text (no Jev call)', async () => {
    const result = await checkToxic('', { brain: makeBrain() });
    expect(result.blocked).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns not-blocked when degraded (conservative)', async () => {
    const prevKey = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    const noKeyBrain = new JevBrain({ apiKey: '' });
    const result = await checkToxic('any text', { brain: noKeyBrain });
    process.env.TYPESAFE_API_KEY = prevKey;
    expect(result.blocked).toBe(false);
    expect(result.degraded).toBe(true);
  });
});
