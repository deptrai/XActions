// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Automotive Vehicles Market scrape() descriptor (Story 25.1).
 * Verbatim extraction of the automotive block from the unified dispatcher (Story 21.2).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AutomotiveCrawler } from './crawler.js';
import { AutomotiveClient } from './client.js';
import { actionNotAvailable } from '../../platforms.js';

/** @type {Record<string, string>} */
const AUTOMOTIVE_ACTION_MAP = {
  search: 'search',
  list: 'list',
  detail: 'detail',
  vehicle_detail: 'detail',
};

export default {
  aliases: ['automotive', 'oto_vn', 'bonbanh', 'chotot_xe'],

  /**
   * @param {Record<string, any>} options
   * @param {Record<string, any>} ctx
   * @returns {string}
   */
  mapAction(options, ctx) {
    const mappedAction = AUTOMOTIVE_ACTION_MAP[ctx.action];
    if (!mappedAction) {
      const available = [...new Set(Object.values(AUTOMOTIVE_ACTION_MAP))];
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
    if (options.platform) mappedArgs.platform = options.platform;
    if (options.brand) mappedArgs.brand = options.brand;
    if (options.model) mappedArgs.model = options.model;
    if (options.city) mappedArgs.city = options.city;
    if (options.yearMin != null) mappedArgs.yearMin = Number(options.yearMin);
    if (options.yearMax != null) mappedArgs.yearMax = Number(options.yearMax);
    if (options.priceMin != null) mappedArgs.priceMin = Number(options.priceMin);
    if (options.priceMax != null) mappedArgs.priceMax = Number(options.priceMax);
    if (options.page != null) mappedArgs.page = Number(options.page);
    if (options.limit != null) mappedArgs.limit = Number(options.limit);
    if (options.id) mappedArgs.id = options.id;
    if (options.slug) mappedArgs.slug = options.slug;
    return mappedArgs;
  },

  /**
   * @param {Record<string, any>} options
   * @param {Record<string, any>} ctx
   * @returns {AutomotiveClient}
   */
  createClient(options, ctx) {
    return new AutomotiveClient({
      targetPlatform: options.targetPlatform || ctx.platformName,
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
   * @param {{ client: AutomotiveClient, store: any, options: Record<string, any>, ctx: Record<string, any> }} deps
   * @returns {AutomotiveCrawler}
   */
  createCrawler({ client, store, options }) {
    return new AutomotiveCrawler({
      client,
      store,
      publisher: options.publisher || options.eventPublisher,
      proxyPool: options.proxyPool,
      governor: options.governor,
      requiresProxy: options.requiresProxy,
    });
  },
};
