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
    /** @type {Record<string, string>} */
    this.cookies = {};
  }

  /** @param {string} [filePath] */
  async loadCookies(filePath) {
    // Backward compatibility stub — reads cookies from file if provided
    if (filePath) {
      const fs = await import('node:fs/promises');
      const raw = await fs.readFile(filePath, 'utf8');
      for (const pair of raw.split(';')) {
        const [k, ...v] = pair.trim().split('=');
        if (k) this.cookies[k.trim()] = v.join('=').trim();
      }
    }
  }

  /** @param {string} cookies — semicolon-separated cookie string */
  async setCookies(cookies) {
    if (typeof cookies === 'string') {
      for (const pair of cookies.split(';')) {
        const [k, ...v] = pair.trim().split('=');
        if (k) this.cookies[k.trim()] = v.join('=').trim();
      }
    }
  }

  async getCookies() {
    return this.cookies;
  }

  /** @param {string} filePath */
  async saveCookies(filePath) {
    const fs = await import('node:fs/promises');
    const str = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    await fs.writeFile(filePath, str, 'utf8');
  }

  /** @param {string} username */
  async getProfile(username) {
    /** @type {any} */
    const res = await dispatchScrape('twitter', 'profile', { username, ...this.options });
    return res.data || res;
  }

  async me() {
    return this.getProfile(this.options?.username || 'me');
  }

  /** @param {string} tweetId */
  async getTweet(tweetId) {
    /** @type {any} */
    const res = await dispatchScrape('twitter', 'tweet_detail', { tweetId, ...this.options });
    return res.data || res;
  }

  /**
   * @param {string} username
   * @param {number} [count]
   */
  async *getTweets(username, count = 100) {
    /** @type {any} */
    const res = await dispatchScrape('twitter', 'tweets', { username, limit: count, ...this.options });
    const items = res.items || res.posts || res.tweets || [];
    for (const item of items) yield item;
  }

  /**
   * @param {string} username
   * @param {number} [count]
   */
  async *getTweetsAndReplies(username, count = 100) {
    yield* this.getTweets(username, count);
  }

  /**
   * @param {string} username
   * @param {number} [count]
   */
  async *getLikedTweets(username, count = 100) {
    /** @type {any} */
    const res = await dispatchScrape('twitter', 'likes', { username, limit: count, ...this.options });
    const items = res.items || res.posts || [];
    for (const item of items) yield item;
  }

  /** @param {string} username */
  async getLatestTweet(username) {
    for await (const t of this.getTweets(username, 1)) return t;
    return null;
  }

  /** @param {string} text @param {Record<string, any>} [options] */
  async sendTweet(text, options = {}) {
    return await dispatchScrape('twitter', 'post', { text, ...options, ...this.options });
  }

  /** @param {string} text @param {string} quotedTweetId @param {string[]} [mediaIds] */
  async sendQuoteTweet(text, quotedTweetId, mediaIds) {
    return await dispatchScrape('twitter', 'quote', { text, tweetId: quotedTweetId, mediaIds, ...this.options });
  }

  /** @param {string} id */
  async deleteTweet(id) {
    return await dispatchScrape('twitter', 'delete_tweet', { tweetId: id, ...this.options });
  }

  /** @param {string} id */
  async likeTweet(id) {
    return await dispatchScrape('twitter', 'like', { tweetId: id, ...this.options });
  }

  /** @param {string} id */
  async unlikeTweet(id) {
    return await dispatchScrape('twitter', 'unlike', { tweetId: id, ...this.options });
  }

  /** @param {string} id */
  async retweet(id) {
    return await dispatchScrape('twitter', 'retweet', { tweetId: id, ...this.options });
  }

  /** @param {string} id */
  async unretweet(id) {
    return await dispatchScrape('twitter', 'undo_retweet', { tweetId: id, ...this.options });
  }

  /**
   * @param {string} query
   * @param {number} [count]
   * @param {string} [mode]
   */
  async *searchTweets(query, count = 100, mode = 'Latest') {
    /** @type {any} */
    const res = await dispatchScrape('twitter', 'search', { query, limit: count, mode, ...this.options });
    const items = res.items || res.posts || [];
    for (const item of items) yield item;
  }

  /**
   * @param {string} query
   * @param {number} [count]
   */
  async *searchProfiles(query, count = 100) {
    /** @type {any} */
    const res = await dispatchScrape('twitter', 'search_users', { query, limit: count, ...this.options });
    const items = res.items || res.users || [];
    for (const item of items) yield item;
  }

  /**
   * @param {string} userId
   * @param {number} [count]
   */
  async *getFollowers(userId, count = 100) {
    /** @type {any} */
    const res = await dispatchScrape('twitter', 'followers', { username: userId, limit: count, ...this.options });
    const items = res.items || res.users || res.followers || [];
    for (const item of items) yield item;
  }

  /**
   * @param {string} userId
   * @param {number} [count]
   */
  async *getFollowing(userId, count = 100) {
    /** @type {any} */
    const res = await dispatchScrape('twitter', 'following', { username: userId, limit: count, ...this.options });
    const items = res.items || res.users || res.following || [];
    for (const item of items) yield item;
  }

  /** @param {string} username */
  async followUser(username) {
    return await dispatchScrape('twitter', 'follow', { username, ...this.options });
  }

  /** @param {string} username */
  async unfollowUser(username) {
    return await dispatchScrape('twitter', 'unfollow', { username, ...this.options });
  }

  /** @param {string} [category] */
  async getTrends(category = 'trending') {
    /** @type {any} */
    const res = await dispatchScrape('twitter', 'trending', { category, ...this.options });
    return res.trends || res.items || [];
  }

  async getExploreTabs() {
    /** @type {any} */
    const res = await dispatchScrape('twitter', 'explore', { ...this.options });
    return res.tabs || res.items || [];
  }

  /**
   * @param {string} listId
   * @param {number} [count]
   */
  async *getListTweets(listId, count = 100) {
    /** @type {any} */
    const res = await dispatchScrape('twitter', 'list_tweets', { listId, limit: count, ...this.options });
    const items = res.items || res.posts || [];
    for (const item of items) yield item;
  }

  /**
   * @param {string} listId
   * @param {number} [count]
   */
  async *getListMembers(listId, count = 100) {
    /** @type {any} */
    const res = await dispatchScrape('twitter', 'list_members', { listId, limit: count, ...this.options });
    const items = res.items || res.users || [];
    for (const item of items) yield item;
  }

  /** @param {string} listId */
  async getListById(listId) {
    /** @type {any} */
    const res = await dispatchScrape('twitter', 'list_detail', { listId, ...this.options });
    return res.data || res;
  }

  async isLoggedIn() {
    return !!(this.cookies.auth_token || this.options?.authToken || this.options?.cookies);
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
