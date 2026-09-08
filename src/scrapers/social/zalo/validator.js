// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * ZaloPlatformResponseValidator — Zalo OA OpenAPI v3 response validator.
 * Validates responses and detects auth failures, rate limits, and WAF blocks.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractPlatformResponseValidator } from '../../../core/platform-validator.js';

const RATE_LIMIT_STATUS = 429;
const UNAUTHORIZED_STATUS = 401;
const FORBIDDEN_STATUS = 403;

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

export class ZaloPlatformResponseValidator extends AbstractPlatformResponseValidator {
  /** @type {string} */
  platform = 'zalo';

  /**
   * Extract JSON record or parsed object from response.
   * @param {unknown} response
   * @returns {Record<string, unknown> | null}
   */
  #getRecord(response) {
    if (typeof response === 'object' && response !== null) {
      const rec = /** @type {Record<string, unknown>} */ (response);
      if (typeof rec.data === 'string') {
        try {
          return JSON.parse(rec.data);
        } catch {}
      }
      if (typeof rec.body === 'string') {
        try {
          return JSON.parse(rec.body);
        } catch {}
      }
      return rec;
    }
    if (typeof response === 'string') {
      try {
        return JSON.parse(response);
      } catch {}
    }
    return null;
  }

  /**
   * Extract raw text/body from response.
   * @param {unknown} response
   * @returns {string}
   */
  #getText(response) {
    if (typeof response === 'string') return response.toLowerCase();
    const rec = typeof response === 'object' && response !== null ? /** @type {Record<string, unknown>} */ (response) : null;
    const raw = rec?.body ?? rec?.data ?? response;
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
   * @param {unknown} response
   * @returns {number | null}
   */
  #getStatus(response) {
    if (typeof response === 'object' && response !== null) {
      const rec = /** @type {Record<string, unknown>} */ (response);
      if (typeof rec.status === 'number') return rec.status;
      if (typeof rec.statusCode === 'number') return rec.statusCode;
    }
    return null;
  }

  /**
   * Extract Zalo OpenAPI error code (e.g. 0, -216, -211).
   * @param {unknown} response
   * @returns {number | null}
   */
  #getErrorCode(response) {
    const record = this.#getRecord(response);
    if (!record) return null;

    if (typeof record.error === 'number') return record.error;
    if (typeof record.error === 'string') {
      const parsed = parseInt(record.error, 10);
      if (!Number.isNaN(parsed)) return parsed;
    }

    if (typeof record.data === 'object' && record.data !== null) {
      const inner = /** @type {Record<string, unknown>} */ (record.data);
      if (typeof inner.error === 'number') return inner.error;
      if (typeof inner.error === 'string') {
        const parsed = parseInt(inner.error, 10);
        if (!Number.isNaN(parsed)) return parsed;
      }
    }

    return null;
  }

  /**
   * Check if response is rate-limited (HTTP 429 or Zalo error -211).
   * @param {unknown} response
   * @returns {boolean}
   */
  isRateLimit(response) {
    const status = this.#getStatus(response);
    if (status === RATE_LIMIT_STATUS) return true;

    const errorCode = this.#getErrorCode(response);
    if (errorCode === -211) return true;

    const text = this.#getText(response);
    return text.includes('out of quota') || text.includes('rate limit') || text.includes('too many requests');
  }

  /**
   * Check if token is expired, invalid, or missing (HTTP 401 or Zalo error -216).
   * @param {unknown} response
   * @returns {boolean}
   */
  isAuthExpired(response) {
    const status = this.#getStatus(response);
    if (status === UNAUTHORIZED_STATUS) return true;

    const errorCode = this.#getErrorCode(response);
    if (errorCode === -216) return true;

    const text = this.#getText(response);
    return (
      text.includes('access token invalid') ||
      text.includes('access token is invalid') ||
      text.includes('invalid access token') ||
      text.includes('expired token') ||
      text.includes('token expired')
    );
  }

  /**
   * Check if response is a bot challenge or WAF block.
   * @param {unknown} response
   * @returns {boolean}
   */
  isBotChallenge(response) {
    const status = this.#getStatus(response);
    if (status === FORBIDDEN_STATUS) return true;

    const text = this.#getText(response);
    return CHALLENGE_MARKERS.some((marker) => text.includes(marker));
  }

  /**
   * Check if OA is deactivated (-221) or permission denied (-32).
   * @param {unknown} response
   * @returns {boolean}
   */
  isLoginWall(response) {
    const errorCode = this.#getErrorCode(response);
    if (errorCode === -221 || errorCode === -32) return true;

    const text = this.#getText(response);
    return text.includes('deactivated') || text.includes('permission denied');
  }

  /**
   * Validate if payload is authentic Zalo OA OpenAPI response.
   * Accepts response object or raw string with options.
   * @param {unknown} response
   * @param {Record<string, unknown>} [options={}]
   * @returns {boolean}
   */
  isValidPayload(response, options = {}) {
    let effectiveResponse = response;
    if (typeof response === 'string' || Buffer.isBuffer(response)) {
      effectiveResponse = { body: response, status: options?.status ?? 200 };
    }

    if (
      this.isRateLimit(effectiveResponse) ||
      this.isAuthExpired(effectiveResponse) ||
      this.isBotChallenge(effectiveResponse) ||
      this.isLoginWall(effectiveResponse)
    ) {
      return false;
    }

    const status = this.#getStatus(effectiveResponse);
    if (status !== null && status >= 400) return false;

    // Array responses
    if (Array.isArray(effectiveResponse)) return true;

    const record = this.#getRecord(effectiveResponse);
    if (!record) return false;

    // Zalo standard envelope: { error: 0, message: 'Success', data: ... }
    const errorCode = this.#getErrorCode(effectiveResponse);
    if (errorCode === 0) {
      return true;
    }

    // Direct object with expected Zalo OA fields
    if (
      record.data !== undefined ||
      record.medias !== undefined ||
      record.users !== undefined ||
      record.products !== undefined ||
      record.oa_id !== undefined
    ) {
      return errorCode === null || errorCode === 0;
    }

    return false;
  }
}
