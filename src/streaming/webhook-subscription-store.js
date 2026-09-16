// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * WebhookSubscriptionStore — Redis-backed subscription store for outbound webhooks.
 * Persists subscriptions to Redis hash `xactions:webhook:subscriptions`.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import crypto from 'crypto';

export const WEBHOOK_SUBSCRIPTIONS_KEY = 'xactions:webhook:subscriptions';

/**
 * Validate that a URL is a well-formed HTTP/HTTPS URL string.
 * @param {string} urlString
 * @returns {boolean}
 */
export function isValidWebhookUrl(urlString) {
  if (typeof urlString !== 'string' || !urlString.trim()) {
    return false;
  }
  try {
    const parsed = new URL(urlString.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const host = (parsed.hostname || '').toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '0.0.0.0' ||
      host === '169.254.169.254' ||
      host.endsWith('.local') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
    ) {
      // Allow loopback only in non-production (tests, local dev)
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
        return process.env.NODE_ENV !== 'production';
      }
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalize events array.
 * @param {unknown} events
 * @returns {string[]}
 */
export function normalizeEvents(events) {
  if (typeof events === 'string') {
    const trimmed = events.trim().toLowerCase();
    return trimmed ? [trimmed] : ['*'];
  }
  if (!Array.isArray(events) || events.length === 0) {
    return [];
  }
  return events
    .filter((e) => typeof e === 'string' && e.trim().length > 0)
    .map((e) => (e.trim() === '*' ? '*' : e.trim().toLowerCase()));
}

export class WebhookSubscriptionStore {
  /** @type {import('../core/types.js').RedisClientLike | null} */
  #redisClient = null;

  /** @type {string} */
  #hashKey;

  /** @type {boolean} */
  #isOwnedClient = false;

  /** @type {Map<string, Record<string, unknown>>} In-memory fallback */
  #memoryFallback = new Map();

  /**
   * @param {Object} [options]
   * @param {import('../core/types.js').RedisClientLike} [options.redisClient]
   * @param {string} [options.hashKey]
   */
  constructor(options = {}) {
    this.#redisClient = options.redisClient || null;
    this.#hashKey = options.hashKey || WEBHOOK_SUBSCRIPTIONS_KEY;
  }

  get hashKey() {
    return this.#hashKey;
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
        console.warn('[WebhookSubscriptionStore] Redis client error:', err instanceof Error ? err.message : String(err));
      });
      await client.connect();
      this.#redisClient = /** @type {import('../core/types.js').RedisClientLike} */ (client);
      this.#isOwnedClient = true;
      return this.#redisClient;
    } catch {
      // Redis unavailable — fallback to memory
      return null;
    }
  }

  /**
   * Sets or replaces the active Redis client.
   * @param {import('../core/types.js').RedisClientLike | null} client
   */
  setClient(client) {
    this.#redisClient = client;
  }

  /**
   * Register a new webhook subscription.
   *
   * @param {Object} data
   * @param {string} data.url
   * @param {string[] | string} data.events
   * @param {string} [data.secret]
   * @param {boolean} [data.active=true]
   * @param {string} [data.description]
   * @returns {Promise<Record<string, unknown>>}
   */
  async create(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Subscription data must be an object');
    }

    if (!isValidWebhookUrl(data.url)) {
      throw new Error('Invalid webhook URL: must be a valid http or https URL');
    }

    const events = normalizeEvents(data.events);
    if (events.length === 0) {
      throw new Error('events must be a non-empty array of platform names or ["*"]');
    }

    const id = `sub_${crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 16) : Math.random().toString(36).slice(2, 12)}`;
    const now = new Date().toISOString();

    const subscription = {
      id,
      url: data.url.trim(),
      events,
      secret: typeof data.secret === 'string' ? data.secret : '',
      active: data.active !== undefined ? Boolean(data.active) : true,
      description: typeof data.description === 'string' ? data.description.trim() : '',
      createdAt: now,
      updatedAt: now,
    };

    const client = await this.ensureClient();
    if (client) {
      try {
        const json = JSON.stringify(subscription);
        if (typeof client.hSet === 'function') {
          await client.hSet(this.#hashKey, id, json);
        } else if (typeof client.hset === 'function') {
          await client.hset(this.#hashKey, id, json);
        }
      } catch (err) {
        console.warn('[WebhookSubscriptionStore] Redis HSET error, using in-memory store:', err instanceof Error ? err.message : String(err));
        this.#memoryFallback.set(id, subscription);
      }
    } else {
      this.#memoryFallback.set(id, subscription);
    }

    return subscription;
  }

  /**
   * Get subscription by ID.
   *
   * @param {string} id
   * @returns {Promise<Record<string, unknown> | null>}
   */
  async get(id) {
    if (!id || typeof id !== 'string') return null;

    const client = await this.ensureClient();
    if (client) {
      try {
        let raw = null;
        if (typeof client.hGet === 'function') {
          raw = await client.hGet(this.#hashKey, id);
        } else if (typeof client.hget === 'function') {
          raw = await client.hget(this.#hashKey, id);
        }
        if (raw) {
          return JSON.parse(raw);
        }
      } catch (err) {
        console.warn('[WebhookSubscriptionStore] Redis HGET error:', err instanceof Error ? err.message : String(err));
      }
    }

    return this.#memoryFallback.get(id) || null;
  }

  /**
   * List all subscriptions, optionally filtered by active status.
   *
   * @param {Object} [filter]
   * @param {boolean} [filter.active]
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  async list(filter = {}) {
    const results = [];
    const client = await this.ensureClient();

    if (client) {
      try {
        let rawMap = null;
        if (typeof client.hGetAll === 'function') {
          rawMap = await client.hGetAll(this.#hashKey);
        } else if (typeof client.hgetall === 'function') {
          rawMap = await client.hgetall(this.#hashKey);
        }

        if (rawMap && typeof rawMap === 'object') {
          for (const raw of Object.values(rawMap)) {
            try {
              if (raw && typeof raw === 'string') {
                results.push(JSON.parse(raw));
              }
            } catch {
              // Ignore malformed JSON
            }
          }
        }
      } catch (err) {
        console.warn('[WebhookSubscriptionStore] Redis HGETALL error:', err instanceof Error ? err.message : String(err));
      }
    }

    // Include any in-memory fallback entries
    for (const [id, sub] of this.#memoryFallback.entries()) {
      if (!results.some((r) => r.id === id)) {
        results.push(sub);
      }
    }

    // Apply active filter if requested
    let filtered = results;
    if (filter.active !== undefined) {
      const activeBool = Boolean(filter.active);
      filtered = filtered.filter((s) => Boolean(s.active) === activeBool);
    }

    // Sort descending by createdAt
    filtered.sort((a, b) => {
      const timeA = new Date(String(a.createdAt || 0)).getTime();
      const timeB = new Date(String(b.createdAt || 0)).getTime();
      return timeB - timeA;
    });

    return filtered;
  }

  /**
   * Update a subscription by ID.
   *
   * @param {string} id
   * @param {Record<string, any>} updates
   * @returns {Promise<Record<string, unknown> | null>}
   */
  async update(id, updates) {
    if (!id || typeof id !== 'string') return null;
    if (!updates || typeof updates !== 'object') return null;

    const existing = await this.get(id);
    if (!existing) {
      return null;
    }

    if (updates.url !== undefined) {
      if (!isValidWebhookUrl(updates.url)) {
        throw new Error('Invalid webhook URL: must be a valid http or https URL');
      }
      existing.url = updates.url.trim();
    }

    if (updates.events !== undefined) {
      const events = normalizeEvents(updates.events);
      if (events.length === 0) {
        throw new Error('events must be a non-empty array of platform names or ["*"]');
      }
      existing.events = events;
    }

    if (updates.active !== undefined) {
      existing.active = Boolean(updates.active);
    }

    if (updates.secret !== undefined) {
      existing.secret = String(updates.secret);
    }

    if (updates.description !== undefined) {
      existing.description = String(updates.description).trim();
    }

    existing.updatedAt = new Date().toISOString();

    const client = await this.ensureClient();
    if (client) {
      try {
        const json = JSON.stringify(existing);
        if (typeof client.hSet === 'function') {
          await client.hSet(this.#hashKey, id, json);
        } else if (typeof client.hset === 'function') {
          await client.hset(this.#hashKey, id, json);
        }
      } catch (err) {
        console.warn('[WebhookSubscriptionStore] Redis HSET update error:', err instanceof Error ? err.message : String(err));
        this.#memoryFallback.set(id, existing);
      }
    } else {
      this.#memoryFallback.set(id, existing);
    }

    return existing;
  }

  /**
   * Delete subscription by ID.
   *
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async delete(id) {
    if (!id || typeof id !== 'string') return false;

    const existing = await this.get(id);
    if (!existing) {
      return false;
    }

    let deleted = false;
    const client = await this.ensureClient();
    if (client) {
      try {
        let count = 0;
        if (typeof client.hDel === 'function') {
          count = await client.hDel(this.#hashKey, id);
        } else if (typeof client.hdel === 'function') {
          count = await client.hdel(this.#hashKey, id);
        }
        deleted = Number(count) > 0;
      } catch (err) {
        console.warn('[WebhookSubscriptionStore] Redis HDEL error:', err instanceof Error ? err.message : String(err));
      }
    }

    if (this.#memoryFallback.has(id)) {
      this.#memoryFallback.delete(id);
      deleted = true;
    }

    return deleted;
  }

  /**
   * Find active subscriptions matching the given platform event.
   *
   * @param {string} platform
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  async matchSubscriptions(platform) {
    const active = await this.list({ active: true });
    const normalizedPlatform = (platform || '').trim().toLowerCase();

    return active.filter((sub) => {
      const events = Array.isArray(sub.events) ? sub.events : [];
      return events.includes('*') || (normalizedPlatform && events.includes(normalizedPlatform));
    });
  }

  /**
   * Find all active subscriptions matching a given event platform.
   * Alias for matchSubscriptions.
   *
   * @param {string} platform
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  async findMatchingSubscriptions(platform) {
    return this.matchSubscriptions(platform);
  }

  /**
   * Close client if owned.
   */
  async close() {
    if (this.#isOwnedClient && this.#redisClient && typeof this.#redisClient.quit === 'function') {
      try {
        await this.#redisClient.quit();
      } catch {
        // Safe ignore
      } finally {
        this.#redisClient = null;
      }
    }
  }
}

export const defaultWebhookSubscriptionStore = new WebhookSubscriptionStore();
