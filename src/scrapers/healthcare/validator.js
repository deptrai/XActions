// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Healthcare platform response validator (Medpro, YouMed, Long Chau).
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractPlatformResponseValidator } from '../../core/platform-validator.js';

const CHALLENGE_MARKERS = [
  'just a moment',
  'cloudflare',
  'checking your browser',
  'verify you are human',
  'captcha',
  'challenge',
  'access denied',
  'attention required',
  'cf-browser-verification',
];

const HEALTHCARE_STRUCTURAL_MARKERS = [
  'initialhospitals',
  'initialpharmacyrecommended',
  'doctor-card',
  'app-typical-doctor-card',
  'tin-tuc/wp-json',
  'specialities',
  '__next_data__',
];

const VIETNAMESE_HEALTHCARE_TERMS = [
  'bác sĩ',
  'bác sỹ',
  'phòng khám',
  'bệnh viện',
  'chuyên khoa',
  'nhà thuốc',
  'dược phẩm',
  'đặt lịch khám',
  'khám bệnh',
  'long châu',
  'medpro',
  'youmed',
];

export class HealthcarePlatformResponseValidator extends AbstractPlatformResponseValidator {
  /** @type {string} */
  platform = 'healthcare';

  constructor() {
    super();
  }

  /**
   * Extract body text from response object, string, or Buffer.
   * @param {unknown} response
   * @returns {string}
   */
  #getText(response) {
    if (typeof response === 'string') return response.toLowerCase();
    const resp = /** @type {{ body?: unknown; data?: unknown } | null} */ (response && typeof response === 'object' ? response : null);
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
    if (status === 403) return true;

    const text = this.#getText(response);
    return CHALLENGE_MARKERS.some((marker) => text.includes(marker));
  }

  /**
   * Validate if payload is authentic healthcare data.
   * Accepts either response object ({ status, body }) or raw body string.
   * @param {unknown} response
   * @param {Record<string, unknown>} [options={}]
   * @returns {boolean}
   */
  isValidPayload(response, options = {}) {
    // Support dual call signature: isValidPayload(body, { status }) and isValidPayload({ status, body })
    let effectiveResponse = response;
    if (typeof response === 'string' || Buffer.isBuffer(response)) {
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
    if (HEALTHCARE_STRUCTURAL_MARKERS.some((m) => text.includes(m))) {
      return true;
    }

    // Secondary fallback: requires at least two Vietnamese healthcare terms
    let matched = 0;
    for (const kw of VIETNAMESE_HEALTHCARE_TERMS) {
      if (text.includes(kw)) matched++;
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
    return text.includes('đăng nhập') || text.includes('login') || text.includes('sign in');
  }

  /**
   * @param {unknown} response
   * @returns {boolean}
   */
  isAuthExpired(response) {
    const text = this.#getText(response);
    return text.includes('phiên đăng nhập') || text.includes('session expired');
  }
}
