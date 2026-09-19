// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// by nichxbt
/**
 * GitHub Identity Scraper Module Barrel — Story 41.1.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

export { GitHubClient, GITHUB_BASE_URL } from './client.js';
export { GitHubCrawler, createGitHubCrawler } from './crawler.js';
export { default as githubDescriptor } from './descriptor.js';

import { GitHubClient } from './client.js';
import { GitHubCrawler } from './crawler.js';

/**
 * Convenience helper: run a GitHub action through the unified crawler interface.
 * @param {string} action
 * @param {Record<string, any>} args
 * @param {Record<string, any>} [options={}]
 * @returns {Promise<any>}
 */
export async function scrapeGitHub(action, args, options = {}) {
  const client = new GitHubClient(options);
  const crawler = new GitHubCrawler({ client, ...options });
  try {
    return await crawler.start({ action, args, session: options.session });
  } finally {
    if (options.autoClose !== false) {
      await crawler.cleanup().catch(() => {});
    }
  }
}

export default {
  GitHubClient,
  GitHubCrawler,
  scrapeGitHub,
};
