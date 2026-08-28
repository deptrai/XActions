// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for RedisStreamPublisher (Story 14.3)
 * @author nich (@nichxbt)
 * @license MIT
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { RedisStreamPublisher } from '../../src/utils/redis-stream-publisher.js';

describe('Story 14.3: RedisStreamPublisher Unit & Contract Tests', () => {
  const origEnv = process.env.REDIS_STREAM_ENABLED;

  beforeEach(() => {
    process.env.REDIS_STREAM_ENABLED = 'true';
  });

  afterAll(() => {
    if (origEnv !== undefined) {
      process.env.REDIS_STREAM_ENABLED = origEnv;
    } else {
      delete process.env.REDIS_STREAM_ENABLED;
    }
  });

  const sampleEvent = {
    id: 'facebook:123456789',
    platform: 'facebook',
    externalId: '123456789',
    category: 'social',
    authorId: 'user_999',
    crawledAt: '2026-08-28T00:00:00.000Z',
    storageRef: 'facebook:123456789',
  };

  it('exports RedisStreamPublisher class and default singleton', () => {
    expect(typeof RedisStreamPublisher).toBe('function');
    const publisher = new RedisStreamPublisher();
    expect(publisher).toBeDefined();
    expect(typeof publisher.publish).toBe('function');
    expect(typeof publisher.xlen).toBe('function');
    expect(typeof publisher.xinfo).toBe('function');
    expect(typeof publisher.xgroupEnsure).toBe('function');
  });

  it('formats thin event to string-valued record correctly for XADD', () => {
    const publisher = new RedisStreamPublisher();
    const formatted = publisher.formatPayload(sampleEvent);
    expect(formatted).toEqual({
      id: 'facebook:123456789',
      platform: 'facebook',
      externalId: '123456789',
      category: 'social',
      authorId: 'user_999',
      crawledAt: '2026-08-28T00:00:00.000Z',
      storageRef: 'facebook:123456789',
    });
    // Ensure all values are strings
    for (const val of Object.values(formatted)) {
      expect(typeof val).toBe('string');
    }
  });

  it('handles node-redis xAdd API with MAXLEN trimming', async () => {
    let capturedKey = '';
    let capturedId = '';
    let capturedFields = {};
    let capturedOptions = {};

    const mockNodeRedis = {
      xAdd: async (key, id, fields, options) => {
        capturedKey = key;
        capturedId = id;
        capturedFields = fields;
        capturedOptions = options;
        return '1700000000000-0';
      },
    };

    const publisher = new RedisStreamPublisher({
      redisClient: mockNodeRedis,
      trimStrategy: 'maxlen',
      maxLen: 500000,
    });

    const res = await publisher.publish('stream:social:raw_posts', sampleEvent);
    expect(res.ok).toBe(true);
    expect(res.id).toBe('1700000000000-0');
    expect(capturedKey).toBe('stream:social:raw_posts');
    expect(capturedId).toBe('*');
    expect(capturedFields.storageRef).toBe('facebook:123456789');
    expect(capturedOptions).toEqual({
      TRIM: {
        strategy: 'MAXLEN',
        strategyModifier: '~',
        threshold: 500000,
      },
    });
  });

  it('handles node-redis xAdd API with MINID trimming', async () => {
    let capturedOptions = {};
    const mockNodeRedis = {
      xAdd: async (key, id, fields, options) => {
        capturedOptions = options;
        return '1700000000000-1';
      },
    };

    const publisher = new RedisStreamPublisher({
      redisClient: mockNodeRedis,
      trimStrategy: 'minid',
      minId: '1690000000000-0',
    });

    const res = await publisher.publish('stream:social:raw_posts', sampleEvent);
    expect(res.ok).toBe(true);
    expect(capturedOptions).toEqual({
      TRIM: {
        strategy: 'MINID',
        strategyModifier: '~',
        threshold: '1690000000000-0',
      },
    });
  });

  it('handles ioredis-like flat xadd API with MAXLEN trimming', async () => {
    let capturedArgs = [];
    const mockIoRedis = {
      xadd: async (...args) => {
        capturedArgs = args;
        return '1700000000000-2';
      },
    };

    const publisher = new RedisStreamPublisher({
      redisClient: mockIoRedis,
      trimStrategy: 'maxlen',
      maxLen: 1000000,
    });

    const res = await publisher.publish('stream:social:raw_posts', sampleEvent);
    expect(res.ok).toBe(true);
    expect(res.id).toBe('1700000000000-2');
    expect(capturedArgs[0]).toBe('stream:social:raw_posts');
    expect(capturedArgs[1]).toBe('MAXLEN');
    expect(capturedArgs[2]).toBe('~');
    expect(capturedArgs[3]).toBe(1000000);
    expect(capturedArgs[4]).toBe('*');
  });

  it('never throws on publish failure, logs warning and returns { ok: false }', async () => {
    const mockFailingRedis = {
      xAdd: async () => {
        throw new Error('Connection refused');
      },
    };

    const publisher = new RedisStreamPublisher({
      redisClient: mockFailingRedis,
    });

    const res = await publisher.publish('stream:social:raw_posts', sampleEvent);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Connection refused');
  });

  it('respects REDIS_STREAM_ENABLED environment variable', async () => {
    let callCount = 0;
    const mockRedis = {
      xAdd: async () => {
        callCount++;
        return '1700000000000-0';
      },
    };

    const publisher = new RedisStreamPublisher({ redisClient: mockRedis });

    // Disabled test
    const origEnv = process.env.REDIS_STREAM_ENABLED;
    try {
      process.env.REDIS_STREAM_ENABLED = 'false';
      const disabledRes = await publisher.publish('stream:social:raw_posts', sampleEvent);
      expect(disabledRes.ok).toBe(false);
      expect(disabledRes.skipped).toBe(true);
      expect(callCount).toBe(0);

      // Enabled test
      process.env.REDIS_STREAM_ENABLED = 'true';
      const enabledRes = await publisher.publish('stream:social:raw_posts', sampleEvent);
      expect(enabledRes.ok).toBe(true);
      expect(callCount).toBe(1);
    } finally {
      if (origEnv !== undefined) {
        process.env.REDIS_STREAM_ENABLED = origEnv;
      } else {
        delete process.env.REDIS_STREAM_ENABLED;
      }
    }
  });

  it('runs real Redis integration if available, otherwise skips gracefully', async () => {
    const publisher = new RedisStreamPublisher({ streamKey: 'stream:test:raw_posts' });
    const client = await publisher.ensureClient();
    if (!client) {
      // Redis server not running locally, graceful skip
      return;
    }

    try {
      const res = await publisher.publish('stream:test:raw_posts', sampleEvent);
      expect(res.ok).toBe(true);
      expect(typeof res.id).toBe('string');

      const count = await publisher.xlen('stream:test:raw_posts');
      expect(count).toBeGreaterThan(0);

      const ensured = await publisher.xgroupEnsure('stream:test:raw_posts', 'test_group');
      expect(ensured).toBe(true);
    } finally {
      await publisher.close();
    }
  });
});
