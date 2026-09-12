// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Zalo Official Account scrape() descriptor (Story 25.1).
 * Verbatim extraction of the zalo block from the unified dispatcher (Story 33.1).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { ZaloCrawler } from './crawler.js';
import { ZaloClient } from './client.js';

/** @type {Record<string, string>} */
const ZALO_ACTION_MAP = {
  oa_posts: 'oa_posts',
  posts: 'oa_posts',
  articles: 'oa_posts',
  feed: 'oa_posts',
  oa_followers: 'oa_followers',
  followers: 'oa_followers',
  oa_detail: 'oa_detail',
  oa_info: 'oa_detail',
  detail: 'oa_detail',
  profile: 'oa_detail',
  info: 'oa_detail',
  marketplace_products: 'marketplace_products',
  marketplace_search: 'marketplace_products',
  products: 'marketplace_products',
  marketplace: 'marketplace_products',
};

export default {
  aliases: ['zalo', 'zalo_oa', 'zalo_official_account'],

  actionMap: ZALO_ACTION_MAP,

  /**
   * @param {Record<string, any>} options
   * @returns {Record<string, any>}
   */
  mapArgs(options) {
    /** @type {Record<string, any>} */
    const mappedArgs = { ...options };
    if (options.limit != null) mappedArgs.limit = Number(options.limit);
    if (options.offset != null) mappedArgs.offset = Number(options.offset);
    if (options.count != null) mappedArgs.count = Number(options.count);
    if (options.oaId) mappedArgs.oaId = options.oaId;
    if (options.id) mappedArgs.oaId = options.id;
    if (options.accessToken || options.token) mappedArgs.accessToken = options.accessToken || options.token;
    return mappedArgs;
  },

  /**
   * @param {Record<string, any>} options
   * @returns {ZaloClient}
   */
  createClient(options) {
    return new ZaloClient(/** @type {any} */ ({
      baseUrl: options.baseUrl,
      accessToken: options.accessToken || options.token,
      proxy: options.proxy,
      proxyPool: options.proxyPool,
      governor: options.governor,
      responseValidator: options.responseValidator,
      requiresAuth: options.requiresAuth,
      requiresProxy: options.requiresProxy,
      timeout: options.timeout,
    }));
  },

  /**
   * @param {{ client: ZaloClient, store: any, options: Record<string, any>, ctx: Record<string, any> }} deps
   * @returns {ZaloCrawler}
   */
  createCrawler({ client, store, options }) {
    return new ZaloCrawler({
      client,
      store,
      publisher: options.publisher || options.eventPublisher,
      accountPool: options.accountPool,
      governor: options.governor,
      requiresAuth: options.requiresAuth,
      requiresProxy: options.requiresProxy,
    });
  },

  /**
   * @param {Record<string, any>} options
   * @returns {Record<string, any>}
   */
  createSession(options) {
    return {
      ...(options.session || {}),
      accountId: options.accountId || options.session?.accountId || (options.accessToken || options.token ? 'zalo:oa:default' : undefined),
    };
  },
};
