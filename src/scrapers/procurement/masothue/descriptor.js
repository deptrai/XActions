// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * MaSoThue B2B Procurement scrape() descriptor (Story 25.1).
 * Verbatim extraction of the masothue block from the unified dispatcher (Story 21.1).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { MaSoThueCrawler } from './crawler.js';
import { MaSoThueClient } from './client.js';
import { actionNotAvailable } from '../../platforms.js';

/** @type {Record<string, string>} */
const MASOTHUE_ACTION_MAP = {
  search: 'search',
  search_by_province: 'search_by_province',
  searchByProvince: 'search_by_province',
  detail: 'detail',
  company_detail: 'detail',
};

export default {
  aliases: ['masothue', 'maso_thue', 'mst'],

  /**
   * @param {Record<string, any>} options
   * @param {Record<string, any>} ctx
   * @returns {string}
   */
  mapAction(options, ctx) {
    const mappedAction = MASOTHUE_ACTION_MAP[ctx.action];
    if (!mappedAction) {
      const available = [...new Set(Object.values(MASOTHUE_ACTION_MAP))];
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
    if (options.q || options.query || options.keyword || options.taxCode) {
      mappedArgs.q = options.q || options.query || options.keyword || options.taxCode;
    }
    if (options.province) mappedArgs.province = options.province;
    if (options.page != null) mappedArgs.page = Number(options.page);
    if (options.limit != null) mappedArgs.limit = Number(options.limit);
    if (options.slug) mappedArgs.slug = options.slug;
    return mappedArgs;
  },

  /**
   * @param {Record<string, any>} options
   * @returns {MaSoThueClient}
   */
  createClient(options) {
    return new MaSoThueClient({
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
   * @param {{ client: MaSoThueClient, store: any, options: Record<string, any>, ctx: Record<string, any> }} deps
   * @returns {MaSoThueCrawler}
   */
  createCrawler({ client, store, options }) {
    return new MaSoThueCrawler({
      client,
      store,
      proxyPool: options.proxyPool,
      governor: options.governor,
      requiresProxy: options.requiresProxy,
    });
  },
};
