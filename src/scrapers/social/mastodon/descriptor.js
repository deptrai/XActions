// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Mastodon scrape() descriptor (Story 25.1).
 * Verbatim extraction of the mastodon block from the unified dispatcher (Story 23.6).
 * Dispatches to MastodonCrawler / MastodonClient (Federated REST API).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { MastodonCrawler } from './crawler.js';
import { MastodonClient } from './client.js';
import { resolveMastodonTarget, normalizeInstanceUrl } from './normalizer.js';
import { actionNotAvailable } from '../../platforms.js';

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

export default {
  aliases: ['mastodon', 'masto'],

  /**
   * @param {Record<string, any>} options
   * @param {Record<string, any>} ctx
   * @returns {string}
   */
  mapAction(options, ctx) {
    const action = ctx.action;
    const normalizedAction = typeof action === 'string' ? action.toLowerCase().trim() : action;
    const mappedAction = MASTODON_ACTION_MAP[normalizedAction];

    if (!mappedAction) {
      const available = [...new Set(Object.values(MASTODON_ACTION_MAP))];
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
    ctx.instance = instance;
    ctx.accessToken = accessToken;

    /** @type {Record<string, any>} */
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
    return mappedArgs;
  },

  /**
   * @param {Record<string, any>} options
   * @param {Record<string, any>} ctx
   * @returns {MastodonClient}
   */
  createClient(options, ctx) {
    return options.client || new MastodonClient(/** @type {any} */ ({
      baseUrl: ctx.instance,
      instance: ctx.instance,
      accessToken: ctx.accessToken,
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
   * @param {{ client: MastodonClient, store: any, options: Record<string, any>, ctx: Record<string, any> }} deps
   * @returns {MastodonCrawler}
   */
  createCrawler({ client, store, options }) {
    return new MastodonCrawler({
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
      ...(ctx.accessToken ? { accessToken: ctx.accessToken } : {}),
    };
  },
};
