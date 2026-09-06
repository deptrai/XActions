// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Automotive Scraper Module Barrel.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

export { AutomotiveCrawler } from './crawler.js';
export { AutomotiveClient } from './client.js';
export { AutomotivePlatformResponseValidator } from './validator.js';
export {
  AUTOMOTIVE_CITY_SLUGS,
  AUTOMOTIVE_BRAND_ALIASES,
  normalizeCitySlug,
  normalizeBrandSlug,
  parseVndPrice,
  parseVnPhone,
  parseMileage,
  normalizeTransmission,
  normalizeFuel,
  inferSellerType,
} from './schema.js';
export { normalizeAutomotiveResults } from './normalizer.js';

import { AutomotiveClient } from './client.js';
import { AutomotiveCrawler } from './crawler.js';

/**
 * Convenience helper: scrape automotive actions through unified interface.
 * @param {string} action
 * @param {Record<string, any>} args
 * @param {Record<string, any>} [options={}]
 * @returns {Promise<any>}
 */
export async function scrapeAutomotive(action, args, options = {}) {
  const client = new AutomotiveClient(options);
  const crawler = new AutomotiveCrawler({ client, ...options });

  try {
    return await crawler.start({ action, args, session: options.session });
  } finally {
    if (options.autoClose !== false) {
      await crawler.cleanup().catch(() => {});
    }
  }
}

export default {
  AutomotiveClient,
  AutomotiveCrawler,
  scrapeAutomotive,
};
