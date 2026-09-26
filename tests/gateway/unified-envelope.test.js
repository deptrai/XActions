// tests/gateway/unified-envelope.test.js
// Contract tests for Story 50.3 — Unified Envelope + Request-Id Propagation
// + ErrorEnvelope (Epic 50 — Public Scrape Gateway, AD-5 / C-10).
//
// Covers the spec I/O & Edge-Case Matrix via injected seams
// (_setScrapeImpl/_setEnqueueImpl/_setOperationStore/_setSyncBudgetMs,
// _setStreamPublisher) — real implementations only, no vi.mock module stubs
// (repo mandate).
// by nichxbt

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

import platformRouter from '../../api/routes/platform.js';
import { errorMiddleware } from '../../api/middleware/envelope.js';
import {
  dispatch,
  _setSyncBudgetMs,
  _setScrapeImpl,
  _setEnqueueImpl,
  _setOperationStore,
  _resetDispatch,
  RETRY_AFTER_DEFAULT_MS,
} from '../../api/services/scrapeDispatch.js';
import {
  ERROR_KINDS,
  generateRequestId,
  sanitizeRequestId,
  normalizeData,
  errorKind,
  scrapeErrorKind,
  _setStreamPublisher,
  _resetGatewayEnvelope,
} from '../../api/services/gatewayEnvelope.js';
import { _resetServiceKeyMap } from '../../api/middleware/serviceAuth.js';
import { PlatformError, RateLimitError } from '../../src/core/error-envelope.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

const JEV_KEY = 'sk_jev_test_unified_envelope_01';
const SERVICE_MAP = JSON.stringify({ [JEV_KEY]: { consumer_id: 'jev', tier: 'internal' } });

const ORIGINAL_ENV = { ...process.env };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    return impl ? impl(platform, action, options) : [{ id: 'r1' }, { id: 'r2' }];
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
  // Real errorMiddleware — emits the canonical envelope; Story 50.3's
  // conditional extension appends kind/status/request_id when req.requestId.
  app.use(errorMiddleware);
});

afterEach(() => {
  _resetDispatch();
  _resetServiceKeyMap();
  _resetGatewayEnvelope();
  process.env = { ...ORIGINAL_ENV };
});

/** Assert the unified success-envelope key-set (AD-5) — the "same keys" CAP. */
function expectSuccessEnvelope(body) {
  expect(body.success).toBe(true);
  expect(body.ok).toBe(true); // deprecated mirror — removed in a cleanup story
  expect(typeof body.mode).toBe('string');
  expect(body.metadata).toBeTypeOf('object');
  expect(typeof body.metadata.request_id).toBe('string');
  expect(body.metadata.request_id.length).toBeGreaterThan(0);
  expect(body.stream).toBeTypeOf('object');
  expect(typeof body.stream.enabled).toBe('boolean');
  expect(Array.isArray(body.preview)).toBe(true);
  expect(Array.isArray(body.data)).toBe(true);
}

/** Assert the unified error-envelope key-set (C-10). */
function expectErrorEnvelope(body, status) {
  expect(body.success).toBe(false);
  const e = body.error;
  expect(e).toBeTypeOf('object');
  expect(typeof e.code).toBe('string');
  expect(ERROR_KINDS).toContain(e.kind);
  expect(typeof e.message).toBe('string');
  expect(e.status).toBe(status);
  expect(typeof e.request_id).toBe('string');
  expect(typeof e.retryable).toBe('boolean');
  if (e.retryable) expect(typeof e.retry_after_ms).toBe('number');
}

// ─── Unit: request-id helpers ───────────────────────────────────────────────

describe('sanitizeRequestId / generateRequestId', () => {
  it('honours safe tokens verbatim (allowlist [A-Za-z0-9_\\-:.] ≤128)', () => {
    expect(sanitizeRequestId('abc-123_X.Y:z')).toBe('abc-123_X.Y:z');
    expect(sanitizeRequestId('t1')).toBe('t1');
  });
  it('rejects hostile/absent values — newline, >128 chars, non-string, empty', () => {
    expect(sanitizeRequestId('bad\nid')).toBeNull();
    expect(sanitizeRequestId('x'.repeat(129))).toBeNull();
    expect(sanitizeRequestId(42)).toBeNull();
    expect(sanitizeRequestId('')).toBeNull();
    expect(sanitizeRequestId('has space')).toBeNull();
    expect(sanitizeRequestId(undefined)).toBeNull();
  });
  it('generateRequestId → req_<ts>_<8hex>', () => {
    expect(generateRequestId()).toMatch(/^req_\d+_[0-9a-f]{8}$/);
  });
});

describe('normalizeData — array-always', () => {
  it('arrays pass through; singleton wraps; null/undefined → []', () => {
    expect(normalizeData([1, 2])).toEqual([1, 2]);
    expect(normalizeData({ a: 1 })).toEqual([{ a: 1 }]);
    expect(normalizeData(null)).toEqual([]);
    expect(normalizeData(undefined)).toEqual([]);
  });
});

describe('errorKind / scrapeErrorKind — closed enum mapping (C-10)', () => {
  it('covers every enum member mapping', () => {
    expect(errorKind('auth')).toBe('auth');
    expect(errorKind('auth_expired')).toBe('auth');
    expect(errorKind('validation')).toBe('validation');
    expect(errorKind('not_found')).toBe('validation');
    expect(errorKind('invalid_args')).toBe('validation');
    expect(errorKind('rate_limit')).toBe('upstream_rate_limit');
    expect(errorKind('bot_challenge')).toBe('proxy_ip_block');
    expect(errorKind('proxy_exhausted')).toBe('proxy_ip_block');
    expect(errorKind('upstream_error')).toBe('upstream_error');
    expect(errorKind('consumer_quota')).toBe('consumer_quota'); // reserved 50.4
    expect(errorKind('bogus')).toBe('internal');
    expect(errorKind(undefined)).toBe('internal');
  });
  it('untyped Error → upstream_error (never internal — it is an upstream fail)', () => {
    expect(scrapeErrorKind(new Error('boom'))).toBe('upstream_error');
    expect(scrapeErrorKind({ type: 'rate_limit' })).toBe('upstream_rate_limit');
    expect(scrapeErrorKind(null)).toBe('upstream_error');
  });
});

// ─── Route-level contract: HAPPY_SYNC + identical key-set across platforms ──

describe('POST /api/platform/:platform/scrape — unified envelope', () => {
  it('HAPPY_SYNC: reddit/search sync → 200 unified envelope, preview===data.slice(0,10)', async () => {
    const payload = Array.from({ length: 14 }, (_, i) => ({ id: `r${i}` }));
    _setScrapeImpl(async () => payload);
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'search', mode: 'sync', query: 'solana' });
    expect(res.status).toBe(200);
    expectSuccessEnvelope(res.body);
    expect(res.body.mode).toBe('sync');
    expect(res.body.metadata.platform).toBe('reddit');
    expect(res.body.metadata.action).toBe('search');
    expect(res.body.metadata.consumer_id).toBe('internal');
    expect(typeof res.body.metadata.duration_ms).toBe('number');
    expect(res.body.metadata.sync_capable).toBe(true);
    expect(res.body.data).toEqual(payload);
    expect(res.body.preview).toEqual(payload.slice(0, 10));
    expect(res.body.preview.length).toBe(10);
    // Deprecated verbatim mirror for in-repo apps/web (D-1)
    expect(res.body.result).toEqual(payload);
  });

  it('EDGE_NONARRAY_RESULT: singleton object result → data:[r], preview:[r], result verbatim', async () => {
    _setScrapeImpl(async () => ({ username: 'spez', karma: 1 }));
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'search', mode: 'sync' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ username: 'spez', karma: 1 }]);
    expect(res.body.preview).toEqual([{ username: 'spez', karma: 1 }]);
    expect(res.body.result).toEqual({ username: 'spez', karma: 1 });
  });

  it('EDGE_NULL_RESULT: null result → data:[], preview:[], result:null', async () => {
    _setScrapeImpl(async () => null);
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'search', mode: 'sync' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.preview).toEqual([]);
    expect(res.body.result).toBeNull();
  });

  it('CAP-4: identical top-level success keys on reddit sync + x async + batch', async () => {
    const sync = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'search', mode: 'sync' });
    const asyncRes = await request(app)
      .post('/api/platform/x/scrape')
      .send({ action: 'search', mode: 'async' });
    const batch = await request(app)
      .post('/api/platform/all/scrape')
      .send({ action: 'search', platform: ['reddit', 'x'] });
    const CORE_KEYS = ['success', 'ok', 'mode', 'metadata', 'stream', 'preview', 'data'];
    for (const body of [sync.body, asyncRes.body, batch.body]) {
      for (const k of CORE_KEYS) expect(body).toHaveProperty(k);
      expect(typeof body.metadata.request_id).toBe('string');
    }
  });

  it('HAPPY_ASYNC: explicit async → 202 envelope, data/preview empty, stream no cursor', async () => {
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'search', mode: 'async' });
    expect(res.status).toBe(202);
    expectSuccessEnvelope(res.body);
    expect(res.body.mode).toBe('async');
    expect(res.body.operationId).toBe('opq_1');
    expect(res.body.statusUrl).toBe(`/api/ai/action/status/${res.body.operationId}`);
    expect(res.body.data).toEqual([]);
    expect(res.body.preview).toEqual([]);
    expect(res.body.stream).not.toHaveProperty('cursor');
  });

  it('HAPPY_DEGRADE: sync ceiling breach → 202 envelope + degraded_reason + Retry-After', async () => {
    _setSyncBudgetMs(50);
    _setScrapeImpl(async () => { await sleep(250); return { slow: true }; });
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'search', mode: 'sync' });
    expect(res.status).toBe(202);
    expectSuccessEnvelope(res.body);
    expect(res.body.mode).toBe('async');
    expect(res.body.degraded_reason).toBe('upstream_timeout');
    expect(res.body.retry_after_ms).toBe(RETRY_AFTER_DEFAULT_MS);
    expect(res.headers['retry-after']).toBe(String(Math.ceil(RETRY_AFTER_DEFAULT_MS / 1000)));
    expect(res.body.metadata.request_id).toBeTypeOf('string');
    expect(res.body.data).toEqual([]);
  });

  // ── Request-id propagation ────────────────────────────────────────────────

  it('HAPPY_REQID_INBOUND: X-Request-Id honoured verbatim + echoed via header + metadata', async () => {
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .set('X-Request-Id', 'my-trace-9')
      .send({ action: 'search', mode: 'sync' });
    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toBe('my-trace-9');
    expect(res.body.metadata.request_id).toBe('my-trace-9');
  });

  it('HAPPY_REQID_GEN: no inbound header → generated req_* + echo', async () => {
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'search', mode: 'sync' });
    expect(res.status).toBe(200);
    expect(res.body.metadata.request_id).toMatch(/^req_\d+_[0-9a-f]{8}$/);
    expect(res.headers['x-request-id']).toBe(res.body.metadata.request_id);
  });

  it('EDGE_BAD_REQID: hostile X-Request-Id (newline/oversized) → fresh generated id, never echoed', async () => {
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .set('X-Request-Id', 'x'.repeat(200))
      .send({ action: 'search', mode: 'sync' });
    expect(res.status).toBe(200);
    expect(res.body.metadata.request_id).toMatch(/^req_\d+_[0-9a-f]{8}$/);
    expect(res.headers['x-request-id']).toBe(res.body.metadata.request_id);
  });

  it('HAPPY_TRACEPARENT: inbound traceparent lands verbatim in metadata', async () => {
    const tp = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .set('traceparent', tp)
      .send({ action: 'search', mode: 'sync' });
    expect(res.status).toBe(200);
    expect(res.body.metadata.traceparent).toBe(tp);
  });

  // ── Error envelope (C-10) ─────────────────────────────────────────────────

  it('ERR_VALIDATION: mode:turbo → 400 error envelope kind:validation + request_id', async () => {
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .set('X-Request-Id', 'bad-mode-1')
      .send({ action: 'search', mode: 'turbo' });
    expect(res.status).toBe(400);
    expectErrorEnvelope(res.body, 400);
    expect(res.body.error.code).toBe('XACT_4001');
    expect(res.body.error.kind).toBe('validation');
    expect(res.body.error.request_id).toBe('bad-mode-1');
    expect(res.body.error.retryable).toBe(false);
    expect(res.headers['x-request-id']).toBe('bad-mode-1');
  });

  it('route-level guard: missing action → 400 error envelope', async () => {
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ mode: 'sync' });
    expect(res.status).toBe(400);
    expectErrorEnvelope(res.body, 400);
    expect(res.body.error.kind).toBe('validation');
    expect(res.body.error.message).toBe('action is required');
  });

  it('route-level guard: non-array accountIds → 400 error envelope', async () => {
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'search', accountIds: 'not-an-array' });
    expect(res.status).toBe(400);
    expectErrorEnvelope(res.body, 400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.kind).toBe('validation');
  });

  it('ERR_AUTH: unknown Bearer → 401 via errorMiddleware, kind:auth + request_id (mw before auth)', async () => {
    process.env.XACTIONS_SERVICE_KEYS = SERVICE_MAP;
    _resetServiceKeyMap();
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .set('Authorization', 'Bearer sk_bogus_unknown_key')
      .set('X-Request-Id', 'auth-trace-1')
      .send({ action: 'search', mode: 'sync' });
    expect(res.status).toBe(401);
    expectErrorEnvelope(res.body, 401);
    expect(res.body.error.kind).toBe('auth');
    expect(res.body.error.request_id).toBe('auth-trace-1');
    expect(res.headers['x-request-id']).toBe('auth-trace-1');
  });

  it('ERR_UPSTREAM: untyped Error in sync lane → 500 kind:upstream_error, no raw stack', async () => {
    _setScrapeImpl(async () => { throw new Error('upstream exploded internally'); });
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'search', mode: 'sync' });
    expect(res.status).toBe(500);
    expectErrorEnvelope(res.body, 500);
    expect(res.body.error.kind).toBe('upstream_error');
    expect(res.body.error.message).toBe('upstream exploded internally');
    expect(res.body.error).not.toHaveProperty('stack');
    expect(res.body.error.retryable).toBe(false);
  });

  it('ERR_TYPED_NOTFOUND: PlatformError not_found → 404 kind:validation', async () => {
    _setScrapeImpl(async () => {
      throw new PlatformError({ code: 'XACT_4004', type: 'not_found', statusCode: 404, message: 'no such coin' });
    });
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'search', mode: 'sync' });
    expect(res.status).toBe(404);
    expectErrorEnvelope(res.body, 404);
    expect(res.body.error.kind).toBe('validation');
    expect(res.body.error.code).toBe('XACT_4004');
    expect(res.body.error.retryable).toBe(false);
  });

  it('typed retryable scrape error that does NOT degrade → error envelope retryable+retry_after_ms', async () => {
    // 'proxy_exhausted' is retryable but NOT degrade-classified (no cf/rate)
    _setScrapeImpl(async () => {
      const e = new PlatformError({ code: 'XACT_5031', type: 'proxy_exhausted', statusCode: 503, message: 'all proxies dead' });
      e.retryAfterMs = 5000;
      throw e;
    });
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'search', mode: 'sync' });
    expect(res.status).toBe(503);
    expectErrorEnvelope(res.body, 503);
    expect(res.body.error.kind).toBe('proxy_ip_block');
    expect(res.body.error.retryable).toBe(true);
    expect(res.body.error.retry_after_ms).toBe(5000);
    expect(res.headers['retry-after']).toBe('5');
  });

  it('ERR_UNAVAILABLE: async + enqueue infra fail → 503 kind:internal + retryable + Retry-After', async () => {
    _setEnqueueImpl(async () => { throw new Error('redis down'); });
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'user', mode: 'async' });
    expect(res.status).toBe(503);
    expectErrorEnvelope(res.body, 503);
    expect(res.body.error.kind).toBe('internal');
    expect(res.body.error.retryable).toBe(true);
    expect(res.body.error.retry_after_ms).toBe(RETRY_AFTER_DEFAULT_MS);
    expect(res.headers['retry-after']).toBe(String(Math.ceil(RETRY_AFTER_DEFAULT_MS / 1000)));
  });

  // ── Stream block ──────────────────────────────────────────────────────────

  it('EDGE_STREAM_OFF: REDIS_STREAM_ENABLED unset → stream:{enabled:false}', async () => {
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'search', mode: 'sync' });
    expect(res.status).toBe(200);
    expect(res.body.stream).toEqual({ enabled: false });
  });

  it('EDGE_STREAM_ON_NO_CURSOR: enabled + publisher xinfo throws → name present, cursor omitted, still 200', async () => {
    process.env.REDIS_STREAM_ENABLED = '1';
    _setStreamPublisher({
      streamKey: 'stream:social:raw_posts',
      xinfo: async () => { throw new Error('redis hiccup'); },
      ensureClient: async () => null,
    });
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'search', mode: 'sync' });
    expect(res.status).toBe(200);
    expect(res.body.stream.enabled).toBe(true);
    expect(res.body.stream.name).toBe('stream:social:raw_posts');
    expect(res.body.stream).not.toHaveProperty('cursor');
  });

  it('stream cursor populated when publisher reports a last-entry id (XINFO last-generated-id)', async () => {
    process.env.REDIS_STREAM_ENABLED = '1';
    _setStreamPublisher({
      streamKey: 'stream:social:raw_posts',
      xinfo: async () => ({ 'last-generated-id': '1727300000000-0' }),
    });
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'search', mode: 'sync' });
    expect(res.status).toBe(200);
    expect(res.body.stream).toMatchObject({
      enabled: true,
      name: 'stream:social:raw_posts',
      cursor: '1727300000000-0',
    });
  });

  // ── Batch envelope ────────────────────────────────────────────────────────

  it('BATCH_200: platform:[reddit,x] default → 200 envelope + results[] + aggregated data + platforms[]', async () => {
    _setScrapeImpl(async (p) => [{ id: `post-${p}` }]);
    const res = await request(app)
      .post('/api/platform/all/scrape')
      .set('X-Request-Id', 'batch-1')
      .send({ action: 'search', platform: ['reddit', 'x'] });
    expect(res.status).toBe(200);
    expectSuccessEnvelope(res.body);
    expect(res.body.mode).toBe('sync');
    expect(res.body.metadata.request_id).toBe('batch-1');
    expect(res.body.metadata.platforms).toEqual(['reddit', 'twitter']);
    expect(res.body.metadata).not.toHaveProperty('platform');
    expect(res.body.metadata).not.toHaveProperty('sync_capable'); // batch omits
    expect(res.body.results).toHaveLength(2);
    const reddit = res.body.results.find((r) => r.platform === 'reddit');
    expect(reddit).toMatchObject({ success: true, status: 'completed' });
    // data = concat of completed entries
    expect(res.body.data).toEqual([{ id: 'post-reddit' }]);
    expect(res.body.preview).toEqual([{ id: 'post-reddit' }]);
  });

  it('BATCH_202: mode:async → 202 envelope + results[] + operationIds[] + empty data', async () => {
    const res = await request(app)
      .post('/api/platform/all/scrape')
      .send({ action: 'search', mode: 'async', platform: ['x', 'reddit'] });
    expect(res.status).toBe(202);
    expectSuccessEnvelope(res.body);
    expect(res.body.operationIds).toHaveLength(2);
    expect(res.body.results).toHaveLength(2);
    expect(res.body.data).toEqual([]);
  });

  it('per-entry batch error carries retryable when derivable (503 enqueue infra fail)', async () => {
    _setEnqueueImpl(async () => { throw new Error('redis down'); });
    const res = await request(app)
      .post('/api/platform/all/scrape')
      .send({ action: 'search', mode: 'async', platform: ['reddit'] });
    // Every entry failed → 503 top-level
    expect(res.status).toBe(503);
    expectErrorEnvelope(res.body, 503);
    expect(res.body.results[0].success).toBe(false);
  });

  // ── pumpfun inert action (Story 50.6 — contract test asserts error path) ──

  it('pumpfun/fetch_coin_meta (inert until 50.6) → error envelope same shape as every error', async () => {
    const res = await request(app)
      .post('/api/platform/pumpfun/scrape')
      .send({ action: 'fetch_coin_meta', mode: 'sync', mint: 'So111' });
    // Manifest declares syncCapable but actionMap doesn't implement → Unknown action 400
    expect(res.status).toBe(400);
    expectErrorEnvelope(res.body, 400);
    expect(res.body.error.kind).toBe('validation');
  });

  // ── errorMiddleware conditional extension — non-gateway requests unchanged ─

  it('EDGE_NONSCRAPE_ERROR: request without requestId → byte-identical legacy error shape', async () => {
    const { ApiError, errorMiddleware: em } = await import('../../api/middleware/envelope.js');
    const res = {
      statusCode: 0,
      body: undefined,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; return this; },
    };
    em(new ApiError('VALIDATION_FAILED', 400, 'bad input', { issues: [] }), {}, res, () => {});
    expect(res.body).toEqual({
      success: false,
      error: { code: 'VALIDATION_FAILED', message: 'bad input', details: { issues: [] } },
    });
  });

  it('errorMiddleware + req.requestId → appends kind/status/request_id/retryable', async () => {
    const { ApiError, errorMiddleware: em } = await import('../../api/middleware/envelope.js');
    const res = {
      statusCode: 0,
      body: undefined,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; return this; },
    };
    em(new ApiError('XACT_4001', 401, 'Invalid Bearer token', undefined, 'auth'), { requestId: 'rid-9' }, res, () => {});
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatchObject({
      code: 'XACT_4001',
      kind: 'auth',
      status: 401,
      request_id: 'rid-9',
      retryable: false,
    });
  });

  // ── Direct dispatch() call (requestId threading without HTTP) ─────────────

  it('dispatch() direct: validation outcome carries request_id when requestId arg passed', async () => {
    const outcome = await dispatch({
      pathPlatform: 'reddit',
      body: { action: 'search', mode: 'turbo' },
      action: 'search',
      userId: null,
      consumer: null,
      requestId: 'direct-rid-1',
    });
    expect(outcome.status).toBe(400);
    expect(outcome.body.error.request_id).toBe('direct-rid-1');
    expect(outcome.body.error.kind).toBe('validation');
  });
});
