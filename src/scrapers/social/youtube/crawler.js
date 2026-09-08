// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * YouTubeVNCrawler — YouTube Vietnam video, channel, and comments crawler.
 * Extends AbstractCrawler with actions for search, trending, channels, and comment threads.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractCrawler } from '../../../core/base-crawler.js';
import { YouTubeClient } from './client.js';
import { normalizeYouTubeResults } from './normalizer.js';
import {
  PlatformError,
  ErrorTypes,
  SuggestedActions,
} from '../../../core/error-envelope.js';

export class YouTubeVNCrawler extends AbstractCrawler {
  /** @type {string} */
  name = 'youtube';

  /** @type {string} */
  platform = 'youtube';

  /** @type {string} */
  category = 'video';

  /** @type {boolean} */
  requiresAuth = false;

  /** @type {boolean} */
  requiresProxy = false;

  /**
   * @param {Object} [deps={}]
   * @param {YouTubeClient} [deps.client]
   * @param {import('../../../core/base-store.js').AbstractStore} [deps.store]
   * @param {any} [deps.publisher]
   * @param {import('../../../core/account-pool.js').AccountPool} [deps.accountPool]
   * @param {import('../../../core/adaptive-governor.js').AdaptiveRateGovernor} [deps.governor]
   * @param {import('../../../proxy/proxy-pool.js').ProxyIpPool} [deps.proxyPool]
   * @param {string} [deps.apiKey]
   * @param {string} [deps.baseUrl]
   */
  constructor(deps = {}) {
    const client = deps.client || new YouTubeClient({
      apiKey: deps.apiKey || deps.key,
      baseUrl: deps.baseUrl,
      accountPool: deps.accountPool,
      governor: deps.governor,
      proxyPool: deps.proxyPool,
      requiresAuth: false,
      requiresProxy: deps.requiresProxy ?? false,
    });

    super({
      ...deps,
      client,
      requiresAuth: false,
    });

    this.publisher = deps.publisher || deps.eventPublisher || null;
    this.#registerActions();
  }

  async start(command) {
    if (command?.session && (command.session.apiKey || command.session.key)) {
      command.args = command.args || {};
      command.args.apiKey = command.args.apiKey || command.session.apiKey || command.session.key;
    }
    return super.start(command);
  }

  async init() {
    return Promise.resolve();
  }

  async cleanup() {
    if (this.client && typeof this.client.cleanup === 'function') {
      await this.client.cleanup().catch(() => {});
    }
  }

  #registerActions() {
    // 1. Video Search
    this.registerAction({
      action: 'search',
      description: 'Search videos on YouTube with Vietnam region filtering',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          q: { type: 'string' },
          regionCode: { type: 'string', default: 'VN' },
          maxResults: { type: 'number', default: 10 },
          order: { type: 'string', default: 'relevance' },
        },
      },
      handler: (args) => this.search(args),
    });

    // 2. Trending Videos VN
    this.registerAction({
      action: 'trending_vn',
      description: 'Get trending and most popular videos in Vietnam',
      inputSchema: {
        type: 'object',
        properties: {
          regionCode: { type: 'string', default: 'VN' },
          maxResults: { type: 'number', default: 20 },
        },
      },
      handler: (args) => this.trendingVn(args),
    });

    this.registerAction({
      action: 'trending',
      description: 'Alias for trending_vn',
      handler: (args) => this.trendingVn(args),
    });

    // 3. Channel Videos
    this.registerAction({
      action: 'channel_videos',
      description: 'Fetch videos published by a specific YouTube channel',
      inputSchema: {
        type: 'object',
        properties: {
          channelId: { type: 'string' },
          maxResults: { type: 'number', default: 15 },
        },
        required: ['channelId'],
      },
      handler: (args) => this.channelVideos(args),
    });

    // 4. Channel Detail / Profile
    this.registerAction({
      action: 'channel_detail',
      description: 'Fetch channel statistics, subscriber count, and metadata',
      inputSchema: {
        type: 'object',
        properties: {
          channelId: { type: 'string' },
          id: { type: 'string' },
          forHandle: { type: 'string' },
          forUsername: { type: 'string' },
        },
      },
      handler: (args) => this.channelDetail(args),
    });

    this.registerAction({
      action: 'channel',
      description: 'Alias for channel_detail',
      handler: (args) => this.channelDetail(args),
    });

    this.registerAction({
      action: 'profile',
      description: 'Alias for channel_detail',
      handler: (args) => this.channelDetail(args),
    });

    // 5. Video Detail
    this.registerAction({
      action: 'video_detail',
      description: 'Fetch statistics, duration, and tags for a single video',
      inputSchema: {
        type: 'object',
        properties: {
          videoId: { type: 'string' },
          id: { type: 'string' },
        },
        required: ['videoId'],
      },
      handler: (args) => this.videoDetail(args),
    });

    this.registerAction({
      action: 'video',
      description: 'Alias for video_detail',
      handler: (args) => this.videoDetail(args),
    });

    this.registerAction({
      action: 'detail',
      description: 'Alias for video_detail',
      handler: (args) => this.videoDetail(args),
    });

    // 6. Video Comments
    this.registerAction({
      action: 'video_comments',
      description: 'Fetch comments and nested replies for a video',
      inputSchema: {
        type: 'object',
        properties: {
          videoId: { type: 'string' },
          id: { type: 'string' },
          maxResults: { type: 'number', default: 20 },
        },
        required: ['videoId'],
      },
      handler: (args) => this.videoComments(args),
    });

    this.registerAction({
      action: 'comments',
      description: 'Alias for video_comments',
      handler: (args) => this.videoComments(args),
    });
  }

  /**
   * Resolve API key from arguments or account pool.
   * @param {Record<string, unknown>} [args={}]
   * @param {Record<string, unknown>} [session={}]
   */
  #resolveApiKey(args = {}, session = {}) {
    const directKey = args.apiKey || args.key || session.apiKey || session.key;
    if (directKey && typeof directKey === 'string') {
      this.client.setApiKey(directKey);
      return;
    }

    if (this.accountPool) {
      const accountId = args.accountId || session.accountId;
      if (accountId) {
        const record = this.accountPool.getAccount(String(accountId), 'youtube');
        if (record?.credentials?.apiKey) {
          this.client.setApiKey(String(record.credentials.apiKey));
          return;
        }
      }
      const available = this.accountPool.listAccounts ? this.accountPool.listAccounts('youtube') : [];
      if (available.length > 0) {
        const first = available[0];
        if (first?.credentials?.apiKey) {
          this.client.setApiKey(String(first.credentials.apiKey));
        }
      }
    }
  }

  /**
   * Persist post items and emit thin events.
   * @param {import('../../../core/types.js').PostItem[]} posts
   */
  async #persistPosts(posts) {
    if (!posts || !posts.length) return;

    if (this.store) {
      if (typeof this.store.storeBatch === 'function') {
        await this.store.storeBatch(posts).catch(() => {});
      } else if (typeof this.store.savePost === 'function') {
        for (const item of posts) {
          await this.store.savePost(item).catch(() => {});
        }
      }
    }

    if (this.publisher && typeof this.publisher.publish === 'function') {
      for (const item of posts) {
        await this.publisher.publish(item).catch(() => {});
      }
    }
  }

  /**
   * Persist profile items.
   * @param {import('../../../core/types.js').ProfileItem[]} profiles
   */
  async #persistProfiles(profiles) {
    if (!profiles || !profiles.length) return;

    if (this.store && typeof this.store.saveProfile === 'function') {
      for (const p of profiles) {
        await this.store.saveProfile(p).catch(() => {});
      }
    }
  }

  /**
   * Persist comment items.
   * @param {import('../../../core/types.js').CommentItem[]} comments
   */
  async #persistComments(comments) {
    if (!comments || !comments.length) return;

    if (this.store && typeof this.store.saveComment === 'function') {
      for (const c of comments) {
        await this.store.saveComment(c).catch(() => {});
      }
    }
  }

  /**
   * Search videos.
   * @param {Record<string, unknown>} [args={}]
   * @returns {Promise<{ posts: import('../../../core/types.js').PostItem[], pageInfo: Object }>}
   */
  async search(args = {}) {
    this.#resolveApiKey(args);
    const regionCode = String(args.regionCode || 'VN');
    const response = await this.client.searchVideos({
      ...args,
      regionCode,
    });

    const result = normalizeYouTubeResults(response, 'search', { regionCode });
    const posts = Array.isArray(result.posts) ? result.posts : [];

    for (const post of posts) {
      this.validateItem(post);
    }
    await this.#persistPosts(posts);

    return {
      posts,
      pageInfo: result.pageInfo || {
        total: posts.length,
        has_next_page: false,
      },
    };
  }

  /**
   * Get trending videos in Vietnam.
   * @param {Record<string, unknown>} [args={}]
   * @returns {Promise<{ posts: import('../../../core/types.js').PostItem[], pageInfo: Object }>}
   */
  async trendingVn(args = {}) {
    this.#resolveApiKey(args);
    const regionCode = String(args.regionCode || 'VN');
    const response = await this.client.getTrending({
      ...args,
      regionCode,
    });

    const result = normalizeYouTubeResults(response, 'trending_vn', { regionCode });
    const posts = Array.isArray(result.posts) ? result.posts : [];

    for (const post of posts) {
      this.validateItem(post);
    }
    await this.#persistPosts(posts);

    return {
      posts,
      pageInfo: result.pageInfo || {
        total: posts.length,
        has_next_page: false,
      },
    };
  }

  /**
   * Get channel videos.
   * @param {Record<string, unknown>} [args={}]
   * @returns {Promise<{ posts: import('../../../core/types.js').PostItem[], pageInfo: Object }>}
   */
  async channelVideos(args = {}) {
    this.#resolveApiKey(args);
    const channelId = args.channelId || args.channel || args.id;
    const response = await this.client.getChannelVideos({
      ...args,
      channelId,
    });

    const result = normalizeYouTubeResults(response, 'channel_videos', {
      channelId,
    });
    const posts = Array.isArray(result.posts) ? result.posts : [];

    for (const post of posts) {
      this.validateItem(post);
    }
    await this.#persistPosts(posts);

    return {
      posts,
      pageInfo: result.pageInfo || {
        total: posts.length,
        has_next_page: false,
      },
    };
  }

  /**
   * Get channel profile details.
   * @param {Record<string, unknown>} [args={}]
   * @returns {Promise<{ profile: import('../../../core/types.js').ProfileItem }>}
   */
  async channelDetail(args = {}) {
    this.#resolveApiKey(args);
    const response = await this.client.getChannelDetail(args);
    const result = normalizeYouTubeResults(response, 'channel_detail', args);

    if (!result.profile) {
      throw new PlatformError({
        type: ErrorTypes.TARGET_NOT_FOUND,
        code: 'XACT_4004',
        message: `YouTube channel "${args.channelId || args.forHandle || args.forUsername}" not found`,
        statusCode: 404,
        suggestedAction: SuggestedActions.VERIFY_URL,
        platform: 'youtube',
      });
    }

    await this.#persistProfiles([result.profile]);
    return { profile: result.profile };
  }

  /**
   * Get single video details.
   * @param {Record<string, unknown>} [args={}]
   * @returns {Promise<{ post: import('../../../core/types.js').PostItem }>}
   */
  async videoDetail(args = {}) {
    this.#resolveApiKey(args);
    const videoId = String(args.videoId || args.id || '');
    const response = await this.client.getVideoDetail({ videoId });
    const result = normalizeYouTubeResults(response, 'video_detail', { videoId });

    if (!result.post) {
      throw new PlatformError({
        type: ErrorTypes.TARGET_NOT_FOUND,
        code: 'XACT_4004',
        message: `YouTube video "${videoId}" not found or private`,
        statusCode: 404,
        suggestedAction: SuggestedActions.VERIFY_URL,
        platform: 'youtube',
      });
    }

    this.validateItem(result.post);
    await this.#persistPosts([result.post]);
    return { post: result.post };
  }

  /**
   * Get video comments.
   * @param {Record<string, unknown>} [args={}]
   * @returns {Promise<{ comments: import('../../../core/types.js').CommentItem[], pageInfo: Object }>}
   */
  async videoComments(args = {}) {
    this.#resolveApiKey(args);
    const videoId = String(args.videoId || args.id || '');
    const response = await this.client.getVideoComments(args);

    const result = normalizeYouTubeResults(response, 'video_comments', { videoId });
    const comments = Array.isArray(result.comments) ? result.comments : [];

    await this.#persistComments(comments);

    return {
      comments,
      pageInfo: result.pageInfo || {
        total: comments.length,
        has_next_page: false,
      },
    };
  }
}
