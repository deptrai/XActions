// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TikTokShopPlatformResponseValidator — Response validator for TikTok Shop API.
 * Detects False 200 OK, bot/captcha/verify challenges, rate-limit payloads, and empty feeds.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractPlatformResponseValidator } from '../../../core/platform-validator.js';

const BOT_CHALLENGE_MARKERS = [
  'captcha',
  'verify',
  'verification',
  'challenge',
  'unusual activity',
  'suspicious activity',
  'access denied',
  'blocked',
  'rate limit',
];

export class TikTokShopPlatformResponseValidator extends AbstractPlatformResponseValidator {
  /** @type {string} */
  platform = 'tiktokshop';

  /**
   * @param {any} response
   * @returns {Record<string, unknown>}
   */
  #getData(response) {
    if (typeof response === 'object' && response !== null) {
      return /** @type {Record<string, unknown>} */ (response);
    }
    return {};
  }

  /**
   * @param {any} response
   * @returns {string}
   */
  #getBodyText(response) {
    const record = this.#getData(response);
    if (typeof record.body === 'string') return record.body;
    if (typeof record.data === 'string') return record.data;
    if (typeof record.text === 'string') return record.text;
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

    const record = this.#getData(response);
    const data = typeof record.data === 'object' && record.data !== null
      ? /** @type {Record<string, unknown>} */ (record.data)
      : record;

    const bodyText = this.#getBodyText(response);
    if (bodyText && (bodyText.trim().startsWith('<!DOCTYPE') || bodyText.trim().startsWith('<html'))) {
      return false;
    }

    // TikTok Shop APIs return a numeric `code`; 0 means success.
    const code = typeof data?.code === 'number' ? data.code : 0;
    if (code !== 0) return false;

    const message = typeof data?.message === 'string' ? data.message.toLowerCase() : '';
    if (message && (message.includes('error:') || message.includes('fail:') || message.includes('invalid request'))) {
      return false;
    }

    // Empty data is only valid if the message is success-like and code is 0.
    if (Object.keys(data).length === 0 && code !== 0) return false;

    return true;
  }

  /**
   * @param {any} response
   * @returns {boolean}
   */
  isBotChallenge(response) {
    const record = this.#getData(response);
    const data = typeof record.data === 'object' && record.data !== null
      ? /** @type {Record<string, unknown>} */ (record.data)
      : record;

    const bodyText = this.#getBodyText(response).toLowerCase();
    for (const marker of BOT_CHALLENGE_MARKERS) {
      if (bodyText.includes(marker)) return true;
    }

    if (bodyText && (bodyText.includes('<!doctype html') || bodyText.includes('<html'))) {
      return true;
    }

    const message = typeof data?.message === 'string' ? data.message.toLowerCase() : '';
    if (message && BOT_CHALLENGE_MARKERS.some((m) => message.includes(m))) return true;

    const code = typeof data?.code === 'number' ? data.code : 0;
    if (code !== 0) {
      const status = response?.status ?? response?.statusCode ?? 200;
      // Non-zero code on an otherwise HTTP 200 is treated as a soft block/challenge.
      if (status === 200 || status === 0) {
        return true;
      }
    }

    return false;
  }

  /**
   * @param {any} response
   * @returns {boolean}
   */
  isRateLimit(response) {
    const record = this.#getData(response);
    const data = typeof record.data === 'object' && record.data !== null
      ? /** @type {Record<string, unknown>} */ (record.data)
      : record;

    const status = response?.status ?? response?.statusCode;
    if (status === 429) return true;

    const code = typeof data?.code === 'number' ? data.code : 0;
    // TikTok Shop rate-limit codes are usually in the 3xxx/4xxx range.
    if (code >= 3000 && code < 5000) {
      const message = typeof data?.message === 'string' ? data.message.toLowerCase() : '';
      if (message.includes('rate limit') || message.includes('too many requests') || message.includes('throttle')) {
        return true;
      }
    }

    const message = typeof data?.message === 'string' ? data.message.toLowerCase() : '';
    if (message.includes('rate limit') || message.includes('too many requests') || message.includes('throttle')) {
      return true;
    }

    return false;
  }
}
