// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Twitter hybrid scraper module (social crawler index).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

export { TwitterClient } from './client.js';
export { TwitterCrawler } from './crawler.js';
export { TwitterPlatformResponseValidator } from './validator.js';
export { tweetToPostItem, entryToPostItem } from './normalize-tweet.js';
export { parseSearchTimeline, parseSearchUsers, userEntryToProfileItem } from './normalize-search.js';
export { parseTrends, trendToPostItem, hashTrendId } from './normalize-trending.js';

import { TwitterClient } from './client.js';
import { TwitterCrawler } from './crawler.js';
import { TwitterPlatformResponseValidator } from './validator.js';

/**
 * Convenience helper: scrape a Twitter action through the unified interface.
 * @param {string} action
 * @param {Record<string, any>} args
 * @param {Record<string, any>} [options={}]
 * @returns {Promise<any>}
 */
export async function scrapeTwitter(action, args, options = {}) {
  const client = new TwitterClient(options);
  const crawler = new TwitterCrawler({ client, ...options });
  const session = {
    accountId: options.accountId || 'twitter-guest',
    cookies: options.authCookie || options.cookies || '',
  };

  try {
    return await crawler.start({ action, args, session });
  } finally {
    if (options.autoClose !== false) {
      await crawler.cleanup().catch(() => {});
    }
  }
}

export default {
  TwitterClient,
  TwitterCrawler,
  TwitterPlatformResponseValidator,
  scrapeTwitter,
};
