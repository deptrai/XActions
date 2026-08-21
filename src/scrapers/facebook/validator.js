// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * FacebookPlatformResponseValidator — recognizes HTML and normalized payload shapes.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { AbstractPlatformResponseValidator } from '../../core/platform-validator.js';

export class FacebookPlatformResponseValidator extends AbstractPlatformResponseValidator {
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
    return this.#getBody(response).toLowerCase();
  }

  /**
   * @param {any} response
   * @returns {boolean}
   */
  isValidPayload(response) {
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

    // mbasic login wall: very short page with only login prompt
    if (body.length < 500 && /log\s*in\s*to\s*facebook|create\s*new\s*account/i.test(body)) {
      return false;
    }

    // A real profile or post page has an article / data-ft / post container
    if (/<article\b|data-ft=|role="main"|id="root"|div class=".*story"/i.test(body)) {
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
    if (/checkpoint|facebook\.com\/checkpoint/i.test(url)) {
      return true;
    }

    const text = this.#getText(response);
    if (
      text.includes('checkpoint') ||
      text.includes('security check') ||
      text.includes('confirm your identity') ||
      text.includes('suspicious activity') ||
      text.includes('captcha') ||
      text.includes('please confirm your identity')
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
      text.includes('too many') ||
      text.includes('rate limit') ||
      text.includes('unusual activity')
    ) {
      return true;
    }

    return false;
  }
}
