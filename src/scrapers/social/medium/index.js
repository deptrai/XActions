// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Medium Social Scraper Module Barrel (Story 35.2).
 * Exports MediumClient, MediumCrawler, MediumPlatformResponseValidator,
 * and normalizer helpers.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

export { MediumClient, createMediumClient } from './client.js';
export { MediumBrowserBridge } from './bridge.js';
export { MediumCrawler, createMediumCrawler } from './crawler.js';
export { MediumPlatformResponseValidator, validateMediumPost } from './validator.js';
export {
  asRecord,
  namespacedMediumId,
  extractPostId,
  stripTrackingParams,
  extractFirstImage,
  extractImages,
  isPaywalledRss,
  normalizeMediumRssItem,
  normalizeMediumJsonPost,
  normalizeMediumGraphqlPost,
} from './normalizer.js';
