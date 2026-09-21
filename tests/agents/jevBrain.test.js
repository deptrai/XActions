// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// XActions — JevBrain Tests
// by nichxbt

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JevBrain } from '../../src/agents/jevBrain.js';
import { globalDistributedTokenBucket } from '../../src/core/distributed-token-bucket.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockJevSuccess(answers, { input_tokens = 120, output_tokens = 25 } = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      answers,
      usage: { input_tokens, output_tokens },
    }),
    text: async () => JSON.stringify({ answers }),
  };
}

describe('JevBrain', () => {
  let brain;

  beforeEach(() => {
    mockFetch.mockReset();
    brain = new JevBrain({
      apiKey: 'test-jev-key-xyz',
      timeoutMs: 1000,
      dailyBudgetUsd: 10.0,
      confidenceThresholds: {
        like: 0.60,
        reply: 0.85,
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Happy path — Mixed Primitives', () => {
    it('should return typed answers for Choice, Score, and Noul questions', async () => {
      const mockAnswers = {
        relevance: { type: 'score', score: 2, confidence: 0.88 },
        action: { type: 'choice', choice: 'reply', confidence: 0.91 },
        isSpam: { type: 'noul', noul: 0.05 },
      };
      mockFetch.mockResolvedValueOnce(mockJevSuccess(mockAnswers));

      const res = await brain.decide(
        { tweet: 'Awesome new AI release', author: 'tester' },
        {
          relevance: { type: 'score', instructions: 'Relevance score', criteria: ['low', 'med', 'high'] },
          action: { type: 'choice', instructions: 'Best action', criteria: { reply: 'Reply', ignore: 'Ignore' } },
          isSpam: { type: 'noul', instructions: 'Is this spam' },
        }
      );

      expect(res.meta.degraded).toBe(false);
      expect(res.meta.source).toBe('jev');
      expect(res.answers.relevance.score).toBe(2);
      expect(res.answers.relevance.confidence).toBe(0.88);
      expect(res.answers.action.choice).toBe('reply');
      expect(res.answers.isSpam.noul).toBe(0.05);
      expect(res.usage.input_tokens).toBe(120);

      // HTTP contract verification
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.typesafe.ai/v1/systemone',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-jev-key-xyz',
          }),
        })
      );
      const reqBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(reqBody.model).toBe('jev-latest');
      expect(reqBody.questions.relevance.type).toBe('score');
      expect(reqBody.questions.action.type).toBe('choice');
      expect(reqBody.questions.isSpam.type).toBe('noul');
    });
  });

  describe('Missing API Key Degradation', () => {
    it('should degrade to fallback without making a fetch call if key is missing', async () => {
      const noKeyBrain = new JevBrain({ apiKey: '' });
      const res = await noKeyBrain.decide('some tweet', {
        action: { type: 'choice', instructions: 'action' },
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(res.meta.degraded).toBe(true);
      expect(res.meta.reason).toBe('missing-key');
      expect(res.meta.source).toBe('llmbrain');
      expect(res.answers.action.choice).toBe('ignore');
    });
  });

  describe('HTTP 5xx Server Error Retry & Degradation', () => {
    it('should retry 3 times on 503 then degrade to fallback without throwing', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => 'Service Unavailable',
      });

      const res = await brain.decide('tweet text', {
        relevance: { type: 'score', instructions: 'score' },
      });

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(res.meta.degraded).toBe(true);
      expect(res.meta.reason).toBe('http-5xx');
      expect(res.answers.relevance.score).toBe(0);
    });
  });

  describe('HTTP 429 Rate Limit Retry Recovery', () => {
    it('should retry after 429 and return real answers on subsequent 200', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'Too Many Requests' })
        .mockResolvedValueOnce(mockJevSuccess({
          action: { type: 'choice', choice: 'like', confidence: 0.95 },
        }));

      const res = await brain.decide('cool post', {
        action: { type: 'choice', instructions: 'best action' },
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(res.meta.degraded).toBe(false);
      expect(res.answers.action.choice).toBe('like');
    });
  });

  describe('Timeout Handling', () => {
    it('should abort and degrade when request exceeds timeoutMs', async () => {
      mockFetch.mockImplementation(async () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      });

      const res = await brain.decide('slow request', {
        action: { type: 'choice', instructions: 'act' },
      }, { timeoutMs: 50 });

      expect(res.meta.degraded).toBe(true);
      expect(res.meta.reason).toBe('timeout');
      expect(res.meta.source).toBe('llmbrain');
    });
  });

  describe('Budget Ceiling Governance (AD-42 mirror)', () => {
    it('should soft-degrade without throwing when daily budget is exhausted', async () => {
      const spyConsume = vi.spyOn(globalDistributedTokenBucket, 'consume').mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        retryAfterMs: 3600000,
      });

      const res = await brain.decide('post', {
        action: { type: 'choice', instructions: 'act' },
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(res.meta.degraded).toBe(true);
      expect(res.meta.reason).toBe('budget');
      spyConsume.mockRestore();
    });

    it('should degrade immediately if dailyBudgetUsd is set to 0', async () => {
      const zeroBudgetBrain = new JevBrain({ apiKey: 'key', dailyBudgetUsd: 0 });
      const res = await zeroBudgetBrain.decide('post', {
        action: { type: 'choice', instructions: 'act' },
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(res.meta.degraded).toBe(true);
      expect(res.meta.reason).toBe('budget');
    });
  });

  describe('Malformed Response Handling', () => {
    it('should degrade gracefully if response body is missing answers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ unexpected: 'format' }),
        text: async () => '{"unexpected":"format"}',
      });

      const res = await brain.decide('test', {
        action: { type: 'choice', instructions: 'act' },
      });

      expect(res.meta.degraded).toBe(true);
      expect(res.meta.reason).toBe('bad-response');
    });
  });

  describe('Fallback with injected LLMBrain', () => {
    it('should delegate to fallbackLLM methods when degrading', async () => {
      const mockLLM = {
        scoreRelevance: vi.fn().mockResolvedValue(75),
        checkPersonaConsistency: vi.fn().mockResolvedValue({ consistent: true }),
      };

      const brainWithFallback = new JevBrain({
        apiKey: '', // triggers immediate degradation
        fallbackLLM: mockLLM,
      });

      const res = await brainWithFallback.decide(
        { tweet: 'test post', nicheKeywords: ['ai'], text: 'test post' },
        {
          relevance: { type: 'score', instructions: 'relevance' },
          persona: { type: 'noul', instructions: 'persona' },
          customChoice: { type: 'choice', criteria: { approve: 'Yes', deny: 'No' }, instructions: 'decide' },
        }
      );

      expect(res.meta.degraded).toBe(true);
      expect(res.meta.source).toBe('llmbrain');
      expect(mockLLM.scoreRelevance).toHaveBeenCalledWith('test post', ['ai']);
      expect(mockLLM.checkPersonaConsistency).toHaveBeenCalled();
      expect(res.answers.relevance.score).toBe(3); // 75 / 25 = 3
      expect(res.answers.persona.noul).toBe(1.0);
      // Criteria does not have 'ignore', so fallback picks first key 'approve'
      expect(res.answers.customChoice.choice).toBe('approve');
    });
  });

  describe('Usage recording and onUsage callback', () => {
    it('should trigger onUsage callback on successful decide call', async () => {
      const onUsageSpy = vi.fn();
      brain.onUsage = onUsageSpy;

      mockFetch.mockResolvedValueOnce(mockJevSuccess({ ok: { type: 'noul', noul: 1.0 } }, {
        input_tokens: 300,
        output_tokens: 50,
      }));

      await brain.decide('state', { ok: { type: 'noul', instructions: 'test' } });

      expect(onUsageSpy).toHaveBeenCalledWith('jev-latest', 300, 50);
      const usage = brain.getUsageToday();
      expect(usage.calls).toBe(1);
      expect(usage.inputTokens).toBe(300);
      expect(usage.outputTokens).toBe(50);
    });
  });

  describe('Confidence Gate Helper', () => {
    it('should evaluate act, review, and skip based on custom thresholds', () => {
      expect(brain.gate({ confidence: 0.90 }, { hi: 0.85, mid: 0.60 })).toBe('act');
      expect(brain.gate({ confidence: 0.70 }, { hi: 0.85, mid: 0.60 })).toBe('review');
      expect(brain.gate({ confidence: 0.40 }, { hi: 0.85, mid: 0.60 })).toBe('skip');
    });

    it('should evaluate action-specific thresholds from config', () => {
      // like threshold = 0.60
      expect(brain.gate({ confidence: 0.65 }, { action: 'like' })).toBe('act');
      // reply threshold = 0.85
      expect(brain.gate({ confidence: 0.75 }, { action: 'reply' })).toBe('review');
      expect(brain.gate({ confidence: 0.88 }, { action: 'reply' })).toBe('act');
    });

    it('should support Noul answers (noul property as confidence)', () => {
      expect(brain.gate({ noul: 0.95 }, { hi: 0.80 })).toBe('act');
      expect(brain.gate({ noul: 0.50 }, { hi: 0.80 })).toBe('review');
      expect(brain.gate({ noul: 0.10 }, { hi: 0.80 })).toBe('skip');
    });

    it('should safely return skip on invalid or missing answer', () => {
      expect(brain.gate(null)).toBe('skip');
      expect(brain.gate({})).toBe('skip');
      expect(brain.gate({ confidence: NaN })).toBe('skip');
    });
  });
});
