// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AutomotiveClient — HTTP client for Oto.com.vn, BonBanh, and Chợ Tốt Xe.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../../core/base-client.js';
import { ChototClient, CHOTOT_GATEWAY_URL } from '../../realestate/chotot/client.js';
import { AutomotivePlatformResponseValidator } from './validator.js';
import { normalizeBrandSlug, normalizeCitySlug } from './schema.js';

export const OTO_VN_BASE_URL = 'https://www.oto.com.vn';
export const BONBANH_BASE_URL = 'https://bonbanh.com';
export const CHOTOT_XE_BASE_URL = 'https://xe.chotot.com';

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

export class AutomotiveClient extends AbstractApiClient {
  /** @type {string} */
  name = 'automotive';

  /** @type {boolean} */
  requiresAuth = false;

  /** @type {boolean} */
  requiresProxy = false;

  /** @type {string} */
  baseUrl = OTO_VN_BASE_URL;

  /** @type {string} */
  platform = 'automotive';

  /**
   * @param {Record<string, any>} [options={}]
   */
  constructor(options = {}) {
    const responseValidator = options.responseValidator || new AutomotivePlatformResponseValidator();
    super({
      ...options,
      platform: options.targetPlatform || options.platform || 'automotive',
      client: options.client || 'got',
      responseValidator,
      requiresAuth: options.requiresAuth ?? false,
      requiresProxy: options.requiresProxy ?? false,
    });

    this.targetPlatform = options.targetPlatform || options.platform || 'oto_vn';
    this.baseUrl = this.#resolveBaseUrl(this.targetPlatform, options.baseUrl);
    this.options = options;
    this.chototClient = null;

    if (this.targetPlatform === 'chotot_xe' || this.targetPlatform === 'chotot') {
      this.chototClient = new ChototClient({
        ...options,
        baseUrl: CHOTOT_GATEWAY_URL,
        requiresAuth: false,
      });
    }
  }

  /**
   * @param {string} targetPlatform
   * @param {string} [baseUrl]
   * @returns {string}
   */
  #resolveBaseUrl(targetPlatform, baseUrl) {
    if (baseUrl) return baseUrl.replace(/\/+$/, '');
    switch (targetPlatform) {
      case 'oto_vn': return OTO_VN_BASE_URL;
      case 'bonbanh': return BONBANH_BASE_URL;
      case 'chotot_xe':
      case 'chotot': return CHOTOT_GATEWAY_URL;
      default: return OTO_VN_BASE_URL;
    }
  }

  /**
   * Default browser headers for VN automotive sites.
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
   * Search vehicle listings.
   * @param {Object} params
   * @param {string} params.platform
   * @param {string} [params.brand]
   * @param {string} [params.model]
   * @param {string} [params.city]
   * @param {number} [params.yearMin]
   * @param {number} [params.yearMax]
   * @param {number} [params.priceMin]
   * @param {number} [params.priceMax]
   * @param {number} [params.page]
   * @param {number} [params.limit]
   * @param {Object} [options]
   * @returns {Promise<any>}
   */
  async search(params = {}, options = {}) {
    const platform = params.platform || this.targetPlatform;
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));

    if (platform === 'chotot_xe' || platform === 'chotot') {
      const offset = (page - 1) * limit;
      const query = {
        cg: params.model && /sh|airblade|lead|dream|wave|sirius|exciter|winner|raider|future/i.test(params.model) ? 2020 : 2010,
        st: 's',
        o: offset,
        limit,
      };
      if (params.region_v2) query.region_v2 = params.region_v2;
      if (params.area_v2) query.area_v2 = params.area_v2;
      if (params.priceMin != null || params.priceMax != null) {
        query.price = `${params.priceMin || ''}-${params.priceMax || ''}`;
      }
      if (params.yearMin != null || params.yearMax != null) {
        query.year = `${params.yearMin || ''}-${params.yearMax || ''}`;
      }
      if (params.brand) query.company = normalizeBrandSlug(params.brand);
      if (params.model) query.model = params.model;

      const resp = await this.chototClient.getJson('/v1/public/ad-listing', query, options);
      return { data: resp };
    }

    const brand = normalizeBrandSlug(params.brand || '');
    const model = normalizeBrandSlug(params.model || '');
    const city = normalizeCitySlug(params.city || '');

    const base = this.baseUrl.replace(/\/+$/, '');

    if (platform === 'bonbanh') {
      const url = `${base}/oto/page,${page}`;
      return this.request('GET', url, { ...options, raw: true });
    }

    // Oto.com.vn
    const pathParts = ['mua-ban-xe'];
    if (brand) pathParts.push(brand);
    if (model) pathParts.push(model);
    if (city) pathParts.push(city);
    const url = `${base}/${pathParts.join('-')}?page=${page}`;
    return this.request('GET', url, { ...options, raw: true });
  }

  /**
   * List vehicles by page.
   * @param {Object} params
   * @param {string} params.platform
   * @param {number} [params.page]
   * @param {number} [params.limit]
   * @param {Object} [options]
   * @returns {Promise<any>}
   */
  async list(params = {}, options = {}) {
    return this.search({ ...params, page: params.page || 1, limit: params.limit || 20 }, options);
  }

  /**
   * Get vehicle detail.
   * @param {Object} params
   * @param {string} params.platform
   * @param {string} params.id
   * @param {string} [params.slug]
   * @param {Object} [options]
   * @returns {Promise<any>}
   */
  async detail(params = {}, options = {}) {
    const platform = params.platform || this.targetPlatform;
    const id = String(params.id || '').trim();

    if (platform === 'chotot_xe' || platform === 'chotot') {
      const resp = await this.chototClient.getJson(`/v1/public/ad-listing/${id}`, {}, options);
      return { data: resp };
    }

    const slug = params.slug ? `-${String(params.slug)}` : '';
    const base = this.baseUrl.replace(/\/+$/, '');

    if (platform === 'bonbanh') {
      const url = slug ? `${base}${slug}-${id}` : `${base}/oto/${id}`;
      return this.request('GET', url, { ...options, raw: true });
    }

    // Oto.com.vn
    const url = `${base}/${id}.html`;
    return this.request('GET', url, { ...options, raw: true });
  }
}
