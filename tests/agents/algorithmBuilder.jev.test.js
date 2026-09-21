// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// XActions — algorithmBuilder jevFilter Tests (Story 42.2)
// by nichxbt

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { jevFilter } from '../../src/algorithmBuilder.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockJevSuccess(answers) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ answers, usage: { input_tokens: 10, output_tokens: 5 } }),
    text: async () => JSON.stringify({ answers }),
  };
}

describe('algorithmBuilder.jevFilter', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    process.env.TYPESAFE_API_KEY = 'test-jev-key';
  });

  it('returns true for a relevant, non-spam tweet', async () => {
    mockFetch.mockResolvedValueOnce(mockJevSuccess({
      relevance: { type: 'score', score: 3, confidence: 0.9 },
      isSpam: { type: 'noul', noul: 0.1 },
    }));
    const result = await jevFilter('great AI automation insight', ['AI', 'automation']);
    expect(result).toBe(true);
  });

  it('sends the shared isSpam literal in the Jev request (parity contract)', async () => {
    mockFetch.mockResolvedValueOnce(mockJevSuccess({
      relevance: { type: 'score', score: 3, confidence: 0.9 },
      isSpam: { type: 'noul', noul: 0.1 },
    }));
    await jevFilter('relevant AI automation tweet', ['AI']);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.questions.isSpam.instructions)
      .toBe('This post is spam, bait, scam, or airdrop-farming — not mere self-promotion');
  });

  it('returns false when Jev flags spam', async () => {
    mockFetch.mockResolvedValueOnce(mockJevSuccess({
      relevance: { type: 'score', score: 3, confidence: 0.9 },
      isSpam: { type: 'noul', noul: 0.8 },
    }));
    const result = await jevFilter('buy followers now cheap', ['AI']);
    expect(result).toBe(false);
  });

  it('returns false when relevance confidence is below 0.7', async () => {
    mockFetch.mockResolvedValueOnce(mockJevSuccess({
      relevance: { type: 'score', score: 1, confidence: 0.5 },
      isSpam: { type: 'noul', noul: 0.2 },
    }));
    const result = await jevFilter('random off-topic post', ['AI']);
    expect(result).toBe(false);
  });

  it('returns true when Jev is unreachable (degraded / never block)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'));
    const result = await jevFilter('any tweet text', ['AI']);
    expect(result).toBe(true);
  });

  it('returns true when text is empty (nothing to filter)', async () => {
    const result = await jevFilter('', ['AI']);
    expect(result).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
