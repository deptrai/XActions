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
import { parseTrends } from './normalize-trending.js';
import { normalizeThreadResponse } from './normalize-thread.js';
import { normalizeBookmarksResponse } from './normalize-bookmarks.js';
import {
  normalizeLikersResponse,
  profileItemToPostItem,
  normalizeUserProfile,
} from './normalize-relationships.js';
import { buildAdvancedQuery } from '../../twitter/http/search.js';
import { DEFAULT_FEATURES } from '../../twitter/http/endpoints.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';
import { isValidCategory } from '../../../core/types.js';
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
      description: 'Search global tweets or users by query',
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
      description: 'Search tweets for a hashtag',
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
        requiresAuth: false,
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
