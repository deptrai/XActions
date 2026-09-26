// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Telegram scrape() descriptor (Story 50.8 skeleton — transport deferred).
 * Exposes 4 action stubs for self-discovery; all throw XACT_4001 until the
 * D4 spec picks MTProto-vs-Bot and lands the real impl.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { TelegramCrawler } from './crawler.js';
import { TelegramClient } from './client.js';

/** @type {Record<string, string>} */
const TELEGRAM_ACTION_MAP = {
  channel_messages: 'channel_messages',
  messages: 'channel_messages',
  posts: 'channel_messages',
  channel_posts: 'channel_messages',
  channel_info: 'channel_info',
  info: 'channel_info',
  metadata: 'channel_info',
  channel_metadata: 'channel_info',
  search_channels: 'search_channels',
  search: 'search_channels',
  find_channels: 'search_channels',
  user_resolve: 'user_resolve',
  resolve: 'user_resolve',
  user: 'user_resolve',
  username: 'user_resolve',
};

export default {
  aliases: ['telegram', 'tg'],

  actionMap: TELEGRAM_ACTION_MAP,

  /**
   * Story 50.8 — no sync-capable actions until a transport lands in D4.
   * `syncCapableActions=[]` forces every action through the async lane.
   */
  syncCapableActions: [],

  /**
   * Story 50.5 self-discovery marker — surface `status:'coming_soon'` per
   * action in /api/actions even though the crawler class loads.
   */
  coming_soon: true,

  /**
   * @param {Record<string, any>} options
   * @returns {Record<string, any>}
   */
  mapArgs(options) {
    /** @type {Record<string, any>} */
    const mappedArgs = { ...options };
    const channel = options.channel || options.channelName || options.handle;
    if (channel != null) mappedArgs.channel = String(channel).replace(/^@/, '');
    const username = options.username || options.user;
    if (username != null) mappedArgs.username = String(username).replace(/^@/, '');
    if (options.query != null || options.q != null || options.keyword != null) {
      mappedArgs.query = String(options.query || options.q || options.keyword);
    }
    if (options.limit != null) mappedArgs.limit = Number(options.limit);
    return mappedArgs;
  },

  /**
   * @param {Record<string, any>} options
   * @returns {TelegramClient}
   */
  createClient(options) {
    return options.client instanceof TelegramClient
      ? options.client
      : new TelegramClient(/** @type {any} */ ({
          transport: options.transport || options.telegramTransport,
          proxy: options.proxy,
          proxyPool: options.proxyPool,
          timeout: options.timeout,
        }));
  },

  /**
   * @param {{ client: TelegramClient, store: any, options: Record<string, any>, ctx: Record<string, any> }} deps
   * @returns {TelegramCrawler}
   */
  createCrawler({ client, store, options }) {
    return new TelegramCrawler(/** @type {any} */ ({
      client,
      store,
      proxyPool: options.proxyPool,
      governor: options.governor,
      fetchFn: options.fetchFn,
    }));
  },
};
