// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions audience` command group.
 */
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import fs from 'fs/promises';
import path from 'path';
import { CONFIG_DIR, CONFIG_FILE, loadConfig, saveConfig, formatNumber, parseCliPositiveInt, parseCliNonNegativeInt, printCliError, disconnectPrisma } from '../shared.js';

export function registerAudienceCommand(program) {
// ============================================================================
// 09-B: Audience Overlap
// ============================================================================

program
  .command('audience <username1> <username2>')
  .description('Analyze follower overlap between two accounts')
  .option('--max <n>', 'Max followers to fetch per account', '5000')
  .action(async (username1, username2, options) => {
    try {
      const { analyzeOverlap } = await import('../../analytics/audienceOverlap.js');
      const spin = ora('Analyzing audience overlap...').start();
      const result = await analyzeOverlap(username1, username2, { maxFollowers: parseInt(options.max) });
      spin.succeed('Overlap analysis complete');
      console.log(`\n${chalk.bold('Overlap:')} ${result.overlapCount} users (${result.overlapPercent}%)`);
      console.log(`${chalk.blue('@' + username1)} unique: ${result.uniqueToA}`);
      console.log(`${chalk.blue('@' + username2)} unique: ${result.uniqueToB}`);
    } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
  });

}
