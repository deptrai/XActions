// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Shopee Scraper Module Barrel.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

export { ShopeeCrawler } from './crawler.js';
export { ShopeeClient, SHOPEE_BASE_URL, SHOPEE_IMAGE_CDN } from './client.js';
export { ShopeePlatformResponseValidator } from './validator.js';
export {
  normalizeShopeeProduct,
  normalizeShopeeReview,
  normalizeShopeePrice,
  buildShopeeImageUrl,
} from './normalize-product.js';

import { ShopeeClient } from './client.js';
import { ShopeeCrawler } from './crawler.js';

/**
 * Convenience helper: scrape Shopee actions through unified interface.
 * @param {string} action
 * @param {Record<string, any>} args
 * @param {Record<string, any>} [options={}]
 * @returns {Promise<any>}
 */
export async function scrapeShopee(action, args, options = {}) {
  const client = new ShopeeClient(options);
  const crawler = new ShopeeCrawler({ client, ...options });

  try {
    return await crawler.start({ action, args, session: options.session });
  } finally {
    if (options.autoClose !== false) {
      await crawler.cleanup().catch(() => {});
    }
  }
}

export default {
  ShopeeClient,
  ShopeeCrawler,
  scrapeShopee,
};
