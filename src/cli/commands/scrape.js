// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions scrape` — unified multi-platform dispatcher.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import ora from 'ora';
import { smartOutput } from '../shared.js';

/**
 * Register the scrape command.
 *
 * @param {import('commander').Command} program
 */
export function registerScrapeCommand(program) {
  program
    .command('scrape')
    .description('Scrape data from any platform (facebook, threads, bluesky, mastodon, twitter)')
    .requiredOption('--platform <platform>', 'Platform: facebook/fb, threads, bluesky, mastodon, twitter/x')
    .requiredOption('--action <action>', 'Action: profile, posts, followers, following, search, marketplace, post_comments, group_posts, group_comments, group_search, group_members')
    .option('--username <username>', 'Target username or handle')
    .option('--url <url>', 'Target URL (for posts, comments, group members, marketplace)')
    .option('--query <query>', 'Search query (for search or marketplace action)')
    .option('--limit <number>', 'Maximum results', '20')
    .option('--category <category>', 'Category slug (for marketplace)')
    .option('--category-id <id>', 'Category ID (for marketplace)')
    .option('--min-price <number>', 'Minimum price filter (for marketplace)')
    .option('--max-price <number>', 'Maximum price filter (for marketplace)')
    .option('--latitude <lat>', 'Latitude (for marketplace)')
    .option('--longitude <lng>', 'Longitude (for marketplace)')
    .option('--radius-km <km>', 'Radius in km (for marketplace)')
    .option('--location <location>', 'Location filter (for search or marketplace)')
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('--include-replies', 'Include nested replies (for comments)')
    .option('--dry-run', 'Preview without making network requests')
    .option('--auth-cookie <json>', 'Auth cookie as JSON — required for facebook: \'{"c_user":"...","xs":"..."}\'')
    .option('--auth-token <token>', 'Auth token string (for twitter/threads)')
    .option('-o, --output <file>', 'Output file (.json or .csv)')
    .action(async (options) => {
      const { scrape: dispatchScrape } = await import('../../scrapers/index.js');
      const platform = options.platform.toLowerCase();
      const action = options.action.toLowerCase();
      const spinner = ora(`Scraping ${action} on ${platform}...`).start();

      try {
        // Facebook requires authCookie object, not authToken string
        if ((platform === 'facebook' || platform === 'fb') && !options.authCookie && action !== 'marketplace') {
          spinner.fail('Facebook requires --auth-cookie \'{"c_user":"...","xs":"..."}\' (not --auth-token)');
          process.exit(1);
        }

        // Parse authCookie JSON if provided
        let authCookie;
        if (options.authCookie) {
          try {
            authCookie = JSON.parse(options.authCookie);
          } catch {
            spinner.fail('--auth-cookie must be valid JSON: \'{"c_user":"...","xs":"..."}\'');
            process.exit(1);
          }
        }

        const parseNum = (val) => {
          if (val == null) return undefined;
          const n = Number(val);
          return Number.isFinite(n) ? n : undefined;
        };

        const scrapeOptions = {
          username: options.username,
          url: options.url,
          query: options.query,
          limit: parseInt(options.limit, 10) || 20,
          category: options.category,
          categoryId: options.categoryId,
          minPrice: parseNum(options.minPrice),
          maxPrice: parseNum(options.maxPrice),
          latitude: parseNum(options.latitude),
          longitude: parseNum(options.longitude),
          radiusKm: parseNum(options.radiusKm),
          location: options.location,
          cursor: options.cursor,
          includeReplies: options.includeReplies,
          dryRun: options.dryRun,
          authToken: options.authToken,
          authCookie,
        };

        const data = await dispatchScrape(platform, action, scrapeOptions);
        spinner.succeed(`Scraped ${action} on ${platform}`);

        if (options.output) {
          await smartOutput(Array.isArray(data) ? data : [data], options);
        } else {
          console.log(JSON.stringify(data, null, 2));
        }
      } catch (err) {
        spinner.fail(`Failed: ${err.message}`);
        process.exit(1);
      }
    });
}
