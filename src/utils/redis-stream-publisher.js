// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * RedisStreamPublisher — Reusable publisher for Nowing Redis Streams thin events.
 * Normalizes node-redis (xAdd) and ioredis (xadd) APIs, applies configurable trimming (MAXLEN/MINID),
 * and guarantees non-blocking, non-throwing emissions for scrapers.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { createHash } from 'node:crypto';
import { defaultHealthTierCache } from '../benchmark/health-tier-cache.js';

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

/**
 * Compute a deterministic SHA-256 idempotency key for an event.
 * Hash formula: sha256(`${platform}:${entityId}:${timestampBucket}`)
 * where timestampBucket defaults to hourly resolution (YYYY-MM-DDTHH)
 *
 * @param {Record<string, unknown>} item
 * @returns {string} 64-character lowercase hex SHA-256 hash
 */
export function computeIdempotencyKey(item) {
  if (!item || typeof item !== 'object') {
    return '';
  }
  try {
    const platform = String(item.platform || '');
    let entityId = String(item.external_post_id || item.externalId || item.id || '');
    if (platform && entityId.startsWith(`${platform}:`)) {
      entityId = entityId.slice(platform.length + 1);
    }
    const rawBucket = item.timestamp_bucket || item.timestampBucket;
    const timestampBucket = rawBucket
      ? String(rawBucket)
      : toIsoDate(item.crawled_at || item.crawledAt || item.time).slice(0, 13);
    const rawKey = `${platform}:${entityId}:${timestampBucket}`;
    return createHash('sha256').update(rawKey).digest('hex');
  } catch {
    return '';
  }
}

/**
 * Validate that an event record complies with the CloudEvents v1.0 specification.
 * Returns true if valid, or false with failure reason recorded if invalid.
 *
 * @param {unknown} event
 * @param {{ reason?: string, errors?: string[] }} [out] - Optional container to receive failure reason/errors
 * @returns {boolean}
 */
export function validateCloudEvent(event, out) {
  const errors = [];
  const setFailure = (reason) => {
    errors.push(reason);
    if (out && typeof out === 'object') {
      out.reason = reason;
      out.errors = errors;
    }
    validateCloudEvent.lastReason = reason;
    validateCloudEvent.lastErrors = errors;
    return false;
  };

  if (!event || typeof event !== 'object') {
    return setFailure('Event must be a non-null object');
  }

  const candidate = /** @type {Record<string, unknown>} */ (event);

  // 1. specversion: MUST be "1.0"
  if (candidate.specversion !== '1.0') {
    return setFailure('Missing or invalid "specversion": must be "1.0"');
  }

  // 2. id: MUST be non-empty string
  if (!candidate.id || typeof candidate.id !== 'string' || candidate.id.trim().length === 0) {
    return setFailure('Missing or invalid "id": must be a non-empty string');
  }

  // 3. source: MUST be non-empty string (URI reference)
  if (!candidate.source || typeof candidate.source !== 'string' || candidate.source.trim().length === 0) {
    return setFailure('Missing or invalid "source": must be a non-empty URI reference');
  }

  // 4. type: MUST be non-empty string
  if (!candidate.type || typeof candidate.type !== 'string' || candidate.type.trim().length === 0) {
    return setFailure('Missing or invalid "type": must be a non-empty string');
  }

  // 5. time: MUST be RFC 3339 timestamp
  if (!candidate.time || typeof candidate.time !== 'string') {
    return setFailure('Missing or invalid "time": must be an RFC 3339 timestamp string');
  }
  const timeDate = new Date(candidate.time);
  if (isNaN(timeDate.getTime())) {
    return setFailure(`Invalid "time" timestamp: "${candidate.time}"`);
  }

  // 6. datacontenttype: string ("application/json")
  if (candidate.datacontenttype !== undefined && candidate.datacontenttype !== null) {
    if (typeof candidate.datacontenttype !== 'string' || candidate.datacontenttype.trim().length === 0) {
      return setFailure('Invalid "datacontenttype": must be a non-empty string');
    }
  } else {
    return setFailure('Missing "datacontenttype": must be provided (e.g. "application/json")');
  }

  // 7. data: payload must be present
  if (candidate.data === undefined || candidate.data === null) {
    return setFailure('Missing "data": payload data must be present');
  }
  const contentType = String(candidate.datacontenttype).toLowerCase();
  if (typeof candidate.data === 'string' && contentType.includes('json')) {
    try {
      JSON.parse(candidate.data);
    } catch {
      return setFailure('Invalid "data": failed to parse JSON data payload');
    }
  }

  // 8. idempotencyKey / idempotencykey: if present, must be 64-character hex string
  const idempotency = candidate.idempotencyKey ?? candidate.idempotencykey;
  if (idempotency !== undefined && idempotency !== null) {
    if (typeof idempotency !== 'string' || !/^[a-f0-9]{64}$/i.test(idempotency)) {
      return setFailure('Invalid "idempotencyKey": must be a 64-character hex string');
    }
  }

  if (out && typeof out === 'object') {
    delete out.reason;
    out.errors = [];
  }
  validateCloudEvent.lastReason = null;
  validateCloudEvent.lastErrors = [];
  return true;
}

validateCloudEvent.lastReason = null;
validateCloudEvent.lastErrors = [];

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

  /** @type {import('../benchmark/health-tier-cache.js').HealthTierCache} */
  #healthTierCache;

  /**
   * @param {Object} [options]
   * @param {import('../core/types.js').RedisClientLike} [options.redisClient]
   * @param {string} [options.streamKey]
   * @param {string} [options.groupName]
   * @param {'maxlen' | 'minid'} [options.trimStrategy]
   * @param {number} [options.maxLen]
   * @param {string} [options.minId]
   * @param {boolean} [options.enabled]
   * @param {import('../benchmark/health-tier-cache.js').HealthTierCache} [options.healthTierCache]
   */
  constructor(options = {}) {
    this.#redisClient = options.redisClient || null;
    this.#streamKey = options.streamKey || 'stream:social:raw_posts';
    this.#groupName = options.groupName || process.env.NOWING_CONSUMER_GROUP || 'nowing_nlp_workers';
    this.#enabled = options.enabled !== undefined ? Boolean(options.enabled) : null;
    this.#healthTierCache = options.healthTierCache || defaultHealthTierCache;

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
   * Enriches payload with scraperId, benchmark_health, and benchmark_alert (Story 34.6 / AD-32).
   * @param {Partial<import('../core/types.js').ThinEvent> & Record<string, unknown>} item
   * @param {string} [scraperId]
   * @returns {Record<string, string>}
   */
  formatPayload(item, scraperId) {
    if (!item) return {};

    const id = String(item.id || (item.platform && (item.external_post_id || item.externalId) ? `${item.platform}:${item.external_post_id || item.externalId}` : ''));
    const platform = String(item.platform || '');
    const externalId = String(item.external_post_id || item.externalId || '');
    const category = String(item.category || 'social');
    const authorId = String(item.author_id || item.authorId || '');
    const authorName = String(item.author_name || item.authorName || '');
    const postUrl = String(item.post_url || item.url || '');
    const crawledAt = toIsoDate(/** @type {any} */ (item.crawled_at || item.crawledAt || item.time));
    const storageRef = String(item.storage_ref || item.storageRef || id);
    const contentSnippet = String(item.content_snippet || '');
    const targetId = String(item.target_id || '');
    const workspaceId = String(item.workspace_id || '');
    const schemaVersion = String(item.schema_version || '1');

    // CloudEvents v1.0 standard attributes
    const specversion = '1.0';
    const source = String(item.source || (platform ? `org.xactions.crawler.${platform}` : 'org.xactions.crawler'));
    const type = String(item.type || 'org.xactions.scrape.completed');
    const time = item.time ? toIsoDate(item.time) : crawledAt;
    const datacontenttype = String(item.datacontenttype || 'application/json');

    const idempotencyKey = String(item.idempotencyKey || item.idempotencykey || computeIdempotencyKey(item));

    let dataStr = '{}';
    try {
      if (typeof item.data === 'string') {
        try {
          JSON.parse(item.data);
          dataStr = item.data;
        } catch {
          dataStr = JSON.stringify({ raw: item.data });
        }
      } else if (item.data && typeof item.data === 'object') {
        dataStr = JSON.stringify(item.data);
      } else {
        dataStr = JSON.stringify(item);
      }
    } catch {
      dataStr = JSON.stringify({ id, platform, externalId });
    }

    const resolvedScraperId = scraperId || item.scraper_id || item.scraperId || (platform ? `${platform}-hybrid` : '');
    let healthTier = item.benchmark_health;
    if (!healthTier && resolvedScraperId) {
      healthTier = this.#healthTierCache.get(resolvedScraperId);
    }
    if (!healthTier) {
      healthTier = 'UNKNOWN';
    }

    let isAlert;
    if (item.benchmark_alert !== undefined && item.benchmark_alert !== null) {
      isAlert = String(item.benchmark_alert) === 'true';
    } else {
      isAlert = healthTier === 'C';
    }

    /** @type {Record<string, string>} */
    const payload = {
      // CloudEvents v1.0 Envelope attributes
      specversion,
      id,
      source,
      type,
      time,
      datacontenttype,
      data: dataStr,
      idempotencyKey,
      idempotencykey: idempotencyKey, // dual-emit lowercase extension

      // Canonical snake_case fields (backward compatibility)
      platform,
      external_post_id: externalId,
      category,
      author_id: authorId,
      author_name: authorName,
      post_url: postUrl,
      crawled_at: crawledAt,
      storage_ref: storageRef,
      content_snippet: contentSnippet,
      target_id: targetId,
      workspace_id: workspaceId,
      schema_version: schemaVersion,
      benchmark_health: String(healthTier),
      benchmark_alert: String(isAlert),

      // Dual-emit camelCase fields (backward compatibility)
      externalId,
      authorId,
      crawledAt,
      storageRef,
    };

    if (resolvedScraperId) {
      payload.scraper_id = String(resolvedScraperId);
      payload.scraperId = String(resolvedScraperId); // dual-emit camelCase
    }

    return payload;
  }

  /**
   * Publish a thin event pointer to the Redis stream.
   * Non-blocking and non-throwing: returns { ok: true, id } or { ok: false, error }
   *
   * @param {string | Record<string, unknown>} keyOrItem
   * @param {Record<string, unknown> | string} [maybeItemOrScraperId]
   * @param {Record<string, unknown> | string} [optsOrScraperId]
   * @returns {Promise<{ ok: boolean, id?: string, skipped?: boolean, error?: string }>}
   */
  async publish(keyOrItem, maybeItemOrScraperId, optsOrScraperId = {}) {
    const isEnabled = this.#enabled !== null ? this.#enabled : isEnvTruthy(process.env.REDIS_STREAM_ENABLED);
    if (!isEnabled) {
      return { ok: false, skipped: true };
    }

    /** @param {unknown} value */
    const extractScraperId = (value) => {
      if (typeof value === 'string') return value;
      const record = typeof value === 'object' && value !== null ? /** @type {Record<string, unknown>} */ (value) : null;
      return record && typeof record.scraperId === 'string' ? record.scraperId : null;
    };

    let streamKey = this.#streamKey;
    /** @type {Record<string, unknown> | undefined} */
    let item;
    let scraperId = null;

    if (typeof keyOrItem === 'string') {
      streamKey = keyOrItem;
      if (maybeItemOrScraperId && typeof maybeItemOrScraperId === 'object') {
        item = /** @type {Record<string, unknown>} */ (maybeItemOrScraperId);
        scraperId = extractScraperId(optsOrScraperId);
      }
    } else if (keyOrItem && typeof keyOrItem === 'object') {
      item = /** @type {Record<string, unknown>} */ (keyOrItem);
      scraperId = extractScraperId(maybeItemOrScraperId);
      if (!scraperId) {
        scraperId = extractScraperId(optsOrScraperId);
      }
    }

    if (!scraperId && item && typeof item.scraperId === 'string') {
      scraperId = item.scraperId;
    }

    if (!item) {
      return { ok: false, error: 'No payload provided to publish' };
    }

    const payload = this.formatPayload(item, scraperId || undefined);
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
