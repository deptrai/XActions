// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Scrapers — Unified Multi-Platform, Multi-Framework Interface
 * 
 * Platforms: Twitter/X, Bluesky, Threads, Mastodon
 * Frameworks: Puppeteer (default), Playwright, Cheerio/HTTP
 * 
 * All original Twitter exports are preserved for full backward compatibility.
 * New unified `scrape()` function dispatches to the correct platform module.
 * 
 * Set scraping framework globally: XACTIONS_SCRAPER_ADAPTER=playwright
 * Or per-call: createBrowser({ adapter: 'playwright' })
 * 
 * Usage:
 *   // Backward-compatible Twitter (unchanged):
 *   import scrapers from 'xactions/scrapers';
 *   const profile = await scrapers.scrapeProfile(page, 'elonmusk');
 * 
 *   // New unified interface:
 *   import { scrape, platforms } from 'xactions/scrapers';
 *   const profile = await scrape('bluesky', 'profile', { username: 'user.bsky.social' });
 *   const mastodonPosts = await scrape('mastodon', 'posts', { username: 'user', instance: 'https://mastodon.social', limit: 20, max_id: '...' });
 *   const mastodonSearch = await scrape('mastodon', 'search', { query: 'open source', instance: 'https://mastodon.social' });
 *   const profile = await scrape('mastodon', 'profile', { username: 'user', instance: 'https://mastodon.social' });
 *
 *   // Use Playwright instead of Puppeteer:
 *   import { createBrowser, createPage, scrapeProfile } from 'xactions/scrapers';
 *   const browser = await createBrowser({ adapter: 'playwright' });
 *   const page = await createPage(browser);
 * 
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 * @license MIT
 */

// ============================================================================
// Platform Modules
// ============================================================================

import twitter from './twitter/index.js';
import threads from './threads/index.js';
import facebook from './facebook/index.js';
import tiktok from './social/tiktok/index.js';
import tiktokShop from './ecom/tiktok-shop/index.js';
import { ThreadsCrawler } from './social/threads/crawler.js';
import { ThreadsClient } from './social/threads/client.js';
import { FacebookCrawler, resolveTargetKey, resolveGroupId } from './social/facebook/crawler.js';
import { FacebookClient } from './social/facebook/client.js';
import { TikTokCrawler } from './social/tiktok/crawler.js';
import { TikTokClient } from './social/tiktok/client.js';
import { TwitterCrawler } from './social/twitter/crawler.js';
import { TwitterClient } from './social/twitter/client.js';
import { ShopeeCrawler } from './ecom/shopee/crawler.js';
import { ShopeeClient } from './ecom/shopee/client.js';
import { TikTokShopCrawler } from './ecom/tiktok-shop/crawler.js';
import { TikTokShopClient } from './ecom/tiktok-shop/client.js';
import { TopCvCrawler } from './recruitment/topcv/crawler.js';
import { TopCvClient } from './recruitment/topcv/client.js';
import { VietnamWorksCrawler } from './recruitment/vietnamworks/crawler.js';
import { VietnamWorksClient } from './recruitment/vietnamworks/client.js';
import { LinkedInCrawler } from './recruitment/linkedin/crawler.js';
import { LinkedInClient } from './recruitment/linkedin/client.js';
import { ChototCrawler } from './realestate/chotot/crawler.js';
import { ChototClient } from './realestate/chotot/client.js';
import { BatdongsanCrawler } from './realestate/batdongsan/crawler.js';
import { BatdongsanClient } from './realestate/batdongsan/client.js';
import { BlueskyCrawler } from './social/bluesky/crawler.js';
import { BlueskyClient } from './social/bluesky/client.js';
import {
  MastodonClient,
  MastodonCrawler,
  resolveMastodonTarget,
  normalizeInstanceUrl,
} from './social/mastodon/index.js';
import { bluesky as blueskyProxy, mastodon as mastodonProxy } from './deprecation-proxy.js';
import topcv from './recruitment/topcv/index.js';
import vietnamworks from './recruitment/vietnamworks/index.js';
import linkedin from './recruitment/linkedin/index.js';
import chotot from './realestate/chotot/index.js';
import batdongsan from './realestate/batdongsan/index.js';
import { defaultStore } from '../store/index.js';

// ============================================================================
// HTTP Scraper (Direct GraphQL — no browser required)
// Usage: createBrowser({ adapter: 'http', cookies: '...' })
// Or:   import { createHttpScraper } from 'xactions/scrapers/twitter/http';
// ============================================================================

export { createHttpScraper } from './twitter/http/index.js';

// ============================================================================
// Adapter System (Multi-Framework Support)
// ============================================================================

import {
  getAdapter,
  getAvailableAdapter,
  setDefaultAdapter,
  getDefaultAdapterName,
  registerAdapter,
  listAdapters,
  getAdapterInfo,
  checkAvailability,
  BaseAdapter,
} from './adapters/index.js';

// ============================================================================
// Backward-Compatible Twitter Re-exports
// ============================================================================

// Re-export all Twitter functions at top level for backward compatibility
export const {
  createBrowser,
  createPage,
  loginWithCookie,
  scrapeProfile,
  scrapeFollowers,
  scrapeFollowing,
  scrapeTweets,
  searchTweets,
  scrapeThread,
  scrapeLikes,
  scrapeHashtag,
  scrapeMedia,
  scrapeListMembers,
  scrapeBookmarks,
  scrapeNotifications,
  scrapeTrending,
  scrapeCommunityMembers,
  scrapeSpaces,
  exportToJSON,
  exportToCSV,
} = twitter;

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

// ============================================================================
// Unified Scrape Interface
// ============================================================================

/**
 * Dispatch to FacebookCrawler hybrid engine (Story 13.10)
 * @param {string} action
 * @param {import('../types/xactions.d.ts').XActionsOptions & Record<string, unknown>} options
 * @returns {Promise<Record<string, unknown>>}
 */
export async function dispatchFacebookHybrid(action, options = {}) {
  // Facebook uses a cookie-object ({ c_user, xs }) via authCookie, not a string authToken.
  if (options.authToken) {
    throw new Error(
      '❌ Facebook uses options.authCookie ({ c_user, xs }), not options.authToken'
    );
  }

  // 1. Map action names (AC-2)
  const normalizedAction = String(action || '').trim().toLowerCase();
  /** @type {Record<string, string>} */
  const ACTION_MAPPING = {
    profile: 'profile',
    followers: 'followers',
    following: 'following',
    search: 'search',
    marketplace: 'marketplace',
    post_comments: 'post_comments',
    group_posts: 'group_posts',
    group_comments: 'group_comments',
    group_search: 'group_search',
    'group-members': 'group_members',
    group_members: 'group_members',
    like: 'like',
    comment: 'comment',
    post: 'post',
    share: 'share',
    messenger: 'messenger_share',
    messenger_share: 'messenger_share',
    'messenger-share': 'messenger_share',
    share_link_uid: 'share_link_uid',
    'share-link-uid': 'share_link_uid',
    join_group: 'join_group',
    join_groups: 'join_group',
    'join-group': 'join_group',
    'join-groups': 'join_group',
    'batch-post-groups': 'post',
    batch_post_groups: 'post',
    send_friend_request: 'send_friend_request',
    send_friend_requests: 'send_friend_request',
    'send-friend-request': 'send_friend_request',
    'send-friend-requests': 'send_friend_request',
    warmup_scroll: 'warmup_scroll',
    'warmup-scroll': 'warmup_scroll',
    'warmup-scroll-feed': 'warmup_scroll',
    warmup_account: 'warmup_account',
    'warmup-account': 'warmup_account',
    cancel_friend_requests: 'cancel_friend_requests',
    'cancel-friend-requests': 'cancel_friend_requests',
  };

  let mappedAction = ACTION_MAPPING[normalizedAction];
  if (normalizedAction === 'posts' || normalizedAction === 'tweets' || normalizedAction === 'feed') {
    const rawUrl = options.url || options.targetUrl || '';
    if (typeof rawUrl === 'string' && (rawUrl.includes('/groups/') || rawUrl.includes('/group/'))) {
      mappedAction = 'group_posts';
    } else {
      mappedAction = 'page_posts';
    }
  }

  if (!mappedAction) {
    mappedAction = normalizedAction;
  }

  // 2. Build or obtain crawler instance
  let crawler = /** @type {FacebookCrawler | undefined} */ (options.crawler);
  let ownsCrawler = false;
  if (!crawler) {
    ownsCrawler = true;
    const browserOpts = /** @type {Record<string, unknown>} */ (options.browserOptions || {});
    const client = /** @type {FacebookClient | undefined} */ (options.client) || createFacebookClient(browserOpts);
    crawler = createFacebookCrawler(client, browserOpts);
  }

  // 3. Build session & args under resource-safe try/finally
  try {
    const validActions = typeof crawler.listActions === 'function'
      ? crawler.listActions().map((a) => a.action)
      : Object.keys(ACTION_MAPPING);

    if (!validActions.includes(mappedAction)) {
      throw new Error(
        `Action "${action}" not available on platform "facebook". Available: ${validActions.join(', ')}`
      );
    }

    let accountId = options.authCookie?.accountId || (Array.isArray(options.accountIds) && options.accountIds.length > 0 ? options.accountIds[0] : null);
    let cookies = options.authCookie;
    if (!accountId && typeof options.authCookie === 'object' && options.authCookie?.c_user) {
      accountId = String(options.authCookie.c_user);
    } else if (!accountId && typeof options.authCookie === 'string') {
      const match = options.authCookie.match(/(?:^|;\s*)c_user=([^;]+)/);
      if (match) accountId = match[1];
    }

    const session = {
      ...(accountId ? { accountId } : {}),
      ...(cookies ? { cookies } : {}),
      cdpUrl: options.browserOptions?.cdpUrl || process.env.FACEBOOK_CDP_URL,
      page: options.page,
    };

    const args = { ...options };
    delete args.page;
    delete args.autoClose;
    delete args.authCookie;
    delete args.browserOptions;
    delete args.client;
    delete args.crawler;
    delete args.authToken;

    // Resolve page/group identifiers from URL aliases (AC-2)
    if (mappedAction === 'page_posts' && !args.pageId) {
      const raw = args.url || args.username || args.targetUrl;
      if (typeof raw === 'string' && raw.trim()) {
        args.pageId = resolveTargetKey(raw.trim());
      }
    }
    if (mappedAction === 'group_posts' && !args.groupId) {
      const raw = args.url || args.groupUrl || args.groupId;
      if (typeof raw === 'string' && raw.trim()) {
        args.groupId = resolveGroupId(raw.trim());
      }
    }
    if ((mappedAction === 'group_search' || mappedAction === 'group_members') && !args.groupUrl && !args.groupId) {
      const raw = args.url || args.groupUrl;
      if (typeof raw === 'string' && raw.trim()) {
        args.groupUrl = raw.trim();
      }
    }

    // Normalize legacy arg shapes to FacebookCrawler canonical args
    if (['like', 'comment', 'share'].includes(mappedAction)) {
      const rawUrls = args.urls || args.postUrl || args.postUrls;
      const postUrls = Array.isArray(rawUrls) ? rawUrls : (typeof rawUrls === 'string' ? rawUrls.split(',').map((u) => u.trim()).filter(Boolean) : []);
      if (postUrls.length) {
        args.postUrls = postUrls;
        args.postUrl = postUrls[0];
      }
      delete args.urls;
      if (mappedAction === 'post' || mappedAction === 'comment') {
        args.text = typeof args.text === 'string' ? args.text : (typeof args.content === 'string' ? args.content : args.text);
      }
    }
    if (mappedAction === 'post') {
      const rawText = args.text || args.content;
      if (typeof rawText === 'string') args.text = rawText;
      const rawGroups = args.groupUrls || args.groupUrl || args.groups;
      if (rawGroups) {
        args.groupUrls = Array.isArray(rawGroups) ? rawGroups : (typeof rawGroups === 'string' ? rawGroups.split(',').map((u) => u.trim()).filter(Boolean) : []);
      }
    }
    if (mappedAction === 'join_group') {
      const rawGroups = args.groupUrls || args.groupUrl || args.groups;
      if (rawGroups) {
        args.groupUrls = Array.isArray(rawGroups) ? rawGroups : (typeof rawGroups === 'string' ? rawGroups.split(',').map((u) => u.trim()).filter(Boolean) : []);
      }
      if (typeof args.keyword === 'string') args.keyword = args.keyword.trim();
      if (args.limit != null) args.limit = Number(args.limit);
    }
    if (mappedAction === 'send_friend_request') {
      const rawTargets = args.targets || args.target;
      if (rawTargets) {
        args.targets = Array.isArray(rawTargets) ? rawTargets : (typeof rawTargets === 'string' ? rawTargets.split(',').map((u) => u.trim()).filter(Boolean) : []);
      }
      if (args.limit != null) args.limit = Number(args.limit);
    }
    if (mappedAction === 'messenger_share' || mappedAction === 'share_link_uid') {
      const rawMessage = args.message || args.content;
      if (typeof rawMessage === 'string') args.message = rawMessage;
      const rawRecipients = args.recipientUids || args.recipients;
      if (rawRecipients) {
        const arr = Array.isArray(rawRecipients) ? rawRecipients : (typeof rawRecipients === 'string' ? rawRecipients.split(',').map((u) => u.trim()).filter(Boolean) : []);
        args.recipientUids = arr;
      }
      const rawPostUrl = args.postUrl || (Array.isArray(args.postUrls) ? args.postUrls[0] : args.postUrl);
      if (typeof rawPostUrl === 'string') args.postUrl = rawPostUrl;
      if (mappedAction === 'share_link_uid' && Array.isArray(args.recipientUids) && args.recipientUids.length) {
        args.recipientUid = args.recipientUids[0];
      }
    }

    const result = await crawler.start({
      action: mappedAction,
      args,
      session,
    });
    return result;
  } finally {
    if (ownsCrawler && options.autoClose !== false && typeof crawler.cleanup === 'function') {
      await crawler.cleanup().catch(() => {});
    }
  }
}

/**
 * Unified scrape function — dispatches to the correct platform module
 *
 * @param {string} platform - Platform name: 'twitter', 'bluesky', 'mastodon', 'threads'
 * @param {string} action - Action name. Mastodon aliases: 'profile', 'followers', 'following', 'posts' ('tweets'/'timeline'/'feed'/'user_feed'/'get_user_feed'/'statuses'/'toots'/'toot'), 'search', 'hashtag' ('tag'), 'trending'.
 * @param {import('../types/xactions.d.ts').XActionsOptions & { instance?: string, baseUrl?: string, accessToken?: string, token?: string, authToken?: string, max_id?: string, since_id?: string, exclude_replies?: boolean, includeReplies?: boolean, type?: string, query?: string, q?: string, keyword?: string, hashtag?: string, tag?: string }} options - Action-specific options. Mastodon accepts `instance`/`baseUrl`, `accessToken`/`token`/`authToken`, pagination `max_id`/`since_id`, and `exclude_replies` or `includeReplies`.
 * @returns {Promise<Record<string, unknown>>} Scraped data
 *
 * @example
 *   // Twitter
 *   const profile = await scrape('twitter', 'profile', { page, username: 'elonmusk' });
 *
 *   // Bluesky (no Puppeteer needed)
 *   const profile = await scrape('bluesky', 'profile', { username: 'user.bsky.social' });
 *
 *   // Mastodon (no Puppeteer needed)
 *   const profile = await scrape('mastodon', 'profile', { username: 'user', instance: 'https://mastodon.social' });
 *   const posts = await scrape('mastodon', 'posts', { username: 'user', instance: 'https://mastodon.social', limit: 20, max_id: '...' });
 *   const search = await scrape('mastodon', 'search', { query: 'open source', instance: 'https://mastodon.social' });
 *
 *   // Threads (Puppeteer)
 *   const posts = await scrape('threads', 'tweets', { page, username: 'zuck', limit: 20 });
 */
export async function scrape(platform, action, options = {}) {
  const store = options.store || defaultStore;
  const normalizedOptions = { ...options, store };
  const platformName = platform.toLowerCase();

  // ── Twitter/X hybrid path — dispatches to TwitterCrawler (Story 13.2.12) ──
  if (platformName === 'twitter' || platformName === 'x') {
    /** @type {Record<string, string>} */
    const TWITTER_ACTION_MAP = {
      profile: 'profile',
      tweets: 'search', timeline: 'search', feed: 'search', user_feed: 'search', posts: 'search',
      search: 'search',
      hashtag: 'hashtag',
      trending: 'trending',
      thread: 'thread',
      likes: 'likes', likers: 'likes',
      bookmarks: 'bookmarks',
      media: 'media',
      download_video: 'download_video', video: 'download_video',
      followers: 'followers',
      following: 'following',
      non_followers: 'non_followers',
      retweeters: 'retweeters',
      listMembers: 'list_members', list_members: 'list_members',
      communityMembers: 'community_members', community_members: 'community_members',
      spaces: 'spaces',
      post: 'post',
      reply: 'reply',
      quote: 'quote',
      schedule: 'schedule',
      like: 'like',
      unlike: 'unlike',
      retweet: 'retweet',
      unretweet: 'undo_retweet', undo_retweet: 'undo_retweet',
      follow: 'follow',
      unfollow: 'unfollow',
      block: 'block',
      unblock: 'unblock',
      mute: 'mute',
      unmute: 'unmute',
      bookmark: 'bookmark',
      unbookmark: 'unbookmark',
      send_dm: 'send_dm', sendDm: 'send_dm',
      dm_conversations: 'dm_conversations', getInbox: 'dm_conversations',
      dm_messages: 'dm_messages', getConversation: 'dm_messages',
      create_list: 'create_list', createList: 'create_list',
      add_list_members: 'add_list_members', addListMembers: 'add_list_members',
      remove_list_members: 'remove_list_members', removeListMembers: 'remove_list_members',
    };

    const mappedAction = TWITTER_ACTION_MAP[action];
    if (!mappedAction) {
      const available = [...new Set(Object.values(TWITTER_ACTION_MAP))];
      throw new Error(
        `Action "${action}" not available on platform "${platform}". Available: ${available.join(', ')}`
      );
    }

    /** @type {Record<string, unknown>} */
    const mappedArgs = {};
    if (options.username) mappedArgs.username = options.username;
    if (options.target && !options.username) mappedArgs.username = options.target;
    if (options.query) mappedArgs.query = options.query;
    if (options.hashtag || options.tag) mappedArgs.tag = options.hashtag || options.tag;
    if (options.tweetId) mappedArgs.tweetId = options.tweetId;
    if (options.url) mappedArgs.url = options.url;
    if (options.userId) mappedArgs.userId = options.userId;
    if (options.listId || options.listUrl) mappedArgs.listUrl = options.listId || options.listUrl;
    if (options.communityUrl) mappedArgs.communityUrl = options.communityUrl;
    if (options.conversationId) mappedArgs.conversationId = options.conversationId;
    if (options.text) mappedArgs.text = options.text;
    if (options.mediaIds) mappedArgs.mediaIds = options.mediaIds;
    if (options.mediaId) mappedArgs.mediaId = options.mediaId;
    if (options.publishAt) mappedArgs.publishAt = options.publishAt;
    if (options.name) mappedArgs.name = options.name;
    if (options.description) mappedArgs.description = options.description;
    if (options.isPrivate != null) mappedArgs.isPrivate = options.isPrivate;
    if (options.userIds) mappedArgs.userIds = options.userIds;
    if (options.usernames) mappedArgs.usernames = options.usernames;
    if (options.dryRun != null) mappedArgs.dryRun = options.dryRun;
    if (options.limit != null) mappedArgs.limit = Number(options.limit);
    if (options.count != null && options.limit == null) mappedArgs.limit = Number(options.count);
    if (options.cursor) mappedArgs.cursor = options.cursor;
    if (options.type) mappedArgs.type = options.type;
    if (options.filter) mappedArgs.filter = options.filter;
    if (options.woeid != null) mappedArgs.woeid = options.woeid;
    if (options.quality) mappedArgs.quality = options.quality;
    if (options.destPath) mappedArgs.destPath = options.destPath;
    if (options.premium != null) mappedArgs.premium = options.premium;
    if (options.sensitive != null) mappedArgs.sensitive = options.sensitive;
    if (options.walkToRoot != null) mappedArgs.walkToRoot = options.walkToRoot;

    const session = {
      accountId: options.accountId || 'twitter-guest',
      cookies: options.authCookie || options.cookies || options.authToken || '',
    };

    const client = new TwitterClient({
      baseUrl: options.baseUrl,
      proxy: options.proxy,
      proxyPool: options.proxyPool,
      proxyProvider: options.proxyProvider,
      governor: options.governor,
      accountPool: options.accountPool,
      sessionManager: options.sessionManager,
      responseValidator: options.responseValidator,
      tokenRing: options.tokenRing,
      signerPool: options.signerPool,
      requiresAuth: options.requiresAuth,
      requiresProxy: options.requiresProxy,
      timeout: options.timeout,
    });

    const crawler = new TwitterCrawler({
      client,
      store,
      redisPublisher: options.redisPublisher,
      proxyPool: options.proxyPool,
      governor: options.governor,
      accountPool: options.accountPool,
      sessionManager: options.sessionManager,
      requiresAuth: options.requiresAuth,
    });

    try {
      return await crawler.start({ action: mappedAction, args: mappedArgs, session });
    } finally {
      if (options.autoClose !== false) {
        await crawler.cleanup().catch(() => {});
      }
    }
  }

  // ── Shopee E-commerce path (Story 16.1) ──
  if (platformName === 'shopee') {
    /** @type {Record<string, string>} */
    const SHOPEE_ACTION_MAP = {
      search_products: 'search_products',
      search: 'search_products',
      products: 'search_products',
      product_detail: 'product_detail',
      product: 'product_detail',
      item: 'product_detail',
      detail: 'product_detail',
      product_reviews: 'product_reviews',
      reviews: 'product_reviews',
      ratings: 'product_reviews',
    };

    const mappedAction = SHOPEE_ACTION_MAP[action];
    if (!mappedAction) {
      const available = [...new Set(Object.values(SHOPEE_ACTION_MAP))];
      throw new Error(
        `Action "${action}" not available on platform "${platform}". Available: ${available.join(', ')}`
      );
    }

    /** @type {Record<string, unknown>} */
    const mappedArgs = {};
    if (options.keyword || options.query || options.q || options.target) {
      mappedArgs.keyword = options.keyword || options.query || options.q || options.target;
    }
    if (options.itemId || options.itemid || options.id) {
      mappedArgs.itemId = options.itemId || options.itemid || options.id;
    }
    if (options.shopId || options.shopid) {
      mappedArgs.shopId = options.shopId || options.shopid;
    }
    if (options.limit != null) mappedArgs.limit = Number(options.limit);
    if (options.page != null) mappedArgs.page = Number(options.page);
    if (options.offset != null) mappedArgs.offset = Number(options.offset);
    if (options.sortBy) mappedArgs.sortBy = options.sortBy;
    if (options.category) mappedArgs.category = options.category;
    if (options.filterRating != null) mappedArgs.filterRating = options.filterRating;

    const client = new ShopeeClient({
      baseUrl: options.baseUrl,
      proxy: options.proxy,
      proxyPool: options.proxyPool,
      proxyProvider: options.proxyProvider,
      governor: options.governor,
      responseValidator: options.responseValidator,
      requiresProxy: options.requiresProxy,
      timeout: options.timeout,
    });

    const crawler = new ShopeeCrawler({
      client,
      store,
      redisPublisher: options.redisPublisher,
      proxyPool: options.proxyPool,
      governor: options.governor,
      requiresProxy: options.requiresProxy,
    });

    try {
      return await crawler.start({ action: mappedAction, args: mappedArgs, session: options.session });
    } finally {
      if (options.autoClose !== false) {
        await crawler.cleanup().catch(() => {});
      }
    }
  }

  // ── TikTok Shop E-commerce path (Story 16.2) ──
  if (platformName === 'tiktokshop' || platformName === 'tiktok_shop') {
    /** @type {Record<string, string>} */
    const TIKTOK_SHOP_ACTION_MAP = {
      top_products: 'top_products',
      'top-products': 'top_products',
      topProducts: 'top_products',
      topproducts: 'top_products',
      top: 'top_products',
      best_sellers: 'top_products',
      'best-sellers': 'top_products',
      bestSellers: 'top_products',
      bestsellers: 'top_products',
      product_detail: 'product_detail',
      'product-detail': 'product_detail',
      productDetail: 'product_detail',
      productdetail: 'product_detail',
      product: 'product_detail',
      item: 'product_detail',
      detail: 'product_detail',
      search_products: 'search_products',
      'search-products': 'search_products',
      searchProducts: 'search_products',
      searchproducts: 'search_products',
      search: 'search_products',
      products: 'search_products',
    };

    const mappedAction = TIKTOK_SHOP_ACTION_MAP[action];
    if (!mappedAction) {
      const available = [...new Set(Object.values(TIKTOK_SHOP_ACTION_MAP))];
      throw new Error(
        `Action "${action}" not available on platform "${platform}". Available: ${available.join(', ')}`
      );
    }

    /** @type {Record<string, unknown>} */
    const mappedArgs = {};
    if (options.keyword || options.query || options.q || options.target) {
      mappedArgs.keyword = options.keyword || options.query || options.q || options.target;
    }
    if (options.productId || options.productid || options.id) {
      mappedArgs.productId = options.productId || options.productid || options.id;
    }
    if (options.category) mappedArgs.category = options.category;
    if (options.limit != null) {
      const limit = Number(options.limit);
      if (Number.isFinite(limit)) mappedArgs.limit = limit;
    }
    if (options.page != null) {
      const page = Number(options.page);
      if (Number.isFinite(page)) mappedArgs.page = page;
    }
    if (options.offset != null) {
      const offset = Number(options.offset);
      if (Number.isFinite(offset)) mappedArgs.offset = offset;
    }
    if (options.sortBy) mappedArgs.sortBy = options.sortBy;

    const client = new TikTokShopClient({
      baseUrl: options.baseUrl,
      proxy: options.proxy,
      proxyPool: options.proxyPool,
      proxyProvider: options.proxyProvider,
      governor: options.governor,
      responseValidator: options.responseValidator,
      requiresProxy: options.requiresProxy,
      timeout: options.timeout,
    });

    const crawler = new TikTokShopCrawler({
      client,
      store,
      redisPublisher: options.redisPublisher,
      proxyPool: options.proxyPool,
      governor: options.governor,
      requiresProxy: options.requiresProxy,
    });

    try {
      return await crawler.start({ action: mappedAction, args: mappedArgs, session: options.session });
    } finally {
      if (options.autoClose !== false) {
        await crawler.cleanup().catch(() => {});
      }
    }
  }

  // ── TopCV Recruitment path (Story 18.1) ──
  if (platformName === 'topcv' || platformName === 'top_cv') {
    /** @type {Record<string, string>} */
    const TOPCV_ACTION_MAP = {
      search_jobs: 'search_jobs',
      search: 'search_jobs',
      jobs: 'search_jobs',
      job_detail: 'job_detail',
      job: 'job_detail',
      detail: 'job_detail',
      company_detail: 'company_detail',
      company: 'company_detail',
      brand: 'company_detail',
    };

    const mappedAction = TOPCV_ACTION_MAP[action];
    if (!mappedAction) {
      const available = [...new Set(Object.values(TOPCV_ACTION_MAP))];
      throw new Error(
        `Action "${action}" not available on platform "${platform}". Available: ${available.join(', ')}`
      );
    }

    /** @type {Record<string, unknown>} */
    const mappedArgs = {};
    if (options.keyword || options.query || options.q || options.target) {
      mappedArgs.keyword = options.keyword || options.query || options.q || options.target;
    }
    if (options.jobId || options.id) {
      mappedArgs.jobId = options.jobId || options.id;
    }
    if (options.jobUrl || options.url) {
      mappedArgs.jobUrl = options.jobUrl || options.url;
    }
    if (options.companyId) {
      mappedArgs.companyId = options.companyId;
    }
    if (options.companyUrl) {
      mappedArgs.companyUrl = options.companyUrl;
    }
    if (options.city) mappedArgs.city = options.city;
    if (options.salary) mappedArgs.salary = options.salary;
    if (options.exp) mappedArgs.exp = options.exp;
    if (Number.isFinite(options.limit)) mappedArgs.limit = options.limit;
    if (Number.isFinite(options.page)) mappedArgs.page = options.page;
    if (options.category) mappedArgs.category = options.category;

    const store = options.store !== undefined ? options.store : defaultStore;
    const client = new TopCvClient({
      baseUrl: options.baseUrl,
      proxy: options.proxy,
      proxyPool: options.proxyPool,
      proxyProvider: options.proxyProvider,
      governor: options.governor,
      responseValidator: options.responseValidator,
      requiresProxy: options.requiresProxy,
      timeout: options.timeout,
    });

    const crawler = new TopCvCrawler({
      client,
      store,
      redisPublisher: options.redisPublisher,
      proxyPool: options.proxyPool,
      governor: options.governor,
      requiresProxy: options.requiresProxy,
    });

    try {
      return await crawler.start({ action: mappedAction, args: mappedArgs, session: options.session });
    } finally {
      if (options.autoClose !== false) {
        await crawler.cleanup().catch(() => {});
      }
    }
  }

  // ── VietnamWorks Recruitment path (Story 18.2) ──
  if (platformName === 'vietnamworks' || platformName === 'vietnam_works' || platformName === 'vnw') {
    /** @type {Record<string, string>} */
    const VNW_ACTION_MAP = {
      search_jobs: 'search_jobs',
      search: 'search_jobs',
      jobs: 'search_jobs',
      job_detail: 'job_detail',
      job: 'job_detail',
      detail: 'job_detail',
      company_detail: 'company_detail',
      company: 'company_detail',
    };

    const mappedAction = VNW_ACTION_MAP[action];
    if (!mappedAction) {
      const available = [...new Set(Object.values(VNW_ACTION_MAP))];
      throw new Error(
        `Action "${action}" not available on platform "${platform}". Available: ${available.join(', ')}`
      );
    }

    /** @type {Record<string, unknown>} */
    const mappedArgs = {};
    if (options.keyword || options.query || options.q || options.target) {
      mappedArgs.keyword = options.keyword || options.query || options.q || options.target;
    }
    if (options.jobId || options.id) {
      mappedArgs.jobId = options.jobId || options.id;
    }
    if (options.jobUrl || options.url) {
      mappedArgs.jobUrl = options.jobUrl || options.url;
    }
    if (options.companyId) {
      mappedArgs.companyId = options.companyId;
    }
    if (options.companyName || options.name) {
      mappedArgs.companyName = options.companyName || options.name;
    }
    if (options.city) mappedArgs.city = options.city;
    if (options.locationId != null) mappedArgs.locationId = options.locationId;
    if (options.salaryMin != null) mappedArgs.salaryMin = options.salaryMin;
    if (options.salaryMax != null) mappedArgs.salaryMax = options.salaryMax;
    if (options.exp != null) mappedArgs.exp = options.exp;
    if (options.employmentType) mappedArgs.employmentType = options.employmentType;
    if (Number.isFinite(options.limit)) mappedArgs.limit = options.limit;
    if (Number.isFinite(options.page)) mappedArgs.page = options.page;

    const store = options.store !== undefined ? options.store : defaultStore;
    const client = new VietnamWorksClient({
      baseUrl: options.baseUrl,
      proxy: options.proxy,
      proxyPool: options.proxyPool,
      proxyProvider: options.proxyProvider,
      governor: options.governor,
      responseValidator: options.responseValidator,
      requiresProxy: options.requiresProxy,
      timeout: options.timeout,
    });

    const crawler = new VietnamWorksCrawler({
      client,
      store,
      redisPublisher: options.redisPublisher,
      proxyPool: options.proxyPool,
      governor: options.governor,
      requiresProxy: options.requiresProxy,
    });

    try {
      return await crawler.start({ action: mappedAction, args: mappedArgs, session: options.session });
    } finally {
      if (options.autoClose !== false) {
        await crawler.cleanup().catch(() => {});
      }
    }
  }

  // ── LinkedIn Recruitment & B2B Leads path (Story 18.3) ──
  if (platformName === 'linkedin') {
    /** @type {Record<string, string>} */
    const LINKEDIN_ACTION_MAP = {
      search_jobs: 'search_jobs',
      search: 'search_jobs',
      jobs: 'search_jobs',
      job_detail: 'job_detail',
      job: 'job_detail',
      detail: 'job_detail',
      company_profile: 'company_profile',
      company: 'company_profile',
      brand: 'company_profile',
      lead_profile: 'lead_profile',
      lead: 'lead_profile',
      profile: 'lead_profile',
    };

    const mappedAction = LINKEDIN_ACTION_MAP[action];
    if (!mappedAction) {
      const available = [...new Set(Object.values(LINKEDIN_ACTION_MAP))];
      throw new Error(
        `Action "${action}" not available on platform "${platform}". Available: ${available.join(', ')}`
      );
    }

    /** @type {Record<string, unknown>} */
    const mappedArgs = { ...options };
    if (options.keyword || options.query || options.q || options.target) {
      mappedArgs.keyword = options.keyword || options.query || options.q || options.target;
    }
    if (options.jobId || options.id) {
      mappedArgs.jobId = options.jobId || options.id;
    }
    if (options.jobUrl || options.url) {
      mappedArgs.jobUrl = options.jobUrl || options.url;
    }
    if (options.companySlug || options.slug) {
      mappedArgs.companySlug = options.companySlug || options.slug;
    }
    if (options.companyUrl) {
      mappedArgs.companyUrl = options.companyUrl;
    }
    if (options.profileUrl || options.url) {
      mappedArgs.profileUrl = options.profileUrl || options.url;
    }
    if (options.profileSlug) {
      mappedArgs.profileSlug = options.profileSlug;
    }
    if (options.location) mappedArgs.location = options.location;
    if (options.cdpPort != null) mappedArgs.cdpPort = options.cdpPort;
    if (Number.isFinite(options.start)) mappedArgs.start = options.start;
    if (Number.isFinite(options.limit)) mappedArgs.limit = options.limit;

    const store = options.store !== undefined ? options.store : defaultStore;
    const client = new LinkedInClient({
      baseUrl: options.baseUrl,
      proxy: options.proxy,
      proxyPool: options.proxyPool,
      proxyProvider: options.proxyProvider,
      governor: options.governor,
      responseValidator: options.responseValidator,
      requiresProxy: options.requiresProxy,
      timeout: options.timeout,
    });

    const crawler = new LinkedInCrawler({
      client,
      store,
      redisPublisher: options.redisPublisher,
      proxyPool: options.proxyPool,
      governor: options.governor,
      requiresProxy: options.requiresProxy,
    });

    try {
      return await crawler.start({ action: mappedAction, args: mappedArgs, session: options.session });
    } finally {
      if (options.autoClose !== false) {
        await crawler.cleanup().catch(() => {});
      }
    }
  }

  // ── Chợ Tốt Real Estate & Multi-Category path (Story 17.1) ──
  if (platformName === 'chotot' || platformName === 'cho_tot') {
    /** @type {Record<string, string>} */
    const CHOTOT_ACTION_MAP = {
      search_listings: 'search_listings',
      search: 'search_listings',
      listings: 'search_listings',
      ads: 'search_listings',
      listing_detail: 'listing_detail',
      listing: 'listing_detail',
      detail: 'listing_detail',
      ad: 'listing_detail',
      get_phone: 'get_phone',
      phone: 'get_phone',
    };

    const mappedAction = CHOTOT_ACTION_MAP[action];
    if (!mappedAction) {
      const available = [...new Set(Object.values(CHOTOT_ACTION_MAP))];
      throw new Error(
        `Action "${action}" not available on platform "${platform}". Available: ${available.join(', ')}`
      );
    }

    /** @type {Record<string, unknown>} */
    const mappedArgs = { ...options };
    if (options.listId || options.id) {
      mappedArgs.listId = options.listId || options.id;
    }
    if (options.category) mappedArgs.category = options.category;
    if (options.region_v2 != null) mappedArgs.region_v2 = options.region_v2;
    if (options.area_v2 != null) mappedArgs.area_v2 = options.area_v2;
    if (options.minPrice != null) mappedArgs.minPrice = options.minPrice;
    if (options.maxPrice != null) mappedArgs.maxPrice = options.maxPrice;
    if (options.minArea != null) mappedArgs.minArea = options.minArea;
    if (options.maxArea != null) mappedArgs.maxArea = options.maxArea;
    if (options.propertyType) mappedArgs.propertyType = options.propertyType;
    if (options.listingType) mappedArgs.listingType = options.listingType;
    if (options.includePhone != null) mappedArgs.includePhone = options.includePhone;
    if (Number.isFinite(options.limit)) mappedArgs.limit = options.limit;
    if (Number.isFinite(options.page)) mappedArgs.page = options.page;

    const store = options.store !== undefined ? options.store : defaultStore;
    const client = new ChototClient({
      baseUrl: options.baseUrl,
      proxy: options.proxy,
      proxyPool: options.proxyPool,
      proxyProvider: options.proxyProvider,
      governor: options.governor,
      responseValidator: options.responseValidator,
      requiresProxy: options.requiresProxy,
      timeout: options.timeout,
    });

    const crawler = new ChototCrawler({
      client,
      store,
      redisPublisher: options.redisPublisher,
      proxyPool: options.proxyPool,
      governor: options.governor,
      requiresProxy: options.requiresProxy,
    });

    try {
      return await crawler.start({ action: mappedAction, args: mappedArgs, session: options.session });
    } finally {
      if (options.autoClose !== false) {
        await crawler.cleanup().catch(() => {});
      }
    }
  }

  // ── Batdongsan.com.vn Real Estate path (Story 17.2) ──
  if (platformName === 'batdongsan' || platformName === 'bds') {
    /** @type {Record<string, string>} */
    const BDS_ACTION_MAP = {
      search_listings: 'search_listings',
      search: 'search_listings',
      listings: 'search_listings',
      listing_detail: 'listing_detail',
      listing: 'listing_detail',
      detail: 'listing_detail',
    };

    const mappedAction = BDS_ACTION_MAP[action];
    if (!mappedAction) {
      const available = [...new Set(Object.values(BDS_ACTION_MAP))];
      throw new Error(
        `Action "${action}" not available on platform "${platform}". Available: ${available.join(', ')}`
      );
    }

    /** @type {Record<string, unknown>} */
    const mappedArgs = { ...options };
    if (options.productId || options.id) {
      mappedArgs.productId = options.productId || options.id;
    }
    if (options.city) mappedArgs.city = options.city;
    if (options.category) mappedArgs.category = options.category;
    if (options.cate != null) mappedArgs.cate = options.cate;
    if (options.listingType) mappedArgs.listingType = options.listingType;
    if (options.ptype != null) mappedArgs.ptype = options.ptype;
    if (options.minPrice != null) mappedArgs.minPrice = options.minPrice;
    if (options.maxPrice != null) mappedArgs.maxPrice = options.maxPrice;
    if (Number.isFinite(options.limit)) mappedArgs.limit = options.limit;
    if (Number.isFinite(options.page)) mappedArgs.page = options.page;

    const store = options.store !== undefined ? options.store : defaultStore;
    const client = new BatdongsanClient({
      baseUrl: options.baseUrl,
      proxy: options.proxy,
      proxyPool: options.proxyPool,
      proxyProvider: options.proxyProvider,
      governor: options.governor,
      responseValidator: options.responseValidator,
      requiresProxy: options.requiresProxy,
      timeout: options.timeout,
    });

    const crawler = new BatdongsanCrawler({
      client,
      store,
      redisPublisher: options.redisPublisher,
      proxyPool: options.proxyPool,
      governor: options.governor,
      requiresProxy: options.requiresProxy,
    });

    try {
      return await crawler.start({ action: mappedAction, args: mappedArgs, session: options.session });
    } finally {
      if (options.autoClose !== false) {
        await crawler.cleanup().catch(() => {});
      }
    }
  }

  // ── Bluesky hybrid path (Story 23.2) ──
  // Dispatches to BlueskyCrawler / BlueskyClient (AT Protocol / XRPC).
  if (platformName === 'bluesky' || platformName === 'bsky') {
    /** @type {Record<string, string>} */
    const BLUESKY_ACTION_MAP = {
      profile: 'profile',
      followers: 'followers',
      following: 'following',
      tweets: 'posts',
      posts: 'posts',
      timeline: 'posts',
      feed: 'posts',
      search: 'search',
      search_posts: 'search',
      trending: 'trending',
      custom_feed: 'feed',
    };

    // If options has feedUri or feed, action 'feed' maps to custom algorithm feed
    let mappedAction = BLUESKY_ACTION_MAP[action];
    if (action === 'feed' && (options.feedUri || options.feed || options.uri)) {
      mappedAction = 'feed';
    }

    if (!mappedAction) {
      const available = [...new Set(Object.values(BLUESKY_ACTION_MAP))];
      throw new Error(
        `Action "${action}" not available on platform "${platform}". Available: ${available.join(', ')}`
      );
    }

    const username = options.username || options.handle || options.actor || options.target;
    const query = options.query || options.q || options.keyword || options.target;
    const feedUri = options.feedUri || options.feed || options.uri || options.target;

    /** @type {Record<string, unknown>} */
    const mappedArgs = { ...options };
    if (['profile', 'followers', 'following', 'posts', 'tweets'].includes(mappedAction) && username) {
      mappedArgs.handle = username;
    }
    if (mappedAction === 'search' && query) {
      mappedArgs.query = query;
    }
    if (mappedAction === 'feed' && feedUri) {
      mappedArgs.feedUri = feedUri;
    }

    if (options.limit != null) {
      mappedArgs.limit = Number(options.limit);
    } else if (options.count != null) {
      mappedArgs.limit = Number(options.count);
    }
    if (options.cursor != null) {
      mappedArgs.cursor = options.cursor;
    }

    // Auth credentials (from options or authCookie)
    const identifier = options.identifier || options.authCookie?.identifier || options.session?.identifier;
    const password = options.password || options.authCookie?.password || options.session?.password;
    if (identifier) mappedArgs.identifier = identifier;
    if (password) mappedArgs.password = password;

    const session = {
      ...(options.session || {}),
      ...(identifier ? { identifier } : {}),
      ...(password ? { password } : {}),
    };

    const client = new BlueskyClient({
      baseUrl: options.baseUrl || options.service,
      service: options.service || options.baseUrl,
      identifier,
      password,
      proxy: options.proxy,
      proxyPool: options.proxyPool,
      proxyProvider: options.proxyProvider,
      governor: options.governor,
      responseValidator: options.responseValidator,
      requiresProxy: options.requiresProxy,
      timeout: options.timeout,
    });

    const crawler = new BlueskyCrawler({
      client,
      store,
      redisPublisher: options.redisPublisher,
      proxyPool: options.proxyPool,
      governor: options.governor,
      accountPool: options.accountPool,
      sessionManager: options.sessionManager,
      requiresProxy: options.requiresProxy,
    });

    try {
      return await crawler.start({ action: mappedAction, args: mappedArgs, session });
    } finally {
      if (options.autoClose !== false) {
        await crawler.cleanup().catch(() => {});
      }
    }
  }

  // ── Mastodon hybrid path (Story 23.6) ──
  // Dispatches to MastodonCrawler / MastodonClient (Federated REST API).
  if (platformName === 'mastodon' || platformName === 'masto') {
    /** @type {Record<string, string>} */
    const MASTODON_ACTION_MAP = {
      profile: 'profile',
      followers: 'followers',
      following: 'following',
      posts: 'posts',
      tweets: 'posts',
      timeline: 'posts',
      feed: 'posts',
      user_feed: 'posts',
      get_user_feed: 'posts',
      statuses: 'posts',
      toots: 'posts',
      toot: 'posts',
      search: 'search',
      hashtag: 'hashtag',
      tag: 'hashtag',
      trending: 'trending',
      trends: 'trending',
      // Legacy function-name aliases still accepted for backward compatibility
      scrapeProfile: 'profile',
      scrapeFollowers: 'followers',
      scrapeFollowing: 'following',
      scrapeTweets: 'posts',
      searchTweets: 'search',
      scrapeHashtag: 'hashtag',
      scrapeTrending: 'trending',
    };

    const normalizedAction = typeof action === 'string' ? action.toLowerCase().trim() : action;
    const mappedAction = MASTODON_ACTION_MAP[normalizedAction];

    if (!mappedAction) {
      const available = [...new Set(Object.values(MASTODON_ACTION_MAP))];
      throw new Error(
        `Action "${action}" not available on platform "${platform}". Available: ${available.join(', ')}`
      );
    }

    let username = options.username || options.handle || options.actor || options.target;
    let instance = options.instance || options.baseUrl || options.service;

    // Only resolve a Mastodon URL for actions that expect an account target.
    if (options.url && ['profile', 'followers', 'following', 'posts'].includes(mappedAction)) {
      const resolved = resolveMastodonTarget(options.url, instance || undefined);
      if (!username) {
        username = resolved.username;
      }
      if (!instance) {
        instance = resolved.instance;
      }
    }

    // If a custom client is passed and no explicit instance/baseUrl was given,
    // use the client's baseUrl so the crawler dispatches to the right instance.
    if (!instance && options.client?.baseUrl) {
      instance = options.client.baseUrl;
    }

    const query = options.query || options.q || options.keyword || options.target || options.url;
    const hashtag = options.hashtag || options.tag || options.target || (options.url && !username ? options.url.split('/').pop() : undefined);
    instance = normalizeInstanceUrl(instance);
    const accessToken = options.accessToken || options.authToken || options.token || options.session?.accessToken;

    /** @type {Record<string, unknown>} */
    const mappedArgs = { ...options };
    if (['profile', 'followers', 'following', 'posts'].includes(mappedAction) && username) {
      mappedArgs.username = username;
    }
    if (mappedAction === 'search' && query) {
      mappedArgs.query = query;
    }
    if (mappedAction === 'hashtag' && hashtag) {
      mappedArgs.hashtag = hashtag;
    }
    if (instance) {
      mappedArgs.instance = instance;
    }
    if (accessToken) {
      mappedArgs.accessToken = accessToken;
    }

    delete mappedArgs.limit;
    const rawLimit = options.limit ?? options.count;
    if (rawLimit != null) {
      const parsed = Number(rawLimit);
      if (Number.isFinite(parsed) && parsed >= 0) {
        mappedArgs.limit = parsed;
      }
    }
    if (options.max_id != null) {
      mappedArgs.max_id = options.max_id;
    }
    if (options.since_id != null) {
      mappedArgs.since_id = options.since_id;
    }
    if (options.includeReplies != null) {
      mappedArgs.exclude_replies = !options.includeReplies;
    } else if (options.exclude_replies != null) {
      mappedArgs.exclude_replies = options.exclude_replies;
    }
    if (options.cursor != null) {
      mappedArgs.max_id = options.cursor;
    }
    if (options.type != null) {
      mappedArgs.type = options.type;
    }

    const session = {
      ...(options.session || {}),
      ...(accessToken ? { accessToken } : {}),
    };

    const client = options.client || new MastodonClient({
      baseUrl: instance,
      instance,
      accessToken,
      proxy: options.proxy,
      proxyPool: options.proxyPool,
      proxyProvider: options.proxyProvider,
      governor: options.governor,
      responseValidator: options.responseValidator,
      requiresProxy: options.requiresProxy,
      timeout: options.timeout,
    });

    const crawler = new MastodonCrawler({
      client,
      store,
      redisPublisher: options.redisPublisher,
      proxyPool: options.proxyPool,
      governor: options.governor,
      accountPool: options.accountPool,
      sessionManager: options.sessionManager,
      requiresProxy: options.requiresProxy,
    });

    try {
      return await crawler.start({ action: mappedAction, args: mappedArgs, session });
    } finally {
      if (options.autoClose !== false) {
        await crawler.cleanup().catch(() => {});
      }
    }
  }

  // Threads hybrid path — no Puppeteer, dispatches to ThreadsCrawler.
  // This branch is evaluated first so legacy actionMap / platform lookups
  // do not block the new hybrid GraphQL flow.
  if (platformName === 'threads') {
    /** @type {Record<string, string>} */
    const THREADS_ACTION_MAP = {
      profile: 'profile',
      tweets: 'get_user_feed',
      timeline: 'get_user_feed',
      feed: 'get_user_feed',
      user_feed: 'get_user_feed',
      posts: 'get_user_feed',
      post: 'post_detail',
      post_detail: 'post_detail',
      comments: 'get_post_comments',
      post_comments: 'get_post_comments',
      get_comments: 'get_post_comments',
      search: 'search',
      followers: 'followers',
      following: 'following',
    };

    const mappedAction = THREADS_ACTION_MAP[action];
    if (!mappedAction) {
      const available = Object.values(THREADS_ACTION_MAP);
      const unique = [...new Set(available)];
      throw new Error(
        `Action "${action}" not available on platform "${platform}". Available: ${unique.join(', ')}`
      );
    }

    const username = options.username || options.target;
    const postId = options.postId || options.url || options.target;
    const query = options.query || options.target;

    /** @type {Record<string, unknown>} */
    const mappedArgs = {};
    if (['profile', 'followers', 'following', 'get_user_feed', 'tweets'].includes(mappedAction) && username) {
      mappedArgs.username = username;
    }
    if (['post_detail', 'get_post_comments'].includes(mappedAction) && postId) {
      mappedArgs.postId = postId;
    }
    if (mappedAction === 'search' && query) {
      mappedArgs.query = query;
    }

    // Normalize counts/cursors
    if (options.limit != null) {
      mappedArgs.count = Number(options.limit);
    } else if (options.count != null) {
      mappedArgs.count = Number(options.count);
    }
    if (options.cursor != null) {
      mappedArgs.cursor = options.cursor;
    }
    if (options.maxDepth != null) {
      mappedArgs.maxDepth = Number(options.maxDepth);
    }
    if (options.maxComments != null) {
      mappedArgs.maxComments = Number(options.maxComments);
    }
    if (options.includeReplies != null) {
      mappedArgs.includeReplies = options.includeReplies;
    }
    if (options.searchType != null) {
      mappedArgs.searchType = options.searchType;
    }

    // Map cursor to after for post/comment actions.
    if (mappedArgs.cursor != null && ['post_detail', 'get_post_comments'].includes(mappedAction) && mappedArgs.after == null) {
      mappedArgs.after = mappedArgs.cursor;
    }

    const session = {
      accountId: options.accountId || 'threads-guest',
      cookies: options.authCookie || options.cookies || '',
    };

    const client = new ThreadsClient({
      baseUrl: options.baseUrl,
      proxyPool: options.proxyPool,
      governor: options.governor,
      accountPool: options.accountPool,
      sessionManager: options.sessionManager,
    });

    const crawler = new ThreadsCrawler({
      client,
      store,
      proxyPool: options.proxyPool,
      governor: options.governor,
      accountPool: options.accountPool,
      sessionManager: options.sessionManager,
      docIds: options.docIds,
    });

    try {
      return await crawler.start({ action: mappedAction, args: mappedArgs, session });
    } finally {
      if (options.autoClose !== false) {
        await crawler.cleanup().catch(() => {});
      }
    }
  }

  // TikTok hybrid path — uses browser-as-signer bridge and got-scraping HTTP client.
  if (platformName === 'tiktok') {
    /** @type {Record<string, string>} */
    const TIKTOK_ACTION_MAP = {
      search: 'search',
      search_videos: 'search',
      hashtag: 'hashtag_feed',
      hashtag_feed: 'hashtag_feed',
      video_detail: 'post_detail',
      post_detail: 'post_detail',
      post: 'post_detail',
      video_comments: 'get_post_comments',
      comments: 'get_post_comments',
      get_post_comments: 'get_post_comments',
    };

    const mappedAction = TIKTOK_ACTION_MAP[action];
    if (!mappedAction) {
      const available = Object.values(TIKTOK_ACTION_MAP);
      const unique = [...new Set(available)];
      throw new Error(
        `Action "${action}" not available on platform "${platform}". Available: ${unique.join(', ')}`
      );
    }

    const query = options.query || options.keyword || options.q || options.target;
    const tag = options.hashtag || options.tag || options.target;
    const videoId = options.videoId || options.postId || options.id || options.url || options.target;

    /** @type {Record<string, unknown>} */
    const mappedArgs = {};
    if (mappedAction === 'search' && query) {
      mappedArgs.query = query;
    }
    if (mappedAction === 'hashtag_feed' && tag) {
      mappedArgs.tag = tag;
    }
    if (['post_detail', 'get_post_comments'].includes(mappedAction) && videoId) {
      mappedArgs.videoId = videoId;
    }

    if (options.limit != null) {
      mappedArgs.count = Number(options.limit);
    } else if (options.count != null) {
      mappedArgs.count = Number(options.count);
    }
    if (options.cursor != null) {
      mappedArgs.cursor = options.cursor;
    }
    if (options.after != null) {
      mappedArgs.after = options.after;
    }
    if (options.maxDepth != null) {
      mappedArgs.maxDepth = Number(options.maxDepth);
    }
    if (options.maxComments != null) {
      mappedArgs.maxComments = Number(options.maxComments);
    }
    if (options.includeComments != null) {
      mappedArgs.includeComments = options.includeComments;
    }

    if (mappedArgs.cursor != null && ['post_detail', 'get_post_comments'].includes(mappedAction) && mappedArgs.after == null) {
      mappedArgs.after = mappedArgs.cursor;
    }

    const session = {
      accountId: options.accountId || 'tiktok-guest',
      cookies: options.authCookie || options.cookies || '',
    };

    const client = new TikTokClient({
      baseUrl: options.baseUrl,
      proxy: options.proxy,
      proxyPool: options.proxyPool,
      proxyProvider: options.proxyProvider,
      governor: options.governor,
      accountPool: options.accountPool,
      sessionManager: options.sessionManager,
      responseValidator: options.responseValidator,
      tokenRing: options.tokenRing,
      guestTokenRing: options.guestTokenRing,
      signerPool: options.signerPool,
      signerBridge: options.signerBridge,
      adapterName: options.adapterName,
      deviceContext: options.deviceContext,
      clientAbVersions: options.clientAbVersions,
      deviceId: options.deviceId,
      requiresProxy: options.requiresProxy,
      requiresAuth: options.requiresAuth,
      timeout: options.timeout,
      headless: options.headless !== false,
    });

    const crawler = new TikTokCrawler({
      client,
      store,
      redisPublisher: options.redisPublisher,
      proxyPool: options.proxyPool,
      proxyProvider: options.proxyProvider,
      governor: options.governor,
      accountPool: options.accountPool,
      sessionManager: options.sessionManager,
      responseValidator: options.responseValidator,
      requiresProxy: options.requiresProxy,
      requiresAuth: options.requiresAuth,
      timeout: options.timeout,
    });

    try {
      return await crawler.start({ action: mappedAction, args: mappedArgs, session });
    } finally {
      if (options.autoClose !== false) {
        await crawler.cleanup().catch(() => {});
      }
    }
  }

  // Facebook Hybrid Dispatch (Story 13.10, AC-1).
  // When the caller provides a Puppeteer page, keep the legacy page-based path
  // so existing unit tests and browser-bridged callers still work.
  if (platformName === 'facebook' || platformName === 'fb') {
    if (options.page) {
      const mod = getPlatform(platform);
      const legacyMap = {
        profile: 'scrapeProfile',
        followers: 'scrapeFollowers',
        following: 'scrapeFollowing',
        tweets: 'scrapeTweets',
        posts: 'scrapeTweets',
        search: 'searchFacebook',
        group_search: 'scrapeFacebookGroupSearch',
        post_comments: 'scrapeFacebookComments',
        group_posts: 'scrapeFacebookGroupPosts',
        group_comments: 'scrapeFacebookGroupComments',
        group_members: 'scrapeGroupMembers',
        'group-members': 'scrapeGroupMembers',
        marketplace: 'scrapeMarketplace',
      };
      const fnName = legacyMap[action] || action;
      const platformMod = /** @type {Record<string, Function>} */ (mod);
      const fn = /** @type {(...args: unknown[]) => Promise<Record<string, unknown>>} */ (platformMod[fnName]);

      if (typeof fn !== 'function') {
        const available = Object.keys(platformMod).filter(
          (k) => typeof platformMod[k] === 'function' && (k.startsWith('scrape') || k.startsWith('search'))
        );
        throw new Error(
          `Action "${action}" not available on platform "${platform}". Available: ${available.join(', ')}`
        );
      }

      if (options.authCookie && platformMod.loginWithCookie) {
        await platformMod.loginWithCookie(options.page, options.authCookie, options.browserOptions || {});
      }

      const target = action === 'group_search'
        ? options.url
        : (options.username || options.query || options.hashtag || options.url || options.listUrl || options.communityUrl);

      // Actions that only take page + options (no target)
      const noTargetActions = ['scrapeBookmarks', 'scrapeNotifications', 'scrapeTrending'];
      if (noTargetActions.includes(fnName)) {
        return await fn(options.page, options);
      }

      return await fn(options.page, target, options);
    }
    return await dispatchFacebookHybrid(action, options);
  }

  const mod = getPlatform(platform);

  // Action name mapping
  /** @type {Record<string, string>} */
  const actionMap = {
    profile: 'scrapeProfile',
    followers: 'scrapeFollowers',
    following: 'scrapeFollowing',
    tweets: 'scrapeTweets',
    posts: 'scrapeTweets', // alias
    search: 'searchTweets',
    hashtag: 'scrapeHashtag',
    trending: 'scrapeTrending',
    thread: 'scrapeThread',
    likes: 'scrapeLikes',
    media: 'scrapeMedia',
    listMembers: 'scrapeListMembers',
    bookmarks: 'scrapeBookmarks',
    notifications: 'scrapeNotifications',
    communityMembers: 'scrapeCommunityMembers',
    spaces: 'scrapeSpaces',
    feed: 'scrapeFeed',
    'group-members': 'scrapeGroupMembers',
    marketplace: 'scrapeMarketplace',
  };

  // Platform-specific action map for Facebook (Story 7.2). Prefer this over the
  // global actionMap so 'search' maps to 'searchFacebook' instead of 'searchTweets'.
  /** @type {Record<string, Record<string, string>>} */
  const platformActionMap = {
    facebook: {
      search: 'searchFacebook',
      post_comments: 'scrapeFacebookComments',
      group_posts: 'scrapeFacebookGroupPosts',
      group_comments: 'scrapeFacebookGroupComments',
      group_search: 'scrapeFacebookGroupSearch',
    },
  };

  const platformKey = platformName === 'fb' ? 'facebook' : platformName;
  const platformSpecific = platformActionMap[platformKey]?.[action];
  const fnName = platformSpecific || actionMap[action] || action;
  const fn = /** @type {((...args: unknown[]) => Promise<Record<string, unknown>>) | undefined} */ (mod[fnName]);
  const platformMod = /** @type {Record<string, Function>} */ (mod);

  if (typeof fn !== 'function') {
    const available = Object.keys(platformMod).filter(
      (k) => typeof platformMod[k] === 'function' && (k.startsWith('scrape') || k.startsWith('search'))
    );
    throw new Error(
      `Action "${action}" not available on platform "${platform}". Available: ${available.join(', ')}`
    );
  }

  // Determine the first argument based on platform type
  // Twitter uses Puppeteer page
  const needsPuppeteer = ['twitter', 'x', 'facebook', 'fb'].includes(platformName);

  if (needsPuppeteer) {
    let page = options.page;

    // Facebook uses a cookie-object ({ c_user, xs }) via authCookie, not a string authToken.
    // Reject the wrong key early (before launching a browser) with a clear message.
    if ((platformName === 'facebook' || platformName === 'fb') && options.authToken) {
      throw new Error(
        '❌ Facebook uses options.authCookie ({ c_user, xs }), not options.authToken'
      );
    }

    // Auto-create browser/page if not provided
    if (!page) {
      const browser = await platformMod.createBrowser(options.browserOptions || {});
      page = await platformMod.createPage(browser, options.browserOptions || {});

      // Store browser ref BEFORE login so a login/goto throw still allows cleanup
      // (previously set after login → a login failure leaked the Chromium process).
      (/** @type {import('puppeteer').Page} */ (page)).__xactions_browser = browser;

      // Authenticate proxy before login so the proxy tunnel is established first.
      // Story 7.4 AC3: page.authenticate(proxyAuth) after createPage, before loginWithCookie.
      const proxyAuth = options.browserOptions?.proxyAuth;
      if (proxyAuth && typeof (/** @type {import('puppeteer').Page} */ (page)).authenticate === 'function') {
        try {
          await (/** @type {import('puppeteer').Page} */ (page)).authenticate(/** @type {import('puppeteer').Credentials} */ (proxyAuth));
        } catch (err) {
          await browser.close().catch(() => {});
          throw new Error(`❌ Proxy authentication failed: ${(/** @type {Error} */ (err)).message || 'unknown error'}`);
        }
      }

      try {
        // Login if auth token provided (Twitter string path — unchanged)
        if (options.authToken && platformMod.loginWithCookie) {
          await platformMod.loginWithCookie(page, options.authToken);
        } else if (options.authCookie && platformMod.loginWithCookie) {
          // Cookie-object path for Facebook ({ c_user, xs }) — additive, does not affect Twitter
          // Pass browserOptions so loginWithCookie can respect headless/skipWarmup (Story 7.2 testing).
          await platformMod.loginWithCookie(page, options.authCookie, options.browserOptions || {});
        }
      } catch (loginErr) {
        // Close the browser we created before re-throwing, else it leaks
        await browser.close().catch(() => {});
        throw loginErr;
      }
    }

    if (!page) throw new Error('Failed to create or receive a Puppeteer page');

    // Determine the second argument based on action.
    // group_search needs url as target (query travels inside options);
    // all other actions follow the existing priority chain.
    const target = action === 'group_search'
      ? options.url
      : (options.username || options.query || options.hashtag || options.url || options.listUrl || options.communityUrl);

    // Actions that only take page + options (no target)
    const noTargetActions = ['scrapeBookmarks', 'scrapeNotifications', 'scrapeTrending'];
    
    let result;
    try {
      if (noTargetActions.includes(fnName)) {
        result = await fn(page, normalizedOptions);
      } else {
        result = await fn(page, target, normalizedOptions);
      }
    } finally {
      // Auto-close browser if we created it — runs even if fn throws (goto timeout,
      // selector error), preventing a leaked Chromium process. Swallow close errors.
      if (page.__xactions_browser && options.autoClose !== false) {
        await page.__xactions_browser.close().catch(() => {});
      }
    }

    return result;
  }

  throw new Error(`Cannot determine how to call platform "${platform}"`);
}

// ============================================================================
// Default Export — backward compatible
// ============================================================================

// ============================================================================
// Plugin Scrapers
// ============================================================================

/**
 * Get a plugin-contributed scraper by name.
 * Plugins register scrapers via the plugin system — this provides a unified lookup.
 * @param {string} name - Scraper name
 * @returns {Promise<((...args: unknown[]) => Promise<Record<string, unknown>>) | undefined>} The scraper handler, or undefined
 */
export async function getPluginScraper(name) {
  try {
    const { getPluginScrapers } = await import('../plugins/index.js');
    const scrapers = /** @type {Record<string, unknown>[]} */ (getPluginScrapers());
    const scraper = scrapers.find((s) => (/** @type {Record<string, unknown>} */ (s)).name === name);
    return /** @type {((...args: unknown[]) => Promise<Record<string, unknown>>) | undefined} */ (scraper ? (/** @type {Record<string, unknown>} */ (scraper)).handler : undefined);
  } catch {
    return undefined;
  }
}

export default {
  // Core (Twitter)
  createBrowser,
  createPage,
  loginWithCookie,
  
  // Twitter Scrapers (backward compatible)
  scrapeProfile,
  scrapeFollowers,
  scrapeFollowing,
  scrapeTweets,
  searchTweets,
  scrapeThread,
  scrapeLikes,
  scrapeHashtag,
  scrapeMedia,
  scrapeListMembers,
  scrapeBookmarks,
  scrapeNotifications,
  scrapeTrending,
  scrapeCommunityMembers,
  scrapeSpaces,
  
  // Export utilities
  exportToJSON,
  exportToCSV,
  
  // Multi-platform
  scrape,
  platforms,
  getPlatform,
  
  // Platform modules
  twitter,
  bluesky: blueskyProxy,
  mastodon: mastodonProxy,
  threads,
  facebook,
  tiktok,

  // Platform crawlers/clients (Story 23.6+)
  BlueskyCrawler,
  BlueskyClient,
  MastodonCrawler,
  MastodonClient,
  createBlueskyClient,
  createBlueskyCrawler,
  createMastodonClient,
  createMastodonCrawler,

  // Plugin scrapers lookup
  getPluginScraper,

  // Adapter system (multi-framework support)
  getAdapter,
  getAvailableAdapter,
  setDefaultAdapter,
  getDefaultAdapterName,
  registerAdapter,
  listAdapters,
  getAdapterInfo,
  checkAvailability,
  BaseAdapter,
};

export function createFacebookClient(options = {}) {
  return new FacebookClient(options);
}

export function createFacebookCrawler(client, options = {}) {
  return new FacebookCrawler({ client, ...options });
}

export function createBlueskyClient(options = {}) {
  return new BlueskyClient(options);
}

export function createBlueskyCrawler(client, options = {}) {
  const resolvedClient = client instanceof BlueskyClient ? client : new BlueskyClient(client || options || {});
  const resolvedOptions = client instanceof BlueskyClient ? options : (options || {});
  return new BlueskyCrawler({ client: resolvedClient, ...resolvedOptions });
}

export function createMastodonClient(options = {}) {
  return new MastodonClient(options);
}

export function createMastodonCrawler(client, options = {}) {
  const resolvedClient = client instanceof MastodonClient ? client : new MastodonClient(client || options || {});
  const resolvedOptions = client instanceof MastodonClient ? options : (options || {});
  return new MastodonCrawler({ client: resolvedClient, ...resolvedOptions });
}

// Named re-exports for adapter utilities
export {
  FacebookCrawler,
  FacebookClient,
  BlueskyCrawler,
  BlueskyClient,
  MastodonCrawler,
  MastodonClient,
  getAdapter,
  getAvailableAdapter,
  setDefaultAdapter,
  getDefaultAdapterName,
  registerAdapter,
  listAdapters,
  getAdapterInfo,
  checkAvailability,
  BaseAdapter,
};
