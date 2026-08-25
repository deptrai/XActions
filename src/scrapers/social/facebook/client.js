// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * FacebookClient — High-throughput hybrid GraphQL client for Facebook.
 * Extends AbstractApiClient with got-scraping, dynamic token extraction (lsd, fb_dtsg),
 * sticky proxy routing, and graceful doc_id rotation.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../../core/base-client.js';
import { FacebookPlatformResponseValidator } from './validator.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';

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

  /** @type {Record<string, { tokens: Record<string, any>, expiresAt: number }>} */
  #tokenCache = {};

  /** @type {number} */
  #tokenTtlMs = 5 * 60 * 1000; // 5 minutes TTL

  /**
   * @param {Object} [deps]
   * @param {string} [deps.baseUrl]
   * @param {'got' | 'undici'} [deps.client]
   * @param {Record<string, string>} [deps.docIds]
   * @param {import('../../../proxy/proxy-pool.js').ProxyIpPool} [deps.proxyPool]
   * @param {import('../../../core/adaptive-governor.js').AdaptiveRateGovernor} [deps.governor]
   * @param {import('../../../core/account-pool.js').AccountPool} [deps.accountPool]
   * @param {import('../../../core/session-manager.js').SessionManager} [deps.sessionManager]
   * @param {import('../../../core/platform-validator.js').AbstractPlatformResponseValidator} [deps.responseValidator]
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
  }

  /**
   * Extract Facebook security tokens (lsd, fb_dtsg, jazoest, spin) from home page HTML.
   * @param {string} [accountId='default']
   * @param {string | Record<string, string>} [cookies='']
   * @returns {Promise<Record<string, any>>}
   */
  async ensureTokens(accountId = 'default', cookies = '') {
    const cached = this.#tokenCache[accountId];
    if (cached && cached.expiresAt > Date.now()) {
      return cached.tokens;
    }

    let cookieHeader = '';
    if (typeof cookies === 'string') {
      cookieHeader = cookies;
    } else if (cookies && typeof cookies === 'object') {
      cookieHeader = Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
    }

    /** @type {Record<string, string>} */
    const headers = {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };
    if (cookieHeader) {
      headers['cookie'] = cookieHeader;
    }

    const resp = /** @type {any} */ (await this.request('GET', `${this.baseUrl}/`, {
      accountId,
      headers,
    }));

    const html = typeof resp?.data === 'string' ? resp.data : (typeof resp === 'string' ? resp : JSON.stringify(resp?.data || ''));

    // Extract security tokens via regex
    const lsdMatch = html.match(/name="lsd"\s+value="([^"]+)"/) || html.match(/\["LSD",\[\],\{"token":"([^"]+)"\}/);
    const lsd = lsdMatch ? lsdMatch[1] : 'AVr_ChrToken';

    const jazoestMatch = html.match(/name="jazoest"\s+value="([^"]+)"/);
    const jazoest = jazoestMatch ? jazoestMatch[1] : '2953';

    const dtsgMatch = html.match(/\["DTSGInitialData",\[\],\{"token":"([^"]+)"\}/) || html.match(/d\.token\s*=\s*"([^"]+)"/);
    const dtsg = dtsgMatch ? dtsgMatch[1] : '';

    const spinRMatch = html.match(/"__spin_r":(\d+)/) || html.match(/window\.__spin_r\s*=\s*(\d+)/);
    const spin_r = spinRMatch ? Number(spinRMatch[1]) : 1016839210;

    const spinTMatch = html.match(/"__spin_t":(\d+)/) || html.match(/window\.__spin_t\s*=\s*(\d+)/);
    const spin_t = spinTMatch ? Number(spinTMatch[1]) : Math.floor(Date.now() / 1000);

    const hsiMatch = html.match(/"__hsi":"([^"]+)"/) || html.match(/window\.__hsi\s*=\s*"([^"]+)"/);
    const hsi = hsiMatch ? hsiMatch[1] : '';

    const tokens = {
      lsd,
      jazoest,
      dtsg,
      spin_r,
      spin_t,
      hsi,
    };

    this.#tokenCache[accountId] = {
      tokens,
      expiresAt: Date.now() + this.#tokenTtlMs,
    };

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
      fb_dtsg: tokens.dtsg || '',
      jazoest: tokens.jazoest || '2953',
      __a: '1',
      __user: '0',
      __comet_req: '15',
      fb_api_caller_class: 'RelayModern',
      server_timestamps: 'true',
    });

    if (tokens.spin_r) params.set('__spin_r', String(tokens.spin_r));
    if (tokens.spin_t) params.set('__spin_t', String(tokens.spin_t));
    if (tokens.hsi) params.set('__hsi', String(tokens.hsi));

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
    const tokens = await this.ensureTokens(accountId, options.cookies || options.headers?.cookie);
    const body = this.buildGraphQlBody(docId, variables, tokens);

    const mergedHeaders = {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'origin': this.baseUrl,
      'referer': `${this.baseUrl}/`,
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      ...(options.headers || {}),
    };

    if (options.cookies && typeof options.cookies === 'string' && !mergedHeaders['cookie']) {
      mergedHeaders['cookie'] = options.cookies;
    }

    const response = /** @type {any} */ (await this.request('POST', `${this.baseUrl}/api/graphql/`, {
      ...options,
      headers: mergedHeaders,
      body,
    }));

    let data = response?.data !== undefined ? response.data : response;
    if (typeof data === 'string') {
      let clean = data;
      if (clean.startsWith('for (;;);')) {
        clean = clean.replace('for (;;);', '');
      }
      try {
        data = JSON.parse(clean);
      } catch {
        // preserve raw string
      }
    }

    // Check for GraphQL execution errors or rotated doc_id
    if (data?.errors && Array.isArray(data.errors) && data.errors.length > 0) {
      console.warn(`⚠️ [FACEBOOK WARNING] Facebook doc_id may be rotated or invalid for query ${docId}: ${data.errors[0]?.message}`);
      throw new PlatformError({
        code: 'XACT_5000',
        type: ErrorTypes.INTERNAL,
        message: `Facebook GraphQL error: ${data.errors[0]?.message || 'Invalid doc_id or query failure'}`,
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform: 'facebook',
        details: data.errors,
      });
    }

    return data;
  }
}
