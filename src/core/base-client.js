// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AbstractApiClient — platform-agnostic HTTP client contract.
 * Supports two proxy strategies:
 *  - requiresAuth=true  → sticky IP per account (via ProxyIpPool.getStickyProxy)
 *  - requiresAuth=false → rotating residential IP per request (via ProxyIpPool.getNext)
 * @author nich (@nichxbt)
 * @license MIT
 */

import { PlatformError, ErrorTypes, SuggestedActions } from './error-envelope.js';

const STANDBY_BACKOFF_MS = 30 * 1000;

export class AbstractApiClient {
  /** @type {string} */
  name = 'base';

  /** @type {boolean} */
  requiresAuth = true;

  /** @type {any} */
  httpClient = null;

  /** @type {Object} */
  cookies = {};

  /**
   * @param {Object} [options]
   * @param {import('./session-manager.js').SessionManager} [options.sessionManager]
   * @param {import('../proxy/proxy-pool.js').ProxyIpPool} [options.proxyPool]
   * @param {import('./account-pool.js').AccountPool} [options.accountPool]
   * @param {import('./adaptive-governor.js').AdaptiveRateGovernor} [options.governor]
   */
  constructor(options = {}) {
    if (new.target === AbstractApiClient) {
      throw new TypeError('AbstractApiClient is abstract; extend it.');
    }
    this.sessionManager = options.sessionManager;
    this.proxyPool = options.proxyPool;
    this.proxyProvider = options.proxyProvider;
    this.accountPool = options.accountPool;
    this.governor = options.governor;
  }

  /**
   * Resolve the correct proxy for the request:
   * - authenticated platforms: sticky IP per account
   * - no-auth platforms: rotating IP from pool
   *
   * Throws a `proxy_exhausted` PlatformError instead of returning `null` so that
   * callers cannot accidentally initiate an unproxied request.
   *
   * @param {string} [accountId]
   * @returns {any}
   */
  resolveProxy(accountId) {
    const provider = this.proxyProvider || this.proxyPool;
    if (!provider) {
      throw new PlatformError({
        type: ErrorTypes.PROXY_EXHAUSTED,
        code: 'XACT_5030',
        message: 'Proxy provider not configured',
        suggestedAction: SuggestedActions.WAIT,
        retryAfterMs: STANDBY_BACKOFF_MS,
        accountId,
      });
    }

    const hasGetProxy = typeof provider.getProxy === 'function';
    const hasGetStickyProxy = typeof provider.getStickyProxy === 'function';
    const hasGetNext = typeof provider.getNext === 'function';
    const hasQuarantine = typeof provider.quarantine === 'function';

    const hasContract = (hasGetProxy || (hasGetStickyProxy && hasGetNext)) && hasQuarantine;
    if (!hasContract) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Provider does not implement the proxy contract',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        accountId,
      });
    }

    let proxy;
    if (hasGetProxy) {
      proxy = this.requiresAuth && accountId
        ? provider.getProxy({ accountId })
        : provider.getProxy();
    } else if (hasGetStickyProxy && hasGetNext) {
      proxy = this.requiresAuth && accountId
        ? provider.getStickyProxy(accountId)
        : provider.getNext();
    } else {
      throw new PlatformError({
        type: ErrorTypes.PROXY_EXHAUSTED,
        code: 'XACT_5030',
        message: 'Provider has no proxy allocation method',
        suggestedAction: SuggestedActions.WAIT,
        retryAfterMs: STANDBY_BACKOFF_MS,
        accountId,
      });
    }

    if (!proxy) {
      // Enter standby backoff for the account, if registered, before throwing.
      if (this.accountPool && accountId && this.accountPool.getAccount(accountId)) {
        this.accountPool.markUnavailable(accountId, 'proxy_exhausted', STANDBY_BACKOFF_MS);
      }

      throw new PlatformError({
        type: ErrorTypes.PROXY_EXHAUSTED,
        code: 'XACT_5030',
        message: 'Proxy pool exhausted: no healthy proxy available',
        suggestedAction: SuggestedActions.WAIT,
        retryAfterMs: STANDBY_BACKOFF_MS,
        accountId,
      });
    }

    return proxy;
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
      type: ErrorTypes.INTERNAL,
      message: 'Request failed',
      platform,
      suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
      details: response,
    });
  }
}
