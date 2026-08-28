// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions logout` — remove saved session.
 *
 * Clears everything the login flow can leave behind: the auth_token and ct0
 * values in `~/.xactions/config.json`, plus the full cookie jar that
 * `createHttpScraper()` prefers over them. Leaving any one of the three on
 * disk keeps the CLI authenticated, so a "successful" logout would lie.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import { CONFIG_DIR, loadConfig, saveConfig } from '../shared.js';

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
      delete config.csrfToken;
      await saveConfig(config);
      try {
        await fs.rm(path.join(CONFIG_DIR, 'cookies.json'), { force: true });
      } catch (err) {
        console.warn(`⚠️ Could not remove cookies.json: ${err.message}`);
      }
      console.log(chalk.green('\n✓ Logged out successfully\n'));
    });
}
