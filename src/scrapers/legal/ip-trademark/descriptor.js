// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * IP Legal & Trademark scrape() descriptor (Story 25.1).
 * Verbatim extraction of the ipvietnam/ip_legal/legal block from the unified dispatcher.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { IpLegalCrawler } from './crawler.js';
import { IpLegalClient } from './client.js';

/** @type {Record<string, string>} */
const IP_LEGAL_ACTION_MAP = {
  search_gazette: 'search_gazette',
  search: 'search_gazette',
  gazette: 'search_gazette',
  get_weekly_list: 'get_weekly_list',
  weekly_list: 'get_weekly_list',
  weekly: 'get_weekly_list',
  yearly_summary: 'yearly_summary',
  yearly: 'yearly_summary',
  summary: 'yearly_summary',
  detail: 'detail',
};

export default {
  aliases: ['ipvietnam', 'ip_legal', 'legal'],

  actionMap: IP_LEGAL_ACTION_MAP,

  /**
   * @param {Record<string, any>} options
   * @returns {Record<string, any>}
   */
  mapArgs(options) {
    /** @type {Record<string, any>} */
    const mappedArgs = { ...options };
    if (options.page != null) mappedArgs.page = Number(options.page);
    if (options.limit != null) mappedArgs.limit = Number(options.limit);
    if (options.id) mappedArgs.id = options.id;
    if (options.applicationNumber) mappedArgs.id = options.applicationNumber;
    if (options.articleUrl) mappedArgs.articleUrl = options.articleUrl;
    if (options.url) mappedArgs.articleUrl = options.url;
    if (options.year != null) mappedArgs.year = Number(options.year);
    return mappedArgs;
  },

  /**
   * @param {Record<string, any>} options
   * @returns {IpLegalClient}
   */
  createClient(options) {
    return new IpLegalClient({
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
   * @param {{ client: IpLegalClient, store: any, options: Record<string, any>, ctx: Record<string, any> }} deps
   * @returns {IpLegalCrawler}
   */
  createCrawler({ client, store, options }) {
    return new IpLegalCrawler({
      client,
      store,
      publisher: options.publisher || options.eventPublisher,
      proxyPool: options.proxyPool,
      governor: options.governor,
      requiresProxy: options.requiresProxy,
    });
  },
};
