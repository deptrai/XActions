// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AbstractApiClient — platform-agnostic HTTP client contract with resilient
 * 429/403 auto-quarantine, exponential backoff with full jitter, account rotation,
 * and standby backoff request pipeline.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
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
 * @typedef {{ accountId?: string, requiresResidential?: boolean, headers?: Record<string, unknown>, body?: unknown,
 *   pool?: ('realtime' | 'bulk'), consumerId?: ('nowing' | 'chainlens' | 'internal' | string), [key: string]: unknown }} RequestOptions
 */

/**
 * @typedef {Object} ProxyProviderLike
 * @property {() => boolean} isAllQuarantined
 * @property {(proxy: string | Record<string, unknown>, options?: Record<string, unknown>) => unknown} getProxyAgent
 * @property {(proxy?: string | Record<string, unknown>, durationMs?: number) => void} quarantine
 * @property {(options?: Record<string, unknown>) => (string | Record<string, unknown> | null)} [getProxy]
 * @property {(accountId: string, requiresResidential?: boolean, options?: { pool?: ('realtime' | 'bulk') }) => (string | Record<string, unknown> | null)} [getStickyProxy]
 * @property {(requiresResidential?: boolean) => (string | Record<string, unknown> | null)} [getNext]
 * @property {(requiresResidential?: boolean) => (string | Record<string, unknown> | null)} [getRotatingProxy]
 * @property {(requiresResidential?: boolean) => (string | Record<string, unknown> | null)} [getRoundRobinProxy]
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

  /** @type {Record<string, string>} */
  cookies = {};

  /** @type {import('./signer-pool.js').PreSignedTokenRing | null} */
  tokenRing = null;

  /** @type {import('./signer-pool.js').SignerWorkerPagePool | null} */
  signerPool = null;

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
   * @param {import('./signer-pool.js').PreSignedTokenRing} [options.tokenRing]
   * @param {import('./signer-pool.js').SignerWorkerPagePool} [options.signerPool]
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
   * @param {number} [options.timeout]
   * @param {boolean} [options.requiresProxy]
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
    this.tokenRing = options.tokenRing || null;
    this.signerPool = options.signerPool || null;

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
    this.timeout = options.timeout ?? 30000;
    this.requiresProxy = options.requiresProxy ?? false;
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
      if (num > 1000000000) {
        const diff = num * 1000 - Date.now();
        return diff > 0 ? diff : 0;
      }
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
   *
   * Backward compatible: when `options.pool` is omitted the legacy whole-pool
   * sticky/round-robin behavior is preserved. When a dual-pool partition is
   * requested ('realtime' | 'bulk'), the pool is selected through
   * ProxyIpPool.getProxy({ pool, ... }) (AD-20).
   *
   * @param {string | AccountRecord | null} [accountId]
   * @param {boolean} [requiresResidential=false]
   * @param {boolean} [requiresAuth] - Effective auth mode for this specific request/action; defaults to instance requiresAuth.
   * @param {Object} [options]
   * @param {('realtime' | 'bulk')} [options.pool] - Dual-pool partition (AD-20).
   * @param {string} [options.consumerId] - Consumer identity for observability (AD-20).
   * @returns {string | Record<string, unknown> | null}
   */
  resolveProxy(accountId, requiresResidential = false, requiresAuth = this.requiresAuth, options = {}) {
    const safeOptions = options || {};
    const rawAccountId = typeof accountId === 'string' ? accountId : accountId?.accountId;
    const pool = typeof safeOptions.pool === 'string' ? safeOptions.pool : null;
    let proxy = null;

    if (this.proxyProvider && typeof this.proxyProvider.getProxy === 'function') {
      const opts = { accountId: rawAccountId, requiresResidential, pool: pool || undefined, consumerId: safeOptions.consumerId };
      proxy = this.proxyProvider.getProxy(opts);
    } else if (this.proxyPool) {
      if (requiresAuth && rawAccountId && typeof this.proxyPool.getStickyProxy === 'function') {
        proxy = this.proxyPool.getStickyProxy(rawAccountId, requiresResidential, pool ? { pool } : undefined);
      } else if (pool && typeof this.proxyPool.getProxy === 'function') {
        proxy = this.proxyPool.getProxy({
          pool,
          requiresResidential,
          yieldFromBulk: pool === 'realtime',
        });
      } else if (typeof this.proxyPool.getNext === 'function') {
        proxy = this.proxyPool.getNext(requiresResidential);
      } else if (typeof this.proxyPool.getRotatingProxy === 'function') {
        proxy = this.proxyPool.getRotatingProxy(requiresResidential);
      } else if (typeof this.proxyPool.getRoundRobinProxy === 'function') {
        proxy = this.proxyPool.getRoundRobinProxy(requiresResidential);
      }
    }

    if (!proxy) {
      if (requiresAuth && rawAccountId && this.accountPool) {
        this.accountPool.markUnavailable(rawAccountId, 'proxy_exhausted', this.standbyBackoffMs, this.platform);
      }
      throw new PlatformError({
        type: ErrorTypes.PROXY_EXHAUSTED,
        code: 'XACT_5030',
        message: 'Proxy pool exhausted: no healthy proxy available',
        statusCode: 503,
        suggestedAction: SuggestedActions.WAIT,
        retryAfterMs: this.standbyBackoffMs,
        accountId: rawAccountId || null,
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
   * Default HTTP transport factory for got-scraping or undici.fetch().
   * @returns {Promise<Function>}
   */
  async #getDefaultHttpClient() {
    if (this.client === 'got') {
      const { gotScraping } = await import('got-scraping');
      return async (/** @type {Record<string, any>} */ reqOpts) => {
        const { method, url, headers, body, json, proxy, timeout, raw } = reqOpts;
        if (!/^https?:\/\//i.test(url)) {
          throw new PlatformError({
            type: ErrorTypes.INVALID_ARGS,
            code: 'XACT_4001',
            message: 'Absolute URL is required for default HTTP client',
            statusCode: 400,
            suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
            platform: this.platform,
          });
        }
        /** @type {Record<string, any>} */
        const options = {
          method,
          url,
          headers: headers || {},
          timeout: { request: timeout === undefined ? 30000 : timeout },
          throwHttpErrors: false,
        };
        if (raw) {
          options.responseType = 'buffer';
          options.resolveBodyOnly = false;
        }
        if (json !== undefined) {
          options.json = json;
        } else if (body !== undefined) {
          options.body = this.#normalizeRequestBody(body, headers);
        }
        if (proxy) {
          const { getProxyAgent } = await import('../proxy/index.js');
          const proxyUrl = getProxyAgent(proxy, { client: 'got' });
          if (typeof proxyUrl === 'string') options.proxyUrl = proxyUrl;
        }
        const resp = await gotScraping(options);
        if (raw) {
          return {
            status: resp.statusCode,
            headers: resp.headers,
            data: undefined,
            body: resp.body,
          };
        }
        let data = resp.body;
        if (typeof resp.body === 'string') {
          try {
            data = JSON.parse(resp.body);
          } catch {}
        }
        return {
          status: resp.statusCode,
          headers: resp.headers,
          data,
        };
      };
    }

    // Default: undici
    const { fetch: undiciFetch } = await import('undici');
    return async (/** @type {Record<string, any>} */ reqOpts) => {
      const { method, url, headers, body, json, agent, timeout, raw } = reqOpts;
      if (!/^https?:\/\//i.test(url)) {
        throw new PlatformError({
          type: ErrorTypes.INVALID_ARGS,
          code: 'XACT_4001',
          message: 'Absolute URL is required for default HTTP client',
          statusCode: 400,
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
          platform: this.platform,
        });
      }
      /** @type {Record<string, any>} */
      const fetchOpts = {
        method,
        headers: { ...(headers || {}) },
        signal: AbortSignal.timeout(timeout === undefined ? 30000 : timeout),
      };
      if (agent) {
        fetchOpts.dispatcher = agent;
      }
      if (json !== undefined) {
        if (!this.#hasHeader(headers, 'content-type')) {
          fetchOpts.headers['content-type'] = 'application/json';
        }
        fetchOpts.body = JSON.stringify(json);
      } else if (body !== undefined) {
        const normalized = this.#normalizeRequestBody(body, headers);
        if (normalized !== body) {
          if (!this.#hasHeader(headers, 'content-type')) {
            fetchOpts.headers['content-type'] = 'application/json';
          }
        }
        fetchOpts.body = normalized;
      }
      const resp = await undiciFetch(url, fetchOpts);
      if (raw) {
        return {
          status: resp.status,
          headers: Object.fromEntries(resp.headers.entries()),
          data: undefined,
          body: resp.body,
        };
      }
      let data;
      const text = await resp.text();
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return {
        status: resp.status,
        headers: Object.fromEntries(resp.headers.entries()),
        data,
      };
    };
  }

  /**
   * Execute request with tiered signing (PreSignedTokenRing, SignerWorkerPagePool, or custom sign()).
   *
   * @param {string} method
   * @param {string} url
   * @param {Object} [payload={}]
   * @param {string} [payload.signType='token'] - 'token' | 'page' | 'custom'
   * @param {'header' | 'query' | 'cookie'} [payload.location='header']
   * @param {string} [payload.name='authorization']
   * @param {string} [payload.prefix='']
   * @param {string | Function} [payload.script]
   * @param {any[]} [payload.args]
   * @param {number} [payload.timeoutMs]
   * @param {boolean} [payload.warmup]
   * @param {RequestOptions} [options={}]
   * @returns {Promise<unknown>}
   */
  async requestWithSign(method, url, payload = {}, options = {}) {
    /** @type {Record<string, any> | null} */
    let signResult = null;
    const signType = payload.signType || 'token';

    if (signType === 'token' && this.tokenRing) {
      if (this.tokenRing.isEmpty) {
        throw new PlatformError({
          type: ErrorTypes.INTERNAL,
          code: 'XACT_5000',
          message: 'Token ring is empty; no pre-signed token available',
          statusCode: 500,
          suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
          platform: this.platform,
        });
      }
      const token = this.tokenRing.next();
      if (token) {
        const location = payload.location || 'header';
        const name = payload.name || 'authorization';
        const prefix = payload.prefix || '';
        const value = `${prefix}${token}`;

        signResult = {};
        if (location === 'header') {
          signResult.headers = { [name]: value };
        } else if (location === 'query') {
          signResult.query = { [name]: value };
        } else if (location === 'cookie') {
          signResult.cookies = { [name]: value };
        } else {
          throw new PlatformError({
            type: ErrorTypes.INVALID_ARGS,
            code: 'XACT_4001',
            message: `Unsupported sign location: "${location}"`,
            statusCode: 400,
            suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
            platform: this.platform,
          });
        }
      }
    } else if (signType === 'page' && this.signerPool && payload.script) {
      const res = await this.signerPool.evaluate(payload.script, payload.args || [], {
        timeoutMs: payload.timeoutMs,
        warmup: payload.warmup,
      });
      signResult = typeof res === 'object' && res !== null ? res : { signature: res };
    } else if (typeof this.sign === 'function' && this.sign !== AbstractApiClient.prototype.sign) {
      signResult = /** @type {Record<string, any>} */ (await this.sign(payload));
    }

    const mergedOptions = { ...options };
    let resolvedUrl = url;

    if (signResult) {
      if (signResult.headers) {
        mergedOptions.headers = { ...mergedOptions.headers, ...signResult.headers };
      }
      if (signResult.query) {
        const isAbsolute = /^https?:\/\//i.test(resolvedUrl);
        const parsedUrl = new URL(resolvedUrl, isAbsolute ? undefined : 'http://localhost');
        for (const [k, v] of Object.entries(signResult.query)) {
          parsedUrl.searchParams.set(k, String(v));
        }
        resolvedUrl = isAbsolute
          ? parsedUrl.toString()
          : `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
      }
      if (signResult.cookies) {
        for (const [k, v] of Object.entries(signResult.cookies)) {
          this.cookies[k] = String(v);
        }
        this.updateCookies(this.cookies);
      }
      if (signResult.signature && !signResult.headers && !signResult.query && !signResult.cookies) {
        const location = payload.location || 'header';
        const name = payload.name || 'x-client-transaction-id';
        if (location === 'header') {
          mergedOptions.headers = { ...mergedOptions.headers, [name]: String(signResult.signature) };
        } else if (location === 'query') {
          const isAbsolute = /^https?:\/\//i.test(resolvedUrl);
          const parsedUrl = new URL(resolvedUrl, isAbsolute ? undefined : 'http://localhost');
          parsedUrl.searchParams.set(name, String(signResult.signature));
          resolvedUrl = isAbsolute
            ? parsedUrl.toString()
            : `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
        }
      }
    }

    if (Object.keys(this.cookies).length > 0) {
      const existingHeaders = /** @type {Record<string, string>} */ ({ ...(mergedOptions.headers || {}) });
      let hasCookieHeader = false;
      const cleanedHeaders = /** @type {Record<string, string>} */ ({});
      for (const [key, value] of Object.entries(existingHeaders)) {
        if (key.toLowerCase() === 'cookie') {
          hasCookieHeader = true;
        }
        cleanedHeaders[key] = value;
      }
      if (!hasCookieHeader) {
        const cookieHeader = Object.entries(this.cookies)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
          .join('; ');
        cleanedHeaders.cookie = cookieHeader;
      }
      mergedOptions.headers = cleanedHeaders;
    }

    return this.request(method, resolvedUrl, mergedOptions);
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
    let concreteAccountId =
      currentAccountId && currentAccountId !== 'guest' && currentAccountId !== 'default'
        ? currentAccountId
        : null;
    const effectiveRequiresAuth =
      typeof opts.requiresAuth === 'boolean' ? opts.requiresAuth : this.requiresAuth;
    const skipResponseValidation = opts.skipResponseValidation === true;
    const isRaw = opts.raw === true;

    // AD-20 multi-consumer identity & dual-pool routing:
    // on-demand consumers (nowing/chainlens) route to the realtime partition,
    // internal/background traffic to bulk. Explicit opts.pool always wins.
    const consumerId =
      typeof opts.consumerId === 'string' && opts.consumerId.trim()
        ? opts.consumerId.trim().toLowerCase()
        : null;
    const pool =
      opts.pool === 'realtime' || opts.pool === 'bulk'
        ? opts.pool
        : consumerId
          ? (consumerId === 'internal' ? 'bulk' : 'realtime')
          : null;

    if (effectiveRequiresAuth && !concreteAccountId && !this.accountPool) {
      throw new AuthSessionExpiredError({
        code: 'XACT_4010',
        message: `No account or account pool configured for authenticated ${this.platform} request`,
        statusCode: 401,
        suggestedAction: SuggestedActions.RELOGIN,
        platform: this.platform,
      });
    }

    // AD-20 consumer quota gate — checked before the per-account governor gate.
    // Metered consumers only (internal is unmetered). We record only after
    // all pre-flight gates (auth, proxy availability, account hibernation) have
    // passed, so quota is not consumed by requests that never leave the client.
    if (consumerId && consumerId !== 'internal' && this.governor && typeof this.governor.canConsumerRequest === 'function') {
      if (!this.governor.canConsumerRequest(consumerId)) {
        const retryAfterSeconds =
          typeof this.governor.getConsumerRetryAfterSeconds === 'function'
            ? this.governor.getConsumerRetryAfterSeconds(consumerId)
            : 60;
        throw new RateLimitError({
          code: 'XACT_4291',
          message: `Consumer quota exceeded for ${consumerId}`,
          statusCode: 429,
          suggestedAction: SuggestedActions.REDUCE_RATE,
          retryAfterMs: Math.max(1, retryAfterSeconds) * 1000,
          platform: this.platform,
          details: { consumerId, pool },
        });
      }
    }

    // Check governor before request for auth-required platforms or opt-in accountId
    if (concreteAccountId && this.governor) {
      if (typeof this.governor.canAccountRequest === 'function') {
        const canRequest = this.governor.canAccountRequest(concreteAccountId, this.platform);
        if (!canRequest) {
          throw new PlatformError({
            type: ErrorTypes.HIBERNATION,
            code: 'XACT_4291',
            message: `Account "${concreteAccountId}" is hibernating or exceeded velocity limit`,
            statusCode: 429,
            suggestedAction: SuggestedActions.ROTATE_ACCOUNT,
            accountId: concreteAccountId,
            platform: this.platform,
          });
        }
      }
    }

    const provider = this.proxyProvider || this.proxyPool;

    if (this.requiresProxy && !provider) {
      throw new PlatformError({
        type: ErrorTypes.PROXY_EXHAUSTED,
        code: 'XACT_5030',
        message: 'Proxy is required for platform requests and no proxy pool is configured',
        statusCode: 503,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        accountId: concreteAccountId,
        platform: this.platform,
      });
    }

    let accountRotationCount = 0;

    while (accountRotationCount <= this.maxAccountRotations) {
      for (let attempt = 0; attempt < this.maxProxyRetries; attempt++) {
        // Check if pool is completely quarantined before attempting
        if (provider && typeof provider.isAllQuarantined === 'function' && provider.isAllQuarantined()) {
          if (concreteAccountId && this.accountPool) {
            this.accountPool.markUnavailable(concreteAccountId, 'proxy_exhausted', this.standbyBackoffMs, this.platform);
          }
          throw new PlatformError({
            type: ErrorTypes.PROXY_EXHAUSTED,
            code: 'XACT_5030',
            message: 'Proxy pool exhausted: all proxies quarantined in standby',
            statusCode: 503,
            suggestedAction: SuggestedActions.WAIT,
            retryAfterMs: this.standbyBackoffMs,
            accountId: concreteAccountId,
            platform: this.platform,
          });
        }

        const proxy = provider || opts.requiresResidential
          ? this.resolveProxy(concreteAccountId, opts.requiresResidential, effectiveRequiresAuth, { pool: pool || undefined, consumerId: consumerId || undefined })
          : null;

        // AD-20: record the consumer request only after we know a healthy proxy
        // exists and all pre-flight gates have passed.
        if (consumerId && consumerId !== 'internal' && proxy && this.governor && typeof this.governor.recordConsumerRequest === 'function') {
          this.governor.recordConsumerRequest(consumerId);
        }

        let agent = null;
        if (proxy && provider && typeof provider.getProxyAgent === 'function') {
          agent = provider.getProxyAgent(proxy, { client: this.client });
        } else if (proxy && provider && typeof provider.createProxyAgent === 'function') {
          agent = provider.createProxyAgent(proxy, this.client);
        }

        let transport = this.httpClient;
        if (typeof transport !== 'function') {
          transport = await this.#getDefaultHttpClient();
        }

        const requestTimeout = opts.timeout ?? this.timeout ?? 30000;
        let response;
        try {
          response = await transport({
            ...opts,
            timeout: requestTimeout,
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
          if (isRaw) {
            const trackingKey = concreteAccountId || 'noauth';
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

          if (this.responseValidator) {
            if (this.responseValidator.isRateLimit(response)) {
              const retryAfterHeader = response?.headers?.['retry-after'] || response?.headers?.['Retry-After'];
              const retryAfterMs = this.#parseRetryAfter(retryAfterHeader) || this.backoffBaseMs;
              if (concreteAccountId && this.accountPool) {
                this.accountPool.markUnavailable(concreteAccountId, 'rate_limit', this.rateLimitHibernationMs, this.platform);
                if (this.governor && typeof this.governor.recordRateLimit === 'function') {
                  this.governor.recordRateLimit(concreteAccountId, this.platform, this.rateLimitHibernationMs);
                }
              }
              throw new RateLimitError({
                code: 'XACT_4290',
                message: 'Rate limit payload detected from upstream platform',
                statusCode: 429,
                suggestedAction: concreteAccountId ? SuggestedActions.ROTATE_ACCOUNT : SuggestedActions.ROTATE_PROXY,
                retryAfterMs,
                accountId: concreteAccountId,
                platform: this.platform,
                details: response?.data || response,
              });
            }
            if (this.responseValidator.isBotChallenge(response)) {
              if (concreteAccountId && this.accountPool) {
                this.accountPool.markUnavailable(concreteAccountId, 'bot_challenge', this.rateLimitHibernationMs, this.platform);
                if (this.governor && typeof this.governor.recordBotChallenge === 'function') {
                  this.governor.recordBotChallenge(concreteAccountId, this.platform);
                }
              }
              throw new BotChallengeError({
                code: 'XACT_4030',
                message: 'Bot challenge detected on upstream platform',
                statusCode: 403,
                suggestedAction: concreteAccountId ? SuggestedActions.ROTATE_ACCOUNT : SuggestedActions.ROTATE_PROXY,
                accountId: concreteAccountId,
                platform: this.platform,
                details: response?.data || response,
              });
            }

            if (typeof this.responseValidator.isLoginWall === 'function' && this.responseValidator.isLoginWall(response)) {
              if (effectiveRequiresAuth) {
                throw new AuthSessionExpiredError({
                  code: 'XACT_4010',
                  message: 'Authentication expired on upstream platform (login wall)',
                  statusCode: 401,
                  suggestedAction: SuggestedActions.RELOGIN,
                  accountId: concreteAccountId,
                  platform: this.platform,
                });
              }

              if (!skipResponseValidation && !this.responseValidator.isValidPayload(response)) {
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
            } else if (!skipResponseValidation && !this.responseValidator.isValidPayload(response)) {
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

          const trackingKey = concreteAccountId || 'noauth';
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
          if (proxy && provider && typeof provider.quarantine === 'function') {
            provider.quarantine(proxy, this.rateLimitHibernationMs);
          }

          if (provider && typeof provider.isAllQuarantined === 'function' && provider.isAllQuarantined()) {
            if (concreteAccountId && this.accountPool) {
              this.accountPool.markUnavailable(concreteAccountId, 'proxy_exhausted', this.standbyBackoffMs, this.platform);
            }
            throw new PlatformError({
              type: ErrorTypes.PROXY_EXHAUSTED,
              code: 'XACT_5030',
              message: 'Proxy pool exhausted: all proxies quarantined in standby',
              statusCode: 503,
              suggestedAction: SuggestedActions.WAIT,
              retryAfterMs: this.standbyBackoffMs,
              accountId: concreteAccountId,
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
            if (concreteAccountId && this.accountPool) {
              this.accountPool.markUnavailable(concreteAccountId, 'rate_limit', this.rateLimitHibernationMs, this.platform);
              if (this.governor && typeof this.governor.recordRateLimit === 'function') {
                this.governor.recordRateLimit(concreteAccountId, this.platform, this.rateLimitHibernationMs);
              }

              const nextAccount = this.accountPool.getNextAvailable(this.platform);
              if (nextAccount && nextAccount !== currentAccountId) {
                currentAccountId = nextAccount;
                concreteAccountId =
                  currentAccountId && currentAccountId !== 'guest' && currentAccountId !== 'default'
                    ? currentAccountId
                    : null;
                break; // Break inner proxy loop to start with new rotated account
              }
            }

            const errorClass = status === 429 ? RateLimitError : BotChallengeError;
            throw new errorClass({
              code: status === 429 ? 'XACT_4290' : 'XACT_4030',
              message: status === 429 ? 'Rate limit exceeded on upstream platform' : 'Bot challenge detected on upstream platform',
              suggestedAction: concreteAccountId ? SuggestedActions.ROTATE_ACCOUNT : SuggestedActions.ROTATE_PROXY,
              retryAfterMs: chosenDelay,
              accountId: concreteAccountId,
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
      accountId: concreteAccountId,
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
   * Check whether a case-insensitive header name is already present.
   * @param {Record<string, unknown>} [headers]
   * @param {string} [name]
   * @returns {boolean}
   */
  #hasHeader(headers = {}, name = '') {
    if (!headers || typeof headers !== 'object') return false;
    const lowerName = name.toLowerCase();
    return Object.keys(headers).some((k) => k.toLowerCase() === lowerName);
  }

  /**
   * Stringify a plain object body when the caller has set a JSON content-type.
   * Leaves strings, Buffers, and streams untouched.
   * @param {any} body
   * @param {Record<string, unknown>} [headers]
   * @returns {any}
   */
  #normalizeRequestBody(body, headers) {
    if (body === undefined || body === null) return body;
    if (typeof body !== 'object') return body;
    if (Buffer.isBuffer(body)) return body;
    if (typeof body.pipe === 'function') return body;
    if (typeof body[Symbol.toStringTag] === 'string') return body;
    const contentType = Object.entries(headers || {}).find(([k]) => k.toLowerCase() === 'content-type')?.[1];
    if (String(contentType).toLowerCase().includes('json')) {
      return JSON.stringify(body);
    }
    return body;
  }

  /**
   * @param {Record<string, unknown>} [cookies={}]
   * @returns {void}
   */
  updateCookies(cookies = {}) {
    if (cookies && typeof cookies === 'object') {
      for (const [key, value] of Object.entries(cookies)) {
        this.cookies[key] = value === undefined || value === null ? '' : String(value);
      }
    }
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
