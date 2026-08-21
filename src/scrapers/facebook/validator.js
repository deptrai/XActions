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
   * @private
   * @param {any} response
   * @returns {string}
   */
  #getBody(response) {
    if (typeof response === 'string') return response;
    if (typeof response?.data === 'string') return response.data;
    if (typeof response?.body === 'string') return response.body;
    return '';
  }

  /**
   * @private
   * @param {any} response
   * @returns {string}
   */
  #getUrl(response) {
    return response?.url || response?.data?.url || '';
  }

  /**
   * @private
   * @param {any} response
   * @returns {string}
   */
  #getText(response) {
    if (typeof response?.data === 'object' && response.data !== null) {
      try {
        return JSON.stringify(response.data).toLowerCase();
      } catch {
        // ignore
      }
    }
    return this.#getBody(response).toLowerCase();
  }

  /**
   * @param {any} response
   * @returns {boolean}
   */
  isValidPayload(response) {
    if (this.isRateLimit(response) || this.isBotChallenge(response)) {
      return false;
    }

    if (Array.isArray(response) || Array.isArray(response?.data)) {
      return true;
    }

    const data = response?.data;
    if (data && typeof data === 'object' && (data.posts || data.profile || data.comments || data.nodes || data.viewer || data.user || data.name || data.id)) {
      return true;
    }

    if (response && typeof response === 'object' && (response.name || response.id || response.postUrl || response.content)) {
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
   * @param {any} response
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
      text.includes('captcha')
    ) {
      return true;
    }

    if (response?.status === 403) {
      return true;
    }

    return false;
  }

  /**
   * @param {any} response
   * @returns {boolean}
   */
  isRateLimit(response) {
    if (response?.status === 429) {
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
