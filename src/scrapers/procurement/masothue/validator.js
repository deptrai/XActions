// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * MaSoThuePlatformResponseValidator — recognizes MaSoThue HTML responses and Cloudflare challenge pages.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractPlatformResponseValidator } from '../../../core/platform-validator.js';

export class MaSoThuePlatformResponseValidator extends AbstractPlatformResponseValidator {
  /** @type {string} */
  platform = 'masothue';

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
   * MaSoThue returns HTML pages. Valid payloads are non-empty HTML strings
   * that contain a recognizable masothue.com structure and are not a challenge page.
   * @param {any} response
   * @returns {boolean}
   */
  /**
   * Detect False 200 responses: HTML returning bot challenge, login wall, or missing company records under 200.
   * @param {any} response
   * @returns {boolean}
   */
  isFalse200(response) {
    const status = this._extractStatus(response);
    if (status < 200 || status >= 300) return false;

    // 1. Generic challenge/checkpoint detection
    if (super.isFalse200(response)) return true;

    // 2. Masothue challenge detection
    if (this.isBotChallenge(response) || this.isRateLimit(response)) {
      return true;
    }

    // 3. Missing company table and tax code terms under 200
    const text = this.#getText(response);
    if (!text || text.length < 50) return true;
    const hasTaxTable = text.includes('table-taxpayer') || text.includes('mã số thuế');
    const hasBusinessTerms = text.includes('doanh nghiệp') && (text.includes('tên công ty') || text.includes('địa chỉ') || text.includes('ngành nghề'));
    if (!hasTaxTable && !hasBusinessTerms) {
      return true;
    }

    return false;
  }

    isValidPayload(response) {
    if (this.isRateLimit(response) || this.isBotChallenge(response) || this.isFalse200(response)) {
      return false;
    }

    const text = this.#getText(response);
    if (!text || text.length < 50) return false;

    // Valid search result pages contain result cards or detail pages have company info rows.
    if (
      text.includes('mã số thuế') ||
      text.includes('table-taxpayer') ||
      (text.includes('doanh nghiệp') && (text.includes('tên công ty') || text.includes('địa chỉ') || text.includes('ngành nghề chính')))
    ) {
      return true;
    }

    return false;
  }
}
