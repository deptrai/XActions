// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * B2BRegistryExtendedClient — HTTP client for hosocongty.vn and muasamcong.mpi.gov.vn.
 * HoSoCongTy uses 2-tier fallback: got-scraping TLS/JA4 spoofing → StealthBrowser cf_clearance warmup.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../../core/base-client.js';
import { B2BRegistryExtendedValidator } from './validator.js';
import { warmupBrowser, getCachedCookies, clearCachedCookies } from './browser.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';

export const HOSOCONGTY_BASE_URL = 'https://hosocongty.vn';
export const MUASAMCONG_BASE_URL = 'https://muasamcong.mpi.gov.vn';

/**
 * Drain a ReadableStream body into a UTF-8 string.
 * @param {ReadableStream<Uint8Array> | any} body
 * @returns {Promise<string>}
 */
async function drainBody(body) {
  if (!body) return '';
  if (Buffer.isBuffer(body)) return body.toString('utf-8');
  if (typeof body === 'string') return body;
  if (typeof body.getReader === 'function') {
    const reader = body.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const buffer = Buffer.alloc(total);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.length;
    }
    return buffer.toString('utf-8');
  }
  if (typeof body[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf-8');
  }
  return String(body);
}

/**
 * Normalize raw body (Buffer, ReadableStream, or string) → string for HTML parsing.
 * @param {any} resp
 * @returns {Promise<any>}
 */
async function normalizeRawBody(resp) {
  if (resp?.body !== undefined) {
    resp.body = await drainBody(resp.body);
  }
  return resp;
}

export class B2BRegistryExtendedClient extends AbstractApiClient {
  /** @type {string} */
  name = 'b2b_registry_extended';

  /** @type {boolean} */
  requiresAuth = false;

  /** @type {boolean} */
  requiresProxy = true;

  /** @type {string} */
  platform = 'b2b_registry_extended';

  /**
   * @param {Record<string, any>} [options={}]
   */
  constructor(options = {}) {
    const responseValidator = options.responseValidator || new B2BRegistryExtendedValidator();

    super({
      ...options,
      platform: options.platform || 'b2b_registry_extended',
      client: options.client || 'got',
      responseValidator,
      requiresAuth: options.requiresAuth ?? false,
      requiresProxy: options.requiresProxy ?? true,
    });

    // Preserve options that class fields would overwrite after super().
    if (options.requiresProxy !== undefined) {
      this.requiresProxy = options.requiresProxy;
    }

    this.targetPlatform = options.targetPlatform || 'hosocongty';
    this.hosocongtyBaseUrl = (options.hosocongtyBaseUrl || (options.targetPlatform === 'hosocongty' ? options.baseUrl : null) || HOSOCONGTY_BASE_URL).replace(/\/+$/, '');
    this.muasamcongBaseUrl = (options.muasamcongBaseUrl || (options.targetPlatform === 'muasamcong' ? options.baseUrl : null) || MUASAMCONG_BASE_URL).replace(/\/+$/, '');

    if (options.baseUrl) {
      const normalizedBase = options.baseUrl.replace(/\/+$/, '');
      if (!options.hosocongtyBaseUrl && (options.targetPlatform === 'hosocongty' || !options.targetPlatform)) {
        this.hosocongtyBaseUrl = normalizedBase;
      }
      if (!options.muasamcongBaseUrl && options.targetPlatform === 'muasamcong') {
        this.muasamcongBaseUrl = normalizedBase;
      }
      if (!options.targetPlatform && !options.hosocongtyBaseUrl && !options.muasamcongBaseUrl) {
        this.hosocongtyBaseUrl = normalizedBase;
        this.muasamcongBaseUrl = normalizedBase;
      }
    }

    this.baseUrl = this.targetPlatform === 'muasamcong' ? this.muasamcongBaseUrl : this.hosocongtyBaseUrl;

    // When proxy is disabled or baseUrl is local, prefer undici (got-scraping may block private IPs).
    const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)/i.test(this.baseUrl || options.baseUrl || '');
    if (options.client === undefined && (options.requiresProxy === false || isLocal)) {
      this.client = 'undici';
      this.httpClient = null;
    }

    this.options = options;
  }

  /**
   * Default browser headers for VN B2B sites.
   * @param {string} [url]
   * @returns {Record<string, string>}
   */
  getDefaultHeaders(url = '') {
    let origin = this.baseUrl;
    if (url) {
      try {
        origin = new URL(url).origin;
      } catch {}
    }
    return {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
      'Referer': `${origin}/`,
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'User-Agent': this.options?.userAgent ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    };
  }

  /**
   * Tier 1: got-scraping request with TLS/JA4 spoofing.
   * @param {string} url
   * @param {Record<string, any>} [options={}]
   * @returns {Promise<any>}
   */
  async gotScrapingRequest(url, options = {}) {
    const { gotScraping } = await import('got-scraping');
    const headers = { ...this.getDefaultHeaders(url), ...(options.headers || {}) };
    let proxy = options.proxy || this.options?.proxy;
    if (!proxy && this.requiresProxy && typeof this.resolveProxy === 'function') {
      try {
        proxy = this.resolveProxy(null, false, false);
      } catch {
        // Fallback if proxy not available
      }
    }
    let proxyUrl;
    if (proxy) {
      const { getProxyAgent } = await import('../../../proxy/index.js');
      const agent = getProxyAgent(proxy, { client: 'got' });
      if (typeof agent === 'string') proxyUrl = agent;
    }
    const resp = await gotScraping.get(url, {
      headers,
      proxyUrl,
      timeout: { request: options.timeout || 30000 },
      throwHttpErrors: false,
    });
    return {
      status: resp.statusCode,
      headers: resp.headers,
      body: resp.body,
      data: resp.body,
    };
  }

  /**
   * Tier 2: Browser warmup → cf_clearance cookie → HTTP request.
   * @param {string} url
   * @param {Record<string, any>} [options={}]
   * @returns {Promise<any>}
   */
  async warmupRequest(url, options = {}) {
    const domain = new URL(url).hostname;
    const proxyKey = options.proxy || this.options?.proxy || '';
    let cookies = getCachedCookies(domain, proxyKey);
    let fromCache = Boolean(cookies);

    if (!cookies) {
      cookies = await warmupBrowser(url, {
        proxy: proxyKey,
        headless: this.options?.headless ?? true,
        userAgent: this.options?.userAgent,
      });
      fromCache = false;
    }

    const headers = {
      ...this.getDefaultHeaders(url),
      'Cookie': cookies,
      ...(options.headers || {}),
    };

    let resp = await super.request('GET', url, { ...options, headers, raw: true });
    resp = await normalizeRawBody(resp);

    // If cached cookie was used and Cloudflare challenged/blocked, invalidate cache and retry once
    if (fromCache && (resp.status === 403 || this.responseValidator?.isBotChallenge(resp))) {
      clearCachedCookies(domain, proxyKey);
      cookies = await warmupBrowser(url, {
        proxy: proxyKey,
        headless: this.options?.headless ?? true,
        userAgent: this.options?.userAgent,
      });
      headers.Cookie = cookies;
      resp = await super.request('GET', url, { ...options, headers, raw: true });
      resp = await normalizeRawBody(resp);
    }

    if (this.responseValidator?.isBotChallenge(resp)) {
      throw new PlatformError({
        type: ErrorTypes.BOT_CHALLENGE,
        code: 'XACT_4030',
        message: 'Cloudflare challenge encountered on HoSoCongTy',
        statusCode: 403,
        suggestedAction: SuggestedActions.ROTATE_PROXY,
        platform: 'hosocongty',
      });
    }

    return resp;
  }

  /**
   * Request override: inject VN browser headers + 2-tier fallback for hosocongty.
   * @param {string} method
   * @param {string} url
   * @param {import('../../../core/base-client.js').RequestOptions} [options]
   * @returns {Promise<any>}
   */
  async request(method, url, options = {}) {
    const isHosocongty = options.platform === 'hosocongty' ||
      url.startsWith(this.hosocongtyBaseUrl) ||
      url.includes('hosocongty.vn') ||
      url.includes('/tra-cuu/') ||
      url.includes('/search?') ||
      url.includes('/tim-kiem');

    if (isHosocongty) {
      try {
        const resp = await this.gotScrapingRequest(url, options);
        const normalized = await normalizeRawBody(resp);
        if (!this.responseValidator?.isBotChallenge(normalized) && resp.status !== 403) {
          return normalized;
        }
      } catch {
        // Fallthrough to Tier 2
      }
      return this.warmupRequest(url, options);
    }

    // MuaSamCong: direct request with browser headers
    const headers = { ...this.getDefaultHeaders(url), ...(options?.headers || {}) };
    const resp = await super.request(method, url, { ...options, headers });
    return await normalizeRawBody(resp);
  }

  /**
   * Search companies on HoSoCongTy.
   * @param {Record<string, any>} [params={}]
   * @param {Record<string, any>} [options={}]
   * @returns {Promise<{ status: number, data: string, body: string }>}
   */
  async searchHosocongty(params = {}, options = {}) {
    const q = encodeURIComponent(String(params.q || params.key || params.taxCode || params.keyword || ''));
    const opt = encodeURIComponent(String(params.opt ?? 0));
    const p = encodeURIComponent(String(params.p ?? 0));
    const d = encodeURIComponent(String(params.d ?? 0));
    const url = `${this.hosocongtyBaseUrl}/search?key=${q}&opt=${opt}&p=${p}&d=${d}`;
    try {
      const resp = await this.request('GET', url, { ...options, raw: true, platform: 'hosocongty' });
      if (resp.status !== 404) return resp;
    } catch (err) {
      const status = /** @type {any} */ (err)?.statusCode || /** @type {any} */ (err)?.status;
      if (status !== 404) throw err;
    }
    const legacyUrl = `${this.hosocongtyBaseUrl}/tim-kiem?q=${q}`;
    return this.request('GET', legacyUrl, { ...options, raw: true, platform: 'hosocongty' });
  }

  /**
   * Get company detail on HoSoCongTy.
   * @param {Record<string, any>} [params={}]
   * @param {Record<string, any>} [options={}]
   * @returns {Promise<{ status: number, data: string, body: string }>}
   */
  async companyDetailHosocongty(params = {}, options = {}) {
    const taxCode = encodeURIComponent(String(params.taxCode || ''));
    const url = `${this.hosocongtyBaseUrl}/tra-cuu/${taxCode}`;
    return this.request('GET', url, { ...options, raw: true, platform: 'hosocongty' });
  }

  /**
   * Search tenders on MuaSamCong.
   * @param {Record<string, any>} [params={}]
   * @param {Record<string, any>} [options={}]
   * @returns {Promise<{ status: number, data: string, body: string }>}
   */
  async searchTendersMuasamcong(params = {}, options = {}) {
    const url = `${this.muasamcongBaseUrl}/o/egp-portal-contractor-selection-v2/services/smart/search?token=`;
    const payload = [{
      pageSize: Number(params.pageSize || params.limit || 10),
      pageNumber: Number(params.pageNumber || params.page || 0),
      query: [{
        index: 'es-contractor-selection',
        keyWord: String(params.keyword || params.q || ''),
        matchType: params.matchType || 'all-1',
        matchFields: Array.isArray(params.matchFields) ? params.matchFields : ['notifyNo', 'bidName'],
        filters: params.filters || [],
      }],
    }];

    try {
      const resp = await this.request('POST', url, {
        ...options,
        raw: true,
        json: payload,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
        platform: 'muasamcong',
      });
      if (resp.status === 200 && resp.body && !resp.body.includes('<!DOCTYPE') && !resp.body.includes('<html')) {
        return resp;
      }
    } catch {
      // Fallback to legacy GET
    }

    const query = new URLSearchParams({
      searchType: params.searchType || 'bidding',
      searchScope: params.searchScope || 'lcnt',
      searchBy: params.searchBy || 'notifyNo,bidName',
      keywordMatch: params.keywordMatch || 'all',
      keyword: String(params.keyword || params.q || ''),
    });
    const fallbackUrl = `${this.muasamcongBaseUrl}/web/guest/bc/-/search?${query.toString()}`;
    return this.request('GET', fallbackUrl, { ...options, raw: true, platform: 'muasamcong' });
  }

  /**
   * Get tender detail on MuaSamCong.
   * @param {Record<string, any>} [params={}]
   * @param {Record<string, any>} [options={}]
   * @returns {Promise<{ status: number, data: string, body: string }>}
   */
  async tenderDetailMuasamcong(params = {}, options = {}) {
    let id = params.id;
    const notifyNo = String(params.notifyNo || params.tenderNo || '');

    // If only notifyNo is provided, attempt smart search resolution to get UUID id
    if (!id && notifyNo) {
      try {
        const searchResp = await this.searchTendersMuasamcong({
          keyword: notifyNo,
          matchFields: ['notifyNo'],
          limit: 1,
        }, options);
        const searchData = searchResp.body || searchResp.data;
        if (searchData && typeof searchData === 'string' && searchData.startsWith('{')) {
          const parsed = JSON.parse(searchData);
          const firstItem = parsed?.page?.content?.[0] || parsed?.items?.[0];
          if (firstItem?.id) {
            id = firstItem.id;
          }
        }
      } catch {
        // Fallthrough if resolution fails
      }
    }

    if (id) {
      const restUrl = `${this.muasamcongBaseUrl}/o/egp-portal-contractor-selection-v2/services/expose/lcnt/bid-po-bido-notify-contractor-view/get-by-id?token=`;
      try {
        const resp = await this.request('POST', restUrl, {
          ...options,
          raw: true,
          json: { id },
          headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
          },
          platform: 'muasamcong',
        });
        if (resp.status === 200 && resp.body && !resp.body.includes('<!DOCTYPE') && !resp.body.includes('<html')) {
          return resp;
        }
      } catch {
        // Fallback to legacy GET
      }
    }

    const query = new URLSearchParams({
      render: 'detail-v2',
      notifyNo: notifyNo,
      step: 'tbmt',
      type: 'es-notify-contractor',
    });
    if (params.id) query.set('id', String(params.id));
    const url = `${this.muasamcongBaseUrl}/web/guest/contractor-selection?${query.toString()}`;
    return this.request('GET', url, { ...options, raw: true, platform: 'muasamcong' });
  }
}
