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
      const {
        likeFacebookPosts,
        commentOnFacebookPosts,
        createFacebookPost,
        shareFacebookPosts,
        joinFacebookGroups,
        sendFriendRequests,
      } = await import('../../../api/services/facebookAutomation.js');
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

      // Hard auth guard — Facebook automate requires a session cookie (mirror scrape command).
      if (!authCookie) {
        console.error(chalk.red('❌ Facebook automate requires --auth-cookie \'{"c_user":"...","xs":"..."}\''));
        process.exit(1);
      }

      // Validate action + required args BEFORE launching the browser (fail fast, no wasted launch).
      let action = options.action.toLowerCase();
      if (action === 'messenger') action = 'messenger-share';
      if (action === 'join-groups') action = 'join-group';
      if (action === 'send-friend-requests') action = 'send-friend-request';
      const urls = (options.urls || '').split(',').map((u) => u.trim()).filter(Boolean);
      const groupUrls = (options.groupUrls || '').split(',').map((u) => u.trim()).filter(Boolean);
      const targets = (options.targets || '').split(',').map((u) => u.trim()).filter(Boolean);

      if (action === 'like' && !urls.length) {
        console.error(chalk.red('❌ --urls required for like action')); process.exit(1);
      }
      if (action === 'share' && !urls.length) {
        console.error(chalk.red('❌ --urls required for share action')); process.exit(1);
      }
      if (action === 'comment' && (!urls.length || !options.text)) {
        console.error(chalk.red('❌ --urls and --text required for comment action')); process.exit(1);
      }
      if (action === 'post' && !options.text) {
        console.error(chalk.red('❌ --text required for post action')); process.exit(1);
      }
      if (action === 'join-group' && !groupUrls.length && !options.keyword) {
        console.error(chalk.red('❌ --group-urls or --keyword required for join-group action')); process.exit(1);
      }
      if (action === 'send-friend-request' && options.mode === 'uid_list' && !targets.length) {
        console.error(chalk.red('❌ --targets required for send-friend-request in uid_list mode')); process.exit(1);
      }
      if (!['like', 'comment', 'post', 'share', 'join-group', 'send-friend-request', 'messenger-share'].includes(action)) {
        console.error(chalk.red(`❌ Unknown action "${action}". Supported: like, comment, post, share, join-group, send-friend-request, messenger-share`)); process.exit(1);
      }

      let campaigns = [];
      if (action === 'messenger-share') {
        const readFileSafe = async (p, label) => {
          try {
            return await fs.readFile(p, 'utf-8');
          } catch {
            console.error(chalk.red(`❌ Cannot read ${label} file: ${p}`));
            process.exit(1);
          }
        };

        let recipients = [];
        if (options.recipients) {
          recipients = options.recipients.split(',').map((r) => r.trim()).filter(Boolean);
          console.log(chalk.gray('ℹ️ recipients: using inline --recipients'));
        } else if (options.recipientsFile) {
          const txt = await readFileSafe(options.recipientsFile, 'recipients');
          recipients = parseRecipientsFile(txt);
          console.log(chalk.gray(`ℹ️ recipients: using --recipients-file (${recipients.length} entries)`));
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

      let browser, page;
      try {
        browser = await createBrowser();
        page = await createPage(browser);
        await loginWithCookie(page, authCookie);

        const guardedOptions = {
          dryRun,
          maxBatch: parseInt(options.maxBatch, 10),
          delay: dryRun ? () => {} : undefined,
        };

        let result;

        if (action === 'like') {
          result = await likeFacebookPosts(page, urls, guardedOptions);
        } else if (action === 'share') {
          result = await shareFacebookPosts(page, urls, guardedOptions);
        } else if (action === 'comment') {
          result = await commentOnFacebookPosts(page, urls, options.text, guardedOptions);
        } else if (action === 'post') {
          result = await createFacebookPost(page, options.text, guardedOptions);
        } else if (action === 'join-group') {
          const input = groupUrls.length ? { groupUrls } : { keyword: options.keyword, limit: Number(options.limit) };
          result = await joinFacebookGroups(page, input, guardedOptions);
        } else if (action === 'send-friend-request') {
          const input = { mode: options.mode || 'uid_list', targets, location: options.location, limit: Number(options.limit) };
          result = await sendFriendRequests(page, input, guardedOptions);
        } else if (action === 'messenger-share') {
          const messengerDelay = dryRun
            ? () => {}
            : (min = 5000, max = 15000) =>
                new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
          const campaignOpts = { ...guardedOptions, delay: messengerDelay };
          const runs = [];
          for (const campaign of campaigns) {
            runs.push(await messengerShareCampaign(page, campaign, campaignOpts));
          }
          result = { campaigns: runs.length, runs };
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
