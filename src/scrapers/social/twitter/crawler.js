// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TwitterCrawler — High-throughput hybrid crawler for Twitter/X Web GraphQL API.
 * Extends AbstractCrawler, registers thread, likes, bookmarks, and profile/relationship actions,
 * normalizes data into PostItem/ProfileItem schema, emits checkpoints & telemetry,
 * and persists to PrismaStore.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractCrawler } from '../../../core/base-crawler.js';
import { TwitterClient, resolveTweetId, resolveUsername } from './client.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';
import { normalizeThreadResponse } from './normalize-thread.js';
import { normalizeBookmarksResponse } from './normalize-bookmarks.js';
import {
  normalizeLikersResponse,
  profileItemToPostItem,
  normalizeUserProfile,
} from './normalize-relationships.js';
import { DEFAULT_FEATURES } from '../../twitter/http/endpoints.js';
import { defaultRedisStreamPublisher, isEnvTruthy, toIsoDate } from '../../../utils/redis-stream-publisher.js';

export const TWITTER_GRAPHQL_QUERY_IDS = {
  TweetDetail: 'U0HTv-bAWTBYylwEMT7x5A',
  Favoriters: 'LLkw5EcVutJL6y-2gkz22A',
  Bookmarks: 'qToeLeMs43Q8cr7tRYXmaQ',
  UserByScreenName: 'NimuplG1OB7Fd2btCLdBOw',
  UserByRestId: 'tD8zKvQzwY3kdx5yz6YmOw',
  Followers: 'gC_lyAxZOptAMLCJX5UhWw',
  Following: '2vUj-_Ek-UmBVDNtd8OnQA',
  Retweeters: 'X-XEqG5qHQSAwmvy00xfyQ',
  ListMembers: 'BQp2IEYkgxuSxqbTAr1e1g',
};

export class TwitterCrawler extends AbstractCrawler {
  /** @type {string} */
  name = 'twitter';

  /** @type {string} */
  platform = 'twitter';

  /** @type {boolean} */
  requiresAuth = false;

  /** @type {TwitterClient} */
  client;

  /**
   * @param {Record<string, any>} [deps]
   */
  constructor(deps = {}) {
    const client = deps.client || new TwitterClient({
      baseUrl: deps.baseUrl,
      bearerToken: deps.bearerToken,
      cookies: deps.cookies,
      sessionManager: deps.sessionManager,
      governor: deps.governor,
      accountPool: deps.accountPool,
    });
    super(/** @type {any} */ ({
      ...deps,
      client,
      requiresAuth: deps.requiresAuth ?? false,
    }));

    this.client = client;
    this.redisPublisher = deps.redisPublisher || null;

    // Register Story 13.2.2 Actions (thread, likes, bookmarks)
    this.registerAction({
      action: 'thread',
      description: 'Scrape Twitter conversation thread with tree reconstruction',
      requiredArgs: ['tweetId'],
      optionalArgs: ['cursor', 'limit', 'walkToRoot'],
      example: { tweetId: '1234567890' },
      outputType: '{ posts: PostItem[], rootTweet: PostItem | null, pageInfo: any }',
      requiresAuth: false,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.thread(args, session),
    });

    this.registerAction({
      action: 'likes',
      description: 'Scrape users who liked a tweet (favoriters) using GraphQL',
      requiredArgs: ['tweetId'],
      optionalArgs: ['limit', 'cursor'],
      example: { tweetId: '1234567890', limit: 100 },
      outputType: '{ likers: ProfileItem[], pageInfo: any }',
      requiresAuth: true,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.likes(args, session),
    });

    this.registerAction({
      action: 'likers',
      description: 'Alias for likes action — scrape users who liked a tweet',
      requiredArgs: ['tweetId'],
      optionalArgs: ['limit', 'cursor'],
      example: { tweetId: '1234567890', limit: 100 },
      outputType: '{ likers: ProfileItem[], pageInfo: any }',
      requiresAuth: true,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.likes(args, session),
    });

    this.registerAction({
      action: 'bookmarks',
      description: 'Scrape bookmarked tweets of authenticated account using GraphQL',
      requiredArgs: [],
      optionalArgs: ['limit', 'cursor'],
      example: { limit: 50 },
      outputType: '{ posts: PostItem[], pageInfo: any }',
      requiresAuth: true,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.bookmarks(args, session),
    });

    // Register Story 13.2.1 Actions (profile, followers, following, retweeters, list_members, non_followers)
    this.registerAction({
      action: 'profile',
      description: 'Scrape user profile by username or URL',
      requiredArgs: [],
      optionalArgs: ['username', 'url'],
      example: { username: 'elonmusk' },
      outputType: '{ profile: ProfileItem }',
      requiresAuth: false,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.profile(args, session),
    });

    this.registerAction({
      action: 'followers',
      description: 'Scrape followers list for a user using GraphQL',
      requiredArgs: ['username'],
      optionalArgs: ['limit', 'cursor'],
      example: { username: 'elonmusk', limit: 100 },
      outputType: '{ followers: ProfileItem[], pageInfo: any }',
      requiresAuth: true,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.followers(args, session),
    });

    this.registerAction({
      action: 'following',
      description: 'Scrape following list for a user using GraphQL',
      requiredArgs: ['username'],
      optionalArgs: ['limit', 'cursor'],
      example: { username: 'elonmusk', limit: 100 },
      outputType: '{ following: ProfileItem[], pageInfo: any }',
      requiresAuth: true,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.following(args, session),
    });

    this.registerAction({
      action: 'retweeters',
      description: 'Scrape retweeters of a tweet using GraphQL',
      requiredArgs: ['tweetId'],
      optionalArgs: ['limit', 'cursor'],
      example: { tweetId: '1234567890', limit: 100 },
      outputType: '{ retweeters: ProfileItem[], pageInfo: any }',
      requiresAuth: true,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.retweeters(args, session),
    });

    this.registerAction({
      action: 'list_members',
      description: 'Scrape members of a Twitter list using GraphQL',
      requiredArgs: ['listUrl'],
      optionalArgs: ['listId', 'limit', 'cursor'],
      example: { listUrl: 'https://x.com/i/lists/123456', limit: 100 },
      outputType: '{ members: ProfileItem[], pageInfo: any }',
      requiresAuth: true,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.listMembers(args, session),
    });

    this.registerAction({
      action: 'non_followers',
      description: 'Identify users you follow who do not follow you back',
      requiredArgs: ['username'],
      optionalArgs: ['limit'],
      example: { username: 'myuser', limit: 1000 },
      outputType: '{ nonFollowers: ProfileItem[], mutuals: ProfileItem[], stats: object }',
      requiresAuth: true,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.nonFollowers(args, session),
    });
  }

  /**
   * Emit checkpoint to store and optional Redis Stream telemetry.
   *
   * @param {Object} params
   * @param {string} params.targetType
   * @param {string} params.targetKey
   * @param {string | null} [params.cursor]
   * @param {Array<any>} [params.items]
   * @param {boolean} [params.hasMore]
   */
  async #emitCheckpointAndStream({ targetType, targetKey, cursor = null, items = [], hasMore = false }) {
    try {
      const storeWithCheckpoint = /** @type {any} */ (this.store);
      if (storeWithCheckpoint && typeof storeWithCheckpoint.saveCheckpoint === 'function') {
        const storageRef = items[0]?.id || items[0]?.externalId || '';
        await storeWithCheckpoint.saveCheckpoint({
          platform: 'twitter',
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
        const publisher =
          this.redisPublisher ||
          (this.store && /** @type {any} */ (this.store).publisher) ||
          defaultRedisStreamPublisher;

        if (publisher && typeof publisher.publish === 'function') {
          for (const item of items) {
            const category = 'category' in item && typeof item.category === 'string' ? item.category : 'social';
            await publisher.publish({
              id: item.id,
              platform: 'twitter',
              externalId: item.externalId,
              category,
              authorId: item.authorId || item.externalId || '',
              crawledAt: item.crawledAt ? toIsoDate(item.crawledAt) : new Date().toISOString(),
              storageRef: item.id,
            });
          }
        }
      }
    } catch (err) {
      console.warn(`⚠️ [TWITTER TELEMETRY] Checkpoint/stream emission warning: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Chunk storeBatch writes into chunks of at most 500 records.
   *
   * @param {Array<import('../../../core/types.js').PostItem>} posts
   */
  async #persistPostItems(posts) {
    if (!this.store || !Array.isArray(posts) || posts.length === 0) return;
    const CHUNK_SIZE = 500;
    for (let i = 0; i < posts.length; i += CHUNK_SIZE) {
      const chunk = posts.slice(i, i + CHUNK_SIZE);
      if (typeof this.store.storeBatch === 'function') {
        await this.store.storeBatch(chunk, { upsert: true });
      }
    }
  }

  /**
   * Action Handler: thread (AC-2)
   *
   * @param {Record<string, any>} args
   * @param {any} [session]
   * @returns {Promise<{
   *   posts: import('../../../core/types.js').PostItem[],
   *   rootTweet: import('../../../core/types.js').PostItem | null,
   *   authorReplies: import('../../../core/types.js').PostItem[],
   *   conversation: import('../../../core/types.js').PostItem[],
   *   pageInfo: any
   * }>}
   */
  async thread(args, session) {
    if (!args || (!args.tweetId && !args.url)) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: tweetId',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
      });
    }

    let targetTweetId = resolveTweetId(args.tweetId || args.url);

    // Optional: walk up reply chain if requested
    if (args.walkToRoot) {
      let currentId = targetTweetId;
      const visited = new Set();
      let depth = 0;
      const MAX_DEPTH = 50;

      while (depth < MAX_DEPTH) {
        if (visited.has(currentId)) break;
        visited.add(currentId);

        const walkVars = {
          focalTweetId: currentId,
          with_rux_injections: false,
          rankingMode: 'Relevance',
          includePromotedContent: false,
          withCommunity: true,
          withQuickPromoteEligibilityTweetFields: true,
          withBirdwatchNotes: true,
          withVoice: true,
          withV2Timeline: true,
        };

        try {
          const res = await this.client.requestGraphQl(
            TWITTER_GRAPHQL_QUERY_IDS.TweetDetail,
            'TweetDetail',
            walkVars,
            DEFAULT_FEATURES,
            undefined,
            {
              accountId: session?.accountId || args.accountId,
              requiresAuth: false,
              cookies: session?.cookies,
            }
          );
          const normalizedWalk = normalizeThreadResponse(res);
          const focalPost = normalizedWalk.posts.find((p) => p.externalId === currentId);
          if (!focalPost) break;

          const parentId = /** @type {any} */ (focalPost.metadata)?.parentTweetId;
          if (parentId) {
            currentId = parentId;
            depth++;
          } else {
            break;
          }
        } catch {
          break;
        }
      }
      targetTweetId = currentId;
    }

    const variables = {
      focalTweetId: targetTweetId,
      with_rux_injections: false,
      rankingMode: 'Relevance',
      includePromotedContent: true,
      withCommunity: true,
      withQuickPromoteEligibilityTweetFields: true,
      withBirdwatchNotes: true,
      withVoice: true,
      withV2Timeline: true,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    };

    const response = await this.client.requestGraphQl(
      TWITTER_GRAPHQL_QUERY_IDS.TweetDetail,
      'TweetDetail',
      variables,
      DEFAULT_FEATURES,
      undefined,
      {
        accountId: session?.accountId || args.accountId,
        requiresAuth: false,
        cookies: session?.cookies,
      }
    );

    const normalized = normalizeThreadResponse(response);

    await this.#persistPostItems(normalized.posts);
    await this.#emitCheckpointAndStream({
      targetType: 'thread',
      targetKey: targetTweetId,
      cursor: normalized.pageInfo.end_cursor,
      items: normalized.posts,
      hasMore: normalized.pageInfo.has_next_page,
    });

    return normalized;
  }

  /**
   * Action Handler: likes (AC-3)
   *
   * @param {Record<string, any>} args
   * @param {any} [session]
   * @returns {Promise<{
   *   likers: import('../../../core/types.js').ProfileItem[],
   *   pageInfo: any
   * }>}
   */
  async likes(args, session) {
    if (!args || (!args.tweetId && !args.url)) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: tweetId',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
      });
    }

    const tweetId = resolveTweetId(args.tweetId || args.url);
    const count = Math.min(Number(args.limit) || 20, 100);

    const variables = {
      tweetId,
      count,
      includePromotedContent: true,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    };

    const response = await this.client.requestGraphQl(
      TWITTER_GRAPHQL_QUERY_IDS.Favoriters,
      'Favoriters',
      variables,
      DEFAULT_FEATURES,
      undefined,
      {
        accountId: session?.accountId || args.accountId,
        requiresAuth: true,
        cookies: session?.cookies,
      }
    );

    const normalized = normalizeLikersResponse(response, tweetId);

    // Convert ProfileItem[] to PostItem[] for persistent store
    const posts = normalized.likers.map((p) => profileItemToPostItem(p));
    await this.#persistPostItems(posts);

    await this.#emitCheckpointAndStream({
      targetType: 'likes',
      targetKey: tweetId,
      cursor: normalized.pageInfo.end_cursor,
      items: normalized.likers,
      hasMore: normalized.pageInfo.has_next_page,
    });

    return normalized;
  }

  /**
   * Action Handler: bookmarks (AC-4)
   *
   * @param {Record<string, any>} [args={}]
   * @param {any} [session]
   * @returns {Promise<{
   *   posts: import('../../../core/types.js').PostItem[],
   *   pageInfo: any
   * }>}
   */
  async bookmarks(args = {}, session) {
    const count = Math.min(Number(args.limit) || 20, 100);
    const variables = {
      count,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    };

    const response = await this.client.requestGraphQl(
      TWITTER_GRAPHQL_QUERY_IDS.Bookmarks,
      'Bookmarks',
      variables,
      DEFAULT_FEATURES,
      undefined,
      {
        accountId: session?.accountId || args.accountId,
        requiresAuth: true,
        cookies: session?.cookies,
      }
    );

    const normalized = normalizeBookmarksResponse(response);

    await this.#persistPostItems(normalized.posts);

    const targetKey = session?.accountId || args.accountId || 'self';
    await this.#emitCheckpointAndStream({
      targetType: 'bookmarks',
      targetKey,
      cursor: normalized.pageInfo.end_cursor,
      items: normalized.posts,
      hasMore: normalized.pageInfo.has_next_page,
    });

    return normalized;
  }

  /**
   * Action Handler: profile
   *
   * @param {Record<string, any>} args
   * @param {any} [session]
   * @returns {Promise<{ profile: import('../../../core/types.js').ProfileItem }>}
   */
  async profile(args = {}, session) {
    const username = resolveUsername(args.username || args.url || '');
    const variables = {
      screen_name: username,
      withSafetyModeUserFields: false,
    };

    const response = await this.client.requestGraphQl(
      TWITTER_GRAPHQL_QUERY_IDS.UserByScreenName,
      'UserByScreenName',
      variables,
      DEFAULT_FEATURES,
      undefined,
      {
        accountId: session?.accountId || args.accountId,
        requiresAuth: false,
        cookies: session?.cookies,
      }
    );

    const userResult = response?.data?.user?.result;
    if (!userResult || userResult.__typename === 'UserUnavailable') {
      throw new PlatformError({
        type: ErrorTypes.NOT_FOUND,
        code: 'XACT_4040',
        message: `Twitter user not found: "${username}"`,
        statusCode: 404,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
      });
    }

    const legacy = userResult.legacy || {};
    const profile = normalizeUserProfile(
      {
        id: userResult.rest_id,
        username: legacy.screen_name || username,
        name: legacy.name,
        bio: legacy.description,
        avatar: legacy.profile_image_url_https,
        followersCount: legacy.followers_count,
        followingCount: legacy.friends_count,
        verified: userResult.is_blue_verified || legacy.verified,
        protected: legacy.protected,
      },
      { isProfile: true, sourceMethod: 'profile' }
    );

    const post = profileItemToPostItem(profile);
    await this.#persistPostItems([post]);
    await this.#emitCheckpointAndStream({
      targetType: 'profile',
      targetKey: username,
      items: [profile],
      hasMore: false,
    });

    return { profile };
  }

  /**
   * Action Handler: followers
   *
   * @param {Record<string, any>} args
   * @param {any} [session]
   */
  async followers(args, session) {
    const username = resolveUsername(args.username || args.url || '');
    const count = Math.min(Number(args.limit) || 20, 100);

    const userProfile = await this.profile({ username }, session);
    const userId = userProfile.profile.externalId;

    const variables = {
      userId,
      count,
      includePromotedContent: false,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    };

    const response = await this.client.requestGraphQl(
      TWITTER_GRAPHQL_QUERY_IDS.Followers,
      'Followers',
      variables,
      DEFAULT_FEATURES,
      undefined,
      {
        accountId: session?.accountId || args.accountId,
        requiresAuth: true,
        cookies: session?.cookies,
      }
    );

    const normalized = normalizeLikersResponse(response, userId);
    const followers = normalized.likers.map((p) => (/** @type {import('../../../core/types.js').ProfileItem} */ ({
      ...p,
      metadata: { ...p.metadata, isFollower: true, isLiker: false, sourceMethod: 'followers' },
    })));

    const posts = followers.map((f) => profileItemToPostItem(f));
    await this.#persistPostItems(posts);
    await this.#emitCheckpointAndStream({
      targetType: 'followers',
      targetKey: username,
      cursor: normalized.pageInfo.end_cursor,
      items: followers,
      hasMore: normalized.pageInfo.has_next_page,
    });

    return { followers, pageInfo: normalized.pageInfo };
  }

  /**
   * Action Handler: following
   *
   * @param {Record<string, any>} args
   * @param {any} [session]
   */
  async following(args, session) {
    const username = resolveUsername(args.username || args.url || '');
    const count = Math.min(Number(args.limit) || 20, 100);

    const userProfile = await this.profile({ username }, session);
    const userId = userProfile.profile.externalId;

    const variables = {
      userId,
      count,
      includePromotedContent: false,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    };

    const response = await this.client.requestGraphQl(
      TWITTER_GRAPHQL_QUERY_IDS.Following,
      'Following',
      variables,
      DEFAULT_FEATURES,
      undefined,
      {
        accountId: session?.accountId || args.accountId,
        requiresAuth: true,
        cookies: session?.cookies,
      }
    );

    const normalized = normalizeLikersResponse(response, userId);
    const following = normalized.likers.map((p) => (/** @type {import('../../../core/types.js').ProfileItem} */ ({
      ...p,
      metadata: { ...p.metadata, isFollowing: true, isLiker: false, sourceMethod: 'following' },
    })));

    const posts = following.map((f) => profileItemToPostItem(f));
    await this.#persistPostItems(posts);
    await this.#emitCheckpointAndStream({
      targetType: 'following',
      targetKey: username,
      cursor: normalized.pageInfo.end_cursor,
      items: following,
      hasMore: normalized.pageInfo.has_next_page,
    });

    return { following, pageInfo: normalized.pageInfo };
  }

  /**
   * Action Handler: retweeters
   *
   * @param {Record<string, any>} args
   * @param {any} [session]
   */
  async retweeters(args, session) {
    const tweetId = resolveTweetId(args.tweetId || args.url || '');
    const count = Math.min(Number(args.limit) || 20, 100);

    const variables = {
      tweetId,
      count,
      includePromotedContent: true,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    };

    const response = await this.client.requestGraphQl(
      TWITTER_GRAPHQL_QUERY_IDS.Retweeters,
      'Retweeters',
      variables,
      DEFAULT_FEATURES,
      undefined,
      {
        accountId: session?.accountId || args.accountId,
        requiresAuth: true,
        cookies: session?.cookies,
      }
    );

    const normalized = normalizeLikersResponse(response, tweetId);
    const retweeters = normalized.likers.map((p) => (/** @type {import('../../../core/types.js').ProfileItem} */ ({
      ...p,
      metadata: { ...p.metadata, isRetweeter: true, isLiker: false, sourceMethod: 'retweeters' },
    })));

    const posts = retweeters.map((r) => profileItemToPostItem(r));
    await this.#persistPostItems(posts);
    await this.#emitCheckpointAndStream({
      targetType: 'retweeters',
      targetKey: tweetId,
      cursor: normalized.pageInfo.end_cursor,
      items: retweeters,
      hasMore: normalized.pageInfo.has_next_page,
    });

    return { retweeters, pageInfo: normalized.pageInfo };
  }

  /**
   * Action Handler: list_members
   *
   * @param {Record<string, any>} args
   * @param {any} [session]
   */
  async listMembers(args, session) {
    const listId = args.listId || (args.listUrl ? args.listUrl.match(/lists\/(\d+)/)?.[1] : null);
    if (!listId) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: listId or valid listUrl',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
      });
    }

    const count = Math.min(Number(args.limit) || 20, 100);
    const variables = {
      listId,
      count,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    };

    const response = await this.client.requestGraphQl(
      TWITTER_GRAPHQL_QUERY_IDS.ListMembers,
      'ListMembers',
      variables,
      DEFAULT_FEATURES,
      undefined,
      {
        accountId: session?.accountId || args.accountId,
        requiresAuth: true,
        cookies: session?.cookies,
      }
    );

    const normalized = normalizeLikersResponse(response, listId);
    const members = normalized.likers.map((p) => (/** @type {import('../../../core/types.js').ProfileItem} */ ({
      ...p,
      metadata: { ...p.metadata, isListMember: true, isLiker: false, listId, sourceMethod: 'list_members' },
    })));

    const posts = members.map((m) => profileItemToPostItem(m));
    await this.#persistPostItems(posts);
    await this.#emitCheckpointAndStream({
      targetType: 'list_members',
      targetKey: listId,
      cursor: normalized.pageInfo.end_cursor,
      items: members,
      hasMore: normalized.pageInfo.has_next_page,
    });

    return { members, pageInfo: normalized.pageInfo };
  }

  /**
   * Action Handler: non_followers
   *
   * @param {Record<string, any>} args
   * @param {any} [session]
   */
  async nonFollowers(args, session) {
    const username = resolveUsername(args.username || args.url || '');
    const limit = Number(args.limit) || 200;

    const { following } = await this.following({ username, limit }, session);
    const { followers } = await this.followers({ username, limit }, session);

    const followerUsernames = new Set(
      followers.map((f) => (f.username || '').toLowerCase()).filter(Boolean)
    );

    const nonFollowers = following.filter(
      (f) => f.username && !followerUsernames.has(f.username.toLowerCase())
    );
    const mutuals = following.filter(
      (f) => f.username && followerUsernames.has(f.username.toLowerCase())
    );

    const stats = {
      followingCount: following.length,
      followersCount: followers.length,
      nonFollowersCount: nonFollowers.length,
      mutualsCount: mutuals.length,
    };

    await this.#emitCheckpointAndStream({
      targetType: 'non_followers',
      targetKey: username,
      items: nonFollowers,
      hasMore: false,
    });

    return { nonFollowers, mutuals, stats };
  }
}
