// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Reddit scrape() descriptor (Story 25.1).
 * Verbatim extraction of the reddit block from the unified dispatcher (Story 35.1).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { RedditCrawler } from './crawler.js';
import { RedditClient } from './client.js';

/** @type {Record<string, string>} */
const REDDIT_ACTION_MAP = {
  subreddit: 'subreddit',
  posts: 'subreddit',
  feed: 'subreddit',
  user: 'user',
  profile: 'user',
  tweets: 'user',
  search: 'search',
  post_comments: 'post_comments',
  comments: 'post_comments',
  get_comments: 'post_comments',
  post_detail: 'post_comments',
  thread: 'post_comments',
  subreddit_info: 'subreddit_info',
  subreddit_about: 'subreddit_info',
  community: 'subreddit_info',
};

export default {
  aliases: ['reddit', 'rdt'],

  actionMap: REDDIT_ACTION_MAP,

  /**
   * @param {Record<string, any>} options
   * @returns {Record<string, any>}
   */
  mapArgs(options) {
    /** @type {Record<string, any>} */
    const mappedArgs = { ...options };
    if (options.name) mappedArgs.name = options.name;
    if (options.subreddit) mappedArgs.name = options.subreddit;
    if (options.username) mappedArgs.username = options.username;
    if (options.user) mappedArgs.username = options.user;
    if (options.query || options.q) mappedArgs.query = options.query || options.q;
    if (options.postId) mappedArgs.postId = options.postId;
    if (options.id) mappedArgs.postId = options.id;
    if (options.url) {
      mappedArgs.url = options.url;
      const commentMatch = String(options.url).match(/\/comments\/([^/?#]+)/i);
      if (commentMatch && !mappedArgs.postId) {
        mappedArgs.postId = commentMatch[1];
      }
      const subMatch = String(options.url).match(/\/r\/([^/?#]+)(?:\/|$)/i);
      if (subMatch) {
        if (!mappedArgs.subreddit) mappedArgs.subreddit = subMatch[1];
        if (!mappedArgs.name && !commentMatch) mappedArgs.name = subMatch[1];
      }
    }
    if (options.sort) mappedArgs.sort = options.sort;
    if (options.time) mappedArgs.time = options.time;
    if (options.limit != null) mappedArgs.limit = Number(options.limit);
    if (options.maxComments != null) mappedArgs.limit = Number(options.maxComments);
    if (options.maxDepth != null) mappedArgs.depth = Number(options.maxDepth);
    if (options.cursor != null) mappedArgs.cursor = options.cursor;
    if (options.after != null) mappedArgs.after = options.after;
    return mappedArgs;
  },

  /**
   * @param {Record<string, any>} options
   * @returns {RedditClient}
   */
  createClient(options) {
    return options.client instanceof RedditClient
      ? options.client
      : new RedditClient(/** @type {any} */ ({
          baseUrl: options.baseUrl,
          apiBaseUrl: options.apiBaseUrl,
          oauthUrl: options.oauthUrl,
          clientId: options.clientId || options.redditClientId,
          clientSecret: options.clientSecret || options.redditClientSecret,
          username: options.redditUsername || options.username || undefined,
          userAgent: options.userAgent,
          accessToken: options.accessToken,
          proxy: options.proxy,
          proxyPool: options.proxyPool,
          proxyProvider: options.proxyProvider,
          governor: options.governor,
          accountPool: options.accountPool,
          responseValidator: options.responseValidator,
          requiresAuth: options.requiresAuth,
          requiresProxy: options.requiresProxy,
          transport: options.transport || options.redditTransport,
          timeout: options.timeout,
        }));
  },

  /**
   * @param {{ client: RedditClient, store: any, options: Record<string, any>, ctx: Record<string, any> }} deps
   * @returns {RedditCrawler}
   */
  createCrawler({ client, store, options }) {
    return new RedditCrawler(/** @type {any} */ ({
      client,
      store,
      transport: options.transport || options.redditTransport,
      redisPublisher: options.redisPublisher,
      proxyPool: options.proxyPool,
      proxyProvider: options.proxyProvider,
      governor: options.governor,
      accountPool: options.accountPool,
      sessionManager: options.sessionManager,
      requiresAuth: options.requiresAuth,
      requiresProxy: options.requiresProxy,
    }));
  },
};
