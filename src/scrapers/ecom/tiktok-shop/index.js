// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TikTok Shop scraper module entry point.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

export { TikTokShopClient } from './client.js';
export { TikTokShopCrawler } from './crawler.js';
export { TikTokShopPlatformResponseValidator } from './validator.js';
export {
  normalizeTikTokShopProduct,
  buildTikTokShopPageInfo,
  TIKTOK_SHOP_BASE_URL,
} from './normalize-product.js';

import { TikTokShopClient } from './client.js';
import { TikTokShopCrawler } from './crawler.js';

/**
 * Convenience helper: scrape a TikTok Shop action through the unified interface.
 * @param {string} action
 * @param {Record<string, any>} args
 * @param {Record<string, any>} [options={}]
 * @returns {Promise<any>}
 */
export async function scrapeTikTokShop(action, args, options = {}) {
  const safeOptions = options || {};
  const client = safeOptions.client || new TikTokShopClient(safeOptions);
  const crawler = new TikTokShopCrawler({ client, store: safeOptions.store, ...safeOptions });

  try {
    return await crawler.start({ action, args: args || {}, session: safeOptions.session });
  } finally {
    if (safeOptions.autoClose !== false) {
      await crawler.cleanup().catch(() => {});
    }
  }
}

export default {
  TikTokShopClient,
  TikTokShopCrawler,
  scrapeTikTokShop,
};
