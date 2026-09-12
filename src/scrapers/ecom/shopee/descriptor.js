// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Shopee scrape() descriptor (Story 25.1).
 * Verbatim extraction of the shopee block from the unified dispatcher (Story 16.1).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { ShopeeCrawler } from './crawler.js';
import { ShopeeClient } from './client.js';
import { actionNotAvailable } from '../../platforms.js';

/** @type {Record<string, string>} */
const SHOPEE_ACTION_MAP = {
  search_products: 'search_products',
  search: 'search_products',
  products: 'search_products',
  product_detail: 'product_detail',
  product: 'product_detail',
  item: 'product_detail',
  detail: 'product_detail',
  product_reviews: 'product_reviews',
  reviews: 'product_reviews',
  ratings: 'product_reviews',
};

export default {
  aliases: ['shopee'],

  /**
   * @param {Record<string, any>} options
   * @param {Record<string, any>} ctx
   * @returns {string}
   */
  mapAction(options, ctx) {
    const mappedAction = SHOPEE_ACTION_MAP[ctx.action];
    if (!mappedAction) {
      const available = [...new Set(Object.values(SHOPEE_ACTION_MAP))];
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
    if (options.keyword || options.query || options.q || options.target) {
      mappedArgs.keyword = options.keyword || options.query || options.q || options.target;
    }
    if (options.itemId || options.itemid || options.id) {
      mappedArgs.itemId = options.itemId || options.itemid || options.id;
    }
    if (options.shopId || options.shopid) {
      mappedArgs.shopId = options.shopId || options.shopid;
    }
    if (options.limit != null) mappedArgs.limit = Number(options.limit);
    if (options.page != null) mappedArgs.page = Number(options.page);
    if (options.offset != null) mappedArgs.offset = Number(options.offset);
    if (options.sortBy) mappedArgs.sortBy = options.sortBy;
    if (options.category) mappedArgs.category = options.category;
    if (options.filterRating != null) mappedArgs.filterRating = options.filterRating;
    if (options.resume !== undefined) mappedArgs.resume = options.resume;
    if (options.dryRun !== undefined) mappedArgs.dryRun = options.dryRun;
    if (options.cursor !== undefined) mappedArgs.cursor = options.cursor;
    return mappedArgs;
  },

  /**
   * @param {Record<string, any>} options
   * @returns {ShopeeClient}
   */
  createClient(options) {
    return new ShopeeClient({
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
   * @param {{ client: ShopeeClient, store: any, options: Record<string, any>, ctx: Record<string, any> }} deps
   * @returns {ShopeeCrawler}
   */
  createCrawler({ client, store, options }) {
    return new ShopeeCrawler({
      client,
      store,
      redisPublisher: options.redisPublisher,
      proxyPool: options.proxyPool,
      governor: options.governor,
      requiresProxy: options.requiresProxy,
    });
  },
};
