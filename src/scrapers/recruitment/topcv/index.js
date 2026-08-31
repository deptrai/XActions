// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TopCV Scraper Module Barrel.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

export { TopCvCrawler } from './crawler.js';
export { TopCvClient, TOPCV_BASE_URL } from './client.js';
export { TopCvPlatformResponseValidator } from './validator.js';
export {
  normalizeKeywordToSlug,
  parseVietnameseSalary,
  parseExperienceYears,
  mapEmploymentType,
  stripHtml,
} from './normalize-job.js';

import { TopCvClient } from './client.js';
import { TopCvCrawler } from './crawler.js';

/**
 * Convenience helper: scrape TopCV actions through unified interface.
 * @param {string} action
 * @param {Record<string, any>} args
 * @param {Record<string, any>} [options={}]
 * @returns {Promise<any>}
 */
export async function scrapeTopCv(action, args, options = {}) {
  const client = options.client || new TopCvClient(options);
  const crawler = new TopCvCrawler({ client, ...options });

  try {
    return await crawler.start({ action, args, session: options.session });
  } finally {
    if (options.autoClose !== false) {
      await crawler.cleanup().catch(() => {});
    }
  }
}

export default {
  TopCvClient,
  TopCvCrawler,
  scrapeTopCv,
};
