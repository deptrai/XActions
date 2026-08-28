// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
/**
 * XActions Facebook Scrapers (Legacy)
 * Puppeteer-based scrapers for Facebook (facebook.com)
 *
 * Uses the same Puppeteer stealth approach as Twitter and Threads scrapers.
 *
 * @deprecated Use `src/scrapers/social/facebook/index.js` (`FacebookCrawler`, `FacebookClient`) instead. See docs/deprecation-plan.md.
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 * @license BSL 1.1
 */

// by nichxbt

// Facebook scraper barrel file
import { warmSession } from './warmup.js';
import { FacebookPlatformResponseValidator } from './validator.js';
export { warmSession, FacebookPlatformResponseValidator };
export * from './core.js';
export * from './auth.js';
export * from './normalize.js';
export * from './profile.js';
export * from './posts.js';
export * from './comments.js';
export * from './search.js';
export * from './followers.js';
export * from './marketplace.js';
export * from './group-search.js';
import { createBrowser } from './core.js';
import { createPage } from './core.js';
import { loginWithCookie } from './auth.js';
import { generateTotp } from './auth.js';
import { loginWithPassword } from './auth.js';
import { scrapeProfile } from './profile.js';
import { scrapeFollowers } from './followers.js';
import { scrapeTweets } from './posts.js';
import { scrapeFacebookComments } from './comments.js';
import { scrapeFacebookGroupPosts } from './posts.js';
import { scrapeFacebookGroupComments } from './comments.js';
import { scrapeFacebookGroupSearch } from './group-search.js';
import { searchFacebook } from './search.js';
import { searchTweets } from './search.js';
import { scrapeGroupMembers } from './followers.js';
// LEGACY — see docs/deprecation-plan.md
import { scrapeMarketplace } from './marketplace.js';

export default {
  createBrowser,
  createPage,
  loginWithCookie,
  generateTotp,
  loginWithPassword,
  scrapeProfile,
  scrapeFollowers,
  scrapeTweets,
  searchTweets,
  searchFacebook,
  scrapeGroupMembers,
  scrapeMarketplace,
  scrapeFacebookComments,
  scrapeFacebookGroupPosts,
  scrapeFacebookGroupComments,
  scrapeFacebookGroupSearch
};
