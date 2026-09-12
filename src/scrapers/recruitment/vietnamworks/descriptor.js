// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * VietnamWorks Recruitment scrape() descriptor (Story 25.1).
 * Verbatim extraction of the vietnamworks block from the unified dispatcher (Story 18.2).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { VietnamWorksCrawler } from './crawler.js';
import { VietnamWorksClient } from './client.js';
import { actionNotAvailable } from '../../platforms.js';

/** @type {Record<string, string>} */
const VNW_ACTION_MAP = {
  search_jobs: 'search_jobs',
  search: 'search_jobs',
  jobs: 'search_jobs',
  job_detail: 'job_detail',
  job: 'job_detail',
  detail: 'job_detail',
  company_detail: 'company_detail',
  company: 'company_detail',
};

export default {
  aliases: ['vietnamworks', 'vietnam_works', 'vnw'],

  /**
   * @param {Record<string, any>} options
   * @param {Record<string, any>} ctx
   * @returns {string}
   */
  mapAction(options, ctx) {
    const mappedAction = VNW_ACTION_MAP[ctx.action];
    if (!mappedAction) {
      const available = [...new Set(Object.values(VNW_ACTION_MAP))];
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
    if (options.companyName || options.name) {
      mappedArgs.companyName = options.companyName || options.name;
    }
    if (options.city) mappedArgs.city = options.city;
    if (options.locationId != null) mappedArgs.locationId = options.locationId;
    if (options.salaryMin != null) mappedArgs.salaryMin = options.salaryMin;
    if (options.salaryMax != null) mappedArgs.salaryMax = options.salaryMax;
    if (options.exp != null) mappedArgs.exp = options.exp;
    if (options.employmentType) mappedArgs.employmentType = options.employmentType;
    if (Number.isFinite(options.limit)) mappedArgs.limit = options.limit;
    if (Number.isFinite(options.page)) mappedArgs.page = options.page;
    if (options.resume !== undefined) mappedArgs.resume = options.resume;
    if (options.dryRun !== undefined) mappedArgs.dryRun = options.dryRun;
    if (options.cursor !== undefined) mappedArgs.cursor = options.cursor;
    return mappedArgs;
  },

  /**
   * @param {Record<string, any>} options
   * @returns {VietnamWorksClient}
   */
  createClient(options) {
    return new VietnamWorksClient({
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
   * @param {{ client: any, store: any, VietnamWorksClient, options: Record<string, any>, ctx: Record<string, any> }} deps
   * @returns {VietnamWorksCrawler}
   */
  createCrawler({ client, store, options }) {
    return new VietnamWorksCrawler({
      client,
      store,
      redisPublisher: options.redisPublisher,
      proxyPool: options.proxyPool,
      governor: options.governor,
      requiresProxy: options.requiresProxy,
    });
  },
};
