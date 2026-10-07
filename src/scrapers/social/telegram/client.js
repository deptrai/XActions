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

  /** @type {string} */
  relayUrl;

  /** @type {string} */
  relayToken;

  /** @type {typeof globalThis.fetch} */
  #fetchFn;

  constructor(options = {}) {
    super(options);
    this.transport = this.#resolveTransport(options.transport);
    this.relayUrl = (
      options.relayUrl ||
      process.env.TELEGRAM_RELAY_URL ||
      'http://127.0.0.1:3800'
    ).replace(/\/+$/, '');
    this.relayToken = options.relayToken || process.env.TELEGRAM_RELAY_TOKEN || '';
    this.#fetchFn = options.fetchFn || globalThis.fetch;
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
   * @returns {Promise<string>} resolved transport
   */
  async #requireTransport() {
    if (this.transport === 'mtproto') {
      return this.transport;
    }
    throw transportNotImplemented(this.transport);
  }

  /**
   * Send HTTP POST request to standalone telegram-relay service.
   * @param {string} endpoint
   * @param {Record<string, any>} payload
   * @returns {Promise<any>}
   */
  async #callRelay(endpoint, payload) {
    await this.#requireTransport();
    const url = `${this.relayUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
    const headers = {
      'content-type': 'application/json',
    };
    if (this.relayToken) {
      headers.authorization = `Bearer ${this.relayToken}`;
      headers['x-relay-token'] = this.relayToken;
    }

    let res;
    try {
      res = await this.#fetchFn(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
    } catch (err) {
      throw new PlatformError({
        type: ErrorTypes.INTERNAL,
        code: 'XACT_5031',
        message: `Failed to connect to telegram-relay at ${url}: ${err instanceof Error ? err.message : String(err)}`,
        statusCode: 503,
        isRetryable: true,
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform: 'telegram',
      });
    }

    let data;
    try {
      data = await res.json();
    } catch {
      data = { error: `HTTP ${res.status} response was not JSON` };
    }

    if (!res.ok) {
      const errMsg = String(data?.error || `Relay HTTP error ${res.status}`);

      if (res.status === 401) {
        throw new PlatformError({
          type: ErrorTypes.AUTH_EXPIRED,
          code: 'XACT_4011',
          message: `Telegram relay unauthorized: ${errMsg}`,
          statusCode: 401,
          isRetryable: false,
          suggestedAction: SuggestedActions.RELOGIN,
          platform: 'telegram',
        });
      }

      if (res.status === 503) {
        const floodMatch = errMsg.match(/FLOOD_WAIT_(\d+)/i);
        if (floodMatch) {
          const cooldownSec = parseInt(floodMatch[1], 10);
          throw new PlatformError({
            type: ErrorTypes.RATE_LIMIT,
            code: 'XACT_4291',
            message: `Telegram flood wait active (${cooldownSec}s): ${errMsg}`,
            statusCode: 429,
            isRetryable: true,
            suggestedAction: SuggestedActions.RATE_LIMIT_BACKOFF,
            platform: 'telegram',
            details: { cooldownSec, cooldownMs: (cooldownSec + 5) * 1000 },
          });
        }

        if (errMsg === 'SESSION_BANNED') {
          throw new PlatformError({
            type: ErrorTypes.AUTH_EXPIRED,
            code: 'XACT_4011',
            message: 'Telegram session has been revoked or banned upstream',
            statusCode: 503,
            isRetryable: false,
            suggestedAction: SuggestedActions.RELOGIN,
            platform: 'telegram',
          });
        }

        throw new PlatformError({
          type: ErrorTypes.INTERNAL,
          code: 'XACT_5031',
          message: `Telegram relay service unavailable: ${errMsg}`,
          statusCode: 503,
          isRetryable: true,
          suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
          platform: 'telegram',
        });
      }

      throw new PlatformError({
        type: ErrorTypes.INTERNAL,
        code: 'XACT_5001',
        message: `Telegram relay error: ${errMsg}`,
        statusCode: res.status,
        isRetryable: res.status >= 500,
        suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
        platform: 'telegram',
      });
    }

    return data;
  }

  /**
   * Fetch recent posts from a public channel.
   * @param {string} channel - t.me/<channel> username
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<Record<string, unknown>[]>}
   */
  async getChannelMessages(channel, options = {}) {
    if (this.transport !== 'mtproto') {
      await this.#requireTransport();
      return [];
    }
    const limit = Number(options.limit) || 20;
    const res = await this.#callRelay('/channel/messages', {
      channel,
      limit,
      minId: options.minId,
      maxId: options.maxId,
    });
    return Array.isArray(res?.messages) ? res.messages : [];
  }

  /**
   * Fetch channel metadata: title, member_count, description, linked_chat_id.
   * @param {string} channel
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<Record<string, unknown>>}
   */
  async getChannelInfo(channel, options = {}) {
    if (this.transport !== 'mtproto') {
      await this.#requireTransport();
      return {};
    }
    const res = await this.#callRelay('/channel/info', { channel });
    return res?.channel || {};
  }

  /**
   * Search public channels by keyword.
   * @param {string} query
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<Record<string, unknown>[]>}
   */
  async searchChannels(query, options = {}) {
    if (this.transport !== 'mtproto') {
      await this.#requireTransport();
      return [];
    }
    const limit = Number(options.limit) || 10;
    const res = await this.#callRelay('/channel/search', { query, limit });
    return Array.isArray(res?.results) ? res.results : [];
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
