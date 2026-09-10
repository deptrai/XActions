// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * IP Legal & Trademark platform response validator (Cục Sở hữu Trí tuệ - ipvietnam.gov.vn).
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractPlatformResponseValidator } from '../../../core/platform-validator.js';

const CHALLENGE_MARKERS = [
  'just a moment',
  'cloudflare',
  'checking your browser',
  'verify you are human',
  'captcha',
  'challenge',
  'access denied',
  'attention required',
  'bảo trì hệ thống',
  'hệ thống đang bận',
];

const LEGAL_STRUCTURAL_MARKERS = [
  'danh-sach-don',
  'chuyen-cong-bo',
  'công báo',
  'sở hữu công nghiệp',
  'sở hữu trí tuệ',
  'nhãn hiệu',
  'sáng chế',
  'số đơn',
  'ngày nộp đơn',
  'chuyển công bố',
  'ipvietnam.gov.vn',
  'cục sở hữu trí tuệ',
];

export class IpLegalPlatformResponseValidator extends AbstractPlatformResponseValidator {
  /** @type {string} */
  platform = 'ipvietnam';

  constructor() {
    super();
  }

  /**
   * Extract body text from response object, string, or Buffer.
   * @param {unknown} response
   * @returns {string}
   */
  #getText(response) {
    if (typeof response === "string") return response.toLowerCase();
    const resp = /** @type {{ body?: unknown; data?: unknown } | null} */ (
      response && typeof response === "object" ? response : null
    );
    const raw = resp?.body ?? resp?.data ?? response;
    if (typeof raw === 'string') return raw.toLowerCase();
    if (Buffer.isBuffer(raw)) return raw.toString('utf-8').toLowerCase();
    if (raw !== null && raw !== undefined && typeof raw === 'object') {
      try {
        return JSON.stringify(raw).toLowerCase();
      } catch {
        return '';
      }
    }
    return '';
  }

  /**
   * Check if response is an HTTP 429 or contains rate limit markers.
   * @param {unknown} response
   * @returns {boolean}
   */
  isRateLimit(response) {
    const status = this._extractStatus(response);
    if (status === 429) return true;

    const text = this.#getText(response);
    return text.includes('rate limit') || text.includes('too many requests');
  }

  /**
   * Check for bot challenge or WAF block.
   * @param {unknown} response
   * @returns {boolean}
   */
  isBotChallenge(response) {
    const status = this._extractStatus(response);
    if (status === 403 || status === 503) return true;

    const text = this.#getText(response);
    return CHALLENGE_MARKERS.some((marker) => text.includes(marker));
  }

  /**
   * Validate if payload is authentic legal IP gazette data.
   * Accepts either response object ({ status, body }) or raw body string.
   * @param {unknown} response
   * @param {Record<string, unknown>} [options={}]
   * @returns {boolean}
   */
  isValidPayload(response, options = {}) {
    let effectiveResponse = response;
    if (typeof response === "string" || Buffer.isBuffer(response)) {
      effectiveResponse = { body: response, status: options?.status ?? 200 };
    }

    if (this.isRateLimit(effectiveResponse) || this.isBotChallenge(effectiveResponse)) {
      return false;
    }

    const status = this._extractStatus(effectiveResponse);
    if (status >= 400) return false;

    const text = this.#getText(effectiveResponse);
    if (!text || text.length < 50) return false;

    // Check platform structural signals
    let matched = 0;
    for (const marker of LEGAL_STRUCTURAL_MARKERS) {
      if (text.includes(marker)) matched++;
      if (matched >= 2) return true;
    }

    return false;
  }

  /**
   * @param {unknown} response
   * @returns {boolean}
   */
  isLoginWall(response) {
    const text = this.#getText(response);
    return text.includes('đăng nhập') || text.includes('login') || text.includes('yêu cầu xác thực');
  }

  /**
   * @param {unknown} response
   * @returns {boolean}
   */
  isAuthExpired(response) {
    const text = this.#getText(response);
    return text.includes('phiên làm việc đã hết hạn') || text.includes('session expired');
  }
}
