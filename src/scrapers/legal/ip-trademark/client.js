// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * IP Legal & Trademark API Client extending AbstractApiClient.
 * Direct connection to ipvietnam.gov.vn with SSL verification disabled.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../../core/base-client.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';
import { IP_LEGAL_BASE_URLS, GAZETTE_WEEKLY_PATH, normalizeApplicationNumber } from './schema.js';
import { IpLegalPlatformResponseValidator } from './validator.js';

/**
 * @typedef {Object} HttpResponseBody
 * @property {() => { read: () => Promise<{ done: boolean; value?: Uint8Array }>; releaseLock?: () => void }} [getReader]
 */

/**
 * @typedef {Object} RawResponse
 * @property {number} [status]
 * @property {number} [statusCode]
 * @property {Record<string, string>} [headers]
 * @property {string | Buffer | HttpResponseBody | Record<string, unknown> | AsyncIterable<any> | null} [body]
 * @property {unknown} [data]
 * @property {() => Promise<string>} [text]
 */

/**
 * @param {unknown} resp
 * @returns {Promise<{ status: number; headers: Record<string, string>; body: string; data: unknown }>}
 */
async function normalizeRawBody(resp) {
  if (!resp) return { status: 200, headers: {}, body: "", data: undefined };

  const respObj = (resp && typeof resp === "object" && !Buffer.isBuffer(resp))
    ? /** @type {RawResponse} */ (resp)
    : null;

  let raw = "";
  if (typeof resp === "string") {
    raw = resp;
  } else if (Buffer.isBuffer(resp)) {
    raw = resp.toString("utf-8");
  } else if (respObj && typeof respObj.text === "function") {
    raw = await respObj.text();
  } else if (respObj && respObj.body !== undefined && respObj.body !== null) {
    if (typeof respObj.body === "string") {
      raw = respObj.body;
    } else if (Buffer.isBuffer(respObj.body)) {
      raw = respObj.body.toString("utf-8");
    } else if (typeof respObj.body === "object" && respObj.body !== null && "getReader" in respObj.body && typeof respObj.body.getReader === "function") {
      const reader = respObj.body.getReader();
      const chunks = [];
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) chunks.push(Buffer.from(value));
        }
        raw = Buffer.concat(chunks).toString("utf-8");
      } finally {
        if (typeof reader.releaseLock === "function") {
          reader.releaseLock();
        }
      }
    } else if (typeof respObj.body === "object" && Symbol.asyncIterator in respObj.body && typeof respObj.body[Symbol.asyncIterator] === "function") {
      const chunks = [];
      for await (const chunk of /** @type {AsyncIterable<any>} */ (respObj.body)) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      raw = Buffer.concat(chunks).toString("utf-8");
    } else if (typeof respObj.body === "object") {
      try { raw = JSON.stringify(respObj.body); } catch { raw = ""; }
    }
  } else if (respObj && respObj.data !== undefined && respObj.data !== null) {
    raw = typeof respObj.data === "string" ? respObj.data : JSON.stringify(respObj.data);
  }

  return {
    status: respObj?.status || respObj?.statusCode || 200,
    headers: respObj?.headers || {},
    body: raw,
    data: respObj?.data,
  };
}

export class IpLegalClient extends AbstractApiClient {
  name = 'ipvietnam';
  requiresAuth = false;
  requiresProxy = false;
  platform = 'ipvietnam';

  /**
   * @param {Record<string, any>} [options={}]
   */
  constructor(options = {}) {
    const responseValidator = options.responseValidator || new IpLegalPlatformResponseValidator();
    super({
      ...options,
      platform: 'ipvietnam',
      client: options.client || 'got',
      responseValidator,
      requiresAuth: options.requiresAuth ?? false,
      requiresProxy: options.requiresProxy ?? false,
    });

    this.baseUrl = (options.baseUrl || IP_LEGAL_BASE_URLS.ipvietnam).replace(/\/+$/, '');
    this.options = options;
  }

  /**
   * @param {string} targetUrl
   * @returns {Record<string, string>}
   */
  getDefaultHeaders(targetUrl) {
    let referer = `${this.baseUrl}/`;
    try {
      if (targetUrl) {
        const u = new URL(targetUrl);
        referer = `${u.origin}/`;
      }
    } catch {
      // ignore URL parse errors
    }

    return {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
      'Referer': referer,
      'DNT': '1',
      'Connection': 'keep-alive',
      'User-Agent': this.options?.userAgent ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    };
  }

  /**
   * Send HTTP request with rejectUnauthorized: false by default for ipvietnam.gov.vn.
   * @param {string} method
   * @param {string} url
   * @param {Record<string, any>} [options={}]
   * @returns {Promise<any>}
   */
  async request(method, url, options = {}) {
    const targetUrl = String(url);
    const headers = {
      ...this.getDefaultHeaders(targetUrl),
      ...(options?.headers || {}),
    };

    // ipvietnam.gov.vn requires rejectUnauthorized: false
    const httpsOptions = {
      rejectUnauthorized: false,
      ...(options?.https || {}),
    };

    const resp = await super.request(method, url, {
      ...options,
      headers,
      https: httpsOptions,
    });
    return await normalizeRawBody(resp);
  }

  /**
   * Fetch weekly gazette article listing page.
   * @param {Object} [params={}]
   * @param {number} [params.page=1]
   * @param {Record<string, any>} [options={}]
   * @returns {Promise<any>}
   */
  async getGazetteList(params = {}, options = {}) {
    const page = Math.max(1, Number(params.page) || 1);
    const qs = page > 1 ? `?page=${page}` : '';
    const url = `${this.baseUrl}${GAZETTE_WEEKLY_PATH}${qs}`;
    return this.request('GET', url, { ...options, raw: true });
  }

  /**
   * Fetch content of a specific weekly gazette article containing the table.
   * @param {string} articleUrl
   * @param {Record<string, any>} [options={}]
   * @returns {Promise<any>}
   */
  async getArticleContent(articleUrl, options = {}) {
    if (!articleUrl || typeof articleUrl !== 'string') {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'articleUrl is required to fetch weekly article content',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'ipvietnam',
      });
    }

    const fullUrl = articleUrl.startsWith('http')
      ? articleUrl
      : `${this.baseUrl}${articleUrl.startsWith('/') ? '' : '/'}${articleUrl}`;

    return this.request('GET', fullUrl, { ...options, raw: true });
  }

  /**
   * Fetch yearly summary gazette links.
   * @param {Object} [params={}]
   * @param {number} [params.year=2026]
   * @param {Record<string, any>} [options={}]
   * @returns {Promise<any>}
   */
  async getYearlySummary(params = {}, options = {}) {
    const year = params.year || new Date().getFullYear();
    const url = `${this.baseUrl}${GAZETTE_WEEKLY_PATH}`;
    return this.request('GET', url, { ...options, raw: true });
  }

  /**
   * Look up detail for a specific application number.
   * @param {Object} [params={}]
   * @param {string} [params.id] - Application number (e.g. "4-2026-11740")
   * @param {string} [params.applicationNumber]
   * @param {Record<string, unknown>} [options={}]
   * @returns {Promise<unknown>}
   */
  async detail(params = {}, options = {}) {
    const rawId = params?.id || params?.applicationNumber;
    const applicationNumber = normalizeApplicationNumber(rawId);
    if (!applicationNumber) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'id (applicationNumber) is required for detail query',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'ipvietnam',
      });
    }

    // Direct detail query fetches weekly gazette list page to find matching row
    const url = `${this.baseUrl}${GAZETTE_WEEKLY_PATH}`;
    return this.request('GET', url, { ...options, raw: true });
  }
}
