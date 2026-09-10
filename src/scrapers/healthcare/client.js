// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * HealthcareClient — unified HTTP client for Vietnamese healthcare platforms.
 * Supports Medpro, YouMed, Nha Thuoc Long Chau, Thuocsi.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from "../../core/base-client.js";
import { PlatformError, ErrorTypes, SuggestedActions } from "../../core/error-envelope.js";
import { HEALTHCARE_BASE_URLS, normalizeCitySlug, normalizeSpecialtySlug } from "./schema.js";
import { HealthcarePlatformResponseValidator } from "./validator.js";

/**
 * @typedef {Object} HttpResponseBody
 * @property {() => { read: () => Promise<{ done: boolean; value?: Uint8Array }>; releaseLock?: () => void }} [getReader]
 */

/**
 * @typedef {Object} RawResponse
 * @property {number} [status]
 * @property {number} [statusCode]
 * @property {Record<string, string>} [headers]
 * @property {string | Buffer | HttpResponseBody | Record<string, unknown> | null} [body]
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

/**
 * @typedef {Object} HealthcareClientOptions
 * @property {string} [platform]
 * @property {string} [targetPlatform]
 * @property {string} [baseUrl]
 * @property {"undici" | "got"} [client]
 * @property {import("../../core/platform-validator.js").AbstractPlatformResponseValidator} [responseValidator]
 * @property {boolean} [requiresAuth]
 * @property {boolean} [requiresProxy]
 * @property {string} [userAgent]
 */

export class HealthcareClient extends AbstractApiClient {
  name = "healthcare";
  requiresAuth = false;
  requiresProxy = false;
  platform = "healthcare";

  /**
   * @param {HealthcareClientOptions & Record<string, unknown>} [options={}]
   */
  constructor(options = {}) {
    const responseValidator = options.responseValidator || new HealthcarePlatformResponseValidator();
    super({
      ...options,
      platform: options.targetPlatform || options.platform || "healthcare",
      client: options.client || "got",
      responseValidator,
      requiresAuth: options.requiresAuth ?? false,
      requiresProxy: options.requiresProxy ?? false,
    });

    this.targetPlatform = options.targetPlatform || options.platform || "medpro";
    this.baseUrl = this.#resolveBase(this.targetPlatform, options.baseUrl);
    this.options = options;
  }

  /**
   * @param {string} [targetPlatform]
   * @param {string} [urlOverride]
   * @returns {string}
   */
  #resolveBase(targetPlatform = "medpro", urlOverride = "") {
    if (urlOverride) return urlOverride.replace(/\/+$/, "");
    const urls = /** @type {Record<string, string>} */ (HEALTHCARE_BASE_URLS);
    return urls[targetPlatform] || HEALTHCARE_BASE_URLS.medpro;
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
      // keep fallback
    }

    return {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
      Referer: referer,
      DNT: "1",
      Connection: "keep-alive",
      "Upgrade-Insecure-Requests": "1",
      "User-Agent":
        this.options?.userAgent ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    };
  }

  /**
   * @param {string} method
   * @param {string} url
   * @param {import("../../core/base-client.js").RequestOptions} [options]
   * @returns {Promise<unknown>}
   */
  async request(method, url, options = {}) {
    const targetUrl = String(url);
    const headers = {
      ...this.getDefaultHeaders(targetUrl),
      ...(options?.headers || {}),
    };

    // Long Chau cert is incomplete on some systems; allow bypass
    const isLongChau = targetUrl.includes("nhathuoclongchau.com.vn");
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
   * @param {Record<string, unknown>} [options={}]
   * @returns {Promise<unknown>}
   */
  async searchClinics(params = {}, options = {}) {
    const platform = params.platform || this.targetPlatform;
    const base = this.#resolveBase(platform, this.options?.baseUrl);
    const city = normalizeCitySlug(params.city || "");
    const specialty = normalizeSpecialtySlug(params.specialty || "");
    const page = Math.max(1, Number(params.page) || 1);

    if (platform === "medpro") {
      const query = [];
      if (city) query.push(`city=${city}`);
      if (specialty) query.push(`specialty=${specialty}`);
      if (page > 1) query.push(`page=${page}`);
      const qs = query.length ? `?${query.join("&")}` : "";
      return this.request("GET", `${base}/co-so-y-te${qs}`, { ...options, raw: true });
    }

    if (platform === "youmed") {
      const query = [];
      if (specialty) query.push(`speciality=${specialty}`);
      if (city) query.push(`city=${city}`);
      if (page > 1) query.push(`page=${page}`);
      const qs = query.length ? `?${query.join("&")}` : "";
      return this.request("GET", `${base}/dat-kham/bac-si${qs}`, { ...options, raw: true });
    }

    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: "XACT_4001",
      message: `searchClinics is not supported for platform: ${platform}`,
      statusCode: 400,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform,
    });
  }

  /**
   * Search pharmacies and medicines.
   * @param {Object} [params={}]
   * @param {string} [params.platform]
   * @param {string} [params.keyword]
   * @param {string} [params.city]
   * @param {number} [params.page]
   * @param {Record<string, unknown>} [options={}]
   * @returns {Promise<unknown>}
   */
  async searchPharmacies(params = {}, options = {}) {
    const platform = params.platform || this.targetPlatform;
    const base = this.#resolveBase(platform, this.options?.baseUrl);
    const keyword = encodeURIComponent(String(params.keyword || "").trim());
    const page = Math.max(1, Number(params.page) || 1);

    if (platform === "nhathuoclongchau") {
      const query = [];
      if (keyword) query.push(`q=${keyword}`);
      if (page > 1) query.push(`page=${page}`);
      const qs = query.length ? `?${query.join("&")}` : "";
      return this.request("GET", `${base}/tim-kiem${qs}`, { ...options, raw: true });
    }

    if (platform === "thuocsi") {
      // Thuocsi requires B2B auth; throw actionable error
      throw new PlatformError({
        type: ErrorTypes.AUTH_EXPIRED,
        code: "XACT_4003",
        message: "Thuocsi requires pharmacy B2B authentication to search the product catalog",
        statusCode: 401,
        suggestedAction: SuggestedActions.RELOGIN,
        platform: "thuocsi",
      });
    }

    // Long Chau is primary for retail pharmacy
    const qs = keyword ? `?q=${keyword}` : "";
    return this.request("GET", `${base}/tim-kiem${qs}`, { ...options, raw: true });
  }

  /**
   * Get entity detail by slug or ID.
   * @param {Object} [params]
   * @param {string} [params.platform]
   * @param {string} [params.slug]
   * @param {string} [params.id]
   * @param {Record<string, unknown>} [options={}]
   * @returns {Promise<unknown>}
   */

  /**
   * Get pharmacy store list (Long Chau).
   * @param {Object} [params={}]
   * @param {string} [params.platform]
   * @param {string} [params.city]
   * @param {number} [params.page]
   * @param {Record<string, unknown>} [options={}]
   * @returns {Promise<unknown>}
   */
  async getStores(params = {}, options = {}) {
    const base = this.#resolveBase("nhathuoclongchau", this.options?.baseUrl);
    const city = normalizeCitySlug(params.city || "");
    const page = Math.max(1, Number(params.page) || 1);
    const query = [];
    if (city) query.push(`province=${city}`);
    if (page > 1) query.push(`page=${page}`);
    const qs = query.length ? `?${query.join("&")}` : "";
    return this.request("GET", `${base}/he-thong-cua-hang${qs}`, { ...options, raw: true });
  }

  /**
   * Placeholder for wholesale pharma catalog (Thuocsi - auth-gated).
   * @param {Record<string, unknown>} [params={}]
   * @param {Record<string, unknown>} [options={}]
   * @returns {Promise<never>}
   */
  async getPharmacyCatalog(params = {}, options = {}) {
    throw new PlatformError({
      type: ErrorTypes.AUTH_EXPIRED,
      code: "XACT_4001",
      message: "thuocsi.vn requires authenticated B2B session — deferred to Epic 24",
      statusCode: 401,
      suggestedAction: SuggestedActions.RELOGIN,
      platform: "thuocsi",
    });
  }

  /**
   * Clean up client resources.
   * @returns {Promise<void>}
   */
  async cleanup() {
    return Promise.resolve();
  }

  /**
   * Get entity detail by slug or ID.
   * @param {Object} [params]
   * @param {string} [params.platform]
   * @param {string} [params.slug]
   * @param {string} [params.id]
   * @param {Record<string, unknown>} [options={}]
   * @returns {Promise<unknown>}
   */
  async detail(params = {}, options = {}) {
    const platform = params.platform || this.targetPlatform;
    const base = this.#resolveBase(platform, this.options?.baseUrl);
    const rawSlug = String(params.slug || params.id || "").trim();

    if (!rawSlug) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: "XACT_4001",
        message: "Missing required argument: slug or id for detail",
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform,
      });
    }

    const slug = encodeURIComponent(rawSlug).replace(/%2F/g, "/");

    if (platform === "youmed") {
      return this.request("GET", `${base}/dat-kham/bac-si/${slug}`, { ...options, raw: true });
    }

    if (platform === "medpro") {
      return this.request("GET", `${base}/co-so-y-te/${slug}`, { ...options, raw: true });
    }

    if (platform === "nhathuoclongchau") {
      return this.request("GET", `${base}/he-thong-cua-hang/${slug}`, { ...options, raw: true });
    }

    return this.request("GET", `${base}/${slug}`, { ...options, raw: true });
  }
}
