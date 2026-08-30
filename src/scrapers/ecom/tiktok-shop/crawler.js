// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TikTokShopCrawler — E-Commerce Crawler for TikTok Shop.
 * Extends AbstractCrawler, registers top_products, product_detail, and search_products actions.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractCrawler } from '../../../core/base-crawler.js';
import { TikTokShopClient } from './client.js';
import { normalizeTikTokShopProduct, buildTikTokShopPageInfo } from './normalize-product.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';

export class TikTokShopCrawler extends AbstractCrawler {
  /** @type {string} */
  name = 'tiktokshop';

  /** @type {string} */
  platform = 'tiktokshop';

  /** @type {boolean} */
  requiresAuth = false;

  /** @type {TikTokShopClient} */
  client;

  /**
   * @param {Record<string, any>} [deps={}]
   */
  constructor(deps = {}) {
    const { client: explicitClient, ...clientDeps } = deps;
    const client = explicitClient || new TikTokShopClient(clientDeps);
    super({
      ...deps,
      client,
      requiresAuth: deps.requiresAuth !== undefined ? deps.requiresAuth : false,
    });

    this.client = client;

    // ── Story 16.2 Actions: top_products, product_detail, search_products ──
    this.registerAction({
      action: 'top_products',
      description: 'Fetch top selling / affiliate products on TikTok Shop by category',
      category: 'ecom',
      requiresAuth: false,
      requiredArgs: [],
      optionalArgs: ['category', 'limit', 'page'],
      example: { category: 'fashion', limit: 20 },
      outputType: '{ products: PostItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.topProducts(args, session),
    });

    this.registerAction({
      action: 'product_detail',
      description: 'Get product details by productId',
      category: 'ecom',
      requiresAuth: false,
      requiredArgs: ['productId'],
      optionalArgs: [],
      example: { productId: '172948291048' },
      outputType: '{ product: PostItem }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.productDetail(args, session),
    });

    this.registerAction({
      action: 'search_products',
      description: 'Search TikTok Shop products by keyword',
      category: 'ecom',
      requiresAuth: false,
      requiredArgs: ['keyword'],
      optionalArgs: ['limit', 'page', 'sortBy'],
      example: { keyword: 'son moi', limit: 20 },
      outputType: '{ products: PostItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.searchProducts(args, session),
    });
  }

  /**
   * Action Handler: top_products
   * @param {Record<string, any>} args
   * @param {Record<string, any>} [session]
   * @returns {Promise<{ products: import('../../../core/types.js').PostItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }>}
   */
  async topProducts(args = {}, session = {}) {
    const limit = Math.max(1, Math.min(Number(args.limit || 20) || 0, 100));
    const page = Math.max(0, Number(args.page || 0) || 0);

    const response = await this.client.getTopProducts({
      category: args.category,
      limit,
      page,
      sortBy: args.sortBy,
    }, {
      requiresAuth: false,
    });

    let productsRaw = response?.data?.products || response?.products || [];
    if (!Array.isArray(productsRaw)) productsRaw = [];
    const products = [];

    for (const raw of productsRaw) {
      const product = normalizeTikTokShopProduct(raw, {
        sourceMethod: 'top_products',
        extraMetadata: { category: args.category, page },
      });
      if (product) products.push(product);
      if (products.length >= limit) break;
    }

    if (this.store && typeof this.store.storeBatch === 'function' && products.length > 0) {
      await this.store.storeBatch(products, { upsert: true }).catch(() => {});
    }

    const pageInfo = buildTikTokShopPageInfo(response, products.length);

    return { products, pageInfo };
  }

  /**
   * Action Handler: product_detail
   * @param {Record<string, any>} args
   * @param {Record<string, any>} [session]
   * @returns {Promise<{ product: import('../../../core/types.js').PostItem }>}
   */
  async productDetail(args = {}, session = {}) {
    const productId = args?.productId;

    if (!productId) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: productId',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'tiktokshop',
      });
    }

    const response = await this.client.getProductDetail(productId, {
      requiresAuth: false,
    });

    const product = normalizeTikTokShopProduct(response?.data?.product || response?.product || response, {
      sourceMethod: 'product_detail',
    });

    if (!product) {
      throw new PlatformError({
        type: ErrorTypes.NOT_FOUND,
        code: 'XACT_4040',
        message: `TikTok Shop product not found: ${productId}`,
        statusCode: 404,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'tiktokshop',
      });
    }

    if (this.store && typeof this.store.storeBatch === 'function') {
      await this.store.storeBatch([product], { upsert: true }).catch(() => {});
    }

    return { product };
  }

  /**
   * Action Handler: search_products
   * @param {Record<string, any>} args
   * @param {Record<string, any>} [session]
   * @returns {Promise<{ products: import('../../../core/types.js').PostItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }>}
   */
  async searchProducts(args = {}, session = {}) {
    const keyword = args?.keyword !== undefined && args?.keyword !== null ? String(args.keyword).trim() : '';
    if (!keyword) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: keyword',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'tiktokshop',
      });
    }

    const limit = Math.max(1, Math.min(Number(args.limit || 20) || 0, 100));
    const page = Math.max(0, Number(args.page || 0) || 0);

    const response = await this.client.searchProducts({
      keyword,
      limit,
      page,
      sortBy: args.sortBy,
    }, {
      requiresAuth: false,
    });

    let productsRaw = response?.data?.products || response?.products || [];
    if (!Array.isArray(productsRaw)) productsRaw = [];
    const products = [];

    for (const raw of productsRaw) {
      const product = normalizeTikTokShopProduct(raw, {
        sourceMethod: 'search_products',
        extraMetadata: { keyword, page },
      });
      if (product) products.push(product);
      if (products.length >= limit) break;
    }

    if (this.store && typeof this.store.storeBatch === 'function' && products.length > 0) {
      await this.store.storeBatch(products, { upsert: true }).catch(() => {});
    }

    const pageInfo = buildTikTokShopPageInfo(response, products.length);

    return { products, pageInfo };
  }

  /** @returns {Promise<void>} */
  async init() {}

  /** @returns {Promise<void>} */
  async cleanup() {
    if (this.client && typeof this.client.close === 'function') {
      await this.client.close().catch(() => {});
    }
  }
}
