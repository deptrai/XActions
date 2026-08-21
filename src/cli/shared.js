// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Shared helpers for the XActions CLI.
 *
 * Anything extracted from src/cli/index.js as a reusable dependency lands here
 * so command modules can import it explicitly instead of reaching back into a
 * 4,000-line monolith.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import scrapers from '../scrapers/index.js';

export const CONFIG_DIR = path.join(os.homedir(), '.xactions');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export async function loadConfig() {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

export async function saveConfig(config) {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function formatNumber(num) {
  if (typeof num === 'string') {
    num = parseFloat(num.replace(/[,K]/g, (m) => (m === 'K' ? '000' : '')));
  }
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return String(num);
}

/**
 * Build an HTTP-only Scraper, authenticated if a session cookie is saved.
 *
 * Read commands prefer this over Puppeteer. X no longer serves profile or
 * timeline content to a logged-out browser, so the DOM scrape came back empty
 * and the CLI cheerfully printed `Followers: 0` and exited 0 — the first
 * command in the README looked broken to every new user. The internal GraphQL
 * API still answers guest-token requests for public reads, is an order of
 * magnitude faster, and needs no Chromium download.
 *
 * @returns {Promise<import('../client/index.js').Scraper>}
 */
export async function createHttpScraper() {
  const { Scraper } = await import('../client/index.js');
  const scraper = new Scraper();

  // Prefer a full cookie jar exported from the browser — it carries ct0, which
  // X requires as a CSRF header before it will treat a session as logged in.
  try {
    await scraper.loadCookies(path.join(CONFIG_DIR, 'cookies.json'));
    return scraper;
  } catch {
    // No cookie jar saved; fall through to the values `xactions login` stores.
  }

  const config = await loadConfig();
  if (config.authToken) {
    const parts = [`auth_token=${config.authToken}`];
    if (config.csrfToken) parts.push(`ct0=${config.csrfToken}`);
    await scraper.setCookies(parts.join('; '));
  }

  return scraper;
}

/**
 * Fail loudly when a scrape came back empty.
 *
 * Silently reporting "0 results" as success is the single most confusing thing
 * a scraper can do: it is indistinguishable from an account that genuinely has
 * nothing, so nobody files a bug and everybody assumes the tool is broken.
 *
 * @param {unknown[]} results
 * @param {string} what - Noun for the message, e.g. "tweets"
 * @param {string} hint - What the user should try next
 * @throws {Error} When results is empty
 */
export function assertNotEmpty(results, what, hint) {
  if (results && results.length > 0) return;
  throw new Error(
    `No ${what} returned. This usually means X served an empty page rather than ` +
      `that none exist.\n  ${hint}`,
  );
}

/** Suggested next step when an unauthenticated read comes back empty. */
export const AUTH_HINT =
  'Run `xactions login` with your auth_token cookie (DevTools > Application > Cookies > x.com), ' +
  'or retry in a minute if you are being rate limited.';

/**
 * Smart output handler — routes data to the right exporter based on file extension.
 * Supports: .json, .csv, .xlsx, plus --google-sheets flag.
 *
 * @param {Object[]} data - Array of objects to export
 * @param {Object} options - CLI options (output, googleSheets, sheetName)
 * @param {string} defaultName - Default filename stem (e.g., 'followers')
 */
export async function smartOutput(data, options, defaultName = 'data') {
  // `--json` is an explicit "give me the data on stdout" and outranks every
  // destination flag. These commands already default to JSON when no
  // destination is set, but a script written against the documented contract
  // (`--json` works on every read command) must not silently write a file
  // instead of piping, and must not fail with "unknown option" either.
  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  // Google Sheets export
  if (options.googleSheets) {
    try {
      const { exportToGoogleSheets } = await import('../plugins/google-sheets/index.js');
      const result = await exportToGoogleSheets(data, {
        spreadsheetId: options.googleSheets,
        sheetName: options.sheetName || defaultName,
        mode: options.sheetMode || 'append',
      });
      console.log(chalk.green(`✓ Exported ${result.rowsWritten} rows to Google Sheets`));
      console.log(chalk.gray(`  → ${result.url}`));
      return;
    } catch (error) {
      console.error(chalk.red(`Google Sheets export failed: ${error.message}`));
      console.log(chalk.yellow('Falling back to JSON output...'));
    }
  }

  // File output
  if (options.output) {
    const ext = path.extname(options.output).toLowerCase();

    if (ext === '.xlsx') {
      try {
        const { exportToExcel } = await import('../plugins/excel/index.js');
        const result = await exportToExcel(data, {
          filepath: options.output,
          sheetName: options.sheetName || defaultName,
        });
        console.log(chalk.green(`✓ Saved ${result.rowsWritten} rows to ${options.output}`));
        return;
      } catch (error) {
        console.error(chalk.red(`Excel export failed: ${error.message}`));
        console.log(chalk.yellow('Falling back to JSON...'));
      }
    }

    if (ext === '.csv') {
      await scrapers.exportToCSV(data, options.output);
    } else {
      await scrapers.exportToJSON(data, options.output);
    }
    console.log(chalk.green(`✓ Saved to ${options.output}`));
    return;
  }

  // Default: print JSON to stdout
  console.log(JSON.stringify(data, null, 2));
}

/**
 * Parse a positive integer CLI argument.
 * @param {string} value
 * @param {string} fieldName
 * @returns {number}
 */
export function parseCliPositiveInt(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return parsed;
}

/**
 * Parse a non-negative integer CLI argument.
 * @param {string} value
 * @param {string} fieldName
 * @returns {number}
 */
export function parseCliNonNegativeInt(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
  return parsed;
}

/**
 * Print a CLI error and set a non-zero exit code.
 * @param {Error} error
 * @param {{json?: boolean}} [options={}]
 */
export function printCliError(error, options = {}) {
  if (options.json) {
    console.log(JSON.stringify({
      success: false,
      error: {
        code: error.code || 'XACT_5000',
        message: error.message,
      },
    }, null, 2));
  } else {
    console.error(chalk.red(`❌ ${error.message}`));
  }
  process.exitCode = 1;
}

/**
 * Disconnect a Prisma client safely.
 * @param {import('@prisma/client').PrismaClient|undefined} prisma
 */
export async function disconnectPrisma(prisma) {
  if (prisma) {
    try { await prisma.$disconnect(); } catch (err) {
      console.warn(`⚠️ Prisma disconnect warning: ${err.message}`);
    }
  }
}
