// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Shared action discovery for MCP and CLI.
 *
 * Keeps the crawler instantiation and listActions() call in one place so the
 * CLI does not need to import the full MCP server stack.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

/**
 * Return the list of available crawler actions, optionally filtered by platform.
 *
 * @param {Object} [options]
 * @param {string} [options.platform]
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function executeActionListTool(options = {}) {
  const { FacebookCrawler } = await import('./facebook/crawler.js');
  const { ThreadsCrawler } = await import('./threads/crawler.js');

  const crawlers = [new FacebookCrawler(), new ThreadsCrawler()];

  try {
    /** @type {Record<string, unknown>[]} */
    const allActions = [];

    for (const crawler of crawlers) {
      const platform = crawler.platform || crawler.name;
      const actions = crawler.listActions().map((desc) => ({ ...desc, platform }));
      allActions.push(...actions);
    }

    if (options.platform && typeof options.platform === 'string') {
      return allActions.filter((a) => a.platform === options.platform);
    }

    return allActions;
  } finally {
    for (const crawler of crawlers) {
      if (typeof crawler.cleanup === 'function') {
        await crawler.cleanup().catch(() => {});
      }
    }
  }
}
