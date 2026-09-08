// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * IP Legal & Trademark Crawler module entry point.
 * Scrapes official trademark and patent gazette data from ipvietnam.gov.vn.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { IpLegalCrawler } from './crawler.js';
import { IpLegalClient } from './client.js';

export { IpLegalCrawler } from './crawler.js';
export { IpLegalClient } from './client.js';
export { IpLegalPlatformResponseValidator } from './validator.js';
export { normalizeIpLegalResults } from './normalizer.js';
export * from './schema.js';

/**
 * Convenience dispatch function for IP legal scraping actions.
 * @param {string} action
 * @param {Record<string, any>} [options={}]
 * @param {Record<string, any>} [deps={}]
 * @returns {Promise<any>}
 */
export async function scrapeIpLegal(action, options = {}, deps = {}) {
  const crawler = new IpLegalCrawler({ ...options, ...deps });
  try {
    await crawler.init();
    return await crawler.start({ action, args: options });
  } finally {
    if (options.autoClose !== false) {
      await crawler.cleanup().catch(() => {});
    }
  }
}

export default {
  IpLegalCrawler,
  IpLegalClient,
  scrapeIpLegal,
};
