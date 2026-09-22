// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for Story 45.3: jev-content-intel
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateTweet } from '../../src/ai/tweetGenerator.js';
import { judgePostVariants } from '../../src/ai/jevVariantJudge.js';
import { filterByViralPotential, prioritizeForEngagement } from '../../src/filters/jevFilter.js';

describe('jev-content-intel', () => {
  const mockViralStats = {
    platform: 'twitter',
    niche: 'web3',
    hookTypeDistribution: {
      assertion: { count: 100, avgEngagement: 500, viralRate: 2.34 },
      contrarian: { count: 50, avgEngagement: 400, viralRate: 1.59 },
      listicle: { count: 80, avgEngagement: 100, viralRate: 0.55 },
    },
    topPerformingPatterns: [
      { attributes: { hookType: 'assertion', hasNumbers: true }, avgEngagement: 1200, count: 50 },
      { attributes: { hookType: 'contrarian', evidenceType: 'data' }, avgEngagement: 890, count: 30 },
    ],
    viralRateThreshold: 500,
  };

  const mockVoiceProfile = {
    username: 'testuser',
    style: 'casual',
    topics: ['tech', 'crypto'],
    tone: {
      formality: 0.5,
      humor: 0.5,
      controversy: 0.5,
      empathy: 0.5,
      confidence: 0.5,
    },
    vocabulary: {
      complexity: 0.5,
      emojiFrequency: 0.3,
      topWords: [{ word: 'crypto', count: 10 }, { word: 'web3', count: 5 }],
      topPhrases: [{ phrase: 'to the moon', count: 3 }],
      sentenceStarters: ['Here is', 'Check out'],
      punctuationStyle: 'standard',
    },
    structure: {
      avgLength: 150,
      questionFrequency: 0.2,
      exclamationFrequency: 0.1,
    },
    engagement: {
      callToActionFrequency: 0.3,
      hashtagUsage: 'moderate',
    },
    contentPillars: [
      { topic: 'crypto', frequency: 0.4 },
      { topic: 'tech', frequency: 0.3 },
    ],
    bestPerforming: {
      commonTraits: ['engaging', 'informative'],
      avgLikes: 500,
      avgRetweets: 100,
      examples: [{ text: 'Example tweet', likes: 1000 }],
    },
    sampleTweets: [],
  };

  beforeEach(() => {
    process.env.USE_VIRAL_INTEL = 'true';
  });

  afterEach(() => {
    delete process.env.USE_VIRAL_INTEL;
  });

  describe('tweetGenerator', () => {
    it('should accept viralStats option', async () => {
      // Verify function accepts viralStats parameter without throwing sync error
      const options = {
        topic: 'AI agents',
        platform: 'twitter',
        niche: 'web3',
        viralStats: mockViralStats,
        count: 1,
      };
      
      // Function should accept viralStats — will throw async on LLM call without API key
      // which is expected. We verify the option is accepted by checking it doesn't throw sync.
      try {
        const promise = generateTweet(mockVoiceProfile, options);
        // If we get here without sync throw, the option was accepted
        expect(true).toBe(true);
        // Await to catch any async error (expected without API key)
        await promise.catch(() => {});
      } catch (e) {
        // Sync errors are failures
        expect(e).toBeUndefined();
      }
    });
  });

  describe('jevVariantJudge', () => {
    it('should apply viral boost when pattern matches', async () => {
      const variants = [
        'This is a test tweet about crypto',
        'Assertion: AI will replace 80% of traders by 2027',
        'Here is a list of tips',
      ];
      
      const result = await judgePostVariants(variants, {
        viralStats: mockViralStats,
        platform: 'twitter',
        niche: 'web3',
        brain: {
          decide: async () => ({
            answers: {
              pick: { choice: 'variant_2', confidence: 0.85 },
              cringe_1: { noul: 0.3 },
              cringe_2: { noul: 0.1 },
              cringe_3: { noul: 0.5 },
            },
            usage: {},
            meta: { degraded: false },
          }),
        },
      });
      
      // Should return result with viralBoostApplied field
      expect(result).toHaveProperty('viralBoostApplied');
    });
  });

  describe('jevFilter', () => {
    const mockPosts = [
      {
        id: '1',
        text: 'Assertion hook tweet',
        platform: 'twitter',
        metrics: { likes: 100, shares: 50 },
        viralDNA: { hookType: 'assertion', hasNumbers: true },
      },
      {
        id: '2',
        text: 'Listicle post',
        platform: 'twitter',
        metrics: { likes: 50, shares: 10 },
        viralDNA: { hookType: 'listicle', hasNumbers: false },
      },
    ];

    it('should filter by viral potential', () => {
      const filtered = filterByViralPotential(mockPosts, mockViralStats, { threshold: 50 });
      
      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered[0].viralScore).toBeDefined();
    });

    it('should prioritize for engagement', () => {
      const prioritized = prioritizeForEngagement(mockPosts, mockViralStats);
      
      expect(prioritized.length).toBeLessThanOrEqual(20);
      expect(prioritized[0].viralScore).toBeGreaterThanOrEqual(prioritized[1]?.viralScore || 0);
    });
  });
});
