// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * MaSoThueCrawler — B2B company registry crawler for Vietnam.
 * Extends AbstractCrawler with search, search_by_province, and detail actions.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractCrawler } from '../../../core/base-crawler.js';
import { MaSoThueClient } from './client.js';
import { MaSoThuePlatformResponseValidator } from './validator.js';
import { normalizeMaSoThueResults } from './normalizer.js';
import { resolveProvince, normalizeProvinceSlug } from './schema.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';

/**
 * @typedef {import('../../../core/types.js').PostItem} PostItem
 */

export class MaSoThueCrawler extends AbstractCrawler {
  /** @type {string} */
  name = 'masothue';

  /** @type {string} */
  platform = 'masothue';

  /** @type {boolean} */
  requiresAuth = false;

  /**
   * @param {Record<string, any>} [deps={}]
   */
  constructor(deps = {}) {
    const client = deps.client || new MaSoThueClient(deps);
    super({ client, ...deps, requiresAuth: deps.requiresAuth ?? false });

    this.registerAction({
      action: 'search',
      description: 'Search companies on MaSoThue by tax code or company name',
      category: 'b2b',
      requiresAuth: false,
      requiredArgs: ['q'],
      optionalArgs: ['type', 'limit'],
      example: { q: '0013180180' },
      outputType: '{ posts: PostItem[], pageInfo: { has_next_page: boolean } }',
      handler: (/** @type {any} */ args) => this.search(args),
    });

    this.registerAction({
      action: 'search_by_province',
      description: 'Browse companies by province/city on MaSoThue',
      category: 'b2b',
      requiresAuth: false,
      requiredArgs: ['province'],
      optionalArgs: ['page', 'limit'],
      example: { province: 'binh-duong', page: 1 },
      outputType: '{ posts: PostItem[], pageInfo: { has_next_page: boolean } }',
      handler: (/** @type {any} */ args) => this.searchByProvince(args),
    });

    this.registerAction({
      action: 'detail',
      description: 'Get detailed company information by tax code from MaSoThue',
      category: 'b2b',
      requiresAuth: false,
      requiredArgs: ['taxCode'],
      optionalArgs: ['slug'],
      example: { taxCode: '0013180180' },
      outputType: '{ post: PostItem }',
      handler: (/** @type {any} */ args) => this.detail(args),
    });
  }

  /**
   * Extract PostItem[] from a MaSoThue HTML response.
   * @param {string} html
   * @param {'search' | 'province' | 'detail'} kind
   * @param {Object} [context]
   * @returns {PostItem[]}
   */
  #extractItems(html, kind = 'search', context = {}) {
    return normalizeMaSoThueResults(html, kind, {
      province: context.province,
      taxCode: context.taxCode,
    });
  }

  /**
   * Resolve a detail slug from search results when caller omits it.
   * @param {string} taxCode
   * @param {string} [providedSlug]
   * @returns {Promise<string | undefined>}
   */
  async #resolveDetailSlug(taxCode, providedSlug) {
    if (providedSlug) return providedSlug;
    try {
      const response = await this.client.search({ q: taxCode, type: 'auto' });
      const html = response.body || response.data || '';
      const items = normalizeMaSoThueResults(html, 'search');
      const item = items.find((i) => i.externalId === taxCode);
      if (item?.metadata?.detailUrl) {
        const match = item.metadata.detailUrl.match(/\/\d{9,13}(?:-\d{1,3})?-(.+)$/);
        if (match) return match[1];
      }
    } catch {
      // Continue to attempt bare detail; if it 404s, caller should provide slug.
    }
    return undefined;
  }

  /**
   * Action: search
   * @param {Record<string, any>} args
   * @returns {Promise<{ posts: PostItem[], pageInfo: { has_next_page: boolean } }>}
   */
  async search(args = {}) {
    const q = typeof args.q === 'string' ? args.q.trim() : '';
    if (!q) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: q',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'masothue',
      });
    }

    const searchType = args.type || 'auto';
    const response = await this.client.search({ q, type: searchType });
    const html = response.body || response.data || '';

    const posts = this.#extractItems(html, 'search', { province: args.province });
    const limit = Math.max(1, Number(args.limit) || 10);

    if (this.store && typeof this.store.storeBatch === 'function' && posts.length > 0) {
      await this.store.storeBatch(posts.slice(0, limit)).catch(() => {});
    }

    return {
      posts: posts.slice(0, limit),
      pageInfo: { has_next_page: posts.length >= limit },
    };
  }

  /**
   * Action: search_by_province
   * @param {Record<string, any>} args
   * @returns {Promise<{ posts: PostItem[], pageInfo: { has_next_page: boolean } }>}
   */
  async searchByProvince(args = {}) {
    const provinceInput = typeof args.province === 'string' ? args.province.trim() : '';
    if (!provinceInput) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: province',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'masothue',
      });
    }

    const slug = normalizeProvinceSlug(provinceInput);
    const province = resolveProvince(slug);

    if (!province) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: `Unknown province: "${provinceInput}"`,
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'masothue',
      });
    }

    const page = Math.max(1, Number(args.page) || 1);
    const response = await this.client.searchByProvince({
      provinceSlug: province.slug,
      id: province.id,
      page,
    });

    const html = response.body || response.data || '';
    const posts = this.#extractItems(html, 'province', { province: province.name });
    const limit = Math.max(1, Number(args.limit) || 10);

    if (this.store && typeof this.store.storeBatch === 'function' && posts.length > 0) {
      await this.store.storeBatch(posts.slice(0, limit)).catch(() => {});
    }

    return {
      posts: posts.slice(0, limit),
      pageInfo: { has_next_page: posts.length >= limit },
    };
  }

  /**
   * Action: detail
   * @param {Record<string, any>} args
   * @returns {Promise<{ post: PostItem | null }>}
   */
  async detail(args = {}) {
    const taxCode = typeof args.taxCode === 'string' ? args.taxCode.trim() : '';
    if (!taxCode || !/^\d{9,13}$/.test(taxCode)) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing or invalid taxCode',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'masothue',
      });
    }

    const slug = await this.#resolveDetailSlug(taxCode, args.slug);
    const response = await this.client.detail({ taxCode, slug });
    const html = response.body || response.data || '';

    const posts = this.#extractItems(html, 'detail', { taxCode, province: args.province });

    if (!posts.length) {
      throw new PlatformError({
        type: ErrorTypes.NOT_FOUND,
        code: 'XACT_4040',
        message: `MaSoThue detail not found for tax code ${taxCode}`,
        statusCode: 404,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'masothue',
      });
    }

    const post = posts[0];
    if (this.store && typeof this.store.storeBatch === 'function') {
      await this.store.storeBatch([post]).catch(() => {});
    }

    return { post };
  }

  /** @returns {Promise<void>} */
  async init() {}

  /** @returns {Promise<void>} */
  async cleanup() {
    if (this.client && typeof this.client.cleanup === 'function') {
      await this.client.cleanup().catch(() => {});
    }
  }
}
