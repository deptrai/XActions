// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * FacebookPlatformResponseValidator — recognizes HTML and normalized payload shapes.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { AbstractPlatformResponseValidator } from '../../core/platform-validator.js';

export class FacebookPlatformResponseValidator extends AbstractPlatformResponseValidator {
  /** @type {string} */
  platform = 'facebook';

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
   * @param {unknown} response
   * @returns {string}
   */
  #getText(response) {
    const body = this.#getBody(response);
    if (body) return body.toLowerCase();

    // Only inspect explicit error arrays inside object payloads,
    // never the full parsed data object (could contain benign matching text).
    const record = typeof response === 'object' && response ? /** @type {Record<string, unknown>} */ (response) : null;
    const data = record?.data && typeof record.data === 'object' ? /** @type {Record<string, unknown>} */ (record.data) : null;
    const errors = data?.errors ?? record?.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      try {
        return JSON.stringify(errors).toLowerCase();
      } catch {
        // ignore
      }
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
    const data = record?.data && typeof record.data === 'object' ? /** @type {Record<string, unknown>} */ (record.data) : null;
    if (data && (data.posts || data.profile || data.comments || data.nodes || data.viewer || data.user || data.name || data.id)) {
      return true;
    }

    if (record && (record.name || record.id || record.postUrl || record.content)) {
      return true;
    }

    const body = this.#getBody(response);
    if (!body) return false;

    // mbasic login wall: short or stripped page with only login prompt
    if (/log\s*in\s*to\s*facebook|create\s*new\s*account/i.test(body) && !/<article\b|data-ft=/i.test(body)) {
      return false;
    }

    // A real profile or post page has an article / data-ft / story container
    if (/<article\b|data-ft=|div class=".*story"/i.test(body)) {
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
    if (/(?:facebook\.com\/checkpoint|\/checkpoint\/)/i.test(url)) {
      return true;
    }

    const text = this.#getText(response);
    if (
      text.includes('security check') ||
      text.includes('confirm your identity') ||
      text.includes('please confirm your identity') ||
      text.includes('/checkpoint/') ||
      text.includes('captcha') ||
      /log\s*in\s*to\s*facebook|create\s*new\s*account|log\s*in\s*to\s*continue|you\s*must\s*log\s*in/.test(text)
    ) {
      return true;
    }

    const record = typeof response === 'object' && response ? /** @type {Record<string, unknown>} */ (response) : null;
    if (typeof record?.status === 'number' && record.status === 403) {
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
    if (typeof record?.status === 'number' && record.status === 429) {
      return true;
    }

    const text = this.#getText(response);
    if (
      text.includes("you're temporarily blocked") ||
      text.includes('you are temporarily blocked') ||
      text.includes('action blocked') ||
      text.includes('too many requests') ||
      text.includes('rate limit')
    ) {
      return true;
    }

    return false;
  }
}
