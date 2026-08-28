// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * ThreadsCrawler — High-throughput hybrid crawler for Meta Threads (Story 15.1 & 15.1.1).
 * Extends AbstractCrawler, registers standard profile, followers, following, and post actions,
 * normalizes data into ProfileItem/PostItem schema, and persists to PrismaStore.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractCrawler } from '../../../core/base-crawler.js';
import { ThreadsClient } from './client.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';
import {
  namespacedProfileId,
  parseHumanCount,
  normalizeThreadsProfile,
  normalizeThreadsConnection,
  profileItemToPostItem,
} from './normalizer.js';
import { defaultRedisStreamPublisher, toIsoDate } from '../../../utils/redis-stream-publisher.js';

export const DEFAULT_THREADS_DOC_IDS = {
  // Profile & Connection doc_ids (Story 15.1.1)
  PROFILE: '23996318473300828', // BarcelonaProfileRootQuery (candidate)
  FOLLOWERS: null, // BarcelonaFollowersTabQuery (capture required)
  FOLLOWING: null, // BarcelonaFollowingTabQuery (capture required)

  // Feed, Post & Comments doc_ids (Story 15.1)
  PROFILE_FEED: '6232751443445612', // BarcelonaProfileThreadsTabQuery
  POST_DETAIL: '23996318473300828',
  SEARCH_POSTS: '27238810212443285', // BarcelonaSearchUserResultsQuery
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
    const client = deps.client || new ThreadsClient(deps);
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

    // ── Story 15.1.1 Actions: profile, followers, following ──
    this.registerAction({
      action: 'profile',
      description: 'Fetch and normalize a Threads user profile via GraphQL or SSR fallback',
      requiredArgs: ['username'],
      optionalArgs: [],
      outputType: 'ProfileItem',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getProfile(args, session),
    });

    this.registerAction({
      action: 'followers',
      description: 'Fetch follower connection profiles for a Threads user with limitation fallback',
      requiredArgs: ['username'],
      optionalArgs: ['count', 'cursor'],
      outputType: '{ profiles: ProfileItem[], counts: object, note?: string }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getFollowers(args, session),
    });

    this.registerAction({
      action: 'following',
      description: 'Fetch following connection profiles for a Threads user with limitation fallback',
      requiredArgs: ['username'],
      optionalArgs: ['count', 'cursor'],
      outputType: '{ profiles: ProfileItem[], counts: object, note?: string }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getFollowing(args, session),
    });
  }

  /**
   * Resolve numeric user ID from username by inspecting SSR HTML page.
   * @param {string} username
   * @param {string} [accountId='threads-guest']
   * @returns {Promise<string>}
   */
  async #resolveUserId(username, accountId = 'threads-guest') {
    const cleanUser = username.replace(/^@/, '').trim();
    try {
      const resp = /** @type {any} */ (await this.client.request('GET', `${this.client.baseUrl}/@${cleanUser}`, {
        accountId,
      }));

      const html = typeof resp?.data === 'string' ? resp.data : (typeof resp === 'string' ? resp : JSON.stringify(resp?.data || ''));

      const idMatch =
        html.match(/window\.__user_id\s*=\s*"([^"]+)"/) ||
        html.match(/window\.__userId\s*=\s*"([^"]+)"/) ||
        html.match(/"user_id":"(\d+)"/) ||
        html.match(/"pk":"(\d+)"/) ||
        html.match(/"id":"(\d+)"/);

      if (idMatch) {
        return idMatch[1];
      }
    } catch (err) {
      const anyErr = /** @type {any} */ (err);
      const status = anyErr?.statusCode || anyErr?.status;
      if (status === 404) {
        throw new PlatformError({
          code: 'XACT_4041',
          type: ErrorTypes.INTERNAL,
          message: `Threads user @${cleanUser} not found`,
          statusCode: 404,
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
          platform: 'threads',
        });
      }
    }

    return cleanUser;
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
        // Safe ignore to allow SSR fallback unless it's a permanent 404
        if ((/** @type {any} */ (err))?.statusCode === 404 || (/** @type {any} */ (err))?.code === 'XACT_4041') {
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
      throw new PlatformError({
        code: 'XACT_4041',
        type: ErrorTypes.INTERNAL,
        message: `Threads user @${cleanUser} not found or inaccessible`,
        statusCode: 404,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'threads',
      });
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

    const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
    const descMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
    const imageMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);

    const title = titleMatch ? titleMatch[1] : '';
    const desc = descMatch ? descMatch[1] : '';
    const avatar = imageMatch ? imageMatch[1] : null;

    const userInTitleMatch = title.match(/@([a-zA-Z0-9._]+)/);
    const usernameFromTitle = userInTitleMatch ? userInTitleMatch[1] : cleanUser;

    const nameMatch = title.match(/^(.+?)\s*\(/);
    const name = nameMatch ? nameMatch[1].trim() : usernameFromTitle;

    const followerMatch = desc.match(/([\d.,]+[KkMmBb]?)\s*followers?/i);
    const followersCount = followerMatch ? parseHumanCount(followerMatch[1]) : 0;

    let bio = desc;
    if (followerMatch) {
      bio = desc.replace(followerMatch[0], '').replace(/^[.\s]+/, '').trim();
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
      followingCount: 0,
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
    const accountId = session?.accountId || 'threads-guest';
    const limit = Math.max(1, Math.min(100, Number(args.count) || 20));
    const docId = connectionType === 'follower' ? this.docIds.FOLLOWERS : this.docIds.FOLLOWING;

    let profiles = [];
    let pageInfo = { has_next_page: false, end_cursor: null };

    if (docId) {
      try {
        const userId = await this.#resolveUserId(username, accountId);
        const res = await this.client.requestGraphQl(
          docId,
          {
            userID: userId,
            first: limit,
            after: args.cursor || null,
          },
          { accountId }
        );

        const node = res?.data?.node || res?.node || res?.data || res;
        const connection =
          connectionType === 'follower'
            ? (node?.followers_connection || res?.data?.followers_connection || res?.followers_connection)
            : (node?.following_connection || res?.data?.following_connection || res?.following_connection);

        const edges = Array.isArray(connection?.edges) ? connection.edges : [];
        for (const edge of edges) {
          if (!edge?.node) continue;
          profiles.push(normalizeThreadsConnection(edge.node, 'graphql', connectionType));
        }
        pageInfo = connection?.page_info || pageInfo;
      } catch {
        // Fall back to limitation response
      }
    }

    // Public list limitation fallback (AC-4)
    if (profiles.length === 0) {
      const profile = await this.getProfile({ username }, session);
      return {
        profiles: [],
        counts: {
          followersCount: profile.followersCount || 0,
          followingCount: profile.followingCount || 0,
        },
        note: 'Threads does not expose public follower/following lists; only counts are available.',
      };
    }

    // Persist connections to store
    if (this.store && typeof this.store.storeBatch === 'function' && profiles.length > 0) {
      const postItems = profiles.map((p) => profileItemToPostItem(p));
      await this.store.storeBatch(postItems, { upsert: true });
    }

    const targetType = connectionType === 'follower' ? 'followers' : 'following';
    await this.#emitProfileCheckpointAndStream(profiles, targetType, username, pageInfo?.end_cursor);

    return {
      profiles,
      counts: {
        followersCount: profiles.length,
        followingCount: 0,
      },
      pageInfo,
    };
  }

  /**
   * Helper to persist checkpoint and emit thin event pointers to Redis Stream.
   * @param {Array<Record<string, any>>} items
   * @param {string} targetType
   * @param {string} targetKey
   * @param {string | null} [cursor]
   * @param {string} [status='running']
   * @returns {Promise<void>}
   */
  async #emitProfileCheckpointAndStream(items, targetType, targetKey, cursor, status = 'running') {
    if (!items || items.length === 0) return;

    const firstItem = items[0];
    const storageRef = firstItem?.id || null;

    if (this.store && typeof (/** @type {any} */ (this.store)).saveCheckpoint === 'function') {
      try {
        await (/** @type {any} */ (this.store)).saveCheckpoint({
          platform: this.platform,
          targetType,
          targetKey,
          lastCursor: cursor || undefined,
          lastCrawledAt: new Date(),
          status,
          storageRef: storageRef || undefined,
        });
      } catch (err) {
        console.warn(`[${this.platform} TELEMETRY] Failed to save checkpoint for ${targetType}:${targetKey}:`, (err instanceof Error ? err.message : String(err)));
      }
    }

    const publisher = (this.store && /** @type {any} */ (this.store).publisher) || defaultRedisStreamPublisher;
    for (const item of items) {
      await publisher.publish({
        id: item.id,
        platform: item.platform || this.platform,
        externalId: item.externalId,
        category: 'social',
        authorId: item.externalId,
        crawledAt: new Date().toISOString(),
        storageRef: item.id,
      });
    }
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
      message: 'search is not supported in this action',
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
      message: 'getPostDetail is not supported in this action',
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
      message: 'getComments is not supported in this action',
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
