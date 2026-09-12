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
// Platform Registry + Dispatch Descriptors (Story 25.1)
// ============================================================================
//
// `scrape()` is a thin data-driven dispatcher: each platform co-locates a
// `descriptor.js` (aliases + actionMap/mapAction + mapArgs + client/crawler
// factories) in its module dir. The `platforms` module registry and the
// legacy `./twitter`, `./threads`, `./facebook` module imports live in
// `./platforms.js` so this file has zero legacy imports.

import {
  platforms,
  getPlatform,
  twitter,
  threads,
  facebook,
} from './platforms.js';

import {
  createBrowser,
  createPage,
  loginWithCookie,
  exportToJSON,
  exportToCSV,
} from './browser.js';

export {
  createBrowser,
  createPage,
  loginWithCookie,
  exportToJSON,
  exportToCSV,
};

export { platforms, getPlatform };

import twitterDescriptor from './social/twitter/descriptor.js';
import facebookDescriptor, { dispatchFacebookHybrid } from './social/facebook/descriptor.js';
import threadsDescriptor from './social/threads/descriptor.js';
import blueskyDescriptor from './social/bluesky/descriptor.js';
import mastodonDescriptor from './social/mastodon/descriptor.js';
import tiktokDescriptor from './social/tiktok/descriptor.js';
import redditDescriptor from './social/reddit/descriptor.js';
import mediumDescriptor from './social/medium/descriptor.js';
import instagramDescriptor from './social/instagram/descriptor.js';
import youtubeDescriptor from './social/youtube/descriptor.js';
import zaloDescriptor from './social/zalo/descriptor.js';
import shopeeDescriptor from './ecom/shopee/descriptor.js';
import tiktokShopDescriptor from './ecom/tiktok-shop/descriptor.js';
import topcvDescriptor from './recruitment/topcv/descriptor.js';
import vietnamworksDescriptor from './recruitment/vietnamworks/descriptor.js';
import linkedinDescriptor from './recruitment/linkedin/descriptor.js';
import chototDescriptor from './realestate/chotot/descriptor.js';
import batdongsanDescriptor from './realestate/batdongsan/descriptor.js';
import masothueDescriptor from './procurement/masothue/descriptor.js';
import b2bRegistryExtendedDescriptor from './procurement/b2b-registry-extended/descriptor.js';
import automotiveDescriptor from './vehicles/automotive/descriptor.js';
import fnbDescriptor from './fnb/merchant/descriptor.js';
import healthcareDescriptor from './healthcare/descriptor.js';
import ipLegalDescriptor from './legal/ip-trademark/descriptor.js';

export { dispatchFacebookHybrid };

// ============================================================================
// Crawler/Client imports kept for the public export surface
// (named re-exports, createXxxClient/createXxxCrawler factories, default export)
// ============================================================================

import { FacebookCrawler } from './social/facebook/crawler.js';
import { FacebookClient } from './social/facebook/client.js';
import { TikTokCrawler, createTikTokCrawler } from './social/tiktok/crawler.js';
import { TikTokClient, createTikTokClient } from './social/tiktok/client.js';
import { BlueskyCrawler } from './social/bluesky/crawler.js';
import { BlueskyClient } from './social/bluesky/client.js';
import { MastodonClient, MastodonCrawler } from './social/mastodon/index.js';
import { MaSoThueCrawler } from './procurement/masothue/crawler.js';
import { MaSoThueClient } from './procurement/masothue/client.js';
import { AutomotiveCrawler } from './vehicles/automotive/crawler.js';
import { AutomotiveClient } from './vehicles/automotive/client.js';
import { B2BRegistryExtendedCrawler } from './procurement/b2b-registry-extended/index.js';
import { B2BRegistryExtendedClient } from './procurement/b2b-registry-extended/client.js';
import { HealthcareCrawler } from './healthcare/crawler.js';
import { HealthcareClient } from './healthcare/client.js';
import { scrapeHealthcare } from './healthcare/index.js';
import { IpLegalCrawler } from './legal/ip-trademark/crawler.js';
import { IpLegalClient } from './legal/ip-trademark/client.js';
import { scrapeIpLegal } from './legal/ip-trademark/index.js';
import {
  YouTubeVNCrawler,
  YouTubeClient,
  createYouTubeVNCrawler,
  createYouTubeClient,
  scrapeYouTube,
} from './social/youtube/index.js';
import {
  ZaloCrawler,
  ZaloClient,
  createZaloCrawler,
  createZaloClient,
  scrapeZalo,
} from './social/zalo/index.js';
import { RedditCrawler } from './social/reddit/crawler.js';
import { RedditClient } from './social/reddit/client.js';
import { MediumClient } from './social/medium/client.js';
import { MediumCrawler } from './social/medium/crawler.js';
import { defaultStore } from '../store/index.js';

// ============================================================================
// HTTP Scraper (Direct GraphQL — no browser required)
// Usage: createBrowser({ adapter: 'http', cookies: '...' })
// Or:   import { createHttpScraper } from 'xactions/scrapers/social/twitter';
// ============================================================================

export { createHttpScraper } from './social/twitter/http/index.js';

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
// Backward-Compatible Twitter Re-exports (routed to scrape())
// ============================================================================

export const scrapeProfile = (page, username, opts = {}) => scrape('twitter', 'profile', { page, username, ...opts });
export const scrapeFollowers = (page, username, opts = {}) => scrape('twitter', 'followers', { page, username, ...opts });
export const scrapeFollowing = (page, username, opts = {}) => scrape('twitter', 'following', { page, username, ...opts });
export const scrapeTweets = (page, username, opts = {}) => scrape('twitter', 'tweets', { page, username, ...opts });
export const searchTweets = (page, query, opts = {}) => scrape('twitter', 'search', { page, query, ...opts });
export const scrapeThread = (page, tweetId, opts = {}) => scrape('twitter', 'thread', { page, tweetId, ...opts });
export const scrapeLikes = (page, username, opts = {}) => scrape('twitter', 'likes', { page, username, ...opts });
export const scrapeHashtag = (page, hashtag, opts = {}) => scrape('twitter', 'hashtag', { page, hashtag, ...opts });
export const scrapeMedia = (page, username, opts = {}) => scrape('twitter', 'media', { page, username, ...opts });
export const scrapeListMembers = (page, listId, opts = {}) => scrape('twitter', 'list_members', { page, listId, ...opts });
export const scrapeBookmarks = (page, opts = {}) => scrape('twitter', 'bookmarks', { page, ...opts });
export const scrapeNotifications = (page, opts = {}) => scrape('twitter', 'notifications', { page, ...opts });
export const scrapeTrending = (page, opts = {}) => scrape('twitter', 'trending', { page, ...opts });
export const scrapeCommunityMembers = (page, communityId, opts = {}) => scrape('twitter', 'community_members', { page, communityId, ...opts });
export const scrapeSpaces = (page, query, opts = {}) => scrape('twitter', 'spaces', { page, query, ...opts });

// ============================================================================
// Unified Scrape Interface — Thin Descriptor Dispatcher (Story 25.1)
// ============================================================================

/**
 * Alias → descriptor lookup. Every alias that previously had an `if`-block in
 * the monolithic `scrape()` resolves to the same descriptor object — including
 * aliases that never appeared in `platforms` (shopee, vnw, medium_com), which
 * used to work because their blocks ran before `getPlatform()` was reached.
 * @type {Record<string, Record<string, any>>}
 */
const DESCRIPTORS = {};
for (const descriptor of [
  twitterDescriptor,
  facebookDescriptor,
  threadsDescriptor,
  blueskyDescriptor,
  mastodonDescriptor,
  tiktokDescriptor,
  redditDescriptor,
  mediumDescriptor,
  instagramDescriptor,
  youtubeDescriptor,
  zaloDescriptor,
  shopeeDescriptor,
  tiktokShopDescriptor,
  topcvDescriptor,
  vietnamworksDescriptor,
  linkedinDescriptor,
  chototDescriptor,
  batdongsanDescriptor,
  masothueDescriptor,
  b2bRegistryExtendedDescriptor,
  automotiveDescriptor,
  fnbDescriptor,
  healthcareDescriptor,
  ipLegalDescriptor,
]) {
  for (const alias of descriptor.aliases) {
    DESCRIPTORS[alias] = descriptor;
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
  if (typeof platform !== 'string' || !platform) {
    throw new Error('❌ platform must be a non-empty string');
  }
  options = options || {};
  const platformName = platform.toLowerCase();
  const descriptor = DESCRIPTORS[platformName];
  // Every alias that had a scrape() block has a descriptor — a miss here means
  // the platform key is not dispatchable at all; getPlatform() throws the
  // canonical "Unknown platform ..." error (same shape as before).
  if (!descriptor) {
    getPlatform(platform);
    throw new Error(`No dispatcher descriptor registered for platform "${platformName}"`); // defensive, unreachable
  }

  /** @type {Record<string, any>} */
  const ctx = { platform, platformName, action };
  if (descriptor.dispatch) {
    return descriptor.dispatch(platformName, action, options, ctx); // facebook page-path
  }

  const mappedAction = descriptor.mapAction
    ? descriptor.mapAction(options, ctx)
    : (descriptor.actionMap?.[action] || action);
  ctx.mappedAction = mappedAction;
  const mappedArgs = descriptor.mapArgs(options, ctx);
  ctx.mappedArgs = mappedArgs;
  const store = options.store !== undefined ? options.store : defaultStore;
  const client = descriptor.createClient(options, ctx);
  const crawler = descriptor.createCrawler({ client, store, options, ctx });
  const session = descriptor.createSession
    ? descriptor.createSession(options, ctx)
    : options.session;

  try {
    return await crawler.start({ action: mappedAction, args: mappedArgs, session });
  } finally {
    if (options.autoClose !== false && typeof crawler?.cleanup === 'function') {
      await crawler.cleanup().catch(() => {});
    }
  }
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
  bluesky: platforms.bluesky,
  mastodon: platforms.mastodon,
  threads,
  facebook,
  tiktok: platforms.tiktok,
  masothue: platforms.masothue,
  b2bRegistryExtended: platforms.b2b_registry_extended,

  // Platform crawlers/clients (Story 23.6+)
  BlueskyCrawler,
  BlueskyClient,
  MastodonCrawler,
  MastodonClient,
  MaSoThueCrawler,
  MaSoThueClient,
  AutomotiveCrawler,
  AutomotiveClient,
  B2BRegistryExtendedCrawler,
  B2BRegistryExtendedClient,
  HealthcareCrawler,
  HealthcareClient,
  scrapeHealthcare,
  IpLegalCrawler,
  IpLegalClient,
  scrapeIpLegal,
  YouTubeVNCrawler,
  YouTubeClient,
  createYouTubeVNCrawler,
  createYouTubeClient,
  scrapeYouTube,
  createBlueskyClient,
  createBlueskyCrawler,
  createMastodonClient,
  createMastodonCrawler,
  createMaSoThueClient,
  createMaSoThueCrawler,
  createAutomotiveClient,
  createAutomotiveCrawler,
  createB2BRegistryExtendedClient,
  createB2BRegistryExtendedCrawler,
  createRedditClient,
  createRedditCrawler,

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

export function createMaSoThueClient(options = {}) {
  return new MaSoThueClient(options);
}

export function createMaSoThueCrawler(client, options = {}) {
  const resolvedClient = client instanceof MaSoThueClient ? client : new MaSoThueClient(client || options || {});
  const resolvedOptions = client instanceof MaSoThueClient ? options : (options || {});
  return new MaSoThueCrawler({ client: resolvedClient, ...resolvedOptions });
}

export function createAutomotiveClient(options = {}) {
  return new AutomotiveClient(options);
}

export function createAutomotiveCrawler(client, options = {}) {
  const resolvedClient = client instanceof AutomotiveClient ? client : new AutomotiveClient(client || options || {});
  const resolvedOptions = client instanceof AutomotiveClient ? options : (options || {});
  return new AutomotiveCrawler({ client: resolvedClient, ...resolvedOptions });
}

export function createB2BRegistryExtendedClient(options = {}) {
  return new B2BRegistryExtendedClient(options);
}

export function createB2BRegistryExtendedCrawler(client, options = {}) {
  const resolvedClient = client instanceof B2BRegistryExtendedClient ? client : new B2BRegistryExtendedClient(client || options || {});
  const resolvedOptions = client instanceof B2BRegistryExtendedClient ? options : (options || {});
  return new B2BRegistryExtendedCrawler({ client: resolvedClient, ...resolvedOptions });
}

export function createRedditClient(options = {}) {
  return new RedditClient(options);
}

export function createRedditCrawler(clientOrDeps, options = {}) {
  let resolvedClient;
  let resolvedOptions;
  if (clientOrDeps instanceof RedditClient) {
    resolvedClient = clientOrDeps;
    resolvedOptions = options || {};
  } else if (clientOrDeps && clientOrDeps.client instanceof RedditClient) {
    resolvedClient = clientOrDeps.client;
    resolvedOptions = { ...clientOrDeps, ...options };
    delete resolvedOptions.client;
  } else {
    resolvedClient = new RedditClient(clientOrDeps || options || {});
    resolvedOptions = clientOrDeps || options || {};
  }
  return new RedditCrawler({ client: resolvedClient, ...resolvedOptions });
}

export function createMediumClient(options = {}) {
  return new MediumClient(options);
}

export function createMediumCrawler(clientOrDeps, options = {}) {
  let resolvedClient;
  let resolvedOptions;
  if (clientOrDeps instanceof MediumClient) {
    resolvedClient = clientOrDeps;
    resolvedOptions = options;
  } else if (clientOrDeps && clientOrDeps.client instanceof MediumClient) {
    resolvedClient = clientOrDeps.client;
    resolvedOptions = { ...clientOrDeps, ...options };
    delete resolvedOptions.client;
  } else {
    resolvedClient = new MediumClient(clientOrDeps || options || {});
    resolvedOptions = clientOrDeps || options || {};
  }
  return new MediumCrawler({ client: resolvedClient, ...resolvedOptions });
}

// Named re-exports for adapter utilities
export {
  YouTubeVNCrawler,
  YouTubeClient,
  createYouTubeVNCrawler,
  createYouTubeClient,
  scrapeYouTube,
  ZaloCrawler,
  ZaloClient,
  createZaloCrawler,
  createZaloClient,
  scrapeZalo,
  FacebookCrawler,
  FacebookClient,
  BlueskyCrawler,
  BlueskyClient,
  MastodonCrawler,
  MastodonClient,
  MaSoThueCrawler,
  MaSoThueClient,
  AutomotiveCrawler,
  AutomotiveClient,
  B2BRegistryExtendedCrawler,
  B2BRegistryExtendedClient,
  RedditCrawler,
  RedditClient,
  TikTokCrawler,
  TikTokClient,
  createTikTokCrawler,
  createTikTokClient,
  MediumCrawler,
  MediumClient,
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
