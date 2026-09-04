// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * BlueskyPlatformResponseValidator — AT Protocol / XRPC response validator.
 * Detects valid actor/feed/search payloads, rate-limits, auth failures,
 * and bot challenges from Bluesky public or authenticated endpoints.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { AbstractPlatformResponseValidator } from '../../../core/platform-validator.js';

const RATE_LIMIT_STATUS = 429;
const UNAUTHORIZED_STATUS = 401;
const FORBIDDEN_STATUS = 403;

const RATE_LIMIT_ERRORS = new Set([
  'RateLimitExceeded',
  'RateLimited',
  'rate_limit',
  'TooManyRequests',
]);

const AUTH_ERRORS = new Set([
  'AuthenticationRequired',
  'AuthExpired',
  'ExpiredToken',
  'InvalidToken',
  'Unauthorized',
  'BadToken',
]);

const BOT_CHALLENGE_ERRORS = new Set([
  'Blocked',
  'AccountTakedown',
  'ServerBlocked',
]);

export class BlueskyPlatformResponseValidator extends AbstractPlatformResponseValidator {
  /** @type {string} */
  platform = 'bluesky';

  /**
   * @param {unknown} response
   * @returns {Record<string, unknown> | null}
   */
  #getRecord(response) {
    if (typeof response === 'object' && response !== null) {
      return /** @type {Record<string, unknown>} */ (response);
    }
    return null;
  }

  /**
   * @param {unknown} response
   * @returns {string}
   */
  #getBody(response) {
    if (typeof response === 'string') return response;
    const record = this.#getRecord(response);
    if (typeof record?.data === 'string') return record.data;
    if (typeof record?.body === 'string') return record.body;
    return '';
  }

  /**
   * @param {unknown} response
   * @returns {number | null}
   */
  #getStatus(response) {
    const record = this.#getRecord(response);
    if (typeof record?.status === 'number') return record.status;
    if (typeof record?.statusCode === 'number') return record.statusCode;
    return null;
  }

  /**
   * @param {unknown} response
   * @returns {Record<string, string> | null}
   */
  #getHeaders(response) {
    const record = this.#getRecord(response);
    if (record && typeof record.headers === 'object' && record.headers !== null) {
      const headers = /** @type {Record<string, string>} */ (record.headers);
      const normalized = /** @type {Record<string, string>} */ ({});
      for (const [key, value] of Object.entries(headers)) {
        normalized[key.toLowerCase()] = value;
      }
      return normalized;
    }
    return null;
  }

  /**
   * Extract the AT Protocol error name from the payload.
   * @param {unknown} response
   * @returns {string}
   */
  #getErrorName(response) {
    const record = this.#getRecord(response);
    if (!record) return '';

    if (typeof record.error === 'string') return record.error;

    const data = typeof record.data === 'object' && record.data !== null
      ? /** @type {Record<string, unknown>} */ (record.data)
      : null;

    if (data && typeof data.error === 'string') {
      return data.error;
    }

    // Fallback for body strings (raw text/HTML from upstream or proxy).
    const body = this.#getBody(response);
    if (body) {
      try {
        const parsed = JSON.parse(body);
        if (typeof parsed.error === 'string') return parsed.error;
      } catch {}
    }

    return '';
  }

  /**
   * @param {unknown} response
   * @returns {boolean}
   */
  #isHtmlResponse(response) {
    const body = this.#getBody(response);
    return body.includes('<html') || body.includes('<!doctype');
  }

  /**
   * @param {unknown} response
   * @returns {boolean}
   */
  isRateLimit(response) {
    const status = this.#getStatus(response);
    if (status === RATE_LIMIT_STATUS) return true;

    const headers = this.#getHeaders(response);
    if (headers) {
      const remaining = headers['ratelimit-remaining'] || headers['x-ratelimit-remaining'];
      if (remaining === '0') return true;
    }

    const error = this.#getErrorName(response);
    if (RATE_LIMIT_ERRORS.has(error)) return true;

    const body = this.#getBody(response).toLowerCase();
    if (this.#isHtmlResponse(response)) {
      if (
        body.includes('rate limit') ||
        body.includes('too many requests') ||
        body.includes('ratelimit')
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * @param {unknown} response
   * @returns {boolean}
   */
  isAuthExpired(response) {
    const status = this.#getStatus(response);
    if (status === UNAUTHORIZED_STATUS) return true;

    const error = this.#getErrorName(response);
    if (AUTH_ERRORS.has(error)) return true;

    const body = this.#getBody(response).toLowerCase();
    if (this.#isHtmlResponse(response)) {
      if (
        body.includes('authentication required') ||
        body.includes('invalid token') ||
        body.includes('expired token') ||
        body.includes('access token is invalid')
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * @param {unknown} response
   * @returns {boolean}
   */
  isBotChallenge(response) {
    const status = this.#getStatus(response);
    if (status === FORBIDDEN_STATUS) return true;

    const error = this.#getErrorName(response);
    if (BOT_CHALLENGE_ERRORS.has(error)) return true;

    const body = this.#getBody(response).toLowerCase();
    if (this.#isHtmlResponse(response)) {
      if (
        body.includes('captcha') ||
        body.includes('challenge') ||
        body.includes('blocked') ||
        body.includes('access denied')
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * @param {unknown} response
   * @returns {boolean}
   */
  isLoginWall(response) {
    const body = this.#getBody(response).toLowerCase();
    const status = this.#getStatus(response);

    if (status === 401 || status === 403) {
      if (
        body.includes('adult content') ||
        body.includes('age-restricted') ||
        body.includes('sign in to view') ||
        body.includes('log in to view') ||
        body.includes('login to view')
      ) {
        return true;
      }
    }

    const error = this.#getErrorName(response);
    if (error === 'AccountTakedown' || error === 'ServerBlocked') return true;

    return false;
  }

  /**
   * @param {unknown} response
   * @returns {boolean}
   */
  isValidPayload(response) {
    if (this.isRateLimit(response) || this.isBotChallenge(response) || this.isAuthExpired(response) || this.isLoginWall(response)) {
      return false;
    }

    // Direct array responses (e.g. feed generators, lists of posts).
    if (Array.isArray(response)) {
      return true;
    }

    const record = this.#getRecord(response);
    if (!record) return false;

    if (Array.isArray(record.data)) {
      return true;
    }

    const data = typeof record.data === 'object' && record.data !== null
      ? /** @type {Record<string, unknown>} */ (record.data)
      : record;

    if (typeof data !== 'object' || data === null) {
      const body = this.#getBody(response);
      if (body) {
        try {
          const parsed = JSON.parse(body);
          if (this.#looksLikeBlueskyPayload(parsed)) return true;
        } catch {}
      }
      return false;
    }

    if (this.#looksLikeBlueskyPayload(data)) return true;

    return false;
  }

  /**
   * @param {unknown} value
   * @returns {boolean}
   */
  #looksLikeBlueskyPayload(value) {
    if (typeof value !== 'object' || value === null) return false;

    if (Array.isArray(value)) {
      return true;
    }

    const data = /** @type {Record<string, unknown>} */ (value);

    if (data.success === false) return false;
    if (typeof data.error === 'string') return false;

    // Core actor profile fields — require at least did + handle together
    // or a strongly identifiable profile shape.
    if (typeof data.did === 'string' && typeof data.handle === 'string') {
      return true;
    }

    // Profile facets that only make sense when paired with an actor.
    if (
      typeof data.displayName === 'string' &&
      (typeof data.handle === 'string' || typeof data.did === 'string')
    ) {
      return true;
    }

    // Standard paginated collections. Empty collections are valid 200 OK responses.
    const collections = [
      'feed',
      'posts',
      'actors',
      'profiles',
      'followers',
      'follows',
      'likes',
      'repostedBy',
      'notifications',
      'lists',
      'feeds',
    ];
    for (const key of collections) {
      if (Array.isArray(data[key])) return true;
    }

    // Nested AT Protocol objects.
    if (
      typeof data.actor === 'object' && data.actor !== null ||
      typeof data.record === 'object' && data.record !== null ||
      typeof data.post === 'object' && data.post !== null ||
      typeof data.thread === 'object' && data.thread !== null ||
      typeof data.replies === 'object' && data.replies !== null
    ) {
      return true;
    }

    // Records with both uri and cid.
    if (typeof data.uri === 'string' && typeof data.cid === 'string') {
      return true;
    }

    return false;
  }
}
