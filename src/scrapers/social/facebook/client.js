// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * FacebookClient — High-throughput hybrid GraphQL client for Facebook.
 * Extends AbstractApiClient with got-scraping, dynamic token extraction (lsd, fb_dtsg, jazoest, spin),
 * sticky proxy routing, in-flight token deduplication, and browser-as-signer bridge support.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../../core/base-client.js';
import { FacebookPlatformResponseValidator } from './validator.js';
import { FacebookBrowserBridge } from './signer-bridge.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';
import crypto from 'node:crypto';

const MAX_TOKEN_CACHE_ENTRIES = 500;
const DEFAULT_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL

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
 * @param {string | Record<string, string> | Array<{ name: string, value: string }>} cookies
 * @returns {string}
 */
function buildCookieHeader(cookies) {
  if (typeof cookies === 'string') return cookies;
  if (Array.isArray(cookies)) {
    return cookies
      .filter((c) => c && c.name && c.value !== undefined)
      .map((c) => `${encodeCookieValue(c.name)}=${encodeCookieValue(c.value)}`)
      .join('; ');
  }
  if (cookies && typeof cookies === 'object') {
    return Object.entries(cookies)
      .map(([k, v]) => `${encodeCookieValue(k)}=${encodeCookieValue(v)}`)
      .join('; ');
  }
  return '';
}

export class FacebookClient extends AbstractApiClient {
  /** @type {string} */
  name = 'facebook';

  /** @type {string} */
  platform = 'facebook';

  /** @type {boolean} */
  requiresAuth = true;

  /** @type {'got' | 'undici'} */
  client = 'got';

  /** @type {string} */
  baseUrl = 'https://www.facebook.com';

  /** @type {Record<string, string>} */
  friendlyNames = {};

  /** @type {FacebookBrowserBridge | null} */
  browserBridge = null;

  /** @type {string | null} */
  cdpUrl = null;

  /** @type {boolean} */
  launchChrome = false;

  /** @type {string} */
  adapterName = 'playwright';

  /** @type {boolean} */
  headless = true;

  /** @type {string | null} */
  userDataDir = null;

  /** @type {string | null} */
  profileDir = null;

  /** @type {boolean} */
  httpFallback = true;

  /** @type {string[]} */
  extraArgs = [];

  /** @type {FacebookBrowserBridge | null} */
  #ownedBrowserBridge = null;

  /** @type {Map<string, { tokens: Record<string, any>, expiresAt: number }>} */
  #tokenCache = new Map();

  /** @type {Map<string, Promise<Record<string, any>>>} */
  #pendingTokenFetches = new Map();

  /** @type {number} */
  #tokenTtlMs = DEFAULT_TOKEN_TTL_MS;

  /** @type {number} */
  #reqCounter = 0x1a;

  /**
   * @param {Object} [deps]
   * @param {string} [deps.baseUrl]
   * @param {'got' | 'undici'} [deps.client]
   * @param {Record<string, string>} [deps.docIds]
   * @param {Record<string, string>} [deps.friendlyNames]
   * @param {import('../../../proxy/proxy-pool.js').ProxyIpPool} [deps.proxyPool]
   * @param {import('../../../core/adaptive-governor.js').AdaptiveRateGovernor} [deps.governor]
   * @param {import('../../../core/account-pool.js').AccountPool} [deps.accountPool]
   * @param {import('../../../core/session-manager.js').SessionManager} [deps.sessionManager]
   * @param {import('../../../core/platform-validator.js').AbstractPlatformResponseValidator} [deps.responseValidator]
   * @param {import('../../../core/signer-pool.js').PreSignedTokenRing} [deps.tokenRing]
   * @param {import('../../../core/signer-pool.js').SignerWorkerPagePool} [deps.signerPool]
   * @param {FacebookBrowserBridge} [deps.browserBridge]
   * @param {string} [deps.cdpUrl]
   * @param {boolean} [deps.launchChrome]
   * @param {string} [deps.adapterName]
   * @param {boolean} [deps.headless]
   * @param {string} [deps.userDataDir]
   * @param {string} [deps.profileDir]
   * @param {boolean} [deps.httpFallback]
   * @param {number} [deps.tokenTtlMs]
   * @param {any} [deps.proxy]
   * @param {string[]} [deps.extraArgs]
   * @param {number} [deps.timeout]
   */
  constructor(deps = {}) {
    super(/** @type {any} */ ({
      ...deps,
      platform: 'facebook',
      client: deps.client || 'got',
      responseValidator: deps.responseValidator || new FacebookPlatformResponseValidator(),
    }));

    if (deps.baseUrl) {
      this.baseUrl = deps.baseUrl.replace(/\/+$/, '');
    }
    if (deps.friendlyNames) {
      this.friendlyNames = deps.friendlyNames;
    }
    this.timeout = deps.timeout ?? 120000;

    this.browserBridge = deps.browserBridge || null;
    this.cdpUrl = deps.cdpUrl || null;
    this.launchChrome = Boolean(deps.launchChrome);
    this.adapterName = deps.adapterName || process.env.XACTIONS_SCRAPER_ADAPTER || 'playwright';
    this.headless = deps.headless ?? true;
    this.userDataDir = deps.userDataDir || null;
    this.profileDir = deps.profileDir || null;
    this.httpFallback = deps.httpFallback ?? true;
    this.proxy = deps.proxy || null;
    this.extraArgs = deps.extraArgs || [];
    if (deps.tokenTtlMs) {
      this.#tokenTtlMs = deps.tokenTtlMs;
    }

    // Create the owned bridge synchronously so concurrent ensureTokens() calls
    // cannot race to instantiate two separate bridges.
    if (!this.browserBridge && (this.cdpUrl || this.launchChrome)) {
      this.#ownedBrowserBridge = this.#createBrowserBridge();
    }
  }

  /**
   * @returns {FacebookBrowserBridge}
   */
  #createBrowserBridge() {
    return new FacebookBrowserBridge({
      baseUrl: this.baseUrl,
      cdpUrl: this.cdpUrl || undefined,
      launchChrome: this.launchChrome,
      adapterName: this.adapterName,
      headless: this.headless,
      userDataDir: this.userDataDir || this.profileDir || undefined,
      proxy: this.proxy,
      proxyPool: this.proxyPool ?? null,
      proxyProvider: this.proxyProvider ?? null,
      extraArgs: this.extraArgs,
    });
  }

  /**
   * Return the owned FacebookBrowserBridge.
   * @returns {FacebookBrowserBridge}
   */
  #getLazyBrowserBridge() {
    if (!this.#ownedBrowserBridge) {
      this.#ownedBrowserBridge = this.#createBrowserBridge();
    }
    return this.#ownedBrowserBridge;
  }

  /**
   * Extract Facebook security tokens with 30s pre-expiry window & in-flight deduplication.
   * @param {string} [accountId='default']
   * @param {string | Record<string, string> | Array<{ name: string, value: string }>} [cookies='']
   * @returns {Promise<Record<string, any>>}
   */
  async ensureTokens(accountId = 'default', cookies = '') {
    const cookieHeader = buildCookieHeader(cookies);
    const cacheKey = this.#cacheKey(accountId, cookieHeader);

    const cached = this.#tokenCache.get(cacheKey);
    const refreshMargin = this.#tokenTtlMs <= 1000 ? 0 : Math.min(30000, Math.floor(this.#tokenTtlMs * 0.1));
    if (cached && cached.expiresAt > Date.now() + refreshMargin) {
      this.#tokenCache.delete(cacheKey);
      this.#tokenCache.set(cacheKey, cached);
      return cached.tokens;
    }

    if (this.#pendingTokenFetches.has(cacheKey)) {
      return /** @type {Promise<Record<string, any>>} */ (this.#pendingTokenFetches.get(cacheKey));
    }

    const fetchPromise = this.#fetchTokensWithStrategy(accountId, cookieHeader)
      .finally(() => {
        this.#pendingTokenFetches.delete(cacheKey);
      });

    this.#pendingTokenFetches.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  /**
   * Orchestrate browser bridge vs HTTP fallback extraction.
   * @param {string} accountId
   * @param {string} cookieHeader
   * @returns {Promise<Record<string, any>>}
   */
  async #fetchTokensWithStrategy(accountId, cookieHeader) {
    const shouldUseBrowser = Boolean(this.browserBridge || this.cdpUrl || this.launchChrome);

    if (shouldUseBrowser) {
      try {
        const bridge = this.browserBridge || this.#getLazyBrowserBridge();
        const tokens = await bridge.extractTokens(accountId, cookieHeader);
        if (tokens.lsd && this.tokenRing && typeof this.tokenRing.refill === 'function') {
          this.tokenRing.refill([tokens.lsd]);
        }
        this.#saveTokensToCache(accountId, cookieHeader, tokens);
        return tokens;
      } catch (browserErr) {
        if (!this.httpFallback) {
          throw browserErr;
        }
        // Fallback to HTTP
      }
    }

    const tokens = await this.#fetchTokens(accountId, cookieHeader);
    if (tokens.lsd && this.tokenRing && typeof this.tokenRing.refill === 'function') {
      this.tokenRing.refill([tokens.lsd]);
    }
    return tokens;
  }

  /**
   * Save extracted tokens into in-memory cache with eviction.
   * @param {string} accountId
   * @param {string} cookieHeader
   * @param {Record<string, any>} tokens
   */
  #saveTokensToCache(accountId, cookieHeader, tokens) {
    const cacheKey = this.#cacheKey(accountId, cookieHeader);

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
  }

  /**
   * Internal worker to fetch tokens from home page HTML via HTTP.
   * @param {string} accountId
   * @param {string} cookieHeader
   * @returns {Promise<Record<string, any>>}
   */
  async #fetchTokens(accountId, cookieHeader) {
    let parsedUserId = '';
    if (cookieHeader) {
      const cUserMatch = cookieHeader.match(/(?:^|;\s*)c_user=([^;]+)/);
      if (cUserMatch) parsedUserId = decodeURIComponent(cUserMatch[1]);
    }

    /** @type {Record<string, string>} */
    const headers = {
      'x-fb-fetch': 'http',
    };
    if (cookieHeader) {
      headers['cookie'] = cookieHeader;
    }

    const resp = /** @type {any} */ (await this.request('GET', `${this.baseUrl}/`, {
      accountId,
      headers,
    }));

    const html = typeof resp?.data === 'string' ? resp.data : (typeof resp === 'string' ? resp : JSON.stringify(resp?.data || ''));

    // Extract security tokens
    const lsdMatch = html.match(/\["LSD",\[\],\{"token":"([^"]+)"\}/) ||
                     html.match(/"LSD",\[\],\{"token":"([^"]+)"\}/) ||
                     html.match(/name="lsd"\s+value="([^"]+)"/);
    const lsd = lsdMatch ? lsdMatch[1] : '';

    const dtsgMatch = html.match(/\["DTSGInitialData",\[\],\{"token":"([^"]+)"\}/) ||
                      html.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"\}/) ||
                      html.match(/d\.token\s*=\s*"([^"]+)"/);
    const dtsg = dtsgMatch ? dtsgMatch[1] : '';

    const jazoestMatch = html.match(/name="jazoest"\s+value="([^"]+)"/);
    const jazoest = jazoestMatch ? jazoestMatch[1] : '2953';

    const spinRMatch = html.match(/"__spin_r":(\d+)/) || html.match(/window\.__spin_r\s*=\s*(\d+)/);
    const spin_r = spinRMatch ? Number(spinRMatch[1]) : 1016839210;

    const spinTMatch = html.match(/"__spin_t":(\d+)/) || html.match(/window\.__spin_t\s*=\s*(\d+)/);
    const spin_t = spinTMatch ? Number(spinTMatch[1]) : Math.floor(Date.now() / 1000);

    const hsiMatch = html.match(/"__hsi":"([^"]+)"/) || html.match(/window\.__hsi\s*=\s*"([^"]+)"/);
    const hsi = hsiMatch ? hsiMatch[1] : '';

    if (!parsedUserId) {
      const userMatch = html.match(/"USER_ID":"(\d+)"/) || html.match(/"actor_id":"(\d+)"/);
      if (userMatch) parsedUserId = userMatch[1];
    }

    if (!lsd && !dtsg) {
      throw new PlatformError({
        code: 'XACT_4010',
        type: ErrorTypes.AUTH_EXPIRED,
        message: 'Failed to extract Facebook security tokens (lsd/dtsg). Session or IP may be checkpointed.',
        suggestedAction: SuggestedActions.ROTATE_ACCOUNT,
        platform: 'facebook',
        accountId,
      });
    }

    const tokens = {
      lsd,
      jazoest,
      dtsg,
      spin_r,
      spin_t,
      hsi,
      c_user: parsedUserId,
    };

    this.#saveTokensToCache(accountId, cookieHeader, tokens);
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
    const userId = tokens.c_user || tokens.userId;
    if (!userId) {
      throw new PlatformError({
        code: 'XACT_4010',
        type: ErrorTypes.AUTH_EXPIRED,
        message: 'Missing c_user token in GraphQL body',
        suggestedAction: SuggestedActions.RELOGIN,
        platform: 'facebook',
      });
    }

    const allocatedLsd = (this.tokenRing && this.tokenRing.size > 0 ? this.tokenRing.next() : null) || tokens.lsd || '';

    const params = new URLSearchParams({
      doc_id: docId,
      variables: JSON.stringify(variables),
      lsd: allocatedLsd,
      fb_dtsg: tokens.dtsg || tokens.fb_dtsg || '',
      jazoest: tokens.jazoest || '2953',
      __a: '1',
      __user: String(userId),
      __comet_req: '15',
      __req: this.#nextReq(),
      __ccg: 'EXCELLENT',
      fb_api_caller_class: 'RelayModern',
      server_timestamps: 'true',
      __aaid: '0',
      av: String(userId),
    });

    if (tokens.spin_r) params.set('__spin_r', String(tokens.spin_r));
    if (tokens.spin_t) params.set('__spin_t', String(tokens.spin_t));
    if (tokens.__rev) params.set('__rev', String(tokens.__rev));
    if (tokens.hsi) params.set('__hsi', String(tokens.hsi));
    if (this.friendlyNames[docId]) params.set('fb_api_req_friendly_name', this.friendlyNames[docId]);

    return params.toString();
  }

  /**
   * Send a Facebook GraphQL request with automatic token extraction and error checking.
   * @param {string} docId
   * @param {Record<string, any>} variables
   * @param {Record<string, any>} [options={}]
   * @returns {Promise<any>}
   */
  async requestGraphQl(docId, variables = {}, options = {}) {
    const accountId = options.accountId || 'default';
    const rawCookies = options.cookies || options.headers?.cookie;
    const tokens = await this.ensureTokens(accountId, rawCookies);
    const body = this.buildGraphQlBody(docId, variables, tokens);

    const mergedHeaders = {
      'content-type': 'application/x-www-form-urlencoded',
      'origin': this.baseUrl,
      'referer': `${this.baseUrl}/`,
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      ...(options.headers || {}),
    };

    if (rawCookies && !mergedHeaders['cookie']) {
      mergedHeaders['cookie'] = buildCookieHeader(rawCookies);
    }

    const response = /** @type {any} */ (await this.request('POST', `${this.baseUrl}/api/graphql/`, {
      ...options,
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
          type: ErrorTypes.INVALID_ARGS,
          message: 'Unexpected non-JSON response payload from Facebook GraphQL',
          suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
          platform: 'facebook',
        });
      }
    }

    // Check for GraphQL execution errors or rotated doc_id
    if (data?.errors && Array.isArray(data.errors) && data.errors.length > 0) {
      const primaryError = data.errors[0] || {};
      const errorCode = Number(primaryError.code || primaryError.error_subcode || 0);

      if (errorCode === 1357004 || errorCode === 190) {
        throw new PlatformError({
          code: 'XACT_4010',
          type: ErrorTypes.AUTH_EXPIRED,
          message: `Facebook session expired: ${primaryError.message}`,
          suggestedAction: SuggestedActions.ROTATE_ACCOUNT,
          platform: 'facebook',
          accountId,
          details: data.errors,
        });
      }

      if (errorCode === 368) {
        throw new PlatformError({
          code: 'XACT_4290',
          type: ErrorTypes.RATE_LIMIT,
          message: `Facebook temporary block / rate limit: ${primaryError.message}`,
          suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
          platform: 'facebook',
          accountId,
          details: data.errors,
        });
      }

      console.warn(`⚠️ [FACEBOOK WARNING] Facebook doc_id may be rotated or query failed for ${docId}: ${primaryError.message}`);
      throw new PlatformError({
        code: 'XACT_5000',
        type: ErrorTypes.INTERNAL,
        message: `Facebook GraphQL error: ${primaryError.message || 'Invalid doc_id or query failure'}`,
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform: 'facebook',
        details: data.errors,
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

  /**
   * Close client and any owned browser signer bridge.
   * @returns {Promise<void>}
   */
  async close() {
    this.clearTokenCache();
    if (this.#ownedBrowserBridge) {
      try {
        await this.#ownedBrowserBridge.close();
      } catch {}
      this.#ownedBrowserBridge = null;
    }
  }

  /**
   * @param {string} accountId
   * @param {string} cookieHeader
   * @returns {string}
   */
  #cacheKey(accountId, cookieHeader) {
    const hash = crypto.createHash('sha256').update(cookieHeader || '').digest('hex').slice(0, 16);
    return `${accountId}:${hash}`;
  }

  /**
   * @returns {string}
   */
  #nextReq() {
    const value = this.#reqCounter.toString(16).padStart(2, '0');
    this.#reqCounter += 1;
    return value;
  }
}
