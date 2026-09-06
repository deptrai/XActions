// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AutomotivePlatformResponseValidator — detects bot challenge, rate limit, empty/invalid payload
 * for Oto.com.vn, BonBanh, and Chợ Tốt Xe responses.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractPlatformResponseValidator } from '../../../core/platform-validator.js';

export class AutomotivePlatformResponseValidator extends AbstractPlatformResponseValidator {
  /** @type {string} */
  platform = 'automotive';

  /**
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
    return text.includes('rate limit') || text.includes('too many requests');
  }

  /**
   * @param {any} response
   * @returns {boolean}
   */
  isBotChallenge(response) {
    const status = response?.status ?? response?.statusCode;
    if (status === 403) return true;
    const text = this.#getText(response);
    if (
      text.includes('just a moment') ||
      text.includes('cloudflare') ||
      text.includes('checking your browser') ||
      text.includes('verify you are human') ||
      text.includes('captcha') ||
      text.includes('challenge') ||
      text.includes('access denied')
    ) {
      return true;
    }
    return false;
  }

  /**
   * @param {any} response
   * @returns {boolean}
   */
  isValidPayload(response) {
    if (this.isRateLimit(response) || this.isBotChallenge(response)) return false;
    const text = this.#getText(response);
    if (!text || text.length < 20) return false;
    return (
      text.includes('oto.com.vn') ||
      text.includes('bonbanh') ||
      text.includes('chotot') ||
      text.includes('xe') ||
      text.includes('giá') ||
      text.includes('bán')
    );
  }
}
