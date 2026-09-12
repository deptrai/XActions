// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * LinkedIn Recruitment & B2B Leads scrape() descriptor (Story 25.1).
 * Verbatim extraction of the linkedin block from the unified dispatcher (Story 18.3).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { LinkedInCrawler } from './crawler.js';
import { LinkedInClient } from './client.js';
import { actionNotAvailable } from '../../platforms.js';

/** @type {Record<string, string>} */
const LINKEDIN_ACTION_MAP = {
  search_jobs: 'search_jobs',
  search: 'search_jobs',
  jobs: 'search_jobs',
  job_detail: 'job_detail',
  job: 'job_detail',
  detail: 'job_detail',
  company_profile: 'company_profile',
  company: 'company_profile',
  brand: 'company_profile',
  lead_profile: 'lead_profile',
  lead: 'lead_profile',
  profile: 'lead_profile',
};

export default {
  aliases: ['linkedin'],

  /**
   * @param {Record<string, any>} options
   * @param {Record<string, any>} ctx
   * @returns {string}
   */
  mapAction(options, ctx) {
    const mappedAction = LINKEDIN_ACTION_MAP[ctx.action];
    if (!mappedAction) {
      const available = [...new Set(Object.values(LINKEDIN_ACTION_MAP))];
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
    if (options.keyword || options.query || options.q || options.target) {
      mappedArgs.keyword = options.keyword || options.query || options.q || options.target;
    }
    if (options.jobId || options.id) {
      mappedArgs.jobId = options.jobId || options.id;
    }
    if (options.jobUrl || options.url) {
      mappedArgs.jobUrl = options.jobUrl || options.url;
    }
    if (options.companySlug || options.slug) {
      mappedArgs.companySlug = options.companySlug || options.slug;
    }
    if (options.companyUrl) {
      mappedArgs.companyUrl = options.companyUrl;
    }
    if (options.profileUrl || options.url) {
      mappedArgs.profileUrl = options.profileUrl || options.url;
    }
    if (options.profileSlug) {
      mappedArgs.profileSlug = options.profileSlug;
    }
    if (options.location) mappedArgs.location = options.location;
    if (options.cdpPort != null) mappedArgs.cdpPort = options.cdpPort;
    if (Number.isFinite(options.start)) mappedArgs.start = options.start;
    if (Number.isFinite(options.limit)) mappedArgs.limit = options.limit;
    return mappedArgs;
  },

  /**
   * @param {Record<string, any>} options
   * @returns {LinkedInClient}
   */
  createClient(options) {
    return new LinkedInClient({
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
   * @param {{ client: any, store: any, LinkedInClient, options: Record<string, any>, ctx: Record<string, any> }} deps
   * @returns {LinkedInCrawler}
   */
  createCrawler({ client, store, options }) {
    return new LinkedInCrawler({
      client,
      store,
      redisPublisher: options.redisPublisher,
      proxyPool: options.proxyPool,
      governor: options.governor,
      requiresProxy: options.requiresProxy,
    });
  },
};
