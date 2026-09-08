// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * YouTubeClient — YouTube Data API v3 HTTP client.
 * Extends AbstractApiClient with API key parameter injection, endpoint helpers,
 * and integration with YouTubePlatformResponseValidator.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../../core/base-client.js';
import { YouTubePlatformResponseValidator } from './validator.js';
import {
  PlatformError,
  AuthSessionExpiredError,
  RateLimitError,
  BotChallengeError,
  ErrorTypes,
  SuggestedActions,
} from '../../../core/error-envelope.js';

export const DEFAULT_YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

export function createYouTubeClient(options = {}) {
  return new YouTubeClient(options);
}

export class YouTubeClient extends AbstractApiClient {
  /** @type {string} */
  name = 'youtube';

  /** @type {string} */
  platform = 'youtube';

  /** @type {string} */
  baseUrl = DEFAULT_YOUTUBE_API_BASE;

  /** @type {string | null} */
  apiKey = null;

  /**
   * @param {Object} [options={}]
   * @param {string} [options.baseUrl] - Base YouTube API endpoint (default: https://www.googleapis.com/youtube/v3)
   * @param {string} [options.apiKey] - Google/YouTube Data API v3 key
   * @param {string} [options.key] - Alias for apiKey
   * @param {YouTubePlatformResponseValidator} [options.responseValidator]
   * @param {import('../../../proxy/proxy-pool.js').ProxyIpPool} [options.proxyPool]
   * @param {import('../../../core/account-pool.js').AccountPool} [options.accountPool]
   * @param {import('../../../core/adaptive-governor.js').AdaptiveRateGovernor} [options.governor]
   * @param {boolean} [options.requiresAuth=false]
   * @param {boolean} [options.requiresProxy=false]
   * @param {number} [options.timeout=30000]
   */
  constructor(options = {}) {
    const validator = options.responseValidator || new YouTubePlatformResponseValidator();
    super({
      ...options,
      platform: 'youtube',
      responseValidator: validator,
      requiresAuth: options.requiresAuth ?? false,
      requiresProxy: options.requiresProxy ?? false,
    });

    this.baseUrl = (options.baseUrl || DEFAULT_YOUTUBE_API_BASE).replace(/\/+$/, '');
    this.apiKey = options.apiKey || options.key || process.env.YOUTUBE_API_KEY || null;
    this.responseValidator = validator;
  }

  /**
   * Set or rotate API key dynamically.
   * @param {string | null} key
   */
  setApiKey(key) {
    this.apiKey = key;
  }

  /**
   * Build complete API endpoint URL with query parameters including key.
   * @param {string} path
   * @param {Record<string, unknown>} [params={}]
   * @returns {string}
   */
  buildUrl(path, params = {}) {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${cleanPath}`);

    const key = params.key || params.apiKey || this.apiKey;
    if (key) {
      url.searchParams.set('key', String(key));
    }

    for (const [k, value] of Object.entries(params)) {
      if (k !== 'key' && k !== 'apiKey' && value !== undefined && value !== null && value !== '') {
        url.searchParams.set(k, String(value));
      }
    }

    return url.toString();
  }

  /**
   * Send GET request through AbstractApiClient resilient pipeline.
   * @param {string} path
   * @param {Record<string, unknown>} [params={}]
   * @param {Object} [options={}]
   * @returns {Promise<Record<string, unknown>>}
   */
  async get(path, params = {}, options = {}) {
    const key = params.key || params.apiKey || options.apiKey || options.key || this.apiKey;
    const effectiveParams = { ...params };
    if (key) {
      effectiveParams.key = key;
    }

    const url = this.buildUrl(path, effectiveParams);
    const headers = { ...(options.headers || {}) };
    headers['accept'] = 'application/json';

    const reqOpts = {
      ...options,
      headers,
      raw: false,
    };

    const res = /** @type {Record<string, unknown>} */ (await this.request('GET', url, reqOpts));

    if (this.responseValidator) {
      if (this.responseValidator.isRateLimit(res)) {
        throw new RateLimitError({
          platform: 'youtube',
          code: 'XACT_4029',
          message: 'YouTube API quota exceeded (10,000 units/day limit reached)',
          suggestedAction: SuggestedActions.RATE_LIMIT_BACKOFF,
          retryAfterMs: 60000,
          details: { rawResponse: res },
        });
      }

      if (this.responseValidator.isAuthExpired(res)) {
        throw new AuthSessionExpiredError({
          platform: 'youtube',
          code: 'XACT_4003',
          message: 'YouTube API key is invalid or revoked',
          suggestedAction: SuggestedActions.ROTATE_ACCOUNT,
          details: { rawResponse: res },
        });
      }

      if (this.responseValidator.isBotChallenge(res)) {
        throw new BotChallengeError({
          platform: 'youtube',
          code: 'XACT_4030',
          message: 'Google WAF or captcha challenge encountered',
          suggestedAction: SuggestedActions.ROTATE_PROXY,
          details: { rawResponse: res },
        });
      }
    }

    return res;
  }

  /**
   * Search videos on YouTube.
   * Endpoint: GET /search
   * @param {Object} [options={}]
   * @param {string} [options.query]
   * @param {string} [options.q] - Alias for query
   * @param {string} [options.regionCode='VN']
   * @param {string} [options.relevanceLanguage='vi']
   * @param {number} [options.maxResults=10]
   * @param {string} [options.pageToken]
   * @param {string} [options.order='relevance']
   * @param {string} [options.type='video']
   * @returns {Promise<Record<string, unknown>>}
   */
  async searchVideos(options = {}) {
    const query = options.query || options.q || '';
    const params = {
      part: 'snippet',
      type: options.type || 'video',
      q: query,
      regionCode: options.regionCode || 'VN',
      relevanceLanguage: options.relevanceLanguage || 'vi',
      maxResults: Math.min(50, Math.max(1, Number(options.maxResults) || 10)),
      order: options.order || 'relevance',
      pageToken: options.pageToken || undefined,
    };
    return this.get('/search', params, options);
  }

  /**
   * Get trending / most popular videos for Vietnam.
   * Endpoint: GET /videos?chart=mostPopular
   * @param {Object} [options={}]
   * @param {string} [options.regionCode='VN']
   * @param {number} [options.maxResults=20]
   * @param {string} [options.pageToken]
   * @param {string} [options.videoCategoryId]
   * @returns {Promise<Record<string, unknown>>}
   */
  async getTrending(options = {}) {
    const params = {
      part: 'snippet,contentDetails,statistics',
      chart: 'mostPopular',
      regionCode: options.regionCode || 'VN',
      maxResults: Math.min(50, Math.max(1, Number(options.maxResults) || 20)),
      pageToken: options.pageToken || undefined,
      videoCategoryId: options.videoCategoryId || undefined,
    };
    return this.get('/videos', params, options);
  }

  /**
   * Get channel videos list.
   * Endpoint: GET /search?channelId=...
   * @param {Object} options
   * @param {string} options.channelId
   * @param {number} [options.maxResults=15]
   * @param {string} [options.pageToken]
   * @param {string} [options.order='date']
   * @returns {Promise<Record<string, unknown>>}
   */
  async getChannelVideos(options = {}) {
    const channelId = options.channelId || options.channel || options.id;
    if (!channelId) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'channelId is required for channel_videos',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'youtube',
      });
    }

    const params = {
      part: 'snippet',
      type: 'video',
      channelId,
      order: options.order || 'date',
      maxResults: Math.min(50, Math.max(1, Number(options.maxResults) || 15)),
      pageToken: options.pageToken || undefined,
    };
    return this.get('/search', params, options);
  }

  /**
   * Get channel profile details.
   * Endpoint: GET /channels?part=snippet,statistics,brandingSettings
   * @param {Object} options
   * @param {string} [options.channelId]
   * @param {string} [options.id] - Alias for channelId
   * @param {string} [options.forHandle]
   * @param {string} [options.forUsername]
   * @returns {Promise<Record<string, unknown>>}
   */
  async getChannelDetail(options = {}) {
    const id = options.channelId || options.id;
    const params = {
      part: 'snippet,statistics,brandingSettings',
    };

    if (id) {
      params.id = id;
    } else if (options.forHandle) {
      params.forHandle = options.forHandle.replace(/^@/, '');
    } else if (options.forUsername) {
      params.forUsername = options.forUsername;
    } else {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'channelId, forHandle, or forUsername is required for channel_detail',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'youtube',
      });
    }

    return this.get('/channels', params, options);
  }

  /**
   * Get detailed info for a single video.
   * Endpoint: GET /videos?part=snippet,contentDetails,statistics&id=...
   * @param {Object} options
   * @param {string} [options.videoId]
   * @param {string} [options.id] - Alias for videoId
   * @returns {Promise<Record<string, unknown>>}
   */
  async getVideoDetail(options = {}) {
    const id = options.videoId || options.id;
    if (!id) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'videoId is required for video_detail',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'youtube',
      });
    }

    const params = {
      part: 'snippet,contentDetails,statistics',
      id,
    };
    return this.get('/videos', params, options);
  }

  /**
   * Get video comments and replies.
   * Endpoint: GET /commentThreads?part=snippet,replies&videoId=...
   * @param {Object} options
   * @param {string} [options.videoId]
   * @param {string} [options.id] - Alias for videoId
   * @param {number} [options.maxResults=20]
   * @param {string} [options.pageToken]
   * @param {string} [options.order='topComments']
   * @returns {Promise<Record<string, unknown>>}
   */
  async getVideoComments(options = {}) {
    const id = options.videoId || options.id;
    if (!id) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'videoId is required for video_comments',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: 'youtube',
      });
    }

    const params = {
      part: 'snippet,replies',
      videoId: id,
      maxResults: Math.min(100, Math.max(1, Number(options.maxResults) || 20)),
      pageToken: options.pageToken || undefined,
      order: options.order || 'topComments',
    };

    try {
      return await this.get('/commentThreads', params, options);
    } catch (err) {
      // If video has comments disabled, return graceful payload
      const text = (
        String(err?.message || '') + ' ' +
        String(err?.details?.rawResponse || '') + ' ' +
        (typeof err?.details === 'object' ? JSON.stringify(err.details) : String(err?.details || ''))
      ).toLowerCase();
      if (text.includes('commentsdisabled') || text.includes('disabled comments')) {
        return {
          kind: 'youtube#commentThreadListResponse',
          items: [],
          commentsDisabled: true,
        };
      }
      throw err;
    }
  }

  async cleanup() {
    return Promise.resolve();
  }
}
