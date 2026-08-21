// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions notify` command group.
 */
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import fs from 'fs/promises';
import path from 'path';
import { CONFIG_DIR, CONFIG_FILE, loadConfig, saveConfig, formatNumber, parseCliPositiveInt, parseCliNonNegativeInt, printCliError, disconnectPrisma } from '../shared.js';

export function registerNotifyCommand(program) {
// ============================================================================
// 09-L: Notifications
// ============================================================================

const notifyCmd = program.command('notify').description('Notification hub — Email, Slack, Discord, Telegram');

notifyCmd.command('test <channel>').description('Send a test notification').action(async (channel) => {
  try {
    const { getNotifier } = await import('../../notifications/notifier.js');
    const notifier = await getNotifier();
    const result = await notifier.test(channel);
    console.log(chalk.green(`✅ Test notification sent to ${channel}`));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

notifyCmd.command('send <message>').description('Send notification to all channels').option('-t, --title <title>', 'Notification title', 'XActions Alert').option('-s, --severity <level>', 'info, warning, critical', 'info').action(async (message, options) => {
  try {
    const { getNotifier } = await import('../../notifications/notifier.js');
    const notifier = await getNotifier();
    const result = await notifier.send({ title: options.title, message, severity: options.severity });
    console.log(chalk.green('✅ Notification sent'));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

notifyCmd.command('configure').description('Configure notification channels interactively').action(async () => {
  try {
    const { getNotifier } = await import('../../notifications/notifier.js');
    const notifier = await getNotifier();
    const { channel } = await inquirer.prompt([{ type: 'list', name: 'channel', message: 'Configure which channel?', choices: ['slack', 'discord', 'telegram', 'email'] }]);
    if (channel === 'slack' || channel === 'discord') {
      const { webhookUrl } = await inquirer.prompt([{ type: 'input', name: 'webhookUrl', message: `${channel} webhook URL:` }]);
      notifier.configure({ [channel]: { enabled: true, webhookUrl } });
    } else if (channel === 'telegram') {
      const { botToken } = await inquirer.prompt([{ type: 'input', name: 'botToken', message: 'Telegram bot token:' }]);
      const { chatId } = await inquirer.prompt([{ type: 'input', name: 'chatId', message: 'Telegram chat ID:' }]);
      notifier.configure({ telegram: { enabled: true, botToken, chatId } });
    } else if (channel === 'email') {
      const { host } = await inquirer.prompt([{ type: 'input', name: 'host', message: 'SMTP host:' }]);
      const { user } = await inquirer.prompt([{ type: 'input', name: 'user', message: 'SMTP user:' }]);
      const { pass } = await inquirer.prompt([{ type: 'password', name: 'pass', message: 'SMTP password:' }]);
      const { to } = await inquirer.prompt([{ type: 'input', name: 'to', message: 'Send to email:' }]);
      notifier.configure({ email: { enabled: true, smtp: { host, user, pass }, to } });
    }
    console.log(chalk.green(`✅ ${channel} configured`));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

}
