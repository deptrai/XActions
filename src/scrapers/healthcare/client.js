// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Healthcare API client extending AbstractApiClient.
 * Direct connections for Medpro, YouMed, and Long Chau.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../core/base-client.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../core/error-envelope.js';
import { HEALTHCARE_BASE_URLS, normalizeCitySlug, normalizeSpecialtySlug } from './schema.js';
import { HealthcarePlatformResponseValidator } from './validator.js';

async function normalizeRawBody(resp) {
  if (!resp) return { status: 200, headers: {}, body: '', data: undefined };

  let raw = '';
  if (typeof resp === 'string') {
    raw = resp;
  } else if (Buffer.isBuffer(resp)) {
    raw = resp.toString('utf-8');
  } else if (typeof resp?.text === 'function') {
    raw = await resp.text();
  } else if (resp?.body !== undefined && resp.body !== null) {
    if (typeof resp.body === 'string') {
      raw = resp.body;
    } else if (Buffer.isBuffer(resp.body)) {
      raw = resp.body.toString('utf-8');
    } else if (typeof resp.body?.getReader === 'function') {
      const reader = resp.body.getReader();
      const chunks = [];
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) chunks.push(Buffer.from(value));
        }
        raw = Buffer.concat(chunks).toString('utf-8');
      } finally {
        if (typeof reader.releaseLock === 'function') {
          reader.releaseLock();
        }
      }
    } else if (typeof resp.body === 'object') {
      try { raw = JSON.stringify(resp.body); } catch { raw = ''; }
    }
  } else if (resp?.data !== undefined && resp.data !== null) {
    raw = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
  }

  return {
    status: resp.status || resp.statusCode || 200,
    headers: resp.headers || {},
    body: raw,
    data: resp.data,
  };
}

export class HealthcareClient extends AbstractApiClient {
  name = 'healthcare';
  requiresAuth = false;
  requiresProxy = false;
  platform = 'healthcare';

  /**
   * @param {Record<string, any>} [options={}]
   */
  constructor(options = {}) {
    const responseValidator = options.responseValidator || new HealthcarePlatformResponseValidator();
    super({
      ...options,
      platform: options.targetPlatform || options.platform || 'healthcare',
      client: options.client || 'got',
      responseValidator,
      requiresAuth: options.requiresAuth ?? false,
      requiresProxy: options.requiresProxy ?? false,
    });

    this.targetPlatform = options.targetPlatform || options.platform || 'medpro';
    this.baseUrl = this.#resolveBase(this.targetPlatform, options.baseUrl);
    this.options = options;
  }

  #resolveBase(targetPlatform, urlOverride) {
    if (urlOverride) return urlOverride.replace(/\/+$/, '');
    return HEALTHCARE_BASE_URLS[targetPlatform] || HEALTHCARE_BASE_URLS.medpro;
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
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
      'Referer': referer,
      'DNT': '1',
      'Connection': 'keep-alive',
      'User-Agent': this.options?.userAgent ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    };
  }

  /**
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

    // Long Chau cert is incomplete on some systems; allow bypass
    const isLongChau = targetUrl.includes('nhathuoclongchau.com.vn');
    const httpsOptions = isLongChau
      ? { rejectUnauthorized: false, ...(options?.https || {}) }
      : options?.https;

    const resp = await super.request(method, url, {
      ...options,
      headers,
      ...(httpsOptions ? { https: httpsOptions } : {}),
    });
    return await normalizeRawBody(resp);
  }

  /**
   * Search clinics and facilities.
   * @param {Object} [params={}]
   * @param {string} [params.platform]
   * @param {string} [params.city]
   * @param {string} [params.specialty]
   * @param {number} [params.page]
   * @param {Record<string, any>} [options={}]
   * @returns {Promise<any>}
   */
  async searchClinics(params = {}, options = {}) {
    const platform = params.platform || this.targetPlatform;
    const base = this.#resolveBase(platform, this.options?.baseUrl);
    const city = normalizeCitySlug(params.city || '');
    const specialty = normalizeSpecialtySlug(params.specialty || '');
    const page = Math.max(1, Number(params.page) || 1);

    if (platform === 'medpro') {
      const query = [];
      if (city) query.push(`city=${city}`);
      if (specialty) query.push(`specialty=${specialty}`);
      if (page > 1) query.push(`page=${page}`);
      const qs = query.length ? `?${query.join('&')}` : '';
      return this.request('GET', `${base}/co-so-y-te${qs}`, { ...options, raw: true });
    }

    if (platform === 'youmed') {
      const query = [];
      if (specialty) query.push(`speciality=${specialty}`);
      if (city) query.push(`city=${city}`);
      if (page > 1) query.push(`page=${page}`);
      const qs = query.length ? `?${query.join('&')}` : '';
      return this.request('GET', `${base}/dat-kham/bac-si${qs}`, { ...options, raw: true });
    }

    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4001',
      message: `searchClinics is not supported for platform: ${platform}`,
      statusCode: 400,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform,
    });
  }

  /**
   * Get pharmacy store list (Long Chau).
   * @param {Object} [params={}]
   * @param {string} [params.city]
   * @param {number} [params.page]
   * @param {Record<string, any>} [options={}]
   * @returns {Promise<any>}
   */
  async getStores(params = {}, options = {}) {
    const base = this.#resolveBase('nhathuoclongchau', this.options?.baseUrl);
    const page = Math.max(1, Number(params.page) || 1);
    const city = normalizeCitySlug(params.city || '');
    const query = [];
    if (city) query.push(`province=${city}`);
    if (page > 1) query.push(`page=${page}`);
    const qs = query.length ? `?${query.join('&')}` : '';
    return this.request('GET', `${base}/he-thong-cua-hang${qs}`, { ...options, raw: true });
  }

  /**
   * Placeholder for wholesale pharma catalog (Thuocsi - auth-gated).
   * @returns {Promise<never>}
   */
  async getPharmacyCatalog() {
    throw new PlatformError({
      type: ErrorTypes.AUTH_EXPIRED,
      code: 'XACT_4001',
      message: 'thuocsi.vn requires authenticated B2B session — deferred to Epic 24',
      statusCode: 401,
      suggestedAction: SuggestedActions.RELOGIN,
      platform: 'thuocsi',
    });
  }

  /**
   * Get entity detail by slug or ID.
   * @param {Object} params
   * @param {Record<string, any>} [options={}]
   * @returns {Promise<any>}
   */
  async detail(params = {}, options = {}) {
    const platform = params.platform || this.targetPlatform;
    const base = this.#resolveBase(platform, this.options?.baseUrl);
    const rawSlug = String(params.slug || params.id || '').trim();

    if (!rawSlug) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: slug or id for detail',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform,
      });
    }

    const slug = encodeURIComponent(rawSlug).replace(/%2F/g, '/');

    if (platform === 'youmed') {
      return this.request('GET', `${base}/dat-kham/bac-si/${slug}`, { ...options, raw: true });
    }

    if (platform === 'medpro') {
      return this.request('GET', `${base}/co-so-y-te/${slug}`, { ...options, raw: true });
    }

    if (platform === 'nhathuoclongchau') {
      return this.request('GET', `${base}/he-thong-cua-hang/${slug}`, { ...options, raw: true });
    }

    return this.request('GET', `${base}/${slug}`, { ...options, raw: true });
  }
}
