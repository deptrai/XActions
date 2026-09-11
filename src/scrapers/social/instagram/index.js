// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Instagram Social Scraper Module Barrel.
 * Exports InstagramClient, InstagramCrawler, InstagramPlatformResponseValidator,
 * ValidationError, and normalizer helpers.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

export { InstagramClient, createInstagramClient } from './client.js';
export { InstagramCrawler, createInstagramCrawler } from './crawler.js';
export { InstagramPlatformResponseValidator, ValidationError, validateInstagramPost } from './validator.js';
export {
  asRecord,
  namespacedInstagramId,
  extractMediaId,
  normalizeInstagramMedia,
  normalizeInstagramProfile,
  normalizeInstagramComment,
} from './normalizer.js';
