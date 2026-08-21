// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AbstractApiClient — platform-agnostic HTTP client contract with resilient
 * 429/403 auto-quarantine, exponential backoff with full jitter, account rotation,
 * and standby backoff request pipeline.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import {
  PlatformError,
  RateLimitError,
  BotChallengeError,
  AuthSessionExpiredError,
  ProxyDeadError,
  ErrorTypes,
  SuggestedActions,
} from './error-envelope.js';

/** @typedef {import('./types.js').AccountRecord} AccountRecord */

/**
 * @typedef {{ accountId?: string, requiresResidential?: boolean, headers?: Record<string, unknown>, body?: unknown, [key: string]: unknown }} RequestOptions
 */

/**
 * @typedef {Object} ProxyProviderLike
 * @property {() => boolean} isAllQuarantined
 * @property {(proxy: string | Record<string, unknown>, options?: Record<string, unknown>) => unknown} getProxyAgent
 * @property {(proxy?: string | Record<string, unknown>, durationMs?: number) => void} quarantine
 * @property {(options?: Record<string, unknown>) => (string | Record<string, unknown> | null)} [getProxy]
 * @property {(accountId: string) => (string | Record<string, unknown> | null)} [getStickyProxy]
 * @property {() => (string | Record<string, unknown> | null)} [getNext]
 * @property {() => (string | Record<string, unknown> | null)} [getRotatingProxy]
 * @property {() => (string | Record<string, unknown> | null)} [getRoundRobinProxy]
 * @property {(proxy: string | Record<string, unknown>, client?: string) => unknown} [createProxyAgent]
 */

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

  /** @type {import('./platform-validator.js').AbstractPlatformResponseValidator | null} */
  responseValidator = null;

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
   * @param {ProxyProviderLike} [options.proxyPool]
   * @param {ProxyProviderLike} [options.proxyProvider]
   * @param {import('./account-pool.js').AccountPool} [options.accountPool]
   * @param {import('./adaptive-governor.js').AdaptiveRateGovernor} [options.governor]
   * @param {import('./platform-validator.js').AbstractPlatformResponseValidator} [options.responseValidator]
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
    this.responseValidator = options.responseValidator || null;

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
   * Resolve proxy from proxyProvider or proxyPool.
   * Throws PROXY_EXHAUSTED if no proxy is available.
   * @param {string | AccountRecord | null} [accountId]
   * @param {boolean} [requiresResidential=false]
   * @returns {string | Record<string, unknown>}
   */
  resolveProxy(accountId, requiresResidential = false) {
    const rawAccountId = typeof accountId === 'string' ? accountId : accountId?.accountId;
    let proxy = null;

    if (this.proxyProvider && typeof this.proxyProvider.getProxy === 'function') {
      const opts = { accountId: rawAccountId, requiresResidential };
      proxy = this.proxyProvider.getProxy(opts);
    } else if (this.proxyPool) {
      if (requiresResidential) {
        throw new PlatformError({
          type: ErrorTypes.PROXY_EXHAUSTED,
          code: 'XACT_5030',
          message: `Residential proxy requested but proxyPool has no residential support on ${this.platform}`,
          statusCode: 503,
          suggestedAction: SuggestedActions.WAIT,
          retryAfterMs: this.standbyBackoffMs,
          accountId: rawAccountId,
          platform: this.platform,
        });
      }
      if (this.requiresAuth && rawAccountId && typeof this.proxyPool.getStickyProxy === 'function') {
        proxy = this.proxyPool.getStickyProxy(rawAccountId);
      } else if (typeof this.proxyPool.getNext === 'function') {
        proxy = this.proxyPool.getNext();
      } else if (typeof this.proxyPool.getRotatingProxy === 'function') {
        proxy = this.proxyPool.getRotatingProxy();
      } else if (typeof this.proxyPool.getRoundRobinProxy === 'function') {
        proxy = this.proxyPool.getRoundRobinProxy();
      }
    }

    if (!proxy) {
      if (this.requiresAuth && rawAccountId && this.accountPool) {
        this.accountPool.markUnavailable(rawAccountId, 'proxy_exhausted', this.standbyBackoffMs, this.platform);
      }
      throw new PlatformError({
        type: ErrorTypes.PROXY_EXHAUSTED,
        code: 'XACT_5030',
        message: 'Proxy pool exhausted: no healthy proxy available',
        statusCode: 503,
        suggestedAction: SuggestedActions.WAIT,
        retryAfterMs: this.standbyBackoffMs,
        accountId: rawAccountId,
        platform: this.platform,
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
   * @param {RequestOptions} [options]
   * @returns {Promise<unknown>}
   */
  async request(method, url, options = {}) {
    const opts = options || {};
    let currentAccountId = opts.accountId;

    if (this.requiresAuth && !currentAccountId && !this.accountPool) {
      throw new AuthSessionExpiredError({
        code: 'XACT_4010',
        message: `No account or account pool configured for authenticated ${this.platform} request`,
        statusCode: 401,
        suggestedAction: SuggestedActions.RELOGIN,
        platform: this.platform,
      });
    }

    // Check governor before request for auth-required platforms
    if (this.requiresAuth && currentAccountId && this.governor) {
      if (typeof this.governor.canAccountRequest === 'function') {
        const canRequest = this.governor.canAccountRequest(currentAccountId, this.platform);
        if (!canRequest) {
          throw new PlatformError({
            type: ErrorTypes.HIBERNATION,
            code: 'XACT_4291',
            message: `Account "${currentAccountId}" is hibernating or exceeded velocity limit`,
            statusCode: 429,
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
            statusCode: 503,
            suggestedAction: SuggestedActions.WAIT,
            retryAfterMs: this.standbyBackoffMs,
            accountId: currentAccountId,
            platform: this.platform,
          });
        }

        const proxy = this.resolveProxy(currentAccountId, opts.requiresResidential);

        let agent = null;
        if (proxy && provider && typeof provider.getProxyAgent === 'function') {
          agent = provider.getProxyAgent(proxy, { client: this.client });
        } else if (proxy && provider && typeof provider.createProxyAgent === 'function') {
          agent = provider.createProxyAgent(proxy, this.client);
        }

        if (typeof this.httpClient !== 'function') {
          throw new PlatformError({
            type: ErrorTypes.INTERNAL,
            code: 'XACT_5000',
            message: 'httpClient transport is not configured on client',
            statusCode: 500,
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
          if (this.responseValidator) {
            if (this.responseValidator.isRateLimit(response)) {
              const retryAfterHeader = response?.headers?.['retry-after'] || response?.headers?.['Retry-After'];
              const retryAfterMs = this.#parseRetryAfter(retryAfterHeader) || this.backoffBaseMs;
              if (this.requiresAuth && currentAccountId && this.accountPool) {
                this.accountPool.markUnavailable(currentAccountId, 'rate_limit', this.rateLimitHibernationMs, this.platform);
                if (this.governor && typeof this.governor.recordRateLimit === 'function') {
                  this.governor.recordRateLimit(currentAccountId, this.platform, this.rateLimitHibernationMs);
                }
              }
              throw new RateLimitError({
                code: 'XACT_4290',
                message: 'Rate limit payload detected from upstream platform',
                statusCode: 429,
                suggestedAction: this.requiresAuth ? SuggestedActions.ROTATE_ACCOUNT : SuggestedActions.ROTATE_PROXY,
                retryAfterMs,
                accountId: currentAccountId,
                platform: this.platform,
                details: response?.data || response,
              });
            }
            if (this.responseValidator.isBotChallenge(response)) {
              if (this.requiresAuth && currentAccountId && this.accountPool) {
                this.accountPool.markUnavailable(currentAccountId, 'bot_challenge', this.rateLimitHibernationMs, this.platform);
                if (this.governor && typeof this.governor.recordBotChallenge === 'function') {
                  this.governor.recordBotChallenge(currentAccountId, this.platform);
                }
              }
              throw new BotChallengeError({
                code: 'XACT_4030',
                message: 'Bot challenge detected on upstream platform',
                statusCode: 403,
                suggestedAction: this.requiresAuth ? SuggestedActions.ROTATE_ACCOUNT : SuggestedActions.ROTATE_PROXY,
                accountId: currentAccountId,
                platform: this.platform,
                details: response?.data || response,
              });
            }
            if (!this.responseValidator.isValidPayload(response)) {
              throw new PlatformError({
                type: ErrorTypes.INVALID_ARGS,
                code: 'XACT_4001',
                message: 'Response payload is invalid or corrupted',
                statusCode: 400,
                suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
                accountId: currentAccountId,
                platform: this.platform,
                details: response?.data || response,
              });
            }
          }

          const trackingKey = this.requiresAuth && currentAccountId ? currentAccountId : 'noauth';
          if (this.accountPool) {
            this.accountPool.recordRequest(trackingKey, this.platform);
          }
          if (
            this.governor &&
            typeof this.governor.recordRequest === 'function' &&
            (!this.accountPool || this.accountPool.governor !== this.governor)
          ) {
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
              statusCode: 503,
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
              if (this.governor && typeof this.governor.recordRateLimit === 'function') {
                this.governor.recordRateLimit(currentAccountId, this.platform, this.rateLimitHibernationMs);
              }

              const nextAccount = this.accountPool.getNextAvailable(this.platform);
              if (nextAccount && nextAccount !== currentAccountId) {
                currentAccountId = nextAccount;
                break; // Break inner proxy loop to start with new rotated account
              }
            }

            const errorClass = status === 429 ? RateLimitError : BotChallengeError;
            throw new errorClass({
              code: status === 429 ? 'XACT_4290' : 'XACT_4030',
              message: status === 429 ? 'Rate limit exceeded on upstream platform' : 'Bot challenge detected on upstream platform',
              suggestedAction: SuggestedActions.ROTATE_PROXY,
              retryAfterMs: chosenDelay,
              accountId: currentAccountId,
              platform: this.platform,
              details: response?.data || response,
            });
          }

          await this.#sleep(chosenDelay);
        } else {
          // Other status codes (401, 5xx, etc.)
          this.handleError(response, this.platform);
        }
      }

      accountRotationCount++;
    }

    throw new PlatformError({
      type: ErrorTypes.INTERNAL,
      code: 'XACT_5000',
      message: 'Request pipeline exhausted all retry and account rotation attempts',
      statusCode: 500,
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
   * Comprehensive error classification for non-2xx/3xx/429/403 responses.
   * @param {any} response
   * @param {string} platform
   * @returns {never}
   */
  handleError(response, platform) {
    const status = response?.status ?? 500;

    if (status === 401) {
      throw new AuthSessionExpiredError({
        code: 'XACT_4010',
        message: 'Authentication expired on upstream platform',
        statusCode: 401,
        suggestedAction: SuggestedActions.RELOGIN,
        platform,
        details: response?.data || response,
      });
    }

    if (status === 403) {
      throw new BotChallengeError({
        code: 'XACT_4030',
        message: 'Bot challenge detected on upstream platform',
        statusCode: 403,
        suggestedAction: SuggestedActions.ROTATE_PROXY,
        platform,
        details: response?.data || response,
      });
    }

    if (status === 429) {
      const retryAfterHeader = response?.headers?.['retry-after'] || response?.headers?.['Retry-After'];
      const retryAfterMs = this.#parseRetryAfter(retryAfterHeader);
      throw new RateLimitError({
        code: 'XACT_4290',
        message: 'Rate limit exceeded on upstream platform',
        statusCode: 429,
        suggestedAction: SuggestedActions.ROTATE_PROXY,
        retryAfterMs,
        platform,
        details: response?.data || response,
      });
    }

    if (status >= 500) {
      throw new ProxyDeadError({
        code: 'XACT_5030',
        message: `Upstream platform returned server error ${status}`,
        statusCode: status,
        suggestedAction: SuggestedActions.WAIT,
        platform,
        details: response?.data || response,
      });
    }

    throw new PlatformError({
      type: ErrorTypes.INTERNAL,
      code: 'XACT_5000',
      message: `Request failed with status ${status}`,
      statusCode: status,
      suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
      platform,
      details: response?.data || response,
    });
  }
}
