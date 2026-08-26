// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * ThreadsClient — High-throughput Meta GraphQL client for Threads.
 * Extends AbstractApiClient with got-scraping, dynamic token extraction (lsd, csrftoken),
 * sticky proxy routing, in-flight token deduplication, and graceful doc_id rotation.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../../core/base-client.js';
import { ThreadsPlatformResponseValidator } from './validator.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';

const MAX_TOKEN_CACHE_ENTRIES = 500;
const DEFAULT_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes TTL

export const DEFAULT_THREADS_APP_ID = '238260118697367';
export const DEFAULT_THREADS_ASBD_ID = '359341';

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
  igAppId = DEFAULT_THREADS_APP_ID;

  /** @type {string} */
  asbdId = DEFAULT_THREADS_ASBD_ID;

  /** @type {Map<string, { tokens: Record<string, any>, expiresAt: number }>} */
  #tokenCache = new Map();

  /** @type {Map<string, Promise<Record<string, any>>>} */
  #pendingTokenFetches = new Map();

  /** @type {number} */
  #tokenTtlMs = DEFAULT_TOKEN_TTL_MS;

  /**
   * @param {Object} [deps]
   * @param {string} [deps.baseUrl]
   * @param {'got' | 'undici'} [deps.client]
   * @param {string} [deps.igAppId]
   * @param {string} [deps.asbdId]
   * @param {number} [deps.tokenTtlMs]
   * @param {import('../../../proxy/proxy-pool.js').ProxyIpPool} [deps.proxyPool]
   * @param {import('../../../core/adaptive-governor.js').AdaptiveRateGovernor} [deps.governor]
   * @param {import('../../../core/account-pool.js').AccountPool} [deps.accountPool]
   * @param {import('../../../core/session-manager.js').SessionManager} [deps.sessionManager]
   * @param {import('../../../core/platform-validator.js').AbstractPlatformResponseValidator} [deps.responseValidator]
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
    if (deps.igAppId) {
      this.igAppId = deps.igAppId;
    }
    if (deps.asbdId) {
      this.asbdId = deps.asbdId;
    }
    if (deps.tokenTtlMs) {
      this.#tokenTtlMs = deps.tokenTtlMs;
    }
  }

  /**
   * Extract Threads security tokens (lsd, csrftoken, fb_dtsg) with in-flight deduplication.
   * @param {string} [proxyOrSessionKey='threads-guest']
   * @param {string | Record<string, string> | Array<{ name: string, value: string }>} [cookies='']
   * @returns {Promise<Record<string, any>>}
   */
  async ensureLsd(proxyOrSessionKey = 'threads-guest', cookies = '') {
    const cached = this.#tokenCache.get(proxyOrSessionKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.tokens;
    }

    if (this.#pendingTokenFetches.has(proxyOrSessionKey)) {
      return /** @type {Promise<Record<string, any>>} */ (this.#pendingTokenFetches.get(proxyOrSessionKey));
    }

    const fetchPromise = this.#fetchTokens(proxyOrSessionKey, cookies)
      .finally(() => {
        this.#pendingTokenFetches.delete(proxyOrSessionKey);
      });

    this.#pendingTokenFetches.set(proxyOrSessionKey, fetchPromise);
    return fetchPromise;
  }

  /**
   * Internal worker to fetch tokens from Threads landing / profile page HTML.
   * @param {string} proxyOrSessionKey
   * @param {string | Record<string, string> | Array<{ name: string, value: string }>} cookies
   * @returns {Promise<Record<string, any>>}
   */
  async #fetchTokens(proxyOrSessionKey, cookies) {
    let cookieHeader = '';
    let parsedCsrf = '';

    if (typeof cookies === 'string') {
      cookieHeader = cookies;
      const csrfMatch = cookies.match(/(?:^|;\s*)csrftoken=([^;]+)/);
      if (csrfMatch) parsedCsrf = csrfMatch[1];
    } else if (Array.isArray(cookies)) {
      cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      const csrfItem = cookies.find((c) => c.name === 'csrftoken');
      if (csrfItem) parsedCsrf = String(csrfItem.value);
    } else if (cookies && typeof cookies === 'object') {
      cookieHeader = Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
      if (cookies['csrftoken']) parsedCsrf = String(cookies['csrftoken']);
    }

    /** @type {Record<string, string>} */
    const headers = {};
    if (cookieHeader) {
      headers['cookie'] = cookieHeader;
    }

    const resp = /** @type {any} */ (await this.request('GET', `${this.baseUrl}/`, {
      accountId: proxyOrSessionKey,
      headers,
    }));

    const html = typeof resp?.data === 'string' ? resp.data : (typeof resp === 'string' ? resp : JSON.stringify(resp?.data || ''));

    // Extract security tokens via targeted regexes
    const lsdMatch = html.match(/name="lsd"\s+value="([^"]+)"/) ||
                     html.match(/\["LSD",\[\],\{"token":"([^"]+)"\}/) ||
                     html.match(/"LSD",\[\],\{"token":"([^"]+)"\}/);
    const lsd = lsdMatch ? lsdMatch[1] : '';

    const dtsgMatch = html.match(/\["DTSGInitialData",\[\],\{"token":"([^"]+)"\}/) ||
                      html.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"\}/) ||
                      html.match(/d\.token\s*=\s*"([^"]+)"/);
    const dtsg = dtsgMatch ? dtsgMatch[1] : '';

    const spinRMatch = html.match(/"__spin_r":(\d+)/) || html.match(/window\.__spin_r\s*=\s*(\d+)/);
    const spin_r = spinRMatch ? Number(spinRMatch[1]) : 1016839210;

    const spinTMatch = html.match(/"__spin_t":(\d+)/) || html.match(/window\.__spin_t\s*=\s*(\d+)/);
    const spin_t = spinTMatch ? Number(spinTMatch[1]) : Math.floor(Date.now() / 1000);

    const hsiMatch = html.match(/"__hsi":"([^"]+)"/) || html.match(/window\.__hsi\s*=\s*"([^"]+)"/);
    const hsi = hsiMatch ? hsiMatch[1] : '';

    const userIdMatch = html.match(/window\.__user_id\s*=\s*"([^"]+)"/) || html.match(/"user_id":"(\d+)"/);
    const userId = userIdMatch ? userIdMatch[1] : '';

    if (!lsd && !dtsg) {
      throw new PlatformError({
        code: 'XACT_4010',
        type: ErrorTypes.AUTH_EXPIRED,
        message: 'Failed to extract Threads security tokens (lsd). Session or IP may be checkpointed.',
        suggestedAction: SuggestedActions.ROTATE_PROXY,
        platform: 'threads',
        accountId: proxyOrSessionKey,
      });
    }

    const tokens = {
      lsd,
      csrftoken: parsedCsrf,
      fb_dtsg: dtsg,
      spin_r,
      spin_t,
      hsi,
      userId,
    };

    // Cache management with pruning
    if (this.#tokenCache.size >= MAX_TOKEN_CACHE_ENTRIES) {
      const now = Date.now();
      for (const [k, v] of this.#tokenCache.entries()) {
        if (v.expiresAt <= now) {
          this.#tokenCache.delete(k);
        }
      }
      if (this.#tokenCache.size >= MAX_TOKEN_CACHE_ENTRIES) {
        const oldestKey = this.#tokenCache.keys().next().value;
        if (oldestKey) this.#tokenCache.delete(oldestKey);
      }
    }

    this.#tokenCache.set(proxyOrSessionKey, {
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
    const params = new URLSearchParams({
      doc_id: docId,
      variables: JSON.stringify(variables),
      lsd: tokens.lsd || '',
    });

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
    const rawCookies = options.cookies || options.headers?.cookie || options.headers?.Cookie;
    const tokens = await this.ensureLsd(accountId, rawCookies);
    const body = this.buildGraphQlBody(docId, variables, tokens);

    const mergedHeaders = {
      'content-type': 'application/x-www-form-urlencoded',
      'origin': this.baseUrl,
      'referer': `${this.baseUrl}/`,
      'x-ig-app-id': this.igAppId,
      'x-asbd-id': this.asbdId,
      'x-fb-lsd': tokens.lsd || '',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      ...(options.headers || {}),
    };

    if (tokens.csrftoken && !mergedHeaders['x-csrftoken'] && !mergedHeaders['X-Csrftoken']) {
      mergedHeaders['x-csrftoken'] = tokens.csrftoken;
    }

    const hasCookieHeader = Object.keys(mergedHeaders).some((k) => k.toLowerCase() === 'cookie');
    if (rawCookies && !hasCookieHeader) {
      mergedHeaders['cookie'] = typeof rawCookies === 'string'
        ? rawCookies
        : (Array.isArray(rawCookies)
            ? rawCookies.map((c) => `${c.name}=${c.value}`).join('; ')
            : Object.entries(rawCookies).map(([k, v]) => `${k}=${v}`).join('; '));
    }

    const response = /** @type {any} */ (await this.request('POST', `${this.baseUrl}/api/graphql`, {
      ...options,
      accountId,
      headers: mergedHeaders,
      body,
    }));

    let data = response?.data !== undefined ? response.data : response;
    if (typeof data === 'string') {
      const clean = data.replace(/^\s*for\s*\(\s*;\s*;\s*\);\s*/, '').trim();
      try {
        data = JSON.parse(clean);
      } catch {
        throw new PlatformError({
          code: 'XACT_5000',
          type: ErrorTypes.INTERNAL,
          message: 'Unexpected non-JSON response payload from Threads GraphQL',
          suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
          platform: 'threads',
        });
      }
    }

    // Check for GraphQL execution errors or rotated doc_id
    const errorsList = Array.isArray(data?.errors) ? data.errors : (data?.error ? [data.error] : null);
    if (errorsList && errorsList.length > 0) {
      const primaryError = errorsList[0] || {};
      const errorCode = Number(primaryError.code || primaryError.error_subcode || 0);

      if (errorCode === 190 || errorCode === 1357004) {
        throw new PlatformError({
          code: 'XACT_4010',
          type: ErrorTypes.AUTH_EXPIRED,
          message: `Threads session expired or challenge required: ${primaryError.message}`,
          suggestedAction: SuggestedActions.ROTATE_ACCOUNT,
          platform: 'threads',
          accountId,
          details: errorsList,
        });
      }

      if (errorCode === 368) {
        throw new PlatformError({
          code: 'XACT_4290',
          type: ErrorTypes.RATE_LIMIT,
          message: `Threads action blocked or rate limited: ${primaryError.message}`,
          suggestedAction: SuggestedActions.ROTATE_ACCOUNT,
          platform: 'threads',
          accountId,
          details: errorsList,
        });
      }

      console.warn(`⚠️ [THREADS WARNING] Threads doc_id may be rotated or query failed for ${docId}: ${primaryError.message}`);
      throw new PlatformError({
        code: 'XACT_5000',
        type: ErrorTypes.INTERNAL,
        message: `Threads GraphQL error: ${primaryError.message || 'Invalid doc_id or query failure'}`,
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform: 'threads',
        details: errorsList,
      });
    }

    return data;
  }

  /**
   * Clear in-memory token cache.
   */
  clearTokenCache() {
    this.#tokenCache.clear();
    this.#pendingTokenFetches.clear();
  }
}
