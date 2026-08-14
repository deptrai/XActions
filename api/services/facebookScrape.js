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
 * @param {Object} args - Action arguments including authCookie, browserOptions, and action-specific params.
 * @returns {Promise<any>} Scraper result (array or object depending on action).
 */
export async function run(action, args = {}) {
  const { authCookie, userId, browserOptions, ...rest } = args;

  if (!authCookie) {
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
    return runSearchAllParallel(scrapeArgs, rest, userId, browserOptions);
  }

  // Default: delegate to scrape() from src/scrapers/index.js.
  const { scrape } = await import('../../src/scrapers/index.js');
  return scrape('facebook', action, scrapeArgs);
}

/**
 * Run search with type: 'all' and parallel: true — fan out to 4 sub-tasks.
 * Uses FacebookAccountPool.runBatch for multi-account parallel execution.
 *
 * @param {Object} baseArgs - Base scrape args (authCookie, browserOptions, etc.)
 * @param {Object} rest - Action-specific params (query, location, limit, etc.)
 * @param {string} [userId] - User ID for account resolution.
 * @param {Object} [browserOptions] - Browser options.
 * @returns {Promise<{ posts: any[], people: any[], pages: any[], groups: any[] }>}
 */
async function runSearchAllParallel(baseArgs, rest, userId, browserOptions) {
  const { query, location, limit } = rest;
  const types = ['posts', 'people', 'pages', 'groups'];

  // If we have accountIds, use runBatch for true parallelism.
  const accountIds = rest.accountIds;
  if (Array.isArray(accountIds) && accountIds.length > 0) {
    const tasks = types.map((type) => async (page) => {
      const { scrape } = await import('../../src/scrapers/index.js');
      return scrape('facebook', 'search', {
        ...baseArgs,
        query,
        type,
        ...(location != null && { location }),
        ...(limit != null && { limit }),
        page, // reuse the pool's page — skip auto-create
        autoClose: false, // pool manages browser lifecycle
      });
    });

    const { results } = await poolRunBatch(tasks, {
      accountIds,
      maxConcurrency: Math.min(4, accountIds.length),
    });

    return {
      posts: results[0] || [],
      people: results[1] || [],
      pages: results[2] || [],
      groups: results[3] || [],
    };
  }

  // Fallback: sequential on a single account (same as parallel: false).
  const { scrape } = await import('../../src/scrapers/index.js');
  return scrape('facebook', 'search', {
    ...baseArgs,
    query,
    type: 'all',
    ...(location != null && { location }),
    ...(limit != null && { limit }),
  });
}

/**
 * Run multiple scrape tasks in parallel across multiple accounts.
 * Delegates to FacebookAccountPool.runBatch.
 *
 * @param {Function[]} tasks - Each task is `async (page, accountContext) => result`
 * @param {Object} options - { maxConcurrency, delayBetweenLaunches, accountIds }
 * @returns {Promise<{ results: any[], accountUsage: object }>}
 */
export async function runBatch(tasks, options = {}) {
  return poolRunBatch(tasks, options);
}

export default { run, runBatch };
