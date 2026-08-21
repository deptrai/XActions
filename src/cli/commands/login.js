// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions login` — session cookie or terminal QR code setup.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import chalk from 'chalk';
import inquirer from 'inquirer';
import { loadConfig, saveConfig } from '../shared.js';

/**
 * Register the login command.
 *
 * @param {import('commander').Command} program
 */
export function registerLoginCommand(program) {
  program
    .command('login')
    .description('Set up authentication with session cookie or terminal QR code')
    .option('--qr', 'Use QR code login')
    .option('--qr-url <url>', 'Provide pre-generated QR URL')
    .option('--push', 'Send push notification for non-TTY')
    .option('--cdp', 'Use CDP attach instead of QR')
    .option('--platform <platform>', 'Platform to authenticate', 'twitter')
    .option('--timeout <seconds>', 'QR timeout', '120')
    .action(async (options = {}) => {
      if (options.cdp) {
        console.log(chalk.cyan('\n⚡ Switching to CDP Remote Attach Mode (Chrome DevTools Protocol on :9222)...'));
        console.log(chalk.gray('Please make sure Chrome is running with: --remote-debugging-port=9222\n'));
        return;
      }

      if (options.push) {
        console.log(chalk.cyan('📲 Push notification requested for QR auth link & short code.'));
      }

      if (options.qr || options.qrUrl || options.push) {
        const parsedTimeout = parseInt(options.timeout || '120', 10);
        const timeoutSec = Number.isNaN(parsedTimeout) || parsedTimeout <= 0 ? 120 : parsedTimeout;

        try {
          const { TerminalQrLogin } = await import('../../core/login/terminal-qr.js');
          const login = new TerminalQrLogin({
            platform: options.platform || 'twitter',
            qrUrl: options.qrUrl,
            timeoutSec,
          });
          await login.login();
        } catch (err) {
          console.error(chalk.red(`\n${err.message || 'Login failed'}`));
          process.exitCode = 1;
        }
        return;
      }

      console.log(chalk.cyan('\n⚡ XActions Login Setup\n'));
      console.log(chalk.gray('To get your session cookies:'));
      console.log(chalk.gray('1. Go to x.com and log in'));
      console.log(chalk.gray('2. Open DevTools (F12) → Application → Cookies → https://x.com'));
      console.log(chalk.gray('3. Copy the values of "auth_token" and "ct0"\n'));
      console.log(
        chalk.gray('   ct0 is the CSRF token. Without it X treats the session as logged out,')
      );
      console.log(chalk.gray('   so search, bookmarks, and DMs stay unavailable.\n'));

      const { cookie, csrf } = await inquirer.prompt([
        {
          type: 'password',
          name: 'cookie',
          message: 'Enter your auth_token cookie:',
          mask: '*',
        },
        {
          type: 'password',
          name: 'csrf',
          message: 'Enter your ct0 cookie (optional, press Enter to skip):',
          mask: '*',
        },
      ]);

      const config = await loadConfig();
      config.authToken = cookie;
      if (csrf) {
        config.csrfToken = csrf;
      } else {
        delete config.csrfToken;
      }
      await saveConfig(config);

      console.log(chalk.green('\n✓ Authentication saved!'));
      if (!csrf) {
        console.log(
          chalk.yellow('  No ct0 saved — login-only endpoints (search, DMs) will still be blocked.\n')
        );
      } else {
        console.log('');
      }
    });
}
