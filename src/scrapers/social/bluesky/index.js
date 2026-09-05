// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Bluesky Social Scraper Module Barrel (Story 23.2).
 * Exports BlueskyClient, BlueskyCrawler, BlueskyPlatformResponseValidator,
 * normalizers and helper functions.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

export { BlueskyClient, resolveActor, DEFAULT_BLUESKY_SERVICE } from './client.js';
export { BlueskyCrawler } from './crawler.js';
export { BlueskyPlatformResponseValidator } from './validator.js';
export {
  namespacedBlueskyId,
  normalizeBlueskyProfile,
  normalizeBlueskyConnection,
  normalizeBlueskyPost,
  normalizeBlueskyTrendingTopic,
  profileItemToPostItem,
} from './normalizer.js';

export { createBlueskyClient, createBlueskyCrawler } from './client.js';

