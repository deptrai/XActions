// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Batdongsan.com.vn Scraper Module Barrel.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

export { BatdongsanCrawler } from './crawler.js';
export { BatdongsanClient, BATDONGSAN_API_HOST } from './client.js';
export { BatdongsanPlatformResponseValidator } from './validator.js';
export {
  CITY_SLUGS,
  CATE_CODES,
  nibbleSwap,
  decodeBatdongsanPayload,
  encodeBatdongsanPayload,
  normalizeBatdongsanListing,
} from './normalize-batdongsan.js';

import { BatdongsanClient } from './client.js';
import { BatdongsanCrawler } from './crawler.js';

/**
 * Convenience helper: scrape Batdongsan actions through unified interface.
 * @param {string} action
 * @param {Record<string, any>} args
 * @param {Record<string, any>} [options={}]
 * @returns {Promise<any>}
 */
export async function scrapeBatdongsan(action, args, options = {}) {
  const client = options.client || new BatdongsanClient(options);
  const crawler = new BatdongsanCrawler({ client, ...options });

  try {
    return await crawler.start({ action, args, session: options.session });
  } finally {
    if (options.autoClose !== false) {
      await crawler.cleanup().catch(() => {});
    }
  }
}

export default {
  BatdongsanClient,
  BatdongsanCrawler,
  scrapeBatdongsan,
};
