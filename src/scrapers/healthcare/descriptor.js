// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Healthcare & Clinics Network scrape() descriptor (Story 25.1).
 * Verbatim extraction of the healthcare block from the unified dispatcher.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { HealthcareCrawler } from './crawler.js';
import { HealthcareClient } from './client.js';
import { actionNotAvailable } from '../platforms.js';

/** @type {Record<string, string>} */
const HEALTHCARE_ACTION_MAP = {
  search_clinics: 'search_clinics',
  clinics: 'search_clinics',
  search: 'search_clinics',
  search_doctors: 'search_clinics',
  doctors: 'search_clinics',
  get_stores: 'get_stores',
  stores: 'get_stores',
  pharmacies: 'get_stores',
  pharmacy_catalog: 'pharmacy_catalog',
  catalog: 'pharmacy_catalog',
  detail: 'detail',
  facility_detail: 'detail',
  doctor_detail: 'detail',
  doctor: 'detail',
};

export default {
  aliases: ['healthcare', 'medpro', 'youmed', 'nhathuoclongchau', 'thuocsi'],

  /**
   * @param {Record<string, any>} options
   * @param {Record<string, any>} ctx
   * @returns {string}
   */
  mapAction(options, ctx) {
    const mappedAction = HEALTHCARE_ACTION_MAP[ctx.action];
    if (!mappedAction) {
      const available = [...new Set(Object.values(HEALTHCARE_ACTION_MAP))];
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
    if (options.specialty) mappedArgs.specialty = options.specialty;
    if (options.page != null) mappedArgs.page = Number(options.page);
    if (options.limit != null) mappedArgs.limit = Number(options.limit);
    if (options.id) mappedArgs.id = options.id;
    if (options.slug) mappedArgs.slug = options.slug;
    if (options.category) mappedArgs.category = options.category;
    if (platformName !== 'healthcare') mappedArgs.platform = platformName;
    return mappedArgs;
  },

  /**
   * @param {Record<string, any>} options
   * @param {Record<string, any>} ctx
   * @returns {HealthcareClient}
   */
  createClient(options, ctx) {
    const platformName = ctx.platformName;
    return new HealthcareClient({
      targetPlatform: options.targetPlatform || (platformName === 'healthcare' ? 'medpro' : platformName),
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
   * @param {{ client: HealthcareClient, store: any, options: Record<string, any>, ctx: Record<string, any> }} deps
   * @returns {HealthcareCrawler}
   */
  createCrawler({ client, store, options }) {
    return new HealthcareCrawler({
      client,
      store,
      publisher: options.publisher || options.eventPublisher,
      proxyPool: options.proxyPool,
      governor: options.governor,
      requiresProxy: options.requiresProxy,
    });
  },
};
