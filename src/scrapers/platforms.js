// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Scrapers — Platform Module Registry (Story 25.1)
 *
 * Owns the `platforms` map + `getPlatform()` lookup so `src/scrapers/index.js`
 * can stay a thin dispatcher with zero legacy module imports.
 *
 * NOTE: `platforms.facebook` / `platforms.twitter` / `platforms.threads`
 * intentionally point at the LEGACY module barrels (./facebook, ./twitter,
 * ./threads) — `tests/scrapers/facebook-exports.test.js` and
 * `api/routes/facebook.js` depend on those legacy functions
 * (createBrowser/loginWithCookie/page-based scrapers). Repointing them at the
 * social/* hybrid barrels is a behavior change scoped to Stories 25.3/25.4.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 * @license Apache-2.0
 */

// ============================================================================
// Legacy Platform Modules (kept here so index.js has zero legacy imports)
// ============================================================================


import { ErrorTypes, SuggestedActions } from '../core/error-envelope.js';
import twitter from './twitter/index.js';
import threads from './threads/index.js';
import facebook from './facebook/index.js';

// ============================================================================
// Hybrid Platform Module Barrels
// ============================================================================

import tiktok from './social/tiktok/index.js';
import tiktokShop from './ecom/tiktok-shop/index.js';
import { bluesky as blueskyProxy, mastodon as mastodonProxy } from './deprecation-proxy.js';
import * as redditModule from './social/reddit/index.js';
import * as mediumModule from './social/medium/index.js';
import * as instagramModule from './social/instagram/index.js';
import topcv from './recruitment/topcv/index.js';
import vietnamworks from './recruitment/vietnamworks/index.js';
import linkedin from './recruitment/linkedin/index.js';
import chotot from './realestate/chotot/index.js';
import batdongsan from './realestate/batdongsan/index.js';
import masothue from './procurement/masothue/index.js';
import automotive from './vehicles/automotive/index.js';
import b2bRegistryExtended from './procurement/b2b-registry-extended/index.js';
import fnb from './fnb/merchant/index.js';
import healthcare from './healthcare/index.js';
import ipLegal from './legal/ip-trademark/index.js';
import youtube from './social/youtube/index.js';
import zalo from './social/zalo/index.js';

const redditProxy = new Proxy(redditModule, {
  get(target, prop, receiver) {
    return Reflect.get(target, prop, receiver);
  },
  apply(target, thisArg, args) {
    return Reflect.apply(/** @type {any} */ (target), thisArg, args);
  },
});

const mediumProxy = new Proxy(mediumModule, {
  get(target, prop, receiver) {
    return Reflect.get(target, prop, receiver);
  },
  apply(target, thisArg, args) {
    return Reflect.apply(/** @type {any} */ (target), thisArg, args);
  },
});

const instagramProxy = new Proxy(instagramModule, {
  get(target, prop, receiver) {
    return Reflect.get(target, prop, receiver);
  },
  apply(target, thisArg, args) {
    return Reflect.apply(/** @type {any} */ (target), thisArg, args);
  },
});

// ============================================================================
// Platform Registry
// ============================================================================

/**
 * Available platform modules
 */
/** @type {Record<string, Record<string, unknown>>} */
export const platforms = {
  twitter,
  x: twitter, // alias
  bluesky: blueskyProxy,
  bsky: blueskyProxy,
  mastodon: mastodonProxy,
  masto: mastodonProxy,
  threads,
  facebook,
  fb: facebook, // alias
  tiktok,
  tiktokshop: tiktokShop,
  tiktok_shop: tiktokShop,
  topcv,
  top_cv: topcv,
  vietnamworks,
  vietnam_works: vietnamworks,
  linkedin,
  chotot,
  cho_tot: chotot,
  batdongsan,
  bds: batdongsan,
  masothue,
  maso_thue: masothue,
  mst: masothue,
  automotive,
  oto_vn: automotive,
  bonbanh: automotive,
  chotot_xe: automotive,
  fnb,
  pasgo: fnb,
  foody: fnb,
  riviu: fnb,
  healthcare,
  medpro: healthcare,
  youmed: healthcare,
  nhathuoclongchau: healthcare,
  thuocsi: healthcare,
  ipvietnam: ipLegal,
  ip_legal: ipLegal,
  legal: ipLegal,
  b2b_registry_extended: b2bRegistryExtended,
  hosocongty: b2bRegistryExtended,
  muasamcong: b2bRegistryExtended,
  zalo,
  zalo_oa: zalo,
  zalo_official_account: zalo,
  youtube,
  yt: youtube,
  youtube_vn: youtube,
  reddit: redditProxy,
  rdt: redditProxy,
  medium: mediumProxy,
  md: mediumProxy,
  instagram: instagramProxy,
  ig: instagramProxy,
  insta: instagramProxy,
};

/**
 * Get a platform module by name
 * @param {string} platform - Platform name
 * @returns {Record<string, unknown>} Platform module
 */
export function getPlatform(platform) {
  const mod = platforms[platform?.toLowerCase()];
  if (!mod) {
    const available = Object.keys(platforms).filter(k => !['x', 'bsky', 'masto', 'fb'].includes(k));
    throw new Error(
      `Unknown platform "${platform}". Available: ${available.join(', ')}`
    );
  }
  return mod;
}

/**
 * Build a 400-level "action not available" error so the API layer can map it
 * to HTTP 400 instead of a generic 500.
 * @param {string} platform
 * @param {string} action
 * @param {string[]} available
 * @param {string} [suggestedAction]
 * @returns {Error & { statusCode: number, code: string, type: string, suggestedAction: string, platform: string }}
 */
export function actionNotAvailable(platform, action, available, suggestedAction = undefined) {
  const err = /** @type {Error & { statusCode?: number, code?: string, type?: string, suggestedAction?: string, platform?: string }} */ (new Error(
    `Action "${action}" not available on platform "${platform}". Available: ${available.join(', ')}`
  ));
  err.statusCode = 400;
  err.code = 'XACT_4001';
  err.type = ErrorTypes.INVALID_ARGS;
  err.platform = platform;
  err.suggestedAction = suggestedAction || SuggestedActions.USE_ACTIONS_LIST;
  return /** @type {Error & { statusCode: number, code: string, type: string, suggestedAction: string, platform: string }} */ (err);
}

// Re-exported so `src/scrapers/index.js` can keep its public export surface
// (destructured Twitter helpers + default export) without importing the
// legacy module paths directly.
export { twitter, threads, facebook };
