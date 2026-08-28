// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * ThreadsPlatformResponseValidator — Hybrid GraphQL & HTML response validator for Meta Threads.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractPlatformResponseValidator } from '../../../core/platform-validator.js';

const BOT_CHALLENGE_PHRASES = [
  'security check',
  'challenge',
  'checkpoint',
  'captcha',
  'please verify your account',
  'unusual activity',
];

const LOGIN_WALL_PHRASES = [
  'log in to threads',
  'log into threads',
  'sign up for threads',
  'threads - log in',
];

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
    if (data && typeof data.data === 'object' && data.data) {
      data = /** @type {Record<string, unknown>} */ (data.data);
    }

    // Allow GraphQL error envelopes to pass so client can classify them accurately
    if (data && (Array.isArray(data.errors) || Array.isArray(record?.errors))) {
      return true;
    }

    if (data && typeof data === 'object') {
      if (
        'userData' in data ||
        'node' in data ||
        'user' in data ||
        'mediaData' in data ||
        'feed' in data ||
        'searchResults' in data ||
        data.profiles ||
        data.posts ||
        data.comments ||
        data.id ||
        data.username
      ) {
        return true;
      }
    }

    if (record && (record.name || record.id || record.username || record.profileUrl)) {
      return true;
    }

    const body = this.#getBody(response);
    if (!body) return false;

    // Real content or page tokens check
    if (
      body.includes('window.__user_id') ||
      body.includes('window.__LSD__') ||
      body.includes('name="lsd"') ||
      body.includes('og:title')
    ) {
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
    if (/(?:checkpoint|challenge|captcha)/i.test(url)) {
      return true;
    }

    const body = this.#getBody(response).toLowerCase();
    if (BOT_CHALLENGE_PHRASES.some((phrase) => body.includes(phrase))) {
      return true;
    }

    if (LOGIN_WALL_PHRASES.some((phrase) => body.includes(phrase)) && !body.includes('og:description')) {
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

    const body = this.#getBody(response).toLowerCase();
    if (
      body.includes('please wait a few minutes') ||
      body.includes('rate limit exceeded') ||
      body.includes('too many requests')
    ) {
      return true;
    }

    return false;
  }
}
