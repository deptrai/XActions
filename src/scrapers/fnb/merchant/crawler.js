// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * FnbMerchantCrawler — F&B merchant directory crawler for PasGo, Foody, and Riviu.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractCrawler } from '../../../core/base-crawler.js';
import { FnbMerchantClient } from './client.js';
import { FnbPlatformResponseValidator } from './validator.js';
import { normalizeFnbMerchantResults } from './normalizer.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';

/**
 * @typedef {import('../../../core/types.js').PostItem} PostItem
 */

const VALID_PLATFORMS = new Set(['pasgo', 'foody', 'riviu', 'fnb']);

export class FnbMerchantCrawler extends AbstractCrawler {
  /** @type {string} */
  name = 'fnb';

  /** @type {string} */
  platform = 'fnb';

  /** @type {boolean} */
  requiresAuth = false;

  /**
   * @param {Record<string, any>} [deps={}]
   */
  constructor(deps = {}) {
    const client = deps.client || new FnbMerchantClient(deps);
    super({ client, ...deps, requiresAuth: deps.requiresAuth ?? false });

    this.publisher = deps.publisher || deps.eventPublisher || null;

    this.registerAction({
      action: 'search_restaurants',
      description: 'Search restaurants by city and optional district',
      category: 'fnb_merchant',
      requiresAuth: false,
      requiredArgs: ['platform', 'city'],
      optionalArgs: ['district', 'page', 'limit'],
      example: { platform: 'pasgo', city: 'ha-noi', district: 'dong-da' },
      outputType: '{ posts: PostItem[], pageInfo: { has_next_page: boolean, page: number } }',
      handler: (/** @type {any} */ args) => this.searchRestaurants(args),
    });

    this.registerAction({
      action: 'newly_opened',
      description: 'Find newly opened restaurants within N days',
      category: 'fnb_merchant',
      requiresAuth: false,
      requiredArgs: ['platform', 'days'],
      optionalArgs: ['city', 'page', 'limit'],
      example: { platform: 'foody', days: 30, city: 'ho-chi-minh' },
      outputType: '{ posts: PostItem[], pageInfo: { has_next_page: boolean, page: number } }',
      handler: (/** @type {any} */ args) => this.getNewlyOpened(args),
    });

    this.registerAction({
      action: 'search_by_district',
      description: 'Search restaurants within a specific district',
      category: 'fnb_merchant',
      requiresAuth: false,
      requiredArgs: ['platform', 'city', 'district'],
      optionalArgs: ['page', 'limit'],
      example: { platform: 'pasgo', city: 'ha-noi', district: 'dong-da' },
      outputType: '{ posts: PostItem[], pageInfo: { has_next_page: boolean, page: number } }',
      handler: (/** @type {any} */ args) => this.searchByDistrict(args),
    });

    this.registerAction({
      action: 'detail',
      description: 'Get restaurant detail by id/slug',
      category: 'fnb_merchant',
      requiresAuth: false,
      requiredArgs: ['platform', 'id'],
      optionalArgs: ['slug', 'city'],
      example: { platform: 'pasgo', id: '123', city: 'ha-noi' },
      outputType: '{ post: PostItem }',
      handler: (/** @type {any} */ args) => this.detail(args),
    });
  }

  /**
   * @param {Record<string, any>} args
   * @returns {string}
   */
  #resolvePlatform(args) {
    const platform = typeof args?.platform === 'string' ? args.platform.trim().toLowerCase() : 'fnb';
    if (!platform || !VALID_PLATFORMS.has(platform)) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: `Invalid or missing platform: "${platform}". Must be one of: ${[...VALID_PLATFORMS].join(', ')}`,
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'fnb',
      });
    }
    if (platform === 'fnb') {
      // Default to PasGo when generic alias is used
      return 'pasgo';
    }
    return platform;
  }

  /**
   * @param {Record<string, any>} args
   * @returns {Promise<{ posts: PostItem[], pageInfo: { has_next_page: boolean, page: number } }>}
   */
  async searchRestaurants(args = {}) {
    const platform = this.#resolvePlatform(args);
    const page = Math.max(1, Number(args.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(args.limit) || 20));

    const searchArgs = { ...args, platform, page, limit };
    const response = await this.client.searchRestaurants(searchArgs);
    const data = typeof response === 'string' ? response : (response?.body !== undefined ? response.body : response.data);

    const posts = normalizeFnbMerchantResults(data, 'search', { platform });
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
  async getNewlyOpened(args = {}) {
    const platform = this.#resolvePlatform(args);
    const page = Math.max(1, Number(args.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(args.limit) || 20));
    const days = Math.max(1, Number(args.days) || 30);

    const searchArgs = { ...args, platform, page, limit };
    const response = await this.client.getNewlyOpened(searchArgs);
    const data = typeof response === 'string' ? response : (response?.body !== undefined ? response.body : response.data);

    const posts = normalizeFnbMerchantResults(data, 'newly_opened', { platform, days });
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
  async searchByDistrict(args = {}) {
    const platform = this.#resolvePlatform(args);
    const page = Math.max(1, Number(args.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(args.limit) || 20));

    if (!args.district) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: district',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'fnb',
      });
    }

    const searchArgs = { ...args, platform, page, limit };
    const response = await this.client.searchByDistrict(searchArgs);
    const data = typeof response === 'string' ? response : (response?.body !== undefined ? response.body : response.data);

    const posts = normalizeFnbMerchantResults(data, 'search_by_district', { platform, district: args.district });
    const result = posts.slice(0, limit);

    await this.#persist(result);

    return {
      posts: result,
      pageInfo: { has_next_page: posts.length >= limit, page },
    };
  }

  /**
   * @param {Record<string, any>} args
   * @returns {Promise<{ post: PostItem }>}
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
        platform: 'fnb',
      });
    }

    const response = await this.client.detail({ ...args, platform });
    const data = typeof response === 'string' ? response : (response?.body !== undefined ? response.body : response.data);

    const posts = normalizeFnbMerchantResults(data, 'detail', { platform });
    if (!posts.length) {
      throw new PlatformError({
        type: ErrorTypes.NOT_FOUND,
        code: 'XACT_4001',
        message: `Restaurant not found for id "${id}" on platform "${platform}"`,
        statusCode: 404,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'fnb',
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
