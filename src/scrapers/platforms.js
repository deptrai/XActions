// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Scrapers — Platform Module Registry (Story 25.1)
 *
 * Owns the `platforms` map + `getPlatform()` lookup so `src/scrapers/index.js`
 * can stay a thin dispatcher with zero legacy module imports.
 *
 * NOTE: `platforms.facebook` / `platforms.twitter` / `platforms.threads`
 * route through `deprecation-proxy.js` which re-exports the `social/*`
 * hybrid barrels with console warnings. The legacy `src/scrapers/twitter/`,
 * `src/scrapers/facebook/`, and `src/scrapers/threads/` directories were
 * removed in Story 26.2.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 * @license Apache-2.0
 */

// ============================================================================
// Legacy Platform Modules (kept here so index.js has zero legacy imports)
// ============================================================================


import { ErrorTypes, SuggestedActions, PlatformError } from '../core/error-envelope.js';
import {
  bluesky as blueskyProxy,
  mastodon as mastodonProxy,
  twitter as twitterProxy,
  facebook as facebookProxy,
  threads as threadsProxy,
} from './deprecation-proxy.js';

// ============================================================================
// Hybrid Platform Module Barrels
// ============================================================================

import tiktok from './social/tiktok/index.js';
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
import * as tiktokShop from './ecom/tiktok-shop/index.js';

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
  twitter: twitterProxy,
  x: twitterProxy, // alias
  bluesky: blueskyProxy,
  bsky: blueskyProxy,
  mastodon: mastodonProxy,
  masto: mastodonProxy,
  threads: threadsProxy,
  facebook: facebookProxy,
  fb: facebookProxy, // alias
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
 * Registry of deprecated platform actions → their replacement action.
 * Key: `"platform:action"` (both lowercased). Value: the replacement action name.
 * When `actionNotAvailable` resolves an action present here, it returns
 * `type: ErrorTypes.DEPRECATED` with `suggestedAction` pointing at the
 * replacement — Story 25.4's "removed/renamed action" branch. Epic 26's
 * decommission populates this map as legacy actions are removed.
 * @type {Record<string, string>}
 */
export const DEPRECATED_ACTIONS = Object.freeze({});

/**
 * Build a 400-level "action not available" error so the API layer can map it
 * to HTTP 400 instead of a generic 500. Returns a `PlatformError` so handlers
 * that branch on `instanceof PlatformError` (schemas.js, checkpoints.js) emit the
 * normalized envelope; `err.statusCode` also covers `platform.js`'s 400 mapping.
 *
 * When `action` is present in `DEPRECATED_ACTIONS`, the error uses
 * `type: DEPRECATED` and a `suggestedAction` pointing at the replacement action.
 * @param {string} platform
 * @param {string} action
 * @param {string[]} available
 * @param {string} [suggestedAction]
 * @param {string} [deprecatedReplacement] - explicit replacement action; overrides registry lookup.
 * @returns {PlatformError} Error with `statusCode:400`, `code:'XACT_4001'`.
 */
export function actionNotAvailable(platform, action, available, suggestedAction = undefined, deprecatedReplacement = undefined) {
  const availableList = Array.isArray(available) ? available : [];
  const replacement = deprecatedReplacement
    ?? DEPRECATED_ACTIONS[`${String(platform).toLowerCase()}:${String(action)}`]
    ?? DEPRECATED_ACTIONS[`${String(platform).toLowerCase()}:${String(action).toLowerCase()}`];
  const isDeprecated = replacement !== undefined;
  return new PlatformError({
    code: 'XACT_4001',
    type: isDeprecated ? ErrorTypes.DEPRECATED : ErrorTypes.INVALID_ARGS,
    message: isDeprecated
      ? `Action "${action}" on platform "${platform}" is deprecated. Use "${replacement}" instead.`
      : `Action "${action}" not available on platform "${platform}". Available: ${availableList.join(', ')}`,
    statusCode: 400,
    isRetryable: false,
    suggestedAction: suggestedAction || (isDeprecated ? `use_${replacement}` : SuggestedActions.USE_ACTIONS_LIST),
    platform,
  });
}

// Re-exported so `src/scrapers/index.js` can keep its public export surface
// (destructured Twitter helpers + default export) without importing the
// legacy module paths directly.
export {
  twitterProxy as twitter,
  threadsProxy as threads,
  facebookProxy as facebook,
};
