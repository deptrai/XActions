// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * YouTube VN scrape() descriptor (Story 25.1).
 * Verbatim extraction of the youtube block from the unified dispatcher (Story 33.2).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { YouTubeVNCrawler } from './crawler.js';
import { YouTubeClient } from './client.js';

/** @type {Record<string, string>} */
const YOUTUBE_ACTION_MAP = {
  search: 'search',
  videos: 'search',
  trending_vn: 'trending_vn',
  trending: 'trending_vn',
  popular: 'trending_vn',
  channel_videos: 'channel_videos',
  channel_detail: 'channel_detail',
  channel: 'channel_detail',
  profile: 'channel_detail',
  video_detail: 'video_detail',
  video: 'video_detail',
  detail: 'video_detail',
  video_comments: 'video_comments',
  comments: 'video_comments',
};

export default {
  aliases: ['youtube', 'yt', 'youtube_vn'],

  actionMap: YOUTUBE_ACTION_MAP,

  /**
   * @param {Record<string, any>} options
   * @param {Record<string, any>} ctx
   * @returns {Record<string, any>}
   */
  mapArgs(options, ctx) {
    const mappedAction = ctx.mappedAction;
    /** @type {Record<string, any>} */
    const mappedArgs = { ...options };
    if (options.limit != null) mappedArgs.maxResults = Number(options.limit);
    if (options.maxResults != null) mappedArgs.maxResults = Number(options.maxResults);
    if (options.regionCode) mappedArgs.regionCode = options.regionCode;
    if (options.query || options.q) mappedArgs.query = options.query || options.q;
    if (mappedAction === 'channel_videos' || mappedAction === 'channel_detail') {
      if (options.channelId || options.channel || options.id) {
        mappedArgs.channelId = options.channelId || options.channel || options.id;
      }
    } else {
      if (options.channelId || options.channel) mappedArgs.channelId = options.channelId || options.channel;
      if (options.videoId || options.id) mappedArgs.videoId = options.videoId || options.id;
    }
    if (options.apiKey || options.key) mappedArgs.apiKey = options.apiKey || options.key;
    return mappedArgs;
  },

  /**
   * @param {Record<string, any>} options
   * @returns {YouTubeClient}
   */
  createClient(options) {
    return new YouTubeClient(/** @type {any} */ ({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey || options.key,
      proxy: options.proxy,
      proxyPool: options.proxyPool,
      governor: options.governor,
      responseValidator: options.responseValidator,
      requiresAuth: false,
      requiresProxy: options.requiresProxy,
      timeout: options.timeout,
    }));
  },

  /**
   * @param {{ client: YouTubeClient, store: any, options: Record<string, any>, ctx: Record<string, any> }} deps
   * @returns {YouTubeVNCrawler}
   */
  createCrawler({ client, store, options }) {
    return new YouTubeVNCrawler(/** @type {any} */ ({
      client,
      store,
      publisher: options.publisher || options.eventPublisher,
      accountPool: options.accountPool,
      governor: options.governor,
      requiresAuth: false,
      requiresProxy: options.requiresProxy,
    }));
  },
};
