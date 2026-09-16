// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// by nichxbt
/**
 * Test Suite — Story 29.3: Stream Replay & Missed-Event Recovery
 *
 * Real implementations only:
 * - Real Redis client and Redis Stream (XRANGE, XADD, XINFO, XLEN)
 * - Real HTTP server for webhook replay delivery verification
 * - Real WebhookSubscriptionStore & OutboundWebhookDispatcher
 * - Real Express router mounted via supertest for GET /api/streams/:id/replay
 * - Real MCP executeTool for x_stream_replay
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import express from 'express';
import request from 'supertest';
import Redis from 'ioredis';
import {
  getStreamReplay,
  validateCursor,
  validateSince,
  parseStreamEntry,
  getStreamInfo,
  matchesStream,
  DEFAULT_REPLAY_STREAM_KEY,
} from '../../src/streaming/stream-replay.js';
import {
  OutboundWebhookDispatcher,
  verifySignature,
} from '../../src/streaming/outbound-webhook-dispatcher.js';
import { WebhookSubscriptionStore } from '../../src/streaming/webhook-subscription-store.js';
import streamsRouter from '../../api/routes/streams.js';
import { TOOLS, executeTool } from '../../src/mcp/server.js';

describe('Story 29.3: Stream Replay & Missed-Event Recovery', () => {
  /** @type {InstanceType<typeof Redis>} */
  let redis;
  const testStreamKey = `test:stream:replay:${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const testEmptyStreamKey = `test:stream:empty:${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  /** @type {Array<{ id: string, payload: Record<string, string> }>} */
  const seededEntries = [];

  beforeAll(async () => {
    redis = new Redis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: Number(process.env.REDIS_PORT) || 6379,
      maxRetriesPerRequest: 2,
    });

    // Seed 15 test entries with known timestamps
    const baseEpoch = 1789500000000; // e.g. future reference epoch
    for (let i = 0; i < 15; i++) {
      const entryId = `${baseEpoch + i * 1000}-0`;
      const platform = i % 2 === 0 ? 'twitter' : 'bluesky';
      const scraperId = i % 2 === 0 ? 'scraper-alpha' : 'scraper-beta';
      const payload = {
        id: `post_${i}`,
        platform,
        scraper_id: scraperId,
        target_id: `user_${i % 3}`,
        content_snippet: `Post content for event ${i}`,
        author_name: `author_${i}`,
        crawled_at: new Date(baseEpoch + i * 1000).toISOString(),
      };

      const args = [];
      for (const [k, v] of Object.entries(payload)) {
        args.push(k, String(v));
      }

      await redis.xadd(testStreamKey, entryId, ...args);
      seededEntries.push({ id: entryId, payload });
    }
  });

  afterAll(async () => {
    try {
      await redis.del(testStreamKey);
      await redis.del(testEmptyStreamKey);
    } catch {
      // ignore cleanup errors
    }
    await redis.quit();
  });

  // ==========================================================================
  // 1. Validation & Parsing Helpers
  // ==========================================================================
  describe('Parameter Validation & Parsing', () => {
    it('validateCursor accepts valid <ms> and <ms>-<seq> strings and numbers', () => {
      expect(validateCursor('1725911162329-0')).toBe('1725911162329-0');
      expect(validateCursor('1725911162329')).toBe('1725911162329');
      expect(validateCursor(1725911162329)).toBe('1725911162329');
      expect(validateCursor('  1725911162329-5  ')).toBe('1725911162329-5');
    });

    it('validateCursor throws INVALID_CURSOR on malformed cursor', () => {
      expect(() => validateCursor(null)).toThrowError();
      expect(() => validateCursor('')).toThrowError();
      expect(() => validateCursor('abc')).toThrowError();
      expect(() => validateCursor('123-abc')).toThrowError();

      try {
        validateCursor('invalid_cursor');
      } catch (err) {
        expect(/** @type {any} */ (err).code).toBe('INVALID_CURSOR');
      }
    });

    it('validateSince parses ISO 8601 strings, timestamps, and Date objects to ms epoch', () => {
      const iso = '2026-09-16T00:00:00.000Z';
      const expectedMs = Date.parse(iso);

      expect(validateSince(iso)).toBe(expectedMs);
      expect(validateSince(expectedMs)).toBe(expectedMs);
      expect(validateSince(String(expectedMs))).toBe(expectedMs);
      expect(validateSince(new Date(iso))).toBe(expectedMs);
    });

    it('validateSince throws INVALID_SINCE on malformed timestamp', () => {
      expect(() => validateSince(null)).toThrowError();
      expect(() => validateSince('not-a-date')).toThrowError();

      try {
        validateSince('not-a-date');
      } catch (err) {
        expect(/** @type {any} */ (err).code).toBe('INVALID_SINCE');
      }
    });

    it('parseStreamEntry handles both ioredis and node-redis response structures', () => {
      // ioredis format: [id, [k1, v1, k2, v2]]
      const ioredisEntry = ['1725911162329-0', ['platform', 'twitter', 'content', 'hello']];
      const parsedIoredis = parseStreamEntry(ioredisEntry);
      expect(parsedIoredis.id).toBe('1725911162329-0');
      expect(parsedIoredis.data.platform).toBe('twitter');
      expect(parsedIoredis.data.content).toBe('hello');

      // node-redis format: { id, message }
      const nodeRedisEntry = {
        id: '1725911162329-1',
        message: { platform: 'bluesky', content: 'atproto' },
      };
      const parsedNodeRedis = parseStreamEntry(nodeRedisEntry);
      expect(parsedNodeRedis.id).toBe('1725911162329-1');
      expect(parsedNodeRedis.data.platform).toBe('bluesky');
      expect(parsedNodeRedis.data.content).toBe('atproto');

      // Empty fallback
      expect(parseStreamEntry(null)).toEqual({ id: '', data: {} });
    });

    it('matchesStream checks streamId and metadata filters correctly', () => {
      const event = {
        scraper_id: 'scraper-alpha',
        target_id: 'user_target',
        platform: 'twitter',
        author_name: 'test_user',
      };

      // Wildcard / all matches
      expect(matchesStream(event, 'all')).toBe(true);
      expect(matchesStream(event, undefined)).toBe(true);
      expect(matchesStream(event, DEFAULT_REPLAY_STREAM_KEY)).toBe(true);

      // Direct scraper_id match
      expect(matchesStream(event, 'scraper-alpha')).toBe(true);
      expect(matchesStream(event, 'scraper-other')).toBe(false);

      // Metadata match
      expect(matchesStream(event, 'custom_stream', { username: 'test_user', type: 'tweet' })).toBe(true);
      expect(matchesStream(event, 'custom_stream', { username: 'other_user', type: 'tweet' })).toBe(false);
    });
  });

  // ==========================================================================
  // 2. Stream Metadata & getStreamInfo
  // ==========================================================================
  describe('Stream Metadata Inspection (getStreamInfo)', () => {
    it('reads stream length and first/last entry IDs from real Redis Stream', async () => {
      const info = await getStreamInfo(redis, testStreamKey);
      expect(info.streamKey).toBe(testStreamKey);
      expect(info.length).toBe(15);
      expect(info.firstEntry).toBe(seededEntries[0].id);
      expect(info.lastEntry).toBe(seededEntries[14].id);
    });

    it('returns zeroes and nulls for non-existent or empty stream', async () => {
      const info = await getStreamInfo(redis, testEmptyStreamKey);
      expect(info.length).toBe(0);
      expect(info.firstEntry).toBeNull();
      expect(info.lastEntry).toBeNull();
    });
  });

  // ==========================================================================
  // 3. Core Replay & Pagination via getStreamReplay
  // ==========================================================================
  describe('getStreamReplay Core Operations', () => {
    it('replays events by ISO timestamp in chronological order (oldest first)', async () => {
      // Replay from 5th event's timestamp
      const sinceIso = seededEntries[5].payload.crawled_at;
      const res = await getStreamReplay({
        streamKey: testStreamKey,
        since: sinceIso,
        limit: 100,
        redisClient: redis,
      });

      expect(res.events.length).toBe(10); // events 5 through 14
      expect(res.count).toBe(10);
      expect(res.hasMore).toBe(false);
      expect(res.events[0].id).toBe(seededEntries[5].id);
      expect(res.events[9].id).toBe(seededEntries[14].id);

      // Verify strictly chronological order
      for (let i = 1; i < res.events.length; i++) {
        const prevMs = parseInt(res.events[i - 1].id.split('-')[0], 10);
        const currMs = parseInt(res.events[i].id.split('-')[0], 10);
        expect(currMs).toBeGreaterThanOrEqual(prevMs);
      }
    });

    it('replays events by cursor resuming exclusively after the given ID', async () => {
      const cursor = seededEntries[4].id;
      const res = await getStreamReplay({
        streamKey: testStreamKey,
        cursor,
        limit: 100,
        redisClient: redis,
      });

      // Must NOT contain the cursor entry itself
      expect(res.events.some((e) => e.id === cursor)).toBe(false);
      // First event must be the one immediately after the cursor
      expect(res.events[0].id).toBe(seededEntries[5].id);
      expect(res.events.length).toBe(10);
      expect(res.hasMore).toBe(false);
    });

    it('supports limit and cursor pagination (hasMore: true, nextCursor)', async () => {
      // Page 1: limit 5
      const page1 = await getStreamReplay({
        streamKey: testStreamKey,
        limit: 5,
        redisClient: redis,
      });

      expect(page1.events.length).toBe(5);
      expect(page1.hasMore).toBe(true);
      expect(page1.nextCursor).toBe(seededEntries[4].id);
      expect(page1.events[0].id).toBe(seededEntries[0].id);

      // Page 2: resume from page 1's nextCursor
      const page2 = await getStreamReplay({
        streamKey: testStreamKey,
        cursor: page1.nextCursor,
        limit: 5,
        redisClient: redis,
      });

      expect(page2.events.length).toBe(5);
      expect(page2.hasMore).toBe(true);
      expect(page2.nextCursor).toBe(seededEntries[9].id);
      expect(page2.events[0].id).toBe(seededEntries[5].id);

      // Page 3: resume from page 2's nextCursor (remaining 5)
      const page3 = await getStreamReplay({
        streamKey: testStreamKey,
        cursor: page2.nextCursor,
        limit: 5,
        redisClient: redis,
      });

      expect(page3.events.length).toBe(5);
      expect(page3.hasMore).toBe(false);
      expect(page3.events[0].id).toBe(seededEntries[10].id);
      expect(page3.events[4].id).toBe(seededEntries[14].id);
    });

    it('caps limit between 1 and 1000 (default 100)', async () => {
      const defaultRes = await getStreamReplay({
        streamKey: testStreamKey,
        redisClient: redis,
      });
      expect(defaultRes.events.length).toBe(15);

      const cappedRes = await getStreamReplay({
        streamKey: testStreamKey,
        limit: 9999, // Should be clamped to 1000
        redisClient: redis,
      });
      expect(cappedRes.events.length).toBe(15);
    });

    it('returns empty result when no events match the requested range', async () => {
      // Future timestamp far ahead
      const futureIso = new Date(Date.now() + 1000000000).toISOString();
      const res = await getStreamReplay({
        streamKey: testStreamKey,
        since: futureIso,
        redisClient: redis,
      });

      expect(res.events).toEqual([]);
      expect(res.hasMore).toBe(false);
      expect(res.nextCursor).toBeNull();
      expect(res.count).toBe(0);
    });

    it('detects trimmed range and sets warning message', async () => {
      // Query before the stream first entry (seededEntries[0].id)
      const firstEntryMs = parseInt(seededEntries[0].id.split('-')[0], 10);
      const trimmedSince = new Date(firstEntryMs - 100000).toISOString();

      const res = await getStreamReplay({
        streamKey: testStreamKey,
        since: trimmedSince,
        redisClient: redis,
      });

      expect(res.warning).toBe('Requested range partially trimmed');
      expect(res.events.length).toBe(15);
    });

    it('filters events by specific stream / scraper ID', async () => {
      const res = await getStreamReplay({
        streamKey: testStreamKey,
        streamId: 'scraper-alpha',
        limit: 100,
        redisClient: redis,
      });

      expect(res.events.length).toBe(8); // 8 out of 15 are scraper-alpha
      for (const ev of res.events) {
        expect(ev.data.scraper_id).toBe('scraper-alpha');
      }
    });
  });

  // ==========================================================================
  // 4. Webhook Replay Delivery Integration
  // ==========================================================================
  describe('Replay Webhook Delivery Integration', () => {
    /** @type {http.Server} */
    let server;
    /** @type {string} */
    let serverUrl;
    /** @type {Array<{ headers: Record<string, string>, body: any }>} */
    const receivedDeliveries = [];

    /** @type {WebhookSubscriptionStore} */
    let store;
    /** @type {OutboundWebhookDispatcher} */
    let dispatcher;
    /** @type {string} */
    let subId;
    const testSecret = 'secret_replay_test_key_123';

    beforeAll(async () => {
      // Start local HTTP server to receive webhook deliveries
      server = http.createServer((req, res) => {
        let bodyStr = '';
        req.on('data', (chunk) => {
          bodyStr += chunk;
        });
        req.on('end', () => {
          try {
            const body = JSON.parse(bodyStr);
            receivedDeliveries.push({
              headers: /** @type {Record<string, string>} */ (req.headers),
              body,
            });
          } catch {
            receivedDeliveries.push({
              headers: /** @type {Record<string, string>} */ (req.headers),
              body: bodyStr,
            });
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ received: true }));
        });
      });

      await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address();
          if (addr && typeof addr === 'object') {
            serverUrl = `http://127.0.0.1:${addr.port}/webhook-target`;
          }
          resolve(true);
        });
      });

      // Setup store and dispatcher
      store = new WebhookSubscriptionStore({ redisClient: redis, prefix: 'test:replay:sub:' });
      dispatcher = new OutboundWebhookDispatcher({
        redisClient: redis,
        subscriptionStore: store,
        streamKey: testStreamKey,
        maxRetries: 0,
      });

      const sub = await store.create({
        url: serverUrl,
        secret: testSecret,
        events: ['twitter'],
      });
      subId = sub.id;
    });

    afterAll(async () => {
      await dispatcher.stop();
      await new Promise((resolve) => server.close(resolve));
    });

    it('delivers replayed events with X-XActions-Replay: true header and valid HMAC signature', async () => {
      receivedDeliveries.length = 0;

      const res = await getStreamReplay({
        streamKey: testStreamKey,
        streamId: 'scraper-alpha', // 8 events
        limit: 3,
        deliver: 'webhook',
        subscriptionId: subId,
        redisClient: redis,
        dispatcher,
        subscriptionStore: store,
      });

      expect(res.events.length).toBe(3);
      expect(res.delivered).toBe(3);
      expect(res.deliveryResults?.length).toBe(3);
      expect(receivedDeliveries.length).toBe(3);

      for (const delivery of receivedDeliveries) {
        expect(delivery.headers['x-xactions-replay']).toBe('true');
        expect(delivery.headers['x-xactions-delivery']).toBeDefined();
        expect(delivery.headers['x-xactions-signature']).toBeDefined();

        const sig = delivery.headers['x-xactions-signature'];
        const valid = verifySignature(delivery.body, sig, testSecret);
        expect(valid).toBe(true);
      }
    });

    it('throws error when subscriptionId is missing or subscription not found', async () => {
      await expect(
        getStreamReplay({
          streamKey: testStreamKey,
          deliver: 'webhook',
          redisClient: redis,
          dispatcher,
          subscriptionStore: store,
        })
      ).rejects.toThrow('Missing "subscriptionId"');

      await expect(
        getStreamReplay({
          streamKey: testStreamKey,
          deliver: 'webhook',
          subscriptionId: 'nonexistent_sub_123',
          redisClient: redis,
          dispatcher,
          subscriptionStore: store,
        })
      ).rejects.toThrow('Subscription not found');
    });
  });

  // ==========================================================================
  // 5. REST API: GET /api/streams/:id/replay
  // ==========================================================================
  describe('REST API: GET /api/streams/:id/replay', () => {
    /** @type {express.Express} */
    let app;

    beforeAll(() => {
      app = express();
      app.use(express.json());
      app.use('/api/streams', streamsRouter);
    });

    it('GET /api/streams/all/replay returns events by timestamp range', async () => {
      const sinceIso = seededEntries[5].payload.crawled_at;
      const res = await request(app)
        .get('/api/streams/all/replay')
        .query({
          streamKey: testStreamKey,
          since: sinceIso,
          limit: 10,
        });

      expect(res.status).toBe(200);
      expect(res.body.events).toBeDefined();
      expect(res.body.events.length).toBe(10);
      expect(res.body.count).toBe(10);
      expect(res.body.streamInfo).toBeDefined();
    });

    it('GET /api/streams/all/replay supports cursor pagination', async () => {
      const res = await request(app)
        .get('/api/streams/all/replay')
        .query({
          streamKey: testStreamKey,
          cursor: seededEntries[4].id,
          limit: 3,
        });

      expect(res.status).toBe(200);
      expect(res.body.events.length).toBe(3);
      expect(res.body.hasMore).toBe(true);
      expect(res.body.nextCursor).toBe(seededEntries[7].id);
    });

    it('GET /api/streams/all/replay includes trim warning if since is before first entry', async () => {
      const firstEntryMs = parseInt(seededEntries[0].id.split('-')[0], 10);
      const trimmedSince = new Date(firstEntryMs - 10000).toISOString();

      const res = await request(app)
        .get('/api/streams/all/replay')
        .query({
          streamKey: testStreamKey,
          since: trimmedSince,
        });

      expect(res.status).toBe(200);
      expect(res.body.warning).toBe('Requested range partially trimmed');
    });

    it('GET /api/streams/:id/replay returns 404 for unknown stream', async () => {
      const res = await request(app)
        .get('/api/streams/nonexistent-stream-id-99999/replay')
        .query({ streamKey: testStreamKey });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Stream not found');
    });

    it('GET /api/streams/all/replay returns 400 for invalid cursor', async () => {
      const res = await request(app)
        .get('/api/streams/all/replay')
        .query({
          streamKey: testStreamKey,
          cursor: 'invalid_cursor_format!',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_CURSOR');
    });

    it('GET /api/streams/all/replay returns 400 for invalid since timestamp', async () => {
      const res = await request(app)
        .get('/api/streams/all/replay')
        .query({
          streamKey: testStreamKey,
          since: 'totally_not_a_date',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_SINCE');
    });

    it('GET /api/streams/all/replay?deliver=webhook without subscriptionId returns 400', async () => {
      const res = await request(app)
        .get('/api/streams/all/replay')
        .query({
          streamKey: testStreamKey,
          deliver: 'webhook',
        });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('MISSING_SUBSCRIPTION_ID');
    });

    it('GET /api/streams/all/replay?deliver=webhook with unknown subscriptionId returns 404', async () => {
      const res = await request(app)
        .get('/api/streams/all/replay')
        .query({
          streamKey: testStreamKey,
          deliver: 'webhook',
          subscriptionId: 'sub_does_not_exist',
        });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('SUBSCRIPTION_NOT_FOUND');
    });

    it('GET /api/streams/all/replay rejects unsupported deliver modes', async () => {
      const res = await request(app)
        .get('/api/streams/all/replay')
        .query({
          streamKey: testStreamKey,
          deliver: 'kafka',
        });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_DELIVER');
    });
  });

  // ==========================================================================
  // 6. MCP Tool: x_stream_replay
  // ==========================================================================
  describe('MCP Tool: x_stream_replay', () => {
    it('is registered in MCP TOOLS definitions with correct schema', () => {
      const toolDef = TOOLS.find((t) => t.name === 'x_stream_replay');
      expect(toolDef).toBeDefined();
      expect(toolDef?.inputSchema?.properties?.streamId).toBeDefined();
      expect(toolDef?.inputSchema?.properties?.since).toBeDefined();
      expect(toolDef?.inputSchema?.properties?.cursor).toBeDefined();
      expect(toolDef?.inputSchema?.properties?.limit).toBeDefined();
    });

    it('executes x_stream_replay tool and returns replay result', async () => {
      const result = await executeTool('x_stream_replay', {
        streamId: 'all',
        streamKey: testStreamKey,
        limit: 4,
      });

      expect(result).toBeDefined();
      expect(result.events.length).toBe(4);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBe(seededEntries[3].id);
      expect(result.streamInfo.streamKey).toBe(testStreamKey);
    });
  });
});
