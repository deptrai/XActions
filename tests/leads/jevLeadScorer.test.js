// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// XActions — jevLeadScorer Tests (Story 42.7)
// by nichxbt

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { scoreProfile, scoreProfiles, DEFAULT_ICP } from '../../src/leads/jevLeadScorer.js';
import { JevBrain } from '../../src/agents/jevBrain.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockJevSuccess(answers) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ answers, usage: { input_tokens: 80, output_tokens: 30 } }),
    text: async () => JSON.stringify({ answers }),
  };
}

function makeBrain() {
  return new JevBrain({ apiKey: 'test-jev-key' });
}

describe('jevLeadScorer.scoreProfile', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('identifies a decision-maker lead', async () => {
    mockFetch.mockResolvedValueOnce(mockJevSuccess({
      buyerIntent: { type: 'choice', choice: 'decision_maker', confidence: 0.92 },
      leadScore: { type: 'score', score: 3, confidence: 0.88 },
    }));
    const result = await scoreProfile(
      { username: 'cto_startup', bio: 'CTO building automation tools', recentTweets: ['shipping our API'] },
      'AI dev tools',
      { brain: makeBrain() },
    );
    expect(result).not.toBeNull();
    expect(result.username).toBe('cto_startup');
    expect(result.buyerIntent).toBe('decision_maker');
    expect(result.leadScore).toBe(3);
    expect(result.intentConfidence).toBe(0.92);
  });

  it('identifies a non-lead', async () => {
    mockFetch.mockResolvedValueOnce(mockJevSuccess({
      buyerIntent: { type: 'choice', choice: 'not_a_lead', confidence: 0.95 },
      leadScore: { type: 'score', score: 0, confidence: 0.9 },
    }));
    const result = await scoreProfile(
      { username: 'sports_fan', bio: 'NFL memes' },
      'AI dev tools',
      { brain: makeBrain() },
    );
    expect(result.buyerIntent).toBe('not_a_lead');
    expect(result.leadScore).toBe(0);
  });

  it('returns null when Jev degraded', async () => {
    const prevKey = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    const noKeyBrain = new JevBrain({ apiKey: '' });
    const result = await scoreProfile({ username: 'x' }, 'icp', { brain: noKeyBrain });
    process.env.TYPESAFE_API_KEY = prevKey;
    expect(result).toBeNull();
  });

  it('handles missing bio gracefully', async () => {
    mockFetch.mockResolvedValueOnce(mockJevSuccess({
      buyerIntent: { type: 'choice', choice: 'not_a_lead', confidence: 0.7 },
      leadScore: { type: 'score', score: 1, confidence: 0.6 },
    }));
    const result = await scoreProfile({ username: 'empty' }, 'icp', { brain: makeBrain() });
    expect(result).not.toBeNull();
    expect(result.username).toBe('empty');
  });
});

describe('jevLeadScorer.scoreProfiles', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('filters qualified vs non-qualified leads', async () => {
    mockFetch
      .mockResolvedValueOnce(mockJevSuccess({
        buyerIntent: { type: 'choice', choice: 'decision_maker', confidence: 0.9 },
        leadScore: { type: 'score', score: 3, confidence: 0.85 },
      }))
      .mockResolvedValueOnce(mockJevSuccess({
        buyerIntent: { type: 'choice', choice: 'not_a_lead', confidence: 0.9 },
        leadScore: { type: 'score', score: 0, confidence: 0.9 },
      }));

    const { qualified, all, stats } = await scoreProfiles(
      [
        { username: 'good_lead', bio: 'CTO' },
        { username: 'not_lead', bio: 'memes' },
      ],
      'AI tools',
      { brain: makeBrain() },
    );

    expect(qualified).toHaveLength(1);
    expect(qualified[0].username).toBe('good_lead');
    expect(all).toHaveLength(2);
    expect(stats.total).toBe(2);
    expect(stats.qualified).toBe(1);
    expect(stats.degraded).toBe(false);
  });

  it('degraded=true when all profiles degrade', async () => {
    const prevKey = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    const noKeyBrain = new JevBrain({ apiKey: '' });
    const { qualified, stats } = await scoreProfiles([{ username: 'a' }], 'icp', { brain: noKeyBrain });
    process.env.TYPESAFE_API_KEY = prevKey;
    expect(qualified).toEqual([]);
    expect(stats.degraded).toBe(true);
  });

  it('handles empty profiles list', async () => {
    const { qualified, stats } = await scoreProfiles([], 'icp', { brain: makeBrain() });
    expect(qualified).toEqual([]);
    expect(stats.total).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('uses DEFAULT_ICP when icp not provided', async () => {
    mockFetch.mockResolvedValueOnce(mockJevSuccess({
      buyerIntent: { type: 'choice', choice: 'problem_aware', confidence: 0.7 },
      leadScore: { type: 'score', score: 2, confidence: 0.7 },
    }));
    const { qualified } = await scoreProfiles(
      [{ username: 'test', bio: 'founder struggling with manual engagement' }],
      undefined,
      { brain: makeBrain() },
    );
    expect(qualified).toHaveLength(1);
    // Verify the request body included DEFAULT_ICP text
    const reqBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(reqBody.questions.buyerIntent.instructions).toContain(DEFAULT_ICP.slice(0, 50));
  });
});
