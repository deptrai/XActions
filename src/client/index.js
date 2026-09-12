// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Client — Barrel Export
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import { scrape as dispatchScrape } from '../scrapers/index.js';

export const SearchMode = Object.freeze({
  Top: 'Top',
  Latest: 'Latest',
  Photos: 'Photos',
  Videos: 'Videos',
});

/**
 * @deprecated Legacy Scraper is decommissioned in Epic 26.
 * Use `scrape('twitter', action)` or `TwitterClient` / `TwitterCrawler` from `xactions/scrapers/social/twitter` instead.
 */
export class Scraper {
  /** @param {Record<string, any>} [options] */
  constructor(options = {}) {
    this.options = options;
  }

  async loadCookies() {
    // Backward compatibility stub
  }

  /** @param {string} username */
  async getProfile(username) {
    /** @type {any} */
    const res = await dispatchScrape('twitter', 'profile', { username, ...this.options });
    return res.data || res;
  }

  /** @param {string} tweetId */
  async getTweet(tweetId) {
    /** @type {any} */
    const res = await dispatchScrape('twitter', 'tweet_detail', { tweetId, ...this.options });
    return res.data || res;
  }

  /**
   * @param {string} query
   * @param {number} [count]
   * @param {string} [mode]
   */
  async *searchTweets(query, count = 20, mode = 'Latest') {
    /** @type {any} */
    const res = await dispatchScrape('twitter', 'search', { query, limit: count, ...this.options });
    const items = res.items || res.posts || [];
    for (const item of items) yield item;
  }

  /** @param {string} text */
  async sendTweet(text) {
    return await dispatchScrape('twitter', 'post', { text, ...this.options });
  }

  /**
   * @param {string} userId
   * @param {number} [count]
   */
  async *getFollowers(userId, count = 100) {
    /** @type {any} */
    const res = await dispatchScrape('twitter', 'followers', { username: userId, limit: count, ...this.options });
    const items = res.items || res.users || [];
    for (const item of items) yield item;
  }

  async getTrends() {
    /** @type {any} */
    const res = await dispatchScrape('twitter', 'trending', { ...this.options });
    return res.trends || res.items || [];
  }
}

// Data models
export { Tweet } from './models/Tweet.js';
export { Profile } from './models/Profile.js';
export { Message } from './models/Message.js';

// Errors
export { ScraperError, AuthenticationError, RateLimitError, NotFoundError, TwitterApiError } from './errors.js';

// GraphQL internals (advanced usage)
export { GRAPHQL_ENDPOINTS, BEARER_TOKEN, DEFAULT_FEATURES, buildGraphQLUrl } from './api/graphqlQueries.js';

// Auth
export { TokenManager } from './auth/TokenManager.js';
