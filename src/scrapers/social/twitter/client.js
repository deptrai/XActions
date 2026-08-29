// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TwitterClient — Hybrid HTTP client for Twitter/X GraphQL and REST APIs.
 * Extends AbstractApiClient with form-encoded GraphQL dispatch and REST helpers.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../../core/base-client.js';
import { TwitterPlatformResponseValidator } from './validator.js';
import { BEARER_TOKEN, GRAPHQL, REST, REST_BASE, DEFAULT_FEATURES, DEFAULT_FIELD_TOGGLES } from '../../twitter/http/endpoints.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';

/**
 * Check whether a URL points to a loopback or local/private host.
 * Treats loopback 127/8, link-local IPv6, private IPv4 ranges, and
 * *.localhost / *.local hosts as local for testing.
 * @param {string} url
 * @returns {boolean}
 */
function isLocalUrl(url) {
  if (typeof url !== 'string') return false;
  try {
    const { hostname } = new URL(url);
    const host = hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
    if (host === '::1' || /^\[?::1\]?$/.test(host) || host === 'fe80::1') return true;
    if (/^127\./.test(host) || host === '0.0.0.0') return true;
    if (host.startsWith('10.') || host.startsWith('192.168.')) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
    if (host.startsWith('fc00:') || host.startsWith('fd00:')) return true;
  } catch {}
  return false;
}

/**
 * Parse a cookie string into a record.
 * @param {string | Record<string, string> | Array<{name: string, value: string}>} cookies
 * @returns {Record<string, string>}
 */
function parseCookies(cookies) {
  if (!cookies) return {};
  if (typeof cookies === 'string') {
    const record = /** @type {Record<string, string>} */ ({});
    for (const part of cookies.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k) record[decodeURIComponent(k.trim())] = v.length ? decodeURIComponent(v.join('=').trim()) : '';
    }
    return record;
  }
  if (Array.isArray(cookies)) {
    return Object.fromEntries(
      cookies
        .filter((c) => c && c.name && c.value !== undefined)
        .map((c) => [c.name, String(c.value)])
    );
  }
  if (typeof cookies === 'object') {
    return Object.fromEntries(Object.entries(cookies).map(([k, v]) => [k, String(v)]));
  }
  return {};
}

/**
 * Build a cookie header string from a record.
 * @param {Record<string, string>} cookies
 * @returns {string}
 */
function buildCookieHeader(cookies) {
  return Object.entries(cookies)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('; ');
}

/**
 * Extract csrf token from cookie record.
 * @param {Record<string, string>} cookies
 * @returns {string}
 */
function extractCsrfToken(cookies) {
  return cookies.ct0 || '';
}

export class TwitterClient extends AbstractApiClient {
  /** @type {string} */
  name = 'twitter';

  /** @type {string} */
  platform = 'twitter';

  /** @type {boolean} */
  requiresAuth = false;

  /** @type {string} */
  baseUrl = 'https://x.com';

  /** @type {string} */
  bearerToken = BEARER_TOKEN;

  /** @type {string | null} */
  guestToken = null;

  /** @type {'got' | 'undici'} */
  client = 'got';

  /**
   * @param {Object} [deps]
   * @param {string} [deps.baseUrl]
   * @param {string} [deps.bearerToken]
   * @param {boolean} [deps.requiresAuth]
   * @param {boolean} [deps.requiresProxy]
   * @param {import('../../../core/adaptive-governor.js').AdaptiveRateGovernor} [deps.governor]
   * @param {import('../../../core/account-pool.js').AccountPool} [deps.accountPool]
   * @param {import('../../../proxy/proxy-pool.js').ProxyIpPool} [deps.proxyPool]
   * @param {import('../../../core/session-manager.js').SessionManager} [deps.sessionManager]
   * @param {import('../../../core/platform-validator.js').AbstractPlatformResponseValidator} [deps.responseValidator]
   * @param {import('../../../core/signer-pool.js').PreSignedTokenRing} [deps.tokenRing]
   * @param {import('../../../core/signer-pool.js').SignerWorkerPagePool} [deps.signerPool]
   * @param {string} [deps.guestToken]
   * @param {number} [deps.timeout]
   * @param {'got' | 'undici'} [deps.client]
   */
  constructor(deps = {}) {
    const baseUrl = (deps.baseUrl || 'https://x.com').replace(/\/+$/, '');
    const requiresProxy = deps.requiresProxy !== undefined ? deps.requiresProxy : !isLocalUrl(baseUrl);

    super(/** @type {any} */ ({
      ...deps,
      platform: 'twitter',
      requiresAuth: deps.requiresAuth !== undefined ? deps.requiresAuth : false,
      requiresProxy,
      responseValidator: deps.responseValidator || new TwitterPlatformResponseValidator(),
      client: deps.client || 'got',
    }));

    this.baseUrl = baseUrl;
    this.bearerToken = deps.bearerToken || BEARER_TOKEN;
    this.guestToken = deps.guestToken || null;
    this.timeout = deps.timeout ?? 30000;
  }

  /**
   * Initialize guest token or account session.
   * @param {Object} [session]
   * @param {string} [session.accountId]
   * @param {string | Record<string, string>} [session.cookies]
   * @returns {Promise<void>}
   */
  async init(session = {}) {
    if (session?.cookies) {
      this.updateCookies(parseCookies(session.cookies));
    } else if (this.guestToken) {
      this.updateCookies({ gt: this.guestToken });
    }
  }

  /**
   * Override request to inject Twitter headers and cookies.
   * @param {string} method
   * @param {string} url
   * @param {import('../../../core/base-client.js').RequestOptions & { cookies?: string | Record<string, string> }} [options]
   * @returns {Promise<any>}
   */
  async request(method, url, options = {}) {
    const opts = /** @type {any} */ (options) || {};

    if (opts.cookies) {
      const parsed = parseCookies(opts.cookies);
      this.updateCookies(parsed);
    }

    const headers = { ...(opts.headers || {}) };
    if (!headers['authorization']) {
      headers['authorization'] = `Bearer ${this.bearerToken}`;
    }
    if (!headers['x-twitter-active-user']) headers['x-twitter-active-user'] = 'yes';
    if (!headers['x-twitter-client-language']) headers['x-twitter-client-language'] = 'en';

    const cookieRecord = { ...this.cookies };
    if (this.guestToken && !cookieRecord.gt) {
      cookieRecord.gt = this.guestToken;
    }

    const cookieHeader = buildCookieHeader(cookieRecord);
    if (cookieHeader) {
      headers['cookie'] = cookieHeader;
      const csrf = extractCsrfToken(cookieRecord);
      if (csrf && !headers['x-csrf-token']) headers['x-csrf-token'] = csrf;
    }

    return super.request(method, url, { ...opts, headers });
  }

  /**
   * Sign x-client-transaction-id with optional signer pool.
   * @param {Object} options
   * @returns {Promise<string | null>}
   */
  async #signTransactionId(options = {}) {
    if (!this.signerPool || typeof this.signerPool.evaluate !== 'function') return null;
    let timer = null;
    try {
      return await Promise.race([
        this.signerPool.evaluate('xClientTransactionId', [options], { timeoutMs: 3000 }).then((result) => {
          if (typeof result === 'string') return result;
          if (result && typeof result === 'object') return result.signature || result.xClientTransactionId || null;
          return null;
        }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('signer timeout')), 3000); }),
      ]);
    } catch {
      // Swallow signing failures for guest/no-auth requests.
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Build GraphQL form-encoded body.
   * @param {Record<string, unknown>} variables
   * @param {Record<string, boolean>} [features]
   * @returns {URLSearchParams}
   */
  #buildGraphQLBody(variables, features = DEFAULT_FEATURES) {
    const body = new URLSearchParams();
    body.set('variables', JSON.stringify(variables));
    body.set('features', JSON.stringify(features));
    body.set('fieldToggles', JSON.stringify(DEFAULT_FIELD_TOGGLES));
    return body;
  }

  /**
   * Send a Twitter GraphQL request.
   * @param {string} queryId
   * @param {string} operationName
   * @param {Record<string, unknown>} variables
   * @param {Object} [options]
   * @param {string} [options.accountId]
   * @param {string | Record<string, string>} [options.cookies]
   * @param {boolean} [options.requiresAuth]
   * @param {Record<string, string>} [options.headers]
   * @returns {Promise<any>}
   */
  async requestGraphQl(queryId, operationName, variables = {}, options = {}) {
    const isAuth = options.requiresAuth !== undefined ? options.requiresAuth : this.requiresAuth;
    const accountId = isAuth ? (options.accountId || null) : null;

    const transactionId = isAuth ? await this.#signTransactionId({ url: `${this.baseUrl}/i/api/graphql/${queryId}/${operationName}`, method: 'POST' }) : null;

    const headers = /** @type {Record<string, string>} */ ({ 'content-type': 'application/x-www-form-urlencoded', ...(options.headers || {}) });
    if (transactionId) headers['x-client-transaction-id'] = transactionId;

    const relayAwareVariables = { ...variables };
    if (!isAuth && relayAwareVariables.__relay_internal__pv__appviewerisloggedinprovider === undefined) {
      relayAwareVariables.__relay_internal__pv__appviewerisloggedinprovider = false;
    }

    const body = this.#buildGraphQLBody(relayAwareVariables).toString();
    const resp = /** @type {any} */ (await this.request('POST', `${this.baseUrl}/i/api/graphql/${queryId}/${operationName}`, {
      ...options,
      accountId: accountId || undefined,
      requiresAuth: isAuth,
      headers,
      body,
    }));

    // Unwrap base-client envelope if present
    const payload = resp?.data ?? resp;
    return payload?.data ?? payload;
  }

  /**
   * Convenience wrapper for SearchTimeline.
   * @param {string} operationName
   * @param {Record<string, unknown>} variables
   * @param {Object} [options]
   * @returns {Promise<any>}
   */
  async requestSearchTimeline(operationName, variables, options = {}) {
    const endpoint = GRAPHQL.SearchTimeline;
    return this.requestGraphQl(endpoint.queryId, operationName, variables, options);
  }

  /**
   * Send a Twitter REST API request.
   * @param {string} path
   * @param {import('../../../core/base-client.js').RequestOptions & { method?: string, query?: Record<string, unknown> }} [options]
   * @returns {Promise<any>}
   */
  async requestRest(path, options = {}) {
    const isAuth = options.requiresAuth !== undefined ? options.requiresAuth : this.requiresAuth;
    const accountId = isAuth ? (options.accountId || null) : null;

    const needsApiPrefix = !isLocalUrl(this.baseUrl) && /^\/(1\.1|2)\//.test(path);
    const fullPath = needsApiPrefix ? `/i/api${path}` : path;
    const url = new URL(`${this.baseUrl}${fullPath.startsWith('/') ? fullPath : `/${fullPath}`}`, this.baseUrl);
    if (options.query && typeof options.query === 'object') {
      for (const [k, v] of Object.entries(options.query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }

    const resp = /** @type {any} */ (await this.request(options.method || 'GET', url.toString(), {
      ...options,
      accountId: accountId || undefined,
      requiresAuth: isAuth,
    }));

    const payload = resp?.data ?? resp;
    return payload?.data ?? payload;
  }

  /**
   * Convenience wrapper for trends/place.
   * @param {number} woeid
   * @param {Object} [options]
   * @returns {Promise<any>}
   */
  async requestTrendsPlace(woeid, options = {}) {
    return this.requestRest(REST.trendsPlace, { ...options, query: { id: String(woeid) } });
  }

  /**
   * Cleanup resources.
   * @returns {Promise<void>}
   */
  async close() {
    this.guestToken = null;
  }
}
