// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * MastodonPlatformResponseValidator — Mastodon REST API response validator.
 * Detects valid account/status/search payloads, rate-limits, auth failures,
 * and bot challenges from any Mastodon instance.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { AbstractPlatformResponseValidator } from '../../../core/platform-validator.js';

const RATE_LIMIT_STATUS = 429;
const FORBIDDEN_STATUS = 403;
const UNAUTHORIZED_STATUS = 401;

export class MastodonPlatformResponseValidator extends AbstractPlatformResponseValidator {
  /** @type {string} */
  platform = 'mastodon';

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
   * @returns {Record<string, unknown> | null}
   */
  #getData(response) {
    const record = this.#getRecord(response);
    if (!record) return null;

    if (typeof record.data === 'object' && record.data !== null) {
      return /** @type {Record<string, unknown>} */ (record.data);
    }

    if (typeof record.data === 'undefined' || record.data === null) {
      return record;
    }

    // Some transports return JSON in body string.
    const body = this.#getBody(response);
    if (body) {
      try {
        return /** @type {Record<string, unknown>} */ (JSON.parse(body));
      } catch {}
    }
    return null;
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
   * @param {unknown} response
   * @returns {boolean}
   */
  #isHtmlResponse(response) {
    const body = this.#getBody(response);
    return body.includes('<html') || body.includes('<!doctype');
  }

  /**
   * Lower-cased error text from the payload.
   * @param {unknown} response
   * @returns {string}
   */
  #getErrorText(response) {
    const data = this.#getData(response);
    if (!data) return '';

    const parts = [];
    if (typeof data.error === 'string') parts.push(data.error);
    if (typeof data.error_description === 'string') parts.push(data.error_description);

    return parts.join(' ').toLowerCase();
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
      const remaining = headers['x-ratelimit-remaining'] || headers['ratelimit-remaining'];
      if (remaining === '0') return true;
    }

    const errorText = this.#getErrorText(response);
    if (
      errorText.includes('too many requests') ||
      errorText.includes('rate limit') ||
      errorText.includes('throttled')
    ) {
      return true;
    }

    const body = this.#getBody(response).toLowerCase();
    if (this.#isHtmlResponse(response)) {
      if (
        body.includes('too many requests') ||
        body.includes('rate limit')
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

    const errorText = this.#getErrorText(response);
    if (
      errorText.includes('access token is invalid') ||
      errorText.includes('unauthenticated') ||
      errorText.includes('unauthorized') ||
      errorText.includes('invalid token') ||
      errorText.includes('invalid_token') ||
      errorText.includes('this api requires an authenticated user') ||
      errorText.includes('revoked')
    ) {
      return true;
    }

    const body = this.#getBody(response).toLowerCase();
    if (this.#isHtmlResponse(response)) {
      if (
        body.includes('access token is invalid') ||
        body.includes('this api requires an authenticated user')
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

    const errorText = this.#getErrorText(response);
    if (
      errorText.includes('this action is not allowed') ||
      errorText.includes('forbidden') ||
      errorText.includes('access denied') ||
      errorText.includes('blocked')
    ) {
      return true;
    }

    const body = this.#getBody(response).toLowerCase();
    if (this.#isHtmlResponse(response)) {
      if (
        body.includes('challenge') ||
        body.includes('captcha') ||
        body.includes('access denied') ||
        body.includes('blocked')
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
    const status = this.#getStatus(response);
    const body = this.#getBody(response).toLowerCase();

    if (status === 401 || status === 403) {
      if (
        body.includes('authorized fetch') ||
        body.includes('this api requires an authenticated user') ||
        body.includes('please sign in')
      ) {
        return true;
      }
    }

    const errorText = this.#getErrorText(response);
    if (
      errorText.includes('this api requires an authenticated user') ||
      errorText.includes('authorized fetch')
    ) {
      return true;
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

    // Direct array responses are common (timelines, search results).
    if (Array.isArray(response)) {
      return true;
    }

    const data = this.#getData(response);
    if (!data) {
      const record = this.#getRecord(response);
      if (record?.data === null || record?.data === undefined) return false;
      return false;
    }

    if (Array.isArray(data)) {
      return true;
    }

    if (typeof data !== 'object' || data === null) return false;

    // Error payload is not a valid payload.
    if (typeof data.error === 'string') return false;

    const payload = /** @type {Record<string, unknown>} */ (data);

    if (
      typeof payload.id === 'string' ||
      typeof payload.id === 'number' ||
      typeof payload.username === 'string' ||
      typeof payload.display_name === 'string' ||
      typeof payload.acct === 'string' ||
      typeof payload.content === 'string' ||
      typeof payload.url === 'string' ||
      typeof payload.uri === 'string' ||
      typeof payload.created_at === 'string' ||
      typeof payload.title === 'string' ||
      typeof payload.domain === 'string' ||
      typeof payload.version === 'string' ||
      typeof payload.email === 'string'
    ) {
      return true;
    }

    if (Array.isArray(payload.accounts) || Array.isArray(payload.statuses) || Array.isArray(payload.hashtags)) {
      return true;
    }

    if (Array.isArray(payload.mentions) || Array.isArray(payload.media_attachments) || Array.isArray(payload.tags)) {
      return true;
    }

    if (typeof payload.reblogs_count === 'number' || typeof payload.favourites_count === 'number') {
      return true;
    }

    if (typeof payload.ancestors === 'object' && payload.ancestors !== null ||
        typeof payload.descendants === 'object' && payload.descendants !== null) {
      return true;
    }

    if (typeof payload.following === 'boolean' || typeof payload.followed_by === 'boolean' || typeof payload.blocking === 'boolean') {
      return true;
    }

    if (payload.card && typeof payload.card === 'object') return true;

    if (Array.isArray(payload.rules) || Array.isArray(payload.languages)) {
      return true;
    }

    return false;
  }
}
