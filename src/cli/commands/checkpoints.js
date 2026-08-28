// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions checkpoints` command group.
 */
import chalk from 'chalk';
import { parseCliPositiveInt, parseCliNonNegativeInt, printCliError, disconnectPrisma } from '../shared.js';

export function registerCheckpointsCommand(program) {
// ============================================================================
// 10-D: CrawlCheckpoint Operations
// ============================================================================

const checkpointsCmd = program.command('checkpoints').description('Manage crawler checkpoints (resume/pause/retry)');

checkpointsCmd.command('list')
  .description('List crawl checkpoints with filtering and pagination')
  .option('-p, --platform <platform>', 'Filter by platform')
  .option('-t, --target-type <type>', 'Filter by target type (profile, group, hashtag, etc.)')
  .option('-k, --target-key <key>', 'Filter by target key substring')
  .option('-s, --status <status>', 'Filter by status (running, paused, failed, completed, stalled)')
  .option('-l, --limit <limit>', 'Max checkpoints to return', '50')
  .option('-o, --offset <offset>', 'Offset for pagination', '0')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    let prisma;
    try {
      const { default: sharedPrisma } = await import('../../../api/lib/prisma.js');
      prisma = sharedPrisma;
      const { listCheckpoints } = await import('../../store/checkpoint-manager.js');
      const result = await listCheckpoints({
        platform: options.platform,
        targetType: options.targetType,
        targetKey: options.targetKey,
        status: options.status,
        limit: parseCliPositiveInt(options.limit, 'limit'),
        offset: parseCliNonNegativeInt(options.offset, 'offset'),
        prisma,
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (result.checkpoints.length === 0) {
          console.log(chalk.dim('No checkpoints found'));
          return;
        }
        console.log(chalk.bold(`Checkpoints (Total: ${result.total}, Showing: ${result.checkpoints.length}):`));
        result.checkpoints.forEach((ckpt) => {
          const statusColor =
            ckpt.status === 'running' ? chalk.green :
            ckpt.status === 'paused' ? chalk.yellow :
            ckpt.status === 'failed' ? chalk.red :
            ckpt.status === 'completed' ? chalk.blue : chalk.magenta;
          console.log(`  • [${statusColor(ckpt.status)}] ${chalk.cyan(ckpt.id)} | ${ckpt.platform}::${ckpt.targetType}::${ckpt.targetKey} | cursor: ${chalk.dim(ckpt.lastCursor || 'none')} | errors: ${ckpt.errorCount}`);
        });
      }
    } catch (error) {
      printCliError(error, options);
    } finally {
      await disconnectPrisma(prisma);
    }
  });

checkpointsCmd.command('show <id>')
  .description('Show details of a specific checkpoint')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    let prisma;
    try {
      const { default: sharedPrisma } = await import('../../../api/lib/prisma.js');
      prisma = sharedPrisma;
      const { getCheckpoint } = await import('../../store/checkpoint-manager.js');
      const checkpoint = await getCheckpoint(id, { prisma });

      if (options.json) {
        console.log(JSON.stringify(checkpoint, null, 2));
      } else {
        console.log(chalk.bold(`Checkpoint Details (${checkpoint.id}):`));
        console.log(`  Platform:       ${checkpoint.platform}`);
        console.log(`  Target:         ${checkpoint.targetType} -> ${checkpoint.targetKey}`);
        console.log(`  Status:         ${checkpoint.status}`);
        console.log(`  Last Cursor:    ${checkpoint.lastCursor || 'none'}`);
        console.log(`  Last Timestamp: ${checkpoint.lastTimestamp || 'none'}`);
        console.log(`  Last Crawled:   ${checkpoint.lastCrawledAt ? new Date(checkpoint.lastCrawledAt).toISOString() : 'never'}`);
        console.log(`  Next Scheduled: ${checkpoint.nextScheduledAt ? new Date(checkpoint.nextScheduledAt).toISOString() : 'none'}`);
        console.log(`  Error Count:    ${checkpoint.errorCount}`);
      }
    } catch (error) {
      printCliError(error, options);
    } finally {
      await disconnectPrisma(prisma);
    }
  });

checkpointsCmd.command('resume <id>')
  .description('Resume a paused/failed/stalled checkpoint')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    let prisma;
    try {
      const { default: sharedPrisma } = await import('../../../api/lib/prisma.js');
      prisma = sharedPrisma;
      const { resumeCheckpoint } = await import('../../store/checkpoint-manager.js');
      const checkpoint = await resumeCheckpoint(id, { prisma });

      if (options.json) {
        console.log(JSON.stringify(checkpoint, null, 2));
      } else {
        console.log(chalk.green(`✅ Resumed checkpoint ${id}: status = ${checkpoint.status}`));
      }
    } catch (error) {
      printCliError(error, options);
    } finally {
      await disconnectPrisma(prisma);
    }
  });

checkpointsCmd.command('pause <id>')
  .description('Pause a running/stalled checkpoint')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    let prisma;
    try {
      const { default: sharedPrisma } = await import('../../../api/lib/prisma.js');
      prisma = sharedPrisma;
      const { pauseCheckpoint } = await import('../../store/checkpoint-manager.js');
      const checkpoint = await pauseCheckpoint(id, { prisma });

      if (options.json) {
        console.log(JSON.stringify(checkpoint, null, 2));
      } else {
        console.log(chalk.yellow(`⏸️ Paused checkpoint ${id}: status = ${checkpoint.status}`));
      }
    } catch (error) {
      printCliError(error, options);
    } finally {
      await disconnectPrisma(prisma);
    }
  });

checkpointsCmd.command('retry <id>')
  .description('Retry a failed/stalled checkpoint (resets errorCount and schedules immediately)')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    let prisma;
    try {
      const { default: sharedPrisma } = await import('../../../api/lib/prisma.js');
      prisma = sharedPrisma;
      const { retryCheckpoint } = await import('../../store/checkpoint-manager.js');
      const checkpoint = await retryCheckpoint(id, { prisma });

      if (options.json) {
        console.log(JSON.stringify(checkpoint, null, 2));
      } else {
        console.log(chalk.green(`🔄 Retried checkpoint ${id}: status = ${checkpoint.status}, errorCount = 0`));
      }
    } catch (error) {
      printCliError(error, options);
    } finally {
      await disconnectPrisma(prisma);
    }
  });

}
