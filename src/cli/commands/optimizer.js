// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions optimizer` command group.
 */
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import fs from 'fs/promises';
import path from 'path';
import { CONFIG_DIR, CONFIG_FILE, loadConfig, saveConfig, formatNumber, parseCliPositiveInt, parseCliNonNegativeInt, printCliError, disconnectPrisma } from '../shared.js';

export function registerOptimizerCommands(program) {
// ============================================================================
// 09-J: AI Content Optimizer
// ============================================================================

program
  .command('optimize <text>')
  .description('AI-optimize a tweet for engagement')
  .option('--goal <goal>', 'Optimization goal: engagement, clarity, growth, viral', 'engagement')
  .action(async (text, options) => {
    try {
      const { optimizeTweet } = await import('../../ai/contentOptimizer.js');
      const spin = ora('Optimizing...').start();
      const result = await optimizeTweet(text, { goal: options.goal });
      spin.succeed('Optimized!');
      console.log(`\n${chalk.bold('Original:')} ${text}`);
      console.log(`${chalk.bold('Optimized:')} ${result.optimized}`);
      if (result.suggestions?.length) {
        console.log(`\n${chalk.bold('Tips:')}`);
        result.suggestions.forEach(s => console.log(`  💡 ${s}`));
      }
    } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
  });

program
  .command('hashtags <text>')
  .description('Suggest hashtags for tweet text')
  .option('-n, --count <n>', 'Number of hashtags', '5')
  .action(async (text, options) => {
    try {
      const { suggestHashtags } = await import('../../ai/contentOptimizer.js');
      const result = await suggestHashtags(text, { count: parseInt(options.count) });
      console.log(`${chalk.bold('Suggested hashtags:')}`);
      result.hashtags?.forEach(h => console.log(`  #${h}`));
    } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
  });

program
  .command('predict <text>')
  .description('Predict tweet performance')
  .action(async (text) => {
    try {
      const { predictPerformance } = await import('../../ai/contentOptimizer.js');
      const result = await predictPerformance(text);
      console.log(`\n${chalk.bold('Performance Prediction:')}`);
      console.log(`  Score: ${result.score}/100`);
      console.log(`  Reach: ${result.estimatedReach || '—'}`);
      if (result.strengths?.length) result.strengths.forEach(s => console.log(`  ✅ ${s}`));
      if (result.weaknesses?.length) result.weaknesses.forEach(w => console.log(`  ⚠️  ${w}`));
    } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
  });

program
  .command('variations <text>')
  .description('Generate tweet variations')
  .option('-n, --count <n>', 'Number of variations', '3')
  .action(async (text, options) => {
    try {
      const { generateVariations } = await import('../../ai/contentOptimizer.js');
      const result = await generateVariations(text, parseInt(options.count));
      console.log(`${chalk.bold('Variations:')}`);
      result.forEach((v, i) => console.log(`\n  ${i + 1}. ${v}`));
    } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
  });

}
