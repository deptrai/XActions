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

function extractResponseBody(response, platform, action) {
  if (!response) return '';
  const status = response.status || response.statusCode || 200;
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
  return response.body || response.data || response;
}

export class IpLegalCrawler extends AbstractCrawler {
  name = 'ipvietnam';
  requiresAuth = false;
  requiresProxy = false;
  platform = 'ipvietnam';
  category = 'legal';

  /**
   * @param {Object} [deps={}]
   * @param {IpLegalClient} [deps.client]
   * @param {import('../../../core/base-store.js').AbstractStore} [deps.store]
   * @param {any} [deps.publisher]
   */
  constructor(deps = {}) {
    const client = deps.client || new IpLegalClient({
      requiresProxy: deps.requiresProxy ?? false,
      proxyPool: deps.proxyPool,
      governor: deps.governor,
      baseUrl: deps.baseUrl,
    });

    super({
      ...deps,
      client,
      requiresAuth: false,
      requiresProxy: false,
    });

    this.publisher = deps.publisher || null;
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
      handler: (args) => this.searchGazette(args),
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
      handler: (args) => this.searchGazette(args),
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
      handler: (args) => this.getWeeklyList(args),
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
      handler: (args) => this.getYearlySummary(args),
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
      handler: (args) => this.detail(args),
    });
  }

  async #persist(posts) {
    if (!posts || !posts.length) return;

    if (this.store) {
      if (typeof this.store.storeBatch === 'function') {
        await this.store.storeBatch(posts).catch(() => {});
      } else if (typeof this.store.savePost === 'function') {
        for (const item of posts) {
          await this.store.savePost(item).catch(() => {});
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
   * @param {Record<string, any>} [args={}]
   * @returns {Promise<{ posts: import('../../../core/types.js').PostItem[], pageInfo: Object }>}
   */
  async searchGazette(args = {}) {
    const page = Math.max(1, Number(args.page) || 1);
    const limit = Math.max(1, Number(args.limit) || 20);

    const response = await this.client.getGazetteList({ page });
    const data = extractResponseBody(response, 'ipvietnam', 'search_gazette');

    let allPosts = normalizeIpLegalResults(data, 'search_gazette', { baseUrl: this.client?.baseUrl });

    // If result contains gazette articles rather than application rows, auto-traverse the latest weekly article to fetch applications
    if (allPosts.length > 0 && allPosts[0].metadata?.articleUrl && !allPosts[0].metadata?.applicationNumber) {
      try {
        // Prioritize article that specifies a week ('tuần' or 'tuan')
        const latestArticle = allPosts.find((p) => /\/content\//i.test(p.metadata?.articleUrl || '') && /tuần\s*\d+/i.test(p.title)) || allPosts.find((p) => /\/content\//i.test(p.metadata?.articleUrl || '')) || allPosts[0];
        const articleResp = await this.client.getArticleContent(latestArticle.metadata.articleUrl);
        const articleData = extractResponseBody(articleResp, 'ipvietnam', 'get_weekly_list');
        const applicationPosts = normalizeIpLegalResults(articleData, 'get_weekly_list', {
          articleUrl: latestArticle.metadata.articleUrl,
          articleTitle: latestArticle.title,
        });
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
   * @param {Record<string, any>} args
   * @returns {Promise<{ posts: import('../../../core/types.js').PostItem[], pageInfo: Object }>}
   */
  async getWeeklyList(args = {}) {
    const articleUrl = args.articleUrl || args.url;
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

    const limit = Math.max(1, Number(args.limit) || 100);
    const response = await this.client.getArticleContent(articleUrl);
    const data = extractResponseBody(response, 'ipvietnam', 'get_weekly_list');

    const allPosts = normalizeIpLegalResults(data, 'get_weekly_list', { articleUrl });
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
   * @param {Record<string, any>} [args={}]
   * @returns {Promise<{ posts: import('../../../core/types.js').PostItem[], pageInfo: Object }>}
   */
  async getYearlySummary(args = {}) {
    const year = args.year || new Date().getFullYear();
    const response = await this.client.getYearlySummary({ year });
    const data = extractResponseBody(response, 'ipvietnam', 'yearly_summary');

    const posts = normalizeIpLegalResults(data, 'yearly_summary', { year });

    if (posts.length === 0 && args.year) {
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
   * @param {Record<string, any>} args
   * @returns {Promise<{ post: import('../../../core/types.js').PostItem }>}
   */
  async detail(args = {}) {
    const rawId = args?.id || args?.applicationNumber;
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
    if (args.articleUrl) {
      const response = await this.client.getArticleContent(args.articleUrl);
      data = extractResponseBody(response, 'ipvietnam', 'detail');
    } else {
      const response = await this.client.detail({ id: applicationNumber });
      data = extractResponseBody(response, 'ipvietnam', 'detail');
    }

    const post = normalizeIpLegalResults(data, 'detail', { id: applicationNumber, articleUrl: args.articleUrl });
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
