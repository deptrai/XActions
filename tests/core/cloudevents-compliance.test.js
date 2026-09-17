// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 38.2: CloudEvents v1.0 Compliance & Outbound Schema Standardization
 * Contract test suite verifying CloudEvents v1.0 compliance, deterministic idempotency keys,
 * dual-emit flat fields for CDC consumers, and end-to-end emission from AbstractCrawler.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AbstractCrawler } from '../../src/core/base-crawler.js';
import {
  RedisStreamPublisher,
  computeIdempotencyKey,
  validateCloudEvent,
} from '../../src/utils/redis-stream-publisher.js';
import { globalActionRegistry } from '../../src/core/action-registry.js';

class FakeRedisClient {
  constructor() {
    this.calls = [];
  }
  async xAdd(key, id, fields, options) {
    this.calls.push({ key, id, fields, options });
    return '1700000000000-0';
  }
  async xadd(key, ...args) {
    this.calls.push({ key, args });
    return '1700000000000-0';
  }
}

class MultiPlatformCrawler extends AbstractCrawler {
  constructor(platformName, deps = {}) {
    super(deps);
    this.name = platformName;
    this.category = 'social';

    this.registerAction('scrape_posts', async (args, session) => {
      return {
        posts: [
          {
            id: `${platformName}:p-1`,
            externalId: 'p-1',
            text: `Post 1 on ${platformName}`,
            authorId: 'author-1',
            authorName: 'Author One',
            url: `https://${platformName}.com/post/1`,
            crawledAt: '2026-09-17T14:20:00.000Z',
          },
          {
            id: `${platformName}:p-2`,
            externalId: 'p-2',
            text: `Post 2 on ${platformName}`,
            authorId: 'author-2',
            authorName: 'Author Two',
            url: `https://${platformName}.com/post/2`,
            crawledAt: '2026-09-17T14:45:00.000Z',
          },
        ],
      };
    }, { action: 'scrape_posts', description: `Scrape posts from ${platformName}` });
  }
}

describe('Story 38.2: CloudEvents v1.0 Compliance & Outbound Schema Standardization', () => {
  let fakeClient;
  let publisher;
  const originalEnv = process.env.REDIS_STREAM_ENABLED;

  beforeEach(() => {
    globalActionRegistry.clear();
    process.env.REDIS_STREAM_ENABLED = 'true';
    fakeClient = new FakeRedisClient();
    publisher = new RedisStreamPublisher({ redisClient: fakeClient, enabled: true });
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.REDIS_STREAM_ENABLED;
    } else {
      process.env.REDIS_STREAM_ENABLED = originalEnv;
    }
  });

  describe('CloudEvents v1.0 Envelope Compliance in RedisStreamPublisher.formatPayload()', () => {
    it('formats ThinEvent with all mandatory CloudEvents v1.0 attributes', () => {
      const thinEvent = {
        id: 'facebook:12345',
        platform: 'facebook',
        externalId: '12345',
        category: 'social',
        authorId: 'user-77',
        authorName: 'Test User',
        crawledAt: '2026-09-17T12:00:00.000Z',
        storageRef: 'facebook:12345',
        content_snippet: 'Hello from CloudEvents',
        workspace_id: 'ws-42',
      };

      const record = publisher.formatPayload(thinEvent);

      // CloudEvents v1.0 mandatory attributes
      expect(record.specversion).toBe('1.0');
      expect(record.id).toBe('facebook:12345');
      expect(record.source).toBe('org.xactions.crawler.facebook');
      expect(record.type).toBe('org.xactions.scrape.completed');
      expect(record.time).toBe('2026-09-17T12:00:00.000Z');
      expect(record.datacontenttype).toBe('application/json');
      expect(typeof record.data).toBe('string');
      expect(JSON.parse(record.data)).toHaveProperty('id', 'facebook:12345');

      // Idempotency key
      expect(record.idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
      expect(record.idempotencykey).toBe(record.idempotencyKey);

      // Strict validation passes
      expect(validateCloudEvent(record)).toBe(true);
    });

    it('returns empty record for falsy input', () => {
      expect(publisher.formatPayload(null)).toEqual({});
      expect(publisher.formatPayload(undefined)).toEqual({});
    });

    it('ensures all Redis Stream XADD record values are strings', () => {
      const item = {
        id: 'linkedin:job-99',
        platform: 'linkedin',
        externalId: 'job-99',
        schema_version: 1,
        benchmark_alert: false,
      };

      const record = publisher.formatPayload(item);
      for (const [key, val] of Object.entries(record)) {
        expect(typeof val, `Key "${key}" must be string`).toBe('string');
      }
    });
  });

  describe('Deterministic SHA-256 Idempotency Key', () => {
    it('produces identical idempotencyKey for identical platform, entityId, and hour bucket', () => {
      const item1 = {
        platform: 'twitter',
        externalId: 'tweet-456',
        crawledAt: '2026-09-17T16:05:00.000Z',
      };
      const item2 = {
        platform: 'twitter',
        externalId: 'tweet-456',
        crawledAt: '2026-09-17T16:55:00.000Z',
      };

      const hash1 = computeIdempotencyKey(item1);
      const hash2 = computeIdempotencyKey(item2);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it('produces different keys across different hour buckets', () => {
      const itemHour1 = {
        platform: 'twitter',
        externalId: 'tweet-456',
        crawledAt: '2026-09-17T16:59:59.000Z',
      };
      const itemHour2 = {
        platform: 'twitter',
        externalId: 'tweet-456',
        crawledAt: '2026-09-17T17:00:00.000Z',
      };

      expect(computeIdempotencyKey(itemHour1)).not.toBe(computeIdempotencyKey(itemHour2));
    });

    it('supports custom timestamp_bucket to override hourly bucket', () => {
      const itemDaily1 = {
        platform: 'twitter',
        externalId: 'tweet-456',
        timestamp_bucket: '2026-09-17',
        crawledAt: '2026-09-17T10:00:00.000Z',
      };
      const itemDaily2 = {
        platform: 'twitter',
        externalId: 'tweet-456',
        timestamp_bucket: '2026-09-17',
        crawledAt: '2026-09-17T22:00:00.000Z',
      };

      expect(computeIdempotencyKey(itemDaily1)).toBe(computeIdempotencyKey(itemDaily2));
    });

    it('falls back to item id when externalId is absent', () => {
      const itemWithoutExt = {
        platform: 'mastodon',
        id: 'status-12345',
        crawledAt: '2026-09-17T08:00:00.000Z',
      };
      const hash = computeIdempotencyKey(itemWithoutExt);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('normalizes namespaced entityId so platform:id and externalId produce identical keys', () => {
      const itemWithNs = {
        platform: 'facebook',
        id: 'facebook:12345',
        crawledAt: '2026-09-17T12:00:00.000Z',
      };
      const itemWithExt = {
        platform: 'facebook',
        externalId: '12345',
        crawledAt: '2026-09-17T12:00:00.000Z',
      };
      expect(computeIdempotencyKey(itemWithNs)).toBe(computeIdempotencyKey(itemWithExt));
    });
  });

  describe('validateCloudEvent() Specification Conformance', () => {
    it('returns true for fully compliant CloudEvent record', () => {
      const valid = {
        specversion: '1.0',
        id: 'threads:post-123',
        source: 'org.xactions.crawler.threads',
        type: 'org.xactions.scrape.completed',
        time: '2026-09-17T15:30:00.000Z',
        datacontenttype: 'application/json',
        data: '{"content":"Threads post"}',
        idempotencyKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      };

      expect(validateCloudEvent(valid)).toBe(true);
    });

    it('accepts case-insensitive and parameterised datacontenttype in validateCloudEvent', () => {
      const validUpper = {
        specversion: '1.0',
        id: '123',
        source: 'org.test',
        type: 't',
        time: '2026-09-17T00:00:00Z',
        datacontenttype: 'APPLICATION/JSON; charset=utf-8',
        data: '{"status":"ok"}',
        idempotencyKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      };
      expect(validateCloudEvent(validUpper)).toBe(true);
    });

    it('rejects invalid records and reports failure reason via out parameter and lastReason', () => {
      const out = {};

      expect(validateCloudEvent({}, out)).toBe(false);
      expect(out.reason).toContain('Missing or invalid "specversion"');
      expect(validateCloudEvent.lastReason).toBe(out.reason);

      expect(validateCloudEvent({ specversion: '1.0' }, out)).toBe(false);
      expect(out.reason).toContain('Missing or invalid "id"');

      expect(validateCloudEvent({ specversion: '1.0', id: '1' }, out)).toBe(false);
      expect(out.reason).toContain('Missing or invalid "source"');

      expect(validateCloudEvent({ specversion: '1.0', id: '1', source: 'org.test' }, out)).toBe(false);
      expect(out.reason).toContain('Missing or invalid "type"');

      expect(validateCloudEvent({ specversion: '1.0', id: '1', source: 'org.test', type: 't' }, out)).toBe(false);
      expect(out.reason).toContain('Missing or invalid "time"');

      expect(validateCloudEvent({ specversion: '1.0', id: '1', source: 'org.test', type: 't', time: 'not-a-date' }, out)).toBe(false);
      expect(out.reason).toContain('Invalid "time" timestamp');

      expect(validateCloudEvent({
        specversion: '1.0',
        id: '1',
        source: 'org.test',
        type: 't',
        time: '2026-09-17T00:00:00Z',
      }, out)).toBe(false);
      expect(out.reason).toContain('Missing "datacontenttype"');

      expect(validateCloudEvent({
        specversion: '1.0',
        id: '1',
        source: 'org.test',
        type: 't',
        time: '2026-09-17T00:00:00Z',
        datacontenttype: 'application/json',
      }, out)).toBe(false);
      expect(out.reason).toContain('Missing "data"');

      expect(validateCloudEvent({
        specversion: '1.0',
        id: '1',
        source: 'org.test',
        type: 't',
        time: '2026-09-17T00:00:00Z',
        datacontenttype: 'application/json',
        data: '{bad-json',
      }, out)).toBe(false);
      expect(out.reason).toContain('failed to parse JSON data payload');

      expect(validateCloudEvent({
        specversion: '1.0',
        id: '1',
        source: 'org.test',
        type: 't',
        time: '2026-09-17T00:00:00Z',
        datacontenttype: 'application/json',
        data: '{}',
        idempotencyKey: 'not-64-hex',
      }, out)).toBe(false);
      expect(out.reason).toContain('must be a 64-character hex string');
    });
  });

  describe('Backward-Compatible Dual-Emit Flat Consumption', () => {
    it('preserves all legacy flat fields consumed by CDC adapters alongside CloudEvents', () => {
      const item = {
        id: 'bluesky:post-777',
        platform: 'bluesky',
        externalId: 'post-777',
        category: 'social',
        authorId: 'did:plc:123',
        authorName: 'Alice',
        url: 'https://bsky.app/profile/alice/post/777',
        crawledAt: '2026-09-17T11:22:33.000Z',
        storageRef: 'storage-ref-777',
        content_snippet: 'Decentralized social post',
        workspace_id: 'ws-cdc',
      };

      const formatted = publisher.formatPayload(item, 'bluesky-hybrid');

      // Legacy CDC flat fields preserved
      expect(formatted.platform).toBe('bluesky');
      expect(formatted.externalId).toBe('post-777');
      expect(formatted.external_post_id).toBe('post-777');
      expect(formatted.authorId).toBe('did:plc:123');
      expect(formatted.author_id).toBe('did:plc:123');
      expect(formatted.author_name).toBe('Alice');
      expect(formatted.storageRef).toBe('storage-ref-777');
      expect(formatted.storage_ref).toBe('storage-ref-777');
      expect(formatted.content_snippet).toBe('Decentralized social post');
      expect(formatted.workspace_id).toBe('ws-cdc');
      expect(formatted.scraperId).toBe('bluesky-hybrid');
      expect(formatted.scraper_id).toBe('bluesky-hybrid');
      expect(formatted.crawledAt).toBe('2026-09-17T11:22:33.000Z');
      expect(formatted.crawled_at).toBe('2026-09-17T11:22:33.000Z');

      // CloudEvents v1.0 attributes coexist seamlessly
      expect(formatted.specversion).toBe('1.0');
      expect(formatted.source).toBe('org.xactions.crawler.bluesky');
      expect(formatted.type).toBe('org.xactions.scrape.completed');
      expect(formatted.idempotencyKey).toBeDefined();
    });
  });

  describe('Multi-Platform Crawler Emission Conformance', () => {
    const testPlatforms = ['facebook', 'twitter', 'linkedin', 'instagram', 'threads', 'bluesky'];

    for (const platform of testPlatforms) {
      it(`AbstractCrawler.execute() produces valid CloudEvents for ${platform}`, async () => {
        const platformCrawler = new MultiPlatformCrawler(platform, {
          store: { publisher },
        });

        const result = await platformCrawler.execute({
          action: 'scrape_posts',
          args: { context: { workspaceId: `ws-${platform}` } },
        });

        expect(result.posts).toHaveLength(2);
        expect(fakeClient.calls).toHaveLength(2);

        for (const call of fakeClient.calls) {
          const emittedRecord = call.fields;

          // Validate CloudEvents standard
          expect(validateCloudEvent(emittedRecord)).toBe(true);
          expect(emittedRecord.specversion).toBe('1.0');
          expect(emittedRecord.source).toBe(`org.xactions.crawler.${platform}`);
          expect(emittedRecord.type).toBe('org.xactions.scrape.completed');
          expect(emittedRecord.datacontenttype).toBe('application/json');
          expect(emittedRecord.idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
          expect(emittedRecord.workspace_id).toBe(`ws-${platform}`);

          // Verify payload data can be parsed back into domain object with full fields intact
          const parsedData = JSON.parse(emittedRecord.data);
          expect(parsedData).toBeDefined();
          expect(parsedData.text).toContain(`Post`);
          expect(parsedData.authorName).toBeDefined();
          expect(parsedData.url).toContain(platform);
        }

        // Clear fake calls for next iteration
        fakeClient.calls = [];
      });
    }
  });
});
