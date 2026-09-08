// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Zalo Social Scraper Module Barrel (Story 33.1).
 * Exports ZaloClient, ZaloCrawler, ZaloPlatformResponseValidator,
 * normalizers and helper functions.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { ZaloClient, createZaloClient, DEFAULT_ZALO_OPENAPI_BASE } from './client.js';
import { ZaloCrawler } from './crawler.js';
import { ZaloPlatformResponseValidator } from './validator.js';
import {
  namespacedZaloId,
  parseZaloDate,
  stripHtml,
} from './schema.js';
import {
  normalizeZaloArticle,
  normalizeZaloFollower,
  normalizeZaloOaProfile,
  normalizeZaloProduct,
  normalizeZaloResults,
} from './normalizer.js';

export {
  ZaloClient,
  ZaloCrawler,
  ZaloPlatformResponseValidator,
  DEFAULT_ZALO_OPENAPI_BASE,
  namespacedZaloId,
  parseZaloDate,
  stripHtml,
  normalizeZaloArticle,
  normalizeZaloFollower,
  normalizeZaloOaProfile,
  normalizeZaloProduct,
  normalizeZaloResults,
  createZaloClient,
};

export function createZaloCrawler(client, options = {}) {
  const resolvedClient = client instanceof ZaloClient ? client : new ZaloClient(client || options || {});
  const resolvedOptions = client instanceof ZaloClient ? options : (options || {});
  return new ZaloCrawler({ client: resolvedClient, ...resolvedOptions });
}

/**
 * Convenience helper to scrape Zalo OA data.
 * @param {string} action
 * @param {Record<string, unknown>} [options={}]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function scrapeZalo(action, options = {}) {
  const crawler = createZaloCrawler(null, options);
  const session = {
    ...(options.session || {}),
    accountId: options.accountId || options.session?.accountId || 'zalo:oa:default',
  };
  try {
    return await crawler.start({ action, args: options, session });
  } finally {
    if (options.autoClose !== false) {
      await crawler.cleanup().catch(() => {});
    }
  }
}

export default {
  ZaloClient,
  ZaloCrawler,
  ZaloPlatformResponseValidator,
  createZaloClient,
  createZaloCrawler,
  scrapeZalo,
};
