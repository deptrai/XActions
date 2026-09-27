// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * InnerTube Client — Story 33.4 (FR-115)
 *
 * Unofficial YouTube InnerTube API client for read-only data that Data API v3
 * cannot reach: live chat, Shorts analytics, subscriber history, YouTube Music VN.
 *
 * InnerTube is the internal API YouTube's web/mobile apps use — no API key,
 * no OAuth, just a hardcoded client key extracted from YouTube's JS bundle.
 *
 * Rate limits: IP-based (~10k req/hr), mitigated by proxy rotation.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../../core/base-client.js';
import { YouTubePlatformResponseValidator } from './validator.js';
import {
  PlatformError,
  RateLimitError,
  BotChallengeError,
  ErrorTypes,
  SuggestedActions,
} from '../../../core/error-envelope.js';

export const INNERTUBE_BASE = 'https://www.youtube.com/youtubei/v1';

// Extracted from YouTube web client JS bundle (2026-09) — rotated periodically
// by YouTube; update if requests start failing with 400 INVALID_CLIENT.
export const INNERTUBE_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
export const INNERTUBE_CLIENT_VERSION = '2.20250919.01.00';
export const INNERTUBE_CLIENT_NAME = 'WEB';

/**
 * InnerTube HTTP client — unofficial, no API key required.
 * @class
 * @extends {AbstractApiClient}
 */
export class InnerTubeClient extends AbstractApiClient {
  /** @type {string} */
  name = 'youtube_innertube';

  /** @type {string} */
  platform = 'youtube';

  /** @type {string} */
  baseUrl = INNERTUBE_BASE;

  /** @type {string} */
  apiKey = INNERTUBE_API_KEY;

  /** @type {string} */
  clientVersion = INNERTUBE_CLIENT_VERSION;

  /** @type {string} */
  clientName = INNERTUBE_CLIENT_NAME;

  constructor(options = {}) {
    // InnerTube returns raw JSON, not Data API v3 — use a passthrough validator
    const validator = options.responseValidator || {
      validateResponse: () => ({ valid: true }),
      isFalse200: () => false,
      isRateLimit: () => false,
      isLoginWall: () => false,
      isBotChallenge: () => false,
      isValidPayload: () => true,
    };
    super({
      ...options,
      platform: 'youtube',
      responseValidator: validator,
      httpClient: options.httpClient,
      requiresAuth: false,
      requiresProxy: options.requiresProxy ?? true,
    });
    this.baseUrl = (options.baseUrl || INNERTUBE_BASE).replace(/\/+$/, '');
    if (options.apiKey) this.apiKey = options.apiKey;
    if (options.clientVersion) this.clientVersion = options.clientVersion;
    if (options.clientName) this.clientName = options.clientName;
  }

  /**
   * Build InnerTube request context — required by all endpoints.
   * @param {Object} [overrides]
   * @returns {Object}
   */
  buildContext(overrides = {}) {
    return {
      client: {
        clientName: this.clientName,
        clientVersion: this.clientVersion,
        hl: 'vi',
        gl: 'VN',
        ...(overrides.client || {}), // shallow merge — overrides.client wins on conflict
      },
      user: {
        lockedSafetyMode: false,
        ...overrides.user,
      },
      request: {
        useSsl: true,
        internalExperimentFlags: [],
        consistencyTokenJars: [],
        ...overrides.request,
      },
    };
  }

  /**
   * Generic InnerTube POST request.
   * @param {string} endpoint — e.g. 'live_chat/get_live_chat'
   * @param {Object} params — query params (continuation, videoId, etc.)
   * @param {Object} body — request body
   * @param {Object} [options]
   * @returns {Promise<any>}
   */
  async #request(endpoint, params = {}, body = {}, options = {}) {
    const url = `${this.baseUrl}/${endpoint}`;
    const context = this.buildContext();
    const requestBody = { context, ...body };

    // Add api_key to params
    params.key = this.apiKey;
    params.prettyPrint = 'false';

    try {
      const response = await this.request('POST', url, {
        params,
        body: JSON.stringify(requestBody),
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'X-YouTube-Client-Name': '1',
          'X-YouTube-Client-Version': this.clientVersion,
          'Origin': 'https://www.youtube.com',
          'Referer': 'https://www.youtube.com/',
          ...options.headers,
        },
        timeout: options.timeout || 30000,
      });

      return response;
    } catch (err) {
      // Classify InnerTube errors
      const status = err.status || err.statusCode || 0;
      if (status === 429) {
        throw new RateLimitError({
          message: 'InnerTube rate limit exceeded — rotate proxy or back off',
          platform: 'youtube',
          suggestedAction: SuggestedActions.ROTATE_PROXY,
        });
      }
      if (status === 400 && (err.body?.includes('INVALID_CLIENT') || err.message?.includes('INVALID_CLIENT'))) {
        throw new PlatformError({
          code: 'XACT_4001',
          type: ErrorTypes.INVALID_ARGS,
          message: `InnerTube client key rotated — update INNERTUBE_API_KEY constant`,
          suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
          platform: 'youtube',
        });
      }
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Live Chat — InnerTube live_chat/get_live_chat continuation polling
  // -------------------------------------------------------------------------

  /**
   * Fetch live chat messages for a video.
   * @param {string} videoId — YouTube video ID
   * @param {Object} [options]
   * @param {string} [options.continuation] — continuation token for next batch
   * @param {number} [options.timeoutMs] — poll timeout
   * @returns {Promise<{messages: Array, continuation: string|null, timeoutMs: number}>}
   */
  async getLiveChat(videoId, options = {}) {
    // Step 1: get initial continuation from video page
    const continuation = options.continuation || await this.#extractLiveChatContinuation(videoId);
    if (!continuation) {
      throw new PlatformError({
        code: 'XACT_4040',
        type: ErrorTypes.NOT_FOUND,
        message: `No live chat found for video ${videoId}`,
        platform: 'youtube',
      });
    }

    const body = { continuation };
    const res = await this.#request('live_chat/get_live_chat', {}, body, options);
    const data = res?.data || res;

    // Extract messages
    const messages = [];
    const actions = data?.continuationContents?.liveChatContinuation?.actions || [];
    for (const action of actions) {
      const item = action?.addChatItemAction?.item;
      if (!item) continue;
      const msg = item.liveChatTextMessageRenderer || item.liveChatPaidMessageRenderer;
      if (!msg) continue;
      messages.push({
        id: msg.id,
        author: msg.authorName?.simpleText || '',
        text: msg.message?.simpleText || (msg.message?.runs?.map(r => r.text).join('') || ''),
        timestamp: msg.timestampUsec ? Number(msg.timestampUsec) : null,
        authorChannelId: msg.authorExternalChannelId || '',
        isPaid: !!item.liveChatPaidMessageRenderer,
      });
    }

    // Next continuation
    const nextContinuation = data?.continuationContents?.liveChatContinuation?.continuations?.[0]?.continuationData?.continuation || null;
    const timeoutMs = data?.continuationContents?.liveChatContinuation?.continuations?.[0]?.continuationData?.timeoutMs || 5000;

    return { messages, continuation: nextContinuation, timeoutMs };
  }

  /**
   * Extract live chat continuation token from video watch page.
   * @param {string} videoId
   * @returns {Promise<string|null>}
   */
  async #extractLiveChatContinuation(videoId) {
    const body = this.buildContext();
    body.videoId = videoId;
    const res = await this.#request('player', {}, body);
    const data = res?.data || res;
    return data?.liveStreamingDetails?.liveChatRenderer?.continuations?.[0]?.reloadContinuationData?.continuation || null;
  }

  // -------------------------------------------------------------------------
  // Shorts Analytics — Shorts-specific engagement metrics
  // -------------------------------------------------------------------------

  /**
   * Fetch Shorts analytics for a video (view count, like rate, comment rate).
   * @param {string} videoId
   * @returns {Promise<{videoId: string, views: number, likes: number, comments: number, likeRate: number, commentRate: number}>}
   */
  async getShortsAnalytics(videoId) {
    const body = this.buildContext();
    body.videoId = videoId;
    body.params = { videoId };

    const res = await this.#request('next', {}, body);
    const data = res?.data || res;

    // Extract engagement data from Shorts response
    const videoPrimaryInfo = data?.contents?.twoColumnWatchNextResults?.results?.results?.contents?.[0]?.videoPrimaryInfoRenderer;
    const videoSecondaryInfo = data?.contents?.twoColumnWatchNextResults?.results?.results?.contents?.[1]?.videoSecondaryInfoRenderer;

    const views = this.#parseCount(videoPrimaryInfo?.viewCount?.videoViewCountRenderer?.viewCount?.simpleText);
    const likes = this.#parseCount(videoPrimaryInfo?.videoActions?.menuRenderer?.topLevelButtons?.[0]?.segmentedLikeDislikeButtonViewModel?.likeCount);
    const comments = this.#parseCount(videoSecondaryInfo?.commentsCount?.simpleText || data?.commentsCount?.simpleText);

    return {
      videoId,
      views,
      likes,
      comments,
      likeRate: views > 0 ? (likes / views) * 100 : 0,
      commentRate: views > 0 ? (comments / views) * 100 : 0,
    };
  }

  /**
   * Parse count strings like "1.2M", "45K", "1,234" into integers.
   * @param {string|number} s
   * @returns {number}
   */
  #parseCount(s) {
    if (typeof s === 'number') return s;
    if (!s) return 0;
    const str = String(s).toLowerCase().replace(/,/g, '');
    if (str.endsWith('m')) return Math.round(parseFloat(str) * 1_000_000);
    if (str.endsWith('k')) return Math.round(parseFloat(str) * 1_000);
    return parseInt(str) || 0;
  }

  // -------------------------------------------------------------------------
  // Subscriber History — channel subscriber count over time
  // -------------------------------------------------------------------------

  /**
   * Fetch channel subscriber count via InnerTube channel page.
   * @param {string} channelId
   * @returns {Promise<{channelId: string, subscribers: number, capturedAt: number}>}
   */
  async getSubscriberCount(channelId) {
    const body = this.buildContext();
    body.browseId = channelId;
    body.params = { channelId };

    const res = await this.#request('browse', {}, body);
    const data = res?.data || res;

    // Extract subscriber count from channel header
    const header = data?.header?.c4TabbedHeaderRenderer || data?.header?.pageHeaderRenderer;
    const subCountText = header?.subscriberCountText?.simpleText
      || header?.content?.pageHeaderViewModel?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[1]?.text?.content
      || '';

    const subscribers = this.#parseCount(subCountText);

    return {
      channelId,
      subscribers,
      capturedAt: Date.now(),
    };
  }

  // -------------------------------------------------------------------------
  // YouTube Music VN — trending/charts via InnerTube browse
  // -------------------------------------------------------------------------

  /**
   * Fetch YouTube Music VN trending.
   * @param {Object} [options]
   * @param {number} [options.limit]
   * @returns {Promise<{tracks: Array, region: string, capturedAt: number}>}
   */
  async getMusicTrendingVn(options = {}) {
    const body = this.buildContext();
    body.browseId = 'FEmusic_trending'; // YouTube Music trending browse ID
    body.params = { region: 'VN' };

    const res = await this.#request('browse', {}, body);
    const data = res?.data || res;

    const tracks = [];
    const items = data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.musicCarouselShelfRenderer?.contents || [];

    for (const item of items.slice(0, options.limit || 20)) {
      const track = item.musicTwoRowItemRenderer;
      if (!track) continue;
      tracks.push({
        title: track.title?.runs?.[0]?.text || '',
        artist: track.subtitle?.runs?.map(r => r.text).join('') || '',
        views: this.#parseCount(track.subtitleBadge?.musicRendererBadge?.label || ''),
        thumbnail: track.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails?.[0]?.url || '',
      });
    }

    return { tracks, region: 'VN', capturedAt: Date.now() };
  }
}
