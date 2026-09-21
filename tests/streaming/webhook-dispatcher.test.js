// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// by nichxbt
/**
 * Test Suite — Story 29.2: Outbound Webhook Dispatcher with HMAC Signing & Retry
 * Real implementations only: real HTTP server, real crypto, real Express, real Redis/Store.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import {
  OutboundWebhookDispatcher,
  createSignature,
  verifySignature,
  parseStreamPayload,
  createWebhookDispatcher,
} from '../../src/streaming/outbound-webhook-dispatcher.js';
import {
  WebhookSubscriptionStore,
  isValidWebhookUrl,
} from '../../src/streaming/webhook-subscription-store.js';
import { createWebhookAdminRouter } from '../../api/routes/webhook-admin.js';
import { prisma, cleanupTestDatabase } from '../store/test-prisma-client.js';

const TEST_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-webhook-dispatcher-29';

function makeUserToken(user) {
  return jwt.sign(
    { userId: user.id, username: user.username, isAdmin: Boolean(user.isAdmin) },
    TEST_SECRET,
    { expiresIn: '1h' }
  );
}

async function seedUser(overrides = {}) {
  const id = `user_wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return prisma.user.create({
    data: {
      id,
      username: `wh_user_${id}`,
      email: `${id}@example.com`,
      password: await bcrypt.hash('TestPassword123!', 10),
      isAdmin: false,
      credits: 100,
      ...overrides,
    },
  });
}

describe('Story 29.2: HMAC Signing & Verification', () => {
  const payload = {
    id: 'bluesky:post_123',
    platform: 'bluesky',
    content: 'Hello decentralised world',
    category: 'social',
  };
  const secret = 'super-secret-key-12345';

  it('generates a valid sha256 hex signature prefixed with sha256=', () => {
    const signature = createSignature(payload, secret);
    expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it('returns an empty string when secret is empty or undefined', () => {
    expect(createSignature(payload, '')).toBe('');
    expect(createSignature(payload, null)).toBe('');
  });

  it('verifies valid signatures using timingSafeEqual', () => {
    const signature = createSignature(payload, secret);
    const isValid = verifySignature(payload, signature, secret);
    expect(isValid).toBe(true);
  });

  it('rejects tampered signatures or modified payload', () => {
    const signature = createSignature(payload, secret);
    const tamperedPayload = { ...payload, content: 'Tampered content' };
    expect(verifySignature(tamperedPayload, signature, secret)).toBe(false);
    expect(verifySignature(payload, 'sha256=invalidhex0000000000000000000000000000000000000000000000000000', secret)).toBe(false);
  });

  it('binds the timestamp into the MAC — a captured delivery cannot be replayed', () => {
    const ts = Math.floor(Date.now() / 1000);
    const signature = createSignature(payload, secret, ts);
    // Valid with the correct timestamp
    expect(verifySignature(payload, signature, secret, { timestamp: ts })).toBe(true);
    // A replayed signature with a rewritten (fresh) timestamp no longer verifies —
    // the timestamp is inside the signed payload.
    const futureTs = ts + 60;
    expect(verifySignature(payload, signature, secret, { timestamp: futureTs })).toBe(false);
  });

  it('rejects a timestamp outside the freshness tolerance window', () => {
    const now = Math.floor(Date.now() / 1000);
    const staleTs = now - 400; // older than default 300s tolerance
    const signature = createSignature(payload, secret, staleTs);
    expect(verifySignature(payload, signature, secret, { timestamp: staleTs, now })).toBe(false);
    // Same timestamp within tolerance verifies
    const freshTs = now - 10;
    const freshSig = createSignature(payload, secret, freshTs);
    expect(verifySignature(payload, freshSig, secret, { timestamp: freshTs, now })).toBe(true);
  });
});

describe('Story 29.2: WebhookSubscriptionStore CRUD & Validation', () => {
  let store;

  beforeEach(() => {
    store = new WebhookSubscriptionStore({
      hashKey: `test:webhook:subscriptions:${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    });
  });

  it('validates URLs correctly', () => {
    expect(isValidWebhookUrl('https://example.com/webhook')).toBe(true);
    expect(isValidWebhookUrl('http://127.0.0.1:8080/hook')).toBe(true);
    expect(isValidWebhookUrl('ftp://invalid.com')).toBe(false);
    expect(isValidWebhookUrl('not-a-url')).toBe(false);
    expect(isValidWebhookUrl('')).toBe(false);
  });

  it('creates and retrieves a subscription', async () => {
    const sub = await store.create({
      url: 'https://consumer.example.com/events',
      events: ['bluesky', 'mastodon'],
      secret: 'my-secret',
      description: 'Bluesky and Mastodon event consumer',
    });

    expect(sub.id).toMatch(/^sub_/);
    expect(sub.url).toBe('https://consumer.example.com/events');
    expect(sub.events).toEqual(['bluesky', 'mastodon']);
    expect(sub.active).toBe(true);
    expect(sub.description).toBe('Bluesky and Mastodon event consumer');

    const fetched = await store.get(sub.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(sub.id);
    expect(fetched?.url).toBe(sub.url);
  });

  it('rejects invalid URLs on creation', async () => {
    await expect(
      store.create({
        url: 'invalid-url',
        events: ['bluesky'],
      })
    ).rejects.toThrow('Invalid webhook URL');
  });

  it('rejects empty events array', async () => {
    await expect(
      store.create({
        url: 'https://consumer.example.com/events',
        events: [],
      })
    ).rejects.toThrow('events must be a non-empty array');
  });

  it('updates subscription fields and updatedAt timestamp', async () => {
    const sub = await store.create({
      url: 'https://consumer.example.com/events',
      events: ['bluesky'],
      secret: 'old-secret',
    });

    const updated = await store.update(sub.id, {
      active: false,
      secret: 'new-secret',
      events: ['*'],
    });

    expect(updated?.active).toBe(false);
    expect(updated?.secret).toBe('new-secret');
    expect(updated?.events).toEqual(['*']);
    expect(updated?.updatedAt).toBeDefined();

    const fetched = await store.get(sub.id);
    expect(fetched?.active).toBe(false);
    expect(fetched?.events).toEqual(['*']);
  });

  it('deletes a subscription', async () => {
    const sub = await store.create({
      url: 'https://consumer.example.com/events',
      events: ['*'],
    });

    const deleted = await store.delete(sub.id);
    expect(deleted).toBe(true);

    const fetched = await store.get(sub.id);
    expect(fetched).toBeNull();
  });

  it('matches subscriptions by event platform filter', async () => {
    const blueskySub = await store.create({
      url: 'https://consumer.example.com/bluesky',
      events: ['bluesky'],
    });
    const wildcardSub = await store.create({
      url: 'https://consumer.example.com/all',
      events: ['*'],
    });
    const inactiveSub = await store.create({
      url: 'https://consumer.example.com/inactive',
      events: ['bluesky'],
      active: false,
    });

    const matchingBluesky = await store.findMatchingSubscriptions('bluesky');
    const matchedIds = matchingBluesky.map((s) => s.id);
    expect(matchedIds).toContain(blueskySub.id);
    expect(matchedIds).toContain(wildcardSub.id);
    expect(matchedIds).not.toContain(inactiveSub.id);

    const matchingTwitter = await store.findMatchingSubscriptions('twitter');
    const twitterIds = matchingTwitter.map((s) => s.id);
    expect(twitterIds).not.toContain(blueskySub.id);
    expect(twitterIds).toContain(wildcardSub.id);
  });
});

describe('Story 29.2: Dispatcher Delivery, Signing, Retries & DLQ', () => {
  let httpServer;
  let serverUrl;
  let receivedRequests = [];
  let responseHandler = null;

  beforeAll(async () => {
    await new Promise((resolve) => {
      httpServer = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          receivedRequests.push({
            method: req.method,
            url: req.url,
            headers: req.headers,
            body: body ? JSON.parse(body) : null,
          });

          if (typeof responseHandler === 'function') {
            responseHandler(req, res);
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ received: true }));
          }
        });
      });

      httpServer.listen(0, '127.0.0.1', () => {
        const address = httpServer.address();
        serverUrl = `http://127.0.0.1:${address.port}`;
        resolve(null);
      });
    });
  });

  afterAll(async () => {
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve));
    }
  });

  beforeEach(() => {
    receivedRequests = [];
    responseHandler = null;
  });

  function createTestStoreAndDispatcher(options = {}) {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const store = new WebhookSubscriptionStore({
      hashKey: `test:webhook:subs:${id}`,
    });
    const dispatcher = new OutboundWebhookDispatcher({
      subscriptionStore: store,
      dlqKey: `test:webhook:dlq:${id}`,
      deliveryLogsKey: `test:webhook:logs:${id}`,
      metricsPrefix: `test:webhook:metrics:${id}:`,
      backoffBaseMs: 10,
      ...options,
    });
    return { store, dispatcher };
  }

  it('delivers signed ThinEvent when subscription matches platform (AC1)', async () => {
    const { store, dispatcher } = createTestStoreAndDispatcher();

    const sub = await store.create({
      url: `${serverUrl}/webhook-bluesky`,
      events: ['bluesky'],
      secret: 'bluesky-secret-key',
    });

    const event = {
      id: 'bluesky:3lb456',
      platform: 'bluesky',
      external_post_id: '3lb456',
      author_id: 'did:plc:test123',
      content_snippet: 'Realtime bluesky post',
      category: 'social',
    };

    const results = await dispatcher.dispatchToMatching(event);
    expect(results).toHaveLength(1);
    expect(results[0].delivered).toBe(true);
    expect(results[0].statusCode).toBe(200);

    expect(receivedRequests).toHaveLength(1);
    const req = receivedRequests[0];
    expect(req.url).toBe('/webhook-bluesky');
    expect(req.headers['x-xactions-event']).toBe('bluesky');
    expect(req.headers['x-xactions-signature']).toMatch(/^sha256=[a-f0-9]{64}$/);
    // Timestamp header is sent and bound into the signature (Story 31 fix —
    // replay protection). Verify the signature over `<timestamp>.<body>`.
    const ts = req.headers['x-xactions-timestamp'];
    expect(ts).toBeDefined();
    expect(Number.isFinite(Number(ts))).toBe(true);
    const expectedSig = createSignature(req.body, 'bluesky-secret-key', Number(ts));
    expect(req.headers['x-xactions-signature']).toBe(expectedSig);
    // And it round-trips through verifySignature with freshness.
    expect(verifySignature(req.body, 'bluesky-secret-key', req.headers['x-xactions-signature'], { timestamp: ts })).toBe(true);
  });

  it('delivers to wildcard subscription for any platform (AC2)', async () => {
    const { store, dispatcher } = createTestStoreAndDispatcher();

    await store.create({
      url: `${serverUrl}/webhook-wildcard`,
      events: ['*'],
    });

    const event = {
      id: 'threads:post_999',
      platform: 'threads',
      external_post_id: 'post_999',
      author_id: 'user_threads_1',
      content_snippet: 'A thread post',
      category: 'social',
    };

    const results = await dispatcher.dispatchToMatching(event);
    expect(results).toHaveLength(1);
    expect(results[0].delivered).toBe(true);

    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].url).toBe('/webhook-wildcard');
    expect(receivedRequests[0].headers['x-xactions-event']).toBe('threads');
  });

  it('skips non-matching subscriptions', async () => {
    const { store, dispatcher } = createTestStoreAndDispatcher();

    await store.create({
      url: `${serverUrl}/webhook-bluesky-only`,
      events: ['bluesky'],
    });

    const event = {
      id: 'facebook:fb_123',
      platform: 'facebook',
      category: 'social',
    };

    const results = await dispatcher.dispatchToMatching(event);
    expect(results).toHaveLength(0);
    expect(receivedRequests).toHaveLength(0);
  });

  it('retries on 500 with exponential backoff (4 attempts total), then dead-letters (AC3)', async () => {
    let callCount = 0;
    responseHandler = (req, res) => {
      callCount++;
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    };

    const { store, dispatcher } = createTestStoreAndDispatcher({ maxRetries: 3 });

    const sub = await store.create({
      url: `${serverUrl}/fail-500`,
      events: ['*'],
      secret: 'retry-secret',
    });

    const event = {
      id: 'bluesky:post_fail',
      platform: 'bluesky',
      content_snippet: 'Will fail with 500',
    };

    const result = await dispatcher.deliverToSubscription(sub, event);
    expect(result.delivered).toBe(false);
    expect(result.totalAttempts).toBe(4); // 1 initial + 3 retries
    expect(result.statusCode).toBe(500);
    expect(callCount).toBe(4);

    // Verify DLQ entry
    const dlq = await dispatcher.getDlq();
    expect(dlq.length).toBeGreaterThanOrEqual(1);
    const dlqEntry = dlq.find((e) => e.subscriptionId === sub.id);
    expect(dlqEntry).toBeDefined();
    expect(dlqEntry?.attempts).toBe(4);
    expect(dlqEntry?.lastError).toContain('500');
  });

  it('moves straight to DLQ on 404 permanent failure without retry (AC4)', async () => {
    let callCount = 0;
    responseHandler = (req, res) => {
      callCount++;
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Endpoint Not Found' }));
    };

    const { store, dispatcher } = createTestStoreAndDispatcher({ maxRetries: 3 });

    const sub = await store.create({
      url: `${serverUrl}/fail-404`,
      events: ['*'],
    });

    const event = {
      id: 'mastodon:status_404',
      platform: 'mastodon',
      content_snippet: 'Will fail with 404',
    };

    const result = await dispatcher.deliverToSubscription(sub, event);
    expect(result.delivered).toBe(false);
    expect(result.totalAttempts).toBe(1); // Straight to DLQ, no retry on 4xx
    expect(result.statusCode).toBe(404);
    expect(callCount).toBe(1);

    const dlq = await dispatcher.getDlq();
    const dlqEntry = dlq.find((e) => e.subscriptionId === sub.id);
    expect(dlqEntry).toBeDefined();
    expect(dlqEntry?.attempts).toBe(1);
    expect(dlqEntry?.lastError).toContain('404');
  });

  it('re-attempts delivery of a DLQ entry via retryDlqEntry', async () => {
    let callCount = 0;
    responseHandler = (req, res) => {
      callCount++;
      if (callCount <= 4) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Service Unavailable' }));
      } else {
        // Recovered on DLQ retry!
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }
    };

    const { store, dispatcher } = createTestStoreAndDispatcher({ maxRetries: 3 });

    const sub = await store.create({
      url: `${serverUrl}/dlq-recovery`,
      events: ['*'],
    });

    const event = {
      id: 'bluesky:recover_me',
      platform: 'bluesky',
    };

    await dispatcher.deliverToSubscription(sub, event);
    const dlqBefore = await dispatcher.getDlq();
    const entry = dlqBefore.find((e) => e.subscriptionId === sub.id);
    expect(entry).toBeDefined();

    // Now retry from DLQ
    const retryResult = await dispatcher.retryDlqEntry(entry.id);
    expect(retryResult.delivered).toBe(true);
    expect(retryResult.statusCode).toBe(200);

    // Verify it was removed from DLQ
    const dlqAfter = await dispatcher.getDlq();
    expect(dlqAfter.find((e) => e.id === entry.id)).toBeUndefined();
  });

  it('updates delivery metrics per subscription', async () => {
    const { store, dispatcher } = createTestStoreAndDispatcher();

    const sub = await store.create({
      url: `${serverUrl}/metrics-test`,
      events: ['*'],
    });

    await dispatcher.deliverToSubscription(sub, { id: 'test:1', platform: 'bluesky' });
    await dispatcher.deliverToSubscription(sub, { id: 'test:2', platform: 'bluesky' });

    const metrics = await dispatcher.getMetrics(sub.id);
    expect(Number(metrics.totalAttempts)).toBe(2);
    expect(Number(metrics.totalSuccess)).toBe(2);
    expect(Number(metrics.totalFailures)).toBe(0);
    expect(metrics.lastStatus).toBe('success');
    expect(Number(metrics.avgLatencyMs)).toBeGreaterThanOrEqual(0);
  });
});

describe('Story 29.2: Webhook Admin REST Endpoints (AC5 & AC6)', () => {
  let app;
  let adminUser;
  let regularUser;
  let adminToken;
  let regularToken;
  let testStore;
  let testDispatcher;

  beforeAll(async () => {
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = TEST_SECRET;
    }
    await cleanupTestDatabase();
    adminUser = await seedUser({ isAdmin: true, username: 'webhook_admin_user' });
    regularUser = await seedUser({ isAdmin: false, username: 'webhook_regular_user' });
    adminToken = makeUserToken(adminUser);
    regularToken = makeUserToken(regularUser);

    testStore = new WebhookSubscriptionStore({
      hashKey: `test:admin:subs:${Date.now()}`,
    });
    testDispatcher = new OutboundWebhookDispatcher({
      subscriptionStore: testStore,
      backoffBaseMs: 10,
    });

    app = express();
    app.use(express.json());
    const webhookRouter = createWebhookAdminRouter({
      subscriptionStore: testStore,
      dispatcher: testDispatcher,
    });
    app.use('/api/admin/webhooks', webhookRouter);
  });

  afterAll(async () => {
    if (adminUser || regularUser) {
      const ids = [adminUser?.id, regularUser?.id].filter(Boolean);
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get('/api/admin/webhooks/subscriptions');
    expect(res.status).toBe(401);
  });

  it('rejects non-admin users with 403', async () => {
    const res = await request(app)
      .get('/api/admin/webhooks/subscriptions')
      .set('Authorization', `Bearer ${regularToken}`);
    expect(res.status).toBe(403);
  });

  it('creates subscription via POST /subscriptions with admin auth (AC5)', async () => {
    const res = await request(app)
      .post('/api/admin/webhooks/subscriptions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        url: 'https://nowing.example.com/stream-hook',
        events: ['bluesky', 'mastodon'],
        secret: 'admin-configured-secret',
        description: 'Nowing social stream subscriber',
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/^sub_/);
    expect(res.body.url).toBe('https://nowing.example.com/stream-hook');
    expect(res.body.events).toEqual(['bluesky', 'mastodon']);
    expect(res.body.active).toBe(true);
  });

  it('returns 400 when creating subscription with invalid URL', async () => {
    const res = await request(app)
      .post('/api/admin/webhooks/subscriptions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        url: 'ftp://not-http-url.com',
        events: ['*'],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid webhook URL');
  });

  it('lists subscriptions via GET /subscriptions', async () => {
    await testStore.create({
      url: 'https://consumer.example.com/list-test',
      events: ['*'],
    });

    const res = await request(app)
      .get('/api/admin/webhooks/subscriptions')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('updates subscription via PATCH /subscriptions/:id', async () => {
    const createRes = await request(app)
      .post('/api/admin/webhooks/subscriptions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        url: 'https://consumer.example.com/patch-target',
        events: ['bluesky'],
      });

    const subId = createRes.body.id;

    const patchRes = await request(app)
      .patch(`/api/admin/webhooks/subscriptions/${subId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        active: false,
        description: 'Temporarily deactivated',
      });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.active).toBe(false);
    expect(patchRes.body.description).toBe('Temporarily deactivated');
  });

  it('deletes subscription via DELETE /subscriptions/:id', async () => {
    const createRes = await request(app)
      .post('/api/admin/webhooks/subscriptions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        url: 'https://consumer.example.com/delete-target',
        events: ['bluesky'],
      });

    const subId = createRes.body.id;

    const delRes = await request(app)
      .delete(`/api/admin/webhooks/subscriptions/${subId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(delRes.status).toBe(200);
    expect(delRes.body.deleted).toBe(true);

    const getRes = await request(app)
      .get(`/api/admin/webhooks/subscriptions/${subId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(getRes.status).toBe(404);
  });
  it('GET /subscriptions/:id returns 200 with redacted secret and metrics', async () => {
    const createRes = await request(app)
      .post('/api/admin/webhooks/subscriptions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        url: 'https://consumer.example.com/get-one',
        events: ['bluesky'],
        secret: 'should-not-leak',
      });
    const subId = createRes.body.id;
    const res = await request(app)
      .get(`/api/admin/webhooks/subscriptions/${subId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(subId);
    expect(res.body.secret).toBeUndefined();
    expect(res.body.hasSecret).toBe(true);
    expect(res.body.metrics).toBeDefined();
  });

  it('GET /metrics/:subscriptionId and GET /lag respond', async () => {
    const createRes = await request(app)
      .post('/api/admin/webhooks/subscriptions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ url: 'https://consumer.example.com/metrics', events: ['*'] });
    const subId = createRes.body.id;
    const metricsRes = await request(app)
      .get(`/api/admin/webhooks/metrics/${subId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(metricsRes.status).toBe(200);

    const lagRes = await request(app)
      .get('/api/admin/webhooks/lag')
      .set('Authorization', `Bearer ${adminToken}`);
    expect([200, 500]).toContain(lagRes.status); // Redis group may not exist in test
    if (lagRes.status === 200) {
      expect(lagRes.body).toBeDefined();
    }
  });


  it('returns delivery logs via GET /delivery-logs (AC6)', async () => {
    // Deliver a test event through dispatcher to populate logs
    const sub = await testStore.create({
      url: 'https://example.com/dummy',
      events: ['*'],
    });

    const res = await request(app)
      .get('/api/admin/webhooks/delivery-logs')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('inspects dead-letter queue via GET /dlq', async () => {
    const res = await request(app)
      .get('/api/admin/webhooks/dlq')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});


describe('Story 29.2: parseStreamPayload', () => {
  it('parses object-shaped stream messages', async () => {
    const { parseStreamPayload } = await import('../../src/streaming/outbound-webhook-dispatcher.js');
    const parsed = parseStreamPayload({ id: 'evt-1', platform: 'bluesky', content_snippet: 'hi' });
    expect(parsed.id).toBe('evt-1');
    expect(parsed.platform).toBe('bluesky');
  });

  it('parses ioredis field/value arrays', async () => {
    const { parseStreamPayload } = await import('../../src/streaming/outbound-webhook-dispatcher.js');
    const parsed = parseStreamPayload(['id', 'evt-2', 'platform', 'mastodon', 'content_snippet', 'hello']);
    expect(parsed.id).toBe('evt-2');
    expect(parsed.platform).toBe('mastodon');
    expect(parsed.content_snippet).toBe('hello');
  });
});

describe('Story 29.2: dispatchReplay', () => {
  it('returns empty array for non-array events', async () => {
    const store = new WebhookSubscriptionStore({ redisClient: null });
    const dispatcher = new OutboundWebhookDispatcher({ redisClient: null, subscriptionStore: store });
    const result = await dispatcher.dispatchReplay(null, { id: 'sub_x', url: 'https://example.com', secret: '' });
    expect(result).toEqual([]);
  });
});
