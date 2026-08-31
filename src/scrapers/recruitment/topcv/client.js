// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TopCV API Client
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../../core/base-client.js';
import { TopCvPlatformResponseValidator } from './validator.js';

export const TOPCV_BASE_URL = 'https://www.topcv.vn';

export class TopCvClient extends AbstractApiClient {
  /** @type {string} */
  platform = 'topcv';

  /** @type {'got' | 'fetch'} */
  client = 'got';

  /** @type {boolean} */
  requiresAuth = false;

  /** @type {boolean} */
  requiresProxy = true;

  /** @type {string} */
  baseUrl = TOPCV_BASE_URL;

  /**
   * @param {Record<string, any>} [options={}]
   */
  constructor(options = {}) {
    const validator = options.responseValidator || new TopCvPlatformResponseValidator();
    const baseUrl = (options.baseUrl || TOPCV_BASE_URL).replace(/\/+$/, '');
    super({
      ...options,
      platform: 'topcv',
      client: options.client || 'got',
      responseValidator: validator,
      requiresAuth: options.requiresAuth ?? false,
      requiresProxy: options.requiresProxy ?? true,
    });
    this.baseUrl = baseUrl;
    this.requiresProxy = options.requiresProxy !== undefined ? options.requiresProxy : true;
  }

  /**
   * Fetch raw HTML page
   * @param {string} pathOrUrl
   * @param {Record<string, any>} [options={}]
   * @returns {Promise<string>}
   */
  async getHtml(pathOrUrl, options = {}) {
    const url = pathOrUrl.startsWith('http')
      ? pathOrUrl
      : `${this.baseUrl}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
      ...(options.headers || {}),
    };

    const response = await this.request('GET', url, {
      headers,
      requiresAuth: false,
      requiresProxy: this.requiresProxy,
      ...options,
    });

    if (typeof response === 'string') return response;
    if (typeof response?.data === 'string') return response.data;
    if (typeof response?.body === 'string') return response.body;
    return String(response?.data || response?.body || '');
  }
}
