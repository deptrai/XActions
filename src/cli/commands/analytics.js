// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions analytics` command group.
 */
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import prisma from '../../../api/lib/prisma.js';

export function registerAnalyticsCommands(program) {
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
      const { analyzeSentiment } = await import('../../analytics/sentiment.js');
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
      const { createMonitor } = await import('../../analytics/reputation.js');
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
        const { stopMonitor: stop } = await import('../../analytics/reputation.js');
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
      const { listMonitors, getMonitor, getMonitorHistory } = await import('../../analytics/reputation.js');
      const { generateReport } = await import('../../analytics/reports.js');

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

const analyticsCmd = program.command('analytics').description('Analytics tools — sentiment, buzzwords, monitoring');

analyticsCmd
  .command('buzzwords')
  .description('Extract keyword and hashtag frequency from content items')
  .option('-f, --file <path>', 'Path to JSON file containing array of items with content field')
  .option('-m, --min-length <n>', 'Minimum token length', '1')
  .option('-t, --top-n <n>', 'Max results per category', '10')
  .option('-l, --lang <lang>', 'Language for stopword filtering (vi, en)', 'auto')
  .option('--no-stopwords', 'Disable stopword filtering')
  .option('-o, --output <file>', 'Output file (JSON)')
  .action(async (options) => {
    const spinner = ora('Analyzing keywords...').start();
    try {
      const { extractKeywordFrequency } = await import('../../analytics/word-frequency.js');
      const fs = await import('fs/promises');

      let items;
      if (options.file) {
        const raw = await fs.readFile(options.file, 'utf-8');
        items = JSON.parse(raw);
      } else {
        // Read from stdin
        const chunks = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk);
        }
        const raw = Buffer.concat(chunks).toString('utf-8').trim();
        if (!raw) {
          spinner.fail('No input provided');
          console.log(chalk.yellow('Usage: xactions analytics buzzwords --file <path> or pipe JSON array via stdin'));
          console.log(chalk.gray('Example: cat posts.json | xactions analytics buzzwords --lang vi'));
          return;
        }
        items = JSON.parse(raw);
      }

      if (!Array.isArray(items)) {
        spinner.fail('Input must be a JSON array of items with a "content" field');
        return;
      }

      const result = extractKeywordFrequency(items, {
        minLength: parseInt(options.minLength) || 1,
        topN: parseInt(options.topN) || 10,
        lang: options.lang,
        removeStopwords: options.stopwords !== false,
      });

      spinner.succeed(`Analyzed ${result.totalTokens} tokens`);

      // Print unigrams
      if (result.unigrams.length > 0) {
        console.log(chalk.cyan('\n📊 Top Keywords (Unigrams)'));
        for (const { term, count } of result.unigrams) {
          console.log(`  ${chalk.bold(term)}: ${count}`);
        }
      }

      // Print bigrams
      if (result.bigrams.length > 0) {
        console.log(chalk.cyan('\n📊 Top Bigrams'));
        for (const { term, count } of result.bigrams) {
          console.log(`  ${chalk.bold(term)}: ${count}`);
        }
      }

      // Print hashtags
      if (result.hashtags.length > 0) {
        console.log(chalk.cyan('\n#️⃣  Top Hashtags'));
        for (const { tag, count } of result.hashtags) {
          console.log(`  ${chalk.bold('#' + tag)}: ${count}`);
        }
      }

      if (result.unigrams.length === 0 && result.bigrams.length === 0 && result.hashtags.length === 0) {
        console.log(chalk.yellow('\nNo keywords or hashtags found.'));
      }

      if (options.output) {
        await fs.writeFile(options.output, JSON.stringify(result, null, 2));
        console.log(chalk.green(`\n✓ Saved to ${options.output}`));
      }
    } catch (error) {
      spinner.fail('Analysis failed');
      console.error(chalk.red(error.message));
    }
  });

}
