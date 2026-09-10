// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * RequalificationService — Scraper promotion workflow from Tier C back to Tier B (AD-31).
 * Requires 5 consecutive clean canary/production runs without False-200 or Checkpoints.
 * Sets requalifiedAt epoch timestamp to reset rolling 24-hour error counting.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import prismaClient from '../../lib/prisma.js';
import { defaultBenchmarkStateManager } from '../../../src/benchmark/state-manager.js';
import { defaultHealthTierCache } from '../../../src/benchmark/health-tier-cache.js';

export class RequalificationService {
  /** @type {import('@prisma/client').PrismaClient} */
  #prisma;

  /** @type {import('../../../src/benchmark/state-manager.js').BenchmarkStateManager} */
  #stateManager;

  /** @type {import('../../../src/benchmark/health-tier-cache.js').HealthTierCache} */
  #healthTierCache;

  /**
   * @param {Object} [deps]
   * @param {import('@prisma/client').PrismaClient} [deps.prisma]
   * @param {import('../../../src/benchmark/state-manager.js').BenchmarkStateManager} [deps.stateManager]
   * @param {import('../../../src/benchmark/health-tier-cache.js').HealthTierCache} [deps.healthTierCache]
   */
  constructor(deps = {}) {
    this.#prisma = deps.prisma || prismaClient;
    this.#stateManager = deps.stateManager || defaultBenchmarkStateManager;
    this.#healthTierCache = deps.healthTierCache || defaultHealthTierCache;
  }

  /**
   * Evaluate whether a scraper meets the 5 clean runs threshold for re-qualification (AD-31).
   * @param {string} scraperId
   * @param {Object} [options]
   * @returns {Promise<{
   *   requalified: boolean;
   *   scraperId: string;
   *   promotedTo?: 'B';
   *   consecutiveCleanRuns: number;
   *   requalifiedAt?: string;
   *   reason?: string;
   * }>}
   */
  async checkAndRequalify(scraperId, options = {}) {
    if (!scraperId || typeof scraperId !== 'string') {
      return { requalified: false, scraperId: '', consecutiveCleanRuns: 0, reason: 'Invalid scraper ID' };
    }

    const runs = await this.#prisma.scraperCanaryRun.findMany({
      where: { scraperId },
      orderBy: { executedAt: 'desc' },
      take: 5,
    });

    let consecutiveClean = 0;
    for (const run of runs) {
      const isClean = run.isSuccess && !run.false200Detected && !run.checkpointDetected;
      if (isClean) {
        consecutiveClean++;
      } else {
        break; // Sequence broken
      }
    }

    if (consecutiveClean >= 5) {
      const requalifiedAt = new Date();

      // Update in-memory cache and Redis
      this.#healthTierCache.set(scraperId, 'B');

      // Update latest ScraperHealthScore in PostgreSQL if present
      try {
        const latestScore = await this.#prisma.scraperHealthScore.findFirst({
          where: { scraperId },
          orderBy: { evaluatedAt: 'desc' },
        });

        if (latestScore) {
          await this.#prisma.scraperHealthScore.update({
            where: { id: latestScore.id },
            data: {
              tier: 'B',
              consecutiveCleanRuns: consecutiveClean,
              requalifiedAt,
            },
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[RequalificationService] Failed to update health score record for ${scraperId}:`, msg);
      }

      return {
        requalified: true,
        scraperId,
        promotedTo: 'B',
        consecutiveCleanRuns: consecutiveClean,
        requalifiedAt: requalifiedAt.toISOString(),
      };
    }

    return {
      requalified: false,
      scraperId,
      consecutiveCleanRuns: consecutiveClean,
      reason: `Requires 5 consecutive clean runs (currently ${consecutiveClean}/5)`,
    };
  }

  /**
   * Manual operator override to force re-qualification of a repaired scraper (AD-31).
   * @param {string} scraperId
   * @param {Object} [options]
   * @param {string} [options.operator='operator']
   * @returns {Promise<{
   *   requalified: boolean;
   *   scraperId: string;
   *   promotedTo: 'B';
   *   manual: boolean;
   *   operator: string;
   *   requalifiedAt: string;
   * }>}
   */
  async manualRequalify(scraperId, options = {}) {
    if (!scraperId || typeof scraperId !== 'string') {
      throw new Error('Invalid scraperId provided for manual requalification');
    }

    const requalifiedAt = new Date();
    this.#healthTierCache.set(scraperId, 'B');

    try {
      const latestScore = await this.#prisma.scraperHealthScore.findFirst({
        where: { scraperId },
        orderBy: { evaluatedAt: 'desc' },
      });

      if (latestScore) {
        await this.#prisma.scraperHealthScore.update({
          where: { id: latestScore.id },
          data: {
            tier: 'B',
            consecutiveCleanRuns: 5,
            requalifiedAt,
          },
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[RequalificationService] Failed to update health score record during manual requalify:`, msg);
    }

    return {
      requalified: true,
      scraperId,
      promotedTo: 'B',
      manual: true,
      operator: options.operator || 'operator',
      requalifiedAt: requalifiedAt.toISOString(),
    };
  }
}

export const defaultRequalificationService = new RequalificationService();
