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
import bluesky from './bluesky/index.js';
import mastodon from './mastodon/index.js';
import threads from './threads/index.js';
import facebook from './facebook/index.js';
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
  bluesky,
  bsky: bluesky, // alias
  mastodon,
  masto: mastodon, // alias
  threads,
  facebook,
  fb: facebook, // alias
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
 * Unified scrape function — dispatches to the correct platform module
 * 
 * @param {string} platform - Platform name: 'twitter', 'bluesky', 'mastodon', 'threads'
 * @param {string} action - Action name: 'profile', 'followers', 'following', 'tweets', 'search', 'hashtag', 'trending'
 * @param {import('../types/xactions.js').XActionsOptions} options - Action-specific options
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
 * 
 *   // Threads (Puppeteer)
 *   const posts = await scrape('threads', 'tweets', { page, username: 'zuck', limit: 20 });
 */
export async function scrape(platform, action, options = {}) {
  const store = options.store || defaultStore;
  const normalizedOptions = { ...options, store };
  const mod = getPlatform(platform);
  const platformName = platform.toLowerCase();

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
  // Twitter & Threads use Puppeteer page; Bluesky & Mastodon use API clients
  const needsPuppeteer = ['twitter', 'x', 'threads', 'facebook', 'fb'].includes(platformName);
  const needsClient = ['bluesky', 'bsky', 'mastodon', 'masto'].includes(platformName);

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

  if (needsClient) {
    let client = normalizedOptions.client;

    // Auto-create client if not provided
    if (!client) {
      if (platformName === 'bluesky' || platformName === 'bsky') {
        client = await /** @type {Record<string, Function>} */ (bluesky).createAgent({
          service: options.service,
          identifier: options.identifier,
          password: options.password,
        });
      } else {
        client = /** @type {Record<string, Function>} */ (mastodon).createClient({
          instance: options.instance,
          accessToken: options.accessToken,
        });
      }
    }

    const target = options.username || options.query || options.hashtag || options.feedUri;

    // Actions that only take client + options (no target)
    const noTargetActions = ['scrapeTrending'];

    if (noTargetActions.includes(fnName)) {
      return await fn(client, options);
    }

    return await fn(client, target, options);
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
  bluesky,
  mastodon,
  threads,
  facebook,
  
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

// Named re-exports for adapter utilities
export {
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
