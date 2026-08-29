// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TikTokPlatformResponseValidator — Response validator for TikTok Web API.
 * Detects False 200 OK, WAF/captcha challenges, rate-limit payloads, and empty feeds.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractPlatformResponseValidator } from '../../../core/platform-validator.js';

const BOT_CHALLENGE_MARKERS = [
  'captcha',
  'verify',
  'verification',
  'unusual activity',
  'suspicious activity',
  'access denied',
  'blocked',
  'challenge',
  'rate limit',
];

const RATE_LIMIT_STATUS_CODES = new Set([10029, 10031, 10032, 10033, 10035, 10036, 10037, 10038, 10039]);

export class TikTokPlatformResponseValidator extends AbstractPlatformResponseValidator {
  /** @type {string} */
  platform = 'tiktok';

  /**
   * @param {unknown} response
   * @returns {Record<string, unknown>}
   */
  #getData(response) {
    if (typeof response === 'object' && response !== null) {
      return /** @type {Record<string, unknown>} */ (response);
    }
    return {};
  }

  /**
   * @param {unknown} response
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
   * @param {unknown} response
   * @returns {boolean}
   */
  isValidPayload(response) {
    const record = this.#getData(response);
    const data = typeof record.data === 'object' && record.data !== null
      ? /** @type {Record<string, unknown>} */ (record.data)
      : record;

    // If the body is HTML, it's almost certainly a challenge page.
    const bodyText = this.#getBodyText(response);
    if (bodyText && (bodyText.trim().startsWith('<!DOCTYPE') || bodyText.trim().startsWith('<html'))) {
      return false;
    }

    // TikTok Web API often wraps response in status_code / status_msg.
    const statusCode = typeof data?.status_code === 'number' ? data.status_code : 0;
    if (statusCode !== 0) return false;

    const statusMsg = typeof data?.status_msg === 'string' ? data.status_msg.toLowerCase() : '';
    if (statusMsg && (statusMsg.includes('error') || statusMsg.includes('fail') || statusMsg.includes('invalid'))) {
      return false;
    }

    // Check explicit error field used by some TikTok endpoints.
    const error = data?.error;
    if (error !== undefined && error !== 0 && error !== null) {
      return false;
    }

    // Feed/list endpoints should have non-empty item_list or comments.
    const itemList = Array.isArray(data?.item_list) ? data.item_list : null;
    const comments = Array.isArray(data?.comments) ? data.comments : null;

    if (itemList !== null && itemList.length === 0) {
      // Empty list may indicate a shadow block or malformed request.
      return false;
    }
    if (comments !== null && comments.length === 0) {
      // Empty comments is valid if there are no comments, but we require callers
      // to validate with maxComments context. Here we only reject if the payload
      // is otherwise anomalous (e.g. missing expected fields).
    }

    // Single item endpoints should have an aweme_detail or item.
    const detail = data?.aweme_detail ?? data?.item;
    if (itemList === null && comments === null && detail === undefined) {
      // Could be a non-feed response; do not reject blindly.
      // But if the body is empty, reject.
      if (Object.keys(data).length === 0) return false;
    }

    return true;
  }

  /**
   * @param {unknown} response
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

    // HTML page served for JSON API request is a strong bot signal.
    if (bodyText && (bodyText.includes('<!doctype html') || bodyText.includes('<html'))) {
      return true;
    }

    const statusMsg = typeof data?.status_msg === 'string' ? data.status_msg.toLowerCase() : '';
    if (statusMsg && BOT_CHALLENGE_MARKERS.some((m) => statusMsg.includes(m))) return true;

    // Empty item list after a successful 200 can be a soft block.
    const itemList = data?.item_list;
    if (Array.isArray(itemList) && itemList.length === 0 && Object.keys(data).length <= 3) {
      return true;
    }

    return false;
  }

  /**
   * @param {unknown} response
   * @returns {boolean}
   */
  isRateLimit(response) {
    const record = this.#getData(response);
    const data = typeof record.data === 'object' && record.data !== null
      ? /** @type {Record<string, unknown>} */ (record.data)
      : record;

    const statusCode = typeof data?.status_code === 'number' ? data.status_code : 0;
    if (RATE_LIMIT_STATUS_CODES.has(statusCode)) return true;

    const statusMsg = typeof data?.status_msg === 'string' ? data.status_msg.toLowerCase() : '';
    if (statusMsg.includes('rate limit') || statusMsg.includes('too many requests') || statusMsg.includes('throttle')) {
      return true;
    }

    return false;
  }

  /**
   * @param {unknown} response
   * @returns {boolean}
   */
  isLoginWall(response) {
    const record = this.#getData(response);
    const data = typeof record.data === 'object' && record.data !== null
      ? /** @type {Record<string, unknown>} */ (record.data)
      : record;

    const statusMsg = typeof data?.status_msg === 'string' ? data.status_msg.toLowerCase() : '';
    return statusMsg.includes('login') || statusMsg.includes('log in') || statusMsg.includes('sign in');
  }
}
