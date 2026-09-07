// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * B2BRegistryExtendedCrawler — HoSoCongTy & MuaSamCong crawler with Cloudflare fallback.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractCrawler } from '../../../core/base-crawler.js';
import { B2BRegistryExtendedClient } from './client.js';
import { B2BRegistryExtendedValidator } from './validator.js';
import { normalizeB2BRegistryResults } from './normalizer.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';

/**
 * @typedef {import('../../../core/types.js').PostItem} PostItem
 */

export class B2BRegistryExtendedCrawler extends AbstractCrawler {
  /** @type {string} */
  name = 'b2b_registry_extended';

  /** @type {string} */
  platform = 'b2b_registry_extended';

  /** @type {boolean} */
  requiresAuth = false;

  /**
   * @param {Record<string, any>} [deps={}]
   */
  constructor(deps = {}) {
    const client = deps.client || new B2BRegistryExtendedClient(deps);
    super({ client, ...deps, requiresAuth: deps.requiresAuth ?? false });
    this.publisher = deps.publisher || deps.eventPublisher || null;

    this.registerAction({
      action: 'search',
      description: 'Search companies on HoSoCongTy or tenders on MuaSamCong',
      category: 'b2b',
      requiresAuth: false,
      requiredArgs: ['q'],
      optionalArgs: ['type', 'limit', 'platform', 'opt', 'p', 'd'],
      example: { q: '0013180180', platform: 'hosocongty' },
      outputType: '{ posts: PostItem[], pageInfo: { has_next_page: boolean } }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.search(args, session),
    });

    this.registerAction({
      action: 'search_tenders',
      description: 'Search tenders on MuaSamCong',
      category: 'b2b',
      requiresAuth: false,
      requiredArgs: ['keyword'],
      optionalArgs: ['searchType', 'searchScope', 'searchBy', 'keywordMatch', 'limit'],
      example: { keyword: 'xây dựng' },
      outputType: '{ posts: PostItem[], pageInfo: { has_next_page: boolean } }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.searchTenders(args, session),
    });

    this.registerAction({
      action: 'detail',
      description: 'Get detail on HoSoCongTy company or MuaSamCong tender',
      category: 'b2b',
      requiresAuth: false,
      requiredArgs: ['id'],
      optionalArgs: ['platform', 'slug', 'notifyNo', 'tenderNo'],
      example: { id: '0013180180', platform: 'hosocongty' },
      outputType: '{ post: PostItem }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.detail(args, session),
    });
  }

  /**
   * Persist posts to store and publish ThinEvent.
   * @param {PostItem[]} posts
   * @returns {Promise<void>}
   */
  async #persist(posts) {
    if (this.store && typeof this.store.storeBatch === 'function' && posts.length > 0) {
      await this.store.storeBatch(posts).catch(() => {});
    }

    if (this.publisher && typeof this.publisher.publish === 'function' && posts.length > 0) {
      for (const post of posts) {
        await this.publisher.publish({
          id: post.id,
          platform: post.platform,
          externalId: post.externalId,
          category: post.category,
          authorId: post.authorId,
          crawledAt: post.crawledAt,
          storageRef: post.id,
        }).catch(() => {});
      }
    }
  }

  /**
   * Search HoSoCongTy companies or MuaSamCong tenders.
   * @param {Record<string, any>} args
   * @param {Record<string, any>} [session]
   * @returns {Promise<{ posts: PostItem[], pageInfo: { has_next_page: boolean } }>}
   */
  async search(args, session = {}) {
    const platform = args.platform || (args.notifyNo || args.tenderNo ? 'muasamcong' : 'hosocongty');
    if (platform === 'muasamcong') {
      return this.searchTenders(args, session);
    }

    const q = args.q || args.taxCode || args.keyword;
    if (!q) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: q',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: this.platform,
      });
    }

    const client = /** @type {B2BRegistryExtendedClient} */ (this.client);
    const response = await client.searchHosocongty({
      q,
      opt: args.opt,
      p: args.p,
      d: args.d,
    });
    const html = response.body || response.data || '';
    const posts = normalizeB2BRegistryResults(html, 'search', { platform: 'hosocongty' });
    const limit = Math.max(1, Number(args.limit) || 10);

    await this.#persist(posts.slice(0, limit));

    return {
      posts: posts.slice(0, limit),
      pageInfo: { has_next_page: posts.length >= limit },
    };
  }

  /**
   * Search tenders on MuaSamCong.
   * @param {Record<string, any>} args
   * @param {Record<string, any>} [session]
   * @returns {Promise<{ posts: PostItem[], pageInfo: { has_next_page: boolean } }>}
   */
  async searchTenders(args, session = {}) {
    const keyword = args.keyword || args.q || args.taxCode;
    if (!keyword) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: keyword',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: this.platform,
      });
    }

    const client = /** @type {B2BRegistryExtendedClient} */ (this.client);
    const response = await client.searchTendersMuasamcong({
      keyword,
      searchType: args.searchType || 'bidding',
      searchScope: args.searchScope || 'lcnt',
      searchBy: args.searchBy || 'notifyNo,bidName',
      keywordMatch: args.keywordMatch || 'all',
    });

    const html = response.body || response.data || '';
    const posts = normalizeB2BRegistryResults(html, 'search', { platform: 'muasamcong' });
    const limit = Math.max(1, Number(args.limit) || 10);

    await this.#persist(posts.slice(0, limit));

    return {
      posts: posts.slice(0, limit),
      pageInfo: { has_next_page: posts.length >= limit },
    };
  }

  /**
   * Get detail on HoSoCongTy company or MuaSamCong tender.
   * @param {Record<string, any>} args
   * @param {Record<string, any>} [session]
   * @returns {Promise<{ post: PostItem }>}
   */
  async detail(args, session = {}) {
    const platform = args.platform || (args.notifyNo || args.tenderNo ? 'muasamcong' : 'hosocongty');
    const id = args.id || args.taxCode || args.notifyNo || args.tenderNo;
    if (!id) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: id (taxCode or notifyNo)',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: this.platform,
      });
    }

    const client = /** @type {B2BRegistryExtendedClient} */ (this.client);

    if (platform === 'muasamcong') {
      const response = await client.tenderDetailMuasamcong({ notifyNo: id, id: args.id });
      const html = response.body || response.data || '';
      const posts = normalizeB2BRegistryResults(html, 'detail', { platform: 'muasamcong' });
      if (!posts.length) {
        throw new PlatformError({
          type: ErrorTypes.NOT_FOUND,
          code: 'XACT_4040',
          message: `MuaSamCong tender detail not found for ${id}`,
          statusCode: 404,
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
          platform: 'muasamcong',
        });
      }
      await this.#persist(posts);
      return { post: posts[0] };
    }

    const response = await client.companyDetailHosocongty({ taxCode: id });
    const html = response.body || response.data || '';
    const posts = normalizeB2BRegistryResults(html, 'detail', { platform: 'hosocongty', taxCode: id });
    if (!posts.length) {
      throw new PlatformError({
        type: ErrorTypes.NOT_FOUND,
        code: 'XACT_4040',
        message: `HoSoCongTy company detail not found for ${id}`,
        statusCode: 404,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'hosocongty',
      });
    }
    await this.#persist(posts);
    return { post: posts[0] };
  }
}

/**
 * Convenience helper: scrape B2B registry extended actions through unified interface.
 * @param {string} action
 * @param {Record<string, any>} args
 * @param {Record<string, any>} [options={}]
 * @returns {Promise<any>}
 */
export async function scrapeB2BRegistryExtended(action, args, options = {}) {
  const client = new B2BRegistryExtendedClient(options);
  const crawler = new B2BRegistryExtendedCrawler({ client, ...options });

  try {
    return await crawler.start({ action, args, session: options.session });
  } finally {
    if (options.autoClose !== false) {
      await crawler.cleanup().catch(() => {});
    }
  }
}

export default {
  B2BRegistryExtendedClient,
  B2BRegistryExtendedCrawler,
  scrapeB2BRegistryExtended,
};
