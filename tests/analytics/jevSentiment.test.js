// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// XActions — Jev Semantic Sentiment & CRM Tests (Story 44.2)
// by nichxbt

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { analyzeJevSentiment, analyzeJevBatch } from '../../src/analytics/jevSentiment.js';
import { analyzeSentiment } from '../../src/analytics/sentiment.js';
import { tagContactWithJev, getContactTimeline } from '../../src/analytics/followerCRM.js';
import { JevBrain } from '../../src/agents/jevBrain.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockJevSentimentSuccess({
  sentiment = 'positive',
  confidence = 0.9,
  sarcasmNoul = 0.05,
  reputationImpact = 2,
}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      answers: {
        sentiment: { type: 'choice', choice: sentiment, confidence },
        sarcasm: { type: 'noul', noul: sarcasmNoul },
        reputationImpact: { type: 'score', score: reputationImpact, confidence: 0.85 },
      },
      usage: { input_tokens: 120, output_tokens: 25 },
    }),
    text: async () => JSON.stringify({ sentiment, sarcasmNoul, reputationImpact }),
  };
}

describe('Jev Semantic Sentiment (Story 44.2)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    process.env.TYPESAFE_API_KEY = 'test-jev-key';
  });

  describe('analyzeJevSentiment', () => {
    it('returns neutral for empty or whitespace text without API call', async () => {
      const res = await analyzeJevSentiment('');
      expect(res.label).toBe('neutral');
      expect(res.score).toBe(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('accurately identifies enthusiastic praise', async () => {
      mockFetch.mockResolvedValueOnce(
        mockJevSentimentSuccess({ sentiment: 'enthusiastic', confidence: 0.95, reputationImpact: 3 })
      );

      const res = await analyzeJevSentiment('This is the best open source release of 2026, truly amazing!');
      expect(res.label).toBe('enthusiastic');
      expect(res.score).toBe(1.0);
      expect(res.reputationImpact).toBe(3);
      expect(res.isSarcasm).toBe(false);
      expect(res.source).toBe('jev');
    });

    it('detects sarcasm and inverts score to negative', async () => {
      mockFetch.mockResolvedValueOnce(
        mockJevSentimentSuccess({
          sentiment: 'positive',
          confidence: 0.85,
          sarcasmNoul: 0.92, // Sarcasm detected!
          reputationImpact: 2,
        })
      );

      const res = await analyzeJevSentiment('Oh wow, wonderful job breaking the production build again!');
      expect(res.isSarcasm).toBe(true);
      expect(res.sarcasmNoul).toBe(0.92);
      expect(res.score).toBeLessThan(0); // Score inverted to negative
    });

    it('detects skeptical sentiment', async () => {
      mockFetch.mockResolvedValueOnce(
        mockJevSentimentSuccess({ sentiment: 'skeptical', confidence: 0.8, reputationImpact: 1 })
      );

      const res = await analyzeJevSentiment('Sounds too good to be true. Where is the catch?');
      expect(res.label).toBe('skeptical');
      expect(res.score).toBe(-0.5);
    });

    it('detects hostile / FUD sentiment', async () => {
      mockFetch.mockResolvedValueOnce(
        mockJevSentimentSuccess({ sentiment: 'hostile', confidence: 0.96, reputationImpact: 3 })
      );

      const res = await analyzeJevSentiment('Complete scam project, team is dumping tokens!');
      expect(res.label).toBe('hostile');
      expect(res.score).toBe(-1.0);
      expect(res.reputationImpact).toBe(3);
    });

    it('gracefully degrades to rule-based analysis when Jev fails or has no key', async () => {
      const prevKey = process.env.TYPESAFE_API_KEY;
      delete process.env.TYPESAFE_API_KEY;

      const degradedBrain = new JevBrain({ apiKey: '' });
      const res = await analyzeJevSentiment('Terrible and awful experience', { brain: degradedBrain });

      process.env.TYPESAFE_API_KEY = prevKey;

      expect(res.degraded).toBe(true);
      expect(res.source).toBe('rules');
      expect(res.score).toBeLessThan(0);
      expect(res.label).toBe('hostile');
    });
  });

  describe('analyzeSentiment with mode=jev', () => {
    it('integrates seamlessly with the main analyzeSentiment function', async () => {
      mockFetch.mockResolvedValueOnce(
        mockJevSentimentSuccess({ sentiment: 'enthusiastic', confidence: 0.91 })
      );

      const res = await analyzeSentiment('Incredible product, loving every bit', { mode: 'jev' });
      expect(res.label).toBe('positive'); // normalized
      expect(res.score).toBe(1.0);
      expect(res.details.label).toBe('enthusiastic');
    });
  });

  describe('analyzeJevBatch', () => {
    it('respects maximum batch limit (default 50)', async () => {
      const texts = Array.from({ length: 60 }, (_, i) => `Tweet text ${i}`);
      mockFetch.mockImplementation(async () =>
        mockJevSentimentSuccess({ sentiment: 'neutral', confidence: 0.9 })
      );

      const batch = await analyzeJevBatch(texts, { maxLimit: 5 });
      expect(batch).toHaveLength(5);
    });
  });

  describe('CRM Tagging (tagContactWithJev)', () => {
    it('tags contact as advocate and high_impact for enthusiastic influencer', async () => {
      mockFetch.mockResolvedValueOnce(
        mockJevSentimentSuccess({ sentiment: 'enthusiastic', confidence: 0.95, reputationImpact: 3 })
      );

      const res = await tagContactWithJev('tech_guru', 'Building AI agents and loving @XActions ecosystem!');
      expect(res.username).toBe('tech_guru');
      expect(res.tagsAdded).toContain('advocate');
      expect(res.tagsAdded).toContain('high_impact');
    });

    it('tags contact as sarcastic when sarcasm detected', async () => {
      mockFetch.mockResolvedValueOnce(
        mockJevSentimentSuccess({
          sentiment: 'positive',
          sarcasmNoul: 0.88,
          reputationImpact: 1,
        })
      );

      const res = await tagContactWithJev('troll_user', 'Yeah right, best bot ever haha');
      expect(res.tagsAdded).toContain('sarcastic');
    });
  });
});
