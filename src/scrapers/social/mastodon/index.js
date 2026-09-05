// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Mastodon Social Scraper Module Barrel (Story 23.4).
 * Exports MastodonClient, MastodonCrawler, MastodonPlatformResponseValidator,
 * normalizers and target resolver helper functions.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

export { MastodonClient } from './client.js';
export { MastodonCrawler } from './crawler.js';
export { MastodonPlatformResponseValidator } from './validator.js';
export {
  DEFAULT_MASTODON_INSTANCE,
  normalizeInstanceUrl,
  extractInstanceHost,
  namespacedMastodonId,
  toPlainText,
  resolveMastodonTarget,
  parseLinkHeader,
  normalizeMastodonAccount,
  profileItemToPostItem,
  normalizeMastodonStatus,
  normalizeMastodonTag,
} from './normalizer.js';

export { createMastodonClient } from './client.js';
export { createMastodonCrawler } from './crawler.js';
