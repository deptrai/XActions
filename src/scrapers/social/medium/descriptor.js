// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Medium scrape() descriptor (Story 25.1).
 * Verbatim extraction of the medium block from the unified dispatcher (Story 35.2).
 * Dispatches to MediumCrawler / MediumClient (RSS-first, JSON fallback, Puppeteer stealth bridge).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { MediumCrawler } from './crawler.js';
import { MediumClient } from './client.js';
import { actionNotAvailable } from '../../platforms.js';

/** @type {Record<string, string>} */
const MEDIUM_ACTION_MAP = {
  user: 'user',
  author: 'user',
  posts: 'user',
  tweets: 'user',
  feed: 'user',
  publication: 'publication',
  pub: 'publication',
  magazine: 'publication',
  tag: 'tag',
  hashtag: 'tag',
  topic: 'tag',
  post: 'post',
  post_detail: 'post',
  article: 'post',
};

export default {
  aliases: ['medium', 'md', 'medium_com'],

  /**
   * @param {Record<string, any>} options
   * @param {Record<string, any>} ctx
   * @returns {string}
   */
  mapAction(options, ctx) {
    const mappedAction = MEDIUM_ACTION_MAP[ctx.action];
    if (!mappedAction) {
      const available = [...new Set(Object.values(MEDIUM_ACTION_MAP))];
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
    if (options.username != null || options.user != null || options.handle != null) {
      mappedArgs.username = options.username || options.user || options.handle;
    }
    if (options.slug != null || options.publication != null || options.pub != null || options.magazine != null) {
      mappedArgs.slug = options.slug || options.publication || options.pub || options.magazine;
    }
    if (options.tag != null || options.hashtag != null || options.topic != null) {
      mappedArgs.tag = options.tag || options.hashtag || options.topic;
    }
    if (options.postId != null || options.id != null || options.url != null) {
      mappedArgs.postId = options.postId || options.id || options.url;
    }
    if (options.url != null) mappedArgs.url = options.url;
    if (options.limit != null) mappedArgs.limit = options.limit;
    if (options.cursor != null) mappedArgs.cursor = options.cursor;
    if (options.transport != null) mappedArgs.transport = options.transport;
    if (options.domain != null) mappedArgs.domain = options.domain;
    if (options.userAgent != null) mappedArgs.userAgent = options.userAgent;
    if (options.resume !== undefined) mappedArgs.resume = options.resume;
    if (options.dryRun !== undefined) mappedArgs.dryRun = options.dryRun;
    return mappedArgs;
  },

  /**
   * @param {Record<string, any>} options
   * @returns {MediumClient}
   */
  createClient(options) {
    return options.client || new MediumClient(/** @type {any} */ ({
      baseUrl: options.baseUrl || 'https://medium.com',
      userAgent: options.userAgent,
      transport: options.transport,
      proxy: options.proxy,
      proxyPool: options.proxyPool,
      proxyProvider: options.proxyProvider,
      governor: options.governor,
      responseValidator: options.responseValidator,
      requiresProxy: options.requiresProxy,
      timeout: options.timeout,
      requiresResidential: options.requiresResidential !== false,
    }));
  },

  /**
   * @param {{ client: MediumClient, store: any, options: Record<string, any>, ctx: Record<string, any> }} deps
   * @returns {MediumCrawler}
   */
  createCrawler({ client, store, options }) {
    return new MediumCrawler({
      client,
      store,
      redisPublisher: options.redisPublisher,
      proxyPool: options.proxyPool,
      governor: options.governor,
      accountPool: options.accountPool,
      sessionManager: options.sessionManager,
      requiresProxy: options.requiresProxy,
    });
  },

  /**
   * @param {Record<string, any>} options
   * @returns {Record<string, any>}
   */
  createSession(options) {
    return options.session || {};
  },
};
