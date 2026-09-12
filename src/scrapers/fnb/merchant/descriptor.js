// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * F&B Merchant scrape() descriptor (Story 25.1).
 * Verbatim extraction of the fnb block from the unified dispatcher.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { FnbMerchantCrawler } from './crawler.js';
import { FnbMerchantClient } from './client.js';
import { actionNotAvailable } from '../../platforms.js';

/** @type {Record<string, string>} */
const FNB_ACTION_MAP = {
  search_restaurants: 'search_restaurants',
  newly_opened: 'newly_opened',
  search_by_district: 'search_by_district',
  detail: 'detail',
  restaurant_detail: 'detail',
  restaurant: 'detail',
  search: 'search_restaurants',
};

export default {
  aliases: ['fnb', 'pasgo', 'foody', 'riviu'],

  /**
   * @param {Record<string, any>} options
   * @param {Record<string, any>} ctx
   * @returns {string}
   */
  mapAction(options, ctx) {
    const mappedAction = FNB_ACTION_MAP[ctx.action];
    if (!mappedAction) {
      const available = [...new Set(Object.values(FNB_ACTION_MAP))];
      throw actionNotAvailable(ctx.platform, ctx.action, available);
    }
    return mappedAction;
  },

  /**
   * @param {Record<string, any>} options
   * @param {Record<string, any>} ctx
   * @returns {Record<string, any>}
   */
  mapArgs(options, ctx) {
    const platformName = ctx.platformName;
    /** @type {Record<string, any>} */
    const mappedArgs = { ...options };
    if (options.platform) mappedArgs.platform = options.platform;
    if (options.city) mappedArgs.city = options.city;
    if (options.district) mappedArgs.district = options.district;
    if (options.days != null) mappedArgs.days = Number(options.days);
    if (options.page != null) mappedArgs.page = Number(options.page);
    if (options.limit != null) mappedArgs.limit = Number(options.limit);
    if (options.id) mappedArgs.id = options.id;
    if (options.slug) mappedArgs.slug = options.slug;
    // If alias is a concrete platform, use it as target platform
    if (platformName !== 'fnb') mappedArgs.platform = platformName;
    return mappedArgs;
  },

  /**
   * @param {Record<string, any>} options
   * @param {Record<string, any>} ctx
   * @returns {FnbMerchantClient}
   */
  createClient(options, ctx) {
    const platformName = ctx.platformName;
    return new FnbMerchantClient({
      targetPlatform: options.targetPlatform || (platformName === 'fnb' ? 'pasgo' : platformName),
      baseUrl: options.baseUrl,
      proxy: options.proxy,
      proxyPool: options.proxyPool,
      proxyProvider: options.proxyProvider,
      governor: options.governor,
      responseValidator: options.responseValidator,
      requiresProxy: options.requiresProxy,
      timeout: options.timeout,
      userAgent: options.userAgent,
    });
  },

  /**
   * @param {{ client: FnbMerchantClient, store: any, options: Record<string, any>, ctx: Record<string, any> }} deps
   * @returns {FnbMerchantCrawler}
   */
  createCrawler({ client, store, options }) {
    return new FnbMerchantCrawler({
      client,
      store,
      publisher: options.publisher || options.eventPublisher,
      proxyPool: options.proxyPool,
      governor: options.governor,
      requiresProxy: options.requiresProxy,
    });
  },
};
