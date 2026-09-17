// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for RedisStreamPublisher (Story 14.3)
 * @author nich (@nichxbt)
 * @license MIT
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { RedisStreamPublisher, computeIdempotencyKey, validateCloudEvent } from '../../src/utils/redis-stream-publisher.js';

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

  it('formats thin event to string-valued record correctly for XADD with CloudEvents v1.0 attributes', () => {
    const publisher = new RedisStreamPublisher();
    const formatted = publisher.formatPayload(sampleEvent);
    const expectedIdempotencyKey = computeIdempotencyKey(sampleEvent);

    expect(formatted).toEqual({
      // CloudEvents v1.0 Envelope attributes
      specversion: '1.0',
      id: 'facebook:123456789',
      source: 'org.xactions.crawler.facebook',
      type: 'org.xactions.scrape.completed',
      time: '2026-08-28T00:00:00.000Z',
      datacontenttype: 'application/json',
      data: JSON.stringify(sampleEvent),
      idempotencyKey: expectedIdempotencyKey,
      idempotencykey: expectedIdempotencyKey,

      // Canonical snake_case flat fields
      platform: 'facebook',
      external_post_id: '123456789',
      category: 'social',
      author_id: 'user_999',
      author_name: '',
      post_url: '',
      crawled_at: '2026-08-28T00:00:00.000Z',
      storage_ref: 'facebook:123456789',
      content_snippet: '',
      target_id: '',
      workspace_id: '',
      schema_version: '1',
      benchmark_health: 'UNKNOWN',
      benchmark_alert: 'false',
      scraper_id: 'facebook-hybrid',

      // Dual-emit legacy camelCase flat fields
      externalId: '123456789',
      authorId: 'user_999',
      crawledAt: '2026-08-28T00:00:00.000Z',
      storageRef: 'facebook:123456789',
      scraperId: 'facebook-hybrid',
    });

    // Ensure all values are strings
    for (const val of Object.values(formatted)) {
      expect(typeof val).toBe('string');
    }

    // Ensure CloudEvents validation passes on formatted record
    expect(validateCloudEvent(formatted)).toBe(true);
  });

  describe('CloudEvents & Idempotency Key Utilities', () => {
    it('computes deterministic SHA-256 idempotency key using default hourly bucket', () => {
      const itemA = {
        platform: 'facebook',
        externalId: 'post-100',
        crawledAt: '2026-09-17T14:15:30.000Z',
      };
      const itemB = {
        platform: 'facebook',
        externalId: 'post-100',
        crawledAt: '2026-09-17T14:59:59.999Z',
      };
      const keyA = computeIdempotencyKey(itemA);
      const keyB = computeIdempotencyKey(itemB);

      expect(keyA).toBe(keyB);
      expect(keyA).toMatch(/^[a-f0-9]{64}$/);
    });

    it('produces different idempotency key across different hour buckets', () => {
      const item1 = {
        platform: 'facebook',
        externalId: 'post-100',
        crawledAt: '2026-09-17T14:15:00.000Z',
      };
      const item2 = {
        platform: 'facebook',
        externalId: 'post-100',
        crawledAt: '2026-09-17T15:15:00.000Z',
      };
      expect(computeIdempotencyKey(item1)).not.toBe(computeIdempotencyKey(item2));
    });

    it('incorporates custom timestamp_bucket when provided', () => {
      const itemCustom1 = {
        platform: 'facebook',
        externalId: 'post-100',
        timestamp_bucket: '2026-09-17',
      };
      const itemCustom2 = {
        platform: 'facebook',
        externalId: 'post-100',
        timestampBucket: '2026-09-17',
      };
      expect(computeIdempotencyKey(itemCustom1)).toBe(computeIdempotencyKey(itemCustom2));
    });

    it('falls back to item id when externalId is missing', () => {
      const itemWithoutExt = {
        platform: 'facebook',
        id: 'fallback-id-123',
        crawledAt: '2026-09-17T10:00:00.000Z',
      };
      const key = computeIdempotencyKey(itemWithoutExt);
      expect(key).toMatch(/^[a-f0-9]{64}$/);
    });

    it('returns empty string for invalid item input in computeIdempotencyKey', () => {
      expect(computeIdempotencyKey(null)).toBe('');
      expect(computeIdempotencyKey(undefined)).toBe('');
      expect(computeIdempotencyKey('string')).toBe('');
    });

    it('validates compliant CloudEvents v1.0 records', () => {
      const validEvent = {
        specversion: '1.0',
        id: 'facebook:post-1',
        source: 'org.xactions.crawler.facebook',
        type: 'org.xactions.scrape.completed',
        time: new Date().toISOString(),
        datacontenttype: 'application/json',
        data: '{"message":"hello"}',
        idempotencyKey: 'a'.repeat(64),
      };
      expect(validateCloudEvent(validEvent)).toBe(true);
    });

    it('rejects events missing mandatory CloudEvents attributes with descriptive reasons', () => {
      const out = {};

      expect(validateCloudEvent(null, out)).toBe(false);
      expect(out.reason).toContain('Event must be a non-null object');

      expect(validateCloudEvent({ specversion: '0.3' }, out)).toBe(false);
      expect(out.reason).toContain('Missing or invalid "specversion"');

      expect(validateCloudEvent({ specversion: '1.0', id: '' }, out)).toBe(false);
      expect(out.reason).toContain('Missing or invalid "id"');

      expect(validateCloudEvent({ specversion: '1.0', id: '1', source: '' }, out)).toBe(false);
      expect(out.reason).toContain('Missing or invalid "source"');

      expect(validateCloudEvent({ specversion: '1.0', id: '1', source: 'org.xactions', type: '' }, out)).toBe(false);
      expect(out.reason).toContain('Missing or invalid "type"');

      expect(validateCloudEvent({ specversion: '1.0', id: '1', source: 'org.xactions', type: 't', time: 'invalid' }, out)).toBe(false);
      expect(out.reason).toContain('Invalid "time" timestamp');

      expect(validateCloudEvent({ specversion: '1.0', id: '1', source: 'org.xactions', type: 't', time: new Date().toISOString() }, out)).toBe(false);
      expect(out.reason).toContain('Missing "datacontenttype"');

      expect(validateCloudEvent({ specversion: '1.0', id: '1', source: 'org.xactions', type: 't', time: new Date().toISOString(), datacontenttype: 'application/json' }, out)).toBe(false);
      expect(out.reason).toContain('Missing "data"');

      expect(validateCloudEvent({
        specversion: '1.0',
        id: '1',
        source: 'org.xactions',
        type: 't',
        time: new Date().toISOString(),
        datacontenttype: 'application/json',
        data: 'invalid json{',
      }, out)).toBe(false);
      expect(out.reason).toContain('Invalid "data": failed to parse JSON data payload');

      expect(validateCloudEvent({
        specversion: '1.0',
        id: '1',
        source: 'org.xactions',
        type: 't',
        time: new Date().toISOString(),
        datacontenttype: 'application/json',
        data: '{}',
        idempotencyKey: 'short-key',
      }, out)).toBe(false);
      expect(out.reason).toContain('Invalid "idempotencyKey": must be a 64-character hex string');
    });
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
