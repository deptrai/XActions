// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Instagram scrape() descriptor (Story 25.1).
 * Verbatim extraction of the instagram block from the unified dispatcher (Story 35.3).
 * Dispatches to InstagramCrawler / InstagramClient (Puppeteer stealth default, http + instagrapi bridge).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { InstagramCrawler } from './crawler.js';
import { InstagramClient } from './client.js';
import { actionNotAvailable } from '../../platforms.js';

/** @type {Record<string, string>} */
const INSTAGRAM_ACTION_MAP = {
  user: 'user',
  author: 'user',
  profile: 'user',
  posts: 'user',
  hashtag: 'hashtag',
  tag: 'hashtag',
  topic: 'hashtag',
  post: 'post',
  post_detail: 'post',
  media: 'post',
  reel: 'post',
  comments: 'comments',
  replies: 'comments',
};

export default {
  aliases: ['instagram', 'ig', 'insta'],

  /**
   * @param {Record<string, any>} options
   * @param {Record<string, any>} ctx
   * @returns {string}
   */
  mapAction(options, ctx) {
    const mappedAction = INSTAGRAM_ACTION_MAP[ctx.action];
    if (!mappedAction) {
      const available = [...new Set(Object.values(INSTAGRAM_ACTION_MAP))];
      throw actionNotAvailable(ctx.platform, ctx.action, available);
    }
    return mappedAction;
  },

  /**
   * @param {Record<string, any>} options
   * @returns {Record<string, any>}
   */
  mapArgs(options) {
    /** @type {Record<string, any>} */
    const mappedArgs = {};
    if (options.username != null || options.user != null || options.handle != null || options.author != null) {
      mappedArgs.username = options.username || options.user || options.handle || options.author;
    }
    if (options.tag != null || options.hashtag != null || options.topic != null) {
      mappedArgs.tag = options.tag || options.hashtag || options.topic;
    }
    if (options.shortcode != null || options.postId != null || options.id != null || options.url != null) {
      mappedArgs.shortcode = options.shortcode || options.postId || options.id || options.url;
    }
    if (options.url != null) mappedArgs.url = options.url;
    if (options.limit != null) mappedArgs.limit = options.limit;
    if (options.cursor != null) mappedArgs.cursor = options.cursor;
    if (options.transport != null) mappedArgs.transport = options.transport;
    if (options.userAgent != null) mappedArgs.userAgent = options.userAgent;
    if (options.accountId != null) mappedArgs.accountId = options.accountId;
    if (options.resume !== undefined) mappedArgs.resume = options.resume;
    if (options.dryRun !== undefined) mappedArgs.dryRun = options.dryRun;
    return mappedArgs;
  },

  /**
   * @param {Record<string, any>} options
   * @returns {InstagramClient}
   */
  createClient(options) {
    return options.client || new InstagramClient(/** @type {any} */ ({
      baseUrl: options.baseUrl || 'https://www.instagram.com',
      userAgent: options.userAgent,
      transport: options.transport,
      credentials: options.credentials || options.session,
      proxy: options.proxy,
      proxyPool: options.proxyPool,
      proxyProvider: options.proxyProvider,
      governor: options.governor,
      responseValidator: options.responseValidator,
      sessionManager: options.sessionManager,
      socialStore: options.socialStore,
      requiresAuth: options.requiresAuth,
      requiresProxy: options.requiresProxy,
      requiresResidential: options.requiresResidential !== false,
      timeout: options.timeout,
    }));
  },

  /**
   * @param {{ client: InstagramClient, store: any, options: Record<string, any>, ctx: Record<string, any> }} deps
   * @returns {InstagramCrawler}
   */
  createCrawler({ client, store, options }) {
    return new InstagramCrawler(/** @type {any} */ ({
      client,
      store,
      redisPublisher: options.redisPublisher,
      proxyPool: options.proxyPool,
      governor: options.governor,
      accountPool: options.accountPool,
      sessionManager: options.sessionManager,
      requiresAuth: options.requiresAuth,
      requiresProxy: options.requiresProxy,
    }));
  },

  /**
   * @param {Record<string, any>} options
   * @returns {Record<string, any>}
   */
  createSession(options) {
    return options.session || {};
  },
};
