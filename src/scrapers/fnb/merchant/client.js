// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * FnbMerchantClient — HTTP client for PasGo, Foody, and Riviu (Vietnam F&B directories).
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../../core/base-client.js';
import { FnbPlatformResponseValidator } from './validator.js';
import { normalizeCitySlug, normalizeDistrictSlug } from './schema.js';

export const PASGO_BASE_URL = 'https://pasgo.vn';
export const FOODY_BASE_URL = 'https://www.foody.vn';
export const RIVIU_BASE_URL = 'https://riviu.vn';

export const FNB_BASE_URLS = {
  pasgo: PASGO_BASE_URL,
  foody: FOODY_BASE_URL,
  riviu: RIVIU_BASE_URL,
};

/**
 * Convert raw response body to UTF-8 string for HTML parsing.
 * @param {any} resp
 * @returns {any}
 */
function normalizeRawBody(resp) {
  if (resp?.body !== undefined) {
    if (Buffer.isBuffer(resp.body)) {
      resp.body = resp.body.toString('utf-8');
    } else if (typeof resp.body !== 'string') {
      resp.body = String(resp.body);
    }
  }
  return resp;
}

export class FnbMerchantClient extends AbstractApiClient {
  /** @type {string} */
  name = 'fnb';

  /** @type {boolean} */
  requiresAuth = false;

  /** @type {boolean} */
  requiresProxy = true;

  /** @type {string} */
  baseUrl = PASGO_BASE_URL;

  /** @type {string} */
  platform = 'fnb';

  /**
   * @param {Record<string, any>} [options={}]
   */
  constructor(options = {}) {
    const responseValidator = options.responseValidator || new FnbPlatformResponseValidator();
    super({
      ...options,
      platform: options.targetPlatform || options.platform || 'fnb',
      client: options.client || 'got',
      responseValidator,
      requiresAuth: options.requiresAuth ?? false,
      requiresProxy: options.requiresProxy ?? true,
    });

    this.targetPlatform = options.targetPlatform || options.platform || 'pasgo';
    this.baseUrl = this.#resolveBaseUrl(this.targetPlatform, options.baseUrl);
    this.options = options;
  }

  /**
   * @param {string} targetPlatform
   * @param {string} [baseUrl]
   * @returns {string}
   */
  #resolveBaseUrl(targetPlatform, baseUrl) {
    if (baseUrl) return baseUrl.replace(/\/+$/, '');
    return FNB_BASE_URLS[targetPlatform] || PASGO_BASE_URL;
  }

  /**
   * Default browser headers for VN F&B sites.
   * @returns {Record<string, string>}
   */
  getDefaultHeaders() {
    return {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
      'Referer': `${this.baseUrl}/`,
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'User-Agent': this.options?.userAgent ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    };
  }

  /**
   * @param {string} method
   * @param {string} url
   * @param {import('../../../core/base-client.js').RequestOptions} [options]
   * @returns {Promise<any>}
   */
  async request(method, url, options = {}) {
    const headers = {
      ...this.getDefaultHeaders(),
      ...(options?.headers || {}),
    };

    const resp = await super.request(method, url, { ...options, headers });
    return normalizeRawBody(resp);
  }

  /**
   * Build a search URL for the target platform.
   * @param {Object} params
   * @param {string} params.platform
   * @param {string} [params.city]
   * @param {string} [params.district]
   * @param {number} [params.page]
   * @param {number} [params.limit]
   * @returns {string}
   */
  #buildSearchUrl(params = {}) {
    const platform = params.platform || this.targetPlatform;
    const city = normalizeCitySlug(params.city || 'ha-noi');
    const district = normalizeDistrictSlug(params.district || '', city);
    const page = Math.max(1, Number(params.page) || 1);

    const base = this.baseUrl.replace(/\/+$/, '');

    if (platform === 'foody') {
      if (district) {
        return `${base}/${city}/${district}/nha-hang`;
      }
      return `${base}/${city}/nha-hang`;
    }

    if (platform === 'riviu') {
      if (district) {
        return `${base}/${city}/${district}/nha-hang`;
      }
      return `${base}/${city}/nha-hang`;
    }

    // PasGo
    if (district) {
      return `${base}/${city}/nha-hang/${district}?page=${page}`;
    }
    return `${base}/${city}/nha-hang?page=${page}`;
  }

  /**
   * Search restaurants.
   * @param {Object} params
   * @param {string} [params.platform]
   * @param {string} [params.city]
   * @param {string} [params.district]
   * @param {number} [params.page]
   * @param {number} [params.limit]
   * @param {Object} [options]
   * @returns {Promise<any>}
   */
  async searchRestaurants(params = {}, options = {}) {
    const url = this.#buildSearchUrl({ ...params, platform: params.platform || this.targetPlatform });
    return this.request('GET', url, { ...options, raw: true });
  }

  /**
   * Search newly opened restaurants.
   * @param {Object} params
   * @param {string} [params.platform]
   * @param {string} [params.city]
   * @param {number} [params.days]
   * @param {number} [params.page]
   * @param {number} [params.limit]
   * @param {Object} [options]
   * @returns {Promise<any>}
   */
  async getNewlyOpened(params = {}, options = {}) {
    return this.searchRestaurants({ ...params, kind: 'newly_opened' }, options);
  }

  /**
   * Search restaurants by district.
   * @param {Object} params
   * @param {string} [params.platform]
   * @param {string} [params.city]
   * @param {string} [params.district]
   * @param {number} [params.page]
   * @param {number} [params.limit]
   * @param {Object} [options]
   * @returns {Promise<any>}
   */
  async searchByDistrict(params = {}, options = {}) {
    return this.searchRestaurants({ ...params, kind: 'search_by_district' }, options);
  }

  /**
   * Get restaurant detail.
   * @param {Object} params
   * @param {string} [params.platform]
   * @param {string} params.id
   * @param {string} [params.slug]
   * @param {string} [params.city]
   * @param {Object} [options]
   * @returns {Promise<any>}
   */
  async detail(params = {}, options = {}) {
    const platform = params.platform || this.targetPlatform;
    const id = String(params.id || '').trim();
    const city = normalizeCitySlug(params.city || 'ha-noi');

    const base = (FNB_BASE_URLS[platform] || PASGO_BASE_URL).replace(/\/+$/, '');

    if (platform === 'foody' || platform === 'riviu') {
      const url = params.slug ? `${base}/${params.slug}` : `${base}/${city}/nha-hang/${id}`;
      return this.request('GET', url, { ...options, raw: true });
    }

    // PasGo detail: /{city}/nha-hang/{slug}-{id}
    const slug = params.slug ? `${params.slug}-` : '';
    const url = slug ? `${base}/${city}/nha-hang/${slug}${id}` : `${base}/${city}/nha-hang/${id}`;
    return this.request('GET', url, { ...options, raw: true });
  }
}
