// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * B2BRegistryExtendedClient — HTTP client for hosocongty.vn and muasamcong.mpi.gov.vn.
 * HoSoCongTy uses 2-tier fallback: got-scraping TLS/JA4 spoofing → StealthBrowser cf_clearance warmup.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../../core/base-client.js';
import { B2BRegistryExtendedValidator } from './validator.js';
import { warmupBrowser, getCachedCookies } from './browser.js';

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

    // When proxy is disabled or baseUrl is local, prefer undici (got-scraping may block private IPs).
    const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)/i.test(this.baseUrl || '');
    if (options.client === undefined && (options.requiresProxy === false || isLocal)) {
      this.client = 'undici';
      this.httpClient = null;
    }

    this.targetPlatform = options.targetPlatform || 'hosocongty';
    this.baseUrl = this.#resolveBaseUrl(this.targetPlatform, options.baseUrl);
    this.options = options;
  }

  /**
   * Resolve base URL per target platform.
   * @param {string} targetPlatform
   * @param {string} [baseUrl]
   * @returns {string}
   */
  #resolveBaseUrl(targetPlatform, baseUrl) {
    if (baseUrl) return baseUrl.replace(/\/+$/, '');
    if (targetPlatform === 'muasamcong') return MUASAMCONG_BASE_URL;
    return HOSOCONGTY_BASE_URL;
  }

  /**
   * Default browser headers for VN B2B sites.
   * @returns {Record<string, string>}
   */
  getDefaultHeaders() {
    return {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
      'Referer': `${this.baseUrl}/`,
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
    const headers = { ...this.getDefaultHeaders(), ...(options.headers || {}) };
    const resp = await gotScraping.get(url, {
      headers,
      proxyUrl: options.proxy || this.options?.proxy,
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
    let cookies = getCachedCookies(domain);

    if (!cookies) {
      cookies = await warmupBrowser(url, {
        proxy: options.proxy || this.options?.proxy,
        headless: this.options?.headless ?? true,
        userAgent: this.options?.userAgent,
      });
    }

    const headers = {
      ...this.getDefaultHeaders(),
      'Cookie': cookies,
      ...(options.headers || {}),
    };

    const resp = await super.request('GET', url, { ...options, headers, raw: true });
    return await normalizeRawBody(resp);
  }

  /**
   * Request override: inject VN browser headers + 2-tier fallback for hosocongty.
   * @param {string} method
   * @param {string} url
   * @param {import('../../../core/base-client.js').RequestOptions} [options]
   * @returns {Promise<any>}
   */
  async request(method, url, options = {}) {
    if (this.targetPlatform === 'hosocongty') {
      try {
        const resp = await this.gotScrapingRequest(url, options);
        const normalized = await normalizeRawBody(resp);
        if (this.responseValidator?.isValidPayload(normalized)) {
          return normalized;
        }
      } catch {
        // Fallthrough to Tier 2
      }
      return this.warmupRequest(url, options);
    }

    // MuaSamCong: direct request with browser headers
    const headers = { ...this.getDefaultHeaders(), ...(options?.headers || {}) };
    const resp = await super.request(method, url, { ...options, headers });
    return await normalizeRawBody(resp);
  }

  /**
   * Search companies on HoSoCongTy.
   * @param {Object} params
   * @param {string} params.q
   * @param {Object} [options={}]
   * @returns {Promise<{ status: number, data: string, body: string }>}
   */
  async searchHosocongty(params = {}, options = {}) {
    const q = encodeURIComponent(String(params.q || params.taxCode || ''));
    const url = `${this.baseUrl}/tim-kiem?q=${q}`;
    return this.request('GET', url, { ...options, raw: true });
  }

  /**
   * Get company detail on HoSoCongTy.
   * @param {Object} params
   * @param {string} params.taxCode
   * @param {Object} [options={}]
   * @returns {Promise<{ status: number, data: string, body: string }>}
   */
  async companyDetailHosocongty(params = {}, options = {}) {
    const taxCode = encodeURIComponent(String(params.taxCode || ''));
    const url = `${this.baseUrl}/tra-cuu/${taxCode}`;
    return this.request('GET', url, { ...options, raw: true });
  }

  /**
   * Search tenders on MuaSamCong.
   * @param {Object} params
   * @param {string} params.keyword
   * @param {string} [params.searchType='bidding']
   * @param {string} [params.searchScope='lcnt']
   * @param {Object} [options={}]
   * @returns {Promise<{ status: number, data: string, body: string }>}
   */
  async searchTendersMuasamcong(params = {}, options = {}) {
    const query = new URLSearchParams({
      searchType: params.searchType || 'bidding',
      searchScope: params.searchScope || 'lcnt',
      searchBy: params.searchBy || 'notifyNo,bidName',
      keywordMatch: params.keywordMatch || 'all',
      keyword: String(params.keyword || ''),
    });
    const url = `${this.baseUrl}/web/guest/bc/-/search?${query.toString()}`;
    return this.request('GET', url, { ...options, raw: true });
  }

  /**
   * Get tender detail on MuaSamCong.
   * @param {Object} params
   * @param {string} params.notifyNo
   * @param {string} [params.id]
   * @param {Object} [options={}]
   * @returns {Promise<{ status: number, data: string, body: string }>}
   */
  async tenderDetailMuasamcong(params = {}, options = {}) {
    const query = new URLSearchParams({
      render: 'detail-v2',
      notifyNo: String(params.notifyNo || params.tenderNo || ''),
      step: 'tbmt',
      type: 'es-notify-contractor',
    });
    if (params.id) query.set('id', String(params.id));
    const url = `${this.baseUrl}/web/guest/contractor-selection?${query.toString()}`;
    return this.request('GET', url, { ...options, raw: true });
  }
}
