// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * MastodonSSEAdapter — Push adapter for Mastodon Server-Sent Events (SSE) streaming API.
 * Uses undici request streaming to consume real-time public, local, hashtag, or user events.
 * Normalizes status updates via normalizeMastodonStatus and publishes to Redis stream.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license Apache-2.0
 */

import { request } from 'undici';
import { BasePushAdapter } from './base-adapter.js';
import { normalizeMastodonStatus, normalizeInstanceUrl } from '../../scrapers/social/mastodon/normalizer.js';

export class MastodonSSEAdapter extends BasePushAdapter {
  /** @type {AbortController | null} */
  _abortController = null;

  /** @type {string} */
  instance;

  /** @type {string} */
  streamType;

  /**
   * @param {string} streamId
   * @param {Record<string, any>} [options]
   * @param {import('../../utils/redis-stream-publisher.js').RedisStreamPublisher} [publisher]
   */
  constructor(streamId, options = {}, publisher) {
    super(streamId, options, publisher);
    this.instance = normalizeInstanceUrl(options.instance || 'https://mastodon.social');
    this.streamType = options.streamType || 'public';
  }

  /**
   * Build the Mastodon SSE endpoint URL.
   * Endpoints:
   * - public: /api/v1/streaming/public
   * - local: /api/v1/streaming/public/local
   * - hashtag: /api/v1/streaming/hashtag?tag=:tag
   * - user: /api/v1/streaming/user
   *
   * @returns {string}
   */
  buildUrl() {
    const base = `${this.instance}/api/v1/streaming`;
    if (this.streamType === 'hashtag') {
      if (!this.options.tag) {
        throw new Error('❌ "tag" option is required for Mastodon hashtag stream');
      }
      const cleanTag = String(this.options.tag).replace(/^#/, '');
      return `${base}/hashtag?tag=${encodeURIComponent(cleanTag)}`;
    }
    if (this.streamType === 'local') {
      return `${base}/public/local`;
    }
    if (this.streamType === 'user') {
      return `${base}/user`;
    }
    return `${base}/public`;
  }

  /**
   * Connect to Mastodon SSE stream.
   * @returns {Promise<void>}
   */
  async connect() {
    this._closing = false;
    this._abortController = new AbortController();
    const targetUrl = this.buildUrl();

    /** @type {Record<string, string>} */
    const headers = {
      Accept: 'text/event-stream',
      'User-Agent': 'XActions-Streaming/3.5.0',
    };
    if (this.options.accessToken) {
      headers.Authorization = `Bearer ${this.options.accessToken}`;
    }

    console.log(`📡 [${this.streamId}] Connecting to Mastodon SSE: ${targetUrl}`);

    try {
      const response = await request(targetUrl, {
        method: 'GET',
        headers,
        signal: this._abortController.signal,
      });

      if (response.statusCode >= 400) {
        const err = new Error(`❌ Mastodon SSE connection rejected with HTTP ${response.statusCode}`);
        this._emitError(err);
        this._scheduleReconnect();
        return;
      }

      this._connected = true;
      this._resetReconnect();
      this._emitStatus('running');
      console.log(`✅ [${this.streamId}] Mastodon SSE connected (status ${response.statusCode})`);

      // Consume stream chunks and parse SSE
      this._consumeSSEStream(response.body).catch((err) => {
        if (!this._closing) {
          console.warn(`⚠️ [${this.streamId}] Mastodon SSE stream error:`, err instanceof Error ? err.message : String(err));
          this._scheduleReconnect();
        }
      });
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      if (!this._closing) {
        console.error(`❌ [${this.streamId}] Mastodon SSE connection failed:`, errorObj.message);
        this._emitError(errorObj);
        this._scheduleReconnect();
      }
    }
  }

  /**
   * Parse incoming Server-Sent Events from body stream.
   * SSE format:
   * event: <event_name>\n
   * data: <payload>\n\n
   *
   * @param {import('stream').Readable | any} bodyStream
   * @returns {Promise<void>}
   */
  async _consumeSSEStream(bodyStream) {
    let buffer = '';

    for await (const chunk of bodyStream) {
      if (this._closing) break;
      buffer += chunk.toString('utf8');

      // Messages are delimited by double newline
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() || '';

      for (const block of parts) {
        if (!block.trim()) continue;
        await this._handleSSEBlock(block);
      }
    }

    // Stream ended normally or was closed
    this._connected = false;
    if (!this._closing) {
      console.log(`🔌 [${this.streamId}] Mastodon SSE stream disconnected unexpectedly`);
      this._scheduleReconnect();
    }
  }

  /**
   * Parse a single SSE block (event + data).
   * @param {string} block
   * @returns {Promise<void>}
   */
  async _handleSSEBlock(block) {
    const lines = block.split(/\r?\n/);
    let eventType = 'update';
    let dataStr = '';

    for (const line of lines) {
      if (line.startsWith(':')) {
        // SSE comment / heartbeat
        continue;
      }
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataStr += (dataStr ? '\n' : '') + line.slice(5).trim();
      }
    }

    if (!dataStr) return;

    if (eventType === 'delete') {
      console.log(`ℹ️ [${this.streamId}] Mastodon status deleted: ${dataStr}`);
      return;
    }

    if (eventType === 'update') {
      try {
        const rawStatus = JSON.parse(dataStr);
        if (rawStatus && rawStatus.id) {
          this._cursor = String(rawStatus.id);
        }

        const postItem = normalizeMastodonStatus(rawStatus, this.instance);
        if (postItem) {
          await this._emitEvent(postItem);
        }
      } catch (err) {
        console.warn(`⚠️ [${this.streamId}] Failed to parse Mastodon status update:`, err instanceof Error ? err.message : String(err));
      }
    }
  }

  /**
   * Disconnect SSE connection cleanly.
   * @returns {Promise<void>}
   */
  async disconnect() {
    this._closing = true;
    if (this._abortController) {
      try {
        this._abortController.abort();
      } catch {
        // Safe ignore
      }
      this._abortController = null;
    }
    await super.disconnect();
  }
}
