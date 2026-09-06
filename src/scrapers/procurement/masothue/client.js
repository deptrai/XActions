// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * MaSoThueClient — HTTP client for masothue.com public HTML with VN browser headers.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../../core/base-client.js';
import { MaSoThuePlatformResponseValidator } from './validator.js';

export const MASOTHUE_BASE_URL = 'https://masothue.com';

export class MaSoThueClient extends AbstractApiClient {
  /** @type {string} */
  name = 'masothue';

  /** @type {string} */
  platform = 'masothue';

  /** @type {boolean} */
  requiresAuth = false;

  /** @type {boolean} */
  requiresProxy = true;

  /** @type {string} */
  baseUrl = MASOTHUE_BASE_URL;

  /**
   * @param {Record<string, any>} [options={}]
   */
  constructor(options = {}) {
    const baseUrl = (options.baseUrl || MASOTHUE_BASE_URL).replace(/\/+$/, '');
    const responseValidator = options.responseValidator || new MaSoThuePlatformResponseValidator();

    super({
      ...options,
      platform: 'masothue',
      client: options.client || 'got',
      responseValidator,
      requiresAuth: options.requiresAuth ?? false,
      requiresProxy: options.requiresProxy ?? true,
    });

    this.baseUrl = baseUrl;
    this.requiresProxy = options.requiresProxy !== undefined ? options.requiresProxy : true;
    this.options = options;
  }

  /**
   * Default browser headers for masothue.com to avoid Cloudflare 403.
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
   * Override request to inject MaSoThue-specific browser headers.
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

    const resp = await super.request(method, url, {
      ...options,
      headers,
    });

    // Normalize raw body to string for HTML parsing.
    if (resp?.body !== undefined && typeof resp.body !== 'string') {
      try {
        if (Buffer.isBuffer(resp.body)) {
          resp.body = resp.body.toString('utf-8');
        } else if (resp.body && typeof resp.body.getReader === 'function') {
          const reader = resp.body.getReader();
          const chunks = [];
          let done = false;
          while (!done) {
            const { done: d, value } = await reader.read();
            if (d) done = true;
            else chunks.push(value);
          }
          resp.body = Buffer.concat(chunks).toString('utf-8');
        } else {
          resp.body = String(resp.body);
        }
      } catch {
        resp.body = '';
      }
    }

    return resp;
  }

  /**
   * Search for companies by tax code or company name.
   * @param {Object} params
   * @param {string} params.q
   * @param {string} [params.type]
   * @param {Object} [options={}]
   * @returns {Promise<{ status: number, data: string, body: string }>}
   */
  async search(params = {}, options = {}) {
    const query = new URLSearchParams();
    if (params.q) query.set('q', params.q);
    if (params.type) query.set('type', params.type);

    const url = `${this.baseUrl}/Search/?${query.toString()}`;
    return this.request('GET', url, { ...options, raw: true });
  }

  /**
   * Get province-level company list.
   * @param {Object} params
   * @param {string} params.provinceSlug
   * @param {number} [params.id]
   * @param {number} [params.page]
   * @param {Object} [options={}]
   * @returns {Promise<{ status: number, data: string, body: string }>}
   */
  async searchByProvince(params = {}, options = {}) {
    const provinceSlug = params.provinceSlug || '';
    const id = params.id || '1';
    const page = Number(params.page) > 1 ? `?page=${params.page}` : '';

    const url = `${this.baseUrl}/tra-cuu-ma-so-thue-theo-tinh/${provinceSlug}-${id}${page}`;
    return this.request('GET', url, { ...options, raw: true });
  }

  /**
   * Get company detail page by tax code (and optional slug).
   * @param {Object} params
   * @param {string} params.taxCode
   * @param {string} [params.slug]
   * @param {Object} [options={}]
   * @returns {Promise<{ status: number, data: string, body: string }>}
   */
  async detail(params = {}, options = {}) {
    const taxCode = String(params.taxCode || '');
    const slug = params.slug ? `-${params.slug}` : '';

    const url = slug
      ? `${this.baseUrl}/${taxCode}${slug}`
      : `${this.baseUrl}/${taxCode}`;

    return this.request('GET', url, { ...options, raw: true });
  }
}
