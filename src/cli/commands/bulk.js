// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions bulk` command group.
 */
import chalk from 'chalk';

export function registerBulkCommand(program) {
// ============================================================================
// 09-D: Bulk Operations
// ============================================================================

program
  .command('bulk <action> <file>')
  .description('Bulk follow/unfollow/block/mute/scrape from CSV/JSON/TXT')
  .option('--delay <ms>', 'Delay between actions', '2000')
  .option('--dry-run', 'Preview without executing')
  .option('--resume', 'Resume from last checkpoint')
  .action(async (action, file, options) => {
    try {
      const { parseBulkInput, bulkExecute, bulkScrape } = await import('../../bulk/bulkOperations.js');
      const usernames = await parseBulkInput(file);
      console.log(chalk.blue(`📋 Loaded ${usernames.length} usernames from ${file}`));
      if (action === 'scrape') {
        const result = await bulkScrape(usernames, { delay: parseInt(options.delay), dryRun: options.dryRun });
        console.log(chalk.green(`✅ Scraped ${result.results?.length || 0} profiles`));
      } else {
        const result = await bulkExecute(usernames, action, {
          delay: parseInt(options.delay), dryRun: options.dryRun, resume: options.resume,
        });
        console.log(chalk.green(`✅ Bulk ${action}: ${result.succeeded} succeeded, ${result.failed} failed`));
      }
    } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
  });

}
