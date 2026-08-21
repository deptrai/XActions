// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions profile/followers/following/non-followers/tweets/search/hashtag/thread/media`
 * — public read and scraping commands.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import chalk from 'chalk';
import ora from 'ora';
import scrapers from '../../scrapers/index.js';
import {
  AUTH_HINT,
  assertNotEmpty,
  createHttpScraper,
  formatNumber,
  loadConfig,
  smartOutput,
} from '../shared.js';

/**
 * Register the public read / scraping commands.
 *
 * @param {import('commander').Command} program
 */
export function registerReadCommands(program) {
  program
    .command('profile <username>')
    .description('Get profile information for a user')
    .option('-j, --json', 'Output as JSON')
    .action(async (username, options) => {
      const spinner = ora(`Fetching profile for @${username}`).start();

      try {
        const scraper = await createHttpScraper();
        const profile = await scraper.getProfile(username);

        if (!profile || !profile.id) {
          throw new Error(
            `X returned no profile data for @${username}. Check the handle, or ${AUTH_HINT}`,
          );
        }

        spinner.stop();

        if (options.json) {
          console.log(JSON.stringify(profile, null, 2));
        } else {
          console.log(chalk.bold(`\n⚡ @${profile.username || username}\n`));
          console.log(`  ${chalk.cyan('Name:')}      ${profile.name || 'N/A'}`);
          console.log(`  ${chalk.cyan('Bio:')}       ${profile.bio || 'N/A'}`);
          console.log(`  ${chalk.cyan('Location:')}  ${profile.location || 'N/A'}`);
          console.log(`  ${chalk.cyan('Website:')}   ${profile.website || 'N/A'}`);
          const joined = profile.joined ? new Date(profile.joined) : null;
          console.log(
            `  ${chalk.cyan('Joined:')}    ${joined && !Number.isNaN(joined.valueOf()) ? joined.toISOString().slice(0, 10) : 'N/A'}`
          );
          console.log(
            `  ${chalk.cyan('Following:')} ${formatNumber(profile.followingCount || 0)}  ${chalk.cyan('Followers:')} ${formatNumber(profile.followersCount || 0)}`
          );
          console.log(
            `  ${chalk.cyan('Tweets:')}    ${formatNumber(profile.tweetCount || 0)}  ${chalk.cyan('Listed:')}    ${formatNumber(profile.listedCount || 0)}`
          );
          if (profile.verified || profile.isBlueVerified) console.log(`  ${chalk.blue('✓ Verified')}`);
          console.log();
        }
      } catch (error) {
        spinner.fail('Failed to fetch profile');
        console.error(chalk.red(error.message));
        process.exitCode = 1;
      }
    });

  program
    .command('followers <username>')
    .description('Scrape followers for a user')
    .option('-l, --limit <number>', 'Maximum followers to scrape', '100')
    .option('-o, --output <file>', 'Output file (json, csv, or xlsx)')
    .option('--google-sheets <id>', 'Export directly to a Google Sheet (spreadsheet ID)')
    .option('--sheet-name <name>', 'Sheet/tab name for xlsx or Google Sheets export')
    .option('--sheet-mode <mode>', 'Google Sheets write mode: append, replace, new-sheet', 'append')
    .option('--json', 'Force JSON on stdout, ignoring --output and --google-sheets')
    .action(async (username, options) => {
      const limit = parseInt(options.limit, 10);
      const spinner = ora(`Scraping followers for @${username}`).start();

      try {
        const scraper = await createHttpScraper();

        const followers = [];
        for await (const follower of scraper.getFollowers(username, limit)) {
          followers.push(follower);
          spinner.text = `Scraping followers for @${username} (${followers.length}/${limit})`;
        }

        assertNotEmpty(followers, `followers for @${username}`, AUTH_HINT);
        spinner.succeed(`Scraped ${followers.length} followers`);

        await smartOutput(followers, options, 'followers');
      } catch (error) {
        spinner.fail('Failed to scrape followers');
        console.error(chalk.red(error.message));
        process.exitCode = 1;
      }
    });

  program
    .command('following <username>')
    .description('Scrape accounts a user is following')
    .option('-l, --limit <number>', 'Maximum to scrape', '100')
    .option('-o, --output <file>', 'Output file (json, csv, or xlsx)')
    .option('--google-sheets <id>', 'Export directly to a Google Sheet (spreadsheet ID)')
    .option('--sheet-name <name>', 'Sheet/tab name for xlsx or Google Sheets export')
    .option('--sheet-mode <mode>', 'Google Sheets write mode: append, replace, new-sheet', 'append')
    .option('--json', 'Force JSON on stdout, ignoring --output and --google-sheets')
    .action(async (username, options) => {
      const limit = parseInt(options.limit, 10);
      const spinner = ora(`Scraping following for @${username}`).start();

      try {
        const scraper = await createHttpScraper();

        const following = [];
        for await (const account of scraper.getFollowing(username, limit)) {
          following.push(account);
          spinner.text = `Scraping following for @${username} (${following.length}/${limit})`;
        }

        assertNotEmpty(following, `accounts followed by @${username}`, AUTH_HINT);
        spinner.succeed(`Scraped ${following.length} following`);

        await smartOutput(following, options, 'following');
      } catch (error) {
        spinner.fail('Failed to scrape following');
        console.error(chalk.red(error.message));
        process.exitCode = 1;
      }
    });

  program
    .command('non-followers <username>')
    .description("Find accounts that don't follow back")
    .option('-l, --limit <number>', 'Maximum to check', '500')
    .option('-o, --output <file>', 'Output file')
    .option('--json', 'Force JSON on stdout, ignoring --output and --google-sheets')
    .action(async (username, options) => {
      const limit = parseInt(options.limit, 10);
      const spinner = ora('Analyzing follow relationships...').start();

      try {
        const scraper = await createHttpScraper();

        spinner.text = 'Reading following list...';
        const following = [];
        for await (const account of scraper.getFollowing(username, limit)) {
          following.push(account);
          spinner.text = `Reading following list (${following.length})`;
        }
        assertNotEmpty(following, `accounts followed by @${username}`, AUTH_HINT);

        spinner.text = 'Reading follower list...';
        const followerHandles = new Set();
        for await (const follower of scraper.getFollowers(username, limit)) {
          followerHandles.add(follower.username.toLowerCase());
          spinner.text = `Reading follower list (${followerHandles.size})`;
        }
        assertNotEmpty([...followerHandles], `followers of @${username}`, AUTH_HINT);

        const nonFollowers = following.filter(
          (u) => !followerHandles.has(u.username.toLowerCase()),
        );
        const mutuals = following.filter((u) => followerHandles.has(u.username.toLowerCase()));

        spinner.succeed('Analysis complete!');

        console.log(chalk.bold('\n📊 Follow Analysis\n'));
        console.log(`  ${chalk.cyan('Total Following:')} ${following.length}`);
        console.log(`  ${chalk.green('Mutuals:')}         ${mutuals.length}`);
        console.log(`  ${chalk.red('Non-Followers:')}   ${nonFollowers.length}`);
        console.log();

        if (nonFollowers.length > 0) {
          console.log(chalk.yellow('Non-followers:'));
          nonFollowers.slice(0, 20).forEach((u) => {
            console.log(`  @${u.username} - ${u.name || 'Unknown'}`);
          });
          if (nonFollowers.length > 20) {
            console.log(chalk.gray(`  ... and ${nonFollowers.length - 20} more`));
          }
        }

        if (options.json) {
          console.log(JSON.stringify(nonFollowers, null, 2));
        } else if (options.output) {
          await scrapers.exportToJSON(nonFollowers, options.output);
          console.log(chalk.green(`\n✓ Full list saved to ${options.output}`));
        }
      } catch (error) {
        spinner.fail('Failed to analyze');
        console.error(chalk.red(error.message));
        process.exitCode = 1;
      }
    });

  program
    .command('tweets <username>')
    .description('Scrape tweets from a user')
    .option('-l, --limit <number>', 'Maximum tweets', '50')
    .option('-r, --replies', 'Include replies')
    .option('-o, --output <file>', 'Output file (json, csv, or xlsx)')
    .option('--google-sheets <id>', 'Export directly to a Google Sheet (spreadsheet ID)')
    .option('--sheet-name <name>', 'Sheet/tab name for xlsx or Google Sheets export')
    .option('--sheet-mode <mode>', 'Google Sheets write mode: append, replace, new-sheet', 'append')
    .option('--json', 'Force JSON on stdout, ignoring --output and --google-sheets')
    .action(async (username, options) => {
      const limit = parseInt(options.limit, 10);
      const spinner = ora(`Scraping tweets from @${username}`).start();

      try {
        const scraper = await createHttpScraper();
        const stream = options.replies
          ? scraper.getTweetsAndReplies(username, limit)
          : scraper.getTweets(username, limit);

        const tweets = [];
        for await (const tweet of stream) {
          tweets.push(tweet);
          spinner.text = `Scraping tweets from @${username} (${tweets.length}/${limit})`;
        }

        assertNotEmpty(tweets, `tweets for @${username}`, AUTH_HINT);
        spinner.succeed(`Scraped ${tweets.length} tweets`);

        await smartOutput(tweets, options, 'tweets');
      } catch (error) {
        spinner.fail('Failed to scrape tweets');
        console.error(chalk.red(error.message));
        process.exitCode = 1;
      }
    });

  program
    .command('search <query>')
    .description('Search for tweets')
    .option('-l, --limit <number>', 'Maximum results', '50')
    .option('-f, --filter <type>', 'Filter: latest, top, people, photos, videos', 'latest')
    .option('-o, --output <file>', 'Output file')
    .option('--json', 'Force JSON on stdout, ignoring --output and --google-sheets')
    .action(async (query, options) => {
      const limit = parseInt(options.limit, 10);
      const spinner = ora(`Searching for "${query}"`).start();

      try {
        const scraper = await createHttpScraper();
        const { SearchMode } = await import('../../client/index.js');

        const mode =
          {
            latest: SearchMode.Latest,
            top: SearchMode.Top,
            photos: SearchMode.Photos,
            videos: SearchMode.Videos,
          }[String(options.filter).toLowerCase()] || SearchMode.Latest;

        const tweets = [];
        for await (const tweet of scraper.searchTweets(query, limit, mode)) {
          tweets.push(tweet);
          spinner.text = `Searching for "${query}" (${tweets.length}/${limit})`;
        }

        assertNotEmpty(tweets, `results for "${query}"`, AUTH_HINT);
        spinner.succeed(`Found ${tweets.length} tweets`);

        if (options.json) {
          console.log(JSON.stringify(tweets, null, 2));
        } else if (options.output) {
          await scrapers.exportToJSON(tweets, options.output);
          console.log(chalk.green(`✓ Saved to ${options.output}`));
        } else {
          console.log(JSON.stringify(tweets, null, 2));
        }
      } catch (error) {
        spinner.fail('Search failed');
        console.error(chalk.red(error.message));
        process.exitCode = 1;
      }
    });

  program
    .command('hashtag <tag>')
    .description('Scrape tweets for a hashtag')
    .option('-l, --limit <number>', 'Maximum results', '50')
    .option('-o, --output <file>', 'Output file')
    .option('--json', 'Force JSON on stdout, ignoring --output and --google-sheets')
    .action(async (tag, options) => {
      const limit = parseInt(options.limit, 10);
      const hashtag = tag.startsWith('#') ? tag : `#${tag}`;
      const spinner = ora(`Scraping ${hashtag}`).start();

      try {
        const browser = await scrapers.createBrowser();
        const page = await scrapers.createPage(browser);

        const config = await loadConfig();
        if (config.authToken) {
          await scrapers.loginWithCookie(page, config.authToken);
        }

        const tweets = await scrapers.scrapeHashtag(page, tag, { limit });
        await browser.close();

        spinner.succeed(`Found ${tweets.length} tweets`);

        if (options.json) {
          console.log(JSON.stringify(tweets, null, 2));
        } else if (options.output) {
          await scrapers.exportToJSON(tweets, options.output);
          console.log(chalk.green(`✓ Saved to ${options.output}`));
        } else {
          console.log(JSON.stringify(tweets, null, 2));
        }
      } catch (error) {
        spinner.fail('Scraping failed');
        console.error(chalk.red(error.message));
      }
    });

  program
    .command('thread <url>')
    .description('Scrape a full tweet thread')
    .option('-o, --output <file>', 'Output file')
    .option('--json', 'Force JSON on stdout, ignoring --output and --google-sheets')
    .action(async (url, options) => {
      const spinner = ora('Scraping thread...').start();

      try {
        const browser = await scrapers.createBrowser();
        const page = await scrapers.createPage(browser);

        const config = await loadConfig();
        if (config.authToken) {
          await scrapers.loginWithCookie(page, config.authToken);
        }

        const thread = await scrapers.scrapeThread(page, url);
        await browser.close();

        spinner.succeed(`Scraped ${thread.length} tweets in thread`);

        if (options.json) {
          console.log(JSON.stringify(thread, null, 2));
        } else if (options.output) {
          await scrapers.exportToJSON(thread, options.output);
          console.log(chalk.green(`✓ Saved to ${options.output}`));
        } else {
          console.log('\n' + chalk.bold('🧵 Thread:\n'));
          thread.forEach((tweet, i) => {
            console.log(chalk.cyan(`${i + 1}.`) + ` ${tweet.text?.slice(0, 100)}...`);
            console.log(chalk.gray(`   ${tweet.timestamp || ''}\n`));
          });
        }
      } catch (error) {
        spinner.fail('Failed to scrape thread');
        console.error(chalk.red(error.message));
      }
    });

  program
    .command('media <username>')
    .description('Scrape media from a user')
    .option('-l, --limit <number>', 'Maximum items', '50')
    .option('-o, --output <file>', 'Output file')
    .option('--json', 'Force JSON on stdout, ignoring --output and --google-sheets')
    .action(async (username, options) => {
      const limit = parseInt(options.limit, 10);
      const spinner = ora(`Scraping media from @${username}`).start();

      try {
        const browser = await scrapers.createBrowser();
        const page = await scrapers.createPage(browser);

        const config = await loadConfig();
        if (config.authToken) {
          await scrapers.loginWithCookie(page, config.authToken);
        }

        const media = await scrapers.scrapeMedia(page, username, { limit });
        await browser.close();

        spinner.succeed(`Found ${media.length} media items`);

        if (options.json) {
          console.log(JSON.stringify(media, null, 2));
        } else if (options.output) {
          await scrapers.exportToJSON(media, options.output);
          console.log(chalk.green(`✓ Saved to ${options.output}`));
        } else {
          console.log(JSON.stringify(media, null, 2));
        }
      } catch (error) {
        spinner.fail('Failed to scrape media');
        console.error(chalk.red(error.message));
      }
    });
}
