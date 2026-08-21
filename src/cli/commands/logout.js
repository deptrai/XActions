// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions logout` — remove saved session.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import chalk from 'chalk';
import { loadConfig, saveConfig } from '../shared.js';

/**
 * Register the logout command.
 *
 * @param {import('commander').Command} program
 */
export function registerLogoutCommand(program) {
  program
    .command('logout')
    .description('Remove saved authentication')
    .action(async () => {
      const config = await loadConfig();
      delete config.authToken;
      await saveConfig(config);
      console.log(chalk.green('\n✓ Logged out successfully\n'));
    });
}
