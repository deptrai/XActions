// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * BenchmarkRetentionCleaner — Daily PostgreSQL cleanup for benchmark tables (AD-36).
 * Enforces 90-day retention for ScraperHealthScore and 30-day retention for ScraperCanaryRun.
 * Uses lock-safe ID-based batch chunking with delay to prevent table locks and replication lag.
 * @author nich (@nichxbt)
 * @license MIT
 */

export const DEFAULT_HEALTH_SCORE_RETENTION_DAYS = 90;
export const DEFAULT_CANARY_RUN_RETENTION_DAYS = 30;
export const DEFAULT_BATCH_SIZE = 1000;
export const DEFAULT_BATCH_DELAY_MS = 50;

/**
 * Sleep helper for batch throttling.
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class BenchmarkRetentionCleaner {
  /** @type {import('@prisma/client').PrismaClient | null} */
  #prisma = null;

  /** @type {number} */
  #batchSize;

  /** @type {number} */
  #batchDelayMs;

  /**
   * @param {Object} [options]
   * @param {import('@prisma/client').PrismaClient} [options.prisma]
   * @param {number} [options.batchSize]
   * @param {number} [options.batchDelayMs]
   */
  constructor(options = {}) {
    this.#prisma = options.prisma || null;
    this.#batchSize = options.batchSize || DEFAULT_BATCH_SIZE;
    this.#batchDelayMs = options.batchDelayMs !== undefined ? options.batchDelayMs : DEFAULT_BATCH_DELAY_MS;
  }

  /**
   * Resolve Prisma client.
   * @returns {Promise<import('@prisma/client').PrismaClient>}
   */
  async ensurePrisma() {
    if (this.#prisma) {
      return this.#prisma;
    }
    const { default: prismaInstance } = await import('../../lib/prisma.js');
    this.#prisma = prismaInstance;
    return this.#prisma;
  }

  /**
   * Purge ScraperHealthScore records older than the specified retention days.
   * @param {number} [retentionDays]
   * @returns {Promise<{ deletedCount: number, cutoffDate: Date }>}
   */
  async cleanHealthScores(retentionDays = DEFAULT_HEALTH_SCORE_RETENTION_DAYS) {
    const prisma = await this.ensurePrisma();
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    let totalDeleted = 0;

    while (true) {
      const records = await prisma.scraperHealthScore.findMany({
        where: { evaluatedAt: { lt: cutoffDate } },
        select: { id: true },
        take: this.#batchSize,
      });

      if (!records || records.length === 0) {
        break;
      }

      const ids = records.map((r) => r.id);
      const res = await prisma.scraperHealthScore.deleteMany({
        where: { id: { in: ids } },
      });

      totalDeleted += (res.count ?? ids.length);

      if (records.length < this.#batchSize) {
        break;
      }

      if (this.#batchDelayMs > 0) {
        await sleep(this.#batchDelayMs);
      }
    }

    return { deletedCount: totalDeleted, cutoffDate };
  }

  /**
   * Purge ScraperCanaryRun records older than the specified retention days.
   * @param {number} [retentionDays]
   * @returns {Promise<{ deletedCount: number, cutoffDate: Date }>}
   */
  async cleanCanaryRuns(retentionDays = DEFAULT_CANARY_RUN_RETENTION_DAYS) {
    const prisma = await this.ensurePrisma();
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    let totalDeleted = 0;

    while (true) {
      const records = await prisma.scraperCanaryRun.findMany({
        where: { executedAt: { lt: cutoffDate } },
        select: { id: true },
        take: this.#batchSize,
      });

      if (!records || records.length === 0) {
        break;
      }

      const ids = records.map((r) => r.id);
      const res = await prisma.scraperCanaryRun.deleteMany({
        where: { id: { in: ids } },
      });

      totalDeleted += (res.count ?? ids.length);

      if (records.length < this.#batchSize) {
        break;
      }

      if (this.#batchDelayMs > 0) {
        await sleep(this.#batchDelayMs);
      }
    }

    return { deletedCount: totalDeleted, cutoffDate };
  }

  /**
   * Execute full retention cleanup across all benchmark tables.
   * @returns {Promise<{ healthScoresDeleted: number, canaryRunsDeleted: number, success: boolean }>}
   */
  async cleanAll() {
    try {
      const healthResult = await this.cleanHealthScores();
      const canaryResult = await this.cleanCanaryRuns();

      return {
        healthScoresDeleted: healthResult.deletedCount,
        canaryRunsDeleted: canaryResult.deletedCount,
        success: true,
      };
    } catch (err) {
      console.error('[BenchmarkRetentionCleaner] Cleanup error:', (err instanceof Error ? err.message : String(err)));
      return {
        healthScoresDeleted: 0,
        canaryRunsDeleted: 0,
        success: false,
      };
    }
  }
}

export const defaultBenchmarkRetentionCleaner = new BenchmarkRetentionCleaner();
