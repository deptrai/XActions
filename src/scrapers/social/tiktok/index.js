// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TikTok scraper module entry point.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

export { TikTokClient } from './client.js';
export { TikTokCrawler } from './crawler.js';
export { TikTokBrowserBridge } from './signer-bridge.js';
export { TikTokPlatformResponseValidator } from './validator.js';
export * from './normalizer.js';

import { TikTokClient } from './client.js';
import { TikTokCrawler } from './crawler.js';
import { TikTokBrowserBridge } from './signer-bridge.js';
import { TikTokPlatformResponseValidator } from './validator.js';

/**
 * Convenience helper: scrape a TikTok action through the unified interface.
 * @param {string} action
 * @param {Record<string, any>} args
 * @param {Record<string, any>} [options={}]
 * @returns {Promise<any>}
 */
export async function scrapeTikTok(action, args, options = {}) {
  const client = new TikTokClient(options);
  const crawler = new TikTokCrawler({ client, ...options });
  const session = {
    accountId: options.accountId || 'tiktok-guest',
    cookies: options.authCookie || options.cookies || '',
  };

  try {
    return await crawler.start({ action, args, session });
  } finally {
    if (options.autoClose !== false) {
      await crawler.cleanup().catch(() => {});
    }
  }
}

export default {
  TikTokClient,
  TikTokCrawler,
  TikTokBrowserBridge,
  TikTokPlatformResponseValidator,
  scrapeTikTok,
};
