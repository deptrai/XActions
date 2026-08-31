// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * ShopeeClient — HTTP client for Shopee Web Search & Item APIs with TLS Spoofing.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../../core/base-client.js';
import { ShopeePlatformResponseValidator } from './validator.js';

export const SHOPEE_BASE_URL = 'https://shopee.vn';
export const SHOPEE_IMAGE_CDN = 'https://down-vn.img.susercontent.com/file';

export class ShopeeClient extends AbstractApiClient {
  /** @type {string} */
  name = 'shopee';

  /** @type {string} */
  platform = 'shopee';

  /** @type {boolean} */
  requiresAuth = false;

  /**
   * @param {Record<string, any>} [options={}]
   */
  constructor(options = {}) {
    const baseUrl = options.baseUrl || SHOPEE_BASE_URL;
    const responseValidator = options.responseValidator || new ShopeePlatformResponseValidator();

    super({
      ...options,
      platform: 'shopee',
      client: options.client || 'got',
      responseValidator,
      requiresAuth: options.requiresAuth ?? false,
      requiresProxy: options.requiresProxy ?? false,
    });

    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  /**
   * Override request to inject Shopee-specific browser headers.
   * @param {string} method
   * @param {string} url
   * @param {import('../../../core/base-client.js').RequestOptions} [options]
   * @returns {Promise<any>}
   */
  async request(method, url, options = {}) {
    const headers = {
      'accept': 'application/json',
      'x-api-source': 'rpc',
      'x-shopee-language': 'vi',
      'x-requested-with': 'XMLHttpRequest',
      'referer': `${this.baseUrl}/`,
      ...(options.headers || {}),
    };

    const resp = /** @type {any} */ (await super.request(method, url, {
      ...options,
      headers,
    }));

    return resp?.data ?? resp;
  }

  /**
   * Search items on Shopee.
   * @param {Record<string, any>} params
   * @param {Object} [options]
   * @returns {Promise<any>}
   */
  async searchItems(params = {}, options = {}) {
    const query = new URLSearchParams({
      by: params.sortBy || 'relevancy',
      keyword: params.keyword || '',
      limit: String(params.limit || 30),
      newest: String(params.offset || 0),
      order: params.order || 'desc',
      page_type: 'search',
      scenario: 'PAGE_GLOBAL_SEARCH',
      version: '2',
      ...(params.category ? { fe_category: String(params.category) } : {}),
    });

    const url = `${this.baseUrl}/api/v4/search/search_items?${query.toString()}`;
    return this.request('GET', url, options);
  }

  /**
   * Get product details by itemId and shopId.
   * @param {string|number} itemId
   * @param {string|number} shopId
   * @param {Object} [options]
   * @returns {Promise<any>}
   */
  async getItemDetail(itemId, shopId, options = {}) {
    const query = new URLSearchParams({
      itemid: String(itemId),
      shopid: String(shopId),
    });
    const url = `${this.baseUrl}/api/v4/item/get?${query.toString()}`;
    return this.request('GET', url, options);
  }

  /**
   * Get product ratings/reviews.
   * @param {string|number} itemId
   * @param {string|number} shopId
   * @param {Record<string, any>} [params={}]
   * @param {Object} [options]
   * @returns {Promise<any>}
   */
  async getItemRatings(itemId, shopId, params = {}, options = {}) {
    const query = new URLSearchParams({
      itemid: String(itemId),
      shopid: String(shopId),
      limit: String(params.limit || 20),
      offset: String(params.offset || 0),
      filter: String(params.filterRating || 0),
      flag: '1',
      type: '0',
    });
    const url = `${this.baseUrl}/api/v4/item/get_ratings?${query.toString()}`;
    return this.request('GET', url, options);
  }
}
