// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * VietnamWorks Scraper Module Barrel.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

export { VietnamWorksCrawler } from './crawler.js';
export { VietnamWorksClient, VIETNAMWORKS_BASE_URL } from './client.js';
export { VietnamWorksPlatformResponseValidator } from './validator.js';
export {
  normalizeVietnamWorksSalary,
  mapWorkingType,
  parseVietnamWorksDate,
  normalizeVietnamWorksJob,
  normalizeVietnamWorksCompany,
  toInt,
} from './normalize-job.js';

import { VietnamWorksClient } from './client.js';
import { VietnamWorksCrawler } from './crawler.js';

/**
 * Convenience helper: scrape VietnamWorks actions through unified interface.
 * @param {string} action
 * @param {Record<string, any>} args
 * @param {Record<string, any>} [options={}]
 * @returns {Promise<any>}
 */
export async function scrapeVietnamWorks(action, args, options = {}) {
  const client = options.client || new VietnamWorksClient(options);
  const crawler = new VietnamWorksCrawler({ client, ...options });

  try {
    return await crawler.start({ action, args, session: options.session });
  } finally {
    if (options.autoClose !== false) {
      await crawler.cleanup().catch(() => {});
    }
  }
}

export default {
  VietnamWorksClient,
  VietnamWorksCrawler,
  scrapeVietnamWorks,
};
