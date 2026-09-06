// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AutomotiveCrawler — Vehicle market crawler for Oto.com.vn, BonBanh, and Chợ Tốt Xe.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractCrawler } from '../../../core/base-crawler.js';
import { AutomotiveClient } from './client.js';
import { AutomotivePlatformResponseValidator } from './validator.js';
import { normalizeAutomotiveResults } from './normalizer.js';
import { parseVndPrice, parseVnPhone } from './schema.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';

/**
 * @typedef {import('../../../core/types.js').PostItem} PostItem
 */

const VALID_PLATFORMS = new Set(['oto_vn', 'bonbanh', 'chotot_xe', 'chotot']);

export class AutomotiveCrawler extends AbstractCrawler {
  /** @type {string} */
  name = 'automotive';

  /** @type {string} */
  platform = 'automotive';

  /** @type {boolean} */
  requiresAuth = false;

  /**
   * @param {Record<string, any>} [deps={}]
   */
  constructor(deps = {}) {
    const client = deps.client || new AutomotiveClient(deps);
    super({ client, ...deps, requiresAuth: deps.requiresAuth ?? false });

    this.publisher = deps.publisher || deps.eventPublisher || null;

    this.registerAction({
      action: 'search',
      description: 'Search vehicle listings across platforms',
      category: 'automotive',
      requiresAuth: false,
      requiredArgs: ['platform'],
      optionalArgs: ['brand', 'model', 'city', 'yearMin', 'yearMax', 'priceMin', 'priceMax', 'page', 'limit'],
      example: { platform: 'oto_vn', brand: 'toyota', city: 'hanoi', page: 1 },
      outputType: '{ posts: PostItem[], pageInfo: { has_next_page: boolean, page: number } }',
      handler: (/** @type {any} */ args) => this.search(args),
    });

    this.registerAction({
      action: 'list',
      description: 'List vehicle listings with paging',
      category: 'automotive',
      requiresAuth: false,
      requiredArgs: ['platform'],
      optionalArgs: ['page', 'limit'],
      example: { platform: 'bonbanh', page: 1 },
      outputType: '{ posts: PostItem[], pageInfo: { has_next_page: boolean, page: number } }',
      handler: (/** @type {any} */ args) => this.list(args),
    });

    this.registerAction({
      action: 'detail',
      description: 'Get vehicle detail by id/slug',
      category: 'automotive',
      requiresAuth: false,
      requiredArgs: ['platform', 'id'],
      optionalArgs: ['slug'],
      example: { platform: 'bonbanh', id: '6917077' },
      outputType: '{ post: PostItem }',
      handler: (/** @type {any} */ args) => this.detail(args),
    });
  }

  /**
   * Extract PostItem[] from automotive response.
   * @param {string | Object} data
   * @param {'search' | 'list' | 'detail'} kind
   * @param {Object} context
   * @returns {PostItem[]}
   */
  #extractItems(data, kind, context = {}) {
    return normalizeAutomotiveResults(data, kind, {
      platform: context.platform,
      sourcePlatform: context.sourcePlatform || context.platform,
    });
  }

  /**
   * Validate and resolve target platform.
   * @param {any} args
   * @returns {string}
   */
  #resolvePlatform(args) {
    const platform = typeof args?.platform === 'string' ? args.platform.trim().toLowerCase() : '';
    if (!platform || !VALID_PLATFORMS.has(platform)) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: `Invalid or missing platform: "${platform}". Must be one of: ${[...VALID_PLATFORMS].join(', ')}`,
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'automotive',
      });
    }
    return platform;
  }

  /**
   * @param {Record<string, any>} args
   * @param {Object} [context]
   * @returns {Promise<{ posts: PostItem[], pageInfo: { has_next_page: boolean, page: number } }>}
   */
  async search(args = {}, context = {}) {
    const platform = this.#resolvePlatform(args);
    const page = Math.max(1, Number(args.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(args.limit) || 20));

    const searchArgs = { ...args, platform, page, limit };
    const response = await this.client.search(searchArgs);
    const data = typeof response === 'string' ? response : (response?.body !== undefined ? response.body : response.data);

    const posts = this.#extractItems(data, 'search', { platform, sourcePlatform: platform });
    const result = posts.slice(0, limit);

    await this.#persist(result);

    return {
      posts: result,
      pageInfo: { has_next_page: posts.length >= limit, page },
    };
  }

  /**
   * @param {Record<string, any>} args
   * @returns {Promise<{ posts: PostItem[], pageInfo: { has_next_page: boolean, page: number } }>}
   */
  async list(args = {}) {
    return this.search(args);
  }

  /**
   * @param {Record<string, any>} args
   * @returns {Promise<{ post: PostItem | null }>}
   */
  async detail(args = {}) {
    const platform = this.#resolvePlatform(args);
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    if (!id) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: id',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'automotive',
      });
    }

    const response = await this.client.detail({ ...args, platform });
    const data = typeof response === 'string' ? response : (response?.body !== undefined ? response.body : response.data);

    const posts = this.#extractItems(data, 'detail', { platform, sourcePlatform: platform });
    if (!posts.length) {
      throw new PlatformError({
        type: ErrorTypes.NOT_FOUND,
        code: 'XACT_4040',
        message: `Vehicle detail not found for id "${id}" on platform "${platform}"`,
        statusCode: 404,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'automotive',
      });
    }

    const post = posts[0];
    await this.#persist([post]);

    return { post };
  }

  /**
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

  /** @returns {Promise<void>} */
  async init() {}

  /** @returns {Promise<void>} */
  async cleanup() {
    if (this.client && typeof this.client.cleanup === 'function') {
      await this.client.cleanup().catch(() => {});
    }
  }
}
