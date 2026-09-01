// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// by nichxbt
/**
 * RetentionCleaner — Data Retention & Checkpoint Purge Service.
 * Implements AD-10 & FR-87: 30-day raw crawl TTL (Post & Comment) and 90-day terminal checkpoint purge.
 * Uses lock-safe ID-based batch chunking with delay to prevent PostgreSQL table locks and replication lag.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import { PlatformError, ErrorTypes, SuggestedActions } from '../core/error-envelope.js';

export const SAFE_CHECKPOINT_CLEANUP_STATUSES = Object.freeze(['completed', 'failed']);
export const PROTECTED_CHECKPOINT_STATUSES = Object.freeze(['running', 'paused', 'stalled']);

export const DEFAULT_RAW_RETENTION_DAYS = 30;
export const DEFAULT_CHECKPOINT_RETENTION_DAYS = 90;
export const DEFAULT_BATCH_SIZE = 1000;
export const MAX_BATCH_SIZE = 5000;
export const DEFAULT_BATCH_DELAY_MS = 50;

/**
 * Sleep helper for batch throttling.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve Prisma client instance.
 * @param {import('@prisma/client').PrismaClient} [injectedPrisma]
 * @returns {Promise<import('@prisma/client').PrismaClient>}
 */
async function resolvePrisma(injectedPrisma) {
  if (injectedPrisma) return injectedPrisma;
  const { default: prisma } = await import('../../api/lib/prisma.js');
  return prisma;
}

export class RetentionCleaner {
  /** @type {import('@prisma/client').PrismaClient | null} */
  #prisma = null;

  /**
   * @param {Object} [options]
   * @param {import('@prisma/client').PrismaClient} [options.prisma]
   */
  constructor(options = {}) {
    this.#prisma = options.prisma || null;
  }

  /**
   * Initialize Prisma client if not injected.
   * @returns {Promise<import('@prisma/client').PrismaClient>}
   */
  async getPrisma() {
    if (!this.#prisma) {
      this.#prisma = await resolvePrisma();
    }
    return this.#prisma;
  }

  /**
   * Clean raw crawl data (Post and Comment) older than retention cutoff.
   * Lock-safe deletion: deletes comments first, then posts in ID-based batches.
   *
   * @param {Object} [options]
   * @param {number} [options.retentionDays] - Retention threshold in days (default: 30)
   * @param {number} [options.batchSize] - Batch size for deletion chunking (default: 1000, max: 5000)
   * @param {number} [options.batchDelayMs] - Sleep between batches in ms (default: 50)
   * @param {boolean} [options.dryRun=false] - If true, only count eligible records without deleting
   * @param {string} [options.platform] - Optional platform filter
   * @param {Date} [options.cutoffDate] - Explicit cutoff date override
   * @param {import('@prisma/client').PrismaClient} [options.prisma]
   * @returns {Promise<{
   *   success: boolean;
   *   postsDeleted?: number;
   *   commentsDeleted?: number;
   *   postsEligible?: number;
   *   commentsEligible?: number;
   *   batchesExecuted: number;
   *   durationMs: number;
   *   cutoffDate: string;
   *   dryRun: boolean;
   *   error?: string;
   * }>}
   */
  async cleanRawCrawlData(options = {}) {
    const startTime = Date.now();
    const prisma = options.prisma || (await this.getPrisma());

    const retentionDays =
      typeof options.retentionDays === 'number' && options.retentionDays > 0
        ? options.retentionDays
        : parseInt(process.env.DATA_RETENTION_DAYS_RAW || '', 10) || DEFAULT_RAW_RETENTION_DAYS;

    const rawBatchSize =
      typeof options.batchSize === 'number' && options.batchSize > 0
        ? options.batchSize
        : parseInt(process.env.DATA_RETENTION_BATCH_SIZE || '', 10) || DEFAULT_BATCH_SIZE;
    const batchSize = Math.min(Math.max(1, rawBatchSize), MAX_BATCH_SIZE);

    const batchDelayMs =
      typeof options.batchDelayMs === 'number' && options.batchDelayMs >= 0
        ? options.batchDelayMs
        : parseInt(process.env.DATA_RETENTION_BATCH_DELAY_MS || '', 10) || DEFAULT_BATCH_DELAY_MS;

    const dryRun = Boolean(options.dryRun);
    const platform = options.platform ? String(options.platform) : undefined;

    const cutoffDate =
      options.cutoffDate instanceof Date
        ? options.cutoffDate
        : new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const postWhere = {
      crawledAt: { lt: cutoffDate },
      ...(platform ? { platform } : {}),
    };

    if (dryRun) {
      const postsEligible = await prisma.post.count({ where: postWhere });
      const commentsEligible = await prisma.comment.count({
        where: {
          crawledAt: { lt: cutoffDate },
          ...(platform ? { platform } : {}),
        },
      });

      return {
        success: true,
        dryRun: true,
        postsEligible,
        commentsEligible,
        postsDeleted: 0,
        commentsDeleted: 0,
        batchesExecuted: 0,
        durationMs: Date.now() - startTime,
        cutoffDate: cutoffDate.toISOString(),
      };
    }

    let postsDeleted = 0;
    let commentsDeleted = 0;
    let batchesExecuted = 0;

    try {
      // Phase 1: Chunked Post & associated Comment deletion
      while (true) {
        const batchPosts = await prisma.post.findMany({
          where: postWhere,
          select: { id: true },
          take: batchSize,
        });

        if (!batchPosts || batchPosts.length === 0) {
          break;
        }

        const batchPostIds = batchPosts.map((p) => p.id);

        // Delete comments associated with this batch of post IDs first
        // to avoid huge cascading lock spikes on the Post table.
        const commentDeleteResult = await prisma.comment.deleteMany({
          where: {
            postId: { in: batchPostIds },
          },
        });
        commentsDeleted += commentDeleteResult.count;

        // Delete the batch of posts
        const postDeleteResult = await prisma.post.deleteMany({
          where: {
            id: { in: batchPostIds },
          },
        });
        postsDeleted += postDeleteResult.count;
        batchesExecuted++;

        if (batchDelayMs > 0) {
          await sleep(batchDelayMs);
        }
      }

      // Phase 2: Clean up any remaining orphan comments with crawledAt < cutoffDate
      // (e.g. comments ingested separately whose posts were previously removed or without parent post)
      while (true) {
        const orphanComments = await prisma.comment.findMany({
          where: {
            crawledAt: { lt: cutoffDate },
            ...(platform ? { platform } : {}),
          },
          select: { id: true },
          take: batchSize,
        });

        if (!orphanComments || orphanComments.length === 0) {
          break;
        }

        const orphanCommentIds = orphanComments.map((c) => c.id);
        const orphanDeleteResult = await prisma.comment.deleteMany({
          where: {
            id: { in: orphanCommentIds },
          },
        });
        commentsDeleted += orphanDeleteResult.count;
        batchesExecuted++;

        if (batchDelayMs > 0) {
          await sleep(batchDelayMs);
        }
      }

      return {
        success: true,
        dryRun: false,
        postsDeleted,
        commentsDeleted,
        batchesExecuted,
        durationMs: Date.now() - startTime,
        cutoffDate: cutoffDate.toISOString(),
      };
    } catch (err) {
      console.error('❌ RetentionCleaner.cleanRawCrawlData error:', err);
      return {
        success: false,
        dryRun: false,
        postsDeleted,
        commentsDeleted,
        batchesExecuted,
        durationMs: Date.now() - startTime,
        cutoffDate: cutoffDate.toISOString(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Clean completed and failed CrawlCheckpoints older than checkpoint retention days.
   * PROTECTED: Never deletes running, paused, or stalled checkpoints.
   *
   * @param {Object} [options]
   * @param {number} [options.checkpointRetentionDays] - Checkpoint TTL in days (default: 90)
   * @param {string[]} [options.statuses] - Candidate statuses to purge (default: ['completed', 'failed'])
   * @param {boolean} [options.dryRun=false] - If true, only count eligible checkpoints
   * @param {string} [options.platform] - Optional platform filter
   * @param {Date} [options.cutoffDate] - Explicit cutoff date override
   * @param {import('@prisma/client').PrismaClient} [options.prisma]
   * @returns {Promise<{
   *   success: boolean;
   *   checkpointsDeleted?: number;
   *   checkpointsEligible?: number;
   *   durationMs: number;
   *   cutoffDate: string;
   *   dryRun: boolean;
   *   error?: string;
   * }>}
   */
  async cleanCheckpoints(options = {}) {
    const startTime = Date.now();
    const prisma = options.prisma || (await this.getPrisma());

    const checkpointRetentionDays =
      typeof options.checkpointRetentionDays === 'number' && options.checkpointRetentionDays > 0
        ? options.checkpointRetentionDays
        : parseInt(process.env.DATA_RETENTION_DAYS_CHECKPOINT || '', 10) || DEFAULT_CHECKPOINT_RETENTION_DAYS;

    const dryRun = Boolean(options.dryRun);
    const platform = options.platform ? String(options.platform) : undefined;

    // Filter statuses: strictly exclude any protected status
    const requestedStatuses = Array.isArray(options.statuses) && options.statuses.length > 0
      ? options.statuses.map((s) => String(s).toLowerCase())
      : SAFE_CHECKPOINT_CLEANUP_STATUSES;

    const allowedStatuses = requestedStatuses.filter(
      (s) => SAFE_CHECKPOINT_CLEANUP_STATUSES.includes(s) && !PROTECTED_CHECKPOINT_STATUSES.includes(s)
    );

    if (allowedStatuses.length === 0) {
      return {
        success: true,
        dryRun,
        checkpointsDeleted: 0,
        checkpointsEligible: 0,
        durationMs: Date.now() - startTime,
        cutoffDate: new Date().toISOString(),
      };
    }

    const cutoffDate =
      options.cutoffDate instanceof Date
        ? options.cutoffDate
        : new Date(Date.now() - checkpointRetentionDays * 24 * 60 * 60 * 1000);

    const whereClause = {
      status: { in: allowedStatuses },
      updatedAt: { lt: cutoffDate },
      ...(platform ? { platform } : {}),
    };

    if (dryRun) {
      const checkpointsEligible = await prisma.crawlCheckpoint.count({
        where: whereClause,
      });

      return {
        success: true,
        dryRun: true,
        checkpointsEligible,
        checkpointsDeleted: 0,
        durationMs: Date.now() - startTime,
        cutoffDate: cutoffDate.toISOString(),
      };
    }

    try {
      const result = await prisma.crawlCheckpoint.deleteMany({
        where: whereClause,
      });

      return {
        success: true,
        dryRun: false,
        checkpointsDeleted: result.count,
        durationMs: Date.now() - startTime,
        cutoffDate: cutoffDate.toISOString(),
      };
    } catch (err) {
      console.error('❌ RetentionCleaner.cleanCheckpoints error:', err);
      return {
        success: false,
        dryRun: false,
        checkpointsDeleted: 0,
        durationMs: Date.now() - startTime,
        cutoffDate: cutoffDate.toISOString(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Get retention metrics and data expiration breakdown.
   *
   * @param {Object} [options]
   * @param {number} [options.rawDays=30]
   * @param {number} [options.checkpointDays=90]
   * @param {string} [options.platform]
   * @param {import('@prisma/client').PrismaClient} [options.prisma]
   * @returns {Promise<{
   *   success: boolean;
   *   data: {
   *     posts: { total: number; olderThan7d: number; olderThan14d: number; olderThan30d: number; olderThan90d: number };
   *     comments: { total: number; olderThan7d: number; olderThan14d: number; olderThan30d: number; olderThan90d: number };
   *     checkpoints: { total: number; eligibleForCleanup: number; byStatus: Record<string, number> };
   *     thresholds: { rawCutoff: string; checkpointCutoff: string };
   *   };
   * }>}
   */
  async getRetentionStats(options = {}) {
    const prisma = options.prisma || (await this.getPrisma());
    const rawDays = options.rawDays || DEFAULT_RAW_RETENTION_DAYS;
    const checkpointDays = options.checkpointDays || DEFAULT_CHECKPOINT_RETENTION_DAYS;
    const platform = options.platform ? String(options.platform) : undefined;

    const now = Date.now();
    const d7 = new Date(now - 7 * 86400000);
    const d14 = new Date(now - 14 * 86400000);
    const d30 = new Date(now - rawDays * 86400000);
    const d90 = new Date(now - checkpointDays * 86400000);

    const postBaseWhere = platform ? { platform } : {};
    const commentBaseWhere = platform ? { platform } : {};
    const checkpointBaseWhere = platform ? { platform } : {};

    const [
      postsTotal,
      posts7d,
      posts14d,
      posts30d,
      posts90d,
      commentsTotal,
      comments7d,
      comments14d,
      comments30d,
      comments90d,
      checkpointsTotal,
      checkpointsEligible,
      checkpointsRunning,
      checkpointsPaused,
      checkpointsFailed,
      checkpointsCompleted,
      checkpointsStalled,
    ] = await Promise.all([
      prisma.post.count({ where: postBaseWhere }),
      prisma.post.count({ where: { ...postBaseWhere, crawledAt: { lt: d7 } } }),
      prisma.post.count({ where: { ...postBaseWhere, crawledAt: { lt: d14 } } }),
      prisma.post.count({ where: { ...postBaseWhere, crawledAt: { lt: d30 } } }),
      prisma.post.count({ where: { ...postBaseWhere, crawledAt: { lt: d90 } } }),

      prisma.comment.count({ where: commentBaseWhere }),
      prisma.comment.count({ where: { ...commentBaseWhere, crawledAt: { lt: d7 } } }),
      prisma.comment.count({ where: { ...commentBaseWhere, crawledAt: { lt: d14 } } }),
      prisma.comment.count({ where: { ...commentBaseWhere, crawledAt: { lt: d30 } } }),
      prisma.comment.count({ where: { ...commentBaseWhere, crawledAt: { lt: d90 } } }),

      prisma.crawlCheckpoint.count({ where: checkpointBaseWhere }),
      prisma.crawlCheckpoint.count({
        where: {
          ...checkpointBaseWhere,
          status: { in: SAFE_CHECKPOINT_CLEANUP_STATUSES },
          updatedAt: { lt: d90 },
        },
      }),
      prisma.crawlCheckpoint.count({ where: { ...checkpointBaseWhere, status: 'running' } }),
      prisma.crawlCheckpoint.count({ where: { ...checkpointBaseWhere, status: 'paused' } }),
      prisma.crawlCheckpoint.count({ where: { ...checkpointBaseWhere, status: 'failed' } }),
      prisma.crawlCheckpoint.count({ where: { ...checkpointBaseWhere, status: 'completed' } }),
      prisma.crawlCheckpoint.count({ where: { ...checkpointBaseWhere, status: 'stalled' } }),
    ]);

    return {
      success: true,
      data: {
        posts: {
          total: postsTotal,
          olderThan7d: posts7d,
          olderThan14d: posts14d,
          olderThan30d: posts30d,
          olderThan90d: posts90d,
        },
        comments: {
          total: commentsTotal,
          olderThan7d: comments7d,
          olderThan14d: comments14d,
          olderThan30d: comments30d,
          olderThan90d: comments90d,
        },
        checkpoints: {
          total: checkpointsTotal,
          eligibleForCleanup: checkpointsEligible,
          byStatus: {
            running: checkpointsRunning,
            paused: checkpointsPaused,
            failed: checkpointsFailed,
            completed: checkpointsCompleted,
            stalled: checkpointsStalled,
          },
        },
        thresholds: {
          rawCutoff: d30.toISOString(),
          checkpointCutoff: d90.toISOString(),
        },
      },
    };
  }

  /**
   * Run full retention pipeline (raw posts/comments and checkpoints).
   *
   * @param {Object} [options]
   * @param {number} [options.retentionDays]
   * @param {number} [options.checkpointRetentionDays]
   * @param {number} [options.batchSize]
   * @param {number} [options.batchDelayMs]
   * @param {boolean} [options.dryRun=false]
   * @param {boolean} [options.cleanCheckpoints=true]
   * @param {string} [options.platform]
   * @param {import('@prisma/client').PrismaClient} [options.prisma]
   * @returns {Promise<{
   *   success: boolean;
   *   data: {
   *     postsDeleted: number;
   *     commentsDeleted: number;
   *     checkpointsDeleted: number;
   *     postsEligible?: number;
   *     commentsEligible?: number;
   *     checkpointsEligible?: number;
   *     batchesExecuted: number;
   *     durationMs: number;
   *     cutoffDate: string;
   *     dryRun: boolean;
   *   };
   * }>}
   */
  async runRetentionPipeline(options = {}) {
    const startTime = Date.now();
    const rawResult = await this.cleanRawCrawlData(options);

    let checkpointsDeleted = 0;
    let checkpointsEligible = 0;

    if (options.cleanCheckpoints !== false) {
      const checkpointResult = await this.cleanCheckpoints({
        checkpointRetentionDays: options.checkpointRetentionDays,
        dryRun: options.dryRun,
        platform: options.platform,
        prisma: options.prisma,
      });
      checkpointsDeleted = checkpointResult.checkpointsDeleted || 0;
      checkpointsEligible = checkpointResult.checkpointsEligible || 0;
    }

    const dryRun = Boolean(options.dryRun);
    return {
      success: rawResult.success,
      data: {
        postsDeleted: rawResult.postsDeleted || 0,
        commentsDeleted: rawResult.commentsDeleted || 0,
        checkpointsDeleted,
        ...(dryRun
          ? {
              postsEligible: rawResult.postsEligible || 0,
              commentsEligible: rawResult.commentsEligible || 0,
              checkpointsEligible,
            }
          : {}),
        batchesExecuted: rawResult.batchesExecuted || 0,
        durationMs: Date.now() - startTime,
        cutoffDate: rawResult.cutoffDate,
        dryRun,
      },
    };
  }
}

export const defaultRetentionCleaner = new RetentionCleaner();

/**
 * Functional helper to clean raw crawl data.
 * @param {Parameters<RetentionCleaner['cleanRawCrawlData']>[0]} options
 */
export async function cleanRawCrawlData(options) {
  return defaultRetentionCleaner.cleanRawCrawlData(options);
}

/**
 * Functional helper to clean checkpoints.
 * @param {Parameters<RetentionCleaner['cleanCheckpoints']>[0]} options
 */
export async function cleanCheckpoints(options) {
  return defaultRetentionCleaner.cleanCheckpoints(options);
}

/**
 * Functional helper to get retention stats.
 * @param {Parameters<RetentionCleaner['getRetentionStats']>[0]} options
 */
export async function getRetentionStats(options) {
  return defaultRetentionCleaner.getRetentionStats(options);
}

/**
 * Functional helper to run retention pipeline.
 * @param {Parameters<RetentionCleaner['runRetentionPipeline']>[0]} options
 */
export async function runRetentionPipeline(options) {
  return defaultRetentionCleaner.runRetentionPipeline(options);
}
