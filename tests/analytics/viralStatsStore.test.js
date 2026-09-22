// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for Story 45.2: jev-viral-stats
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { aggregateStats, saveStats, loadLatestStats, listStats, ViralStatsSchema } from '../../src/analytics/viralStatsStore.js';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DATA_DIR = path.join(__dirname, '../../data/test-viral-stats');

// Mock platformQuestions for category lookup
vi.mock('../../src/analytics/platformQuestions.js', async () => {
  const actual = await vi.importActual('../../src/analytics/platformQuestions.js');
  return {
    ...actual,
    getPlatformCategory: vi.fn((platform) => {
      const categories = {
        twitter: 'social',
        linkedin: 'recruitment',
        chotot: 'realestate',
        shopee: 'ecom',
      };
      return categories[platform] || 'social';
    }),
  };
});

describe('viralStatsStore', () => {
  const mockProfiles = [
    {
      id: '1',
      platform: 'twitter',
      niche: 'web3',
      text: 'Test tweet 1',
      metrics: { likes: 1000, retweets: 500, views: 10000 },
      viralDNA: { hookType: 'assertion', hasNumbers: true, emotionalTrigger: 'greed' },
      jevDegraded: false,
      scrapedAt: '2026-09-23T00:00:00Z',
    },
    {
      id: '2',
      platform: 'twitter',
      niche: 'web3',
      text: 'Test tweet 2',
      metrics: { likes: 100, retweets: 20, views: 1000 },
      viralDNA: { hookType: 'question', hasNumbers: false, emotionalTrigger: 'none' },
      jevDegraded: false,
      scrapedAt: '2026-09-23T00:00:00Z',
    },
    {
      id: '3',
      platform: 'twitter',
      niche: 'web3',
      text: 'Test tweet 3',
      metrics: { likes: 5000, retweets: 2000, views: 50000 },
      viralDNA: { hookType: 'assertion', hasNumbers: true, emotionalTrigger: 'surprise' },
      jevDegraded: false,
      scrapedAt: '2026-09-23T00:00:00Z',
    },
    {
      id: '4',
      platform: 'twitter',
      niche: 'web3',
      text: 'Test tweet 4',
      metrics: { likes: 50, retweets: 5, views: 500 },
      viralDNA: { hookType: 'listicle', hasNumbers: false, emotionalTrigger: 'none' },
      jevDegraded: false,
      scrapedAt: '2026-09-23T00:00:00Z',
    },
  ];

  beforeEach(async () => {
    // Setup test directory
    await fs.mkdir(TEST_DATA_DIR, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup test files
    try {
      await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  describe('aggregateStats', () => {
    it('should compute correct hookTypeDistribution', () => {
      const stats = aggregateStats(mockProfiles, 'twitter', 'web3');
      
      expect(stats.hookTypeDistribution).toBeDefined();
      expect(stats.hookTypeDistribution.assertion).toBeDefined();
      expect(stats.hookTypeDistribution.assertion.count).toBe(2);
      expect(stats.hookTypeDistribution.question.count).toBe(1);
      expect(stats.hookTypeDistribution.listicle.count).toBe(1);
    });

    it('should calculate viralRate correctly', () => {
      const stats = aggregateStats(mockProfiles, 'twitter', 'web3');
      
      // Top 10% threshold — highest engagement post
      expect(stats.viralRateThreshold).toBeGreaterThan(0);
      
      // Assertion posts should have higher viral rate
      const assertionRate = stats.hookTypeDistribution.assertion.viralRate;
      const questionRate = stats.hookTypeDistribution.question.viralRate;
      expect(assertionRate).toBeGreaterThanOrEqual(questionRate);
    });

    it('should find topPerformingPatterns', () => {
      const stats = aggregateStats(mockProfiles, 'twitter', 'web3');
      
      expect(stats.topPerformingPatterns).toBeDefined();
      expect(Array.isArray(stats.topPerformingPatterns)).toBe(true);
      expect(stats.topPerformingPatterns.length).toBeGreaterThan(0);
    });

    it('should calculate attributeCorrelations', () => {
      const stats = aggregateStats(mockProfiles, 'twitter', 'web3');
      
      expect(stats.attributeCorrelations).toBeDefined();
      expect(stats.attributeCorrelations.hookType).toBeDefined();
    });
  });

  describe('ViralStatsSchema', () => {
    it('should validate correct stats object', () => {
      const stats = aggregateStats(mockProfiles, 'twitter', 'web3');
      const result = ViralStatsSchema.safeParse(stats);
      
      expect(result.success).toBe(true);
    });

    it('should reject invalid stats', () => {
      const invalid = { platform: 'twitter' }; // Missing required fields
      const result = ViralStatsSchema.safeParse(invalid);
      
      expect(result.success).toBe(false);
    });
  });

  describe('saveStats / loadLatestStats', () => {
    it('should save and load stats', async () => {
      const stats = aggregateStats(mockProfiles, 'twitter', 'web3');
      const filepath = await saveStats(stats, 'twitter', 'web3');
      
      expect(filepath).toContain('social-twitter-web3');
      
      const loaded = await loadLatestStats('twitter', 'web3');
      expect(loaded).toBeDefined();
      expect(loaded.platform).toBe('twitter');
      expect(loaded.niche).toBe('web3');
    });
  });

  describe('listStats', () => {
    it('should list all saved stats', async () => {
      const stats = aggregateStats(mockProfiles, 'twitter', 'web3');
      await saveStats(stats, 'twitter', 'web3');
      
      const list = await listStats();
      expect(list.length).toBeGreaterThan(0);
      expect(list[0].platform).toBe('twitter');
    });
  });
});
