// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Dexscreener scrape() descriptor (Story 50.7 — crypto/dexscreener platform).
 * Wires the dexscreener module into the unified `scrape(platform, action, options)`
 * dispatcher via aliases + actionMap + mapArgs + client/crawler factories.
 * All 5 actions are sub-second keyless REST reads → syncCapable.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { DexscreenerCrawler } from './crawler.js';
import { DexscreenerClient } from './client.js';

/** @type {Record<string, string>} */
const DEXSCREENER_ACTION_MAP = {
  // token_socials
  token_socials: 'token_socials',
  socials: 'token_socials',
  token_social_links: 'token_socials',
  token_links: 'token_socials',
  // token_legitimacy
  token_legitimacy: 'token_legitimacy',
  legitimacy: 'token_legitimacy',
  token_orders: 'token_legitimacy',
  orders: 'token_legitimacy',
  boosts: 'token_legitimacy',
  // token_lookup
  token_lookup: 'token_lookup',
  lookup: 'token_lookup',
  token_pairs: 'token_lookup',
  pairs: 'token_lookup',
  pair_lookup: 'token_lookup',
  // latest_boosted
  latest_boosted: 'latest_boosted',
  boosted: 'latest_boosted',
  trending_boosted: 'latest_boosted',
  trending: 'latest_boosted',
  // latest_profiles
  latest_profiles: 'latest_profiles',
  profiles: 'latest_profiles',
  new_profiles: 'latest_profiles',
  token_profiles: 'latest_profiles',
};

export default {
  aliases: ['dexscreener', 'dex', 'dexscreen'],

  actionMap: DEXSCREENER_ACTION_MAP,

  /**
   * Story 50.2 — sync-lane manifest. Every dexscreener action is a sub-second
   * keyless REST read against api.dexscreener.com → all 5 are sync-capable.
   */
  syncCapableActions: [
    'token_socials',
    'token_legitimacy',
    'token_lookup',
    'latest_boosted',
    'latest_profiles',
  ],

  /**
   * @param {Record<string, any>} options
   * @returns {Record<string, any>}
   */
  mapArgs(options) {
    /** @type {Record<string, any>} */
    const mappedArgs = { ...options };
    // chainId | chain | chain_id | network → chainId
    const chain = options.chainId || options.chain || options.chain_id || options.network;
    if (chain != null) mappedArgs.chainId = String(chain);
    // tokenAddress | token | token_address | address | mint → tokenAddress
    const token =
      options.tokenAddress ||
      options.token ||
      options.token_address ||
      options.address ||
      options.mint;
    if (token != null) mappedArgs.tokenAddress = String(token);
    if (options.limit != null) mappedArgs.limit = Number(options.limit);
    return mappedArgs;
  },

  /**
   * @param {Record<string, any>} options
   * @returns {DexscreenerClient}
   */
  createClient(options) {
    return options.client instanceof DexscreenerClient
      ? options.client
      : new DexscreenerClient(/** @type {any} */ ({
          baseUrl: options.baseUrl || options.dexscreenerBaseUrl,
          proxy: options.proxy,
          proxyPool: options.proxyPool,
          proxyProvider: options.proxyProvider,
          governor: options.governor,
          accountPool: options.accountPool,
          transport: options.transport || options.dexscreenerTransport,
          timeout: options.timeout,
          reqPerMinute: options.reqPerMinute,
        }));
  },

  /**
   * @param {{ client: DexscreenerClient, store: any, options: Record<string, any>, ctx: Record<string, any> }} deps
   * @returns {DexscreenerCrawler}
   */
  createCrawler({ client, store, options }) {
    return new DexscreenerCrawler(/** @type {any} */ ({
      client,
      store,
      proxyPool: options.proxyPool,
      governor: options.governor,
      accountPool: options.accountPool,
      sessionManager: options.sessionManager,
      fetchFn: options.fetchFn,
      requiresAuth: options.requiresAuth,
    }));
  },
};
