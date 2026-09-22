// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// XActions — Workflow Jev Condition Tests (Story 43.1)
// by nichxbt

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { evaluateConditionAsync } from '../../src/workflows/conditions.js';
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

describe('evaluateConditionAsync — jev condition type', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    process.env.TYPESAFE_API_KEY = 'test-jev-key';
  });

  it('noul condition passes when answer.noul >= threshold', async () => {
    mockFetch.mockResolvedValueOnce(mockJevSuccess({
      answer: { type: 'noul', noul: 0.8 },
    }));
    const result = await evaluateConditionAsync(
      { jev: { question: 'Is this spam?', state: 'spam text', type: 'noul', threshold: 0.5 } },
      {},
    );
    expect(result.passed).toBe(true);
    expect(result.details).toContain('0.80');
  });

  it('noul condition fails when answer.noul < threshold', async () => {
    mockFetch.mockResolvedValueOnce(mockJevSuccess({
      answer: { type: 'noul', noul: 0.3 },
    }));
    const result = await evaluateConditionAsync(
      { jev: { question: 'Is this spam?', state: 'legit text', type: 'noul', threshold: 0.5 } },
      {},
    );
    expect(result.passed).toBe(false);
  });

  it('choice condition passes when choice ∈ choices', async () => {
    mockFetch.mockResolvedValueOnce(mockJevSuccess({
      answer: { type: 'choice', choice: 'reply', confidence: 0.9 },
    }));
    const result = await evaluateConditionAsync(
      { jev: { question: 'Best action?', state: 'tweet', type: 'choice', choices: ['reply', 'like'] } },
      {},
    );
    expect(result.passed).toBe(true);
  });

  it('choice condition fails when choice ∉ choices', async () => {
    mockFetch.mockResolvedValueOnce(mockJevSuccess({
      answer: { type: 'choice', choice: 'ignore', confidence: 0.9 },
    }));
    const result = await evaluateConditionAsync(
      { jev: { question: 'Best action?', state: 'spam tweet', type: 'choice', choices: ['reply', 'like'] } },
      {},
    );
    expect(result.passed).toBe(false);
  });

  it('choice condition passes for any non-ignore when choices absent', async () => {
    mockFetch.mockResolvedValueOnce(mockJevSuccess({
      answer: { type: 'choice', choice: 'like', confidence: 0.8 },
    }));
    const result = await evaluateConditionAsync(
      { jev: { question: 'Worth acting on?', state: 'tweet', type: 'choice' } },
      {},
    );
    expect(result.passed).toBe(true);
  });

  it('score condition passes when answer.score >= threshold', async () => {
    mockFetch.mockResolvedValueOnce(mockJevSuccess({
      answer: { type: 'score', score: 3, confidence: 0.9 },
    }));
    const result = await evaluateConditionAsync(
      { jev: { question: 'Relevant to niche?', state: 'AI tweet', type: 'score', threshold: 2 } },
      {},
    );
    expect(result.passed).toBe(true);
  });

  it('score condition fails when answer.score < threshold', async () => {
    mockFetch.mockResolvedValueOnce(mockJevSuccess({
      answer: { type: 'score', score: 1, confidence: 0.8 },
    }));
    const result = await evaluateConditionAsync(
      { jev: { question: 'Relevant to niche?', state: 'off-topic', type: 'score', threshold: 2 } },
      {},
    );
    expect(result.passed).toBe(false);
  });

  it('degraded Jev → passed: false (conservative)', async () => {
    const prevKey = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    // Force a fresh JevBrain singleton inside conditions.js by clearing require cache
    // (JevBrain singleton is module-level — need to test degraded via no-key path)
    // Since singleton may already exist with key, test via error mock instead:
    process.env.TYPESAFE_API_KEY = prevKey;
    mockFetch.mockRejectedValueOnce(new Error('network down'));
    mockFetch.mockRejectedValueOnce(new Error('network down'));
    mockFetch.mockRejectedValueOnce(new Error('network down'));
    const result = await evaluateConditionAsync(
      { jev: { question: 'test', state: 'x', type: 'noul' } },
      {},
    );
    expect(result.passed).toBe(false);
    expect(result.details).toContain('degraded');
  });

  it('resolves state path from context', async () => {
    mockFetch.mockResolvedValueOnce(mockJevSuccess({
      answer: { type: 'noul', noul: 0.9 },
    }));
    const result = await evaluateConditionAsync(
      { jev: { question: 'Is this spam?', state: 'tweet.text', type: 'noul', threshold: 0.5 } },
      { tweet: { text: 'buy followers now' } },
    );
    expect(result.passed).toBe(true);
    // Verify fetch was called with resolved text
    const reqBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(reqBody.state).toBe('buy followers now');
  });

  it('delegates non-jev conditions to sync evaluateCondition', async () => {
    const result = await evaluateConditionAsync(
      { left: 'score', operator: '>', right: 50 },
      { score: 80 },
    );
    expect(result.passed).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('handles string expression via async wrapper', async () => {
    const result = await evaluateConditionAsync('user.followers > 100', { user: { followers: 500 } });
    expect(result.passed).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
