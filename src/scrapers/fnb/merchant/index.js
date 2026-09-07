// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * F&B Merchant Scraper Module Barrel.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

export { FnbMerchantCrawler } from './crawler.js';
export { FnbMerchantClient, FNB_BASE_URLS } from './client.js';
export { FnbPlatformResponseValidator } from './validator.js';
export {
  parseVnPhone,
  normalizeCitySlug,
  normalizeDistrictSlug,
} from './schema.js';
export { normalizeFnbMerchantResults, normalizeFnbResults } from './normalizer.js';

import { FnbMerchantClient } from './client.js';
import { FnbMerchantCrawler } from './crawler.js';

/**
 * Convenience helper: scrape F&B merchant actions through unified interface.
 * @param {string} action
 * @param {Record<string, any>} args
 * @param {Record<string, any>} [options={}]
 * @returns {Promise<any>}
 */
export async function scrapeFnb(action, args, options = {}) {
  const client = new FnbMerchantClient(options);
  const crawler = new FnbMerchantCrawler({ client, ...options });

  try {
    return await crawler.start({ action, args, session: options.session });
  } finally {
    if (options.autoClose !== false) {
      await crawler.cleanup().catch(() => {});
    }
  }
}

export default {
  FnbMerchantClient,
  FnbMerchantCrawler,
  scrapeFnb,
};
