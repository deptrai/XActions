// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * ThreadsPlatformResponseValidator — Response validator for Threads (Meta GraphQL & SSR HTML).
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractPlatformResponseValidator } from '../../../core/platform-validator.js';

export class ThreadsPlatformResponseValidator extends AbstractPlatformResponseValidator {
  /** @type {string} */
  platform = 'threads';

  /**
   * @param {unknown} response
   * @returns {string}
   */
  #getBody(response) {
    if (typeof response === 'string') return response;
    const record = typeof response === 'object' && response ? /** @type {Record<string, unknown>} */ (response) : null;
    if (typeof record?.data === 'string') return record.data;
    if (typeof record?.body === 'string') return record.body;
    return '';
  }

  /**
   * @param {unknown} response
   * @returns {string}
   */
  #getUrl(response) {
    const record = typeof response === 'object' && response ? /** @type {Record<string, unknown>} */ (response) : null;
    const data = record?.data && typeof record.data === 'object' ? /** @type {Record<string, unknown>} */ (record.data) : null;
    return typeof record?.url === 'string' ? record.url : (typeof data?.url === 'string' ? data.url : '');
  }

  /**
   * Extract error-only text from response payload.
   * @param {unknown} response
   * @returns {string}
   */
  #getErrorText(response) {
    const record = typeof response === 'object' && response ? /** @type {Record<string, unknown>} */ (response) : null;
    const data = record?.data && typeof record.data === 'object' ? /** @type {Record<string, unknown>} */ (record.data) : null;
    const errors = data?.errors ?? record?.errors ?? (data?.error ? [data.error] : (record?.error ? [record.error] : null));
    if (Array.isArray(errors) && errors.length > 0) {
      try {
        return JSON.stringify(errors).toLowerCase();
      } catch {}
    }

    const body = this.#getBody(response);
    if (body && (body.includes('/checkpoint/') || body.includes('security check') || body.includes('challenge'))) {
      return body.toLowerCase();
    }

    return '';
  }

  /**
   * @param {unknown} response
   * @returns {boolean}
   */
  isValidPayload(response) {
    if (this.isRateLimit(response) || this.isBotChallenge(response)) {
      return false;
    }

    if (Array.isArray(response) || (typeof response === 'object' && response && Array.isArray(/** @type {Record<string, unknown>} */ (response).data))) {
      return true;
    }

    const record = typeof response === 'object' && response ? /** @type {Record<string, unknown>} */ (response) : null;
    let data = record?.data && typeof record.data === 'object' ? /** @type {Record<string, unknown>} */ (record.data) : null;
    
    // Unwrap nested data layers if any
    while (data && typeof data.data === 'object' && data.data && !Array.isArray(data.data)) {
      data = /** @type {Record<string, unknown>} */ (data.data);
    }

    // Allow GraphQL error envelopes to pass so client can classify them accurately
    if (data && (Array.isArray(data.errors) || Array.isArray(record?.errors))) {
      return true;
    }

    if (data && typeof data === 'object') {
      if (
        'mediaData' in data ||
        'containing_thread' in data ||
        'reply_threads' in data ||
        'user' in data ||
        'node' in data ||
        'threads' in data ||
        'posts' in data ||
        'edges' in data ||
        'feed' in data ||
        'searchResults' in data ||
        data.success !== undefined
      ) {
        return true;
      }
    }

    if (record && (record.id || record.pk || record.postUrl || record.content || record.caption)) {
      return true;
    }

    const body = this.#getBody(response);
    if (!body) return false;

    // Real content or page tokens check
    if (
      body.includes('["LSD"') ||
      body.includes('"LSD"') ||
      body.includes('name="lsd"') ||
      body.includes('window.__user_id') ||
      body.includes('BarcelonaProfileThreadsTabQuery') ||
      body.includes('BarcelonaPostPageQuery') ||
      /<article\b|div data-pressable-container=/i.test(body)
    ) {
      return true;
    }

    if (/<html/i.test(body) && (body.includes('role="main"') || body.includes('id="root"'))) {
      return true;
    }

    return false;
  }

  /**
   * @param {unknown} response
   * @returns {boolean}
   */
  isBotChallenge(response) {
    const url = this.#getUrl(response);
    if (/(?:threads\.net\/checkpoint|instagram\.com\/checkpoint|\/checkpoint\/)/i.test(url)) {
      return true;
    }

    const errorText = this.#getErrorText(response);
    if (
      errorText.includes('security check') ||
      errorText.includes('confirm your identity') ||
      errorText.includes('please confirm your identity') ||
      errorText.includes('/checkpoint/') ||
      errorText.includes('captcha') ||
      errorText.includes('checkpoint_required')
    ) {
      return true;
    }

    const record = typeof response === 'object' && response ? /** @type {Record<string, unknown>} */ (response) : null;
    const status = typeof record?.status === 'number' ? record.status : (typeof record?.statusCode === 'number' ? record.statusCode : null);
    if (status === 403) {
      return true;
    }

    return false;
  }

  /**
   * @param {unknown} response
   * @returns {boolean}
   */
  isRateLimit(response) {
    const record = typeof response === 'object' && response ? /** @type {Record<string, unknown>} */ (response) : null;
    const status = typeof record?.status === 'number' ? record.status : (typeof record?.statusCode === 'number' ? record.statusCode : null);
    if (status === 429) {
      return true;
    }

    const errorText = this.#getErrorText(response);
    if (
      errorText.includes("you're temporarily blocked") ||
      errorText.includes('you are temporarily blocked') ||
      errorText.includes('action blocked') ||
      errorText.includes('too many requests') ||
      errorText.includes('"code":368') ||
      errorText.includes('"code": 368') ||
      errorText.includes('rate_limit')
    ) {
      return true;
    }

    return false;
  }
}
