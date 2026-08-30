// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * ShopeePlatformResponseValidator — recognizes Shopee Web API payloads and WAF/Captcha blocks.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractPlatformResponseValidator } from '../../../core/platform-validator.js';

export class ShopeePlatformResponseValidator extends AbstractPlatformResponseValidator {
  /** @type {string} */
  platform = 'shopee';

  /**
   * Extract raw body text if available.
   * @param {any} response
   * @returns {string}
   */
  #getText(response) {
    if (typeof response === 'string') return response.toLowerCase();
    if (typeof response?.data === 'string') return response.data.toLowerCase();
    if (typeof response?.body === 'string') return response.body.toLowerCase();
    return '';
  }

  /**
   * @param {any} response
   * @returns {boolean}
   */
  isRateLimit(response) {
    const status = response?.status ?? response?.statusCode;
    if (status === 429) return true;

    const text = this.#getText(response);
    return text.includes('too many requests') || text.includes('rate limit');
  }

  /**
   * @param {any} response
   * @returns {boolean}
   */
  isBotChallenge(response) {
    const status = response?.status ?? response?.statusCode;
    if (status === 403) return true;

    const data = response?.data !== undefined ? response.data : response;
    if (data?.error === 90309999 || data?.error === -1) return true;
    if (typeof data?.error_msg === 'string' && /captcha|challenge|blocked/i.test(data.error_msg)) return true;

    const text = this.#getText(response);
    return (
      text.includes('captcha') ||
      text.includes('sec_check') ||
      text.includes('akamai') ||
      text.includes('challenge') ||
      text.includes('access denied')
    );
  }

  /**
   * @param {any} response
   * @returns {boolean}
   */
  isValidPayload(response) {
    if (this.isRateLimit(response) || this.isBotChallenge(response)) {
      return false;
    }

    const data = response?.data !== undefined ? response.data : response;
    if (!data) return false;

    if (typeof data === 'object') {
      if (Array.isArray(data.items) || Array.isArray(data.data?.items)) return true;
      if (data.data?.itemid || data.item_basic?.itemid || data.itemid) return true;
      if (Array.isArray(data.data?.ratings) || Array.isArray(data.ratings)) return true;
      if (data.total_count !== undefined || data.nomore !== undefined) return true;
    }

    return false;
  }
}
