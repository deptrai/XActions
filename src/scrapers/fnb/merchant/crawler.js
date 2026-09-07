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

/**
 * Extract response body and validate HTTP status.
 * @param {any} response
 * @param {string} platform
 * @param {string} action
 * @returns {string}
 */
function extractResponseBody(response, platform, action) {
  if (response === null || response === undefined) {
    throw new PlatformError({
      type: ErrorTypes.INTERNAL,
      code: 'XACT_5001',
      message: `Empty response from ${platform} during ${action}`,
      statusCode: 500,
      suggestedAction: SuggestedActions.ROTATE_PROXY,
      platform,
    });
  }

  const status = response?.status ?? response?.statusCode ?? 200;
  const body = typeof response === 'string' ? response : (response?.body ?? response?.data ?? '');

  if (status >= 400 && status < 500) {
    const type = status === 404 ? ErrorTypes.NOT_FOUND : ErrorTypes.INVALID_ARGS;
    throw new PlatformError({
      type,
      code: 'XACT_4001',
      message: `${platform} returned HTTP ${status} for ${action}`,
      statusCode: status,
      suggestedAction: status === 404 ? SuggestedActions.USE_ACTIONS_LIST : SuggestedActions.ROTATE_PROXY,
      platform,
    });
  }

  if (status >= 500) {
    throw new PlatformError({
      type: ErrorTypes.INTERNAL,
      code: 'XACT_5001',
      message: `${platform} returned HTTP ${status} for ${action}`,
      statusCode: status,
      suggestedAction: SuggestedActions.ROTATE_PROXY,
      platform,
    });
  }

  return body;
}

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
      requiredArgs: ['city'],
      optionalArgs: ['platform', 'district', 'page', 'limit'],
      example: { platform: 'pasgo', city: 'ha-noi', district: 'dong-da' },
      outputType: '{ posts: PostItem[], pageInfo: { has_next_page: boolean, page: number } }',
      handler: (/** @type {any} */ args) => this.searchRestaurants(args),
    });

    this.registerAction({
      action: 'newly_opened',
      description: 'Find newly opened restaurants within N days',
      category: 'fnb_merchant',
      requiresAuth: false,
      requiredArgs: ['days'],
      optionalArgs: ['platform', 'city', 'page', 'limit'],
      example: { platform: 'foody', days: 30, city: 'ho-chi-minh' },
      outputType: '{ posts: PostItem[], pageInfo: { has_next_page: boolean, page: number } }',
      handler: (/** @type {any} */ args) => this.getNewlyOpened(args),
    });

    this.registerAction({
      action: 'search_by_district',
      description: 'Search restaurants within a specific district',
      category: 'fnb_merchant',
      requiresAuth: false,
      requiredArgs: ['city', 'district'],
      optionalArgs: ['platform', 'page', 'limit'],
      example: { platform: 'pasgo', city: 'ha-noi', district: 'dong-da' },
      outputType: '{ posts: PostItem[], pageInfo: { has_next_page: boolean, page: number } }',
      handler: (/** @type {any} */ args) => this.searchByDistrict(args),
    });

    this.registerAction({
      action: 'detail',
      description: 'Get restaurant detail by id/slug',
      category: 'fnb_merchant',
      requiresAuth: false,
      requiredArgs: ['id'],
      optionalArgs: ['platform', 'slug', 'city'],
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
    const raw = typeof args?.platform === 'string' ? args.platform.trim().toLowerCase() : 'fnb';
    const platform = raw || 'fnb';
    if (!VALID_PLATFORMS.has(platform)) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: `Invalid or missing platform: "${platform}". Must be one of: ${[...VALID_PLATFORMS].join(', ')}`,
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: raw || 'fnb',
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

    if (!args.city) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: city',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform,
      });
    }

    const page = Math.max(1, Number(args.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(args.limit) || 20));

    const searchArgs = { ...args, platform, page, limit };
    const response = await this.client.searchRestaurants(searchArgs);
    const data = extractResponseBody(response, platform, 'search_restaurants');

    const posts = normalizeFnbMerchantResults(data, 'search', { platform });
    for (const post of posts) {
      this.validateItem(post);
    }
    const result = posts.slice(0, limit);

    await this.#persist(result);

    return {
      posts: result,
      pageInfo: { has_next_page: posts.length === limit, page },
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

    const searchArgs = { ...args, platform, page, limit, days };
    const response = await this.client.getNewlyOpened(searchArgs);
    const data = extractResponseBody(response, platform, 'newly_opened');

    const posts = normalizeFnbMerchantResults(data, 'newly_opened', { platform, days });
    for (const post of posts) {
      this.validateItem(post);
    }
    const result = posts.slice(0, limit);

    await this.#persist(result);

    return {
      posts: result,
      pageInfo: { has_next_page: posts.length === limit, page },
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
        platform,
      });
    }

    const searchArgs = { ...args, platform, page, limit };
    const response = await this.client.searchByDistrict(searchArgs);
    const data = extractResponseBody(response, platform, 'search_by_district');

    const posts = normalizeFnbMerchantResults(data, 'search_by_district', { platform, district: args.district });
    for (const post of posts) {
      this.validateItem(post);
    }
    const result = posts.slice(0, limit);

    await this.#persist(result);

    return {
      posts: result,
      pageInfo: { has_next_page: posts.length === limit, page },
    };
  }

  /**
   * @param {Record<string, any>} args
   * @returns {Promise<{ post: PostItem }>}
   */
  async detail(args = {}) {
    const platform = this.#resolvePlatform(args);
    const id = typeof args?.id === 'number' ? String(args.id) : (typeof args?.id === 'string' ? args.id.trim() : '');
    if (!id) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: id',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform,
      });
    }

    const response = await this.client.detail({ ...args, platform });
    const data = extractResponseBody(response, platform, 'detail');

    const posts = normalizeFnbMerchantResults(data, 'detail', { platform });
    for (const post of posts) {
      this.validateItem(post);
    }
    if (!posts.length) {
      throw new PlatformError({
        type: ErrorTypes.NOT_FOUND,
        code: 'XACT_4001',
        message: `Restaurant not found for id "${id}" on platform "${platform}"`,
        statusCode: 404,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform,
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
