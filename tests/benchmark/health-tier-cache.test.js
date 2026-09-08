import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HealthTierCache } from '../../src/benchmark/health-tier-cache.js';

describe('HealthTierCache Unit Tests', () => {
  let mockRedis;
  let mockPrisma;
  let cache;

  beforeEach(() => {
    mockRedis = {
      hGetAll: vi.fn().mockResolvedValue({
        'twitter-hybrid': 'A',
        'facebook-hybrid': 'B',
      }),
      hgetall: vi.fn().mockResolvedValue({
        'twitter-hybrid': 'A',
        'facebook-hybrid': 'B',
      }),
      hSet: vi.fn().mockResolvedValue(1),
      hset: vi.fn().mockResolvedValue(1),
    };

    mockPrisma = {
      scraperHealthScore: {
        findMany: vi.fn().mockResolvedValue([
          { scraperId: 'twitter-hybrid', tier: 'A', evaluatedAt: new Date() },
          { scraperId: 'shopee-search', tier: 'C', evaluatedAt: new Date() },
        ]),
        findFirst: vi.fn(),
      },
    };

    cache = new HealthTierCache({ redisClient: mockRedis, prisma: mockPrisma });
  });

  afterEach(() => {
    cache.stopPolling();
  });

  it('performs synchronous O(1) in-memory lookup', () => {
    cache.set('twitter-hybrid', 'A');
    expect(cache.get('twitter-hybrid')).toBe('A');

    // Missing scraper defaults to UNKNOWN, never B
    expect(cache.get('unknown-scraper')).toBe('UNKNOWN');
  });

  it('warms up from PostgreSQL into both in-memory map and Redis hash', async () => {
    await cache.warmup();

    expect(cache.get('twitter-hybrid')).toBe('A');
    expect(cache.get('shopee-search')).toBe('C');
    expect(mockRedis.hSet).toHaveBeenCalledWith(
      'hash:scraper:health_tier',
      expect.objectContaining({
        'twitter-hybrid': 'A',
        'shopee-search': 'C',
      })
    );
  });

  it('refreshes cache from Redis Hash every 30s', async () => {
    await cache.refresh();

    expect(cache.get('twitter-hybrid')).toBe('A');
    expect(cache.get('facebook-hybrid')).toBe('B');
    expect(mockRedis.hGetAll).toHaveBeenCalledTimes(1);
  });

  it('resolves fallback safely: returns C if Tier C existed in 24h, else UNKNOWN', async () => {
    // 1. Found Tier C in DB in last 24h
    mockPrisma.scraperHealthScore.findFirst.mockResolvedValueOnce({
      scraperId: 'degraded-scraper',
      tier: 'C',
    });

    const fallbackTier = await cache.resolveFallback('degraded-scraper');
    expect(fallbackTier).toBe('C');
    expect(cache.get('degraded-scraper')).toBe('C');

    // 2. Not found in DB in last 24h
    mockPrisma.scraperHealthScore.findFirst.mockResolvedValueOnce(null);

    const unknownTier = await cache.resolveFallback('brand-new-scraper');
    expect(unknownTier).toBe('UNKNOWN');
    expect(cache.get('brand-new-scraper')).toBe('UNKNOWN');
  });
});
