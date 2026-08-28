// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Threads Social Scraper Module Barrel (Story 15.1 & 15.1.1).
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

export { ThreadsClient } from './client.js';
export { ThreadsCrawler, DEFAULT_THREADS_DOC_IDS } from './crawler.js';
export { ThreadsPlatformResponseValidator } from './validator.js';
export {
  namespacedProfileId,
  parseHumanCount,
  normalizeThreadsProfile,
  normalizeThreadsConnection,
  profileItemToPostItem,
} from './normalizer.js';
