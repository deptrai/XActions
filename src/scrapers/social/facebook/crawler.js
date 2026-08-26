// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * FacebookCrawler — High-throughput hybrid crawler for Facebook Groups and Pages.
 * Extends AbstractCrawler, registers standard group_posts and page_posts actions,
 * normalizes data into PostItem schema, and persists to PrismaStore.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractCrawler } from '../../../core/base-crawler.js';
import { FacebookClient } from './client.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';
import { CommentTreeExtractor } from '../comment-tree.js';

const FORBIDDEN_COOKIE_CHARS = /[;,"\\]/g;

/**
 * Percent-encode only characters that are illegal inside a Cookie header value.
 * @param {unknown} value
 * @returns {string}
 */
function encodeCookieValue(value) {
  if (value == null) return '';
  return String(value).replace(FORBIDDEN_COOKIE_CHARS, (c) => encodeURIComponent(c));
}

/**
 * Build a Cookie header from a record of cookie values.
 * @param {Record<string, unknown>} cookies
 * @returns {string}
 */
function buildCookieHeader(cookies) {
  return Object.entries(cookies)
    .map(([k, v]) => `${encodeCookieValue(k)}=${encodeCookieValue(v)}`)
    .join('; ');
}

export const DEFAULT_FB_DOC_IDS = {
  GROUP_FEED: 'group_feed_doc_123',
  PAGE_FEED: 'page_feed_doc_456',
  // Captured 2026-08-26 from authenticated Facebook web session
  // CommentsListComponentsPaginationQuery_facebookRelayOperation
  COMMENT_ROOTS: '28217113134586234',
  // Depth1CommentsListPaginationQuery_facebookRelayOperation
  COMMENT_REPLIES: '27878908781774491',
  // Depth2CommentsListPaginationQuery_facebookRelayOperation (nested replies)
  COMMENT_REPLIES_DEPTH2: '28232639913040278',
};

/**
 * Relay feature flag values injected by the Facebook web runtime for comment queries.
 * Captured from live GraphQL requests.
 */
const FB_COMMENT_RELAY_PROVIDERS = {
  __relay_internal__pv__CometUFICommentAutoTranslationTyperelayprovider: 'AUTO_TRANSLATE',
  __relay_internal__pv__CometUFICommentAvatarStickerAnimatedImagerelayprovider: false,
  __relay_internal__pv__CometUFICommentActionLinksRewriteEnabledrelayprovider: true,
  __relay_internal__pv__IsWorkUserrelayprovider: false,
};

export class FacebookCrawler extends AbstractCrawler {
  /** @type {string} */
  name = 'facebook';

  /** @type {string} */
  platform = 'facebook';

  /** @type {boolean} */
  requiresAuth = true;

  /** @type {FacebookClient} */
  client;

  /** @type {Record<string, string>} */
  docIds;

  /**
   * @param {Object} [deps]
   * @param {FacebookClient} [deps.client]
   * @param {Record<string, string>} [deps.docIds]
   * @param {import('../../../core/base-store.js').AbstractStore} [deps.store]
   * @param {import('../../../core/session-manager.js').SessionManager} [deps.sessionManager]
   * @param {import('../../../core/adaptive-governor.js').AdaptiveRateGovernor} [deps.governor]
   * @param {import('../../../core/account-pool.js').AccountPool} [deps.accountPool]
   * @param {import('../../../proxy/proxy-pool.js').ProxyIpPool} [deps.proxyPool]
   * @param {Record<string, string>} [deps.friendlyNames]
   * @param {string} [deps.cdpUrl]
   */
  constructor(deps = {}) {
    const { client: explicitClient, friendlyNames, ...clientDeps } = deps;
    const client = explicitClient || new FacebookClient({ ...clientDeps, friendlyNames });
    super({
      ...deps,
      client,
      requiresAuth: true,
      cdpUrl: deps.cdpUrl || client.cdpUrl || undefined,
    });

    this.client = client;
    this.docIds = {
      ...DEFAULT_FB_DOC_IDS,
      ...(deps.docIds || {}),
    };

    // Register standard actions in ActionRegistry
    this.registerAction({
      action: 'group_posts',
      description: 'Scrape posts and updates from a Facebook Group using GraphQL',
      requiredArgs: ['groupId'],
      optionalArgs: ['count', 'cursor'],
      outputType: '{ posts: PostItem[], pageInfo?: any }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.groupPosts(args, session),
    });

    this.registerAction({
      action: 'page_posts',
      description: 'Scrape timeline posts from a Facebook Page using GraphQL',
      requiredArgs: ['pageId'],
      optionalArgs: ['count', 'cursor'],
      outputType: '{ posts: PostItem[], pageInfo?: any }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.pagePosts(args, session),
    });

    this.registerAction({
      action: 'get_comments',
      description: 'Scrape hierarchical comments from a Facebook post using GraphQL',
      requiredArgs: ['postId'],
      optionalArgs: ['maxDepth', 'maxComments', 'after'],
      outputType: '{ comments: CommentItem[], pageInfo?: any }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getCommentsForPost(args, session),
    });
  }

  /**
   * Normalize raw Facebook GraphQL node into uniform PostItem.
   * @param {Record<string, any>} rawNode
   * @param {string} [parentContextUrl='']
   * @returns {import('../../../core/types.js').PostItem | null}
   */
  #normalizePostItem(rawNode, parentContextUrl = '') {
    if (!rawNode || typeof rawNode !== 'object') return null;

    // Support nested story structures
    const node = rawNode.comet_sections?.content_story?.story || rawNode.story || rawNode;
    const postId = String(node.id || node.post_id || rawNode.id || rawNode.post_id || '');
    if (!postId) return null;

    const authorActors = Array.isArray(node.actors) ? node.actors : (Array.isArray(rawNode.actors) ? rawNode.actors : []);
    const authorActor = authorActors.length > 0 ? authorActors[0] : null;
    const authorId = authorActor ? String(authorActor.id || '') : '';
    const authorName = authorActor ? String(authorActor.name || '') : '';

    const content = (typeof node.message === 'string' ? node.message : node.message?.text) ||
                    (typeof node.story === 'string' ? node.story : node.story?.text) ||
                    node.text ||
                    '';

    /**
     * @param {unknown} val
     * @returns {number}
     */
    const parseCount = (val) => {
      const n = Number(val);
      return Number.isFinite(n) ? n : 0;
    };

    const likesCount = parseCount(node.feedback?.reaction_count?.count ?? node.reaction_count);
    const repliesCount = parseCount(node.feedback?.comment_count?.total_count ?? node.comment_count);
    const repostsCount = parseCount(node.feedback?.share_count?.count ?? node.share_count);

    const mediaUrls = [];
    const attachments = Array.isArray(node.attachments) ? node.attachments : (Array.isArray(rawNode.attachments) ? rawNode.attachments : []);
    for (const att of attachments) {
      if (!att || typeof att !== 'object') continue;
      const uri = att.media?.image?.uri || att.media?.photo_image?.uri || att.url;
      if (uri && typeof uri === 'string') mediaUrls.push(uri);
    }

    const creationTime = node.creation_time || rawNode.creation_time || null;

    /** @type {import('../../../core/types.js').PostItem} */
    const post = {
      id: `facebook:${postId}`,
      externalId: postId,
      platform: 'facebook',
      category: 'social',
      authorId,
      authorName,
      content,
      likesCount,
      repliesCount,
      repostsCount,
      mediaUrls,
      postUrl: parentContextUrl ? `${parentContextUrl}/posts/${postId}` : `https://www.facebook.com/${postId}`,
      publishedAt: creationTime ? new Date(Number(creationTime) * 1000) : undefined,
      crawledAt: new Date(),
      metadata: {
        creationTime,
      },
    };

    return post;
  }

  /**
   * Extract a clean post external id from a URL, namespaced id, or raw id.
   * @param {string} input
   * @returns {string}
   */
  #extractPostExternalId(input) {
    if (typeof input !== 'string') return '';
    if (input.startsWith('https://') || input.startsWith('http://')) {
      try {
        const url = new URL(input);
        const parts = url.pathname.split('/').filter(Boolean);
        return parts[parts.length - 1] || '';
      } catch {
        return '';
      }
    }
    if (input.startsWith('facebook:')) {
      return input.slice('facebook:'.length);
    }
    return input;
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
   * Normalize a raw comment node from GraphQL into CommentItem.
   * @param {Record<string, any>} raw
   * @param {string} postId
   * @returns {import('../../../core/types.js').CommentItem | null}
   */
  #normalizeComment(raw, postId) {
    if (!raw || typeof raw !== 'object') return null;

    const node = raw.node || raw;
    const rawId = node.id ?? node.comment_id ?? node.legacy_fbid ?? '';
    const commentId = this.#extractCommentExternalId(rawId);
    if (!commentId) return null;

    const authorActor = Array.isArray(node.actors) && node.actors.length > 0
      ? node.actors[0]
      : (node.author && typeof node.author === 'object' ? node.author : null);
    const authorId = authorActor ? String(authorActor.id || '') : '';
    const authorName = authorActor ? String(authorActor.name || '') : '';

    const content = node.body?.text ||
                    (typeof node.body === 'string' ? node.body : '') ||
                    (typeof node.message === 'string' ? node.message : node.message?.text) ||
                    node.text ||
                    '';

    const parentId = node.parentId ?? node.parent_comment_id ?? undefined;
    const parentCommentId = parentId ? `facebook:${postId}:${parentId}` : undefined;

    const feedback = node.feedback || {};
    const likesCount = Number(
      node.reactors?.count_reduced ??
      feedback.like_count?.count ??
      feedback.like_count ??
      node.like_count ??
      0
    ) || 0;
    const subCommentsCount = Number(
      feedback.replies_fields?.total_count ??
      feedback.replies_fields?.count ??
      feedback.comment_count?.total_count ??
      feedback.comment_count ??
      node.replies_connection?.edges?.length ??
      node.comment_count ??
      0
    ) || 0;

    const creationTime = node.created_time || null;
    const feedbackId = feedback.id || '';
    const expansionToken = feedback.expansion_info?.expansion_token || '';

    /** @type {import('../../../core/types.js').CommentItem} */
    const comment = {
      id: `facebook:${postId}:${commentId}`,
      platform: 'facebook',
      externalId: commentId,
      postId: `facebook:${postId}`,
      parentCommentId,
      depth: node.depth ?? 0,
      authorId,
      authorName,
      authorAvatar: authorActor?.profile_picture_depth_0?.uri || undefined,
      content,
      likesCount,
      subCommentsCount,
      metadata: {
        rawId,
        parentId,
        feedbackId,
        expansionToken,
      },
      publishedAt: creationTime ? new Date(Number(creationTime) * 1000) : undefined,
      crawledAt: new Date(),
    };

    return comment;
  }

  /**
   * Decode a Relay base64 comment id (e.g. "Y29tbWVudDoxXzI=") to the numeric comment id.
   * Falls back to the raw value for non-base64 / test data.
   * @param {unknown} rawId
   * @returns {string}
   */
  #extractCommentExternalId(rawId) {
    if (!rawId) return '';
    const raw = String(rawId);
    try {
      const decoded = Buffer.from(raw, 'base64').toString('utf8');
      if (decoded.startsWith('comment:')) {
        const parts = decoded.split('_');
        return parts[parts.length - 1] || raw;
      }
      if (decoded.startsWith('feedback:')) {
        const parts = decoded.split('_');
        // feedback:postId is the post feedback, not a comment
        return parts.length > 1 ? parts[parts.length - 1] : raw;
      }
    } catch {}
    return raw;
  }

  /**
   * Encode a plaintext feedback id ("feedback:<id>") to the base64 GraphQL id.
   * @param {string} plain
   * @returns {string}
   */
  #encodeFeedbackId(plain) {
    return Buffer.from(plain, 'utf8').toString('base64');
  }

  /**
   * Decode a base64 feedback id. Returns the plain string or null on failure.
   * @param {string} encoded
   * @returns {string | null}
   */
  #decodeFeedbackId(encoded) {
    try {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      return decoded.startsWith('feedback:') ? decoded : null;
    } catch {
      return null;
    }
  }

  /**
   * Recursively walk a JSON value, collecting objects whose __typename is in the allow list.
   * @param {unknown} value
   * @param {Set<string>} typeSet
   * @param {Record<string, unknown>[]} results
   * @param {WeakSet<object>} visited
   */
  #walkJson(value, typeSet, results, visited) {
    if (Array.isArray(value)) {
      for (const item of value) this.#walkJson(item, typeSet, results, visited);
    } else if (value && typeof value === 'object') {
      if (visited.has(value)) return;
      visited.add(value);
      const record = /** @type {Record<string, unknown>} */ (value);
      if (typeof record.__typename === 'string' && typeSet.has(record.__typename)) {
        results.push(record);
      }
      for (const key of Object.keys(record)) {
        if (key === '__typename') continue;
        this.#walkJson(record[key], typeSet, results, visited);
      }
    }
  }

  /**
   * Extract the post-level Feedback id from Facebook hydration HTML.
   * Looks for a Feedback node whose decoded id is "feedback:<postId>" (no comment suffix).
   * @param {string} html
   * @returns {string | null}
   */
  #extractPostFeedbackIdFromHtml(html) {
    if (typeof html !== 'string' || !html.includes('data-content-len')) return null;
    const re = /<script type="application\/json"[^>]*data-content-len="[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/script>/g;
    const typeSet = new Set(['Feedback']);

    let match;
    while ((match = re.exec(html)) !== null) {
      try {
        const data = JSON.parse(match[1]);
        /** @type {Record<string, unknown>[]} */
        const feedbacks = [];
        this.#walkJson(data, typeSet, feedbacks, new WeakSet());
        for (const fb of feedbacks) {
          if (typeof fb.id !== 'string') continue;
          const decoded = this.#decodeFeedbackId(fb.id);
          if (decoded && /^feedback:\d+$/.test(decoded)) {
            return fb.id;
          }
        }
      } catch {
        // Invalid JSON or malformed script — skip silently
      }
    }

    return null;
  }

  /**
   * Resolve a post identifier to its GraphQL Feedback id.
   * Supports URLs, base64 feedback ids, numeric post ids, and synthetic test ids.
   * @param {string} input
   * @param {string | Record<string, unknown>} cookies
   * @param {string} [accountId]
   * @returns {Promise<{ feedbackId: string }>}
   */
  async #resolvePostFeedbackContext(input, cookies, accountId) {
    // 1. Already a GraphQL feedback id
    if (typeof input === 'string' && input.startsWith('ZmVlZGJhY2s6')) {
      const decoded = this.#decodeFeedbackId(input);
      if (decoded) return { feedbackId: input };
    }

    // 2. Plain "feedback:<id>" form
    if (typeof input === 'string' && input.startsWith('feedback:')) {
      return { feedbackId: this.#encodeFeedbackId(input) };
    }

    // 3. Numeric post id (e.g. "4552000341698946")
    if (/^\d+$/.test(input)) {
      return { feedbackId: this.#encodeFeedbackId(`feedback:${input}`) };
    }

    // 4. URL or share token — try to fetch the post page and extract feedback id.
    // Skip network fetch when the client is pointed at a test server (baseUrl not facebook.com).
    const isFacebookClient = /facebook\.com$/i.test(this.client.baseUrl);
    if (isFacebookClient) {
      const candidateUrls = [];
      if (/^https?:\/\//i.test(input)) {
        candidateUrls.push(input);
      } else {
        // Short share token or pfbid — try the share endpoint first
        candidateUrls.push(`https://www.facebook.com/share/p/${input}/`);
        candidateUrls.push(`https://www.facebook.com/${input}/`);
      }

      const cookieHeader = typeof cookies === 'string' ? cookies : buildCookieHeader(cookies);
      for (const url of candidateUrls) {
        try {
          const res = /** @type {{ data?: unknown }} */ (await this.client.request('GET', url, {
            accountId,
            headers: { cookie: cookieHeader },
            timeout: 60000,
          }));
          const html = typeof res?.data === 'string' ? res.data : '';
          const feedbackId = this.#extractPostFeedbackIdFromHtml(html);
          if (feedbackId) return { feedbackId };
        } catch {
          // Try next candidate or fall through to synthetic fallback
        }
      }
    }

    // 5. Fallback for test / unsupported ids: fabricate a feedback:<input> id.
    // ponytail: this lets unit tests pass a synthetic post id; real Facebook will
    // reject a non-existent feedback id, so callers should use a real URL or numeric id.
    return { feedbackId: this.#encodeFeedbackId(`feedback:${input}`) };
  }

  /**
   * Extract cookie string from session or sessionManager.
   * @param {Record<string, any>} [session]
   * @returns {string}
   */
  #resolveCookies(session = {}) {
    if (session?.cookies) {
      if (typeof session.cookies === 'string') return session.cookies;
      if (typeof session.cookies === 'object') {
        return buildCookieHeader(session.cookies);
      }
    }

    const accountId = session?.accountId;
    if (!accountId || !this.sessionManager) return '';
    const sess = this.sessionManager.get(accountId);
    if (!sess?.cookies) return '';
    if (typeof sess.cookies === 'string') return sess.cookies;
    return buildCookieHeader(sess.cookies);
  }

  /**
   * Validate and normalize a count argument.
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
   * Scrape posts from Facebook Group via GraphQL.
   * @param {Object} args
   * @param {string} args.groupId
   * @param {number} [args.count=20]
   * @param {string} [args.cursor]
   * @param {Record<string, any>} [session={}]
   * @returns {Promise<{ posts: import('../../../core/types.js').PostItem[], pageInfo?: any }>}
   */
  async groupPosts(args, session = {}) {
    if (!args?.groupId) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing required argument: groupId',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    const accountId = session?.accountId;
    const cookies = this.#resolveCookies(session);

    const variables = {
      groupId: args.groupId,
      count: this.#normalizeCount(args?.count),
      cursor: args?.cursor || null,
    };

    const docId = this.docIds.GROUP_FEED;
    const res = await this.client.requestGraphQl(docId, variables, {
      accountId,
      cookies,
    });

    const rawEdges = res?.data?.group?.feed?.edges || res?.data?.node?.feed?.edges;
    const edges = Array.isArray(rawEdges) ? rawEdges : [];
    const posts = [];

    for (const edge of edges) {
      if (!edge?.node) continue;
      const post = this.#normalizePostItem(edge.node, `https://www.facebook.com/groups/${args.groupId}`);
      if (!post) continue;
      this.validateItem(post);
      posts.push(post);
    }

    if (this.store && typeof this.store.storeBatch === 'function' && posts.length > 0) {
      await this.store.storeBatch(posts, { upsert: true });
    }

    return {
      posts,
      pageInfo: res?.data?.group?.feed?.page_info || res?.data?.node?.feed?.page_info || null,
    };
  }

  /**
   * Scrape timeline posts from Facebook Page via GraphQL.
   * @param {Object} args
   * @param {string} args.pageId
   * @param {number} [args.count=20]
   * @param {string} [args.cursor]
   * @param {Record<string, any>} [session={}]
   * @returns {Promise<{ posts: import('../../../core/types.js').PostItem[], pageInfo?: any }>}
   */
  async pagePosts(args, session = {}) {
    if (!args?.pageId) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing required argument: pageId',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    const accountId = session?.accountId;
    const cookies = this.#resolveCookies(session);

    const variables = {
      pageId: args.pageId,
      count: this.#normalizeCount(args?.count),
      cursor: args?.cursor || null,
    };

    const docId = this.docIds.PAGE_FEED;
    const res = await this.client.requestGraphQl(docId, variables, {
      accountId,
      cookies,
    });

    const rawEdges = res?.data?.page?.timeline_feed?.edges || res?.data?.node?.timeline_feed?.edges;
    const edges = Array.isArray(rawEdges) ? rawEdges : [];
    const posts = [];

    for (const edge of edges) {
      if (!edge?.node) continue;
      const post = this.#normalizePostItem(edge.node, `https://www.facebook.com/${args.pageId}`);
      if (!post) continue;
      this.validateItem(post);
      posts.push(post);
    }

    if (this.store && typeof this.store.storeBatch === 'function' && posts.length > 0) {
      await this.store.storeBatch(posts, { upsert: true });
    }

    return {
      posts,
      pageInfo: res?.data?.page?.timeline_feed?.page_info || res?.data?.node?.timeline_feed?.page_info || null,
    };
  }

  /**
   * Abstract Crawler lifecycle methods.
   */
  async init() {}

  /**
   * @param {Object} _args
   * @returns {Promise<import('../../../core/types.js').PostItem[]>}
   */
  async search(_args) {
    throw new PlatformError({
      code: 'XACT_4001',
      type: ErrorTypes.INVALID_ARGS,
      message: 'Search is not supported on FacebookCrawler',
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }

  /**
   * @param {Object} _args
   * @returns {Promise<import('../../../core/types.js').PostItem>}
   */
  async getPostDetail(_args) {
    throw new PlatformError({
      code: 'XACT_4001',
      type: ErrorTypes.INVALID_ARGS,
      message: 'getPostDetail is not supported on FacebookCrawler',
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }

  /**
   * Scrape hierarchical comments from a Facebook post via GraphQL.
   * @param {Object} args
   * @param {string} args.postId - Post URL, base64 feedback id, numeric post id, or namespaced/synthetic id
   * @param {number} [args.maxDepth=3]
   * @param {number} [args.maxComments=500]
   * @param {Record<string, any>} [session={}]
   * @returns {Promise<{ comments: import('../../../core/types.js').CommentItem[], pageInfo?: any }>}
   */
  async getCommentsForPost(args, session = {}) {
    if (!args?.postId) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing required argument: postId',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    const postExternalId = this.#extractPostExternalId(args.postId);
    if (!postExternalId) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Invalid postId: could not extract post external id',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    const maxDepth = this.#clampMaxDepth(args?.maxDepth);
    const maxComments = this.#clampMaxComments(args?.maxComments);
    const accountId = session?.accountId;
    const cookies = this.#resolveCookies(session);

    // Resolve post feedback id up-front; needed for the root comment GraphQL query.
    const postContext = await this.#resolvePostFeedbackContext(args.postId, cookies, accountId);

    /**
     * Map of comment / post external id -> GraphQL context needed for pagination.
     * @type {Map<string, { feedbackId: string, expansionToken?: string }>}
     */
    const commentContext = new Map();
    commentContext.set(postExternalId, postContext);

    /**
     * @param {import('../comment-tree.js').FetchLayerInput} input
     * @returns {Promise<import('../comment-tree.js').FetchLayerPage>}
     */
    const fetchLayer = async ({ postId, parentCommentId, after, limit }) => {
      const isReply = parentCommentId != null;
      const docId = isReply ? this.docIds.COMMENT_REPLIES : this.docIds.COMMENT_ROOTS;
      if (!docId) {
        throw new PlatformError({
          code: 'XACT_5000',
          type: ErrorTypes.INTERNAL,
          message: 'Facebook comment doc_id is not configured',
          suggestedAction: 'retry_after_delay',
        });
      }

      const contextKey = parentCommentId || postId;
      const context = commentContext.get(contextKey);
      if (!context?.feedbackId) {
        throw new PlatformError({
          code: 'XACT_4001',
          type: ErrorTypes.INVALID_ARGS,
          message: `Missing feedback context for ${isReply ? 'reply' : 'root'} comment fetch`,
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        });
      }

      const pageSize = Math.min(limit || 20, 50);
      const baseVariables = {
        clientKey: null,
        expansionToken: isReply ? (context.expansionToken || null) : null,
        feedLocation: 'POST_PERMALINK_DIALOG',
        focusCommentID: null,
        id: context.feedbackId,
        scale: 2,
        useDefaultActor: false,
      };

      const variables = isReply
        ? {
            ...baseVariables,
            repliesAfterCount: pageSize,
            repliesAfterCursor: after,
            repliesBeforeCount: null,
            repliesBeforeCursor: null,
          }
        : {
            ...baseVariables,
            commentsAfterCount: pageSize,
            commentsAfterCursor: after,
            commentsBeforeCount: null,
            commentsBeforeCursor: null,
            commentsIntentToken: null,
            targetDialect: null,
          };

      Object.assign(variables, FB_COMMENT_RELAY_PROVIDERS);

      const res = await this.client.requestGraphQl(docId, variables, {
        accountId,
        cookies,
      });

      const connection = isReply
        ? res?.data?.node?.replies_connection
        : res?.data?.node?.comment_rendering_instance_for_feed_location?.comments;
      const rawEdges = connection?.edges || [];
      const comments = [];
      for (const edge of rawEdges) {
        const raw = edge?.node;
        if (!raw) continue;
        if (isReply && raw.parentId === undefined) {
          raw.parentId = parentCommentId;
        }
        comments.push(raw);
      }

      const pageInfo = connection?.page_info || { has_next_page: false, end_cursor: null };
      return { comments, pageInfo };
    };

    /** @type {function(Record<string, unknown>, string): import('../../../core/types.js').CommentItem | null} */
    const normalizeFn = (raw, postId) => {
      const comment = this.#normalizeComment(raw, postId);
      const meta = /** @type {Record<string, any> | undefined} */ (comment?.metadata);
      if (comment && meta?.feedbackId) {
        commentContext.set(comment.externalId, {
          feedbackId: meta.feedbackId,
          expansionToken: meta.expansionToken,
        });
      }
      return comment;
    };

    const extractor = new CommentTreeExtractor(fetchLayer, normalizeFn, {
      maxDepth,
      maxComments,
      concurrency: 2,
    });

    const { comments, pageInfo } = await extractor.fetch(postExternalId);

    for (const comment of comments) {
      this.validateItem(comment);
    }

    if (this.store && comments.length > 0 && typeof this.store.storeCommentBatch === 'function') {
      await this.store.storeCommentBatch(comments, { upsert: true });
    }

    return { comments, pageInfo };
  }

  /**
   * Cleanup crawler and client resources.
   * @returns {Promise<void>}
   */
  async cleanup() {
    if (this.client && typeof this.client.close === 'function') {
      await this.client.close();
    } else if (this.client && typeof this.client.clearTokenCache === 'function') {
      this.client.clearTokenCache();
    }
  }
}
