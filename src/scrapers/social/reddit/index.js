// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Reddit scraper module barrel.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

export { RedditClient, createRedditClient } from './client.js';
export { RedditCrawler } from './crawler.js';
export { RedditPlatformResponseValidator } from './validator.js';
export {
  namespacedRedditId,
  parseFullname,
  normalizeRedditPost,
  normalizeRedditComment,
  normalizeRedditSubreddit,
  normalizeRedditUser,
} from './normalizer.js';
