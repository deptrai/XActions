// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * FnbPlatformResponseValidator — recognizes F&B platform HTML responses and bot challenge pages.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractPlatformResponseValidator } from '../../../core/platform-validator.js';

const CHALLENGE_MARKERS = [
  'just a moment',
  'cloudflare',
  'checking your browser',
  'verify you are human',
  'captcha',
  'challenge',
  'access denied',
  'attention required',
];

const PLATFORM_STRUCTURAL_MARKERS = {
  pasgo: ['application/ld+json', 'schema.org/restaurant', 'schema.org/foodestablishment', 'itemtype='],
  foody: ['var jsondata', 'searchitems'],
  riviu: ['__nuxt__', 'window.__nuxt__', 'restaurant-card', 'location-card'],
};

const VIETNAMESE_FNB_TERMS = [
  'nhà hàng',
  'quán ăn',
  'quán cà phê',
  'quán cafe',
  'cà phê',
  'quán nhậu',
  'trà sữa',
  'tiệm bánh',
  'bánh mì',
  'buffet',
  'lẩu',
  'nướng',
  'thực đơn',
  'món ăn',
  'đặt bàn',
  'restaurant',
];

export class FnbPlatformResponseValidator extends AbstractPlatformResponseValidator {
  /** @type {string} */
  platform = 'fnb';

  /**
   * Extract raw body text if available.
   * @param {any} response
   * @returns {string}
   */
  #getText(response) {
    if (typeof response === 'string') return response.toLowerCase();

    const raw = response?.body ?? response?.data;
    if (typeof raw === 'string') return raw.toLowerCase();
    if (Buffer.isBuffer(raw)) return raw.toString('utf-8').toLowerCase();
    if (raw !== null && raw !== undefined && typeof raw === 'object') {
      try {
        return JSON.stringify(raw).toLowerCase();
      } catch {
        return '';
      }
    }
    return '';
  }

  /**
   * @param {any} response
   * @returns {boolean}
   */
  isRateLimit(response) {
    const status = response?.status ?? response?.statusCode;
    if (status === 429) return true;

    const text = this.#getText(response);
    return text.includes('rate limit') || text.includes('too many requests');
  }

  /**
   * @param {any} response
   * @returns {boolean}
   */
  isBotChallenge(response) {
    const status = response?.status ?? response?.statusCode;
    if (status === 403) return true;

    const text = this.#getText(response);
    return CHALLENGE_MARKERS.some((marker) => text.includes(marker));
  }

  /**
   * F&B platforms return HTML pages. Valid payloads are non-empty HTML strings
   * that contain recognizable F&B content and are not a challenge page.
   * @param {any} response
   * @returns {boolean}
   */
  isValidPayload(response) {
    if (this.isRateLimit(response) || this.isBotChallenge(response)) {
      return false;
    }

    const status = response?.status ?? response?.statusCode;
    if (status >= 400) return false;

    const text = this.#getText(response);
    if (!text || text.length < 50) return false;

    // Check platform-specific structural signals first.
    for (const markers of Object.values(PLATFORM_STRUCTURAL_MARKERS)) {
      if (markers.some((marker) => text.includes(marker))) return true;
    }

    // Fallback: require at least two corroborating Vietnamese F&B terms.
    let hits = 0;
    for (const term of VIETNAMESE_FNB_TERMS) {
      if (text.includes(term)) hits += 1;
      if (hits >= 2) return true;
    }

    return false;
  }

  /**
   * @param {any} response
   * @returns {boolean}
   */
  isLoginWall(response) {
    const text = this.#getText(response);
    return text.includes('đăng nhập') || text.includes('login') || text.includes('sign in');
  }

  /**
   * @param {any} response
   * @returns {boolean}
   */
  isAuthExpired(response) {
    const text = this.#getText(response);
    return text.includes('phiên đăng nhập') || text.includes('session expired');
  }
}
