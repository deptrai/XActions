// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * MediumCrawler — RSS-first crawler for Medium public content.
 * Extends AbstractCrawler, registers user/publication/tag/post actions,
 * and emits checkpoints + thin events to the Redis stream.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractCrawler } from '../../../core/base-crawler.js';
import { MediumClient } from './client.js';
import {
  normalizeMediumRssItem,
  normalizeMediumJsonPost,
  normalizeMediumGraphqlPost,
  asRecord,
  extractPostId,
} from './normalizer.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';
import { defaultRedisStreamPublisher, isEnvTruthy, toIsoDate } from '../../../utils/redis-stream-publisher.js';

/**
 * @param {MediumClient | Record<string, unknown>} [client]
 * @param {Record<string, unknown>} [options]
 * @returns {MediumCrawler}
 */
export function createMediumCrawler(client = {}, options = {}) {
  const resolvedClient = client instanceof MediumClient ? client : new MediumClient(client || options || {});
  const resolvedOptions = client instanceof MediumClient ? options : (options || {});
  return new MediumCrawler({ client: resolvedClient, ...resolvedOptions });
}

export class MediumCrawler extends AbstractCrawler {
  /** @type {string} */
  name = 'medium';

  /** @type {string} */
  platform = 'medium';

  /** @type {boolean} */
  requiresAuth = false;

  /** @type {MediumClient} */
  client;

  /** @type {import('../../../utils/redis-stream-publisher.js').RedisStreamPublisher | null} */
  redisPublisher = null;

  /**
   * @param {Object} [deps={}]
   * @param {MediumClient} [deps.client]
   * @param {import('../../../core/base-store.js').AbstractStore} [deps.store]
   * @param {import('../../../core/session-manager.js').SessionManager} [deps.sessionManager]
   * @param {import('../../../core/adaptive-governor.js').AdaptiveRateGovernor} [deps.governor]
   * @param {import('../../../core/account-pool.js').AccountPool} [deps.accountPool]
   * @param {import('../../../proxy/proxy-pool.js').ProxyIpPool} [deps.proxyPool]
   * @param {import('../../../utils/redis-stream-publisher.js').RedisStreamPublisher} [deps.redisPublisher]
   * @param {boolean} [deps.requiresAuth=false]
   * @param {boolean} [deps.requiresProxy=false]
   * @param {string} [deps.transport]
   */
  constructor(deps = {}) {
    const { client: explicitClient, transport, ...clientDeps } = deps;
    const rawTransport = typeof transport === 'string' ? transport : undefined;
    const client = explicitClient
      ? /** @type {MediumClient} */ (/** @type {unknown} */ (explicitClient))
      : new MediumClient({ ...clientDeps, transport: rawTransport });
    if (explicitClient && rawTransport) {
      if (rawTransport === 'rss' || rawTransport === 'http' || rawTransport === 'graphql' || rawTransport === 'puppeteer') {
        client.transport = /** @type {import('./client.js').MediumTransport} */ (rawTransport);
      }
    }

    const requiresAuth = typeof deps.requiresAuth === 'boolean' ? deps.requiresAuth : false;
    super({
      ...deps,
      client,
      requiresAuth,
    });

    this.category = 'social';
    this.client = client;
    this.redisPublisher = deps.redisPublisher || null;

    // ── 1. Action: user ──
    this.registerAction({
      action: 'user',
      description: 'Scrape public posts for a Medium user by @username',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['username'],
      optionalArgs: ['limit', 'transport', 'cursor'],
      outputType: '{ posts: PostItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }',
      example: { username: 'karpathy', limit: 10 },
      checkpointResolver: (args) => {
        const username = args?.username || args?.user || args?.handle;
        if (!username || typeof username !== 'string') return null;
        return {
          targetType: 'user',
          targetKey: String(username).trim().toLowerCase(),
          cursorField: 'cursor',
          fallbackCursorFields: ['after', 'to'],
        };
      },
      handler: (/** @type {Record<string, unknown>} */ args, /** @type {Record<string, unknown>} */ session) => this.getUser(args, session),
    });

    // Alias: author
    this.registerAction({
      action: 'author',
      description: 'Alias for user action',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['username'],
      optionalArgs: ['limit', 'transport', 'cursor'],
      outputType: '{ posts: PostItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }',
      example: { username: 'karpathy', limit: 10 },
      handler: (/** @type {Record<string, unknown>} */ args, /** @type {Record<string, unknown>} */ session) => this.getUser(args, session),
    });

    // Alias: posts
    this.registerAction({
      action: 'posts',
      description: 'Alias for user action',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['username'],
      optionalArgs: ['limit', 'transport', 'cursor'],
      outputType: '{ posts: PostItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }',
      example: { username: 'karpathy', limit: 10 },
      handler: (/** @type {Record<string, unknown>} */ args, /** @type {Record<string, unknown>} */ session) => this.getUser(args, session),
    });

    // Alias: tweets
    this.registerAction({
      action: 'tweets',
      description: 'Alias for user action',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['username'],
      optionalArgs: ['limit', 'transport', 'cursor'],
      outputType: '{ posts: PostItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }',
      example: { username: 'karpathy', limit: 10 },
      handler: (/** @type {Record<string, unknown>} */ args, /** @type {Record<string, unknown>} */ session) => this.getUser(args, session),
    });

    // Alias: feed
    this.registerAction({
      action: 'feed',
      description: 'Alias for user action',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['username'],
      optionalArgs: ['limit', 'transport', 'cursor'],
      outputType: '{ posts: PostItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }',
      example: { username: 'karpathy', limit: 10 },
      handler: (/** @type {Record<string, unknown>} */ args, /** @type {Record<string, unknown>} */ session) => this.getUser(args, session),
    });

    // ── 2. Action: publication ──
    this.registerAction({
      action: 'publication',
      description: 'Scrape public posts from a Medium publication (optional tag)',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['slug'],
      optionalArgs: ['tag', 'limit', 'transport', 'cursor', 'domain'],
      outputType: '{ posts: PostItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }',
      example: { slug: 'towards-data-science', limit: 10 },
      checkpointResolver: (args) => {
        const slug = args?.slug || args?.publication;
        const tag = args?.tag;
        if (!slug || typeof slug !== 'string') return null;
        if (tag && typeof tag === 'string') {
          return {
            targetType: 'publication_tag',
            targetKey: `${String(slug).trim().toLowerCase()}:${String(tag).trim().toLowerCase()}`,
            cursorField: 'cursor',
            fallbackCursorFields: ['after', 'to'],
          };
        }
        return {
          targetType: 'publication',
          targetKey: String(slug).trim().toLowerCase(),
          cursorField: 'cursor',
          fallbackCursorFields: ['after', 'to'],
        };
      },
      handler: (/** @type {Record<string, unknown>} */ args, /** @type {Record<string, unknown>} */ session) => this.getPublication(args, session),
    });

    // Alias: pub
    this.registerAction({
      action: 'pub',
      description: 'Alias for publication action',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['slug'],
      optionalArgs: ['tag', 'limit', 'transport', 'cursor', 'domain'],
      outputType: '{ posts: PostItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }',
      example: { slug: 'towards-data-science', limit: 10 },
      handler: (/** @type {Record<string, unknown>} */ args, /** @type {Record<string, unknown>} */ session) => this.getPublication(args, session),
    });

    // Alias: magazine
    this.registerAction({
      action: 'magazine',
      description: 'Alias for publication action',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['slug'],
      optionalArgs: ['tag', 'limit', 'transport', 'cursor', 'domain'],
      outputType: '{ posts: PostItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }',
      example: { slug: 'towards-data-science', limit: 10 },
      handler: (/** @type {Record<string, unknown>} */ args, /** @type {Record<string, unknown>} */ session) => this.getPublication(args, session),
    });

    // ── 3. Action: tag ──
    this.registerAction({
      action: 'tag',
      description: 'Scrape public posts for a Medium tag',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['tag'],
      optionalArgs: ['limit', 'transport', 'cursor'],
      outputType: '{ posts: PostItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }',
      example: { tag: 'programming', limit: 10 },
      checkpointResolver: (args) => {
        const tag = args?.tag || args?.topic || args?.hashtag;
        if (!tag || typeof tag !== 'string') return null;
        return {
          targetType: 'tag',
          targetKey: String(tag).trim().toLowerCase().replace(/^#/, ''),
          cursorField: 'cursor',
          fallbackCursorFields: ['after', 'to'],
        };
      },
      handler: (/** @type {Record<string, unknown>} */ args, /** @type {Record<string, unknown>} */ session) => this.getTag(args, session),
    });

    // Alias: hashtag
    this.registerAction({
      action: 'hashtag',
      description: 'Alias for tag action',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['tag'],
      optionalArgs: ['limit', 'transport', 'cursor'],
      outputType: '{ posts: PostItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }',
      example: { tag: 'programming', limit: 10 },
      handler: (/** @type {Record<string, unknown>} */ args, /** @type {Record<string, unknown>} */ session) => this.getTag(args, session),
    });

    // Alias: topic
    this.registerAction({
      action: 'topic',
      description: 'Alias for tag action',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['tag'],
      optionalArgs: ['limit', 'transport', 'cursor'],
      outputType: '{ posts: PostItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }',
      example: { tag: 'programming', limit: 10 },
      handler: (/** @type {Record<string, unknown>} */ args, /** @type {Record<string, unknown>} */ session) => this.getTag(args, session),
    });

    // ── 4. Action: post ──
    this.registerAction({
      action: 'post',
      description: 'Scrape a single Medium post by id or URL',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['postId'],
      optionalArgs: ['url', 'transport'],
      outputType: '{ post: PostItem }',
      example: { postId: 'a64152b37c35' },
      handler: (/** @type {Record<string, unknown>} */ args, /** @type {Record<string, unknown>} */ session) => this.getPost(args, session),
    });

    // Alias: post_detail
    this.registerAction({
      action: 'post_detail',
      description: 'Alias for post action',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['postId'],
      optionalArgs: ['url', 'transport'],
      outputType: '{ post: PostItem }',
      example: { postId: 'a64152b37c35' },
      handler: (/** @type {Record<string, unknown>} */ args, /** @type {Record<string, unknown>} */ session) => this.getPost(args, session),
    });

    // Alias: article
    this.registerAction({
      action: 'article',
      description: 'Alias for post action',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['postId'],
      optionalArgs: ['url', 'transport'],
      outputType: '{ post: PostItem }',
      example: { postId: 'a64152b37c35' },
      handler: (/** @type {Record<string, unknown>} */ args, /** @type {Record<string, unknown>} */ session) => this.getPost(args, session),
    });
  }

  /**
   * Parse a limit argument, falling back to default and max values.
   * @param {unknown} value
   * @returns {number}
   */
  #parseLimit(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) {
      return 10;
    }
    return Math.min(100, Math.max(1, Math.floor(parsed)));
  }

  /**
   * Resolve the transport mode from args and client default.
   * @param {Record<string, unknown>} args
   * @returns {string}
   */
  #resolveTransport(args) {
    const raw = args?.transport;
    if (typeof raw === 'string') {
      const lower = raw.toLowerCase().trim();
      if (lower === 'rss' || lower === 'http' || lower === 'graphql' || lower === 'puppeteer') {
        return lower;
      }
    }
    return this.client.transport;
  }

  /**
   * Build a PostItem from raw RSS/JSON/GraphQL data.
   * @param {Record<string, unknown>} raw
   * @param {string} [source]
   * @returns {import('../../../core/types.js').PostItem}
   */
  #normalizeItem(raw, source = 'rss') {
    if (source === 'graphql') return normalizeMediumGraphqlPost(raw);
    if (raw.guid || raw.link || raw.title || raw['content:encoded']) {
      return normalizeMediumRssItem(raw);
    }
    return normalizeMediumJsonPost(raw, {});
  }

  /**
   * Build pageInfo from a feed response.
   * @param {Record<string, unknown>} feed
   * @param {string} [cursor]
   * @returns {{ end_cursor: string | null, has_next_page: boolean }}
   */
  #buildPageInfo(feed, cursor) {
    const feedRecord = asRecord(feed);
    const paging = asRecord(feedRecord.paging);
    const next = paging.next;

    if (cursor) {
      return { end_cursor: cursor, has_next_page: true };
    }
    if (next && typeof next === 'object') {
      const nextStr = JSON.stringify(next);
      return { end_cursor: nextStr, has_next_page: true };
    }
    return { end_cursor: null, has_next_page: false };
  }

  /**
   * Scrape user posts.
   * @param {Record<string, unknown>} args
   * @param {Record<string, unknown>} [session]
   * @returns {Promise<{ posts: import('../../../core/types.js').PostItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }>}
   */
  async getUser(args = {}, session = {}) {
    const username = this.#extractUsername(args);
    const limit = this.#parseLimit(args.limit);
    const transport = this.#resolveTransport(args);
    const cursor = typeof args.cursor === 'string' ? args.cursor : (typeof args.to === 'string' ? args.to : undefined);

    // When user asks for more posts than RSS can provide, switch to JSON.
    const effectiveTransport = transport === 'rss' && limit > 10 ? 'http' : transport;

    const feed = await this.client.getUserFeed(username, {
      limit,
      transport: effectiveTransport,
      to: cursor,
    });

    const feedRecord = asRecord(feed);
    const rawItems = Array.isArray(feedRecord.items) ? feedRecord.items : [];
    const posts = rawItems
      .slice(0, limit)
      .map((item) => {
        const raw = asRecord(item);
        const post = this.#normalizeItem(raw, effectiveTransport === 'graphql' ? 'graphql' : (raw.guid ? 'rss' : 'http'));
        this.validateItem(post);
        return post;
      });

    const pageInfo = this.#buildPageInfo(feed, cursor);

    let stopPagination = false;
    if (this.store && posts.length > 0) {
      const batch = await this.store.storeBatch(posts).catch(() => null);
      stopPagination = await this.shouldStopPagination(batch ?? posts);
    }

    await this.#emitCheckpointAndStream({
      targetType: 'user',
      targetKey: username.toLowerCase(),
      cursor: pageInfo.end_cursor,
      items: posts,
      hasMore: pageInfo.has_next_page && !stopPagination,
    });

    return {
      posts,
      pageInfo: {
        ...pageInfo,
        has_next_page: pageInfo.has_next_page && !stopPagination,
      },
    };
  }

  /**
   * Scrape publication posts.
   * @param {Record<string, unknown>} args
   * @param {Record<string, unknown>} [session]
   * @returns {Promise<{ posts: import('../../../core/types.js').PostItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }>}
   */
  async getPublication(args = {}, session = {}) {
    const slug = this.#extractSlug(args);
    const tag = typeof args.tag === 'string' ? args.tag.trim() : undefined;
    const limit = this.#parseLimit(args.limit);
    const transport = this.#resolveTransport(args);
    const cursor = typeof args.cursor === 'string' ? args.cursor : (typeof args.to === 'string' ? args.to : undefined);
    const domain = typeof args.domain === 'string' ? args.domain.trim() : undefined;

    const effectiveTransport = transport === 'rss' && limit > 10 ? 'http' : transport;

    const feed = await this.client.getPublicationFeed(slug, {
      tag,
      limit,
      transport: effectiveTransport,
      to: cursor,
      domain,
    });

    const feedRecord = asRecord(feed);
    const rawItems = Array.isArray(feedRecord.items) ? feedRecord.items : [];
    const posts = rawItems
      .slice(0, limit)
      .map((item) => {
        const raw = asRecord(item);
        const post = this.#normalizeItem(raw, effectiveTransport === 'graphql' ? 'graphql' : (raw.guid ? 'rss' : 'http'));
        this.validateItem(post);
        return post;
      });

    const targetType = tag ? 'publication_tag' : 'publication';
    const targetKey = tag ? `${slug.toLowerCase()}:${tag.toLowerCase()}` : slug.toLowerCase();
    const pageInfo = this.#buildPageInfo(feed, cursor);

    let stopPagination = false;
    if (this.store && posts.length > 0) {
      const batch = await this.store.storeBatch(posts).catch(() => null);
      stopPagination = await this.shouldStopPagination(batch ?? posts);
    }

    await this.#emitCheckpointAndStream({
      targetType,
      targetKey,
      cursor: pageInfo.end_cursor,
      items: posts,
      hasMore: pageInfo.has_next_page && !stopPagination,
    });

    return {
      posts,
      pageInfo: {
        ...pageInfo,
        has_next_page: pageInfo.has_next_page && !stopPagination,
      },
    };
  }

  /**
   * Scrape tag posts.
   * @param {Record<string, unknown>} args
   * @param {Record<string, unknown>} [session]
   * @returns {Promise<{ posts: import('../../../core/types.js').PostItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }>}
   */
  async getTag(args = {}, session = {}) {
    const tag = this.#extractTag(args);
    const limit = this.#parseLimit(args.limit);
    const transport = this.#resolveTransport(args);
    const cursor = typeof args.cursor === 'string' ? args.cursor : (typeof args.to === 'string' ? args.to : undefined);

    const effectiveTransport = transport === 'rss' && limit > 10 ? 'http' : transport;

    const feed = await this.client.getTagFeed(tag, {
      limit,
      transport: effectiveTransport,
      to: cursor,
    });

    const feedRecord = asRecord(feed);
    const rawItems = Array.isArray(feedRecord.items) ? feedRecord.items : [];
    const posts = rawItems
      .slice(0, limit)
      .map((item) => {
        const raw = asRecord(item);
        const post = this.#normalizeItem(raw, effectiveTransport === 'graphql' ? 'graphql' : (raw.guid ? 'rss' : 'http'));
        this.validateItem(post);
        return post;
      });

    const pageInfo = this.#buildPageInfo(feed, cursor);

    let stopPagination = false;
    if (this.store && posts.length > 0) {
      const batch = await this.store.storeBatch(posts).catch(() => null);
      stopPagination = await this.shouldStopPagination(batch ?? posts);
    }

    await this.#emitCheckpointAndStream({
      targetType: 'tag',
      targetKey: tag.toLowerCase(),
      cursor: pageInfo.end_cursor,
      items: posts,
      hasMore: pageInfo.has_next_page && !stopPagination,
    });

    return {
      posts,
      pageInfo: {
        ...pageInfo,
        has_next_page: pageInfo.has_next_page && !stopPagination,
      },
    };
  }

  /**
   * Scrape a single post.
   * @param {Record<string, unknown>} args
   * @param {Record<string, unknown>} [session]
   * @returns {Promise<{ post: import('../../../core/types.js').PostItem }>}
   */
  async getPost(args = {}, session = {}) {
    const rawId = args.postId || args.post_id || args.id || args.url;
    if (!rawId || (typeof rawId !== 'string' && typeof rawId !== 'number')) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: postId or url',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'medium',
      });
    }

    let postId = String(rawId).trim();
    if (postId.startsWith('medium:')) {
      postId = postId.slice(7).trim();
    }

    let url = typeof args.url === 'string' ? args.url.trim() : undefined;
    if (postId.startsWith('http') || postId.includes('medium.com/')) {
      url = postId;
      postId = extractPostId(postId) || '';
    }

    if (!postId && !url) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Invalid Medium post: unable to resolve postId or url',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'medium',
      });
    }

    const transport = this.#resolveTransport(args);
    const raw = await this.client.getPost(postId || url || '', { url, transport });
    const post = normalizeMediumJsonPost(raw, {});
    this.validateItem(post);

    if (this.store) {
      await this.store.storeContent(post).catch(() => {});
    }

    await this.#emitCheckpointAndStream({
      targetType: 'post',
      targetKey: postId || post.externalId || post.id,
      cursor: null,
      items: [post],
      hasMore: false,
    });

    return { post };
  }

  /**
   * Extract username from various arg conventions.
   * @param {Record<string, unknown>} args
   * @returns {string}
   */
  #extractUsername(args = {}) {
    const raw = args.username || args.user || args.handle;
    if (!raw || typeof raw !== 'string' || !raw.trim()) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: "username"',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'medium',
      });
    }
    return String(raw).replace(/^@/, '').trim();
  }

  /**
   * Extract publication slug from various arg conventions.
   * @param {Record<string, unknown>} args
   * @returns {string}
   */
  #extractSlug(args = {}) {
    const raw = args.slug || args.publication || args.pub;
    if (!raw || typeof raw !== 'string' || !raw.trim()) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: "slug" or "publication"',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'medium',
      });
    }
    return String(raw).trim().replace(/^\//, '').replace(/\/$/, '');
  }

  /**
   * Extract tag from various arg conventions.
   * @param {Record<string, unknown>} args
   * @returns {string}
   */
  #extractTag(args = {}) {
    const raw = args.tag || args.topic || args.hashtag;
    if (!raw || typeof raw !== 'string' || !raw.trim()) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: "tag"',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'medium',
      });
    }
    return String(raw).replace(/^#/, '').trim();
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
          platform: 'medium',
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
              platform: 'medium',
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
      console.warn(`⚠️ [MEDIUM TELEMETRY] Checkpoint/stream emission warning: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Clean up the underlying client.
   * @returns {Promise<void>}
   */
  async cleanup() {
    if (this.client && typeof this.client.close === 'function') {
      await this.client.close().catch(() => {});
    }
  }
}
