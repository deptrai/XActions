// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * VietnamWorks API Client
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../../core/base-client.js';
import { VietnamWorksPlatformResponseValidator } from './validator.js';

export const VIETNAMWORKS_BASE_URL = 'https://ms.vietnamworks.com';

export class VietnamWorksClient extends AbstractApiClient {
  /** @type {string} */
  platform = 'vietnamworks';

  /** @type {'got' | 'fetch'} */
  client = 'got';

  /** @type {boolean} */
  requiresAuth = false;

  /** @type {boolean} */
  requiresProxy = false;

  /** @type {string} */
  baseUrl = VIETNAMWORKS_BASE_URL;

  /**
   * @param {Record<string, any>} [options={}]
   */
  constructor(options = {}) {
    const validator = options.responseValidator || new VietnamWorksPlatformResponseValidator();
    const baseUrl = (options.baseUrl || VIETNAMWORKS_BASE_URL).replace(/\/+$/, '');
    super({
      ...options,
      platform: 'vietnamworks',
      client: options.client || 'got',
      responseValidator: validator,
      requiresAuth: options.requiresAuth ?? false,
      requiresProxy: options.requiresProxy ?? false,
    });
    this.baseUrl = baseUrl;
    this.requiresProxy = options.requiresProxy !== undefined ? options.requiresProxy : false;
  }

  /**
   * Send JSON request to VietnamWorks microservices.
   * @param {string} endpoint
   * @param {Record<string, any>} body
   * @param {Record<string, any>} [options={}]
   * @returns {Promise<any>}
   */
  async postJson(endpoint, body = {}, options = {}) {
    const url = endpoint.startsWith('http')
      ? endpoint
      : `${this.baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      ...(options.headers || {}),
    };

    const response = await this.request('POST', url, {
      headers,
      json: body,
      requiresAuth: false,
      requiresProxy: this.requiresProxy,
      ...options,
    });

    return response?.data !== undefined ? response.data : response;
  }
}
