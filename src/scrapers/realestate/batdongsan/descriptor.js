// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Batdongsan.com.vn Real Estate scrape() descriptor (Story 25.1).
 * Verbatim extraction of the batdongsan block from the unified dispatcher (Story 17.2).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { BatdongsanCrawler } from './crawler.js';
import { BatdongsanClient } from './client.js';
import { actionNotAvailable } from '../../platforms.js';

/** @type {Record<string, string>} */
const BDS_ACTION_MAP = {
  search_listings: 'search_listings',
  search: 'search_listings',
  listings: 'search_listings',
  listing_detail: 'listing_detail',
  listing: 'listing_detail',
  detail: 'listing_detail',
};

export default {
  aliases: ['batdongsan', 'bds'],

  /**
   * @param {Record<string, any>} options
   * @param {Record<string, any>} ctx
   * @returns {string}
   */
  mapAction(options, ctx) {
    const mappedAction = BDS_ACTION_MAP[ctx.action];
    if (!mappedAction) {
      const available = [...new Set(Object.values(BDS_ACTION_MAP))];
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
    const mappedArgs = { ...options };
    if (options.productId || options.id) {
      mappedArgs.productId = options.productId || options.id;
    }
    if (options.city) mappedArgs.city = options.city;
    if (options.category) mappedArgs.category = options.category;
    if (options.cate != null) mappedArgs.cate = options.cate;
    if (options.listingType) mappedArgs.listingType = options.listingType;
    if (options.ptype != null) mappedArgs.ptype = options.ptype;
    if (options.minPrice != null) mappedArgs.minPrice = options.minPrice;
    if (options.maxPrice != null) mappedArgs.maxPrice = options.maxPrice;
    if (Number.isFinite(options.limit)) mappedArgs.limit = options.limit;
    if (Number.isFinite(options.page)) mappedArgs.page = options.page;
    return mappedArgs;
  },

  /**
   * @param {Record<string, any>} options
   * @returns {BatdongsanClient}
   */
  createClient(options) {
    return new BatdongsanClient({
      baseUrl: options.baseUrl,
      proxy: options.proxy,
      proxyPool: options.proxyPool,
      proxyProvider: options.proxyProvider,
      governor: options.governor,
      responseValidator: options.responseValidator,
      requiresProxy: options.requiresProxy,
      timeout: options.timeout,
    });
  },

  /**
   * @param {{ client: any, store: any, BatdongsanClient, options: Record<string, any>, ctx: Record<string, any> }} deps
   * @returns {BatdongsanCrawler}
   */
  createCrawler({ client, store, options }) {
    return new BatdongsanCrawler({
      client,
      store,
      redisPublisher: options.redisPublisher,
      proxyPool: options.proxyPool,
      governor: options.governor,
      requiresProxy: options.requiresProxy,
    });
  },
};
