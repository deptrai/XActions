// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * ThreadsPlatformResponseValidator — Hybrid GraphQL & HTML response validator for Threads (threads.net).
 * Extends AbstractPlatformResponseValidator to detect valid payloads, bot challenges, rate limits, and empty data.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractPlatformResponseValidator } from '../../../core/platform-validator.js';

const BOT_CHALLENGE_PHRASES = [
  'security check',
  'confirm your identity',
  'please confirm your identity',
  '/checkpoint/',
  'captcha',
  'log in',
  'login',
  'đăng nhập',
  'iniciar sesión',
  'entrar',
  'se connecter',
  'challenge_required',
  'checkpoint_required',
];

const LOGIN_WALL_PHRASES = [
  'log in to threads',
  'log into threads',
  'log in with instagram',
  'threads - log in',
  'threads — log in',
  'threads – log in',
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
   * Check if the payload is structurally valid for Threads.
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
    while (data && typeof data === 'object' && typeof data.data === 'object' && data.data) {
      data = /** @type {Record<string, unknown>} */ (data.data);
    }

    // Allow GraphQL error envelopes to pass so client can classify them accurately
    if (data && (Array.isArray(data.errors) || Array.isArray(record?.errors))) {
      return true;
    }

    if (data && typeof data === 'object') {
      if (
        'userData' in data ||
        'mediaData' in data ||
        'containing_thread' in data ||
        'reply_threads' in data ||
        'searchResults' in data ||
        'threads' in data ||
        'edges' in data ||
        'user' in data ||
        'node' in data ||
        'feed' in data ||
        'posts' in data ||
        'comments' in data ||
        data.id ||
        data.pk ||
        data.success
      ) {
        return true;
      }
    }

    if (record && (record.id || record.pk || record.postUrl || record.content || record.username)) {
      return true;
    }

    const body = this.#getBody(response);
    if (!body) return false;

    // Real content, SSR data, or page tokens check
    if (
      (body.includes('LSD') || body.includes('name="lsd"') || body.includes('DTSGInitialData') || body.includes('"__spin_r"')) ||
      body.includes('window.__SHARED_DATA') ||
      body.includes('application/json')
    ) {
      return true;
    }

    if (/<html/i.test(body) && (body.includes('role="main"') || body.includes('id="root"') || body.includes('data-reactroot') || body.includes('threads.net'))) {
      return true;
    }

    return false;
  }

  /**
   * Check if response indicates a bot challenge / captcha / checkpoint.
   * @param {unknown} response
   * @returns {boolean}
   */
  isBotChallenge(response) {
    const url = this.#getUrl(response);
    if (/(?:threads\.net\/checkpoint|\/checkpoint\/|challenge)/i.test(url)) {
      return true;
    }

    const errorText = this.#getErrorText(response);
    if (BOT_CHALLENGE_PHRASES.some((phrase) => errorText.includes(phrase))) {
      return true;
    }

    const body = this.#getBody(response).toLowerCase();
    if (/<input[^>]+type=["']password["']/i.test(body)) {
      return true;
    }

    if (LOGIN_WALL_PHRASES.some((phrase) => body.includes(phrase))) {
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
   * Check if response indicates a rate limit.
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
      errorText.includes('rate limit') ||
      errorText.includes('"code":368') ||
      errorText.includes('"code": 368') ||
      errorText.includes('"code":1357004') ||
      errorText.includes('"code": 1357004')
    ) {
      return true;
    }

    return false;
  }
}
