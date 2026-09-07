// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * FnbMerchantClient — HTTP client for PasGo, Foody, and Riviu (Vietnam F&B directories).
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../../core/base-client.js';
import { FnbPlatformResponseValidator } from './validator.js';
import { normalizeCitySlug, normalizeDistrictSlug } from './schema.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';

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
 * @returns {Promise<any>}
 */
async function normalizeRawBody(resp) {
  if (resp === null || resp === undefined) return resp;

  let raw = resp.body;
  if (raw === undefined && resp.data !== undefined) {
    raw = resp.data;
  }

  if (raw === null || raw === undefined) {
    resp.body = '';
    return resp;
  }

  if (Buffer.isBuffer(raw)) {
    resp.body = raw.toString('utf-8');
  } else if (typeof raw === 'string') {
    resp.body = raw;
  } else if (typeof raw?.text === 'function') {
    resp.body = await raw.text();
  } else if (typeof raw?.getReader === 'function' || typeof raw?.pipe === 'function') {
    try {
      const chunks = [];
      if (typeof raw.getReader === 'function') {
        const reader = raw.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(Buffer.from(value));
        }
        resp.body = Buffer.concat(chunks).toString('utf-8');
      } else {
        for await (const chunk of raw) {
          chunks.push(Buffer.from(chunk));
        }
        resp.body = Buffer.concat(chunks).toString('utf-8');
      }
    } catch {
      resp.body = '';
    }
  } else {
    resp.body = String(raw);
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
   * @param {string} [url] — actual request URL; used to derive the Referer dynamically.
   * @returns {Record<string, string>}
   */
  getDefaultHeaders(url) {
    let referer = `${this.baseUrl}/`;
    try {
      const parsed = new URL(String(url || this.baseUrl));
      referer = `${parsed.origin}/`;
    } catch {
      // keep baseUrl fallback
    }

    return {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
      'Referer': referer,
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
    const targetUrl = String(url);
    const headers = {
      ...this.getDefaultHeaders(targetUrl),
      ...(options?.headers || {}),
    };

    const resp = await super.request(method, url, { ...options, headers });
    return await normalizeRawBody(resp);
  }

  /**
   * Build a search URL for the target platform.
   * @param {Object} params
   * @param {string} params.platform
   * @param {string} [params.city]
   * @param {string} [params.district]
   * @param {number} [params.page]
   * @param {number} [params.limit] — maximum items per page (not all platforms support arbitrary page size)
   * @param {string} [params.kind]
   * @param {number} [params.days]
   * @returns {string}
   */
  #resolveBase(targetPlatform, urlOverride) {
    if (urlOverride) return urlOverride.replace(/\/+$/, '');
    return FNB_BASE_URLS[targetPlatform] || this.baseUrl;
  }

  #buildSearchUrl(params = {}) {
    const platform = params.platform || this.targetPlatform;
    const city = normalizeCitySlug(params.city || 'ha-noi', platform);
    const district = normalizeDistrictSlug(params.district || '', city);
    const page = Math.max(1, Number(params.page) || 1);
    const days = Math.max(1, Number(params.days) || 30);

    const base = this.#resolveBase(platform, this.options?.baseUrl);

    if (platform === 'foody') {
      const districtPart = district ? `/${district}` : '';
      let url = `${base}/${city}${districtPart}/nha-hang`;
      const query = [];
      if (page > 1) query.push(`page=${page}`);
      if (params.kind === 'newly_opened' && days) query.push(`days=${days}`);
      return query.length ? `${url}?${query.join('&')}` : url;
    }

    // Riviu: city-level pages live under `/{city}`, not `/{city}/nha-hang`
    if (platform === 'riviu') {
      let url = `${base}/${city}`;
      const query = [];
      if (district) query.push(`district=${district}`);
      if (page > 1) query.push(`page=${page}`);
      if (params.kind === 'newly_opened' && days) query.push(`days=${days}`);
      return query.length ? `${url}?${query.join('&')}` : url;
    }

    // PasGo
    const districtPart = district ? `/${district}` : '';
    let url = `${base}/${city}/nha-hang${districtPart}`;
    const query = [`page=${page}`];
    if (params.kind === 'newly_opened' && days) query.push(`days=${days}`);
    return `${url}?${query.join('&')}`;
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
    return this.searchRestaurants({ ...params, kind: 'newly_opened', days: params.days }, options);
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
    const city = normalizeCitySlug(params.city || 'ha-noi', platform);
    const slug = params.slug ? String(params.slug).trim().replace(/^\/+|\/+$/g, '') : '';

    const base = this.#resolveBase(platform, this.options?.baseUrl);

    if (platform === 'foody' || platform === 'riviu') {
      if (!slug) {
        throw new PlatformError({
          type: ErrorTypes.INVALID_ARGS,
          code: 'XACT_4001',
          message: `Slug is required for ${platform} detail (ID-based URLs are not supported)`,
          statusCode: 400,
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
          platform,
        });
      }
      return this.request('GET', `${base}/${slug}`, { ...options, raw: true });
    }

    // PasGo detail: /{city}/nha-hang/{slug}-{id}
    const slugPart = slug ? `${slug}-` : '';
    const url = slugPart ? `${base}/${city}/nha-hang/${slugPart}${id}` : `${base}/${city}/nha-hang/${id}`;
    return this.request('GET', url, { ...options, raw: true });
  }
}
