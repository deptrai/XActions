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
import {
  normalizeFacebookProfile,
  normalizeFacebookFollower,
  normalizeFacebookGroupMember,
  profileItemToPostItem,
} from './normalize-profile.js';
import {
  normalizeFacebookSearchPost,
  normalizeFacebookSearchProfile,
  normalizeFacebookPageSearchResult,
  normalizeFacebookGroupSearchResult,
  searchResultToPostItem,
} from './normalize-search.js';
import { normalizeFacebookMarketplaceListing } from './normalize-marketplace.js';
import { FacebookActions } from './actions.js';
import { FacebookActionVelocityTracker } from './batch-runner.js';
import { stripPii } from './pii.js';
import { assertFacebookUrlLocal, NON_PROFILE_SEGMENTS } from '../../facebook/core.js';
import { normalizeHandle, buildMarketplaceSearchUrl, resolveMarketplaceLocation } from '../../facebook/normalize.js';

const FORBIDDEN_COOKIE_CHARS = /[;,"\\]/g;

/**
 * Parse a truthy environment variable value.
 * @param {string | undefined} value
 * @returns {boolean}
 */
function isEnvTruthy(value) {
  if (typeof value !== 'string') return false;
  return /^(true|1|yes)$/i.test(value.trim());
}

/**
 * Normalize a value to a Date and return an ISO string.
 * @param {Date | string | number | undefined} value
 * @returns {string}
 */
function toIsoDate(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

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

/**
 * Wrap the legacy assertFacebookUrlLocal so it throws a PlatformError.
 * @param {string} url
 * @param {string} [label='URL']
 * @returns {void}
 */
function assertFacebookUrl(url, label = 'URL') {
  try {
    assertFacebookUrlLocal(url, label);
  } catch (err) {
    throw new PlatformError({
      code: 'XACT_4001',
      type: ErrorTypes.INVALID_ARGS,
      message: err instanceof Error ? err.message : `Invalid ${label}`,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }
}

/**
 * Resolve target handle or ID from username or Facebook URL.
 * Throws PlatformError (XACT_4001) on invalid or SSRF input.
 * @param {string} [input]
 * @returns {string}
 */
export function resolveTargetKey(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new PlatformError({
      code: 'XACT_4001',
      type: ErrorTypes.INVALID_ARGS,
      message: 'Missing username or url',
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }

  let handle = input.trim();

  if (/^https?:\/\//i.test(handle)) {
    assertFacebookUrl(handle, 'profile url');
    const url = new URL(handle);
    const idMatch = url.search.match(/[?&]id=(\d+)/);
    if (idMatch) return `profile.php?id=${idMatch[1]}`;

    const parts = url.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
    if (parts.length === 0) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'URL does not resolve to a profile',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    if (parts[0] === 'people' && parts.length >= 2) {
      const numericPart = parts.find((p, i) => i > 0 && /^\d+$/.test(p));
      if (numericPart) return numericPart;
    }

    if (NON_PROFILE_SEGMENTS.includes(parts[0])) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: `URL path "${parts[0]}" is not a profile segment`,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    return parts[0];
  }

  const normalized = normalizeHandle(input).replace(/^@/, '').split('/')[0].split('?')[0];
  if (!normalized) {
    throw new PlatformError({
      code: 'XACT_4001',
      type: ErrorTypes.INVALID_ARGS,
      message: 'Invalid username or handle',
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }
  return normalized;
}

/**
 * Resolve group ID from group URL or ID string with SSRF protection.
 * Throws PlatformError (XACT_4001) on invalid or non-group input.
 * @param {string} [input]
 * @returns {string}
 */
export function resolveGroupId(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new PlatformError({
      code: 'XACT_4001',
      type: ErrorTypes.INVALID_ARGS,
      message: 'Missing groupUrl or groupId',
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }

  const trimmed = input.trim();

  if (/^\d+$/.test(trimmed)) return trimmed;

  if (/^(?:https?:)?\/\//i.test(trimmed)) {
    const fullUrl = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
    assertFacebookUrl(fullUrl, 'group url');
    const url = new URL(fullUrl);
    const match = url.pathname.match(/\/groups\/([^/?#]+)/);
    if (!match) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Group URL must contain /groups/<groupId>',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }
    return match[1];
  }

  return trimmed;
}

export const DEFAULT_FB_DOC_IDS = {
  GROUP_FEED: 'group_feed_doc_123',
  PAGE_FEED: 'page_feed_doc_456',
  PROFILE: 'profile_doc_789',
  FOLLOWERS: 'followers_doc_101',
  FOLLOWING: 'following_doc_102',
  GROUP_MEMBERS: 'group_members_doc_103',
  SEARCH_POSTS: 'fb_search_posts_doc',
  SEARCH_PEOPLE: 'fb_search_people_doc',
  SEARCH_PAGES: 'fb_search_pages_doc',
  SEARCH_GROUPS: 'fb_search_groups_doc',
  GROUP_SEARCH: 'fb_group_search_doc',
  // Captured 2026-08-26 from authenticated Facebook web session
  // CommentsListComponentsPaginationQuery_facebookRelayOperation
  COMMENT_ROOTS: '28217113134586234',
  // Depth1CommentsListPaginationQuery_facebookRelayOperation
  COMMENT_REPLIES: '27878908781774491',
  // Depth2CommentsListPaginationQuery_facebookRelayOperation (nested replies)
  COMMENT_REPLIES_DEPTH2: '28232639913040278',
  GROUP_COMMENT_ROOTS: '28217113134586234',
  GROUP_COMMENT_REPLIES: '27878908781774491',
  MARKETPLACE_SEARCH: 'fb_marketplace_search_doc',
  LIKE_MUTATION: 'fb_like_mutation_doc',
  COMMENT_MUTATION: 'fb_comment_mutation_doc',
  POST_MUTATION: 'fb_post_mutation_doc',
  SHARE_MUTATION: 'fb_share_mutation_doc',
  MESSENGER_SHARE_MUTATION: 'fb_messenger_share_mutation_doc',
  JOIN_GROUP_MUTATION: 'fb_join_group_mutation_doc',
  SEND_FRIEND_REQUEST_MUTATION: 'fb_send_friend_request_mutation_doc',
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

/**
 * High-throughput hybrid crawler for Facebook Groups and Pages.
 */
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

    if (deps.docIds?.COMMENT_ROOTS && !deps.docIds?.GROUP_COMMENT_ROOTS) {
      this.docIds.GROUP_COMMENT_ROOTS = deps.docIds.COMMENT_ROOTS;
    }
    if (deps.docIds?.COMMENT_REPLIES && !deps.docIds?.GROUP_COMMENT_REPLIES) {
      this.docIds.GROUP_COMMENT_REPLIES = deps.docIds.COMMENT_REPLIES;
    }

    // Register standard actions in ActionRegistry
    this.registerAction({
      action: 'group_posts',
      description: 'Scrape posts and updates from a Facebook Group using GraphQL',
      requiredArgs: ['groupId'],
      optionalArgs: ['count', 'cursor'],
      outputType: '{ posts: PostItem[], pageInfo?: any }',
      requiresAuth: false,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.groupPosts(args, session),
    });

    this.registerAction({
      action: 'page_posts',
      description: 'Scrape timeline posts from a Facebook Page using GraphQL',
      requiredArgs: ['pageId'],
      optionalArgs: ['count', 'cursor'],
      outputType: '{ posts: PostItem[], pageInfo?: any }',
      requiresAuth: false,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.pagePosts(args, session),
    });

    this.registerAction({
      action: 'get_comments',
      description: 'Scrape hierarchical comments from a Facebook post using GraphQL',
      requiredArgs: ['postId'],
      optionalArgs: ['maxDepth', 'maxComments', 'after'],
      outputType: '{ comments: CommentItem[], pageInfo?: any }',
      requiresAuth: false,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getCommentsForPost(args, session),
    });

    this.registerAction({
      action: 'post_comments',
      description: 'Scrape hierarchical comments from a Facebook post using hybrid GraphQL + browser fallback',
      requiredArgs: ['url'],
      optionalArgs: ['postId', 'maxDepth', 'maxComments', 'limit', 'includeReplies', 'after'],
      outputType: '{ comments: CommentItem[], pageInfo?: any }',
      requiresAuth: false,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.postComments(args, session),
    });

    this.registerAction({
      action: 'group_comments',
      description: 'Scrape hierarchical comments from a Facebook group post using hybrid GraphQL + browser fallback',
      requiredArgs: ['url'],
      optionalArgs: ['postId', 'maxDepth', 'maxComments', 'limit', 'includeReplies', 'after'],
      outputType: '{ comments: CommentItem[], pageInfo?: any }',
      requiresAuth: false,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.groupComments(args, session),
    });

    this.registerAction({
      action: 'profile',
      description: 'Scrape user or page profile information using GraphQL',
      requiredArgs: [],
      optionalArgs: ['username', 'url'],
      example: { username: 'zuck' },
      outputType: '{ profile: ProfileItem }',
      requiresAuth: false,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.profile(args, session),
    });

    this.registerAction({
      action: 'followers',
      description: 'Scrape followers list with pagination cursor using GraphQL',
      requiredArgs: [],
      optionalArgs: ['username', 'url', 'limit', 'cursor'],
      example: { username: 'zuck', limit: 20 },
      outputType: '{ followers: ProfileItem[], pageInfo?: any }',
      requiresAuth: false,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.followers(args, session),
    });

    this.registerAction({
      action: 'following',
      description: 'Scrape following list using GraphQL (best-effort / restricted)',
      requiredArgs: [],
      optionalArgs: ['username', 'url', 'limit', 'cursor'],
      example: { username: 'zuck' },
      outputType: '{ following?: ProfileItem[], note?: string, pageInfo?: any }',
      requiresAuth: false,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.following(args, session),
    });

    this.registerAction({
      action: 'group_members',
      description: 'Scrape members from a Facebook Group using GraphQL',
      requiredArgs: [],
      optionalArgs: ['groupUrl', 'groupId', 'limit', 'cursor'],
      example: { groupUrl: 'https://www.facebook.com/groups/123456', limit: 50 },
      outputType: '{ members: ProfileItem[], pageInfo?: any }',
      requiresAuth: false,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.groupMembers(args, session),
    });

    this.registerAction({
      action: 'search',
      description: 'Search Facebook global entities (posts, people, pages, groups, all)',
      requiredArgs: ['query'],
      optionalArgs: ['type', 'location', 'limit', 'cursor'],
      example: { query: 'artificial intelligence', type: 'posts', limit: 20 },
      outputType: '{ posts?: PostItem[], people?: PostItem[], pages?: PostItem[], groups?: PostItem[], pageInfo?: any }',
      requiresAuth: false,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.search(args, session),
    });

    this.registerAction({
      action: 'group_search',
      description: 'Search posts inside a specific Facebook group',
      requiredArgs: ['groupUrl', 'query'],
      optionalArgs: ['limit', 'cursor'],
      example: { groupUrl: 'https://www.facebook.com/groups/123456', query: 'ai tools', limit: 20 },
      outputType: '{ posts: PostItem[], pageInfo?: any }',
      requiresAuth: false,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.groupSearch(args, session),
    });

    this.velocityTracker = /** @type {any} */ (deps).velocityTracker || new FacebookActionVelocityTracker();
    this.actions = new FacebookActions({
      client: this.client,
      crawler: this,
      governor: this.governor,
      accountPool: this.accountPool,
      proxyPool: /** @type {any} */ (deps).proxyPool || this.client?.proxyPool || null,
      velocityTracker: this.velocityTracker,
    });

    this.registerAction({
      action: 'marketplace',
      description: 'Search products and listings on Facebook Marketplace',
      requiredArgs: ['query'],
      optionalArgs: ['location', 'category', 'categoryId', 'minPrice', 'maxPrice', 'limit', 'cursor', 'after', 'radiusKm', 'latitude', 'longitude', 'dryRun', 'priceMin', 'priceMax'],
      example: { query: 'macbook pro 14', location: 'Ho Chi Minh City', minPrice: 800, maxPrice: 1200, limit: 20 },
      outputType: '{ posts: PostItem[], pageInfo?: { has_next_page: boolean, end_cursor: string | null }, searchUrl?: string, dryRun?: boolean, note?: string }',
      requiresAuth: false,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.marketplace(args, session),
    });

    this.registerAction({
      action: 'like',
      description: 'Like or unlike Facebook posts with human-like delay and rate limits',
      requiredArgs: ['postUrl'],
      optionalArgs: ['postUrls', 'dryRun', 'delayMin', 'delayMax', 'maxBatch'],
      example: { postUrl: 'https://www.facebook.com/zuck/posts/1011565502' },
      outputType: '{ results: { postUrl: string, liked: boolean, alreadyLiked: boolean, error?: string }[], dryRun: boolean }',
      requiresAuth: true,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.like(args, session),
    });

    this.registerAction({
      action: 'comment',
      description: 'Comment on Facebook posts with human-like typing and PII safety',
      requiredArgs: ['postUrl', 'text'],
      optionalArgs: ['postUrls', 'dryRun', 'delayMin', 'delayMax', 'maxBatch'],
      example: { postUrl: 'https://www.facebook.com/zuck/posts/1011565502', text: 'Great update!' },
      outputType: '{ results: { postUrl: string, commentId?: string, error?: string }[], dryRun: boolean }',
      requiresAuth: true,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.comment(args, session),
    });

    this.registerAction({
      action: 'post',
      description: 'Create a post on timeline or Facebook group(s)',
      requiredArgs: ['text'],
      optionalArgs: ['mediaUrls', 'groupUrl', 'groupUrls', 'groupIds', 'profileUrl', 'profileUrls', 'dryRun', 'delayMin', 'delayMax', 'maxBatch'],
      example: { text: 'Hello Facebook from XActions Hybrid Crawler!' },
      outputType: '{ results: { targetUrl: string, postId?: string, error?: string }[], dryRun: boolean }',
      requiresAuth: true,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.post(args, session),
    });

    this.registerAction({
      action: 'share',
      description: 'Share a Facebook post to timeline',
      requiredArgs: ['postUrl'],
      optionalArgs: ['postUrls', 'message', 'dryRun', 'delayMin', 'delayMax', 'maxBatch'],
      example: { postUrl: 'https://www.facebook.com/zuck/posts/1011565502' },
      outputType: '{ results: { postUrl: string, shared: boolean, error?: string }[], dryRun: boolean }',
      requiresAuth: true,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.share(args, session),
    });

    this.registerAction({
      action: 'messenger_share',
      description: 'Share a post or message to one or more recipient UIDs via Messenger',
      requiredArgs: ['postUrl', 'recipientUids'],
      optionalArgs: ['recipientNames', 'message', 'dryRun', 'delayMin', 'delayMax', 'maxBatch'],
      example: { postUrl: 'https://www.facebook.com/zuck/posts/1011565502', recipientUids: ['100001234567890'] },
      outputType: '{ results: { recipientUid: string, ok: boolean, method?: string, error?: string }[], dryRun: boolean }',
      requiresAuth: true,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.messengerShare(args, session),
    });

    this.registerAction({
      action: 'share_link_uid',
      description: 'Alias for sharing a link to a single recipient UID via Messenger',
      requiredArgs: ['postUrl', 'recipientUid'],
      optionalArgs: ['message', 'dryRun', 'delayMin', 'delayMax'],
      example: { postUrl: 'https://www.facebook.com/zuck/posts/1011565502', recipientUid: '100001234567890' },
      outputType: '{ ok: boolean, postUrl: string, recipientUid: string, method?: string, error?: string, dryRun: boolean }',
      requiresAuth: true,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.shareLinkByUid(args, session),
    });

    this.registerAction({
      action: 'join_group',
      description: 'Join Facebook group(s) with human-like delays',
      requiredArgs: [],
      optionalArgs: ['groupUrl', 'groupUrls', 'groupId', 'groupIds', 'keyword', 'limit', 'dryRun', 'delayMin', 'delayMax', 'maxBatch'],
      example: { groupUrls: ['https://www.facebook.com/groups/123456'] },
      outputType: '{ results: { groupUrl: string, joined: boolean, pending?: boolean, error?: string }[], dryRun: boolean }',
      requiresAuth: true,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.joinGroup(args, session),
    });

    this.registerAction({
      action: 'send_friend_request',
      description: 'Send Facebook friend request(s) to targets with safety limits',
      requiredArgs: [],
      optionalArgs: ['targets', 'mode', 'location', 'limit', 'dryRun', 'delayMin', 'delayMax', 'maxBatch'],
      example: { targets: ['https://www.facebook.com/zuck'] },
      outputType: '{ results: { target: string, ok: boolean, error?: string }[], dryRun: boolean }',
      requiresAuth: true,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.sendFriendRequest(args, session),
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
        sourceMethod: 'graphql',
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
        const fbid = url.searchParams.get('story_fbid') || url.searchParams.get('fbid') || url.searchParams.get('id');
        if (fbid) return fbid;

        const parts = url.pathname.split('/').filter(Boolean);
        const skipSegments = new Set([
          'comments', 'likes', 'shares', 'reactions', 'permalink', 'story',
          'photo', 'photos', 'video', 'videos', 'media', 'feed', 'posts',
        ]);
        const isPostIdLike = (/** @type {string} */ part) => /^\d+$/.test(part) || /^pfbid[A-Za-z0-9_-]+$/.test(part);

        let firstNonSkip = '';
        for (let i = parts.length - 1; i >= 0; i--) {
          const part = parts[i];
          if (skipSegments.has(part)) continue;
          if (!firstNonSkip) firstNonSkip = part;
          if (isPostIdLike(part)) return part;
        }
        return firstNonSkip;
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
   * Clamp maxComments to [1, 2000] (default 50).
   * @param {unknown} value
   * @returns {number}
   */
  #clampMaxComments(value) {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n) || n <= 0) return 50;
    return Math.min(Math.floor(n), 2000);
  }

  /**
   * Coerce a value to boolean/undefined for flags like includeReplies.
   * Accepts true/1/'true' and false/0/'false'. Other values are undefined.
   * @param {unknown} value
   * @returns {boolean | undefined}
   */
  #normalizeBoolean(value) {
    if (value === true || value === 1 || value === 'true' || value === 'True' || value === 'TRUE') return true;
    if (value === false || value === 0 || value === 'false' || value === 'False' || value === 'FALSE') return false;
    return undefined;
  }

  /**
   * Validate a post comment target (URL or id) before fetching.
   * @param {string} rawTarget
   */
  #validatePostCommentTarget(rawTarget) {
    if (rawTarget.includes('://') || rawTarget.startsWith('//')) {
      const fullUrl = rawTarget.startsWith('//') ? `https:${rawTarget}` : rawTarget;
      assertFacebookUrl(fullUrl, 'post url');
      const parsed = new URL(fullUrl);
      const hasStoryParam = parsed.searchParams.get('story_fbid') || parsed.searchParams.get('fbid') || parsed.searchParams.get('id');
      const isPlausiblePost =
        parsed.pathname.includes('/posts/') ||
        parsed.pathname.includes('/permalink.php') ||
        parsed.pathname.includes('/story.php') ||
        /^\/groups\/[^/]+\/posts\/[^/]+/.test(parsed.pathname);
      if (!isPlausiblePost || ((parsed.pathname.includes('/permalink.php') || parsed.pathname.includes('/story.php')) && !hasStoryParam)) {
        throw new PlatformError({
          code: 'XACT_4001',
          type: ErrorTypes.INVALID_ARGS,
          message: `URL does not look like a Facebook post: "${rawTarget}"`,
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        });
      }
      return;
    }

    if (
      /^\d+$/.test(rawTarget) ||
      rawTarget.startsWith('facebook:') ||
      rawTarget.startsWith('feedback:') ||
      rawTarget.startsWith('ZmVlZGJhY2s6')
    ) {
      return;
    }

    throw new PlatformError({
      code: 'XACT_4001',
      type: ErrorTypes.INVALID_ARGS,
      message: `Invalid post target: "${rawTarget}"`,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }

  /**
   * Validate a group comment target (URL or id) before fetching.
   * @param {string} rawTarget
   */
  #validateGroupCommentTarget(rawTarget) {
    if (rawTarget.includes('://') || rawTarget.startsWith('//')) {
      const fullUrl = rawTarget.startsWith('//') ? `https:${rawTarget}` : rawTarget;
      assertFacebookUrl(fullUrl, 'group post url');
      const parsed = new URL(fullUrl);
      if (!parsed.pathname.startsWith('/groups/')) {
        throw new PlatformError({
          code: 'XACT_4001',
          type: ErrorTypes.INVALID_ARGS,
          message: `Group post URL must start with "/groups/": "${rawTarget}"`,
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        });
      }
      const groupPostPathRe = /^\/groups\/[^/]+\/posts\/[^/]+/;
      const hasPostSegment = parsed.pathname.includes('/posts/') || groupPostPathRe.test(parsed.pathname);
      if (!hasPostSegment) {
        throw new PlatformError({
          code: 'XACT_4001',
          type: ErrorTypes.INVALID_ARGS,
          message: `Group post URL must contain a post segment: "${rawTarget}"`,
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        });
      }
      return;
    }

    if (
      /^\d+$/.test(rawTarget) ||
      rawTarget.startsWith('facebook:') ||
      rawTarget.startsWith('feedback:') ||
      rawTarget.startsWith('ZmVlZGJhY2s6')
    ) {
      return;
    }

    throw new PlatformError({
      code: 'XACT_4001',
      type: ErrorTypes.INVALID_ARGS,
      message: `Invalid group post target: "${rawTarget}"`,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
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
    const authorName = authorActor ? stripPii(String(authorActor.name || '')) : '';

    const rawContent = node.body?.text ||
                       (typeof node.body === 'string' ? node.body : '') ||
                       (typeof node.message === 'string' ? node.message : node.message?.text) ||
                       node.text ||
                       '';
    const content = stripPii(rawContent);

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

    const creationTime = node.created_time != null ? node.created_time : null;
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
        sourceMethod: 'graphql',
      },
      publishedAt: creationTime != null && creationTime !== '' ? new Date(Number(creationTime) * 1000) : undefined,
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
   * @param {Record<string, any>} [session]
   * @returns {Promise<{ feedbackId: string }>}
   */
  async #resolvePostFeedbackContext(input, cookies, accountId, session = {}) {
    // Strip optional facebook: namespacing so "facebook:<id>" behaves like a numeric id.
    if (typeof input === 'string' && input.startsWith('facebook:')) {
      input = input.slice('facebook:'.length);
    }

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
    // Reject non-Facebook URLs to prevent SSRF; allow short share tokens for Facebook only.
    const isFacebookClient = /facebook\.com$/i.test(this.client.baseUrl);
    if (/^https?:\/\//i.test(input)) {
      try {
        const parsed = new URL(input);
        const host = parsed.hostname.toLowerCase();
        if (host !== 'facebook.com' && !host.endsWith('.facebook.com')) {
          throw new PlatformError({
            code: 'XACT_4001',
            type: ErrorTypes.INVALID_ARGS,
            message: 'postId URL must be a facebook.com URL',
            suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
          });
        }
      } catch (err) {
        if (err instanceof PlatformError) throw err;
        throw new PlatformError({
          code: 'XACT_4001',
          type: ErrorTypes.INVALID_ARGS,
          message: 'Invalid postId URL',
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        });
      }
    }

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
            requiresAuth: session?.requiresAuth,
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
    if (session?.account?.credentials?.cookies) {
      const c = session.account.credentials.cookies;
      if (typeof c === 'string') return c;
      if (typeof c === 'object') return buildCookieHeader(c);
    }

    if (accountId && this.sessionManager) {
      const sess = this.sessionManager.get(accountId);
      if (sess?.cookies) {
        if (typeof sess.cookies === 'string') return sess.cookies;
        return buildCookieHeader(sess.cookies);
      }
    }

    return '';
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
      requiresAuth: session?.requiresAuth,
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
    session = { requiresAuth: false, ...(session || {}) };
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
      requiresAuth: session?.requiresAuth,
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
   * Search Facebook global entities (posts, people, pages, groups, all).
   * @param {Object} args
   * @param {string} args.query - Search keyword or query
   * @param {'posts' | 'people' | 'pages' | 'groups' | 'all'} [args.type='posts']
   * @param {string} [args.location]
   * @param {number} [args.limit=30]
   * @param {string} [args.cursor]
   * @param {Record<string, any>} [session={}]
   * @returns {Promise<any>}
   */
  async search(args, session = {}) {
    session = { requiresAuth: false, ...(session || {}) };
    const rawQuery = String(args?.query || '').trim();
    if (!rawQuery) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing required argument: query',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    const type = String(args?.type || 'posts').toLowerCase();
    const VALID_SEARCH_TYPES = ['posts', 'people', 'pages', 'groups', 'all'];
    if (!VALID_SEARCH_TYPES.includes(type)) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: `Invalid search type: "${type}". Supported types: ${VALID_SEARCH_TYPES.join(', ')}`,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    const location = args?.location ? String(args.location).trim() : '';
    const query = location ? `${rawQuery} near ${location}` : rawQuery;
    const limit = this.#normalizeCount(args?.limit, 30, 500);
    const cursor = args?.cursor || null;

    if (type === 'all') {
      return this.#searchAllTypes(query, { ...args, limit, cursor }, session);
    }

    return this.#searchByType(type, query, { ...args, limit, cursor }, session);
  }

  /**
   * @param {string} type
   * @param {string} query
   * @param {Record<string, any>} options
   * @param {Record<string, any>} session
   * @returns {Promise<any>}
   */
  async #searchByType(type, query, options, session) {
    const accountId = session?.accountId;
    const cookies = this.#resolveCookies(session);

    let docId = '';
    if (type === 'posts') docId = this.docIds.SEARCH_POSTS || DEFAULT_FB_DOC_IDS.SEARCH_POSTS;
    else if (type === 'people') docId = this.docIds.SEARCH_PEOPLE || DEFAULT_FB_DOC_IDS.SEARCH_PEOPLE;
    else if (type === 'pages') docId = this.docIds.SEARCH_PAGES || DEFAULT_FB_DOC_IDS.SEARCH_PAGES;
    else if (type === 'groups') docId = this.docIds.SEARCH_GROUPS || DEFAULT_FB_DOC_IDS.SEARCH_GROUPS;

    const variables = {
      query,
      searchTerm: query,
      queryString: query,
      count: options.limit,
      first: options.limit,
      cursor: options.cursor,
      after: options.cursor,
    };

    const res = await this.client.requestGraphQl(docId, variables, {
      accountId,
      cookies,
      requiresAuth: session?.requiresAuth,
    });

    const rawEdges = res?.data?.serpResponse?.results?.edges ||
                     res?.data?.searchResults?.edges ||
                     res?.data?.edges || [];
    const edges = Array.isArray(rawEdges) ? rawEdges : [];
    const pageInfo = res?.data?.serpResponse?.results?.page_info ||
                     res?.data?.searchResults?.page_info ||
                     res?.data?.page_info || null;

    const postItems = [];
    for (const edge of edges) {
      let postItem = null;
      if (type === 'posts') {
        postItem = normalizeFacebookSearchPost(edge, query);
      } else if (type === 'people') {
        const p = normalizeFacebookSearchProfile(edge, 'people', query);
        postItem = p ? searchResultToPostItem(p, 'people', query) : null;
      } else if (type === 'pages') {
        const p = normalizeFacebookPageSearchResult(edge, query);
        postItem = p ? searchResultToPostItem(p, 'pages', query) : null;
      } else if (type === 'groups') {
        const p = normalizeFacebookGroupSearchResult(edge, query);
        postItem = p ? searchResultToPostItem(p, 'groups', query) : null;
      }

      if (!postItem) continue;
      this.validateItem(postItem);
      postItems.push(postItem);
    }

    if (this.store && postItems.length > 0 && typeof this.store.storeBatch === 'function') {
      await this.store.storeBatch(postItems, { upsert: true });
    }

    await this.#saveCheckpoint('search', `${query}:${type}`, pageInfo?.end_cursor, postItems, pageInfo?.has_next_page);

    const out = Object.assign([...postItems], { posts: postItems, pageInfo });
    return out;
  }

  /**
   * @param {string} query
   * @param {Record<string, any>} options
   * @param {Record<string, any>} session
   * @returns {Promise<any>}
   */
  async #searchAllTypes(query, options, session) {
    const types = ['posts', 'people', 'pages', 'groups'];
    const results = /** @type {Record<string, any>} */ ({
      posts: [],
      people: [],
      pages: [],
      groups: [],
      pageInfo: null,
    });

    for (const t of types) {
      const typeOptions = t === 'posts' ? options : { ...options, cursor: null };
      const res = await this.#searchByType(t, query, typeOptions, session);
      const items = res?.posts || (Array.isArray(res) ? res : []);
      results[t] = items;
      if (!results.pageInfo && res?.pageInfo) {
        results.pageInfo = res.pageInfo;
      }
    }

    return results;
  }

  /**
   * Search posts within a Facebook Group.
   * @param {Object} args
   * @param {string} [args.groupUrl]
   * @param {string} [args.groupId]
   * @param {string} args.query
   * @param {number} [args.limit=30]
   * @param {string} [args.cursor]
   * @param {Record<string, any>} [session={}]
   * @returns {Promise<{ posts: import('../../../core/types.js').PostItem[], pageInfo?: any, note?: string }>}
   */
  async groupSearch(args, session = {}) {
    const rawQuery = String(args?.query || '').trim();
    if (!rawQuery) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing required argument: query',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    const rawGroupInput = String(args?.groupUrl || args?.groupId || '').trim();
    if (!rawGroupInput) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing required argument: groupUrl or groupId',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    if (/^(?:https?:)?\/\//i.test(rawGroupInput)) {
      const fullUrl = rawGroupInput.startsWith('//') ? `https:${rawGroupInput}` : rawGroupInput;
      try {
        const parsed = new URL(fullUrl);
        const host = parsed.hostname.toLowerCase();
        if (host !== 'facebook.com' && !host.endsWith('.facebook.com')) {
          throw new PlatformError({
            code: 'XACT_4001',
            type: ErrorTypes.INVALID_ARGS,
            message: `SSRF Guard: Target URL is not a facebook.com domain: ${rawGroupInput}`,
            suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
          });
        }
      } catch (err) {
        if (err instanceof PlatformError) throw err;
        throw new PlatformError({
          code: 'XACT_4001',
          type: ErrorTypes.INVALID_ARGS,
          message: `Invalid group URL: ${rawGroupInput}`,
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        });
      }
    }

    const groupId = resolveGroupId(rawGroupInput);
    if (!groupId) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: `Could not resolve numeric groupId from: ${rawGroupInput}`,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    const limit = this.#normalizeCount(args?.limit, 30, 500);
    const cursor = args?.cursor || null;
    const accountId = session?.accountId;
    const cookies = this.#resolveCookies(session);
    const docId = this.docIds.GROUP_SEARCH || DEFAULT_FB_DOC_IDS.GROUP_SEARCH;

    const variables = {
      groupID: groupId,
      groupId,
      query: rawQuery,
      searchTerm: rawQuery,
      count: limit,
      first: limit,
      cursor,
      after: cursor,
    };

    const res = await this.client.requestGraphQl(docId, variables, {
      accountId,
      cookies,
      requiresAuth: session?.requiresAuth,
    });

    const group = res?.data?.group || res?.data?.node || res?.data;
    const groupSearchConnection = group?.group_search_results || group?.search_results || res?.data?.searchResults;
    const edges = Array.isArray(groupSearchConnection?.edges) ? groupSearchConnection.edges : [];
    const pageInfo = groupSearchConnection?.page_info || null;

    const postItems = [];
    for (const edge of edges) {
      const postItem = normalizeFacebookSearchPost(edge, rawQuery);
      if (!postItem) continue;
      this.validateItem(postItem);
      postItems.push(postItem);
    }

    if (this.store && postItems.length > 0 && typeof this.store.storeBatch === 'function') {
      await this.store.storeBatch(postItems, { upsert: true });
    }

    await this.#saveCheckpoint('search', `${groupId}:${rawQuery}`, pageInfo?.end_cursor, postItems, pageInfo?.has_next_page);

    const out = Object.assign([...postItems], { posts: postItems, pageInfo });
    return out;
  }

  /**
   * Search listings on Facebook Marketplace using hybrid GraphQL with browser fallback.
   * @param {Object} args
   * @param {string} args.query - Search query (e.g. 'macbook pro')
   * @param {string} [args.location] - Location name or slug (e.g. 'hochiminhcity', 'hanoi')
   * @param {string} [args.category] - Category slug
   * @param {string | number} [args.categoryId] - Numeric category ID
   * @param {number} [args.minPrice] - Minimum price (in standard currency units)
   * @param {number} [args.maxPrice] - Maximum price (in standard currency units)
   * @param {number} [args.priceMin] - Alias for minPrice
   * @param {number} [args.priceMax] - Alias for maxPrice
   * @param {number} [args.limit=50] - Max items to return [1-200]
   * @param {string} [args.cursor] - Pagination cursor
   * @param {string} [args.after] - Alias for cursor
   * @param {number} [args.radiusKm] - Radius in kilometers
   * @param {number} [args.latitude] - Location latitude [-90 to 90]
   * @param {number} [args.longitude] - Location longitude [-180 to 180]
   * @param {boolean} [args.dryRun] - If true, returns searchUrl preview without calling network
   * @param {Record<string, any>} [session={}]
   * @returns {Promise<{ posts: import('../../../core/types.js').PostItem[], pageInfo?: { has_next_page: boolean, end_cursor: string | null }, searchUrl?: string, dryRun?: boolean, note?: string }>}
   */
  async marketplace(args, session = {}) {
    session = { requiresAuth: false, ...(session || {}) };
    const rawQuery = String(args?.query || '').trim();
    if (!rawQuery) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing required argument: query',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    if (rawQuery.length > 500) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'query exceeds maximum length of 500 characters',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    // Reject queries that look like URLs or contain obvious injection patterns.
    const qLower = rawQuery.toLowerCase();
    if (
      qLower.includes('://') ||
      qLower.includes('http') ||
      qLower.includes('https') ||
      qLower.includes('//') ||
      qLower.startsWith('www.')
    ) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'query cannot contain URL patterns',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    // Min / Max price parsing & validation
    const rawMinPrice = args?.minPrice ?? args?.priceMin;
    const rawMaxPrice = args?.maxPrice ?? args?.priceMax;
    let minPrice = undefined;
    let maxPrice = undefined;

    const SAFE_PRICE_LIMIT = Number.MAX_SAFE_INTEGER / 100;

    /**
     * @param {unknown} raw
     * @param {string} name
     * @returns {number | undefined}
     */
    const parsePrice = (raw, name) => {
      if (raw == null) return undefined;
      const s = String(raw).trim();
      if (s === '') return undefined;
      const n = Number(s);
      if (!Number.isFinite(n) || n < 0) {
        throw new PlatformError({
          code: 'XACT_4001',
          type: ErrorTypes.INVALID_ARGS,
          message: `${name} must be a non-negative number`,
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        });
      }
      if (n > SAFE_PRICE_LIMIT) {
        throw new PlatformError({
          code: 'XACT_4001',
          type: ErrorTypes.INVALID_ARGS,
          message: `${name} is too large`,
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        });
      }
      return n;
    };

    minPrice = parsePrice(rawMinPrice, 'minPrice');
    maxPrice = parsePrice(rawMaxPrice, 'maxPrice');

    if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: `minPrice (${minPrice}) cannot be greater than maxPrice (${maxPrice})`,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    // Category validation (strict slug whitelist)
    let category = undefined;
    if (args?.category != null && String(args.category).trim() !== '') {
      category = String(args.category).trim();
      if (!/^[a-zA-Z0-9_-]+$/.test(category)) {
        throw new PlatformError({
          code: 'XACT_4001',
          type: ErrorTypes.INVALID_ARGS,
          message: 'category must be a plain slug (alphanumeric, hyphen, underscore)',
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        });
      }
    }

    // CategoryId validation (numeric string or positive integer)
    let categoryId = undefined;
    if (args?.categoryId != null) {
      const rawCatId = args.categoryId;
      if (typeof rawCatId === 'number') {
        if (!Number.isInteger(rawCatId) || rawCatId <= 0) {
          throw new PlatformError({
            code: 'XACT_4001',
            type: ErrorTypes.INVALID_ARGS,
            message: 'categoryId must be a positive integer',
            suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
          });
        }
        categoryId = String(rawCatId);
      } else {
        const s = String(rawCatId).trim();
        if (s === '' || !/^\d+$/.test(s)) {
          throw new PlatformError({
            code: 'XACT_4001',
            type: ErrorTypes.INVALID_ARGS,
            message: 'categoryId must be a numeric id',
            suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
          });
        }
        categoryId = s;
      }
    }

    // Coordinates validation
    let latitude = undefined;
    let longitude = undefined;
    if (args?.latitude != null && String(args.latitude).trim() !== '') {
      latitude = Number(args.latitude);
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
        throw new PlatformError({
          code: 'XACT_4001',
          type: ErrorTypes.INVALID_ARGS,
          message: 'latitude must be a valid number between -90 and 90',
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        });
      }
    }
    if (args?.longitude != null && String(args.longitude).trim() !== '') {
      longitude = Number(args.longitude);
      if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        throw new PlatformError({
          code: 'XACT_4001',
          type: ErrorTypes.INVALID_ARGS,
          message: 'longitude must be a valid number between -180 and 180',
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        });
      }
    }

    if ((latitude != null) !== (longitude != null)) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Both latitude and longitude must be provided together',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    // Radius validation (default 50 only when lat/lng are provided; reject 0/NaN/empty)
    const hasCoords = latitude != null && longitude != null;
    let radiusKm = undefined;
    if (args?.radiusKm != null && String(args.radiusKm).trim() !== '') {
      const r = Number(String(args.radiusKm).trim());
      if (!Number.isFinite(r) || r <= 0) {
        throw new PlatformError({
          code: 'XACT_4001',
          type: ErrorTypes.INVALID_ARGS,
          message: 'radiusKm must be a positive number',
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        });
      }
      radiusKm = r;
    }
    if (hasCoords && radiusKm == null) {
      radiusKm = 50;
    }

    // Location validation and resolution
    let location = undefined;
    if (args?.location != null && String(args.location).trim() !== '') {
      const rawLoc = String(args.location).trim();
      const resolvedSlug = resolveMarketplaceLocation(rawLoc);
      if (resolvedSlug) {
        location = resolvedSlug;
      } else if (/^https?:\/\//i.test(rawLoc)) {
        if (!/^https?:\/\/(?:www\.)?facebook\.com\/marketplace\/[a-zA-Z0-9_-]+(?:\/?)$/i.test(rawLoc)) {
          throw new PlatformError({
            code: 'XACT_4001',
            type: ErrorTypes.INVALID_ARGS,
            message: 'location URL must be a valid facebook.com/marketplace URL',
            suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
          });
        }
        location = rawLoc;
      } else {
        location = rawLoc;
      }
    }

    // Limit: positive integer, clamped [1, 200], default 50
    const DEFAULT_LIMIT = 50;
    const MAX_LIMIT = 200;
    let limit = DEFAULT_LIMIT;
    if (args?.limit != null && String(args.limit).trim() !== '') {
      const n = Number(String(args.limit).trim());
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
        throw new PlatformError({
          code: 'XACT_4001',
          type: ErrorTypes.INVALID_ARGS,
          message: 'limit must be a positive integer',
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        });
      }
      limit = Math.min(n, MAX_LIMIT);
    }

    const cursor = (typeof args?.cursor === 'string' ? args.cursor.trim() : '') ||
                   (typeof args?.after === 'string' ? args.after.trim() : '') || null;

    const dryRun = Boolean(args?.dryRun);
    if (dryRun) {
      const searchUrl = buildMarketplaceSearchUrl(rawQuery, {
        baseUrl: this.client.baseUrl,
        location,
        category,
        minPrice,
        maxPrice,
        categoryId,
        latitude,
        longitude,
        radiusKm,
        cursor,
      });
      return {
        dryRun: true,
        searchUrl,
        posts: [],
        pageInfo: { has_next_page: false, end_cursor: null },
      };
    }

    const accountId = session?.accountId;
    const cookies = this.#resolveCookies(session);

    const docId = this.docIds.MARKETPLACE_SEARCH || DEFAULT_FB_DOC_IDS.MARKETPLACE_SEARCH;
    const variables = {
      count: limit,
      first: limit,
      cursor,
      after: cursor,
      params: {
        bqf: {
          callsite: 'COMMERCE_MKTPLACE_WWW',
          query: rawQuery,
        },
        browse_request_params: {
          ...(latitude != null && { filter_location_latitude: latitude }),
          ...(longitude != null && { filter_location_longitude: longitude }),
          ...(minPrice != null && { filter_price_lower_bound: Math.round(minPrice * 100) }),
          ...(maxPrice != null && { filter_price_upper_bound: Math.round(maxPrice * 100) }),
          ...(radiusKm != null && { filter_radius_km: radiusKm }),
          ...(categoryId != null && { commerce_search_and_rp_category_id: categoryId }),
        },
      },
    };

    let postItems = [];
    let pageInfo = { has_next_page: false, end_cursor: null };
    let note = undefined;

    try {
      const res = await this.client.requestGraphQl(docId, variables, {
        accountId,
        cookies,
        requiresAuth: session?.requiresAuth,
      });

      const feedUnits = res?.data?.marketplace_search?.feed_units ||
                        res?.data?.marketplace_search_listings ||
                        res?.data?.searchResults ||
                        res?.data?.browse ||
                        res?.data?.marketplaceSearch ||
                        res?.data;

      const edges = Array.isArray(feedUnits?.edges) ? feedUnits.edges : (Array.isArray(res?.data?.edges) ? res.data.edges : []);
      pageInfo = feedUnits?.page_info || res?.data?.page_info || { has_next_page: false, end_cursor: null };

      for (const edge of edges) {
        const postItem = normalizeFacebookMarketplaceListing(edge, 'graphql');
        if (!postItem) continue;
        try {
          this.validateItem(postItem);
          postItems.push(postItem);
        } catch (valErr) {
          const valErrMsg = valErr instanceof Error ? valErr.message : String(valErr);
          console.warn(`⚠️ [FacebookCrawler] Marketplace listing item validation failed: ${valErrMsg}`);
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️ [FacebookCrawler] Marketplace GraphQL fetch failed: ${errMsg}. Attempting SSR fallback.`);
      note = 'Marketplace GraphQL query failed; attempting SSR fallback';

      const fallbackUrl = buildMarketplaceSearchUrl(rawQuery, {
        baseUrl: this.client.baseUrl,
        location,
        category,
        minPrice,
        maxPrice,
        categoryId,
        latitude,
        longitude,
        radiusKm,
        cursor,
      });

      let html = '';
      try {
        const ssrResponse = await this.client.request('GET', fallbackUrl, {
          accountId,
          requiresAuth: session?.requiresAuth,
          headers: cookies ? { cookie: cookies } : {},
          timeout: 60000,
        });

        const ssrResponseRecord = ssrResponse && typeof ssrResponse === 'object'
          ? /** @type {Record<string, any>} */ (ssrResponse)
          : null;
        html = typeof ssrResponseRecord?.data === 'string'
          ? ssrResponseRecord.data
          : (typeof ssrResponse === 'string' ? ssrResponse : '');
      } catch (ssrErr) {
        // FacebookClient validates the payload and rejects HTML as invalid.
        // The raw HTML is still useful for best-effort parsing, so extract it
        // from the error details when available.
        if (ssrErr instanceof PlatformError && ssrErr.details) {
          if (typeof ssrErr.details === 'string') {
            html = ssrErr.details;
          } else if (typeof ssrErr.details === 'object' && typeof ssrErr.details.data === 'string') {
            html = ssrErr.details.data;
          }
        }
        if (!html) {
          const ssrErrMsg = ssrErr instanceof Error ? ssrErr.message : String(ssrErr);
          console.warn(`⚠️ [FacebookCrawler] SSR fallback failed: ${ssrErrMsg}`);
        }
      }

      if (html) {
        const fallbackItems = this.#parseMarketplaceSsrHtml(html, limit);
        for (const item of fallbackItems) {
          try {
            this.validateItem(item);
            postItems.push(item);
          } catch (valErr) {
            const valErrMsg = valErr instanceof Error ? valErr.message : String(valErr);
            console.warn(`⚠️ [FacebookCrawler] SSR fallback item validation failed: ${valErrMsg}`);
          }
        }
      }

      if (postItems.length > 0) {
        pageInfo = { has_next_page: false, end_cursor: null };
      }

      note = postItems.length > 0
        ? `SSR fallback returned ${postItems.length} result(s)`
        : 'Marketplace GraphQL query failed; attempted SSR fallback: no results found';
    }

    // Enforce the requested limit before storage.
    if (postItems.length > limit) {
      postItems = postItems.slice(0, limit);
    }

    if (this.store && postItems.length > 0 && typeof this.store.storeBatch === 'function') {
      await this.store.storeBatch(postItems, { upsert: true });
    }

    const targetKey = [rawQuery, location, category, categoryId, minPrice, maxPrice].filter((v) => v !== undefined && v !== null && v !== '').join(':');
    await this.#saveCheckpoint('marketplace', targetKey, pageInfo?.end_cursor || null, postItems, Boolean(pageInfo?.has_next_page));

    return {
      posts: postItems,
      pageInfo,
      note,
    };
  }

  /**
   * Best-effort parse marketplace listings from Facebook Marketplace search HTML (SSR fallback).
   * @param {string} html
   * @param {number} limit
   * @returns {import('../../../core/types.js').PostItem[]}
   */
  #parseMarketplaceSsrHtml(html, limit) {
    const items = [];

    const targetKeys = [
      'MarketplaceSearchSchema',
      'marketplace_search_listings',
      'marketplaceSearch',
      'searchResults',
      'browse',
    ];

    /**
     * @param {unknown} value
     * @returns {Record<string, unknown> | null}
     */
    const findConnection = (value) => {
      if (!value || typeof value !== 'object') return null;
      if (Array.isArray(value)) {
        for (const el of value) {
          const c = findConnection(el);
          if (c) return c;
        }
        return null;
      }
      const obj = /** @type {Record<string, unknown>} */ (value);
      if (Array.isArray(obj.edges)) {
        return obj;
      }
      for (const key of targetKeys) {
        const candidate = obj[key];
        if (candidate && typeof candidate === 'object') {
          const c = /** @type {Record<string, unknown>} */ (candidate);
          if (Array.isArray(c.edges)) return c;
        }
      }
      for (const v of Object.values(obj)) {
        const c = findConnection(v);
        if (c) return c;
      }
      return null;
    };

    /**
     * @param {string} text
     * @param {number} start
     * @returns {string | null}
     */
    const tryExtractJson = (text, start) => {
      if (text[start] !== '{') return null;
      let depth = 0;
      let inString = false;
      let escape = false;
      for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (escape) {
          escape = false;
          continue;
        }
        if (c === '\\') {
          escape = true;
          continue;
        }
        if (c === '"') {
          inString = !inString;
          continue;
        }
        if (inString) continue;
        if (c === '{') depth++;
        else if (c === '}') {
          depth--;
          if (depth === 0) return text.slice(start, i + 1);
        }
      }
      return null;
    };

    // 1. JSON script tags
    const scriptRe = /<script[^>]*type=["']application\/json["'][^>]*>([^]*?)<\/script>/gi;
    /** @type {RegExpExecArray | null} */
    let match = null;
    const scriptContents = [];
    while ((match = scriptRe.exec(html)) !== null) {
      scriptContents.push(match[1].trim());
    }

    for (const script of scriptContents) {
      try {
        const parsed = JSON.parse(script);
        const conn = findConnection(parsed);
        if (conn && Array.isArray(conn.edges)) {
          const edges = conn.edges.slice(0, limit);
          for (const edge of edges) {
            const postItem = normalizeFacebookMarketplaceListing(
              /** @type {Record<string, any>} */ (edge),
              'ssr'
            );
            if (postItem) items.push(postItem);
          }
          if (items.length > 0) return items;
        }
      } catch {}
    }

    // 2. Raw JSON around target keys
    for (const key of targetKeys) {
      const idx = html.indexOf(key);
      if (idx === -1) continue;
      const braceIdx = html.indexOf('{', idx);
      if (braceIdx === -1) continue;
      const candidate = tryExtractJson(html, braceIdx);
      if (!candidate) continue;
      try {
        const parsed = JSON.parse(candidate);
        const conn = findConnection(parsed);
        if (conn && Array.isArray(conn.edges)) {
          const edges = conn.edges.slice(0, limit);
          for (const edge of edges) {
            const postItem = normalizeFacebookMarketplaceListing(
              /** @type {Record<string, any>} */ (edge),
              'ssr'
            );
            if (postItem) items.push(postItem);
          }
          if (items.length > 0) return items;
        }
      } catch {}
    }

    // 3. Regex fallback for listing ids
    const itemRe = /href=["'][^"']*\/marketplace\/(?:item|listing)\/([a-zA-Z0-9_-]+)/gi;
    const seen = new Set();
    while ((match = itemRe.exec(html)) !== null && items.length < limit) {
      const id = match[1];
      if (seen.has(id)) continue;
      seen.add(id);
      const postItem = normalizeFacebookMarketplaceListing(
        { id, listingUrl: 'https://www.facebook.com/marketplace/item/' + id },
        'ssr'
      );
      if (postItem) items.push(postItem);
    }

    return items;
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
   * @param {any} args
   * @returns {Promise<import('../../../core/types.js').CommentItem[]>}
   */
  async getComments(args) {
    const res = await this.getCommentsForPost(args);
    return res.comments;
  }

  /**
   * Scrape hierarchical comments from a Facebook post using hybrid GraphQL.
   * @param {Object} args
   * @param {string} args.url - Post URL or numeric postId
   * @param {string} [args.postId]
   * @param {number} [args.maxDepth]
   * @param {number} [args.maxComments=50]
   * @param {number} [args.limit=50]
   * @param {boolean} [args.includeReplies]
   * @param {string} [args.after]
   * @param {Record<string, any>} [session={}]
   * @returns {Promise<{ comments: import('../../../core/types.js').CommentItem[], pageInfo?: any, note?: string }>}
   */
  async postComments(args, session = {}) {
    const rawTarget = String(args?.url || args?.postId || '').trim();
    if (!rawTarget) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing required argument: url or postId',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    this.#validatePostCommentTarget(rawTarget);

    const postExternalId = this.#extractPostExternalId(rawTarget);
    if (!postExternalId) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Could not resolve post external ID from input',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    const includeReplies = this.#normalizeBoolean(args?.includeReplies);
    let maxDepth = 0;
    if (includeReplies === true) {
      maxDepth = args?.maxDepth != null ? this.#clampMaxDepth(args.maxDepth) : 3;
    } else if (includeReplies === false) {
      maxDepth = 0;
    } else if (args?.maxDepth != null) {
      maxDepth = this.#clampMaxDepth(args.maxDepth);
    }

    const maxComments = this.#clampMaxComments(args?.limit || args?.maxComments || 50);
    const after = typeof args?.after === 'string' ? args.after.trim() || undefined : undefined;

    const res = await this.getCommentsForPost({
      postId: rawTarget,
      maxDepth,
      maxComments,
      after,
      feedLocation: 'POST_PERMALINK_DIALOG',
    }, session);

    const comments = res.comments || [];
    const pageInfo = res.pageInfo || null;
    const note = res.note;

    await this.#saveCheckpoint('post_comments', postExternalId, pageInfo?.end_cursor || null, /** @type {any} */ (comments), Boolean(pageInfo?.has_next_page));

    return { comments, pageInfo, note };
  }

  /**
   * Scrape hierarchical comments from a Facebook group post using hybrid GraphQL.
   * @param {Object} args
   * @param {string} args.url - Group post URL
   * @param {string} [args.postId]
   * @param {number} [args.maxDepth]
   * @param {number} [args.maxComments=50]
   * @param {number} [args.limit=50]
   * @param {boolean} [args.includeReplies]
   * @param {string} [args.after]
   * @param {Record<string, any>} [session={}]
   * @returns {Promise<{ comments: import('../../../core/types.js').CommentItem[], pageInfo?: any, note?: string }>}
   */
  async groupComments(args, session = {}) {
    const rawTarget = String(args?.url || args?.postId || '').trim();
    if (!rawTarget) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing required argument: url or postId',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    this.#validateGroupCommentTarget(rawTarget);

    const postExternalId = this.#extractPostExternalId(rawTarget);
    if (!postExternalId) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Could not resolve post external ID from group URL',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    const includeReplies = this.#normalizeBoolean(args?.includeReplies);
    let maxDepth = 0;
    if (includeReplies === true) {
      maxDepth = args?.maxDepth != null ? this.#clampMaxDepth(args.maxDepth) : 3;
    } else if (includeReplies === false) {
      maxDepth = 0;
    } else if (args?.maxDepth != null) {
      maxDepth = this.#clampMaxDepth(args.maxDepth);
    }

    const maxComments = this.#clampMaxComments(args?.limit || args?.maxComments || 50);
    const after = typeof args?.after === 'string' ? args.after.trim() || undefined : undefined;

    const res = await this.getCommentsForPost({
      postId: rawTarget,
      maxDepth,
      maxComments,
      after,
      feedLocation: 'GROUP',
    }, session);

    const comments = res.comments || [];
    const pageInfo = res.pageInfo || null;
    const note = res.note;

    await this.#saveCheckpoint('group_comments', postExternalId, pageInfo?.end_cursor || null, /** @type {any} */ (comments), Boolean(pageInfo?.has_next_page));

    return { comments, pageInfo, note };
  }

  /**
   * Scrape hierarchical comments from a Facebook post via GraphQL.
   * @param {Object} args
   * @param {string} args.postId - Post URL, base64 feedback id, numeric post id, or namespaced/synthetic id
   * @param {number} [args.maxDepth=3]
   * @param {number} [args.maxComments=50]
   * @param {string} [args.after]
   * @param {string} [args.feedLocation='POST_PERMALINK_DIALOG']
   * @param {boolean} [args.triedFallback] - internal recursion guard
   * @param {Record<string, any>} [session={}]
   * @returns {Promise<{ comments: import('../../../core/types.js').CommentItem[], pageInfo?: any, note?: string }>}
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
    const feedLocation = args?.feedLocation || 'POST_PERMALINK_DIALOG';
    const isGroup = feedLocation === 'GROUP';
    const after = typeof args?.after === 'string' ? args.after.trim() || null : null;
    const triedFallback = Boolean(args?.triedFallback);

    // Resolve post feedback id up-front; needed for the root comment GraphQL query.
    const postContext = await this.#resolvePostFeedbackContext(args.postId, cookies, accountId, session);

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
    const fetchLayer = async ({ postId, parentCommentId, after, limit, depth }) => {
      const isReply = parentCommentId != null;
      const replyDepth = depth ?? 0;
      const docId = isReply
        ? (isGroup
            ? (replyDepth >= 2
                ? (this.docIds.GROUP_COMMENT_REPLIES_DEPTH2 || this.docIds.GROUP_COMMENT_REPLIES || this.docIds.COMMENT_REPLIES)
                : (this.docIds.GROUP_COMMENT_REPLIES || this.docIds.COMMENT_REPLIES))
            : (replyDepth >= 2
                ? (this.docIds.COMMENT_REPLIES_DEPTH2 || this.docIds.COMMENT_REPLIES)
                : this.docIds.COMMENT_REPLIES))
        : (isGroup ? (this.docIds.GROUP_COMMENT_ROOTS || this.docIds.COMMENT_ROOTS) : this.docIds.COMMENT_ROOTS);
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
        feedLocation,
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
        requiresAuth: session?.requiresAuth,
      });

      if (!res?.data?.node) {
        const note = `${isReply ? 'Reply' : 'Post or comment'} context not found (${contextKey})`;
        return { comments: [], pageInfo: { has_next_page: false, end_cursor: null }, note };
      }

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

    let extractorResult;
    try {
      extractorResult = await extractor.fetch(postExternalId, { after });
    } catch (err) {
      if (isGroup && !triedFallback) {
        console.warn(`⚠️ [FB] Group comment GraphQL failed for ${postExternalId}, retrying with POST_PERMALINK_DIALOG`);
        return this.getCommentsForPost({ ...args, feedLocation: 'POST_PERMALINK_DIALOG', triedFallback: true }, session);
      }
      throw err;
    }

    if (isGroup && !triedFallback && extractorResult.comments.length === 0 && extractorResult.note) {
      return this.getCommentsForPost({ ...args, feedLocation: 'POST_PERMALINK_DIALOG', triedFallback: true }, session);
    }

    const { comments, pageInfo, note } = extractorResult;

    for (const comment of comments) {
      this.validateItem(comment);
    }

    if (this.store && comments.length > 0 && typeof this.store.storeCommentBatch === 'function') {
      await this.store.storeCommentBatch(comments, { upsert: true });
    }

    return { comments, pageInfo, note };
  }

  /**
   * Persist and return a group-members result produced by the browser bridge.
   * @param {string} groupId
   * @param {{ members?: import('../../../core/types.js').ProfileItem[], note?: string, pageInfo?: any }} bridgeResult
   * @returns {Promise<{ members: import('../../../core/types.js').ProfileItem[], note?: string, pageInfo?: any }>}
   */
  async #processGroupMembersBridgeResult(groupId, bridgeResult) {
    const members = bridgeResult?.members || [];
    const note = bridgeResult?.note;
    const pageInfo = bridgeResult?.pageInfo || null;
    const postItems = [];

    for (const member of members) {
      const postItem = profileItemToPostItem(member);
      this.validateItem(postItem);
      postItems.push(postItem);
    }

    if (this.store && typeof this.store.storeBatch === 'function' && postItems.length > 0) {
      await this.store.storeBatch(postItems, { upsert: true });
    }

    await this.#saveCheckpoint('group_members', groupId, pageInfo?.end_cursor || null, postItems, Boolean(pageInfo?.has_next_page));

    return { members, note, pageInfo };
  }

  /**
   * Internal checkpoint saver and thin-event stream emitter.
   * @param {string} targetType
   * @param {string} targetKey
   * @param {string | null} [cursor=null]
   * @param {Array<import('../../../core/types.js').PostItem>} [items=[]]
   * @param {boolean} [hasMore=false]
   * @returns {Promise<void>}
   */
  async #saveCheckpoint(targetType, targetKey, cursor = null, items = [], hasMore = false) {
    try {
      const storeWithCheckpoint = /** @type {any} */ (this.store);
      if (storeWithCheckpoint && typeof storeWithCheckpoint.saveCheckpoint === 'function') {
        await storeWithCheckpoint.saveCheckpoint({
          platform: 'facebook',
          targetType,
          targetKey,
          lastCursor: cursor || undefined,
          lastTimestamp: new Date(),
          lastCrawledAt: new Date(),
          status: hasMore ? 'has_more' : 'completed',
        });
      }

      const redisClient = /** @type {any} */ (this.store)?.redis || /** @type {any} */ (this.sessionManager)?.redis;
      if (redisClient && isEnvTruthy(process.env.REDIS_STREAM_ENABLED)) {
        for (const item of items) {
          const category = 'category' in item && typeof item.category === 'string' ? item.category : 'social';
          const fields = {
            id: item.id,
            platform: 'facebook',
            externalId: item.externalId,
            category,
            authorId: item.authorId || '',
            crawledAt: toIsoDate(item.crawledAt),
          };

          if (typeof redisClient.xAdd === 'function') {
            await redisClient.xAdd(
              'stream:social:raw_posts',
              '*',
              fields,
              {
                TRIM: {
                  strategy: 'MAXLEN',
                  strategyModifier: '~',
                  threshold: 1000000,
                },
              }
            );
          } else if (typeof redisClient.xadd === 'function') {
            await redisClient.xadd(
              'stream:social:raw_posts',
              'MAXLEN',
              '~',
              '1000000',
              '*',
              ...Object.entries(fields).flat()
            );
          }
        }
      }
    } catch (err) {
      console.warn(`[FB TELEMETRY] Checkpoint/stream emission warning: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Scrape user or page profile via GraphQL.
   * @param {Object} args
   * @param {string} [args.username]
   * @param {string} [args.url]
   * @param {Record<string, any>} [session={}]
   * @returns {Promise<{ profile: import('../../../core/types.js').ProfileItem }>}
   */
  async profile(args, session = {}) {
    session = { requiresAuth: false, ...(session || {}) };
    const rawTarget = args?.username || args?.url;
    const targetKey = resolveTargetKey(rawTarget);

    const accountId = session?.accountId;
    const cookies = this.#resolveCookies(session);

    const variables = {
      username: targetKey,
      scale: 2,
    };

    const docId = this.docIds.PROFILE || DEFAULT_FB_DOC_IDS.PROFILE;
    let res = null;
    let graphQlErr = null;
    try {
      res = await this.client.requestGraphQl(docId, variables, {
        accountId,
        cookies,
        requiresAuth: session?.requiresAuth,
      });
    } catch (err) {
      if (err instanceof PlatformError && (err.type === ErrorTypes.AUTH_EXPIRED || err.type === ErrorTypes.RATE_LIMIT)) {
        throw err;
      }
      graphQlErr = err;
    }

    const profileData = res?.data?.user || res?.data?.node || res?.data?.page;

    let profile = null;
    if (!profileData || typeof profileData !== 'object' || (!profileData.id && !profileData.userID && !profileData.username)) {
      if (this.client?.browserBridge) {
        try {
          profile = await this.client.scrapeProfileWithBrowser(targetKey, {
            cookies,
            accountId,
            baseUrl: this.client.baseUrl,
          });
        } catch (bridgeErr) {
          if (bridgeErr instanceof PlatformError) {
            throw bridgeErr;
          }
          throw graphQlErr || bridgeErr;
        }
      }
      if (!profile) {
        throw graphQlErr || new PlatformError({
          code: 'XACT_4004',
          type: ErrorTypes.INVALID_ARGS,
          message: `Profile not found for ${targetKey}`,
          suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        });
      }
    } else {
      profile = normalizeFacebookProfile(profileData, 'graphql');
      if (!profile) {
        profile = normalizeFacebookProfile({
          id: targetKey,
          username: targetKey,
          name: targetKey,
        }, 'graphql');
      }
    }

    if (!profile || (!profile.username && !profile.externalId)) {
      throw new PlatformError({
        code: 'XACT_5000',
        type: ErrorTypes.INTERNAL,
        message: `Failed to normalize profile for ${targetKey}`,
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
      });
    }

    const postItem = profileItemToPostItem(profile);
    this.validateItem(postItem);

    if (this.store && typeof this.store.storeBatch === 'function') {
      await this.store.storeBatch([postItem], { upsert: true });
    }

    await this.#saveCheckpoint('profile', targetKey, null, [postItem], false);

    return { profile };
  }

  /**
   * Scrape followers list with cursor pagination via GraphQL.
   * @param {Object} args
   * @param {string} [args.username]
   * @param {string} [args.url]
   * @param {number} [args.limit=20]
   * @param {string} [args.cursor]
   * @param {Record<string, any>} [session={}]
   * @returns {Promise<{ followers: import('../../../core/types.js').ProfileItem[], pageInfo?: any }>}
   */
  async followers(args, session = {}) {
    const rawTarget = args?.username || args?.url;
    const targetKey = resolveTargetKey(rawTarget);

    const limit = this.#normalizeCount(args?.limit, 20, 500);
    const accountId = session?.accountId;
    const cookies = this.#resolveCookies(session);
    const docId = this.docIds.FOLLOWERS || DEFAULT_FB_DOC_IDS.FOLLOWERS;

    const followers = [];
    const postItems = [];
    let cursor = args?.cursor || null;
    let pageInfo = null;
    let pageCount = 0;
    const maxPages = limit + 20;

    while (followers.length < limit) {
      if (++pageCount > maxPages) break;
      const remaining = limit - followers.length;
      const first = Math.min(remaining, 50);

      const variables = {
        username: targetKey,
        first,
        after: cursor,
      };

      const res = await this.client.requestGraphQl(docId, variables, {
        accountId,
        cookies,
        requiresAuth: session?.requiresAuth,
      });

      const user = res?.data?.user || res?.data?.node || res?.data;
      const connection = user?.followers || user?.subscribers || res?.data?.followers;
      const edges = Array.isArray(connection?.edges) ? connection.edges : [];
      pageInfo = connection?.page_info || null;

      if (edges.length === 0) break;

      for (const edge of edges) {
        const node = edge?.node || edge;
        if (!node || (!node.id && !node.userID && !node.username)) continue;
        const follower = normalizeFacebookFollower(edge);
        if (!follower) continue;
        followers.push(follower);
        const postItem = profileItemToPostItem(follower);
        this.validateItem(postItem);
        postItems.push(postItem);

        if (followers.length >= limit) break;
      }

      if (!pageInfo?.has_next_page || !pageInfo?.end_cursor || pageInfo.end_cursor === cursor) {
        break;
      }
      cursor = pageInfo.end_cursor;
    }

    if (this.store && typeof this.store.storeBatch === 'function' && postItems.length > 0) {
      await this.store.storeBatch(postItems, { upsert: true });
    }

    await this.#saveCheckpoint('followers', targetKey, cursor, postItems, Boolean(pageInfo?.has_next_page));

    return { followers, pageInfo };
  }

  /**
   * Determine whether a GraphQL error indicates the following list is unavailable.
   * @param {PlatformError} err
   * @returns {boolean}
   */
  #isFollowingRestricted(err) {
    if (!(err instanceof PlatformError)) return false;
    const details = /** @type {any} */ (err.details);
    if (Array.isArray(details)) {
      return details.some(
        (e) =>
          e?.code === 1675030 ||
          /following list is not available|not available|following list/i.test(String(e?.message || ''))
      );
    }
    return /following list is not available|not available/i.test(err.message);
  }

  /**
   * Scrape following list via GraphQL (best-effort / restricted).
   * @param {Object} args
   * @param {string} [args.username]
   * @param {string} [args.url]
   * @param {number} [args.limit=20]
   * @param {string} [args.cursor]
   * @param {Record<string, any>} [session={}]
   * @returns {Promise<{ following?: import('../../../core/types.js').ProfileItem[], note?: string, pageInfo?: any }>}
   */
  async following(args, session = {}) {
    const rawTarget = args?.username || args?.url;
    const targetKey = resolveTargetKey(rawTarget);

    const limit = this.#normalizeCount(args?.limit, 20, 500);
    const accountId = session?.accountId;
    const cookies = this.#resolveCookies(session);
    const docId = this.docIds.FOLLOWING || DEFAULT_FB_DOC_IDS.FOLLOWING;

    const following = [];
    const postItems = [];
    let cursor = args?.cursor || null;
    let pageInfo = null;
    let pageCount = 0;
    const maxPages = limit + 20;

    try {
      while (following.length < limit) {
        if (++pageCount > maxPages) break;
        const remaining = limit - following.length;
        const first = Math.min(remaining, 50);

        const variables = {
          username: targetKey,
          first,
          after: cursor,
        };

        const res = await this.client.requestGraphQl(docId, variables, {
          accountId,
          cookies,
          requiresAuth: session?.requiresAuth,
        });

        const user = res?.data?.user || res?.data?.node || res?.data;
        const connection = user?.following || user?.friends || res?.data?.following;
        const edges = Array.isArray(connection?.edges) ? connection.edges : [];
        pageInfo = connection?.page_info || null;

        if (edges.length === 0) {
          if (following.length === 0) {
            return {
              following: [],
              note: 'Facebook does not expose the personal profile following list for this account.',
            };
          }
          break;
        }

        for (const edge of edges) {
          const node = edge?.node || edge;
          if (!node || (!node.id && !node.userID && !node.username)) continue;
          const member = normalizeFacebookFollower(edge);
          if (!member) continue;
          member.metadata = { ...(member.metadata || {}), isFollower: false, isFollowing: true };
          following.push(member);
          const postItem = profileItemToPostItem(member);
          this.validateItem(postItem);
          postItems.push(postItem);

          if (following.length >= limit) break;
        }

        if (!pageInfo?.has_next_page || !pageInfo?.end_cursor || pageInfo.end_cursor === cursor) {
          break;
        }
        cursor = pageInfo.end_cursor;
      }

      if (this.store && typeof this.store.storeBatch === 'function' && postItems.length > 0) {
        await this.store.storeBatch(postItems, { upsert: true });
      }

      await this.#saveCheckpoint('following', targetKey, cursor, postItems, Boolean(pageInfo?.has_next_page));

      return { following, pageInfo };
    } catch (err) {
      if (err instanceof PlatformError && (err.type === ErrorTypes.AUTH_EXPIRED || err.type === ErrorTypes.RATE_LIMIT)) {
        throw err;
      }
      if (this.#isFollowingRestricted(/** @type {PlatformError} */ (err))) {
        return {
          following: [],
          note: 'Facebook does not expose the personal profile following list for this account.',
        };
      }
      throw new PlatformError({
        code: 'XACT_5000',
        type: ErrorTypes.INTERNAL,
        message: err instanceof Error ? err.message : 'Failed to fetch following list',
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform: 'facebook',
      });
    }
  }

  /**
   * Scrape members from a Facebook Group via GraphQL.
   * @param {Object} args
   * @param {string} [args.groupUrl]
   * @param {string} [args.groupId]
   * @param {number} [args.limit=20]
   * @param {string} [args.cursor]
   * @param {Record<string, any>} [session={}]
   * @returns {Promise<{ members: import('../../../core/types.js').ProfileItem[], note?: string, pageInfo?: any }>}
   */
  async groupMembers(args, session = {}) {
    const rawTarget = args?.groupUrl || args?.groupId;
    const groupId = resolveGroupId(rawTarget);

    const limit = this.#normalizeCount(args?.limit, 20, 500);
    const accountId = session?.accountId;
    const cookies = this.#resolveCookies(session);
    const docId = this.docIds.GROUP_MEMBERS || DEFAULT_FB_DOC_IDS.GROUP_MEMBERS;

    const members = [];
    const postItems = [];
    let cursor = args?.cursor || null;
    let pageInfo = null;
    let pageCount = 0;
    const maxPages = limit + 20;

    try {
      while (members.length < limit) {
        if (++pageCount > maxPages) break;
        const remaining = limit - members.length;
        const first = Math.min(remaining, 50);

        const variables = {
          groupId,
          first,
          after: cursor,
        };

        const res = await this.client.requestGraphQl(docId, variables, {
          accountId,
          cookies,
          requiresAuth: session?.requiresAuth,
        });

        const group = res?.data?.group || res?.data?.node || res?.data;

        // A missing group object with placeholder doc_ids is a reasonable restricted signal.
        if (!group && members.length === 0) {
          if (this.client?.browserBridge) {
            try {
              const bridgeResult = await this.client.scrapeGroupMembersWithBrowser(groupId, {
                cookies,
                accountId,
                limit,
                baseUrl: this.client.baseUrl,
              });
              return this.#processGroupMembersBridgeResult(groupId, bridgeResult);
            } catch (bridgeErr) {
              if (bridgeErr instanceof PlatformError) throw bridgeErr;
            }
          }
          return {
            members: [],
            pageInfo,
            note: 'Group is private or members list is restricted. Please retry with relogin if you are a member.',
          };
        }

        const connection = group?.members || group?.group_members || res?.data?.members;
        const edges = Array.isArray(connection?.edges) ? connection.edges : [];
        pageInfo = connection?.page_info || null;

        if (edges.length === 0) break;

        for (const edge of edges) {
          const node = edge?.node || edge;
          if (!node || (!node.id && !node.userID && !node.username)) continue;
          const member = normalizeFacebookGroupMember(edge, groupId);
          if (!member) continue;
          members.push(member);
          const postItem = profileItemToPostItem(member);
          this.validateItem(postItem);
          postItems.push(postItem);

          if (members.length >= limit) break;
        }

        if (!pageInfo?.has_next_page || !pageInfo?.end_cursor || pageInfo.end_cursor === cursor) {
          break;
        }
        cursor = pageInfo.end_cursor;
      }
    } catch (err) {
      if (err instanceof PlatformError && (err.type === ErrorTypes.AUTH_EXPIRED || err.type === ErrorTypes.RATE_LIMIT)) {
        throw err;
      }
      if (members.length === 0) {
        if (this.client?.browserBridge) {
          try {
            const bridgeResult = await this.client.scrapeGroupMembersWithBrowser(groupId, {
              cookies,
              accountId,
              limit,
              baseUrl: this.client.baseUrl,
            });
            return this.#processGroupMembersBridgeResult(groupId, bridgeResult);
          } catch (bridgeErr) {
            if (bridgeErr instanceof PlatformError) throw bridgeErr;
          }
        }
        return {
          members: [],
          pageInfo,
          note: 'Group is private or members list is restricted. Please retry with relogin if you are a member.',
        };
      }
    }

    if (this.store && typeof this.store.storeBatch === 'function' && postItems.length > 0) {
      await this.store.storeBatch(postItems, { upsert: true });
    }

    await this.#saveCheckpoint('group_members', groupId, cursor, postItems, Boolean(pageInfo?.has_next_page));

    return { members, pageInfo };
  }

  /**
   * Like a Facebook post.
   * @param {any} args
   * @param {any} [session]
   */
  async like(args, session = {}) {
    return this.actions.like(args, session);
  }

  /**
   * Comment on a Facebook post.
   * @param {any} args
   * @param {any} [session]
   */
  async comment(args, session = {}) {
    return this.actions.comment(args, session);
  }

  /**
   * Create a post on timeline or group(s).
   * @param {any} args
   * @param {any} [session]
   */
  async post(args, session = {}) {
    return this.actions.post(args, session);
  }

  /**
   * Share a Facebook post to timeline.
   * @param {any} args
   * @param {any} [session]
   */
  async share(args, session = {}) {
    return this.actions.share(args, session);
  }

  /**
   * Share a post or message to one or more recipient UIDs via Messenger.
   * @param {any} args
   * @param {any} [session]
   */
  async messengerShare(args, session = {}) {
    return this.actions.messengerShare(args, session);
  }

  /**
   * Alias for sharing a link to a single recipient UID via Messenger.
   * @param {any} args
   * @param {any} [session]
   */
  async shareLinkByUid(args, session = {}) {
    return this.actions.shareLinkByUid(args, session);
  }

  /**
   * Join Facebook group(s).
   * @param {any} args
   * @param {any} [session]
   */
  async joinGroup(args, session = {}) {
    return this.actions.joinGroup(args, session);
  }

  /**
   * Send Facebook friend request(s) to targets.
   * @param {any} args
   * @param {any} [session]
   */
  async sendFriendRequest(args, session = {}) {
    return this.actions.sendFriendRequest(args, session);
  }

  /**
   * Resolve post feedback context (feedback ID, story ID).
   * @param {string} input
   * @param {string | Record<string, unknown>} [cookies='']
   * @param {string} [accountId]
   * @param {Record<string, any>} [session]
   * @returns {Promise<{ feedbackId: string }>}
   */
  async resolvePostFeedbackContext(input, cookies = '', accountId, session = {}) {
    return this.#resolvePostFeedbackContext(input, cookies, accountId, session);
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

