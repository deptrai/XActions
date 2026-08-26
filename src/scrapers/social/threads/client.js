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
import {
  PlatformError,
  BotChallengeError,
  RateLimitError,
  AuthSessionExpiredError,
  ErrorTypes,
  SuggestedActions,
} from '../../../core/error-envelope.js';

const MAX_TOKEN_CACHE_ENTRIES = 500;
const DEFAULT_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes TTL
const TOKEN_FAILURE_COOLDOWN_MS = 1500;

/** @type {Set<number>} */
const AUTH_EXPIRED_CODES = new Set([190, 1357004, 1357001, 1357006, 1357010, 1357013]);
/** @type {Set<number>} */
const RATE_LIMIT_CODES = new Set([368]);

/** @type {RegExp[]} */
const LSD_REGEXES = [
  /name="lsd"\s+value="([^"]+)"/,
  /\[\s*"LSD"\s*,\s*\[\s*\]\s*,\s*\{\s*"token"\s*:\s*"([^"]+)"\s*\}\s*\]/,
  /"LSD"\s*,\s*\[\s*\]\s*,\s*\{\s*"token"\s*:\s*"([^"]+)"\s*\}\s*\]/,
];

/** @type {RegExp[]} */
const DTSG_REGEXES = [
  /\[\s*"DTSGInitialData"\s*,\s*\[\s*\]\s*,\s*\{\s*"token"\s*:\s*"([^"]+)"\s*\}\s*\]/,
  /"DTSGInitialData"\s*,\s*\[\s*\]\s*,\s*\{\s*"token"\s*:\s*"([^"]+)"\s*\}\s*\]/,
  /d\.token\s*=\s*"([^"]+)"/,
];

/** @type {RegExp[]} */
const SPIN_R_REGEXES = [
  /"__spin_r"\s*:\s*(\d+)/,
  /window\.__spin_r\s*=\s*(\d+)/,
];

/** @type {RegExp[]} */
const SPIN_T_REGEXES = [
  /"__spin_t"\s*:\s*(\d+)/,
  /window\.__spin_t\s*=\s*(\d+)/,
];

/** @type {RegExp[]} */
const HSI_REGEXES = [
  /"__hsi"\s*:\s*"([^"]+)"/,
  /window\.__hsi\s*=\s*"([^"]+)"/,
];

/** @type {RegExp[]} */
const USER_ID_REGEXES = [
  /window\.__user_id\s*=\s*"([^"]+)"/,
  /window\.__userId\s*=\s*"([^"]+)"/,
  /"user_id"\s*:\s*"([^"]+)"/,
];

export const DEFAULT_THREADS_APP_ID = '238260118697367';
export const DEFAULT_THREADS_ASBD_ID = '359341';

const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class ThreadsClient extends AbstractApiClient {
  /** @type {string} */
  name = 'threads';

  /** @type {string} */
  platform = 'threads';

  /** @type {boolean} */
  requiresAuth = true;

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

  /** @type {Map<string, number>} */
  #tokenFailures = new Map();

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
   * Build a cache key that is sensitive to the resolved proxy and the supplied cookies.
   * @param {string} accountId
   * @param {string | Record<string, string> | Array<{ name: string, value: string }>} [cookies='']
   * @returns {string}
   */
  #buildCacheKey(accountId, cookies = '') {
    const proxyKey = this.#resolveProxyKey(accountId);
    const cookieKey = this.#stableCookieKey(cookies);
    return `${accountId}::${proxyKey}::${cookieKey}`;
  }

  /**
   * Resolve a stable, canonical key for the proxy bound to an account.
   * @param {string} accountId
   * @returns {string}
   */
  #resolveProxyKey(accountId) {
    try {
      const proxy = this.resolveProxy(accountId);
      if (typeof proxy === 'string') return proxy;
      if (proxy && typeof proxy === 'object') {
        const p = /** @type {any} */ (proxy);
        if (typeof p.server === 'string') return p.server;
        const scheme = typeof p.scheme === 'string' ? p.scheme : 'http';
        const host = typeof p.host === 'string' ? p.host : '';
        const port = Number.isFinite(Number(p.port)) ? Number(p.port) : (scheme === 'https' ? 443 : 80);
        return `${scheme}://${host}:${port}`;
      }
    } catch {
      // No healthy proxy or provider unavailable; still cache under a deterministic key.
    }
    return 'no-proxy';
  }

  /**
   * Create a stable, sorted string representation of the supplied cookies.
   * @param {string | Record<string, string> | Array<{ name: string, value: string }>} cookies
   * @returns {string}
   */
  #stableCookieKey(cookies) {
    /** @type {string[]} */
    let segments = [];

    if (typeof cookies === 'string') {
      segments = cookies.split(';').map((s) => s.trim()).filter(Boolean);
    } else if (Array.isArray(cookies)) {
      segments = cookies
        .filter((c) => c && typeof c === 'object')
        .map((c) => `${c.name}=${c.value}`)
        .sort();
    } else if (cookies && typeof cookies === 'object') {
      segments = Object.entries(cookies)
        .map(([k, v]) => `${k}=${v === undefined || v === null ? '' : `${v}`}`)
        .sort();
    }

    return segments.sort().join(';');
  }

  /**
   * Extract a token from the first matching regex.
   * @param {RegExp[]} patterns
   * @param {string} html
   * @returns {string}
   */
  #extractToken(patterns, html) {
    for (const re of patterns) {
      const m = html.match(re);
      if (m && m[1]) return m[1];
    }
    return '';
  }

  /**
   * Parse `csrftoken` out of one or more `Set-Cookie` header values.
   * @param {string | string[] | unknown} setCookie
   * @returns {string}
   */
  #parseCsrftokenFromSetCookie(setCookie) {
    if (!setCookie) return '';
    /** @type {string[]} */
    const values = Array.isArray(setCookie) ? setCookie.map(String) : String(setCookie).split(/,\s*|\r?\n/);
    for (const value of values) {
      const m = value.match(/(?:^|;\s*)csrftoken=([^;]+)/);
      if (m && m[1]) return m[1].trim();
    }
    return '';
  }

  /**
   * Extract Threads security tokens (lsd, csrftoken, fb_dtsg) with in-flight deduplication.
   * @param {string} [proxyOrSessionKey='threads-guest']
   * @param {string | Record<string, string> | Array<{ name: string, value: string }>} [cookies='']
   * @returns {Promise<Record<string, any>>}
   */
  async ensureLsd(proxyOrSessionKey = 'threads-guest', cookies = '') {
    const cacheKey = this.#buildCacheKey(proxyOrSessionKey, cookies);

    const cached = this.#tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.tokens;
    }

    const lastFailure = this.#tokenFailures.get(cacheKey);
    if (lastFailure) {
      const elapsed = Date.now() - lastFailure;
      if (elapsed < TOKEN_FAILURE_COOLDOWN_MS) {
        await sleep(TOKEN_FAILURE_COOLDOWN_MS - elapsed);
      }
    }

    if (this.#pendingTokenFetches.has(cacheKey)) {
      return /** @type {Promise<Record<string, any>>} */ (this.#pendingTokenFetches.get(cacheKey));
    }

    const fetchPromise = this.#fetchTokens(cacheKey, proxyOrSessionKey, cookies)
      .finally(() => {
        this.#pendingTokenFetches.delete(cacheKey);
      })
      .catch((err) => {
        this.#tokenFailures.set(cacheKey, Date.now());
        throw err;
      });

    this.#pendingTokenFetches.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  /**
   * Internal worker to fetch tokens from Threads landing / profile page HTML.
   * @param {string} cacheKey
   * @param {string} accountId
   * @param {string | Record<string, string> | Array<{ name: string, value: string }>} cookies
   * @returns {Promise<Record<string, any>>}
   */
  async #fetchTokens(cacheKey, accountId, cookies) {
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
      accountId,
      headers,
    }));

    const html = typeof resp?.data === 'string' ? resp.data : (typeof resp === 'string' ? resp : JSON.stringify(resp?.data || ''));

    // Prefer a fresh csrftoken returned by the server.
    const setCookie = resp?.headers?.['set-cookie'] ?? resp?.headers?.['Set-Cookie'];
    const csrfFromResponse = this.#parseCsrftokenFromSetCookie(setCookie);
    if (csrfFromResponse) {
      parsedCsrf = csrfFromResponse;
    }

    const lsd = this.#extractToken(LSD_REGEXES, html);
    const fb_dtsg = this.#extractToken(DTSG_REGEXES, html);

    const spin_rMatch = this.#extractToken(SPIN_R_REGEXES, html);
    const spin_r = spin_rMatch ? Number(spin_rMatch) : 1016839210;

    const spin_tMatch = this.#extractToken(SPIN_T_REGEXES, html);
    const spin_t = spin_tMatch ? Number(spin_tMatch) : Math.floor(Date.now() / 1000);

    const hsi = this.#extractToken(HSI_REGEXES, html);
    const userId = this.#extractToken(USER_ID_REGEXES, html);

    if (!lsd) {
      throw new PlatformError({
        code: 'XACT_4010',
        type: ErrorTypes.AUTH_EXPIRED,
        message: 'Failed to extract Threads security tokens (lsd). Session or IP may be checkpointed.',
        suggestedAction: SuggestedActions.ROTATE_PROXY,
        platform: 'threads',
        accountId,
      });
    }

    const tokens = {
      lsd,
      csrftoken: parsedCsrf,
      fb_dtsg,
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

    this.#tokenCache.set(cacheKey, {
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
    const params = new URLSearchParams();
    params.set('doc_id', docId);
    params.set('variables', JSON.stringify(variables));
    params.set('lsd', tokens.lsd || '');
    if (tokens.fb_dtsg) {
      params.set('fb_dtsg', tokens.fb_dtsg);
    }
    return params.toString();
  }

  /**
   * Merge base and user-supplied headers with normalized lowercase keys.
   * @param {Record<string, any>} options
   * @param {Record<string, any>} tokens
   * @returns {Record<string, string>}
   */
  #buildRequestHeaders(options, tokens) {
    /** @type {Record<string, string>} */
    const headers = {};

    /** @type {Record<string, string>} */
    const base = {
      'content-type': 'application/x-www-form-urlencoded',
      'origin': this.baseUrl,
      'referer': `${this.baseUrl}/`,
      'x-ig-app-id': this.igAppId,
      'x-asbd-id': this.asbdId,
      'x-fb-lsd': tokens.lsd || '',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
    };

    if (tokens.fb_dtsg) {
      base['x-fb-dtsg'] = tokens.fb_dtsg;
    }
    if (tokens.csrftoken) {
      base['x-csrftoken'] = tokens.csrftoken;
    }

    for (const [k, v] of Object.entries(base)) {
      headers[k.toLowerCase()] = v;
    }

    const optionHeaders = options.headers || {};
    for (const [k, v] of Object.entries(optionHeaders)) {
      headers[k.toLowerCase()] = typeof v === 'string' ? v : String(v);
    }

    const rawCookies = options.cookies || headers['cookie'] || '';
    if (rawCookies && !headers['cookie']) {
      headers['cookie'] = typeof rawCookies === 'string'
        ? rawCookies
        : (Array.isArray(rawCookies)
            ? rawCookies.map((c) => `${c.name}=${c.value}`).join('; ')
            : Object.entries(rawCookies).map(([k, v]) => `${k}=${v}`).join('; '));
    }

    return headers;
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
    const mergedHeaders = this.#buildRequestHeaders(options, tokens);

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
        const responseLike = {
          data: clean,
          headers: response?.headers || {},
          status: typeof response?.status === 'number' ? response.status : 200,
        };

        if (this.responseValidator && this.responseValidator.isBotChallenge(responseLike)) {
          this.clearTokenCacheForAccount(accountId);
          throw new BotChallengeError({
            code: 'XACT_4030',
            message: 'Threads GraphQL returned a bot challenge page',
            accountId,
            platform: 'threads',
            details: responseLike,
          });
        }

        if (this.responseValidator && !this.responseValidator.isValidPayload(responseLike)) {
          throw new PlatformError({
            code: 'XACT_5000',
            type: ErrorTypes.INTERNAL,
            message: 'Unexpected non-JSON response payload from Threads GraphQL',
            suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
            platform: 'threads',
            details: responseLike,
          });
        }

        throw new PlatformError({
          code: 'XACT_5000',
          type: ErrorTypes.INTERNAL,
          message: 'Threads GraphQL returned a non-JSON payload',
          suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
          platform: 'threads',
          details: responseLike,
        });
      }
    }

    // Check for GraphQL execution errors or rotated doc_id
    const errorsList = Array.isArray(data?.errors) ? data.errors : (data?.error ? [data.error] : null);
    if (errorsList && errorsList.length > 0) {
      const primaryError = errorsList[0] || {};
      const errorCode = Number(primaryError.code || primaryError.error_subcode || 0);

      if (AUTH_EXPIRED_CODES.has(errorCode)) {
        this.clearTokenCacheForAccount(accountId);
        throw new AuthSessionExpiredError({
          code: 'XACT_4010',
          type: ErrorTypes.AUTH_EXPIRED,
          message: `Threads session expired or challenge required: ${primaryError.message}`,
          suggestedAction: SuggestedActions.ROTATE_ACCOUNT,
          accountId,
          platform: 'threads',
          details: errorsList,
        });
      }

      if (RATE_LIMIT_CODES.has(errorCode)) {
        throw new RateLimitError({
          code: 'XACT_4290',
          message: `Threads action blocked or rate limited: ${primaryError.message}`,
          suggestedAction: SuggestedActions.ROTATE_ACCOUNT,
          accountId,
          platform: 'threads',
          details: errorsList,
        });
      }

      throw new PlatformError({
        code: 'XACT_5000',
        type: ErrorTypes.INTERNAL,
        message: `Threads GraphQL error: ${primaryError.message || 'Invalid doc_id or query failure'}`,
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform: 'threads',
        details: errorsList,
        accountId,
      });
    }

    return data;
  }

  /**
   * Remove all cached and in-flight tokens for a given account.
   * @param {string} accountId
   */
  clearTokenCacheForAccount(accountId) {
    const prefix = `${accountId}::`;
    for (const key of this.#tokenCache.keys()) {
      if (key.startsWith(prefix)) this.#tokenCache.delete(key);
    }
    for (const key of this.#pendingTokenFetches.keys()) {
      if (key.startsWith(prefix)) this.#pendingTokenFetches.delete(key);
    }
    for (const key of this.#tokenFailures.keys()) {
      if (key.startsWith(prefix)) this.#tokenFailures.delete(key);
    }
  }

  /**
   * Clear in-memory token cache.
   */
  clearTokenCache() {
    this.#tokenCache.clear();
    this.#pendingTokenFetches.clear();
    this.#tokenFailures.clear();
  }
}
