// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `medirus fb` command group.
 * Facebook utilities: capture GraphQL doc_ids from a live session, inspect the
 * captured store, and trigger headless refreshes when Facebook rotates them.
 *
 * doc_ids are per-build persisted-query IDs (identical for every account), so
 * one capture serves all accounts until Facebook ships a new web build.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */
// by nichxbt

import chalk from 'chalk';
import { printCliError } from '../shared.js';
import {
  getActiveDocIdStore,
  getDocIdStorePath,
} from '../../scrapers/social/facebook/doc-id-store.js';

/** @param {number} ms @returns {string} */
function formatAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'n/a';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function registerFbCommand(program) {
  const fb = program
    .command('fb')
    .description('Facebook utilities (doc_id capture, scraping helpers)');

  fb.command('capture-docids')
    .description(
      'Capture real Facebook GraphQL doc_ids from a browser session and persist them for every future scrape'
    )
    .option('--timeout <seconds>', 'How long to keep the capture browser open', '120')
    .option('--headless', 'Run without UI (requires saved cookies or --cookie-file)')
    .option('--cookie-file <path>', 'JSON file with Facebook cookies (c_user, xs, ...)')
    .option(
      '--save-cookies',
      'Save session cookies after capture so future refreshes can run headless'
    )
    .option('--json', 'Print the summary as JSON')
    .action(async (options) => {
      try {
        const { captureDocIds } = await import(
          '../../scrapers/social/facebook/doc-id-capture.js'
        );

        const timeoutSeconds = parseInt(options.timeout, 10) || 120;
        console.log(
          chalk.bold(`\n📸 Facebook doc_id capture (timeout ${timeoutSeconds}s)\n`)
        );
        console.log(
          chalk.gray(
            'doc_ids la persisted-query IDs cua Facebook web build - giong nhau voi moi tai khoan,\n' +
              'capture mot lan dung cho tat ca cho den khi Facebook deploy build moi.\n'
          )
        );

        const summary = await captureDocIds({
          headless: Boolean(options.headless),
          timeoutMs: timeoutSeconds * 1000,
          cookieFile: options.cookieFile || null,
          saveCookies: Boolean(options.saveCookies),
          onProgress: (message) => console.log(chalk.dim(`  ${message}`)),
        });

        if (options.json) {
          console.log(JSON.stringify(summary, null, 2));
          return;
        }

        console.log(
          `\n${chalk.green('✔')} Da capture ${chalk.bold(String(summary.total))} GraphQL queries ` +
            `(${chalk.bold(String(summary.mapped))} map vao action, ${summary.extra} chua map)`
        );
        console.log(chalk.gray(`  Store: ${summary.storePath}`));
        if (summary.cookiesSaved) {
          console.log(
            chalk.gray(
              '  Cookie da luu - tu nay co the refresh headless (cron / FACEBOOK_DOCIDS_AUTO_REFRESH=1).'
            )
          );
        }
        console.log(
          chalk.gray(
            '\n  Cac lan scrape sau tu dong dung doc_ids nay. Khi Facebook rotate, chay lai lenh nay.'
          )
        );
      } catch (err) {
        printCliError(err);
      }
    });

  fb.command('docids')
    .description('Show captured Facebook doc_ids (or manage the store)')
    .option('--clear', 'Delete the captured doc_id store')
    .option('--refresh', 'Re-capture headless right now (needs saved cookies)')
    .option('--json', 'Print as JSON')
    .action(async (options) => {
      try {
        if (options.clear) {
          const fs = await import('node:fs');
          const storePath = getDocIdStorePath();
          if (fs.existsSync(storePath)) {
            fs.unlinkSync(storePath);
            console.log(chalk.yellow(`🗑  Da xoa ${storePath}`));
          } else {
            console.log(chalk.gray('Khong co store nao de xoa.'));
          }
          return;
        }

        if (options.refresh) {
          const { maybeAutoRefreshDocIds } = await import(
            '../../scrapers/social/facebook/doc-id-capture.js'
          );
          const result = await maybeAutoRefreshDocIds({ reason: 'manual' });
          if (result.refreshed) {
            console.log(chalk.green('✔ Da refresh doc_ids (headless).'));
          } else {
            console.log(chalk.yellow(`Khong refresh duoc (${result.reason}).`));
          }
        }

        const store = getActiveDocIdStore();
        const stats = store.getStats();

        if (options.json) {
          console.log(JSON.stringify({ stats, docIds: store.toJSON().docIds, extra: store.toJSON().extra }, null, 2));
          return;
        }

        console.log(chalk.bold(`\n📋 Facebook doc_ids (${store.filePath})\n`));
        if (stats.total === 0) {
          console.log(
            chalk.gray('Store trong. Chay ') +
              chalk.cyan('medirus fb capture-docids') +
              chalk.gray(' de capture tu mot session that.')
          );
          return;
        }

        const age = stats.capturedAt ? formatAge(Date.now() - stats.capturedAt) : 'n/a';
        console.log(
          chalk.gray(`  Captured ${age} truoc | ${stats.total} actions | ${stats.failures} failures | ${stats.stale ? 'STALE' : 'fresh'}\n`)
        );

        const data = store.toJSON();
        for (const [action, entry] of Object.entries(data.docIds)) {
          const fail = entry.failCount > 0 ? chalk.red(` (${entry.failCount} fails)`) : '';
          console.log(
            `  ${chalk.bold(action.padEnd(22))} ${chalk.cyan(String(entry.docId).padEnd(24))} ` +
              `${chalk.gray(String(entry.friendlyName || '-').slice(0, 52))}${fail}`
          );
        }
        if (stats.extra > 0) {
          console.log(chalk.gray(`\n  + ${stats.extra} queries chua map (xem --json de lay doc_id).`));
        }
      } catch (err) {
        printCliError(err);
      }
    });
}
