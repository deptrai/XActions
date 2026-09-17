// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Universal scraping & crawler action discovery commands for XActions CLI.
 *
 * Exposes:
 * - `xactions scrape`
 * - `xactions actions-list`
 * - `xactions actions` (alias/compat)
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import chalk from 'chalk';
import { registerScrapeCommand } from './scrape.js';
import { executeActionListTool } from '../../scrapers/social/actions-list.js';

/**
 * Handle listing available actions.
 * @param {{ platform?: string }} options
 */
async function handleActionsList(options) {
  try {
    const actions = await executeActionListTool({ platform: options.platform });
    console.log(JSON.stringify(actions, null, 2));
  } catch (error) {
    console.error(chalk.red(`❌ ${error instanceof Error ? error.message : error}`));
    process.exitCode = 1;
  }
}

/**
 * Register universal scraping commands on the Commander program.
 *
 * @param {import('commander').Command} program
 */
export function registerScrapingCommands(program) {
  // Register unified multi-platform scrape command
  registerScrapeCommand(program);

  // Register action discovery command
  program
    .command('actions-list')
    .description('List available crawler actions across platforms')
    .option('--platform <platform>', 'Filter by platform')
    .action(handleActionsList);

  // Preserve 'actions' command for full backward compatibility
  program
    .command('actions')
    .description('List available crawler actions')
    .option('--platform <platform>', 'Filter by platform')
    .action(handleActionsList);
}

export { registerScrapeCommand };
