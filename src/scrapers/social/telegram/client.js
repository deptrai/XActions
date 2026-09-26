// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TelegramClient — strategy-shim for telegram scraping (Story 50.8 skeleton).
 * Transport choice deferred to D4 spec — env `TELEGRAM_TRANSPORT` selects one
 * of 'mtproto' | 'bot' | 'web'. All upstream methods throw `XACT_4001` until a
 * real impl lands in the D4 PR; only the interface seam exists here.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AbstractApiClient } from '../../../core/base-client.js';
import {
  PlatformError,
  ErrorTypes,
  SuggestedActions,
} from '../../../core/error-envelope.js';

export const TELEGRAM_TRANSPORTS = Object.freeze(['mtproto', 'bot', 'web']);

export function createTelegramClient(options = {}) {
  return new TelegramClient(options);
}

/**
 * @param {string | null} transport
 * @returns {PlatformError}
 */
function transportNotImplemented(transport) {
  return new PlatformError({
    type: ErrorTypes.INVALID_ARGS,
    code: 'XACT_4001',
    message: `telegram transport "${transport || 'unset'}" not implemented — D4 spec picks and lands the impl`,
    statusCode: 400,
    suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    platform: 'telegram',
  });
}

export class TelegramClient extends AbstractApiClient {
  /** @type {string} */
  name = 'telegram';

  /** @type {string} */
  platform = 'telegram';

  /** @type {boolean} */
  requiresAuth = false;

  /** @type {boolean} */
  requiresResidential = false;

  /** @type {'undici' | 'got' | 'curl'} */
  client = 'undici';

  /**
   * Active transport choice: 'mtproto' | 'bot' | 'web' | null.
   * `null` means TELEGRAM_TRANSPORT unset — downstream calls throw XACT_4001.
   * @type {string | null}
   */
  transport;

  constructor(options = {}) {
    super(options);
    this.transport = this.#resolveTransport(options.transport);
  }

  /**
   * Resolve the transport choice: explicit option > env > null.
   * @param {unknown} t
   * @returns {string | null}
   */
  #resolveTransport(t) {
    const env = String(process.env.TELEGRAM_TRANSPORT || '').trim().toLowerCase();
    const pick = String(t || env || '').trim().toLowerCase();
    return TELEGRAM_TRANSPORTS.includes(pick) ? pick : null;
  }

  /**
   * Guard — throws XACT_4001 when transport is unset or no impl is wired.
   * Every upstream method calls this first.
   * @returns {Promise<string>} resolved transport
   */
  async #requireTransport() {
    // Even when a transport IS picked, no impl is wired in 50.8 — surface
    // the explicit XACT_4001 either way so consumers see a stable contract.
    throw transportNotImplemented(this.transport);
  }

  /**
   * Fetch recent posts from a public channel. STUB — throws XACT_4001.
   * @param {string} channel - t.me/<channel> username
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<Record<string, unknown>[]>}
   */
  async getChannelMessages(channel, options = {}) {
    void channel;
    void options;
    await this.#requireTransport();
    return [];
  }

  /**
   * Fetch channel metadata: title, member_count, description, linked_chat_id.
   * STUB — throws XACT_4001.
   * @param {string} channel
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<Record<string, unknown>>}
   */
  async getChannelInfo(channel, options = {}) {
    void channel;
    void options;
    await this.#requireTransport();
    return {};
  }

  /**
   * Search public channels by keyword. STUB — throws XACT_4001.
   * @param {string} query
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<Record<string, unknown>[]>}
   */
  async searchChannels(query, options = {}) {
    void query;
    void options;
    await this.#requireTransport();
    return [];
  }

  /**
   * Resolve a @username to a profile record. STUB — throws XACT_4001.
   * @param {string} username
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<Record<string, unknown>>}
   */
  async resolveUser(username, options = {}) {
    void username;
    void options;
    await this.#requireTransport();
    return {};
  }
}

export default TelegramClient;
