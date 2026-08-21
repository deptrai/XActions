// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TwitterPlatformResponseValidator — recognizes GraphQL and HTML payload shapes.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { AbstractPlatformResponseValidator } from '../../core/platform-validator.js';

export class TwitterPlatformResponseValidator extends AbstractPlatformResponseValidator {
  /**
   * Extract raw body string if available.
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
   * Extract lowercased body text.
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
    if (this.isRateLimit(response) || this.isBotChallenge(response)) {
      return false;
    }

    // GraphQL response structure
    const data = response?.data;
    if (data && typeof data === 'object') {
      if (data.user?.result?.rest_id && data.user?.result?.legacy) return true;
      if (Array.isArray(data.user?.result?.timeline_v2?.timeline?.instructions)) return true;
      if (data.tweetResult?.result?.__typename === 'Tweet' || data.tweetResult?.result?.__typename === 'TweetTombstone' || data.tweetResult?.result?.rest_id) return true;
      if (Array.isArray(data.threaded_conversation_with_injections_v2?.instructions)) return true;
      if (Array.isArray(data.instructions)) return true;
    }

    if (Array.isArray(response) || Array.isArray(response?.data)) {
      return true;
    }

    const text = this.#getText(response);
    if (text.includes('<html') && !text.includes('cf-browser-verification') && !text.includes('captcha')) {
      return true;
    }

    return false;
  }

  /**
   * @param {any} response
   * @returns {boolean}
   */
  isBotChallenge(response) {
    if (response?.status === 403) return true;

    const text = this.#getText(response);
    if (
      text.includes('cf-browser-verification') ||
      text.includes('challenge') ||
      text.includes('captcha') ||
      text.includes('incapsula') ||
      text.includes('access denied') ||
      text.includes('just a moment')
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
    if (response?.status === 429) return true;

    // Check GraphQL errors
    const errors = response?.errors || response?.data?.errors;
    if (Array.isArray(errors)) {
      for (const err of errors) {
        if (err?.code === 88) return true;
        const msg = String(err?.message || '').toLowerCase();
        if (
          msg.includes('rate limit') ||
          msg.includes('too many') ||
          msg.includes('to protect our users from spam')
        ) {
          return true;
        }
      }
    }

    const text = this.#getText(response);
    if (
      text.includes('rate limit') ||
      text.includes('too many requests')
    ) {
      return true;
    }

    return false;
  }
}
