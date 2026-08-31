// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * LinkedIn Scraper Module Barrel.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

export { LinkedInCrawler } from './crawler.js';
export { LinkedInClient, LINKEDIN_BASE_URL } from './client.js';
export { LinkedInPlatformResponseValidator } from './validator.js';
export {
  extractSkills,
  parseLinkedInJobCard,
  parseLinkedInJobDetail,
  normalizeLinkedInCompany,
  normalizeLinkedInLead,
} from './normalize-linkedin.js';

import { LinkedInClient } from './client.js';
import { LinkedInCrawler } from './crawler.js';

/**
 * Convenience helper: scrape LinkedIn actions through unified interface.
 * @param {string} action
 * @param {Record<string, any>} args
 * @param {Record<string, any>} [options={}]
 * @returns {Promise<any>}
 */
export async function scrapeLinkedIn(action, args, options = {}) {
  const client = options.client || new LinkedInClient(options);
  const crawler = new LinkedInCrawler({ client, ...options });

  try {
    return await crawler.start({ action, args, session: options.session });
  } finally {
    if (options.autoClose !== false) {
      await crawler.cleanup().catch(() => {});
    }
  }
}

export default {
  LinkedInClient,
  LinkedInCrawler,
  scrapeLinkedIn,
};
