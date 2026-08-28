// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * ThreadsCrawler — High-throughput hybrid crawler for Threads (Meta Internal GraphQL).
 * Extends AbstractCrawler, registers get_user_feed, search, and get_post_comments,
 * normalizes data into PostItem/CommentItem schema, emits checkpoints & stream events,
 * and persists to PrismaStore.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractCrawler } from '../../../core/base-crawler.js';
import { ThreadsClient } from './client.js';
import { CommentTreeExtractor } from '../comment-tree.js';
import { generatePostId, generateCommentId } from '../../../core/types.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';
import {
  defaultRedisStreamPublisher,
  isEnvTruthy,
  toIsoDate,
} from '../../../utils/redis-stream-publisher.js';

export const DEFAULT_THREADS_DOC_IDS = {
  PROFILE_FEED: '6232751443445612',
  POST_DETAIL: '5587632691339264',
  SEARCH_POSTS: null,
  COMMENT_ROOTS: null,
  COMMENT_REPLIES: null,
};

/** @type {string} */
const SHORTCODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export class ThreadsCrawler extends AbstractCrawler {
  /** @type {string} */
  name = 'threads';

  /** @type {string} */
  platform = 'threads';

  /** @type {boolean} */
  requiresAuth = true;

  /** @type {ThreadsClient} */
  client;

  /** @type {Record<string, string | null>} */
  docIds;

  /**
   * @param {Object} [deps]
   * @param {ThreadsClient} [deps.client]
   * @param {Record<string, string | null>} [deps.docIds]
   * @param {import('../../../core/base-store.js').AbstractStore} [deps.store]
   * @param {import('../../../core/session-manager.js').SessionManager} [deps.sessionManager]
   * @param {import('../../../core/adaptive-governor.js').AdaptiveRateGovernor} [deps.governor]
   * @param {import('../../../core/account-pool.js').AccountPool} [deps.accountPool]
   * @param {import('../../../proxy/proxy-pool.js').ProxyIpPool} [deps.proxyPool]
   */
  constructor(deps = {}) {
    const { client: explicitClient, ...clientDeps } = deps;
    const client = explicitClient || new ThreadsClient(/** @type {any} */ (clientDeps));
    super({
      ...deps,
      client,
      requiresAuth: true,
    });

    this.client = client;
    this.docIds = {
      ...DEFAULT_THREADS_DOC_IDS,
      ...(deps.docIds || {}),
    };

    // Register standard actions in ActionRegistry conforming to AD-11
    this.registerAction(/** @type {any} */ ({
      action: 'get_user_feed',
      description: 'Scrape timeline threads and posts for a user profile by username',
      category: 'social',
      requiredArgs: ['username'],
      optionalArgs: ['count', 'cursor'],
      outputType: 'PostItem[]',
      example: { username: 'zuck', count: 20 },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getUserFeed(args, session),
    }));

    this.registerAction(/** @type {any} */ ({
      action: 'search',
      description: 'Search viral posts and discussions on Threads',
      category: 'social',
      requiredArgs: ['query'],
      optionalArgs: ['count', 'cursor', 'searchType'],
      outputType: 'PostItem[] | { posts: PostItem[], pageInfo: any }',
      example: { query: 'artificial intelligence', count: 20 },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.search(args, session),
    }));

    this.registerAction(/** @type {any} */ ({
      action: 'get_post_comments',
      description: 'Scrape hierarchical comment tree for a Threads post',
      category: 'social',
      requiredArgs: ['postId'],
      optionalArgs: ['maxDepth', 'maxComments', 'after'],
      outputType: 'CommentItem[]',
      example: { postId: 'CuZ7X9_sF9y', maxDepth: 3, maxComments: 100 },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getPostComments(args, session),
    }));
  }

  /**
   * Helper to emit checkpoint and Redis stream pointer if available.
   * @param {Object} params
   * @param {string} params.targetType
   * @param {string} params.targetKey
   * @param {string | null} [params.cursor]
   * @param {Array<import('../../../core/types.js').PostItem | import('../../../core/types.js').CommentItem>} params.items
   * @param {boolean} [params.hasMore]
   */
  async #emitCheckpointAndStream({ targetType, targetKey, cursor = null, items = [], hasMore = false }) {
    try {
      const storeWithCheckpoint = /** @type {any} */ (this.store);
      if (storeWithCheckpoint && typeof storeWithCheckpoint.saveCheckpoint === 'function') {
        const storageRef = items[0]?.id || items[0]?.externalId || '';
        await storeWithCheckpoint.saveCheckpoint({
          platform: 'threads',
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
        for (const item of items) {
          const category = 'category' in item && typeof item.category === 'string' ? item.category : 'social';
          await defaultRedisStreamPublisher.publish({
            id: item.id,
            platform: 'threads',
            externalId: item.externalId,
            category,
            authorId: item.authorId || '',
            crawledAt: item.crawledAt ? toIsoDate(item.crawledAt) : new Date().toISOString(),
            storageRef: item.id,
          });
        }
      }
    } catch (err) {
      // Non-blocking telemetry warning
      console.warn(`⚠️ [THREADS TELEMETRY] Checkpoint/stream emission warning: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Clamp `count` to a sensible range.
   * @param {unknown} value
   * @param {number} [min=1]
   * @param {number} [max=100]
   * @returns {number}
   */
  #clampCount(value, min = 1, max = 100) {
    const n = Number(value);
    const parsed = Number.isFinite(n) ? n : 20;
    return Math.max(min, Math.min(parsed, max));
  }

  /**
   * Normalize an empty end_cursor to null and ensure a stable pageInfo shape.
   * When a `seenCursors` set is supplied, deduplicate repeated cursors and
   * clamp empty cursors that falsely claim more pages.
   * @param {any} pageInfo
   * @param {Set<string>} [seenCursors]
   * @returns {{ has_next_page: boolean, end_cursor: string | null }}
   */
  #normalizePageInfo(pageInfo, seenCursors = undefined) {
    if (!pageInfo || typeof pageInfo !== 'object') {
      return { has_next_page: false, end_cursor: null };
    }
    let has_next_page = Boolean(pageInfo.has_next_page);
    let end_cursor = (pageInfo.end_cursor && typeof pageInfo.end_cursor === 'string') ? pageInfo.end_cursor : null;

    if (has_next_page && !end_cursor) {
      has_next_page = false;
      end_cursor = null;
    }

    if (end_cursor && seenCursors) {
      if (seenCursors.has(end_cursor)) {
        has_next_page = false;
        end_cursor = null;
      } else {
        seenCursors.add(end_cursor);
      }
    }

    return { has_next_page, end_cursor };
  }

  /**
   * Flatten a thread wrapper into its contained post nodes.
   * @param {Record<string, any>} raw
   * @returns {Record<string, any>[]}
   */
  #flattenThreadItems(raw) {
    if (!raw || typeof raw !== 'object') return [];

    // Unwrap an edge wrapper (e.g. search results).
    let wrapper = raw;
    if (raw.node && typeof raw.node === 'object' && !Array.isArray(raw.node)) {
      wrapper = raw.node;
    }

    if (wrapper.post) return [wrapper.post];
    if (Array.isArray(wrapper.thread_items)) {
      return wrapper.thread_items
        .filter((/** @type {any} */ item) => item && typeof item === 'object')
        .map((/** @type {any} */ item) => item.post || item)
        .filter(Boolean);
    }
    return [wrapper];
  }

  /**
   * Parse a timestamp value robustly.
   * @param {unknown} takenAt
   * @returns {Date | undefined}
   */
  #parseTakenAt(takenAt) {
    if (takenAt === undefined || takenAt === null) return undefined;
    const n = Number(takenAt);
    if (Number.isFinite(n)) {
      if (n <= 0) return undefined;
      const ms = n > 1e12 ? n : (n > 1e9 ? n * 1000 : n);
      return new Date(ms);
    }
    const d = new Date(String(takenAt));
    return Number.isNaN(d.getTime()) ? undefined : d;
  }

  /**
   * Pick the largest candidate by width*height.
   * @param {Record<string, any>[]} candidates
   * @returns {string | null}
   */
  #bestCandidateUrl(candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    const sorted = [...candidates].sort((a, b) => {
      const aw = Number(a?.width) || 0;
      const ah = Number(a?.height) || 0;
      const bw = Number(b?.width) || 0;
      const bh = Number(b?.height) || 0;
      return (bw * bh) - (aw * ah);
    });
    return sorted[0]?.url || null;
  }

  /**
   * Extract media URLs and determine the media type.
   * @param {Record<string, any>} post
   * @returns {{ mediaUrls: string[], mediaType: string, carousel: string[] }}
   */
  #extractMedia(post) {
    /** @type {string[]} */
    const mediaUrls = [];
    /** @type {string[]} */
    const carousel = [];
    let mediaType = 'text';

    const hasVideo = Array.isArray(post.video_versions) && post.video_versions.length > 0;
    const hasCarousel = Array.isArray(post.carousel_media) && post.carousel_media.length > 0;
    const hasImage = Array.isArray(post.image_versions2?.candidates) && post.image_versions2.candidates.length > 0;

    if (post.media_type === 2 || post.media_type === 'video' || (post.media_type === undefined && hasVideo)) {
      mediaType = 'video';
      const video = this.#bestCandidateUrl(post.video_versions);
      if (video) mediaUrls.push(video);
      // Fallback to a still thumbnail if the video list is empty.
      if (mediaUrls.length === 0 && hasImage) {
        const thumb = this.#bestCandidateUrl(post.image_versions2.candidates);
        if (thumb) mediaUrls.push(thumb);
      }
    } else if (post.media_type === 8 || post.media_type === 'carousel' || (post.media_type === undefined && hasCarousel)) {
      mediaType = 'carousel';
      for (const item of post.carousel_media) {
        const url = this.#bestCandidateUrl(item?.image_versions2?.candidates);
        if (url) {
          mediaUrls.push(url);
          carousel.push(url);
        }
      }
    } else if (post.media_type === 1 || post.media_type === 'image' || (post.media_type === undefined && hasImage)) {
      mediaType = 'image';
      const image = this.#bestCandidateUrl(post.image_versions2.candidates);
      if (image) mediaUrls.push(image);
    }

    return { mediaUrls, mediaType, carousel };
  }

  /**
   * Convert a numeric media id to a Threads shortcode.
   * @param {bigint} id
   * @returns {string}
   */
  #numericIdToShortcode(id) {
    if (id === 0n) return SHORTCODE_ALPHABET[0];
    let s = '';
    let n = id;
    while (n > 0n) {
      const r = Number(n % 64n);
      s = SHORTCODE_ALPHABET[r] + s;
      n = n / 64n;
    }
    return s;
  }

  /**
   * Normalize raw Threads GraphQL / SSR post node into uniform PostItem.
   * @param {Record<string, any>} raw
   * @returns {import('../../../core/types.js').PostItem | null}
   */
  #normalizePostItem(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const post = raw.post || raw;
    const rawPk = post.pk || post.id || raw.pk || raw.id;
    const postId = rawPk ? String(rawPk) : '';
    if (!postId) return null;

    const user = post.user || raw.user || {};
    const authorId = String(user.pk || user.id || '');
    const authorName = String(user.username || '');
    const authorAvatar = user.profile_pic_url || '';
    const authorUrl = authorName ? `https://www.threads.net/@${authorName}` : undefined;

    const rawContent = (typeof post.caption === 'string' ? post.caption : post.caption?.text) ?? post.text ?? '';
    const content = rawContent == null ? '' : String(rawContent);

    const parseCount = (/** @type {unknown} */ val) => {
      const n = Number(val);
      return Number.isFinite(n) ? n : 0;
    };

    const likesCount = parseCount(post.like_count);
    const repliesCount = parseCount(post.text_post_app_info?.direct_reply_count ?? post.comment_count);
    const repostsCount = parseCount(post.media_repost_count);
    const viewsCount = parseCount(post.play_count);

    const { mediaUrls, mediaType, carousel } = this.#extractMedia(post);

    let postCode = post.code || raw.code;
    if (!postCode) {
      if (/^[0-9]+$/.test(postId)) {
        try {
          postCode = this.#numericIdToShortcode(BigInt(postId));
        } catch {
          postCode = postId;
        }
      } else {
        postCode = postId;
      }
    }

    const postUrl = authorName ? `https://www.threads.net/@${authorName}/post/${postCode}` : `https://www.threads.net/t/${postCode}`;
    const takenAt = post.taken_at || raw.taken_at;
    const publishedAt = this.#parseTakenAt(takenAt);

    /** @type {import('../../../core/types.js').PostItem} */
    const item = {
      id: generatePostId('threads', postId),
      externalId: postId,
      platform: 'threads',
      category: 'social',
      authorId,
      authorName,
      authorAvatar,
      authorUrl,
      content,
      likesCount,
      repliesCount,
      repostsCount,
      viewsCount,
      mediaUrls,
      postUrl,
      publishedAt,
      crawledAt: new Date(),
      metadata: {
        postCode: String(postCode),
        mediaType: String(mediaType),
        isReply: Boolean(post.text_post_app_info?.is_reply),
        carousel: mediaType === 'carousel' ? carousel : undefined,
        replyControl: post.text_post_app_info?.reply_control ? String(post.text_post_app_info.reply_control) : 'everyone',
        sourceMethod: 'graphql',
      },
    };

    return item;
  }

  /**
   * Normalize raw Threads comment node into uniform CommentItem.
   * @param {Record<string, any>} raw
   * @param {string} rootPostId
   * @returns {import('../../../core/types.js').CommentItem | null}
   */
  #normalizeCommentItem(raw, rootPostId) {
    if (!raw || typeof raw !== 'object') return null;

    const replyPost = raw.post || raw;
    const commentPk = replyPost.pk || replyPost.id;
    const commentId = commentPk ? String(commentPk) : '';
    if (!commentId) return null;

    const user = replyPost.user || {};
    const authorId = String(user.pk || user.id || '');
    const authorName = String(user.username || '');
    const authorAvatar = user.profile_pic_url || '';

    const rawContent = (typeof replyPost.caption === 'string' ? replyPost.caption : replyPost.caption?.text) ?? replyPost.text ?? '';
    const content = rawContent == null ? '' : String(rawContent);

    const parseCount = (/** @type {unknown} */ val) => {
      const n = Number(val);
      return Number.isFinite(n) ? n : 0;
    };

    const likesCount = parseCount(replyPost.like_count);
    const subCommentsCount = parseCount(replyPost.text_post_app_info?.direct_reply_count ?? replyPost.comment_count);
    const takenAt = replyPost.taken_at;
    const publishedAt = this.#parseTakenAt(takenAt);

    const parentExternalId = raw.parentId || replyPost.parentId;

    /** @type {import('../../../core/types.js').CommentItem} */
    const item = {
      id: generateCommentId('threads', rootPostId, commentId),
      externalId: commentId,
      platform: 'threads',
      postId: generatePostId('threads', rootPostId),
      parentCommentId: parentExternalId ? generateCommentId('threads', rootPostId, String(parentExternalId)) : undefined,
      depth: 0, // CommentTreeExtractor will override
      authorId,
      authorName,
      authorAvatar,
      content,
      likesCount,
      subCommentsCount,
      publishedAt,
      crawledAt: new Date(),
      metadata: {
        postCode: String(replyPost.code || commentId),
        mediaType: String(replyPost.media_type || 'comment'),
        isReply: !!replyPost.text_post_app_info?.is_reply,
        sourceMethod: 'graphql',
      },
    };

    return item;
  }

  /**
   * Extract clean post ID or shortcode from URL or raw ID string.
   * @param {string} input
   * @returns {string}
   */
  #extractPostCodeOrId(input) {
    if (!input) return '';
    const clean = String(input).trim();
    const urlMatch = clean.match(/(?:threads\.net\/(?:@[^/]+\/post|t)\/)([^/?#]+)/i);
    if (urlMatch && urlMatch[1]) {
      return urlMatch[1];
    }
    return clean.replace(/^threads:/, '');
  }

  /**
   * Extract only the root/top-level comments from a BarcelonaPostPageQuery-style
   * post detail bundle. Nested reply threads inside each thread are intentionally
   * ignored so the fallback does not mis-parent or duplicate children.
   * @param {Record<string, any>} bundle
   * @returns {{ comments: Record<string, any>[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }}
   */
  #extractFallbackRootComments(bundle) {
    const data = bundle?.data?.data ?? bundle?.data ?? bundle;
    /** @type {Record<string, any>[]} */
    const comments = [];
    const seen = new Set();

    const push = (/** @type {Record<string, any> | undefined} */ post) => {
      if (!post || typeof post !== 'object') return;
      const key = post.id || post.pk || post.externalId;
      if (key && seen.has(key)) return;
      if (key) seen.add(key);
      comments.push(post);
    };

    /**
     * @param {unknown} thread
     */
    const extractFromThread = (thread) => {
      if (!thread || typeof thread !== 'object') return;
      const record = /** @type {Record<string, any>} */ (thread);

      const itemList = Array.isArray(record.items)
        ? record.items
        : (Array.isArray(record.thread_items) ? record.thread_items : null);

      if (Array.isArray(itemList)) {
        const first = itemList[0];
        if (first?.post) {
          push(first.post);
        } else if (first && (first.pk || first.id)) {
          push(first);
        }
        return;
      }

      // Direct post object in a thread wrapper.
      if (record.post && (record.post.pk || record.post.id)) {
        push(record.post);
      } else if (record.pk || record.id) {
        push(record);
      }
    };

    const topReplyThreads = data?.containing_thread?.thread_items?.[0]?.post?.reply_threads;
    if (Array.isArray(topReplyThreads)) {
      for (const thread of topReplyThreads) {
        extractFromThread(thread);
      }
    }

    const topComments = data?.containing_thread?.thread_items?.[0]?.post?.comments;
    if (topComments && typeof topComments === 'object') {
      const list = Array.isArray(topComments.items)
        ? topComments.items
        : (Array.isArray(topComments.edges) ? topComments.edges : (Array.isArray(topComments) ? topComments : []));
      for (const item of list) {
        if (item?.post) {
          push(item.post);
        } else if (item?.node) {
          push(item.node);
        } else if (item && (item.pk || item.id)) {
          push(item);
        }
      }
    }

    if (Array.isArray(data?.reply_threads)) {
      for (const thread of data.reply_threads) {
        extractFromThread(thread);
      }
    }

    return { comments, pageInfo: { has_next_page: false, end_cursor: null } };
  }

  /**
   * Resolve numeric Threads user ID from @username profile page HTML.
   * @param {string} username
   * @param {string} accountId
   * @returns {Promise<string>}
   */
  async #resolveUserId(username, accountId) {
    const cleanUser = username.replace(/^@/, '').trim();
    if (!cleanUser) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Username cannot be empty',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    const resp = /** @type {any} */ (await this.client.request('GET', `${this.client.baseUrl}/@${encodeURIComponent(cleanUser)}`, {
      accountId,
    }));

    const html = typeof resp?.data === 'string' ? resp.data : (typeof resp === 'string' ? resp : JSON.stringify(resp?.data || ''));

    // Prioritize target profile user ID, then scoped user JSON, then fallbacks.
    const idMatch =
      html.match(/window\.__user_id\s*=\s*"([^"]+)"/) ||
      html.match(/window\.__userId\s*=\s*"([^"]+)"/) ||
      html.match(/"user"\s*:\s*\{\s*"pk"\s*:\s*"([^"]+)"/) ||
      html.match(/"owner"\s*:\s*\{\s*"id"\s*:\s*"([^"]+)"/) ||
      html.match(/"user_id"\s*:\s*"([^"]+)"/) ||
      html.match(/"pk"\s*:\s*"([^"]+)"/);

    if (idMatch && idMatch[1]) {
      return idMatch[1];
    }

    throw new PlatformError({
      code: 'XACT_4041',
      type: ErrorTypes.INVALID_ARGS,
      message: `Could not resolve numeric user ID for @${cleanUser}. Profile may be private, suspended, or not found.`,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: 'threads',
    });
  }

  /**
   * Scrape user timeline threads by username via GraphQL.
   * @param {Object} args
   * @param {string} args.username
   * @param {number} [args.count=20]
   * @param {string} [args.cursor]
   * @param {Record<string, any>} [session={}]
   * @returns {Promise<{ posts: import('../../../core/types.js').PostItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }>}
   */
  async getUserFeed(args, session = {}) {
    if (!args?.username) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing required argument: username',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    const accountId = session?.accountId || 'threads-guest';
    const cleanUser = args.username.replace(/^@/, '');
    const numericUserId = await this.#resolveUserId(cleanUser, accountId);

    const docId = this.docIds.PROFILE_FEED || DEFAULT_THREADS_DOC_IDS.PROFILE_FEED;
    const count = this.#clampCount(args.count, 1, 100);
    const variables = {
      userID: numericUserId,
      first: count,
      after: args.cursor || null,
    };

    const res = await this.client.requestGraphQl(docId, variables, {
      accountId,
    });

    const rawThreads = res?.data?.mediaData?.threads || res?.data?.mediaData?.edges || [];
    const posts = [];

    for (const thread of rawThreads) {
      for (const rawPost of this.#flattenThreadItems(thread)) {
        try {
          const post = this.#normalizePostItem(rawPost);
          if (!post) continue;
          this.validateItem(post);
          posts.push(post);
        } catch {
          // Skip invalid posts instead of aborting the whole batch.
        }
      }
    }

    if (this.store && typeof this.store.storeBatch === 'function' && posts.length > 0) {
      await this.store.storeBatch(posts, { upsert: true });
    }

    const pageInfo = this.#normalizePageInfo(res?.data?.mediaData?.page_info);
    await this.#emitCheckpointAndStream({
      targetType: 'user_feed',
      targetKey: cleanUser,
      cursor: pageInfo.end_cursor,
      items: posts,
      hasMore: pageInfo.has_next_page,
    });

    return {
      posts,
      pageInfo,
    };
  }

  /**
   * Search posts on Threads via GraphQL or HTTP SSR fallback.
   * @param {Object} args
   * @param {string} args.query
   * @param {number} [args.count=20]
   * @param {string} [args.cursor]
   * @param {string} [args.searchType='default']
   * @param {Record<string, any>} [session={}]
   * @returns {Promise<{ posts: import('../../../core/types.js').PostItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }>}
   */
  async searchPosts(args, session = {}) {
    if (!args?.query) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing required argument: query',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    const accountId = session?.accountId || 'threads-guest';
    const count = this.#clampCount(args.count, 1, 100);

    if (this.docIds.SEARCH_POSTS) {
      const res = await this.client.requestGraphQl(this.docIds.SEARCH_POSTS, {
        query: args.query,
        first: count,
        after: args.cursor || null,
        serp_type: args.searchType || 'default',
      }, { accountId });

      const rawThreads = res?.data?.mediaData?.threads || res?.data?.searchResults?.edges || [];
      const posts = [];
      for (const t of rawThreads) {
        for (const rawPost of this.#flattenThreadItems(t)) {
          try {
            const post = this.#normalizePostItem(rawPost);
            if (!post) continue;
            this.validateItem(post);
            posts.push(post);
          } catch {
            // Skip invalid posts instead of aborting the whole batch.
          }
        }
      }

      if (this.store && typeof this.store.storeBatch === 'function' && posts.length > 0) {
        await this.store.storeBatch(posts, { upsert: true });
      }

      const pageInfo = this.#normalizePageInfo(res?.data?.mediaData?.page_info || res?.data?.searchResults?.page_info);
      await this.#emitCheckpointAndStream({
        targetType: 'search',
        targetKey: args.query,
        cursor: pageInfo.end_cursor,
        items: posts,
        hasMore: pageInfo.has_next_page,
      });

      return { posts, pageInfo };
    }

    // SSR HTTP Search Fallback
    const searchUrl = `${this.client.baseUrl}/search?q=${encodeURIComponent(args.query)}&serp_type=${encodeURIComponent(args.searchType || 'default')}`;
    const resp = /** @type {any} */ (await this.client.request('GET', searchUrl, { accountId }));
    const html = typeof resp?.data === 'string' ? resp.data : (typeof resp === 'string' ? resp : JSON.stringify(resp?.data || ''));

    const posts = [];
    let nextCursor = null;
    const scriptMatches = [...html.matchAll(/<script type="application\/json"[^>]*>(.*?)<\/script>/gs)];
    for (const m of scriptMatches) {
      if (!m[1]) continue;
      try {
        const parsed = JSON.parse(m[1]);
        const threads = parsed?.raw_data?.searchResults?.edges ||
                        parsed?.mediaData?.threads ||
                        parsed?.data?.searchResults?.edges ||
                        [];
        const pageInfo =
          parsed?.raw_data?.searchResults?.page_info ||
          parsed?.mediaData?.page_info ||
          parsed?.data?.searchResults?.page_info ||
          null;
        if (Array.isArray(threads) && threads.length > 0) {
          for (const t of threads) {
            for (const rawPost of this.#flattenThreadItems(t)) {
              try {
                const post = this.#normalizePostItem(rawPost);
                if (!post) continue;
                this.validateItem(post);
                posts.push(post);
              } catch {
                // Skip invalid SSR posts.
              }
            }
          }
          nextCursor = pageInfo?.end_cursor || null;
          break;
        }
      } catch {}
    }

    const sliced = posts.slice(0, count);
    for (const post of sliced) {
      if (post.metadata && typeof post.metadata === 'object') {
        /** @type {Record<string, any>} */ (post.metadata).sourceMethod = 'ssr';
      }
    }

    if (this.store && typeof this.store.storeBatch === 'function' && sliced.length > 0) {
      await this.store.storeBatch(sliced, { upsert: true });
    }

    const pageInfo = nextCursor
      ? { has_next_page: true, end_cursor: nextCursor }
      : { has_next_page: false, end_cursor: null };

    await this.#emitCheckpointAndStream({
      targetType: 'search',
      targetKey: args.query,
      cursor: pageInfo.end_cursor,
      items: sliced,
      hasMore: pageInfo.has_next_page,
    });

    return {
      posts: sliced,
      pageInfo,
    };
  }

  /**
   * Search method satisfying AbstractCrawler contract while preserving pageInfo.
   * @param {Object} args
   * @param {Record<string, any>} [session={}]
   * @returns {Promise<import('../../../core/types.js').PostItem[]>}
   */
  async search(args, session = {}) {
    return /** @type {any} */ (this.searchPosts(/** @type {any} */ (args), session));
  }

  /**
   * Scrape hierarchical comment tree for a post using CommentTreeExtractor.
   * @param {Object} args
   * @param {string} args.postId
   * @param {number} [args.maxDepth=3]
   * @param {number} [args.maxComments=500]
   * @param {string} [args.after]
   * @param {Record<string, any>} [session={}]
   * @returns {Promise<{ comments: import('../../../core/types.js').CommentItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }>}
   */
  async getPostComments(args, session = {}) {
    if (!args?.postId) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing required argument: postId',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    const accountId = session?.accountId || 'threads-guest';
    const rootPostId = this.#extractPostCodeOrId(args.postId);
    const maxDepth = Math.max(0, Math.min(args.maxDepth ?? 3, 5));
    const maxComments = Math.max(1, Math.min(args.maxComments ?? 500, 2000));

    // Per-call cursor set to prevent empty/stuck-cursor infinite loops.
    const seenCursors = new Set();

    /**
     * @param {import('../comment-tree.js').FetchLayerInput} input
     * @returns {Promise<import('../comment-tree.js').FetchLayerPage>}
     */
    const fetchLayer = async ({ postId, parentCommentId, after, limit }) => {
      const isReply = parentCommentId != null;

      let docId = null;
      if (isReply) {
        docId = this.docIds.COMMENT_REPLIES;
        if (!docId) {
          throw new PlatformError({
            code: 'XACT_5000',
            type: ErrorTypes.INTERNAL,
            message: 'COMMENT_REPLIES doc_id not configured; cannot fetch reply layer',
            suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
          });
        }
      } else {
        docId = this.docIds.COMMENT_ROOTS || this.docIds.POST_DETAIL;
        if (!docId) {
          throw new PlatformError({
            code: 'XACT_5000',
            type: ErrorTypes.INTERNAL,
            message: 'Threads comment doc_id is not configured',
            suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
          });
        }
      }

      /** @type {Record<string, any>} */
      const variables = {
        postID: postId,
        post_id: postId,
        after: after || null,
        first: this.#clampCount(limit, 1, 50),
      };

      if (isReply) {
        variables.parentCommentId = parentCommentId;
        variables.parent_id = parentCommentId;
        variables.parentId = parentCommentId;
      }

      const res = await this.client.requestGraphQl(docId, variables, { accountId });

      // POST_DETAIL (BarcelonaPostPageQuery) is a flat fallback for root comments only.
      if (!isReply && docId === (this.docIds.POST_DETAIL || DEFAULT_THREADS_DOC_IDS.POST_DETAIL)) {
        const { comments, pageInfo } = this.#extractFallbackRootComments(res);
        return { comments, pageInfo: this.#normalizePageInfo(pageInfo, seenCursors) };
      }

      // Support BarcelonaPostPageQuery format and connection format.
      const topData = res?.data?.data && (res.data.data.reply_threads || res.data.data.node)
        ? res.data.data
        : res?.data;

      if (Array.isArray(topData?.reply_threads)) {
        const comments = [];
        for (const t of topData.reply_threads) {
          const items = t.thread_items || [t];
          for (const item of items) {
            if (item?.post) {
              if (isReply && parentCommentId && item.post.parentId === undefined) {
                item.post.parentId = parentCommentId;
              }
              comments.push(item.post);
            }
          }
        }
        return {
          comments,
          pageInfo: this.#normalizePageInfo({ has_next_page: false, end_cursor: null }, seenCursors),
        };
      }

      const connection = isReply
        ? (topData?.node?.replies_connection || topData?.replies_connection)
        : (topData?.node?.comment_rendering_instance_for_feed_location?.comments || topData?.comments);

      /**
       * Defensively unwrap nested `edge.node` wrappers.
       * @param {any} edge
       * @returns {any}
       */
      const unwrapNode = (edge) => {
        let n = edge?.node;
        while (
          n &&
          typeof n === 'object' &&
          n.node &&
          !Array.isArray(n.node) &&
          n.pk === undefined &&
          n.id === undefined
        ) {
          n = n.node;
        }
        return n;
      };

      const comments = (connection?.edges || []).map(unwrapNode).filter(Boolean);
      if (isReply && parentCommentId) {
        for (const raw of comments) {
          if (raw && raw.parentId === undefined) raw.parentId = parentCommentId;
        }
      }

      return {
        comments,
        pageInfo: this.#normalizePageInfo(connection?.page_info, seenCursors),
      };
    };

    const extractor = new CommentTreeExtractor(
      fetchLayer,
      (raw, pid) => this.#normalizeCommentItem(raw, pid),
      { maxDepth, maxComments, concurrency: 2 }
    );

    const { comments, pageInfo } = await extractor.fetch(rootPostId);

    if (this.store && typeof this.store.storeCommentBatch === 'function' && comments.length > 0) {
      await this.store.storeCommentBatch(comments, { upsert: true });
    }

    const normalizedPageInfo = this.#normalizePageInfo(pageInfo);
    await this.#emitCheckpointAndStream({
      targetType: 'post_comments',
      targetKey: rootPostId,
      cursor: normalizedPageInfo.end_cursor,
      items: comments,
      hasMore: normalizedPageInfo.has_next_page,
    });

    return {
      comments,
      pageInfo: normalizedPageInfo,
    };
  }

  /**
   * Abstract Crawler lifecycle methods.
   */
  async init() {}

  /**
   * @param {Object} _args
   * @returns {Promise<import('../../../core/types.js').PostItem>}
   */
  async getPostDetail(_args) {
    throw new PlatformError({
      code: 'XACT_5000',
      type: ErrorTypes.INTERNAL,
      message: 'getPostDetail is not implemented; use getPostComments or get_user_feed',
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }

  /**
   * @param {Object} _args
   * @returns {Promise<import('../../../core/types.js').CommentItem[]>}
   */
  async getComments(_args) {
    throw new PlatformError({
      code: 'XACT_5000',
      type: ErrorTypes.INTERNAL,
      message: 'getComments is not implemented; use get_post_comments',
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }

  /**
   * Cleanup crawler and client resources.
   * @returns {Promise<void>}
   */
  async cleanup() {
    if (this.client && typeof this.client.clearTokenCache === 'function') {
      this.client.clearTokenCache();
    }
  }
}
