// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * StreamMetricsReader — reads pending message metrics from Redis Streams.
 * @author nich (@nichxbt)
 * @license MIT
 */

export class StreamMetricsReader {
  /** @type {import('redis').RedisClientType | null} */
  #redisClient = null;

  /** @type {string} */
  #streamKey;

  /** @type {string} */
  #groupName;

  /** @type {boolean} */
  #isOwnedClient = false;

  /**
   * @param {Object} [options]
   * @param {import('redis').RedisClientType} [options.redisClient]
   * @param {string} [options.streamKey='stream:social:raw_posts']
   * @param {string} [options.groupName='nowing_nlp_workers']
   */
  constructor(options = {}) {
    this.#redisClient = options.redisClient || null;
    this.#streamKey = options.streamKey || 'stream:social:raw_posts';
    this.#groupName = options.groupName || 'nowing_nlp_workers';
  }

  /**
   * Ensure client is initialized and connected.
   * @private
   * @returns {Promise<import('redis').RedisClientType | null>}
   */
  async #ensureClient() {
    if (this.#redisClient) {
      return this.#redisClient;
    }

    try {
      const { createClient } = await import('redis');
      const url = process.env.REDIS_URL || (process.env.REDIS_HOST ? `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}` : 'redis://localhost:6379');
      const client = createClient({ url });
      client.on('error', () => {}); // Prevent unhandled error event crashes
      await client.connect();
      this.#redisClient = client;
      this.#isOwnedClient = true;
      return this.#redisClient;
    } catch {
      return null;
    }
  }

  /**
   * Get total number of pending/unacknowledged messages in the stream group.
   * Never throws; returns 0 on failure or disconnect.
   * @returns {Promise<number>}
   */
  async getPendingCount() {
    const client = await this.#ensureClient();
    if (!client) {
      return 0;
    }

    try {
      if (typeof client.xPending === 'function') {
        const info = await client.xPending(this.#streamKey, this.#groupName);
        return Number(info?.pending ?? info?.count ?? 0) || 0;
      }
      if (typeof client.xpending === 'function') {
        const info = await client.xpending(this.#streamKey, this.#groupName);
        if (Array.isArray(info) && info.length > 0) {
          return Number(info[0]) || 0;
        }
        return Number(info?.pending ?? info?.count ?? 0) || 0;
      }
      return 0;
    } catch (err) {
      console.warn(`[StreamMetricsReader] Failed to query stream pending count for "${this.#streamKey}":`, err?.message || String(err));
      return 0;
    }
  }

  /**
   * Close client if owned.
   * @returns {Promise<void>}
   */
  async close() {
    if (this.#isOwnedClient && this.#redisClient && typeof this.#redisClient.quit === 'function') {
      try {
        await this.#redisClient.quit();
      } catch {
        // Safe ignore on shutdown
      } finally {
        this.#redisClient = null;
      }
    }
  }
}

/**
 * Helper to query reader and update governor with current lag.
 * @param {import('../core/adaptive-governor.js').AdaptiveRateGovernor} governor
 * @param {StreamMetricsReader} [reader]
 * @returns {Promise<number>}
 */
export async function refreshGovernorConsumerLag(governor, reader = new StreamMetricsReader()) {
  const lag = await reader.getPendingCount();
  if (governor && typeof governor.updateRedisConsumerLag === 'function') {
    governor.updateRedisConsumerLag(lag);
  }
  return lag;
}
