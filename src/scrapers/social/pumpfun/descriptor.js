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
};

export default {
  aliases: ['pumpfun', 'pump', 'pump.fun'],

  actionMap: PUMPFUN_ACTION_MAP,

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
