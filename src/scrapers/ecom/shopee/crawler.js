// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * ShopeeCrawler — E-Commerce Crawler for Shopee Vietnam.
 * Extends AbstractCrawler, registers search_products, product_detail, and product_reviews actions.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractCrawler } from '../../../core/base-crawler.js';
import { ShopeeClient } from './client.js';
import { normalizeShopeeProduct, normalizeShopeeReview } from './normalize-product.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';
import { gaussianDelay } from '../../../utils/gaussian-delay.js';

export class ShopeeCrawler extends AbstractCrawler {
  /** @type {string} */
  name = 'shopee';

  /** @type {string} */
  platform = 'shopee';

  /** @type {boolean} */
  requiresAuth = false;

  /** @type {ShopeeClient} */
  client;

  /**
   * @param {Record<string, any>} [deps={}]
   */
  constructor(deps = {}) {
    const { client: explicitClient, ...clientDeps } = deps;
    const client = explicitClient || new ShopeeClient(clientDeps);
    super({
      ...deps,
      client,
      requiresAuth: deps.requiresAuth !== undefined ? deps.requiresAuth : false,
    });

    this.client = client;

    // ── Story 16.1 Actions: search_products, product_detail, product_reviews ──
    this.registerAction({
      action: 'search_products',
      description: 'Search products on Shopee by keyword with filters',
      category: 'ecom',
      requiresAuth: false,
      requiredArgs: ['keyword'],
      optionalArgs: ['limit', 'page', 'sortBy', 'category'],
      example: { keyword: 'ao thun', limit: 30, sortBy: 'sales' },
      outputType: '{ products: PostItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.searchProducts(args, session),
    });

    this.registerAction({
      action: 'product_detail',
      description: 'Get product details by itemId and shopId',
      category: 'ecom',
      requiresAuth: false,
      requiredArgs: ['itemId', 'shopId'],
      optionalArgs: [],
      example: { itemId: '111222', shopId: '333444' },
      outputType: '{ product: PostItem }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.productDetail(args, session),
    });

    this.registerAction({
      action: 'product_reviews',
      description: 'Get product reviews and buyer ratings by itemId and shopId',
      category: 'ecom',
      requiresAuth: false,
      requiredArgs: ['itemId', 'shopId'],
      optionalArgs: ['limit', 'offset', 'filterRating'],
      example: { itemId: '111222', shopId: '333444', limit: 20 },
      outputType: '{ reviews: CommentItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.productReviews(args, session),
    });
  }

  /**
   * Action Handler: search_products
   * @param {Record<string, any>} args
   * @param {Record<string, any>} [session]
   * @returns {Promise<{ products: import('../../../core/types.js').PostItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }>}
   */
  async searchProducts(args = {}, session = {}) {
    const keyword = typeof args?.keyword === 'string' ? args.keyword.trim() : '';
    if (!keyword) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: keyword',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'shopee',
      });
    }

    const limit = Math.max(1, Math.min(Number(args.limit || 30), 100));
    const page = Math.max(0, Number(args.page || 0));
    const offset = page * limit;

    const response = await this.client.searchItems({
      keyword,
      limit,
      offset,
      sortBy: args.sortBy,
      category: args.category,
    }, {
      requiresAuth: false,
    });

    const itemsRaw = response?.items || response?.data?.items || [];
    const products = [];

    for (const raw of itemsRaw) {
      const product = normalizeShopeeProduct(raw, {
        sourceMethod: 'search_products',
        extraMetadata: { keyword, page },
      });
      if (product) products.push(product);
      if (products.length >= limit) break;
    }

    if (this.store && typeof this.store.savePosts === 'function' && products.length > 0) {
      await this.store.savePosts(products).catch(() => {});
    }

    const hasNext = Boolean(!response?.nomore && products.length > 0 && products.length === limit);

    return {
      products,
      pageInfo: {
        has_next_page: hasNext,
        end_cursor: hasNext ? String(offset + products.length) : null,
      },
    };
  }

  /**
   * Action Handler: product_detail
   * @param {Record<string, any>} args
   * @param {Record<string, any>} [session]
   * @returns {Promise<{ product: import('../../../core/types.js').PostItem }>}
   */
  async productDetail(args = {}, session = {}) {
    const itemId = args?.itemId || args?.itemid;
    const shopId = args?.shopId || args?.shopid;

    if (!itemId || !shopId) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required arguments: itemId and shopId',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'shopee',
      });
    }

    const response = await this.client.getItemDetail(itemId, shopId, {
      requiresAuth: false,
    });

    const product = normalizeShopeeProduct(response, {
      sourceMethod: 'product_detail',
    });

    if (!product) {
      throw new PlatformError({
        type: ErrorTypes.NOT_FOUND,
        code: 'XACT_4040',
        message: `Shopee product not found: itemId ${itemId}, shopId ${shopId}`,
        statusCode: 404,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'shopee',
      });
    }

    if (this.store && typeof this.store.savePosts === 'function') {
      await this.store.savePosts([product]).catch(() => {});
    }

    return { product };
  }

  /**
   * Action Handler: product_reviews
   * @param {Record<string, any>} args
   * @param {Record<string, any>} [session]
   * @returns {Promise<{ reviews: import('../../../core/types.js').CommentItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }>}
   */
  async productReviews(args = {}, session = {}) {
    const itemId = args?.itemId || args?.itemid;
    const shopId = args?.shopId || args?.shopid;

    if (!itemId || !shopId) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required arguments: itemId and shopId',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'shopee',
      });
    }

    const limit = Math.max(1, Math.min(Number(args.limit || 20), 50));
    const offset = Math.max(0, Number(args.offset || 0));

    const response = await this.client.getItemRatings(itemId, shopId, {
      limit,
      offset,
      filterRating: args.filterRating,
    }, {
      requiresAuth: false,
    });

    const ratingsRaw = response?.data?.ratings || response?.ratings || [];
    const reviews = [];

    for (const raw of ratingsRaw) {
      const review = normalizeShopeeReview(raw, String(itemId));
      if (review) reviews.push(review);
      if (reviews.length >= limit) break;
    }

    if (this.store && typeof this.store.saveComments === 'function' && reviews.length > 0) {
      await this.store.saveComments(reviews).catch(() => {});
    }

    const hasNext = Boolean(reviews.length > 0 && reviews.length === limit);

    return {
      reviews,
      pageInfo: {
        has_next_page: hasNext,
        end_cursor: hasNext ? String(offset + reviews.length) : null,
      },
    };
  }

  /** @returns {Promise<void>} */
  async init() {}

  /** @returns {Promise<void>} */
  async cleanup() {}
}
