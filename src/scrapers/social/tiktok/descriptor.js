// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TikTok scrape() descriptor (Story 25.1).
 * Verbatim extraction of the tiktok block from the unified dispatcher.
 * TikTok hybrid path — uses browser-as-signer bridge and got-scraping HTTP client.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { TikTokCrawler } from './crawler.js';
import { TikTokClient } from './client.js';
import { actionNotAvailable } from '../../platforms.js';

/** @type {Record<string, string>} */
const TIKTOK_ACTION_MAP = {
  search: 'search',
  search_videos: 'search',
  hashtag: 'hashtag_feed',
  hashtag_feed: 'hashtag_feed',
  video_detail: 'post_detail',
  post_detail: 'post_detail',
  post: 'post_detail',
  video_comments: 'get_post_comments',
  comments: 'get_post_comments',
  get_post_comments: 'get_post_comments',
};

export default {
  aliases: ['tiktok'],

  /**
   * @param {Record<string, any>} options
   * @param {Record<string, any>} ctx
   * @returns {string}
   */
  mapAction(options, ctx) {
    const mappedAction = TIKTOK_ACTION_MAP[ctx.action];
    if (!mappedAction) {
      const available = Object.values(TIKTOK_ACTION_MAP);
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
    const query = options.query || options.keyword || options.q || options.target;
    const tag = options.hashtag || options.tag || options.target;
    const videoId = options.videoId || options.postId || options.id || options.url || options.target;

    /** @type {Record<string, any>} */
    const mappedArgs = {};
    if (mappedAction === 'search' && query) {
      mappedArgs.query = query;
    }
    if (mappedAction === 'hashtag_feed' && tag) {
      mappedArgs.tag = tag;
    }
    if (['post_detail', 'get_post_comments'].includes(mappedAction) && videoId) {
      mappedArgs.videoId = videoId;
    }

    if (options.limit != null) {
      mappedArgs.count = Number(options.limit);
    } else if (options.count != null) {
      mappedArgs.count = Number(options.count);
    }
    if (options.cursor != null) {
      mappedArgs.cursor = options.cursor;
    }
    if (options.after != null) {
      mappedArgs.after = options.after;
    }
    if (options.maxDepth != null) {
      mappedArgs.maxDepth = Number(options.maxDepth);
    }
    if (options.maxComments != null) {
      mappedArgs.maxComments = Number(options.maxComments);
    }
    if (options.includeComments != null) {
      mappedArgs.includeComments = options.includeComments;
    }
    if (options.resume !== undefined) {
      mappedArgs.resume = options.resume;
    }
    if (options.dryRun !== undefined) {
      mappedArgs.dryRun = options.dryRun;
    }

    if (mappedArgs.cursor != null && ['post_detail', 'get_post_comments'].includes(mappedAction) && mappedArgs.after == null) {
      mappedArgs.after = mappedArgs.cursor;
    }
    return mappedArgs;
  },

  /**
   * @param {Record<string, any>} options
   * @returns {TikTokClient}
   */
  createClient(options) {
    return new TikTokClient(/** @type {any} */ ({
      baseUrl: options.baseUrl,
      proxy: options.proxy,
      proxyPool: options.proxyPool,
      proxyProvider: options.proxyProvider,
      governor: options.governor,
      accountPool: options.accountPool,
      sessionManager: options.sessionManager,
      responseValidator: options.responseValidator,
      tokenRing: options.tokenRing,
      guestTokenRing: options.guestTokenRing,
      signerPool: options.signerPool,
      signerBridge: options.signerBridge,
      adapterName: options.adapterName,
      deviceContext: options.deviceContext,
      clientAbVersions: options.clientAbVersions,
      deviceId: options.deviceId,
      requiresProxy: options.requiresProxy,
      requiresAuth: options.requiresAuth,
      timeout: options.timeout,
      headless: options.headless !== false,
    }));
  },

  /**
   * NOTE: `options.store !== undefined ? options.store : store` preserved verbatim —
   * `store` is the dispatcher-computed `options.store || defaultStore`, so
   * `store: null` still disables persistence for this platform.
   * @param {{ client: TikTokClient, store: any, options: Record<string, any>, ctx: Record<string, any> }} deps
   * @returns {TikTokCrawler}
   */
  createCrawler({ client, store, options }) {
    return new TikTokCrawler(/** @type {any} */ ({
      client,
      store: options.store !== undefined ? options.store : store,
      redisPublisher: options.redisPublisher,
      proxyPool: options.proxyPool,
      proxyProvider: options.proxyProvider,
      governor: options.governor,
      accountPool: options.accountPool,
      sessionManager: options.sessionManager,
      responseValidator: options.responseValidator,
      requiresProxy: options.requiresProxy,
      requiresAuth: options.requiresAuth,
      timeout: options.timeout,
    }));
  },

  /**
   * @param {Record<string, any>} options
   * @returns {Record<string, any>}
   */
  createSession(options) {
    return {
      accountId: options.accountId || 'tiktok-guest',
      cookies: options.authCookie || options.cookies || '',
    };
  },
};
