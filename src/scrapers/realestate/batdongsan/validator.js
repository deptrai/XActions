// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Batdongsan.com.vn Platform Response Validator
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractPlatformResponseValidator } from '../../../core/platform-validator.js';

export class BatdongsanPlatformResponseValidator extends AbstractPlatformResponseValidator {
  /** @type {string} */
  platform = 'batdongsan';

  /**
   * Extract raw body string if available.
   * @param {any} response
   * @returns {string}
   */
  #getBody(response) {
    if (typeof response === 'string') return response;
    if (Buffer.isBuffer(response)) return response.toString('utf8');
    if (typeof response?.data === 'string') return response.data;
    if (typeof response?.body === 'string') return response.body;
    if (typeof response?.data?.data === 'string') return response.data.data;
    return '';
  }

  /**
   * @param {any} response
   * @returns {boolean}
   */
  isValidPayload(response) {
    if (this.isRateLimit(response) || this.isBotChallenge(response)) {
      return false;
    }

    if (Buffer.isBuffer(response) || Buffer.isBuffer(response?.data) || Buffer.isBuffer(response?.raw)) {
      return true;
    }

    const data = response?.data !== undefined ? response.data : response;
    if (data && typeof data === 'object') {
      if (Array.isArray(data.data) || Array.isArray(data.items) || data.ProductId != null) {
        return true;
      }
    }

    if (response?.status === 200 || response?.statusCode === 200) {
      return true;
    }

    return false;
  }

  /**
   * @param {any} response
   * @returns {boolean}
   */
  isBotChallenge(response) {
    if (response?.status === 403 || response?.statusCode === 403) {
      return true;
    }

    const text = this.#getBody(response).toLowerCase();
    if (
      text.includes('cf-browser-verification') ||
      text.includes('attention required! | cloudflare') ||
      text.includes('<title>access denied</title>') ||
      text.includes('just a moment...') ||
      text.includes('security verification') ||
      text.includes('blocked by cloudflare') ||
      text.includes('data-translate="why_captcha"')
    ) {
      return true;
    }

    return false;
  }

  /**
   * @param {any} response
   * @returns {boolean}
   */
  isRateLimit(response) {
    if (response?.status === 429 || response?.statusCode === 429) {
      return true;
    }

    const text = this.#getBody(response).toLowerCase();
    if (text.includes('too many requests') || text.includes('rate limit')) {
      return true;
    }

    return false;
  }
}
