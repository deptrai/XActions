// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * LinkedIn Platform Response Validator
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractPlatformResponseValidator } from '../../../core/platform-validator.js';

export class LinkedInPlatformResponseValidator extends AbstractPlatformResponseValidator {
  /** @type {string} */
  platform = 'linkedin';

  /**
   * Extract raw body string if available.
   * @param {any} response
   * @returns {string}
   */
  #getBody(response) {
    if (typeof response === 'string') return response;
    if (typeof response?.data === 'string') return response.data;
    if (typeof response?.body === 'string') return response.body;
    if (typeof response?.data?.data === 'string') return response.data.data;
    return '';
  }

  /**
   * @param {any} response
   * @returns {boolean}
   */
  isValidPayload(response) {
    if (this.isRateLimit(response) || this.isBotChallenge(response)) {
      return false;
    }

    const text = this.#getBody(response).toLowerCase();
    if (
      text.includes('base-card') ||
      text.includes('job-search-card') ||
      text.includes('jobposting') ||
      text.includes('top-card-layout') ||
      text.includes('topcard') ||
      text.includes('company') ||
      text.includes('profile')
    ) {
      return true;
    }

    if (response?.status === 200 || response?.statusCode === 200) {
      return true;
    }

    return false;
  }

  /**
   * @param {any} response
   * @returns {boolean}
   */
  isBotChallenge(response) {
    if (
      response?.status === 403 ||
      response?.statusCode === 403 ||
      response?.status === 999 ||
      response?.statusCode === 999
    ) {
      return true;
    }

    const text = this.#getBody(response).toLowerCase();
    if (
      text.includes('checkpoint_challenge') ||
      text.includes('/checkpoint/challenge') ||
      text.includes('security verification') ||
      text.includes('cf-browser-verification') ||
      text.includes('attention required! | cloudflare') ||
      text.includes('just a moment...') ||
      text.includes('authwall') ||
      text.includes('join linkedin to see') ||
      text.includes('request denied')
    ) {
      return true;
    }

    return false;
  }

  /**
   * @param {any} response
   * @returns {boolean}
   */
  isRateLimit(response) {
    if (response?.status === 429 || response?.statusCode === 429) {
      return true;
    }

    const text = this.#getBody(response).toLowerCase();
    if (text.includes('too many requests') || text.includes('rate limit exceeded')) {
      return true;
    }

    return false;
  }
}
