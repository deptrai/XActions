// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * ZaloClient — Zalo OA OpenAPI v3 HTTP client.
 * Extends AbstractApiClient with Zalo OpenAPI request pipeline, token header injection,
 * and integration with ZaloPlatformResponseValidator.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../../core/base-client.js';
import { ZaloPlatformResponseValidator } from './validator.js';
import {
  PlatformError,
  AuthSessionExpiredError,
  RateLimitError,
  BotChallengeError,
  ErrorTypes,
  SuggestedActions,
} from '../../../core/error-envelope.js';

export const DEFAULT_ZALO_OPENAPI_BASE = 'https://openapi.zalo.me';

export function createZaloClient(options = {}) {
  return new ZaloClient(options);
}

export class ZaloClient extends AbstractApiClient {
  /** @type {string} */
  name = 'zalo';

  /** @type {string} */
  platform = 'zalo';

  /** @type {string} */
  baseUrl = DEFAULT_ZALO_OPENAPI_BASE;

  /** @type {string | null} */
  accessToken = null;

  /**
   * @param {Object} [options={}]
   * @param {string} [options.baseUrl] - Base OpenAPI endpoint (default: https://openapi.zalo.me)
   * @param {string} [options.accessToken] - Zalo OA access token
   * @param {string} [options.token] - Alias for accessToken
   * @param {ZaloPlatformResponseValidator} [options.responseValidator]
   * @param {import('../../../proxy/proxy-pool.js').ProxyIpPool} [options.proxyPool]
   * @param {import('../../../core/account-pool.js').AccountPool} [options.accountPool]
   * @param {import('../../../core/adaptive-governor.js').AdaptiveRateGovernor} [options.governor]
   * @param {boolean} [options.requiresAuth=true]
   * @param {boolean} [options.requiresProxy=false]
   * @param {number} [options.timeout=30000]
   */
  constructor(options = {}) {
    const validator = options.responseValidator || new ZaloPlatformResponseValidator();
    super({
      ...options,
      platform: 'zalo',
      responseValidator: validator,
      requiresAuth: options.requiresAuth ?? true,
      requiresProxy: options.requiresProxy ?? false,
      proxyPool: /** @type {import('../../../core/base-client.js').ProxyProviderLike} */ (/** @type {unknown} */ (options.proxyPool)),
    });

    this.baseUrl = (options.baseUrl || DEFAULT_ZALO_OPENAPI_BASE).replace(/\/+$/, '');
    this.accessToken = options.accessToken || options.token || process.env.ZALO_OA_ACCESS_TOKEN || null;
    this.responseValidator = validator;
  }

  /**
   * Set or rotate access token dynamically.
   * @param {string | null} token
   */
  setAccessToken(token) {
    this.accessToken = token;
  }

  /**
   * Build complete OpenAPI endpoint URL with query parameters.
   * @param {string} path
   * @param {Record<string, unknown>} [params={}]
   * @returns {string}
   */
  buildUrl(path, params = {}) {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${cleanPath}`);

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }

    return url.toString();
  }

  /**
   * Send GET request through AbstractApiClient resilient pipeline.
   * @param {string} url
   * @param {object} [options={}]
   * @param {Record<string, string>} [options.headers]
   * @param {string} [options.accessToken]
   * @param {string} [options.token]
   * @param {boolean} [options.requiresAuth]
   * @returns {Promise<Record<string, unknown>>}
   */
  async get(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    const token = options.accessToken || options.token || this.accessToken;

    if (token) {
      headers['access_token'] = token;
    } else if (this.requiresAuth && options.requiresAuth !== false) {
      throw new AuthSessionExpiredError({
        platform: 'zalo',
        code: 'XACT_4003',
        message: 'Zalo OA access token required for authenticated action',
        suggestedAction: SuggestedActions.ROTATE_ACCOUNT,
      });
    }

    headers['accept'] = 'application/json';

    const reqOpts = {
      ...options,
      headers,
      raw: false,
    };

    const res = /** @type {Record<string, unknown>} */ (await this.request('GET', url, reqOpts));

    // Handle Zalo OpenAPI business error codes embedded in HTTP 200 responses
    if (this.responseValidator) {
      if (this.responseValidator.isAuthExpired(res)) {
        throw new AuthSessionExpiredError({
          platform: 'zalo',
          code: 'XACT_4003',
          message: res?.message ? `Zalo auth expired: ${res.message}` : 'Zalo OA access token invalid or expired (-216)',
          suggestedAction: SuggestedActions.ROTATE_ACCOUNT,
          details: { rawResponse: res },
        });
      }

      if (this.responseValidator.isRateLimit(res)) {
        throw new RateLimitError({
          platform: 'zalo',
          code: 'XACT_4029',
          message: res?.message ? `Zalo rate limit: ${res.message}` : 'Zalo OA API out of quota (-211)',
          suggestedAction: SuggestedActions.RATE_LIMIT_BACKOFF,
          retryAfterMs: 60000,
          details: { rawResponse: res },
        });
      }

      if (this.responseValidator.isBotChallenge(res)) {
        throw new BotChallengeError({
          platform: 'zalo',
          code: 'XACT_4030',
          message: 'Zalo WAF bot challenge or access denied',
          suggestedAction: SuggestedActions.ROTATE_PROXY,
          details: { rawResponse: res },
        });
      }

      if (this.responseValidator.isLoginWall(res)) {
        throw new PlatformError({
          platform: 'zalo',
          type: ErrorTypes.TARGET_NOT_FOUND,
          code: 'XACT_4004',
          message: res?.message ? `Zalo OA unavailable: ${res.message}` : 'Zalo OA deactivated or permission denied',
          statusCode: 404,
          suggestedAction: SuggestedActions.VERIFY_URL,
          details: { rawResponse: res },
        });
      }
    }

    return res;
  }

  /**
   * Fetch OA articles/broadcast posts.
   * Endpoint: GET /v3.0/oa/article/getslice
   * @param {Object} [options={}]
   * @param {number} [options.offset=0]
   * @param {number} [options.limit=10]
   * @param {string} [options.type='normal'] - 'normal' | 'video'
   * @returns {Promise<Record<string, unknown>>}
   */
  async getArticles(options = {}) {
    const { offset = 0, limit = 10, type = 'normal', ...rest } = options;
    const url = this.buildUrl('/v3.0/oa/article/getslice', { offset, limit, type });
    return this.get(url, rest);
  }

  /**
   * Fetch OA followers list.
   * Endpoint: GET /v3.0/oa/user/getfollowers
   * @param {Object} [options={}]
   * @param {number} [options.offset=0]
   * @param {number} [options.count=50]
   * @returns {Promise<Record<string, unknown>>}
   */
  async getFollowers(options = {}) {
    const { offset = 0, count = 50, ...rest } = options;
    const url = this.buildUrl('/v3.0/oa/user/getfollowers', { offset, count });
    return this.get(url, rest);
  }

  /**
   * Fetch OA profile details.
   * Endpoint: GET /v3.0/oa/info
   * @param {Object} [options={}]
   * @returns {Promise<Record<string, unknown>>}
   */
  async getOaInfo(options = {}) {
    const url = this.buildUrl('/v3.0/oa/info');
    return this.get(url, options);
  }

  /**
   * Cleanup hook for AbstractApiClient compatibility.
   * @returns {Promise<void>}
   */
  async cleanup() {
    return Promise.resolve();
  }

  /**
   * Fetch OA Marketplace / Shop products catalog.
   * Endpoint: GET /v3.0/oa/product/getslice
   * @param {Object} [options={}]
   * @param {number} [options.offset=0]
   * @param {number} [options.limit=10]
   * @returns {Promise<Record<string, unknown>>}
   */
  async getProducts(options = {}) {
    const { offset = 0, limit = 10, ...rest } = /** @type {Record<string, any>} */ (options);
    const url = this.buildUrl('/v3.0/oa/product/getslice', { offset, limit });
    return this.get(url, rest);
  }
}
