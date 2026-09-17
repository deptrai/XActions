// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Cross-platform syndication commands for XActions CLI (Story 30.1, Story 30.2, Story 31.1).
 *
 * Exposes multi-platform write operations:
 * - `xactions publish-all`
 * - `xactions like-all`
 * - `xactions follow-all`
 * - `xactions download-media`
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import chalk from 'chalk';
import ora from 'ora';
import fs from 'node:fs/promises';
import { printCliError } from '../shared.js';

/**
 * Register syndication commands on the Commander program.
 *
 * @param {import('commander').Command} program
 */
export function registerSyndicationCommands(program) {
  // ============================================================================
  // publish-all
  // ============================================================================
  program
    .command('publish-all [text]')
    .description('Publish a post or thread across multiple platforms (Twitter, Bluesky, Mastodon, Threads)')
    .option('-t, --text <text>', 'Post text content')
    .option('-p, --platforms <platforms>', 'Target platforms comma-separated or "all"', 'all')
    .option('--media <urls>', 'Media URLs or IDs (comma-separated)')
    .option('--no-auto-thread', 'Disable automatic thread splitting when text exceeds platform limits')
    .option('--dry-run', 'Preview without making network requests')
    .option('--json', 'Output results as JSON')
    .action(async (textArg, options) => {
      const content = textArg || options.text;
      if (!content || typeof content !== 'string' || content.trim().length === 0) {
        printCliError(new Error('Post content is required (provide text as argument or via --text)'), {
          json: options.json,
        });
        return;
      }

      const spinner = options.json ? null : ora('Publishing cross-platform...').start();

      try {
        const { UniversalActionDispatcher } = await import('../../scrapers/social/dispatcher.js');

        const mediaIds = options.media
          ? options.media.split(',').map((m) => m.trim()).filter(Boolean)
          : undefined;

        const result = await UniversalActionDispatcher.dispatch({
          platform: options.platforms || 'all',
          action: 'post',
          args: {
            text: content,
            mediaIds,
            autoThread: options.autoThread !== false,
          },
          options: {
            dryRun: Boolean(options.dryRun),
            autoThread: options.autoThread !== false,
          },
        });

        if (spinner) spinner.stop();

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(chalk.bold(`\n📢 Cross-Platform Publish Summary (${result.action})\n`));
        console.log(`  • ${chalk.cyan('Total Platforms')}: ${result.summary.total}`);
        console.log(`  • ${chalk.green('Succeeded')}:       ${result.summary.succeeded}`);
        console.log(`  • ${chalk.red('Failed')}:          ${result.summary.failed}\n`);

        for (const [platform, res] of Object.entries(result.results || {})) {
          console.log(`  ${chalk.green('✔')} ${chalk.bold(platform)}: ${chalk.dim(JSON.stringify(res))}`);
        }

        for (const [platform, err] of Object.entries(result.errors || {})) {
          console.log(`  ${chalk.red('✖')} ${chalk.bold(platform)}: ${chalk.yellow(err.message || JSON.stringify(err))}`);
        }
        console.log();

        if (!result.success) {
          process.exitCode = 1;
        }
      } catch (error) {
        if (spinner) spinner.stop();
        printCliError(error instanceof Error ? error : new Error(String(error)), { json: options.json });
      }
    });

  // ============================================================================
  // like-all
  // ============================================================================
  program
    .command('like-all <targetId>')
    .description('Like a post across multiple platforms')
    .option('-p, --platforms <platforms>', 'Target platforms comma-separated or "all"', 'all')
    .option('--uri <uri>', 'AT Protocol URI (for Bluesky)')
    .option('--cid <cid>', 'Content CID (for Bluesky)')
    .option('--dry-run', 'Preview without making network requests')
    .option('--json', 'Output results as JSON')
    .action(async (targetId, options) => {
      const spinner = options.json ? null : ora(`Liking post ${targetId}...`).start();

      try {
        const { UniversalActionDispatcher } = await import('../../scrapers/social/dispatcher.js');

        const result = await UniversalActionDispatcher.dispatch({
          platform: options.platforms || 'all',
          action: 'like',
          args: {
            targetId,
            uri: options.uri,
            cid: options.cid,
          },
          options: {
            dryRun: Boolean(options.dryRun),
          },
        });

        if (spinner) spinner.stop();

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(chalk.bold(`\n❤️ Cross-Platform Like Summary\n`));
        console.log(`  • Target ID:  ${chalk.yellow(targetId)}`);
        console.log(`  • Succeeded:  ${chalk.green(result.summary.succeeded)} / ${result.summary.total}\n`);

        for (const [platform, res] of Object.entries(result.results || {})) {
          console.log(`  ${chalk.green('✔')} ${chalk.bold(platform)}: ${chalk.dim(JSON.stringify(res))}`);
        }

        for (const [platform, err] of Object.entries(result.errors || {})) {
          console.log(`  ${chalk.red('✖')} ${chalk.bold(platform)}: ${chalk.yellow(err.message || JSON.stringify(err))}`);
        }
        console.log();

        if (!result.success) {
          process.exitCode = 1;
        }
      } catch (error) {
        if (spinner) spinner.stop();
        printCliError(error instanceof Error ? error : new Error(String(error)), { json: options.json });
      }
    });

  // ============================================================================
  // follow-all
  // ============================================================================
  program
    .command('follow-all <target>')
    .description('Follow an account across multiple platforms')
    .option('-p, --platforms <platforms>', 'Target platforms comma-separated or "all"', 'all')
    .option('--dry-run', 'Preview without making network requests')
    .option('--json', 'Output results as JSON')
    .action(async (target, options) => {
      const spinner = options.json ? null : ora(`Following ${target}...`).start();

      try {
        const { UniversalActionDispatcher } = await import('../../scrapers/social/dispatcher.js');

        const result = await UniversalActionDispatcher.dispatch({
          platform: options.platforms || 'all',
          action: 'follow',
          args: {
            username: target,
            subject: target,
            accountId: target,
          },
          options: {
            dryRun: Boolean(options.dryRun),
          },
        });

        if (spinner) spinner.stop();

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(chalk.bold(`\n👥 Cross-Platform Follow Summary\n`));
        console.log(`  • Target:     ${chalk.yellow(target)}`);
        console.log(`  • Succeeded:  ${chalk.green(result.summary.succeeded)} / ${result.summary.total}\n`);

        for (const [platform, res] of Object.entries(result.results || {})) {
          console.log(`  ${chalk.green('✔')} ${chalk.bold(platform)}: ${chalk.dim(JSON.stringify(res))}`);
        }

        for (const [platform, err] of Object.entries(result.errors || {})) {
          console.log(`  ${chalk.red('✖')} ${chalk.bold(platform)}: ${chalk.yellow(err.message || JSON.stringify(err))}`);
        }
        console.log();

        if (!result.success) {
          process.exitCode = 1;
        }
      } catch (error) {
        if (spinner) spinner.stop();
        printCliError(error instanceof Error ? error : new Error(String(error)), { json: options.json });
      }
    });

  // ============================================================================
  // download-media
  // ============================================================================
  program
    .command('download-media <url>')
    .description('Extract and download media (video/audio/images) from any social media post URL')
    .option('-p, --platform <platform>', 'Explicit platform override (twitter, bluesky, mastodon, threads, facebook, tiktok)')
    .option('-q, --quality <quality>', 'Quality preference (highest, lowest, all)', 'highest')
    .option('-o, --output <file>', 'Output path to save media metadata or file')
    .option('--json', 'Output extracted media as JSON')
    .action(async (url, options) => {
      const spinner = options.json ? null : ora('Extracting media from post...').start();

      try {
        const { downloadMedia } = await import('../../scrapers/videoDownloader.js');

        const result = await downloadMedia(url, {
          platform: options.platform,
          quality: options.quality || 'highest',
        });

        if (spinner) spinner.stop();

        if (options.output) {
          await fs.writeFile(options.output, JSON.stringify(result, null, 2), 'utf-8');
        }

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (!result.success || !result.media || result.media.length === 0) {
          console.log(chalk.yellow(`⚠️ No downloadable media found at ${url}`));
          return;
        }

        console.log(chalk.bold(`\n🎬 Extracted Media (${result.media.length} items)\n`));
        console.log(`  • ${chalk.cyan('Source URL')}:   ${chalk.underline(url)}`);
        if (result.bestUrl) {
          console.log(`  • ${chalk.green('Best Stream')}:  ${chalk.underline(result.bestUrl)}`);
        }

        result.media.forEach((item, idx) => {
          console.log(`\n  [${idx + 1}] Type: ${chalk.bold.yellow(item.type)} (${item.contentType || 'unknown'})`);
          console.log(`      Direct URL: ${chalk.underline(item.url)}`);
          if (item.bitrate) {
            console.log(`      Bitrate:    ${(item.bitrate / 1000).toFixed(0)} kbps`);
          }
          if (item.variants && item.variants.length > 1) {
            console.log(`      Variants:   ${item.variants.length} qualities available`);
          }
        });
        console.log();

        if (options.output) {
          console.log(chalk.green(`✔ Saved metadata to ${options.output}\n`));
        }
      } catch (error) {
        if (spinner) spinner.stop();
        printCliError(error instanceof Error ? error : new Error(String(error)), { json: options.json });
      }
    });
}
