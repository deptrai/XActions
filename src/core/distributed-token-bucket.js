// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * DistributedTokenBucket — Redis-backed quota & token bucket with header parsing (Story 32.2).
 *
 * Provides atomic, synchronized rate limiting across multiple worker processes:
 * - Redis Lua script for atomic sliding window token refill & consumption.
 * - Automatic in-memory token bucket fallback when Redis is unavailable.
 * - HTTP RateLimit header parser for Twitter, GitHub, and RFC 6585 standards.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

/**
 * Lua script for atomic token bucket in Redis.
 * KEYS[1]: bucket key
 * ARGV[1]: requested tokens
 * ARGV[2]: capacity (burst limit)
 * ARGV[3]: refill rate (tokens per second)
 * ARGV[4]: current timestamp (milliseconds)
 * ARGV[5]: TTL in seconds
 *
 * Returns: [allowed (0 or 1), remaining_tokens, retry_after_ms]
 */
export const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local requested = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local refill_rate = tonumber(ARGV[3])
local now = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5])

local data = redis.call('HMGET', key, 'tokens', 'last_updated')
local tokens = tonumber(data[1])
local last_updated = tonumber(data[2])

if not tokens or not last_updated then
  tokens = capacity
  last_updated = now
else
  local delta_sec = math.max(0, (now - last_updated) / 1000.0)
  tokens = math.min(capacity, tokens + (delta_sec * refill_rate))
  last_updated = now
end

if tokens >= requested then
  tokens = tokens - requested
  redis.call('HMSET', key, 'tokens', tokens, 'last_updated', last_updated)
  redis.call('EXPIRE', key, ttl)
  return { 1, math.floor(tokens), 0 }
else
  local missing = requested - tokens
  local wait_ms = math.ceil((missing / refill_rate) * 1000)
  redis.call('HMSET', key, 'tokens', tokens, 'last_updated', last_updated)
  redis.call('EXPIRE', key, ttl)
  return { 0, math.floor(tokens), wait_ms }
end
`;

/**
 * Parse standard HTTP RateLimit headers.
 * Supports:
 * - x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset (Twitter, GitHub)
 * - ratelimit-limit, ratelimit-remaining, ratelimit-reset (RFC 6585 / IETF Draft)
 *
 * @param {Record<string, any> | Headers} headers
 * @returns {{
 *   limit: number | null,
 *   remaining: number | null,
 *   resetTimestamp: number | null,
 *   retryAfterMs: number | null
 * }}
 */
export function parseRateLimitHeaders(headers = {}) {
  if (!headers) {
    return { limit: null, remaining: null, resetTimestamp: null, retryAfterMs: null };
  }

  const getHeader = (...names) => {
    for (const name of names) {
      if (typeof headers.get === 'function') {
        const val = headers.get(name) || headers.get(name.toLowerCase());
        if (val != null) return val;
      } else {
        const lower = name.toLowerCase();
        for (const [k, v] of Object.entries(headers)) {
          if (k.toLowerCase() === lower && v != null) return String(v);
        }
      }
    }
    return null;
  };

  const rawLimit = getHeader('x-rate-limit-limit', 'x-ratelimit-limit', 'ratelimit-limit');
  const rawRemaining = getHeader('x-rate-limit-remaining', 'x-ratelimit-remaining', 'ratelimit-remaining');
  const rawReset = getHeader('x-rate-limit-reset', 'x-ratelimit-reset', 'ratelimit-reset');
  const rawRetryAfter = getHeader('retry-after');

  const limit = rawLimit != null ? Number(rawLimit) : null;
  const remaining = rawRemaining != null ? Number(rawRemaining) : null;
  let resetTimestamp = null;
  let retryAfterMs = null;

  if (rawReset != null) {
    const numReset = Number(rawReset);
    if (Number.isFinite(numReset)) {
      // Determine if it's epoch seconds (e.g. 1720000000) or delta seconds (e.g. 60)
      if (numReset > 1_000_000_000) {
        resetTimestamp = numReset * 1000;
      } else {
        resetTimestamp = Date.now() + numReset * 1000;
      }
      retryAfterMs = Math.max(0, resetTimestamp - Date.now());
    }
  }

  if (rawRetryAfter != null && retryAfterMs == null) {
    const numRetry = Number(rawRetryAfter);
    if (Number.isFinite(numRetry)) {
      retryAfterMs = numRetry * 1000;
      resetTimestamp = Date.now() + retryAfterMs;
    }
  }

  return {
    limit: Number.isFinite(limit) ? limit : null,
    remaining: Number.isFinite(remaining) ? remaining : null,
    resetTimestamp,
    retryAfterMs,
  };
}

/**
 * In-memory token bucket entry.
 * @typedef {Object} MemoryBucket
 * @property {number} tokens
 * @property {number} lastUpdated
 */

/**
 * Distributed Token Bucket manager.
 */
export class DistributedTokenBucket {
  /** @type {any} */
  #redisClient = null;

  /** @type {Map<string, MemoryBucket>} */
  #memoryBuckets = new Map();

  /**
   * @param {Object} [options={}]
   * @param {any} [options.redis] - Redis client instance
   */
  constructor(options = {}) {
    this.#redisClient = options.redis || null;
  }

  /** @type {Promise<any> | null} */
  #connecting = null;

  /**
   * Lazily connect to Redis from REDIS_URL / REDIS_HOST when REDIS_TOKEN_BUCKET=1
   * and no client was injected (Story 32 fix — makes the flag actually engage a
   * shared backend instead of staying on the in-memory fallback forever).
   * Safe to call repeatedly; concurrent callers share one connect promise.
   * @returns {Promise<any | null>}
   */
  async ensureClient() {
    if (this.#redisClient) return this.#redisClient;
    if (this.#connecting) return this.#connecting;
    this.#connecting = (async () => {
      try {
        const { createClient } = await import('redis');
        const url = process.env.REDIS_URL ||
          (process.env.REDIS_HOST
            ? `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}`
            : 'redis://localhost:6379');
        const client = createClient({ url });
        client.on('error', (err) => {
          console.warn('[DistributedTokenBucket] Redis client error:', (err instanceof Error ? err.message : String(err)));
        });
        await client.connect();
        this.#redisClient = client;
        return client;
      } catch (err) {
        console.warn('[DistributedTokenBucket] Failed to connect to Redis (using in-memory):', (err instanceof Error ? err.message : String(err)));
        return null;
      } finally {
        this.#connecting = null;
      }
    })();
    return this.#connecting;
  }

  /**
   * Underlying Redis client instance if configured.
   * @returns {any}
   */
  get redis() {
    return this.#redisClient;
  }

  /**
   * Underlying Redis client instance alias if configured.
   * @returns {any}
   */
  get redisClient() {
    return this.#redisClient;
  }

  /**
   * Check and consume tokens atomically.
   *
   * @param {string} key - Bucket key (e.g., 'consumer:chainlens', 'account:twitter:123')
   * @param {number} [tokens=1] - Number of tokens to consume
   * @param {Object} [options={}]
   * @param {number} [options.capacity=60] - Maximum capacity (burst)
   * @param {number} [options.refillRate=1.0] - Tokens refilled per second
   * @param {number} [options.ttlSeconds=3600] - Redis key TTL
   * @returns {Promise<{ allowed: boolean, remaining: number, retryAfterMs: number }>}
   */
  async consume(key, tokens = 1, options = {}) {
    const capacity = Number(options.capacity) || 60;
    const refillRate = Number(options.refillRate) || (capacity / 60); // Default refill to capacity per minute
    const requested = Math.max(1, Number(tokens) || 1);
    const ttlSeconds = Number(options.ttlSeconds) || 3600;
    const now = Date.now();

    // Lazily connect to Redis when the distributed flag is on and no client was
    // injected (Story 32 fix — engages the shared backend on first use).
    if (!this.#redisClient && process.env.REDIS_TOKEN_BUCKET === '1') {
      await this.ensureClient();
    }

    // 1. Try Redis Lua script if available
    if (this.#redisClient && typeof this.#redisClient.eval === 'function') {
      try {
        const redisKey = `xact:tokenbucket:${key}`;
        const res = await this.#redisClient.eval(
          TOKEN_BUCKET_LUA,
          1,
          redisKey,
          requested,
          capacity,
          refillRate,
          now,
          ttlSeconds
        );

        if (Array.isArray(res)) {
          return {
            allowed: Boolean(res[0]),
            remaining: Number(res[1]) || 0,
            retryAfterMs: Number(res[2]) || 0,
          };
        }
      } catch (err) {
        console.warn(`[DistributedTokenBucket] Redis eval failed, falling back to memory:`, err.message);
      }
    }

    // 2. In-Memory fallback
    let bucket = this.#memoryBuckets.get(key);
    if (!bucket) {
      bucket = { tokens: capacity, lastUpdated: now };
      this.#memoryBuckets.set(key, bucket);
    } else {
      const deltaSec = Math.max(0, (now - bucket.lastUpdated) / 1000);
      bucket.tokens = Math.min(capacity, bucket.tokens + deltaSec * refillRate);
      bucket.lastUpdated = now;
    }

    if (bucket.tokens >= requested) {
      bucket.tokens -= requested;
      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        retryAfterMs: 0,
      };
    }

    const missing = requested - bucket.tokens;
    const waitMs = Math.ceil((missing / refillRate) * 1000);
    return {
      allowed: false,
      remaining: Math.floor(bucket.tokens),
      retryAfterMs: waitMs,
    };
  }

  /**
   * Check if tokens can be consumed without actually consuming them.
   *
   * NOTE (Story 32 fix): this only inspects the in-memory bucket — it does not
   * call Redis — so it is safe to expose a synchronous twin for callers that
   * cannot await. `canConsumeSync` returns the same answer without a Promise.
   *
   * @param {string} key
   * @param {number} [tokens=1]
   * @param {Object} [options={}]
   * @returns {Promise<boolean>}
   */
  async canConsume(key, tokens = 1, options = {}) {
    return this.canConsumeSync(key, tokens, options);
  }

  /**
   * Synchronous twin of {@link canConsume}. Reads the in-memory bucket only;
   * a bucket that exists only in Redis (not yet synced via consume/syncFromHeaders)
   * reports as having capacity. Story 32 fix — prevents the async/sync mismatch
   * that made callers treat a Promise (always truthy) as "allowed" (fail-open).
   *
   * @param {string} key
   * @param {number} [tokens=1]
   * @param {Object} [options={}]
   * @returns {boolean}
   */
  canConsumeSync(key, tokens = 1, options = {}) {
    const capacity = Number(options.capacity) || 60;
    const refillRate = Number(options.refillRate) || (capacity / 60);
    const requested = Math.max(1, Number(tokens) || 1);
    const now = Date.now();

    let bucket = this.#memoryBuckets.get(key);
    if (!bucket) return true;

    const deltaSec = Math.max(0, (now - bucket.lastUpdated) / 1000);
    const currentTokens = Math.min(capacity, bucket.tokens + deltaSec * refillRate);
    return currentTokens >= requested;
  }

  /**
   * Sync bucket state directly from parsed HTTP response headers.
   *
   * @param {string} key
   * @param {Record<string, any> | Headers} headers
   */
  syncFromHeaders(key, headers) {
    const parsed = parseRateLimitHeaders(headers);
    if (parsed.remaining != null) {
      const now = Date.now();
      const bucket = this.#memoryBuckets.get(key) || { tokens: parsed.remaining, lastUpdated: now };
      bucket.tokens = parsed.remaining;
      bucket.lastUpdated = now;
      this.#memoryBuckets.set(key, bucket);
    }
  }

  /**
   * Reset or delete a bucket key.
   * @param {string} key
   */
  reset(key) {
    this.#memoryBuckets.delete(key);
    if (this.#redisClient && typeof this.#redisClient.del === 'function') {
      this.#redisClient.del(`xact:tokenbucket:${key}`).catch(() => {});
    }
  }
}

export const globalDistributedTokenBucket = new DistributedTokenBucket();
