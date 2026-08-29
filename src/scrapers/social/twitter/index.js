// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * src/scrapers/social/twitter/index.js — Barrel export for Twitter hybrid scraper modules.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

export { TwitterCrawler, TWITTER_GRAPHQL_QUERY_IDS } from './crawler.js';
export {
  TwitterClient,
  resolveTweetId,
  resolveUsername,
  buildCookieHeader,
  parseTwitterCookies,
} from './client.js';
export { TwitterPlatformResponseValidator } from './validator.js';
export {
  normalizeThreadResponse,
  parseTwitterTweetToPostItem,
  reconstructThread,
  extractTweetDetailEntries,
} from './normalize-thread.js';
export { normalizeBookmarksResponse } from './normalize-bookmarks.js';
export {
  normalizeLikersResponse,
  profileItemToPostItem,
  normalizeUserProfile,
} from './normalize-relationships.js';
