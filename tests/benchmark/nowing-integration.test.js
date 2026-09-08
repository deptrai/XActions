// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 34.6: Nowing Integration Health Flag & Stream Events Unit & Integration Tests.
 * Verifies thin event payload enrichment with scraperId, benchmark_health, benchmark_alert (AD-27, AD-32).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { RedisStreamPublisher } from '../../src/utils/redis-stream-publisher.js';
import { HealthTierCache } from '../../src/benchmark/health-tier-cache.js';

describe('Story 34.6: Nowing Integration Health Flag & Stream Events', () => {
  const origEnv = process.env.REDIS_STREAM_ENABLED;

  beforeEach(() => {
    process.env.REDIS_STREAM_ENABLED = 'true';
  });

  afterAll(() => {
    if (origEnv !== undefined) {
      process.env.REDIS_STREAM_ENABLED = origEnv;
    } else {
      delete process.env.REDIS_STREAM_ENABLED;
    }
  });

  const baseItem = {
    id: 'twitter:1890000000',
    platform: 'twitter',
    externalId: '1890000000',
    category: 'social',
    authorId: 'elano_musk',
    crawledAt: '2026-09-08T12:00:00.000Z',
    storageRef: 'twitter:1890000000',
  };

  describe('AC 1 & AC 2: Payload Enrichment & Health Tier Mapping', () => {
    it('enriches thin event with Tier A health status (no alert)', () => {
      const mockCache = new HealthTierCache();
      mockCache.set('twitter-hybrid', 'A');

      const publisher = new RedisStreamPublisher({ healthTierCache: mockCache });
      const payload = publisher.formatPayload(baseItem, 'twitter-hybrid');

      expect(payload).toMatchObject({
        id: 'twitter:1890000000',
        platform: 'twitter',
        externalId: '1890000000',
        scraperId: 'twitter-hybrid',
        benchmark_health: 'A',
        benchmark_alert: 'false',
      });
      // Ensure all fields are string-valued for XADD
      for (const [key, val] of Object.entries(payload)) {
        expect(typeof val).toBe('string');
      }
    });

    it('enriches thin event with Tier B health status (no alert)', () => {
      const mockCache = new HealthTierCache();
      mockCache.set('facebook-hybrid', 'B');

      const publisher = new RedisStreamPublisher({ healthTierCache: mockCache });
      const payload = publisher.formatPayload(
        { ...baseItem, platform: 'facebook', id: 'facebook:222', externalId: '222' },
        'facebook-hybrid'
      );

      expect(payload).toMatchObject({
        scraperId: 'facebook-hybrid',
        benchmark_health: 'B',
        benchmark_alert: 'false',
      });
    });

    it('enriches thin event with Tier C health status and sets benchmark_alert: "true" (AD-27)', () => {
      const mockCache = new HealthTierCache();
      mockCache.set('pasgo-merchant', 'C');

      const publisher = new RedisStreamPublisher({ healthTierCache: mockCache });
      const payload = publisher.formatPayload(
        { ...baseItem, platform: 'fnb', id: 'fnb:333', externalId: '333' },
        'pasgo-merchant'
      );

      expect(payload).toMatchObject({
        scraperId: 'pasgo-merchant',
        benchmark_health: 'C',
        benchmark_alert: 'true',
      });
    });

    it('resolves unranked or missing scraper safely to UNKNOWN (never B per AD-32)', () => {
      const mockCache = new HealthTierCache();
      // 'unranked-scraper' is not in cache

      const publisher = new RedisStreamPublisher({ healthTierCache: mockCache });
      const payload = publisher.formatPayload(baseItem, 'unranked-scraper');

      expect(payload).toMatchObject({
        scraperId: 'unranked-scraper',
        benchmark_health: 'UNKNOWN',
        benchmark_alert: 'false',
      });
    });

    it('preserves explicitly provided benchmark_health and benchmark_alert overrides', () => {
      const mockCache = new HealthTierCache();
      mockCache.set('twitter-hybrid', 'A');

      const publisher = new RedisStreamPublisher({ healthTierCache: mockCache });
      const customItem = {
        ...baseItem,
        scraperId: 'twitter-hybrid',
        benchmark_health: 'C',
        benchmark_alert: true,
      };

      const payload = publisher.formatPayload(customItem);

      expect(payload.benchmark_health).toBe('C');
      expect(payload.benchmark_alert).toBe('true');
    });

    it('derives default scraperId from platform-hybrid if omitted', () => {
      const mockCache = new HealthTierCache();
      mockCache.set('threads-hybrid', 'A');

      const publisher = new RedisStreamPublisher({ healthTierCache: mockCache });
      const payload = publisher.formatPayload({
        ...baseItem,
        platform: 'threads',
        id: 'threads:444',
      });

      expect(payload.scraperId).toBe('threads-hybrid');
      expect(payload.benchmark_health).toBe('A');
    });
  });

  describe('AC 3 & AC 4: Non-Blocking Publish & Scraper ID Transmission', () => {
    it('publishes Tier C event to Redis stream without blocking or dropping (AD-27)', async () => {
      let capturedKey = '';
      let capturedFields = {};

      const mockRedis = {
        xAdd: async (key, id, fields) => {
          capturedKey = key;
          capturedFields = fields;
          return '1788800000000-0';
        },
      };

      const mockCache = new HealthTierCache();
      mockCache.set('tiktok-hybrid', 'C');

      const publisher = new RedisStreamPublisher({
        redisClient: mockRedis,
        healthTierCache: mockCache,
      });

      const res = await publisher.publish(
        'stream:social:raw_posts',
        { ...baseItem, platform: 'tiktok' },
        'tiktok-hybrid'
      );

      expect(res.ok).toBe(true);
      expect(res.id).toBe('1788800000000-0');
      expect(capturedKey).toBe('stream:social:raw_posts');
      expect(capturedFields.scraperId).toBe('tiktok-hybrid');
      expect(capturedFields.benchmark_health).toBe('C');
      expect(capturedFields.benchmark_alert).toBe('true');
    });

    it('accepts publish(item, scraperId) directly with default stream key', async () => {
      let capturedFields = {};
      const mockRedis = {
        xAdd: async (key, id, fields) => {
          capturedFields = fields;
          return '1788800000000-1';
        },
      };

      const mockCache = new HealthTierCache();
      mockCache.set('youtube-crawler', 'A');

      const publisher = new RedisStreamPublisher({
        redisClient: mockRedis,
        healthTierCache: mockCache,
      });

      const res = await publisher.publish(
        { ...baseItem, platform: 'youtube' },
        'youtube-crawler'
      );

      expect(res.ok).toBe(true);
      expect(capturedFields.scraperId).toBe('youtube-crawler');
      expect(capturedFields.benchmark_health).toBe('A');
      expect(capturedFields.benchmark_alert).toBe('false');
    });

    it('supports flat ioredis client signature with enriched benchmark fields', async () => {
      let capturedArgs = [];
      const mockIoRedis = {
        xadd: async (...args) => {
          capturedArgs = args;
          return '1788800000000-2';
        },
      };

      const mockCache = new HealthTierCache();
      mockCache.set('zalo-hybrid', 'B');

      const publisher = new RedisStreamPublisher({
        redisClient: mockIoRedis,
        healthTierCache: mockCache,
      });

      const res = await publisher.publish(
        'stream:social:raw_posts',
        { ...baseItem, platform: 'zalo' },
        'zalo-hybrid'
      );

      expect(res.ok).toBe(true);
      expect(capturedArgs[0]).toBe('stream:social:raw_posts');
      // Verify that benchmark fields are in the flat payload
      const flatPayload = capturedArgs.slice(5);
      expect(flatPayload).toContain('benchmark_health');
      expect(flatPayload).toContain('B');
      expect(flatPayload).toContain('benchmark_alert');
      expect(flatPayload).toContain('false');
      expect(flatPayload).toContain('scraperId');
      expect(flatPayload).toContain('zalo-hybrid');
    });
  });

  describe('AC 5: Sub-Millisecond Benchmark Lookup Performance (NFR)', () => {
    it('formats 1,000 events with synchronous tier lookup with average latency < 0.1ms', () => {
      const mockCache = new HealthTierCache();
      mockCache.set('twitter-hybrid', 'A');
      mockCache.set('facebook-hybrid', 'B');
      mockCache.set('pasgo-merchant', 'C');

      const publisher = new RedisStreamPublisher({ healthTierCache: mockCache });

      const scrapers = ['twitter-hybrid', 'facebook-hybrid', 'pasgo-merchant', 'unknown-one'];
      const iterations = 1000;

      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        const scraperId = scrapers[i % scrapers.length];
        const payload = publisher.formatPayload(baseItem, scraperId);
        expect(payload.benchmark_health).toBeDefined();
      }
      const elapsed = performance.now() - start;
      const avgPerItem = elapsed / iterations;

      // NFR constraint: strictly less than 0.1ms average per event
      expect(avgPerItem).toBeLessThan(0.1);
    });
  });

  describe('AD-32 Cache Fallback Verification with PostgreSQL', () => {
    it('resolves fallback to C if Tier C record existed in last 24h', async () => {
      const mockPrisma = {
        scraperHealthScore: {
          findFirst: vi.fn().mockResolvedValueOnce({
            scraperId: 'degraded-scraper',
            tier: 'C',
            evaluatedAt: new Date(),
          }),
        },
      };

      const cache = new HealthTierCache({ prisma: mockPrisma });
      const resolved = await cache.resolveFallback('degraded-scraper');

      expect(resolved).toBe('C');
      expect(cache.get('degraded-scraper')).toBe('C');
    });

    it('resolves fallback to UNKNOWN if no Tier C record exists in last 24h', async () => {
      const mockPrisma = {
        scraperHealthScore: {
          findFirst: vi.fn().mockResolvedValueOnce(null),
        },
      };

      const cache = new HealthTierCache({ prisma: mockPrisma });
      const resolved = await cache.resolveFallback('healthy-or-new-scraper');

      expect(resolved).toBe('UNKNOWN');
      expect(cache.get('healthy-or-new-scraper')).toBe('UNKNOWN');
    });
  });
});
