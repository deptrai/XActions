// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Singleton Default Store configured with Prisma and Redis stream publisher.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { PrismaStore } from './prisma-store.js';
import { defaultRedisStreamPublisher } from '../utils/redis-stream-publisher.js';

class StoreWithRedis extends PrismaStore {
  /** @type {import('../utils/redis-stream-publisher.js').RedisStreamPublisher} */
  publisher;

  /** @type {import('../core/types.js').RedisClientLike | null} */
  #redisClient = null;

  /**
   * @param {Object} [options]
   * @param {import('../utils/redis-stream-publisher.js').RedisStreamPublisher} [options.publisher]
   * @param {import('../core/types.js').RedisClientLike} [options.redisClient]
   * @param {import('../core/types.js').RedisClientLike} [options.redis]
   * @param {import('@prisma/client').PrismaClient} [options.prisma]
   * @param {number} [options.chunkSize]
   * @param {boolean} [options.validateSchema]
   */
  constructor(options = {}) {
    super(options);
    this.publisher = options.publisher || defaultRedisStreamPublisher;
    this.#redisClient = options.redisClient || options.redis || null;
  }

  /**
   * Lazy accessor for redis client from publisher
   * @returns {import('../core/types.js').RedisClientLike | null}
   */
  get redis() {
    return this.#redisClient;
  }

  set redis(client) {
    this.#redisClient = client;
    if (this.publisher && typeof this.publisher.setClient === 'function') {
      this.publisher.setClient(client);
    }
  }
}

/** @type {StoreWithRedis} */
export const defaultStore = new StoreWithRedis();

export { StoreWithRedis };
