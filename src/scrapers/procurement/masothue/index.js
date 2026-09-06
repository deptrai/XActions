// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * MaSoThue Scraper Module Barrel.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

export { MaSoThueCrawler } from './crawler.js';
export { MaSoThueClient, MASOTHUE_BASE_URL } from './client.js';
export { MaSoThuePlatformResponseValidator } from './validator.js';
export {
  normalizeMaSoThueResults,
  resolveProvince,
  normalizeProvinceSlug,
  MASOTHUE_PROVINCES,
} from './schema.js';

import { MaSoThueClient } from './client.js';
import { MaSoThueCrawler } from './crawler.js';

/**
 * Convenience helper: scrape MaSoThue actions through unified interface.
 * @param {string} action
 * @param {Record<string, any>} args
 * @param {Record<string, any>} [options={}]
 * @returns {Promise<any>}
 */
export async function scrapeMaSoThue(action, args, options = {}) {
  const client = new MaSoThueClient(options);
  const crawler = new MaSoThueCrawler({ client, ...options });

  try {
    return await crawler.start({ action, args, session: options.session });
  } finally {
    if (options.autoClose !== false) {
      await crawler.cleanup().catch(() => {});
    }
  }
}

export default {
  MaSoThueClient,
  MaSoThueCrawler,
  scrapeMaSoThue,
};
