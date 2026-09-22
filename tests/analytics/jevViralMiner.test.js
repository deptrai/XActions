// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for Story 45.1: jev-viral-miner
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { normalizeNiche, estimateCost, viralMine } from '../../src/analytics/jevViralMiner.js';
import { getPlatformQuestions, listPlatforms, getPlatformCategory } from '../../src/analytics/platformQuestions.js';
import { JevBrain } from '../../src/agents/jevBrain.js';

// Mock JevBrain
vi.mock('../../src/agents/jevBrain.js', () => {
  class MockJevBrain {
    async batchDecide() {
      return [
        { answers: { hookType: 'assertion', hasNumbers: true }, meta: { degraded: false } },
      ];
    }
  }
  return { JevBrain: MockJevBrain };
});

// Mock scrapers
vi.mock('../../src/scrapers/social/twitter/crawler.js', () => {
  class MockTwitterCrawler {
    async init() {}
    async search() {
      return [
        { id: '1', text: 'Test tweet', metrics: { likes: 100, retweets: 50 } },
        { id: '2', text: 'Another tweet', metrics: { likes: 200, retweets: 30 } },
      ];
    }
    async cleanup() {}
  }
  return { TwitterCrawler: MockTwitterCrawler };
});

describe('jevViralMiner', () => {
  describe('normalizeNiche', () => {
    it('should normalize niche to lowercase alphanumeric with hyphens', () => {
      expect(normalizeNiche('Web3 Crypto')).toBe('web3-crypto');
      expect(normalizeNiche('AI Agents!')).toBe('ai-agents');
      expect(normalizeNiche('  Multiple   Spaces  ')).toBe('multiple-spaces');
      expect(normalizeNiche('Special@#$%Chars')).toBe('specialchars');
      expect(normalizeNiche('')).toBe('');
    });
  });

  describe('estimateCost', () => {
    it('should calculate correct cost for 1000 posts', () => {
      const cost = estimateCost(1000, 14);
      expect(cost.posts).toBe(1000);
      expect(cost.totalQuestions).toBe(14000);
      expect(cost.estimated).toBeCloseTo(0.00672, 5); // ~$0.0067
      expect(cost.formatted).toBe('$0.0067');
    });

    it('should calculate correct cost for 10000 posts', () => {
      const cost = estimateCost(10000, 14);
      expect(cost.estimated).toBeCloseTo(0.0672, 4); // ~$0.067
    });
  });

  describe('platformQuestions', () => {
    it('should return questions for all 18 platforms', () => {
      const platforms = listPlatforms();
      expect(platforms).toHaveLength(18);
      
      for (const platform of platforms) {
        const questions = getPlatformQuestions(platform);
        expect(questions).toBeDefined();
        expect(Object.keys(questions).length).toBeGreaterThanOrEqual(10);
      }
    });

    it('should categorize platforms correctly', () => {
      expect(getPlatformCategory('twitter')).toBe('social');
      expect(getPlatformCategory('linkedin')).toBe('recruitment');
      expect(getPlatformCategory('chotot')).toBe('realestate');
      expect(getPlatformCategory('shopee')).toBe('ecom');
    });
  });

  describe('viralMine', () => {
    it('should throw error for unsupported platform', async () => {
      await expect(viralMine({ platform: 'invalid', niche: 'test' }))
        .rejects.toThrow("Platform 'invalid' not supported");
    });

    it('should return MiningResult structure', async () => {
      const result = await viralMine(
        { platform: 'twitter', niche: 'test', count: 10 },
        { session: 'mock-session' }
      );

      expect(result).toHaveProperty('jobId');
      expect(result).toHaveProperty('platform', 'twitter');
      expect(result).toHaveProperty('niche', 'test');
      expect(result).toHaveProperty('scraped');
      expect(result).toHaveProperty('classified');
      expect(result).toHaveProperty('profiles');
      expect(result).toHaveProperty('cost');
      expect(result).toHaveProperty('outputPath');
      expect(result).toHaveProperty('status');
    });
  });
});
