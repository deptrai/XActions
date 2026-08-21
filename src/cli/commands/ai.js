// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions ai` command group.
 */
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import fs from 'fs/promises';
import path from 'path';
import { CONFIG_DIR, CONFIG_FILE, loadConfig, saveConfig, formatNumber, parseCliPositiveInt, parseCliNonNegativeInt, printCliError, disconnectPrisma } from '../shared.js';
import scrapers from '../../scrapers/index.js';

export function registerAiCommands(program) {
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
      const { analyzeVoice, summarizeVoiceProfile } = await import('../../ai/index.js');
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
      const { analyzeVoice, generateTweet, generateThread } = await import('../../ai/index.js');
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
      const { analyzeVoice, rewriteTweet } = await import('../../ai/index.js');
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
      const { analyzeVoice, generateWeek } = await import('../../ai/index.js');
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
      const { generateTweet, generateThread, generateThreadFromText, generateBio } = await import('../../ai/index.js');
      const { analyzeVoice } = await import('../../ai/voiceAnalyzer.js');

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

}
