// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * ThreadsCrawler — High-throughput hybrid crawler for Meta Threads (threads.net).
 * Extends AbstractCrawler, registers search, get_user_feed, and get_post_comments actions,
 * normalizes data into PostItem / CommentItem schemas, and persists to PrismaStore.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractCrawler } from '../../../core/base-crawler.js';
import { ThreadsClient } from './client.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';
import { CommentTreeExtractor } from '../comment-tree.js';
import { normalizePost, normalizeComment } from './normalizer.js';

export const DEFAULT_THREADS_DOC_IDS = {
  // BarcelonaProfileThreadsTabQuery — profile threads tab
  USER_FEED: '6232751443445612',
  // BarcelonaPostPageQuery — post detail fallback
  POST_DETAIL: '5587632691339264',
  // Root comment pagination (capture required; overrideable via deps.docIds)
  COMMENT_ROOTS: null,
  // Reply comment pagination (capture required; overrideable via deps.docIds)
  COMMENT_REPLIES: null,
  // Search posts (capture required; overrideable via deps.docIds)
  SEARCH_POSTS: null,
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

  /** @type {any} */
  prisma = null;

  /** @type {any} */
  redis = null;

  /**
   * @param {Object} [deps]
   * @param {ThreadsClient} [deps.client]
   * @param {Record<string, string | null>} [deps.docIds]
   * @param {import('../../../core/base-store.js').AbstractStore} [deps.store]
   * @param {import('../../../core/session-manager.js').SessionManager} [deps.sessionManager]
   * @param {import('../../../core/adaptive-governor.js').AdaptiveRateGovernor} [deps.governor]
   * @param {import('../../../core/account-pool.js').AccountPool} [deps.accountPool]
   * @param {import('../../../proxy/proxy-pool.js').ProxyIpPool} [deps.proxyPool]
   * @param {any} [deps.prisma]
   * @param {any} [deps.redis]
   * @param {string} [deps.appId]
   * @param {string} [deps.asbdId]
   * @param {Record<string, string>} [deps.friendlyNames]
   */
  constructor(deps = {}) {
    const { client: explicitClient, appId, asbdId, friendlyNames, ...crawlerDeps } = deps;
    const client = explicitClient || new ThreadsClient({ ...crawlerDeps, appId, asbdId, friendlyNames });
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
    this.prisma = deps.prisma || null;
    this.redis = deps.redis || null;

    // Register standard actions in ActionRegistry
    this.registerAction({
      action: 'get_user_feed',
      description: 'Scrape user timeline posts and threads from Threads profile using GraphQL',
      requiredArgs: ['username'],
      optionalArgs: ['count', 'cursor'],
      outputType: '{ posts: PostItem[], pageInfo?: any }',
      example: { username: 'instagram', count: 20 },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getUserFeed(args, session),
    });

    this.registerAction({
      action: 'search',
      description: 'Search for posts on Threads via GraphQL or SSR HTTP fallback',
      requiredArgs: ['query'],
      optionalArgs: ['count', 'cursor', 'searchType'],
      outputType: '{ posts: PostItem[], pageInfo?: any }',
      example: { query: 'drama vietnam', count: 20 },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.search(args, session),
    });

    this.registerAction({
      action: 'get_post_comments',
      description: 'Scrape hierarchical comments for a Threads post via GraphQL',
      requiredArgs: ['postId'],
      optionalArgs: ['maxDepth', 'maxComments', 'after'],
      outputType: '{ comments: CommentItem[], pageInfo?: any }',
      example: { postId: '3141592653589793', maxDepth: 3, maxComments: 500 },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getPostComments(args, session),
    });
  }

  /**
   * Clamp maxDepth to [0, 5] (default 3).
   * @param {unknown} value
   * @returns {number}
   */
  #clampMaxDepth(value) {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n) || n < 0) return 3;
    return Math.min(Math.floor(n), 5);
  }

  /**
   * Clamp maxComments to [1, 2000] (default 500).
   * @param {unknown} value
   * @returns {number}
   */
  #clampMaxComments(value) {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n) || n <= 0) return 500;
    return Math.min(Math.floor(n), 2000);
  }

  /**
   * Normalize count parameter.
   * @param {unknown} count
   * @param {number} [defaultCount=20]
   * @param {number} [maxCount=100]
   * @returns {number}
   */
  #normalizeCount(count, defaultCount = 20, maxCount = 100) {
    const n = typeof count === 'number' ? count : Number(count);
    if (!Number.isFinite(n) || n <= 0) return defaultCount;
    return Math.min(Math.floor(n), maxCount);
  }

  /**
   * Extract clean post external ID from input URL or string.
   * @param {string} input
   * @returns {string}
   */
  #extractPostExternalId(input) {
    if (typeof input !== 'string') return '';
    if (input.startsWith('threads:')) {
      return input.slice('threads:'.length);
    }
    if (input.startsWith('https://') || input.startsWith('http://')) {
      try {
        const url = new URL(input);
        const parts = url.pathname.split('/').filter(Boolean);
        return parts[parts.length - 1] || '';
      } catch {
        return '';
      }
    }
    return input;
  }

  /**
   * Resolve numeric user ID from username by inspecting profile page HTML.
   * @param {string} username
   * @param {string} accountId
   * @param {string | Record<string, string>} [cookies]
   * @returns {Promise<string>}
   */
  async #resolveUserId(username, accountId, cookies) {
    const cleanUsername = username.replace(/^@/, '').trim();
    if (!cleanUsername) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Invalid username: username cannot be empty',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'threads',
      });
    }

    // If username is already all digits, assume it is numeric user ID
    if (/^\d+$/.test(cleanUsername)) {
      return cleanUsername;
    }

    try {
      const resp = /** @type {any} */ (await this.client.request('GET', `${this.client.baseUrl}/@${cleanUsername}`, {
        accountId: accountId || 'threads-guest',
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        },
        cookies,
      }));

      const html = typeof resp?.data === 'string' ? resp.data : (typeof resp === 'string' ? resp : JSON.stringify(resp?.data || ''));

      // 1. Regex match for "user_id":"12345" or "pk":"12345"
      const userIdMatch = html.match(/"user_id":"(\d+)"/) ||
                          html.match(/"pk":"(\d+)"/) ||
                          html.match(/"id":"(\d+)"/) ||
                          html.match(/profile_id=(\d+)/);
      if (userIdMatch && userIdMatch[1]) {
        return userIdMatch[1];
      }

      // 2. Try parsing JSON script tags
      const scriptRegex = /<script\s+type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi;
      let match;
      while ((match = scriptRegex.exec(html)) !== null) {
        try {
          const json = JSON.parse(match[1]);
          const userPk = json?.require?.[0]?.[3]?.[0]?.__bbox?.result?.data?.userData?.user?.pk ||
                         json?.require?.[0]?.[3]?.[0]?.__bbox?.result?.data?.userData?.user?.id ||
                         json?.props?.pageProps?.user?.pk ||
                         json?.data?.user?.pk;
          if (userPk) return String(userPk);
        } catch {}
      }
    } catch (err) {
      // If fetching fails, re-throw if it's already a PlatformError
      if (err instanceof PlatformError) throw err;
    }

    throw new PlatformError({
      code: 'XACT_5000',
      type: ErrorTypes.INTERNAL,
      message: `Failed to resolve numeric user_id for Threads username: @${cleanUsername}`,
      suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
      platform: 'threads',
      accountId,
    });
  }

  /**
   * Save checkpoint to database if Prisma is available.
   * @param {Object} params
   * @param {string} params.targetType
   * @param {string} params.targetKey
   * @param {string | null} [params.lastCursor]
   * @param {Date | null} [params.lastTimestamp]
   * @param {string} [params.status='completed']
   */
  async #saveCheckpoint({ targetType, targetKey, lastCursor = null, lastTimestamp = null, status = 'completed' }) {
    try {
      const prisma = this.prisma || (await import('../../../../api/lib/prisma.js').then((m) => m.default).catch(() => null));
      if (prisma?.crawlCheckpoint) {
        await prisma.crawlCheckpoint.upsert({
          where: {
            platform_targetType_targetKey: {
              platform: 'threads',
              targetType,
              targetKey: String(targetKey),
            },
          },
          create: {
            platform: 'threads',
            targetType,
            targetKey: String(targetKey),
            lastCursor: lastCursor || null,
            lastTimestamp: lastTimestamp || null,
            lastCrawledAt: new Date(),
            status,
          },
          update: {
            lastCursor: lastCursor || null,
            lastTimestamp: lastTimestamp || null,
            lastCrawledAt: new Date(),
            status,
          },
        });
      }
    } catch {
      // Non-blocking for environments without DB
    }
  }

  /**
   * Emit thin event pointers to Redis stream if configured.
   * @param {Array<import('../../../core/types.js').PostItem | import('../../../core/types.js').CommentItem>} items
   * @param {string} [category='social']
   */
  async #emitThinEvents(items, category = 'social') {
    if (!Array.isArray(items) || items.length === 0) return;
    if (process.env.REDIS_STREAM_ENABLED !== 'true' && !this.redis) return;

    try {
      const redisClient = this.redis;
      if (redisClient && typeof redisClient.xadd === 'function') {
        for (const item of items) {
          const payload = JSON.stringify({
            id: item.id,
            platform: 'threads',
            externalId: item.externalId,
            category: /** @type {any} */ (item).category || category,
            authorId: item.authorId,
            crawledAt: item.crawledAt || new Date(),
            storageRef: `postgres:post:${item.id}`,
          });
          await redisClient.xadd('stream:social:raw_posts', 'MAXLEN', '~', '1000000', '*', 'payload', payload);
        }
      }
    } catch {
      // Non-blocking error for Redis stream emission
    }
  }

  /**
   * Scrape user feed from Threads profile via GraphQL.
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
        platform: 'threads',
      });
    }

    const username = String(args.username).replace(/^@/, '').trim();
    const count = this.#normalizeCount(args.count);
    const accountId = session?.accountId || 'threads-guest';
    const cookies = session?.cookies || '';

    const userID = await this.#resolveUserId(username, accountId, cookies);
    const docId = this.docIds.USER_FEED || DEFAULT_THREADS_DOC_IDS.USER_FEED;
    if (!docId) {
      throw new PlatformError({
        code: 'XACT_5000',
        type: ErrorTypes.INTERNAL,
        message: 'Threads USER_FEED doc_id is not configured',
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform: 'threads',
        accountId,
      });
    }

    const variables = {
      userID,
      first: count,
    };
    if (args.cursor) {
      Object.assign(variables, { after: args.cursor });
    }

    const res = await this.client.requestGraphQl(docId, variables, {
      accountId,
      cookies,
    });

    const threads = res?.data?.mediaData?.threads ||
                    res?.data?.userData?.user?.threads ||
                    res?.data?.edges ||
                    [];
    const threadList = Array.isArray(threads) ? threads : [];
    const posts = [];

    for (const thread of threadList) {
      const rawPost = thread?.thread_items?.[0]?.post || thread?.node?.thread_items?.[0]?.post || thread?.post || thread;
      const post = normalizePost(rawPost, 'graphql');
      if (!post) continue;
      this.validateItem(post);
      posts.push(post);
    }

    if (this.store && typeof this.store.storeBatch === 'function' && posts.length > 0) {
      await this.store.storeBatch(posts, { upsert: true });
    }

    const pageInfo = res?.data?.mediaData?.page_info ||
                     res?.data?.page_info ||
                     { has_next_page: false, end_cursor: null };

    await this.#saveCheckpoint({
      targetType: 'user_feed',
      targetKey: username,
      lastCursor: pageInfo?.end_cursor || null,
      lastTimestamp: posts[0]?.publishedAt || null,
      status: 'completed',
    });

    await this.#emitThinEvents(posts, 'social');

    return {
      posts,
      pageInfo,
    };
  }

  /**
   * Search posts on Threads via GraphQL or SSR HTTP fallback.
   * @param {Object} args
   * @param {string} [args.query]
   * @param {number} [args.count=20]
   * @param {string} [args.cursor]
   * @param {string} [args.searchType]
   * @param {Record<string, any>} [session={}]
   * @returns {Promise<any>}
   */
  async search(args, session = {}) {
    if (!args?.query) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing required argument: query',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'threads',
      });
    }

    const query = String(args.query).trim();
    const count = this.#normalizeCount(args.count);
    const accountId = session?.accountId || 'threads-guest';
    const cookies = session?.cookies || '';

    let posts = [];
    let pageInfo = { has_next_page: false, end_cursor: null };

    // 1. Try GraphQL if SEARCH_POSTS doc_id is configured
    if (this.docIds.SEARCH_POSTS) {
      const variables = {
        query,
        count,
        cursor: args.cursor || null,
        searchType: args.searchType || 'default',
      };

      const res = await this.client.requestGraphQl(this.docIds.SEARCH_POSTS, variables, {
        accountId,
        cookies,
      });

      const items = res?.data?.searchResults?.threads ||
                    res?.data?.mediaData?.threads ||
                    res?.data?.edges ||
                    [];
      for (const item of (Array.isArray(items) ? items : [])) {
        const rawPost = item?.thread_items?.[0]?.post || item?.node?.thread_items?.[0]?.post || item?.post || item;
        const post = normalizePost(rawPost, 'graphql');
        if (!post) continue;
        this.validateItem(post);
        posts.push(post);
      }

      pageInfo = res?.data?.searchResults?.page_info ||
                 res?.data?.page_info ||
                 pageInfo;
    } else {
      // 2. SSR HTTP fallback via got-scraping GET request
      try {
        const resp = /** @type {any} */ (await this.client.request(
          'GET',
          `${this.client.baseUrl}/search?q=${encodeURIComponent(query)}&serp_type=default`,
          {
            accountId,
            headers: {
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            },
            cookies,
          }
        ));

        const html = typeof resp?.data === 'string' ? resp.data : (typeof resp === 'string' ? resp : JSON.stringify(resp?.data || ''));

        // Parse JSON scripts for search results
        const scriptRegex = /<script\s+type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi;
        let match;
        while ((match = scriptRegex.exec(html)) !== null) {
          try {
            const json = JSON.parse(match[1]);
            const searchThreads = json?.require?.[0]?.[3]?.[0]?.__bbox?.result?.data?.searchResults?.threads ||
                                  json?.props?.pageProps?.threads ||
                                  json?.data?.searchResults?.threads;
            if (Array.isArray(searchThreads)) {
              for (const thread of searchThreads) {
                const rawPost = thread?.thread_items?.[0]?.post || thread?.post || thread;
                const post = normalizePost(rawPost, 'ssr');
                if (post) {
                  this.validateItem(post);
                  posts.push(post);
                }
              }
            }
          } catch {}
        }
      } catch (err) {
        if (err instanceof PlatformError) throw err;
      }

      if (posts.length === 0) {
        throw new PlatformError({
          code: 'XACT_5000',
          type: ErrorTypes.INTERNAL,
          message: 'Threads search doc_id is not configured and SSR fallback returned no items',
          suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
          platform: 'threads',
          accountId,
          details: { query },
        });
      }
    }

    if (this.store && typeof this.store.storeBatch === 'function' && posts.length > 0) {
      await this.store.storeBatch(posts, { upsert: true });
    }

    await this.#saveCheckpoint({
      targetType: 'search',
      targetKey: query,
      lastCursor: pageInfo?.end_cursor || null,
      lastTimestamp: posts[0]?.publishedAt || null,
      status: 'completed',
    });

    await this.#emitThinEvents(posts, 'social');

    return {
      posts,
      pageInfo,
    };
  }

  /**
   * Scrape hierarchical comments for a Threads post via GraphQL.
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
        platform: 'threads',
      });
    }

    const postExternalId = this.#extractPostExternalId(args.postId);
    if (!postExternalId) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Invalid postId: could not extract post external id',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'threads',
      });
    }

    const maxDepth = this.#clampMaxDepth(args.maxDepth);
    const maxComments = this.#clampMaxComments(args.maxComments);
    const accountId = session?.accountId || 'threads-guest';
    const cookies = session?.cookies || '';

    /**
     * @param {import('../comment-tree.js').FetchLayerInput} input
     * @returns {Promise<import('../comment-tree.js').FetchLayerPage>}
     */
    const fetchLayer = async ({ postId, parentCommentId, after, limit }) => {
      const isReply = parentCommentId != null;
      const docId = isReply ? this.docIds.COMMENT_REPLIES : this.docIds.COMMENT_ROOTS;

      if (!docId) {
        // Fallback to BarcelonaPostPageQuery (POST_DETAIL) if available
        if (this.docIds.POST_DETAIL) {
          const res = await this.client.requestGraphQl(this.docIds.POST_DETAIL, {
            postID: postId,
          }, { accountId, cookies });

          const containingThread = res?.data?.data?.containing_thread;
          const replyThreads = res?.data?.data?.reply_threads || [];
          const rawComments = [];

          if (isReply) {
            // Find replies matching parent
            for (const thread of replyThreads) {
              const threadItems = thread?.thread_items || [];
              for (const item of threadItems) {
                const p = item?.post;
                if (p) {
                  rawComments.push({ ...p, parentId: parentCommentId });
                }
              }
            }
          } else {
            // Root replies
            for (const thread of replyThreads) {
              const rootPost = thread?.thread_items?.[0]?.post;
              if (rootPost) {
                rawComments.push(rootPost);
              }
            }
          }

          return {
            comments: rawComments,
            pageInfo: { has_next_page: false, end_cursor: null },
          };
        }

        throw new PlatformError({
          code: 'XACT_5000',
          type: ErrorTypes.INTERNAL,
          message: 'Threads comment doc_id is not configured',
          suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
          platform: 'threads',
          accountId,
        });
      }

      const pageSize = Math.min(limit || 20, 50);
      const variables = {
        postID: postId,
        after: after || null,
        first: pageSize,
      };

      const res = await this.client.requestGraphQl(docId, variables, {
        accountId,
        cookies,
      });

      const connection = isReply
        ? res?.data?.node?.replies_connection
        : res?.data?.node?.comment_rendering_instance_for_feed_location?.comments || res?.data?.comments;

      const rawEdges = connection?.edges || res?.data?.edges || [];
      const comments = [];
      for (const edge of rawEdges) {
        const raw = edge?.node || edge;
        if (!raw) continue;
        if (isReply && raw.parentId === undefined) {
          raw.parentId = parentCommentId;
        }
        comments.push(raw);
      }

      const pageInfo = connection?.page_info || res?.data?.page_info || { has_next_page: false, end_cursor: null };
      return { comments, pageInfo };
    };

    /**
     * @param {Record<string, unknown>} raw
     * @param {string} pid
     * @returns {import('../../../core/types.js').CommentItem | null}
     */
    const normalizeFn = (raw, pid) => {
      return normalizeComment(raw, pid, 'graphql');
    };

    const extractor = new CommentTreeExtractor(fetchLayer, normalizeFn, {
      maxDepth,
      maxComments,
      concurrency: 2,
    });

    const result = await extractor.fetch(postExternalId);
    const comments = result.comments;

    if (this.store && typeof this.store.storeCommentBatch === 'function' && comments.length > 0) {
      await this.store.storeCommentBatch(comments, { upsert: true });
    }

    await this.#saveCheckpoint({
      targetType: 'post_comments',
      targetKey: postExternalId,
      lastCursor: result.pageInfo?.end_cursor || null,
      lastTimestamp: comments[0]?.publishedAt || null,
      status: 'completed',
    });

    await this.#emitThinEvents(comments, 'social');

    return {
      comments,
      pageInfo: result.pageInfo,
    };
  }

  /**
   * Cleanup crawler resources and client token cache.
   * @returns {Promise<void>}
   */
  async cleanup() {
    if (this.client && typeof this.client.clearTokenCache === 'function') {
      this.client.clearTokenCache();
    }
  }
}
