// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * YouTube VN Scraper Module Barrel (Story 33.2).
 * Exports YouTubeClient, YouTubeVNCrawler, YouTubePlatformResponseValidator,
 * normalizers and helper functions.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { YouTubeClient, createYouTubeClient, DEFAULT_YOUTUBE_API_BASE } from './client.js';
import { YouTubeVNCrawler } from './crawler.js';
import { YouTubePlatformResponseValidator } from './validator.js';
import {
  namespacedYouTubeId,
  namespacedCommentId,
  parseIsoDuration,
  extractBestThumbnail,
  parseYouTubeDate,
} from './schema.js';
import {
  normalizeYouTubeVideo,
  normalizeYouTubeChannel,
  normalizeYouTubeCommentThread,
  normalizeYouTubeResults,
} from './normalizer.js';

export {
  YouTubeClient,
  YouTubeVNCrawler,
  YouTubePlatformResponseValidator,
  DEFAULT_YOUTUBE_API_BASE,
  namespacedYouTubeId,
  namespacedCommentId,
  parseIsoDuration,
  extractBestThumbnail,
  parseYouTubeDate,
  normalizeYouTubeVideo,
  normalizeYouTubeChannel,
  normalizeYouTubeCommentThread,
  normalizeYouTubeResults,
  createYouTubeClient,
};

/**
 * @param {YouTubeClient | Record<string, unknown> | null} [client]
 * @param {Record<string, unknown>} [options={}]
 */
export function createYouTubeVNCrawler(client, options = {}) {
  const resolvedClient = client instanceof YouTubeClient ? client : new YouTubeClient(client || options || {});
  const resolvedOptions = client instanceof YouTubeClient ? options : (options || {});
  return new YouTubeVNCrawler({ client: resolvedClient, ...resolvedOptions });
}

/**
 * Convenience helper to scrape YouTube VN data.
 * @param {string} action
 * @param {Record<string, unknown>} [options={}]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function scrapeYouTube(action, options = {}) {
  const crawler = createYouTubeVNCrawler(null, options);
  try {
    return await crawler.start({
      action,
      args: options,
      session: /** @type {Record<string, unknown> | undefined} */ (options.session),
    });
  } finally {
    if (options.autoClose !== false) {
      await crawler.cleanup().catch(() => {});
    }
  }
}

export default {
  YouTubeClient,
  YouTubeVNCrawler,
  YouTubePlatformResponseValidator,
  createYouTubeClient,
  createYouTubeVNCrawler,
  scrapeYouTube,
};
