// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions auth` — Chrome DevTools Protocol (CDP) remote attach launch helper.
 *
 * Launches Chrome with remote debugging enabled, then persists the CDP endpoint
 * so crawler commands can attach to the same real-browser profile.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import chalk from 'chalk';
import ora from 'ora';
import fs from 'node:fs/promises';
import { launchChrome, getDefaultUserDataDir } from '../../core/cdp-launcher.js';
import { globalSessionManager } from '../../core/session-manager.js';
import { loadConfig, saveConfig, CONFIG_FILE } from '../shared.js';

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
    .option('--headless', 'Run Chrome in headless mode (default: false)')
    .option('--account-id <accountId>', 'Account ID to associate with this CDP session');

  /**
   * @param {{
   *   launchChrome?: boolean,
   *   port?: string,
   *   userDataDir?: string,
   *   chromePath?: string,
   *   headless?: boolean,
   *   accountId?: string,
   * }} [options]
   */
  const handler = config.actionOverride || (async (options = {}) => {
    if (options.launchChrome) {
      const isTTY = Boolean(process.stdout.isTTY);
      const spinner = isTTY ? ora('Launching Chrome with remote debugging port...').start() : null;

      try {
        const userDataDir = options.userDataDir || getDefaultUserDataDir();
        const accountId = options.accountId || `cdp-${Date.now()}`;

        const result = await launchChrome({
          port: options.port,
          userDataDir,
          chromePath: options.chromePath,
          headless: Boolean(options.headless),
        });

        /**
         * @type {import('../../core/types.js').LoginResult}
         */
        const loginResult = {
          accountId,
          cookies: {},
          tokens: {},
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          cdpUrl: result.cdpUrl,
        };
        globalSessionManager.set(accountId, loginResult);

        // Persist to global config so other CLI invocations can retrieve the CDP session.
        try {
          const configData = /** @type {Record<string, any>} */ (await loadConfig());
          configData.cdpSessions = configData.cdpSessions || {};
          configData.cdpSessions[accountId] = loginResult;
          await saveConfig(configData);
          await fs.chmod(String(CONFIG_FILE), 0o600).catch(() => {});
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[CDP WARNING] Could not persist session to config: ${msg}`);
        }

        // Register signal handlers so Ctrl+C / SIGTERM kill the Chrome we spawned,
        // but a normal CLI exit leaves Chrome running for manual login.
        if (result.kill && !result.alreadyRunning) {
          const cleanup = () => {
            result.kill().catch(() => {});
          };
          process.once('SIGINT', cleanup);
          process.once('SIGTERM', cleanup);
        }

        if (spinner) {
          spinner.succeed(`Chrome is ready with remote debugging on port ${result.port}`);
        } else {
          console.log(`[CDP] Chrome is ready with remote debugging on port ${result.port}`);
        }

        if (result.alreadyRunning) {
          console.log(chalk.yellow(`\n[CDP NOTE] An existing Chrome instance was already listening on port ${result.port}. Using existing session.`));
        }

        console.log(chalk.cyan(`\nAccount ID: ${accountId}`));
        console.log(chalk.cyan(`CDP listening on ${result.cdpUrl}`));
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
