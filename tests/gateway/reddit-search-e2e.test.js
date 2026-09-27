// tests/gateway/reddit-search-e2e.test.js
// Story 50.9 — reddit search E2E contract + envelope parity
// by nichxbt

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import platformRouter from '../../api/routes/platform.js';
import actionsRouter from '../../api/routes/actions.js';
import { errorMiddleware } from '../../api/middleware/envelope.js';
import { _resetServiceKeyMap } from '../../api/middleware/serviceAuth.js';
import { _setTokenBucket, _resetTokenBucket } from '../../api/middleware/gatewayQuota.js';
import {
  _resetDispatch,
  _setScrapeImpl,
  _setEnqueueImpl,
  _setSyncBudgetMs,
  SYNC_BUDGET_MS,
} from '../../api/services/scrapeDispatch.js';
import { _resetMetrics, getMetricsSummary } from '../../api/services/gatewayMetrics.js';
import { _resetActionsCache } from '../../api/routes/actions.js';
import { executeActionListTool } from '../../src/scrapers/social/actions-list.js';
import { seedTestUser, cleanupTestUser, makeTestUserId, TEST_SECRET } from '../api/fixtures/test-user.js';
import { normalizeRedditPost } from '../../src/scrapers/social/reddit/normalizer.js';

const JEV_KEY = 'sk_jev_e2e_001';
const OTHER_KEY = 'sk_jev_e2e_002';
const SERVICE_MAP = JSON.stringify({
  [JEV_KEY]: { consumer_id: 'jev', tier: 'internal' },
  [OTHER_KEY]: { consumer_id: 'jev-b', tier: 'internal' },
});

const REDDIT_SEARCH_PAYLOAD = {
  data: {
    children: [
      {
        kind: 't3',
        data: {
          id: 'abc123',
          name: 't3_abc123',
          title: 'solana memecoin season',
          selftext: 'discussion of the latest solana memecoin pump',
          subreddit: 'solana',
          subreddit_name_prefixed: 'r/solana',
          author: 'crypto_bro',
          created_utc: 1758013154,
          score: 142,
          num_comments: 51,
          permalink: '/r/solana/comments/abc123/solana_memecoin_season/',
          url: 'https://reddit.com/r/solana/comments/abc123/',
          thumbnail: 'self',
          over_18: false,
        },
      },
    ],
    after: 't3_abc123',
  },
};

const ORIGINAL_ENV = { ...process.env };

let app;
let seededUserId;

beforeEach(async () => {
  process.env = { ...ORIGINAL_ENV };
  process.env.XACTIONS_SERVICE_KEYS = SERVICE_MAP;
  process.env.XACTIONS_CONSUMER_QUOTAS = JSON.stringify({
    'jev': { 'reddit:search': '100/min', default: '100/min' },
    'jev-b': { 'reddit:search': '100/min', default: '100/min' },
    anonymous: '50/min',
    default: '100/min',
  });

  _resetServiceKeyMap();
  _resetDispatch();
  _resetTokenBucket();
  _resetMetrics();
  _resetActionsCache();

  // Deterministic scrape seam — returns real-shaped PostItem[] for reddit search
  _setScrapeImpl(async (platform, action, options) => {
    if (platform === 'reddit' && action === 'search') {
      const post = normalizeRedditPost(REDDIT_SEARCH_PAYLOAD.data.children[0]);
      return { posts: [post], pageInfo: { end_cursor: 't3_abc123', has_next_page: true } };
    }
    if (platform === 'pumpfun' && action === 'fetch_coin_meta') {
      return { mint: 'TEST', coinMeta: { creator: 'C', marketCapUsd: 50000, socialLinks: { twitter: 'x' }, bondingCurve: 'b', isCurrentlyLive: false, athMarketCap: 60000 } };
    }
    if (platform === 'dexscreener' && action === 'token_lookup') {
      return { platform: 'dexscreener', category: 'crypto', type: 'token_lookup', data: { chain_id: 'solana', token_address: 'T', pairs: [] } };
    }
    return [];
  });
  _setEnqueueImpl(async () => ({ jobId: 'op-e2e-1' }));

  app = express();
  app.use(express.json());
  app.use('/api/platform', platformRouter);
  app.use('/api/actions', actionsRouter);
  app.use(errorMiddleware);
});

afterEach(async () => {
  if (seededUserId) {
    await cleanupTestUser(seededUserId).catch(() => {});
    seededUserId = null;
  }
  _resetServiceKeyMap();
  _resetDispatch();
  _resetTokenBucket();
  _resetMetrics();
  _resetActionsCache();
  process.env = { ...ORIGINAL_ENV };
});

describe('Story 50.9 — reddit search e2e contract', () => {
  it('E-1: sync reddit/search returns unified envelope + PostItem[] snake_case', async () => {
    const startedAt = Date.now();
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .set('Authorization', `Bearer ${JEV_KEY}`)
      .send({ action: 'search', mode: 'sync', options: { query: 'solana memecoin' } });
    const elapsed = Date.now() - startedAt;

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.mode).toBe('sync');
    expect(res.body.metadata.platform).toBe('reddit');
    expect(res.body.metadata.action).toBe('search');
    expect(res.body.metadata.consumer_id).toBe('jev');
    expect(res.body.metadata.sync_capable).toBe(true);
    expect(res.body.metadata.request_id).toBeTruthy();
    expect(elapsed).toBeLessThan(5000); // wall-clock — injected impl is fast

    const payload = res.body.data?.[0] || res.body.data;
    const posts = payload?.posts || (Array.isArray(payload) ? payload : []);
    expect(Array.isArray(posts)).toBe(true);
    expect(posts.length).toBeGreaterThan(0);
    const p = posts[0];
    expect(typeof p.id).toBe('string');
    expect(p.platform).toBe('reddit');
    // canonical PostItem fields — `content` + `author.username` are the
    // snake_case exports from normalizeRedditPost
    expect(p).toHaveProperty('content');
    expect(p.authorName).toBe('crypto_bro');
    expect(p.metadata?.subreddit).toBe('solana');
  });

  it('E-2: async mode queues + returns operation metadata', async () => {
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .set('Authorization', `Bearer ${JEV_KEY}`)
      .send({ action: 'search', mode: 'async', options: { query: 'solana' } });

    expect(res.status).toBe(202);
    expect(res.body.mode).toBe('async');
    // operationId + statusUrl live at the body top-level (queuedOutcome extra)
    const opId = res.body.operationId;
    expect(opId).toBeTruthy();
    expect(res.body.statusUrl).toContain(opId);
  });

  it('E-3: sync-timeout → 202 with degraded_reason=upstream_timeout', async () => {
    _setScrapeImpl(async () => new Promise((resolve) => setTimeout(() => resolve([]), 5000)));
    _setSyncBudgetMs(50); // tighten ceiling for deterministic timeout

    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .set('Authorization', `Bearer ${JEV_KEY}`)
      .send({ action: 'search', mode: 'sync', options: { query: 'solana' } });

    expect(res.status).toBe(202);
    expect(res.body.degraded_reason).toBe('upstream_timeout');
    expect(res.body.operationId).toBeTruthy();
  });

  it('E-4: 4 auth lanes — JWT internal unmetered / service key metered / x402 / anonymous', async () => {
    // userJWT → internal
    seededUserId = makeTestUserId('e2e-user');
    const user = await seedTestUser(seededUserId);
    const jwtToken = user.token;

    const jwtRes = await request(app)
      .post('/api/platform/reddit/scrape')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ action: 'search', mode: 'sync', options: { query: 'crypto' } });
    expect(jwtRes.body.metadata.consumer_id).toBe('internal');

    // service key → jev bucket
    const keyRes = await request(app)
      .post('/api/platform/reddit/scrape')
      .set('Authorization', `Bearer ${JEV_KEY}`)
      .send({ action: 'search', mode: 'sync', options: { query: 'crypto' } });
    expect(keyRes.body.metadata.consumer_id).toBe('jev');

    // X-Payment lane — quota middleware bypasses when header present
    let consumedKeys = [];
    _setTokenBucket({
      async consume(key) { consumedKeys.push(key); return { allowed: true, remaining: 9 }; },
    });
    const x402Res = await request(app)
      .post('/api/platform/reddit/scrape')
      .set('X-Payment', 'mock-payment-proof')
      .send({ action: 'search', mode: 'sync', options: { query: 'crypto' } });
    expect(x402Res.status).toBe(200);
    // x402 lane still hits anonymous bucket (no bearer); key shape check.
    // The BYPASS only kicks in when consume() returns allowed:false — see
    // ERR_X402_BYPASS test in consumer-quota.test.js.
    expect(consumedKeys.length).toBe(1);
    expect(consumedKeys[0]).toMatch(/^anonymous:/);
    _resetTokenBucket();

    // anonymous → anonymous bucket
    consumedKeys = [];
    _setTokenBucket({
      async consume(key) { consumedKeys.push(key); return { allowed: true, remaining: 9 }; },
    });
    await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'search', mode: 'sync', options: { query: 'crypto' } });
    expect(consumedKeys[0]).toMatch(/^anonymous:.*:reddit:search$/);
  });

  it('E-5: spoofed X-Consumer-Id is ignored (Bearer-derived identity wins)', async () => {
    const consumedKeys = [];
    _setTokenBucket({
      async consume(key) { consumedKeys.push(key); return { allowed: true, remaining: 9 }; },
    });
    // X-Consumer-Id alone does NOT authenticate — lands on anonymous bucket
    await request(app)
      .post('/api/platform/reddit/scrape')
      .set('X-Consumer-Id', 'jev')
      .send({ action: 'search', mode: 'sync', options: { query: 'crypto' } });
    expect(consumedKeys[0]).toMatch(/^anonymous:.*:reddit:search$/);
    expect(consumedKeys[0]).not.toContain('jev');
  });

  it('E-6: per-consumer quota isolation — jev exhausts, jev-b still 200', async () => {
    const counters = { jev: 0, 'jev-b': 0 };
    _setTokenBucket({
      async consume(key) {
        if (key.startsWith('jev:')) { counters.jev++; return { allowed: counters.jev <= 1, remaining: 0, retryAfterMs: 1500 }; }
        if (key.startsWith('jev-b:')) { counters['jev-b']++; return { allowed: true, remaining: 9 }; }
        return { allowed: true, remaining: 9 };
      },
    });

    // jev first call ok, second → 429
    const r1 = await request(app)
      .post('/api/platform/reddit/scrape')
      .set('Authorization', `Bearer ${JEV_KEY}`)
      .send({ action: 'search', mode: 'sync', options: { query: 'x' } });
    expect(r1.status).toBe(200);
    const r2 = await request(app)
      .post('/api/platform/reddit/scrape')
      .set('Authorization', `Bearer ${JEV_KEY}`)
      .send({ action: 'search', mode: 'sync', options: { query: 'x' } });
    expect(r2.status).toBe(429);
    expect(r2.body.error.code).toBe('XACT_4029');
    expect(r2.body.error.kind).toBe('consumer_quota');

    // jev-b unaffected
    const r3 = await request(app)
      .post('/api/platform/reddit/scrape')
      .set('Authorization', `Bearer ${OTHER_KEY}`)
      .send({ action: 'search', mode: 'sync', options: { query: 'x' } });
    expect(r3.status).toBe(200);
  });

  it('E-7: not_sync_capable action with mode:sync → 400 XACT_4001 (telegram stub)', async () => {
    const res = await request(app)
      .post('/api/platform/telegram/scrape')
      .set('Authorization', `Bearer ${JEV_KEY}`)
      .send({ action: 'channel_messages', mode: 'sync', options: { channel: 'durov' } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('XACT_4001');
    expect(res.body.error.kind).toBe('validation');
  });

  it('E-8: envelope shape parity across reddit + pumpfun + dexscreener (kind enum)', async () => {
    const envelopes = [];
    for (const [platform, body] of [
      ['reddit', { action: 'search', mode: 'sync', options: { query: 'x' } }],
      ['pumpfun', { action: 'fetch_coin_meta', mode: 'sync', options: { mintAddress: 'TEST' } }],
      ['dexscreener', { action: 'token_lookup', mode: 'sync', options: { chainId: 'solana', tokenAddress: 'T' } }],
    ]) {
      const r = await request(app)
        .post(`/api/platform/${platform}/scrape`)
        .set('Authorization', `Bearer ${JEV_KEY}`)
        .send(body);
      expect([200, 202]).toContain(r.status);
      envelopes.push(r.body);
    }
    const KINDS = ['auth', 'validation', 'consumer_quota', 'upstream_rate_limit', 'proxy_ip_block', 'upstream_error', 'internal'];
    for (const env of envelopes) {
      expect(env).toHaveProperty('success');
      expect(env).toHaveProperty('ok');
      expect(env).toHaveProperty('mode');
      expect(env.metadata).toHaveProperty('request_id');
      expect(env.metadata).toHaveProperty('platform');
      expect(env.metadata).toHaveProperty('action');
      expect(env.metadata).toHaveProperty('consumer_id');
      if (!env.ok && env.error) {
        expect(KINDS).toContain(env.error.kind);
      }
    }
  });

  it('E-9: GET /api/actions ≡ x_actions_list shape (regression on 50.5)', async () => {
    const res = await request(app).get('/api/actions?platform=reddit');
    expect(res.status).toBe(200);
    const direct = await executeActionListTool({ platform: 'reddit' });
    // REST response fields ⊆ shared executor fields
    const actionNames = res.body.data.map(a => a.action);
    const directNames = direct.map(a => a.action);
    expect(actionNames.sort()).toEqual(directNames.sort());
  });

  it('E-10: malformed bearer → 401 (presented-invalid ≠ absent)', async () => {
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .set('Authorization', 'Token abc123')
      .send({ action: 'search', mode: 'sync', options: { query: 'x' } });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBeTruthy();
  });
});
