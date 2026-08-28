// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Meta Threads (threads.net) Social Scraper Module.
 * Provides ThreadsClient, ThreadsCrawler, ThreadsPlatformResponseValidator, and normalization utilities.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

export { ThreadsClient } from './client.js';
export { ThreadsCrawler, DEFAULT_THREADS_DOC_IDS } from './crawler.js';
export { ThreadsPlatformResponseValidator } from './validator.js';
export { normalizePost, normalizeComment, extractMediaUrls } from './normalizer.js';
