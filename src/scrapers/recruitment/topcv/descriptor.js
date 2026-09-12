// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TopCV Recruitment scrape() descriptor (Story 25.1).
 * Verbatim extraction of the topcv block from the unified dispatcher (Story 18.1).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { TopCvCrawler } from './crawler.js';
import { TopCvClient } from './client.js';
import { actionNotAvailable } from '../../platforms.js';

/** @type {Record<string, string>} */
const TOPCV_ACTION_MAP = {
  search_jobs: 'search_jobs',
  search: 'search_jobs',
  jobs: 'search_jobs',
  job_detail: 'job_detail',
  job: 'job_detail',
  detail: 'job_detail',
  company_detail: 'company_detail',
  company: 'company_detail',
  brand: 'company_detail',
};

export default {
  aliases: ['topcv', 'top_cv'],

  /**
   * @param {Record<string, any>} options
   * @param {Record<string, any>} ctx
   * @returns {string}
   */
  mapAction(options, ctx) {
    const mappedAction = TOPCV_ACTION_MAP[ctx.action];
    if (!mappedAction) {
      const available = [...new Set(Object.values(TOPCV_ACTION_MAP))];
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
    if (options.jobId || options.id) {
      mappedArgs.jobId = options.jobId || options.id;
    }
    if (options.jobUrl || options.url) {
      mappedArgs.jobUrl = options.jobUrl || options.url;
    }
    if (options.companyId) {
      mappedArgs.companyId = options.companyId;
    }
    if (options.companyUrl) {
      mappedArgs.companyUrl = options.companyUrl;
    }
    if (options.city) mappedArgs.city = options.city;
    if (options.salary) mappedArgs.salary = options.salary;
    if (options.exp) mappedArgs.exp = options.exp;
    if (Number.isFinite(options.limit)) mappedArgs.limit = options.limit;
    if (Number.isFinite(options.page)) mappedArgs.page = options.page;
    if (options.category) mappedArgs.category = options.category;
    if (options.resume !== undefined) mappedArgs.resume = options.resume;
    if (options.dryRun !== undefined) mappedArgs.dryRun = options.dryRun;
    if (options.cursor !== undefined) mappedArgs.cursor = options.cursor;
    return mappedArgs;
  },

  /**
   * @param {Record<string, any>} options
   * @returns {TopCvClient}
   */
  createClient(options) {
    return new TopCvClient({
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
   * @param {{ client: TopCvClient, store: any, options: Record<string, any>, ctx: Record<string, any> }} deps
   * @returns {TopCvCrawler}
   */
  createCrawler({ client, store, options }) {
    return new TopCvCrawler({
      client,
      store,
      redisPublisher: options.redisPublisher,
      proxyPool: options.proxyPool,
      governor: options.governor,
      requiresProxy: options.requiresProxy,
    });
  },
};
