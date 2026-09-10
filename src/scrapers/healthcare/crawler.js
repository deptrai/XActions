// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Healthcare, Clinics & Pharmacy Network Crawler extending AbstractCrawler.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractCrawler } from "../../core/base-crawler.js";
import { PlatformError, ErrorTypes, SuggestedActions } from "../../core/error-envelope.js";
import { HealthcareClient } from "./client.js";
import { normalizeHealthcareResults } from "./normalizer.js";

/**
 * @param {unknown} response
 * @param {string} platform
 * @param {string} action
 * @returns {string | Record<string, unknown> | Buffer}
 */
function extractResponseBody(response, platform, action) {
  if (!response) return "";
  const resp = /** @type {{ status?: number; statusCode?: number; body?: unknown; data?: unknown } | null} */ (
    response && typeof response === "object" ? response : null
  );
  const status = resp?.status || resp?.statusCode || 200;
  if (status >= 400) {
    throw new PlatformError({
      type: status === 404 ? ErrorTypes.NOT_FOUND : ErrorTypes.INTERNAL,
      code: status === 404 ? "XACT_4004" : "XACT_5001",
      message: `HTTP ${status} from ${platform} on action "${action}"`,
      statusCode: status,
      suggestedAction: status === 404 ? SuggestedActions.USE_ACTIONS_LIST : SuggestedActions.RETRY_AFTER_DELAY,
      platform,
    });
  }
  const body = resp?.body ?? resp?.data ?? response;
  if (typeof body === "string" || Buffer.isBuffer(body)) return body;
  if (body && typeof body === "object") return /** @type {Record<string, unknown>} */ (body);
  return String(body || "");
}

/**
 * @typedef {Object} HealthcareCrawlerDeps
 * @property {HealthcareClient} [client]
 * @property {import("../../core/base-store.js").AbstractStore} [store]
 * @property {{ publish: (item: unknown, scraperId?: string) => Promise<unknown> }} [publisher]
 * @property {boolean} [requiresProxy]
 * @property {import("../../proxy/proxy-pool.js").ProxyIpPool} [proxyPool]
 * @property {import("../../core/adaptive-governor.js").AdaptiveRateGovernor} [governor]
 */

export class HealthcareCrawler extends AbstractCrawler {
  name = "healthcare";
  requiresAuth = false;
  platform = "healthcare";

  /**
   * @param {HealthcareCrawlerDeps & Record<string, unknown>} [deps={}]
   */
  constructor(deps = {}) {
    const client = deps.client || new HealthcareClient({
      requiresProxy: deps.requiresProxy ?? false,
      proxyPool: deps.proxyPool,
      governor: deps.governor,
    });

    super({
      ...deps,
      client,
      requiresAuth: false,
    });

    this.publisher = deps.publisher || null;
    this.#registerActions();
  }

  /** @returns {HealthcareClient} */
  get #healthcareClient() {
    return /** @type {HealthcareClient} */ (/** @type {unknown} */ (this.client));
  }

  async init() {
    return Promise.resolve();
  }

  async cleanup() {
    if (this.client && typeof (/** @type {{ cleanup?: () => Promise<void> }} */ (/** @type {unknown} */ (this.client))).cleanup === "function") {
      await (/** @type {{ cleanup: () => Promise<void> }} */ (/** @type {unknown} */ (this.client))).cleanup().catch(() => {});
    }
  }

  #registerActions() {
    this.registerAction({
      action: "search_clinics",
      description: "Search clinics, hospitals, and medical facilities",
      inputSchema: {
        type: "object",
        properties: {
          city: { type: "string", description: "City name or slug" },
          specialty: { type: "string", description: "Medical specialty" },
          page: { type: "number", default: 1 },
          limit: { type: "number", default: 20 },
          platform: { type: "string", enum: ["medpro", "youmed"], default: "medpro" },
        },
      },
      handler: (/** @type {Record<string, unknown>} */ args) => this.searchClinics(args),
    });

    this.registerAction({
      action: "search_doctors",
      description: "Search doctors and medical specialists",
      inputSchema: {
        type: "object",
        properties: {
          city: { type: "string", description: "City name or slug" },
          specialty: { type: "string", description: "Medical specialty" },
          page: { type: "number", default: 1 },
          limit: { type: "number", default: 20 },
          platform: { type: "string", enum: ["youmed", "medpro"], default: "youmed" },
        },
      },
      handler: (/** @type {Record<string, unknown>} */ args) => this.searchDoctors(args),
    });

    this.registerAction({
      action: "get_stores",
      description: "Get retail pharmacy network stores (Long Chau)",
      inputSchema: {
        type: "object",
        properties: {
          city: { type: "string" },
          page: { type: "number", default: 1 },
          limit: { type: "number", default: 20 },
          platform: { type: "string", default: "nhathuoclongchau" },
        },
      },
      handler: (/** @type {Record<string, unknown>} */ args) => this.getStores(args),
    });

    this.registerAction({
      action: "pharmacy_catalog",
      description: "Get wholesale pharmacy catalog (Thuocsi - deferred/auth-gated)",
      inputSchema: {
        type: "object",
        properties: {
          category: { type: "string" },
          platform: { type: "string", default: "thuocsi" },
        },
      },
      handler: (/** @type {Record<string, unknown>} */ args) => this.getPharmacyCatalog(args),
    });

    this.registerAction({
      action: "detail",
      description: "Get detail of doctor or facility by slug/id",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          slug: { type: "string" },
          platform: { type: "string", enum: ["medpro", "youmed", "nhathuoclongchau"], default: "medpro" },
        },
        required: ["id"],
      },
      handler: (/** @type {Record<string, unknown>} */ args) => this.detail(args),
    });
  }

  /**
   * @param {import("../../core/types.js").PostItem[]} posts
   */
  async #persist(posts) {
    if (!posts.length) return;

    if (this.store && typeof this.store.storeBatch === "function") {
      await this.store.storeBatch(posts).catch(() => {});
    }

    if (this.publisher && typeof this.publisher.publish === "function") {
      for (const item of posts) {
        await this.publisher.publish(item, this.scraperId).catch(() => {});
      }
    }
  }

  /**
   * Search clinics and facilities.
   * @param {Record<string, unknown>} [args={}]
   * @returns {Promise<{ posts: import("../../core/types.js").PostItem[], pageInfo: Record<string, unknown> }>}
   */
  async searchClinics(args = {}) {
    const platform = typeof args.platform === "string" ? args.platform : "medpro";
    const response = await this.#healthcareClient.searchClinics({ ...args, platform });
    const data = extractResponseBody(response, platform, "search_clinics");

    const limit = Math.max(1, Number(args.limit) || 20);
    const page = Math.max(1, Number(args.page) || 1);

    const allPosts = normalizeHealthcareResults(data, "search", { platform });
    const posts = allPosts.slice(0, limit);

    for (const post of posts) {
      this.validateItem(post);
    }
    await this.#persist(posts);

    return {
      posts,
      pageInfo: {
        has_next_page: allPosts.length >= limit,
        page,
        total: allPosts.length,
      },
    };
  }

  /**
   * Search doctors (maps to YouMed by default).
   * @param {Record<string, unknown>} [args={}]
   * @returns {Promise<{ posts: import("../../core/types.js").PostItem[], pageInfo: Record<string, unknown> }>}
   */
  async searchDoctors(args = {}) {
    const platform = typeof args.platform === "string" ? args.platform : "youmed";
    return this.searchClinics({ ...args, platform });
  }

  /**
   * Get Long Chau retail pharmacies.
   * @param {Record<string, unknown>} [args={}]
   * @returns {Promise<{ posts: import("../../core/types.js").PostItem[], pageInfo: Record<string, unknown> }>}
   */
  async getStores(args = {}) {
    const platform = "nhathuoclongchau";
    const response = await this.#healthcareClient.getStores({ ...args, platform });
    const data = extractResponseBody(response, platform, "get_stores");

    const limit = Math.max(1, Number(args.limit) || 20);
    const page = Math.max(1, Number(args.page) || 1);

    const allPosts = normalizeHealthcareResults(data, "stores", { platform });
    const posts = allPosts.slice(0, limit);

    for (const post of posts) {
      this.validateItem(post);
    }
    await this.#persist(posts);

    return {
      posts,
      pageInfo: {
        has_next_page: allPosts.length >= limit,
        page,
        total: allPosts.length,
      },
    };
  }

  /**
   * Wholesale pharmacy catalog placeholder.
   * @param {Record<string, unknown>} [args={}]
   * @returns {Promise<never>}
   */
  async getPharmacyCatalog(args = {}) {
    return this.#healthcareClient.getPharmacyCatalog(args);
  }

  /**
   * Get entity detail.
   * @param {Record<string, unknown>} [args={}]
   * @returns {Promise<{ post: import("../../core/types.js").PostItem }>}
   */
  async detail(args = {}) {
    const platform = typeof args.platform === "string" ? args.platform : "medpro";
    const id = String(args.id || args.slug || "").trim();
    if (!id) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: "XACT_4001",
        message: "Missing required argument: id",
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform,
      });
    }

    const response = await this.#healthcareClient.detail({ ...args, platform, id });
    const data = extractResponseBody(response, platform, "detail");

    const slugStr = typeof args.slug === "string" ? args.slug : undefined;
    const posts = normalizeHealthcareResults(data, "detail", { platform, id, slug: slugStr });
    if (!posts.length) {
      throw new PlatformError({
        type: ErrorTypes.NOT_FOUND,
        code: "XACT_4004",
        message: `Entity not found for id "${id}" on platform "${platform}"`,
        statusCode: 404,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform,
      });
    }

    const post = posts[0];
    this.validateItem(post);
    await this.#persist([post]);

    return { post };
  }
}
