// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TelegramCrawler — skeleton (Story 50.8). Registers 4 action stubs so the
 * platform is discoverable via /api/actions as `status:'coming_soon'` until
 * a transport is picked in the D4 spec. All handlers route to client stubs
 * that throw XACT_4001 (transport not implemented).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractCrawler } from '../../../core/base-crawler.js';
import { TelegramClient } from './client.js';
import {
  PlatformError,
  ErrorTypes,
  SuggestedActions,
} from '../../../core/error-envelope.js';

/** Telegram username/channel shape (t.me/<name>): 5–32 chars alnum+underscore. */
export const TELEGRAM_HANDLE_RE = /^[a-zA-Z0-9_]{5,32}$/;

/**
 * @param {TelegramClient | Record<string, unknown>} [client]
 * @param {Record<string, unknown>} [options]
 * @returns {TelegramCrawler}
 */
export function createTelegramCrawler(client = {}, options = {}) {
  const resolvedClient = client instanceof TelegramClient ? client : new TelegramClient(client || options || {});
  const resolvedOptions = client instanceof TelegramClient ? options : (options || {});
  return new TelegramCrawler({ client: resolvedClient, ...resolvedOptions });
}

export class TelegramCrawler extends AbstractCrawler {
  /** @type {string} */
  name = 'telegram';

  /** @type {string} */
  platform = 'telegram';

  /** @type {boolean} */
  requiresAuth = false;

  /** @type {TelegramClient} */
  client;

  constructor(deps = {}) {
    const { client: explicitClient, ...rest } = deps;
    const client = explicitClient instanceof TelegramClient
      ? explicitClient
      : new TelegramClient({ ...rest });
    super({ ...deps, client });

    this.category = 'social';
    this.client = client;

    // ── Action: channel_messages ─────────────────────────────────────────
    this.registerAction({
      action: 'channel_messages',
      description: '[coming soon] Fetch recent posts from a public telegram channel',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['channel'],
      optionalArgs: ['limit', 'before', 'after'],
      outputType: 'ChannelMessage[]',
      example: { channel: 'durov', limit: 25 },
      handler: (args, session) => this.fetchChannelMessages(args, session),
    });

    // ── Action: channel_info ─────────────────────────────────────────────
    this.registerAction({
      action: 'channel_info',
      description: '[coming soon] Fetch channel metadata (member count, description, linked chat)',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['channel'],
      optionalArgs: [],
      outputType: '{ channel, title, member_count, description, linked_chat_id }',
      example: { channel: 'durov' },
      handler: (args, session) => this.fetchChannelInfo(args, session),
    });

    // ── Action: search_channels ──────────────────────────────────────────
    this.registerAction({
      action: 'search_channels',
      description: '[coming soon] Search public telegram channels by keyword',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['query'],
      optionalArgs: ['limit'],
      outputType: 'ChannelSearchResult[]',
      example: { query: 'crypto news', limit: 10 },
      handler: (args, session) => this.fetchSearchChannels(args, session),
    });

    // ── Action: user_resolve ─────────────────────────────────────────────
    this.registerAction({
      action: 'user_resolve',
      description: '[coming soon] Resolve a telegram @username to a profile record',
      category: 'social',
      requiresAuth: false,
      requiredArgs: ['username'],
      optionalArgs: [],
      outputType: '{ username, user_id, display_name, bio, is_bot }',
      example: { username: 'durov' },
      handler: (args, session) => this.fetchUserResolve(args, session),
    });
  }

  /**
   * @param {unknown} value
   * @param {string} what
   * @returns {string}
   */
  #requireHandle(value, what) {
    const v = typeof value === 'string' ? value.trim().replace(/^@/, '') : '';
    if (!TELEGRAM_HANDLE_RE.test(v)) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4002',
        message: `Invalid telegram ${what} "${value}" — expected 5–32 chars [a-zA-Z0-9_]`,
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: this.platform,
      });
    }
    return v;
  }

  async fetchChannelMessages(args, session = {}) {
    const channel = this.#requireHandle(args?.channel, 'channel');
    return this.client.getChannelMessages(channel, { accountId: session?.accountId || null, session });
  }

  async fetchChannelInfo(args, session = {}) {
    const channel = this.#requireHandle(args?.channel, 'channel');
    return this.client.getChannelInfo(channel, { accountId: session?.accountId || null, session });
  }

  async fetchSearchChannels(args, session = {}) {
    const query = typeof args?.query === 'string' ? args.query.trim() : '';
    if (!query) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'search_channels requires query',
        statusCode: 400,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
        platform: this.platform,
      });
    }
    return this.client.searchChannels(query, { accountId: session?.accountId || null, session });
  }

  async fetchUserResolve(args, session = {}) {
    const username = this.#requireHandle(args?.username, 'username');
    return this.client.resolveUser(username, { accountId: session?.accountId || null, session });
  }

  async cleanup() {}
}

export default TelegramCrawler;
