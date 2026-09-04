// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * BlueskyCrawler — High-throughput hybrid crawler for Bluesky (AT Protocol).
 * Extends AbstractCrawler, registers profile, followers, following, posts,
 * search, trending, and feed actions. Conforms to universal scraping core schema.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractCrawler } from '../../../core/base-crawler.js';
import { BlueskyClient, resolveActor } from './client.js';
import {
  normalizeBlueskyProfile,
  normalizeBlueskyConnection,
  normalizeBlueskyPost,
  normalizeBlueskyTrendingTopic,
  profileItemToPostItem,
} from './normalizer.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';
import { gaussianDelay } from '../../../utils/gaussian-delay.js';

export class BlueskyCrawler extends AbstractCrawler {
  /** @type {string} */
  name = 'bluesky';

  /** @type {string} */
  platform = 'bluesky';

  /** @type {boolean} */
  requiresAuth = false;

  /** @type {BlueskyClient} */
  client;

  /**
   * @param {Object} [deps]
   * @param {BlueskyClient} [deps.client]
   * @param {import('../../../core/base-store.js').AbstractStore} [deps.store]
   * @param {import('../../../core/session-manager.js').SessionManager} [deps.sessionManager]
   * @param {import('../../../core/adaptive-governor.js').AdaptiveRateGovernor} [deps.governor]
   * @param {import('../../../core/account-pool.js').AccountPool} [deps.accountPool]
   * @param {import('../../../proxy/proxy-pool.js').ProxyIpPool} [deps.proxyPool]
   * @param {any} [deps.redisPublisher]
   * @param {boolean} [deps.requiresAuth]
   * @param {boolean} [deps.requiresProxy]
   */
  constructor(deps = {}) {
    const { client: explicitClient, ...clientDeps } = deps;
    const client = explicitClient || new BlueskyClient(/** @type {any} */ (clientDeps));

    super({
      ...deps,
      client,
      requiresAuth: deps.requiresAuth !== undefined ? deps.requiresAuth : false,
    });

    this.client = client;
    this.redisPublisher = deps.redisPublisher || null;

    // ── 1. Action: profile ──
    this.registerAction({
      action: 'profile',
      description: 'Scrape actor profile on Bluesky by handle or DID',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['handle'],
      optionalArgs: ['username', 'actor', 'identifier', 'password'],
      outputType: 'ProfileItem',
      example: { handle: 'nichxbt.bsky.social' },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getProfile(args, session),
    });

    // ── 2. Action: followers ──
    this.registerAction({
      action: 'followers',
      description: 'Scrape followers for an actor on Bluesky',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['handle'],
      optionalArgs: ['username', 'actor', 'limit', 'cursor', 'identifier', 'password'],
      outputType: '{ profiles: ProfileItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }',
      example: { handle: 'nichxbt.bsky.social', limit: 50 },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getFollowers(args, session),
    });

    // ── 3. Action: following ──
    this.registerAction({
      action: 'following',
      description: 'Scrape follows/following for an actor on Bluesky',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['handle'],
      optionalArgs: ['username', 'actor', 'limit', 'cursor', 'identifier', 'password'],
      outputType: '{ profiles: ProfileItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }',
      example: { handle: 'nichxbt.bsky.social', limit: 50 },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getFollowing(args, session),
    });

    // ── 4. Action: posts (timeline/author feed, equivalent of tweets) ──
    this.registerAction({
      action: 'posts',
      description: 'Scrape authored posts and reposts from a user timeline',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['handle'],
      optionalArgs: ['username', 'actor', 'limit', 'cursor', 'filter', 'identifier', 'password'],
      outputType: '{ posts: PostItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }',
      example: { handle: 'nichxbt.bsky.social', limit: 30 },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getAuthorFeed(args, session),
    });

    // Alias: tweets -> posts
    this.registerAction({
      action: 'tweets',
      description: 'Alias for posts — scrape authored posts from a user timeline',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['handle'],
      optionalArgs: ['username', 'actor', 'limit', 'cursor', 'identifier', 'password'],
      outputType: '{ posts: PostItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }',
      example: { handle: 'nichxbt.bsky.social', limit: 30 },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getAuthorFeed(args, session),
    });

    // ── 5. Action: search (search posts) ──
    this.registerAction({
      action: 'search',
      description: 'Search posts across Bluesky by query (auth optional but recommended for protected endpoints)',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['query'],
      optionalArgs: ['limit', 'cursor', 'sort', 'since', 'until', 'author', 'identifier', 'password'],
      outputType: '{ posts: PostItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }',
      example: { query: 'bluesky', limit: 25 },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.search(args, session),
    });

    // ── 6. Action: trending (trending topics) ──
    this.registerAction({
      action: 'trending',
      description: 'Scrape currently trending topics on Bluesky via getTrendingTopics',
      category: 'social',
      requiresAuth: false,
      requiredArgs: [],
      optionalArgs: ['limit', 'identifier', 'password'],
      outputType: '{ trends: PostItem[], pageInfo: { end_cursor: null, has_next_page: false } }',
      example: { limit: 20 },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.trending(args, session),
    });

    // ── 7. Action: feed (custom algorithm feed) ──
    this.registerAction({
      action: 'feed',
      description: 'Scrape posts from a custom algorithmic feed generator URI',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['feedUri'],
      optionalArgs: ['feed', 'uri', 'limit', 'cursor', 'identifier', 'password'],
      outputType: '{ posts: PostItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }',
      example: { feedUri: 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot' },
      handler: (/** @type {any} */ args, /** @type {any} */ session) => this.getFeed(args, session),
    });
  }

  /**
   * Helper to ensure client authentication if credentials are supplied in args or session.
   * @param {Record<string, any>} [args]
   * @param {Record<string, any>} [session]
   */
  async #maybeAuthenticate(args = {}, session = {}) {
    const identifier = args.identifier || session.identifier || session.username;
    const password = args.password || session.password;
    if (identifier && password && (!this.client.accessJwt || this.client.identifier !== identifier)) {
      await this.client.login({ identifier, password });
    }
  }

  /**
   * Helper to resolve handle from various arg conventions.
   * @param {Record<string, any>} args
   * @returns {string}
   */
  #extractHandle(args = {}) {
    const raw = args.handle || args.username || args.actor || args.user;
    if (!raw) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: "handle" or "username"',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'bluesky',
      });
    }
    return resolveActor(String(raw));
  }

  /**
   * Scrape actor profile.
   * @param {Record<string, any>} args
   * @param {Record<string, any>} [session]
   * @returns {Promise<import('../../../core/types.js').ProfileItem>}
   */
  async getProfile(args = {}, session = {}) {
    await this.#maybeAuthenticate(args, session);
    const actor = this.#extractHandle(args);

    const raw = await this.client.xrpc('app.bsky.actor.getProfile', { actor });
    const profile = normalizeBlueskyProfile(raw);

    if (this.store) {
      const postItem = profileItemToPostItem(profile);
      await this.store.storeContent(postItem).catch(() => {});
    }

    return profile;
  }

  /**
   * Scrape actor followers.
   * @param {Record<string, any>} args
   * @param {Record<string, any>} [session]
   * @returns {Promise<{ profiles: import('../../../core/types.js').ProfileItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }>}
   */
  async getFollowers(args = {}, session = {}) {
    await this.#maybeAuthenticate(args, session);
    const actor = this.#extractHandle(args);
    const limit = Math.min(100, Math.max(1, Number(args.limit || 50)));
    const cursor = args.cursor || undefined;

    const raw = await this.client.xrpc('app.bsky.graph.getFollowers', {
      actor,
      limit,
      cursor,
    });

    const rawFollowers = Array.isArray(raw?.followers) ? raw.followers : [];
    const profiles = rawFollowers.map((f) => normalizeBlueskyConnection(f, 'follower'));
    const nextCursor = raw?.cursor || null;

    if (this.store && profiles.length > 0) {
      const postItems = profiles.map(profileItemToPostItem);
      await this.store.storeBatch(postItems).catch(() => {});
    }

    return {
      profiles,
      pageInfo: {
        end_cursor: nextCursor,
        has_next_page: Boolean(nextCursor),
      },
    };
  }

  /**
   * Scrape actor following (follows).
   * @param {Record<string, any>} args
   * @param {Record<string, any>} [session]
   * @returns {Promise<{ profiles: import('../../../core/types.js').ProfileItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }>}
   */
  async getFollowing(args = {}, session = {}) {
    await this.#maybeAuthenticate(args, session);
    const actor = this.#extractHandle(args);
    const limit = Math.min(100, Math.max(1, Number(args.limit || 50)));
    const cursor = args.cursor || undefined;

    const raw = await this.client.xrpc('app.bsky.graph.getFollows', {
      actor,
      limit,
      cursor,
    });

    const rawFollows = Array.isArray(raw?.follows) ? raw.follows : [];
    const profiles = rawFollows.map((f) => normalizeBlueskyConnection(f, 'following'));
    const nextCursor = raw?.cursor || null;

    if (this.store && profiles.length > 0) {
      const postItems = profiles.map(profileItemToPostItem);
      await this.store.storeBatch(postItems).catch(() => {});
    }

    return {
      profiles,
      pageInfo: {
        end_cursor: nextCursor,
        has_next_page: Boolean(nextCursor),
      },
    };
  }

  /**
   * Scrape author feed (posts & reposts).
   * @param {Record<string, any>} args
   * @param {Record<string, any>} [session]
   * @returns {Promise<{ posts: import('../../../core/types.js').PostItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }>}
   */
  async getAuthorFeed(args = {}, session = {}) {
    await this.#maybeAuthenticate(args, session);
    const actor = this.#extractHandle(args);
    const limit = Math.min(100, Math.max(1, Number(args.limit || 50)));
    const cursor = args.cursor || undefined;
    const filter = args.filter || undefined;

    // Resolve handle to DID if actor is not already DID
    const did = await this.client.resolveHandle(actor);

    const raw = await this.client.xrpc('app.bsky.feed.getAuthorFeed', {
      actor: did,
      limit,
      cursor,
      filter,
    });

    const rawFeed = Array.isArray(raw?.feed) ? raw.feed : [];
    const posts = rawFeed.map(normalizeBlueskyPost);
    const nextCursor = raw?.cursor || null;

    if (this.store && posts.length > 0) {
      await this.store.storeBatch(posts).catch(() => {});
    }

    return {
      posts,
      pageInfo: {
        end_cursor: nextCursor,
        has_next_page: Boolean(nextCursor),
      },
    };
  }

  /**
   * Search posts across Bluesky.
   * @param {Record<string, any>} args
   * @param {Record<string, any>} [session]
   * @returns {Promise<{ posts: import('../../../core/types.js').PostItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }>}
   */
  async search(args = {}, session = {}) {
    await this.#maybeAuthenticate(args, session);
    const query = args.query || args.q || args.keyword;
    if (!query || typeof query !== 'string' || !query.trim()) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: "query"',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'bluesky',
      });
    }

    const limit = Math.min(100, Math.max(1, Number(args.limit || 25)));
    const cursor = args.cursor || undefined;
    const sort = args.sort || undefined;
    const since = args.since || undefined;
    const until = args.until || undefined;
    const author = args.author || undefined;

    const params = {
      q: query.trim(),
      limit,
      cursor,
      sort,
      since,
      until,
      author,
    };

    const raw = await this.client.xrpc('app.bsky.feed.searchPosts', params);

    const rawPosts = Array.isArray(raw?.posts) ? raw.posts : [];
    const posts = rawPosts.map(normalizeBlueskyPost);
    const nextCursor = raw?.cursor || null;

    if (this.store && posts.length > 0) {
      await this.store.storeBatch(posts).catch(() => {});
    }

    return {
      posts,
      pageInfo: {
        end_cursor: nextCursor,
        has_next_page: Boolean(nextCursor),
      },
    };
  }

  /**
   * Scrape trending topics.
   * Uses app.bsky.unspecced.getTrendingTopics
   * @param {Record<string, any>} [args]
   * @param {Record<string, any>} [session]
   * @returns {Promise<{ trends: import('../../../core/types.js').PostItem[], pageInfo: { end_cursor: null, has_next_page: false } }>}
   */
  async trending(args = {}, session = {}) {
    await this.#maybeAuthenticate(args, session);
    const limit = Number(args.limit || 30);

    const raw = await this.client.xrpc('app.bsky.unspecced.getTrendingTopics', {});

    const rawTopics = Array.isArray(raw?.topics) ? raw.topics : [];
    const trends = rawTopics
      .slice(0, limit)
      .map((topic, idx) => normalizeBlueskyTrendingTopic(topic, idx + 1));

    if (this.store && trends.length > 0) {
      await this.store.storeBatch(trends).catch(() => {});
    }

    return {
      trends,
      pageInfo: {
        end_cursor: null,
        has_next_page: false,
      },
    };
  }

  /**
   * Scrape custom algorithmic feed.
   * @param {Record<string, any>} args
   * @param {Record<string, any>} [session]
   * @returns {Promise<{ posts: import('../../../core/types.js').PostItem[], pageInfo: { end_cursor: string | null, has_next_page: boolean } }>}
   */
  async getFeed(args = {}, session = {}) {
    await this.#maybeAuthenticate(args, session);
    const feedUri = args.feedUri || args.feed || args.uri;
    if (!feedUri || typeof feedUri !== 'string') {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'Missing required argument: "feedUri"',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'bluesky',
      });
    }

    const limit = Math.min(100, Math.max(1, Number(args.limit || 50)));
    const cursor = args.cursor || undefined;

    const raw = await this.client.xrpc('app.bsky.feed.getFeed', {
      feed: feedUri,
      limit,
      cursor,
    });

    const rawFeed = Array.isArray(raw?.feed) ? raw.feed : [];
    const posts = rawFeed.map(normalizeBlueskyPost);
    const nextCursor = raw?.cursor || null;

    if (this.store && posts.length > 0) {
      await this.store.storeBatch(posts).catch(() => {});
    }

    return {
      posts,
      pageInfo: {
        end_cursor: nextCursor,
        has_next_page: Boolean(nextCursor),
      },
    };
  }

  /**
   * Clean up resources.
   * @returns {Promise<void>}
   */
  async cleanup() {
    // Bluesky is HTTP-only, no browser to close.
  }
}
