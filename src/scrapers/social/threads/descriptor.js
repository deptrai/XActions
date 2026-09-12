// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Threads scrape() descriptor (Story 25.1).
 * Verbatim extraction of the threads block from the unified dispatcher.
 * Threads hybrid path — no Puppeteer, dispatches to ThreadsCrawler.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { ThreadsCrawler } from './crawler.js';
import { ThreadsClient } from './client.js';
import { actionNotAvailable } from '../../platforms.js';

/** @type {Record<string, string>} */
const THREADS_ACTION_MAP = {
  profile: 'profile',
  tweets: 'get_user_feed',
  timeline: 'get_user_feed',
  feed: 'get_user_feed',
  user_feed: 'get_user_feed',
  posts: 'get_user_feed',
  post: 'post_detail',
  post_detail: 'post_detail',
  comments: 'get_post_comments',
  post_comments: 'get_post_comments',
  get_comments: 'get_post_comments',
  search: 'search',
  followers: 'followers',
  following: 'following',
};

export default {
  aliases: ['threads'],

  /**
   * @param {Record<string, any>} options
   * @param {Record<string, any>} ctx
   * @returns {string}
   */
  mapAction(options, ctx) {
    const mappedAction = THREADS_ACTION_MAP[ctx.action];
    if (!mappedAction) {
      const available = Object.values(THREADS_ACTION_MAP);
      const unique = [...new Set(available)];
      throw actionNotAvailable(ctx.platform, ctx.action, unique);
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
    const username = options.username || options.target;
    const postId = options.postId || options.url || options.target;
    const query = options.query || options.target;

    /** @type {Record<string, any>} */
    const mappedArgs = {};
    if (['profile', 'followers', 'following', 'get_user_feed', 'tweets'].includes(mappedAction) && username) {
      mappedArgs.username = username;
    }
    if (['post_detail', 'get_post_comments'].includes(mappedAction) && postId) {
      mappedArgs.postId = postId;
    }
    if (mappedAction === 'search' && query) {
      mappedArgs.query = query;
    }

    // Normalize counts/cursors
    if (options.limit != null) {
      mappedArgs.count = Number(options.limit);
    } else if (options.count != null) {
      mappedArgs.count = Number(options.count);
    }
    if (options.cursor != null) {
      mappedArgs.cursor = options.cursor;
    }
    if (options.maxDepth != null) {
      mappedArgs.maxDepth = Number(options.maxDepth);
    }
    if (options.maxComments != null) {
      mappedArgs.maxComments = Number(options.maxComments);
    }
    if (options.includeReplies != null) {
      mappedArgs.includeReplies = options.includeReplies;
    }
    if (options.searchType != null) {
      mappedArgs.searchType = options.searchType;
    }

    // Map cursor to after for post/comment actions.
    if (mappedArgs.cursor != null && ['post_detail', 'get_post_comments'].includes(mappedAction) && mappedArgs.after == null) {
      mappedArgs.after = mappedArgs.cursor;
    }
    if (options.resume !== undefined) mappedArgs.resume = options.resume;
    if (options.dryRun !== undefined) mappedArgs.dryRun = options.dryRun;
    return mappedArgs;
  },

  /**
   * @param {Record<string, any>} options
   * @returns {ThreadsClient}
   */
  createClient(options) {
    return new ThreadsClient({
      baseUrl: options.baseUrl,
      proxyPool: options.proxyPool,
      governor: options.governor,
      accountPool: options.accountPool,
      sessionManager: options.sessionManager,
    });
  },

  /**
   * @param {{ client: ThreadsClient, store: any, options: Record<string, any>, ctx: Record<string, any> }} deps
   * @returns {ThreadsCrawler}
   */
  createCrawler({ client, store, options }) {
    return new ThreadsCrawler({
      client,
      store,
      proxyPool: options.proxyPool,
      governor: options.governor,
      accountPool: options.accountPool,
      sessionManager: options.sessionManager,
      docIds: options.docIds,
    });
  },

  /**
   * @param {Record<string, any>} options
   * @returns {Record<string, any>}
   */
  createSession(options) {
    return {
      accountId: options.accountId || 'threads-guest',
      cookies: options.authCookie || options.cookies || '',
    };
  },
};
