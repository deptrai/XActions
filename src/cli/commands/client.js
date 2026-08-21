// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions client` command group.
 */
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import fs from 'fs/promises';
import path from 'path';
import { CONFIG_DIR, CONFIG_FILE, loadConfig, saveConfig, formatNumber, parseCliPositiveInt, parseCliNonNegativeInt, printCliError, disconnectPrisma } from '../shared.js';

export function registerClientCommand(program) {
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
      const { Scraper } = await import('../../client/index.js');

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
      const { Scraper } = await import('../../client/index.js');
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
      const { Scraper } = await import('../../client/index.js');
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
      const { Scraper } = await import('../../client/index.js');
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
      const { Scraper } = await import('../../client/index.js');
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
      const { Scraper } = await import('../../client/index.js');
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
      const { Scraper } = await import('../../client/index.js');
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
      const { Scraper } = await import('../../client/index.js');
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

}
