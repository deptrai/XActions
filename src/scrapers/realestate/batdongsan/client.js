// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Batdongsan.com.vn API Client
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../../core/base-client.js';
import { BatdongsanPlatformResponseValidator } from './validator.js';

export const BATDONGSAN_API_HOST = 'https://apimap.batdongsan.com.vn';

export class BatdongsanClient extends AbstractApiClient {
  /** @type {string} */
  platform = 'batdongsan';

  /** @type {'got' | 'fetch'} */
  client = 'got';

  /** @type {boolean} */
  requiresAuth = false;

  /** @type {boolean} */
  requiresProxy = false;

  /** @type {string} */
  baseUrl = BATDONGSAN_API_HOST;

  /**
   * @param {Record<string, any>} [options={}]
   */
  constructor(options = {}) {
    const validator = options.responseValidator || new BatdongsanPlatformResponseValidator();
    const baseUrl = (options.baseUrl || BATDONGSAN_API_HOST).replace(/\/+$/, '');
    super({
      ...options,
      platform: 'batdongsan',
      client: options.client || 'got',
      responseValidator: validator,
      requiresAuth: options.requiresAuth ?? false,
      requiresProxy: options.requiresProxy ?? false,
    });
    this.baseUrl = baseUrl;
    this.requiresProxy = options.requiresProxy !== undefined ? options.requiresProxy : false;
  }

  /**
   * Post to p_sync and get raw buffer.
   * @param {string} endpoint
   * @param {Record<string, any>} body
   * @param {Record<string, any>} [options={}]
   * @returns {Promise<Buffer>}
   */
  async postSyncRaw(endpoint, body = {}, options = {}) {
    const url = endpoint.startsWith('http')
      ? endpoint
      : `${this.baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

    const headers = {
      'Content-Type': 'application/json',
      'Accept': '*/*',
      'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 8.0.0; SM-G9500 Build/R16NW)',
      ...(options.headers || {}),
    };

    const response = await this.request('POST', url, {
      headers,
      json: body,
      raw: true,
      requiresAuth: false,
      requiresProxy: this.requiresProxy,
      ...options,
    });

    if (Buffer.isBuffer(response)) return response;
    if (Buffer.isBuffer(response?.body)) return response.body;
    if (Buffer.isBuffer(response?.data)) return response.data;
    if (typeof response?.body === 'string') return Buffer.from(response.body);
    if (typeof response?.data === 'string') return Buffer.from(response.data);
    return Buffer.from(JSON.stringify(response || {}));
  }
}
