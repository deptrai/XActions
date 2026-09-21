// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * MastodonCrawler — High-throughput hybrid crawler for Mastodon (Federated REST API).
 * Extends AbstractCrawler, registers profile, followers, following, posts,
 * search, hashtag, and trending actions. Conforms to universal scraping core schema.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractCrawler } from '../../../core/base-crawler.js';
import { MastodonClient } from './client.js';
import {
  resolveMastodonTarget,
  normalizeMastodonAccount,
  normalizeMastodonStatus,
  profileItemToPostItem,
} from './normalizer.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';

/**
 * @param {MastodonClient | Record<string, unknown>} [client]
 * @param {Record<string, unknown>} [options={}]
 * @returns {MastodonCrawler}
 */
export function createMastodonCrawler(client, options = {}) {
  const resolvedClient = client instanceof MastodonClient ? client : new MastodonClient(client || options || {});
  const resolvedOptions = client instanceof MastodonClient ? options : (options || {});
  return new MastodonCrawler({ client: resolvedClient, ...resolvedOptions });
}

export class MastodonCrawler extends AbstractCrawler {
  /** @type {string} */
  name = 'mastodon';

  /** @type {string} */
  platform = 'mastodon';

  /** @type {boolean} */
  requiresAuth = false;

  /** @type {MastodonClient & import('../../../core/base-crawler.js').ClientLike} */
  client;

  /** @type {any} */
  redisPublisher = null;

  /**
   * @param {Object} [deps]
   * @param {MastodonClient} [deps.client]
   * @param {import('../../../core/base-store.js').AbstractStore} [deps.store]
   * @param {import('../../../core/session-manager.js').SessionManager} [deps.sessionManager]
   * @param {import('../../../core/adaptive-governor.js').AdaptiveRateGovernor} [deps.governor]
   * @param {import('../../../core/account-pool.js').AccountPool} [deps.accountPool]
   * @param {import('../../../proxy/proxy-pool.js').ProxyIpPool} [deps.proxyPool]
   * @param {any} [deps.redisPublisher]
   * @param {boolean} [deps.requiresAuth]
   * @param {boolean} [deps.requiresProxy]
   */
  constructor(deps = {}) {
    const { client: explicitClient, ...clientDeps } = deps;
    const client = /** @type {MastodonClient & import('../../../core/base-crawler.js').ClientLike} */ (
      explicitClient || new MastodonClient(clientDeps)
    );

    super({
      client,
      store: deps.store ? /** @type {import('../../../core/base-crawler.js').StoreLike} */ (deps.store) : undefined,
      sessionManager: deps.sessionManager,
      governor: deps.governor,
      accountPool: deps.accountPool,
      requiresAuth: deps.requiresAuth !== undefined ? deps.requiresAuth : false,
    });

    this.client = client;
    this.redisPublisher = deps.redisPublisher || null;

    // ── 1. Action: profile ──
    this.registerAction({
      action: 'profile',
      description: 'Scrape actor profile on Mastodon by username or URL',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['username'],
      optionalArgs: ['instance', 'target', 'accessToken'],
      outputType: 'ProfileItem',
      example: { username: 'Gargron', instance: 'https://mastodon.social' },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getProfile(args, session),
    });

    // ── 2. Action: followers ──
    this.registerAction({
      action: 'followers',
      description: 'Scrape followers for an account on Mastodon',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['username'],
      optionalArgs: ['instance', 'limit', 'max_id', 'onProgress', 'accessToken'],
      outputType: '{ profiles: ProfileItem[], pageInfo: { next_max_id: string | null, has_next_page: boolean } }',
      example: { username: 'Gargron', limit: 40 },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getFollowers(args, session),
    });

    // ── 3. Action: following ──
    this.registerAction({
      action: 'following',
      description: 'Scrape accounts followed by a user on Mastodon',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['username'],
      optionalArgs: ['instance', 'limit', 'max_id', 'onProgress', 'accessToken'],
      outputType: '{ profiles: ProfileItem[], pageInfo: { next_max_id: string | null, has_next_page: boolean } }',
      example: { username: 'Gargron', limit: 40 },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getFollowing(args, session),
    });

    // ── 4. Action: posts (alias: get_user_feed) ──
    this.registerAction({
      action: 'posts',
      description: 'Scrape posts/statuses timeline for an account on Mastodon',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['username'],
      optionalArgs: ['instance', 'limit', 'max_id', 'since_id', 'exclude_replies', 'onProgress', 'accessToken'],
      outputType: 'PostItem[]',
      example: { username: 'Gargron', limit: 20 },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getPosts(args, session),
    });

    // Story 31.1 fix: single-post read for x_download_media postUrl-only path.
    this.registerAction({
      action: 'post_detail',
      description: 'Fetch a single Mastodon status by numeric ID or public post URL via GET /api/v1/statuses/:id',
      category: 'social',
      requiresAuth: false,
      requiredArgs: [],
      optionalArgs: ['statusId', 'id', 'url', 'postUrl', 'postId', 'instance', 'accessToken'],
      outputType: '{ post: PostItem, posts: PostItem[] }',
      example: { postUrl: 'https://mastodon.social/@Gargron/1234567890' },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getPostDetail(args, session),
    });

    this.registerAction({
      action: 'get_user_feed',
      description: 'Alias for posts action',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['username'],
      optionalArgs: ['instance', 'limit', 'max_id', 'accessToken'],
      outputType: 'PostItem[]',
      example: { username: 'Gargron', limit: 20 },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getPosts(args, session),
    });

    // ── 5. Action: search ──
    this.registerAction({
      action: 'search',
      description: 'Search content, accounts, or hashtags on Mastodon',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['query'],
      optionalArgs: ['instance', 'type', 'limit', 'max_id', 'accessToken'],
      outputType: '{ posts: PostItem[], profiles: ProfileItem[], hashtags: any[] }',
      example: { query: 'open source', limit: 20 },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.search(args, session),
    });

    // ── 6. Action: hashtag ──
    this.registerAction({
      action: 'hashtag',
      description: 'Scrape posts matching a specific hashtag on Mastodon',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['hashtag'],
      optionalArgs: ['instance', 'limit', 'max_id', 'accessToken'],
      outputType: 'PostItem[]',
      example: { hashtag: 'technology', limit: 20 },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getHashtag(args, session),
    });

    // ── 7. Action: trending ──
    this.registerAction({
      action: 'trending',
      description: 'Scrape trending statuses on Mastodon',
      category: 'social',
      requiresAuth: false,
      requiredArgs: [],
      optionalArgs: ['instance', 'limit', 'accessToken'],
      outputType: 'PostItem[]',
      example: { limit: 20 },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getTrending(args, session),
    });

    // ── 8. Write Action: post ──
    this.registerAction({
      action: 'post',
      description: 'Publish a new status to Mastodon',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['text'],
      optionalArgs: ['status', 'media_ids', 'visibility', 'instance', 'dryRun', 'accessToken'],
      outputType: '{ status: any, success: boolean }',
      example: { text: 'Hello Mastodon from XActions', dryRun: false },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.post(args, session),
    });

    // ── 9. Write Action: reply ──
    this.registerAction({
      action: 'reply',
      description: 'Reply to an existing status on Mastodon',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['text', 'in_reply_to_id'],
      optionalArgs: ['status', 'media_ids', 'instance', 'dryRun', 'accessToken'],
      example: { text: 'Great point!', in_reply_to_id: '123456789' },
      outputType: '{ status: any, success: boolean }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.reply(args, session),
    });

    // ── 10. Write Action: like ──
    this.registerAction({
      action: 'like',
      description: 'Favourite (like) a status on Mastodon',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['statusId'],
      optionalArgs: ['instance', 'dryRun', 'accessToken'],
      example: { statusId: '123456789' },
      outputType: '{ success: boolean }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.like(args, session),
    });

    // ── 11. Write Action: retweet / reblog ──
    this.registerAction({
      action: 'reblog',
      description: 'Boost (reblog) a status on Mastodon',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['statusId'],
      optionalArgs: ['instance', 'dryRun', 'accessToken'],
      example: { statusId: '123456789' },
      outputType: '{ success: boolean }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.reblog(args, session),
    });

    this.registerAction({
      action: 'retweet',
      description: 'Alias for reblog on Mastodon',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['statusId'],
      optionalArgs: ['instance', 'dryRun', 'accessToken'],
      example: { statusId: '123456789' },
      outputType: '{ success: boolean }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.reblog(args, session),
    });

    // ── 12. Write Action: follow ──
    this.registerAction({
      action: 'follow',
      description: 'Follow an account on Mastodon',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['accountId'],
      optionalArgs: ['username', 'instance', 'dryRun', 'accessToken'],
      example: { accountId: '12345' },
      outputType: '{ success: boolean }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.follow(args, session),
    });

    // ── 13. Write Action: unfollow ──
    this.registerAction({
      action: 'unfollow',
      description: 'Unfollow an account on Mastodon',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['accountId'],
      optionalArgs: ['username', 'instance', 'dryRun', 'accessToken'],
      example: { accountId: '12345' },
      outputType: '{ success: boolean }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.unfollow(args, session),
    });
  }

  /**
   * Helper to initialize session tokens before executing an action.
   * @param {Record<string, any>} [args]
   * @param {Record<string, any>} [session]
   */
  async #maybeAuthenticate(args = {}, session = {}) {
    const token = args.accessToken || session.accessToken;
    if (token) {
      await this.client.init({ accessToken: token });
    }
  }

  /**
   * Extract username from multiple accepted fields.
   * @param {Record<string, any>} args
   * @returns {string}
   */
  #extractUsername(args) {
    const user = args.username || args.handle || args.actor || args.target;
    if (!user || typeof user !== 'string' || !user.trim()) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: "username"',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'mastodon',
      });
    }
    return user.trim();
  }

  /**
   * Scrape a profile.
   * @param {Record<string, any>} args
   * @param {Record<string, any>} [session]
   * @returns {Promise<import('../../../core/types.js').ProfileItem>}
   */
  async getProfile(args = {}, session = {}) {
    await this.#maybeAuthenticate(args, session);
    const rawTarget = this.#extractUsername(args);
    const target = resolveMastodonTarget(rawTarget, args.instance || this.client.baseUrl);

    const raw = await this.client.lookupAccount(target.username, target.instance);
    const profile = normalizeMastodonAccount(raw, target.instance);
    this.validateItem(profile);

    if (this.store) {
      const postForm = profileItemToPostItem(profile);
      try { this.validateItem(postForm); } catch { /* skip corrupted conversion */ }
      await this.store.storeContent(postForm).catch(() => {});
    }

    return profile;
  }

  /**
   * Scrape followers for a user.
   * @param {Record<string, any>} args
   * @param {Record<string, any>} [session]
   * @returns {Promise<{ profiles: import('../../../core/types.js').ProfileItem[], pageInfo: { next_max_id: string | null, has_next_page: boolean } }>}
   */
  async getFollowers(args = {}, session = {}) {
    await this.#maybeAuthenticate(args, session);
    const rawTarget = this.#extractUsername(args);
    const target = resolveMastodonTarget(rawTarget, args.instance || this.client.baseUrl);
    const limit = Math.min(80, Math.max(1, Number(args.limit || 40)));

    const account = await this.client.lookupAccount(target.username, target.instance);
    const res = await this.client.getAccountFollowers(account.id, {
      limit,
      max_id: args.max_id,
      instance: target.instance,
    });

    const profiles = res.accounts.map((acc) => normalizeMastodonAccount(acc, target.instance));

    if (typeof args.onProgress === 'function') {
      args.onProgress({ scraped: profiles.length, limit });
    }

    if (this.store && profiles.length > 0) {
      const postItems = this.filterValidItems(profiles.map(profileItemToPostItem));
      if (postItems.length > 0) {
        await this.store.storeBatch(postItems).catch(() => {});
      }
    }

    return {
      profiles,
      pageInfo: {
        next_max_id: res.nextMaxId,
        has_next_page: Boolean(res.nextMaxId),
      },
    };
  }

  /**
   * Scrape following for a user.
   * @param {Record<string, any>} args
   * @param {Record<string, any>} [session]
   * @returns {Promise<{ profiles: import('../../../core/types.js').ProfileItem[], pageInfo: { next_max_id: string | null, has_next_page: boolean } }>}
   */
  async getFollowing(args = {}, session = {}) {
    await this.#maybeAuthenticate(args, session);
    const rawTarget = this.#extractUsername(args);
    const target = resolveMastodonTarget(rawTarget, args.instance || this.client.baseUrl);
    const limit = Math.min(80, Math.max(1, Number(args.limit || 40)));

    const account = await this.client.lookupAccount(target.username, target.instance);
    const res = await this.client.getAccountFollowing(account.id, {
      limit,
      max_id: args.max_id,
      instance: target.instance,
    });

    const profiles = res.accounts.map((acc) => normalizeMastodonAccount(acc, target.instance));

    if (typeof args.onProgress === 'function') {
      args.onProgress({ scraped: profiles.length, limit });
    }

    if (this.store && profiles.length > 0) {
      const postItems = this.filterValidItems(profiles.map(profileItemToPostItem));
      if (postItems.length > 0) {
        await this.store.storeBatch(postItems).catch(() => {});
      }
    }

    return {
      profiles,
      pageInfo: {
        next_max_id: res.nextMaxId,
        has_next_page: Boolean(res.nextMaxId),
      },
    };
  }

  /**
   * Scrape user posts/statuses timeline.
   * @param {Record<string, any>} args
   * @param {Record<string, any>} [session]
   * @returns {Promise<import('../../../core/types.js').PostItem[]>}
   */
  async getPosts(args = {}, session = {}) {
    await this.#maybeAuthenticate(args, session);
    const rawTarget = this.#extractUsername(args);
    const target = resolveMastodonTarget(rawTarget, args.instance || this.client.baseUrl);
    const limit = Math.min(80, Math.max(1, Number(args.limit || 20)));

    const account = await this.client.lookupAccount(target.username, target.instance);
    const res = await this.client.getAccountStatuses(account.id, {
      limit,
      max_id: args.max_id,
      since_id: args.since_id,
      exclude_replies: args.exclude_replies,
      instance: target.instance,
    });

    const posts = res.statuses.map((status) => normalizeMastodonStatus(status, target.instance));

    if (typeof args.onProgress === 'function') {
      args.onProgress({ scraped: posts.length, limit });
    }

    const validPosts = this.filterValidItems(posts);
    if (this.store && validPosts.length > 0) {
      await this.store.storeBatch(validPosts).catch(() => {});
    }

    return posts;
  }

  /**
   * Action Handler: post_detail — fetch a single status by ID or public post
   * URL via GET /api/v1/statuses/:id. Story 31.1 fix — backs x_download_media
   * postUrl-only path. Returns `{ post, posts }`.
   * @param {Record<string, any>} args
   * @param {Record<string, any>} [session]
   */
  async getPostDetail(args = {}, session = {}) {
    await this.#maybeAuthenticate(args, session);
    const status = await this.client.getStatus(args);
    const instance = args.instance || this.client.baseUrl;
    const post = status ? normalizeMastodonStatus(status, instance) : null;
    const posts = post ? [post] : [];
    const validPosts = this.filterValidItems(posts);
    if (this.store && validPosts.length > 0) {
      await this.store.storeBatch(validPosts).catch(() => {});
    }
    return { post, posts };
  }

  /**
   * Search content across Mastodon instance.
   * @param {Record<string, any>} args
   * @param {Record<string, any>} [session]
   * @returns {Promise<{ posts: import('../../../core/types.js').PostItem[], profiles: import('../../../core/types.js').ProfileItem[], hashtags: any[], pageInfo: Record<string, any> }>}
   */
  async search(args = {}, session = {}) {
    await this.#maybeAuthenticate(args, session);
    const instance = args.instance || this.client.baseUrl;
    const res = await this.client.search({
      ...args,
      instance,
    });

    const posts = res.statuses.map((s) => normalizeMastodonStatus(s, instance));
    const profiles = res.accounts.map((a) => normalizeMastodonAccount(a, instance));

    const validPosts = this.filterValidItems(posts);
    if (this.store && validPosts.length > 0) {
      await this.store.storeBatch(validPosts).catch(() => {});
    }

    return {
      posts,
      profiles,
      hashtags: res.hashtags,
      pageInfo: {
        end_cursor: null,
        has_next_page: false,
      },
    };
  }

  /**
   * Scrape posts for a hashtag.
   * @param {Record<string, any>} args
   * @param {Record<string, any>} [session]
   * @returns {Promise<import('../../../core/types.js').PostItem[]>}
   */
  async getHashtag(args = {}, session = {}) {
    await this.#maybeAuthenticate(args, session);
    const hashtag = args.hashtag || args.tag;
    const instance = args.instance || this.client.baseUrl;
    const limit = Math.min(40, Math.max(1, Number(args.limit || 20)));

    const res = await this.client.getHashtagTimeline(hashtag, {
      limit,
      max_id: args.max_id,
      instance,
    });

    const posts = res.statuses.map((s) => normalizeMastodonStatus(s, instance));

    const validPosts = this.filterValidItems(posts);
    if (this.store && validPosts.length > 0) {
      await this.store.storeBatch(validPosts).catch(() => {});
    }

    return posts;
  }

  /**
   * Scrape trending statuses.
   * @param {Record<string, any>} [args={}]
   * @param {Record<string, any>} [session={}]
   * @returns {Promise<import('../../../core/types.js').PostItem[]>}
   */
  async getTrending(args = {}, session = {}) {
    await this.#maybeAuthenticate(args, session);
    const instance = args.instance || this.client.baseUrl;
    const limit = Math.min(40, Math.max(1, Number(args.limit || 20)));

    const raw = await this.client.getTrendingStatuses({
      limit,
      instance,
    });

    const posts = raw.map((s) => normalizeMastodonStatus(s, instance));

    const validPosts = this.filterValidItems(posts);
    if (this.store && validPosts.length > 0) {
      await this.store.storeBatch(validPosts).catch(() => {});
    }

    return posts;
  }

  /**
   * @returns {Promise<void>}
   */
  async init() {
    // No-op for HTTP Mastodon
  }

  /**
   * Action Handler: post
   * @param {Record<string, any>} args
   * @param {Record<string, any>} [session]
   */
  async post(args = {}, session = {}) {
    await this.#maybeAuthenticate(args, session);
    const dryRun = args.dryRun === true;
    const text = args.text || args.status || '';

    if (!text || typeof text !== 'string') {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: "text" or "status"',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'mastodon',
      });
    }

    if (dryRun) {
      return {
        status: { id: 'dryrun_status_id', content: text, created_at: new Date().toISOString() },
        success: true,
        dryRun: true,
      };
    }

    const res = await this.client.postStatus({
      status: text,
      media_ids: args.media_ids || args.mediaIds,
      visibility: args.visibility,
      instance: args.instance,
    });

    return {
      status: res,
      success: true,
    };
  }

  /**
   * Action Handler: reply
   * @param {Record<string, any>} args
   * @param {Record<string, any>} [session]
   */
  async reply(args = {}, session = {}) {
    await this.#maybeAuthenticate(args, session);
    const dryRun = args.dryRun === true;
    const text = args.text || args.status || '';
    const inReplyToId = args.in_reply_to_id || args.inReplyToId || args.replyToId || args.targetId;

    if (!text || !inReplyToId) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required arguments: "text" and "in_reply_to_id"',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'mastodon',
      });
    }

    if (dryRun) {
      return {
        status: { id: 'dryrun_reply_id', in_reply_to_id: inReplyToId, content: text },
        success: true,
        dryRun: true,
      };
    }

    const res = await this.client.postStatus({
      status: text,
      in_reply_to_id: inReplyToId,
      media_ids: args.media_ids || args.mediaIds,
      visibility: args.visibility,
      instance: args.instance,
    });

    return {
      status: res,
      success: true,
    };
  }

  /**
   * Action Handler: like
   * @param {Record<string, any>} args
   * @param {Record<string, any>} [session]
   */
  async like(args = {}, session = {}) {
    await this.#maybeAuthenticate(args, session);
    const dryRun = args.dryRun === true;
    const statusId = args.statusId || args.targetId || args.id;

    if (!statusId) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: "statusId"',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'mastodon',
      });
    }

    if (dryRun) {
      return {
        success: true,
        dryRun: true,
      };
    }

    await this.client.favouriteStatus(statusId, { instance: args.instance });
    return {
      success: true,
    };
  }

  /**
   * Action Handler: reblog
   * @param {Record<string, any>} args
   * @param {Record<string, any>} [session]
   */
  async reblog(args = {}, session = {}) {
    await this.#maybeAuthenticate(args, session);
    const dryRun = args.dryRun === true;
    const statusId = args.statusId || args.targetId || args.id;

    if (!statusId) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: "statusId"',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'mastodon',
      });
    }

    if (dryRun) {
      return {
        success: true,
        dryRun: true,
      };
    }

    await this.client.reblogStatus(statusId, { instance: args.instance });
    return {
      success: true,
    };
  }

  /**
   * Action Handler: follow
   * @param {Record<string, any>} args
   * @param {Record<string, any>} [session]
   */
  async follow(args = {}, session = {}) {
    await this.#maybeAuthenticate(args, session);
    const dryRun = args.dryRun === true;
    let accountId = args.accountId || args.targetId || args.id;

    if (!accountId && (args.username || args.handle)) {
      const profile = await this.profile(args);
      accountId = profile?.profile?.externalId || profile?.profile?.authorId;
    }

    if (!accountId) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: "accountId" or "username"',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'mastodon',
      });
    }

    if (dryRun) {
      return {
        success: true,
        dryRun: true,
      };
    }

    await this.client.followAccount(accountId, { instance: args.instance });
    return {
      success: true,
    };
  }

  /**
   * Action Handler: unfollow
   * @param {Record<string, any>} args
   * @param {Record<string, any>} [session]
   */
  async unfollow(args = {}, session = {}) {
    await this.#maybeAuthenticate(args, session);
    const dryRun = args.dryRun === true;
    let accountId = args.accountId || args.targetId || args.id;

    if (!accountId && (args.username || args.handle)) {
      const profile = await this.profile(args);
      accountId = profile?.profile?.externalId || profile?.profile?.authorId;
    }

    if (!accountId) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: "accountId" or "username"',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'mastodon',
      });
    }

    if (dryRun) {
      return {
        success: true,
        dryRun: true,
      };
    }

    await this.client.unfollowAccount(accountId, { instance: args.instance });
    return {
      success: true,
    };
  }

  /**
   * @returns {Promise<void>}
   */
  async cleanup() {
    // No-op for HTTP Mastodon
  }
}
