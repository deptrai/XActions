// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Canonical test targets and probe configuration for synthetic canary testing (AD-23, AD-35).
 * Contains stable, representative URLs and probe parameters for all supported scrapers.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

export const DEFAULT_CANARY_CRON = '0 * * * *'; // Hourly (NFR-20: >= 24 runs/day)
export const DEFAULT_CANARY_TIMEOUT_MS = 30000; // 30s per probe timeout

/**
 * Canary configuration map for all monitored platform scrapers.
 * @type {Record<string, {
 *   scraperId: string;
 *   platform: string;
 *   targetUrl: string;
 *   category: string;
 *   authRequired: boolean;
 *   probeAccountKey?: string;
 * }>}
 */
export const CANARY_CONFIGS = Object.freeze({
  'twitter-hybrid': {
    scraperId: 'twitter-hybrid',
    platform: 'twitter',
    targetUrl: 'https://x.com/nasa',
    category: 'social',
    authRequired: true,
    probeAccountKey: 'probe-twitter-001',
  },
  'facebook-hybrid': {
    scraperId: 'facebook-hybrid',
    platform: 'facebook',
    targetUrl: 'https://www.facebook.com/NASA',
    category: 'social',
    authRequired: true,
    probeAccountKey: 'probe-facebook-001',
  },
  'threads-hybrid': {
    scraperId: 'threads-hybrid',
    platform: 'threads',
    targetUrl: 'https://www.threads.net/@nasa',
    category: 'social',
    authRequired: false,
  },
  'tiktok-hybrid': {
    scraperId: 'tiktok-hybrid',
    platform: 'tiktok',
    targetUrl: 'https://www.tiktok.com/@nasa',
    category: 'social',
    authRequired: false,
  },
  'shopee-hybrid': {
    scraperId: 'shopee-hybrid',
    platform: 'shopee',
    targetUrl: 'https://shopee.vn/api/v4/item/get?itemid=1&shopid=1',
    category: 'ecom',
    authRequired: false,
  },
  'pasgo-merchant': {
    scraperId: 'pasgo-merchant',
    platform: 'fnb',
    targetUrl: 'https://pasgo.vn/ha-noi/nha-hang',
    category: 'fnb_merchant',
    authRequired: false,
  },
  'masothue': {
    scraperId: 'masothue',
    platform: 'masothue',
    targetUrl: 'https://masothue.com/',
    category: 'b2b',
    authRequired: false,
  },
  'youtube-crawler': {
    scraperId: 'youtube-crawler',
    platform: 'youtube',
    targetUrl: 'https://www.youtube.com/@nasa',
    category: 'video',
    authRequired: false,
  },
  'zalo-hybrid': {
    scraperId: 'zalo-hybrid',
    platform: 'zalo',
    targetUrl: 'https://oa.zalo.me/',
    category: 'social',
    authRequired: true,
    probeAccountKey: 'probe-zalo-001',
  },
});
