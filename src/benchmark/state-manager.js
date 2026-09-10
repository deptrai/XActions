// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * BenchmarkStateManager — Single Authoritative Writer for Health Tier State & Epoch Filtering (AD-31, AD-32).
 * Enforces atomic state transitions, respects requalifiedAt epoch, and maintains sync across PostgreSQL, Redis, and RAM cache.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { HEALTH_TIER_HASH_KEY, defaultHealthTierCache } from './health-tier-cache.js';
import { ensureBenchmarkTables } from './ensure-tables.js';

export class BenchmarkStateManager {
  /** @type {import('@prisma/client').PrismaClient | null} */
  #prisma = null;

  /** @type {import('../core/types.js').RedisClientLike | null} */
  #redisClient = null;

  /** @type {import('./health-tier-cache.js').HealthTierCache} */
  #healthTierCache;

  /** @type {string} */
  #hashKey;

  /**
   * @param {Object} [options]
   * @param {import('@prisma/client').PrismaClient} [options.prisma]
   * @param {import('../core/types.js').RedisClientLike} [options.redisClient]
   * @param {import('./health-tier-cache.js').HealthTierCache} [options.healthTierCache]
   * @param {string} [options.hashKey]
   */
  constructor(options = {}) {
    this.#prisma = options.prisma || null;
    this.#redisClient = options.redisClient || null;
    this.#healthTierCache = options.healthTierCache || defaultHealthTierCache;
    this.#hashKey = options.hashKey || HEALTH_TIER_HASH_KEY;
  }

  /**
   * Ensure Prisma client is available.
   * @returns {Promise<import('@prisma/client').PrismaClient | null>}
   */
  async ensurePrisma() {
    if (this.#prisma) return this.#prisma;
    try {
      const { default: prismaInstance } = await import('../../api/lib/prisma.js');
      this.#prisma = prismaInstance;
      return this.#prisma;
    } catch {
      return null;
    }
  }

  /**
   * Ensure Redis client is available.
   * @returns {Promise<import('../core/types.js').RedisClientLike | null>}
   */
  async ensureRedis() {
    if (this.#redisClient) return this.#redisClient;
    try {
      const { createClient } = await import('redis');
      const url =
        process.env.REDIS_URL ||
        (process.env.REDIS_HOST
          ? `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}`
          : 'redis://localhost:6379');
      const client = createClient({ url });
      client.on('error', () => {});
      await client.connect();
      this.#redisClient = /** @type {import('../core/types.js').RedisClientLike} */ (client);
      return this.#redisClient;
    } catch {
      return null;
    }
  }

  /**
   * Get synchronous tier from memory cache.
   * @param {string} scraperId
   * @returns {'A' | 'B' | 'C' | 'UNKNOWN'}
   */
  getTier(scraperId) {
    if (!scraperId || typeof scraperId !== 'string') return 'UNKNOWN';
    if (this.#healthTierCache && typeof this.#healthTierCache.get === 'function') {
      return this.#healthTierCache.get(scraperId);
    }
    return 'UNKNOWN';
  }

  /**
   * Filter rolling evaluation events by requalifiedAt epoch (AD-31).
   * Pre-requalification failures are excluded so they cannot immediately demote a re-qualified scraper.
   * @param {Array<Record<string, any>>} events
   * @param {Date | string | null | undefined} requalifiedAt
   * @returns {Array<Record<string, any>>}
   */
  filterTelemetryByEpoch(events = [], requalifiedAt = null) {
    if (!Array.isArray(events)) {
      return [];
    }
    const cleanEvents = events.filter((e) => e !== null && typeof e === 'object');
    if (!requalifiedAt) {
      return cleanEvents;
    }
    const epochTime = new Date(requalifiedAt).getTime();
    if (Number.isNaN(epochTime)) {
      return cleanEvents;
    }

    return cleanEvents.filter((evt) => {
      const timestamp = evt.ts !== undefined ? evt.ts : (evt.timestamp !== undefined ? evt.timestamp : (evt.createdAt !== undefined ? evt.createdAt : evt.evaluatedAt));
      if (timestamp === undefined || timestamp === null) return true;
      const t = new Date(timestamp).getTime();
      return Number.isNaN(t) || t >= epochTime;
    });
  }

  /**
   * Persist evaluation result as single authoritative writer to PostgreSQL, Redis, and memory cache (AD-31, AD-32).
   * @param {string} scraperId
   * @param {Object} scoringResult
   * @param {number} scoringResult.healthScore
   * @param {'A' | 'B' | 'C'} scoringResult.tier
   * @param {boolean} scoringResult.knockoutTriggered
   * @param {string[]} scoringResult.knockoutReasons
   * @param {Record<string, number>} scoringResult.pillars
   * @param {Record<string, number>} scoringResult.rawMetrics
   * @param {Object} [options]
   * @param {string} [options.platform]
   * @param {string} [options.category]
   * @param {number} [options.sampleCount]
   * @param {Array<Record<string, unknown>>} [options.runs]
   * @param {Date} [options.evaluatedAt]
   * @returns {Promise<any>}
   */
  async recordEvaluation(scraperId, scoringResult, options = {}) {
    if (!scraperId || typeof scraperId !== 'string') {
      throw new Error('Valid scraperId is required for recordEvaluation');
    }
    if (!scoringResult || typeof scoringResult !== 'object') {
      throw new Error('Valid scoringResult object is required for recordEvaluation');
    }

    const evaluatedAt = options.evaluatedAt || new Date();
    const prisma = await this.ensurePrisma();
    const redis = await this.ensureRedis();

    // Determine current tier from cache or DB to enforce AD-31 State Machine
    let currentTier = this.getTier(scraperId);
    let consecutiveCleanRuns = 0;
    let requalifiedAt = null;

    if (prisma) {
      await ensureBenchmarkTables(prisma);
      try {
        const latest = await prisma.scraperHealthScore.findFirst({
          where: { scraperId },
          orderBy: { evaluatedAt: 'desc' },
          select: { tier: true, consecutiveCleanRuns: true, requalifiedAt: true },
        });
        if (latest) {
          currentTier = /** @type {'A' | 'B' | 'C' | 'UNKNOWN'} */ (latest.tier || currentTier);
          consecutiveCleanRuns = latest.consecutiveCleanRuns || 0;
          requalifiedAt = latest.requalifiedAt || null;
        }
      } catch (err) {
        console.warn(`[BenchmarkStateManager] Prisma lookup warning for ${scraperId}:`, err instanceof Error ? err.message : String(err));
      }
    }

    // State Machine Transitions (AD-31)
    const proposedTier = scoringResult.tier;
    const isCleanRun = !scoringResult.knockoutTriggered && (proposedTier === 'A' || proposedTier === 'B');
    let finalTier = proposedTier;

    if (currentTier === 'C') {
      if (isCleanRun) {
        consecutiveCleanRuns += 1;
        if (consecutiveCleanRuns >= 5) {
          finalTier = 'B'; // Re-qualification promotes C -> B per AD-31 rule 3
          requalifiedAt = evaluatedAt;
        } else {
          finalTier = 'C'; // Remains Tier C until 5 consecutive clean runs
        }
      } else {
        consecutiveCleanRuns = 0;
        finalTier = 'C';
      }
    } else {
      // Current tier is A, B, or UNKNOWN
      if (scoringResult.knockoutTriggered || proposedTier === 'C') {
        finalTier = 'C';
        consecutiveCleanRuns = 0;
      } else {
        finalTier = proposedTier;
        consecutiveCleanRuns += 1;
      }
    }

    const platform = options.platform || (scraperId.includes('-') ? scraperId.split('-')[0] : scraperId);
    const sampleCount = options.sampleCount || (Array.isArray(options.runs) ? options.runs.length : 0);

    const pillars = scoringResult.pillars || {};
    const stabilityScore = typeof pillars.stability === 'number' ? pillars.stability : 0;
    const qualityScore = typeof pillars.quality === 'number' ? pillars.quality : 0;
    const noiseScore = typeof pillars.noise === 'number' ? pillars.noise : 0;
    const costScore = typeof pillars.cost === 'number' ? pillars.cost : 0;

    let persistedRecord = null;

    if (prisma) {
      try {
        const metricsSnapshot = {
          raw: scoringResult.rawMetrics || {},
          pillars,
          category: options.category || 'social',
          knockoutTriggered: scoringResult.knockoutTriggered || false,
          knockoutReasons: scoringResult.knockoutReasons || [],
        };

        persistedRecord = await prisma.scraperHealthScore.create({
          data: {
            scraperId,
            platform,
            healthScore: scoringResult.healthScore,
            tier: finalTier,
            stabilityScore,
            qualityScore,
            noiseScore,
            costScore,
            sampleCount,
            consecutiveCleanRuns,
            requalifiedAt,
            evaluatedAt,
            metricsSnapshot,
          },
        });
      } catch (err) {
        console.warn(`[BenchmarkStateManager] Prisma persist error for ${scraperId}:`, err instanceof Error ? err.message : String(err));
      }
    }

    // Update Redis Hash (hash:scraper:health_tier)
    if (redis) {
      try {
        if (typeof redis.hSet === 'function') {
          await redis.hSet(this.#hashKey, { [scraperId]: finalTier });
        } else if (typeof redis.hset === 'function') {
          await redis.hset(this.#hashKey, scraperId, finalTier);
        }
      } catch (err) {
        console.warn(`[BenchmarkStateManager] Redis hash update error for ${scraperId}:`, err instanceof Error ? err.message : String(err));
      }
    }

    // Update synchronous in-memory cache
    if (this.#healthTierCache && typeof this.#healthTierCache.set === 'function') {
      this.#healthTierCache.set(scraperId, finalTier);
    }

    return (
      persistedRecord || {
        scraperId,
        platform,
        tier: finalTier,
        healthScore: scoringResult.healthScore,
        stabilityScore,
        qualityScore,
        noiseScore,
        costScore,
        sampleCount,
        consecutiveCleanRuns,
        requalifiedAt,
        evaluatedAt,
      }
    );
  }
}

export const defaultBenchmarkStateManager = new BenchmarkStateManager();

