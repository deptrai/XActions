// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TwitterCrawler — High-throughput hybrid crawler for Twitter/X GraphQL and REST APIs.
 * Extends AbstractCrawler, registers search, hashtag, trending, thread, likes, bookmarks,
 * profile, and relationship actions.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractCrawler } from '../../../core/base-crawler.js';
import { TwitterClient, resolveTweetId, resolveUsername } from './client.js';
import { parseSearchTimeline, parseSearchUsers } from './normalize-search.js';
import { tweetMediaToPostItem, parseMediaEntity, mediaObjectsToUrls } from './normalize-media.js';
import { parseTrends } from './normalize-trending.js';
import { normalizeThreadResponse } from './normalize-thread.js';
import { normalizeBookmarksResponse } from './normalize-bookmarks.js';
import {
  normalizeLikersResponse,
  profileItemToPostItem,
  normalizeUserProfile,
} from './normalize-relationships.js';
import {
  normalizeListOrCommunityMembersResponse,
  normalizeSpacesResponse,
} from './normalize-list-community-space.js';
import { buildAdvancedQuery } from '../../twitter/http/search.js';
import { parseTweetData } from '../../twitter/http/tweets.js';
import { extractUserCoreFields } from '../../twitter/http/user-helpers.js';
import { DEFAULT_FEATURES, DEFAULT_FIELD_TOGGLES, GRAPHQL, REST } from '../../twitter/http/endpoints.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';
import { isValidCategory } from '../../../core/types.js';
import { defaultRedisStreamPublisher, isEnvTruthy, toIsoDate } from '../../../utils/redis-stream-publisher.js';
import { gaussianDelay } from '../../../utils/gaussian-delay.js';
import { tweetToPostItem } from './normalize-tweet.js';

export const TWITTER_GRAPHQL_QUERY_IDS = {
  TweetDetail: 'XMOz5h24KAZ86qKffKTLdQ',
  Favoriters: 'LLkw5EcVutJL6y-2gkz22A',
  Bookmarks: 'qToeLeMs43Q8cr7tRYXmaQ',
  UserByScreenName: 'Gb-d6r0vxPOADdG62OEBpQ',
  UserByRestId: 'xvmVfRLmnr1alc5f2dib0Q',
  UserMedia: 'VyudDWQnr9vJNw7GasFz2g',
  TweetResultByRestId: 'GZsN2Pc4knAoit6pXa4HSA',
  Followers: 'JNyQdTISpzCkj_1fqxDvFg',
  Following: 'qGZZDF3mp91q7X22s3HxpA',
  Retweeters: 'X-XEqG5qHQSAwmvy00xfyQ',
  ListMembers: 'BQp2IEYkgxuSxqbTAr1e1g',
  // TBD: replace with real GraphQL query IDs when reverse-engineered.
  CommunityMembers: 'TBD_COMMUNITY_MEMBERS',
  SearchSpaces: 'TBD_SEARCH_SPACES',
  SearchTimeline: 'hyPfJYJ_XAtDYoslQc-Rgg',
};

const VALID_SEARCH_TYPES = new Set(['top', 'latest', 'live', 'photos', 'videos', 'people', 'user', 'all']);
const PRODUCT_MAP = /** @type {Record<string, string>} */ ({
  top: 'Top',
  latest: 'Latest',
  live: 'Latest',
  photos: 'Photos',
  images: 'Photos',
  videos: 'Videos',
  video: 'Videos',
  people: 'People',
  user: 'People',
  all: 'Latest',
});

const SEARCH_FILTER_VALUES = new Set(['links', 'images', 'videos', 'media', 'native_video']);

export class TwitterCrawler extends AbstractCrawler {
  /** @type {string} */
  name = 'twitter';

  /** @type {string} */
  platform = 'twitter';

  /** @type {boolean} */
  requiresAuth = true;

  /** @type {TwitterClient} */
  client;

  /**
   * @param {Record<string, any>} [deps]
   */
  constructor(deps = {}) {
    const { client: explicitClient, ...clientDeps } = deps;
    const client = explicitClient || new TwitterClient(clientDeps);
    super({
      ...deps,
      client,
      requiresAuth: deps.requiresAuth !== undefined ? deps.requiresAuth : true,
    });

    this.client = client;
    this.redisPublisher = deps.redisPublisher || null;

    // ── Story 13.2.3 Actions: search, hashtag, trending ──
    this.registerAction({
      action: 'search',
      description: 'Search global tweets or users by query (requires auth as of 2026-09)',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['query'],
      optionalArgs: ['type', 'filter', 'since', 'until', 'from', 'to', 'minLikes', 'minRetweets', 'lang', 'limit', 'cursor'],
      outputType: '{ posts: PostItem[], users: ProfileItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }',
      example: { query: 'javascript', type: 'Latest', limit: 20 },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.search(args, session),
    });

    this.registerAction({
      action: 'hashtag',
      description: 'Search tweets for a hashtag (requires auth as of 2026-09)',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['tag'],
      optionalArgs: ['hashtag', 'type', 'filter', 'since', 'until', 'minLikes', 'minRetweets', 'lang', 'limit', 'cursor'],
      outputType: '{ posts: PostItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }',
      example: { tag: 'AI', type: 'Latest', limit: 50 },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.hashtag(args, session),
    });

    this.registerAction({
      action: 'trending',
      description: 'Fetch trending topics for a WOEID',
      category: 'social',
      requiresAuth: false,
      requiredArgs: [],
      optionalArgs: ['woeid', 'limit', 'includePromoted'],
      outputType: '{ trends: PostItem[], pageInfo: { has_next_page: false, end_cursor: null } }',
      example: { woeid: 1, limit: 30 },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.trending(args, session),
    });

    // ── Story 13.2.2 Actions: thread, likes, bookmarks ──
    this.registerAction({
      action: 'thread',
      description: 'Scrape Twitter conversation thread; full conversation requires auth, root tweet available as guest',
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

    // ── Story 13.2.1 Actions: profile, followers, following, retweeters, list_members, non_followers ──
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
      action: 'non_followers',
      description: 'Identify users you follow who do not follow you back',
      requiredArgs: ['username'],
      optionalArgs: ['limit'],
      example: { username: 'myuser', limit: 1000 },
      outputType: '{ nonFollowers: ProfileItem[], mutuals: ProfileItem[], stats: object }',
      requiresAuth: true,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.nonFollowers(args, session),
    });

    // ── Story 13.2.5 Actions: list_members, community_members, spaces ──
    this.registerAction({
      action: 'list_members',
      description: 'Scrape members of a Twitter list using GraphQL',
      requiredArgs: ['listUrl'],
      optionalArgs: ['listId', 'limit', 'cursor'],
      example: { listUrl: 'https://x.com/i/lists/1234567890123456789', limit: 100 },
      outputType: '{ members: ProfileItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }',
      requiresAuth: true,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.listMembers(args, session),
    });

    this.registerAction({
      action: 'community_members',
      description: 'Scrape members of a Twitter community using GraphQL or browser-as-signer bridge',
      requiredArgs: ['communityUrl'],
      optionalArgs: ['communityId', 'limit', 'cursor'],
      example: { communityUrl: 'https://x.com/i/communities/1234567890123456789', limit: 100 },
      outputType: '{ members: ProfileItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }',
      requiresAuth: true,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.communityMembers(args, session),
    });

    this.registerAction({
      action: 'spaces',
      description: 'Scrape Twitter Spaces matching a query using GraphQL or browser-as-signer bridge',
      requiredArgs: ['query'],
      optionalArgs: ['limit', 'cursor', 'state'],
      example: { query: 'crypto', limit: 20 },
      outputType: '{ posts: PostItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }',
      requiresAuth: false,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.spaces(args, session),
    });

    // ── Story 13.2.4 Actions: media, download_video ──
    this.registerAction({
      action: 'media',
      description: 'Scrape media (photos, videos, GIFs) from a user profile or a single tweet',
      requiredArgs: [],
      optionalArgs: ['username', 'tweetId', 'type', 'limit', 'cursor'],
      example: { username: 'elonmusk', type: 'video', limit: 20 },
      outputType: '{ posts: PostItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }',
      requiresAuth: false,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.media(args, session),
    });

    this.registerAction({
      action: 'download_video',
      description: 'Extract and optionally download the best MP4 video variant from a tweet',
      requiredArgs: ['tweetId'],
      optionalArgs: ['quality', 'destPath'],
      example: { tweetId: '1234567890123456789', destPath: '/tmp/video.mp4' },
      outputType: '{ url: string, destPath: string | null, bytes: number, width: number, height: number, bitrate: number, contentType: string, durationMs: number | null, variants: Array<{bitrate, contentType, url}> }',
      requiresAuth: false,
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.downloadVideo(args, session),
    });

    // ── Story 13.2.6 Actions: post, reply, quote ──
    this.registerAction({
      action: 'post',
      description: 'Create a new tweet via the CreateTweet GraphQL mutation',
      category: 'social',
      requiresAuth: true,
      requiredArgs: ['text'],
      optionalArgs: ['mediaIds', 'premium', 'sensitive', 'dryRun'],
      example: { text: 'Hello XActions', mediaIds: ['123'], dryRun: false },
      outputType: '{ tweet: PostItem }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.composeContent(args, session, 'post'),
    });

    this.registerAction({
      action: 'reply',
      description: 'Create a reply tweet via the CreateTweet GraphQL mutation',
      category: 'social',
      requiresAuth: true,
      requiredArgs: ['tweetId', 'text'],
      optionalArgs: ['mediaIds', 'premium', 'sensitive', 'dryRun'],
      example: { tweetId: '1900000000000000000', text: 'Nice', dryRun: false },
      outputType: '{ tweet: PostItem }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.composeContent(args, session, 'reply'),
    });

    this.registerAction({
      action: 'quote',
      description: 'Create a quote tweet via the CreateTweet GraphQL mutation',
      category: 'social',
      requiresAuth: true,
      requiredArgs: ['tweetId', 'text'],
      optionalArgs: ['mediaIds', 'premium', 'sensitive', 'dryRun'],
      example: { tweetId: '1900000000000000000', text: 'Agree', dryRun: false },
      outputType: '{ tweet: PostItem }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.composeContent(args, session, 'quote'),
    });

    // ── Story 13.2.7 Action: schedule ──
    this.registerAction({
      action: 'schedule',
      description: 'Schedule a tweet for future publication via the CreateScheduledTweet GraphQL mutation',
      category: 'social',
      requiresAuth: true,
      requiredArgs: ['text', 'publishAt'],
      optionalArgs: ['mediaIds', 'premium', 'sensitive', 'dryRun'],
      example: { text: 'Hello future XActions', publishAt: '2026-09-01T12:00:00Z', dryRun: false },
      outputType: '{ tweet: PostItem }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.schedule(args, session),
    });

    // ── Story 13.2.8 Actions: like, unlike, retweet, undo_retweet ──
    this.registerAction({
      action: 'like',
      description: 'Favorite (like) a tweet via the FavoriteTweet GraphQL mutation',
      category: 'social',
      requiresAuth: true,
      requiredArgs: ['tweetId'],
      optionalArgs: ['dryRun'],
      example: { tweetId: '1900000000000000000', dryRun: false },
      outputType: '{ success: boolean }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.like(args, session),
    });

    this.registerAction({
      action: 'unlike',
      description: 'Unfavorite (unlike) a tweet via the UnfavoriteTweet GraphQL mutation',
      category: 'social',
      requiresAuth: true,
      requiredArgs: ['tweetId'],
      optionalArgs: ['dryRun'],
      example: { tweetId: '1900000000000000000', dryRun: false },
      outputType: '{ success: boolean }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.unlike(args, session),
    });

    this.registerAction({
      action: 'retweet',
      description: 'Retweet a tweet via the CreateRetweet GraphQL mutation',
      category: 'social',
      requiresAuth: true,
      requiredArgs: ['tweetId'],
      optionalArgs: ['dryRun'],
      example: { tweetId: '1900000000000000000', dryRun: false },
      outputType: '{ success: boolean }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.retweet(args, session),
    });

    this.registerAction({
      action: 'undo_retweet',
      description: 'Delete (undo) a retweet via the DeleteRetweet GraphQL mutation',
      category: 'social',
      requiresAuth: true,
      requiredArgs: ['tweetId'],
      optionalArgs: ['dryRun'],
      example: { tweetId: '1900000000000000000', dryRun: false },
      outputType: '{ success: boolean }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.undoRetweet(args, session),
    });

    // ── Story 13.2.9 Actions: follow, unfollow, block, unblock, mute, unmute, bookmark, unbookmark ──
    this.registerAction({
      action: 'follow',
      description: 'Follow a user by username, URL, or userId',
      category: 'social',
      requiresAuth: true,
      requiredArgs: [],
      optionalArgs: ['userId', 'username', 'dryRun'],
      example: { username: 'elonmusk', dryRun: false },
      outputType: '{ success: boolean }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.follow(args, session),
    });

    this.registerAction({
      action: 'unfollow',
      description: 'Unfollow a user by username, URL, or userId',
      category: 'social',
      requiresAuth: true,
      requiredArgs: [],
      optionalArgs: ['userId', 'username', 'dryRun'],
      example: { username: 'elonmusk', dryRun: false },
      outputType: '{ success: boolean }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.unfollow(args, session),
    });

    this.registerAction({
      action: 'block',
      description: 'Block a user by username, URL, or userId',
      category: 'social',
      requiresAuth: true,
      requiredArgs: [],
      optionalArgs: ['userId', 'username', 'dryRun'],
      example: { username: 'spammer', dryRun: false },
      outputType: '{ success: boolean }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.block(args, session),
    });

    this.registerAction({
      action: 'unblock',
      description: 'Unblock a user by username, URL, or userId',
      category: 'social',
      requiresAuth: true,
      requiredArgs: [],
      optionalArgs: ['userId', 'username', 'dryRun'],
      example: { username: 'spammer', dryRun: false },
      outputType: '{ success: boolean }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.unblock(args, session),
    });

    this.registerAction({
      action: 'mute',
      description: 'Mute a user by username, URL, or userId',
      category: 'social',
      requiresAuth: true,
      requiredArgs: [],
      optionalArgs: ['userId', 'username', 'dryRun'],
      example: { username: 'noisy_account', dryRun: false },
      outputType: '{ success: boolean }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.mute(args, session),
    });

    this.registerAction({
      action: 'unmute',
      description: 'Unmute a user by username, URL, or userId',
      category: 'social',
      requiresAuth: true,
      requiredArgs: [],
      optionalArgs: ['userId', 'username', 'dryRun'],
      example: { username: 'noisy_account', dryRun: false },
      outputType: '{ success: boolean }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.unmute(args, session),
    });

    this.registerAction({
      action: 'bookmark',
      description: 'Bookmark a tweet by tweetId via GraphQL CreateBookmark mutation',
      category: 'social',
      requiresAuth: true,
      requiredArgs: ['tweetId'],
      optionalArgs: ['dryRun'],
      example: { tweetId: '1900000000000000000', dryRun: false },
      outputType: '{ success: boolean }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.bookmark(args, session),
    });

    this.registerAction({
      action: 'unbookmark',
      description: 'Remove a bookmark from a tweet by tweetId via GraphQL DeleteBookmark mutation',
      category: 'social',
      requiresAuth: true,
      requiredArgs: ['tweetId'],
      optionalArgs: ['dryRun'],
      example: { tweetId: '1900000000000000000', dryRun: false },
      outputType: '{ success: boolean }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.unbookmark(args, session),
    });

    // ── Story 13.2.10 Actions: send_dm, dm_conversations, dm_messages ──
    this.registerAction({
      action: 'send_dm',
      description: 'Send a direct message to a user or conversation',
      category: 'social',
      requiresAuth: true,
      requiredArgs: [],
      optionalArgs: ['userId', 'username', 'text', 'mediaId', 'conversationId', 'dryRun'],
      example: { username: 'elonmusk', text: 'Hello', dryRun: false },
      outputType: '{ success: boolean, messageId?: string, createdAt?: string }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.sendDm(args, session),
    });

    this.registerAction({
      action: 'dm_conversations',
      description: 'Get list of DM conversations in inbox',
      category: 'social',
      requiresAuth: true,
      requiredArgs: [],
      optionalArgs: ['limit', 'cursor'],
      example: { limit: 20 },
      outputType: '{ conversations: object[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.dmConversations(args, session),
    });

    this.registerAction({
      action: 'dm_messages',
      description: 'Get message history for a specific DM conversation',
      category: 'social',
      requiresAuth: true,
      requiredArgs: ['conversationId'],
      optionalArgs: ['limit', 'cursor'],
      example: { conversationId: '123-456', limit: 50 },
      outputType: '{ messages: object[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.dmMessages(args, session),
    });

    // ── Story 13.2.11 Actions: create_list, add_list_members, remove_list_members ──
    this.registerAction({
      action: 'create_list',
      description: 'Create a new Twitter list',
      category: 'social',
      requiresAuth: true,
      requiredArgs: ['name'],
      optionalArgs: ['description', 'isPrivate', 'dryRun'],
      example: { name: 'Tech Leaders', description: 'Curated list', isPrivate: false, dryRun: false },
      outputType: '{ success: boolean, listId?: string, name?: string }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.createList(args, session),
    });

    this.registerAction({
      action: 'add_list_members',
      description: 'Add members to a Twitter list in batches of up to 100',
      category: 'social',
      requiresAuth: true,
      requiredArgs: ['listId'],
      optionalArgs: ['userIds', 'usernames', 'dryRun'],
      example: { listId: '12345678', usernames: ['elonmusk', 'sama'], dryRun: false },
      outputType: '{ success: boolean, listId: string, addedCount: number, batchCount: number }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.addListMembers(args, session),
    });

    this.registerAction({
      action: 'remove_list_members',
      description: 'Remove members from a Twitter list in batches of up to 100',
      category: 'social',
      requiresAuth: true,
      requiredArgs: ['listId'],
      optionalArgs: ['userIds', 'usernames', 'dryRun'],
      example: { listId: '12345678', usernames: ['spammer'], dryRun: false },
      outputType: '{ success: boolean, listId: string, removedCount: number, batchCount: number }',
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.removeListMembers(args, session),
    });
  }

  /**
   * Convenience accessor for post metadata as an untyped record.
   * @param {import('../../../core/types.js').PostItem} post
   * @returns {Record<string, any>}
   */
  #getMetadata(post) {
    return /** @type {Record<string, any>} */ (post.metadata || {});
  }

  /**
   * Clamp a numeric value to [min, max].
   * @param {unknown} value
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  #clamp(value, min, max) {
    const n = Number(value);
    const parsed = Number.isFinite(n) ? n : min;
    return Math.max(min, Math.min(parsed, max));
  }

  /**
   * Resolve session with optional cookies.
   * @param {Record<string, any>} session
   * @returns {Promise<Record<string, any>>}
   */
  async #resolveSession(session = {}) {
    const accountId = session?.accountId || null;
    const cookies = session?.cookies || (accountId && this.sessionManager?.get(accountId)?.cookies) || null;
    await this.client.init(accountId && cookies ? { accountId, cookies } : {});
    return { accountId, cookies };
  }

  /**
   * Map user-facing type/filter to GraphQL product.
   * @param {string} [type]
   * @param {string} [filter]
   * @returns {{ product: string, searchFilter: string | null, searchType: string }}
   */
  #resolveProduct(type, filter) {
    const typeInput = String(type || '').toLowerCase();
    const filterInput = String(filter || '').toLowerCase();

    if (PRODUCT_MAP[typeInput]) {
      return { product: PRODUCT_MAP[typeInput], searchFilter: null, searchType: PRODUCT_MAP[typeInput] };
    }

    if (typeInput && !VALID_SEARCH_TYPES.has(typeInput)) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: `Invalid search type "${type}". Allowed: Top, Latest, Photos, Videos, People`,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
      });
    }

    if (PRODUCT_MAP[filterInput]) {
      return { product: PRODUCT_MAP[filterInput], searchFilter: null, searchType: PRODUCT_MAP[filterInput] };
    }

    if (filterInput && SEARCH_FILTER_VALUES.has(filterInput)) {
      return { product: 'Latest', searchFilter: filterInput, searchType: 'Latest' };
    }

    if (filterInput && !SEARCH_FILTER_VALUES.has(filterInput) && filterInput !== '') {
      return { product: 'Latest', searchFilter: null, searchType: 'Latest' };
    }

    return { product: 'Latest', searchFilter: null, searchType: 'Latest' };
  }

  /**
   * Build raw search query from args.
   * @param {Object} args
   * @param {string} [args.query]
   * @param {string} [args.type]
   * @param {string} [args.from]
   * @param {string} [args.to]
   * @param {string} [args.mentioning]
   * @param {string} [args.url]
   * @param {string} [args.listId]
   * @param {string} [args.since]
   * @param {string} [args.until]
   * @param {number} [args.minLikes]
   * @param {number} [args.minRetweets]
   * @param {number} [args.minReplies]
   * @param {string} [args.lang]
   * @param {string} [args.filter]
   * @param {string|string[]} [args.exclude]
   * @param {string} [args.near]
   * @param {string} [args.within]
   * @param {boolean} [args.isHashtag]
   * @returns {{ rawQuery: string, product: string, searchType: string }}
   */
  #buildRawQuery(args) {
    const { product, searchFilter, searchType } = this.#resolveProduct(args.type, args.filter);
    const queryOptions = /** @type {Record<string, any>} */ ({
      keywords: args.query || '',
      from: args.from,
      to: args.to,
      mentioning: args.mentioning,
      url: args.url,
      listId: args.listId,
      since: args.since,
      until: args.until,
      minLikes: args.minLikes,
      minRetweets: args.minRetweets,
      minReplies: args.minReplies,
      lang: args.lang,
      near: args.near,
      within: args.within,
    });
    if (searchFilter) queryOptions.filter = searchFilter;
    if (args.exclude) queryOptions.exclude = args.exclude;

    const rawQuery = buildAdvancedQuery(queryOptions);
    return { rawQuery, product, searchType };
  }

  /**
   * Emit checkpoint to store and optional Redis Stream telemetry.
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
        const firstItem = /** @type {any} */ (items[0]);
        const storageRef = firstItem?.id || firstItem?.externalId || '';
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
            const anyItem = /** @type {any} */ (item);
            const category = 'category' in anyItem && typeof anyItem.category === 'string' ? anyItem.category : 'social';
            await publisher.publish({
              id: anyItem.id,
              platform: 'twitter',
              externalId: anyItem.externalId,
              category,
              authorId: anyItem.authorId || anyItem.externalId || '',
              crawledAt: anyItem.crawledAt ? toIsoDate(anyItem.crawledAt) : new Date().toISOString(),
              storageRef: anyItem.id,
            });
          }
        }
      }
    } catch (err) {
      console.warn(`⚠️ [TWITTER TELEMETRY] Checkpoint/stream emission warning: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Ensure a PostItem-compatible object has the minimum fields required by PrismaStore.
   * @param {import('../../../core/types.js').PostItem | import('../../../core/types.js').ProfileItem} item
   * @returns {import('../../../core/types.js').PostItem}
   */
  #toStoreablePostItem(item) {
    const anyItem = /** @type {any} */ (item);
    const storeableCategory = isValidCategory(anyItem.category) ? anyItem.category : 'social';

    return /** @type {import('../../../core/types.js').PostItem} */ ({
      ...anyItem,
      category: storeableCategory,
      authorId: anyItem.authorId || anyItem.externalId || '',
      authorName: anyItem.authorName || anyItem.name || '',
      content: anyItem.content || anyItem.bio || anyItem.name || anyItem.authorName || '',
    });
  }

  /**
   * Store a batch of items.
   * @param {Array<any>} items
   */
  async #persistPostItems(items) {
    if (!this.store || typeof this.store.storeBatch !== 'function' || items.length === 0) return;
    const storeable = items.map((item) => this.#toStoreablePostItem(item));
    for (const item of storeable) {
      this.validateItem(item);
    }
    const CHUNK_SIZE = 500;
    for (let i = 0; i < storeable.length; i += CHUNK_SIZE) {
      const chunk = storeable.slice(i, i + CHUNK_SIZE);
      await this.store.storeBatch(chunk, { upsert: true, validateSchema: true });
    }
  }

  /**
   * Paginated SearchTimeline fetcher.
   * @param {Object} params
   * @param {string} params.rawQuery
   * @param {string} params.product
   * @param {string} params.searchType
   * @param {string} [params.accountId]
   * @param {number} [params.limit=20]
   * @param {string|null} [params.cursor]
   * @param {Record<string, unknown>} [params.extraMetadata]
   * @returns {Promise<{ items: Array<any>, cursor: string | null, hasMore: boolean }>}
   */
  async #paginateSearch({ rawQuery, product, searchType, accountId, limit = 20, cursor = null, extraMetadata = {} }) {
    const maxPerRequest = 50;
    const seen = new Set();
    const allItems = [];
    let nextCursor = cursor;
    let hasMore = false;

    while (allItems.length < limit) {
      const pageLimit = Math.min(limit - allItems.length, maxPerRequest);
      /** @type {Record<string, unknown>} */
      const variables = {
        rawQuery,
        count: pageLimit,
        querySource: 'typed_query',
        product,
      };
      if (nextCursor) variables.cursor = nextCursor;

      const resp = await this.client.requestSearchTimeline('SearchTimeline', variables, {
        accountId,
        requiresAuth: true,
      });

      let pageItems = [];
      if (product === 'People') {
        const { users, cursor: userCursor } = parseSearchUsers(resp, {
          extraMetadata: { isSearchResult: true, searchQuery: rawQuery, searchFilter: product, searchType, sourceMethod: 'search', ...extraMetadata },
        });
        pageItems = users;
        nextCursor = userCursor;
      } else {
        const { posts, cursor: postCursor } = parseSearchTimeline(resp, {
          sourceMethod: 'search',
          extraMetadata: { isSearchResult: true, searchQuery: rawQuery, searchFilter: product, searchType, sourceMethod: 'search', ...extraMetadata },
        });
        pageItems = posts;
        nextCursor = postCursor;
      }

      let added = 0;
      for (const item of pageItems) {
        if (!item || !item.id || seen.has(item.id)) continue;
        seen.add(item.id);
        allItems.push(item);
        added += 1;
        if (allItems.length >= limit) break;
      }

      if (allItems.length >= limit) {
        hasMore = Boolean(nextCursor);
        break;
      }
      if (!nextCursor) {
        hasMore = false;
        break;
      }
      if (added === 0) {
        hasMore = Boolean(nextCursor);
        break;
      }
    }

    return { items: allItems.slice(0, limit), cursor: nextCursor, hasMore };
  }

  /**
   * Action Handler: search
   * @param {Object} args
   * @param {string} args.query
   * @param {string} [args.type]
   * @param {string} [args.filter]
   * @param {number} [args.limit]
   * @param {string} [args.cursor]
   * @param {Record<string, any>} [session={}]
   */
  async search(args, session = {}) {
    if (!args?.query || typeof args.query !== 'string' || args.query.trim() === '') {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing or empty required argument: query',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
        isRetryable: false,
      });
    }

    // SearchTimeline is no longer reachable with a guest token. An auth_token
    // cookie is required for all search/hashtag queries as of 2026-09.
    if (!this.#hasAuth(session)) {
      throw new PlatformError({
        type: ErrorTypes.AUTH_EXPIRED,
        code: 'XACT_4010',
        message: 'Twitter search requires an authenticated session (auth_token cookie). Guest search is no longer supported by X/Twitter.',
        statusCode: 401,
        suggestedAction: SuggestedActions.RELOGIN,
        platform: 'twitter',
      });
    }

    const { accountId } = await this.#resolveSession(session);
    const limit = this.#clamp(args.limit, 1, 1000);
    const { rawQuery, product, searchType } = this.#buildRawQuery(args);

    const { items, cursor, hasMore } = await this.#paginateSearch({
      rawQuery,
      product,
      searchType,
      accountId,
      limit,
      cursor: args.cursor || null,
      extraMetadata: { searchQuery: args.query },
    });

    await this.#persistPostItems(items);
    await this.#emitCheckpointAndStream({
      targetType: 'search',
      targetKey: rawQuery,
      cursor,
      items,
      hasMore,
    });

    const pageInfo = {
      hasNextPage: hasMore,
      has_next_page: hasMore,
      endCursor: cursor,
      end_cursor: cursor,
    };

    if (product === 'People') {
      return { posts: [], users: items, pageInfo };
    }
    return { posts: items, pageInfo };
  }

  /**
   * Action Handler: hashtag
   * @param {Object} args
   * @param {string} [args.hashtag]
   * @param {string} [args.tag]
   * @param {string} [args.type]
   * @param {string} [args.filter]
   * @param {number} [args.limit]
   * @param {string} [args.cursor]
   * @param {Record<string, any>} [session={}]
   */
  async hashtag(args, session = {}) {
    const tag = String(args?.tag ?? args?.hashtag ?? '').trim();
    if (!tag) {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing or empty required argument: hashtag / tag',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
        isRetryable: false,
      });
    }

    const cleanTag = tag.replace(/^#+/, '');
    const searchArgs = { ...args, query: `#${cleanTag}` };

    // SearchTimeline (used by hashtag) now requires auth.
    if (!this.#hasAuth(session)) {
      throw new PlatformError({
        type: ErrorTypes.AUTH_EXPIRED,
        code: 'XACT_4010',
        message: 'Twitter hashtag search requires an authenticated session (auth_token cookie). Guest hashtag search is no longer supported by X/Twitter.',
        statusCode: 401,
        suggestedAction: SuggestedActions.RELOGIN,
        platform: 'twitter',
      });
    }

    const { accountId } = await this.#resolveSession(session);
    const limit = this.#clamp(args.limit, 1, 1000);
    const { rawQuery, product, searchType } = this.#buildRawQuery(searchArgs);

    const { items, cursor, hasMore } = await this.#paginateSearch({
      rawQuery,
      product,
      searchType,
      accountId,
      limit,
      cursor: args.cursor || null,
      extraMetadata: { isHashtag: true, hashtag: cleanTag },
    });

    const posts = items;
    await this.#persistPostItems(posts);
    await this.#emitCheckpointAndStream({
      targetType: 'hashtag',
      targetKey: cleanTag,
      cursor,
      items: posts,
      hasMore,
    });

    return {
      posts,
      pageInfo: {
        hasNextPage: hasMore,
        has_next_page: hasMore,
        endCursor: cursor,
        end_cursor: cursor,
      },
    };
  }

  /**
   * Fetch trending topics by WOEID.
   * @param {Object} args
   * @param {number} [args.woeid=1]
   * @param {number} [args.limit]
   * @param {boolean} [args.includePromoted=false]
   * @param {Record<string, any>} [session={}]
   */
  async trending(args, session = {}) {
    const woeid = Number(args?.woeid) || 1;
    const limit = args?.limit === undefined ? 100 : this.#clamp(args.limit, 1, 100);
    const includePromoted = args?.includePromoted !== false;

    const { accountId } = await this.#resolveSession(session);
    let resp;
    let usedFallback = false;

    try {
      resp = await this.client.requestTrendsPlace(woeid, { accountId, requiresAuth: false });
    } catch (err) {
      const statusCode = /** @type {any} */ (err)?.statusCode || /** @type {any} */ (err)?.httpStatus || 0;
      if (statusCode === 404 || statusCode === 403 || statusCode === 401) {
        usedFallback = true;
      } else {
        throw err;
      }
    }

    let trends = [];
    if (usedFallback || !resp || (Array.isArray(resp) && resp.length === 0)) {
      const { items } = await this.#paginateSearch({
        rawQuery: 'trending',
        product: 'Top',
        searchType: 'Top',
        accountId,
        limit,
        extraMetadata: { isTrend: true, sourceMethod: 'trending' },
      });
      trends = items.slice(0, limit).map((item) => ({
        ...item,
        metadata: { ...item.metadata, woeid, isTrend: true },
      }));
    } else {
      trends = parseTrends(resp, woeid);
    }

    if (!includePromoted) {
      trends = trends.filter((t) => !(t.metadata?.isPromoted));
    }

    if (limit < trends.length) {
      trends = trends.slice(0, limit);
    }

    await this.#persistPostItems(trends);
    await this.#emitCheckpointAndStream({
      targetType: 'trending',
      targetKey: `woeid:${woeid}`,
      items: trends,
      hasMore: false,
    });

    return {
      trends,
      pageInfo: {
        hasNextPage: false,
        has_next_page: false,
        endCursor: null,
        end_cursor: null,
      },
    };
  }

  /**
   * Determine whether an authenticated session (auth_token cookie) is present.
   * @param {Record<string, any>} [session]
   * @returns {boolean}
   */
  #hasAuth(session = {}) {
    const accountId = session?.accountId || null;
    const managerCookies = accountId && this.sessionManager?.get ? this.sessionManager.get(accountId)?.cookies : null;
    const accountRecord = accountId && this.accountPool?.getAccount
      ? this.accountPool.getAccount(accountId, this.platform)
      : null;
    const poolCredentials = accountRecord?.credentials || null;
    const cookieSources = [session?.cookies, managerCookies, poolCredentials?.cookies, this.client?.cookies];
    for (const source of cookieSources) {
      if (!source) continue;
      if (typeof source === 'string') {
        if (/\bauth_token=/.test(source)) return true;
      } else if (source?.auth_token) {
        return true;
      }
    }
    return false;
  }

  /**
   * Resolve a single tweet by ID using TweetResultByRestId.
   * Works with guest tokens for public tweets.
   * @param {string} tweetId
   * @param {Record<string, any>} [session]
   * @returns {Promise<import('../../../core/types.js').PostItem | null>}
   */
  async #resolveSingleTweet(tweetId, session = {}) {
    const { accountId } = await this.#resolveSession(session);
    const variables = {
      tweetId,
      includePromotedContent: false,
      withCommunity: false,
      withVoice: false,
    };
    const response = await this.client.requestGraphQl(
      TWITTER_GRAPHQL_QUERY_IDS.TweetResultByRestId,
      'TweetResultByRestId',
      variables,
      DEFAULT_FEATURES,
      undefined,
      {
        accountId,
        requiresAuth: false,
        cookies: session?.cookies,
      }
    );
    const tweetResult = response?.tweetResult?.result;
    if (!tweetResult) return null;
    return tweetToPostItem(tweetResult, {
      sourceMethod: 'thread',
      extraMetadata: { fallback: 'single-tweet' },
    });
  }

  /**
   * Walk to the root of a reply chain using only public single-tweet lookups.
   * This preserves the no-account guest path for thread root resolution.
   * @param {string} startId
   * @param {Record<string, any>} [session]
   * @returns {Promise<string>}
   */
  async #walkToRootGuest(startId, session = {}) {
    let currentId = startId;
    const visited = new Set();
    let depth = 0;
    const MAX_DEPTH = 50;

    while (depth < MAX_DEPTH) {
      if (visited.has(currentId)) break;
      visited.add(currentId);

      const post = await this.#resolveSingleTweet(currentId, session);
      if (!post) break;

      const parentId = /** @type {any} */ (post.metadata)?.parentTweetId;
      if (parentId) {
        currentId = parentId;
        depth++;
      } else {
        break;
      }
    }
    return currentId;
  }

  /**
   * Action Handler: thread (Story 13.2.2)
   * @param {Record<string, any>} args
   * @param {any} [session]
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
    const hasAuth = this.#hasAuth(session);

    // Authenticated path: full conversation via TweetDetail.
    if (hasAuth) {
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
                requiresAuth: true,
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
          requiresAuth: true,
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

    // Guest / no-auth path: Twitter has closed TweetDetail for guest tokens.
    // Fall back to single-tweet lookup for the requested (or root) tweet.
    if (args.walkToRoot) {
      targetTweetId = await this.#walkToRootGuest(targetTweetId, session);
    }

    const rootPost = await this.#resolveSingleTweet(targetTweetId, session);
    if (!rootPost) {
      throw new PlatformError({
        type: ErrorTypes.NOT_FOUND,
        code: 'XACT_4040',
        message: `Tweet not found or unavailable without auth: "${targetTweetId}"`,
        statusCode: 404,
        suggestedAction: SuggestedActions.RELOGIN,
        platform: 'twitter',
      });
    }

    const posts = [rootPost];
    const pageInfo = {
      cursors: [],
      end_cursor: null,
      has_next_page: false,
    };

    await this.#persistPostItems(posts);
    await this.#emitCheckpointAndStream({
      targetType: 'thread',
      targetKey: targetTweetId,
      items: posts,
      hasMore: false,
    });

    return {
      posts,
      rootTweet: rootPost,
      authorReplies: [],
      conversation: [],
      pageInfo,
      notice: 'Guest session returned root tweet only. Replies require an authenticated session.',
    };
  }

  /**
   * Action Handler: likes (Story 13.2.2)
   * @param {Record<string, any>} args
   * @param {any} [session]
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
   * Action Handler: bookmarks (Story 13.2.2)
   * @param {Record<string, any>} [args={}]
   * @param {any} [session]
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
   * @param {Record<string, any>} args
   * @param {any} [session]
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

    const userResult = response?.user?.result;
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

    const core = extractUserCoreFields(userResult);
    const profile = normalizeUserProfile(
      {
        id: core.restId,
        username: core.username || username,
        name: core.name,
        bio: core.bio,
        avatar: core.avatar,
        followersCount: core.followers,
        followingCount: core.following,
        verified: core.verified,
        protected: core.protected,
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

    const normalized = normalizeListOrCommunityMembersResponse(response, { sourceMethod: 'list_members', groupId: listId });
    const members = normalized.members.map((p) => (/** @type {import('../../../core/types.js').ProfileItem} */ ({
      ...p,
      metadata: { ...p.metadata, isListMember: true, isLiker: false, listId, sourceMethod: 'list_members' },
    })));

    const posts = members.map((m) => profileItemToPostItem(m));
    await this.#persistPostItems(posts);
    await this.#emitCheckpointAndStream({
      targetType: 'list_members',
      targetKey: `twitter:list:${listId}`,
      cursor: normalized.pageInfo.end_cursor,
      items: members,
      hasMore: normalized.pageInfo.has_next_page,
    });

    return { members, pageInfo: normalized.pageInfo };
  }

  /**
   * Action Handler: community_members
   * @param {Record<string, any>} args
   * @param {any} [session]
   */
  async communityMembers(args, session) {
    const communityId = args.communityId || (args.communityUrl ? args.communityUrl.match(/communities\/(\d+)/)?.[1] : null);
    if (!communityId) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: communityId or valid communityUrl',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
      });
    }

    const count = Math.min(Number(args.limit) || 20, 100);

    // TODO: Add real CommunityMembers GraphQL queryId when discovered.
    // For now, attempt a generic timeline fallback by reusing ListMembers structure.
    const hasRealCommunityQuery = TWITTER_GRAPHQL_QUERY_IDS.CommunityMembers && !TWITTER_GRAPHQL_QUERY_IDS.CommunityMembers.startsWith('TBD_');
    const queryId = hasRealCommunityQuery ? TWITTER_GRAPHQL_QUERY_IDS.CommunityMembers : TWITTER_GRAPHQL_QUERY_IDS.ListMembers;
    const operationName = hasRealCommunityQuery ? 'CommunityMembers' : 'ListMembers';

    const variables = {
      listId: communityId,
      count,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    };

    const response = await this.client.requestGraphQl(
      queryId,
      operationName,
      variables,
      DEFAULT_FEATURES,
      undefined,
      {
        accountId: session?.accountId || args.accountId,
        requiresAuth: true,
        cookies: session?.cookies,
      }
    );

    // If the platform reports a private community, translate to a PlatformError.
    const errors = response?.errors || response?.data?.errors;
    if (errors && JSON.stringify(errors).match(/private|unauthorized|not allowed/i)) {
      throw new PlatformError({
        type: ErrorTypes.AUTH_EXPIRED,
        code: 'TWITTER_COMMUNITY_PRIVATE',
        message: `Community ${communityId} is private or requires membership`,
        statusCode: 401,
        suggestedAction: SuggestedActions.RELOGIN,
        platform: 'twitter',
      });
    }

    const normalized = normalizeListOrCommunityMembersResponse(response, { sourceMethod: 'community_members', groupId: communityId });
    const members = normalized.members.map((p) => (/** @type {import('../../../core/types.js').ProfileItem} */ ({
      ...p,
      metadata: { ...p.metadata, isCommunityMember: true, isListMember: false, isLiker: false, communityId, sourceMethod: 'community_members' },
    })));

    const posts = members.map((m) => profileItemToPostItem(m));
    await this.#persistPostItems(posts);
    await this.#emitCheckpointAndStream({
      targetType: 'community_members',
      targetKey: `twitter:community:${communityId}`,
      cursor: normalized.pageInfo.end_cursor,
      items: members,
      hasMore: normalized.pageInfo.has_next_page,
    });

    return { members, pageInfo: normalized.pageInfo };
  }

  /**
   * Action Handler: spaces
   * @param {Record<string, any>} args
   * @param {any} [session]
   */
  async spaces(args, session) {
    const query = String(args.query || '');
    if (!query) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: query',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
      });
    }

    // Spaces search relies on SearchTimeline, which no longer supports guest tokens.
    if (!this.#hasAuth(session)) {
      throw new PlatformError({
        type: ErrorTypes.AUTH_EXPIRED,
        code: 'XACT_4010',
        message: 'Twitter Spaces search requires an authenticated session (auth_token cookie). Guest Spaces search is no longer supported by X/Twitter.',
        statusCode: 401,
        suggestedAction: SuggestedActions.RELOGIN,
        platform: 'twitter',
      });
    }

    const limit = this.#clamp(args.limit, 1, 1000);
    const state = String(args.state || 'all').toLowerCase();

    // TODO: Add real SearchSpaces/LiveEventTimeline GraphQL queryId when discovered.
    // For now, use SearchTimeline as an auth fallback to demonstrate the action.
    const searchQuery = `${query} filter:spaces`;
    const { rawQuery, product, searchType } = this.#buildRawQuery({ query: searchQuery, type: 'Latest' });

    const variables = {
      rawQuery,
      count: Math.min(limit, 100),
      querySource: 'typed_query',
      product,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    };

    const response = await this.client.requestGraphQl(
      TWITTER_GRAPHQL_QUERY_IDS.SearchTimeline,
      'SearchTimeline',
      variables,
      DEFAULT_FEATURES,
      undefined,
      {
        accountId: session?.accountId || args.accountId,
        requiresAuth: true,
        cookies: session?.cookies,
      }
    );

    // Try audio space-specific response shape first, then generic search spaces fallback.
    let normalized;
    if (response && (response.search_spaces || response.data?.search_spaces)) {
      normalized = normalizeSpacesResponse(response);
    } else {
      normalized = this.#extractSpacesFromSearchTimeline(response, { state });
    }

    const allPosts = [];
    const seen = new Set();
    for (const post of normalized.posts) {
      if (seen.has(post.id)) continue;
      seen.add(post.id);
      if (state && state !== 'all' && post.metadata?.spaceState && post.metadata.spaceState !== state) continue;
      allPosts.push(post);
      if (allPosts.length >= limit) break;
    }

    await this.#persistPostItems(allPosts);
    await this.#emitCheckpointAndStream({
      targetType: 'spaces',
      targetKey: `twitter:spaces:${query}`,
      cursor: normalized.pageInfo.end_cursor,
      items: allPosts,
      hasMore: normalized.pageInfo.has_next_page,
    });

    return { posts: allPosts, pageInfo: normalized.pageInfo };
  }

  /**
   * Extract AudioSpace results from a generic SearchTimeline response.
   * @param {Record<string, any>} response
   * @param {Object} [context={}]
   * @returns {{ posts: import('../../../core/types.js').PostItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }}
   */
  #extractSpacesFromSearchTimeline(response, context = {}) {
    const parsed = parseSearchTimeline(response, { sourceMethod: 'spaces' });
    const posts = [];
    for (const post of parsed.posts) {
      const meta = /** @type {Record<string, any>} */ (post.metadata || {});
      if (meta.isSpace || post.postUrl?.includes('/i/spaces/')) {
        posts.push({
          ...post,
          metadata: {
            ...meta,
            isSpace: true,
            spaceState: meta.spaceState || context.state || 'live',
            participantCount: meta.participantCount || 0,
            sourceMethod: 'spaces',
          },
        });
      }
    }
    return { posts, pageInfo: { end_cursor: parsed.cursor, has_next_page: Boolean(parsed.cursor) } };
  }

  /**
   * Action Handler: non_followers
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

  /**
   * Extract tweet result objects from a UserMedia / search timeline response.
   * Handles direct TimelineTimelineItem and TimelineTimelineModule wrappers.
   * @param {Record<string, any>} entry
   * @returns {Record<string, any>[]}
   */
  #extractTweetResultsFromMediaResponse(entry) {
    const results = [];

    const itemContent = entry?.content?.itemContent ?? entry?.content;
    if (itemContent?.tweet_results?.result) {
      const r = itemContent.tweet_results.result;
      const target = r.__typename === 'TweetWithVisibilityResults' ? r.tweet : r;
      if (target) results.push(target);
    }

    const moduleItems = entry?.content?.items ?? [];
    for (const item of moduleItems) {
      const inner = item?.item?.itemContent?.tweet_results?.result;
      if (inner) {
        const r = inner;
        const target = r.__typename === 'TweetWithVisibilityResults' ? r.tweet : r;
        if (target) results.push(target);
      }
    }

    return results;
  }

  /**
   * Build media filter predicate from args.type.
   * @param {string} [type]
   * @returns {(m: Record<string, any>) => boolean}
   */
  #mediaTypeFilter(type) {
    if (!type) return () => true;
    const normalized = String(type).toLowerCase();
    if (normalized === 'gif') return (/** @type {Record<string, any>} */ m) => m.type === 'animated_gif';
    return (/** @type {Record<string, any>} */ m) => m.type === normalized;
  }

  /**
   * Paginated UserMedia fetcher.
   * @param {Object} params
   * @param {string} params.userId
   * @param {number} [params.limit]
   * @param {string|null} [params.cursor]
   * @param {string} [params.type]
   * @param {string} [params.username]
   * @param {string|null} [params.accountId]
   * @returns {Promise<{ items: import('../../../core/types.js').PostItem[], cursor: string|null, hasMore: boolean }>}
   */
  async #paginateUserMedia({ userId, limit = 20, cursor = null, type, username, accountId }) {
    const maxPerRequest = 20;
    const seen = new Set();
    const allItems = [];
    let nextCursor = cursor;
    let hasMore = false;
    const filterFn = this.#mediaTypeFilter(type);

    let emptyPageCount = 0;
    const MAX_EMPTY_PAGES = 5;

    // Twitter retired the UserMedia GraphQL endpoint in 2026-09. Use UserTweets
    // and keep only tweets that contain media matching the requested type.
    const useUserTweetsFallback = true;

    while (allItems.length < limit) {
      const pageLimit = Math.min(limit - allItems.length, maxPerRequest);
      let resp;

      if (useUserTweetsFallback) {
        const variables = {
          userId,
          count: pageLimit,
          includePromotedContent: false,
          withVoice: false,
          ...(nextCursor ? { cursor: nextCursor } : {}),
        };
        resp = await this.client.requestGraphQl(
          TWITTER_GRAPHQL_QUERY_IDS.UserTweets,
          'UserTweets',
          variables,
          DEFAULT_FEATURES,
          undefined,
          {
            accountId,
            requiresAuth: false,
            cookies: undefined,
          }
        );
      } else {
        const variables = {
          userId,
          count: pageLimit,
          includePromotedContent: false,
          withClientEventToken: false,
          withBirdwatchNotes: false,
          withVoice: true,
          withV2Timeline: true,
          ...(nextCursor ? { cursor: nextCursor } : {}),
        };
        resp = await this.client.requestGraphQl(
          TWITTER_GRAPHQL_QUERY_IDS.UserMedia,
          'UserMedia',
          variables,
          DEFAULT_FEATURES,
          undefined,
          {
            accountId,
            requiresAuth: false,
            cookies: undefined,
          }
        );
      }

      const instructions = resp?.user?.result?.timeline_v2?.timeline?.instructions
        ?? resp?.user?.result?.timeline?.timeline?.instructions
        ?? [];
      let foundTweets = false;
      nextCursor = null;

      for (const instruction of instructions) {
        const entries = instruction.entries ?? [];
        for (const entry of entries) {
          if (entry.entryId?.startsWith('cursor-bottom-')) {
            nextCursor = entry.content?.value ?? null;
            continue;
          }

          const tweetResults = this.#extractTweetResultsFromMediaResponse(entry);
          for (const tweetResult of tweetResults) {
            const post = tweetMediaToPostItem(tweetResult, {
              sourceMethod: 'media',
              extraMetadata: { isMedia: true },
            });
            if (!post) continue;

            const meta = this.#getMetadata(post);
            const mediaMatchesType = (meta.media || []).some(filterFn);
            if (type && !mediaMatchesType) continue;

            // UserTweets fallback: skip tweets with no media entirely
            if (useUserTweetsFallback && (meta.media || []).length === 0) continue;

            if (seen.has(post.id)) continue;
            seen.add(post.id);
            allItems.push(post);
            foundTweets = true;
            if (allItems.length >= limit) break;
          }
          if (allItems.length >= limit) break;
        }
        if (allItems.length >= limit) break;
      }

      if (allItems.length >= limit) {
        hasMore = Boolean(nextCursor);
        break;
      }
      if (!nextCursor) {
        hasMore = false;
        break;
      }
      if (!foundTweets) {
        emptyPageCount += 1;
        if (emptyPageCount >= MAX_EMPTY_PAGES) {
          hasMore = false;
          break;
        }
        // Continue to next page; a type-filtered timeline may skip many pages.
        continue;
      }
      emptyPageCount = 0;
    }

    return { items: allItems.slice(0, limit), cursor: nextCursor, hasMore };
  }

  /**
   * Action Handler: media
   * @param {Record<string, any>} args
   * @param {any} [session]
   */
  async media(args = {}, session) {
    const hasUsername = Boolean(args.username);
    const hasTweetId = Boolean(args.tweetId);

    if (!hasUsername && !hasTweetId) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: username or tweetId',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
      });
    }

    const { accountId } = await this.#resolveSession(session);

    if (hasTweetId) {
      const tweetId = resolveTweetId(args.tweetId);

      const variables = {
        tweetId,
        includePromotedContent: false,
        withCommunity: false,
        withVoice: false,
      };

      const response = await this.client.requestGraphQl(
        TWITTER_GRAPHQL_QUERY_IDS.TweetResultByRestId,
        'TweetResultByRestId',
        variables,
        DEFAULT_FEATURES,
        undefined,
        {
          accountId,
          requiresAuth: false,
          cookies: session?.cookies,
        }
      );

      const tweetResult = response?.tweetResult?.result;
      if (!tweetResult) {
        throw new PlatformError({
          type: ErrorTypes.NOT_FOUND,
          code: 'XACT_4040',
          message: `Tweet not found: "${tweetId}"`,
          statusCode: 404,
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
          platform: 'twitter',
        });
      }

      const post = tweetMediaToPostItem(tweetResult, {
        sourceMethod: 'media',
        extraMetadata: { isMedia: true },
      });

      if (!post) {
        throw new PlatformError({
          type: ErrorTypes.NOT_FOUND,
          code: 'XACT_4040',
          message: `Could not parse tweet media: "${tweetId}"`,
          statusCode: 404,
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
          platform: 'twitter',
        });
      }

      const filterFn = this.#mediaTypeFilter(args.type);
      const meta = this.#getMetadata(post);
      if (args.type) {
        meta.media = (meta.media || []).filter(filterFn);
        post.mediaUrls = mediaObjectsToUrls(meta.media);
        if (meta.media.length === 0) {
          return {
            posts: [],
            pageInfo: {
              hasNextPage: false,
              has_next_page: false,
              endCursor: null,
              end_cursor: null,
            },
          };
        }
      }

      await this.#persistPostItems([post]);
      await this.#emitCheckpointAndStream({
        targetType: 'media',
        targetKey: `twitter:tweet:${tweetId}`,
        items: [post],
        hasMore: false,
      });

      return {
        posts: [post],
        pageInfo: {
          hasNextPage: false,
          has_next_page: false,
          endCursor: null,
          end_cursor: null,
        },
      };
    }

    const username = resolveUsername(args.username || args.url || '');
    const userProfile = await this.profile({ username }, session);
    const userId = userProfile.profile?.externalId;
    if (!userId) {
      throw new PlatformError({
        type: ErrorTypes.NOT_FOUND,
        code: 'XACT_4040',
        message: `Could not resolve user ID for "${username}"`,
        statusCode: 404,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
      });
    }

    const limit = this.#clamp(args.limit, 1, 1000);
    const { items, cursor, hasMore } = await this.#paginateUserMedia({
      userId,
      limit,
      cursor: args.cursor || null,
      type: args.type,
      username,
      accountId,
    });

    await this.#persistPostItems(items);
    await this.#emitCheckpointAndStream({
      targetType: 'media',
      targetKey: `twitter:user:${username}`,
      cursor,
      items,
      hasMore,
    });

    return {
      posts: items,
      pageInfo: {
        hasNextPage: hasMore,
        has_next_page: hasMore,
        endCursor: cursor,
        end_cursor: cursor,
      },
    };
  }

  /**
   * Action Handler: download_video
   * @param {Record<string, any>} args
   * @param {any} [session]
   */
  async downloadVideo(args, session) {
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
    const quality = String(args.quality || 'highest').toLowerCase();
    if (!['highest', 'lowest', 'all'].includes(quality)) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: `Invalid quality "${args.quality}". Allowed: highest, lowest, all`,
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
      });
    }

    const { accountId } = await this.#resolveSession(session);

    const variables = {
      tweetId,
      includePromotedContent: false,
      withCommunity: false,
      withVoice: false,
    };

    const response = await this.client.requestGraphQl(
      TWITTER_GRAPHQL_QUERY_IDS.TweetResultByRestId,
      'TweetResultByRestId',
      variables,
      DEFAULT_FEATURES,
      undefined,
      {
        accountId,
        requiresAuth: false,
        cookies: session?.cookies,
      }
    );

    const tweetResult = response?.tweetResult?.result;
    if (!tweetResult) {
      throw new PlatformError({
        type: ErrorTypes.NOT_FOUND,
        code: 'XACT_4040',
        message: `Tweet not found: "${tweetId}"`,
        statusCode: 404,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
      });
    }

    const parsed = parseTweetData(tweetResult);
    if (!parsed || !parsed.id) {
      throw new PlatformError({
        type: ErrorTypes.NOT_FOUND,
        code: 'XACT_4040',
        message: `Could not parse tweet: "${tweetId}"`,
        statusCode: 404,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
      });
    }

    const mediaRaw = Array.isArray(parsed.media) ? parsed.media : [];
    const video = mediaRaw.find((m) => m.type === 'video' || m.type === 'animated_gif');

    if (!video) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: `Tweet "${tweetId}" does not contain a video or GIF`,
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
      });
    }

    const mediaObj = parseMediaEntity(video);
    const variants = mediaObj.variants || [];

    if (quality === 'all') {
      if (args.destPath) {
        throw new PlatformError({
          type: ErrorTypes.INVALID_ARGS,
          code: 'XACT_4001',
          message: 'Cannot use destPath with quality "all" — multiple variants would overwrite the same file',
          statusCode: 400,
          suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
          platform: 'twitter',
        });
      }
      return {
        url: mediaObj.url,
        destPath: null,
        bytes: 0,
        width: mediaObj.width,
        height: mediaObj.height,
        bitrate: mediaObj.bitrate ?? 0,
        contentType: mediaObj.contentType,
        durationMs: mediaObj.durationMs,
        variants,
      };
    }

    const variant = quality === 'highest' ? variants[0] : variants[variants.length - 1];
    if (!variant) {
      throw new PlatformError({
        type: ErrorTypes.NOT_FOUND,
        code: 'XACT_4040',
        message: `No downloadable video variant found for tweet "${tweetId}"`,
        statusCode: 404,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
      });
    }

    let destPath = args.destPath || null;
    let bytes = 0;

    if (destPath) {
      const { pipeline } = await import('node:stream/promises');
      const { createWriteStream } = await import('node:fs');
      const { Readable } = await import('node:stream');
      const fs = await import('node:fs/promises');
      const path = await import('node:path');

      const MAX_VIDEO_BYTES = 512 * 1024 * 1024;
      const outputDir = /** @type {string} */ (destPath ? path.dirname(destPath) : '');
      if (outputDir) await fs.mkdir(outputDir, { recursive: true });

      let downloaded = 0;
      /** @type {number | null} */
      let total = null;
      const fileStream = createWriteStream(/** @type {string} */ (destPath));

      const cleanup = async () => {
        try {
          fileStream.destroy();
          await fs.unlink(destPath);
        } catch {
          // ignore cleanup errors
        }
      };

      try {
        const { status, headers, body } = await this.client.requestStream(variant.url, {
          requiresAuth: false,
          timeout: 300000,
        });

        if (status < 200 || status >= 400) {
          await cleanup();
          throw new PlatformError({
            type: ErrorTypes.INTERNAL,
            code: 'XACT_5000',
            message: `Download failed: HTTP ${status} for ${variant.url}`,
            statusCode: status,
            suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
            platform: 'twitter',
          });
        }

        const totalHeader = headers?.['content-length'] || headers?.['Content-Length'];
        const parsedTotal = totalHeader ? parseInt(String(totalHeader), 10) : null;
        if (parsedTotal && parsedTotal > MAX_VIDEO_BYTES) {
          await cleanup();
          throw new PlatformError({
            type: ErrorTypes.INVALID_ARGS,
            code: 'XACT_4001',
            message: 'Video exceeds 512 MB limit',
            statusCode: 400,
            suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
            platform: 'twitter',
          });
        }
        total = parsedTotal;

        if (!body) {
          await cleanup();
          throw new PlatformError({
            type: ErrorTypes.INTERNAL,
            code: 'XACT_5000',
            message: `Download response has no body for ${variant.url}`,
            statusCode: 500,
            suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
            platform: 'twitter',
          });
        }

        await pipeline(
          Readable.fromWeb(/** @type {any} */ (body)),
          new (await import('node:stream')).Writable({
            write(chunk, encoding, callback) {
              downloaded += chunk.length;
              if (downloaded > MAX_VIDEO_BYTES) {
                callback(new PlatformError({
                  type: ErrorTypes.INVALID_ARGS,
                  code: 'XACT_4001',
                  message: 'Video exceeds 512 MB limit while streaming',
                  statusCode: 400,
                  suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
                  platform: 'twitter',
                }));
                return;
              }
              args.onProgress?.({ downloaded, total });
              fileStream.write(chunk, encoding, callback);
            },
            final(callback) {
              fileStream.end(callback);
            },
            destroy(error, callback) {
              if (error) cleanup().finally(() => callback(error));
              else callback(error);
            },
          })
        );
        bytes = downloaded;
      } catch (err) {
        await cleanup();
        throw err;
      }
    }

    return {
      url: variant.url,
      destPath,
      bytes,
      width: mediaObj.width,
      height: mediaObj.height,
      bitrate: variant.bitrate,
      contentType: variant.contentType,
      durationMs: mediaObj.durationMs,
      variants,
    };
  }

  /**
   * Action Handler: post / reply / quote
   * @param {Record<string, any>} args
   * @param {Record<string, any>} session
   * @param {'post' | 'reply' | 'quote'} sourceMethod
   * @returns {Promise<{ tweet: import('../../../core/types.js').PostItem }>}
   */
  async composeContent(args, session, sourceMethod) {
    const text = typeof args.text === 'string' ? args.text : '';
    const premium = Boolean(args.premium);
    const sensitive = Boolean(args.sensitive);
    const dryRun = args.dryRun !== false;
    const mediaIds = Array.isArray(args.mediaIds) ? args.mediaIds : [];

    this.#validateTweetText(text, { premium });

    if (mediaIds.length > 4) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: `Too many media IDs (${mediaIds.length}/4)`,
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
      });
    }

    const { accountId } = await this.#resolveSession(session);

    const targetTweetId = sourceMethod !== 'post'
      ? resolveTweetId(args.tweetId || args.url || '')
      : undefined;

    const baseVariables = {
      tweet_text: text,
      dark_request: false,
      media: {
        media_entities: mediaIds.map((id) => ({ media_id: String(id), tagged_users: [] })),
        possibly_sensitive: sensitive,
      },
      semantic_annotation_ids: [],
    };

    const variables = this.#buildComposeVariables(baseVariables, sourceMethod, targetTweetId);
    const extraMetadata = this.#buildComposeMetadata(sourceMethod, targetTweetId, mediaIds);

    if (dryRun) {
      console.log(`🔄 [DRY RUN] ${sourceMethod}: ${JSON.stringify({ text, mediaIds: mediaIds.length, sourceMethod, targetTweetId })}`);
      const dryPost = this.#createDryRunPostItem({ text, sourceMethod, extraMetadata });
      return { tweet: dryPost };
    }

    await gaussianDelay(3000, 7000);

    console.log(`🔄 [WRITE] ${sourceMethod}: ${JSON.stringify({ accountId, textLength: text.length, hasMedia: mediaIds.length > 0, dryRun })}`);

    const response = await this.client.requestGraphQl(
      GRAPHQL.CreateTweet.queryId,
      GRAPHQL.CreateTweet.operationName,
      variables,
      DEFAULT_FEATURES,
      DEFAULT_FIELD_TOGGLES,
      {
        accountId,
        requiresAuth: true,
        method: 'POST',
        cookies: session?.cookies,
      }
    );

    const graphQLErrors = Array.isArray(response?.errors) ? response.errors : (Array.isArray(response?.data?.errors) ? response.data.errors : null);
    if (graphQLErrors) {
      const firstError = graphQLErrors[0] || {};
      const upstreamMessage = firstError.message || String(firstError);
      throw new PlatformError({
        type: ErrorTypes.INTERNAL,
        code: 'XACT_5000',
        message: `Twitter CreateTweet error: ${upstreamMessage}`,
        statusCode: firstError.code ? Number(firstError.code) : 500,
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform: 'twitter',
        details: { sourceMethod, errors: graphQLErrors },
      });
    }

    const rawResult =
      response?.data?.create_tweet?.tweet_results?.result ??
      response?.create_tweet?.tweet_results?.result ??
      response?.tweet_results?.result ??
      response;

    const post = tweetToPostItem(rawResult, {
      sourceMethod,
      extraMetadata,
    });

    if (!post) {
      throw new PlatformError({
        type: ErrorTypes.INTERNAL,
        code: 'XACT_5000',
        message: `Could not parse created tweet response for ${sourceMethod}`,
        statusCode: 500,
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform: 'twitter',
      });
    }

    console.log(`✅ [WRITE] ${sourceMethod} ok: ${JSON.stringify({ accountId, tweetId: post.externalId, textLength: text.length, hasMedia: mediaIds.length > 0 })}`);

    await this.#persistPostItems([post]);
    await this.#emitCheckpointAndStream({
      targetType: sourceMethod,
      targetKey: post.id,
      items: [post],
      hasMore: false,
    });

    return { tweet: post };
  }

  /**
   * Validate tweet text length.
   * @param {string} text
   * @param {{ premium?: boolean }} [options]
   */
  #validateTweetText(text, options = {}) {
    const premium = Boolean(options.premium);
    const limit = premium ? 25_000 : 280;
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Tweet text must be a non-empty string',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
      });
    }
    if (text.length > limit) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: `Tweet text exceeds maximum length (${text.length}/${limit})`,
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
      });
    }
  }

  /**
   * Build CreateTweet variables for post / reply / quote.
   * @param {Record<string, any>} baseVariables
   * @param {'post' | 'reply' | 'quote'} sourceMethod
   * @param {string | undefined} targetTweetId
   * @returns {Record<string, any>}
   */
  #buildComposeVariables(baseVariables, sourceMethod, targetTweetId) {
    const variables = { ...baseVariables };

    if (sourceMethod === 'reply' && targetTweetId) {
      variables.reply = {
        in_reply_to_tweet_id: targetTweetId,
        exclude_reply_user_ids: [],
      };
    }

    if (sourceMethod === 'quote' && targetTweetId) {
      variables.attachment_url = `https://x.com/i/status/${targetTweetId}`;
    }

    return variables;
  }

  /**
   * Build extra metadata for post / reply / quote PostItem.
   * @param {'post' | 'reply' | 'quote'} sourceMethod
   * @param {string | undefined} targetTweetId
   * @param {string[]} mediaIds
   * @returns {Record<string, any>}
   */
  #buildComposeMetadata(sourceMethod, targetTweetId, mediaIds) {
    const metadata = {};
    if (sourceMethod === 'reply' && targetTweetId) {
      metadata.replyToTweetId = targetTweetId;
    }
    if (sourceMethod === 'quote' && targetTweetId) {
      metadata.quotedTweetId = targetTweetId;
    }
    if (mediaIds.length > 0) {
      metadata.mediaIds = mediaIds;
    }
    return metadata;
  }

  /**
   * Create a preview PostItem for dry-run write actions.
   * @param {Record<string, any>} params
   * @returns {import('../../../core/types.js').PostItem}
   */
  #createDryRunPostItem({ text, sourceMethod, extraMetadata }) {
    const now = new Date();
    const externalId = `dry-run-${sourceMethod}-${now.getTime()}`;

    return /** @type {import('../../../core/types.js').PostItem} */ ({
      id: `twitter:${externalId}`,
      platform: 'twitter',
      externalId,
      category: 'social',
      authorId: '',
      authorName: '',
      content: text,
      mediaUrls: [],
      likesCount: 0,
      repostsCount: 0,
      repliesCount: 0,
      viewsCount: 0,
      publishedAt: now,
      crawledAt: now,
      metadata: {
        tweetId: externalId,
        dryRun: true,
        sourceMethod,
        ...extraMetadata,
      },
    });
  }

  /**
   * Normalize a publishAt value to Unix seconds.
   * Accepts ISO string, Date, milliseconds, or seconds.
   * @param {string | number | Date} publishAt
   * @returns {{ executeAt: number, publishAtDate: Date, publishAtIso: string }}
   */
  #normalizePublishAt(publishAt) {
    let ms;
    if (publishAt instanceof Date) {
      ms = publishAt.getTime();
    } else if (typeof publishAt === 'number') {
      ms = publishAt < 1e10 ? publishAt * 1000 : publishAt;
    } else if (typeof publishAt === 'string') {
      const trimmed = publishAt.trim();
      if (/^\d+$/.test(trimmed)) {
        const n = Number(trimmed);
        ms = n < 1e10 ? n * 1000 : n;
      } else {
        ms = Date.parse(trimmed);
      }
    } else {
      ms = NaN;
    }

    if (!Number.isFinite(ms) || ms <= 0) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: `Invalid publishAt value: ${publishAt}`,
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
      });
    }

    const publishAtDate = new Date(ms);
    const executeAt = Math.floor(ms / 1000);
    const publishAtIso = publishAtDate.toISOString();
    return { executeAt, publishAtDate, publishAtIso };
  }

  /**
   * Validate scheduled tweet payload before dispatch.
   * @param {string} text
   * @param {string | number | Date} publishAt
   * @param {string[]} mediaIds
   * @param {{ premium?: boolean }} [options]
   */
  #validateSchedulePayload(text, publishAt, mediaIds, options = {}) {
    this.#validateTweetText(text, { premium: options.premium });

    if (mediaIds.length > 4) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: `Too many media IDs (${mediaIds.length}/4)`,
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
      });
    }

    const { executeAt, publishAtDate, publishAtIso } = this.#normalizePublishAt(publishAt);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const graceSeconds = 5;
    if (executeAt < nowSeconds + graceSeconds) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: `publishAt must be in the future (${publishAtDate.toISOString()})`,
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
      });
    }

    return { executeAt, publishAtDate, publishAtIso };
  }

  /**
   * Action Handler: schedule (Story 13.2.7)
   * @param {Record<string, any>} args
   * @param {Record<string, any>} session
   * @returns {Promise<{ tweet: import('../../../core/types.js').PostItem }>}
   */
  async schedule(args, session) {
    const text = typeof args.text === 'string' ? args.text : '';
    const premium = Boolean(args.premium);
    const sensitive = Boolean(args.sensitive);
    const dryRun = args.dryRun !== false;
    const mediaIds = Array.isArray(args.mediaIds) ? args.mediaIds : [];

    const { executeAt, publishAtDate, publishAtIso } = this.#validateSchedulePayload(text, args.publishAt, mediaIds, { premium });

    const { accountId } = await this.#resolveSession(session);

    const variables = {
      post_tweet_request: {
        auto_populate_reply_metadata: false,
        status: text,
        exclude_reply_user_ids: [],
        media_ids: mediaIds.map((id) => String(id)),
      },
      execute_at: executeAt,
    };

    if (dryRun) {
      console.log(`🔄 [DRY RUN] schedule: ${JSON.stringify({ text, publishAt: publishAtIso, mediaIds: mediaIds.length })}`);
      const dryPost = this.#createScheduleDryRunPostItem({ text, publishAt: publishAtIso });
      return { tweet: dryPost };
    }

    await gaussianDelay(3000, 7000);

    console.log(`🔄 [WRITE] schedule: ${JSON.stringify({ accountId, textLength: text.length, hasMedia: mediaIds.length > 0, publishAt: publishAtIso })}`);

    const response = await this.client.requestGraphQl(
      GRAPHQL.CreateScheduledTweet.queryId,
      GRAPHQL.CreateScheduledTweet.operationName,
      variables,
      DEFAULT_FEATURES,
      DEFAULT_FIELD_TOGGLES,
      {
        accountId,
        requiresAuth: true,
        method: 'POST',
        cookies: session?.cookies,
      }
    );

    const graphQLErrors = Array.isArray(response?.errors) ? response.errors : (Array.isArray(response?.data?.errors) ? response.data.errors : null);
    if (graphQLErrors) {
      const firstError = graphQLErrors[0] || {};
      const upstreamMessage = firstError.message || String(firstError);
      throw new PlatformError({
        type: ErrorTypes.INTERNAL,
        code: 'XACT_5000',
        message: `Twitter CreateScheduledTweet error: ${upstreamMessage}`,
        statusCode: firstError.code ? Number(firstError.code) : 500,
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform: 'twitter',
        details: { sourceMethod: 'schedule', errors: graphQLErrors },
      });
    }

    const scheduledRoot =
      response?.data?.create_scheduled_tweet ??
      response?.create_scheduled_tweet ??
      response?.data ??
      response;

    const scheduledId =
      scheduledRoot?.id ??
      scheduledRoot?.rest_id ??
      scheduledRoot?.tweet_results?.result?.rest_id ??
      null;

    if (!scheduledId) {
      throw new PlatformError({
        type: ErrorTypes.INTERNAL,
        code: 'XACT_5000',
        message: 'Could not parse CreateScheduledTweet response: missing scheduled id',
        statusCode: 500,
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform: 'twitter',
      });
    }

    const externalId = String(scheduledId);
    const now = new Date();

    const post = /** @type {import('../../../core/types.js').PostItem} */ ({
      id: `twitter:${externalId}`,
      platform: 'twitter',
      externalId,
      category: 'social',
      authorId: accountId || '',
      authorName: '',
      content: text,
      mediaUrls: [],
      likesCount: 0,
      repostsCount: 0,
      repliesCount: 0,
      viewsCount: 0,
      publishedAt: publishAtDate,
      crawledAt: now,
      metadata: {
        tweetId: externalId,
        scheduledAt: publishAtIso,
        scheduledTweetId: externalId,
        sourceMethod: 'schedule',
        mediaIds: mediaIds.length > 0 ? mediaIds.map(String) : undefined,
      },
    });

    console.log(`✅ [WRITE] schedule ok: ${JSON.stringify({ accountId, scheduledTweetId: externalId, textLength: text.length, hasMedia: mediaIds.length > 0 })}`);

    await this.#persistPostItems([post]);
    await this.#emitCheckpointAndStream({
      targetType: 'schedule',
      targetKey: externalId,
      items: [post],
      hasMore: false,
    });

    return { tweet: post };
  }

  /**
   * Create a preview PostItem for dry-run schedule action.
   * @param {Record<string, any>} params
   * @returns {import('../../../core/types.js').PostItem}
   */
  #createScheduleDryRunPostItem({ text, publishAt }) {
    const now = new Date();
    const externalId = `schedule-dryrun-${now.getTime()}`;

    return /** @type {import('../../../core/types.js').PostItem} */ ({
      id: `twitter:${externalId}`,
      platform: 'twitter',
      externalId,
      category: 'social',
      authorId: '',
      authorName: '',
      content: text,
      mediaUrls: [],
      likesCount: 0,
      repostsCount: 0,
      repliesCount: 0,
      viewsCount: 0,
      publishedAt: new Date(publishAt),
      crawledAt: now,
      metadata: {
        tweetId: externalId,
        dryRun: true,
        sourceMethod: 'schedule',
        scheduledAt: publishAt,
      },
    });
  }

  /**
   * Generic handler for Twitter engagement mutations (like, unlike, retweet, undo_retweet).
   * @param {Record<string, any>} args
   * @param {Record<string, any>} session
   * @param {'like' | 'unlike' | 'retweet' | 'undo_retweet'} actionName
   * @param {{ queryId: string, operationName: string, buildVariables: (tweetId: string) => Record<string, any> }} mutationConfig
   * @returns {Promise<{ success: boolean }>}
   */
  async #performEngagement(args, session, actionName, mutationConfig) {
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
    const dryRun = args.dryRun !== false;

    if (dryRun) {
      console.log(`🔄 [DRY RUN] ${actionName}: ${JSON.stringify({ tweetId })}`);
      return { success: true };
    }

    const { accountId } = await this.#resolveSession(session);

    await gaussianDelay(1000, 3000);

    console.log(`🔄 [WRITE] ${actionName}: ${JSON.stringify({ accountId, tweetId })}`);

    const IDEMPOTENT_ENGAGEMENT_MESSAGES = [
      'already favorited',
      'already retweeted',
      'already bookmarked',
      'you have already',
      'not found in list of retweets',
    ];

    const variables = mutationConfig.buildVariables(tweetId);

    const response = await this.client.requestGraphQl(
      mutationConfig.queryId,
      mutationConfig.operationName,
      variables,
      DEFAULT_FEATURES,
      DEFAULT_FIELD_TOGGLES,
      {
        accountId,
        requiresAuth: true,
        method: 'POST',
        cookies: session?.cookies,
      }
    );

    const graphQLErrors = response?.errors || response?.data?.errors;
    if (Array.isArray(graphQLErrors) && graphQLErrors.length > 0) {
      for (const err of graphQLErrors) {
        const msg = String(err?.message || '').toLowerCase();
        if (IDEMPOTENT_ENGAGEMENT_MESSAGES.some((needle) => msg.includes(needle))) {
          console.log(`ℹ️ [WRITE] ${actionName} idempotent hit: "${msg}"`);
          return { success: true };
        }
      }

      const firstError = graphQLErrors[0];
      throw new PlatformError({
        type: ErrorTypes.INTERNAL,
        code: 'XACT_5000',
        message: firstError?.message || `GraphQL error while performing ${actionName}`,
        statusCode: firstError?.code ? Number(firstError.code) : 500,
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform: 'twitter',
        details: { action: actionName, tweetId, errors: graphQLErrors },
      });
    }

    console.log(`✅ [WRITE] ${actionName} ok: ${JSON.stringify({ accountId, tweetId })}`);
    return { success: true };
  }

  /**
   * Action Handler: like (FavoriteTweet mutation)
   * @param {Record<string, any>} args
   * @param {Record<string, any>} session
   * @returns {Promise<{ success: boolean }>}
   */
  async like(args, session) {
    return this.#performEngagement(args, session, 'like', {
      queryId: GRAPHQL.FavoriteTweet.queryId,
      operationName: 'FavoriteTweet',
      buildVariables: (tweetId) => ({ tweet_id: tweetId }),
    });
  }

  /**
   * Action Handler: unlike (UnfavoriteTweet mutation)
   * @param {Record<string, any>} args
   * @param {Record<string, any>} session
   * @returns {Promise<{ success: boolean }>}
   */
  async unlike(args, session) {
    return this.#performEngagement(args, session, 'unlike', {
      queryId: GRAPHQL.UnfavoriteTweet.queryId,
      operationName: 'UnfavoriteTweet',
      buildVariables: (tweetId) => ({ tweet_id: tweetId }),
    });
  }

  /**
   * Action Handler: retweet (CreateRetweet mutation)
   * @param {Record<string, any>} args
   * @param {Record<string, any>} session
   * @returns {Promise<{ success: boolean }>}
   */
  async retweet(args, session) {
    return this.#performEngagement(args, session, 'retweet', {
      queryId: GRAPHQL.CreateRetweet.queryId,
      operationName: 'CreateRetweet',
      buildVariables: (tweetId) => ({ tweet_id: tweetId, dark_request: false }),
    });
  }

  /**
   * Action Handler: undo_retweet (DeleteRetweet mutation)
   * @param {Record<string, any>} args
   * @param {Record<string, any>} session
   * @returns {Promise<{ success: boolean }>}
   */
  async undoRetweet(args, session) {
    return this.#performEngagement(args, session, 'undo_retweet', {
      queryId: GRAPHQL.DeleteRetweet.queryId,
      operationName: 'DeleteRetweet',
      buildVariables: (tweetId) => ({ source_tweet_id: tweetId, dark_request: false }),
    });
  }

  /**
   * Helper to resolve userId from arguments (userId, username, or profile URL).
   * @param {Record<string, any>} args
   * @param {Record<string, any>} session
   * @returns {Promise<string>}
   */
  async #resolveTargetUserId(args = {}, session = {}) {
    if (args.userId && typeof args.userId === 'string' && /^\d{1,30}$/.test(args.userId.trim())) {
      return args.userId.trim();
    }

    const usernameOrUrl = args.username || args.url;
    if (!usernameOrUrl || typeof usernameOrUrl !== 'string') {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: userId or username',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
      });
    }

    const cleanUsername = resolveUsername(usernameOrUrl);
    const { accountId } = await this.#resolveSession(session);

    const response = await this.client.requestGraphQl(
      TWITTER_GRAPHQL_QUERY_IDS.UserByScreenName,
      'UserByScreenName',
      {
        screen_name: cleanUsername,
        withSafetyModeUserFields: false,
      },
      DEFAULT_FEATURES,
      undefined,
      {
        accountId,
        requiresAuth: false,
        cookies: session?.cookies,
      }
    );

    const userResult = response?.user?.result;
    if (!userResult || userResult.__typename === 'UserUnavailable' || !userResult.rest_id) {
      throw new PlatformError({
        type: ErrorTypes.NOT_FOUND,
        code: 'XACT_4040',
        message: `Twitter user not found: "${cleanUsername}"`,
        statusCode: 404,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
      });
    }

    return String(userResult.rest_id);
  }

  /**
   * Generic handler for Twitter REST social actions (follow, unfollow, block, unblock, mute, unmute).
   * @param {Record<string, any>} args
   * @param {Record<string, any>} session
   * @param {'follow' | 'unfollow' | 'block' | 'unblock' | 'mute' | 'unmute'} actionName
   * @param {string} endpointPath
   * @param {(userId: string) => Record<string, any>} buildBody
   * @returns {Promise<{ success: boolean }>}
   */
  async #performRestSocialAction(args, session, actionName, endpointPath, buildBody) {
    const dryRun = args?.dryRun !== false;
    const usernameOrUrl = args?.username || args?.url;
    const directUserId = args?.userId;

    if (!directUserId && !usernameOrUrl) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: userId or username',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
      });
    }

    if (dryRun) {
      console.log(`🔄 [DRY RUN] ${actionName}: ${JSON.stringify({ userId: directUserId, username: usernameOrUrl })}`);
      return { success: true };
    }

    const userId = await this.#resolveTargetUserId(args, session);
    const { accountId } = await this.#resolveSession(session);

    await gaussianDelay(2000, 5000);

    console.log(`🔄 [WRITE] ${actionName}: ${JSON.stringify({ accountId, userId })}`);

    const IDEMPOTENT_SOCIAL_MESSAGES = [
      'already following',
      'already requested',
      'you are already following',
      'cannot find specified user',
      'not found in list',
    ];

    const body = buildBody(userId);

    let response;
    try {
      response = await this.client.requestRest(endpointPath, {
        method: 'POST',
        body,
        accountId,
        requiresAuth: true,
        cookies: session?.cookies,
      });
    } catch (err) {
      const msg = String(err?.message || '').toLowerCase();
      if (IDEMPOTENT_SOCIAL_MESSAGES.some((needle) => msg.includes(needle))) {
        console.log(`ℹ️ [WRITE] ${actionName} idempotent hit: "${msg}"`);
        return { success: true };
      }
      throw err;
    }

    const errors = response?.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      for (const err of errors) {
        const msg = String(err?.message || '').toLowerCase();
        if (IDEMPOTENT_SOCIAL_MESSAGES.some((needle) => msg.includes(needle))) {
          console.log(`ℹ️ [WRITE] ${actionName} idempotent hit: "${msg}"`);
          return { success: true };
        }
      }

      const firstError = errors[0];
      throw new PlatformError({
        type: ErrorTypes.INTERNAL,
        code: 'XACT_5000',
        message: firstError?.message || `Twitter REST error while performing ${actionName}`,
        statusCode: firstError?.code ? Number(firstError.code) : 500,
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform: 'twitter',
        details: { action: actionName, userId, errors },
      });
    }

    console.log(`✅ [WRITE] ${actionName} ok: ${JSON.stringify({ accountId, userId })}`);
    return { success: true };
  }

  /**
   * Action Handler: follow
   * @param {Record<string, any>} args
   * @param {Record<string, any>} session
   * @returns {Promise<{ success: boolean }>}
   */
  async follow(args, session) {
    return this.#performRestSocialAction(args, session, 'follow', REST.friendshipsCreate, (userId) => ({
      user_id: userId,
      skip_status: 'true',
    }));
  }

  /**
   * Action Handler: unfollow
   * @param {Record<string, any>} args
   * @param {Record<string, any>} session
   * @returns {Promise<{ success: boolean }>}
   */
  async unfollow(args, session) {
    return this.#performRestSocialAction(args, session, 'unfollow', REST.friendshipsDestroy, (userId) => ({
      user_id: userId,
      skip_status: 'true',
    }));
  }

  /**
   * Action Handler: block
   * @param {Record<string, any>} args
   * @param {Record<string, any>} session
   * @returns {Promise<{ success: boolean }>}
   */
  async block(args, session) {
    return this.#performRestSocialAction(args, session, 'block', REST.blocksCreate, (userId) => ({
      user_id: userId,
    }));
  }

  /**
   * Action Handler: unblock
   * @param {Record<string, any>} args
   * @param {Record<string, any>} session
   * @returns {Promise<{ success: boolean }>}
   */
  async unblock(args, session) {
    return this.#performRestSocialAction(args, session, 'unblock', REST.blocksDestroy, (userId) => ({
      user_id: userId,
    }));
  }

  /**
   * Action Handler: mute
   * @param {Record<string, any>} args
   * @param {Record<string, any>} session
   * @returns {Promise<{ success: boolean }>}
   */
  async mute(args, session) {
    return this.#performRestSocialAction(args, session, 'mute', REST.mutesCreate, (userId) => ({
      user_id: userId,
    }));
  }

  /**
   * Action Handler: unmute
   * @param {Record<string, any>} args
   * @param {Record<string, any>} session
   * @returns {Promise<{ success: boolean }>}
   */
  async unmute(args, session) {
    return this.#performRestSocialAction(args, session, 'unmute', REST.mutesDestroy, (userId) => ({
      user_id: userId,
    }));
  }

  /**
   * Action Handler: bookmark (CreateBookmark mutation)
   * @param {Record<string, any>} args
   * @param {Record<string, any>} session
   * @returns {Promise<{ success: boolean }>}
   */
  async bookmark(args, session) {
    return this.#performEngagement(args, session, 'bookmark', {
      queryId: GRAPHQL.CreateBookmark.queryId,
      operationName: 'CreateBookmark',
      buildVariables: (tweetId) => ({ tweet_id: tweetId }),
    });
  }

  /**
   * Action Handler: unbookmark (DeleteBookmark mutation)
   * @param {Record<string, any>} args
   * @param {Record<string, any>} session
   * @returns {Promise<{ success: boolean }>}
   */
  async unbookmark(args, session) {
    return this.#performEngagement(args, session, 'unbookmark', {
      queryId: GRAPHQL.DeleteBookmark.queryId,
      operationName: 'DeleteBookmark',
      buildVariables: (tweetId) => ({ tweet_id: tweetId }),
    });
  }

  /**
   * Resolve DM recipient userId and check can_dm capability.
   * @param {Record<string, any>} args
   * @param {Record<string, any>} session
   * @returns {Promise<string>}
   */
  async #resolveDmRecipient(args = {}, session = {}) {
    if (args.userId && typeof args.userId === 'string' && /^\d{1,30}$/.test(args.userId.trim())) {
      return args.userId.trim();
    }

    const usernameOrUrl = args.username || args.url;
    if (!usernameOrUrl || typeof usernameOrUrl !== 'string') {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing recipient: provide userId, username, or conversationId',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
      });
    }

    const cleanUsername = resolveUsername(usernameOrUrl);
    const { accountId } = await this.#resolveSession(session);

    const response = await this.client.requestGraphQl(
      TWITTER_GRAPHQL_QUERY_IDS.UserByScreenName,
      'UserByScreenName',
      {
        screen_name: cleanUsername,
        withSafetyModeUserFields: false,
      },
      DEFAULT_FEATURES,
      undefined,
      {
        accountId,
        requiresAuth: false,
        cookies: session?.cookies,
      }
    );

    const userResult = response?.user?.result;
    if (!userResult || userResult.__typename === 'UserUnavailable' || !userResult.rest_id) {
      throw new PlatformError({
        type: ErrorTypes.NOT_FOUND,
        code: 'XACT_4040',
        message: `Twitter user not found: "${cleanUsername}"`,
        statusCode: 404,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
      });
    }

    const canDm = userResult?.legacy?.can_dm ?? userResult?.can_dm ?? true;
    if (canDm === false) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'TWITTER_DM_NOT_ALLOWED',
        message: `User @${cleanUsername} does not accept direct messages from you`,
        statusCode: 403,
        suggestedAction: SuggestedActions.CONTACT_SUPPORT,
        platform: 'twitter',
      });
    }

    return String(userResult.rest_id);
  }

  /**
   * Action Handler: send_dm
   * @param {Record<string, any>} args
   * @param {Record<string, any>} session
   * @returns {Promise<{ success: boolean, messageId?: string, createdAt?: string, dryRun?: boolean }>}
   */
  async sendDm(args = {}, session = {}) {
    const text = typeof args?.text === 'string' ? args.text.trim() : '';
    if (!text) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Direct message text must be a non-empty string',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
      });
    }

    const dryRun = args?.dryRun !== false;
    const conversationId = args?.conversationId;
    const directUserId = args?.userId;
    const usernameOrUrl = args?.username || args?.url;

    if (!conversationId && !directUserId && !usernameOrUrl) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Recipient target is required: provide userId, username, or conversationId',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
      });
    }

    if (dryRun) {
      console.log(`🔄 [DRY RUN] send_dm: ${JSON.stringify({ conversationId, userId: directUserId, username: usernameOrUrl, textLength: text.length })}`);
      return { success: true, dryRun: true };
    }

    const targetUserId = !conversationId ? await this.#resolveDmRecipient(args, session) : null;
    const { accountId } = await this.#resolveSession(session);

    await gaussianDelay(5000, 15000);

    console.log(`🔄 [WRITE] send_dm: ${JSON.stringify({ accountId, targetUserId, conversationId, textLength: text.length })}`);

    const requestId = typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

    let payload;
    if (conversationId) {
      payload = {
        conversation_id: String(conversationId),
        text,
        cards_platform: 'Web-12',
        include_cards: 1,
        include_quote_count: true,
        dm_users: false,
        request_id: requestId,
      };
    } else {
      payload = {
        conversation_id: `${targetUserId}`,
        recipient_ids: [targetUserId],
        text,
        cards_platform: 'Web-12',
        include_cards: 1,
        include_quote_count: true,
        dm_users: false,
        request_id: requestId,
      };
    }

    if (args.mediaId) {
      payload.attachment = {
        type: 'media',
        media: { id: String(args.mediaId) },
      };
    }

    const response = await this.client.requestRest(REST.dmNew, {
      method: 'POST',
      body: payload,
      headers: { 'content-type': 'application/json' },
      accountId,
      requiresAuth: true,
      cookies: session?.cookies,
    });

    const event = response?.event || response?.entries?.[0]?.message || {};
    const messageId = String(event.id || response?.entries?.[0]?.message?.id || requestId);
    const createdAt = event.created_timestamp
      ? new Date(Number(event.created_timestamp)).toISOString()
      : (event.time ? new Date(Number(event.time)).toISOString() : new Date().toISOString());

    console.log(`✅ [WRITE] send_dm ok: ${JSON.stringify({ accountId, messageId })}`);
    return {
      success: true,
      messageId,
      createdAt,
    };
  }

  /**
   * Action Handler: dm_conversations (list inbox conversations)
   * @param {Record<string, any>} args
   * @param {Record<string, any>} session
   * @returns {Promise<{ conversations: object[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }>}
   */
  async dmConversations(args = {}, session = {}) {
    const limit = args?.limit === undefined ? 50 : this.#clamp(args.limit, 1, 100);
    const cursor = args?.cursor || null;
    const { accountId } = await this.#resolveSession(session);

    await gaussianDelay(1000, 3000);

    const query = {
      nsfw_filtering_enabled: 'false',
      filter_low_quality: 'false',
      include_quality: 'all',
      dm_secret_conversations_enabled: 'false',
      krs_registration_enabled: 'true',
      cards_platform: 'Web-12',
      include_cards: '1',
      include_ext_alt_text: 'true',
      include_quote_count: 'true',
      include_reply_count: '1',
      tweet_mode: 'extended',
      ...(cursor ? { cursor } : {}),
    };

    const response = await this.client.requestRest(REST.dmInbox, {
      method: 'GET',
      query,
      accountId,
      requiresAuth: true,
      cookies: session?.cookies,
    });

    const entries = response?.inbox_initial_state ?? response ?? {};
    const rawConversations = /** @type {Record<string, any>} */ (entries.conversations ?? {});
    const rawEntries = /** @type {any[]} */ (entries.entries ?? []);
    const rawUsers = /** @type {Record<string, any>} */ (entries.users ?? {});
    const nextCursor = entries.cursor || null;

    const conversations = [];

    for (const [convId, conv] of Object.entries(rawConversations)) {
      if (conversations.length >= limit) break;

      const rawParticipants = Array.isArray(conv?.participants) ? conv.participants : [];
      const participantIds = rawParticipants.map((p) => (typeof p === 'string' ? p : String(p?.user_id || '')));
      const participants = participantIds.map((uid) => {
        const u = rawUsers[uid] || {};
        return {
          id: String(uid),
          username: u.screen_name || '',
          name: u.name || '',
          avatar: u.profile_image_url_https || '',
        };
      });

      const convEntries = rawEntries.filter((e) => {
        const msg = e?.message || {};
        return msg.conversation_id === convId || e?.conversation_id === convId;
      });

      const lastEntry = convEntries[0] || {};
      const lastMsg = lastEntry.message || {};
      const lastMsgData = lastMsg.message_data || {};

      conversations.push({
        conversationId: convId,
        participants,
        lastMessage: {
          text: lastMsgData.text || '',
          createdAt: lastMsg.time ? new Date(Number(lastMsg.time)).toISOString() : '',
          senderId: lastMsgData.sender_id || lastMsg.sender_id || '',
        },
        unreadCount: Number(conv.unread_count || 0),
        type: conv.type === 'GROUP_DM' ? 'group' : 'one_to_one',
      });
    }

    return {
      conversations,
      pageInfo: {
        has_next_page: Boolean(nextCursor && conversations.length > 0),
        end_cursor: nextCursor,
      },
    };
  }

  /**
   * Action Handler: dm_messages (get messages for a conversation)
   * @param {Record<string, any>} args
   * @param {Record<string, any>} session
   * @returns {Promise<{ messages: object[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }>}
   */
  async dmMessages(args = {}, session = {}) {
    const conversationId = args?.conversationId;
    if (!conversationId || typeof conversationId !== 'string') {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: conversationId',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
      });
    }

    const limit = args?.limit === undefined ? 50 : this.#clamp(args.limit, 1, 100);
    const cursor = args?.cursor || null;
    const { accountId } = await this.#resolveSession(session);

    await gaussianDelay(1000, 3000);

    const query = {
      cards_platform: 'Web-12',
      include_cards: '1',
      include_ext_alt_text: 'true',
      include_quote_count: 'true',
      include_reply_count: '1',
      tweet_mode: 'extended',
      ...(cursor ? { max_id: cursor } : {}),
    };

    const path = `${REST.dmConversation}/${encodeURIComponent(conversationId)}.json`;
    const response = await this.client.requestRest(path, {
      method: 'GET',
      query,
      accountId,
      requiresAuth: true,
      cookies: session?.cookies,
    });

    const timeline = response?.conversation_timeline ?? response ?? {};
    const rawEntries = Array.isArray(timeline.entries) ? timeline.entries : [];
    const minEntryId = timeline.min_entry_id || null;

    const messages = [];
    for (const item of rawEntries) {
      if (messages.length >= limit) break;
      const msg = item?.message || {};
      const msgData = msg.message_data || {};
      if (!msg.id && !item.id) continue;

      messages.push({
        id: String(msg.id || item.id),
        text: msgData.text || '',
        senderId: String(msgData.sender_id || msg.sender_id || ''),
        createdAt: msg.time ? new Date(Number(msg.time)).toISOString() : '',
        media: msgData.attachment?.media ? [msgData.attachment.media] : null,
      });
    }

    return {
      messages,
      pageInfo: {
        has_next_page: Boolean(minEntryId && messages.length > 0),
        end_cursor: minEntryId,
      },
    };
  }

  /**
   * Helper to split an array into chunks.
   * @template T
   * @param {T[]} array
   * @param {number} [size=100]
   * @returns {T[][]}
   */
  #chunkArray(array, size = 100) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Action Handler: create_list
   * @param {Record<string, any>} args
   * @param {Record<string, any>} session
   * @returns {Promise<{ success: boolean, listId?: string, name?: string, isPrivate?: boolean, dryRun?: boolean }>}
   */
  async createList(args = {}, session = {}) {
    const name = typeof args?.name === 'string' ? args.name.trim() : '';
    if (!name || name.length > 25) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'List name is required and must be 1-25 characters',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
      });
    }

    const description = typeof args?.description === 'string' ? args.description.trim().slice(0, 100) : '';
    const isPrivate = Boolean(args?.isPrivate);
    const dryRun = args?.dryRun !== false;

    if (dryRun) {
      console.log(`🔄 [DRY RUN] create_list: ${JSON.stringify({ name, description, isPrivate })}`);
      return { success: true, dryRun: true };
    }

    const { accountId } = await this.#resolveSession(session);

    await gaussianDelay(2000, 5000);

    console.log(`🔄 [WRITE] create_list: ${JSON.stringify({ accountId, name, isPrivate })}`);

    const response = await this.client.requestRest(REST.listsCreate, {
      method: 'POST',
      body: {
        name,
        description,
        mode: isPrivate ? 'private' : 'public',
      },
      accountId,
      requiresAuth: true,
      cookies: session?.cookies,
    });

    const listId = String(response?.id_str || response?.id || '');
    console.log(`✅ [WRITE] create_list ok: ${JSON.stringify({ accountId, listId, name })}`);

    return {
      success: true,
      listId,
      name,
      isPrivate,
    };
  }

  /**
   * Action Handler: add_list_members
   * @param {Record<string, any>} args
   * @param {Record<string, any>} session
   * @returns {Promise<{ success: boolean, listId: string, addedCount: number, batchCount: number, dryRun?: boolean, count?: number }>}
   */
  async addListMembers(args = {}, session = {}) {
    const listId = args?.listId;
    if (!listId || typeof listId !== 'string') {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: listId',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
      });
    }

    const dryRun = args?.dryRun !== false;
    let userIds = Array.isArray(args?.userIds) ? [...args.userIds] : (args?.userId ? [args.userId] : []);
    const usernames = Array.isArray(args?.usernames) ? [...args.usernames] : (args?.username ? [args.username] : []);

    if (userIds.length === 0 && usernames.length === 0) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Must provide userIds or usernames to add to list',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
      });
    }

    if (dryRun) {
      const count = userIds.length + usernames.length;
      console.log(`🔄 [DRY RUN] add_list_members: ${JSON.stringify({ listId, count })}`);
      return { success: true, dryRun: true, listId, count };
    }

    const { accountId } = await this.#resolveSession(session);

    // Resolve any usernames to userIds
    for (const u of usernames) {
      try {
        const uid = await this.#resolveTargetUserId({ username: u }, session);
        if (uid) userIds.push(uid);
      } catch (err) {
        console.warn(`⚠️ [WRITE] Could not resolve username "${u}" for list: ${err.message}`);
      }
    }

    userIds = Array.from(new Set(userIds.map(String)));
    const batches = this.#chunkArray(userIds, 100);

    for (const batch of batches) {
      await gaussianDelay(2000, 5000);
      console.log(`🔄 [WRITE] add_list_members batch: ${JSON.stringify({ accountId, listId, batchSize: batch.length })}`);

      await this.client.requestRest(REST.listsMembersCreateAll, {
        method: 'POST',
        body: {
          list_id: listId,
          user_id: batch.join(','),
        },
        accountId,
        requiresAuth: true,
        cookies: session?.cookies,
      });
    }

    console.log(`✅ [WRITE] add_list_members ok: ${JSON.stringify({ accountId, listId, addedCount: userIds.length, batchCount: batches.length })}`);
    return {
      success: true,
      listId,
      addedCount: userIds.length,
      batchCount: batches.length,
    };
  }

  /**
   * Action Handler: remove_list_members
   * @param {Record<string, any>} args
   * @param {Record<string, any>} session
   * @returns {Promise<{ success: boolean, listId: string, removedCount: number, batchCount: number, dryRun?: boolean, count?: number }>}
   */
  async removeListMembers(args = {}, session = {}) {
    const listId = args?.listId;
    if (!listId || typeof listId !== 'string') {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: listId',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
      });
    }

    const dryRun = args?.dryRun !== false;
    let userIds = Array.isArray(args?.userIds) ? [...args.userIds] : (args?.userId ? [args.userId] : []);
    const usernames = Array.isArray(args?.usernames) ? [...args.usernames] : (args?.username ? [args.username] : []);

    if (userIds.length === 0 && usernames.length === 0) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Must provide userIds or usernames to remove from list',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
      });
    }

    if (dryRun) {
      const count = userIds.length + usernames.length;
      console.log(`🔄 [DRY RUN] remove_list_members: ${JSON.stringify({ listId, count })}`);
      return { success: true, dryRun: true, listId, count };
    }

    const { accountId } = await this.#resolveSession(session);

    // Resolve any usernames to userIds
    for (const u of usernames) {
      try {
        const uid = await this.#resolveTargetUserId({ username: u }, session);
        if (uid) userIds.push(uid);
      } catch (err) {
        console.warn(`⚠️ [WRITE] Could not resolve username "${u}" for list: ${err.message}`);
      }
    }

    userIds = Array.from(new Set(userIds.map(String)));
    const batches = this.#chunkArray(userIds, 100);

    for (const batch of batches) {
      await gaussianDelay(2000, 5000);
      console.log(`🔄 [WRITE] remove_list_members batch: ${JSON.stringify({ accountId, listId, batchSize: batch.length })}`);

      await this.client.requestRest(REST.listsMembersDestroyAll, {
        method: 'POST',
        body: {
          list_id: listId,
          user_id: batch.join(','),
        },
        accountId,
        requiresAuth: true,
        cookies: session?.cookies,
      });
    }

    console.log(`✅ [WRITE] remove_list_members ok: ${JSON.stringify({ accountId, listId, removedCount: userIds.length, batchCount: batches.length })}`);
    return {
      success: true,
      listId,
      removedCount: userIds.length,
      batchCount: batches.length,
    };
  }

  /** @returns {Promise<void>} */
  async init() {}

  /**
   * Cleanup crawler and client resources.
   * @returns {Promise<void>}
   */
  async cleanup() {
    if (this.client && typeof this.client.close === 'function') {
      await this.client.close();
    }
  }
}
