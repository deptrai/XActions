// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions export`, `migrate`, `diff` — data portability commands.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import scrapers from '../../scrapers/index.js';
import { loadConfig } from '../shared.js';

/**
 * Register the portability commands.
 *
 * @param {import('commander').Command} program
 */
export function registerPortabilityCommands(program) {
  program
    .command('export <username>')
    .description('Export a Twitter account (profile, tweets, followers, following, bookmarks)')
    .option('-f, --format <formats>', 'Output formats: json,csv,xlsx,md,html (comma-separated)', 'json,csv,md,html')
    .option('--only <phases>', 'Export only specific phases: profile,tweets,followers,following,bookmarks,likes (comma-separated)')
    .option('-l, --limit <number>', 'Maximum items per phase', '500')
    .option('-o, --output <dir>', 'Custom output directory')
    .action(async (username, options) => {
      const user = username.replace(/^@/, '');
      const formats = options.format.split(',').map((s) => s.trim());
      const only = options.only ? options.only.split(',').map((s) => s.trim()) : undefined;
      const limit = parseInt(options.limit, 10) || 500;

      const spinner = ora(`Exporting @${user}...`).start();

      try {
        const browser = await scrapers.createBrowser();
        const page = await scrapers.createPage(browser);

        const config = await loadConfig();
        if (config.authToken) {
          await scrapers.loginWithCookie(page, config.authToken);
        }

        const { exportAccount } = await import('../../portability/exporter.js');
        const summary = await exportAccount({
          page,
          username: user,
          formats,
          only,
          limit,
          outputDir: options.output,
          scrapers,
          onProgress: ({ phase, completed, total, currentItem }) => {
            spinner.text = `[${phase}] ${currentItem || ''} (${completed}/${total})`;
          },
        });

        await browser.close();

        spinner.succeed(`Export complete → ${summary.dir}`);

        console.log('');
        for (const [phase, info] of Object.entries(summary.phases || {})) {
          const status = info.skipped ? chalk.gray('(cached)') : chalk.green('✓');
          console.log(`  ${status} ${chalk.bold(phase)}: ${info.count} items`);
        }
        if (summary.archiveViewer) {
          console.log(`\n  ${chalk.cyan('Archive viewer:')} ${summary.archiveViewer}`);
        }
        if (summary.errors?.length > 0) {
          console.log(`\n  ${chalk.yellow('Errors:')}`);
          for (const e of summary.errors) {
            console.log(`    ${chalk.red(e.phase)}: ${e.error}`);
          }
        }
        console.log('');
      } catch (error) {
        spinner.fail('Export failed');
        console.error(chalk.red(error.message));
      }
    });

  program
    .command('migrate <username>')
    .description('Migrate Twitter data to Bluesky or Mastodon')
    .requiredOption('--to <platform>', 'Target platform: bluesky or mastodon')
    .option('--dry-run', 'Preview migration without executing (default)', true)
    .option('--execute', 'Actually execute the migration')
    .option('--export-dir <dir>', 'Path to export directory (auto-detected if omitted)')
    .option('-l, --limit <number>', 'Max tweets to migrate', '50')
    .action(async (username, options) => {
      const user = username.replace(/^@/, '');
      const dryRun = !options.execute;
      const platform = options.to.toLowerCase();

      if (!['bluesky', 'mastodon'].includes(platform)) {
        console.error(chalk.red('Platform must be "bluesky" or "mastodon"'));
        return;
      }

      let exportDir = options.exportDir;
      if (!exportDir) {
        const { promises: fs } = await import('fs');
        const exportsRoot = path.join(process.cwd(), 'exports');
        try {
          const dirs = await fs.readdir(exportsRoot);
          const match = dirs
            .filter((d) => d.startsWith(user + '_'))
            .sort()
            .pop();
          if (match) exportDir = path.join(exportsRoot, match);
        } catch { /* no exports dir */ }
      }

      if (!exportDir) {
        console.error(chalk.red(`No export found for @${user}. Run "xactions export @${user}" first.`));
        return;
      }

      const spinner = ora(`${dryRun ? 'Previewing' : 'Executing'} migration to ${platform}...`).start();

      try {
        const { migrate } = await import('../../portability/importer.js');
        const summary = await migrate({
          platform,
          exportDir,
          dryRun,
          onProgress: ({ phase, completed, total }) => {
            spinner.text = `[${phase}] ${completed}/${total}`;
          },
        });

        spinner.succeed(`Migration ${dryRun ? 'preview' : ''} complete`);

        console.log(`\n  Platform: ${chalk.cyan(platform)}`);
        console.log(`  Mode: ${dryRun ? chalk.yellow('DRY RUN') : chalk.green('EXECUTE')}`);
        console.log(`  Tweets: ${summary.tweets.migrated}/${summary.tweets.total} ready`);
        console.log(`  Follows: ${summary.follows.matched}/${summary.follows.total} matchable`);

        if (dryRun) {
          console.log(`\n  ${chalk.yellow('This was a dry run. Add --execute to perform the migration.')}`);
        }

        if (summary.actions.length > 0) {
          console.log(`\n  ${chalk.gray('Sample actions:')}`);
          for (const a of summary.actions.slice(0, 5)) {
            console.log(`    ${a.type}: ${a.content?.slice(0, 60) || a.twitterUser || ''} [${a.status}]`);
          }
          if (summary.actions.length > 5) {
            console.log(`    ... and ${summary.actions.length - 5} more`);
          }
        }
        console.log('');
      } catch (error) {
        spinner.fail('Migration failed');
        console.error(chalk.red(error.message));
      }
    });

  program
    .command('diff <dirA> <dirB>')
    .description('Compare two account exports and show changes')
    .option('-o, --output <dir>', 'Output directory for report (default: dirB)')
    .action(async (dirA, dirB, options) => {
      const spinner = ora('Comparing exports...').start();

      try {
        const { diffAndReport } = await import('../../portability/differ.js');
        const { diff, files } = await diffAndReport(dirA, dirB, options.output);
        const s = diff.summary;

        spinner.succeed('Diff complete');

        console.log('');
        console.log(`  ${chalk.bold('Followers:')} ${chalk.green('+' + s.followersGained)} ${chalk.red('-' + s.followersLost)} (net: ${s.netFollowerChange >= 0 ? '+' : ''}${s.netFollowerChange})`);
        console.log(`  ${chalk.bold('Following:')} ${chalk.green('+' + s.followingAdded)} ${chalk.red('-' + s.followingRemoved)}`);
        console.log(`  ${chalk.bold('Tweets:')} ${chalk.green('+' + s.newTweets + ' new')} ${chalk.red(s.deletedTweets + ' deleted')}`);
        console.log(`  ${chalk.bold('Engagement changes:')} ${s.engagementChanges} tweets`);

        if (s.profileChanges > 0) {
          console.log(`  ${chalk.bold('Profile changes:')} ${s.profileChanges}`);
          for (const c of diff.profile.changes) {
            console.log(`    ${c.field}: ${chalk.gray(String(c.before))} → ${chalk.white(String(c.after))}`);
          }
        }

        console.log(`\n  ${chalk.cyan('Report:')} ${files.join(', ')}`);
        console.log('');
      } catch (error) {
        spinner.fail('Diff failed');
        console.error(chalk.red(error.message));
      }
    });
}
