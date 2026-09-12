// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Chợ Tốt Real Estate & Multi-Category scrape() descriptor (Story 25.1).
 * Verbatim extraction of the chotot block from the unified dispatcher (Story 17.1).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { ChototCrawler } from './crawler.js';
import { ChototClient } from './client.js';
import { actionNotAvailable } from '../../platforms.js';

/** @type {Record<string, string>} */
const CHOTOT_ACTION_MAP = {
  search_listings: 'search_listings',
  search: 'search_listings',
  listings: 'search_listings',
  ads: 'search_listings',
  listing_detail: 'listing_detail',
  listing: 'listing_detail',
  detail: 'listing_detail',
  ad: 'listing_detail',
  get_phone: 'get_phone',
  phone: 'get_phone',
};

export default {
  aliases: ['chotot', 'cho_tot'],

  /**
   * @param {Record<string, any>} options
   * @param {Record<string, any>} ctx
   * @returns {string}
   */
  mapAction(options, ctx) {
    const mappedAction = CHOTOT_ACTION_MAP[ctx.action];
    if (!mappedAction) {
      const available = [...new Set(Object.values(CHOTOT_ACTION_MAP))];
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
    if (options.listId || options.id) {
      mappedArgs.listId = options.listId || options.id;
    }
    if (options.category) mappedArgs.category = options.category;
    if (options.region_v2 != null) mappedArgs.region_v2 = options.region_v2;
    if (options.area_v2 != null) mappedArgs.area_v2 = options.area_v2;
    if (options.minPrice != null) mappedArgs.minPrice = options.minPrice;
    if (options.maxPrice != null) mappedArgs.maxPrice = options.maxPrice;
    if (options.minArea != null) mappedArgs.minArea = options.minArea;
    if (options.maxArea != null) mappedArgs.maxArea = options.maxArea;
    if (options.propertyType) mappedArgs.propertyType = options.propertyType;
    if (options.listingType) mappedArgs.listingType = options.listingType;
    if (options.includePhone != null) mappedArgs.includePhone = options.includePhone;
    if (Number.isFinite(options.limit)) mappedArgs.limit = options.limit;
    if (Number.isFinite(options.page)) mappedArgs.page = options.page;
    return mappedArgs;
  },

  /**
   * @param {Record<string, any>} options
   * @returns {ChototClient}
   */
  createClient(options) {
    return new ChototClient({
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
   * @param {{ client: any, store: any, ChototClient, options: Record<string, any>, ctx: Record<string, any> }} deps
   * @returns {ChototCrawler}
   */
  createCrawler({ client, store, options }) {
    return new ChototCrawler({
      client,
      store,
      redisPublisher: options.redisPublisher,
      proxyPool: options.proxyPool,
      governor: options.governor,
      requiresProxy: options.requiresProxy,
    });
  },
};
