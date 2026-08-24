// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions auth` — Chrome DevTools Protocol (CDP) remote attach launch helper.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import chalk from 'chalk';
import ora from 'ora';
import { launchChrome, getDefaultUserDataDir } from '../../core/cdp-launcher.js';

/**
 * Register the auth command.
 *
 * @param {import('commander').Command} program
 * @param {Object} [config={}]
 * @param {(...args: any[]) => void | Promise<void>} [config.actionOverride]
 */
export function registerAuthCommand(program, config = {}) {
  const cmd = program
    .command('auth')
    .description('Manage browser authentication and CDP remote attach helper')
    .option('--launch-chrome', 'Launch Chrome with remote debugging port enabled')
    .option('--port <port>', 'Remote debugging port', '9222')
    .option('--user-data-dir <path>', 'Dedicated Chrome user profile directory')
    .option('--chrome-path <path>', 'Custom path to Chrome executable')
    .option('--headless', 'Run Chrome in headless mode (default: false)');

  /**
   * @param {{ launchChrome?: boolean, port?: string, userDataDir?: string, chromePath?: string, headless?: boolean }} [options]
   */
  const handler = config.actionOverride || (async (options = {}) => {
    if (options.launchChrome) {
      const isTTY = Boolean(process.stdout.isTTY);
      const spinner = isTTY ? ora('Launching Chrome with remote debugging port...').start() : null;

      try {
        const port = Number(options.port) || 9222;
        const userDataDir = options.userDataDir || getDefaultUserDataDir();

        const result = await launchChrome({
          port,
          userDataDir,
          chromePath: options.chromePath,
          headless: Boolean(options.headless),
        });

        if (spinner) {
          spinner.succeed(`Chrome is ready with remote debugging on port ${port}`);
        } else {
          console.log(`[CDP] Chrome is ready with remote debugging on port ${port}`);
        }

        if (result.alreadyRunning) {
          console.log(chalk.yellow(`\n[CDP NOTE] An existing Chrome instance was already listening on port ${port}. Using existing session.`));
        }

        console.log(chalk.cyan(`\nCDP listening on http://localhost:${port}`));
        console.log(chalk.gray(`Profile directory: ${userDataDir}\n`));
        console.log(chalk.white('Next steps:'));
        console.log(chalk.gray('1. Open your target platforms (LinkedIn, TopCV, Facebook, etc.) in the opened Chrome browser.'));
        console.log(chalk.gray('2. Log in manually. Your session cookies and fingerprint will be preserved.'));
        console.log(chalk.gray('3. Run your XActions scraper commands with CDP attach enabled.\n'));
      } catch (err) {
        if (spinner) {
          spinner.fail('Failed to launch Chrome for CDP');
        }
        const errorMsg = err instanceof Error ? err.message : 'Unknown error occurred while launching Chrome.';
        console.error(chalk.red(`\n${errorMsg}\n`));
        process.exitCode = 1;
      }
      return;
    }

    cmd.outputHelp();
  });

  cmd.action(handler);
  return cmd;
}
