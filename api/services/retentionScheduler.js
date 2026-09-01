// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// by nichxbt
/**
 * Retention Scheduler Service.
 * Runs automated daily retention cleanup for raw crawl data (Post & Comment) and terminal checkpoints.
 * Default schedule: 0 3 * * * (03:00 AM UTC).
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import cron from 'node-cron';
import { defaultRetentionCleaner } from '../../src/store/retention-cleaner.js';

let cronTask = null;
let isProcessing = false;
let schedulerStarted = false;
let shutdownRequested = false;

const RETENTION_ADVISORY_LOCK_KEY = 123456789;

/**
 * Resolve a Prisma client instance.
 * @param {import('@prisma/client').PrismaClient} [prisma]
 * @returns {Promise<import('@prisma/client').PrismaClient>}
 */
async function resolvePrisma(prisma) {
  if (prisma) return prisma;
  const { default: resolved } = await import('../../api/lib/prisma.js');
  return resolved;
}

/**
 * Acquire the retention processing lock.
 * Uses a PostgreSQL advisory lock so the mutex is shared across processes (CLI, API, scheduler).
 * @param {import('@prisma/client').PrismaClient} [prisma]
 * @returns {Promise<boolean>} true if the lock was acquired
 */
export async function acquireRetentionLock(prisma) {
  const client = await resolvePrisma(prisma);
  const [{ pg_try_advisory_lock: acquired }] = await client.$queryRaw`
    SELECT pg_try_advisory_lock(${RETENTION_ADVISORY_LOCK_KEY}::bigint) AS pg_try_advisory_lock
  `;
  if (acquired) {
    isProcessing = true;
    return true;
  }
  return false;
}

/**
 * Release the retention processing lock.
 * @param {import('@prisma/client').PrismaClient} [prisma]
 */
export async function releaseRetentionLock(prisma) {
  isProcessing = false;
  try {
    const client = await resolvePrisma(prisma);
    await client.$queryRaw`SELECT pg_advisory_unlock(${RETENTION_ADVISORY_LOCK_KEY}::bigint)`;
  } catch (err) {
    console.error('❌ [RetentionScheduler] Failed to release advisory lock:', err);
  }
}

/**
 * Query whether a retention run is currently in progress.
 * @returns {boolean}
 */
export function getIsProcessing() {
  return isProcessing;
}

/**
 * Execute a single cycle of the retention cleanup.
 * Uses mutex flag isProcessing to prevent overlapping executions.
 *
 * @param {Object} [options]
 * @param {import('../../src/store/retention-cleaner.js').RetentionCleaner} [options.cleaner]
 * @param {import('@prisma/client').PrismaClient} [options.prisma]
 * @returns {Promise<{
 *   executed: boolean;
 *   skipped?: boolean;
 *   result?: any;
 *   error?: string;
 * }>}
 */
export async function runRetentionCycle(options = {}) {
  if (!(await acquireRetentionLock(options.prisma))) {
    console.warn('⚠️ [RetentionScheduler] Previous cleanup cycle is still running. Skipping overlapping run.');
    return { executed: false, skipped: true, reason: 'overlapping_run' };
  }
  const startTime = Date.now();
  console.log('🔄 [RetentionScheduler] Starting daily retention cleanup job...');

  try {
    const cleaner = options.cleaner || defaultRetentionCleaner;
    const result = await cleaner.runRetentionPipeline({
      prisma: options.prisma,
      cleanCheckpoints: true,
    });

    const elapsed = Date.now() - startTime;
    if (result.success) {
      console.log(
        `✅ [RetentionScheduler] Retention cleanup finished in ${elapsed}ms: ` +
        `${result.data.postsDeleted} posts, ${result.data.commentsDeleted} comments, ` +
        `${result.data.checkpointsDeleted} checkpoints deleted (${result.data.batchesExecuted} batches).`
      );
    } else {
      console.error(`❌ [RetentionScheduler] Retention cleanup completed with errors: ${result.data.error || 'Unknown error'}`);
    }

    return { executed: true, result };
  } catch (err) {
    console.error('❌ [RetentionScheduler] Unhandled error during retention cycle:', err);
    return { executed: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    isProcessing = false;
    if (shutdownRequested) {
      stopRetentionScheduler();
    }
    await releaseRetentionLock(options.prisma);
  }
}

/**
 * Run a guarded retention pipeline under the shared scheduler lock.
 * This is the single entry point used by the cron scheduler, admin API, and CLI.
 *
 * @param {Object} [options]
 * @param {import('../../src/store/retention-cleaner.js').RetentionCleaner} [options.cleaner]
 * @param {import('@prisma/client').PrismaClient} [options.prisma]
 * @param {number} [options.retentionDays]
 * @param {number} [options.checkpointRetentionDays]
 * @param {number} [options.batchSize]
 * @param {number} [options.batchDelayMs]
 * @param {boolean} [options.dryRun]
 * @param {boolean} [options.cleanCheckpoints]
 * @param {string} [options.platform]
 * @returns {Promise<import('../../src/store/retention-cleaner.js').RunRetentionPipelineResult>}
 */
export async function runGuardedRetention(options = {}) {
  if (!(await acquireRetentionLock(options.prisma))) {
    throw new Error('Retention cleanup is already running (overlapping_run)');
  }

  try {
    const cleaner = options.cleaner || defaultRetentionCleaner;
    return await cleaner.runRetentionPipeline(options);
  } finally {
    await releaseRetentionLock(options.prisma);
  }
}

/**
 * Start the daily background retention scheduler.
 *
 * @param {Object} [options]
 * @param {string} [options.schedule] - Cron schedule expression (default: 0 3 * * *)
 * @param {import('../../src/store/retention-cleaner.js').RetentionCleaner} [options.cleaner]
 * @param {import('@prisma/client').PrismaClient} [options.prisma]
 * @returns {boolean} True if started, false if already running or disabled
 */
export function startRetentionScheduler(options = {}) {
  if (process.env.ENABLE_RETENTION_SCHEDULER === 'false') {
    console.log('ℹ️ [RetentionScheduler] Retention scheduler disabled via ENABLE_RETENTION_SCHEDULER=false');
    return false;
  }

  if (schedulerStarted && cronTask) {
    console.warn('⚠️ [RetentionScheduler] Scheduler already started, skipping duplicate startup.');
    return false;
  }

  const scheduleExpr = options.schedule || process.env.RETENTION_CRON_SCHEDULE || '0 3 * * *';

  if (!cron.validate(scheduleExpr)) {
    console.error(`❌ [RetentionScheduler] Invalid cron schedule expression: "${scheduleExpr}". Scheduler not started.`);
    return false;
  }

  cronTask = cron.schedule(scheduleExpr, async () => {
    try {
      await runRetentionCycle(options);
    } catch (err) {
      console.error('❌ [RetentionScheduler] Cron tick error:', err);
    }
  });

  schedulerStarted = true;
  console.log(`🔄 [RetentionScheduler] Daily retention scheduler registered (cron: "${scheduleExpr}")`);
  return true;
}

/**
 * Request a graceful scheduler shutdown and stop any in-flight run.
 * Call this from SIGTERM/SIGINT handlers.
 */
export function requestRetentionShutdown() {
  shutdownRequested = true;
  stopRetentionScheduler();
  if (isProcessing) {
    console.log('🛑 [RetentionScheduler] Shutdown requested; waiting for in-flight cleanup to finish.');
    return true;
  }
  return false;
}

/**
 * Stop the background retention scheduler gracefully.
 * @returns {boolean}
 */
export function stopRetentionScheduler() {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    schedulerStarted = false;
    console.log('🛑 [RetentionScheduler] Daily retention scheduler stopped.');
    return true;
  }
  return false;
}

/**
 * Get current status of the retention scheduler.
 * @returns {{ started: boolean; isProcessing: boolean }}
 */
export function getRetentionSchedulerStatus() {
  return {
    started: schedulerStarted && cronTask !== null,
    isProcessing,
  };
}
