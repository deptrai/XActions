// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
/**
 * FacebookScrapeService — single source of truth for Facebook scraping (Story 7.4, AD-7.7).
 *
 * Both the REST API (api/routes/facebook.js) and MCP tools (src/mcp/server.js) route
 * through this service. It resolves auth and dispatches directly to FacebookCrawler
 * via the hybrid dispatcher in src/scrapers/index.js.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import { resolve as resolveFacebookAuth } from './facebookAuth.js';
import { runBatch as poolRunBatch } from './facebookAccountPool.js';
import {
  createFacebookClient,
  createFacebookCrawler,
  dispatchFacebookHybrid,
} from '../../src/scrapers/index.js';

/**
 * Build a result-bucket object from 4 search type results.
 * @param {unknown[]} results
 * @returns {Record<string, unknown[]>}
 */
function bucketSearchResults(results) {
  /** @type {Record<string, unknown[]>} */
  const buckets = { posts: [], people: [], pages: [], groups: [] };
  const keys = ['posts', 'people', 'pages', 'groups'];
  for (let i = 0; i < keys.length; i += 1) {
    const val = results[i];
    if (Array.isArray(val)) {
      buckets[keys[i]] = val;
    } else if (val && typeof val === 'object') {
      const obj = /** @type {Record<string, unknown>} */ (val);
      if (Array.isArray(obj[keys[i]])) buckets[keys[i]] = /** @type {unknown[]} */ (obj[keys[i]]);
      else if (keys[i] === 'people' && Array.isArray(obj.users)) buckets[keys[i]] = /** @type {unknown[]} */ (obj.users);
      else if (Array.isArray(obj.items)) buckets[keys[i]] = /** @type {unknown[]} */ (obj.items);
    }
  }
  return buckets;
}

/**
 * Run a single Facebook scrape action directly through FacebookCrawler.
 *
 * @param {string} action - One of VALID_ACTIONS (profile, posts, followers, search, etc.)
 * @param {Record<string, unknown>} args - Action arguments including authCookie, browserOptions, and action-specific params.
 * @returns {Promise<Record<string, unknown>>} Scraper result (array or object depending on action).
 */
export async function run(action, args = {}) {
  const authCookie = /** @type {Record<string, unknown> | null} */ (args.authCookie);
  const userId = /** @type {string | undefined} */ (args.userId);
  const browserOptions = /** @type {Record<string, unknown> | undefined} */ (args.browserOptions);
  const rest = /** @type {Record<string, unknown>} */ ({});
  for (const [k, v] of Object.entries(args)) {
    if (!['authCookie', 'userId', 'browserOptions'].includes(k)) {
      rest[k] = v;
    }
  }

  // Resolve authCookie to { c_user, xs } via FacebookAuthResolver.
  // Public actions can omit authCookie entirely and run as guest.
  /** @type {{ c_user?: string, xs?: string }} */
  const resolved = authCookie && typeof authCookie === 'object'
    ? await resolveFacebookAuth(authCookie, userId)
    : { c_user: undefined, xs: undefined };

  const browserOpts = /** @type {Record<string, unknown>} */ (browserOptions || {});
  const client = createFacebookClient(browserOpts);
  const crawler = createFacebookCrawler(client, browserOpts);

  try {
    // search with type: 'all' and parallel: true fans out to 4 sub-tasks.
    if (action === 'search' && rest.type === 'all' && rest.parallel === true) {
      return runSearchAllParallel(
        /** @type {import('../../src/types/xactions.js').XActionsOptions} */ ({
          ...rest,
          ...(resolved.c_user ? { authCookie: { c_user: resolved.c_user, xs: resolved.xs } } : {}),
          ...(browserOptions ? { browserOptions } : {}),
        }),
        rest,
        userId,
        browserOptions,
      );
    }

    return /** @type {Record<string, unknown>} */ (
      await dispatchFacebookHybrid(action, {
        ...rest,
        ...(resolved.c_user ? { authCookie: { c_user: resolved.c_user, xs: resolved.xs } } : {}),
        browserOptions: browserOpts,
        client,
        crawler,
      })
    );
  } finally {
    if (typeof crawler.cleanup === 'function') {
      await crawler.cleanup().catch(() => {});
    }
  }
}

/**
 * Run search with type: 'all' and parallel: true — fan out to 4 sub-tasks.
 * For multi-account runs the pool creates one FacebookCrawler per account and reuses it.
 *
 * @param {import('../../src/types/xactions.js').XActionsOptions} baseArgs - Base scrape args (authCookie, browserOptions, etc.)
 * @param {Record<string, unknown>} rest - Action-specific params (query, location, limit, etc.)
 * @param {string} [userId] - User ID for account resolution.
 * @param {Record<string, unknown>} [browserOptions] - Browser options.
 * @returns {Promise<Record<string, unknown>>}
 */
export async function runSearchAllParallel(baseArgs = {}, rest = {}, userId, browserOptions) {
  const query = /** @type {string} */ (rest.query ?? baseArgs.query ?? '');
  const location = /** @type {string | undefined} */ (rest.location ?? baseArgs.location);
  const limit = /** @type {number | undefined} */ (rest.limit ?? baseArgs.limit);
  const types = ['posts', 'people', 'pages', 'groups'];

  // If we have accountIds, use runBatch for true hybrid parallelism.
  const accountIds = /** @type {string[]} */ (rest.accountIds ?? baseArgs.accountIds);
  if (Array.isArray(accountIds) && accountIds.length > 0) {
    /** @type {((crawler: import('../../src/scrapers/social/facebook/crawler.js').FacebookCrawler, ctx: Record<string, unknown>) => Promise<Record<string, unknown>>)[]} */
    const tasks = types.map((type) =>
      async (crawler, ctx) =>
        dispatchFacebookHybrid('search', {
          query,
          type,
          ...(location != null && { location }),
          ...(limit != null && { limit }),
          authCookie: { c_user: ctx.c_user, xs: ctx.xs },
          browserOptions,
          client: crawler.client,
          crawler,
        })
    );

    const batchResult = await poolRunBatch(tasks, {
      accountIds,
      hybrid: true,
      maxConcurrency: Math.min(4, accountIds.length),
      browserOptions,
    });

    const results = /** @type {unknown[]} */ (batchResult.results ?? []);
    return bucketSearchResults(results);
  }

  // Fallback: query all 4 categories with a single shared FacebookCrawler.
  const browserOpts = /** @type {Record<string, unknown>} */ (browserOptions || {});
  const client = createFacebookClient(browserOpts);
  const crawler = createFacebookCrawler(client, browserOpts);

  try {
    const settled = await Promise.allSettled(
      types.map((type) =>
        dispatchFacebookHybrid('search', {
          query,
          type,
          ...(location != null && { location }),
          ...(limit != null && { limit }),
          authCookie: baseArgs.authCookie,
          browserOptions: browserOpts,
          client,
          crawler,
        }),
      ),
    );

    const results = settled.map((res, i) => {
      if (res.status !== 'fulfilled' || !res.value) return [];
      const val = res.value;
      const key = types[i];
      if (Array.isArray(val)) return val;
      if (val && typeof val === 'object') {
        const obj = /** @type {Record<string, unknown>} */ (val);
        if (Array.isArray(obj[key])) return /** @type {unknown[]} */ (obj[key]);
        if (key === 'people' && Array.isArray(obj.users)) return /** @type {unknown[]} */ (obj.users);
        if (Array.isArray(obj.items)) return /** @type {unknown[]} */ (obj.items);
      }
      return [];
    });

    return bucketSearchResults(results);
  } finally {
    if (typeof crawler.cleanup === 'function') {
      await crawler.cleanup().catch(() => {});
    }
  }
}

/**
 * Run multiple scrape tasks in parallel across multiple accounts.
 * Delegates to FacebookAccountPool.runBatch.
 *
 * @param {((...args: any[]) => Promise<Record<string, unknown>>)[]} tasks
 * @param {Record<string, unknown>} options - { maxConcurrency, delayBetweenLaunches, accountIds, hybrid, browserOptions }
 * @returns {Promise<Record<string, unknown>>}
 */
export async function runBatch(tasks, options = {}) {
  return poolRunBatch(tasks, options);
}

export default { run, runBatch };
