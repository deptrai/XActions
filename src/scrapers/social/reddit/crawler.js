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

export function createRedditCrawler(client, options = {}) {
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
   * @param {Object} [deps]
   * @param {RedditClient} [deps.client]
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
    const client = explicitClient || new RedditClient(/** @type {any} */ (clientDeps));

    super({
      ...deps,
      client,
      requiresAuth: deps.requiresAuth !== undefined ? deps.requiresAuth : false,
    });

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
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getSubredditPosts(args, session),
    });

    // ── 2. Action: user ──
    this.registerAction({
      action: 'user',
      description: 'Scrape Reddit user profile and submitted posts',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['username'],
      optionalArgs: ['name', 'user', 'limit', 'sort', 'cursor', 'after'],
      outputType: '{ profile: ProfileItem, posts: PostItem[] }',
      example: { username: 'spez', limit: 25 },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getUser(args, session),
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
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.search(args, session),
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
        const postId = args?.postId || args?.id;
        if (!postId || typeof postId !== 'string') return null;
        return {
          targetType: 'post_comments',
          targetKey: String(postId).trim(),
          cursorField: 'after',
          fallbackCursorFields: ['cursor'],
        };
      },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getPostComments(args, session),
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
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getSubredditInfo(args, session),
    });
  }

  /**
   * Resolve subreddit name from various arg conventions.
   * @param {Record<string, any>} args
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
    return String(raw).replace(/^r\//, '').trim();
  }

  /**
   * Resolve username from various arg conventions.
   * @param {Record<string, any>} args
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
    return String(raw).replace(/^u\//, '').replace(/^@/, '').trim();
  }

  /**
   * Resolve postId from various arg conventions.
   * Supports fullname (t3_xxx), bare id (xxx), or URL.
   * @param {Record<string, any>} args
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

    // Extract from URL: /r/{sub}/comments/{id}/...
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
      postId = clean;
    }

    if (!subreddit) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'post_comments requires "subreddit" arg or a Reddit post URL containing /r/{sub}/',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'reddit',
      });
    }

    return { postId, subreddit };
  }

  /**
   * Helper to emit checkpoint + stream events for paginated results.
   * @param {Object} params
   * @param {string} params.targetType
   * @param {string} params.targetKey
   * @param {string | null} [params.cursor]
   * @param {any[]} [params.items]
   * @param {boolean} [params.hasMore]
   */
  async #emitCheckpointAndStream({ targetType, targetKey, cursor = null, items = [], hasMore = false }) {
    try {
      const storeWithCheckpoint = /** @type {any} */ (this.store);
      if (storeWithCheckpoint && typeof storeWithCheckpoint.saveCheckpoint === 'function') {
        const firstItem = /** @type {any} */ (items[0]);
        const storageRef = firstItem?.id || firstItem?.externalId || '';
        await storeWithCheckpoint.saveCheckpoint({
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
        const publisher =
          this.redisPublisher ||
          (this.store && /** @type {any} */ (this.store).publisher) ||
          null;

        if (publisher && typeof publisher.publish === 'function') {
          for (const item of items) {
            const anyItem = /** @type {any} */ (item);
            const category = 'category' in anyItem && typeof anyItem.category === 'string' ? anyItem.category : 'social';
            await publisher.publish({
              id: anyItem.id,
              platform: 'reddit',
              externalId: anyItem.externalId,
              category,
              authorId: anyItem.authorId || anyItem.externalId || '',
              crawledAt: anyItem.crawledAt ? toIsoDate(anyItem.crawledAt) : new Date().toISOString(),
              storageRef: anyItem.id,
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
   * @param {Record<string, any>} args
   * @param {Record<string, any>} [session]
   * @returns {Promise<{ posts: import('../../../core/types.js').PostItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }>}
   */
  async getSubredditPosts(args = {}, session = {}) {
    const name = this.#extractSubreddit(args);
    const limit = Math.min(100, Math.max(1, Number(args.limit || 25)));
    const sort = ['new', 'hot', 'top', 'rising'].includes(args.sort) ? args.sort : 'new';
    const time = args.time || undefined;
    const after = args.after || args.cursor || undefined;

    const params = { limit };
    if (sort === 'top' && time) params.t = time;
    if (after) params.after = after;

    const raw = await this.client.apiRequest(`/r/${name}/${sort}`, params);
    const children = Array.isArray(raw?.data?.children) ? raw.data.children : [];
    const posts = children
      .filter((child) => child?.kind === 't3')
      .map((child) => normalizeRedditPost(child));
    const nextCursor = raw?.data?.after || null;

    if (this.store && posts.length > 0) {
      await this.store.storeBatch(posts).catch(() => {});
    }

    await this.#emitCheckpointAndStream({
      targetType: 'subreddit',
      targetKey: name,
      cursor: nextCursor,
      items: posts,
      hasMore: Boolean(nextCursor),
    });

    return {
      posts,
      pageInfo: {
        end_cursor: nextCursor,
        has_next_page: Boolean(nextCursor),
      },
    };
  }

  /**
   * Scrape user profile and posts.
   * @param {Record<string, any>} args
   * @param {Record<string, any>} [session]
   * @returns {Promise<{ profile: import('../../../core/types.js').ProfileItem, posts: import('../../../core/types.js').PostItem[] }>}
   */
  async getUser(args = {}, session = {}) {
    const username = this.#extractUsername(args);
    const limit = Math.min(100, Math.max(1, Number(args.limit || 25)));
    const sort = ['new', 'hot', 'top'].includes(args.sort) ? args.sort : 'new';
    const after = args.after || args.cursor || undefined;

    const params = { limit };
    if (after) params.after = after;

    const [profileRaw, postsRaw] = await Promise.all([
      this.client.apiRequest(`/user/${username}/about`, {}),
      this.client.apiRequest(`/user/${username}/submitted`, params),
    ]);

    const profile = normalizeRedditUser(profileRaw);
    const children = Array.isArray(postsRaw?.data?.children) ? postsRaw.data.children : [];
    const posts = children
      .filter((child) => child?.kind === 't3')
      .map((child) => normalizeRedditPost(child));
    const nextCursor = postsRaw?.data?.after || null;

    if (this.store) {
      if (posts.length > 0) {
        await this.store.storeBatch(posts).catch(() => {});
      }
      const profilePost = {
        id: profile.id,
        platform: profile.platform,
        externalId: profile.externalId,
        category: 'social',
        authorId: profile.externalId,
        authorName: profile.authorName,
        authorAvatar: profile.avatar || null,
        postUrl: profile.profileUrl,
        content: profile.bio || profile.name || 'Reddit Profile',
        mediaUrls: profile.avatar ? [profile.avatar] : [],
        likesCount: profile.followersCount || 0,
        repostsCount: 0,
        repliesCount: 0,
        metadata: { isProfile: true, ...(profile.metadata || {}) },
        crawledAt: profile.crawledAt,
      };
      await this.store.storeContent(profilePost).catch(() => {});
    }

    return {
      profile,
      posts,
      pageInfo: {
        end_cursor: nextCursor,
        has_next_page: Boolean(nextCursor),
      },
    };
  }

  /**
   * Search posts across Reddit.
   * @param {Record<string, any>} args
   * @param {Record<string, any>} [session]
   * @returns {Promise<{ posts: import('../../../core/types.js').PostItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }>}
   */
  async search(args = {}, session = {}) {
    const query = args.query || args.q;
    if (!query || typeof query !== 'string' || !query.trim()) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: "query"',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'reddit',
      });
    }

    const limit = Math.min(100, Math.max(1, Number(args.limit || 25)));
    const sort = args.sort || undefined;
    const time = args.time || undefined;
    const after = args.after || args.cursor || undefined;

    const params = { q: query.trim(), limit, sort, t: time, after };
    const raw = await this.client.apiRequest('/search', params);
    const children = Array.isArray(raw?.data?.children) ? raw.data.children : [];
    const posts = children
      .filter((child) => child?.kind === 't3')
      .map((child) => normalizeRedditPost(child));
    const nextCursor = raw?.data?.after || null;

    if (this.store && posts.length > 0) {
      await this.store.storeBatch(posts).catch(() => {});
    }

    await this.#emitCheckpointAndStream({
      targetType: 'search',
      targetKey: query.trim().toLowerCase(),
      cursor: nextCursor,
      items: posts,
      hasMore: Boolean(nextCursor),
    });

    return {
      posts,
      pageInfo: {
        end_cursor: nextCursor,
        has_next_page: Boolean(nextCursor),
      },
    };
  }

  /**
   * Scrape comment tree for a post.
   * @param {Record<string, any>} args
   * @param {Record<string, any>} [session]
   * @returns {Promise<{ comments: import('../../../core/types.js').CommentItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }>}
   */
  async getPostComments(args = {}, session = {}) {
    const { postId, subreddit } = this.#extractPostId(args);
    const limit = Math.min(500, Math.max(1, Number(args.limit || 100)));
    const depth = args.depth !== undefined ? Number(args.depth) : 10;
    const after = args.after || args.cursor || undefined;

    const params = { limit, depth };
    if (after) params.after = after;

    const raw = await this.client.apiRequest(`/r/${subreddit}/comments/${postId}`, params);
    const postListing = Array.isArray(raw) ? raw[0] : null;
    const commentListing = Array.isArray(raw) ? raw[1] : null;

    const comments = [];
    const stack = [...(commentListing?.data?.children || [])];
    while (stack.length > 0) {
      const node = stack.shift();
      if (!node || node.kind !== 't1') continue;
      comments.push(normalizeRedditComment(node));
      const replies = node.data?.replies?.data?.children;
      if (Array.isArray(replies)) {
        for (const reply of replies) stack.push(reply);
      }
    }

    const nextCursor = commentListing?.data?.after || null;

    if (this.store && comments.length > 0) {
      await this.store.storeBatch(comments).catch(() => {});
    }

    await this.#emitCheckpointAndStream({
      targetType: 'post_comments',
      targetKey: postId,
      cursor: nextCursor,
      items: comments,
      hasMore: Boolean(nextCursor),
    });

    return {
      comments,
      pageInfo: {
        end_cursor: nextCursor,
        has_next_page: Boolean(nextCursor),
      },
    };
  }

  /**
   * Scrape subreddit metadata.
   * @param {Record<string, any>} args
   * @param {Record<string, any>} [session]
   * @returns {Promise<import('../../../core/types.js').PostItem>}
   */
  async getSubredditInfo(args = {}, session = {}) {
    const name = this.#extractSubreddit(args);
    const raw = await this.client.apiRequest(`/r/${name}/about`, {});
    const subreddit = normalizeRedditSubreddit(raw);

    if (this.store) {
      await this.store.storeContent(subreddit).catch(() => {});
    }

    return subreddit;
  }

  /**
   * Clean up resources.
   * @returns {Promise<void>}
   */
  async cleanup() {
    // Reddit is HTTP-only, no browser to close.
  }
}
