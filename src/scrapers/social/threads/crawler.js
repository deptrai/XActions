// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * ThreadsCrawler — High-throughput hybrid crawler for Threads (Meta Internal GraphQL).
 * Extends AbstractCrawler, registers get_user_feed, search, and get_post_comments,
 * normalizes data into PostItem/CommentItem schema, and persists to PrismaStore.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractCrawler } from '../../../core/base-crawler.js';
import { ThreadsClient } from './client.js';
import { CommentTreeExtractor } from '../comment-tree.js';
import { generatePostId, generateCommentId } from '../../../core/types.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';

export const DEFAULT_THREADS_DOC_IDS = {
  PROFILE_FEED: '6232751443445612',
  POST_DETAIL: '5587632691339264',
  SEARCH_POSTS: null,
  COMMENT_ROOTS: null,
  COMMENT_REPLIES: null,
};

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

    // Register standard actions in ActionRegistry
    this.registerAction(/** @type {any} */ ({
      action: 'get_user_feed',
      description: 'Scrape timeline threads and posts for a user profile by username',
      category: 'social',
      args: {
        username: { type: 'string', required: true, description: 'Threads username without @' },
        count: { type: 'number', required: false, default: 20, description: 'Max threads to retrieve' },
        cursor: { type: 'string', required: false, description: 'Pagination end cursor' },
      },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getUserFeed(args, session),
    }));

    this.registerAction(/** @type {any} */ ({
      action: 'search',
      description: 'Search viral posts and discussions on Threads',
      category: 'social',
      args: {
        query: { type: 'string', required: true, description: 'Search keyword or query' },
        count: { type: 'number', required: false, default: 20, description: 'Max posts to retrieve' },
        cursor: { type: 'string', required: false, description: 'Pagination cursor' },
        searchType: { type: 'string', required: false, default: 'default', description: 'Search type (default, recent)' },
      },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.searchPosts(args, session),
    }));

    this.registerAction(/** @type {any} */ ({
      action: 'get_post_comments',
      description: 'Scrape hierarchical comment tree for a Threads post',
      category: 'social',
      args: {
        postId: { type: 'string', required: true, description: 'Threads post ID or code' },
        maxDepth: { type: 'number', required: false, default: 3, description: 'Max comment nesting depth (0-5)' },
        maxComments: { type: 'number', required: false, default: 500, description: 'Max comments limit (1-2000)' },
        after: { type: 'string', required: false, description: 'Initial cursor' },
      },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getPostComments(args, session),
    }));
  }

  /**
   * Normalize raw Threads GraphQL / SSR post node into uniform PostItem.
   * @param {Record<string, any>} raw
   * @returns {import('../../../core/types.js').PostItem | null}
   */
  #normalizePostItem(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const post = raw.post || raw.thread_items?.[0]?.post || raw;
    const rawPk = post.pk || post.id || raw.pk || raw.id;
    const postId = rawPk ? String(rawPk) : '';
    if (!postId) return null;

    const user = post.user || raw.user || {};
    const authorId = String(user.pk || user.id || '');
    const authorName = String(user.username || '');
    const authorAvatar = user.profile_pic_url || '';

    const content = (typeof post.caption === 'string' ? post.caption : post.caption?.text) ||
                    post.text ||
                    '';

    const parseCount = (/** @type {unknown} */ val) => {
      const n = Number(val);
      return Number.isFinite(n) ? n : 0;
    };

    const likesCount = parseCount(post.like_count);
    const repliesCount = parseCount(post.text_post_app_info?.direct_reply_count ?? post.comment_count);
    const repostsCount = parseCount(post.media_repost_count);
    const viewsCount = parseCount(post.play_count);

    const mediaUrls = [];
    if (Array.isArray(post.image_versions2?.candidates) && post.image_versions2.candidates.length > 0) {
      const candidate = post.image_versions2.candidates[0];
      if (candidate?.url) mediaUrls.push(candidate.url);
    }
    if (Array.isArray(post.video_versions) && post.video_versions.length > 0) {
      const video = post.video_versions[0];
      if (video?.url) mediaUrls.push(video.url);
    }
    if (Array.isArray(post.carousel_media)) {
      for (const item of post.carousel_media) {
        const candidate = item.image_versions2?.candidates?.[0];
        if (candidate?.url) mediaUrls.push(candidate.url);
      }
    }

    const postCode = post.code || raw.code || postId;
    const postUrl = authorName ? `https://www.threads.net/@${authorName}/post/${postCode}` : `https://www.threads.net/t/${postCode}`;
    const takenAt = post.taken_at || raw.taken_at;

    /** @type {import('../../../core/types.js').PostItem} */
    const item = {
      id: generatePostId('threads', postId),
      externalId: postId,
      platform: 'threads',
      category: 'social',
      authorId,
      authorName,
      authorAvatar,
      content,
      likesCount,
      repliesCount,
      repostsCount,
      viewsCount,
      mediaUrls,
      postUrl,
      publishedAt: takenAt ? new Date(Number(takenAt) * 1000) : undefined,
      crawledAt: new Date(),
      metadata: {
        postCode: String(postCode),
        mediaType: post.media_type ? String(post.media_type) : undefined,
        isReply: Boolean(post.text_post_app_info?.is_reply),
        carousel: mediaUrls,
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

    const content = (typeof replyPost.caption === 'string' ? replyPost.caption : replyPost.caption?.text) ||
                    replyPost.text ||
                    '';

    const parseCount = (/** @type {unknown} */ val) => {
      const n = Number(val);
      return Number.isFinite(n) ? n : 0;
    };

    const likesCount = parseCount(replyPost.like_count);
    const subCommentsCount = parseCount(replyPost.text_post_app_info?.direct_reply_count ?? replyPost.comment_count);
    const takenAt = replyPost.taken_at;

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
      publishedAt: takenAt ? new Date(Number(takenAt) * 1000) : undefined,
      crawledAt: new Date(),
      metadata: {
        postCode: String(replyPost.code || commentId),
        mediaType: replyPost.media_type ? String(replyPost.media_type) : undefined,
        isReply: Boolean(replyPost.text_post_app_info?.is_reply),
        sourceMethod: 'graphql',
      },
    };

    return item;
  }

  /**
   * Resolve numeric Threads user ID from @username profile page HTML.
   * @param {string} username
   * @param {string} accountId
   * @returns {Promise<string>}
   */
  async #resolveUserId(username, accountId) {
    const cleanUser = username.replace(/^@/, '');
    const resp = /** @type {any} */ (await this.client.request('GET', `${this.client.baseUrl}/@${cleanUser}`, {
      accountId,
    }));

    const html = typeof resp?.data === 'string' ? resp.data : (typeof resp === 'string' ? resp : JSON.stringify(resp?.data || ''));

    const idMatch = html.match(/"user_id":"(\d+)"/) ||
                    html.match(/window\.__user_id\s*=\s*"(\d+)"/) ||
                    html.match(/window\.__userId\s*=\s*"(\d+)"/) ||
                    html.match(/"pk":"(\d+)"/);

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
   * @returns {Promise<{ posts: import('../../../core/types.js').PostItem[], pageInfo?: any }>}
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
    const variables = {
      userID: numericUserId,
      first: args.count || 20,
      after: args.cursor || null,
    };

    const res = await this.client.requestGraphQl(docId, variables, {
      accountId,
    });

    const rawThreads = res?.data?.mediaData?.threads || res?.data?.mediaData?.edges || [];
    const posts = [];

    for (const thread of rawThreads) {
      const post = this.#normalizePostItem(thread);
      if (!post) continue;
      this.validateItem(post);
      posts.push(post);
    }

    if (this.store && typeof this.store.storeBatch === 'function' && posts.length > 0) {
      await this.store.storeBatch(posts, { upsert: true });
    }

    return {
      posts,
      pageInfo: res?.data?.mediaData?.page_info || null,
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
   * @returns {Promise<{ posts: import('../../../core/types.js').PostItem[], pageInfo?: any }>}
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

    if (this.docIds.SEARCH_POSTS) {
      const res = await this.client.requestGraphQl(this.docIds.SEARCH_POSTS, {
        query: args.query,
        first: args.count || 20,
        after: args.cursor || null,
        serp_type: args.searchType || 'default',
      }, { accountId });

      const rawThreads = res?.data?.mediaData?.threads || res?.data?.searchResults?.edges || [];
      const posts = [];
      for (const t of rawThreads) {
        const post = this.#normalizePostItem(t);
        if (!post) continue;
        this.validateItem(post);
        posts.push(post);
      }

      if (this.store && typeof this.store.storeBatch === 'function' && posts.length > 0) {
        await this.store.storeBatch(posts, { upsert: true });
      }

      return { posts, pageInfo: res?.data?.mediaData?.page_info || null };
    }

    // SSR HTTP Search Fallback
    const searchUrl = `${this.client.baseUrl}/search?q=${encodeURIComponent(args.query)}&serp_type=${encodeURIComponent(args.searchType || 'default')}`;
    const resp = /** @type {any} */ (await this.client.request('GET', searchUrl, { accountId }));
    const html = typeof resp?.data === 'string' ? resp.data : (typeof resp === 'string' ? resp : JSON.stringify(resp?.data || ''));

    const posts = [];
    const sharedDataMatch = html.match(/window\.__SHARED_DATA\s*=\s*({.*?});/s) ||
                            html.match(/<script type="application\/json"[^>]*>(.*?)<\/script>/s);

    if (sharedDataMatch && sharedDataMatch[1]) {
      try {
        const parsed = JSON.parse(sharedDataMatch[1]);
        const threads = parsed?.raw_data?.searchResults?.edges || parsed?.mediaData?.threads || [];
        for (const t of threads) {
          const post = this.#normalizePostItem(t);
          if (!post) continue;
          this.validateItem(post);
          posts.push(post);
        }
      } catch {}
    }

    if (this.store && typeof this.store.storeBatch === 'function' && posts.length > 0) {
      await this.store.storeBatch(posts, { upsert: true });
    }

    return {
      posts,
      pageInfo: null,
    };
  }

  /**
   * Search method satisfying AbstractCrawler contract.
   * @param {Object} args
   * @returns {Promise<import('../../../core/types.js').PostItem[]>}
   */
  async search(args) {
    const res = await this.searchPosts(/** @type {any} */ (args));
    return res.posts;
  }

  /**
   * Scrape hierarchical comment tree for a post using CommentTreeExtractor.
   * @param {Object} args
   * @param {string} args.postId
   * @param {number} [args.maxDepth=3]
   * @param {number} [args.maxComments=500]
   * @param {string} [args.after]
   * @param {Record<string, any>} [session={}]
   * @returns {Promise<{ comments: import('../../../core/types.js').CommentItem[], pageInfo?: any }>}
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
    const rootPostId = String(args.postId);
    const maxDepth = Math.max(0, Math.min(args.maxDepth ?? 3, 5));
    const maxComments = Math.max(1, Math.min(args.maxComments ?? 500, 2000));

    /**
     * @param {import('../comment-tree.js').FetchLayerInput} input
     * @returns {Promise<import('../comment-tree.js').FetchLayerPage>}
     */
    const fetchLayer = async ({ postId, parentCommentId, after, limit }) => {
      const isReply = parentCommentId != null;
      const docId = isReply ? (this.docIds.COMMENT_REPLIES || this.docIds.POST_DETAIL) : (this.docIds.COMMENT_ROOTS || this.docIds.POST_DETAIL);

      if (!docId) {
        throw new PlatformError({
          code: 'XACT_5000',
          type: ErrorTypes.INTERNAL,
          message: 'Threads comment doc_id is not configured',
          suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        });
      }

      const res = await this.client.requestGraphQl(docId, {
        postID: postId,
        post_id: postId,
        after,
        first: Math.min(limit || 20, 50),
      }, { accountId });

      // Support BarcelonaPostPageQuery format and connection format
      const replyThreads = res?.data?.data?.reply_threads || res?.data?.reply_threads;
      if (Array.isArray(replyThreads)) {
        const comments = [];
        for (const t of replyThreads) {
          const items = t.thread_items || [t];
          for (const item of items) {
            if (item?.post) comments.push(item.post);
          }
        }
        return {
          comments,
          pageInfo: { has_next_page: false, end_cursor: null },
        };
      }

      const connection = isReply
        ? res?.data?.node?.replies_connection
        : res?.data?.node?.comment_rendering_instance_for_feed_location?.comments;

      const comments = (connection?.edges || []).map((/** @type {any} */ edge) => edge?.node).filter(Boolean);
      if (isReply && parentCommentId) {
        for (const raw of comments) {
          if (raw.parentId === undefined) raw.parentId = parentCommentId;
        }
      }

      return {
        comments,
        pageInfo: connection?.page_info || { has_next_page: false, end_cursor: null },
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

    return {
      comments,
      pageInfo,
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
      code: 'XACT_4001',
      type: ErrorTypes.INVALID_ARGS,
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
      code: 'XACT_4001',
      type: ErrorTypes.INVALID_ARGS,
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
