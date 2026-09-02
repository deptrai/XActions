// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions actions list` — action discovery for CLI.
 *
 * Reuses the same executeActionListTool logic as the MCP `x_actions_list` tool.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import chalk from 'chalk';
import { executeActionListTool } from '../../scrapers/social/actions-list.js';

/**
 * @param {import('commander').Command} program
 */
export function registerActionsCommand(program) {
  program
    .command('actions')
    .description('List available crawler actions')
    .option('--platform <platform>', 'Filter by platform')
    .action(async (options) => {
      try {
        const actions = await executeActionListTool({ platform: options.platform });
        console.log(JSON.stringify(actions, null, 2));
      } catch (error) {
        console.error(chalk.red(`❌ ${error instanceof Error ? error.message : error}`));
        process.exitCode = 1;
      }
    });
}
