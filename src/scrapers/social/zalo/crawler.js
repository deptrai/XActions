// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * ZaloCrawler — Zalo Official Account & Marketplace crawler extending AbstractCrawler.
 * Scrapes OA broadcasts/articles, followers, OA info, and Shop products.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractCrawler } from '../../../core/base-crawler.js';
import { ZaloClient } from './client.js';
import { normalizeZaloResults } from './normalizer.js';
import {
  PlatformError,
  AuthSessionExpiredError,
  ErrorTypes,
  SuggestedActions,
} from '../../../core/error-envelope.js';

export class ZaloCrawler extends AbstractCrawler {
  /** @type {string} */
  name = 'zalo';

  /** @type {string} */
  platform = 'zalo';

  /** @type {string} */
  category = 'social';

  /** @type {boolean} */
  requiresAuth = true;

  /** @type {boolean} */
  requiresProxy = false;

  /**
   * @param {Object} [deps={}]
   * @param {ZaloClient} [deps.client]
   * @param {import('../../../core/base-store.js').AbstractStore} [deps.store]
   * @param {any} [deps.publisher]
   * @param {import('../../../core/account-pool.js').AccountPool} [deps.accountPool]
   * @param {import('../../../core/adaptive-governor.js').AdaptiveRateGovernor} [deps.governor]
   * @param {import('../../../proxy/proxy-pool.js').ProxyIpPool} [deps.proxyPool]
   * @param {string} [deps.accessToken]
   * @param {string} [deps.baseUrl]
   */
  constructor(deps = {}) {
    const client = deps.client || new ZaloClient({
      accessToken: deps.accessToken,
      baseUrl: deps.baseUrl,
      accountPool: deps.accountPool,
      governor: deps.governor,
      proxyPool: deps.proxyPool,
      requiresAuth: deps.requiresAuth ?? true,
      requiresProxy: deps.requiresProxy ?? false,
    });

    super({
      ...deps,
      client,
      requiresAuth: deps.requiresAuth ?? true,
    });

    this.publisher = deps.publisher || deps.eventPublisher || null;
    this.#registerActions();
  }

  async start(command) {
    if (command?.args && (command.args.accessToken || command.args.token)) {
      command.args.accountId = command.args.accountId || "zalo:token";
    }
    if (command?.session && (command.session.accessToken || command.session.token)) {
      command.session.accountId = command.session.accountId || "zalo:token";
    }
    return super.start(command);
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
    // 1. OA Posts / Articles
    this.registerAction({
      action: 'oa_posts',
      description: 'Fetch official account broadcasts and articles',
      inputSchema: {
        type: 'object',
        properties: {
          oaId: { type: 'string' },
          limit: { type: 'number', default: 10 },
          offset: { type: 'number', default: 0 },
          type: { type: 'string', default: 'normal' },
        },
      },
      handler: (args) => this.oaPosts(args),
    });

    this.registerAction({
      action: 'posts',
      description: 'Alias for oa_posts',
      handler: (args) => this.oaPosts(args),
    });

    this.registerAction({
      action: 'articles',
      description: 'Alias for oa_posts',
      handler: (args) => this.oaPosts(args),
    });

    this.registerAction({
      action: 'feed',
      description: 'Alias for oa_posts',
      handler: (args) => this.oaPosts(args),
    });

    // 2. OA Followers
    this.registerAction({
      action: 'oa_followers',
      description: 'Fetch followers of a Zalo Official Account',
      inputSchema: {
        type: 'object',
        properties: {
          oaId: { type: 'string' },
          offset: { type: 'number', default: 0 },
          count: { type: 'number', default: 50 },
        },
      },
      handler: (args) => this.oaFollowers(args),
    });

    this.registerAction({
      action: 'followers',
      description: 'Alias for oa_followers',
      handler: (args) => this.oaFollowers(args),
    });

    // 3. OA Profile / Info
    this.registerAction({
      action: 'oa_detail',
      description: 'Fetch details of a Zalo Official Account',
      inputSchema: {
        type: 'object',
        properties: {
          oaId: { type: 'string' },
        },
      },
      handler: (args) => this.oaDetail(args),
    });

    this.registerAction({
      action: 'oa_info',
      description: 'Alias for oa_detail',
      handler: (args) => this.oaDetail(args),
    });

    this.registerAction({
      action: 'detail',
      description: 'Alias for oa_detail',
      handler: (args) => this.oaDetail(args),
    });

    this.registerAction({
      action: 'profile',
      description: 'Alias for oa_detail',
      handler: (args) => this.oaDetail(args),
    });

    this.registerAction({
      action: 'info',
      description: 'Alias for oa_detail',
      handler: (args) => this.oaDetail(args),
    });

    // 4. Marketplace / Shop Products
    this.registerAction({
      action: 'marketplace_products',
      description: 'Fetch products published on Zalo OA Shop',
      inputSchema: {
        type: 'object',
        properties: {
          oaId: { type: 'string' },
          offset: { type: 'number', default: 0 },
          limit: { type: 'number', default: 10 },
        },
      },
      handler: (args) => this.marketplaceProducts(args),
    });

    this.registerAction({
      action: 'marketplace_search',
      description: 'Alias for marketplace_products',
      handler: (args) => this.marketplaceProducts(args),
    });

    this.registerAction({
      action: 'products',
      description: 'Alias for marketplace_products',
      handler: (args) => this.marketplaceProducts(args),
    });

    this.registerAction({
      action: 'marketplace',
      description: 'Alias for marketplace_products',
      handler: (args) => this.marketplaceProducts(args),
    });
  }

  /**
   * Resolve token from arguments, account pool, or client.
   * @param {Record<string, unknown>} [args={}]
   * @param {Record<string, unknown>} [session={}]
   */
  #resolveToken(args = {}, session = {}) {
    const directToken = args.accessToken || args.token || session.accessToken || session.token;
    if (directToken && typeof directToken === 'string') {
      this.client.setAccessToken(directToken);
      return;
    }

    if (this.accountPool) {
      const accountId = args.accountId || session.accountId;
      if (accountId) {
        const record = this.accountPool.getAccount(String(accountId), 'zalo');
        if (record?.credentials?.accessToken) {
          this.client.setAccessToken(String(record.credentials.accessToken));
          return;
        }
      }
      const available = this.accountPool.listAccounts ? this.accountPool.listAccounts('zalo') : [];
      if (available.length > 0) {
        const first = available[0];
        if (first?.credentials?.accessToken) {
          this.client.setAccessToken(String(first.credentials.accessToken));
        }
      }
    }
  }

  /**
   * Persist post items and emit thin events.
   * @param {import('../../../core/types.js').PostItem[]} posts
   */
  async #persistPosts(posts) {
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
   * Persist profile items.
   * @param {import('../../../core/types.js').ProfileItem[]} profiles
   */
  async #persistProfiles(profiles) {
    if (!profiles || !profiles.length) return;

    if (this.store && typeof this.store.saveProfile === 'function') {
      for (const p of profiles) {
        await this.store.saveProfile(p).catch(() => {});
      }
    }
  }

  /**
   * Scrape Zalo OA broadcasts / articles.
   * @param {Record<string, unknown>} [args={}]
   * @returns {Promise<{ posts: import('../../../core/types.js').PostItem[], pageInfo: Object }>}
   */
  async oaPosts(args = {}) {
    this.#resolveToken(args);
    const limit = Math.max(1, Number(args.limit) || 10);
    const offset = Math.max(0, Number(args.offset) || 0);
    const type = typeof args.type === 'string' ? args.type : 'normal';

    const response = await this.client.getArticles({ offset, limit, type });
    const result = normalizeZaloResults(response, 'oa_posts', {
      oaId: args.oaId,
      oaName: args.oaName,
      offset,
      limit,
    });

    const posts = Array.isArray(result.posts) ? result.posts : [];
    for (const post of posts) {
      this.validateItem(post);
    }
    await this.#persistPosts(posts);

    return {
      posts,
      pageInfo: result.pageInfo || {
        total: posts.length,
        offset,
        limit,
        has_next_page: false,
      },
    };
  }

  /**
   * Scrape Zalo OA followers list.
   * @param {Record<string, unknown>} [args={}]
   * @returns {Promise<{ profiles: import('../../../core/types.js').ProfileItem[], pageInfo: Object }>}
   */
  async oaFollowers(args = {}) {
    this.#resolveToken(args);
    const count = Math.max(1, Number(args.count) || 50);
    const offset = Math.max(0, Number(args.offset) || 0);

    const response = await this.client.getFollowers({ offset, count });
    const result = normalizeZaloResults(response, 'oa_followers', {
      oaId: args.oaId,
      offset,
      count,
    });

    const profiles = Array.isArray(result.profiles) ? result.profiles : [];
    await this.#persistProfiles(profiles);

    return {
      profiles,
      pageInfo: result.pageInfo || {
        total: profiles.length,
        offset,
        count,
        has_next_page: false,
      },
    };
  }

  /**
   * Scrape Zalo OA info / profile details.
   * @param {Record<string, unknown>} [args={}]
   * @returns {Promise<{ profile: import('../../../core/types.js').ProfileItem }>}
   */
  async oaDetail(args = {}) {
    this.#resolveToken(args);
    const response = await this.client.getOaInfo(args);
    const result = normalizeZaloResults(response, 'oa_detail', { oaId: args.oaId });

    if (!result.profile) {
      throw new PlatformError({
        type: ErrorTypes.TARGET_NOT_FOUND,
        code: 'XACT_4004',
        message: `Zalo OA "${args.oaId || 'current'}" not found`,
        statusCode: 404,
        suggestedAction: SuggestedActions.VERIFY_URL,
        platform: 'zalo',
      });
    }

    await this.#persistProfiles([result.profile]);
    return { profile: result.profile };
  }

  /**
   * Scrape Zalo OA Marketplace / Shop products.
   * @param {Record<string, unknown>} [args={}]
   * @returns {Promise<{ posts: import('../../../core/types.js').PostItem[], pageInfo: Object }>}
   */
  async marketplaceProducts(args = {}) {
    this.#resolveToken(args);
    const limit = Math.max(1, Number(args.limit) || 10);
    const offset = Math.max(0, Number(args.offset) || 0);

    const response = await this.client.getProducts({ offset, limit });
    const result = normalizeZaloResults(response, 'marketplace_products', {
      oaId: args.oaId,
      offset,
      limit,
    });

    const posts = Array.isArray(result.posts) ? result.posts : [];
    for (const post of posts) {
      this.validateItem(post);
    }
    await this.#persistPosts(posts);

    return {
      posts,
      pageInfo: result.pageInfo || {
        total: posts.length,
        offset,
        limit,
        has_next_page: false,
      },
    };
  }
}
