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
   * Extract plain text blocks containing tax code patterns from HTML.
   * @param {string} html
   * @returns {string[]}
   */
  #extractCompanyBlocks(html) {
    // Strip HTML tags but keep text structure for regex matching.
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Split by tax code occurrences.
    const taxCodePattern = /\b\d{9,13}\b/g;
    const blocks = [];
    let lastEnd = 0;
    let m;
    while ((m = taxCodePattern.exec(text)) !== null) {
      const taxCode = m[0];
      // Capture surrounding ~200 chars for context
      const start = Math.max(0, m.index - 200);
      const end = Math.min(text.length, m.index + 200);
      blocks.push({ taxCode, context: text.slice(start, end) });
    }
    return blocks;
  }

  /**
   * Extract a labeled field value from a text block.
   * @param {string} block
   * @param {string} label
   * @returns {string}
   */
  #extractField(block, label) {
    const idx = block.indexOf(label);
    if (idx === -1) return '';
    // Value runs until next label or end.
    const after = block.slice(idx + label.length);
    const nextLabelIdx = after.search(/(Mã số thuế|Địa chỉ|Ngành nghề chính|Tên công ty|Doanh nghiệp|Đại diện|Ngày thành lập|Vốn điều lệ)/i);
    const value = nextLabelIdx === -1 ? after : after.slice(0, nextLabelIdx);
    return value.replace(/^[:\s]+/, '').replace(/[:\s]+$/, '').trim();
  }

  /**
   * Extract company name from a context block.
   * @param {string} context
   * @param {string} taxCode
   * @returns {string}
   */
  #extractCompanyName(context, taxCode) {
    // Try pattern "TAXCODE - Company Name"
    const direct = context.match(new RegExp(`${taxCode}\\s*[-–—]\\s*([^\\n<]{5,200})`));
    if (direct) return direct[1].trim();
    // Try label-based extraction
    const name = this.#extractField(context, 'Tên công ty');
    if (name) return name;
    return `Company ${taxCode}`;
  }

  /**
   * Extract PostItem[] from a MaSoThue HTML response.
   * @param {string} html
   * @param {'search' | 'province' | 'detail'} kind
   * @param {Object} [context]
   * @returns {PostItem[]}
   */
  #extractItems(html, kind = 'search', context = {}) {
    const items = [];
    const now = new Date();

    if (typeof html !== 'string' || html.length < 100) {
      return items;
    }

    const blocks = this.#extractCompanyBlocks(html);
    const provinceInfo = resolveProvince(context.province) || {};

    for (const { taxCode, context: block } of blocks) {
      if (!taxCode || taxCode.length < 9) continue;
      const companyName = this.#extractCompanyName(block, taxCode);
      const address = this.#extractField(block, 'Địa chỉ') || '';
      const businessLines = this.#extractField(block, 'Ngành nghề chính') || '';

      items.push({
        id: `masothue:${taxCode}`,
        platform: 'masothue',
        externalId: taxCode,
        category: 'b2b',
        authorId: taxCode,
        authorName: companyName,
        content: `Mã số thuế: ${taxCode}${companyName ? ` — ${companyName}` : ''}${address ? ` — ${address}` : ''}`,
        metadata: {
          taxCode,
          companyName,
          address,
          businessLines,
          detailUrl: `https://masothue.com/${taxCode}`,
          province: provinceInfo.name || context.province || '',
        },
        crawledAt: now,
      });
    }

    // Fallback: normalizer regex if no structured blocks found
    if (items.length === 0) {
      return normalizeMaSoThueResults(html, kind, {
        province: context.province,
        detailUrl: context.taxCode ? `https://masothue.com/${context.taxCode}` : undefined,
      });
    }

    return items;
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

    const posts = this.#extractItems(html, 'search', { keyword: q });
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

    const response = await this.client.detail({ taxCode, slug: args.slug });
    const html = response.body || response.data || '';

    const posts = this.#extractItems(html, 'detail', { taxCode });

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
