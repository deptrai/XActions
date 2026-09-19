// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// by nichxbt
/**
 * Gravatar Identity Scraper Module Barrel — Story 41.1.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

export { GravatarClient, GRAVATAR_BASE_URL } from './client.js';
export { GravatarCrawler, createGravatarCrawler } from './crawler.js';
export { default as gravatarDescriptor } from './descriptor.js';

import { GravatarClient } from './client.js';
import { GravatarCrawler } from './crawler.js';

/**
 * Convenience helper: run a Gravatar action through the unified crawler interface.
 * @param {string} action
 * @param {Record<string, any>} args
 * @param {Record<string, any>} [options={}]
 * @returns {Promise<any>}
 */
export async function scrapeGravatar(action, args, options = {}) {
  const client = new GravatarClient(options);
  const crawler = new GravatarCrawler({ client, ...options });
  try {
    return await crawler.start({ action, args, session: options.session });
  } finally {
    if (options.autoClose !== false) {
      await crawler.cleanup().catch(() => {});
    }
  }
}

export default {
  GravatarClient,
  GravatarCrawler,
  scrapeGravatar,
};
