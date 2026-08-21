// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions agent` command group.
 */
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import fs from 'fs/promises';
import path from 'path';
import { CONFIG_DIR, CONFIG_FILE, loadConfig, saveConfig, formatNumber, parseCliPositiveInt, parseCliNonNegativeInt, printCliError, disconnectPrisma } from '../shared.js';
import prisma from '../../../api/lib/prisma.js';

export function registerAgentCommand(program) {
// ============================================================================
// Agent — Thought Leader Agent commands
// ============================================================================

const agentCmd = program.command('agent').description('24/7 LLM-powered thought leadership agent');

agentCmd
  .command('start')
  .description('Start the thought leader agent')
  .option('-c, --config <path>', 'Config file path', 'data/agent-config.json')
  .action(async (options) => {
    try {
      const { ThoughtLeaderAgent } = await import('../../agents/thoughtLeaderAgent.js');
      const config = ThoughtLeaderAgent.loadConfig(options.config);
      const agent = new ThoughtLeaderAgent(config);

      const shutdown = async () => {
        await agent.stop();
        try {
          await prisma.$disconnect();
        } catch (err) {
          console.error(chalk.red('❌ Prisma disconnect error:'), err.message);
          process.exitCode = 1;
        }
        process.exit(process.exitCode || 0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      await agent.start();
    } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); process.exit(1); }
  });

agentCmd
  .command('test')
  .description('Run the agent for 5 minutes (test mode)')
  .option('-c, --config <path>', 'Config file path', 'data/agent-config.json')
  .action(async (options) => {
    try {
      const { ThoughtLeaderAgent } = await import('../../agents/thoughtLeaderAgent.js');
      const config = ThoughtLeaderAgent.loadConfig(options.config);
      const agent = new ThoughtLeaderAgent(config);

      setTimeout(async () => {
        console.log('\n⏰ Test time limit reached');
        await agent.stop();
        process.exit(0);
      }, 5 * 60000);

      await agent.start();
    } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); process.exit(1); }
  });

agentCmd
  .command('login')
  .description('Open browser for manual X.com login (saves session cookies)')
  .action(async () => {
    try {
      const { BrowserDriver } = await import('../../agents/browserDriver.js');
      console.log(chalk.cyan('🔑 Login mode — browser will open for manual authentication'));
      const driver = new BrowserDriver({ headless: false, sessionPath: 'data/session.json' });
      await driver.launch();
      await driver.navigate('https://x.com/login');
      console.log(chalk.yellow('👉 Log in manually, then press Enter in this terminal...'));
      await new Promise((resolve) => { process.stdin.once('data', resolve); });
      await driver.saveSession();
      await driver.close();
      console.log(chalk.green('✅ Session saved! You can now run: xactions agent start'));
    } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); process.exit(1); }
  });

agentCmd
  .command('setup')
  .description('Interactive setup wizard for first-time configuration')
  .action(async () => {
    try {
      const { runSetup } = await import('../../agents/setup.js');
      await runSetup();
    } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); process.exit(1); }
  });

agentCmd
  .command('status')
  .description('Show current agent status and today\'s metrics')
  .option('-c, --config <path>', 'Config file path', 'data/agent-config.json')
  .action(async (options) => {
    try {
      const { AgentDatabase } = await import('../../agents/database.js');
      const db = new AgentDatabase('data/agent.db');
      const summary = db.getTodaySummary();
      const llmCost = db.getLLMCostReport(1);
      db.close();

      console.log(chalk.cyan.bold('\n📊 Agent Status — Today'));
      console.log(`  ❤️  Likes:    ${summary.likes || 0}`);
      console.log(`  ➕ Follows:  ${summary.follows || 0}`);
      console.log(`  💬 Comments: ${summary.comments || 0}`);
      console.log(`  ✍️  Posts:    ${summary.posts || 0}`);
      console.log(`  🔖 Bookmarks: ${summary.bookmarks || 0}`);
      console.log(`  🔁 Retweets:  ${summary.retweets || 0}`);
      if (llmCost?.totalCost) {
        console.log(`  🧠 LLM cost:  $${llmCost.totalCost.toFixed(4)}`);
      }
      console.log('');
    } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
  });

agentCmd
  .command('report')
  .description('Generate a growth report for the last N days')
  .option('-d, --days <n>', 'Number of days', '7')
  .action(async (options) => {
    try {
      const { AgentDatabase } = await import('../../agents/database.js');
      const db = new AgentDatabase('data/agent.db');
      const report = db.getGrowthReport(parseInt(options.days));
      const llmCost = db.getLLMCostReport(parseInt(options.days));
      db.close();

      console.log(chalk.cyan.bold(`\n📈 Growth Report — Last ${options.days} days`));
      if (report && report.length > 0) {
        for (const day of report) {
          console.log(`  ${day.date}: ❤️ ${day.likes || 0} | ➕ ${day.follows || 0} | 💬 ${day.comments || 0} | ✍️ ${day.posts || 0}`);
        }
      } else {
        console.log('  No data yet. Run the agent first!');
      }
      if (llmCost?.totalCost) {
        console.log(`\n  🧠 Total LLM cost: $${llmCost.totalCost.toFixed(4)}`);
      }
      console.log('');
    } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
  });

}
