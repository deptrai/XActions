// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * FnbPlatformResponseValidator — recognizes F&B platform HTML responses and bot challenge pages.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractPlatformResponseValidator } from '../../../core/platform-validator.js';

export class FnbPlatformResponseValidator extends AbstractPlatformResponseValidator {
  /** @type {string} */
  platform = 'fnb';

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
   * F&B platforms return HTML pages. Valid payloads are non-empty HTML strings
   * that contain recognizable F&B content and are not a challenge page.
   * @param {any} response
   * @returns {boolean}
   */
  isValidPayload(response) {
    if (this.isRateLimit(response) || this.isBotChallenge(response)) {
      return false;
    }

    const text = this.#getText(response);
    if (!text || text.length < 50) return false;

    // Valid pages contain restaurant/food-related markers.
    if (
      text.includes('nhà hàng') ||
      text.includes('quán ăn') ||
      text.includes('quán cafe') ||
      text.includes('restaurant') ||
      text.includes('pasgo.vn') ||
      text.includes('foody.vn') ||
      text.includes('riviu.vn') ||
      text.includes('schema.org/restaurant') ||
      text.includes('application/ld+json')
    ) {
      return true;
    }

    return false;
  }
}
