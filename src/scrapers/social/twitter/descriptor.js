// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Twitter/X scrape() descriptor (Story 25.1).
 * Verbatim extraction of the twitter/x block from the unified dispatcher.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { TwitterCrawler } from './crawler.js';
import { TwitterClient } from './client.js';
import { actionNotAvailable } from '../../platforms.js';

/** @type {Record<string, string>} */
const TWITTER_ACTION_MAP = {
  profile: 'profile',
  tweets: 'search', timeline: 'search', feed: 'search', user_feed: 'search', posts: 'search',
  search: 'search',
  hashtag: 'hashtag',
  trending: 'trending',
  thread: 'thread',
  likes: 'likes', likers: 'likes',
  bookmarks: 'bookmarks',
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
   * @param {Record<string, any>} options
   * @param {Record<string, any>} ctx
   * @returns {string}
   */
  mapAction(options, ctx) {
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
    return new TwitterClient(/** @type {any} */ ({
      baseUrl: options.baseUrl,
      proxy: options.proxy,
      proxyPool: options.proxyPool,
      proxyProvider: options.proxyProvider,
      governor: options.governor,
      accountPool: options.accountPool,
      sessionManager: options.sessionManager,
      responseValidator: options.responseValidator,
      tokenRing: options.tokenRing,
      signerPool: options.signerPool,
      requiresAuth: options.requiresAuth,
      requiresProxy: options.requiresProxy,
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
      accountPool: options.accountPool,
      sessionManager: options.sessionManager,
      requiresAuth: options.requiresAuth,
    });
  },

  /**
   * @param {Record<string, any>} options
   * @returns {Record<string, any>}
   */
  createSession(options) {
    return {
      accountId: options.accountId || 'twitter-guest',
      cookies: options.authCookie || options.cookies || options.authToken || '',
    };
  },
};
