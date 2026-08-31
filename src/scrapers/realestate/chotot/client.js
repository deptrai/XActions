// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Chợ Tốt API Client
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../../core/base-client.js';
import { ChototPlatformResponseValidator } from './validator.js';

export const CHOTOT_GATEWAY_URL = 'https://gateway.chotot.com';

export class ChototClient extends AbstractApiClient {
  /** @type {string} */
  platform = 'chotot';

  /** @type {'got' | 'fetch'} */
  client = 'got';

  /** @type {boolean} */
  requiresAuth = false;

  /** @type {boolean} */
  requiresProxy = false;

  /** @type {string} */
  baseUrl = CHOTOT_GATEWAY_URL;

  /**
   * @param {Record<string, any>} [options={}]
   */
  constructor(options = {}) {
    const validator = options.responseValidator || new ChototPlatformResponseValidator();
    const baseUrl = (options.baseUrl || CHOTOT_GATEWAY_URL).replace(/\/+$/, '');
    super({
      ...options,
      platform: 'chotot',
      client: options.client || 'got',
      responseValidator: validator,
      requiresAuth: options.requiresAuth ?? false,
      requiresProxy: options.requiresProxy ?? false,
    });
    this.baseUrl = baseUrl;
    this.requiresProxy = options.requiresProxy !== undefined ? options.requiresProxy : false;
  }

  /**
   * Send GET request to Chợ Tốt Gateway API.
   * @param {string} endpoint
   * @param {Record<string, any>} [params={}]
   * @param {Record<string, any>} [options={}]
   * @returns {Promise<any>}
   */
  async getJson(endpoint, params = {}, options = {}) {
    const isAbsolute = endpoint.startsWith('http');
    const base = isAbsolute ? endpoint : `${this.baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

    const urlObj = new URL(base);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') {
        urlObj.searchParams.set(k, String(v));
      }
    }

    const headers = {
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      ...(options.headers || {}),
    };

    const response = await this.request('GET', urlObj.toString(), {
      headers,
      requiresAuth: false,
      requiresProxy: this.requiresProxy,
      ...options,
    });

    return response?.data !== undefined ? response.data : response;
  }
}
