// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Facebook Social Scraper Module.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

export { FacebookClient } from './client.js';
export { FacebookCrawler, DEFAULT_FB_DOC_IDS } from './crawler.js';
export { FacebookPlatformResponseValidator } from './validator.js';
export { FacebookBrowserBridge, extractFacebookTokensScript } from './signer-bridge.js';
export {
  normalizeFacebookProfile,
  normalizeFacebookFollower,
  normalizeFacebookGroupMember,
  profileItemToPostItem,
  namespacedProfileId,
} from './normalize-profile.js';
export {
  normalizeFacebookSearchPost,
  normalizeFacebookSearchProfile,
  normalizeFacebookPageSearchResult,
  normalizeFacebookGroupSearchResult,
  searchResultToPostItem,
} from './normalize-search.js';
export {
  normalizeFacebookMarketplaceListing,
  marketplaceListingToPostItem,
} from './normalize-marketplace.js';
export { FacebookActions, assertFacebookUrlLocal, stripPii, stripEmojiSurrogates, pickRandomSegment } from './actions.js';
export { FacebookActionVelocityTracker, runGuardedActionBatch, enforceActionDelay, ACTION_LIMITS, ACCOUNT_RISK_WARNING } from './batch-runner.js';

