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
  if (isProcessing) {
    console.warn('⚠️ [RetentionScheduler] Previous cleanup cycle is still running. Skipping overlapping run.');
    return { executed: false, skipped: true, reason: 'overlapping_run' };
  }

  isProcessing = true;
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
