// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * PumpFun scrape() descriptor (Story 20.5 / 25.1 descriptor contract).
 * Wires the pumpfun module into the unified `scrape(platform, action, options)`
 * dispatcher via aliases + actionMap + mapArgs + client/crawler factories.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { PumpFunCrawler } from './crawler.js';
import { PumpFunClient } from './client.js';

/** @type {Record<string, string>} */
const PUMPFUN_ACTION_MAP = {
  fetch_mint_social: 'fetch_mint_social',
  mint_social: 'fetch_mint_social',
  social: 'fetch_mint_social',
  mint: 'fetch_mint_social',
  resolve_user_wallet: 'resolve_user_wallet',
  user_wallet: 'resolve_user_wallet',
  resolve_user: 'resolve_user_wallet',
  user: 'resolve_user_wallet',
  fetch_platform_feed: 'fetch_platform_feed',
  platform_feed: 'fetch_platform_feed',
  feed: 'fetch_platform_feed',
  coins: 'fetch_platform_feed',
  stream_mint_chat: 'stream_mint_chat',
  stream_chat: 'stream_mint_chat',
  chat_stream: 'stream_mint_chat',
  fetch_my_profile: 'fetch_my_profile',
  my_profile: 'fetch_my_profile',
  fetch_user_following: 'fetch_user_following',
  user_following: 'fetch_user_following',
  fetch_livestream_clips: 'fetch_livestream_clips',
  livestream_clips: 'fetch_livestream_clips',
  clips: 'fetch_livestream_clips',
  post_mint_reply: 'post_mint_reply',
  post_reply: 'post_mint_reply',
  comment: 'post_mint_reply',
};

export default {
  aliases: ['pumpfun', 'pump', 'pump.fun'],

  actionMap: PUMPFUN_ACTION_MAP,

  /**
   * Story 50.2 — sync-lane manifest. `fetch_coin_meta` is the lightweight
   * metadata read (lands in Story 50.6 — inert until the crawler action
   * exists); everything else (mint social, streams, writes) is async-only.
   */
  syncCapableActions: ['fetch_coin_meta'],

  /**
   * @param {Record<string, any>} options
   * @returns {Record<string, any>}
   */
  mapArgs(options) {
    /** @type {Record<string, any>} */
    const mappedArgs = { ...options };
    // mintAddress | mint | address | token | tokenAddress → mintAddress
    const mint =
      options.mintAddress ||
      options.mint ||
      options.address ||
      options.token ||
      options.tokenAddress;
    if (mint != null) mappedArgs.mintAddress = String(mint);
    if (options.limit != null) mappedArgs.limit = Number(options.limit);
    if (options.offset != null) mappedArgs.offset = Number(options.offset);
    if (options.username || options.user) mappedArgs.username = String(options.username || options.user);
    if (options.feedType || options.feed) mappedArgs.feedType = String(options.feedType || options.feed);
    if (options.durationMs != null) mappedArgs.durationMs = Number(options.durationMs);
    // Story 20.7 args
    if (options.userId) mappedArgs.userId = String(options.userId);
    if (options.mintOrWallet) mappedArgs.mintOrWallet = String(options.mintOrWallet);
    if (options.text) mappedArgs.text = String(options.text);
    if (options.replyToId) mappedArgs.replyToId = String(options.replyToId);
    if (options.mediaUrl) mappedArgs.mediaUrl = String(options.mediaUrl);
    return mappedArgs;
  },

  /**
   * @param {Record<string, any>} options
   * @returns {PumpFunClient}
   */
  createClient(options) {
    return options.client instanceof PumpFunClient
      ? options.client
      : new PumpFunClient(/** @type {any} */ ({
          baseUrl: options.baseUrl || options.apiBaseUrl,
          proxy: options.proxy,
          proxyPool: options.proxyPool,
          proxyProvider: options.proxyProvider,
          governor: options.governor,
          accountPool: options.accountPool,
          transport: options.transport || options.pumpfunTransport,
          timeout: options.timeout,
          dedupWindowMs: options.dedupWindowMs,
        }));
  },

  /**
   * @param {{ client: PumpFunClient, store: any, options: Record<string, any>, ctx: Record<string, any> }} deps
   * @returns {PumpFunCrawler}
   */
  createCrawler({ client, store, options }) {
    return new PumpFunCrawler(/** @type {any} */ ({
      client,
      store,
      proxyPool: options.proxyPool,
      governor: options.governor,
      accountPool: options.accountPool,
      sessionManager: options.sessionManager,
      redisPublisher: options.redisPublisher,
      redis: options.redis,
      fetchFn: options.fetchFn,
      kolResolver: options.kolResolver,
      livestreamPoller: options.livestreamPoller,
      startLivestreamPoller: options.startLivestreamPoller,
      livestreamIntervalMs: options.livestreamIntervalMs,
      dedupWindowMs: options.dedupWindowMs,
      requiresAuth: options.requiresAuth,
    }));
  },
};
