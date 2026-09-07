// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * B2BRegistryExtendedValidator — recognizes HoSoCongTy & MuaSamCong HTML and Cloudflare challenges.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractPlatformResponseValidator } from '../../../core/platform-validator.js';

export class B2BRegistryExtendedValidator extends AbstractPlatformResponseValidator {
  /** @type {string} */
  platform = 'b2b_registry_extended';

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
   * Valid payloads are non-empty HTML strings with recognizable content.
   * @param {any} response
   * @returns {boolean}
   */
  isValidPayload(response) {
    if (this.isRateLimit(response) || this.isBotChallenge(response)) {
      return false;
    }

    const text = this.#getText(response);
    if (!text || text.length < 50) return false;

    // HoSoCongTy or MuaSamCong indicators
    if (
      text.includes('mã số thuế') ||
      text.includes('tên công ty') ||
      text.includes('chủ đầu tư') ||
      text.includes('mã tbmt') ||
      text.includes('tên gói thầu') ||
      text.includes('ngày đăng tải') ||
      text.includes('thông tin lựa chọn nhà thầu') ||
      text.includes('hosocongty.vn') ||
      text.includes('muasamcong.mpi.gov.vn')
    ) {
      return true;
    }

    return false;
  }
}
