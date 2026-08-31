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
  SEARCH_POSTS: '1314198888521447147', // BarcelonaSearchPostsQuery (candidate — capture required)
  COMMENT_ROOTS: '1343493212639512438', // root comments query (candidate — capture required)
  COMMENT_REPLIES: '1377060551033072606', // nested reply comments query (candidate — capture required)
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

    // ── Story 15.1.2 Action: post_detail ──
    this.registerAction(/** @type {any} */ ({
      action: 'post_detail',
      description: 'Scrape thread post detail and optional comment tree',
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
   * Convert a Threads shortcode back to a numeric post id.
   * Reverse of #numericIdToShortcode.
   * @param {string} shortcode
   * @returns {string | null}
   */
  #shortcodeToNumericId(shortcode) {
    if (!shortcode || typeof shortcode !== 'string') return null;
    const clean = shortcode.trim();
    let n = 0n;
    for (let i = 0; i < clean.length; i++) {
      const char = clean[i];
      const idx = SHORTCODE_ALPHABET.indexOf(char);
      if (idx === -1) return null;
      n = n * 64n + BigInt(idx);
    }
    return n.toString();
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
   * Resolve any post ID, shortcode, or URL to a canonical numeric post ID.
   * @param {string} input
   * @param {string} [accountId='threads-guest']
   * @param {string | Record<string, string>} [cookies='']
   * @returns {Promise<string>}
   */
  async #resolvePostId(input, accountId = 'threads-guest', cookies = '') {
    if (!input || typeof input !== 'string') {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing or invalid postId',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'threads',
      });
    }

    // SSRF guard for absolute URLs
    if (/^https?:\/\//i.test(input)) {
      try {
        const parsed = new URL(input);
        const host = parsed.hostname.toLowerCase();
        const baseHost = new URL(this.client.baseUrl).hostname.toLowerCase();
        if (host !== baseHost && host !== 'threads.net' && !host.endsWith('.threads.net')) {
          throw new PlatformError({
            code: 'XACT_4001',
            type: ErrorTypes.INVALID_ARGS,
            message: 'postId URL must be a threads.net URL',
            suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
            platform: 'threads',
          });
        }
      } catch (err) {
        if (err instanceof PlatformError) throw err;
        throw new PlatformError({
          code: 'XACT_4001',
          type: ErrorTypes.INVALID_ARGS,
          message: 'Invalid postId URL',
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
          platform: 'threads',
        });
      }
    }

    const clean = input.trim();
    if (/^\d+$/.test(clean)) {
      return clean;
    }

    const extracted = this.#extractPostCodeOrId(clean);
    if (/^\d+$/.test(extracted)) {
      return extracted;
    }

    // Try decoding base64 shortcode to numeric ID
    const decoded = this.#shortcodeToNumericId(extracted);
    if (decoded && decoded !== '0') {
      return decoded;
    }

    // SSR fallback: fetch post page and parse embedded JSON
    const targetUrl = clean.startsWith('http://') || clean.startsWith('https://')
      ? clean
      : `${this.client.baseUrl}/t/${extracted}`;

    try {
      const resp = /** @type {any} */ (await this.client.request('GET', targetUrl, {
        accountId,
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        },
        cookies,
      }));

      const html = typeof resp?.data === 'string' ? resp.data : (typeof resp === 'string' ? resp : JSON.stringify(resp?.data || ''));

      // Check for post ID in script tags
      const scriptRegex = /<script\s+type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi;
      let match;
      while ((match = scriptRegex.exec(html)) !== null) {
        try {
          const json = JSON.parse(match[1]);
          /**
           * @param {any} obj
           * @returns {string | null}
           */
          const findPostPk = (obj) => {
            if (!obj || typeof obj !== 'object') return null;
            if (extracted && obj.code === extracted && (obj.pk || obj.id)) {
              return String(obj.pk || obj.id);
            }
            if (extracted && obj.post && obj.post.code === extracted && (obj.post.pk || obj.post.id)) {
              return String(obj.post.pk || obj.post.id);
            }
            for (const key of Object.keys(obj)) {
              if (typeof obj[key] === 'object') {
                const found = findPostPk(obj[key]);
                if (found) return found;
              }
            }
            return null;
          };

          const pk = findPostPk(json);
          if (pk && /^\d+$/.test(pk)) {
            return pk;
          }
        } catch {}
      }

      // Check regex patterns in HTML
      const pkMatch = html.match(/"post_id":"(\d+)"/) ||
                      html.match(/"pk":"(\d+)"/) ||
                      html.match(/threads:\/\/post\?id=(\d+)/);
      if (pkMatch && pkMatch[1]) {
        return pkMatch[1];
      }
    } catch (err) {
      if (err instanceof PlatformError) throw err;
    }

    throw new PlatformError({
      code: 'XACT_4041',
      type: ErrorTypes.INVALID_ARGS,
      message: `Post not found: ${input}`,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: 'threads',
      accountId,
    });
  }

  /**
   * Extract every inline `application/json` script payload from an HTML string.
   * @param {string} html
   * @yields {any}
   */
  *#parseSsrJsonScripts(html) {
    const scriptRegex = /<script\s+type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = scriptRegex.exec(html)) !== null) {
      try {
        yield JSON.parse(match[1]);
      } catch {}
    }
  }

  /**
   * Recursively walk a Meta SSR `require` tree and extract every `result.data`
   * payload found inside `__bbox` blocks (RelayPrefetchedStreamCache, etc.).
   * @param {any} node
   * @returns {Generator<Record<string, any>, void, unknown>}
   */
  *#walkBboxForData(node) {
    if (!node || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      for (const item of node) {
        yield* this.#walkBboxForData(item);
      }
      return;
    }

    const record = /** @type {Record<string, any>} */ (node);

    if (record.__bbox && typeof record.__bbox === 'object') {
      const bbox = record.__bbox;
      if (bbox.result && typeof bbox.result === 'object' && bbox.result.data) {
        yield bbox.result.data;
      }
      if (Array.isArray(bbox.require)) {
        for (const r of bbox.require) {
          yield* this.#walkBboxForData(r);
        }
      }
      if (Array.isArray(bbox.define)) {
        for (const d of bbox.define) {
          if (Array.isArray(d)) {
            for (const entry of d) {
              if (entry && typeof entry === 'object') yield* this.#walkBboxForData(entry);
            }
          }
        }
      }
    }

    if (Array.isArray(record.require)) {
      for (const r of record.require) {
        yield* this.#walkBboxForData(r);
      }
    }

    for (const key of Object.keys(record)) {
      if (key !== '__bbox' && key !== 'require') {
        const val = record[key];
        if (val && typeof val === 'object') {
          yield* this.#walkBboxForData(val);
        }
      }
    }
  }

  /**
   * Fetch a single post page and extract the embedded post payload (SSR fallback).
   * Meta serves the BarcelonaPostPageQuery as a dehydrated Relay JSON script with
   * `__bbox.result.data`. We collect all data payloads and prefer the node whose
   * `pk` matches the requested numeric post id or whose `code` matches the shortcode.
   * @param {string} input
   * @param {string} numericPostId
   * @param {string} accountId
   * @param {string | Record<string, string>} [cookies='']
   * @returns {Promise<Record<string, any> | null>}
   */
  async #fetchPostDetailSsr(input, numericPostId, accountId, cookies = '') {
    const extracted = this.#extractPostCodeOrId(input);
    const shortcode = /^\d+$/.test(extracted) ? this.#numericIdToShortcode(BigInt(extracted)) : extracted;
    if (!shortcode) return null;

    const targetUrl = input.startsWith('http://') || input.startsWith('https://')
      ? input
      : `${this.client.baseUrl}/t/${shortcode}`;

    try {
      const resp = /** @type {any} */ (await this.client.request('GET', targetUrl, {
        accountId,
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        },
        cookies,
      }));

      const html = typeof resp?.data === 'string' ? resp.data : (typeof resp === 'string' ? resp : JSON.stringify(resp?.data || ''));

      for (const parsed of this.#parseSsrJsonScripts(html)) {
        for (const data of this.#walkBboxForData(parsed)) {
          const found = this.#findPostNode(data, numericPostId, shortcode);
          if (found) return found;
        }
      }
    } catch (err) {
      if (err instanceof PlatformError) throw err;
    }

    return null;
  }

  /**
   * Recursively locate a post object in a parsed SSR payload.
   * @param {any} obj
   * @param {string} numericPostId
   * @param {string} shortcode
   * @returns {Record<string, any> | null}
   */
  #findPostNode(obj, numericPostId, shortcode) {
    if (!obj || typeof obj !== 'object') return null;

    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = this.#findPostNode(item, numericPostId, shortcode);
        if (found) return found;
      }
      return null;
    }

    const direct = /** @type {Record<string, any>} */ (obj);
    const pk = String(direct.pk ?? direct.id ?? '');
    const code = String(direct.code ?? direct.shortcode ?? '');

    // A Threads post object has `pk` and `text_post_app_info` or `caption`.
    if ((pk === numericPostId || code === shortcode) && (direct.pk || direct.id)) {
      if (direct.text_post_app_info || direct.caption || direct.user) {
        return direct;
      }
    }

    // Post is often wrapped in `thread_items[0].post` inside a `text_post_app_thread`.
    if (direct.thread_items && Array.isArray(direct.thread_items)) {
      for (const item of direct.thread_items) {
        const post = item?.post;
        if (post) {
          const postPk = String(post.pk ?? post.id ?? '');
          const postCode = String(post.code ?? post.shortcode ?? '');
          if ((postPk === numericPostId || postCode === shortcode) && (post.pk || post.id)) {
            return post;
          }
        }
      }
    }

    for (const key of Object.keys(direct)) {
      const found = this.#findPostNode(direct[key], numericPostId, shortcode);
      if (found) return found;
    }

    return null;
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
   * Extract root comments from a post SSR payload (the raw post object found by
   * #findPostNode).  Relies on `reply_threads` or `comments` arrays inside the
   * post, matching the structure returned by Meta's dehydrated HTML payloads.
   * @param {Record<string, any>} post
   * @param {number} limit
   * @returns {{ comments: Record<string, any>[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }}
   */
  #extractSsrRootComments(post, limit) {
    /** @type {Record<string, any>[]} */
    const comments = [];
    const seen = new Set();

    const push = (/** @type {Record<string, any> | undefined} */ item) => {
      if (!item || typeof item !== 'object') return;
      const p = item.post || item;
      const key = p.id || p.pk;
      if (key && seen.has(key)) return;
      if (key) seen.add(key);
      comments.push(p);
    };

    const topReplyThreads = post?.reply_threads;
    if (Array.isArray(topReplyThreads)) {
      for (const thread of topReplyThreads) {
        const items = thread?.thread_items || thread?.items || [thread];
        for (const item of items) {
          push(item);
        }
      }
    }

    const topComments = post?.comments;
    if (topComments && typeof topComments === 'object') {
      const list = Array.isArray(topComments.items)
        ? topComments.items
        : (Array.isArray(topComments.edges) ? topComments.edges : (Array.isArray(topComments) ? topComments : []));
      for (const item of list) {
        if (item?.post) {
          push(item.post);
        } else if (item?.node) {
          push(item.node);
        } else if (item) {
          push(item);
        }
      }
    }

    const limited = comments.slice(0, limit);
    return { comments: limited, pageInfo: { has_next_page: false, end_cursor: null } };
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
    const cookies = session?.cookies || '';
    const count = this.#clampCount(args.count, 1, 100);

    if (this.docIds.SEARCH_POSTS) {
      try {
        const res = await this.client.requestGraphQl(this.docIds.SEARCH_POSTS, {
          query: args.query,
          first: count,
          after: args.cursor || null,
          serp_type: args.searchType || 'default',
        }, { accountId, cookies });

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
      } catch (err) {
        console.warn(`⚠️ [THREADS] GraphQL search failed, falling back to SSR: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // SSR HTTP Search Fallback
    const searchUrl = `${this.client.baseUrl}/search?q=${encodeURIComponent(args.query)}&serp_type=${encodeURIComponent(args.searchType || 'default')}`;
    const resp = /** @type {any} */ (await this.client.request('GET', searchUrl, { accountId, cookies }));
    const html = typeof resp?.data === 'string' ? resp.data : (typeof resp === 'string' ? resp : JSON.stringify(resp?.data || ''));

    const posts = [];
    let nextCursor = null;
    /** @type {any} */
    let ssrPageInfo = null;

    // First try the new Relay/SSR `__bbox` dehydrated script format.
    for (const parsed of this.#parseSsrJsonScripts(html)) {
      for (const data of this.#walkBboxForData(parsed)) {
        const searchResults = data?.searchResults;
        if (!searchResults || typeof searchResults !== 'object') continue;
        const edges = Array.isArray(searchResults.edges)
          ? searchResults.edges
          : (Array.isArray(searchResults.threads) ? searchResults.threads : []);
        if (edges.length > 0) {
          for (const edge of edges) {
            const node = edge?.node || edge;
            const thread = node?.thread || node?.text_post_app_thread || node;
            for (const rawPost of this.#flattenThreadItems(thread)) {
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
          ssrPageInfo = searchResults.page_info || null;
          nextCursor = ssrPageInfo?.end_cursor || null;
          if (posts.length > 0) break;
        }
      }
      if (posts.length > 0) break;
    }

    // Legacy direct script fallback.
    if (posts.length === 0) {
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
            parsed?.searchResults?.page_info ||
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
            ssrPageInfo = pageInfo;
            break;
          }
        } catch {}
      }
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

    const pageInfo = this.#normalizePageInfo(ssrPageInfo);

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
    const cookies = session?.cookies || '';
    const rootPostId = await this.#resolvePostId(args.postId, accountId, cookies);
    const requestedDepth = Math.max(0, Math.min(args.maxDepth ?? 3, 5));
    const maxComments = Math.max(1, Math.min(args.maxComments ?? 500, 2000));

    // Clamp depth when reply doc_id is not available; this matches the graceful
    // degradation contract in AC-3/AC-4 so callers never crash on missing replies.
    const maxDepth = this.docIds.COMMENT_REPLIES ? requestedDepth : 0;
    if (!this.docIds.COMMENT_REPLIES && requestedDepth > 0) {
      console.warn('⚠️ [THREADS] COMMENT_REPLIES doc_id not configured; clamping maxDepth to 0.');
    }

    const rootPostSsr = !this.docIds.COMMENT_ROOTS && !this.docIds.POST_DETAIL
      ? await this.#fetchPostDetailSsr(args.postId, rootPostId, accountId, cookies)
      : null;

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
          console.warn('⚠️ [THREADS] COMMENT_REPLIES doc_id not configured; skipping reply layer.');
          return { comments: [], pageInfo: { has_next_page: false, end_cursor: null }, note: 'COMMENT_REPLIES not configured; reply layer skipped.' };
        }
      } else {
        docId = this.docIds.COMMENT_ROOTS || this.docIds.POST_DETAIL;
        if (!docId) {
          // SSR-only: extract top-level replies from the pre-fetched post page payload.
          if (rootPostSsr) {
            const { comments, pageInfo } = this.#extractSsrRootComments(rootPostSsr, this.#clampCount(limit, 1, 50));
            return {
              comments,
              pageInfo: this.#normalizePageInfo(pageInfo, seenCursors),
              note: 'SSR-only mode; using post page reply threads.',
            };
          }
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

      /**
       * Execute a GraphQL request and, for root-level failures, fall back to
       * POST_DETAIL once. This preserves the AC-4 graceful-degradation contract
       * without mutating `this.docIds` or looping on the same failing doc_id.
       * @param {string} docId
       * @returns {Promise<any>}
       */
      const doGraphQl = async (docId) => {
        try {
          return await this.client.requestGraphQl(docId, variables, { accountId, cookies });
        } catch (err) {
          if (!isReply && docId !== this.docIds.POST_DETAIL && this.docIds.POST_DETAIL) {
            console.warn('⚠️ [THREADS] COMMENT_ROOTS GraphQL failed; falling back to POST_DETAIL.');
            return this.client.requestGraphQl(this.docIds.POST_DETAIL, variables, { accountId, cookies });
          }
          throw err;
        }
      };

      try {
        const res = await doGraphQl(docId);

        // POST_DETAIL (BarcelonaPostPageQuery) is a flat fallback for root comments only.
        if (!isReply && docId === (this.docIds.POST_DETAIL || DEFAULT_THREADS_DOC_IDS.POST_DETAIL)) {
          const { comments, pageInfo } = this.#extractFallbackRootComments(res);
          return {
            comments,
            pageInfo: this.#normalizePageInfo(pageInfo, seenCursors),
            note: 'Using POST_DETAIL fallback; only root-level comments returned.',
          };
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
      } catch (err) {
        if (isReply) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`⚠️ [THREADS] GraphQL reply layer failed for ${parentCommentId}: ${message}`);
          return { comments: [], pageInfo: { has_next_page: false, end_cursor: null }, note: `Reply layer failed: ${message}` };
        }

        throw err;
      }
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
   * Scrape thread post detail and optional comment tree for a post by ID, shortcode, or URL.
   * @param {Object} args
   * @param {string} [args.postId]
   * @param {boolean} [args.includeReplies=false]
   * @param {number} [args.maxDepth=3]
   * @param {number} [args.maxComments=500]
   * @param {string} [args.after]
   * @param {Record<string, any>} [session={}]
   * @returns {Promise<any>}
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
    const cookies = session?.cookies || '';
    const numericPostId = await this.#resolvePostId(args.postId, accountId, cookies);

    const docId = this.docIds.POST_DETAIL;

    /** @type {Record<string, any> | null} */
    let rawRootPost = null;

    if (docId) {
      const variables = {
        postID: numericPostId,
        post_id: numericPostId,
      };

      try {
        const res = await this.client.requestGraphQl(docId, variables, { accountId, cookies });
        const topData = res?.data?.data && (res.data.data.containing_thread || res.data.data.reply_threads)
          ? res.data.data
          : (res?.data || {});

        // Search containing_thread first
        let fallbackPost = null;

        if (topData.containing_thread) {
          const items = Array.isArray(topData.containing_thread.thread_items)
            ? topData.containing_thread.thread_items
            : (Array.isArray(topData.containing_thread.items) ? topData.containing_thread.items : [topData.containing_thread]);
          for (const item of items) {
            const p = item?.post || (item?.pk || item?.id ? item : null);
            if (p) {
              if (String(p.pk || p.id) === numericPostId) {
                rawRootPost = p;
                break;
              }
              if (!fallbackPost) {
                fallbackPost = p;
              }
            }
          }
        }

        // Search reply_threads if exact match not found in containing_thread
        if (!rawRootPost && Array.isArray(topData.reply_threads)) {
          for (const thread of topData.reply_threads) {
            const items = Array.isArray(thread.thread_items) ? thread.thread_items : [thread];
            for (const item of items) {
              const p = item?.post || (item?.pk || item?.id ? item : null);
              if (p && String(p.pk || p.id) === numericPostId) {
                rawRootPost = p;
                break;
              }
            }
            if (rawRootPost) break;
          }
        }

        if (!rawRootPost && fallbackPost) {
          rawRootPost = fallbackPost;
        }
      } catch (err) {
        console.warn(`⚠️ [THREADS] POST_DETAIL GraphQL failed, falling back to SSR: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (!rawRootPost) {
      rawRootPost = await this.#fetchPostDetailSsr(args.postId, numericPostId, accountId, cookies);
    }

    if (!rawRootPost) {
      throw new PlatformError({
        code: 'XACT_4041',
        type: 'not_found',
        message: `Post ${numericPostId} not found`,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'threads',
        accountId,
      });
    }

    const post = this.#normalizePostItem(rawRootPost);
    if (!post) {
      throw new PlatformError({
        code: 'XACT_4041',
        type: 'not_found',
        message: `Failed to normalize post ${numericPostId}`,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'threads',
        accountId,
      });
    }

    if (post.metadata && typeof post.metadata === 'object') {
      /** @type {Record<string, any>} */ (post.metadata).sourceMethod = 'post_detail';
    }
    this.validateItem(post);

    if (this.store && typeof this.store.storeBatch === 'function') {
      await this.store.storeBatch([post], { upsert: true });
    }

    await this.#emitCheckpointAndStream({
      targetType: 'post_detail',
      targetKey: numericPostId,
      items: [post],
      hasMore: false,
    });

    if (args.includeReplies) {
      const effectiveMaxDepth = this.docIds.COMMENT_REPLIES ? (args.maxDepth ?? 3) : 0;
      if (!this.docIds.COMMENT_REPLIES && (args.maxDepth ?? 3) > 0) {
        console.warn('⚠️ [THREADS] COMMENT_REPLIES doc_id not configured; returning root-level comments only.');
      }

      const commentsResult = await this.getPostComments({
        ...args,
        postId: numericPostId,
        maxDepth: effectiveMaxDepth,
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
   * @param {Object} args
   * @returns {Promise<import('../../../core/types.js').CommentItem[]>}
   */
  /**
   * @param {Object} args
   * @param {Record<string, any>} [session={}]
   * @returns {Promise<import('../../../core/types.js').CommentItem[]>}
   */
  async getComments(args, session = {}) {
    const res = await this.getPostComments(/** @type {any} */ (args), session);
    return res.comments;
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
