// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * YouTubePlatformResponseValidator — YouTube Data API v3 response validator.
 * Validates responses and detects quota exhaustion, key invalidation,
 * bot challenges, and permission walls.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractPlatformResponseValidator } from '../../../core/platform-validator.js';

const RATE_LIMIT_STATUS = 429;
const UNAUTHORIZED_STATUS = 401;
const BAD_REQUEST_STATUS = 400;
const FORBIDDEN_STATUS = 403;

const QUOTA_REASONS = new Set([
  'quotaExceeded',
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'dailyLimitExceeded',
  'resourceExhausted',
]);

const AUTH_REASONS = new Set([
  'keyInvalid',
  'keyExpired',
  'badRequest',
  'authError',
  'unauthorized',
  'invalidCredentials',
]);

const CHALLENGE_MARKERS = [
  'unusual traffic from your computer network',
  'google.com/recaptcha',
  'recaptcha',
  'just a moment',
  'cloudflare',
  'checking your browser',
  'verify you are human',
  'captcha',
  'challenge',
  'access denied',
  'attention required',
];

export class YouTubePlatformResponseValidator extends AbstractPlatformResponseValidator {
  /** @type {string} */
  platform = 'youtube';

  /**
   * Extract JSON record from response object or string.
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
   * Extract HTTP status code from response.
   * @param {unknown} response
   * @returns {number | null}
   */
  #getStatus(response) {
    if (typeof response === 'object' && response !== null) {
      const rec = /** @type {Record<string, unknown>} */ (response);
      if (typeof rec.status === 'number') return rec.status;
      if (typeof rec.statusCode === 'number') return rec.statusCode;
      if (typeof rec.error === 'object' && rec.error !== null) {
        const err = /** @type {Record<string, unknown>} */ (rec.error);
        if (typeof err.code === 'number') return err.code;
      }
    }
    return null;
  }

  /**
   * Extract Google/YouTube error reasons array.
   * @param {unknown} response
   * @returns {string[]}
   */
  #getErrorReasons(response) {
    const record = this.#getRecord(response);
    if (!record) return [];

    const errObj = typeof record.error === 'object' && record.error !== null
      ? /** @type {Record<string, unknown>} */ (record.error)
      : null;

    if (!errObj) return [];

    const reasons = [];
    if (Array.isArray(errObj.errors)) {
      for (const item of errObj.errors) {
        if (item && typeof item.reason === 'string') {
          reasons.push(item.reason);
        }
      }
    }

    if (typeof errObj.message === 'string') {
      reasons.push(errObj.message);
    }

    return reasons;
  }

  /**
   * Check if response indicates YouTube API quota exceeded or rate limit.
   * @param {unknown} response
   * @returns {boolean}
   */
  isRateLimit(response) {
    const status = this.#getStatus(response);
    if (status === RATE_LIMIT_STATUS) return true;

    const reasons = this.#getErrorReasons(response);
    if (reasons.some((r) => QUOTA_REASONS.has(r))) return true;

    const text = this.#getText(response);
    if (status === FORBIDDEN_STATUS && (text.includes('quotaexceeded') || text.includes('quota exceeded'))) {
      return true;
    }

    return text.includes('rate limit exceeded') || text.includes('too many requests') || text.includes('quota exceeded');
  }

  /**
   * Check if API key is missing, invalid, or expired.
   * @param {unknown} response
   * @returns {boolean}
   */
  isAuthExpired(response) {
    const status = this.#getStatus(response);
    const reasons = this.#getErrorReasons(response);

    if (reasons.some((r) => AUTH_REASONS.has(r) && r !== 'badRequest')) {
      return true;
    }

    const text = this.#getText(response);
    if (
      text.includes('api key not valid') ||
      text.includes('keyinvalid') ||
      text.includes('key is invalid') ||
      text.includes('api key expired') ||
      text.includes('permission denied to use api')
    ) {
      return true;
    }

    if (status === UNAUTHORIZED_STATUS) return true;

    return false;
  }

  /**
   * Check if response is a bot challenge, captcha, or WAF block.
   * @param {unknown} response
   * @returns {boolean}
   */
  isBotChallenge(response) {
    const text = this.#getText(response);
    if (CHALLENGE_MARKERS.some((marker) => text.includes(marker))) {
      return true;
    }

    const status = this.#getStatus(response);
    if (status === FORBIDDEN_STATUS && (text.includes('<html') || text.includes('<!doctype'))) {
      return true;
    }

    return false;
  }

  /**
   * Check if video/channel is private, restricted, or comments disabled.
   * @param {unknown} response
   * @returns {boolean}
   */
  isLoginWall(response) {
    const reasons = this.#getErrorReasons(response);
    if (
      reasons.includes('privateVideo') ||
      reasons.includes('commentsDisabled') ||
      reasons.includes('videoNotFound')
    ) {
      return true;
    }

    const text = this.#getText(response);
    return (
      text.includes('private video') ||
      text.includes('sign in to confirm your age') ||
      text.includes('this video is private')
    );
  }

  /**
   * Validate if payload is authentic YouTube Data API response.
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
      this.isBotChallenge(effectiveResponse)
    ) {
      return false;
    }

    const status = this.#getStatus(effectiveResponse);
    if (status !== null && status >= 400) return false;

    // Direct array responses
    if (Array.isArray(effectiveResponse)) return true;

    const record = this.#getRecord(effectiveResponse);
    if (!record) return false;

    // If Google error block exists, payload is not valid
    if (record.error !== undefined && typeof record.error === 'object' && record.error !== null) {
      return false;
    }

    // YouTube API envelope matches kind or items
    if (Array.isArray(record.items)) return true;

    if (typeof record.kind === 'string' && record.kind.startsWith('youtube#')) {
      return true;
    }

    // Direct video, channel, or comment object
    if (record.snippet !== undefined || record.contentDetails !== undefined || record.statistics !== undefined) {
      return true;
    }

    return false;
  }
}
