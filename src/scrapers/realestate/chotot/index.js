// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Chợ Tốt Scraper Module Barrel.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

export { ChototCrawler } from './crawler.js';
export { ChototClient, CHOTOT_GATEWAY_URL } from './client.js';
export { ChototPlatformResponseValidator } from './validator.js';
export {
  CHOTOT_RSA_PUBLIC_KEY,
  CATEGORY_CONFIG,
  PROPERTY_TYPE_CG_MAP,
  getCategoryConfig,
  encryptChototListId,
  validateAndFormatPhone,
  normalizeChototListing,
} from './normalize-chotot.js';

import { ChototClient } from './client.js';
import { ChototCrawler } from './crawler.js';

/**
 * Convenience helper: scrape Chợ Tốt actions through unified interface.
 * @param {string} action
 * @param {Record<string, any>} args
 * @param {Record<string, any>} [options={}]
 * @returns {Promise<any>}
 */
export async function scrapeChotot(action, args, options = {}) {
  const client = options.client || new ChototClient(options);
  const crawler = new ChototCrawler({ client, ...options });

  try {
    return await crawler.start({ action, args, session: options.session });
  } finally {
    if (options.autoClose !== false) {
      await crawler.cleanup().catch(() => {});
    }
  }
}

export default {
  ChototClient,
  ChototCrawler,
  scrapeChotot,
};
