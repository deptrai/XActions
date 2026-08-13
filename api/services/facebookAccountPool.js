// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
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
import { PrismaClient } from '@prisma/client';
import { createBrowser, createPage, loginWithCookie } from '../../src/scrapers/facebook/index.js';
import { parseFlatProxy } from '../../src/scrapers/facebook/proxy.js';
import { decrypt } from '../routes/facebookAccounts.js';
import { checkAccountHealth } from './facebookHealth.js';

const prisma = new PrismaClient();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomDelay = (min, max) => sleep(min + Math.random() * (max - min));

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
 * Resolve a stored FacebookAccount into the runtime context the pool needs.
 * Decrypts cookie and proxy, validates health, parses proxy.
 *
 * @param {Object} account - Prisma FacebookAccount
 * @returns {Promise<{ id, c_user, xs, userDataDir, proxyServer, proxyAuth }|null>}
 */
export async function resolveAccountContext(account, options = {}) {
  const healthCheck = options.checkAccountHealthImpl || checkAccountHealth;
  const health = await healthCheck(account, { force: false });
  if (health.status !== 'active') return null;

  const cookiePayload = decrypt(account.encryptedCookie);
  if (!cookiePayload) return null;

  let c_user, xs;
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
        if (desc.username) proxyAuth = { username: desc.username, password: desc.password };
      }
    }
  }

  return {
    id: account.id,
    c_user,
    xs,
    userDataDir: buildUserDataDir(c_user),
    proxyServer,
    proxyAuth,
  };
}

/**
 * Run an array of tasks in parallel across a pool of live Facebook accounts.
 *
 * @param {Function[]} tasks - Each task is `async (page, accountContext) => result`
 * @param {Object} options
 * @param {number} [options.maxConcurrency=4] - max concurrent browsers
 * @param {number|{min:number,max:number}} [options.delayBetweenLaunches=3-8s] - delay before each launch
 * @param {string[]} [options.accountIds] - account IDs to consider
 * @returns {Promise<{ results: any[], accountUsage: object }>}
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
    where: { id: { in: accountIds } },
  });

  if (accounts.length === 0) {
    throw new Error('❌ No accounts found for the provided accountIds');
  }

  // Build active account contexts (health checked + cookie/proxy decrypted)
  const resolver = resolveAccountContextImpl || resolveAccountContext;
  const contexts = (await Promise.all(accounts.map((a) => resolver(a, resolveAccountContextOptions)))).filter(Boolean);

  if (contexts.length === 0) {
    throw new Error('❌ No active Facebook accounts available for the pool');
  }

  const usage = {};
  contexts.forEach((ctx) => { usage[ctx.id] = { tasks: 0, checkpoints: 0 }; });

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
          const browserOptions = { userDataDir: ctx.userDataDir };
          if (ctx.proxyServer) browserOptions.proxy = ctx.proxyServer;
          if (launchImpl) browserOptions.launchImpl = launchImpl;

          let browser;
          let page;
          try {
            await randomDelay(delayMin, delayMax);
            browser = await createBrowser(browserOptions);
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
            const message = err?.message || '';
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
