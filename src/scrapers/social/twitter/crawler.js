// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TwitterCrawler — Hybrid crawler for Twitter/X search, hashtag, and trending.
 * Extends AbstractCrawler and registers search, hashtag, trending actions.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractCrawler } from '../../../core/base-crawler.js';
import { TwitterClient } from './client.js';
import { parseSearchTimeline, parseSearchUsers } from './normalize-search.js';
import { parseTrends } from './normalize-trending.js';
import { buildAdvancedQuery } from '../../twitter/http/search.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';
import { defaultRedisStreamPublisher, isEnvTruthy, toIsoDate } from '../../../utils/redis-stream-publisher.js';

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
   * @param {Object} [deps]
   * @param {TwitterClient} [deps.client]
   * @param {import('../../../core/base-store.js').AbstractStore} [deps.store]
   * @param {import('../../../core/session-manager.js').SessionManager} [deps.sessionManager]
   * @param {import('../../../core/adaptive-governor.js').AdaptiveRateGovernor} [deps.governor]
   * @param {import('../../../core/account-pool.js').AccountPool} [deps.accountPool]
   * @param {import('../../../proxy/proxy-pool.js').ProxyIpPool} [deps.proxyPool]
   * @param {import('../../../utils/redis-stream-publisher.js').RedisStreamPublisher} [deps.redisPublisher]
   */
  constructor(deps = {}) {
    const { client: explicitClient, ...clientDeps } = deps;
    const client = explicitClient || new TwitterClient(/** @type {any} */ (clientDeps));
    super({
      ...deps,
      client,
      requiresAuth: true,
    });

    this.client = client;
    this.redisPublisher = deps.redisPublisher;

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
      requiredArgs: ['hashtag', 'tag'],
      optionalArgs: ['tag', 'type', 'filter', 'since', 'until', 'minLikes', 'minRetweets', 'lang', 'limit', 'cursor'],
      outputType: '{ posts: PostItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }',
      example: { hashtag: 'AI', tag: 'AI', type: 'Latest', limit: 50 },
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
      // Unknown filter value — keep as product default but don't treat as search filter
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
   * @param {string} [args.since]
   * @param {string} [args.until]
   * @param {number} [args.minLikes]
   * @param {number} [args.minRetweets]
   * @param {number} [args.minReplies]
   * @param {string} [args.lang]
   * @param {string} [args.filter]
   * @param {boolean} [args.isHashtag]
   * @returns {{ rawQuery: string, product: string, searchType: string }}
   */
  #buildRawQuery(args) {
    const { product, searchFilter, searchType } = this.#resolveProduct(args.type, args.filter);
    const queryOptions = /** @type {Record<string, any>} */ ({
      keywords: args.query || '',
      from: args.from,
      to: args.to,
      since: args.since,
      until: args.until,
      minLikes: args.minLikes,
      minRetweets: args.minRetweets,
      minReplies: args.minReplies,
      lang: args.lang,
    });
    if (searchFilter) queryOptions.filter = searchFilter;

    const rawQuery = buildAdvancedQuery(queryOptions);
    return { rawQuery, product, searchType };
  }

  /**
   * Save checkpoint and optionally emit stream.
   * @param {Object} params
   * @param {string} params.targetType
   * @param {string} params.targetKey
   * @param {string | null} [params.cursor]
   * @param {Array<import('../../../core/types.js').PostItem | import('../../../core/types.js').ProfileItem>} [params.items]
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
        const publisher = this.redisPublisher || (this.store && /** @type {any} */ (this.store).publisher) || defaultRedisStreamPublisher;
        if (publisher && typeof publisher.publish === 'function') {
          for (const item of items) {
            const anyItem = /** @type {any} */ (item);
            const category = 'category' in anyItem && typeof anyItem.category === 'string' ? anyItem.category : 'social';
            await publisher.publish({
              id: anyItem.id,
              platform: 'twitter',
              externalId: anyItem.externalId,
              category,
              authorId: anyItem.authorId || '',
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
   * Store a batch of items and validate.
   * @param {import('../../../core/types.js').PostItem[]} items
   */
  async #storeItems(items) {
    if (!this.store || typeof this.store.storeBatch !== 'function' || items.length === 0) return;
    for (const item of items) {
      this.validateItem(item);
    }
    await this.store.storeBatch(items, { upsert: true, validateSchema: true });
  }

  /**
   * Search tweets or users.
   * @param {Object} args
   * @param {string} args.query
   * @param {string} [args.type]
   * @param {string} [args.filter]
   * @param {number} [args.limit]
   * @param {string} [args.cursor]
   * @param {Record<string, any>} [session={}]
   * @returns {Promise<import('../../../core/types.js').PostItem[] | { posts: import('../../../core/types.js').PostItem[], users?: import('../../../core/types.js').ProfileItem[], pageInfo: Record<string, any> }>}
   */
  async search(args, session = {}) {
    if (!args?.query || typeof args.query !== 'string' || args.query.trim() === '') {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Missing or empty required argument: query',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'twitter',
      });
    }

    const { accountId } = await this.#resolveSession(session);
    const limit = this.#clamp(args.limit, 1, 50);
    const { rawQuery, product, searchType } = this.#buildRawQuery(args);

    /** @type {Record<string, unknown>} */
    const variables = {
      rawQuery,
      count: limit,
      querySource: 'typed_query',
      product,
    };
    if (args.cursor) variables.cursor = String(args.cursor);

    const resp = await this.client.requestSearchTimeline('SearchTimeline', variables, {
      accountId,
      requiresAuth: false,
    });

    /** @type {import('../../../core/types.js').PostItem[] | import('../../../core/types.js').ProfileItem[]} */
    let items = [];
    /** @type {string | null} */
    let cursor = null;

    if (product === 'People') {
      const { users, cursor: userCursor } = parseSearchUsers(resp, { extraMetadata: { isSearchResult: true, searchQuery: args.query, searchFilter: product, searchType, sourceMethod: 'search' } });
      items = users;
      cursor = userCursor;
    } else {
      const { posts, cursor: postCursor } = parseSearchTimeline(resp, {
        sourceMethod: 'search',
        extraMetadata: { isSearchResult: true, searchQuery: args.query, searchFilter: product, searchType, sourceMethod: 'search' },
      });
      items = posts;
      cursor = postCursor;
    }

    await this.#emitCheckpointAndStream({
      targetType: 'search',
      targetKey: rawQuery,
      cursor,
      items,
      hasMore: Boolean(cursor),
    });

    const pageInfo = {
      hasNextPage: Boolean(cursor),
      has_next_page: Boolean(cursor),
      endCursor: cursor,
      end_cursor: cursor,
    };

    if (product === 'People') {
      return { posts: [], users: /** @type {import('../../../core/types.js').ProfileItem[]} */ (items), pageInfo };
    }
    await this.#storeItems(/** @type {import('../../../core/types.js').PostItem[]} */ (items));
    return { posts: /** @type {import('../../../core/types.js').PostItem[]} */ (items), pageInfo };
  }

  /**
   * Search tweets by hashtag.
   * @param {Object} args
   * @param {string} [args.hashtag]
   * @param {string} [args.tag]
   * @param {string} [args.type]
   * @param {string} [args.filter]
   * @param {number} [args.limit]
   * @param {string} [args.cursor]
   * @param {Record<string, any>} [session={}]
   * @returns {Promise<{ posts: import('../../../core/types.js').PostItem[], pageInfo: { hasNextPage: boolean, has_next_page: boolean, endCursor: string | null, end_cursor: string | null } }>}
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
      });
    }

    const cleanTag = tag.replace(/^#+/, '');
    const searchArgs = { ...args, query: `#${cleanTag}` };

    const { accountId } = await this.#resolveSession(session);
    const limit = this.#clamp(args.limit, 1, 50);
    const { rawQuery, product, searchType } = this.#buildRawQuery(searchArgs);

    /** @type {Record<string, unknown>} */
    const variables = {
      rawQuery,
      count: limit,
      querySource: 'typed_query',
      product,
    };
    if (args.cursor) variables.cursor = String(args.cursor);

    const resp = await this.client.requestSearchTimeline('SearchTimeline', variables, {
      accountId,
      requiresAuth: false,
    });

    const { posts, cursor } = parseSearchTimeline(resp, {
      sourceMethod: 'hashtag',
      extraMetadata: { isSearchResult: true, isHashtag: true, hashtag: cleanTag, searchQuery: rawQuery, searchFilter: product, searchType, sourceMethod: 'hashtag' },
    });

    await this.#storeItems(posts);
    await this.#emitCheckpointAndStream({
      targetType: 'hashtag',
      targetKey: cleanTag,
      cursor,
      items: posts,
      hasMore: Boolean(cursor),
    });

    return {
      posts,
      pageInfo: {
        hasNextPage: Boolean(cursor),
        has_next_page: Boolean(cursor),
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
   * @returns {Promise<{ trends: import('../../../core/types.js').PostItem[], pageInfo: { hasNextPage: boolean, has_next_page: boolean, endCursor: null, end_cursor: null } }>}
   */
  async trending(args, session = {}) {
    const woeid = Number(args?.woeid) || 1;
    const limit = args?.limit === undefined ? 100 : this.#clamp(args.limit, 1, 100);
    const includePromoted = args?.includePromoted !== false;

    const { accountId } = await this.#resolveSession(session);
    const resp = await this.client.requestTrendsPlace(woeid, { accountId, requiresAuth: false });

    let trends = parseTrends(resp, woeid);
    if (!includePromoted) {
      trends = trends.filter((t) => !(/** @type {any} */ (t.metadata)?.isPromoted));
    }

    if (limit < trends.length) {
      trends = trends.slice(0, limit);
    }

    // Trend results expose `category` as promoted/null for consumers,
    // but Prisma storage requires a valid PostItem category.
    if (this.store && typeof this.store.storeBatch === 'function') {
      const storeableTrends = trends.map((t) => ({ ...t, category: 'social' }));
      for (const item of storeableTrends) {
        this.validateItem(item);
      }
      await this.store.storeBatch(storeableTrends, { upsert: true, validateSchema: true });
    }

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
