// tests/gateway/consumer-quota.test.js
// Story 50.4 — Per-Consumer Quota + Anonymous Free Tier + Anti-Spoofing
// by nichxbt

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import platformRouter from '../../api/routes/platform.js';
import { buildRouteConfig } from '../../api/middleware/x402.js';
import { errorMiddleware } from '../../api/middleware/envelope.js';
import { _resetServiceKeyMap } from '../../api/middleware/serviceAuth.js';
import { _setTokenBucket, _resetTokenBucket } from '../../api/middleware/gatewayQuota.js';
import { _resetDispatch, _setScrapeImpl } from '../../api/services/scrapeDispatch.js';
import { _resetMetrics } from '../../api/services/gatewayMetrics.js';
import { seedTestUser, cleanupTestUser, makeTestUserId, TEST_SECRET } from '../api/fixtures/test-user.js';

const JEV_KEY = 'sk_jev_quota_test_001';
const SERVICE_MAP = JSON.stringify({
  [JEV_KEY]: { consumer_id: 'jev', tier: 'internal' },
});

const ORIGINAL_ENV = { ...process.env };

let app;
beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.XACTIONS_SERVICE_KEYS = SERVICE_MAP;
  process.env.XACTIONS_CONSUMER_QUOTAS = JSON.stringify({
    jev: { 'reddit:search': '2/min', default: '5/min' },
    default: '10/min',
  });

  _resetServiceKeyMap();
  _resetDispatch();
  _resetTokenBucket();
  _resetMetrics();
  _setScrapeImpl(async () => [{ id: 'mock-1' }]);

  app = express();
  app.use(express.json());
  app.use('/api/platform', platformRouter);
  app.use(errorMiddleware);
});

afterEach(() => {
  _resetServiceKeyMap();
  _resetDispatch();
  _resetTokenBucket();
  _resetMetrics();
  process.env = { ...ORIGINAL_ENV };
});

describe('Story 50.4 — Gateway Quota Enforcement & Anti-Spoofing', () => {
  it('HAPPY_QUOTA_ALLOW: named consumer within quota succeeds', async () => {
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .set('Authorization', `Bearer ${JEV_KEY}`)
      .send({ action: 'search', mode: 'sync', query: 'crypto' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.metadata.consumer_id).toBe('jev');
  });

  it('ERR_QUOTA_EXHAUSTED: named consumer exceeding quota gets 429 with consumer_quota ErrorEnvelope', async () => {
    // Stateful in-test token bucket — deterministic (no Redis, no cross-run
    // persistence from the global in-memory/Redis bucket).
    let consumed = 0;
    _setTokenBucket({
      async consume(_key, tokens, opts) {
        const capacity = opts?.capacity ?? 2;
        if (consumed + tokens <= capacity) {
          consumed += tokens;
          return { allowed: true, remaining: capacity - consumed, retryAfterMs: 0 };
        }
        return { allowed: false, remaining: 0, retryAfterMs: 1500 };
      },
    });

    const res1 = await request(app)
      .post('/api/platform/reddit/scrape')
      .set('Authorization', `Bearer ${JEV_KEY}`)
      .send({ action: 'search', mode: 'sync' });
    expect(res1.status).toBe(200);

    const res2 = await request(app)
      .post('/api/platform/reddit/scrape')
      .set('Authorization', `Bearer ${JEV_KEY}`)
      .send({ action: 'search', mode: 'sync' });
    expect(res2.status).toBe(200);

    // 3rd request breaches the 2/min capacity
    const res3 = await request(app)
      .post('/api/platform/reddit/scrape')
      .set('Authorization', `Bearer ${JEV_KEY}`)
      .set('X-Request-Id', 'req-exhausted-1')
      .send({ action: 'search', mode: 'sync' });

    expect(res3.status).toBe(429);
    expect(res3.body.success).toBe(false);
    expect(res3.body.error).toMatchObject({
      code: 'XACT_4029',
      kind: 'consumer_quota',
      type: 'rate_limit',
      status: 429,
      request_id: 'req-exhausted-1',
      retryable: true,
    });
    expect(typeof res3.body.error.retry_after_ms).toBe('number');
    expect(res3.headers['retry-after']).toBeDefined();
  });

  it('ANTI_SPOOFING: anonymous caller sending X-Consumer-Id: jev is still subject to anonymous IP quota', async () => {
    // In-memory fake bucket counting calls per key
    const consumedKeys = [];
    _setTokenBucket({
      async consume(key) {
        consumedKeys.push(key);
        return { allowed: true, remaining: 10, retryAfterMs: 0 };
      },
    });

    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .set('X-Consumer-Id', 'jev') // Attacker tries to impersonate jev without token
      .send({ action: 'search', mode: 'sync' });

    expect(res.status).toBe(200);
    // The bucket key used MUST be anonymous:<ip>:reddit:search, NOT jev:reddit:search!
    expect(consumedKeys.length).toBe(1);
    expect(consumedKeys[0]).toMatch(/^anonymous:.*:reddit:search$/);
    expect(consumedKeys[0]).not.toContain('jev:');
  });

  it('INTERNAL_UNMETERED: internal (userJWT) consumers bypass gateway quota', async () => {
    let bucketCalled = false;
    _setTokenBucket({
      async consume() {
        bucketCalled = true;
        return { allowed: false, remaining: 0, retryAfterMs: 5000 };
      },
    });

    // A real user JWT — eitherAuth resolves source:'userJWT' → internal (unmetered)
    const TEST_USER_ID = makeTestUserId('quota-internal');
    const user = await seedTestUser(TEST_USER_ID, 'quota_internal_user');
    try {
      const token = jwt.sign({ userId: user.id, username: user.username }, TEST_SECRET, { expiresIn: '1h' });

      app = express();
      app.use(express.json());
      app.use('/api/platform', platformRouter);

      const res = await request(app)
        .post('/api/platform/reddit/scrape')
        .set('Authorization', `Bearer ${token}`)
        .send({ action: 'search', mode: 'sync' });

      expect(res.status).toBe(200);
      expect(bucketCalled).toBe(false); // Internal requests must never call token bucket
    } finally {
      await cleanupTestUser(TEST_USER_ID);
    }
  });

  it('X402_ROUTE_CONFIG: buildRouteConfig exposes gateway scrape routes with pricing', () => {
    const routes = buildRouteConfig();
    expect(routes['POST /api/platform/:platform/scrape']).toBeDefined();
    expect(routes['POST /api/platform/:platform/scrape'].accepts).toBeDefined();
    expect(routes['POST /api/platform/:platform/scrape'].accepts.price).toMatch(/^\$[\d.]+$/);
    expect(routes['POST /api/platform/all/scrape']).toBeDefined();
  });

  it('X402_BYPASS: quota-exhausted caller with x402 payment header proceeds to handler', async () => {
    _setTokenBucket({
      async consume() {
        return { allowed: false, remaining: 0, retryAfterMs: 2000 };
      },
    });

    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .set('X-Payment', 'test-valid-x402-payment-signature')
      .send({ action: 'search', mode: 'sync' });

    // Allowed through rate limiter because payment header is present
    expect(res.status).toBe(200);
  });
});
