// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.

import prisma from '../lib/prisma.js';
/**
 * Facebook Account Pool — bounded parallel task execution across live accounts.
 *
 * Story 7.1 — AC2:
 *   - Filter active accounts from health cache
 *   - Honor per-account proxy
 *   - Round-robin / LRU assignment
 *   - p-limit max concurrency (default 4, max 8)
 *   - Random 3-8s delay between browser launches
 *   - Per-c_user userDataDir
 *   - Checkpoint retry on another live account
 *
 * @author nich (@nichxbt)
 * @license BSL 1.1
 */

import path from 'node:path';
import fs from 'node:fs';
import pLimit from 'p-limit';
import { createBrowser, createPage, loginWithCookie } from '../../src/scrapers/facebook/index.js';
import { parseFlatProxy } from '../../src/scrapers/facebook/proxy.js';
import { decrypt } from '../routes/facebookAccounts.js';
import { checkAccountHealth } from './facebookHealth.js';
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
const randomDelay = (/** @type {number} */ min, /** @type {number} */ max) => sleep(min + Math.random() * (max - min));

const DEFAULT_MAX_CONCURRENCY = 4;
const MAX_CONCURRENCY = 8;
const DEFAULT_DELAY_MIN = 3000;
const DEFAULT_DELAY_MAX = 8000;

/**
 * Build a deterministic profile directory per c_user.
 * @param {string} c_user
 * @returns {string}
 */
export function buildUserDataDir(c_user) {
  const clean = String(c_user).replace(/\D/g, '');
  if (!clean) {
    throw new Error('❌ buildUserDataDir requires a numeric c_user');
  }
  const dir = path.resolve(process.cwd(), '.data', 'facebook-profiles', clean);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * @typedef {import('puppeteer').Credentials} ProxyAuth
 */

/**
 * @typedef {object} AccountContext
 * @property {string} id
 * @property {string} c_user
 * @property {string} xs
 * @property {string} userDataDir
 * @property {string | null} proxyServer
 * @property {ProxyAuth | null} proxyAuth
 */

/**
 * @typedef {object} ResolveOptions
 * @property {(account: Record<string, unknown>, options?: Record<string, unknown>) => Promise<Record<string, unknown>>} [checkAccountHealthImpl]
 */

/**
 * Resolve a stored FacebookAccount into the runtime context the pool needs.
 * Decrypts cookie and proxy, validates health, parses proxy.
 *
 * @param {import('@prisma/client').FacebookAccount} account - Prisma FacebookAccount
 * @param {ResolveOptions} [options]
 * @returns {Promise<AccountContext | null>}
 */
export async function resolveAccountContext(account, options = {}) {
  const healthCheck = options.checkAccountHealthImpl || checkAccountHealth;
  const health = await healthCheck(/** @type {Record<string, unknown>} */ (account), { force: false });
  if (health.status !== 'active') return null;

  const cookiePayload = decrypt(account.encryptedCookie);
  if (!cookiePayload) return null;

  let c_user;
  let xs;
  try {
    ({ c_user, xs } = JSON.parse(cookiePayload));
  } catch {
    return null;
  }
  if (!c_user || !xs) return null;

  let proxyServer = null;
  let proxyAuth = null;
  if (account.encryptedProxy) {
    const proxyText = decrypt(account.encryptedProxy);
    if (proxyText) {
      const desc = parseFlatProxy(proxyText);
      if (desc) {
        proxyServer = desc.server;
        if (desc.username) proxyAuth = { username: desc.username, password: desc.password || '' };
      }
    }
  }

  return {
    id: account.id,
    c_user: String(c_user),
    xs: String(xs),
    userDataDir: buildUserDataDir(String(c_user)),
    proxyServer,
    proxyAuth,
  };
}

/**
 * @typedef {object} BatchOptions
 * @property {number} [maxConcurrency]
 * @property {number | { min: number; max: number }} [delayBetweenLaunches]
 * @property {string[]} [accountIds]
 * @property {(opts: Record<string, unknown>) => Promise<import('puppeteer').Browser>} [launchImpl]
 * @property {(page: import('puppeteer').Page, cookie: { c_user: string; xs: string }, options?: Record<string, unknown>) => Promise<void>} [loginImpl]
 * @property {Record<string, unknown>} [loginOptions]
 * @property {Record<string, unknown>} [resolveAccountContextOptions]
 * @property {(account: import('@prisma/client').FacebookAccount, options?: ResolveOptions) => Promise<AccountContext | null>} [resolveAccountContextImpl]
 */

/**
 * @typedef {object} AccountUsage
 * @property {number} tasks
 * @property {number} checkpoints
 */

/**
 * Run an array of tasks in parallel across a pool of live Facebook accounts.
 *
 * @param {((page: import('puppeteer').Page, ctx: AccountContext) => Promise<Record<string, unknown>>)[]} tasks
 * @param {Partial<BatchOptions>} [options]
 * @returns {Promise<{ results: Record<string, unknown>[]; accountUsage: Record<string, AccountUsage> }>}
 */
export async function runBatch(tasks, options = {}) {
  const {
    maxConcurrency = DEFAULT_MAX_CONCURRENCY,
    delayBetweenLaunches,
    accountIds,
    launchImpl,
    loginImpl,
    loginOptions = {},
    resolveAccountContextOptions = {},
    resolveAccountContextImpl,
  } = options;

  if (!Array.isArray(accountIds) || accountIds.length === 0) {
    throw new Error('❌ runBatch requires a non-empty accountIds array');
  }

  if (!Array.isArray(tasks) || tasks.length === 0) {
    return { results: [], accountUsage: {} };
  }

  const concurrency = Math.max(1, Math.min(Number(maxConcurrency) || DEFAULT_MAX_CONCURRENCY, MAX_CONCURRENCY));

  const accounts = await prisma.facebookAccount.findMany({
    where: { id: { in: /** @type {string[]} */ (accountIds) } },
  });

  if (accounts.length === 0) {
    throw new Error('❌ No accounts found for the provided accountIds');
  }

  // Build active account contexts (health checked + cookie/proxy decrypted)
  const resolver = resolveAccountContextImpl || resolveAccountContext;
  /** @type {AccountContext[]} */
  const contexts = /** @type {AccountContext[]} */ ((await Promise.all(accounts.map((a) => resolver(/** @type {import('@prisma/client').FacebookAccount} */ (a), resolveAccountContextOptions)))).filter(Boolean));

  if (contexts.length === 0) {
    throw new Error('❌ No active Facebook accounts available for the pool');
  }

  /** @type {Record<string, AccountUsage>} */
  const usage = {};
  contexts.forEach((/** @type {AccountContext} */ ctx) => { usage[ctx.id] = { tasks: 0, checkpoints: 0 }; });

  const delayMin = typeof delayBetweenLaunches === 'number' ? delayBetweenLaunches : DEFAULT_DELAY_MIN;
  const delayMax = typeof delayBetweenLaunches === 'number' ? delayBetweenLaunches : DEFAULT_DELAY_MAX;

  const limit = pLimit(concurrency);

  const results = await Promise.all(
    tasks.map((task, index) => {
      if (typeof task !== 'function') {
        throw new Error(`❌ task at index ${index} must be a function`);
      }
      return limit(async () => {
        // stagger launches by index to spread load; later tasks wait a bit
        await randomDelay(0, Math.min(delayMax, delayMin + index * 1000));

        const startIndex = index % contexts.length;
        const attempts = contexts.length;

        for (let i = 0; i < attempts; i++) {
          const ctx = contexts[(startIndex + i) % contexts.length];
          const browserOptions = /** @type {Record<string, unknown>} */ ({ userDataDir: ctx.userDataDir });
          if (ctx.proxyServer) browserOptions.proxy = ctx.proxyServer;
          if (launchImpl) browserOptions.launchImpl = launchImpl;

          /** @type {import('puppeteer').Browser | undefined} */
          let browser;
          /** @type {import('puppeteer').Page | undefined} */
          let page;
          try {
            await randomDelay(delayMin, delayMax);
            const launchFn = launchImpl || createBrowser;
            browser = await launchFn(/** @type {Record<string, unknown>} */ (browserOptions));
            page = await createPage(browser);

            if (ctx.proxyAuth) {
              await page.authenticate(ctx.proxyAuth);
            }

            const doLogin = loginImpl || loginWithCookie;
            await doLogin(page, { c_user: ctx.c_user, xs: ctx.xs }, { ...loginOptions });

            const result = await task(page, ctx);

            usage[ctx.id].tasks += 1;

            if (page?.__xactions_browser || browser) {
              await (page?.__xactions_browser || browser).close().catch(() => {});
            }

            return result;
          } catch (err) {
            if (browser) await browser.close().catch(() => {});

            let pageUrl = '';
            try { pageUrl = page?.url?.() || ''; } catch { pageUrl = ''; }
            const message = err instanceof Error ? err.message : '';
            const lowerMessage = message.toLowerCase();
            const lowerUrl = pageUrl.toLowerCase();
            const isCheckpoint =
              lowerMessage.includes('checkpoint') ||
              lowerMessage.includes('security check') ||
              lowerMessage.includes('captcha') ||
              lowerUrl.includes('/checkpoint/') ||
              lowerUrl.includes('facebook.com/checkpoint') ||
              lowerUrl.includes('help/1865253247038416');

            if (isCheckpoint) {
              usage[ctx.id].checkpoints += 1;
              // try next live account
              continue;
            }

            // non-checkpoint error — fail fast for this task
            throw err;
          }
        }

        throw new Error('❌ All active accounts hit checkpoint while running task');
      })
    })
  );

  return { results, accountUsage: usage };
}

export default { runBatch, buildUserDataDir, resolveAccountContext };
