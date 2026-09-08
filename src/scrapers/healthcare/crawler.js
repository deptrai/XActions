// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Healthcare, Clinics & Pharmacy Network Crawler extending AbstractCrawler.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractCrawler } from '../../core/base-crawler.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../core/error-envelope.js';
import { HealthcareClient } from './client.js';
import { normalizeHealthcareResults } from './normalizer.js';

function extractResponseBody(response, platform, action) {
  if (!response) return '';
  const status = response.status || response.statusCode || 200;
  if (status >= 400) {
    throw new PlatformError({
      type: status === 404 ? ErrorTypes.NOT_FOUND : ErrorTypes.PLATFORM_ERROR,
      code: 'XACT_5001',
      message: `HTTP ${status} from ${platform} on action "${action}"`,
      statusCode: status,
      suggestedAction: SuggestedActions.RETRY,
      platform,
    });
  }
  return response.body || response.data || response;
}

export class HealthcareCrawler extends AbstractCrawler {
  name = 'healthcare';
  requiresAuth = false;
  platform = 'healthcare';

  /**
   * @param {Object} [deps={}]
   * @param {HealthcareClient} [deps.client]
   * @param {import('../../core/base-store.js').AbstractStore} [deps.store]
   * @param {any} [deps.publisher]
   */
  constructor(deps = {}) {
    const client = deps.client || new HealthcareClient({
      requiresProxy: deps.requiresProxy ?? false,
      proxyPool: deps.proxyPool,
      governor: deps.governor,
    });

    super({
      ...deps,
      client,
      requiresAuth: false,
    });

    this.publisher = deps.publisher || null;
    this.#registerActions();
  }

  #registerActions() {
    this.registerAction({
      action: 'search_clinics',
      description: 'Search clinics, hospitals, and medical facilities',
      inputSchema: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name or slug' },
          specialty: { type: 'string', description: 'Medical specialty' },
          platform: { type: 'string', enum: ['medpro', 'youmed'], default: 'medpro' },
        },
      },
      handler: (args) => this.searchClinics(args),
    });

    this.registerAction({
      action: 'get_stores',
      description: 'Get retail pharmacy network stores (Long Chau)',
      inputSchema: {
        type: 'object',
        properties: {
          city: { type: 'string' },
          page: { type: 'number', default: 1 },
          platform: { type: 'string', default: 'nhathuoclongchau' },
        },
      },
      handler: (args) => this.getStores(args),
    });

    this.registerAction({
      action: 'pharmacy_catalog',
      description: 'Get wholesale pharmacy catalog (Thuocsi - deferred/auth-gated)',
      inputSchema: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          platform: { type: 'string', default: 'thuocsi' },
        },
      },
      handler: (args) => this.getPharmacyCatalog(args),
    });

    this.registerAction({
      action: 'detail',
      description: 'Get detail of doctor or facility by slug/id',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          slug: { type: 'string' },
          platform: { type: 'string', enum: ['medpro', 'youmed', 'nhathuoclongchau'], default: 'medpro' },
        },
        required: ['id'],
      },
      handler: (args) => this.detail(args),
    });
  }

  async #persist(posts) {
    if (!this.store || !posts.length) return;
    for (const item of posts) {
      this.validateItem(item);
    }
    if (typeof this.store.storeBatch === 'function') {
      await this.store.storeBatch(posts);
    }
    if (this.publisher && typeof this.publisher.publishThinEvent === 'function') {
      for (const item of posts) {
        await this.publisher.publishThinEvent('post', item).catch(() => {});
      }
    }
  }

  /**
   * Search clinics and facilities.
   * @param {Record<string, any>} [args={}]
   * @returns {Promise<{ posts: import('../../core/types.js').PostItem[], pageInfo: Object }>}
   */
  async searchClinics(args = {}) {
    const platform = args.platform || 'medpro';
    const response = await this.client.searchClinics({ ...args, platform });
    const data = extractResponseBody(response, platform, 'search_clinics');

    const posts = normalizeHealthcareResults(data, 'search', { platform });
    await this.#persist(posts);

    return {
      posts,
      pageInfo: {
        has_next_page: false,
        page: 1,
        total: posts.length,
      },
    };
  }

  /**
   * Get Long Chau retail pharmacies.
   * @param {Record<string, any>} [args={}]
   * @returns {Promise<{ posts: import('../../core/types.js').PostItem[], pageInfo: Object }>}
   */
  async getStores(args = {}) {
    const platform = 'nhathuoclongchau';
    const response = await this.client.getStores({ ...args, platform });
    const data = extractResponseBody(response, platform, 'get_stores');

    const posts = normalizeHealthcareResults(data, 'stores', { platform });
    await this.#persist(posts);

    const page = Math.max(1, Number(args.page) || 1);
    return {
      posts,
      pageInfo: {
        has_next_page: posts.length >= 5,
        page,
        total: posts.length,
      },
    };
  }

  /**
   * Wholesale pharmacy catalog placeholder.
   * @param {Record<string, any>} [args={}]
   * @returns {Promise<never>}
   */
  async getPharmacyCatalog(args = {}) {
    return this.client.getPharmacyCatalog(args);
  }

  /**
   * Get entity detail.
   * @param {Record<string, any>} [args={}]
   * @returns {Promise<{ post: import('../../core/types.js').PostItem }>}
   */
  async detail(args = {}) {
    const platform = args.platform || 'medpro';
    const id = String(args.id || args.slug || '').trim();
    if (!id) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: id',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform,
      });
    }

    const response = await this.client.detail({ ...args, platform, id });
    const data = extractResponseBody(response, platform, 'detail');

    const posts = normalizeHealthcareResults(data, 'detail', { platform });
    if (!posts.length) {
      throw new PlatformError({
        type: ErrorTypes.NOT_FOUND,
        code: 'XACT_4001',
        message: `Entity not found for id "${id}" on platform "${platform}"`,
        statusCode: 404,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform,
      });
    }

    const post = posts[0];
    this.validateItem(post);
    await this.#persist([post]);

    return { post };
  }
}
