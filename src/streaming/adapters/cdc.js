// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * CDCAdapter — Change Data Capture push adapter reading from a Redis Stream.
 * Continuously loops with XREAD BLOCK to consume events, validates ThinEvent
 * compatibility, and publishes them to the target social raw posts stream.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license Apache-2.0
 */

import { BasePushAdapter } from './base-adapter.js';

export class CDCAdapter extends BasePushAdapter {
  /** @type {string} */
  sourceStreamKey;

  /** @type {number} */
  blockTimeoutMs;

  /** @type {boolean} */
  _running = false;

  /** @type {import('../../core/types.js').RedisClientLike | null} */
  _sourceRedis = null;

  /**
   * @param {string} streamId
   * @param {Record<string, any>} [options]
   * @param {import('../../utils/redis-stream-publisher.js').RedisStreamPublisher} [publisher]
   */
  constructor(streamId, options = {}, publisher) {
    super(streamId, options, publisher);
    this.sourceStreamKey = options.sourceStreamKey || 'cdc:events';
    this.blockTimeoutMs = Number(options.blockTimeoutMs) || 5000;
    this._sourceRedis = options.sourceRedis || null;
  }

  /**
   * Ensure a dedicated Redis client is connected for long-polling XREAD BLOCK.
   * @returns {Promise<import('../../core/types.js').RedisClientLike | null>}
   */
  async _getSourceRedis() {
    if (this._sourceRedis) {
      return this._sourceRedis;
    }
    const client = await this._getRedisClient();
    this._sourceRedis = client;
    return client;
  }

  /**
   * Validate that an ingested raw event adheres to the required ThinEvent shape.
   * Required fields: id, platform, (external_post_id or externalId), content_snippet
   *
   * @param {Record<string, any>} event
   * @returns {boolean}
   */
  validateThinEvent(event) {
    if (!event || typeof event !== 'object') return false;
    const hasId = Boolean(event.id);
    const hasPlatform = Boolean(event.platform);
    const hasExternalId = Boolean(event.external_post_id || event.externalId);
    const hasContent = event.content_snippet !== undefined && event.content_snippet !== null;

    return hasId && hasPlatform && hasExternalId && hasContent;
  }

  /**
   * Connect and start XREAD BLOCK consumer loop.
   * @returns {Promise<void>}
   */
  async connect() {
    this._closing = false;
    const client = await this._getSourceRedis();
    if (!client) {
      const err = new Error(`❌ [${this.streamId}] Redis client unavailable for CDC adapter`);
      this._emitError(err);
      this._scheduleReconnect();
      return;
    }

    // Load initial cursor (defaults to '$' to read only new items, or 0)
    let cursor = await this.getCursor();
    if (!cursor) {
      cursor = this.options.initialCursor || '$';
      this._cursor = cursor;
    }

    this._connected = true;
    this._running = true;
    this._resetReconnect();
    this._emitStatus('running');
    console.log(`✅ [${this.streamId}] CDC adapter connected to ${this.sourceStreamKey} at cursor ${cursor}`);

    // Start background consume loop
    this._consumeLoop().catch((err) => {
      if (!this._closing) {
        console.error(`❌ [${this.streamId}] CDC consume loop encountered error:`, err instanceof Error ? err.message : String(err));
        this._scheduleReconnect();
      }
    });
  }

  /**
   * Loop reading events from source Redis stream via XREAD BLOCK.
   * @returns {Promise<void>}
   */
  async _consumeLoop() {
    while (this._running && !this._closing) {
      try {
        const client = await this._getSourceRedis();
        if (!client) break;

        const currentCursor = this._cursor || '$';
        const entries = await this._readFromStream(client, this.sourceStreamKey, currentCursor, this.blockTimeoutMs);

        if (Array.isArray(entries) && entries.length > 0) {
          for (const entry of entries) {
            if (this._closing) break;
            const { id: entryId, message } = entry;
            this._cursor = entryId;

            if (this.validateThinEvent(message)) {
              await this._emitEvent(message);
            } else {
              console.warn(`⚠️ [${this.streamId}] Skipped invalid ThinEvent record from CDC ${this.sourceStreamKey}:`, message);
            }
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (this._closing) break;

        // If command timed out / aborted, loop continues
        if (errMsg.includes('timeout') || errMsg.includes('abort')) {
          continue;
        }

        console.error(`❌ [${this.streamId}] XREAD error:`, errMsg);
        this._connected = false;
        this._running = false;
        this._scheduleReconnect();
        break;
      }
    }
  }

  /**
   * Read batch of events from Redis stream supporting both node-redis and ioredis API shapes.
   *
   * @param {any} client
   * @param {string} key
   * @param {string} cursor
   * @param {number} blockMs
   * @returns {Promise<Array<{ id: string, message: Record<string, any> }>>}
   */
  async _readFromStream(client, key, cursor, blockMs) {
    // 1. node-redis v4+ xRead API
    if (typeof client.xRead === 'function') {
      const response = await client.xRead(
        { key, id: cursor },
        { BLOCK: blockMs, COUNT: 50 }
      );
      if (!response || !Array.isArray(response)) return [];
      const streamData = response.find((s) => s.name === key || s.key === key) || response[0];
      if (!streamData || !Array.isArray(streamData.messages)) return [];
      return streamData.messages.map(/** @param {any} m */ (m) => ({
        id: String(m.id),
        message: /** @type {Record<string, any>} */ (m.message),
      }));
    }

    // 2. ioredis xread API: xread('BLOCK', blockMs, 'COUNT', 50, 'STREAMS', key, cursor)
    if (typeof client.xread === 'function') {
      const response = await client.xread(
        'BLOCK',
        blockMs,
        'COUNT',
        50,
        'STREAMS',
        key,
        cursor
      );
      if (!response || !Array.isArray(response)) return [];
      // Format: [ [ streamKey, [ [ id, [ field1, val1, ... ] ], ... ] ] ]
      const streamTuple = response[0];
      if (!streamTuple || !Array.isArray(streamTuple[1])) return [];
      return streamTuple[1].map(([id, fields]) => {
        /** @type {Record<string, any>} */
        const message = {};
        for (let i = 0; i < fields.length; i += 2) {
          message[String(fields[i])] = fields[i + 1];
        }
        return { id: String(id), message };
      });
    }

    // 3. Fallback: sendCommand
    if (typeof client.sendCommand === 'function') {
      const response = await client.sendCommand([
        'XREAD',
        'BLOCK',
        String(blockMs),
        'COUNT',
        '50',
        'STREAMS',
        key,
        cursor,
      ]);
      if (!response || !Array.isArray(response)) return [];
      const streamTuple = response[0];
      if (!streamTuple || !Array.isArray(streamTuple[1])) return [];
      return streamTuple[1].map(([id, fields]) => {
        /** @type {Record<string, any>} */
        const message = {};
        for (let i = 0; i < fields.length; i += 2) {
          message[String(fields[i])] = fields[i + 1];
        }
        return { id: String(id), message };
      });
    }

    return [];
  }

  /**
   * Stop CDC polling loop and disconnect cleanly.
   * @returns {Promise<void>}
   */
  async disconnect() {
    this._closing = true;
    this._running = false;
    await super.disconnect();
  }
}
