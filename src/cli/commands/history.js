// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions history` command group.
 */
import chalk from 'chalk';
import fs from 'fs/promises';
import ora from 'ora';

export function registerHistoryCommands(program) {
// ============================================================================
// 09-A: History & Time-Series Analytics
// ============================================================================

program
  .command('history <username>')
  .description('View account history over time')
  .option('-d, --days <n>', 'Number of days to look back', '30')
  .option('-i, --interval <interval>', 'Grouping interval: hour, day, week', 'day')
  .option('-f, --format <format>', 'Export format: json, csv', 'json')
  .option('--export <path>', 'Export to file')
  .action(async (username, options) => {
    try {
      const { getAccountHistory, exportHistory } = await import('../../analytics/historyStore.js');
      const from = new Date(Date.now() - parseInt(options.days) * 86400000).toISOString();
      const data = getAccountHistory(username, { from, interval: options.interval });
      if (options.export) {
        const exported = exportHistory(username, options.format);
        const fs = await import('fs/promises');
        await fs.writeFile(options.export, exported);
        console.log(chalk.green(`✅ Exported ${data.length} snapshots to ${options.export}`));
      } else {
        console.log(JSON.stringify(data, null, 2));
      }
    } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
  });

program
  .command('snapshot <username>')
  .description('Start auto-snapshotting an account')
  .option('-i, --interval <minutes>', 'Snapshot interval in minutes', '60')
  .action(async (username, options) => {
    try {
      const { startAutoSnapshot } = await import('../../analytics/autoSnapshot.js');
      const result = startAutoSnapshot(username, parseInt(options.interval));
      console.log(chalk.green(`✅ Auto-snapshot started for @${username} every ${options.interval}m`));
      console.log(chalk.dim('Press Ctrl+C to stop'));
      await new Promise(() => {}); // Keep alive
    } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
  });

}
