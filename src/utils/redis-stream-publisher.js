// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * RedisStreamPublisher — Reusable publisher for Nowing Redis Streams thin events.
 * Normalizes node-redis (xAdd) and ioredis (xadd) APIs, applies configurable trimming (MAXLEN/MINID),
 * and guarantees non-blocking, non-throwing emissions for scrapers.
 * @author nich (@nichxbt)
 * @license MIT
 */

/**
 * Check if an environment variable string represents a truthy flag (true, 1, yes, on).
 * @param {string | boolean | undefined | null} val
 * @returns {boolean}
 */
export function isEnvTruthy(val) {
  if (typeof val === 'boolean') return val;
  if (!val) return false;
  const normalized = String(val).trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

/**
 * Format any date/timestamp into ISO 8601 string.
 * @param {Date | string | number | undefined | null} val
 * @returns {string}
 */
export function toIsoDate(val) {
  if (!val) return new Date().toISOString();
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return new Date().toISOString();
    return val.toISOString();
  }
  try {
    const parsed = new Date(val);
    if (isNaN(parsed.getTime())) return new Date().toISOString();
    return parsed.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

export class RedisStreamPublisher {
  /** @type {import('../core/types.js').RedisClientLike | null} */
  #redisClient = null;

  /** @type {string} */
  #streamKey;

  /** @type {string} */
  #groupName;

  /** @type {'maxlen' | 'minid'} */
  #trimStrategy;

  /** @type {number} */
  #maxLen;

  /** @type {string | null} */
  #minId;

  /** @type {boolean | null} */
  #enabled = null;

  /** @type {boolean} */
  #isOwnedClient = false;

  /**
   * @param {Object} [options]
   * @param {import('../core/types.js').RedisClientLike} [options.redisClient]
   * @param {string} [options.streamKey]
   * @param {string} [options.groupName]
   * @param {'maxlen' | 'minid'} [options.trimStrategy]
   * @param {number} [options.maxLen]
   * @param {string} [options.minId]
   * @param {boolean} [options.enabled]
   */
  constructor(options = {}) {
    this.#redisClient = options.redisClient || null;
    this.#streamKey = options.streamKey || 'stream:social:raw_posts';
    this.#groupName = options.groupName || process.env.NOWING_CONSUMER_GROUP || 'nowing_nlp_workers';
    this.#enabled = options.enabled !== undefined ? Boolean(options.enabled) : null;

    const rawStrategy = (options.trimStrategy || process.env.REDIS_STREAM_TRIM_STRATEGY || 'maxlen').toLowerCase();
    this.#trimStrategy = rawStrategy === 'minid' ? 'minid' : 'maxlen';

    const parsedMaxLen = Number(options.maxLen ?? process.env.REDIS_STREAM_MAXLEN);
    this.#maxLen = Number.isFinite(parsedMaxLen) && parsedMaxLen > 0 ? parsedMaxLen : 1000000;

    this.#minId = options.minId ?? process.env.REDIS_STREAM_MINID ?? null;
  }

  /**
   * Ensure Redis client is available and connected.
   * @returns {Promise<import('../core/types.js').RedisClientLike | null>}
   */
  async ensureClient() {
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
        console.warn('[RedisStreamPublisher] Redis client error:', (err instanceof Error ? err.message : String(err)));
      });
      await client.connect();
      this.#redisClient = /** @type {import('../core/types.js').RedisClientLike} */ (client);
      this.#isOwnedClient = true;
      return this.#redisClient;
    } catch (err) {
      console.warn('[RedisStreamPublisher] Failed to connect to Redis:', (err instanceof Error ? err.message : String(err)));
      return null;
    }
  }

  /**
   * Sets or replaces the active redis client.
   * @param {import('../core/types.js').RedisClientLike | null} client
   */
  setClient(client) {
    this.#redisClient = client;
  }

  /**
   * Format a PostItem, CommentItem, or ThinEvent into the required string-only key-value record for XADD.
   * @param {Partial<import('../core/types.js').ThinEvent> & Record<string, unknown>} item
   * @returns {Record<string, string>}
   */
  formatPayload(item) {
    if (!item) return {};

    const id = String(item.id || (item.platform && item.externalId ? `${item.platform}:${item.externalId}` : ''));
    const platform = String(item.platform || '');
    const externalId = String(item.externalId || '');
    const category = String(item.category || 'social');
    const authorId = String(item.authorId || '');
    const crawledAt = toIsoDate(/** @type {any} */ (item.crawledAt));
    const storageRef = String(item.storageRef || id);

    return {
      id,
      platform,
      externalId,
      category,
      authorId,
      crawledAt,
      storageRef,
    };
  }

  /**
   * Publish a thin event pointer to the Redis stream.
   * Non-blocking and non-throwing: returns { ok: true, id } or { ok: false, error }
   *
   * @param {string | (Partial<import('../core/types.js').ThinEvent> & Record<string, unknown>)} keyOrItem
   * @param {Partial<import('../core/types.js').ThinEvent> & Record<string, unknown>} [maybeItem]
   * @param {Object} [opts]
   * @returns {Promise<{ ok: boolean, id?: string, skipped?: boolean, error?: string }>}
   */
  async publish(keyOrItem, maybeItem, opts = {}) {
    const isEnabled = this.#enabled !== null ? this.#enabled : isEnvTruthy(process.env.REDIS_STREAM_ENABLED);
    if (!isEnabled) {
      return { ok: false, skipped: true };
    }

    let streamKey = this.#streamKey;
    let item = maybeItem;

    if (typeof keyOrItem === 'string') {
      streamKey = keyOrItem;
    } else if (keyOrItem && typeof keyOrItem === 'object') {
      item = keyOrItem;
    }

    if (!item) {
      return { ok: false, error: 'No payload provided to publish' };
    }

    const payload = this.formatPayload(item);
    if (!payload.id) {
      return { ok: false, error: 'Payload missing id' };
    }

    const client = await this.ensureClient();
    if (!client) {
      return { ok: false, error: 'Redis client unavailable' };
    }

    try {
      // Determine trimming strategy
      const strategy = this.#trimStrategy;
      const useMinId = strategy === 'minid' && this.#minId;

      // 1. node-redis v4+ API: xAdd(key, '*', fields, options)
      if (typeof client.xAdd === 'function') {
        /** @type {any} */
        const trimOptions = useMinId
          ? {
              TRIM: {
                strategy: 'MINID',
                strategyModifier: '~',
                threshold: this.#minId,
              },
            }
          : {
              TRIM: {
                strategy: 'MAXLEN',
                strategyModifier: '~',
                threshold: this.#maxLen,
              },
            };

        const eventId = await client.xAdd(streamKey, '*', payload, trimOptions);
        return { ok: true, id: typeof eventId === 'string' ? eventId : String(eventId) };
      }

      // 2. ioredis / flat API: xadd(key, 'MAXLEN', '~', maxLen, '*', field1, val1, ...)
      if (typeof client.xadd === 'function') {
        const trimType = useMinId ? 'MINID' : 'MAXLEN';
        const trimThreshold = useMinId ? this.#minId : this.#maxLen;
        const flatPayload = Object.entries(payload).flat();

        const eventId = await client.xadd(
          streamKey,
          trimType,
          '~',
          trimThreshold,
          '*',
          ...flatPayload
        );
        return { ok: true, id: typeof eventId === 'string' ? eventId : String(eventId) };
      }

      // 3. Fallback to generic sendCommand if available
      if (typeof client.sendCommand === 'function') {
        const trimType = useMinId ? 'MINID' : 'MAXLEN';
        const trimThreshold = String(useMinId ? this.#minId : this.#maxLen);
        const flatPayload = Object.entries(payload).flat();
        const commandArgs = ['XADD', streamKey, trimType, '~', trimThreshold, '*', ...flatPayload];
        const eventId = await client.sendCommand(commandArgs);
        return { ok: true, id: typeof eventId === 'string' ? eventId : String(eventId) };
      }

      return { ok: false, error: 'No compatible XADD method found on Redis client' };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[${payload.platform || 'STREAM'} TELEMETRY] Failed to publish thin event to ${streamKey}:`, errMsg);
      return { ok: false, error: errMsg };
    }
  }

  /**
   * Query total message count (XLEN) for a stream.
   * @param {string} [streamKey]
   * @returns {Promise<number>}
   */
  async xlen(streamKey = this.#streamKey) {
    const client = await this.ensureClient();
    if (!client) return 0;

    try {
      if (typeof client.xLen === 'function') {
        return Number(await client.xLen(streamKey)) || 0;
      }
      if (typeof client.xlen === 'function') {
        return Number(await client.xlen(streamKey)) || 0;
      }
      if (typeof client.sendCommand === 'function') {
        return Number(await client.sendCommand(['XLEN', streamKey])) || 0;
      }
      return 0;
    } catch (err) {
      console.warn(`[RedisStreamPublisher] Failed to query XLEN for ${streamKey}:`, (err instanceof Error ? err.message : String(err)));
      return 0;
    }
  }

  /**
   * Query stream info (XINFO STREAM) for a stream.
   * @param {string} [streamKey]
   * @returns {Promise<Record<string, unknown> | null>}
   */
  async xinfo(streamKey = this.#streamKey) {
    const client = await this.ensureClient();
    if (!client) return null;

    try {
      const anyClient = /** @type {Record<string, any>} */ (client);
      if (typeof anyClient.xInfoStream === 'function') {
        return await anyClient.xInfoStream(streamKey);
      }
      if (typeof anyClient.xInfo === 'function') {
        return await anyClient.xInfo('STREAM', streamKey);
      }
      if (typeof anyClient.xinfo === 'function') {
        return await anyClient.xinfo('STREAM', streamKey);
      }
      if (typeof anyClient.sendCommand === 'function') {
        const raw = await anyClient.sendCommand(['XINFO', 'STREAM', streamKey]);
        if (Array.isArray(raw)) {
          /** @type {Record<string, unknown>} */
          const map = {};
          for (let i = 0; i < raw.length; i += 2) {
            map[raw[i]] = raw[i + 1];
          }
          return map;
        }
        return raw;
      }
      return null;
    } catch (err) {
      console.warn(`[RedisStreamPublisher] Failed to query XINFO for ${streamKey}:`, (err instanceof Error ? err.message : String(err)));
      return null;
    }
  }

  /**
   * Ensure a consumer group exists on the stream with MKSTREAM.
   * Idempotent: ignores BUSYGROUP errors.
   * @param {string} [streamKey]
   * @param {string} [groupName]
   * @returns {Promise<boolean>}
   */
  async xgroupEnsure(streamKey = this.#streamKey, groupName = this.#groupName) {
    const client = await this.ensureClient();
    if (!client) return false;

    try {
      if (typeof client.xGroupCreate === 'function') {
        await client.xGroupCreate(streamKey, groupName, '0', { MKSTREAM: true });
        return true;
      }
      if (typeof client.xgroup === 'function') {
        await client.xgroup('CREATE', streamKey, groupName, '0', 'MKSTREAM');
        return true;
      }
      if (typeof client.sendCommand === 'function') {
        await client.sendCommand(['XGROUP', 'CREATE', streamKey, groupName, '0', 'MKSTREAM']);
        return true;
      }
      return false;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('BUSYGROUP')) {
        return true; // Already exists
      }
      console.warn(`[RedisStreamPublisher] Failed to create consumer group "${groupName}" on "${streamKey}":`, errMsg);
      return false;
    }
  }

  /**
   * Close owned client.
   * @returns {Promise<void>}
   */
  async close() {
    if (this.#isOwnedClient && this.#redisClient) {
      try {
        const client = /** @type {any} */ (this.#redisClient);
        if (typeof client.quit === 'function') {
          await client.quit();
        } else if (typeof client.disconnect === 'function') {
          await client.disconnect();
        }
      } catch {
        // Safe ignore
      } finally {
        this.#redisClient = null;
      }
    }
  }
}

/** @type {RedisStreamPublisher} */
export const defaultRedisStreamPublisher = new RedisStreamPublisher();
