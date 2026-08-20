// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AbstractApiClient — platform-agnostic HTTP client contract with resilient
 * 429/403 auto-quarantine, exponential backoff with full jitter, account rotation,
 * and standby backoff request pipeline.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import { PlatformError, ErrorTypes, SuggestedActions } from './error-envelope.js';

const STANDBY_BACKOFF_MS = 30 * 1000;
const DEFAULT_QUARANTINE_MS = 5 * 60 * 1000;

export class AbstractApiClient {
  /** @type {string} */
  name = 'base';

  /** @type {string} */
  platform = 'twitter';

  /** @type {boolean} */
  requiresAuth = true;

  /** @type {'undici' | 'got'} */
  client = 'undici';

  /** @type {Function | null} */
  httpClient = null;

  /** @type {Object} */
  cookies = {};

  /** @type {number} */
  maxProxyRetries = 3;

  /** @type {number} */
  maxAccountRotations = 1;

  /** @type {number} */
  backoffBaseMs = 1000;

  /** @type {number} */
  backoffMultiplier = 2;

  /** @type {number} */
  maxBackoffMs = 30000;

  /** @type {number} */
  rateLimitHibernationMs = DEFAULT_QUARANTINE_MS;

  /** @type {number} */
  standbyBackoffMs = STANDBY_BACKOFF_MS;

  /**
   * @param {Object} [options]
   * @param {import('./session-manager.js').SessionManager} [options.sessionManager]
   * @param {import('../proxy/proxy-pool.js').ProxyIpPool} [options.proxyPool]
   * @param {import('../proxy/providers.js').ProxyProviderContract} [options.proxyProvider]
   * @param {import('./account-pool.js').AccountPool} [options.accountPool]
   * @param {import('./adaptive-governor.js').AdaptiveRateGovernor} [options.governor]
   * @param {string} [options.platform]
   * @param {'undici' | 'got'} [options.client]
   * @param {Function} [options.httpClient]
   * @param {boolean} [options.requiresAuth]
   * @param {number} [options.maxProxyRetries]
   * @param {number} [options.maxAccountRotations]
   * @param {number} [options.backoffBaseMs]
   * @param {number} [options.backoffMultiplier]
   * @param {number} [options.maxBackoffMs]
   * @param {number} [options.rateLimitHibernationMs]
   * @param {number} [options.standbyBackoffMs]
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

    if (options.platform !== undefined) this.platform = options.platform;
    if (options.client !== undefined) this.client = options.client;
    if (options.httpClient !== undefined) this.httpClient = options.httpClient;
    if (options.requiresAuth !== undefined) this.requiresAuth = options.requiresAuth;
    if (options.maxProxyRetries !== undefined) this.maxProxyRetries = options.maxProxyRetries;
    if (options.maxAccountRotations !== undefined) this.maxAccountRotations = options.maxAccountRotations;
    if (options.backoffBaseMs !== undefined) this.backoffBaseMs = options.backoffBaseMs;
    if (options.backoffMultiplier !== undefined) this.backoffMultiplier = options.backoffMultiplier;
    if (options.maxBackoffMs !== undefined) this.maxBackoffMs = options.maxBackoffMs;
    if (options.rateLimitHibernationMs !== undefined) this.rateLimitHibernationMs = options.rateLimitHibernationMs;
    if (options.standbyBackoffMs !== undefined) this.standbyBackoffMs = options.standbyBackoffMs;
  }

  /**
   * Parse Retry-After HTTP header in seconds or HTTP-date into milliseconds.
   * @param {string | number} [headerValue]
   * @returns {number}
   */
  #parseRetryAfter(headerValue) {
    if (!headerValue) return 0;
    const num = Number(headerValue);
    if (!Number.isNaN(num) && num > 0) {
      return num * 1000;
    }
    const dateMs = Date.parse(String(headerValue));
    if (!Number.isNaN(dateMs)) {
      const diff = dateMs - Date.now();
      return diff > 0 ? diff : 0;
    }
    return 0;
  }

  /**
   * Async sleep helper.
   * @param {number} ms
   * @returns {Promise<void>}
   */
  #sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
        retryAfterMs: this.standbyBackoffMs,
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
        retryAfterMs: this.standbyBackoffMs,
        accountId,
      });
    }

    if (!proxy) {
      // Enter standby backoff for the account, if registered, before throwing.
      if (this.accountPool && accountId && this.accountPool.getAccount(accountId)) {
        this.accountPool.markUnavailable(accountId, 'proxy_exhausted', this.standbyBackoffMs);
      }

      throw new PlatformError({
        type: ErrorTypes.PROXY_EXHAUSTED,
        code: 'XACT_5030',
        message: 'Proxy pool exhausted: no healthy proxy available',
        suggestedAction: SuggestedActions.WAIT,
        retryAfterMs: this.standbyBackoffMs,
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
   * Execute request through resilient interceptor pipeline (429/403 auto-quarantine,
   * exponential replay with jitter, account rotation, standby backoff).
   *
   * @param {string} method
   * @param {string} url
   * @param {Object} [options]
   * @returns {Promise<any>}
   */
  async request(method, url, options = {}) {
    const opts = options || {};
    let currentAccountId = opts.accountId;

    // Check governor before request for auth-required platforms
    if (this.requiresAuth && currentAccountId && this.governor) {
      if (typeof this.governor.canAccountRequest === 'function') {
        const canRequest = this.governor.canAccountRequest(currentAccountId, this.platform);
        if (!canRequest) {
          throw new PlatformError({
            type: ErrorTypes.HIBERNATION,
            code: 'XACT_4291',
            message: `Account "${currentAccountId}" is hibernating or exceeded velocity limit`,
            suggestedAction: SuggestedActions.ROTATE_ACCOUNT,
            accountId: currentAccountId,
            platform: this.platform,
          });
        }
      }
    }

    const provider = this.proxyProvider || this.proxyPool;
    let accountRotationCount = 0;

    while (accountRotationCount <= this.maxAccountRotations) {
      for (let attempt = 0; attempt < this.maxProxyRetries; attempt++) {
        // Check if pool is completely quarantined before attempting
        if (provider && typeof provider.isAllQuarantined === 'function' && provider.isAllQuarantined()) {
          if (currentAccountId && this.accountPool) {
            this.accountPool.markUnavailable(currentAccountId, 'proxy_exhausted', this.standbyBackoffMs, this.platform);
          }
          throw new PlatformError({
            type: ErrorTypes.PROXY_EXHAUSTED,
            code: 'XACT_5030',
            message: 'Proxy pool exhausted: all proxies quarantined in standby',
            suggestedAction: SuggestedActions.WAIT,
            retryAfterMs: this.standbyBackoffMs,
            accountId: currentAccountId,
            platform: this.platform,
          });
        }

        const proxy = this.resolveProxy(currentAccountId);

        let agent = null;
        if (proxy && provider && typeof provider.getProxyAgent === 'function') {
          agent = provider.getProxyAgent(proxy, { client: this.client });
        }

        if (typeof this.httpClient !== 'function') {
          throw new PlatformError({
            type: ErrorTypes.INTERNAL,
            code: 'XACT_5000',
            message: 'httpClient transport is not configured on client',
            suggestedAction: SuggestedActions.CONTACT_SUPPORT,
          });
        }

        let response;
        try {
          response = await this.httpClient({
            ...opts,
            method,
            url,
            proxy,
            agent,
            accountId: currentAccountId,
          });
        } catch (err) {
          if (err instanceof PlatformError && !err.isRetryable) {
            throw err;
          }
          response = {
            status: 503,
            headers: {},
            error: err,
          };
        }

        const status = response?.status ?? 500;

        // Success condition (2xx / 3xx)
        if (status >= 200 && status < 400) {
          const trackingKey = this.requiresAuth && currentAccountId ? currentAccountId : 'noauth';
          if (this.accountPool) {
            this.accountPool.recordRequest(trackingKey, this.platform);
          }
          if (this.governor && typeof this.governor.recordRequest === 'function') {
            this.governor.recordRequest(trackingKey, this.platform);
          }
          return response;
        }

        // Handle 429 (Rate Limit) or 403 (Bot Challenge)
        if (status === 429 || status === 403) {
          if (provider && typeof provider.quarantine === 'function') {
            provider.quarantine(proxy, this.rateLimitHibernationMs);
          }

          if (provider && typeof provider.isAllQuarantined === 'function' && provider.isAllQuarantined()) {
            if (currentAccountId && this.accountPool) {
              this.accountPool.markUnavailable(currentAccountId, 'proxy_exhausted', this.standbyBackoffMs, this.platform);
            }
            throw new PlatformError({
              type: ErrorTypes.PROXY_EXHAUSTED,
              code: 'XACT_5030',
              message: 'Proxy pool exhausted: all proxies quarantined in standby',
              suggestedAction: SuggestedActions.WAIT,
              retryAfterMs: this.standbyBackoffMs,
              accountId: currentAccountId,
              platform: this.platform,
            });
          }

          const baseDelay = this.backoffBaseMs * Math.pow(this.backoffMultiplier, attempt);
          const jitter = Math.random() * baseDelay;
          const exponentialDelay = baseDelay + jitter;
          const retryAfterHeader = response?.headers?.['retry-after'] || response?.headers?.['Retry-After'];
          const parsedRetryAfterMs = this.#parseRetryAfter(retryAfterHeader);
          const chosenDelay = Math.min(this.maxBackoffMs, Math.max(exponentialDelay, parsedRetryAfterMs));

          const isLastProxyAttempt = attempt === this.maxProxyRetries - 1;

          if (isLastProxyAttempt) {
            if (this.requiresAuth && currentAccountId && this.accountPool) {
              this.accountPool.markUnavailable(currentAccountId, 'rate_limit', this.rateLimitHibernationMs, this.platform);

              const nextAccount = this.accountPool.getNextAvailable(this.platform);
              if (nextAccount && nextAccount !== currentAccountId) {
                currentAccountId = nextAccount;
                break; // Break inner proxy loop to start with new rotated account
              }
            }

            throw new PlatformError({
              type: status === 429 ? ErrorTypes.RATE_LIMIT : ErrorTypes.BOT_CHALLENGE,
              code: status === 429 ? 'XACT_4290' : 'XACT_4030',
              message: status === 429 ? 'Rate limit exceeded on upstream platform' : 'Bot challenge detected on upstream platform',
              statusCode: status,
              suggestedAction: SuggestedActions.ROTATE_PROXY,
              retryAfterMs: chosenDelay,
              accountId: currentAccountId,
              platform: this.platform,
              details: response?.data || response,
            });
          }

          await this.#sleep(chosenDelay);
        } else {
          // Other unexpected status codes
          this.handleError(response, this.platform);
        }
      }

      accountRotationCount++;
    }

    throw new PlatformError({
      type: ErrorTypes.INTERNAL,
      code: 'XACT_5000',
      message: 'Request pipeline exhausted all retry and account rotation attempts',
      suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
      accountId: currentAccountId,
      platform: this.platform,
    });
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

