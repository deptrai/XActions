// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * B2B Registry Extended scrape() descriptor (Story 25.1).
 * Verbatim extraction of the b2b_registry_extended block from the unified dispatcher (Story 21.3).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { B2BRegistryExtendedCrawler } from './index.js';
import { B2BRegistryExtendedClient } from './client.js';
import { actionNotAvailable } from '../../platforms.js';

/** @type {Record<string, string>} */
const B2B_ACTION_MAP = {
  search: 'search',
  search_tenders: 'search_tenders',
  search_tender: 'search_tenders',
  company: 'detail',
  company_detail: 'detail',
  detail: 'detail',
  tender_detail: 'detail',
};

export default {
  aliases: ['b2b_registry_extended', 'hosocongty', 'muasamcong'],

  /**
   * @param {Record<string, any>} options
   * @param {Record<string, any>} ctx
   * @returns {string}
   */
  mapAction(options, ctx) {
    const mappedAction = B2B_ACTION_MAP[ctx.action];
    if (!mappedAction) {
      const available = [...new Set(Object.values(B2B_ACTION_MAP))];
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
    const action = ctx.action;
    /** @type {Record<string, any>} */
    const mappedArgs = { ...options };
    if (options.q || options.query || options.keyword) {
      mappedArgs.q = options.q || options.query || options.keyword;
    }
    if (options.taxCode) mappedArgs.taxCode = options.taxCode;
    if (options.notifyNo || options.tenderNo) mappedArgs.notifyNo = options.notifyNo || options.tenderNo;
    if (options.id) mappedArgs.id = options.id;
    mappedArgs.platform = options.platform || (platformName === "muasamcong" || action.includes("tender") || options.notifyNo || options.tenderNo ? "muasamcong" : (platformName === "hosocongty" ? "hosocongty" : "b2b_registry_extended"));
    if (options.searchType) mappedArgs.searchType = options.searchType;
    if (options.searchScope) mappedArgs.searchScope = options.searchScope;
    if (options.searchBy) mappedArgs.searchBy = options.searchBy;
    if (options.keywordMatch) mappedArgs.keywordMatch = options.keywordMatch;
    if (options.limit != null) mappedArgs.limit = Number(options.limit);
    if (options.slug) mappedArgs.slug = options.slug;
    return mappedArgs;
  },

  /**
   * @param {Record<string, any>} options
   * @param {Record<string, any>} ctx
   * @returns {B2BRegistryExtendedClient}
   */
  createClient(options, ctx) {
    return new B2BRegistryExtendedClient({
      targetPlatform: options.targetPlatform || (ctx?.mappedArgs?.platform === "muasamcong" ? "muasamcong" : "hosocongty"),
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
   * @param {{ client: B2BRegistryExtendedClient, store: any, options: Record<string, any>, ctx: Record<string, any> }} deps
   * @returns {B2BRegistryExtendedCrawler}
   */
  createCrawler({ client, store, options }) {
    return new B2BRegistryExtendedCrawler({
      client,
      store,
      publisher: options.publisher || options.eventPublisher,
      proxyPool: options.proxyPool,
      governor: options.governor,
      requiresProxy: options.requiresProxy,
    });
  },
};
