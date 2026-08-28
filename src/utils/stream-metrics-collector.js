// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * StreamMetricsCollector — Collects full StreamMetrics from Redis Streams with in-memory caching.
 * Measures events/sec, pending messages, consumer lag, dropped events, and ack idle time.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { extractPendingCount } from './stream-metrics.js';

export class StreamMetricsCollector {
  /** @type {import('../core/types.js').RedisClientLike | null} */
  #redisClient = null;

  /** @type {string} */
  #streamKey;

  /** @type {string} */
  #groupName;

  /** @type {number} */
  #maxLen;

  /** @type {number} */
  #cacheTtlMs;

  /** @type {import('../core/types.js').StreamMetrics | null} */
  #cachedMetrics = null;

  /** @type {number} */
  #lastFetchedAt = 0;

  /** @type {number} */
  #prevEntriesAdded = 0;

  /** @type {number} */
  #prevSampleTime = 0;

  /** @type {boolean} */
  #groupInitialized = false;

  /** @type {boolean} */
  #isOwnedClient = false;

  /**
   * @param {Object} [options]
   * @param {import('../core/types.js').RedisClientLike} [options.redisClient]
   * @param {string} [options.streamKey]
   * @param {string} [options.groupName]
   * @param {number} [options.maxLen]
   * @param {number} [options.cacheTtlMs]
   */
  constructor(options = {}) {
    this.#redisClient = options.redisClient || null;
    this.#streamKey = options.streamKey || 'stream:social:raw_posts';
    this.#groupName = options.groupName || process.env.NOWING_CONSUMER_GROUP || 'nowing_nlp_workers';

    const parsedMaxLen = Number(options.maxLen ?? process.env.REDIS_STREAM_MAXLEN);
    this.#maxLen = Number.isFinite(parsedMaxLen) && parsedMaxLen > 0 ? parsedMaxLen : 1000000;

    this.#cacheTtlMs = options.cacheTtlMs ?? 5000;
  }

  /**
   * Ensure Redis client is initialized.
   * @returns {Promise<import('../core/types.js').RedisClientLike | null>}
   */
  async #ensureClient() {
    if (this.#redisClient) {
      return this.#redisClient;
    }

    try {
      const { createClient } = await import('redis');
      const url =
        process.env.REDIS_URL ||
        (process.env.REDIS_HOST
          ? `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}`
          : 'redis://localhost:6379');
      const client = createClient({ url });
      client.on('error', (err) => {
        console.warn('[StreamMetricsCollector] Redis client error:', (err instanceof Error ? err.message : String(err)));
      });
      await client.connect();
      this.#redisClient = /** @type {import('../core/types.js').RedisClientLike} */ (client);
      this.#isOwnedClient = true;
      return this.#redisClient;
    } catch {
      return null;
    }
  }

  /**
   * Ensure consumer group exists with MKSTREAM.
   * @param {import('../core/types.js').RedisClientLike} client
   */
  async #ensureConsumerGroup(client) {
    if (this.#groupInitialized) return;
    try {
      if (typeof client.xGroupCreate === 'function') {
        await client.xGroupCreate(this.#streamKey, this.#groupName, '$', { MKSTREAM: true });
      } else if (typeof client.xgroup === 'function') {
        await client.xgroup('CREATE', this.#streamKey, this.#groupName, '$', 'MKSTREAM');
      } else if (typeof client.sendCommand === 'function') {
        await client.sendCommand(['XGROUP', 'CREATE', this.#streamKey, this.#groupName, '$', 'MKSTREAM']);
      }
      this.#groupInitialized = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('BUSYGROUP')) {
        this.#groupInitialized = true;
      }
    }
  }

  /**
   * Collect fresh metrics from Redis or return cached metrics if valid.
   * @param {Object} [options]
   * @param {boolean} [options.forceRefresh=false]
   * @returns {Promise<import('../core/types.js').StreamMetrics>}
   */
  async getMetrics(options = {}) {
    const now = Date.now();
    if (
      !options.forceRefresh &&
      this.#cachedMetrics &&
      now - this.#lastFetchedAt < this.#cacheTtlMs
    ) {
      return this.#cachedMetrics;
    }

    const defaultMetrics = {
      eventsPerSecond: 0,
      pendingMessages: 0,
      consumerLag: 0,
      droppedEvents: 0,
      lastAckTime: 0,
      maxLen: this.#maxLen,
      minId: null,
    };

    const client = await this.#ensureClient();
    if (!client) {
      this.#cachedMetrics = defaultMetrics;
      this.#lastFetchedAt = now;
      return defaultMetrics;
    }

    try {
      await this.#ensureConsumerGroup(client);

      // 1. Pending Messages (XLEN)
      let pendingMessages = 0;
      if (typeof client.xLen === 'function') {
        pendingMessages = Number(await client.xLen(this.#streamKey)) || 0;
      } else if (typeof client.xlen === 'function') {
        pendingMessages = Number(await client.xlen(this.#streamKey)) || 0;
      } else if (typeof client.sendCommand === 'function') {
        pendingMessages = Number(await client.sendCommand(['XLEN', this.#streamKey])) || 0;
      }

      // 2. Consumer Lag (XPENDING)
      let consumerLag = 0;
      try {
        if (typeof client.xPending === 'function') {
          const info = await client.xPending(this.#streamKey, this.#groupName);
          consumerLag = Number(extractPendingCount(info)) || 0;
        } else if (typeof client.xpending === 'function') {
          const info = await client.xpending(this.#streamKey, this.#groupName);
          consumerLag = Number(extractPendingCount(info)) || 0;
        } else if (typeof client.sendCommand === 'function') {
          const info = await client.sendCommand(['XPENDING', this.#streamKey, this.#groupName]);
          consumerLag = Number(extractPendingCount(info)) || 0;
        }
      } catch {
        consumerLag = 0;
      }

      // 3. XINFO STREAM (minId, entries-added, length)
      let minId = null;
      let entriesAdded = pendingMessages;
      try {
        let streamInfo = null;
        const anyClient = /** @type {Record<string, any>} */ (client);
        if (typeof anyClient.xInfoStream === 'function') {
          streamInfo = await anyClient.xInfoStream(this.#streamKey);
        } else if (typeof anyClient.xInfo === 'function') {
          streamInfo = await anyClient.xInfo('STREAM', this.#streamKey);
        } else if (typeof anyClient.xinfo === 'function') {
          streamInfo = await anyClient.xinfo('STREAM', this.#streamKey);
        } else if (typeof anyClient.sendCommand === 'function') {
          const raw = await anyClient.sendCommand(['XINFO', 'STREAM', this.#streamKey]);
          if (Array.isArray(raw)) {
            /** @type {Record<string, unknown>} */
            const parsedMap = {};
            for (let i = 0; i < raw.length; i += 2) {
              const k = String(raw[i]);
              parsedMap[k] = raw[i + 1];
            }
            streamInfo = parsedMap;
          }
        }

        if (streamInfo && typeof streamInfo === 'object') {
          const typedStreamInfo = /** @type {Record<string, unknown>} */ (streamInfo);
          const rawAdded = typedStreamInfo.entriesAdded ?? typedStreamInfo['entries-added'];
          if (rawAdded !== undefined) {
            entriesAdded = Number(rawAdded) || pendingMessages;
          }
          const rawFirst = typedStreamInfo.firstEntry ?? typedStreamInfo['first-entry'];
          if (Array.isArray(rawFirst) && rawFirst.length > 0) {
            minId = typeof rawFirst[0] === 'string' ? rawFirst[0] : String(rawFirst[0]);
          } else if (rawFirst && typeof rawFirst === 'object') {
            const firstObj = /** @type {Record<string, unknown>} */ (rawFirst);
            if (firstObj.id) {
              minId = String(firstObj.id);
            }
          }
        }
      } catch {
        // Fallback
      }

      // 4. Dropped Events
      const droppedEvents = Math.max(0, entriesAdded - pendingMessages);

      // 5. Events per second calculation
      let eventsPerSecond = 0;
      if (this.#prevSampleTime > 0 && now > this.#prevSampleTime) {
        const deltaSec = (now - this.#prevSampleTime) / 1000;
        const deltaAdded = Math.max(0, entriesAdded - this.#prevEntriesAdded);
        eventsPerSecond = Number((deltaAdded / deltaSec).toFixed(2));
      }
      this.#prevSampleTime = now;
      this.#prevEntriesAdded = entriesAdded;

      // 6. Last Ack Time / Idle calculation
      let lastAckTime = 0;
      try {
        const anyClient = /** @type {Record<string, any>} */ (client);
        if (typeof anyClient.xInfoConsumers === 'function') {
          const consumers = await anyClient.xInfoConsumers(this.#streamKey, this.#groupName);
          if (Array.isArray(consumers) && consumers.length > 0) {
            const minIdleMs = Math.min(...consumers.map((c) => Number(c?.idle) || 0));
            lastAckTime = Math.max(0, Math.floor(minIdleMs / 1000));
          }
        } else if (typeof anyClient.sendCommand === 'function') {
          const rawConsumers = await anyClient.sendCommand(['XINFO', 'CONSUMERS', this.#streamKey, this.#groupName]);
          if (Array.isArray(rawConsumers) && rawConsumers.length > 0) {
            lastAckTime = 0;
          }
        }
      } catch {
        lastAckTime = 0;
      }

      const result = {
        eventsPerSecond,
        pendingMessages,
        consumerLag,
        droppedEvents,
        lastAckTime,
        maxLen: this.#maxLen,
        minId,
      };

      this.#cachedMetrics = result;
      this.#lastFetchedAt = now;
      return result;
    } catch (err) {
      console.warn('[StreamMetricsCollector] Failed to collect metrics:', (err instanceof Error ? err.message : String(err)));
      this.#cachedMetrics = defaultMetrics;
      this.#lastFetchedAt = now;
      return defaultMetrics;
    }
  }

  /**
   * Close owned client.
   * @returns {Promise<void>}
   */
  async close() {
    if (this.#isOwnedClient && this.#redisClient) {
      try {
        const anyClient = /** @type {Record<string, any>} */ (this.#redisClient);
        if (typeof anyClient.quit === 'function') {
          await anyClient.quit();
        }
      } catch {
        // Safe ignore
      } finally {
        this.#redisClient = null;
      }
    }
  }
}

/** @type {StreamMetricsCollector} */
export const defaultStreamMetricsCollector = new StreamMetricsCollector();
