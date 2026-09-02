// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// by nichxbt
/**
 * `xactions retention` CLI command group.
 * Story 10.6: Data retention cleanup and status commands.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import chalk from 'chalk';
import { parseCliPositiveInt, parseCliNonNegativeInt, printCliError, disconnectPrismaUnlessShared } from '../shared.js';

export function registerRetentionCommand(program) {
  const retentionCmd = program
    .command('retention')
    .description('Manage data retention lifecycle & cleanup jobs (Post, Comment, Checkpoint)');

  retentionCmd
    .command('run')
    .description('Run data retention cleanup job for raw crawl data and terminal checkpoints')
    .option('-d, --days <n>', 'Raw crawl retention threshold in days (default: 30)')
    .option('-c, --checkpoint-days <n>', 'Checkpoint retention threshold in days (default: 90)')
    .option('-b, --batch-size <n>', 'Batch size for deletion (default: 1000)')
    .option('--delay <ms>', 'Delay between deletion batches in ms (default: 50)')
    .option('--dry-run', 'Estimate eligible records without deleting', false)
    .option('--checkpoints', 'Include completed/failed checkpoints in cleanup', true)
    .option('--no-checkpoints', 'Skip checkpoint cleanup')
    .option('-p, --platform <platform>', 'Filter by platform')
    .option('--json', 'Output results as JSON')
    .action(async (options) => {
      let prisma;
      try {
        const { default: sharedPrisma } = await import('../../../api/lib/prisma.js');
        prisma = sharedPrisma;
        const { runGuardedRetention } = await import('../../../api/services/retentionScheduler.js');

        const retentionDays = options.days ? parseCliPositiveInt(options.days, 'days') : undefined;
        const checkpointRetentionDays = options.checkpointDays
          ? parseCliPositiveInt(options.checkpointDays, 'checkpoint-days')
          : undefined;
        const batchSize = options.batchSize ? parseCliPositiveInt(options.batchSize, 'batch-size') : undefined;
        const batchDelayMs = options.delay ? parseCliNonNegativeInt(options.delay, 'delay') : undefined;
        const dryRun = Boolean(options.dryRun);
        const cleanCheckpointsFlag = options.checkpoints !== false;
        const platform = options.platform ? String(options.platform) : undefined;

        if (!options.json) {
          console.log(chalk.bold(`🔄 Starting retention cleanup ${dryRun ? chalk.yellow('(DRY-RUN)') : ''}...`));
        }

        const result = await runGuardedRetention({
          retentionDays,
          checkpointRetentionDays,
          batchSize,
          batchDelayMs,
          dryRun,
          cleanCheckpoints: cleanCheckpointsFlag,
          platform,
          prisma,
        });

        if (options.json) {
          if (!result.success) process.exitCode = 1;
          console.log(JSON.stringify(result, null, 2));
        } else {
          if (!result.success) {
            console.error(chalk.red(`❌ Retention cleanup failed: ${result.data?.error || 'Unknown error'}`));
            process.exitCode = 1;
            return;
          }

          const { data } = result;
          if (dryRun) {
            console.log(chalk.yellow(`\n🔍 Retention Cleanup Dry-Run Summary:`));
            console.log(`  • Cutoff Date:           ${chalk.cyan(data.cutoffDate)}`);
            console.log(`  • Eligible Posts:        ${chalk.green(data.postsEligible ?? 0)}`);
            console.log(`  • Eligible Comments:     ${chalk.green(data.commentsEligible ?? 0)}`);
            console.log(`  • Eligible Checkpoints:  ${chalk.green(data.checkpointsEligible ?? 0)}`);
            console.log(`  • Duration:              ${chalk.dim(`${data.durationMs}ms`)}`);
            console.log(chalk.dim(`\nNo records were deleted. Run without --dry-run to purge data.`));
          } else {
            console.log(chalk.green(`\n✅ Retention Cleanup Complete:`));
            console.log(`  • Cutoff Date:           ${chalk.cyan(data.cutoffDate)}`);
            console.log(`  • Posts Deleted:         ${chalk.bold(data.postsDeleted)}`);
            console.log(`  • Comments Deleted:      ${chalk.bold(data.commentsDeleted)}`);
            console.log(`  • Checkpoints Deleted:   ${chalk.bold(data.checkpointsDeleted)}`);
            console.log(`  • Batches Executed:      ${data.batchesExecuted}`);
            console.log(`  • Total Duration:        ${chalk.dim(`${data.durationMs}ms`)}`);
          }
        }
      } catch (error) {
        printCliError(error, options);
      } finally {
        // The CLI imports the shared api/lib/prisma.js singleton; do not close it
        // because it is the same connection pool the rest of the process uses.
        await disconnectPrismaUnlessShared(prisma, true);
      }
    });

  retentionCmd
    .command('status')
    .description('Show retention threshold statistics and expired record counts')
    .option('-d, --days <n>', 'Raw crawl retention threshold in days (default: 30)')
    .option('-c, --checkpoint-days <n>', 'Checkpoint retention threshold in days (default: 90)')
    .option('-p, --platform <platform>', 'Filter by platform')
    .option('--json', 'Output statistics as JSON')
    .action(async (options) => {
      let prisma;
      try {
        const { default: sharedPrisma } = await import('../../../api/lib/prisma.js');
        prisma = sharedPrisma;
        const { getRetentionStats } = await import('../../store/retention-cleaner.js');

        const rawDays = options.days ? parseCliPositiveInt(options.days, 'days') : undefined;
        const checkpointDays = options.checkpointDays
          ? parseCliPositiveInt(options.checkpointDays, 'checkpoint-days')
          : undefined;
        const platform = options.platform ? String(options.platform) : undefined;

        const result = await getRetentionStats({
          rawDays,
          checkpointDays,
          platform,
          prisma,
        });

        if (options.json) {
          if (!result.success) process.exitCode = 1;
          console.log(JSON.stringify(result, null, 2));
        } else {
          const { posts, comments, checkpoints, thresholds } = result.data;
          console.log(chalk.bold(`\n📊 Data Retention Status & Breakdown:`));
          console.log(`  Platform:                ${platform || 'all'}`);
          console.log(`  Raw TTL Cutoff:          ${chalk.cyan(thresholds.rawCutoff)} (30d default)`);
          console.log(`  Checkpoint TTL Cutoff:   ${chalk.cyan(thresholds.checkpointCutoff)} (90d default)`);

          console.log(chalk.bold(`\n📝 Posts (${posts.total} total):`));
          console.log(`  • Older than 7 days:     ${posts.olderThan7d}`);
          console.log(`  • Older than 14 days:    ${posts.olderThan14d}`);
          console.log(`  • Older than 30 days:    ${chalk.yellow(posts.olderThan30d)}`);
          console.log(`  • Older than 90 days:    ${chalk.red(posts.olderThan90d)}`);

          console.log(chalk.bold(`\n💬 Comments (${comments.total} total):`));
          console.log(`  • Older than 7 days:     ${comments.olderThan7d}`);
          console.log(`  • Older than 14 days:    ${comments.olderThan14d}`);
          console.log(`  • Older than 30 days:    ${chalk.yellow(comments.olderThan30d)}`);
          console.log(`  • Older than 90 days:    ${chalk.red(comments.olderThan90d)}`);

          console.log(chalk.bold(`\n🎯 Checkpoints (${checkpoints.total} total):`));
          console.log(`  • Eligible for cleanup:  ${chalk.yellow(checkpoints.eligibleForCleanup)}`);
          console.log(`  • By Status:             running: ${checkpoints.byStatus.running}, paused: ${checkpoints.byStatus.paused}, completed: ${checkpoints.byStatus.completed}, failed: ${checkpoints.byStatus.failed}, stalled: ${checkpoints.byStatus.stalled}`);
        }
      } catch (error) {
        printCliError(error, options);
      } finally {
        // Shared singleton — do not fully disconnect, just release any local resources if needed.
        await disconnectPrismaUnlessShared(prisma, true);
      }
    });
}
