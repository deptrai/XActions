// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions evergreen` command group.
 */
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import fs from 'fs/promises';
import path from 'path';
import { CONFIG_DIR, CONFIG_FILE, loadConfig, saveConfig, formatNumber, parseCliPositiveInt, parseCliNonNegativeInt, printCliError, disconnectPrisma } from '../shared.js';

export function registerEvergreenCommand(program) {
// ============================================================================
// 09-H: Evergreen Content Recycler
// ============================================================================

program
  .command('evergreen <username>')
  .description('Find and recycle top-performing evergreen tweets')
  .option('--min-likes <n>', 'Min likes threshold', '50')
  .option('--min-age <days>', 'Min age in days', '30')
  .option('--analyze', 'Only analyze, don\'t queue')
  .action(async (username, options) => {
    try {
      const { analyzeEvergreenCandidates, createEvergreenQueue } = await import('../../automation/evergreenRecycler.js');
      const spin = ora('Analyzing evergreen candidates...').start();
      const candidates = await analyzeEvergreenCandidates(username, {
        minLikes: parseInt(options.minLikes), minAgeDays: parseInt(options.minAge),
      });
      spin.succeed(`Found ${candidates.length} evergreen candidates`);
      candidates.slice(0, 5).forEach((t, i) => {
        console.log(`  ${i + 1}. ${chalk.dim(t.text?.substring(0, 60))}... (${t.likes} ❤️)`);
      });
      if (!options.analyze && candidates.length > 0) {
        await createEvergreenQueue(username, candidates);
        console.log(chalk.green(`✅ Evergreen queue created with ${candidates.length} tweets`));
      }
    } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
  });

}
