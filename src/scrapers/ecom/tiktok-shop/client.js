// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TikTokShopClient — HTTP client for TikTok Shop Affiliate/Shop APIs with
 * browser-as-signer bridge for a_bogus/msToken anti-bot tokens.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../../core/base-client.js';
import { TikTokShopPlatformResponseValidator } from './validator.js';
import { TikTokBrowserBridge } from '../../social/tiktok/signer-bridge.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';

export const TIKTOK_SHOP_BASE_URL = 'https://affiliate.tiktok.com';

export class TikTokShopClient extends AbstractApiClient {
  /** @type {string} */
  name = 'tiktokshop';

  /** @type {string} */
  platform = 'tiktokshop';

  /** @type {boolean} */
  requiresAuth = false;

  /** @type {TikTokBrowserBridge | null} */
  signerBridge = null;

  /** @type {TikTokBrowserBridge | null} */
  #ownedBridge = null;

  /** @type {string | Record<string, any> | null} */
  proxy = null;

  /**
   * @param {Record<string, any>} [options={}]
   */
  constructor(options = {}) {
    const baseUrl = options.baseUrl || TIKTOK_SHOP_BASE_URL;
    const responseValidator = options.responseValidator || new TikTokShopPlatformResponseValidator();

    super({
      ...options,
      platform: 'tiktokshop',
      client: options.client || 'got',
      responseValidator,
      requiresAuth: options.requiresAuth ?? false,
      requiresProxy: options.requiresProxy ?? false,
    });

    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.signerBridge = options.signerBridge || null;
    this.proxy = options.proxy ?? null;

    if (!this.signerBridge && process.env.TIKTOK_BROWSER_SIGN !== 'false') {
      this.#ownedBridge = this.#createBridge();
      this.signerBridge = this.#ownedBridge;
    }
  }

  /**
   * @returns {TikTokBrowserBridge}
   */
  #createBridge() {
    return new TikTokBrowserBridge({
      baseUrl: this.baseUrl,
      proxy: this.proxy,
      proxyPool: this.proxyPool ?? null,
      proxyProvider: this.proxyProvider ?? null,
    });
  }

  /**
   * Sign a TikTok Shop request through the browser-as-signer bridge.
   * Falls back to a stub when the bridge is unavailable.
   *
   * @param {Object} payload
   * @param {string} payload.url
   * @param {Record<string, any>} [payload.params]
   * @returns {Promise<Record<string, any>>}
   */
  async sign(payload) {
    const { url, params = {} } = payload || {};
    if (!url || typeof url !== 'string') {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'TikTokShopClient.sign() requires a URL string',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'tiktokshop',
      });
    }

    if (this.signerBridge) {
      let signed;
      try {
        signed = await this.signerBridge.signUrl(url, {
          userAgent: this.#defaultUserAgent(),
          cookies: this.cookies,
        });
      } catch (err) {
        throw new PlatformError({
          type: ErrorTypes.AUTH_EXPIRED,
          code: 'XACT_4030',
          message: `TikTok Shop signing failed: ${err?.message || err}`,
          suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
          platform: 'tiktokshop',
          cause: err,
        });
      }
      return {
        query: {
          ...(signed.query || {}),
          ...params,
        },
        cookies: signed.cookies || {},
      };
    }

    // Fallback stub: enough to exercise the pipeline in red-phase tests.
    return {
      query: {
        a_bogus: `DFsSwQVLQfAiv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        msToken: '',
        ...params,
      },
      cookies: { ...this.cookies },
    };
  }

  /**
   * @returns {string}
   */
  #defaultUserAgent() {
    return 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
  }

  /**
   * Merge signed query parameters into a pre-built URL without duplicating keys.
   * @param {string} url
   * @param {Record<string, any>} signedQuery
   * @returns {string}
   */
  #mergeSignedQuery(url, signedQuery) {
    const parsed = new URL(url);
    const safeSignedQuery = signedQuery == null ? {} : signedQuery;
    for (const [k, v] of Object.entries(safeSignedQuery)) {
      if (v === undefined || v === null) continue;
      parsed.searchParams.set(k, String(v));
    }
    return parsed.toString();
  }

  /**
   * Execute a signed TikTok Shop API request.
   * @param {string} method
   * @param {string} endpointPath
   * @param {Record<string, any>} params
   * @param {import('../../../core/base-client.js').RequestOptions} [options]
   * @returns {Promise<Record<string, any>>}
   */
  async requestTikTokShopApi(method, endpointPath, params = {}, options = {}) {
    const url = this.buildApiUrl(endpointPath, params);
    const signed = await this.sign({ url, params });
    const finalUrl = this.#mergeSignedQuery(url, signed.query);

    const resp = /** @type {Record<string, any>} */ (await this.request(method, finalUrl, {
      requiresAuth: options.requiresAuth ?? this.requiresAuth,
      ...options,
    }));

    return resp?.data ?? resp;
  }

  /**
   * Build a full TikTok Shop API URL without signing.
   * @param {string} endpointPath
   * @param {Record<string, any>} params
   * @returns {string}
   */
  buildApiUrl(endpointPath = '', params = {}) {
    const safeEndpoint = endpointPath == null ? '' : String(endpointPath);
    const path = safeEndpoint.startsWith('/') ? safeEndpoint : `/${safeEndpoint}`;
    const parsed = new URL(`${this.baseUrl}${path}`);

    // The browser-as-signer bridge matches requests by `aid` (app/device id).
    // Include a default aid so signUrl can intercept the outbound request.
    if (!parsed.searchParams.has('aid')) {
      parsed.searchParams.set('aid', '1988');
    }

    const safeParams = params == null ? {} : params;
    for (const [k, v] of Object.entries(safeParams)) {
      if (v === undefined || v === null) continue;
      parsed.searchParams.set(k, String(v));
    }
    return parsed.toString();
  }

  /**
   * Fetch top selling/affiliate products by category.
   * @param {Record<string, any>} [params={}]
   * @param {import('../../../core/base-client.js').RequestOptions} [options]
   * @returns {Promise<Record<string, any>>}
   */
  async getTopProducts(params = {}, options = {}) {
    const safeParams = params || {};
    const query = {
      category: safeParams.category || '',
      limit: String(Math.max(1, Math.min(Number(safeParams.limit || 20) || 0, 100))),
      page: String(Math.max(0, Number(safeParams.page || 0) || 0)),
      sort_by: safeParams.sortBy || 'sales',
    };
    return this.requestTikTokShopApi('GET', '/api/v1/oec/affiliate/product/list', query, options);
  }

  /**
   * Fetch product detail by productId.
   * @param {string|number} productId
   * @param {import('../../../core/base-client.js').RequestOptions} [options]
   * @returns {Promise<Record<string, any>>}
   */
  async getProductDetail(productId, options = {}) {
    if (!productId && productId !== 0) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'productId is required',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'tiktokshop',
      });
    }
    return this.requestTikTokShopApi('GET', '/api/v1/shop/product/detail', {
      product_id: String(productId),
    }, options);
  }

  /**
   * Search products by keyword.
   * @param {Record<string, any>} [params={}]
   * @param {import('../../../core/base-client.js').RequestOptions} [options]
   * @returns {Promise<Record<string, any>>}
   */
  async searchProducts(params = {}, options = {}) {
    const safeParams = params || {};
    const query = {
      keyword: safeParams.keyword || '',
      limit: String(Math.max(1, Math.min(Number(safeParams.limit || 20) || 0, 100))),
      page: String(Math.max(0, Number(safeParams.page || 0) || 0)),
      sort_by: safeParams.sortBy || 'relevance',
    };
    return this.requestTikTokShopApi('GET', '/api/v1/oec/affiliate/product/search', query, options);
  }

  /** @returns {Promise<void>} */
  async close() {
    if (this.#ownedBridge) {
      await this.#ownedBridge.close();
      this.#ownedBridge = null;
      this.signerBridge = null;
    }
  }
}
