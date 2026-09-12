// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TikTok Shop scrape() descriptor (Story 25.1).
 * Verbatim extraction of the tiktokshop block from the unified dispatcher (Story 16.2).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { TikTokShopCrawler } from './crawler.js';
import { TikTokShopClient } from './client.js';
import { actionNotAvailable } from '../../platforms.js';

/** @type {Record<string, string>} */
const TIKTOK_SHOP_ACTION_MAP = {
  top_products: 'top_products',
  'top-products': 'top_products',
  topProducts: 'top_products',
  topproducts: 'top_products',
  top: 'top_products',
  best_sellers: 'top_products',
  'best-sellers': 'top_products',
  bestSellers: 'top_products',
  bestsellers: 'top_products',
  product_detail: 'product_detail',
  'product-detail': 'product_detail',
  productDetail: 'product_detail',
  productdetail: 'product_detail',
  product: 'product_detail',
  item: 'product_detail',
  detail: 'product_detail',
  search_products: 'search_products',
  'search-products': 'search_products',
  searchProducts: 'search_products',
  searchproducts: 'search_products',
  search: 'search_products',
  products: 'search_products',
};

export default {
  aliases: ['tiktokshop', 'tiktok_shop'],

  /**
   * @param {Record<string, any>} options
   * @param {Record<string, any>} ctx
   * @returns {string}
   */
  mapAction(options, ctx) {
    const mappedAction = TIKTOK_SHOP_ACTION_MAP[ctx.action];
    if (!mappedAction) {
      const available = [...new Set(Object.values(TIKTOK_SHOP_ACTION_MAP))];
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
    if (options.productId || options.productid || options.id) {
      mappedArgs.productId = options.productId || options.productid || options.id;
    }
    if (options.category) mappedArgs.category = options.category;
    if (options.limit != null) {
      const limit = Number(options.limit);
      if (Number.isFinite(limit)) mappedArgs.limit = limit;
    }
    if (options.page != null) {
      const page = Number(options.page);
      if (Number.isFinite(page)) mappedArgs.page = page;
    }
    if (options.offset != null) {
      const offset = Number(options.offset);
      if (Number.isFinite(offset)) mappedArgs.offset = offset;
    }
    if (options.sortBy) mappedArgs.sortBy = options.sortBy;
    if (options.resume !== undefined) mappedArgs.resume = options.resume;
    if (options.dryRun !== undefined) mappedArgs.dryRun = options.dryRun;
    if (options.cursor !== undefined) mappedArgs.cursor = options.cursor;
    return mappedArgs;
  },

  /**
   * @param {Record<string, any>} options
   * @returns {TikTokShopClient}
   */
  createClient(options) {
    return new TikTokShopClient({
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
   * @param {{ client: TikTokShopClient, store: any, options: Record<string, any>, ctx: Record<string, any> }} deps
   * @returns {TikTokShopCrawler}
   */
  createCrawler({ client, store, options }) {
    return new TikTokShopCrawler({
      client,
      store,
      redisPublisher: options.redisPublisher,
      proxyPool: options.proxyPool,
      governor: options.governor,
      requiresProxy: options.requiresProxy,
    });
  },
};
