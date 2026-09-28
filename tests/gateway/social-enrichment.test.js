// tests/gateway/social-enrichment.test.js
// Contract tests for spec-12-8 — Social Enrichment & Parallel Scrape
// (CAP-1 new channels, CAP-2 author enrichment, CAP-3 engagement velocity,
// CAP-4 concurrency + proxy_rotate request knobs).
//
// Covers the spec I/O & Edge-Case Matrix via injected seams
// (_setScrapeImpl/_setEnqueueImpl/_setOperationStore) — real implementations
// only, no vi.mock module stubs (repo mandate).
// by nichxbt

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

import platformRouter from '../../api/routes/platform.js';
import { errorMiddleware } from '../../api/middleware/envelope.js';
import {
  sanitizeOptions,
  _setScrapeImpl,
  _setEnqueueImpl,
  _setOperationStore,
  _resetDispatch,
} from '../../api/services/scrapeDispatch.js';
import { _resetGatewayEnvelope } from '../../api/services/gatewayEnvelope.js';
import { _resetServiceKeyMap } from '../../api/middleware/serviceAuth.js';
import { tweetToPostItem } from '../../src/scrapers/social/twitter/normalize-tweet.js';
import { nextTestId } from '../utils/test-ids.js';

const TEST_SCOPE = 'gw-soc-enr';
const ORIGINAL_ENV = { ...process.env };

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeFakeStore() {
  const rows = new Map();
  let seq = 0;
  return {
    rows,
    async create(data) {
      const id = `op_${++seq}`;
      const row = { id, ...data };
      rows.set(id, row);
      return row;
    },
    async update(id, data) {
      const row = rows.get(id) || { id };
      Object.assign(row, data);
      rows.set(id, row);
      return row;
    },
    async updateIfProcessing(id, data) {
      const row = rows.get(id);
      if (!row || row.status !== 'processing') return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
  };
}

function makeFakeEnqueue() {
  const calls = [];
  let seq = 0;
  const fn = async (type, data, opts) => {
    const jobId = `opq_${++seq}`;
    calls.push({ type, data, opts, jobId });
    return { jobId, bullJobId: `bull_${seq}`, operation: { id: jobId } };
  };
  return { calls, fn };
}

function makeScrapeSpy(impl) {
  const calls = [];
  const fn = async (platform, action, options) => {
    calls.push({ platform, action, options });
    return impl ? impl(platform, action, options) : [{ id: 'r1' }];
  };
  return { calls, fn };
}

let app;
let store;
let enq;
let scrapeSpy;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.XACTIONS_SERVICE_KEYS;
  delete process.env.XACTIONS_MCP_API_KEY;
  delete process.env.XACTIONS_API_TOKEN;
  delete process.env.REDIS_STREAM_ENABLED;
  process.env.XACTIONS_CONSUMER_QUOTAS = JSON.stringify({ default: '100000/min' });
  process.env.NODE_ENV = 'development';
  _resetServiceKeyMap();
  _resetDispatch();
  _resetGatewayEnvelope();

  store = makeFakeStore();
  enq = makeFakeEnqueue();
  scrapeSpy = makeScrapeSpy();
  _setOperationStore(store);
  _setEnqueueImpl(enq.fn);
  _setScrapeImpl(scrapeSpy.fn);

  app = express();
  app.use(express.json());
  app.use('/api/platform', platformRouter);
  app.use(errorMiddleware);
});

afterEach(() => {
  _resetDispatch();
  _resetServiceKeyMap();
  _resetGatewayEnvelope();
  process.env = { ...ORIGINAL_ENV };
});

// ─── CAP-1 — New channels ──────────────────────────────────────────────────

describe('CAP-1 — new channels (telegram/tiktok/4chan) in batch platforms[]', () => {
  it(`[${nextTestId(TEST_SCOPE, 'CAP1', 'P0')}] batch platforms ['x','reddit','telegram','tiktok','4chan'] returns per-channel results; 4chan is 'unsupported'`, async () => {
    const res = await request(app)
      .post('/api/platform/x/scrape')
      .send({ action: 'search', platform: ['x', 'reddit', 'telegram', 'tiktok', '4chan'], mode: 'sync' });

    expect(res.status).toBe(200);
    const results = res.body.results || [];
    const byPlatform = Object.fromEntries(results.map((r) => [r.platform, r]));

    // 4chan is a reserved channel name — 'unsupported', never 'failed' the batch.
    expect(byPlatform['4chan']).toBeDefined();
    expect(byPlatform['4chan'].status).toBe('unsupported');
    expect(byPlatform['4chan'].error.code).toBe('XACT_4001');

    // The whole batch stays 200 — one unknown channel never fails the rest.
    expect(res.body.success).toBe(true);
  });

  it(`[${nextTestId(TEST_SCOPE, 'CAP1', 'P1')}] 'tg' alias normalizes to 'telegram'`, async () => {
    const res = await request(app)
      .post('/api/platform/x/scrape')
      .send({ action: 'search', platform: ['tg'], mode: 'sync' });
    // 'tg' resolves via PLATFORM_ALIASES — canonical 'telegram' is the label.
    const results = res.body.results || [];
    const labels = results.map((r) => r.platform);
    expect(labels).toContain('telegram');
  });
});

// ─── CAP-4 — concurrency + proxy_rotate ────────────────────────────────────

describe('CAP-4 — concurrency + proxy_rotate request knobs', () => {
  it(`[${nextTestId(TEST_SCOPE, 'CAP4', 'P0')}] concurrency:999 clamps to MAX_SCRAPE_CONCURRENCY ceiling`, () => {
    const out = sanitizeOptions({ action: 'search', query: 'x', concurrency: 999 });
    expect(out.concurrency).toBeLessThanOrEqual(8);
    expect(out.concurrency).toBeGreaterThanOrEqual(1);
  });

  it(`[${nextTestId(TEST_SCOPE, 'CAP4', 'P0')}] concurrency:6 passes through unchanged`, () => {
    const out = sanitizeOptions({ action: 'search', query: 'x', concurrency: 6 });
    expect(out.concurrency).toBe(6);
  });

  it(`[${nextTestId(TEST_SCOPE, 'CAP4', 'P1')}] invalid concurrency values are dropped (absent, not zero)`, () => {
    expect(sanitizeOptions({ action: 'x', concurrency: 0 })).not.toHaveProperty('concurrency');
    expect(sanitizeOptions({ action: 'x', concurrency: -3 })).not.toHaveProperty('concurrency');
    expect(sanitizeOptions({ action: 'x', concurrency: 'bogus' })).not.toHaveProperty('concurrency');
    expect(sanitizeOptions({ action: 'x', concurrency: NaN })).not.toHaveProperty('concurrency');
  });

  it(`[${nextTestId(TEST_SCOPE, 'CAP4', 'P0')}] proxy_rotate:true coerces to boolean`, () => {
    const out = sanitizeOptions({ action: 'search', proxy_rotate: true });
    expect(out.proxy_rotate).toBe(true);
    expect(sanitizeOptions({ action: 'x', proxy_rotate: 'true' }).proxy_rotate).toBe(true);
    expect(sanitizeOptions({ action: 'x', proxy_rotate: false }).proxy_rotate).toBe(false);
    expect(sanitizeOptions({ action: 'x' })).not.toHaveProperty('proxy_rotate');
  });

  it(`[${nextTestId(TEST_SCOPE, 'CAP4', 'P1')}] end-to-end: scrape body with concurrency + proxy_rotate dispatches with options intact`, async () => {
    const res = await request(app)
      .post('/api/platform/x/scrape')
      .send({ action: 'search', query: 'x', platform: ['x', 'reddit'], concurrency: 6, proxy_rotate: true, mode: 'sync' });
    expect([200, 202]).toContain(res.status);
    // Options reached the scraper layer (flat, post-sanitizeOptions).
    expect(scrapeSpy.calls.length).toBeGreaterThan(0);
    const seenOpts = scrapeSpy.calls.map((c) => c.options);
    for (const o of seenOpts) {
      expect(o.concurrency).toBe(6);
      expect(o.proxy_rotate).toBe(true);
    }
  });
});

// ─── CAP-2 — Author enrichment fields ──────────────────────────────────────

describe('CAP-2 — author enrichment on twitter PostItem', () => {
  const RAW_TWEET_WITH_ENRICHMENT = {
    rest_id: '1234567890',
    legacy: {
      full_text: 'hello world',
      favorite_count: 12,
      retweet_count: 3,
      reply_count: 2,
      created_at: new Date(Date.now() - 10 * 60 * 1000).toUTCString(), // 10 min ago
    },
    core: {
      user_results: {
        result: {
          rest_id: 'u_1',
          legacy: {
            screen_name: 'alice',
            name: 'Alice',
            followers_count: 50,
            friends_count: 10,
            created_at: new Date(Date.now() - 12 * 86400000).toUTCString(), // 12 days ago
          },
          is_blue_verified: false,
        },
      },
    },
  };

  it(`[${nextTestId(TEST_SCOPE, 'CAP2', 'P0')}] enriched tweet normalizes with author.account_age_days / is_new_account / follower_quality`, () => {
    const post = tweetToPostItem(RAW_TWEET_WITH_ENRICHMENT);
    expect(post).toBeDefined();
    expect(post.author).toBeDefined();
    expect(post.author.account_age_days).toBe(12);
    expect(post.author.is_new_account).toBe(true);
    // follower_quality = min(1, 50/10) * 0.8 = min(1, 5) * 0.8 = 0.8
    expect(post.author.follower_quality).toBeCloseTo(0.8, 5);
  });

  it(`[${nextTestId(TEST_SCOPE, 'CAP2', 'P1')}] verified author bumps follower_quality multiplier to 1.0`, () => {
    const raw = JSON.parse(JSON.stringify(RAW_TWEET_WITH_ENRICHMENT));
    raw.core.user_results.result.is_blue_verified = true;
    raw.core.user_results.result.legacy.followers_count = 5;
    raw.core.user_results.result.legacy.friends_count = 10;
    const post = tweetToPostItem(raw);
    // follower_quality = min(1, 5/10) * 1.0 = 0.5
    expect(post.author.follower_quality).toBeCloseTo(0.5, 5);
  });

  it(`[${nextTestId(TEST_SCOPE, 'CAP2', 'P0')}] raw tweet without author metrics normalizes WITHOUT enrichment keys (absent stays absent)`, () => {
    const bare = {
      rest_id: '99',
      legacy: {
        full_text: 'bare',
        created_at: new Date().toUTCString(),
        favorite_count: 1,
        retweet_count: 0,
        reply_count: 0,
      },
      // no core.user_results at all — author.* inputs absent
    };
    const post = tweetToPostItem(bare);
    expect(post).toBeDefined();
    // author object itself may be present (flat fields) but enrichment keys must not
    if (post.author) {
      expect(post.author).not.toHaveProperty('account_age_days');
      expect(post.author).not.toHaveProperty('follower_quality');
      expect(post.author).not.toHaveProperty('is_new_account');
    }
  });
});

// ─── CAP-3 — engagement_velocity ───────────────────────────────────────────

describe('CAP-3 — engagement_velocity on twitter PostItem', () => {
  it(`[${nextTestId(TEST_SCOPE, 'CAP3', 'P0')}] post with metrics + timestamp emits engagement_velocity`, () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toUTCString();
    const raw = {
      rest_id: '77',
      legacy: {
        full_text: 'x',
        created_at: tenMinAgo,
        favorite_count: 30,
        retweet_count: 10,
        reply_count: 5,
      },
    };
    const post = tweetToPostItem(raw);
    // (30 + 10 + 5) / 10min = 4.5 interactions/min
    expect(post.engagement_velocity).toBeGreaterThan(4.0);
    expect(post.engagement_velocity).toBeLessThan(5.0);
  });

  it(`[${nextTestId(TEST_SCOPE, 'CAP3', 'P1')}] post without created_at omits engagement_velocity entirely`, () => {
    const raw = {
      rest_id: '78',
      legacy: { full_text: 'x', favorite_count: 10, retweet_count: 5, reply_count: 2 },
    };
    const post = tweetToPostItem(raw);
    expect(post).toBeDefined();
    expect(post.engagement_velocity).toBeUndefined();
  });
});
