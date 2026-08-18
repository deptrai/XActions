// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * CrawlCheckpoint Operational Service & State Machine.
 * Story 10.4 — CRUD, search, and lifecycle transitions (resume / pause / retry).
 * @author nich (@nichxbt)
 * @license MIT
 */

import { PlatformError, ErrorTypes, SuggestedActions } from '../core/error-envelope.js';

export const CHECKPOINT_STATUSES = Object.freeze([
  'running',
  'paused',
  'failed',
  'completed',
  'stalled',
]);

/**
 * @typedef {Object} ListCheckpointsOptions
 * @property {string} [platform]
 * @property {string} [targetType]
 * @property {string} [targetKey]
 * @property {string} [status]
 * @property {number} [limit=50]
 * @property {number} [offset=0]
 * @property {string} [sortBy='updatedAt']
 * @property {'asc'|'desc'} [order='desc']
 * @property {unknown} [prisma]
 */

/**
 * Helper to resolve Prisma client instance.
 * @param {unknown} [injectedPrisma]
 * @returns {Promise<any>}
 */
async function resolvePrisma(injectedPrisma) {
  if (injectedPrisma) return injectedPrisma;
  const { default: sharedPrisma } = await import('../../api/lib/prisma.js');
  return sharedPrisma;
}

/**
 * List checkpoints with pagination, filtering, and sorting.
 * @param {ListCheckpointsOptions} options
 * @returns {Promise<{ checkpoints: any[], total: number, limit: number, offset: number }>}
 */
export async function listCheckpoints(options = {}) {
  const {
    platform,
    targetType,
    targetKey,
    status,
    limit = 50,
    offset = 0,
    sortBy = 'updatedAt',
    order = 'desc',
    prisma: injectedPrisma,
  } = options;

  const prisma = await resolvePrisma(injectedPrisma);

  const rawLimit = Number(limit);
  const rawOffset = Number(offset);

  if (!Number.isFinite(rawLimit) || !Number.isInteger(rawLimit) || rawLimit < 1) {
    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4001',
      message: 'limit must be a positive integer between 1 and 500',
      statusCode: 400,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }

  if (!Number.isFinite(rawOffset) || !Number.isInteger(rawOffset) || rawOffset < 0) {
    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4001',
      message: 'offset must be a non-negative integer',
      statusCode: 400,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }

  const parsedLimit = Math.min(Math.max(rawLimit, 1), 500);
  const parsedOffset = Math.max(rawOffset, 0);

  const where = {};
  if (platform) where.platform = String(platform);
  if (targetType) where.targetType = String(targetType);
  if (status) where.status = String(status);
  if (targetKey) {
    const trimmed = String(targetKey).trim();
    if (trimmed) {
      where.targetKey = {
        contains: trimmed,
        mode: 'insensitive',
      };
    }
  }

  const validSortFields = [
    'updatedAt',
    'createdAt',
    'lastCrawledAt',
    'nextScheduledAt',
    'platform',
    'targetType',
    'status',
  ];
  const safeSortBy = validSortFields.includes(sortBy) ? sortBy : 'updatedAt';
  const safeOrder = order === 'asc' ? 'asc' : 'desc';

  const [checkpoints, total] = await Promise.all([
    prisma.crawlCheckpoint.findMany({
      where,
      take: parsedLimit,
      skip: parsedOffset,
      orderBy: { [safeSortBy]: safeOrder },
    }),
    prisma.crawlCheckpoint.count({ where }),
  ]);

  return {
    checkpoints,
    total,
    limit: parsedLimit,
    offset: parsedOffset,
  };
}

/**
 * Get a single checkpoint by its ID.
 * @param {string} id
 * @param {{ prisma?: unknown }} [options]
 * @returns {Promise<any>}
 */
export async function getCheckpoint(id, options = {}) {
  if (!id || typeof id !== 'string' || id.trim() === '') {
    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4001',
      message: 'Checkpoint ID is required and must be a non-empty string',
      statusCode: 400,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }

  const prisma = await resolvePrisma(options.prisma);
  const checkpoint = await prisma.crawlCheckpoint.findUnique({
    where: { id: id.trim() },
  });

  if (!checkpoint) {
    throw new PlatformError({
      type: ErrorTypes.INTERNAL,
      code: 'XACT_4041',
      message: `Checkpoint not found: ${id}`,
      statusCode: 404,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }

  return checkpoint;
}

/**
 * Resume a paused, failed, or stalled checkpoint.
 * Transitions status to 'running' and sets nextScheduledAt to now if null or in the past.
 * @param {string} id
 * @param {{ prisma?: unknown }} [options]
 * @returns {Promise<any>}
 */
export async function resumeCheckpoint(id, options = {}) {
  const checkpoint = await getCheckpoint(id, options);
  const currentStatus = checkpoint.status;

  const validResumeStates = ['paused', 'failed', 'stalled'];
  if (!validResumeStates.includes(currentStatus)) {
    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4002',
      message: `Cannot resume checkpoint with status "${currentStatus}". Only paused, failed, or stalled checkpoints can be resumed.`,
      statusCode: 400,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }

  const prisma = await resolvePrisma(options.prisma);
  const now = new Date();
  const nextScheduledAt =
    !checkpoint.nextScheduledAt || new Date(checkpoint.nextScheduledAt) <= now
      ? now
      : checkpoint.nextScheduledAt;

  return prisma.crawlCheckpoint.update({
    where: { id: checkpoint.id },
    data: {
      status: 'running',
      nextScheduledAt,
    },
  });
}

/**
 * Pause a running or stalled checkpoint.
 * Transitions status to 'paused' and clears nextScheduledAt.
 * @param {string} id
 * @param {{ prisma?: unknown }} [options]
 * @returns {Promise<any>}
 */
export async function pauseCheckpoint(id, options = {}) {
  const checkpoint = await getCheckpoint(id, options);
  const currentStatus = checkpoint.status;

  const validPauseStates = ['running', 'stalled'];
  if (!validPauseStates.includes(currentStatus)) {
    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4002',
      message: `Cannot pause checkpoint with status "${currentStatus}". Only running or stalled checkpoints can be paused.`,
      statusCode: 400,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }

  const prisma = await resolvePrisma(options.prisma);

  return prisma.crawlCheckpoint.update({
    where: { id: checkpoint.id },
    data: {
      status: 'paused',
      nextScheduledAt: null,
    },
  });
}

/**
 * Retry a failed or stalled checkpoint.
 * Transitions status to 'running', resets errorCount to 0, preserves lastCursor/lastTimestamp, and sets nextScheduledAt to now.
 * @param {string} id
 * @param {{ prisma?: unknown }} [options]
 * @returns {Promise<any>}
 */
export async function retryCheckpoint(id, options = {}) {
  const checkpoint = await getCheckpoint(id, options);
  const currentStatus = checkpoint.status;

  const validRetryStates = ['failed', 'stalled', 'paused'];
  if (!validRetryStates.includes(currentStatus)) {
    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4002',
      message: `Cannot retry checkpoint with status "${currentStatus}". Only failed, stalled, or paused checkpoints can be retried.`,
      statusCode: 400,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }

  const prisma = await resolvePrisma(options.prisma);
  const now = new Date();

  return prisma.crawlCheckpoint.update({
    where: { id: checkpoint.id },
    data: {
      status: 'running',
      errorCount: 0,
      nextScheduledAt: now,
    },
  });
}
