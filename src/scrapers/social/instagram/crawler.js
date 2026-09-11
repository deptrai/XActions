// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * InstagramCrawler — crawler for Instagram public profile / hashtag / post / comments.
 * Extends AbstractCrawler, registers user/hashtag/post/comments actions,
 * and emits checkpoints + thin events to the Redis stream.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractCrawler } from '../../../core/base-crawler.js';
import { InstagramClient } from './client.js';
import {
  normalizeInstagramMedia,
  normalizeInstagramProfile,
  normalizeInstagramComment,
  asRecord,
  extractMediaId,
} from './normalizer.js';
import { InstagramPlatformResponseValidator } from './validator.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';
import { defaultRedisStreamPublisher, isEnvTruthy, toIsoDate } from '../../../utils/redis-stream-publisher.js';

/**
 * @param {InstagramClient | Record<string, unknown>} [client]
 * @param {Record<string, unknown>} [options]
 * @returns {InstagramCrawler}
 */
export function createInstagramCrawler(client = {}, options = {}) {
  const resolvedClient = client instanceof InstagramClient ? client : new InstagramClient(client || options || {});
  const resolvedOptions = client instanceof InstagramClient ? options : (options || {});
  return new InstagramCrawler({ client: resolvedClient, ...resolvedOptions });
}

export class InstagramCrawler extends AbstractCrawler {
  /** @type {string} */ name = 'instagram';
  /** @type {string} */ platform = 'instagram';
  /** @type {boolean} */ requiresAuth = true;
  /** @type {InstagramClient} */ client;
  /** @type {import('../../../utils/redis-stream-publisher.js').RedisStreamPublisher | null} */
  redisPublisher = null;
  /** @type {InstagramPlatformResponseValidator} */ #validator = new InstagramPlatformResponseValidator();

  /**
   * @param {Object} [deps={}]
   * @param {InstagramClient} [deps.client]
   * @param {import('../../../core/base-store.js').AbstractStore} [deps.store]
   * @param {import('../../../core/session-manager.js').SessionManager} [deps.sessionManager]
   * @param {import('../../../core/adaptive-governor.js').AdaptiveRateGovernor} [deps.governor]
   * @param {import('../../../core/account-pool.js').AccountPool} [deps.accountPool]
   * @param {import('../../../proxy/proxy-pool.js').ProxyIpPool} [deps.proxyPool]
   * @param {import('../../../utils/redis-stream-publisher.js').RedisStreamPublisher} [deps.redisPublisher]
   * @param {boolean} [deps.requiresAuth=true]
   * @param {string} [deps.transport]
   */
  constructor(deps = {}) {
    const { client: explicitClient, transport, ...clientDeps } = deps;
    const client = explicitClient
      ? /** @type {InstagramClient} */ (/** @type {unknown} */ (explicitClient))
      : new InstagramClient({ ...clientDeps, transport });
    const requiresAuth = typeof deps.requiresAuth === 'boolean' ? deps.requiresAuth : true;
    super({ ...deps, client, requiresAuth });
    this.category = 'social';
    this.client = client;
    this.redisPublisher = deps.redisPublisher || null;
    this.#registerActions();
  }

  #registerActions() {
    const desc = { category: 'social', requiresAuth: true };

    this.registerAction({
      action: 'user',
      description: 'Scrape an Instagram user profile + recent media by @username',
      ...desc,
      requiredArgs: ['username'],
      optionalArgs: ['limit', 'cursor', 'transport'],
      outputType: '{ profile: ProfileItem, posts: PostItem[], pageInfo }',
      example: { username: 'natgeo', limit: 25 },
      checkpointResolver: (args) => {
        const u = args?.username || args?.user || args?.handle;
        if (!u || typeof u !== 'string') return null;
        return { targetType: 'user', targetKey: u.trim().toLowerCase(), cursorField: 'cursor', fallbackCursorFields: ['max_id', 'end_cursor'] };
      },
      handler: (args, session) => this.getUser(args, session),
    });
    for (const alias of ['author', 'profile']) {
      this.registerAction({ action: alias, description: `Alias for user`, ...desc, requiredArgs: ['username'], optionalArgs: ['limit', 'cursor', 'transport'], outputType: '{ profile, posts, pageInfo }', handler: (a, s) => this.getUser(a, s) });
    }

    this.registerAction({
      action: 'hashtag',
      description: 'Scrape media under an Instagram hashtag',
      ...desc,
      requiredArgs: ['tag'],
      optionalArgs: ['limit', 'cursor', 'transport'],
      outputType: '{ posts: PostItem[], pageInfo }',
      example: { tag: 'travel', limit: 25 },
      checkpointResolver: (args) => {
        const t = args?.tag || args?.hashtag || args?.topic;
        if (!t || typeof t !== 'string') return null;
        return { targetType: 'tag', targetKey: t.trim().toLowerCase().replace(/^#/, ''), cursorField: 'cursor', fallbackCursorFields: ['max_id', 'end_cursor'] };
      },
      handler: (args, session) => this.getHashtag(args, session),
    });
    for (const alias of ['tag', 'topic']) {
      this.registerAction({ action: alias, description: 'Alias for hashtag', ...desc, requiredArgs: ['tag'], optionalArgs: ['limit', 'cursor', 'transport'], outputType: '{ posts, pageInfo }', handler: (a, s) => this.getHashtag(a, s) });
    }

    this.registerAction({
      action: 'post',
      description: 'Fetch a single Instagram post by shortcode or URL',
      ...desc,
      requiredArgs: ['shortcode'],
      optionalArgs: ['transport'],
      outputType: '{ post: PostItem }',
      example: { shortcode: 'Cxyz123' },
      handler: (args, session) => this.getPost(args, session),
    });
    for (const alias of ['post_detail', 'media']) {
      this.registerAction({ action: alias, description: 'Alias for post', ...desc, requiredArgs: ['shortcode'], optionalArgs: ['transport'], outputType: '{ post }', handler: (a, s) => this.getPost(a, s) });
    }

    this.registerAction({
      action: 'comments',
      description: 'Fetch comments on an Instagram post',
      ...desc,
      requiredArgs: ['shortcode'],
      optionalArgs: ['limit', 'cursor', 'transport'],
      outputType: '{ comments: CommentItem[], pageInfo }',
      example: { shortcode: 'Cxyz123', limit: 50 },
      handler: (args, session) => this.getComments(args, session),
    });
  }

  /**
   * @param {Record<string, unknown>} args
   * @returns {string}
   */
  #extractUsername(args = {}) {
    const raw = args.username || args.user || args.handle || args.author;
    if (!raw || typeof raw !== 'string' || !raw.trim()) {
      throw new PlatformError({ type: ErrorTypes.INVALID_ARGS, code: 'XACT_4001', message: 'Missing required argument: "username"', statusCode: 400, suggestedAction: SuggestedActions.USE_ACTIONS_LIST, platform: 'instagram' });
    }
    return String(raw).replace(/^@/, '').trim();
  }

  /**
   * @param {Record<string, unknown>} args
   * @returns {string}
   */
  #extractTag(args = {}) {
    const raw = args.tag || args.hashtag || args.topic;
    if (!raw || typeof raw !== 'string' || !raw.trim()) {
      throw new PlatformError({ type: ErrorTypes.INVALID_ARGS, code: 'XACT_4001', message: 'Missing required argument: "tag"', statusCode: 400, suggestedAction: SuggestedActions.USE_ACTIONS_LIST, platform: 'instagram' });
    }
    return String(raw).replace(/^#/, '').trim();
  }

  /**
   * @param {Record<string, unknown>} args
   * @returns {string}
   */
  #extractShortcode(args = {}) {
    const raw = args.shortcode || args.postId || args.id || args.url;
    if (!raw || typeof raw !== 'string' || !raw.trim()) {
      throw new PlatformError({ type: ErrorTypes.INVALID_ARGS, code: 'XACT_4001', message: 'Missing required argument: "shortcode" or "url"', statusCode: 400, suggestedAction: SuggestedActions.VERIFY_URL, platform: 'instagram' });
    }
    return String(raw).trim();
  }

  /**
   * @param {unknown} value
   * @param {number} [fallback=25]
   * @returns {number}
   */
  #parseLimit(value, fallback = 25) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  }

  /**
   * @param {Record<string, unknown>} args
   * @returns {import('./client.js').InstagramTransport | undefined}
   */
  #resolveTransport(args = {}) {
    const t = typeof args.transport === 'string' ? args.transport.toLowerCase().trim() : undefined;
    return t === 'puppeteer' || t === 'instagrapi' || t === 'http' ? t : undefined;
  }

  /**
   * Scrape a user profile + recent media.
   * @param {Record<string, unknown>} args
   * @param {Record<string, unknown>} [session]
   * @returns {Promise<{ profile: import('../../../core/types.js').ProfileItem, posts: import('../../../core/types.js').PostItem[], pageInfo: object }>}
   */
  async getUser(args = {}, session = {}) {
    const username = this.#extractUsername(args);
    const limit = this.#parseLimit(args.limit);
    const transport = this.#resolveTransport(args);
    if (transport) this.client.transport = transport;
    const accountId = session?.accountId || args.accountId;
    await this.client.ensureSession(accountId, session);

    const { user, raw } = await this.client.getUserProfile(username, { ...args, accountId });
    // Pass the already-fetched payload through so getUserMedia does not re-fetch.
    const { items, pageInfo } = await this.client.getUserMedia(username, { ...args, accountId, limit, __user: user, __raw: raw });

    const profile = normalizeInstagramProfile(user);
    const posts = items.slice(0, limit).map((m) => {
      const post = normalizeInstagramMedia(asRecord(m));
      this.validateItem(post);
      return post;
    });

    let stopPagination = false;
    if (this.store && posts.length > 0) {
      const batch = await this.store.storeBatch(posts).catch(() => null);
      stopPagination = await this.shouldStopPagination(batch ?? posts);
    }

    await this.#emitCheckpointAndStream({
      targetType: 'user', targetKey: username.toLowerCase(), cursor: pageInfo.end_cursor, items: posts, hasMore: pageInfo.has_next_page && !stopPagination,
    });

    return { profile, posts, pageInfo: { ...pageInfo, has_next_page: pageInfo.has_next_page && !stopPagination } };
  }

  /**
   * Scrape a hashtag feed.
   * @param {Record<string, unknown>} args
   * @param {Record<string, unknown>} [session]
   * @returns {Promise<{ posts: import('../../../core/types.js').PostItem[], pageInfo: object }>}
   */
  async getHashtag(args = {}, session = {}) {
    const tag = this.#extractTag(args);
    const limit = this.#parseLimit(args.limit);
    const transport = this.#resolveTransport(args);
    if (transport) this.client.transport = transport;
    const accountId = session?.accountId || args.accountId;
    await this.client.ensureSession(accountId, session);

    const { items, pageInfo } = await this.client.getHashtagFeed(tag, { ...args, accountId, limit });
    const posts = items.slice(0, limit).map((m) => {
      const post = normalizeInstagramMedia(asRecord(m));
      this.validateItem(post);
      return post;
    });

    let stopPagination = false;
    if (this.store && posts.length > 0) {
      const batch = await this.store.storeBatch(posts).catch(() => null);
      stopPagination = await this.shouldStopPagination(batch ?? posts);
    }

    await this.#emitCheckpointAndStream({
      targetType: 'tag', targetKey: tag.toLowerCase(), cursor: pageInfo.end_cursor, items: posts, hasMore: pageInfo.has_next_page && !stopPagination,
    });

    return { posts, pageInfo: { ...pageInfo, has_next_page: pageInfo.has_next_page && !stopPagination } };
  }

  /**
   * Fetch a single post.
   * @param {Record<string, unknown>} args
   * @param {Record<string, unknown>} [session]
   * @returns {Promise<{ post: import('../../../core/types.js').PostItem }>}
   */
  async getPost(args = {}, session = {}) {
    const shortcode = this.#extractShortcode(args);
    const transport = this.#resolveTransport(args);
    if (transport) this.client.transport = transport;
    const accountId = session?.accountId || args.accountId;
    await this.client.ensureSession(accountId, session);

    const { media } = await this.client.getPost(shortcode, { ...args, accountId });
    const post = normalizeInstagramMedia(media);
    this.validateItem(post);
    if (this.store && typeof this.store.storeContent === 'function') {
      await this.store.storeContent(post).catch(() => {});
    }
    await this.#emitCheckpointAndStream({
      targetType: 'post', targetKey: post.externalId, cursor: null, items: [post], hasMore: false,
    });
    return { post };
  }

  /**
   * Fetch comments on a post.
   * @param {Record<string, unknown>} args
   * @param {Record<string, unknown>} [session]
   * @returns {Promise<{ comments: import('../../../core/types.js').CommentItem[], pageInfo: object }>}
   */
  async getComments(args = {}, session = {}) {
    const shortcode = this.#extractShortcode(args);
    const limit = this.#parseLimit(args.limit, 50);
    const transport = this.#resolveTransport(args);
    if (transport) this.client.transport = transport;
    const accountId = session?.accountId || args.accountId;
    await this.client.ensureSession(accountId, session);

    const { media } = await this.client.getPost(shortcode, { ...args, accountId });
    const { items, pageInfo } = await this.client.getComments(shortcode, { ...args, accountId, limit });
    const postId = extractMediaId(media);
    const comments = items.slice(0, limit).map((c) => normalizeInstagramComment(asRecord(c), postId));
    return { comments, pageInfo };
  }

  /**
   * Emit checkpoint + stream events for paginated results.
   * @param {Object} params
   * @param {string} params.targetType
   * @param {string} params.targetKey
   * @param {string | null} [params.cursor]
   * @param {Array<import('../../../core/types.js').PostItem>} [params.items]
   * @param {boolean} [params.hasMore]
   */
  async #emitCheckpointAndStream({ targetType, targetKey, cursor = null, items = [], hasMore = false }) {
    try {
      if (this.store && typeof this.store.saveCheckpoint === 'function') {
        const firstItem = items[0];
        const storageRef = (firstItem && (firstItem.id || firstItem.externalId)) || '';
        await this.store.saveCheckpoint({
          platform: 'instagram',
          targetType,
          targetKey,
          lastCursor: cursor || undefined,
          lastTimestamp: new Date(),
          lastCrawledAt: new Date(),
          status: hasMore ? 'has_more' : 'completed',
          storageRef,
        });
      }
      if (isEnvTruthy(process.env.REDIS_STREAM_ENABLED)) {
        const storeRecord = this.store ? asRecord(this.store) : null;
        const rawStorePublisher = storeRecord && storeRecord.publisher;
        const storePublisher = rawStorePublisher && typeof rawStorePublisher === 'object'
          ? /** @type {import('../../../utils/redis-stream-publisher.js').RedisStreamPublisher} */ (/** @type {unknown} */ (rawStorePublisher))
          : null;
        const publisher = this.redisPublisher || storePublisher || defaultRedisStreamPublisher;
        if (publisher && typeof publisher.publish === 'function') {
          for (const item of items) {
            const category = 'category' in item && typeof item.category === 'string' ? item.category : 'social';
            const authorId = 'authorId' in item && typeof item.authorId === 'string' ? item.authorId : item.externalId || '';
            const crawledAt = 'crawledAt' in item && item.crawledAt ? toIsoDate(item.crawledAt) : new Date().toISOString();
            await publisher.publish({
              id: item.id,
              platform: 'instagram',
              externalId: item.externalId,
              category,
              authorId,
              crawledAt,
              storageRef: item.id,
              scraperId: this.scraperId,
            });
          }
        }
      }
    } catch (err) {
      console.warn(`⚠️ [INSTAGRAM TELEMETRY] Checkpoint/stream emission warning: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Clean up the underlying client (closes browser bridge).
   * @returns {Promise<void>}
   */
  async cleanup() {
    if (this.client && typeof this.client.close === 'function') {
      await this.client.close().catch(() => {});
    }
  }
}
