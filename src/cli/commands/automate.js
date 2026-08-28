// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions automate` — Facebook write automation (like, comment, post, messenger-share).
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import fs from 'fs/promises';
import chalk from 'chalk';
import ora from 'ora';
import { scrape } from '../../scrapers/index.js';

/**
 * Register the automate command.
 *
 * @param {import('commander').Command} program
 */
export function registerAutomateCommand(program) {
  program
    .command('automate')
    .description('Automate write actions on Facebook (dry-run on by default)')
    .requiredOption('--platform <platform>', 'Platform: facebook/fb')
    .requiredOption('--action <action>', 'Action: like, comment, post, share, join-group, send-friend-request, messenger-share')
    .option('--urls <urls>', 'Comma-separated post URLs (for like/comment/share)')
    .option('--text <text>', 'Comment text or post content (for comment/post)')
    .option('--group-urls <urls>', 'Comma-separated Facebook group URLs (for join-group)')
    .option('--keyword <keyword>', 'Keyword to search groups (for join-group)')
    .option('--targets <targets>', 'Comma-separated profile URLs or UIDs (for send-friend-request)')
    .option('--mode <mode>', 'Friend request mode: uid_list, suggestions, location', 'uid_list')
    .option('--location <location>', 'Location filter (for send-friend-request in location mode)')
    .option('--limit <number>', 'Limit count (for join-group, friend requests)', '10')
    .option('--auth-cookie <json>', 'Auth cookie JSON: \'{"c_user":"...","xs":"..."}\'')
    .option('--no-dry-run', 'Execute real writes (default: dry-run enabled)')
    .option('--max-batch <number>', 'Max items per batch', '20')
    .option('--recipients <list>', 'Comma-separated recipient Pages (messenger-share)')
    .option('--recipients-file <path>', 'File with one recipient Page per line (messenger-share)')
    .option('--content <text>', 'Message body, may contain ** segments (messenger-share)')
    .option('--content-file <path>', 'File with message body (messenger-share)')
    .option('--post-url <url>', 'Single facebook.com post URL to share (messenger-share)')
    .option('--links-file <path>', 'File with one facebook.com post URL per line (messenger-share)')
    .action(async (options) => {
      const platform = options.platform.toLowerCase();
      if (platform !== 'facebook' && platform !== 'fb') {
        console.error(chalk.red(`❌ automate only supports facebook/fb. Got: ${platform}`));
        process.exit(1);
      }

      const { loginWithCookie, createBrowser, createPage } = await import('../../scrapers/facebook/index.js');
      const { parseRecipientsFile, buildCampaignQueue } = await import('../../scrapers/facebook/messengerQueue.js');
      const { messengerShareCampaign } = await import('../../scrapers/facebook/messengerShare.js');

      // Parse authCookie
      let authCookie;
      if (options.authCookie) {
        try {
          authCookie = JSON.parse(options.authCookie);
        } catch {
          console.error(chalk.red('❌ --auth-cookie must be valid JSON'));
          process.exit(1);
        }
      }

      const action = options.action.toLowerCase();
      const urls = options.urls ? options.urls.split(',').map((u) => u.trim()).filter(Boolean) : [];
      const groupUrls = options.groupUrls ? options.groupUrls.split(',').map((u) => u.trim()).filter(Boolean) : [];
      const targets = options.targets ? options.targets.split(',').map((t) => t.trim()).filter(Boolean) : [];

      if ((action === 'like' || action === 'comment') && !urls.length) {
        console.error(chalk.red(`❌ --urls is required for ${action}`));
        process.exit(1);
      }
      if (action === 'post' && !options.text) {
        console.error(chalk.red('❌ --text is required for post'));
        process.exit(1);
      }
      if (action === 'comment' && !options.text) {
        console.error(chalk.red('❌ --text is required for comment'));
        process.exit(1);
      }
      if (action === 'join-group' && !groupUrls.length && !options.keyword) {
        console.error(chalk.red('❌ join-group requires --group-urls or --keyword'));
        process.exit(1);
      }
      if (action === 'send-friend-request' && !targets.length && (!options.mode || options.mode === 'uid_list')) {
        console.error(chalk.red('❌ send-friend-request in uid_list mode requires --targets'));
        process.exit(1);
      }

      // Build campaigns if action is messenger-share
      let campaigns = [];
      if (action === 'messenger-share') {
        const readFileSafe = async (filePath, label) => {
          try {
            return await fs.readFile(filePath, 'utf-8');
          } catch (err) {
            console.error(chalk.red(`❌ Cannot read --${label}-file at ${filePath}: ${err.message}`));
            process.exit(1);
          }
        };

        let recipients = [];
        if (options.recipients) {
          recipients = options.recipients.split(',').map((r) => r.trim()).filter(Boolean);
          console.log(chalk.gray(`ℹ️ recipients: ${recipients.length} item(s) from inline --recipients`));
        } else if (options.recipientsFile) {
          const raw = await readFileSafe(options.recipientsFile, 'recipients');
          recipients = parseRecipientsFile(raw);
          console.log(chalk.gray(`ℹ️ recipients: ${recipients.length} item(s) from --recipients-file`));
        }

        let content = '';
        if (options.content != null) {
          content = options.content;
          console.log(chalk.gray('ℹ️ content: using inline --content'));
        } else if (options.contentFile) {
          content = await readFileSafe(options.contentFile, 'content');
          console.log(chalk.gray('ℹ️ content: using --content-file'));
        }

        let linksText = '';
        if (options.postUrl) {
          linksText = options.postUrl;
          console.log(chalk.gray('ℹ️ post URL: using inline --post-url'));
        } else if (options.linksFile) {
          linksText = await readFileSafe(options.linksFile, 'links');
          console.log(chalk.gray('ℹ️ post URL: using --links-file'));
        }

        const { campaigns: built, stats } = buildCampaignQueue({ recipients, linksText, content });
        if (stats.skipped > 0) {
          console.log(chalk.yellow(`⚠️ Skipped ${stats.skipped} non-facebook.com link(s)`));
        }

        if (!stats.links) {
          console.error(chalk.red('❌ messenger-share requires at least one facebook.com post URL (--post-url or --links-file)')); process.exit(1);
        }
        if (!recipients.length) {
          console.error(chalk.red('❌ messenger-share requires at least one recipient (--recipients or --recipients-file)')); process.exit(1);
        }
        if (!content.trim()) {
          console.error(chalk.red('❌ messenger-share requires non-empty content (--content or --content-file)')); process.exit(1);
        }
        campaigns = built;
      }

      const dryRun = options.dryRun !== false;
      const spinner = ora(`${dryRun ? '[DRY RUN] ' : ''}Running ${options.action} on ${platform}...`).start();

      let browser;
      let page;
      try {
        let result;

        if (action === 'messenger-share') {
          // Legacy multi-link multi-recipient campaign still needs a Puppeteer page.
          browser = await createBrowser();
          page = await createPage(browser);
          await loginWithCookie(page, authCookie);

          // ADR-012: messenger-share uses a HIGHER delay floor (5–15s jitter), NOT the
          // 1–3s like/comment default. Dry-run still passes the no-op delay from above.
          const messengerDelay = dryRun
            ? () => {}
            : (min = 5000, max = 15000) =>
                new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
          const campaignOpts = { dryRun, maxBatch: parseInt(options.maxBatch, 10), delay: messengerDelay };
          const runs = [];
          for (const campaign of campaigns) {
            runs.push(await messengerShareCampaign(page, campaign, campaignOpts));
          }
          result = { campaigns: runs.length, runs };
        } else {
          /** @type {Record<string, unknown>} */
          const scrapeArgs = {
            dryRun,
            ...(options.maxBatch && { maxBatch: parseInt(options.maxBatch, 10) }),
            authCookie,
          };
          if (action === 'like' || action === 'comment' || action === 'share') {
            scrapeArgs.urls = urls;
          }
          if (action === 'comment' || action === 'post') {
            scrapeArgs.text = options.text;
          }
          if (action === 'join-group') {
            if (groupUrls.length) scrapeArgs.groupUrls = groupUrls;
            else {
              scrapeArgs.keyword = options.keyword;
              scrapeArgs.limit = Number(options.limit);
            }
          }
          if (action === 'send-friend-request') {
            scrapeArgs.targets = targets;
            scrapeArgs.mode = options.mode || 'uid_list';
            if (options.location) scrapeArgs.location = options.location;
            scrapeArgs.limit = Number(options.limit);
          }

          result = await scrape('facebook', action, scrapeArgs);
        }

        spinner.succeed(`${dryRun ? '[DRY RUN] ' : ''}${action} complete`);
        console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        spinner.fail(`Failed: ${err.message}`);
        process.exit(1);
      } finally {
        if (browser) await browser.close().catch(() => {});
      }
    });
}
