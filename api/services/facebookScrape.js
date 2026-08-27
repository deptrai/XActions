// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
/**
 * FacebookScrapeService — single source of truth for Facebook scraping (Story 7.4, AD-7.7).
 *
 * Both the REST API (api/routes/facebook.js) and MCP tools (src/mcp/server.js) route
 * through this service. It resolves auth, delegates to scrape() for single-task runs,
 * and delegates to FacebookAccountPool.runBatch for multi-account parallel execution.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import { resolve as resolveFacebookAuth } from './facebookAuth.js';
import { runBatch as poolRunBatch } from './facebookAccountPool.js';

/**
 * Run a single Facebook scrape action.
 *
 * @param {string} action - One of VALID_ACTIONS (profile, posts, followers, search, etc.)
 * @param {Record<string, unknown>} args - Action arguments including authCookie, browserOptions, and action-specific params.
 * @returns {Promise<Record<string, unknown>>} Scraper result (array or object depending on action).
 */
export async function run(action, args = {}) {
  const authCookie = /** @type {Record<string, unknown>} */ (args.authCookie);
  const userId = /** @type {string | undefined} */ (args.userId);
  const browserOptions = /** @type {Record<string, unknown> | undefined} */ (args.browserOptions);
  const rest = /** @type {Record<string, unknown>} */ ({});
  for (const [k, v] of Object.entries(args)) {
    if (!['authCookie', 'userId', 'browserOptions'].includes(k)) {
      rest[k] = v;
    }
  }

  if (!authCookie || typeof authCookie !== 'object') {
    throw new Error('❌ FacebookScrapeService.run requires authCookie');
  }

  // Resolve authCookie to { c_user, xs } via FacebookAuthResolver.
  const resolved = await resolveFacebookAuth(authCookie, userId);

  // Build the scrape args — pass resolved cookie + browserOptions + action-specific params.
  const scrapeArgs = {
    ...rest,
    authCookie: { c_user: resolved.c_user, xs: resolved.xs },
    ...(browserOptions ? { browserOptions } : {}),
  };

  // search with type: 'all' and parallel: true fans out to 4 sub-tasks.
  if (action === 'search' && rest.type === 'all' && rest.parallel === true) {
    return runSearchAllParallel(/** @type {import('../../src/types/xactions.js').XActionsOptions} */ (scrapeArgs), rest, userId, browserOptions);
  }

  // Default: delegate to scrape() from src/scrapers/index.js.
  // TODO(13.10): route to FacebookCrawler.start({ action: 'marketplace' }) to use hybrid filters
  const { scrape } = await import('../../src/scrapers/index.js');
  return /** @type {Record<string, unknown>} */ (await scrape('facebook', action, /** @type {import('../../src/types/xactions.js').XActionsOptions} */ (scrapeArgs)));
}

/**
 * Run search with type: 'all' and parallel: true — fan out to 4 sub-tasks.
 * Uses FacebookAccountPool.runBatch for multi-account parallel execution.
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

  // If we have accountIds, use runBatch for true parallelism.
  const accountIds = /** @type {string[]} */ (rest.accountIds ?? baseArgs.accountIds);
  if (Array.isArray(accountIds) && accountIds.length > 0) {
    const tasks = types.map((type) => /** @param {import('puppeteer').Page} page */ async (page) => {
      const { scrape } = await import('../../src/scrapers/index.js');
      return /** @type {Record<string, unknown>} */ (await scrape('facebook', 'search', {
        ...baseArgs,
        query,
        type,
        ...(location != null && { location }),
        ...(limit != null && { limit }),
        ...(browserOptions ? { browserOptions } : {}),
        page, // reuse the pool's page — skip auto-create
        autoClose: false, // pool manages browser lifecycle
      }));
    });

    const batchResult = await poolRunBatch(tasks, {
      accountIds,
      maxConcurrency: Math.min(4, accountIds.length),
    });
    const results = /** @type {Record<string, unknown>[][]} */ (/** @type {unknown} */ (batchResult.results ?? []));

    return {
      posts: results[0] || [],
      people: results[1] || [],
      pages: results[2] || [],
      groups: results[3] || [],
    };
  }

  // Fallback: query all 4 categories via scrape() with error isolation
  const { scrape } = await import('../../src/scrapers/index.js');
  const settled = await Promise.allSettled(
    types.map((type) =>
      scrape('facebook', 'search', {
        ...baseArgs,
        query,
        type,
        ...(location != null && { location }),
        ...(limit != null && { limit }),
        ...(browserOptions ? { browserOptions } : {}),
      })
    )
  );

  /**
   * Extract an array result from a settled promise by output key.
   * @param {PromiseSettledResult<Record<string, unknown> | Record<string, unknown>[]>} res
   * @param {string} key
   * @returns {unknown[]}
   */
  const getArrayResult = (res, key) => {
    if (res.status !== 'fulfilled' || !res.value) return [];
    const val = res.value;
    if (Array.isArray(val)) return val;
    if (Array.isArray(val[key])) return val[key];
    if (key === 'people' && Array.isArray(val.users)) return val.users;
    if (key === 'posts' && Array.isArray(val.posts)) return val.posts;
    if (Array.isArray(val.items)) return val.items;
    return [];
  };

  return {
    posts: getArrayResult(settled[0], 'posts'),
    people: getArrayResult(settled[1], 'people'),
    pages: getArrayResult(settled[2], 'pages'),
    groups: getArrayResult(settled[3], 'groups'),
  };
}

/**
 * Run multiple scrape tasks in parallel across multiple accounts.
 * Delegates to FacebookAccountPool.runBatch.
 *
 * @param {((page: import('puppeteer').Page, accountContext?: Record<string, unknown>) => Promise<Record<string, unknown>>)[]} tasks - Each task is `async (page, accountContext) => result`
 * @param {Record<string, unknown>} options - { maxConcurrency, delayBetweenLaunches, accountIds }
 * @returns {Promise<Record<string, unknown>>}
 */
export async function runBatch(tasks, options = {}) {
  return poolRunBatch(tasks, options);
}

export default { run, runBatch };
