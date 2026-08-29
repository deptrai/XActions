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
  namespacedProfileId,
  parseHumanCount,
  normalizeThreadsProfile,
  normalizeThreadsConnection,
  profileItemToPostItem,
} from './normalizer.js';
import {
  defaultRedisStreamPublisher,
  isEnvTruthy,
  toIsoDate,
} from '../../../utils/redis-stream-publisher.js';

export const DEFAULT_THREADS_DOC_IDS = {
  // Profile & Connection doc_ids (Story 15.1.1)
  PROFILE: '23996318473300828', // BarcelonaProfileRootQuery (candidate)
  FOLLOWERS: null, // BarcelonaFollowersTabQuery (capture required)
  FOLLOWING: null, // BarcelonaFollowingTabQuery (capture required)

  // Feed, Post & Comments doc_ids (Story 15.1)
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
   * @param {import('../../../utils/redis-stream-publisher.js').RedisStreamPublisher} [deps.redisPublisher]
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
    this.redisPublisher = deps.redisPublisher;
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

    this.registerAction(/** @type {any} */ ({
      action: 'post_detail',
      description: 'Scrape a single Threads post detail and optional comment tree',
      category: 'social',
      requiredArgs: ['postId'],
      optionalArgs: ['includeReplies', 'maxDepth', 'maxComments', 'after'],
      outputType: '{ post: PostItem, comments?: CommentItem[], pageInfo?: any }',
      example: { postId: 'CuZ7X9_sF9y', includeReplies: true, maxDepth: 3, maxComments: 100 },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getPostDetail(args, session),
    }));

    // ── Story 15.1.1 Actions: profile, followers, following ──
    this.registerAction(/** @type {any} */ ({
      action: 'profile',
      description: 'Fetch and normalize a Threads user profile via GraphQL or SSR fallback',
      category: 'social',
      requiredArgs: ['username'],
      optionalArgs: [],
      outputType: 'ProfileItem',
      example: { username: 'zuck' },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getProfile(args, session),
    }));

    this.registerAction(/** @type {any} */ ({
      action: 'followers',
      description: 'Fetch follower connection profiles for a Threads user with limitation fallback',
      category: 'social',
      requiredArgs: ['username'],
      optionalArgs: ['count', 'cursor'],
      outputType: '{ profiles: ProfileItem[], counts: object, note?: string }',
      example: { username: 'zuck', count: 50 },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getFollowers(args, session),
    }));

    this.registerAction(/** @type {any} */ ({
      action: 'following',
      description: 'Fetch following connection profiles for a Threads user with limitation fallback',
      category: 'social',
      requiredArgs: ['username'],
      optionalArgs: ['count', 'cursor'],
      outputType: '{ profiles: ProfileItem[], counts: object, note?: string }',
      example: { username: 'zuck', count: 50 },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getFollowing(args, session),
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
        const publisher = this.redisPublisher || (this.store && /** @type {any} */ (this.store).publisher) || defaultRedisStreamPublisher;
        if (publisher && typeof publisher.publish === 'function') {
          for (const item of items) {
            const category = 'category' in item && typeof item.category === 'string' ? item.category : 'social';
            await publisher.publish({
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
   * Find an object node in a tree that contains `value` as one of its string fields.
   * Iterative BFS to avoid stack issues; used only for exact matching, not traversal.
   * @param {any} root
   * @param {string} value
   * @param {number} [maxDepth=12]
   * @returns {any | null}
   */
  #findNodeByValue(root, value, maxDepth = 12) {
    if (!root || !value) return null;
    const queue = [{ node: root, depth: 0 }];
    const seen = new WeakSet();

    while (queue.length > 0) {
      const entry = queue.shift();
      if (!entry) continue;
      const { node, depth } = entry;
      if (depth > maxDepth) continue;
      if (!node || typeof node !== 'object') continue;
      if (seen.has(node)) continue;
      seen.add(node);

      const matchKeys = ['code', 'pk', 'id', 'shortcode'];
      if (matchKeys.some((key) => String(node[key] ?? '') === value)) {
        return node;
      }

      for (const child of Array.isArray(node) ? node : Object.values(node)) {
        if (child != null && typeof child === 'object') {
          queue.push({ node: child, depth: depth + 1 });
        }
      }
    }
    return null;
  }

  /**
   * Find the first node in a tree whose `pk` or `id` is a numeric string.
   * BFS with bounded depth to avoid picking arbitrary ids from unrelated nodes.
   * @param {any} root
   * @param {number} [maxDepth=12]
   * @returns {string | null}
   */
  #findNumericPostId(root, maxDepth = 12) {
    if (!root) return null;
    const queue = [{ node: root, depth: 0 }];
    const seen = new WeakSet();

    while (queue.length > 0) {
      const entry = queue.shift();
      if (!entry) continue;
      const { node, depth } = entry;
      if (depth > maxDepth) continue;
      if (!node || typeof node !== 'object') continue;
      if (seen.has(node)) continue;
      seen.add(node);

      const id = node.pk || node.id;
      if (id != null && /^\d+$/.test(String(id))) {
        return String(id);
      }

      for (const child of Array.isArray(node) ? node : Object.values(node)) {
        if (child != null && typeof child === 'object') {
          queue.push({ node: child, depth: depth + 1 });
        }
      }
    }
    return null;
  }

  /**
   * Convert a Threads shortcode to numeric post id.
   * Reverse base64 decoder using SHORTCODE_ALPHABET.
   * @param {string} shortcode
   * @returns {string | null}
   */
  #shortcodeToNumericId(shortcode) {
    if (!shortcode || typeof shortcode !== 'string') return null;
    if (/^\d+$/.test(shortcode)) return null; // pure numeric is not a shortcode
    if (shortcode.length < 4) return null; // too short to be a real encoded id
    let n = 0n;
    for (let i = 0; i < shortcode.length; i++) {
      const char = shortcode[i];
      const idx = SHORTCODE_ALPHABET.indexOf(char);
      if (idx === -1) return null;
      n = (n * 64n) + BigInt(idx);
    }
    return n > 0n ? n.toString() : null;
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

    this.validateItem(item);

    return item;
  }

  /**
   * Extract clean post ID or shortcode from URL or raw ID string.
   * Rejects non-Threads domains to prevent SSRF, but allows the configured baseUrl
   * (used in local tests / mock servers).
   * @param {string} input
   * @returns {{ code: string, isUrl: boolean }}
   */
  #extractPostCodeOrId(input) {
    if (!input) return { code: '', isUrl: false };
    const clean = String(input).trim();

    const urlMatch = clean.match(/^https?:\/\/(?:www\.)?threads\.net\/(?:@[^/]+\/post|t)\/([^/?#]+)/i);
    if (urlMatch && urlMatch[1]) {
      return { code: urlMatch[1], isUrl: true };
    }

    const localBase = this.client.baseUrl || '';
    if (localBase && clean.startsWith(localBase)) {
      const localMatch = clean.slice(localBase.length).match(/^\/(?:@[^/]+\/post|t)\/([^/?#]+)/i);
      if (localMatch && localMatch[1]) {
        return { code: localMatch[1], isUrl: true };
      }
    }

    return { code: clean.replace(/^threads:/, ''), isUrl: false };
  }

  /**
   * Resolve numeric Threads post ID from URL, shortcode, or raw ID.
   * @param {string} input
   * @param {string} accountId
   * @returns {Promise<string>}
   */
  async #resolvePostId(input, accountId) {
    if (!input) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing required argument: postId',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'threads',
      });
    }

    const clean = String(input).trim().replace(/^threads:/, '');
    if (!clean) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing or empty postId argument',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'threads',
      });
    }

    // 1. Direct numeric ID
    if (/^\d+$/.test(clean)) {
      return clean;
    }

    // 2. Extract code from URL or shortcode
    const { code, isUrl } = this.#extractPostCodeOrId(clean);
    if (/^\d+$/.test(code)) {
      return code;
    }

    // 3. Try mathematical decode from shortcode
    const decodedNumeric = this.#shortcodeToNumericId(code);
    if (decodedNumeric) {
      return decodedNumeric;
    }

    // 4. SSR HTML fallback via /t/<code or path>
    try {
      let fetchPath;
      if (isUrl) {
        fetchPath = clean;
      } else {
        fetchPath = `${this.client.baseUrl}/t/${encodeURIComponent(code)}`;
      }
      const resp = /** @type {any} */ (await this.client.request('GET', fetchPath, {
        accountId,
      }));

      const html = typeof resp?.data === 'string' ? resp.data : (typeof resp === 'string' ? resp : JSON.stringify(resp?.data || ''));

      if (html.includes("Sorry, this page isn't available") || html.includes('Page Not Found')) {
        throw new PlatformError({
          code: 'XACT_4041',
          type: ErrorTypes.NOT_FOUND,
          message: `Threads post ${code} not found`,
          statusCode: 404,
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
          platform: 'threads',
        });
      }

      // Parse application/json script tags or regex matches
      const scriptMatches = html.matchAll(/<script\s+type="application\/json"[^>]*>(.*?)<\/script>/gis);
      for (const sm of scriptMatches) {
        try {
          const jsonText = sm[1];
          if (jsonText.includes(code) || jsonText.includes('"pk"') || jsonText.includes('"post"')) {
            const parsed = JSON.parse(jsonText);

            // Try fast exact match first: find a node whose `code` or `pk` equals `code`.
            const matchingNode = this.#findNodeByValue(parsed, code);
            if (matchingNode?.pk || matchingNode?.id) {
              return String(matchingNode.pk || matchingNode.id);
            }

            // Fallback: find any Barcelona node with a numeric post id.
            const numericPost = this.#findNumericPostId(parsed);
            if (numericPost) return numericPost;
          }
        } catch {}
      }

      // Contextual regex fallback: require a nearby post marker so we don't grab
      // a random user / thread / media id.
      const postIdMatch = html.match(/"post_id"\s*:\s*"(\d+)"/);
      if (postIdMatch && postIdMatch[1]) {
        return postIdMatch[1];
      }

      const pkMatch = html.match(/"pk"\s*:\s*"(\d+)"/);
      if (pkMatch && pkMatch[1]) {
        return pkMatch[1];
      }
    } catch (err) {
      const anyErr = /** @type {any} */ (err);
      if (anyErr?.statusCode === 404 || anyErr?.code === 'XACT_4041') {
        throw new PlatformError({
          code: 'XACT_4041',
          type: ErrorTypes.NOT_FOUND,
          message: `Threads post ${code} not found`,
          statusCode: 404,
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
          platform: 'threads',
        });
      }
      throw err;
    }

    throw new PlatformError({
      code: 'XACT_4041',
      type: ErrorTypes.NOT_FOUND,
      message: `Threads post ${code} could not be resolved to a numeric ID`,
      statusCode: 404,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: 'threads',
    });
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
      try {
        const res = await this.client.requestGraphQl(this.docIds.SEARCH_POSTS, {
          query: args.query,
          first: count,
          after: args.cursor || null,
          serp_type: args.searchType || 'default',
        }, { accountId });

        const rawThreads = res?.data?.searchResults?.threads ||
                          res?.data?.searchResults?.edges ||
                          res?.data?.mediaData?.threads ||
                          res?.data?.edges ||
                          [];
        const posts = [];
        for (const t of rawThreads) {
          for (const rawPost of this.#flattenThreadItems(t)) {
            try {
              const post = this.#normalizePostItem(rawPost);
              if (!post) continue;
              if (post.metadata && typeof post.metadata === 'object') {
                /** @type {Record<string, any>} */ (post.metadata).sourceMethod = 'graphql';
              }
              this.validateItem(post);
              posts.push(post);
            } catch {
              // Skip invalid posts instead of aborting the whole batch.
            }
          }
        }

        const pageInfo = this.#normalizePageInfo(res?.data?.searchResults?.page_info || res?.data?.mediaData?.page_info);
        if (posts.length > 0) {
          if (this.store && typeof this.store.storeBatch === 'function') {
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
      } catch (err) {
        console.warn(`⚠️ [THREADS] GraphQL search failed, falling back to SSR: ${err instanceof Error ? err.message : String(err)}`);
      }
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
                        parsed?.raw_data?.searchResults?.threads ||
                        parsed?.mediaData?.threads ||
                        parsed?.data?.searchResults?.edges ||
                        parsed?.data?.searchResults?.threads ||
                        parsed?.searchResults?.threads ||
                        parsed?.searchResults?.edges ||
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
    const rootPostId = await this.#resolvePostId(args.postId, accountId);
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
   * Scrape a single Threads post detail and optional comment tree.
   * @param {Object} args
   * @param {string} args.postId
   * @param {boolean} [args.includeReplies=false]
   * @param {number} [args.maxDepth=3]
   * @param {number} [args.maxComments=500]
   * @param {string} [args.after]
   * @param {Record<string, any>} [session={}]
   * @returns {Promise<{ post: import('../../../core/types.js').PostItem, comments?: import('../../../core/types.js').CommentItem[], pageInfo?: any }>}
   */
  async getPostDetail(args, session = {}) {
    if (!args?.postId) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing required argument: postId',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'threads',
      });
    }

    const accountId = session?.accountId || 'threads-guest';
    const numericPostId = await this.#resolvePostId(args.postId, accountId);

    const docId = this.docIds.POST_DETAIL || DEFAULT_THREADS_DOC_IDS.POST_DETAIL;
    if (!docId) {
      throw new PlatformError({
        code: 'XACT_5000',
        type: ErrorTypes.INTERNAL,
        message: 'POST_DETAIL doc_id is not configured',
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform: 'threads',
      });
    }

    const res = await this.client.requestGraphQl(
      docId,
      { postID: numericPostId, post_id: numericPostId },
      { accountId }
    );

    const topData = res?.data?.data && typeof res.data.data === 'object'
      ? res.data.data
      : res?.data;

    let rootRawPost = null;

    // 1. Search containing_thread
    const containingItems = topData?.containing_thread?.thread_items || [];
    for (const item of containingItems) {
      const p = item?.post || item;
      if (p && (String(p.pk || p.id) === numericPostId || p.code === args.postId)) {
        rootRawPost = p;
        break;
      }
    }

    // 2. Search reply_threads if not found in containing_thread
    if (!rootRawPost && Array.isArray(topData?.reply_threads)) {
      for (const t of topData.reply_threads) {
        const items = t.thread_items || [t];
        for (const item of items) {
          const p = item?.post || item;
          if (p && (String(p.pk || p.id) === numericPostId || p.code === args.postId)) {
            rootRawPost = p;
            break;
          }
        }
        if (rootRawPost) break;
      }
    }

    if (!rootRawPost) {
      throw new PlatformError({
        code: 'XACT_4041',
        type: ErrorTypes.NOT_FOUND,
        message: `Threads post ${args.postId} not found in GraphQL response`,
        statusCode: 404,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'threads',
      });
    }

    const post = this.#normalizePostItem(rootRawPost);
    if (!post) {
      throw new PlatformError({
        code: 'XACT_5000',
        type: ErrorTypes.INTERNAL,
        message: `Failed to normalize Threads post ${args.postId}`,
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform: 'threads',
      });
    }

    this.validateItem(post);

    if (post.metadata && typeof post.metadata === 'object') {
      /** @type {Record<string, any>} */ (post.metadata).sourceMethod = 'post_detail';
    }

    // Persist root post
    if (this.store && typeof this.store.storeBatch === 'function') {
      await this.store.storeBatch([post], { upsert: true });
    }

    // Checkpoint & thin event for root post
    await this.#emitCheckpointAndStream({
      targetType: 'post_detail',
      targetKey: numericPostId,
      items: [post],
      hasMore: false,
    });

    /** @type {{ post: import('../../../core/types.js').PostItem, comments?: import('../../../core/types.js').CommentItem[], pageInfo?: any }} */
    const result = { post };

    // 4. Optional reply tree
    if (args.includeReplies) {
      let maxDepth = Math.max(0, Math.min(args.maxDepth ?? 3, 5));
      if (!this.docIds.COMMENT_REPLIES && maxDepth > 0) {
        console.warn('⚠️ [THREADS] Nested replies deferred to Story 15.1.3; limiting to root-level comments.');
        maxDepth = 0;
      }

      if (!this.docIds.COMMENT_REPLIES && this.docIds.COMMENT_ROOTS) {
        // maxDepth 0 still fetches root-level comments via the root comment doc_id.
      } else if (!this.docIds.COMMENT_REPLIES && !this.docIds.COMMENT_ROOTS && !this.docIds.POST_DETAIL) {
        console.warn('⚠️ [THREADS] No comment doc_ids configured; comments unavailable in this environment.');
        result.comments = [];
        result.pageInfo = { has_next_page: false, end_cursor: null };
        return result;
      }

      const commentsResult = await this.getPostComments(
        {
          postId: numericPostId,
          maxDepth,
          maxComments: args.maxComments,
          after: args.after,
        },
        session
      );

      result.comments = commentsResult.comments;
      result.pageInfo = commentsResult.pageInfo;
    }

    return result;
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
   * Decode common HTML entities in meta tag content.
   * @param {string} str
   * @returns {string}
   */
  #decodeHtmlEntities(str) {
    if (typeof str !== 'string') return String(str);
    return str
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
  }

  /**
   * Scrape a Threads user profile.
   * Tries GraphQL first if docIds.PROFILE is configured, otherwise falls back to HTML SSR parsing.
   * @param {Object} args
   * @param {string} args.username
   * @param {Record<string, any>} [session={}]
   * @returns {Promise<Record<string, any>>} Normalized ProfileItem
   */
  async getProfile(args, session = {}) {
    if (!args?.username) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing required argument: username',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'threads',
      });
    }

    const username = String(args.username).replace(/^@/, '').trim();
    if (!username) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing or empty username argument',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'threads',
      });
    }
    const accountId = session?.accountId || 'threads-guest';
    let profile = null;

    // 1. Try GraphQL if docIds.PROFILE is available
    if (this.docIds.PROFILE) {
      try {
        const userId = await this.#resolveUserId(username, accountId);
        const res = await this.client.requestGraphQl(
          this.docIds.PROFILE,
          { userID: userId, username },
          { accountId }
        );

        const rawUser = res?.data?.userData?.user || res?.data?.user || res?.data?.node;
        if (rawUser) {
          profile = normalizeThreadsProfile(rawUser, 'graphql');
        }
      } catch (err) {
        // 404 is final; other errors (rate limit, network, 5xx) allow SSR fallback
        const anyErr = /** @type {any} */ (err);
        if (anyErr?.statusCode === 404 || anyErr?.code === 'XACT_4041') {
          throw err;
        }
      }
    }

    // 2. SSR Fallback if GraphQL was not configured or returned null
    if (!profile) {
      profile = await this.#fetchProfileSsr(username, accountId);
    }

    // 3. Persist as PostItem to store
    if (this.store && typeof this.store.storeBatch === 'function') {
      const postItem = profileItemToPostItem(profile);
      await this.store.storeBatch([postItem], { upsert: true });
    }

    // 4. Save Checkpoint & emit thin event
    await this.#emitProfileCheckpointAndStream([profile], 'profile', username, null, 'completed');

    return profile;
  }

  /**
   * SSR HTML fallback parser for Threads profile page.
   * @param {string} username
   * @param {string} accountId
   * @returns {Promise<Record<string, any>>}
   */
  async #fetchProfileSsr(username, accountId) {
    const cleanUser = username.replace(/^@/, '').trim();
    let resp;
    try {
      resp = /** @type {any} */ (await this.client.request('GET', `${this.client.baseUrl}/@${cleanUser}`, {
        accountId,
      }));
    } catch (err) {
      const anyErr = /** @type {any} */ (err);
      const status = anyErr?.statusCode || anyErr?.status;
      if (status === 404 || anyErr?.code === 'XACT_4041') {
        throw new PlatformError({
          code: 'XACT_4041',
          type: ErrorTypes.INTERNAL,
          message: `Threads user @${cleanUser} not found`,
          statusCode: 404,
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
          platform: 'threads',
        });
      }
      throw err;
    }

    const html = typeof resp?.data === 'string' ? resp.data : (typeof resp === 'string' ? resp : JSON.stringify(resp?.data || ''));

    if (html.includes("Sorry, this page isn't available") || html.includes('Page Not Found')) {
      throw new PlatformError({
        code: 'XACT_4041',
        type: ErrorTypes.INTERNAL,
        message: `Threads user @${cleanUser} not found`,
        statusCode: 404,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'threads',
      });
    }

    const titleMatch = html.match(/<meta\s+[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
    const descMatch = html.match(/<meta\s+[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']/i);
    const imageMatch = html.match(/<meta\s+[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);

    const title = titleMatch ? this.#decodeHtmlEntities(titleMatch[1]) : '';
    const desc = descMatch ? this.#decodeHtmlEntities(descMatch[1]) : '';
    const avatar = imageMatch ? imageMatch[1] : null;

    const userInTitleMatch = title.match(/@([a-zA-Z0-9._]+)/);
    const usernameFromTitle = userInTitleMatch ? userInTitleMatch[1] : cleanUser;

    const nameMatch = title.match(/^(.+?)\s*\(/);
    const name = nameMatch ? nameMatch[1].trim() : usernameFromTitle;

    const followerMatch = desc.match(/([\d.,]+[KkMmBb]?)\s*followers?/i);
    const followersCount = followerMatch ? parseHumanCount(followerMatch[1]) : 0;

    const followingMatch = desc.match(/([\d.,]+[KkMmBb]?)\s*following?/i);
    const followingCount = followingMatch ? parseHumanCount(followingMatch[1]) : 0;

    let bio = desc;
    const countPrefix = followerMatch && followingMatch
      ? `${followerMatch[0]}, ${followingMatch[0]}`
      : (followerMatch ? followerMatch[0] : (followingMatch ? followingMatch[0] : ''));
    if (countPrefix) {
      bio = desc.replace(countPrefix, '').replace(/^[.,\s]+/, '').trim();
    }

    const idMatch =
      html.match(/window\.__user_id\s*=\s*"([^"]+)"/) ||
      html.match(/window\.__userId\s*=\s*"([^"]+)"/) ||
      html.match(/"user_id":"(\d+)"/) ||
      html.match(/"pk":"(\d+)"/);
    const userId = idMatch ? idMatch[1] : usernameFromTitle;

    return {
      id: namespacedProfileId(userId),
      platform: 'threads',
      externalId: userId,
      name,
      username: usernameFromTitle,
      bio,
      avatar,
      profileUrl: `https://www.threads.net/@${usernameFromTitle}`,
      followersCount,
      followingCount,
      metadata: {
        isProfile: true,
        isFollower: false,
        isFollowing: false,
        sourceMethod: 'ssr',
        isVerified: false,
        userId,
        username: usernameFromTitle,
        followersCount,
        followingCount: 0,
      },
    };
  }

  /**
   * Scrape followers of a Threads account.
   * @param {Object} args
   * @param {string} args.username
   * @param {number} [args.count=20]
   * @param {string} [args.cursor]
   * @param {Record<string, any>} [session={}]
   * @returns {Promise<{ profiles: Record<string, any>[], counts: { followersCount: number, followingCount: number }, note?: string, pageInfo?: any }>}
   */
  async getFollowers(args, session = {}) {
    return this.#fetchConnections(args, session, 'follower');
  }

  /**
   * Scrape following of a Threads account.
   * @param {Object} args
   * @param {string} args.username
   * @param {number} [args.count=20]
   * @param {string} [args.cursor]
   * @param {Record<string, any>} [session={}]
   * @returns {Promise<{ profiles: Record<string, any>[], counts: { followersCount: number, followingCount: number }, note?: string, pageInfo?: any }>}
   */
  async getFollowing(args, session = {}) {
    return this.#fetchConnections(args, session, 'following');
  }

  /**
   * Internal connection scraper for followers and following.
   * @param {Record<string, any>} args
   * @param {Record<string, any>} session
   * @param {'follower' | 'following'} connectionType
   * @returns {Promise<{ profiles: Record<string, any>[], counts: { followersCount: number, followingCount: number }, note?: string, pageInfo?: any }>}
   */
  async #fetchConnections(args, session, connectionType) {
    if (!args?.username) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing required argument: username',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'threads',
      });
    }

    const username = String(args.username).replace(/^@/, '').trim();
    if (!username) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing or empty username argument',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'threads',
      });
    }

    const accountId = session?.accountId || 'threads-guest';
    const userId = await this.#resolveUserId(username, accountId);

    const docIdKey = connectionType === 'follower' ? 'FOLLOWERS' : 'FOLLOWING';
    const docId = this.docIds[docIdKey];

    const profiles = [];
    let counts = { followersCount: 0, followingCount: 0 };
    let note;
    let pageInfo = { has_next_page: false, end_cursor: null };

    if (!docId) {
      note = `${docIdKey} doc_id is not configured; returning SSR-fallback counts only`;

      const profile = await this.#fetchProfileSsr(username, accountId);
      counts = {
        followersCount: profile.followersCount ?? 0,
        followingCount: profile.followingCount ?? 0,
      };

      // Persist the seed profile so callers have some data
      if (this.store && typeof this.store.storeBatch === 'function') {
        const postItem = profileItemToPostItem(profile);
        await this.store.storeBatch([postItem], { upsert: true });
      }

      await this.#emitProfileCheckpointAndStream(
        [profile],
        connectionType,
        username,
        pageInfo.end_cursor,
        'completed'
      );

      return {
        profiles: [profile],
        counts,
        note,
        pageInfo,
      };
    }

    // Fetch profile counts first for accurate totals
    try {
      const profile = this.docIds.PROFILE
        ? await this.getProfile({ username }, session)
        : await this.#fetchProfileSsr(username, accountId);
      counts = {
        followersCount: profile.followersCount ?? 0,
        followingCount: profile.followingCount ?? 0,
      };

      // Persist the seed profile
      if (this.store && typeof this.store.storeBatch === 'function') {
        const postItem = profileItemToPostItem(profile);
        await this.store.storeBatch([postItem], { upsert: true });
      }
    } catch (err) {
      // SSR/GraphQL may fail for private/suspended accounts; keep counts zero
      counts = { followersCount: 0, followingCount: 0 };
    }

    const targetCount = this.#clampCount(args.count, 1, 100);
    let after = args.cursor || null;
    let fetched = 0;
    let hasMore = true;

    // Loop to satisfy count across multiple GraphQL pages
    while (fetched < targetCount && hasMore) {
      const pageSize = Math.min(targetCount - fetched, 50);
      const variables = {
        userID: userId,
        username,
        first: pageSize,
        after,
      };

      const res = await this.client.requestGraphQl(docId, variables, { accountId });

      const connection =
        res?.data?.node?.[`${connectionType === 'follower' ? 'followers' : 'following'}_connection`] ||
        res?.data?.userData?.user?.[`${connectionType === 'follower' ? 'followers' : 'following'}_connection`] ||
        res?.data?.[connectionType === 'follower' ? 'followers_connection' : 'following_connection'];

      const edges = Array.isArray(connection?.edges) ? connection.edges : [];
      const nodes = Array.isArray(connection?.nodes) ? connection.nodes : [];
      const rawItems = edges.length ? edges : nodes;

      // If GraphQL returns an empty/null connection, switch to limitation fallback
      if (!connection || rawItems.length === 0) {
        note = 'Threads does not expose public follower/following lists; returned counts only.';

        const profile = this.docIds.PROFILE
          ? await this.getProfile({ username }, session)
          : await this.#fetchProfileSsr(username, accountId);
        counts = {
          followersCount: profile.followersCount ?? 0,
          followingCount: profile.followingCount ?? 0,
        };

        if (this.store && typeof this.store.storeBatch === 'function') {
          const postItem = profileItemToPostItem(profile);
          await this.store.storeBatch([postItem], { upsert: true });
        }

        await this.#emitProfileCheckpointAndStream(
          [profile],
          connectionType,
          username,
          null,
          'completed'
        );

        return { profiles: [], counts, note, pageInfo: { has_next_page: false, end_cursor: null } };
      }

      for (const raw of rawItems) {
        const node = raw?.node || raw;
        const profile = normalizeThreadsConnection(node, 'graphql', connectionType);

        if (this.store && typeof this.store.storeBatch === 'function') {
          const postItem = profileItemToPostItem(profile);
          await this.store.storeBatch([postItem], { upsert: true });
        }

        profiles.push(profile);
      }

      fetched += rawItems.length;
      pageInfo = {
        has_next_page: Boolean(connection?.page_info?.has_next_page || connection?.pageInfo?.has_next_page),
        end_cursor: connection?.page_info?.end_cursor || connection?.pageInfo?.end_cursor || null,
      };
      after = pageInfo.end_cursor;
      hasMore = pageInfo.has_next_page && Boolean(after);

      if (!hasMore) break;
    }

    await this.#emitProfileCheckpointAndStream(profiles, connectionType, username, after);

    return { profiles, counts, pageInfo };
  }

  /**
   * Emit checkpoint and Redis stream pointer for profile / connection actions.
   * @param {Record<string, any>[]} items
   * @param {string} targetType
   * @param {string} targetKey
   * @param {string | null} [cursor]
   * @param {string} [status='running']
   */
  async #emitProfileCheckpointAndStream(items, targetType, targetKey, cursor, status = 'running') {
    try {
      const storeWithCheckpoint = /** @type {any} */ (this.store);
      if (storeWithCheckpoint && typeof storeWithCheckpoint.saveCheckpoint === 'function') {
        const storageRef = items[0]?.id || items[0]?.externalId || '';
        await storeWithCheckpoint.saveCheckpoint({
          platform: 'threads',
          action: targetType,
          targetType,
          targetKey,
          cursor,
          status,
          itemsCount: items.length,
          storageRef,
          completedAt: status === 'completed' ? toIsoDate(new Date()) : null,
        });
      }

      if (items.length > 0 && isEnvTruthy(process.env.REDIS_STREAM_ENABLED)) {
        const publisher = this.redisPublisher || (this.store && /** @type {any} */ (this.store).publisher) || defaultRedisStreamPublisher;
        if (publisher && typeof publisher.publish === 'function') {
          for (const item of items) {
            const postItem = profileItemToPostItem(item);
            await publisher.publish({
              id: postItem.id,
              platform: 'threads',
              externalId: postItem.externalId,
              category: 'social',
              authorId: postItem.authorId,
              crawledAt: toIsoDate(postItem.crawledAt),
              storageRef: postItem.id,
            });
          }
        }
      }
    } catch {}
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
