// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * LinkedIn API Client
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../../core/base-client.js';
import { LinkedInPlatformResponseValidator } from './validator.js';

export const LINKEDIN_BASE_URL = 'https://www.linkedin.com';

export class LinkedInClient extends AbstractApiClient {
  /** @type {string} */
  platform = 'linkedin';

  /** @type {'got' | 'fetch'} */
  client = 'got';

  /** @type {boolean} */
  requiresAuth = false;

  /** @type {boolean} */
  requiresProxy = false;

  /** @type {string} */
  baseUrl = LINKEDIN_BASE_URL;

  /**
   * @param {Record<string, any>} [options={}]
   */
  constructor(options = {}) {
    const validator = options.responseValidator || new LinkedInPlatformResponseValidator();
    const baseUrl = (options.baseUrl || LINKEDIN_BASE_URL).replace(/\/+$/, '');
    super({
      ...options,
      platform: 'linkedin',
      client: options.client || 'got',
      responseValidator: validator,
      requiresAuth: options.requiresAuth ?? false,
      requiresProxy: options.requiresProxy ?? false,
    });
    this.baseUrl = baseUrl;
    this.requiresProxy = options.requiresProxy !== undefined ? options.requiresProxy : false;
  }

  /**
   * Fetch raw HTML or Guest API response
   * @param {string} endpointOrUrl
   * @param {Record<string, any>} [options={}]
   * @returns {Promise<string>}
   */
  async getHtml(endpointOrUrl, options = {}) {
    const url = endpointOrUrl.startsWith('http')
      ? endpointOrUrl
      : `${this.baseUrl}${endpointOrUrl.startsWith('/') ? '' : '/'}${endpointOrUrl}`;

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
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
