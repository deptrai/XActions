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


// ============================================================================
// Canonical module re-exports (Story 25.3 migration — these live here as the
// source of truth; the legacy src/scrapers/facebook/*.js copies are frozen for
// Epic 26 decommission). Re-exported so consumers can use the barrel instead of
// deep imports. collision-prone names are namespaced.
// ============================================================================
export { parseFlatProxy, rotateProxy } from './proxy.js';
export {
  LIMITS as FB_LIMITS,
  ACCOUNT_AGE_TIERS as FB_ACCOUNT_AGE_TIERS,
  getActionLimit,
  enforceDelay,
  getAccountAgeDays,
} from './limits.js';
export { parseRecipientsFile, parseLinksFile, buildCampaignQueue } from './messengerQueue.js';
export {
  SELECTORS as MESSENGER_SHARE_SELECTORS,
  composeMessage as composeMessengerShareMessage,
  typeMessage,
  sendMessageToThread,
  shareToMessenger,
  messengerShareCampaign,
} from './messengerShare.js';
