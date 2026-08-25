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

export const DEFAULT_FB_DOC_IDS = {
  GROUP_FEED: 'group_feed_doc_123',
  PAGE_FEED: 'page_feed_doc_456',
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
   */
  constructor(deps = {}) {
    const { client: explicitClient, ...clientDeps } = deps;
    const client = explicitClient || new FacebookClient(/** @type {any} */ (clientDeps));
    super({
      ...deps,
      client,
      requiresAuth: true,
    });

    this.client = client;
    this.docIds = {
      ...DEFAULT_FB_DOC_IDS,
      ...(deps.docIds || {}),
    };

    // Register standard actions in ActionRegistry
    this.registerAction(/** @type {any} */ ({
      action: 'group_posts',
      description: 'Scrape posts and updates from a Facebook Group using GraphQL',
      category: 'social',
      args: {
        groupId: { type: 'string', required: true, description: 'Facebook Group ID or vanity name' },
        count: { type: 'number', required: false, default: 20, description: 'Max posts to retrieve' },
        cursor: { type: 'string', required: false, description: 'Pagination end cursor' },
      },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.groupPosts(args, session),
    }));

    this.registerAction(/** @type {any} */ ({
      action: 'page_posts',
      description: 'Scrape timeline posts from a Facebook Page using GraphQL',
      category: 'social',
      args: {
        pageId: { type: 'string', required: true, description: 'Facebook Page ID or handle' },
        count: { type: 'number', required: false, default: 20, description: 'Max posts to retrieve' },
        cursor: { type: 'string', required: false, description: 'Pagination end cursor' },
      },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.pagePosts(args, session),
    }));
  }

  /**
   * Normalize raw Facebook GraphQL node into uniform PostItem.
   * @param {Record<string, any>} node
   * @param {string} [parentContextUrl='']
   * @returns {import('../../../core/types.js').PostItem}
   */
  #normalizePostItem(node, parentContextUrl = '') {
    const postId = String(node.id || node.post_id || '');
    const authorActor = Array.isArray(node.actors) && node.actors.length > 0 ? node.actors[0] : null;
    const authorId = authorActor ? String(authorActor.id || '') : '';
    const authorName = authorActor ? String(authorActor.name || '') : '';

    const content = node.message?.text || node.story?.text || node.text || '';
    const likesCount = Number(node.feedback?.reaction_count?.count || node.reaction_count || 0);
    const repliesCount = Number(node.feedback?.comment_count?.total_count || node.comment_count || 0);
    const repostsCount = Number(node.feedback?.share_count?.count || node.share_count || 0);

    const mediaUrls = [];
    if (Array.isArray(node.attachments)) {
      for (const att of node.attachments) {
        const uri = att.media?.image?.uri || att.media?.photo_image?.uri || att.url;
        if (uri) mediaUrls.push(uri);
      }
    }

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
      crawledAt: new Date(),
      metadata: {
        creationTime: node.creation_time || null,
      },
    };

    return post;
  }

  /**
   * Extract cookie string from session or sessionManager.
   * @param {string} [accountId]
   * @returns {string}
   */
  #getCookiesForAccount(accountId) {
    if (!accountId || !this.sessionManager) return '';
    const sess = this.sessionManager.get(accountId);
    if (!sess?.cookies) return '';
    if (typeof sess.cookies === 'string') return sess.cookies;
    return Object.entries(sess.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
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
    const cookies = this.#getCookiesForAccount(accountId);

    const variables = {
      groupId: args.groupId,
      count: args.count || 20,
      cursor: args.cursor || null,
    };

    const docId = this.docIds.GROUP_FEED;
    const res = await this.client.requestGraphQl(docId, variables, {
      accountId,
      cookies,
    });

    const edges = res?.data?.group?.feed?.edges || res?.data?.node?.feed?.edges || [];
    const posts = [];

    for (const edge of edges) {
      if (!edge?.node) continue;
      const post = this.#normalizePostItem(edge.node, `https://www.facebook.com/groups/${args.groupId}`);
      this.validateItem(post);
      posts.push(post);
    }

    if (this.store && typeof this.store.storeBatch === 'function' && posts.length > 0) {
      await this.store.storeBatch(posts, { upsert: true });
    }

    return {
      posts,
      pageInfo: res?.data?.group?.feed?.page_info || null,
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
    const cookies = this.#getCookiesForAccount(accountId);

    const variables = {
      pageId: args.pageId,
      count: args.count || 20,
      cursor: args.cursor || null,
    };

    const docId = this.docIds.PAGE_FEED;
    const res = await this.client.requestGraphQl(docId, variables, {
      accountId,
      cookies,
    });

    const edges = res?.data?.page?.timeline_feed?.edges || res?.data?.node?.timeline_feed?.edges || [];
    const posts = [];

    for (const edge of edges) {
      if (!edge?.node) continue;
      const post = this.#normalizePostItem(edge.node, `https://www.facebook.com/${args.pageId}`);
      this.validateItem(post);
      posts.push(post);
    }

    if (this.store && typeof this.store.storeBatch === 'function' && posts.length > 0) {
      await this.store.storeBatch(posts, { upsert: true });
    }

    return {
      posts,
      pageInfo: res?.data?.page?.timeline_feed?.page_info || null,
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
   * @param {Object} _args
   * @returns {Promise<import('../../../core/types.js').CommentItem[]>}
   */
  async getComments(_args) {
    throw new PlatformError({
      code: 'XACT_4001',
      type: ErrorTypes.INVALID_ARGS,
      message: 'getComments is not supported on FacebookCrawler',
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }

  /**
   * Cleanup crawler and client resources.
   * @returns {Promise<void>}
   */
  async cleanup() {
    // Release any allocated resources
  }
}
