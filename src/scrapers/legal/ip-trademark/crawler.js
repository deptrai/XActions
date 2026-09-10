// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * IP Legal & Trademark Crawler extending AbstractCrawler.
 * Scrapes official IP trademark and patent gazette data from ipvietnam.gov.vn.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractCrawler } from '../../../core/base-crawler.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';
import { IpLegalClient } from './client.js';
import { normalizeIpLegalResults } from './normalizer.js';
import { normalizeApplicationNumber } from './schema.js';

/**
 * Extract the body/data from a response object.
 * @param {Record<string, unknown> | null} response
 * @param {string} platform
 * @param {string} action
 * @returns {unknown}
 */
function extractResponseBody(response, platform, action) {
  if (!response) return '';
  const r = /** @type {Record<string, unknown>} */ (response);
  const status = Number(r.status || r.statusCode || 200);
  if (status >= 400) {
    throw new PlatformError({
      type: status === 404 ? ErrorTypes.NOT_FOUND : ErrorTypes.INTERNAL,
      code: status === 404 ? 'XACT_4004' : 'XACT_5001',
      message: `HTTP ${status} from ${platform} on action "${action}"`,
      statusCode: status,
      suggestedAction: status === 404 ? SuggestedActions.USE_ACTIONS_LIST : SuggestedActions.RETRY_AFTER_DELAY,
      platform,
    });
  }
  return r.body || r.data || r;
}

/**
 * Normalize normalizeIpLegalResults output to always be an array.
 * @param {Array<import('../../../core/types.js').PostItem> | import('../../../core/types.js').PostItem | null} result
 * @returns {import('../../../core/types.js').PostItem[]}
 */
function toPostArray(result) {
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

export class IpLegalCrawler extends AbstractCrawler {
  name = 'ipvietnam';
  requiresAuth = false;
  requiresProxy = false;
  platform = 'ipvietnam';

  /**
   * @param {object} [deps={}]
   * @param {IpLegalClient} [deps.client]
   * @param {import('../../../core/base-store.js').AbstractStore} [deps.store]
   * @param {unknown} [deps.publisher]
   * @param {boolean} [deps.requiresProxy]
   * @param {unknown} [deps.proxyPool]
   * @param {unknown} [deps.governor]
   * @param {string} [deps.baseUrl]
   */
  constructor(deps = {}) {
    const d = /** @type {Record<string, unknown>} */ (deps);
    const client = d.client || new IpLegalClient({
      requiresProxy: d.requiresProxy ?? false,
      proxyPool: d.proxyPool,
      governor: d.governor,
      baseUrl: d.baseUrl,
    });

    super({
      client: /** @type {import('../../../core/base-crawler.js').ClientLike} */ (client),
      store: /** @type {import('../../../core/base-crawler.js').StoreLike | undefined} */ (d.store),
      governor: /** @type {import('../../../core/adaptive-governor.js').AdaptiveRateGovernor | undefined} */ (d.governor),
      requiresAuth: false,
    });

    this.client = /** @type {IpLegalClient & Record<string, Function>} */ (client);
    /** @type {Record<string, Function> | null} */
    this.publisher = (/** @type {Record<string, Function> | null} */ (d.publisher)) || null;
    this.category = 'legal';
    this.#registerActions();
  }

  async init() {
    return Promise.resolve();
  }

  async cleanup() {
    if (this.client && typeof this.client.cleanup === 'function') {
      await this.client.cleanup().catch(() => {});
    }
  }

  #registerActions() {
    this.registerAction({
      action: 'search_gazette',
      description: 'Search weekly trademark publication gazette list',
      inputSchema: {
        type: 'object',
        properties: {
          page: { type: 'number', default: 1 },
          limit: { type: 'number', default: 20 },
        },
      },
      handler: (/** @type {Record<string, unknown>} */ args) => this.searchGazette(args),
    });

    this.registerAction({
      action: 'search',
      description: 'Alias for search_gazette',
      inputSchema: {
        type: 'object',
        properties: {
          page: { type: 'number', default: 1 },
          limit: { type: 'number', default: 20 },
        },
      },
      handler: (/** @type {Record<string, unknown>} */ args) => this.searchGazette(args),
    });

    this.registerAction({
      action: 'get_weekly_list',
      description: 'Get weekly list of trademark applications from article URL',
      inputSchema: {
        type: 'object',
        properties: {
          articleUrl: { type: 'string', description: 'URL or path to gazette article' },
          limit: { type: 'number', default: 50 },
        },
        required: ['articleUrl'],
      },
      handler: (/** @type {Record<string, unknown>} */ args) => this.getWeeklyList(args),
    });

    this.registerAction({
      action: 'yearly_summary',
      description: 'Get yearly gazette summary and spreadsheet download links',
      inputSchema: {
        type: 'object',
        properties: {
          year: { type: 'number', default: 2026 },
        },
      },
      handler: (/** @type {Record<string, unknown>} */ args) => this.getYearlySummary(args),
    });

    this.registerAction({
      action: 'detail',
      description: 'Get detail of trademark application by number',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Application number (e.g. 4-2026-11740)' },
          articleUrl: { type: 'string' },
        },
        required: ['id'],
      },
      handler: (/** @type {Record<string, unknown>} */ args) => this.detail(args),
    });
  }

  /**
   * @param {import('../../../core/types.js').PostItem[]} posts
   */
  async #persist(posts) {
    if (!posts || !posts.length) return;

    if (this.store) {
      const storeLike = /** @type {{ storeBatch?: (p: any[]) => Promise<any>; savePost?: (p: any) => Promise<any> }} */ (/** @type {unknown} */ (this.store));
      if (typeof storeLike.storeBatch === "function") {
        await storeLike.storeBatch(posts).catch(() => {});
      } else if (typeof storeLike.savePost === "function") {
        for (const item of posts) {
          await storeLike.savePost(item).catch(() => {});
        }
      }
    }

    if (this.publisher && typeof this.publisher.publish === 'function') {
      for (const item of posts) {
        await this.publisher.publish(item, this.scraperId).catch(() => {});
      }
    }
  }

  /**
   * Search weekly gazette articles.
   * @param {Record<string, unknown>} [args={}]
   * @returns {Promise<{ posts: import('../../../core/types.js').PostItem[], pageInfo: Record<string, unknown> }>}
   */
  async searchGazette(args = {}) {
    const a = /** @type {Record<string, unknown>} */ (args);
    const page = Math.max(1, Number(a.page) || 1);
    const limit = Math.max(1, Number(a.limit) || 20);

    const response = await this.client.getGazetteList({ page });
    const data = extractResponseBody(response, 'ipvietnam', 'search_gazette');

    let allPosts = toPostArray(normalizeIpLegalResults(/** @type {any} */ (data), 'search_gazette', { baseUrl: this.client?.baseUrl }));

    // If result contains gazette articles rather than application rows, auto-traverse the latest weekly article to fetch applications
    const firstMeta = /** @type {Record<string, unknown>} */ (allPosts[0].metadata || {});
    if (allPosts.length > 0 && firstMeta.articleUrl && !firstMeta.applicationNumber) {
      try {
        // Prioritize article that specifies a week ('tuần' or 'tuan')
        const hasArticleUrl = (/** @type {import('../../../core/types.js').PostItem} */ p) => {
          const m = /** @type {Record<string, unknown>} */ (p.metadata || {});
          return /\/content\//i.test(String(m.articleUrl || ''));
        };
        const hasWeek = (/** @type {import('../../../core/types.js').PostItem} */ p) => /tuần\s*\d+/i.test(p.title || '');
        const latestArticle = allPosts.find((p) => hasArticleUrl(p) && hasWeek(p)) || allPosts.find((p) => hasArticleUrl(p)) || allPosts[0];
        const latestMeta = /** @type {Record<string, unknown>} */ (latestArticle.metadata || {});
        const articleResp = await this.client.getArticleContent(/** @type {string} */ (latestMeta.articleUrl));
        const articleData = extractResponseBody(articleResp, 'ipvietnam', 'get_weekly_list');
        const applicationPosts = toPostArray(normalizeIpLegalResults(/** @type {any} */ (articleData), 'get_weekly_list', {
          articleUrl: latestMeta.articleUrl,
          articleTitle: latestArticle.title,
        }));
        if (applicationPosts.length > 0) {
          allPosts = applicationPosts;
        }
      } catch {
        // Fall back to article listing if traversal fails
      }
    }

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
   * Get applications inside a weekly article table.
   * @param {Record<string, unknown>} args
   * @returns {Promise<{ posts: import('../../../core/types.js').PostItem[], pageInfo: Record<string, unknown> }>}
   */
  async getWeeklyList(args = {}) {
    const a = /** @type {Record<string, unknown>} */ (args);
    const articleUrl = a.articleUrl || a.url;
    if (!articleUrl) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'articleUrl is required for get_weekly_list',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'ipvietnam',
      });
    }

    const limit = Math.max(1, Number(a.limit) || 100);
    const response = await this.client.getArticleContent(/** @type {string} */ (articleUrl));
    const data = extractResponseBody(response, 'ipvietnam', 'get_weekly_list');

    const allPosts = toPostArray(normalizeIpLegalResults(/** @type {any} */ (data), 'get_weekly_list', { articleUrl }));
    const posts = allPosts.slice(0, limit);

    for (const post of posts) {
      this.validateItem(post);
    }
    await this.#persist(posts);

    return {
      posts,
      pageInfo: {
        has_next_page: allPosts.length >= limit,
        page: 1,
        total: allPosts.length,
      },
    };
  }

  /**
   * Get yearly gazette documents and summary links.
   * @param {Record<string, unknown>} [args={}]
   * @returns {Promise<{ posts: import('../../../core/types.js').PostItem[], pageInfo: Record<string, unknown> }>}
   */
  async getYearlySummary(args = {}) {
    const a = /** @type {Record<string, unknown>} */ (args);
    const year = Number(a.year) || new Date().getFullYear();
    const response = await this.client.getYearlySummary({ year });
    const data = extractResponseBody(response, 'ipvietnam', 'yearly_summary');

    const posts = toPostArray(normalizeIpLegalResults(/** @type {any} */ (data), 'yearly_summary', { year }));

    if (posts.length === 0 && a.year != null) {
      throw new PlatformError({
        type: ErrorTypes.NOT_FOUND,
        code: 'XACT_4004',
        message: `No yearly gazette documents found for year ${year}`,
        statusCode: 404,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'ipvietnam',
      });
    }

    for (const post of posts) {
      this.validateItem(post);
    }
    await this.#persist(posts);

    return {
      posts,
      pageInfo: {
        has_next_page: false,
        page: 1,
        total: posts.length,
      },
    };
  }

  /**
   * Get detail for an application number.
   * @param {Record<string, unknown>} args
   * @returns {Promise<{ post: import('../../../core/types.js').PostItem }>}
   */
  async detail(args = {}) {
    const a = /** @type {Record<string, unknown>} */ (args);
    const rawId = /** @type {string | undefined} */ (a?.id || a?.applicationNumber);
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

    let data;
    if (a.articleUrl) {
      const response = await this.client.getArticleContent(/** @type {string} */ (a.articleUrl));
      data = extractResponseBody(/** @type {Record<string, unknown> | null} */ (response), 'ipvietnam', 'detail');
    } else {
      const response = await this.client.detail({ id: applicationNumber });
      data = extractResponseBody(/** @type {Record<string, unknown> | null} */ (response), 'ipvietnam', 'detail');
    }

    const result = normalizeIpLegalResults(/** @type {any} */ (data), 'detail', { id: applicationNumber, articleUrl: a.articleUrl });
    const post = Array.isArray(result) ? result[0] : result;
    if (!post) {
      throw new PlatformError({
        type: ErrorTypes.NOT_FOUND,
        code: 'XACT_4004',
        message: `Application number "${applicationNumber}" not found`,
        statusCode: 404,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'ipvietnam',
      });
    }

    this.validateItem(post);
    await this.#persist([post]);

    return { post };
  }
}
