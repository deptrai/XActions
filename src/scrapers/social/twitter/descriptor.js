// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Twitter/X scrape() descriptor (Story 25.1).
 * Verbatim extraction of the twitter/x block from the unified dispatcher.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TwitterCrawler } from './crawler.js';
import { TwitterClient } from './client.js';
import { actionNotAvailable } from '../../platforms.js';
import { globalAccountPool } from '../../../core/account-pool.js';
import { globalSessionManager } from '../../../core/session-manager.js';

/** @type {Record<string, string>} */
const TWITTER_ACTION_MAP = {
  profile: 'profile',
  tweets: 'search', timeline: 'search', feed: 'search', user_feed: 'search', posts: 'search',
  search: 'search',
  hashtag: 'hashtag',
  trending: 'trending',
  thread: 'thread',
  // Story 31.1 fix: x_download_media postUrl-only path calls 'post_detail' — map to
  // 'thread' which resolves the root tweet (+ replies) from a tweetId/URL.
  post_detail: 'thread',
  postDetail: 'thread',
  tweet_detail: 'thread',
  likes: 'likes', likers: 'likes',
  bookmarks: 'bookmarks',
  export_bookmarks: 'export_bookmarks', exportBookmarks: 'export_bookmarks',
  unroll_thread: 'unroll_thread', unrollThread: 'unroll_thread',
  media: 'media',
  download_video: 'download_video', video: 'download_video',
  followers: 'followers',
  following: 'following',
  non_followers: 'non_followers',
  retweeters: 'retweeters',
  listMembers: 'list_members', list_members: 'list_members',
  communityMembers: 'community_members', community_members: 'community_members',
  spaces: 'spaces',
  post: 'post',
  reply: 'reply',
  quote: 'quote',
  schedule: 'schedule',
  like: 'like',
  unlike: 'unlike',
  retweet: 'retweet',
  unretweet: 'undo_retweet', undo_retweet: 'undo_retweet',
  follow: 'follow',
  unfollow: 'unfollow',
  block: 'block',
  unblock: 'unblock',
  mute: 'mute',
  unmute: 'unmute',
  bookmark: 'bookmark',
  unbookmark: 'unbookmark',
  send_dm: 'send_dm', sendDm: 'send_dm',
  dm_conversations: 'dm_conversations', getInbox: 'dm_conversations',
  dm_messages: 'dm_messages', getConversation: 'dm_messages',
  create_list: 'create_list', createList: 'create_list',
  add_list_members: 'add_list_members', addListMembers: 'add_list_members',
  remove_list_members: 'remove_list_members', removeListMembers: 'remove_list_members',
};

export default {
  aliases: ['twitter', 'x'],

  /**
   * @param {Record<string, any>} _options
   * @param {Record<string, any>} ctx
   * @returns {string}
   */
  mapAction(_options, ctx) {
    const mappedAction = TWITTER_ACTION_MAP[ctx.action];
    if (!mappedAction) {
      const available = [...new Set(Object.values(TWITTER_ACTION_MAP))];
      throw actionNotAvailable(ctx.platform, ctx.action, available);
    }
    return mappedAction;
  },

  /**
   * @param {Record<string, any>} options
   * @returns {Record<string, any>}
   */
  mapArgs(options) {
    /** @type {Record<string, any>} */
    const mappedArgs = {};
    if (options.username) mappedArgs.username = options.username;
    if (options.target && !options.username) mappedArgs.username = options.target;
    if (options.query) mappedArgs.query = options.query;
    if (options.hashtag || options.tag) mappedArgs.tag = options.hashtag || options.tag;
    if (options.tweetId) mappedArgs.tweetId = options.tweetId;
    if (options.url) mappedArgs.url = options.url;
    if (options.userId) mappedArgs.userId = options.userId;
    if (options.listId || options.listUrl) mappedArgs.listUrl = options.listId || options.listUrl;
    if (options.communityUrl || options.communityId) mappedArgs.communityUrl = options.communityUrl || (options.communityId ? `https://x.com/i/communities/${options.communityId}` : undefined);
    if (options.conversationId) mappedArgs.conversationId = options.conversationId;
    if (options.text) mappedArgs.text = options.text;
    if (options.mediaIds) mappedArgs.mediaIds = options.mediaIds;
    if (options.mediaId) mappedArgs.mediaId = options.mediaId;
    if (options.publishAt) mappedArgs.publishAt = options.publishAt;
    if (options.name) mappedArgs.name = options.name;
    if (options.description) mappedArgs.description = options.description;
    if (options.isPrivate != null) mappedArgs.isPrivate = options.isPrivate;
    if (options.userIds) mappedArgs.userIds = options.userIds;
    if (options.usernames) mappedArgs.usernames = options.usernames;
    if (options.dryRun != null) mappedArgs.dryRun = options.dryRun;
    if (options.limit != null) mappedArgs.limit = Number(options.limit);
    if (options.count != null && options.limit == null) mappedArgs.limit = Number(options.count);
    if (options.cursor) mappedArgs.cursor = options.cursor;
    if (options.type) mappedArgs.type = options.type;
    if (options.filter) mappedArgs.filter = options.filter;
    if (options.woeid != null) mappedArgs.woeid = options.woeid;
    if (options.quality) mappedArgs.quality = options.quality;
    if (options.destPath) mappedArgs.destPath = options.destPath;
    if (options.format) mappedArgs.format = options.format;
    if (options.premium != null) mappedArgs.premium = options.premium;
    if (options.sensitive != null) mappedArgs.sensitive = options.sensitive;
    if (options.walkToRoot != null) mappedArgs.walkToRoot = options.walkToRoot;
    if (options.resume !== undefined) mappedArgs.resume = options.resume;
    return mappedArgs;
  },

  /**
   * @param {Record<string, any>} options
   * @returns {TwitterClient}
   */
  createClient(options) {
    const hasProxyConfigured = Boolean(
      options.proxy ||
      options.proxyPool ||
      options.proxyProvider ||
      process.env.PROXY_URL ||
      process.env.MEDIRUS_PROXIES ||
      process.env.HTTP_PROXY ||
      process.env.HTTPS_PROXY
    );
    const requiresProxy = options.requiresProxy !== undefined
      ? options.requiresProxy
      : hasProxyConfigured;

    return new TwitterClient(/** @type {any} */ ({
      baseUrl: options.baseUrl,
      proxy: options.proxy,
      proxyPool: options.proxyPool,
      proxyProvider: options.proxyProvider,
      governor: options.governor,
      accountPool: options.accountPool || globalAccountPool,
      sessionManager: options.sessionManager || globalSessionManager,
      responseValidator: options.responseValidator,
      tokenRing: options.tokenRing,
      signerPool: options.signerPool,
      requiresAuth: options.requiresAuth,
      requiresProxy,
      timeout: options.timeout,
    }));
  },

  /**
   * @param {{ client: TwitterClient, store: any, options: Record<string, any> }} deps
   * @returns {TwitterCrawler}
   */
  createCrawler({ client, store, options }) {
    return new TwitterCrawler({
      client,
      store,
      redisPublisher: options.redisPublisher,
      proxyPool: options.proxyPool,
      governor: options.governor,
      accountPool: options.accountPool || globalAccountPool,
      sessionManager: options.sessionManager || globalSessionManager,
      requiresAuth: options.requiresAuth,
    });
  },

  /**
   * @param {Record<string, any>} options
   * @returns {Record<string, any>}
   */
  createSession(options) {
    let cookies = options.authCookie || options.cookies || options.authToken || '';
    let accountId = options.accountId;

    if (!cookies) {
      if (process.env.MEDIRUS_SESSION_COOKIE) {
        if (process.env.MEDIRUS_SESSION_COOKIE.includes('auth_token=')) {
          cookies = process.env.MEDIRUS_SESSION_COOKIE;
        } else {
          cookies = `auth_token=${process.env.MEDIRUS_SESSION_COOKIE}`;
          if (process.env.MEDIRUS_CSRF_TOKEN) {
            cookies += `; ct0=${process.env.MEDIRUS_CSRF_TOKEN}`;
          }
        }
      } else if (process.env.TWITTER_COOKIES) {
        cookies = process.env.TWITTER_COOKIES;
      }

      if (!cookies) {
        try {
          const cookiePath = path.join(os.homedir(), '.medirus', 'cookies.json');
          if (fs.existsSync(cookiePath)) {
            const raw = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
            if (Array.isArray(raw)) {
              cookies = raw.map((c) => `${c.name}=${c.value}`).join('; ');
            } else if (typeof raw === 'object' && raw !== null) {
              cookies = Object.entries(raw).map(([k, v]) => `${k}=${v}`).join('; ');
            }
          }
        } catch {}
      }
    }

    if (!accountId) {
      if (process.env.TWITTER_USERNAME) {
        accountId = process.env.TWITTER_USERNAME;
      } else if (!options.accountId && globalAccountPool.hasAvailable('twitter')) {
        accountId = null;
      } else {
        try {
          const configPath = path.join(os.homedir(), '.medirus', 'config.json');
          if (fs.existsSync(configPath)) {
            const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (cfg.activeSession) accountId = cfg.activeSession;
          }
        } catch {}
      }
      if (!accountId && !globalAccountPool.hasAvailable('twitter')) accountId = 'twitter-guest';
    }

    return {
      accountId,
      cookies,
    };
  },
};
