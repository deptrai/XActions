// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Healthcare, Clinics & Pharmacy Network Scraper Module.
 * Exports HealthcareCrawler, HealthcareClient, and scrapeHealthcare helper.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { HealthcareCrawler } from './crawler.js';
import { HealthcareClient } from './client.js';

export { HealthcareCrawler, HealthcareClient };
export { normalizeHealthcareResults } from './normalizer.js';
export { HealthcarePlatformResponseValidator } from './validator.js';
export * from './schema.js';

/**
 * Top-level scrape helper for healthcare module.
 * @param {string} action
 * @param {Record<string, any>} [options={}]
 * @returns {Promise<any>}
 */
export async function scrapeHealthcare(action, options = {}) {
  const crawler = new HealthcareCrawler(options);
  try {
    return await crawler.start({ action, args: options });
  } finally {
    if (options.autoClose !== false) {
      await crawler.cleanup().catch(() => {});
    }
  }
}

export default {
  HealthcareCrawler,
  HealthcareClient,
  scrapeHealthcare,
};
