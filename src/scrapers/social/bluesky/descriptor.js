// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Bluesky scrape() descriptor (Story 25.1).
 * Verbatim extraction of the bluesky block from the unified dispatcher (Story 23.2).
 * Dispatches to BlueskyCrawler / BlueskyClient (AT Protocol / XRPC).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { BlueskyCrawler } from './crawler.js';
import { BlueskyClient } from './client.js';
import { actionNotAvailable } from '../../platforms.js';

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

export default {
  aliases: ['bluesky', 'bsky'],

  /**
   * @param {Record<string, any>} options
   * @param {Record<string, any>} ctx
   * @returns {string}
   */
  mapAction(options, ctx) {
    const action = ctx.action;
    // If options has feedUri or feed, action 'feed' maps to custom algorithm feed
    let mappedAction = BLUESKY_ACTION_MAP[action];
    if (action === 'feed' && (options.feedUri || options.feed || options.uri)) {
      mappedAction = 'feed';
    }

    if (!mappedAction) {
      const available = [...new Set(Object.values(BLUESKY_ACTION_MAP))];
      throw actionNotAvailable(ctx.platform, ctx.action, available);
    }
    return mappedAction;
  },

  /**
   * @param {Record<string, any>} options
   * @param {Record<string, any>} ctx
   * @returns {Record<string, any>}
   */
  mapArgs(options, ctx) {
    const mappedAction = ctx.mappedAction;
    const username = options.username || options.handle || options.actor || options.target;
    const query = options.query || options.q || options.keyword || options.target;
    const feedUri = options.feedUri || options.feed || options.uri || options.target;

    /** @type {Record<string, any>} */
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
    ctx.identifier = identifier;
    ctx.password = password;
    return mappedArgs;
  },

  /**
   * @param {Record<string, any>} options
   * @param {Record<string, any>} ctx
   * @returns {BlueskyClient}
   */
  createClient(options, ctx) {
    return new BlueskyClient(/** @type {any} */ ({
      baseUrl: options.baseUrl || options.service,
      service: options.service || options.baseUrl,
      identifier: ctx.identifier,
      password: ctx.password,
      proxy: options.proxy,
      proxyPool: options.proxyPool,
      proxyProvider: options.proxyProvider,
      governor: options.governor,
      responseValidator: options.responseValidator,
      requiresProxy: options.requiresProxy,
      timeout: options.timeout,
    }));
  },

  /**
   * @param {{ client: BlueskyClient, store: any, options: Record<string, any>, ctx: Record<string, any> }} deps
   * @returns {BlueskyCrawler}
   */
  createCrawler({ client, store, options }) {
    return new BlueskyCrawler({
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
   * @param {Record<string, any>} ctx
   * @returns {Record<string, any>}
   */
  createSession(options, ctx) {
    return {
      ...(options.session || {}),
      ...(ctx.identifier ? { identifier: ctx.identifier } : {}),
      ...(ctx.password ? { password: ctx.password } : {}),
    };
  },
};
