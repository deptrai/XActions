// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * RedditPlatformResponseValidator — Reddit REST API response validator.
 * Detects valid Listing/Thing payloads, rate-limits, auth failures,
 * bot challenges, and login walls from Reddit endpoints.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractPlatformResponseValidator } from '../../../core/platform-validator.js';

const RATE_LIMIT_STATUS = 429;
const UNAUTHORIZED_STATUS = 401;
const FORBIDDEN_STATUS = 403;

const RATE_LIMIT_ERRORS = new Set([
  'rate_limit',
  'too_many_requests',
  'RATELIMIT',
]);

const AUTH_ERRORS = new Set([
  'invalid_token',
  'unauthorized',
  'invalid_grant',
  'access_denied',
]);

const BOT_CHALLENGE_ERRORS = new Set([
  'blocked',
  'quarantined',
  'suspicious_activity',
]);

export class RedditPlatformResponseValidator extends AbstractPlatformResponseValidator {
  /** @type {string} */
  platform = 'reddit';

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
    if (!record) return null;

    const rawHeaders = record.headers;
    if (!rawHeaders || typeof rawHeaders !== 'object') return null;

    /** @type {Record<string, string>} */
    const normalized = {};

    // Handle Headers instances (undici/fetch) via entries()/forEach().
    const h = /** @type {Headers & Record<string, unknown>} */ (rawHeaders);
    if (typeof h.entries === 'function') {
      for (const [key, value] of h.entries()) {
        normalized[key.toLowerCase()] = value;
      }
      return normalized;
    }

    if (typeof h.forEach === 'function' && typeof h.get === 'function') {
      h.forEach((value, key) => {
        normalized[key.toLowerCase()] = value;
      });
      return normalized;
    }

    for (const [key, value] of Object.entries(/** @type {Record<string, unknown>} */ (rawHeaders))) {
      normalized[key.toLowerCase()] = typeof value === 'string' ? value : String(value);
    }
    return normalized;
  }

  /**
   * Extract the Reddit error name from the payload.
   * @param {unknown} response
   * @returns {string}
   */
  #getErrorName(response) {
    const record = this.#getRecord(response);
    if (!record) return '';

    if (typeof record.error === 'string') return record.error;
    if (typeof record.error === 'number') return String(record.error);

    const data = typeof record.data === 'object' && record.data !== null
      ? /** @type {Record<string, unknown>} */ (record.data)
      : null;

    if (data && typeof data.error === 'string') return data.error;
    if (data && typeof data.error === 'number') return String(data.error);

    const body = this.#getBody(response);
    if (body) {
      try {
        const parsed = JSON.parse(body);
        if (typeof parsed.error === 'string') return parsed.error;
        if (typeof parsed.error === 'number') return String(parsed.error);
      } catch {}
    }

    return '';
  }

  /**
   * @param {unknown} response
   * @returns {boolean}
   */
  #isHtmlResponse(response) {
    const body = this.#getBody(response).toLowerCase();
    return body.includes('<html') || body.includes('<!doctype') || body.includes('<!DOCTYPE');
  }

  /**
   * @param {unknown} response
   * @returns {boolean}
   */
  isRateLimit(response) {
    const status = this.#getStatus(response);
    if (status === RATE_LIMIT_STATUS) return true;

    const headers = this.#getHeaders(response);
    if (headers && status !== 200) {
      const remaining = headers['x-ratelimit-remaining'] ?? headers['ratelimit-remaining'];
      const remainingNum = Number(remaining);
      if (remaining === '0' || (Number.isFinite(remainingNum) && remainingNum <= 0)) return true;
    }

    const error = this.#getErrorName(response);
    if (RATE_LIMIT_ERRORS.has(error)) return true;
    if (error === '429') return true;

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
        body.includes('invalid token') ||
        body.includes('expired token') ||
        body.includes('access token is invalid') ||
        body.includes('unauthorized')
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
    const record = this.#getRecord(response);
    const data = record && typeof record.data === 'object' && record.data !== null
      ? /** @type {Record<string, unknown>} */ (record.data)
      : null;

    const error = this.#getErrorName(response);
    if (BOT_CHALLENGE_ERRORS.has(error)) return true;

    // 403 private subreddits are login walls, not bot challenges.
    if (status === FORBIDDEN_STATUS) {
      if (data && (data.reason === 'private' || data.error === 'private' || data.error === 'subreddit_private')) {
        return false;
      }

      const body = this.#getBody(response).toLowerCase();
      if (body.includes('private subreddit') || body.includes('nsfw')) {
        return false;
      }

      // Only treat 403 as bot challenge when it looks like an active block.
      if (this.#isHtmlResponse(response)) {
        if (
          body.includes('captcha') ||
          body.includes('challenge') ||
          body.includes('blocked') ||
          body.includes('access denied') ||
          body.includes('cloudflare') ||
          body.includes('your request has been blocked') ||
          body.includes('unusual activity')
        ) {
          return true;
        }
      }

      // A bare 403 without block markers is not automatically a bot challenge.
      return false;
    }

    if (BOT_CHALLENGE_ERRORS.has(error)) return true;

    // Non-403 HTML responses can still contain bot challenge content (Cloudflare pages, etc.).
    if (this.#isHtmlResponse(response)) {
      const body = this.#getBody(response).toLowerCase();
      if (
        body.includes('captcha') ||
        body.includes('challenge') ||
        body.includes('blocked') ||
        body.includes('access denied') ||
        body.includes('cloudflare') ||
        body.includes('your request has been blocked') ||
        body.includes('unusual activity')
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
    const record = this.#getRecord(response);
    const data = record && typeof record.data === 'object' && record.data !== null
      ? /** @type {Record<string, unknown>} */ (record.data)
      : null;

    // Reddit returns { reason: 'private' } or { error: 'subreddit_private' } for private subs
    if (data && (data.reason === 'private' || data.error === 'private' || data.error === 'subreddit_private')) {
      return true;
    }

    // Top-level response objects may carry the private marker directly.
    if (record && (record.reason === 'private' || record.error === 'private' || record.error === 'subreddit_private')) {
      return true;
    }

    const body = this.#getBody(response).toLowerCase();
    const status = this.#getStatus(response);

    if (status === 401 || status === 403) {
      if (
        body.includes('sign in to view') ||
        body.includes('log in to view') ||
        body.includes('login to view') ||
        body.includes('private subreddit') ||
        body.includes('nsfw')
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
  isValidPayload(response) {
    if (this.isRateLimit(response) || this.isBotChallenge(response) || this.isAuthExpired(response) || this.isLoginWall(response)) {
      return false;
    }

    if (Array.isArray(response)) {
      return true;
    }

    const record = this.#getRecord(response);
    if (!record) return false;

    if (Array.isArray(record.data)) {
      return true;
    }

    if (record && typeof record.kind === 'string' && /^t[1-8]$/.test(record.kind) && typeof record.data === 'object' && record.data !== null) {
      return this.#looksLikeRedditPayload(record);
    }

    const data = typeof record.data === 'object' && record.data !== null
      ? /** @type {Record<string, unknown>} */ (record.data)
      : record;

    if (typeof data !== 'object' || data === null) {
      const body = this.#getBody(response);
      if (body) {
        try {
          const parsed = JSON.parse(body);
          if (this.#looksLikeRedditPayload(parsed)) return true;
        } catch {}
      }
      return false;
    }

    if (this.#looksLikeRedditPayload(data)) return true;

    return false;
  }

  /**
   * @param {unknown} value
   * @returns {boolean}
   */
  #looksLikeRedditPayload(value) {
    if (typeof value !== 'object' || value === null) return false;

    if (Array.isArray(value)) {
      return true;
    }

    const data = /** @type {Record<string, unknown>} */ (value);

    if (data.error !== undefined && data.error !== null) return false;

    // Reddit Listing shape: { kind: 'Listing', data: { children: [...], after, before } }
    if (data.kind === 'Listing' && typeof data.data === 'object' && data.data !== null) {
      return true;
    }

    // Reddit Thing shape: { kind: 't1'|'t2'|'t3'|'t5', data: { ... } }
    if (typeof data.kind === 'string' && /^t[1-8]$/.test(data.kind) && typeof data.data === 'object' && data.data !== null) {
      return true;
    }

    // Direct object with common Reddit fields
    if (typeof data.subreddit === 'string' && (typeof data.author === 'string' || typeof data.score === 'number')) {
      return true;
    }

    // OAuth token response
    if (typeof data.access_token === 'string' && typeof data.token_type === 'string') {
      return true;
    }

    // Empty but valid responses
    if (typeof data.children === 'object' && data.children !== null) {
      return true;
    }

    return false;
  }
}
