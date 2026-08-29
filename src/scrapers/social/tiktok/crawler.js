// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TikTokCrawler — High-throughput hybrid crawler for TikTok Web API.
 * Extends AbstractCrawler, registers search, hashtag_feed, post_detail,
 * get_post_comments, normalizes data, and persists to PrismaStore.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractCrawler } from '../../../core/base-crawler.js';
import { TikTokClient } from './client.js';
import { CommentTreeExtractor } from '../comment-tree.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';
import {
  normalizeTikTokPost,
  normalizeTikTokSearchResponse,
  normalizeTikTokHashtagResponse,
  normalizeTikTokItemDetail,
  normalizeTikTokComment,
  normalizeTikTokCommentResponse,
  parseHumanCount,
} from './normalizer.js';
import { defaultRedisStreamPublisher, isEnvTruthy, toIsoDate } from '../../../utils/redis-stream-publisher.js';

export class TikTokCrawler extends AbstractCrawler {
  /** @type {string} */
  name = 'tiktok';

  /** @type {string} */
  platform = 'tiktok';

  /** @type {boolean} */
  requiresAuth = true;

  /** @type {TikTokClient} */
  client;

  /**
   * @param {Object} [deps]
   * @param {TikTokClient} [deps.client]
   * @param {import('../../../core/base-store.js').AbstractStore} [deps.store]
   * @param {import('../../../core/session-manager.js').SessionManager} [deps.sessionManager]
   * @param {import('../../../core/adaptive-governor.js').AdaptiveRateGovernor} [deps.governor]
   * @param {import('../../../core/account-pool.js').AccountPool} [deps.accountPool]
   * @param {import('../../../proxy/proxy-pool.js').ProxyIpPool} [deps.proxyPool]
   * @param {import('../../../utils/redis-stream-publisher.js').RedisStreamPublisher} [deps.redisPublisher]
   */
  constructor(deps = {}) {
    const { client: explicitClient, ...clientDeps } = deps;
    const client = explicitClient || new TikTokClient(/** @type {any} */ (clientDeps));
    super({
      ...deps,
      client,
      requiresAuth: true,
    });

    this.client = client;
    this.redisPublisher = deps.redisPublisher;

    this.registerAction(/** @type {any} */ ({
      action: 'search',
      description: 'Search TikTok videos by keyword',
      category: 'social',
      requiresAuth: true,
      requiredArgs: ['query'],
      optionalArgs: ['count', 'cursor'],
      outputType: '{ posts: PostItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }',
      example: { query: 'viral', count: 12 },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.search(args, session),
    }));

    this.registerAction(/** @type {any} */ ({
      action: 'hashtag_feed',
      description: 'Fetch TikTok videos for a hashtag',
      category: 'social',
      requiresAuth: true,
      requiredArgs: ['tag'],
      optionalArgs: ['count', 'cursor'],
      outputType: '{ posts: PostItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }',
      example: { tag: 'foryou', count: 30 },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.hashtagFeed(args, session),
    }));

    this.registerAction(/** @type {any} */ ({
      action: 'post_detail',
      description: 'Fetch TikTok video detail by ID or URL',
      category: 'social',
      requiresAuth: true,
      requiredArgs: ['videoId'],
      optionalArgs: ['includeComments', 'maxDepth', 'maxComments'],
      outputType: '{ post: PostItem, comments?: CommentItem[], pageInfo?: any }',
      example: { videoId: '7325759242735676680' },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.postDetail(args, session),
    }));

    this.registerAction(/** @type {any} */ ({
      action: 'get_post_comments',
      description: 'Scrape hierarchical comment tree for a TikTok video',
      category: 'social',
      requiresAuth: true,
      requiredArgs: ['videoId'],
      optionalArgs: ['maxDepth', 'maxComments', 'after'],
      outputType: '{ comments: CommentItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }',
      example: { videoId: '7325759242735676680', maxDepth: 3, maxComments: 100 },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getPostComments(args, session),
    }));
  }

  /**
   * @param {Object} params
   * @param {string} params.targetType
   * @param {string} params.targetKey
   * @param {string | null} [params.cursor]
   * @param {Array<import('../../../core/types.js').PostItem | import('../../../core/types.js').CommentItem>} [params.items]
   * @param {boolean} [params.hasMore]
   */
  async #emitCheckpointAndStream({ targetType, targetKey, cursor = null, items = [], hasMore = false }) {
    try {
      const storeWithCheckpoint = /** @type {any} */ (this.store);
      if (storeWithCheckpoint && typeof storeWithCheckpoint.saveCheckpoint === 'function') {
        const storageRef = items[0]?.id || items[0]?.externalId || '';
        await storeWithCheckpoint.saveCheckpoint({
          platform: 'tiktok',
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
        const publisher = this.redisPublisher || (this.store && /** @type {any} */ (this.store).publisher) || defaultRedisStreamPublisher;
        if (publisher && typeof publisher.publish === 'function') {
          for (const item of items) {
            const category = 'category' in item && typeof item.category === 'string' ? item.category : 'social';
            await publisher.publish({
              id: item.id,
              platform: 'tiktok',
              externalId: item.externalId,
              category,
              authorId: item.authorId || '',
              crawledAt: item.crawledAt ? toIsoDate(item.crawledAt) : new Date().toISOString(),
              storageRef: item.id,
            });
          }
        }
      }
    } catch (err) {
      console.warn(`⚠️ [TIKTOK TELEMETRY] Checkpoint/stream emission warning: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Clamp a numeric value to [min, max].
   * @param {unknown} value
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  #clamp(value, min, max) {
    const n = Number(value);
    const parsed = Number.isFinite(n) ? n : min;
    return Math.max(min, Math.min(parsed, max));
  }

  /**
   * Resolve a TikTok video ID from a URL or raw string.
   * @param {string} input
   * @returns {string}
   */
  #resolveVideoId(input) {
    if (!input || typeof input !== 'string') {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing or invalid videoId',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'tiktok',
      });
    }

    const clean = input.trim();
    if (/^\d+$/.test(clean)) return clean;

    const urlMatch = clean.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/i) ||
                     clean.match(/\/video\/(\d+)/i) ||
                     clean.match(/\/t\/(\d+)/i);
    if (urlMatch?.[1]) return urlMatch[1];

    throw new PlatformError({
      code: 'XACT_4001',
      type: ErrorTypes.INVALID_ARGS,
      message: `Cannot resolve TikTok video id from: ${input}`,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: 'tiktok',
    });
  }

  /**
   * Search TikTok videos by keyword.
   * @param {Object} args
   * @param {string} args.query
   * @param {number} [args.count=12]
   * @param {string | number} [args.cursor=0]
   * @param {Record<string, any>} [session={}]
   * @returns {Promise<{ posts: import('../../../core/types.js').PostItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }>}
   */
  async search(args, session = {}) {
    if (!args?.query) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing required argument: query',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'tiktok',
      });
    }

    const accountId = session?.accountId || 'tiktok-guest';
    const count = this.#clamp(args.count, 1, 35);
    const cursor = args.cursor ?? 0;

    await this.client.init({ accountId, cookies: session?.cookies });

    const resp = await this.client.requestTikTokApi('GET', '/api/search/general/full/', {
      keyword: args.query,
      count,
      cursor: String(cursor),
      offset: String(cursor),
    }, { accountId, requiresResidential: true });

    const { posts, pageInfo } = normalizeTikTokSearchResponse(resp);
    for (const post of posts) {
      this.validateItem(post);
    }

    if (this.store && typeof this.store.storeBatch === 'function' && posts.length > 0) {
      await this.store.storeBatch(posts, { upsert: true });
    }

    await this.#emitCheckpointAndStream({
      targetType: 'search',
      targetKey: args.query,
      cursor: pageInfo.end_cursor,
      items: posts,
      hasMore: pageInfo.has_next_page,
    });

    return { posts, pageInfo };
  }

  /**
   * Fetch TikTok videos for a hashtag.
   * @param {Object} args
   * @param {string} args.tag
   * @param {number} [args.count=30]
   * @param {string | number} [args.cursor=0]
   * @param {Record<string, any>} [session={}]
   * @returns {Promise<{ posts: import('../../../core/types.js').PostItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }>}
   */
  async hashtagFeed(args, session = {}) {
    if (!args?.tag) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing required argument: tag',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'tiktok',
      });
    }

    const accountId = session?.accountId || 'tiktok-guest';
    const count = this.#clamp(args.count, 1, 35);
    const cursor = args.cursor ?? 0;
    const tag = String(args.tag).replace(/^#/, '');

    await this.client.init({ accountId, cookies: session?.cookies });

    // Resolve challenge id from tag name.
    const detailResp = await this.client.requestTikTokApi('GET', '/api/challenge/detail/', {
      challengeName: tag,
    }, { accountId, requiresResidential: true });

    const challengeId =
      detailResp?.challengeInfo?.challenge?.id ||
      detailResp?.challenge_info?.challenge?.id ||
      detailResp?.challengeInfo?.challengeId ||
      detailResp?.challenge?.id;

    if (!challengeId) {
      throw new PlatformError({
        code: 'XACT_4041',
        type: ErrorTypes.INTERNAL,
        message: `Hashtag not found: ${tag}`,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'tiktok',
      });
    }

    const resp = await this.client.requestTikTokApi('GET', '/api/challenge/item_list/', {
      challengeID: String(challengeId),
      count,
      cursor: String(cursor),
    }, { accountId, requiresResidential: true });

    const { posts, pageInfo } = normalizeTikTokHashtagResponse(resp);
    for (const post of posts) {
      this.validateItem(post);
    }

    if (this.store && typeof this.store.storeBatch === 'function' && posts.length > 0) {
      await this.store.storeBatch(posts, { upsert: true });
    }

    await this.#emitCheckpointAndStream({
      targetType: 'hashtag_feed',
      targetKey: tag,
      cursor: pageInfo.end_cursor,
      items: posts,
      hasMore: pageInfo.has_next_page,
    });

    return { posts, pageInfo };
  }

  /**
   * Fetch TikTok video detail.
   * @param {Object} args
   * @param {string} args.videoId
   * @param {boolean} [args.includeComments=false]
   * @param {number} [args.maxDepth=3]
   * @param {number} [args.maxComments=500]
   * @param {Record<string, any>} [session={}]
   * @returns {Promise<{ post: import('../../../core/types.js').PostItem, comments?: import('../../../core/types.js').CommentItem[], pageInfo?: any }>}
   */
  async postDetail(args, session = {}) {
    if (!args?.videoId) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing required argument: videoId',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'tiktok',
      });
    }

    const accountId = session?.accountId || 'tiktok-guest';
    const videoId = this.#resolveVideoId(args.videoId);

    await this.client.init({ accountId, cookies: session?.cookies });

    let resp = null;
    let lastErr = null;

    // Prefer the item detail endpoint; fall back to SEO keyword tags.
    try {
      resp = await this.client.requestTikTokApi('GET', '/api/item/detail/', {
        itemId: videoId,
      }, { accountId, requiresResidential: true });
    } catch (err) {
      lastErr = err;
      console.warn(`⚠️ [TIKTOK] item/detail failed for ${videoId}, trying seo/keyword/item_tags`);
    }

    if (!resp) {
      try {
        resp = await this.client.requestTikTokApi('GET', '/api/seo/keyword/item_tags/', {
          itemIds: videoId,
          trafficType: 0,
        }, { accountId, requiresResidential: true });
      } catch (err) {
        lastErr = err;
      }
    }

    if (!resp) {
      throw new PlatformError({
        code: 'XACT_4041',
        type: ErrorTypes.INTERNAL,
        message: `Post not found: ${videoId} — ${lastErr instanceof Error ? lastErr.message : ''}`,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'tiktok',
      });
    }

    const post = normalizeTikTokItemDetail(resp);
    if (!post) {
      throw new PlatformError({
        code: 'XACT_4041',
        type: ErrorTypes.INTERNAL,
        message: `Failed to normalize post: ${videoId}`,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'tiktok',
      });
    }

    this.validateItem(post);

    if (this.store && typeof this.store.storeBatch === 'function') {
      await this.store.storeBatch([post], { upsert: true });
    }

    await this.#emitCheckpointAndStream({
      targetType: 'post_detail',
      targetKey: videoId,
      items: [post],
      hasMore: false,
    });

    if (args.includeComments) {
      const commentsResult = await this.getPostComments({
        videoId,
        maxDepth: args.maxDepth,
        maxComments: args.maxComments,
      }, session);
      return {
        post,
        comments: commentsResult.comments,
        pageInfo: commentsResult.pageInfo,
      };
    }

    return { post };
  }

  /**
   * Scrape hierarchical comment tree for a TikTok video.
   * @param {Object} args
   * @param {string} args.videoId
   * @param {number} [args.maxDepth=3]
   * @param {number} [args.maxComments=500]
   * @param {string} [args.after]
   * @param {Record<string, any>} [session={}]
   * @returns {Promise<{ comments: import('../../../core/types.js').CommentItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }>}
   */
  async getPostComments(args, session = {}) {
    if (!args?.videoId) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing required argument: videoId',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'tiktok',
      });
    }

    const accountId = session?.accountId || 'tiktok-guest';
    const videoId = this.#resolveVideoId(args.videoId);
    const maxDepth = Math.max(0, Math.min(args.maxDepth ?? 3, 5));
    const maxComments = Math.max(1, Math.min(args.maxComments ?? 500, 2000));

    await this.client.init({ accountId, cookies: session?.cookies });

    // Track cursors per layer (postId + parentCommentId) to avoid siblings
    // sharing the same cursor values and prematurely terminating pagination.
    /** @type {Map<string, Set<string>>} */
    const seenCursorsByLayer = new Map();

    /**
     * @param {import('../comment-tree.js').FetchLayerInput} input
     * @returns {Promise<import('../comment-tree.js').FetchLayerPage>}
     */
    const fetchLayer = async ({ postId, parentCommentId, after, limit }) => {
      const isReply = parentCommentId != null;
      const endpoint = isReply ? '/api/comment/list/reply/' : '/api/comment/list/';

      /** @type {Record<string, any>} */
      const params = {
        aweme_id: postId,
        count: this.#clamp(limit, 1, 50),
        cursor: String(after || 0),
      };

      if (isReply) {
        params.item_id = postId;
        params.comment_id = parentCommentId;
      }

      const resp = await this.client.requestTikTokApi('GET', endpoint, params, { accountId, requiresResidential: true });

      const rawComments =
        resp?.comments ||
        resp?.comment_list ||
        resp?.commentList ||
        resp?.data?.comments ||
        resp?.data?.comment_list ||
        resp?.data?.commentList ||
        [];

      const pageInfo = {
        has_next_page: Boolean(resp?.has_more || resp?.hasMore),
        end_cursor: resp?.cursor !== undefined ? String(resp.cursor) : null,
      };

      // Deduplicate cursors per layer to avoid empty/stuck pagination loops
      // without sharing state across unrelated reply threads.
      const layerKey = `${postId}:${parentCommentId || 'root'}`;
      if (!seenCursorsByLayer.has(layerKey)) {
        seenCursorsByLayer.set(layerKey, new Set());
      }
      const seenCursors = /** @type {Set<string>} */ (seenCursorsByLayer.get(layerKey));

      if (pageInfo.end_cursor) {
        if (seenCursors.has(pageInfo.end_cursor)) {
          pageInfo.has_next_page = false;
          pageInfo.end_cursor = null;
        } else {
          seenCursors.add(pageInfo.end_cursor);
        }
      }

      return { comments: rawComments, pageInfo };
    };

    const extractor = new CommentTreeExtractor(
      fetchLayer,
      (raw, pid) => normalizeTikTokComment(raw, pid),
      { maxDepth, maxComments, concurrency: 2 }
    );

    const { comments, pageInfo } = await extractor.fetch(videoId, { after: args.after || null });

    if (this.store && typeof this.store.storeCommentBatch === 'function' && comments.length > 0) {
      await this.store.storeCommentBatch(comments, { upsert: true });
    }

    await this.#emitCheckpointAndStream({
      targetType: 'post_comments',
      targetKey: videoId,
      cursor: pageInfo.end_cursor,
      items: comments,
      hasMore: pageInfo.has_next_page,
    });

    return { comments, pageInfo };
  }

  /** @returns {Promise<void>} */
  async init() {}

  /**
   * Cleanup crawler and client resources.
   * @returns {Promise<void>}
   */
  async cleanup() {
    if (this.client && typeof this.client.close === 'function') {
      await this.client.close();
    }
  }
}
