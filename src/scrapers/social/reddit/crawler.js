// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * RedditCrawler — HTTP-only crawler for Reddit (official REST API / public .json).
 * Extends AbstractCrawler, registers subreddit, user, search, post_comments,
 * and subreddit_info actions. Conforms to universal scraping core schema.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractCrawler } from '../../../core/base-crawler.js';
import { RedditClient } from './client.js';
import {
  normalizeRedditPost,
  normalizeRedditComment,
  normalizeRedditSubreddit,
  normalizeRedditUser,
} from './normalizer.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';
import { defaultRedisStreamPublisher, isEnvTruthy, toIsoDate } from '../../../utils/redis-stream-publisher.js';

/**
 * @param {RedditClient | Record<string, unknown>} [client]
 * @param {Record<string, unknown>} [options]
 * @returns {RedditCrawler}
 */
export function createRedditCrawler(client = {}, options = {}) {
  const resolvedClient = client instanceof RedditClient ? client : new RedditClient(client || options || {});
  const resolvedOptions = client instanceof RedditClient ? options : (options || {});
  return new RedditCrawler({ client: resolvedClient, ...resolvedOptions });
}

export class RedditCrawler extends AbstractCrawler {
  /** @type {string} */
  name = 'reddit';

  /** @type {string} */
  platform = 'reddit';

  /** @type {boolean} */
  requiresAuth = false;

  /** @type {RedditClient} */
  client;

  /**
   * Parse a limit/depth argument, falling back to a default when the input
   * is missing, NaN, non-numeric, or out of range.
   *
   * @param {unknown} value
   * @param {number} defaultValue
   * @param {number} maxValue
   * @returns {number}
   */
  #parseCount(value, defaultValue, maxValue) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) {
      return defaultValue;
    }
    return Math.min(maxValue, Math.max(1, Math.floor(parsed)));
  }

  /**
   * Safely cast an unknown value to a record for typed property access.
   * @param {unknown} value
   * @returns {Record<string, unknown>}
   */
  #asRecord(value) {
    return (typeof value === 'object' && value !== null ? /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (value)) : {});
  }

  /**
   * @param {Object} [deps]
   * @param {RedditClient} [deps.client]
   * @param {import('../../../core/base-store.js').AbstractStore} [deps.store]
   * @param {import('../../../core/session-manager.js').SessionManager} [deps.sessionManager]
   * @param {import('../../../core/adaptive-governor.js').AdaptiveRateGovernor} [deps.governor]
   * @param {import('../../../core/account-pool.js').AccountPool} [deps.accountPool]
   * @param {import('../../../proxy/proxy-pool.js').ProxyIpPool} [deps.proxyPool]
   * @param {import('../../../utils/redis-stream-publisher.js').RedisStreamPublisher} [deps.redisPublisher]
   * @param {boolean} [deps.requiresAuth]
   * @param {boolean} [deps.requiresProxy]
   * @param {string} [deps.transport]
   */
  constructor(deps = {}) {
    const { client: explicitClient, transport, ...clientDeps } = deps;
    const rawTransport = typeof transport === 'string' ? transport : undefined;
    const client = explicitClient
      ? /** @type {RedditClient} */ (/** @type {unknown} */ (explicitClient))
      : new RedditClient({ ...clientDeps, transport: rawTransport });
    if (explicitClient && rawTransport) {
      if (rawTransport === 'http' || rawTransport === 'puppeteer' || rawTransport === 'rss') {
        client.transport = rawTransport;
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

    // ── 1. Action: subreddit ──
    this.registerAction({
      action: 'subreddit',
      description: 'Scrape posts from a subreddit (new/hot/top/rising)',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['name'],
      optionalArgs: ['subreddit', 'limit', 'sort', 'time', 'cursor', 'after'],
      outputType: '{ posts: PostItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }',
      example: { name: 'programming', limit: 25, sort: 'new' },
      checkpointResolver: (args) => {
        const name = args?.name || args?.subreddit;
        if (!name || typeof name !== 'string') return null;
        return {
          targetType: 'subreddit',
          targetKey: String(name).trim().toLowerCase(),
          cursorField: 'after',
          fallbackCursorFields: ['cursor'],
        };
      },
      handler: (/** @type {Record<string, unknown>} */ args, /** @type {Record<string, unknown>} */ session) => this.getSubredditPosts(args, session),
    });

    // ── 2. Action: user ──
    this.registerAction({
      action: 'user',
      description: 'Scrape Reddit user profile and submitted posts',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['username'],
      optionalArgs: ['name', 'user', 'limit', 'sort', 'cursor', 'after'],
      outputType: '{ profile: ProfileItem, posts: PostItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }',
      example: { username: 'spez', limit: 25 },
      checkpointResolver: (args) => {
        const username = args?.username || args?.name || args?.user;
        if (!username || typeof username !== 'string') return null;
        return {
          targetType: 'user',
          targetKey: String(username).trim().toLowerCase(),
          cursorField: 'after',
          fallbackCursorFields: ['cursor'],
        };
      },
      handler: (/** @type {Record<string, unknown>} */ args, /** @type {Record<string, unknown>} */ session) => this.getUser(args, session),
    });

    // ── 3. Action: search ──
    this.registerAction({
      action: 'search',
      description: 'Search posts across Reddit by query',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['query'],
      optionalArgs: ['q', 'limit', 'sort', 'time', 'cursor', 'after'],
      outputType: '{ posts: PostItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }',
      example: { query: 'machine learning', limit: 25 },
      checkpointResolver: (args) => {
        const query = args?.query || args?.q;
        if (!query || typeof query !== 'string') return null;
        return {
          targetType: 'search',
          targetKey: String(query).trim().toLowerCase(),
          cursorField: 'after',
          fallbackCursorFields: ['cursor'],
        };
      },
      handler: (/** @type {Record<string, unknown>} */ args, /** @type {Record<string, unknown>} */ session) => this.searchReddit(args, session),
    });

    // ── 4. Action: post_comments ──
    this.registerAction({
      action: 'post_comments',
      description: 'Scrape comment tree for a Reddit post',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['postId'],
      optionalArgs: ['subreddit', 'postUrl', 'limit', 'depth', 'cursor', 'after'],
      outputType: '{ comments: CommentItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }',
      example: { postId: '1a2b3c', subreddit: 'programming', limit: 100 },
      checkpointResolver: (args) => {
        try {
          const { postId } = this.#extractPostId(args);
          if (!postId || typeof postId !== 'string') return null;
          return {
            targetType: 'post_comments',
            targetKey: String(postId).trim(),
            cursorField: 'after',
            fallbackCursorFields: ['cursor'],
          };
        } catch {
          return null;
        }
      },
      handler: (/** @type {Record<string, unknown>} */ args, /** @type {Record<string, unknown>} */ session) => this.getPostComments(args, session),
    });

    // ── 5. Action: subreddit_info ──
    this.registerAction({
      action: 'subreddit_info',
      description: 'Scrape subreddit metadata (subscribers, description, rules)',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['name'],
      optionalArgs: ['subreddit'],
      outputType: 'PostItem',
      example: { name: 'programming' },
      handler: (/** @type {Record<string, unknown>} */ args, /** @type {Record<string, unknown>} */ session) => this.getSubredditInfo(args, session),
    });
  }

  /**
   * Resolve subreddit name from various arg conventions.
   * @param {Record<string, unknown>} args
   * @returns {string}
   */
  #extractSubreddit(args = {}) {
    const raw = args.name || args.subreddit || args.r;
    if (!raw || typeof raw !== 'string' || !raw.trim()) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: "name" or "subreddit"',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'reddit',
      });
    }
    return String(raw).replace(/^\/?r\//, '').replace(/^\//, '').trim();
  }

  /**
   * Resolve username from various arg conventions.
   * @param {Record<string, unknown>} args
   * @returns {string}
   */
  #extractUsername(args = {}) {
    const raw = args.username || args.name || args.user;
    if (!raw || typeof raw !== 'string' || !raw.trim()) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: "username" or "name"',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'reddit',
      });
    }
    return String(raw).replace(/^\/?u\//, '').replace(/^\//, '').replace(/^@/, '').trim();
  }

  /**
   * Resolve postId from various arg conventions.
   * Supports fullname (t3_xxx), bare id (xxx), or URL.
   * @param {Record<string, unknown>} args
   * @returns {{ postId: string, subreddit: string | null }}
   */
  #extractPostId(args = {}) {
    const raw = args.postId || args.id || args.url || args.postUrl;
    if (!raw || typeof raw !== 'string' || !raw.trim()) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: "postId", "id", or "url"',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'reddit',
      });
    }

    const clean = String(raw).trim();
    let postId = clean;
    let subreddit = args.subreddit ? String(args.subreddit).replace(/^r\//, '').trim() : null;

    // Extract from URL: /r/{sub}/comments/{id}/... or /comments/{id}/...
    if (/^https?:\/\//i.test(clean)) {
      const m = clean.match(/\/r\/([^/]+)\/comments\/([^/?#]+)/i);
      if (m) {
        subreddit = m[1];
        postId = m[2];
      } else {
        const m2 = clean.match(/\/comments\/([^/?#]+)/i);
        if (m2) postId = m2[1];
      }
    } else if (clean.startsWith('t3_')) {
      postId = clean.slice(3).trim();
    } else if (/^[a-z0-9]+$/i.test(clean)) {
      // already a bare post id — keep as-is
      postId = clean;
    } else {
      // Final fallback: try to extract a reddit shortlink id (redd.it/xxx).
      const short = clean.match(/redd\.it\/([a-z0-9]+)/i);
      if (short) postId = short[1];
    }

    return { postId, subreddit };
  }

  /**
   * Helper to emit checkpoint + stream events for paginated results.
   * @param {Object} params
   * @param {string} params.targetType
   * @param {string} params.targetKey
   * @param {string | null} [params.cursor]
   * @param {Array<import('../../../core/types.js').PostItem | import('../../../core/types.js').CommentItem | import('../../../core/types.js').ProfileItem>} [params.items]
   * @param {boolean} [params.hasMore]
   */
  async #emitCheckpointAndStream({ targetType, targetKey, cursor = null, items = [], hasMore = false }) {
    try {
      if (this.store && typeof this.store.saveCheckpoint === 'function') {
        const firstItem = items[0];
        const storageRef = (firstItem && (firstItem.id || firstItem.externalId)) || '';
        await this.store.saveCheckpoint({
          platform: 'reddit',
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
        const storeRecord = this.store ? this.#asRecord(this.store) : null;
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
              platform: 'reddit',
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
      console.warn(`⚠️ [REDDIT TELEMETRY] Checkpoint/stream emission warning: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Scrape subreddit posts.
   * @param {Record<string, unknown>} args
   * @param {Record<string, unknown>} [session]
   * @returns {Promise<{ posts: import('../../../core/types.js').PostItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }>}
   */
  async getSubredditPosts(args = {}, session = {}) {
    const name = this.#extractSubreddit(args);
    const limit = this.#parseCount(args.limit, 25, 100);
    const rawSort = typeof args.sort === 'string' ? args.sort : undefined;
    const sort = rawSort && ['new', 'hot', 'top', 'rising'].includes(rawSort) ? rawSort : 'new';
    const time = typeof args.time === 'string' ? args.time : undefined;
    const after = typeof args.after === 'string' ? args.after : (typeof args.cursor === 'string' ? args.cursor : undefined);

    const params = /** @type {Record<string, unknown>} */ ({ limit });
    if (sort === 'top' && time) params.t = time;
    if (after) params.after = after;

    const raw = await this.client.apiRequest(`/r/${name}/${sort}`, params);
    const rawData = /** @type {Record<string, unknown>} */ (raw?.data ?? raw);
    const children = Array.isArray(rawData.children) ? rawData.children : [];
    const posts = children
      .filter((child) => {
        const thing = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (child));
        return thing.kind === 't3';
      })
      .map((child) => {
        const thing = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (child));
        const post = normalizeRedditPost(thing);
        this.validateItem(post);
        return post;
      });
    const nextCursor = typeof rawData.after === 'string' ? rawData.after : null;

    let stopPagination = false;
    if (this.store && posts.length > 0) {
      const batch = await this.store.storeBatch(posts).catch(() => null);
      stopPagination = await this.shouldStopPagination(batch ?? posts);
    }

    await this.#emitCheckpointAndStream({
      targetType: 'subreddit',
      targetKey: name,
      cursor: nextCursor,
      items: posts,
      hasMore: Boolean(nextCursor) && !stopPagination,
    });

    return {
      posts,
      pageInfo: {
        end_cursor: nextCursor,
        has_next_page: Boolean(nextCursor) && !stopPagination,
      },
    };
  }

  /**
   * Scrape user profile and posts.
   * @param {Record<string, unknown>} args
   * @param {Record<string, unknown>} [session]
   * @returns {Promise<{ profile: import('../../../core/types.js').ProfileItem, posts: import('../../../core/types.js').PostItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }>}
   */
  async getUser(args = {}, session = {}) {
    const username = this.#extractUsername(args);
    const limit = this.#parseCount(args.limit, 25, 100);
    const rawSort = typeof args.sort === 'string' ? args.sort : undefined;
    const sort = rawSort && ['new', 'hot', 'top'].includes(rawSort) ? rawSort : 'new';
    const after = typeof args.after === 'string' ? args.after : (typeof args.cursor === 'string' ? args.cursor : undefined);

    const params = /** @type {Record<string, unknown>} */ ({ limit, sort });
    if (after) params.after = after;

    const [profileRaw, postsRaw] = await Promise.all([
      this.client.apiRequest(`/user/${username}/about`, {}),
      this.client.apiRequest(`/user/${username}/submitted`, params),
    ]);

    const profile = normalizeRedditUser(profileRaw);
    this.validateItem(/** @type {import('../../../core/types.js').PostItem | import('../../../core/types.js').CommentItem} */ (/** @type {unknown} */ (profile)));
    const postsData = /** @type {Record<string, unknown>} */ (postsRaw?.data ?? postsRaw);
    const children = Array.isArray(postsData.children) ? postsData.children : [];
    const posts = children
      .filter((child) => {
        const thing = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (child));
        return thing.kind === 't3';
      })
      .map((child) => {
        const thing = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (child));
        const post = normalizeRedditPost(thing);
        this.validateItem(post);
        return post;
      });
    const nextCursor = typeof postsData.after === 'string' ? postsData.after : null;

    let stopPagination = false;
    if (this.store) {
      if (posts.length > 0) {
        const batch = await this.store.storeBatch(posts).catch(() => null);
        stopPagination = await this.shouldStopPagination(batch ?? posts);
      }
      const profilePost = {
        id: profile.id,
        platform: profile.platform,
        externalId: profile.externalId,
        category: 'social',
        authorId: profile.externalId,
        authorName: profile.authorName || profile.name || profile.username || 'unknown',
        authorAvatar: profile.avatar || undefined,
        postUrl: profile.profileUrl,
        content: profile.bio || profile.name || 'Reddit Profile',
        mediaUrls: profile.avatar ? [profile.avatar] : [],
        likesCount: profile.followersCount || 0,
        repostsCount: 0,
        repliesCount: 0,
        metadata: { isProfile: true, ...(profile.metadata || {}) },
        crawledAt: profile.crawledAt,
      };
      this.validateItem(profilePost);
      await this.store.storeContent(profilePost).catch(() => {});
    }

    await this.#emitCheckpointAndStream({
      targetType: 'user',
      targetKey: username,
      cursor: nextCursor,
      items: posts,
      hasMore: Boolean(nextCursor) && !stopPagination,
    });

    return {
      profile,
      posts,
      pageInfo: {
        end_cursor: nextCursor,
        has_next_page: Boolean(nextCursor) && !stopPagination,
      },
    };
  }

  /**
   * Search posts across Reddit.
   * @param {Record<string, unknown>} args
   * @param {Record<string, unknown>} [session]
   * @returns {Promise<{ posts: import('../../../core/types.js').PostItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }>}
   */
  async searchReddit(args = {}, session = {}) {
    const query = typeof args.query === 'string' ? args.query : (typeof args.q === 'string' ? args.q : undefined);
    if (!query || !query.trim()) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: "query"',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'reddit',
      });
    }

    const limit = this.#parseCount(args.limit, 25, 100);
    const sort = typeof args.sort === 'string' ? args.sort : undefined;
    const time = typeof args.time === 'string' ? args.time : undefined;
    const after = typeof args.after === 'string' ? args.after : (typeof args.cursor === 'string' ? args.cursor : undefined);

    const params = /** @type {Record<string, unknown>} */ ({ q: query.trim(), limit, sort, t: time, after });
    const raw = await this.client.apiRequest('/search', params);
    const rawData = /** @type {Record<string, unknown>} */ (raw?.data ?? raw);
    const children = Array.isArray(rawData.children) ? rawData.children : [];
    const posts = children
      .filter((child) => {
        const thing = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (child));
        return thing.kind === 't3';
      })
      .map((child) => {
        const thing = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (child));
        const post = normalizeRedditPost(thing);
        this.validateItem(post);
        return post;
      });
    const nextCursor = typeof rawData.after === 'string' ? rawData.after : null;

    let stopPagination = false;
    if (this.store && posts.length > 0) {
      const batch = await this.store.storeBatch(posts).catch(() => null);
      stopPagination = await this.shouldStopPagination(batch ?? posts);
    }

    await this.#emitCheckpointAndStream({
      targetType: 'search',
      targetKey: query.trim().toLowerCase(),
      cursor: nextCursor,
      items: posts,
      hasMore: Boolean(nextCursor) && !stopPagination,
    });

    return {
      posts,
      pageInfo: {
        end_cursor: nextCursor,
        has_next_page: Boolean(nextCursor) && !stopPagination,
      },
    };
  }

  /**
   * Scrape comment tree for a post.
   * @param {Record<string, unknown>} args
   * @param {Record<string, unknown>} [session]
   * @returns {Promise<{ comments: import('../../../core/types.js').CommentItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }>}
   */
  async getPostComments(args = {}, session = {}) {
    const { postId, subreddit } = this.#extractPostId(args);
    const limit = this.#parseCount(args.limit, 100, 500);
    const depth = this.#parseCount(args.depth, 10, 24);
    const after = typeof args.after === 'string' ? args.after : (typeof args.cursor === 'string' ? args.cursor : undefined);

    const params = /** @type {Record<string, unknown>} */ ({ limit, depth });
    if (after) params.after = after;

    const path = subreddit ? `/r/${subreddit}/comments/${postId}` : `/comments/${postId}`;
    const raw = await this.client.apiRequest(path, params);
    const rawArr = Array.isArray(raw) ? raw : [];
    const postListing = this.#asRecord(rawArr[0]);
    const postData = this.#asRecord(postListing.data);
    const commentListing = this.#asRecord(rawArr[1]);
    const commentData = this.#asRecord(commentListing.data);

    const comments = [];
    const children = Array.isArray(commentData.children) ? commentData.children : [];
    const stack = [...children];
    while (stack.length > 0 && comments.length < limit) {
      const node = this.#asRecord(stack.shift());
      if (node.kind !== 't1') continue;
      const comment = normalizeRedditComment(node);
      this.validateItem(comment);
      comments.push(comment);
      if (comments.length >= limit) break;
      const nodeData = this.#asRecord(node.data);
      const nodeReplies = this.#asRecord(nodeData.replies);
      const replyData = this.#asRecord(nodeReplies.data);
      const replies = Array.isArray(replyData.children) ? replyData.children : [];
      for (const reply of replies) {
        if (comments.length + stack.length >= limit) break;
        stack.push(reply);
      }
    }

    // Store the parent post first to satisfy foreign key constraints.
    if (this.store && Object.keys(postListing).length > 0) {
      const postChildren = Array.isArray(postData.children) ? postData.children : [rawArr[0]];
      const posts = postChildren
        .filter((child) => {
          const thing = this.#asRecord(child);
          return thing.kind === 't3' || Object.keys(thing).length > 0;
        })
        .map((child) => {
          const thing = this.#asRecord(child);
          const post = normalizeRedditPost(thing);
          this.validateItem(post);
          return post;
        });
      for (const post of posts) {
        await this.store.storeContent(post).catch(() => {});
      }
    }

    const nextCursor = typeof commentData.after === 'string' ? commentData.after : null;

    let stopPagination = false;
    if (this.store && comments.length > 0) {
      const batch = await this.store.storeCommentBatch(comments).catch(() => null);
      stopPagination = await this.shouldStopPagination(batch ?? comments);
    }

    await this.#emitCheckpointAndStream({
      targetType: 'post_comments',
      targetKey: postId,
      cursor: nextCursor,
      items: comments,
      hasMore: Boolean(nextCursor) && !stopPagination,
    });

    return {
      comments,
      pageInfo: {
        end_cursor: nextCursor,
        has_next_page: Boolean(nextCursor) && !stopPagination,
      },
    };
  }

  /**
   * Scrape subreddit metadata.
   * @param {Record<string, unknown>} args
   * @param {Record<string, unknown>} [session]
   * @returns {Promise<import('../../../core/types.js').PostItem>}
   */
  async getSubredditInfo(args = {}, session = {}) {
    const name = this.#extractSubreddit(args);
    const raw = await this.client.apiRequest(`/r/${name}/about`, {});
    const subreddit = normalizeRedditSubreddit(raw); this.validateItem(subreddit);

    if (this.store) {
      await this.store.storeContent(subreddit).catch(() => {});
    }

    await this.#emitCheckpointAndStream({
      targetType: 'subreddit_info',
      targetKey: name,
      cursor: null,
      items: [subreddit],
      hasMore: false,
    });

    return subreddit;
  }

  /**
   * Clean up resources.
   * @returns {Promise<void>}
   */
  async cleanup() {
    if (this.client && typeof this.client.close === 'function') {
      await this.client.close();
    }
  }
}
