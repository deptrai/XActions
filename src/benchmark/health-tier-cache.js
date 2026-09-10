// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * HealthTierCache — Synchronous O(1) in-memory tier cache with Redis hash polling & DB warmup (AD-32).
 * Prevents cold-start masking, provides synchronous lookup for thin events, and falls back safely to UNKNOWN.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { ensureBenchmarkTables } from './ensure-tables.js';

export const HEALTH_TIER_HASH_KEY = 'hash:scraper:health_tier';
export const VALID_TIERS = Object.freeze(['A', 'B', 'C', 'UNKNOWN']);
export const DEFAULT_TIER = 'UNKNOWN';

export class HealthTierCache {
  /** @type {Map<string, string>} */
  #cache = new Map();

  /** @type {import('../core/types.js').RedisClientLike | null} */
  #redisClient = null;

  /** @type {import('@prisma/client').PrismaClient | null} */
  #prisma = null;

  /** @type {string} */
  #hashKey;

  /** @type {NodeJS.Timeout | null} */
  #pollTimer = null;

  /**
   * @param {Object} [options]
   * @param {import('../core/types.js').RedisClientLike} [options.redisClient]
   * @param {import('@prisma/client').PrismaClient} [options.prisma]
   * @param {string} [options.hashKey]
   */
  constructor(options = {}) {
    this.#redisClient = options.redisClient || null;
    this.#prisma = options.prisma || null;
    this.#hashKey = options.hashKey || HEALTH_TIER_HASH_KEY;
  }

  /**
   * Synchronous O(1) in-memory tier lookup.
   * Never makes network calls on the hot path (AD-32).
   * @param {string} scraperId
   * @returns {'A' | 'B' | 'C' | 'UNKNOWN'}
   */
  get(scraperId) {
    if (!scraperId || typeof scraperId !== 'string') {
      return DEFAULT_TIER;
    }
    const val = this.#cache.get(scraperId);
    if (val && VALID_TIERS.includes(val)) {
      return /** @type {'A' | 'B' | 'C' | 'UNKNOWN'} */ (val);
    }
    return DEFAULT_TIER;
  }

  /**
   * Set tier in local memory cache.
   * @param {string} scraperId
   * @param {'A' | 'B' | 'C' | 'UNKNOWN'} tier
   */
  set(scraperId, tier) {
    if (scraperId && VALID_TIERS.includes(tier)) {
      this.#cache.set(scraperId, tier);
    }
  }

  /**
   * Ensure Redis client is connected.
   * @returns {Promise<import('../core/types.js').RedisClientLike | null>}
   */
  async ensureRedisClient() {
    if (this.#redisClient) {
      return this.#redisClient;
    }

    try {
      const { createClient } = await import('redis');
      const url =
        process.env.REDIS_URL ||
        (process.env.REDIS_HOST
          ? `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}`
          : 'redis://localhost:6379');
      const client = createClient({ url });
      client.on('error', (err) => {
        console.warn('[HealthTierCache] Redis error:', (err instanceof Error ? err.message : String(err)));
      });
      await client.connect();
      this.#redisClient = /** @type {import('../core/types.js').RedisClientLike} */ (client);
      return this.#redisClient;
    } catch (err) {
      console.warn('[HealthTierCache] Redis connection failed:', (err instanceof Error ? err.message : String(err)));
      return null;
    }
  }

  /**
   * Resolve Prisma client.
   * @returns {Promise<import('@prisma/client').PrismaClient | null>}
   */
  async ensurePrisma() {
    if (this.#prisma) {
      return this.#prisma;
    }

    try {
      const { default: prismaInstance } = await import('../../api/lib/prisma.js');
      this.#prisma = prismaInstance;
      return this.#prisma;
    } catch (err) {
      console.warn('[HealthTierCache] Prisma resolution warning:', (err instanceof Error ? err.message : String(err)));
      return null;
    }
  }

  /**
   * Poll and refresh in-memory map from Redis Hash hash:scraper:health_tier.
   * @returns {Promise<void>}
   */
  async refresh() {
    const client = await this.ensureRedisClient();
    if (!client) {
      return;
    }

    try {
      let hash = null;
      if (typeof client.hGetAll === 'function') {
        hash = await client.hGetAll(this.#hashKey);
      } else if (typeof client.hgetall === 'function') {
        hash = await client.hgetall(this.#hashKey);
      }

      if (hash && typeof hash === 'object') {
        for (const [scraperId, tier] of Object.entries(hash)) {
          if (VALID_TIERS.includes(tier)) {
            this.#cache.set(scraperId, tier);
          }
        }
      }
    } catch (err) {
      console.warn('[HealthTierCache] Refresh failed:', (err instanceof Error ? err.message : String(err)));
    }
  }

  /**
   * Start periodic polling loop (default: every 30s).
   * @param {number} [intervalMs]
   */
  startPolling(intervalMs = 30000) {
    if (this.#pollTimer) {
      return;
    }
    this.#pollTimer = setInterval(() => {
      this.refresh().catch((err) => {
        console.warn('[HealthTierCache] Periodic refresh error:', err.message);
      });
    }, intervalMs);
    // Do not prevent process from exiting
    if (this.#pollTimer.unref) {
      this.#pollTimer.unref();
    }
  }

  /**
   * Stop periodic polling loop.
   */
  stopPolling() {
    if (this.#pollTimer) {
      clearInterval(this.#pollTimer);
      this.#pollTimer = null;
    }
  }

  /**
   * Warmup tier cache from PostgreSQL on startup into both RAM and Redis Hash (AD-32).
   * @param {Object} [deps]
   * @param {import('@prisma/client').PrismaClient} [deps.prisma]
   * @param {import('../core/types.js').RedisClientLike} [deps.redisClient]
   * @param {import('../core/types.js').RedisClientLike} [deps.redis]
   * @returns {Promise<void>}
   */
  async warmup(deps = {}) {
    const prisma = deps.prisma || (await this.ensurePrisma());
    const redis = deps.redisClient || deps.redis || (await this.ensureRedisClient());

    if (!prisma) {
      console.warn('[HealthTierCache] Warmup skipped: Prisma unavailable');
      return;
    }

    try {
      await ensureBenchmarkTables(prisma);
      const records = await prisma.scraperHealthScore.findMany({
        distinct: ['scraperId'],
        orderBy: { evaluatedAt: 'desc' },
        select: { scraperId: true, tier: true },
      });

      /** @type {Record<string, string>} */
      const latestMap = {};
      for (const rec of records) {
        if (!latestMap[rec.scraperId] && VALID_TIERS.includes(rec.tier)) {
          latestMap[rec.scraperId] = rec.tier;
          this.#cache.set(rec.scraperId, rec.tier);
        }
      }

      if (redis && Object.keys(latestMap).length > 0) {
        if (typeof redis.hSet === 'function') {
          await redis.hSet(this.#hashKey, latestMap);
        } else if (typeof redis.hset === 'function') {
          for (const [key, val] of Object.entries(latestMap)) {
            await redis.hset(this.#hashKey, key, val);
          }
        }
      }
    } catch (err) {
      console.warn('[HealthTierCache] Warmup query error:', (err instanceof Error ? err.message : String(err)));
    }
  }

  /**
   * Safe fallback resolution when cache misses (AD-32).
   * Checks if scraper had Tier C in last 24h -> returns 'C'.
   * Otherwise returns 'UNKNOWN' (never defaults to 'B').
   * @param {string} scraperId
   * @returns {Promise<'A' | 'B' | 'C' | 'UNKNOWN'>}
   */
  async resolveFallback(scraperId) {
    if (this.#cache.has(scraperId)) {
      return this.get(scraperId);
    }

    const prisma = await this.ensurePrisma();
    if (!prisma) {
      this.#cache.set(scraperId, DEFAULT_TIER);
      return DEFAULT_TIER;
    }

    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentDegraded = await prisma.scraperHealthScore.findFirst({
        where: {
          scraperId,
          tier: 'C',
          evaluatedAt: { gte: twentyFourHoursAgo },
        },
      });

      if (recentDegraded) {
        this.#cache.set(scraperId, 'C');
        return 'C';
      }

      this.#cache.set(scraperId, DEFAULT_TIER);
      return DEFAULT_TIER;
    } catch {
      this.#cache.set(scraperId, DEFAULT_TIER);
      return DEFAULT_TIER;
    }
  }
}

export const defaultHealthTierCache = new HealthTierCache();
