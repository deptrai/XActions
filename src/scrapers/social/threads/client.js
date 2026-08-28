// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * ThreadsClient — High-throughput hybrid GraphQL client for Meta Threads (threads.net).
 * Extends AbstractApiClient with got-scraping, dynamic token extraction (lsd, csrftoken, fb_dtsg),
 * sticky proxy routing per account/guest, in-flight token deduplication, and graceful doc_id rotation.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../../core/base-client.js';
import { ThreadsPlatformResponseValidator } from './validator.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';

const MAX_TOKEN_CACHE_ENTRIES = 500;
const FORBIDDEN_COOKIE_CHARS = /[;,"\\]/g;

/**
 * Percent-encode only characters that are illegal inside a Cookie header value.
 * @param {unknown} value
 * @returns {string}
 */
function encodeCookieValue(value) {
  if (value == null) return '';
  return String(value).replace(FORBIDDEN_COOKIE_CHARS, (c) => encodeURIComponent(c));
}

/**
 * Build a stable Cookie header string from a string or a record of cookie values.
 * @param {string | Record<string, unknown>} cookies
 * @returns {string}
 */
function buildCookieHeader(cookies) {
  if (typeof cookies === 'string') return cookies;
  if (cookies && typeof cookies === 'object') {
    return Object.entries(cookies)
      .map(([k, v]) => `${encodeCookieValue(k)}=${encodeCookieValue(v)}`)
      .join('; ');
  }
  return '';
}

export class ThreadsClient extends AbstractApiClient {
  /** @type {string} */
  name = 'threads';

  /** @type {string} */
  platform = 'threads';

  /** @type {boolean} */
  requiresAuth = true;

  /** @type {'got' | 'undici'} */
  client = 'got';

  /** @type {string} */
  baseUrl = 'https://www.threads.net';

  /** @type {string} */
  appId = '238260118697367';

  /** @type {string} */
  asbdId = '359341';

  /** @type {Record<string, string>} */
  friendlyNames = {};

  /** @type {Map<string, { tokens: Record<string, any>, expiresAt: number }>} */
  #tokenCache = new Map();

  /** @type {Map<string, Promise<Record<string, any>>>} */
  #pendingTokenFetches = new Map();

  /** @type {number} */
  #tokenTtlMs = 30 * 60 * 1000; // 30 minutes TTL per AC-1

  /**
   * @param {Object} [deps]
   * @param {string} [deps.baseUrl]
   * @param {'got' | 'undici'} [deps.client]
   * @param {string} [deps.appId]
   * @param {string} [deps.asbdId]
   * @param {Record<string, string>} [deps.friendlyNames]
   * @param {import('../../../proxy/proxy-pool.js').ProxyIpPool} [deps.proxyPool]
   * @param {import('../../../core/adaptive-governor.js').AdaptiveRateGovernor} [deps.governor]
   * @param {import('../../../core/account-pool.js').AccountPool} [deps.accountPool]
   * @param {import('../../../core/session-manager.js').SessionManager} [deps.sessionManager]
   * @param {import('../../../core/platform-validator.js').AbstractPlatformResponseValidator} [deps.responseValidator]
   * @param {number} [deps.timeout]
   */
  constructor(deps = {}) {
    super(/** @type {any} */ ({
      ...deps,
      platform: 'threads',
      client: deps.client || 'got',
      responseValidator: deps.responseValidator || new ThreadsPlatformResponseValidator(),
    }));

    if (deps.baseUrl) {
      this.baseUrl = deps.baseUrl.replace(/\/+$/, '');
    }
    if (deps.appId) {
      this.appId = deps.appId;
    }
    if (deps.asbdId) {
      this.asbdId = deps.asbdId;
    }
    if (deps.friendlyNames) {
      this.friendlyNames = deps.friendlyNames;
    }
    this.timeout = deps.timeout ?? 120000;
  }

  /**
   * Build cache key for tokens based on accountId and cookieHeader.
   * @param {string} accountId
   * @param {string} cookieHeader
   * @returns {string}
   */
  #cacheKey(accountId, cookieHeader) {
    return `${accountId || 'threads-guest'}:${cookieHeader || 'no-cookie'}`;
  }

  /**
   * Extract Threads security tokens (lsd, csrftoken, fb_dtsg) with in-flight deduplication.
   * @param {string} [proxyOrSessionKey='threads-guest']
   * @param {string | Record<string, string>} [cookies='']
   * @returns {Promise<Record<string, any>>}
   */
  async ensureLsd(proxyOrSessionKey = 'threads-guest', cookies = '') {
    const cookieHeader = buildCookieHeader(cookies);
    const cacheKey = this.#cacheKey(proxyOrSessionKey, cookieHeader);

    const cached = this.#tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      // Touch to maintain LRU order
      this.#tokenCache.delete(cacheKey);
      this.#tokenCache.set(cacheKey, cached);
      return cached.tokens;
    }

    if (this.#pendingTokenFetches.has(cacheKey)) {
      return /** @type {Promise<Record<string, any>>} */ (this.#pendingTokenFetches.get(cacheKey));
    }

    const fetchPromise = this.#fetchTokens(proxyOrSessionKey, cookieHeader)
      .finally(() => {
        this.#pendingTokenFetches.delete(cacheKey);
      });

    this.#pendingTokenFetches.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  /**
   * Internal worker to fetch tokens from landing/profile page HTML.
   * @param {string} accountId
   * @param {string} cookieHeader
   * @returns {Promise<Record<string, any>>}
   */
  async #fetchTokens(accountId, cookieHeader) {
    /** @type {Record<string, string>} */
    const headers = {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
    };
    if (cookieHeader) {
      headers['cookie'] = cookieHeader;
    }

    const resp = /** @type {any} */ (await this.request('GET', `${this.baseUrl}/@instagram`, {
      accountId: accountId || 'threads-guest',
      headers,
    }));

    const html = typeof resp?.data === 'string' ? resp.data : (typeof resp === 'string' ? resp : JSON.stringify(resp?.data || ''));

    // Extract LSD token
    const lsdMatch = html.match(/name="lsd"\s+value="([^"]+)"/) ||
                     html.match(/\["LSD",\[\],\{"token":"([^"]+)"\}/) ||
                     html.match(/"LSD",\[\],\{"token":"([^"]+)"\}/) ||
                     html.match(/"token":"([a-zA-Z0-9_-]{8,})"/);
    const lsd = lsdMatch ? lsdMatch[1] : '';

    // Extract DTSG token if present
    const dtsgMatch = html.match(/\["DTSGInitialData",\[\],\{"token":"([^"]+)"\}/) ||
                      html.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"\}/) ||
                      html.match(/d\.token\s*=\s*"([^"]+)"/);
    const dtsg = dtsgMatch ? dtsgMatch[1] : '';

    // Extract csrftoken from cookie or HTML
    let csrftoken = '';
    if (cookieHeader) {
      const csrfMatch = cookieHeader.match(/(?:^|;\s*)csrftoken=([^;]+)/);
      if (csrfMatch) csrftoken = decodeURIComponent(csrfMatch[1]);
    }
    if (!csrftoken) {
      const csrfHtmlMatch = html.match(/"csrf_token":"([^"]+)"/) || html.match(/"csrftoken":"([^"]+)"/);
      if (csrfHtmlMatch) csrftoken = csrfHtmlMatch[1];
    }

    if (!lsd) {
      throw new PlatformError({
        code: 'XACT_5000',
        type: ErrorTypes.INTERNAL,
        message: 'Failed to extract Threads LSD token from landing page',
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform: 'threads',
        accountId: accountId || 'threads-guest',
      });
    }

    const tokens = {
      lsd,
      csrftoken,
      dtsg,
    };

    if (this.#tokenCache.size >= MAX_TOKEN_CACHE_ENTRIES) {
      const oldestKey = this.#tokenCache.keys().next().value;
      if (oldestKey) this.#tokenCache.delete(oldestKey);
    }

    this.#tokenCache.set(this.#cacheKey(accountId, cookieHeader), {
      tokens,
      expiresAt: Date.now() + this.#tokenTtlMs,
    });

    return tokens;
  }

  /**
   * Build application/x-www-form-urlencoded GraphQL body string.
   * @param {string} docId
   * @param {Record<string, any>} variables
   * @param {Record<string, any>} tokens
   * @returns {string}
   */
  buildGraphQlBody(docId, variables = {}, tokens = {}) {
    const lsd = tokens.lsd || '';
    const params = new URLSearchParams({
      doc_id: docId,
      lsd,
      variables: JSON.stringify(variables),
    });

    if (tokens.dtsg) {
      params.set('fb_dtsg', tokens.dtsg);
    }

    return params.toString();
  }

  /**
   * Send a Threads GraphQL request with automatic token extraction and error checking.
   * @param {string} docId
   * @param {Record<string, any>} variables
   * @param {Record<string, any>} [options={}]
   * @returns {Promise<any>}
   */
  async requestGraphQl(docId, variables = {}, options = {}) {
    const accountId = options.accountId || 'threads-guest';
    const cookies = options.cookies || '';
    const cookieHeader = buildCookieHeader(cookies);

    const tokens = options.tokens || await this.ensureLsd(accountId, cookieHeader);
    const body = this.buildGraphQlBody(docId, variables, tokens);

    /** @type {Record<string, string>} */
    const headers = {
      'content-type': 'application/x-www-form-urlencoded',
      'x-ig-app-id': this.appId,
      'x-asbd-id': this.asbdId,
      'x-fb-lsd': tokens.lsd || '',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
    };

    if (tokens.csrftoken) {
      headers['x-csrftoken'] = tokens.csrftoken;
    }
    if (cookieHeader) {
      headers['cookie'] = cookieHeader;
    }
    if (options.headers) {
      Object.assign(headers, options.headers);
    }

    const response = /** @type {any} */ (await this.request('POST', `${this.baseUrl}/api/graphql`, {
      ...options,
      accountId,
      headers,
      body,
    }));

    let rawData = response?.data !== undefined ? response.data : response;
    if (typeof rawData === 'string') {
      try {
        rawData = JSON.parse(rawData);
      } catch {
        // Leave raw string
      }
    }

    if (rawData && typeof rawData === 'object' && Array.isArray(rawData.errors) && rawData.errors.length > 0) {
      const firstError = rawData.errors[0];
      const errorMsg = firstError?.message || JSON.stringify(firstError);
      const isDocIdError = /invalid doc_id|execution failed|doc_id/i.test(errorMsg);

      if (isDocIdError) {
        console.error(`⚠️ [THREADS WARNING] Threads doc_id may be rotated or query failed for ${docId}: ${errorMsg}`);
        throw new PlatformError({
          code: 'XACT_5000',
          type: ErrorTypes.INTERNAL,
          message: `Threads GraphQL query execution failed: ${errorMsg}`,
          suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
          platform: 'threads',
          accountId,
          details: { docId },
        });
      }
    }

    return rawData;
  }

  /**
   * Clear in-memory token cache (useful in tests and account rotation).
   * @returns {void}
   */
  clearTokenCache() {
    this.#tokenCache.clear();
    this.#pendingTokenFetches.clear();
  }
}
