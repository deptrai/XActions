// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AbstractApiClient — platform-agnostic HTTP client contract.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { PlatformError } from './error-envelope.js';

export class AbstractApiClient {
  /** @type {string} */
  name = 'base';

  /** @type {any} */
  httpClient = null;

  /** @type {Object} */
  cookies = {};

  /**
   * @param {Object} [options]
   * @param {import('./session-manager.js').SessionManager} [options.sessionManager]
   * @param {import('../proxy/proxy-pool.js').ProxyIpPool} [options.proxyPool]
   */
  constructor(options = {}) {
    if (new.target === AbstractApiClient) {
      throw new TypeError('AbstractApiClient is abstract; extend it.');
    }
    this.sessionManager = options.sessionManager;
    this.proxyPool = options.proxyPool;
  }

  /**
   * @param {Object} session
   * @returns {Promise<void>}
   */
  async init(session) {
    throw new Error('Method not implemented: init(session)');
  }

  /**
   * @param {string} method
   * @param {string} url
   * @param {Object} [options]
   * @returns {Promise<any>}
   */
  async request(method, url, options = {}) {
    throw new Error('Method not implemented: request()');
  }

  /**
   * @param {Object} payload
   * @returns {Promise<any>}
   */
  async sign(payload) {
    throw new Error('Method not implemented: sign()');
  }

  /**
   * @param {Object} cookies
   * @returns {void}
   */
  updateCookies(cookies) {
    this.cookies = { ...this.cookies, ...cookies };
  }

  /**
   * @param {any} response
   * @param {string} platform
   * @returns {never | any}
   */
  handleError(response, platform) {
    throw new PlatformError({
      type: 'internal',
      message: 'Request failed',
      platform,
      suggestedAction: 'retry_after_delay',
    });
  }
}
