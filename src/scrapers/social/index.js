// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Social Scrapers Module Barrel.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

export { FacebookClient, FacebookCrawler, DEFAULT_FB_DOC_IDS, FacebookPlatformResponseValidator, FacebookBrowserBridge, extractFacebookTokensScript, normalizeFacebookProfile, normalizeFacebookFollower, normalizeFacebookGroupMember, profileItemToPostItem as facebookProfileItemToPostItem, namespacedProfileId as facebookNamespacedProfileId, normalizeFacebookSearchPost, normalizeFacebookSearchProfile, normalizeFacebookPageSearchResult, normalizeFacebookGroupSearchResult, searchResultToPostItem, normalizeFacebookMarketplaceListing, marketplaceListingToPostItem, FacebookActions, assertFacebookUrlLocal, stripPii, stripEmojiSurrogates, pickRandomSegment, FacebookActionVelocityTracker, runGuardedActionBatch, enforceActionDelay, ACTION_LIMITS, ACCOUNT_RISK_WARNING } from './facebook/index.js';
export { ThreadsClient, DEFAULT_THREADS_APP_ID, DEFAULT_THREADS_ASBD_ID, ThreadsCrawler, DEFAULT_THREADS_DOC_IDS, ThreadsPlatformResponseValidator, threadsNamespacedProfileId, parseHumanCount, normalizeThreadsProfile, normalizeThreadsConnection, threadsProfileItemToPostItem } from './threads/index.js';
export { TikTokClient, TikTokCrawler, TikTokBrowserBridge, TikTokPlatformResponseValidator, scrapeTikTok } from './tiktok/index.js';
export { TwitterClient, TwitterCrawler, TWITTER_GRAPHQL_QUERY_IDS, TwitterPlatformResponseValidator, resolveTweetId, resolveUsername, buildCookieHeader, parseTwitterCookies, normalizeThreadResponse, parseTwitterTweetToPostItem, reconstructThread, extractTweetDetailEntries, normalizeBookmarksResponse, normalizeLikersResponse, profileItemToPostItem as twitterProfileItemToPostItem, normalizeUserProfile } from './twitter/index.js';
export { CommentTreeExtractor } from './comment-tree.js';
