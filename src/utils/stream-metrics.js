// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * StreamMetricsReader — reads pending message metrics from Redis Streams.
 * @author nich (@nichxbt)
 * @license MIT
 */

export class StreamMetricsReader {
  /** @type {any} */
  #redisClient = null;

  /** @type {string} */
  #streamKey;

  /** @type {string} */
  #groupName;

  /**
   * @param {Object} [options]
   * @param {any} [options.redisClient]
   * @param {string} [options.streamKey='stream:social:raw_posts']
   * @param {string} [options.groupName='nowing_nlp_workers']
   */
  constructor(options = {}) {
    this.#redisClient = options.redisClient || null;
    this.#streamKey = options.streamKey || 'stream:social:raw_posts';
    this.#groupName = options.groupName || 'nowing_nlp_workers';
  }

  /**
   * Get total number of pending/unacknowledged messages in the stream group.
   * Never throws; returns 0 on failure or disconnect.
   * @returns {Promise<number>}
   */
  async getPendingCount() {
    if (!this.#redisClient) {
      return 0;
    }

    try {
      if (typeof this.#redisClient.xPending === 'function') {
        const info = await this.#redisClient.xPending(this.#streamKey, this.#groupName);
        return Number(info?.pending ?? info?.count ?? 0) || 0;
      }
      if (typeof this.#redisClient.xpending === 'function') {
        const info = await this.#redisClient.xpending(this.#streamKey, this.#groupName);
        if (Array.isArray(info) && info.length > 0) {
          return Number(info[0]) || 0;
        }
        return Number(info?.pending ?? info?.count ?? 0) || 0;
      }
      return 0;
    } catch (err) {
      console.warn(`[StreamMetricsReader] Failed to query stream pending count for "${this.#streamKey}":`, err.message);
      return 0;
    }
  }

  /**
   * Close client if owned.
   * @returns {Promise<void>}
   */
  async close() {
    if (this.#redisClient && typeof this.#redisClient.quit === 'function') {
      try {
        await this.#redisClient.quit();
      } catch {
        // Safe ignore on shutdown
      }
    }
  }
}
