// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * BasePushAdapter — Abstract base class for push-based streaming adapters.
 * Manages connection lifecycle, exponential backoff reconnects,
 * Redis cursor persistence, and normalized event emission.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license Apache-2.0
 */

import { EventEmitter } from 'events';
import { defaultRedisStreamPublisher } from '../../utils/redis-stream-publisher.js';

/**
 * @typedef {Object} BasePushAdapterOptions
 * @property {string} [cursor] - Initial cursor to start reading from
 * @property {number} [reconnectBaseDelayMs=1000] - Initial delay before reconnecting (ms)
 * @property {number} [reconnectMaxDelayMs=30000] - Maximum reconnect delay cap (ms)
 * @property {number} [maxReconnectAttempts=Infinity] - Max reconnect attempts before failing
 * @property {import('../../core/types.js').RedisClientLike} [redisClient] - Custom Redis client for cursors
 * @property {Record<string, unknown>} [extra] - Additional adapter-specific options
 */

export class BasePushAdapter extends EventEmitter {
  /** @type {string} */
  streamId;

  /** @type {Record<string, any>} */
  options;

  /** @type {import('../../utils/redis-stream-publisher.js').RedisStreamPublisher} */
  publisher;

  /** @type {boolean} */
  _connected = false;

  /** @type {boolean} */
  _paused = false;

  /** @type {boolean} */
  _closing = false;

  /** @type {number} */
  reconnectAttempts = 0;

  /** @type {NodeJS.Timeout | null} */
  _reconnectTimer = null;

  /** @type {string | null} */
  _cursor = null;

  /** @type {import('../../core/types.js').RedisClientLike | null} */
  _redisClient = null;

  /**
   * @param {string} streamId
   * @param {Record<string, any>} [options]
   * @param {import('../../utils/redis-stream-publisher.js').RedisStreamPublisher} [publisher]
   */
  constructor(streamId, options = {}, publisher = defaultRedisStreamPublisher) {
    super();
    if (!streamId) {
      throw new Error('❌ streamId is required for BasePushAdapter');
    }
    this.streamId = streamId;
    this.options = { ...options };
    this.publisher = publisher;
    this._cursor = typeof options.cursor === 'string' || typeof options.cursor === 'number'
      ? String(options.cursor)
      : null;
    this._redisClient = options.redisClient || null;
  }

  /**
   * Getter for connection status.
   * Also supports caller checking as a method: `if (adapter.isConnected)` or `if (adapter.isConnected())`.
   * @returns {boolean}
   */
  get isConnected() {
    return this._connected;
  }

  /**
   * Checks if adapter is currently connected.
   * @returns {boolean}
   */
  checkConnected() {
    return this._connected;
  }

  /**
   * Checks if adapter is currently paused.
   * @returns {boolean}
   */
  get isPaused() {
    return this._paused;
  }

  /**
   * Redis cursor key name for this stream.
   * @returns {string}
   */
  get cursorKey() {
    return `xactions:adapter_cursor:${this.streamId}`;
  }

  /**
   * Acquire a Redis client for cursor persistence.
   * Reuses options.redisClient if supplied, or calls publisher.ensureClient().
   * @returns {Promise<import('../../core/types.js').RedisClientLike | null>}
   */
  async _getRedisClient() {
    if (this._redisClient) {
      return this._redisClient;
    }
    if (this.publisher && typeof this.publisher.ensureClient === 'function') {
      const client = await this.publisher.ensureClient();
      if (client) {
        return client;
      }
    }
    return null;
  }

  /**
   * Load the persisted cursor for this stream from Redis.
   * @returns {Promise<string | null>}
   */
  async getCursor() {
    if (this._cursor) {
      return this._cursor;
    }
    try {
      const client = await this._getRedisClient();
      if (!client) {
        return this._cursor;
      }
      let val = null;
      if (typeof client.get === 'function') {
        val = await client.get(this.cursorKey);
      } else if (typeof client.sendCommand === 'function') {
        val = await client.sendCommand(['GET', this.cursorKey]);
      }
      if (val !== null && val !== undefined) {
        this._cursor = String(val);
      }
      return this._cursor;
    } catch (err) {
      console.warn(`⚠️ [${this.streamId}] Failed to load cursor from Redis:`, err instanceof Error ? err.message : String(err));
      return this._cursor;
    }
  }

  /**
   * Save a new cursor position for this stream.
   * @param {string | number} cursor
   * @returns {Promise<void>}
   */
  async saveCursor(cursor) {
    if (cursor === undefined || cursor === null) return;
    const strCursor = String(cursor);
    this._cursor = strCursor;
    try {
      const client = await this._getRedisClient();
      if (!client) return;

      if (typeof client.set === 'function') {
        await client.set(this.cursorKey, strCursor);
      } else if (typeof client.sendCommand === 'function') {
        await client.sendCommand(['SET', this.cursorKey, strCursor]);
      }
    } catch (err) {
      console.warn(`⚠️ [${this.streamId}] Failed to persist cursor to Redis:`, err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Connect to the push-based stream source.
   * Abstract method — must be implemented by concrete subclasses.
   * @abstract
   * @returns {Promise<void>}
   */
  async connect() {
    throw new Error('❌ connect() must be implemented by subclass');
  }

  /**
   * Disconnect cleanly from the stream source and persist cursor.
   * @returns {Promise<void>}
   */
  async disconnect() {
    this._closing = true;
    this._clearReconnectTimer();
    this._connected = false;
    if (this._cursor) {
      await this.saveCursor(this._cursor);
    }
    this._emitStatus('stopped');
  }

  /**
   * Pause processing events without closing connection.
   * @returns {void}
   */
  pause() {
    if (!this._paused) {
      this._paused = true;
      this._emitStatus('paused');
    }
  }

  /**
   * Resume processing events after pause.
   * @returns {void}
   */
  resume() {
    if (this._paused) {
      this._paused = false;
      this._emitStatus('running');
    }
  }

  /**
   * Schedule reconnection with exponential backoff.
   * Delays: 1s -> 2s -> 4s -> 8s -> 16s -> 30s max.
   * @protected
   * @returns {void}
   */
  _scheduleReconnect() {
    if (this._closing) return;

    this._clearReconnectTimer();
    this._connected = false;

    const maxAttempts = this.options.maxReconnectAttempts ?? Infinity;
    if (this.reconnectAttempts >= maxAttempts) {
      const err = new Error(`❌ Max reconnect attempts (${maxAttempts}) reached for stream ${this.streamId}`);
      this._emitError(err);
      this._emitStatus('error');
      return;
    }

    const baseDelay = Number(this.options.reconnectBaseDelayMs) || 1000;
    const maxDelay = Number(this.options.reconnectMaxDelayMs) || 30000;
    const delay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempts), maxDelay);

    this.reconnectAttempts++;
    this._emitStatus('reconnecting');
    console.log(`🔄 [${this.streamId}] Scheduling reconnect attempt #${this.reconnectAttempts} in ${delay}ms`);

    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      if (this._closing) return;
      try {
        await this.connect();
      } catch (err) {
        console.error(`❌ [${this.streamId}] Reconnect failed:`, err instanceof Error ? err.message : String(err));
        this._scheduleReconnect();
      }
    }, delay);
  }

  /**
   * Clear any active reconnect timer.
   * @protected
   * @returns {void}
   */
  _clearReconnectTimer() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  /**
   * Reset the reconnect attempts counter upon successful connection.
   * @protected
   * @returns {void}
   */
  _resetReconnect() {
    this.reconnectAttempts = 0;
    this._clearReconnectTimer();
  }

  /**
   * Emit normalized event to listeners and publish to Redis Stream.
   * If adapter is paused, event is dropped/skipped.
   *
   * @protected
   * @param {Record<string, any>} item - Normalized PostItem or ThinEvent
   * @returns {Promise<void>}
   */
  async _emitEvent(item) {
    if (this._paused || this._closing || !item) return;

    // Emit local event to listeners (e.g. streamManager / socket.io)
    this.emit('event', item);

    // Publish to stream:social:raw_posts via RedisStreamPublisher
    if (this.publisher && typeof this.publisher.publish === 'function') {
      try {
        await this.publisher.publish(item);
      } catch (err) {
        console.warn(`⚠️ [${this.streamId}] Failed to publish event to Redis stream:`, err instanceof Error ? err.message : String(err));
      }
    }
  }

  /**
   * Emit error to error listeners.
   * @protected
   * @param {Error} err
   * @returns {void}
   */
  _emitError(err) {
    this.emit('error', err);
  }

  /**
   * Emit status change event.
   * @protected
   * @param {string} status - 'running' | 'paused' | 'stopped' | 'reconnecting' | 'error'
   * @returns {void}
   */
  _emitStatus(status) {
    this.emit('status', {
      status,
      streamId: this.streamId,
      timestamp: new Date().toISOString(),
    });
  }
}
