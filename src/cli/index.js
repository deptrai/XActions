#!/usr/bin/env node
// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions CLI
 * Command-line interface for X/Twitter automation
 * 
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 * @license MIT
 */

import prisma from '../../api/lib/prisma.js';

import { Command, Help } from 'commander';
import { VERSION } from '../version.js';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

import scrapers from '../scrapers/index.js';
import { registerConnectCommand } from './commands/connect.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerReportCommand } from './commands/report.js';
import { registerQuickstartCommand } from './commands/quickstart.js';
import { registerCompletionCommand } from './commands/completion.js';
import { registerLoginCommand } from './commands/login.js';
import { registerLogoutCommand } from './commands/logout.js';
import { registerScrapeCommand } from './commands/scrape.js';
import { registerAutomateCommand } from './commands/automate.js';
import { registerReadCommands } from './commands/read.js';
import { registerPluginCommand } from './commands/plugin.js';
import { registerStreamCommand } from './commands/stream.js';
import { registerWorkflowCommand } from './commands/workflow.js';
import { registerGraphCommand } from './commands/graph.js';
import { registerPortabilityCommands } from './commands/portability.js';
import { registerMcpConfigCommand } from './commands/mcp-config.js';
import { registerInfoCommands } from './commands/info.js';
import { renderRootHelp } from './help-groups.js';
import {
  CONFIG_DIR,
  CONFIG_FILE,
  loadConfig,
  saveConfig,
  formatNumber,
  createHttpScraper,
  assertNotEmpty,
  AUTH_HINT,
  smartOutput,
} from './shared.js';

const program = new Command();

// ============================================================================
// Helpers (moved to ./shared.js)
// ============================================================================

// ============================================================================
// CLI Setup
// ============================================================================

program
  .name('xactions')
  .description(chalk.bold('⚡ XActions - The Complete X/Twitter Automation Toolkit'))
  .version(VERSION);

// ============================================================================
// Commands that live in their own modules
//
// index.js is long enough that adding to it makes it harder to read, so
// anything new is registered from src/cli/commands/. Each module owns its
// flags, its rendering and its error handling, and takes whatever it needs
// from here as an explicit dependency rather than reaching back in.
// ============================================================================

registerConnectCommand(program);
registerDoctorCommand(program);
registerReportCommand(program);
registerQuickstartCommand(program, { version: VERSION });
registerCompletionCommand(program);
registerLoginCommand(program);
registerLogoutCommand(program);
registerScrapeCommand(program);
registerAutomateCommand(program);
registerReadCommands(program);
registerPluginCommand(program);
registerStreamCommand(program);
registerWorkflowCommand(program);
registerGraphCommand(program);
registerPortabilityCommands(program);
registerMcpConfigCommand(program);
registerInfoCommands(program);







// ============================================================================
// Analytics Commands
// ============================================================================

program
  .command('sentiment <text>')
  .description('Analyze sentiment of text or tweet content')
  .option('-m, --mode <mode>', 'Analysis mode: rules (default) or llm', 'rules')
  .option('-o, --output <file>', 'Output file (JSON)')
  .action(async (text, options) => {
    const spinner = ora('Analyzing sentiment...').start();
    try {
      const { analyzeSentiment } = await import('../analytics/sentiment.js');
      const result = await analyzeSentiment(text, { mode: options.mode });
      spinner.succeed('Sentiment analysis complete');

      const icon = result.label === 'positive' ? '🟢' : result.label === 'negative' ? '🔴' : '⚪';
      console.log(`\n${icon} ${chalk.bold(result.label.toUpperCase())} (score: ${result.score}, confidence: ${result.confidence})`);
      if (result.keywords.length > 0) {
        console.log(chalk.gray(`   Keywords: ${result.keywords.join(', ')}`));
      }

      if (options.output) {
        const fs = await import('fs/promises');
        await fs.writeFile(options.output, JSON.stringify(result, null, 2));
        console.log(chalk.green(`\n✓ Saved to ${options.output}`));
      }
    } catch (error) {
      spinner.fail('Sentiment analysis failed');
      console.error(chalk.red(error.message));
    }
  });

program
  .command('monitor <target>')
  .description('Start monitoring sentiment for a username or keyword')
  .option('-t, --type <type>', 'Monitor type: mentions, keyword, replies', 'mentions')
  .option('-i, --interval <seconds>', 'Polling interval in seconds', '900')
  .option('-m, --mode <mode>', 'Analysis mode: rules or llm', 'rules')
  .option('--threshold <number>', 'Alert threshold for negative sentiment', '-0.3')
  .option('--webhook <url>', 'Webhook URL for alerts')
  .action(async (target, options) => {
    const spinner = ora(`Starting monitor for ${target}...`).start();
    try {
      const { createMonitor } = await import('../analytics/reputation.js');
      const monitor = createMonitor({
        target,
        type: options.type,
        intervalMs: Math.max(60, parseInt(options.interval)) * 1000,
        sentimentMode: options.mode,
        alertConfig: {
          sentimentThreshold: parseFloat(options.threshold),
          webhookUrl: options.webhook || null,
        },
      });

      spinner.succeed(`Monitor started: ${monitor.id}`);
      console.log(chalk.cyan(`\n📊 Monitoring ${target}`));
      console.log(chalk.gray(`   Type: ${monitor.type}`));
      console.log(chalk.gray(`   Interval: ${monitor.intervalMs / 1000}s`));
      console.log(chalk.gray(`   Mode: ${monitor.sentimentMode}`));
      console.log(chalk.yellow(`\n⚡ Monitor is running. Press Ctrl+C to stop.`));
      console.log(chalk.gray(`   ID: ${monitor.id}`));

      // Keep process alive
      process.on('SIGINT', async () => {
        const { stopMonitor: stop } = await import('../analytics/reputation.js');
        stop(monitor.id);
        console.log(chalk.yellow('\n🛑 Monitor stopped.'));
        try {
          await prisma.$disconnect();
        } catch (err) {
          console.error(chalk.red('❌ Prisma disconnect error:'), err.message);
          process.exitCode = 1;
        }
        process.exit(process.exitCode || 0);
      });

      // Prevent exit
      await new Promise(() => {});
    } catch (error) {
      spinner.fail('Failed to start monitor');
      console.error(chalk.red(error.message));
    }
  });

program
  .command('report <username>')
  .description('Generate a reputation report for a monitored username')
  .option('-p, --period <period>', 'Report period: 24h, 7d, 30d, all', '7d')
  .option('-f, --format <format>', 'Output format: json or markdown', 'markdown')
  .option('-o, --output <file>', 'Output file')
  .action(async (username, options) => {
    const spinner = ora(`Generating report for @${username}...`).start();
    try {
      const { listMonitors, getMonitor, getMonitorHistory } = await import('../analytics/reputation.js');
      const { generateReport } = await import('../analytics/reports.js');

      const monitors = listMonitors();
      const monitor = monitors.find(m =>
        m.target.replace(/^@/, '').toLowerCase() === username.replace(/^@/, '').toLowerCase()
      );

      if (!monitor) {
        spinner.fail(`No active monitor found for @${username}`);
        console.log(chalk.yellow('Start one first with: xactions monitor @' + username));
        return;
      }

      const history = getMonitorHistory(monitor.id, { limit: 10000 });
      const { report, markdown } = generateReport(monitor, history, {
        period: options.period,
        format: options.format,
      });

      spinner.succeed('Report generated');

      if (options.format === 'markdown' && markdown) {
        if (options.output) {
          const fs = await import('fs/promises');
          await fs.writeFile(options.output, markdown);
          console.log(chalk.green(`\n✓ Report saved to ${options.output}`));
        } else {
          console.log('\n' + markdown);
        }
      } else {
        if (options.output) {
          const fs = await import('fs/promises');
          await fs.writeFile(options.output, JSON.stringify(report, null, 2));
          console.log(chalk.green(`\n✓ Report saved to ${options.output}`));
        } else {
          console.log(JSON.stringify(report, null, 2));
        }
      }
    } catch (error) {
      spinner.fail('Failed to generate report');
      console.error(chalk.red(error.message));
    }
  });

program
  .command('platforms')
  .description('List supported social media platforms')
  .action(() => {
    console.log(chalk.bold('\n⚡ Supported Platforms\n'));
    console.log(`  ${chalk.cyan('twitter')}   X/Twitter — Puppeteer-based scraping (requires auth_token)`);
    console.log(`  ${chalk.cyan('bluesky')}   Bluesky — AT Protocol API (no browser needed)`);
    console.log(`  ${chalk.cyan('mastodon')}  Mastodon — REST API (any instance, no browser needed)`);
    console.log(`  ${chalk.cyan('threads')}   Threads — Puppeteer-based scraping`);
    console.log();
    console.log(chalk.gray('Usage: xactions scrape --platform <platform> --action <action> --username <target>'));
    console.log(chalk.gray('Example: xactions scrape --platform bluesky --action profile --username user.bsky.social'));
    console.log(chalk.gray('Example: xactions scrape --platform mastodon --action tweets --username Gargron --instance https://mastodon.social'));
    console.log();
  });

// ============================================================================
// AI Tweet Writer Commands
// ============================================================================

const ai = program
  .command('ai')
  .description('AI Tweet Writer — analyze voice, generate & rewrite tweets');

ai
  .command('analyze <username>')
  .description('Analyze a user\'s writing voice from their tweets')
  .option('-l, --limit <n>', 'Number of tweets to analyze', '100')
  .option('-o, --output <file>', 'Save voice profile to file')
  .option('--json', 'Output as JSON')
  .action(async (username, options) => {
    const config = await loadConfig();
    const token = config.auth_token || process.env.TWITTER_AUTH_TOKEN;
    if (!token) {
      console.error(chalk.red('✗ Auth token required. Run: xactions config --token <auth_token>'));
      process.exit(1);
    }
    const spinner = ora(`Analyzing @${username}'s writing voice...`).start();
    try {
      const { scrapeTweets, createBrowser, createPage, loginWithCookie } = scrapers;
      const { analyzeVoice, summarizeVoiceProfile } = await import('../ai/index.js');
      const browser = await createBrowser();
      const page = await createPage(browser);
      await loginWithCookie(page, token);
      const tweets = await scrapeTweets(page, username, { limit: parseInt(options.limit) });
      await browser.close();
      if (!tweets || tweets.length === 0) {
        spinner.fail(`No tweets found for @${username}`);
        return;
      }
      spinner.text = `Analyzing ${tweets.length} tweets...`;
      const profile = analyzeVoice(username, tweets);
      spinner.succeed(`Voice analysis complete for @${username}`);

      if (options.json) {
        console.log(JSON.stringify(profile, null, 2));
      } else {
        const summary = summarizeVoiceProfile(profile);
        console.log(chalk.bold(`\n🎤 Voice Profile: @${username}\n`));
        console.log(summary);
      }

      if (options.output) {
        await fs.writeFile(options.output, JSON.stringify(profile, null, 2));
        console.log(chalk.green(`\n✓ Voice profile saved to ${options.output}`));
      }
    } catch (error) {
      spinner.fail('Voice analysis failed');
      console.error(chalk.red(error.message));
    }
  });

ai
  .command('generate <topic>')
  .description('Generate tweets in a user\'s voice')
  .option('-v, --voice <username>', 'Username whose voice to mimic (required)')
  .option('-c, --count <n>', 'Number of tweets to generate', '3')
  .option('-s, --style <style>', 'Style: casual, professional, provocative')
  .option('-t, --type <type>', 'Type: tweet or thread', 'tweet')
  .option('-m, --model <model>', 'OpenRouter model to use')
  .option('-k, --api-key <key>', 'OpenRouter API key (or set OPENROUTER_API_KEY)')
  .action(async (topic, options) => {
    if (!options.voice) {
      console.error(chalk.red('✗ --voice <username> is required'));
      process.exit(1);
    }
    const config = await loadConfig();
    const token = config.auth_token || process.env.TWITTER_AUTH_TOKEN;
    const apiKey = options.apiKey || config.openrouter_api_key || process.env.OPENROUTER_API_KEY;
    if (!token) {
      console.error(chalk.red('✗ Auth token required. Run: xactions config --token <auth_token>'));
      process.exit(1);
    }
    if (!apiKey) {
      console.error(chalk.red('✗ OpenRouter API key required. Set OPENROUTER_API_KEY or use --api-key'));
      process.exit(1);
    }
    process.env.OPENROUTER_API_KEY = apiKey;
    if (options.model) process.env.OPENROUTER_MODEL = options.model;

    const spinner = ora(`Scraping @${options.voice}'s tweets...`).start();
    try {
      const { scrapeTweets, createBrowser, createPage, loginWithCookie } = scrapers;
      const { analyzeVoice, generateTweet, generateThread } = await import('../ai/index.js');
      const browser = await createBrowser();
      const page = await createPage(browser);
      await loginWithCookie(page, token);
      const tweets = await scrapeTweets(page, options.voice, { limit: 100 });
      await browser.close();
      if (!tweets || tweets.length === 0) {
        spinner.fail(`No tweets found for @${options.voice}`);
        return;
      }
      const voiceProfile = analyzeVoice(options.voice, tweets);
      spinner.text = `Generating ${options.type === 'thread' ? 'thread' : 'tweets'} about "${topic}"...`;

      if (options.type === 'thread') {
        const result = await generateThread(voiceProfile, { topic, length: parseInt(options.count) });
        spinner.succeed('Thread generated!');
        console.log(chalk.bold(`\n🧵 Thread: ${topic}\n`));
        result.thread.forEach((t, i) => {
          console.log(chalk.cyan(`  ${i + 1}/${result.thread.length}`) + ` ${t}`);
          console.log();
        });
      } else {
        const result = await generateTweet(voiceProfile, {
          topic,
          count: parseInt(options.count),
          style: options.style,
        });
        spinner.succeed('Tweets generated!');
        console.log(chalk.bold(`\n✍️  Generated Tweets: ${topic}\n`));
        result.tweets.forEach((t, i) => {
          console.log(chalk.cyan(`  ${i + 1}.`) + ` ${t}`);
          console.log();
        });
      }
    } catch (error) {
      spinner.fail('Generation failed');
      console.error(chalk.red(error.message));
    }
  });

ai
  .command('rewrite <text>')
  .description('Rewrite a tweet in a user\'s voice')
  .option('-v, --voice <username>', 'Username whose voice to mimic (required)')
  .option('-g, --goal <goal>', 'Goal: more_engaging, shorter, more_professional, funnier', 'more_engaging')
  .option('-c, --count <n>', 'Number of variations', '3')
  .option('-m, --model <model>', 'OpenRouter model to use')
  .option('-k, --api-key <key>', 'OpenRouter API key (or set OPENROUTER_API_KEY)')
  .action(async (text, options) => {
    if (!options.voice) {
      console.error(chalk.red('✗ --voice <username> is required'));
      process.exit(1);
    }
    const config = await loadConfig();
    const token = config.auth_token || process.env.TWITTER_AUTH_TOKEN;
    const apiKey = options.apiKey || config.openrouter_api_key || process.env.OPENROUTER_API_KEY;
    if (!token) {
      console.error(chalk.red('✗ Auth token required. Run: xactions config --token <auth_token>'));
      process.exit(1);
    }
    if (!apiKey) {
      console.error(chalk.red('✗ OpenRouter API key required. Set OPENROUTER_API_KEY or use --api-key'));
      process.exit(1);
    }
    process.env.OPENROUTER_API_KEY = apiKey;
    if (options.model) process.env.OPENROUTER_MODEL = options.model;

    const spinner = ora(`Scraping @${options.voice}'s tweets...`).start();
    try {
      const { scrapeTweets, createBrowser, createPage, loginWithCookie } = scrapers;
      const { analyzeVoice, rewriteTweet } = await import('../ai/index.js');
      const browser = await createBrowser();
      const page = await createPage(browser);
      await loginWithCookie(page, token);
      const tweets = await scrapeTweets(page, options.voice, { limit: 100 });
      await browser.close();
      if (!tweets || tweets.length === 0) {
        spinner.fail(`No tweets found for @${options.voice}`);
        return;
      }
      const voiceProfile = analyzeVoice(options.voice, tweets);
      spinner.text = 'Rewriting tweet...';
      const result = await rewriteTweet(voiceProfile, text, {
        goal: options.goal,
        count: parseInt(options.count),
      });
      spinner.succeed('Tweet rewritten!');
      console.log(chalk.bold('\n✏️  Rewritten Variations:\n'));
      console.log(chalk.gray(`  Original: ${text}\n`));
      result.rewrites.forEach((t, i) => {
        console.log(chalk.cyan(`  ${i + 1}.`) + ` ${t}`);
        console.log();
      });
    } catch (error) {
      spinner.fail('Rewrite failed');
      console.error(chalk.red(error.message));
    }
  });

ai
  .command('calendar <username>')
  .description('Generate a content calendar for the week')
  .option('-d, --days <n>', 'Number of days', '7')
  .option('-p, --posts-per-day <n>', 'Posts per day', '3')
  .option('-t, --topics <topics>', 'Comma-separated topics')
  .option('-o, --output <file>', 'Save calendar to file')
  .option('-m, --model <model>', 'OpenRouter model to use')
  .option('-k, --api-key <key>', 'OpenRouter API key (or set OPENROUTER_API_KEY)')
  .action(async (username, options) => {
    const config = await loadConfig();
    const token = config.auth_token || process.env.TWITTER_AUTH_TOKEN;
    const apiKey = options.apiKey || config.openrouter_api_key || process.env.OPENROUTER_API_KEY;
    if (!token) {
      console.error(chalk.red('✗ Auth token required. Run: xactions config --token <auth_token>'));
      process.exit(1);
    }
    if (!apiKey) {
      console.error(chalk.red('✗ OpenRouter API key required. Set OPENROUTER_API_KEY or use --api-key'));
      process.exit(1);
    }
    process.env.OPENROUTER_API_KEY = apiKey;
    if (options.model) process.env.OPENROUTER_MODEL = options.model;

    const spinner = ora(`Scraping @${username}'s tweets...`).start();
    try {
      const { scrapeTweets, createBrowser, createPage, loginWithCookie } = scrapers;
      const { analyzeVoice, generateWeek } = await import('../ai/index.js');
      const browser = await createBrowser();
      const page = await createPage(browser);
      await loginWithCookie(page, token);
      const tweets = await scrapeTweets(page, username, { limit: 100 });
      await browser.close();
      if (!tweets || tweets.length === 0) {
        spinner.fail(`No tweets found for @${username}`);
        return;
      }
      const voiceProfile = analyzeVoice(username, tweets);
      const topics = options.topics ? options.topics.split(',').map(t => t.trim()) : undefined;
      spinner.text = `Generating ${options.days}-day content calendar...`;
      const result = await generateWeek(voiceProfile, {
        topics,
        postsPerDay: parseInt(options.postsPerDay),
        days: parseInt(options.days),
      });
      spinner.succeed('Content calendar generated!');
      console.log(chalk.bold(`\n📅 Content Calendar for @${username}\n`));
      for (const day of result.calendar) {
        console.log(chalk.cyan.bold(`  ${day.day}`));
        day.posts.forEach((post, i) => {
          const typeIcon = post.type === 'thread' ? '🧵' : '📝';
          console.log(`    ${typeIcon} ${chalk.gray(post.time || '')} ${post.topic}`);
          console.log(`       ${post.content}`);
          console.log();
        });
      }

      if (options.output) {
        await fs.writeFile(options.output, JSON.stringify(result.calendar, null, 2));
        console.log(chalk.green(`✓ Calendar saved to ${options.output}`));
      }
    } catch (error) {
      spinner.fail('Calendar generation failed');
      console.error(chalk.red(error.message));
    }
  });

// ============================================================================
// Persona & Algorithm Builder Commands
// ============================================================================

const personaCmd = program
  .command('persona')
  .description('Manage personas for algorithm building & automated growth');

personaCmd
  .command('create')
  .description('Create a new persona with interactive setup')
  .option('--preset <preset>', 'Use a niche preset (crypto-degen, tech-builder, ai-researcher, growth-marketer, finance-investor, creative-writer)')
  .option('--name <name>', 'Persona name')
  .option('--strategy <strategy>', 'Growth strategy (aggressive, moderate, conservative, thoughtleader)')
  .option('--activity <pattern>', 'Activity pattern (night-owl, early-bird, nine-to-five, always-on, weekend-warrior)')
  .action(async (options) => {
    const { createPersona, savePersona, NICHE_PRESETS, ACTIVITY_PATTERNS, ENGAGEMENT_STRATEGIES } = await import('../personaEngine.js');

    let preset = options.preset;
    let strategy = options.strategy;
    let activityPattern = options.activity;
    let name = options.name;

    // Interactive mode if options not provided
    if (!preset) {
      const presetAnswer = await inquirer.prompt([{
        type: 'list',
        name: 'preset',
        message: '🎯 Choose your niche:',
        choices: Object.entries(NICHE_PRESETS).map(([key, val]) => ({
          name: `${val.name}${val.topics.length ? ' — ' + val.topics.slice(0, 4).join(', ') : ''}`,
          value: key,
        })),
      }]);
      preset = presetAnswer.preset;
    }

    if (!name) {
      const nameAnswer = await inquirer.prompt([{
        type: 'input',
        name: 'name',
        message: '📛 Persona name:',
        default: NICHE_PRESETS[preset]?.name || 'My Persona',
      }]);
      name = nameAnswer.name;
    }

    if (!strategy) {
      const stratAnswer = await inquirer.prompt([{
        type: 'list',
        name: 'strategy',
        message: '📈 Growth strategy:',
        choices: Object.entries(ENGAGEMENT_STRATEGIES).map(([key, val]) => ({
          name: `${val.name} — ${val.description}`,
          value: key,
        })),
      }]);
      strategy = stratAnswer.strategy;
    }

    if (!activityPattern) {
      const actAnswer = await inquirer.prompt([{
        type: 'list',
        name: 'activity',
        message: '🕐 Activity pattern:',
        choices: Object.entries(ACTIVITY_PATTERNS).map(([key, val]) => ({
          name: `${val.name} — ${val.description}`,
          value: key,
        })),
      }]);
      activityPattern = actAnswer.activity;
    }

    // Custom topics if preset is custom
    let customTopics, customSearchTerms, customTargetAccounts;
    if (preset === 'custom') {
      const customAnswers = await inquirer.prompt([
        { type: 'input', name: 'topics', message: '📌 Topics (comma-separated):', },
        { type: 'input', name: 'searchTerms', message: '🔍 Search terms (comma-separated):', },
        { type: 'input', name: 'targetAccounts', message: '🎯 Target accounts to study (comma-separated, no @):', },
        { type: 'input', name: 'tone', message: '🎭 Describe your tone/voice:', default: 'casual, knowledgeable, authentic' },
      ]);
      customTopics = customAnswers.topics.split(',').map(t => t.trim()).filter(Boolean);
      customSearchTerms = customAnswers.searchTerms.split(',').map(t => t.trim()).filter(Boolean);
      customTargetAccounts = customAnswers.targetAccounts.split(',').map(t => t.trim().replace('@', '')).filter(Boolean);
    }

    const persona = createPersona({
      name,
      preset,
      strategy,
      activityPattern,
      topics: customTopics,
      searchTerms: customSearchTerms,
      targetAccounts: customTargetAccounts,
    });

    const filePath = savePersona(persona);
    console.log(chalk.green(`\n✅ Persona "${persona.name}" created!`));
    console.log(chalk.gray(`   ID: ${persona.id}`));
    console.log(chalk.gray(`   Preset: ${preset}`));
    console.log(chalk.gray(`   Strategy: ${strategy}`));
    console.log(chalk.gray(`   Activity: ${activityPattern}`));
    console.log(chalk.gray(`   Topics: ${persona.niche.topics.join(', ')}`));
    console.log(chalk.gray(`   Saved to: ${filePath}`));
    console.log(chalk.cyan(`\n🚀 Start with: xactions persona run ${persona.id}\n`));
  });

personaCmd
  .command('list')
  .description('List all saved personas')
  .action(async () => {
    const { listPersonas } = await import('../personaEngine.js');
    const personas = listPersonas();

    if (personas.length === 0) {
      console.log(chalk.yellow('No personas found. Create one with: xactions persona create'));
      return;
    }

    console.log(chalk.bold('\n🤖 Saved Personas\n'));
    for (const p of personas) {
      const status = p.lastSessionAt ? chalk.green('●') : chalk.gray('○');
      console.log(`  ${status} ${chalk.bold(p.name)} ${chalk.gray(`(${p.id})`)}`);
      console.log(`    Preset: ${p.preset} | Strategy: ${p.strategy}`);
      console.log(`    Sessions: ${p.totalSessions} | Follows: ${p.totalFollows || 0} | Likes: ${p.totalLikes || 0} | Comments: ${p.totalComments || 0}`);
      if (p.lastSessionAt) {
        console.log(`    Last active: ${new Date(p.lastSessionAt).toLocaleString()}`);
      }
      console.log();
    }
  });

personaCmd
  .command('run <personaId>')
  .description('Start the algorithm builder for a persona (runs 24/7)')
  .option('--headless', 'Run in headless mode (default)', true)
  .option('--no-headless', 'Run with visible browser')
  .option('--dry-run', 'Preview actions without executing')
  .option('--sessions <n>', 'Stop after N sessions (0 = infinite)', '0')
  .option('--token <token>', 'X auth token (overrides saved config)')
  .action(async (personaId, options) => {
    const config = await loadConfig();
    const token = options.token || config.authToken || process.env.XACTIONS_SESSION_COOKIE;

    if (!token) {
      console.error(chalk.red('❌ No auth token. Run "xactions login" first, pass --token, or set XACTIONS_SESSION_COOKIE'));
      return;
    }

    console.log(chalk.bold.cyan('\n🤖 XActions Algorithm Builder\n'));
    console.log(chalk.gray('Press Ctrl+C to stop gracefully\n'));

    try {
      const { startAlgorithmBuilder } = await import('../algorithmBuilder.js');

      await startAlgorithmBuilder({
        personaId,
        authToken: token,
        headless: options.headless,
        dryRun: options.dryRun,
        maxSessions: parseInt(options.sessions),
        onSessionComplete: ({ persona, stats, sessionCount }) => {
          console.log(chalk.green(`\n✅ Session #${sessionCount} complete`));
          console.log(chalk.gray(`   Total: ${persona.state.totalLikes} likes, ${persona.state.totalFollows} follows, ${persona.state.totalComments} comments, ${persona.state.totalPosts} posts`));
        },
      });
    } catch (error) {
      console.error(chalk.red(`\n❌ ${error.message}`));
    }
  });

personaCmd
  .command('status <personaId>')
  .description('Show detailed status and stats for a persona')
  .action(async (personaId) => {
    try {
      const { loadPersona } = await import('../personaEngine.js');
      const persona = loadPersona(personaId);

      console.log(chalk.bold(`\n🤖 ${persona.name} — Status Report\n`));
      console.log(chalk.cyan('Identity'));
      console.log(`  ID: ${persona.id}`);
      console.log(`  Preset: ${persona.preset}`);
      console.log(`  Created: ${new Date(persona.createdAt).toLocaleString()}`);
      console.log();

      console.log(chalk.cyan('Niche'));
      console.log(`  Topics: ${persona.niche.topics.join(', ')}`);
      console.log(`  Search terms: ${persona.niche.searchTerms.length}`);
      console.log(`  Target accounts: ${persona.niche.targetAccounts.join(', ') || 'none'}`);
      console.log();

      console.log(chalk.cyan('Strategy'));
      console.log(`  Growth: ${persona.strategy.preset}`);
      console.log(`  Activity: ${persona.activityPattern.preset}`);
      console.log(`  Daily limits: ${persona.strategy.dailyLimits.follows} follows, ${persona.strategy.dailyLimits.likes} likes, ${persona.strategy.dailyLimits.comments} comments`);
      console.log();

      console.log(chalk.cyan('Lifetime Stats'));
      console.log(`  Sessions: ${persona.state.totalSessions}`);
      console.log(`  Follows: ${persona.state.totalFollows}`);
      console.log(`  Likes: ${persona.state.totalLikes}`);
      console.log(`  Comments: ${persona.state.totalComments}`);
      console.log(`  Posts: ${persona.state.totalPosts}`);
      console.log(`  Searches: ${persona.state.totalSearches}`);
      console.log(`  Last active: ${persona.state.lastSessionAt ? new Date(persona.state.lastSessionAt).toLocaleString() : 'never'}`);
      console.log();

      const followedCount = Object.keys(persona.state.followedUsers || {}).length;
      console.log(chalk.cyan('Follow Graph'));
      console.log(`  Users followed: ${followedCount}`);
      console.log(`  Current followers: ${persona.state.currentFollowers}`);
      console.log(`  Target: ${persona.goals.targetFollowers.toLocaleString()}`);
      console.log();
    } catch (error) {
      console.error(chalk.red(`❌ ${error.message}`));
    }
  });

personaCmd
  .command('delete <personaId>')
  .description('Delete a saved persona')
  .action(async (personaId) => {
    try {
      const { deletePersona } = await import('../personaEngine.js');
      const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: `Delete persona ${personaId}? This cannot be undone.`,
        default: false,
      }]);

      if (confirm) {
        deletePersona(personaId);
        console.log(chalk.green(`✅ Persona ${personaId} deleted`));
      }
    } catch (error) {
      console.error(chalk.red(`❌ ${error.message}`));
    }
  });

personaCmd
  .command('edit <personaId>')
  .description('Edit persona configuration')
  .option('--topics <topics>', 'Set topics (comma-separated)')
  .option('--search-terms <terms>', 'Set search terms (comma-separated)')
  .option('--target-accounts <accounts>', 'Set target accounts (comma-separated)')
  .option('--strategy <strategy>', 'Set growth strategy')
  .option('--activity <pattern>', 'Set activity pattern')
  .action(async (personaId, options) => {
    try {
      const { loadPersona, savePersona, ENGAGEMENT_STRATEGIES, ACTIVITY_PATTERNS } = await import('../personaEngine.js');
      const persona = loadPersona(personaId);

      if (options.topics) {
        persona.niche.topics = options.topics.split(',').map(t => t.trim());
      }
      if (options.searchTerms) {
        persona.niche.searchTerms = options.searchTerms.split(',').map(t => t.trim());
      }
      if (options.targetAccounts) {
        persona.niche.targetAccounts = options.targetAccounts.split(',').map(t => t.trim().replace('@', ''));
      }
      if (options.strategy && ENGAGEMENT_STRATEGIES[options.strategy]) {
        persona.strategy = { preset: options.strategy, ...ENGAGEMENT_STRATEGIES[options.strategy] };
      }
      if (options.activity && ACTIVITY_PATTERNS[options.activity]) {
        persona.activityPattern = { preset: options.activity, ...ACTIVITY_PATTERNS[options.activity] };
      }

      persona.updatedAt = new Date().toISOString();
      savePersona(persona);
      console.log(chalk.green(`✅ Persona "${persona.name}" updated`));
    } catch (error) {
      console.error(chalk.red(`❌ ${error.message}`));
    }
  });

// ============================================================================
// 09-A: History & Time-Series Analytics
// ============================================================================

program
  .command('history <username>')
  .description('View account history over time')
  .option('-d, --days <n>', 'Number of days to look back', '30')
  .option('-i, --interval <interval>', 'Grouping interval: hour, day, week', 'day')
  .option('-f, --format <format>', 'Export format: json, csv', 'json')
  .option('--export <path>', 'Export to file')
  .action(async (username, options) => {
    try {
      const { getAccountHistory, exportHistory } = await import('../analytics/historyStore.js');
      const from = new Date(Date.now() - parseInt(options.days) * 86400000).toISOString();
      const data = getAccountHistory(username, { from, interval: options.interval });
      if (options.export) {
        const exported = exportHistory(username, options.format);
        const fs = await import('fs/promises');
        await fs.writeFile(options.export, exported);
        console.log(chalk.green(`✅ Exported ${data.length} snapshots to ${options.export}`));
      } else {
        console.log(JSON.stringify(data, null, 2));
      }
    } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
  });

program
  .command('snapshot <username>')
  .description('Start auto-snapshotting an account')
  .option('-i, --interval <minutes>', 'Snapshot interval in minutes', '60')
  .action(async (username, options) => {
    try {
      const { startAutoSnapshot } = await import('../analytics/autoSnapshot.js');
      const result = startAutoSnapshot(username, parseInt(options.interval));
      console.log(chalk.green(`✅ Auto-snapshot started for @${username} every ${options.interval}m`));
      console.log(chalk.dim('Press Ctrl+C to stop'));
      await new Promise(() => {}); // Keep alive
    } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
  });

// ============================================================================
// 09-B: Audience Overlap
// ============================================================================

program
  .command('audience <username1> <username2>')
  .description('Analyze follower overlap between two accounts')
  .option('--max <n>', 'Max followers to fetch per account', '5000')
  .action(async (username1, username2, options) => {
    try {
      const { analyzeOverlap } = await import('../analytics/audienceOverlap.js');
      const spin = ora('Analyzing audience overlap...').start();
      const result = await analyzeOverlap(username1, username2, { maxFollowers: parseInt(options.max) });
      spin.succeed('Overlap analysis complete');
      console.log(`\n${chalk.bold('Overlap:')} ${result.overlapCount} users (${result.overlapPercent}%)`);
      console.log(`${chalk.blue('@' + username1)} unique: ${result.uniqueToA}`);
      console.log(`${chalk.blue('@' + username2)} unique: ${result.uniqueToB}`);
    } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
  });

// ============================================================================
// 09-C: Follower CRM
// ============================================================================

const crmCmd = program.command('crm').description('Follower CRM — tags, scores, segments');

crmCmd.command('sync <username>').description('Sync followers to CRM').action(async (username) => {
  try {
    const { syncFollowers } = await import('../analytics/followerCRM.js');
    const spin = ora('Syncing followers...').start();
    const result = await syncFollowers(username);
    spin.succeed(`Synced: ${result.added} added, ${result.updated} updated`);
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

crmCmd.command('tag <username> <tag>').description('Tag a contact').action(async (username, tag) => {
  try {
    const { tagContact } = await import('../analytics/followerCRM.js');
    tagContact(username, tag);
    console.log(chalk.green(`✅ Tagged @${username} with "${tag}"`));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

crmCmd.command('search <query>').description('Search contacts').action(async (query) => {
  try {
    const { searchContacts } = await import('../analytics/followerCRM.js');
    const results = searchContacts(query);
    console.log(JSON.stringify(results.slice(0, 20), null, 2));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

crmCmd.command('score').description('Auto-score all contacts').action(async () => {
  try {
    const { autoScore } = await import('../analytics/followerCRM.js');
    const result = autoScore();
    console.log(chalk.green(`✅ Scored ${result.scored} contacts`));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

crmCmd.command('segment <name>').description('Get segment members').action(async (name) => {
  try {
    const { getSegment } = await import('../analytics/followerCRM.js');
    const members = getSegment(name);
    console.log(JSON.stringify(members, null, 2));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

// ============================================================================
// 09-D: Bulk Operations
// ============================================================================

program
  .command('bulk <action> <file>')
  .description('Bulk follow/unfollow/block/mute/scrape from CSV/JSON/TXT')
  .option('--delay <ms>', 'Delay between actions', '2000')
  .option('--dry-run', 'Preview without executing')
  .option('--resume', 'Resume from last checkpoint')
  .action(async (action, file, options) => {
    try {
      const { parseBulkInput, bulkExecute, bulkScrape } = await import('../bulk/bulkOperations.js');
      const usernames = await parseBulkInput(file);
      console.log(chalk.blue(`📋 Loaded ${usernames.length} usernames from ${file}`));
      if (action === 'scrape') {
        const result = await bulkScrape(usernames, { delay: parseInt(options.delay), dryRun: options.dryRun });
        console.log(chalk.green(`✅ Scraped ${result.results?.length || 0} profiles`));
      } else {
        const result = await bulkExecute(usernames, action, {
          delay: parseInt(options.delay), dryRun: options.dryRun, resume: options.resume,
        });
        console.log(chalk.green(`✅ Bulk ${action}: ${result.succeeded} succeeded, ${result.failed} failed`));
      }
    } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
  });

// ============================================================================
// 09-F: Scheduler
// ============================================================================

const schedCmd = program.command('schedule').description('Cron-based task scheduler + tweet scheduling (EPS-2)');

schedCmd.command('add <name> <cron>').description('Add scheduled job').option('-c, --command <cmd>', 'Command to run').action(async (name, cron, options) => {
  try {
    const { getScheduler } = await import('../scheduler/scheduler.js');
    const scheduler = getScheduler();
    scheduler.addJob({ name, cron, action: options.command || 'echo "Job: ' + name + '"' });
    console.log(chalk.green(`✅ Job "${name}" scheduled: ${cron}`));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

schedCmd.command('list').description('List scheduled jobs, or tweet schedules when --status is given (EPS-2)').option('--status <status>', 'Filter tweet schedules by status (pending|running|completed|failed|cancelled)').action(async (options) => {
  try {
    // EPS-2: `schedule list --status [status]` lists DB-backed tweet schedules.
    if (options.status !== undefined) {
      const where = { platform: 'twitter' };
      if (options.status) where.status = String(options.status);
      const schedules = await prisma.schedule.findMany({
        where,
        orderBy: [{ queueOrder: 'asc' }, { scheduledAt: 'asc' }],
        take: 100,
      });
      if (schedules.length === 0) { console.log(chalk.dim('No tweet schedules')); return; }
      for (const s of schedules) {
        const when = s.scheduledAt.toISOString().replace('T', ' ').slice(0, 16);
        const tag = s.thread ? 'thread' : 'tweet';
        const recur = s.recurrenceCron ? chalk.dim(` recur="${s.recurrenceCron}"`) : '';
        console.log(`  ${chalk.cyan(s.id)}  ${when}  ${chalk.yellow(s.status.padEnd(9))}  ${tag}${recur}  ${chalk.dim(s.content.slice(0, 50))}`);
      }
      return;
    }
    const { getScheduler } = await import('../scheduler/scheduler.js');
    const scheduler = getScheduler();
    const jobs = scheduler.listJobs();
    if (jobs.length === 0) { console.log(chalk.dim('No scheduled jobs')); return; }
    jobs.forEach(j => console.log(`  ${j.enabled ? '🟢' : '🔴'} ${j.name}  ${chalk.dim(j.cron)}  ${chalk.dim('Next: ' + (j.nextRun || '—'))}`));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

schedCmd.command('remove <name>').description('Remove a scheduled job').action(async (name) => {
  try {
    const { getScheduler } = await import('../scheduler/scheduler.js');
    getScheduler().removeJob(name);
    console.log(chalk.green(`✅ Job "${name}" removed`));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

schedCmd.command('run <name>').description('Run a job immediately').action(async (name) => {
  try {
    const { getScheduler } = await import('../scheduler/scheduler.js');
    await getScheduler().runJobNow(name);
    console.log(chalk.green(`✅ Job "${name}" executed`));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

// ── EPS-2 Tweet Scheduling ───────────────────────────────────────────────────
// `schedule create` / `schedule cancel` operate on DB-backed tweet schedules.
// `schedule list --status [status]` (above) lists them. The CLI resolves the
// caller's userId from the stored session cookie (auth_token): an existing User
// row with that cookie is reused; otherwise a CLI-local user is provisioned so
// dryRun:false can persist a Schedule row without the dashboard signup flow.
async function resolveCliUserId() {
  const config = await loadConfig();
  const sessionCookie = config.sessionCookie || process.env.XACTIONS_SESSION_COOKIE;
  if (!sessionCookie) {
    throw new Error('No Twitter session cookie found — run `xactions login` or set XACTIONS_SESSION_COOKIE');
  }
  const existing = await prisma.user.findFirst({ where: { sessionCookie } });
  if (existing) return existing.id;
  // Provision a CLI-local user so scheduled tweets have a stable owner.
  const username = `cli_${sessionCookie.slice(0, 8)}`;
  const user = await prisma.user.upsert({
    where: { username },
    update: { sessionCookie },
    create: { username, sessionCookie, isGuest: true, authMethod: 'cli' },
  });
  return user.id;
}

schedCmd.command('create').description('Schedule a tweet or thread for future publishing (EPS-2). Dry-run by default.')
  .requiredOption('-c, --content <text>', 'Tweet text (first tweet of a thread)')
  .requiredOption('-a, --at <iso>', 'ISO-8601 datetime ≥60s in the future')
  .option('--thread <t2,t3,...>', 'Comma-separated follow-up tweet texts (thread)')
  .option('--tz <timezone>', 'IANA timezone to interpret a wall-clock --at (e.g. Europe/London)')
  .option('--recur <cron>', 'node-cron expression; re-arms the schedule after execution')
  .option('--dry-run <bool>', 'Preview without persisting (default: true; set false to create)', (v) => v === 'false' ? false : true, true)
  .action(async (options) => {
    try {
      const { scheduleTweet } = await import('../../api/services/tweetScheduling.js');
      const thread = options.thread ? options.thread.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
      const userId = options.dryRun === false ? await resolveCliUserId() : undefined;
      const result = await scheduleTweet(
        { content: options.content, scheduledAt: options.at, thread, timezone: options.tz, recurrenceCron: options.recur },
        { dryRun: options.dryRun, userId },
      );
      if (result.dryRun) {
        console.log(chalk.cyan('🔍 Dry-run preview (no row persisted):'));
        console.log(`  content:    ${result.preview.content.slice(0, 60)}`);
        console.log(`  scheduledAt:${result.preview.scheduledAt}`);
        if (result.preview.timezone) console.log(`  timezone:   ${result.preview.timezone}`);
        if (result.preview.recurrenceCron) console.log(`  recurrence: ${result.preview.recurrenceCron}`);
        if (result.preview.thread) console.log(`  thread:     ${result.preview.thread.length} follow-up tweet(s)`);
        console.log(chalk.dim(`  set --dry-run false to persist`));
      } else {
        console.log(chalk.green(`✅ Tweet scheduled: ${result.scheduleId} at ${result.scheduledAt} (status: ${result.status})`));
      }
    } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
  });

schedCmd.command('cancel <id>').description('Cancel a pending tweet schedule (EPS-2)').action(async (id) => {
  try {
    const claim = await prisma.schedule.updateMany({
      where: { id, platform: 'twitter', status: 'pending' },
      data: { status: 'cancelled' },
    });
    if (claim.count === 0) {
      const existing = await prisma.schedule.findFirst({ where: { id, platform: 'twitter' }, select: { status: true } });
      if (!existing) { console.error(chalk.red(`❌ Schedule ${id} not found`)); return; }
      console.error(chalk.red(`❌ Cannot cancel schedule in status "${existing.status}" (only pending can be cancelled)`));
      return;
    }
    console.log(chalk.green(`✅ Schedule ${id} cancelled`));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

// ============================================================================
// 09-H: Evergreen Content Recycler
// ============================================================================

program
  .command('evergreen <username>')
  .description('Find and recycle top-performing evergreen tweets')
  .option('--min-likes <n>', 'Min likes threshold', '50')
  .option('--min-age <days>', 'Min age in days', '30')
  .option('--analyze', 'Only analyze, don\'t queue')
  .action(async (username, options) => {
    try {
      const { analyzeEvergreenCandidates, createEvergreenQueue } = await import('../automation/evergreenRecycler.js');
      const spin = ora('Analyzing evergreen candidates...').start();
      const candidates = await analyzeEvergreenCandidates(username, {
        minLikes: parseInt(options.minLikes), minAgeDays: parseInt(options.minAge),
      });
      spin.succeed(`Found ${candidates.length} evergreen candidates`);
      candidates.slice(0, 5).forEach((t, i) => {
        console.log(`  ${i + 1}. ${chalk.dim(t.text?.substring(0, 60))}... (${t.likes} ❤️)`);
      });
      if (!options.analyze && candidates.length > 0) {
        await createEvergreenQueue(username, candidates);
        console.log(chalk.green(`✅ Evergreen queue created with ${candidates.length} tweets`));
      }
    } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
  });

// ============================================================================
// 09-I: RSS Monitor
// ============================================================================

const rssCmd = program.command('rss').description('RSS feed monitoring & auto-posting');

rssCmd.command('add <name> <url>').description('Add an RSS feed').option('-t, --template <template>', 'Post template', '📰 {title}\n\n{link}').action(async (name, url, options) => {
  try {
    const { addFeed } = await import('../automation/rssMonitor.js');
    addFeed({ name, url, template: options.template });
    console.log(chalk.green(`✅ Feed "${name}" added`));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

rssCmd.command('list').description('List all feeds').action(async () => {
  try {
    const { listFeeds } = await import('../automation/rssMonitor.js');
    const feeds = listFeeds();
    if (feeds.length === 0) { console.log(chalk.dim('No feeds configured')); return; }
    feeds.forEach(f => console.log(`  ${f.enabled ? '🟢' : '🔴'} ${f.name}  ${chalk.dim(f.url)}`));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

rssCmd.command('check [name]').description('Check feeds for new items').action(async (name) => {
  try {
    const { checkFeed, checkAllFeeds } = await import('../automation/rssMonitor.js');
    const spin = ora('Checking feeds...').start();
    const result = name ? await checkFeed(name) : await checkAllFeeds();
    const count = name ? result.newItems : result.reduce((s, r) => s + r.newItems, 0);
    spin.succeed(`Found ${count} new items`);
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

rssCmd.command('drafts').description('View draft posts from feeds').action(async () => {
  try {
    const { getDrafts } = await import('../automation/rssMonitor.js');
    const drafts = getDrafts();
    if (drafts.length === 0) { console.log(chalk.dim('No drafts')); return; }
    drafts.forEach((d, i) => console.log(`  ${i + 1}. ${chalk.dim(d.text?.substring(0, 80))}...`));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

// ============================================================================
// 09-J: AI Content Optimizer
// ============================================================================

program
  .command('optimize <text>')
  .description('AI-optimize a tweet for engagement')
  .option('--goal <goal>', 'Optimization goal: engagement, clarity, growth, viral', 'engagement')
  .action(async (text, options) => {
    try {
      const { optimizeTweet } = await import('../ai/contentOptimizer.js');
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
      const { suggestHashtags } = await import('../ai/contentOptimizer.js');
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
      const { predictPerformance } = await import('../ai/contentOptimizer.js');
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
      const { generateVariations } = await import('../ai/contentOptimizer.js');
      const result = await generateVariations(text, parseInt(options.count));
      console.log(`${chalk.bold('Variations:')}`);
      result.forEach((v, i) => console.log(`\n  ${i + 1}. ${v}`));
    } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
  });

// ============================================================================
// 09-L: Notifications
// ============================================================================

const notifyCmd = program.command('notify').description('Notification hub — Email, Slack, Discord, Telegram');

notifyCmd.command('test <channel>').description('Send a test notification').action(async (channel) => {
  try {
    const { getNotifier } = await import('../notifications/notifier.js');
    const notifier = await getNotifier();
    const result = await notifier.test(channel);
    console.log(chalk.green(`✅ Test notification sent to ${channel}`));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

notifyCmd.command('send <message>').description('Send notification to all channels').option('-t, --title <title>', 'Notification title', 'XActions Alert').option('-s, --severity <level>', 'info, warning, critical', 'info').action(async (message, options) => {
  try {
    const { getNotifier } = await import('../notifications/notifier.js');
    const notifier = await getNotifier();
    const result = await notifier.send({ title: options.title, message, severity: options.severity });
    console.log(chalk.green('✅ Notification sent'));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

notifyCmd.command('configure').description('Configure notification channels interactively').action(async () => {
  try {
    const { getNotifier } = await import('../notifications/notifier.js');
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

// ============================================================================
// 09-M: Dataset Management
// ============================================================================

const datasetCmd = program.command('dataset').description('Manage scraping datasets (Apify-style)');

datasetCmd.command('list').description('List all datasets').action(async () => {
  try {
    const { listDatasets } = await import('../scraping/paginationEngine.js');
    const datasets = await listDatasets();
    if (datasets.length === 0) { console.log(chalk.dim('No datasets')); return; }
    datasets.forEach(d => console.log(`  📦 ${d.name}  ${chalk.dim(`${d.itemCount} items, ${d.size}`)}`));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

datasetCmd.command('export <name>').description('Export dataset').option('-f, --format <format>', 'json, csv, jsonl', 'json').option('-o, --output <path>', 'Output file path').action(async (name, options) => {
  try {
    const { DatasetStore } = await import('../scraping/paginationEngine.js');
    const ds = new DatasetStore(name);
    const data = await ds.export(options.format);
    if (options.output) {
      const fs = await import('fs/promises');
      await fs.writeFile(options.output, data);
      console.log(chalk.green(`✅ Exported to ${options.output}`));
    } else {
      console.log(data);
    }
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

datasetCmd.command('delete <name>').description('Delete a dataset').action(async (name) => {
  try {
    const { DatasetStore } = await import('../scraping/paginationEngine.js');
    const ds = new DatasetStore(name);
    await ds.delete();
    console.log(chalk.green(`✅ Dataset "${name}" deleted`));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

datasetCmd.command('export-db')
  .description('Export scraped dataset directly from PostgreSQL (streaming JSONL/CSV)')
  .requiredOption('-o, --output <path>', 'Output file path')
  .option('-f, --format <format>', 'Export format: jsonl, csv', 'jsonl')
  .option('-p, --platform <platform>', 'Filter by platform (e.g. twitter, facebook, shopee)')
  .option('-k, --keyword <keyword>', 'Filter content by keyword (case-insensitive)')
  .option('--from <date>', 'Filter from crawledAt date (ISO string)')
  .option('--to <date>', 'Filter to crawledAt date (ISO string)')
  .option('-c, --compress', 'Enable Gzip compression (.gz)', false)
  .option('--include-comments', 'Include Comment rows in the export', true)
  .action(async (options) => {
    let prisma;
    try {
      const { default: sharedPrisma } = await import('../../api/lib/prisma.js');
      prisma = sharedPrisma;
      const { exportDataset } = await import('../utils/exporter.js');
      const result = await exportDataset({
        format: options.format,
        outputPath: options.output,
        compress: options.compress,
        platform: options.platform,
        keyword: options.keyword,
        fromDate: options.from,
        toDate: options.to,
        includeComments: options.includeComments,
        prisma,
      });
      console.log(chalk.green(`✅ Export completed: ${result.rowCount} records -> ${result.outputPath} (compressed: ${result.compressed})`));
    } catch (error) {
      console.error(chalk.red(`❌ ${error.message}`));
      process.exitCode = 1;
    } finally {
      if (prisma) {
        try {
          await prisma.$disconnect();
        } catch {}
      }
    }
  });

// ============================================================================
// 10-D: CrawlCheckpoint Operations
// ============================================================================

function parseCliPositiveInt(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return parsed;
}

function parseCliNonNegativeInt(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
  return parsed;
}

function printCliError(error, options = {}) {
  if (options.json) {
    console.log(JSON.stringify({
      success: false,
      error: {
        code: error.code || 'XACT_5000',
        message: error.message,
      },
    }, null, 2));
  } else {
    console.error(chalk.red(`❌ ${error.message}`));
  }
  process.exitCode = 1;
}

async function disconnectPrisma(prisma) {
  if (prisma) {
    try { await prisma.$disconnect(); } catch (err) {
      console.warn(`⚠️ Prisma disconnect warning: ${err.message}`);
    }
  }
}

const checkpointsCmd = program.command('checkpoints').description('Manage crawler checkpoints (resume/pause/retry)');

checkpointsCmd.command('list')
  .description('List crawl checkpoints with filtering and pagination')
  .option('-p, --platform <platform>', 'Filter by platform')
  .option('-t, --target-type <type>', 'Filter by target type (profile, group, hashtag, etc.)')
  .option('-k, --target-key <key>', 'Filter by target key substring')
  .option('-s, --status <status>', 'Filter by status (running, paused, failed, completed, stalled)')
  .option('-l, --limit <limit>', 'Max checkpoints to return', '50')
  .option('-o, --offset <offset>', 'Offset for pagination', '0')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    let prisma;
    try {
      const { default: sharedPrisma } = await import('../../api/lib/prisma.js');
      prisma = sharedPrisma;
      const { listCheckpoints } = await import('../store/checkpoint-manager.js');
      const result = await listCheckpoints({
        platform: options.platform,
        targetType: options.targetType,
        targetKey: options.targetKey,
        status: options.status,
        limit: parseCliPositiveInt(options.limit, 'limit'),
        offset: parseCliNonNegativeInt(options.offset, 'offset'),
        prisma,
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (result.checkpoints.length === 0) {
          console.log(chalk.dim('No checkpoints found'));
          return;
        }
        console.log(chalk.bold(`Checkpoints (Total: ${result.total}, Showing: ${result.checkpoints.length}):`));
        result.checkpoints.forEach((ckpt) => {
          const statusColor =
            ckpt.status === 'running' ? chalk.green :
            ckpt.status === 'paused' ? chalk.yellow :
            ckpt.status === 'failed' ? chalk.red :
            ckpt.status === 'completed' ? chalk.blue : chalk.magenta;
          console.log(`  • [${statusColor(ckpt.status)}] ${chalk.cyan(ckpt.id)} | ${ckpt.platform}::${ckpt.targetType}::${ckpt.targetKey} | cursor: ${chalk.dim(ckpt.lastCursor || 'none')} | errors: ${ckpt.errorCount}`);
        });
      }
    } catch (error) {
      printCliError(error, options);
    } finally {
      await disconnectPrisma(prisma);
    }
  });

checkpointsCmd.command('show <id>')
  .description('Show details of a specific checkpoint')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    let prisma;
    try {
      const { default: sharedPrisma } = await import('../../api/lib/prisma.js');
      prisma = sharedPrisma;
      const { getCheckpoint } = await import('../store/checkpoint-manager.js');
      const checkpoint = await getCheckpoint(id, { prisma });

      if (options.json) {
        console.log(JSON.stringify(checkpoint, null, 2));
      } else {
        console.log(chalk.bold(`Checkpoint Details (${checkpoint.id}):`));
        console.log(`  Platform:       ${checkpoint.platform}`);
        console.log(`  Target:         ${checkpoint.targetType} -> ${checkpoint.targetKey}`);
        console.log(`  Status:         ${checkpoint.status}`);
        console.log(`  Last Cursor:    ${checkpoint.lastCursor || 'none'}`);
        console.log(`  Last Timestamp: ${checkpoint.lastTimestamp || 'none'}`);
        console.log(`  Last Crawled:   ${checkpoint.lastCrawledAt ? new Date(checkpoint.lastCrawledAt).toISOString() : 'never'}`);
        console.log(`  Next Scheduled: ${checkpoint.nextScheduledAt ? new Date(checkpoint.nextScheduledAt).toISOString() : 'none'}`);
        console.log(`  Error Count:    ${checkpoint.errorCount}`);
      }
    } catch (error) {
      printCliError(error, options);
    } finally {
      await disconnectPrisma(prisma);
    }
  });

checkpointsCmd.command('resume <id>')
  .description('Resume a paused/failed/stalled checkpoint')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    let prisma;
    try {
      const { default: sharedPrisma } = await import('../../api/lib/prisma.js');
      prisma = sharedPrisma;
      const { resumeCheckpoint } = await import('../store/checkpoint-manager.js');
      const checkpoint = await resumeCheckpoint(id, { prisma });

      if (options.json) {
        console.log(JSON.stringify(checkpoint, null, 2));
      } else {
        console.log(chalk.green(`✅ Resumed checkpoint ${id}: status = ${checkpoint.status}`));
      }
    } catch (error) {
      printCliError(error, options);
    } finally {
      await disconnectPrisma(prisma);
    }
  });

checkpointsCmd.command('pause <id>')
  .description('Pause a running/stalled checkpoint')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    let prisma;
    try {
      const { default: sharedPrisma } = await import('../../api/lib/prisma.js');
      prisma = sharedPrisma;
      const { pauseCheckpoint } = await import('../store/checkpoint-manager.js');
      const checkpoint = await pauseCheckpoint(id, { prisma });

      if (options.json) {
        console.log(JSON.stringify(checkpoint, null, 2));
      } else {
        console.log(chalk.yellow(`⏸️ Paused checkpoint ${id}: status = ${checkpoint.status}`));
      }
    } catch (error) {
      printCliError(error, options);
    } finally {
      await disconnectPrisma(prisma);
    }
  });

checkpointsCmd.command('retry <id>')
  .description('Retry a failed/stalled checkpoint (resets errorCount and schedules immediately)')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    let prisma;
    try {
      const { default: sharedPrisma } = await import('../../api/lib/prisma.js');
      prisma = sharedPrisma;
      const { retryCheckpoint } = await import('../store/checkpoint-manager.js');
      const checkpoint = await retryCheckpoint(id, { prisma });

      if (options.json) {
        console.log(JSON.stringify(checkpoint, null, 2));
      } else {
        console.log(chalk.green(`🔄 Retried checkpoint ${id}: status = ${checkpoint.status}, errorCount = 0`));
      }
    } catch (error) {
      printCliError(error, options);
    } finally {
      await disconnectPrisma(prisma);
    }
  });

// ============================================================================
// 10-5: Schema Contract Registry (Metadata)
// ============================================================================

const schemaCmd = program.command('schema')
  .description('Manage JSON metadata schemas');

schemaCmd.command('list')
  .description('List all registered schemas')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const { metadataSchemaRegistry } = await import('../core/index.js');
      const schemas = metadataSchemaRegistry.listSchemas();
      if (options.json) {
        console.log(JSON.stringify(schemas, null, 2));
      } else {
        if (schemas.length === 0) {
          console.log(chalk.dim('No schemas registered.'));
          return;
        }
        console.log(chalk.bold(`Registered Schemas (${schemas.length}):`));
        schemas.forEach(s => {
          console.log(`  • ${chalk.cyan(s.platform)} / ${chalk.green(s.category)}`);
        });
      }
    } catch (error) {
      printCliError(error, options);
    }
  });

schemaCmd.command('get <platform> <category>')
  .description('Get JSON schema definition for a platform and category')
  .option('--json', 'Output as JSON')
  .action(async (platform, category, options) => {
    try {
      const { metadataSchemaRegistry } = await import('../core/index.js');
      const schema = metadataSchemaRegistry.getSchema(platform, category);
      if (!schema) {
        const { PlatformError, ErrorTypes } = await import('../core/error-envelope.js');
        throw new PlatformError({
          type: ErrorTypes.INTERNAL,
          code: 'XACT_4041',
          message: `Schema not found for platform: ${platform}, category: ${category}`,
          statusCode: 404
        });
      }
      
      if (options.json) {
        console.log(JSON.stringify(schema, null, 2));
      } else {
        console.log(chalk.bold(`Schema: ${platform} / ${category}`));
        console.log(JSON.stringify(schema, null, 2));
      }
    } catch (error) {
      printCliError(error, options);
    }
  });

// ============================================================================
// 09-N: Team Management
// ============================================================================

const teamCmd = program.command('team').description('Team & multi-user management');

teamCmd.command('create <name>').description('Create a new team').option('-u, --owner <username>', 'Owner username').action(async (name, options) => {
  try {
    const { createTeam } = await import('../auth/teamManager.js');
    const result = await createTeam(name, options.owner || 'default');
    console.log(chalk.green(`✅ Team "${name}" created (ID: ${result.id})`));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

teamCmd.command('invite <teamId> <email>').description('Invite user to team').option('-r, --role <role>', 'Role: admin, member, viewer', 'member').action(async (teamId, email, options) => {
  try {
    const { inviteUser } = await import('../auth/teamManager.js');
    const result = await inviteUser(teamId, email, options.role);
    console.log(chalk.green(`✅ Invite sent to ${email} as ${options.role}`));
    console.log(chalk.dim(`Token: ${result.token}`));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

teamCmd.command('members <teamId>').description('List team members').action(async (teamId) => {
  try {
    const { listTeamMembers } = await import('../auth/teamManager.js');
    const members = await listTeamMembers(teamId);
    if (members.error) { console.error(chalk.red(members.error)); return; }
    members.forEach(m => console.log(`  ${m.role === 'owner' ? '👑' : '👤'} @${m.username}  ${chalk.dim(m.role)}`));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

teamCmd.command('activity <teamId>').description('View team activity log').option('-l, --limit <n>', 'Max entries', '20').action(async (teamId, options) => {
  try {
    const { getActivityLog } = await import('../auth/teamManager.js');
    const log = await getActivityLog(teamId, { limit: parseInt(options.limit) });
    log.forEach(a => console.log(`  ${chalk.dim(a.timestamp.split('T')[0])} @${chalk.blue(a.user)} ${a.action} ${JSON.stringify(a.target)}`));
  } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
});

// ============================================================================
// 09-P: Import/Export Compatibility
// ============================================================================

program
  .command('import <file>')
  .description('Import data from Apify, Phantombuster, or CSV')
  .option('--from <source>', 'Source format: apify, phantombuster, auto', 'auto')
  .option('-o, --output <path>', 'Save normalized output to file')
  .action(async (file, options) => {
    try {
      const { importData } = await import('../compat/apifyAdapter.js');
      const result = await importData(file, options.from);
      console.log(chalk.green(`✅ Imported ${result.items.length} items (type: ${result.type})`));
      if (result.unmappedFields?.length) {
        console.log(chalk.yellow(`⚠️  Unmapped fields: ${result.unmappedFields.join(', ')}`));
      }
      if (options.output) {
        const fs = await import('fs/promises');
        await fs.writeFile(options.output, JSON.stringify(result.items, null, 2));
        console.log(chalk.green(`Saved to ${options.output}`));
      }
    } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
  });

program
  .command('export-data <file>')
  .description('Export data in external tool format')
  .option('--to <target>', 'Target format: apify, phantombuster, socialblade, csv', 'csv')
  .option('--type <type>', 'Data type: profile, tweet, followers', 'profile')
  .option('-o, --output <path>', 'Output file path')
  .action(async (file, options) => {
    try {
      const { exportData } = await import('../compat/apifyAdapter.js');
      const fs = await import('fs/promises');
      const data = JSON.parse(await fs.readFile(file, 'utf-8'));
      const output = exportData(data, options.to, options.type);
      if (options.output) {
        await fs.writeFile(options.output, output);
        console.log(chalk.green(`✅ Exported to ${options.output} (${options.to} format)`));
      } else {
        console.log(output);
      }
    } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
  });

program
  .command('convert <file>')
  .description('Convert between Apify/Phantombuster/CSV formats')
  .option('--from <source>', 'Source: apify, phantombuster', 'apify')
  .option('--to <target>', 'Target: apify, phantombuster, csv', 'csv')
  .option('-o, --output <path>', 'Output file path')
  .action(async (file, options) => {
    try {
      const { convertFormat } = await import('../compat/apifyAdapter.js');
      const fs = await import('fs/promises');
      const data = await fs.readFile(file, 'utf-8');
      const output = convertFormat(data.startsWith('[') ? JSON.parse(data) : data, options.from, options.to);
      if (options.output) {
        await fs.writeFile(options.output, output);
        console.log(chalk.green(`✅ Converted ${options.from} → ${options.to}, saved to ${options.output}`));
      } else {
        console.log(output);
      }
    } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); }
  });

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
      const { ThoughtLeaderAgent } = await import('../agents/thoughtLeaderAgent.js');
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
      const { ThoughtLeaderAgent } = await import('../agents/thoughtLeaderAgent.js');
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
      const { BrowserDriver } = await import('../agents/browserDriver.js');
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
      const { runSetup } = await import('../agents/setup.js');
      await runSetup();
    } catch (error) { console.error(chalk.red(`❌ ${error.message}`)); process.exit(1); }
  });

agentCmd
  .command('status')
  .description('Show current agent status and today\'s metrics')
  .option('-c, --config <path>', 'Config file path', 'data/agent-config.json')
  .action(async (options) => {
    try {
      const { AgentDatabase } = await import('../agents/database.js');
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
      const { AgentDatabase } = await import('../agents/database.js');
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

// ============================================================================
// Client Commands (HTTP-only, no Puppeteer — faster)
// ============================================================================

const clientCmd = program
  .command('client')
  .description('HTTP-only Twitter client (fast, no browser needed)');

clientCmd
  .command('login')
  .description('Log in and save cookies for HTTP client')
  .action(async () => {
    const spinner = ora();
    try {
      const { Scraper } = await import('../client/index.js');

      const answers = await inquirer.prompt([
        { type: 'input', name: 'username', message: 'Twitter username:' },
        { type: 'password', name: 'password', message: 'Password:' },
        { type: 'input', name: 'email', message: 'Email (for verification):', default: '' },
      ]);

      spinner.start('Logging in...');
      console.log(chalk.yellow('\n⚠️  Username/password login not yet available in HTTP client.'));
      console.log(chalk.yellow('    Please export cookies from your browser and save to:'));
      const cookiePath = path.join(CONFIG_DIR, 'cookies.json');
      console.log(chalk.cyan(`    ${cookiePath}`));
      console.log(chalk.gray('\n    Format: [{\"name\":\"auth_token\",\"value\":\"...\"},...]'));
      spinner.stop();
    } catch (error) {
      spinner.fail(chalk.red(`Login failed: ${error.message}`));
    }
  });

clientCmd
  .command('profile <username>')
  .description('Get a user profile (HTTP client)')
  .action(async (username) => {
    const spinner = ora(`Fetching profile @${username}...`).start();
    try {
      const { Scraper } = await import('../client/index.js');
      const scraper = new Scraper();
      const cookiePath = path.join(CONFIG_DIR, 'cookies.json');
      try { await scraper.loadCookies(cookiePath); } catch {}

      const profile = await scraper.getProfile(username);
      spinner.stop();

      console.log(chalk.bold.cyan(`\n  ${profile.name}`), chalk.gray(`@${profile.username}`));
      if (profile.bio) console.log(chalk.white(`  ${profile.bio}`));
      if (profile.location) console.log(chalk.gray(`  📍 ${profile.location}`));
      if (profile.website) console.log(chalk.gray(`  🔗 ${profile.website}`));
      console.log('');
      console.log(`  ${chalk.bold(formatNumber(profile.followersCount))} followers  ·  ${chalk.bold(formatNumber(profile.followingCount))} following  ·  ${chalk.bold(formatNumber(profile.tweetCount))} tweets`);
      if (profile.isBlueVerified) console.log(chalk.blue('  ✓ Blue verified'));
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red(`Failed: ${error.message}`));
    }
  });

clientCmd
  .command('tweet <tweetId>')
  .description('Get a single tweet by ID (HTTP client)')
  .action(async (tweetId) => {
    const spinner = ora('Fetching tweet...').start();
    try {
      const { Scraper } = await import('../client/index.js');
      const scraper = new Scraper();
      const cookiePath = path.join(CONFIG_DIR, 'cookies.json');
      try { await scraper.loadCookies(cookiePath); } catch {}

      const tweet = await scraper.getTweet(tweetId);
      spinner.stop();

      console.log(chalk.bold.cyan(`\n  @${tweet.username}`), chalk.gray(tweet.timeParsed ? tweet.timeParsed.toLocaleString() : ''));
      console.log(chalk.white(`  ${tweet.fullText}`));
      console.log('');
      console.log(`  ❤️  ${tweet.likes}  🔁 ${tweet.retweets}  💬 ${tweet.replies}  👀 ${tweet.views}`);
      console.log(chalk.gray(`  https://x.com/${tweet.username}/status/${tweet.id}`));
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red(`Failed: ${error.message}`));
    }
  });

clientCmd
  .command('search <query>')
  .description('Search tweets (HTTP client)')
  .option('-c, --count <n>', 'Number of results', '20')
  .option('-m, --mode <mode>', 'Search mode: Top, Latest, Photos, Videos', 'Latest')
  .action(async (query, options) => {
    const spinner = ora(`Searching "${query}"...`).start();
    try {
      const { Scraper } = await import('../client/index.js');
      const scraper = new Scraper();
      const cookiePath = path.join(CONFIG_DIR, 'cookies.json');
      try { await scraper.loadCookies(cookiePath); } catch {}

      const count = parseInt(options.count, 10) || 20;
      const tweets = [];
      for await (const tweet of scraper.searchTweets(query, count, options.mode)) {
        tweets.push(tweet);
      }
      spinner.stop();

      if (tweets.length === 0) {
        console.log(chalk.yellow('\n  No results found.\n'));
        return;
      }

      console.log(chalk.bold.cyan(`\n  Found ${tweets.length} tweets:\n`));
      for (const tweet of tweets) {
        console.log(chalk.bold(`  @${tweet.username}`), chalk.gray(tweet.timeParsed ? tweet.timeParsed.toLocaleString() : ''));
        console.log(chalk.white(`  ${tweet.fullText.slice(0, 200)}${tweet.fullText.length > 200 ? '...' : ''}`));
        console.log(chalk.gray(`  ❤️  ${tweet.likes}  🔁 ${tweet.retweets}  💬 ${tweet.replies}`));
        console.log('');
      }
    } catch (error) {
      spinner.fail(chalk.red(`Failed: ${error.message}`));
    }
  });

clientCmd
  .command('post <text>')
  .description('Post a tweet (HTTP client, requires auth cookies)')
  .action(async (text) => {
    const spinner = ora('Posting tweet...').start();
    try {
      const { Scraper } = await import('../client/index.js');
      const scraper = new Scraper();
      const cookiePath = path.join(CONFIG_DIR, 'cookies.json');
      await scraper.loadCookies(cookiePath);

      const tweet = await scraper.sendTweet(text);
      spinner.succeed(chalk.green('Tweet posted!'));
      console.log(chalk.cyan(`  https://x.com/${tweet.username}/status/${tweet.id}\n`));
    } catch (error) {
      spinner.fail(chalk.red(`Failed: ${error.message}`));
    }
  });

clientCmd
  .command('followers <username>')
  .description('List followers (HTTP client)')
  .option('-c, --count <n>', 'Number of followers', '100')
  .action(async (username, options) => {
    const spinner = ora(`Fetching followers of @${username}...`).start();
    try {
      const { Scraper } = await import('../client/index.js');
      const scraper = new Scraper();
      const cookiePath = path.join(CONFIG_DIR, 'cookies.json');
      try { await scraper.loadCookies(cookiePath); } catch {}

      const profile = await scraper.getProfile(username);
      const count = parseInt(options.count, 10) || 100;
      const followers = [];
      for await (const f of scraper.getFollowers(profile.id, count)) {
        followers.push(f);
      }
      spinner.stop();

      console.log(chalk.bold.cyan(`\n  @${username} — ${followers.length} followers:\n`));
      for (const f of followers) {
        console.log(`  ${chalk.bold(f.name)} ${chalk.gray(`@${f.username}`)} — ${formatNumber(f.followersCount)} followers`);
      }
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red(`Failed: ${error.message}`));
    }
  });

clientCmd
  .command('trends')
  .description('Show trending topics (HTTP client)')
  .action(async () => {
    const spinner = ora('Fetching trends...').start();
    try {
      const { Scraper } = await import('../client/index.js');
      const scraper = new Scraper();
      const cookiePath = path.join(CONFIG_DIR, 'cookies.json');
      try { await scraper.loadCookies(cookiePath); } catch {}

      const trends = await scraper.getTrends();
      spinner.stop();

      if (trends.length === 0) {
        console.log(chalk.yellow('\n  No trends available.\n'));
        return;
      }

      console.log(chalk.bold.cyan('\n  Trending Topics:\n'));
      for (let i = 0; i < Math.min(trends.length, 20); i++) {
        const t = trends[i];
        console.log(`  ${chalk.bold(String(i + 1).padStart(2))}. ${chalk.white(t.name)} ${t.tweetCount ? chalk.gray(`(${t.tweetCount})`) : ''}`);
      }
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red(`Failed: ${error.message}`));
    }
  });

clientCmd
  .command('whoami')
  .description('Show authenticated user profile (HTTP client)')
  .action(async () => {
    const spinner = ora('Checking identity...').start();
    try {
      const { Scraper } = await import('../client/index.js');
      const scraper = new Scraper();
      const cookiePath = path.join(CONFIG_DIR, 'cookies.json');
      await scraper.loadCookies(cookiePath);

      const profile = await scraper.me();
      spinner.stop();

      console.log(chalk.bold.cyan(`\n  ${profile.name}`), chalk.gray(`@${profile.username}`));
      console.log(`  ${chalk.bold(formatNumber(profile.followersCount))} followers  ·  ${chalk.bold(formatNumber(profile.followingCount))} following`);
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red(`Failed: ${error.message}`));
    }
  });

// ============================================================================
// AI Commands (Epic 4 — AI Tweet Writer)
// ============================================================================

ai
  .command('write')
  .description('Generate tweets with AI — "Write a viral tweet about [topic]"')
  .requiredOption('-t, --topic <topic>', 'Topic or prompt for the tweet(s)')
  .option('-u, --username <username>', 'Twitter username to analyze voice from (uses saved auth token)')
  .option('--tone <tone>', 'Tone: funny, professional, controversial, casual, inspirational, educational')
  .option('--style <style>', 'Style: hot-take, educational, personal, promotional')
  .option('-n, --count <number>', 'Number of variations (1-5)', '5')
  .option('--type <type>', 'Output type: tweet, thread, thread-from-text, bio', 'tweet')
  .option('--text <text>', 'Long-form text (for thread-from-text) or existing tweet (for rewrite)')
  .option('--thread-length <number>', 'Thread length (3-15)', '8')
  .option('--keywords <keywords>', 'Comma-separated keywords (for bio)')
  .option('--provider <provider>', 'LLM provider: openrouter, openai, grok')
  .option('--model <model>', 'Model override (e.g. gpt-4o-mini, grok-3-mini)')
  .option('--api-key <key>', 'API key (defaults to env: OPENROUTER_API_KEY / OPENAI_API_KEY / XAI_API_KEY)')
  .option('-o, --output <file>', 'Output file (.json)')
  .action(async (options) => {
    const spinner = ora('✨ Generating with AI...').start();

    try {
      const { generateTweet, generateThread, generateThreadFromText, generateBio } = await import('../ai/index.js');
      const { analyzeVoice } = await import('../ai/voiceAnalyzer.js');

      const llmOpts = {
        topic: options.topic,
        tone: options.tone,
        style: options.style,
        count: parseInt(options.count, 10) || 5,
        model: options.model,
        apiKey: options.apiKey,
        provider: options.provider,
      };

      // Resolve a voice profile if a username is given (scrapes + analyzes)
      let voiceProfile = null;
      if (options.username) {
        spinner.text = `🔍 Analyzing @${options.username}'s voice...`;
        const config = await loadConfig();
        const authToken = config.authToken;
        if (!authToken) {
          spinner.fail('No auth token saved. Run `xactions login` first, or pass --topic without --username for generic generation.');
          process.exit(1);
        }
        const browser = await scrapers.createBrowser();
        const page = await scrapers.createPage(browser);
        await scrapers.loginWithCookie(page, authToken);
        try {
          const tweets = await scrapers.scrapeTweets(page, options.username, { limit: 100 });
          if (!tweets || tweets.length === 0) {
            spinner.fail(`No tweets found for @${options.username}`);
            process.exit(1);
          }
          voiceProfile = analyzeVoice(options.username, tweets);
        } finally {
          await browser.close();
        }
      }

      spinner.text = '✨ Generating with AI...';

      let result;
      const type = options.type;

      if (type === 'thread') {
        if (!voiceProfile) {
          spinner.fail('Voice profile required for thread generation. Pass --username.');
          process.exit(1);
        }
        result = await generateThread(voiceProfile, {
          topic: options.topic,
          length: parseInt(options.threadLength, 10) || 8,
          ...llmOpts,
        });
      } else if (type === 'thread-from-text') {
        if (!options.text) {
          spinner.fail('--text required for thread-from-text. Pass the long-form text to split.');
          process.exit(1);
        }
        if (!voiceProfile) {
          spinner.fail('Voice profile required for thread-from-text. Pass --username.');
          process.exit(1);
        }
        result = await generateThreadFromText(voiceProfile, {
          text: options.text,
          maxLength: parseInt(options.threadLength, 10) || 10,
          tone: options.tone,
          model: options.model,
          apiKey: options.apiKey,
          provider: options.provider,
        });
      } else if (type === 'bio') {
        const keywords = options.keywords ? options.keywords.split(',').map(k => k.trim()).filter(Boolean) : undefined;
        result = await generateBio(voiceProfile, {
          topic: options.topic,
          keywords,
          tone: options.tone,
          count: parseInt(options.count, 10) || 5,
          model: options.model,
          apiKey: options.apiKey,
          provider: options.provider,
        });
      } else {
        // Single tweet (default) — works with or without a voice profile.
        // Without a voice profile, use a minimal generic profile so the API stays consistent.
        const profile = voiceProfile || { username: 'you', contentPillars: [{ topic: options.topic }], bestPerforming: { commonTraits: [], examples: [] }, tone: { formality: 0.5, humor: 0.5, controversy: 0.5, technicality: 0.5 } };
        result = await generateTweet(profile, llmOpts);
      }

      spinner.succeed('✨ AI generation complete');

      if (options.output) {
        await scrapers.exportToJSON(result, options.output);
        console.log(chalk.green(`✓ Saved to ${options.output}`));
      } else {
        // Pretty-print results
        if (result.tweets) {
          console.log(chalk.bold(`\n✨ ${result.tweets.length} tweet variation(s)${result.model ? chalk.gray(` (${result.model})`) : ''}\n`));
          for (const t of result.tweets) {
            console.log(chalk.white(`  ${t.text}`));
            if (t.estimatedEngagement) console.log(chalk.gray(`    → ${t.estimatedEngagement} engagement — ${t.reasoning || ''}`));
            console.log();
          }
        } else if (result.thread) {
          console.log(chalk.bold(`\n🧵 ${result.thread.length}-tweet thread${result.model ? chalk.gray(` (${result.model})`) : ''}\n`));
          for (const t of result.thread) {
            console.log(chalk.white(`  ${t.text}`));
            if (t.purpose) console.log(chalk.gray(`    → ${t.purpose}`));
            console.log();
          }
        } else if (result.bios) {
          console.log(chalk.bold(`\n📝 ${result.bios.length} bio option(s)${result.model ? chalk.gray(` (${result.model})`) : ''}\n`));
          for (const b of result.bios) {
            console.log(chalk.white(`  ${b.text}`));
            console.log(chalk.gray(`    → ${b.characterCount} chars — ${b.style}`));
            console.log();
          }
        } else {
          console.log(JSON.stringify(result, null, 2));
        }
      }
    } catch (err) {
      spinner.fail(`Failed: ${err.message}`);
      process.exit(1);
    }
  });

// ============================================================================
// Parse and Run
// ============================================================================

// Fifty-plus commands printed as one flat alphabetical list tells a newcomer
// nothing about where to start. Replace Commander's root help with the grouped
// screen; sub-command help keeps the default format, which is fine at that size.
const defaultFormatHelp = Help.prototype.formatHelp;
program.configureHelp({
  formatHelp(command, helper) {
    return command === program
      ? renderRootHelp(program, VERSION)
      : defaultFormatHelp.call(this, command, helper);
  },
});

// Commander prints help and exits when it is given no arguments, so bare
// `xactions` lands on the grouped screen above. That screen points at
// `xactions quickstart` in three places, which is where a first-time user
// should go; there is deliberately no redirect here, because an implicit jump
// would hide the command list from someone who ran the binary to see it.
program.parse();
