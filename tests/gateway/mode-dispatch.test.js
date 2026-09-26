// tests/gateway/mode-dispatch.test.js
// Contract tests for Story 50.2 — Sync/Async Mode Dispatch + 202 Degrade Contract.
// Covers the spec I/O & Edge-Case Matrix via injected seams
// (_setScrapeImpl/_setEnqueueImpl/_setOperationStore/_setSyncBudgetMs) —
// real implementations only, no vi.mock module stubs (repo mandate).
// by nichxbt

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

import prisma from '../../api/lib/prisma.js';
import platformRouter from '../../api/routes/platform.js';
import actionsRouter from '../../api/routes/ai/actions.js';
import {
  addJob,
  getJob,
  normalizeBullState,
  operationsQueue,
  _setOperationsQueue,
  _resetOperationsQueue,
} from '../../api/services/jobQueue.js';
import {
  dispatch,
  resolveMode,
  classifyDegrade,
  runSyncWithCeiling,
  sanitizeOptions,
  assertSerializableOptions,
  canonicalPlatforms,
  _setSyncBudgetMs,
  _setScrapeImpl,
  _setEnqueueImpl,
  _setOperationStore,
  _resetDispatch,
  MAX_BATCH_PLATFORMS,
  RETRY_AFTER_DEFAULT_MS,
} from '../../api/services/scrapeDispatch.js';
import { isSyncCapable, DESCRIPTORS } from '../../src/scrapers/index.js';
import { BotChallengeError, RateLimitError, PlatformError } from '../../src/core/error-envelope.js';
import { _resetServiceKeyMap } from '../../api/middleware/serviceAuth.js';
import { seedTestUser, cleanupTestUser, makeTestUserId, TEST_SECRET } from '../api/fixtures/test-user.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

const JEV_KEY = 'sk_jev_test_mode_dispatch_0001';
const SERVICE_MAP = JSON.stringify({ [JEV_KEY]: { consumer_id: 'jev', tier: 'internal' } });

const ORIGINAL_ENV = { ...process.env };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Mirror of platform.js encrypt() — AES-256-GCM, scrypt-derived key, hex
// salt:iv:authTag:ciphertext. Same KEY_MATERIAL so resolveAccountCookie can
// decrypt rows seeded by this fixture.
const ENC_KEY_MATERIAL = process.env.SESSION_SECRET || process.env.JWT_SECRET || 'dev-only-key';
function encryptCookie(plaintext) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(ENC_KEY_MATERIAL, salt, 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let enc = cipher.update(plaintext, 'utf8', 'hex');
  enc += cipher.final('hex');
  return `${salt.toString('hex')}:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc}`;
}

/** In-memory Operation store seam — mimics prisma.operation create/update. */
function makeFakeStore() {
  const rows = new Map();
  let seq = 0;
  return {
    rows,
    /** @param {Record<string, unknown>} data */
    async create(data) {
      const id = `op_${++seq}`;
      const row = { id, ...data };
      rows.set(id, row);
      return row;
    },
    /** @param {string} id @param {Record<string, unknown>} data */
    async update(id, data) {
      const row = rows.get(id) || { id };
      Object.assign(row, data);
      rows.set(id, row);
      return row;
    },
    /** Conditional write mirroring prisma updateMany where status='processing'. */
    async updateIfProcessing(id, data) {
      const row = rows.get(id);
      if (!row || row.status !== 'processing') return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
  };
}

/** In-memory enqueue seam — captures addJob('scrape', data, opts) calls. */
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

/** Default scrape seam — resolves instantly with a marker payload. */
function makeScrapeSpy(impl) {
  const calls = [];
  const fn = async (platform, action, options) => {
    calls.push({ platform, action, options });
    return impl ? impl(platform, action, options) : { ok_data: true, platform };
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
  process.env.NODE_ENV = 'development';
  _resetServiceKeyMap();
  _resetDispatch();
  _resetOperationsQueue();

  store = makeFakeStore();
  enq = makeFakeEnqueue();
  scrapeSpy = makeScrapeSpy();
  _setOperationStore(store);
  _setEnqueueImpl(enq.fn);
  _setScrapeImpl(scrapeSpy.fn);

  app = express();
  app.use(express.json());
  app.use('/api/platform', platformRouter);
  // Real status poll route — GET /api/ai/action/status/:operationId
  app.use('/api/ai/action', actionsRouter);
  app.use((err, req, res, _next) => {
    const status = err.statusCode || err.status || 500;
    res.status(status).json({ success: false, error: { code: err.code || 'INTERNAL', message: err.message } });
  });
});

afterEach(() => {
  _resetDispatch();
  _resetServiceKeyMap();
  _resetOperationsQueue();
  process.env = { ...ORIGINAL_ENV };
});

// ─── Unit tests ──────────────────────────────────────────────────────────────

describe('resolveMode', () => {
  it('sync + capable → sync', () => {
    expect(resolveMode({ capable: true, requestedMode: 'sync' })).toBe('sync');
  });
  it("sync + not capable → 'not_sync_capable' (contract violation, never silent)", () => {
    expect(resolveMode({ capable: false, requestedMode: 'sync' })).toBe('not_sync_capable');
  });
  it('async → async regardless of capability (sync→async override allowed)', () => {
    expect(resolveMode({ capable: true, requestedMode: 'async' })).toBe('async');
    expect(resolveMode({ capable: false, requestedMode: 'async' })).toBe('async');
  });
  it('absent → manifest decides (capable→sync, unlisted→async)', () => {
    expect(resolveMode({ capable: true, requestedMode: undefined })).toBe('sync');
    expect(resolveMode({ capable: false, requestedMode: undefined })).toBe('async');
  });
});

describe('classifyDegrade — err.type driven (not code list)', () => {
  it('bot_challenge → cf_challenge', () => {
    expect(classifyDegrade(new BotChallengeError({ message: 'cf' }))).toBe('cf_challenge');
  });
  it('rate_limit → upstream_rate_limit (incl. local-cap XACT_4291 which is still type rate_limit)', () => {
    expect(classifyDegrade(new RateLimitError({ code: 'XACT_4291', message: 'cap' }))).toBe('upstream_rate_limit');
  });
  it('non-retryable types → null', () => {
    expect(classifyDegrade(new PlatformError({ type: 'invalid_args', code: 'XACT_4001', message: 'bad' }))).toBeNull();
    expect(classifyDegrade(new Error('plain'))).toBeNull();
    expect(classifyDegrade(null)).toBeNull();
  });
});

describe('sanitizeOptions — dispatch fields stripped; credentials stay in RUN options (sync lane)', () => {
  it('strips mode/platform/accountIds/action/callbackUrl/options wrapper; merges body.options under flat fields', () => {
    const out = sanitizeOptions({
      action: 'search',
      mode: 'async',
      platform: ['x', 'reddit'],
      accountIds: ['a1'],
      callbackUrl: 'https://hook.example/x',
      sessionCookie: 'SECRET',
      authToken: 'SECRET',
      query: 'solana',
      options: { limit: 5 },
    });
    expect(out.query).toBe('solana');
    expect(out.limit).toBe(5);
    for (const k of ['mode', 'platform', 'accountIds', 'action', 'options', 'callbackUrl']) {
      expect(out).not.toHaveProperty(k);
    }
    // Credential keys are KEPT in run options — the legacy body-cookie sync
    // flow needs them; persistence (tracking config / Bull data) strips them.
    expect(out.sessionCookie).toBe('SECRET');
    expect(out.authToken).toBe('SECRET');
  });
});

describe('assertSerializableOptions', () => {
  it('rejects functions and circular structures', () => {
    expect(() => assertSerializableOptions({ fn: () => {} })).toThrow(/JSON-serializable/);
    const c = {}; c.self = c;
    expect(() => assertSerializableOptions({ c })).toThrow(/JSON-serializable/);
  });
  it('accepts DIAMONDS — a shared reference via two paths is valid JSON', () => {
    const shared = { v: 1 };
    expect(() => assertSerializableOptions({ a: shared, b: shared })).not.toThrow();
    expect(() => assertSerializableOptions({ list: [shared, shared], nested: { again: shared } })).not.toThrow();
  });
  it('rejects lossy serializers: Map/Set/Date/RegExp and non-finite numbers', () => {
    expect(() => assertSerializableOptions({ m: new Map() })).toThrow(/JSON-serializable/);
    expect(() => assertSerializableOptions({ s: new Set([1]) })).toThrow(/JSON-serializable/);
    expect(() => assertSerializableOptions({ d: new Date() })).toThrow(/JSON-serializable/);
    expect(() => assertSerializableOptions({ r: /x/ })).toThrow(/JSON-serializable/);
    expect(() => assertSerializableOptions({ n: NaN })).toThrow(/JSON-serializable/);
    expect(() => assertSerializableOptions({ n: Infinity })).toThrow(/JSON-serializable/);
    expect(() => assertSerializableOptions({ nested: { deep: -Infinity } })).toThrow(/JSON-serializable/);
  });
  it('accepts plain JSON-safe options', () => {
    expect(() => assertSerializableOptions({ query: 'x', limit: 5, tags: ['a'] })).not.toThrow();
  });
});

describe('canonicalPlatforms — DESCRIPTORS aliases[0] dedupe (D-3)', () => {
  it('returns deduped canonical names and is a superset including non-whitelisted platforms', () => {
    const list = canonicalPlatforms(DESCRIPTORS);
    expect(list.length).toBeGreaterThanOrEqual(26);
    expect(new Set(list).size).toBe(list.length);
    expect(list).toContain('reddit');
    expect(list).toContain('pumpfun');
    expect(list).toContain('github'); // descriptor platform not in VALID_PLATFORMS — intended superset
    expect(list).not.toContain('rdt'); // alias deduped to canonical 'reddit'
  });
});

describe('isSyncCapable — manifest check on requested AND mapped action', () => {
  it('reddit search/subreddit/post_comments are sync-capable', () => {
    expect(isSyncCapable('reddit', 'search')).toBe(true);
    expect(isSyncCapable('reddit', 'subreddit')).toBe(true);
    expect(isSyncCapable('reddit', 'post_comments')).toBe(true);
  });
  it('mapped aliases inherit capability (posts→subreddit, thread→post_comments)', () => {
    expect(isSyncCapable('reddit', 'posts')).toBe(true);
    expect(isSyncCapable('reddit', 'thread')).toBe(true);
  });
  it('unlisted reddit actions + pumpfun non-manifest actions are async-only', () => {
    expect(isSyncCapable('reddit', 'followers')).toBe(false);
    expect(isSyncCapable('pumpfun', 'fetch_mint_social')).toBe(false);
  });
  it('pumpfun fetch_coin_meta is sync-capable (Story 50.6 manifest is declared)', () => {
    expect(isSyncCapable('pumpfun', 'fetch_coin_meta')).toBe(true);
  });
  it('platform without manifest / unknown platform → false', () => {
    expect(isSyncCapable('x', 'search')).toBe(false); // twitter ships no syncCapableActions yet
    expect(isSyncCapable('bogus', 'search')).toBe(false);
  });
});

// ─── runSyncWithCeiling — ceiling race + detached tracking (D-4) ──────────────

describe('runSyncWithCeiling', () => {
  it('fast completion → {outcome:completed} within budget', async () => {
    const out = await runSyncWithCeiling({
      run: async () => ({ data: 1 }),
      platform: 'reddit', action: 'search', options: {}, userId: null, consumerId: 'internal',
    });
    expect(out.outcome).toBe('completed');
    expect(out.result).toEqual({ data: 1 });
  });

  it('ceiling breach → degraded upstream_timeout + detached row settle writes completed', async () => {
    _setSyncBudgetMs(50);
    const out = await runSyncWithCeiling({
      run: async () => { await sleep(200); return { slow: true }; },
      platform: 'reddit', action: 'search', options: {}, userId: null, consumerId: 'internal',
    });
    expect(out.outcome).toBe('degraded');
    expect(out.reason).toBe('upstream_timeout');
    expect(out.operationId).toMatch(/^op_/);
    // Row created as 'processing'
    expect(store.rows.get(out.operationId).status).toBe('processing');
    // Detached continuation writes the result when the promise lands (D-4)
    await sleep(350);
    const row = store.rows.get(out.operationId);
    expect(row.status).toBe('completed');
    expect(JSON.parse(row.result)).toEqual({ slow: true });
  });

  it('EDGE_LATE_SETTLE: rejection after the ceiling does not crash — row settles failed', async () => {
    _setSyncBudgetMs(50);
    const out = await runSyncWithCeiling({
      run: async () => { await sleep(150); throw new Error('late boom'); },
      platform: 'reddit', action: 'search', options: {}, userId: null, consumerId: 'internal',
    });
    expect(out.outcome).toBe('degraded');
    await sleep(300);
    const row = store.rows.get(out.operationId);
    expect(row.status).toBe('failed');
    expect(row.error).toContain('late boom');
  });

  it('EDGE_QUEUE_DOWN: create fails + scrape already REJECTED → queue_fallback (a retry, not a duplicate)', async () => {
    _setSyncBudgetMs(50);
    const failingStore = makeFakeStore();
    // Create must fail AFTER the scrape rejects so the settle-aware branch
    // sees a rejected promise — re-enqueue is then a retry of a failed
    // execution, not a second execution of live work.
    failingStore.create = async () => { await sleep(150); throw new Error('prisma down'); };
    _setOperationStore(failingStore);

    const out = await runSyncWithCeiling({
      run: async () => { await sleep(80); throw new Error('upstream exploded'); },
      platform: 'reddit', action: 'search', options: { q: 1 }, userId: null, consumerId: 'jev', apiKeyRequired: true,
    });
    expect(out.outcome).toBe('degraded');
    expect(out.reason).toBe('queue_fallback');
    expect(enq.calls).toHaveLength(1);
    expect(enq.calls[0].type).toBe('scrape');
    expect(enq.calls[0].data.consumerId).toBe('jev');
    expect(enq.calls[0].data.apiKeyRequired).toBe(true);
  });

  it('EDGE_QUEUE_DOWN: create fails + scrape still IN-FLIGHT → unavailable, NO enqueue (no double execution — spec Never)', async () => {
    _setSyncBudgetMs(50);
    const failingStore = makeFakeStore();
    failingStore.create = async () => { throw new Error('prisma down'); };
    _setOperationStore(failingStore);

    const out = await runSyncWithCeiling({
      run: async () => { await sleep(500); return { still: 'running' }; },
      platform: 'reddit', action: 'search', options: {}, userId: null, consumerId: null,
    });
    expect(out.outcome).toBe('unavailable');
    // The in-flight promise is NEVER re-enqueued — zero Bull calls.
    expect(enq.calls).toHaveLength(0);
  });

  it('EDGE_QUEUE_DOWN: create fails + scrape already RESOLVED → normal completed outcome', async () => {
    _setSyncBudgetMs(50);
    const failingStore = makeFakeStore();
    failingStore.create = async () => { await sleep(120); throw new Error('prisma down'); };
    _setOperationStore(failingStore);

    const out = await runSyncWithCeiling({
      run: async () => { await sleep(80); return { done: true }; },
      platform: 'reddit', action: 'search', options: {}, userId: null, consumerId: null,
    });
    expect(out.outcome).toBe('completed');
    expect(out.result).toEqual({ done: true });
    expect(enq.calls).toHaveLength(0);
  });

  it('EDGE_QUEUE_DOWN: falsy row.id → settle-aware fallback (never emits .../undefined statusUrl)', async () => {
    _setSyncBudgetMs(50);
    const badRowStore = makeFakeStore();
    badRowStore.create = async () => { await sleep(120); return {}; }; // no id
    _setOperationStore(badRowStore);

    const out = await runSyncWithCeiling({
      run: async () => { await sleep(80); throw new Error('upstream exploded'); },
      platform: 'reddit', action: 'search', options: {}, userId: null, consumerId: null,
    });
    // scrape rejected before the falsy-id row landed → retry via queue_fallback
    expect(out.outcome).toBe('degraded');
    expect(out.reason).toBe('queue_fallback');
    expect(enq.calls[0].jobId).toMatch(/^opq_/);
  });

  it('EDGE_QUEUE_DOWN worst case: scrape rejected + tracking + enqueue both fail → unavailable', async () => {
    _setSyncBudgetMs(50);
    const failingStore = makeFakeStore();
    failingStore.create = async () => { await sleep(150); throw new Error('prisma down'); };
    _setOperationStore(failingStore);
    _setEnqueueImpl(async () => { throw new Error('redis down'); });

    const out = await runSyncWithCeiling({
      run: async () => { await sleep(80); throw new Error('upstream exploded'); },
      platform: 'reddit', action: 'search', options: {}, userId: null, consumerId: null,
    });
    expect(out.outcome).toBe('unavailable');
  });

  it('detached settle never clobbers a mid-flight cancel (updateIfProcessing guard)', async () => {
    _setSyncBudgetMs(50);
    const out = await runSyncWithCeiling({
      run: async () => { await sleep(150); return { done: true }; },
      platform: 'reddit', action: 'search', options: {}, userId: null, consumerId: null,
    });
    expect(out.outcome).toBe('degraded');
    // A cancelJob lands while the scrape is still in-flight.
    store.rows.get(out.operationId).status = 'cancelled';
    await sleep(300);
    const row = store.rows.get(out.operationId);
    expect(row.status).toBe('cancelled');
    expect(row.result).toBeUndefined();
  });

  it('detached settle writes typed error fields into config.lastError (cf vs crash discrimination)', async () => {
    _setSyncBudgetMs(50);
    const cfErr = new Error('cf wall');
    cfErr.code = 'XACT_4030';
    cfErr.type = 'bot_challenge';
    cfErr.statusCode = 403;
    const out = await runSyncWithCeiling({
      run: async () => { await sleep(150); throw cfErr; },
      platform: 'reddit', action: 'search', options: { q: 'x' }, userId: null, consumerId: null,
    });
    expect(out.outcome).toBe('degraded');
    await sleep(300);
    const row = store.rows.get(out.operationId);
    expect(row.status).toBe('failed');
    expect(row.error).toBe('cf wall');
    const cfg = JSON.parse(row.config);
    expect(cfg.lastError).toMatchObject({ code: 'XACT_4030', type: 'bot_challenge', statusCode: 403 });
  });
});

// ─── Route-level contract tests (supertest + injected seams) ────────────────

describe('POST /api/platform/:platform/scrape — mode dispatch', () => {
  it('HAPPY_SYNC: mode:sync on capable action → 200 {ok:true, mode:sync, result}', async () => {
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'search', mode: 'sync', query: 'solana memecoin' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.mode).toBe('sync');
    expect(res.body.platform).toBe('reddit');
    expect(res.body.action).toBe('search');
    expect(res.body.result).toEqual({ ok_data: true, platform: 'reddit' });
    expect(scrapeSpy.calls).toHaveLength(1);
  });

  it('options strip: dispatch fields never reach scrape(); credential keys DO on the sync lane (legacy body-cookie)', async () => {
    await request(app)
      .post('/api/platform/reddit/scrape')
      .send({
        action: 'search',
        mode: 'sync',
        platform: 'reddit',
        callbackUrl: 'https://hook.example/x',
        sessionCookie: 'LEGACY_COOKIE',
        password: 'LEGACY_PW',
        clientSecret: 'LEGACY_SECRET',
        query: 'hi',
      });
    expect(scrapeSpy.calls).toHaveLength(1);
    const options = scrapeSpy.calls[0].options;
    expect(options.query).toBe('hi');
    for (const k of ['mode', 'platform', 'accountIds', 'callbackUrl', 'options']) {
      expect(options).not.toHaveProperty(k);
    }
    // Sync-lane credential pass-through — the legacy flow depends on it.
    expect(options.sessionCookie).toBe('LEGACY_COOKIE');
    expect(options.password).toBe('LEGACY_PW');
    expect(options.clientSecret).toBe('LEGACY_SECRET');
  });

  it('EDGE_CREDS_ASYNC: credential keys + async lane → 400 validation (explicit AND manifest-default)', async () => {
    // Explicit async — queued work cannot carry secrets.
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'user', mode: 'async', sessionCookie: 'SECRET', username: 'u' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('XACT_4001');
    expect(res.body.error.message).toBe('credentials not allowed for queued execution — use sync or accountIds');
    expect(enq.calls).toHaveLength(0);

    // Manifest-default async ('user' is unlisted → async) — same rejection.
    const res2 = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'user', ct0: 'SECRET' });
    expect(res2.status).toBe(400);
    expect(res2.body.error.message).toContain('credentials not allowed');
    expect(enq.calls).toHaveLength(0);

    // Credential-bearing body on the SYNC lane still scrapes fine.
    const res3 = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'search', mode: 'sync', sessionCookie: 'SECRET' });
    expect(res3.status).toBe(200);
    expect(scrapeSpy.calls[scrapeSpy.calls.length - 1].options.sessionCookie).toBe('SECRET');
  });

  it('HAPPY_ASYNC_EXPLICIT: mode:async → 202 {success, mode:async, operationId, statusUrl}, no degraded_reason', async () => {
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'search', mode: 'async' });
    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.mode).toBe('async');
    expect(res.body.operationId).toBe('opq_1');
    expect(res.body.statusUrl).toBe(`/api/ai/action/status/${res.body.operationId}`);
    expect(res.body).not.toHaveProperty('degraded_reason');
    expect(enq.calls).toHaveLength(1);
    expect(enq.calls[0].data.platform).toBe('reddit');
    expect(enq.calls[0].data.action).toBe('search');
  });

  it('HAPPY_DEFAULT_SYNC: no mode on manifest action → sync 200', async () => {
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'search' });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('sync');
    expect(scrapeSpy.calls).toHaveLength(1);
    expect(enq.calls).toHaveLength(0);
  });

  it('HAPPY_DEFAULT_SYNC via mapped alias: posts→subreddit still sync-capable', async () => {
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'posts', name: 'CryptoMoonShots' });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('sync');
  });

  it('HAPPY_DEFAULT_ASYNC: no mode on unlisted (known) action → 202 enqueue', async () => {
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'user', username: 'spez' });
    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.operationId).toBeDefined();
    expect(enq.calls).toHaveLength(1);
    expect(scrapeSpy.calls).toHaveLength(0);
  });

  it('DEGRADE_TIMEOUT: sync pending > ceiling → 202 upstream_timeout + Retry-After + tracked row', async () => {
    _setSyncBudgetMs(50);
    _setScrapeImpl(async () => { await sleep(250); return { done: true }; });
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'search', mode: 'sync' });
    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.mode).toBe('async');
    expect(res.body.degraded_reason).toBe('upstream_timeout');
    expect(res.body.operationId).toMatch(/^op_/);
    expect(res.body.retry_after_ms).toBe(RETRY_AFTER_DEFAULT_MS);
    expect(res.headers['retry-after']).toBe(String(Math.ceil(RETRY_AFTER_DEFAULT_MS / 1000)));
    expect(res.body.statusUrl).toBe(`/api/ai/action/status/${res.body.operationId}`);
    // In-flight promise keeps running and writes the row when it settles
    await sleep(400);
    expect(store.rows.get(res.body.operationId).status).toBe('completed');
  });

  it('DEGRADE_CF: sync throws BotChallengeError inside budget → 202 cf_challenge + Bull job enqueued', async () => {
    _setScrapeImpl(async () => { throw new BotChallengeError({ message: 'cf wall' }); });
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'search', mode: 'sync' });
    expect(res.status).toBe(202);
    expect(res.body.degraded_reason).toBe('cf_challenge');
    expect(res.body.operationId).toBe('opq_1');
    expect(enq.calls).toHaveLength(1);
  });

  it('DEGRADE_429: RateLimitError retryAfterMs propagates to retry_after_ms + Retry-After + Bull delay', async () => {
    _setScrapeImpl(async () => { throw new RateLimitError({ message: 'slow down', retryAfterMs: 8000 }); });
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'search', mode: 'sync' });
    expect(res.status).toBe(202);
    expect(res.body.degraded_reason).toBe('upstream_rate_limit');
    expect(res.body.retry_after_ms).toBe(8000);
    expect(res.headers['retry-after']).toBe('8');
    expect(enq.calls[0].opts.delay).toBe(8000);
  });

  it('ERR_NOT_SYNC_CAPABLE: mode:sync on unlisted action → 400 contract violation (no enqueue)', async () => {
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'user', mode: 'sync' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toEqual({
      code: 'XACT_4001',
      kind: 'validation',
      type: 'validation',
      message: 'action not sync-eligible',
    });
    expect(enq.calls).toHaveLength(0);
    expect(scrapeSpy.calls).toHaveLength(0);
  });

  it('ERR_BAD_MODE: mode:turbo → 400 validation (closed enum)', async () => {
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'search', mode: 'turbo' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('XACT_4001');
    expect(res.body.error.kind).toBe('validation');
  });

  it('ERR_NONRETRYABLE_SYNC: non-retryable scrape error → legacy {ok:false} error, never degrade', async () => {
    _setScrapeImpl(async () => {
      throw new PlatformError({ code: 'XACT_4001', type: 'invalid_args', statusCode: 400, message: 'bad args' });
    });
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'search', mode: 'sync' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('bad args');
    expect(enq.calls).toHaveLength(0);
  });

  it('EDGE_BAD_PLATFORM_TYPE: platform 42/[]/""/true → 400 validation', async () => {
    for (const platform of [42, [], '', true, { x: 1 }]) {
      const res = await request(app)
        .post('/api/platform/reddit/scrape')
        .send({ action: 'search', platform });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('XACT_4001');
    }
  });

  it('EDGE_PLATFORM_MISMATCH: body platform wins over path, canonicalized to aliases[0] (x → twitter)', async () => {
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'search', platform: 'x' });
    // twitter knows 'search' but has no sync manifest → default async,
    // enqueued for canonical 'twitter' (consistent with batch entry labels)
    expect(res.status).toBe(202);
    expect(enq.calls[0].data.platform).toBe('twitter');
  });

  it('EDGE_PLATFORM_ALIAS: single-string body platform canonicalizes (rdt → reddit, tiktok-shop → tiktokshop)', async () => {
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'search', platform: 'rdt' });
    expect(res.status).toBe(200);
    expect(res.body.platform).toBe('reddit');
    expect(scrapeSpy.calls[0].platform).toBe('reddit');

    // PLATFORM_ALIASES apply to body strings the same way the path guard does
    const res2 = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'search', platform: ['tiktok-shop'], mode: 'async' });
    expect([202, 503]).toContain(res2.status); // enqueue-or-failed, label is what matters
    const entry = (res2.body.results || []).find((r) => r.platform === 'tiktokshop');
    expect(entry).toBeDefined();
  });

  it("EDGE_UNKNOWN_ACTION: unresolvable action → 400 'Unknown action' — never reaches scrape()/Bull", async () => {
    for (const mode of ['async', 'sync', undefined]) {
      const res = await request(app)
        .post('/api/platform/reddit/scrape')
        .send(mode ? { action: 'bogus_xyz', mode } : { action: 'bogus_xyz' });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatchObject({ code: 'XACT_4001', kind: 'validation', message: 'Unknown action: bogus_xyz' });
    }
    expect(enq.calls).toHaveLength(0);
    expect(scrapeSpy.calls).toHaveLength(0);
  });

  it('EDGE_NONSERIAL_OPTIONS: circular options → 400 before enqueue (via dispatch direct)', async () => {
    const circular = { nested: {} };
    circular.nested.loop = circular;
    const outcome = await dispatch({
      pathPlatform: 'reddit',
      body: { action: 'search', mode: 'async', options: circular },
      action: 'search',
      userId: null,
      consumer: null,
    });
    expect(outcome.status).toBe(400);
    expect(outcome.body.error.code).toBe('XACT_4001');
    expect(enq.calls).toHaveLength(0);
  });

  it('EDGE_ACCOUNTIDS_SERVICE: service caller + accountIds → 400 before dispatch', async () => {
    process.env.XACTIONS_SERVICE_KEYS = SERVICE_MAP;
    _resetServiceKeyMap();
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .set('Authorization', `Bearer ${JEV_KEY}`)
      .send({ action: 'search', accountIds: ['acc-1'] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(enq.calls).toHaveLength(0);
  });

  it('EDGE_DRYRUN_ASYNC: mode:async + dryRun:true → 202; job carries dryRun in options (allowed-inert)', async () => {
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'search', mode: 'async', dryRun: true });
    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.operationId).toBeDefined();
    expect(enq.calls).toHaveLength(1);
    expect(enq.calls[0].data.options.dryRun).toBe(true);
  });

  it('EDGE_OP_USER: serviceAuth caller + mode:async → job data userId=null, consumerId=jev', async () => {
    process.env.XACTIONS_SERVICE_KEYS = SERVICE_MAP;
    _resetServiceKeyMap();
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .set('Authorization', `Bearer ${JEV_KEY}`)
      .send({ action: 'user', mode: 'async' });
    expect(res.status).toBe(202);
    expect(enq.calls[0].data.userId).toBeNull();
    expect(enq.calls[0].data.consumerId).toBe('jev');
    // Service lane flag carried into the job payload for the worker's ctx
    expect(enq.calls[0].data.apiKeyRequired).toBe(true);
  });

  it('EDGE_OP_USER: JWT caller + mode:async → consumerId:null (indexed column is service-lane only)', async () => {
    const TEST_USER_ID = makeTestUserId('mode-dispatch-jwt-lane');
    const user = await seedTestUser(TEST_USER_ID, 'mode_dispatch_jwt');
    try {
      const token = jwt.sign({ userId: user.id, username: user.username }, TEST_SECRET, { expiresIn: '1h' });
      const res = await request(app)
        .post('/api/platform/reddit/scrape')
        .set('Authorization', `Bearer ${token}`)
        .send({ action: 'user', mode: 'async' });
      expect(res.status).toBe(202);
      expect(enq.calls[0].data.userId).toBe(user.id);
      expect(enq.calls[0].data.consumerId).toBeNull();
      expect(enq.calls[0].data.apiKeyRequired).toBe(false);
    } finally {
      await cleanupTestUser(TEST_USER_ID);
    }
  });
});

// ─── Batch dispatch ───────────────────────────────────────────────────────────

describe('batch dispatch — platform:all|string[] (allSettled, per-platform ceiling)', () => {
  it('BATCH_ASYNC: platform:[x,reddit] mode:async → 202 results[]+operationIds[]', async () => {
    const res = await request(app)
      .post('/api/platform/all/scrape')
      .send({ action: 'search', mode: 'async', platform: ['x', 'reddit'] });
    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.mode).toBe('async');
    expect(res.body.results).toHaveLength(2);
    // Per-entry label is the canonical name (descriptor.aliases[0]) → 'twitter'
    expect(res.body.results.map((r) => r.platform)).toEqual(['twitter', 'reddit']);
    for (const entry of res.body.results) {
      expect(entry.success).toBe(true);
      expect(entry.status).toBe('queued');
      expect(entry.operationId).toMatch(/^opq_/);
      expect(entry.statusUrl).toBe(`/api/ai/action/status/${entry.operationId}`);
    }
    expect(res.body.operationIds).toHaveLength(2);
    expect(res.body.operationIds).toEqual(res.body.results.map((r) => r.operationId));
  });

  it('BATCH_MIXED_DEFAULT: no mode → reddit sync-completed + twitter queued, top-level 200/mode:sync', async () => {
    const res = await request(app)
      .post('/api/platform/all/scrape')
      .send({ action: 'search', platform: ['reddit', 'x'] });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.mode).toBe('sync');
    const reddit = res.body.results.find((r) => r.platform === 'reddit');
    const twitter = res.body.results.find((r) => r.platform === 'twitter');
    expect(reddit).toMatchObject({ success: true, status: 'completed' });
    expect(reddit.data).toBeDefined();
    // twitter knows 'search' (actionMap) but has no syncCapableActions → async
    expect(twitter).toMatchObject({ success: true, status: 'queued' });
    expect(twitter.operationId).toMatch(/^opq_/);
  });

  it('BATCH_PARTIAL_CAPABLE: mode:sync + non-capable platform → per-entry failed, not whole-400', async () => {
    const res = await request(app)
      .post('/api/platform/all/scrape')
      .send({ action: 'search', mode: 'sync', platform: ['reddit', 'x'] });
    expect(res.status).toBe(200);
    const reddit = res.body.results.find((r) => r.platform === 'reddit');
    const twitter = res.body.results.find((r) => r.platform === 'twitter');
    expect(reddit.status).toBe('completed');
    expect(twitter).toMatchObject({ success: false, status: 'failed' });
    expect(twitter.error).toMatchObject({
      code: 'XACT_4001',
      kind: 'validation',
      type: 'validation',
      message: 'action not sync-eligible',
    });
  });

  it('BATCH unknown action → every entry failed XACT_4001 validation, batch still 200', async () => {
    const res = await request(app)
      .post('/api/platform/all/scrape')
      .send({ action: 'bogus_xyz', mode: 'sync', platform: ['reddit', 'pumpfun'] });
    expect(res.status).toBe(200);
    for (const entry of res.body.results) {
      expect(entry.success).toBe(false);
      expect(entry.status).toBe('failed');
      expect(entry.error).toMatchObject({ code: 'XACT_4001', kind: 'validation', message: 'Unknown action: bogus_xyz' });
    }
    expect(enq.calls).toHaveLength(0);
    expect(scrapeSpy.calls).toHaveLength(0);
  });

  it('BATCH_SYNC manifest-declared-but-unimplemented action (pumpfun fetch_coin_meta, inert until 50.6) → Unknown action', async () => {
    const res = await request(app)
      .post('/api/platform/all/scrape')
      .send({ action: 'fetch_coin_meta', mode: 'sync', platform: ['pumpfun'] });
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({
      platform: 'pumpfun',
      success: false,
      status: 'failed',
      error: { code: 'XACT_4001', message: 'Unknown action: fetch_coin_meta' },
    });
  });

  it('per-platform ceiling: a degraded entry does not fail the batch (reddit times out)', async () => {
    _setSyncBudgetMs(50);
    _setScrapeImpl(async () => { await sleep(200); return { slow: true }; });
    const res = await request(app)
      .post('/api/platform/all/scrape')
      .send({ action: 'search', mode: 'sync', platform: ['reddit', 'pumpfun'] });
    expect(res.status).toBe(200);
    const reddit = res.body.results.find((r) => r.platform === 'reddit');
    const pumpfun = res.body.results.find((r) => r.platform === 'pumpfun');
    expect(reddit).toMatchObject({ success: true, status: 'degraded' });
    expect(reddit.degraded_reason).toBe('upstream_timeout');
    expect(reddit.operationId).toMatch(/^op_/);
    expect(reddit.statusUrl).toBe(`/api/ai/action/status/${reddit.operationId}`);
    // pumpfun does not know 'search' at all → Unknown action entry; batch still resolves
    expect(pumpfun).toMatchObject({ success: false, status: 'failed' });
    expect(pumpfun.error.message).toBe('Unknown action: search');
  });

  it('BATCH_ALL: POST /all/scrape (no body.platform) expands every canonical descriptor platform', async () => {
    const res = await request(app)
      .post('/api/platform/all/scrape')
      .send({ action: 'search', mode: 'async' });
    expect(res.status).toBe(202);
    const expected = canonicalPlatforms(DESCRIPTORS);
    expect(res.body.results).toHaveLength(expected.length);
    // Platforms that don't know 'search' fail per-entry; queued entries still mint operationIds
    expect(res.body.operationIds.length).toBeGreaterThan(0);
    expect(res.body.operationIds.length).toBe(res.body.results.filter((r) => r.operationId).length);
    expect(res.body.results.map((r) => r.platform).sort()).toEqual([...expected].sort());
    expect(res.body.results.find((r) => r.platform === 'reddit')).toMatchObject({ status: 'queued' });
  });

  it('EDGE_ALL_BODY: body {platform:"all"} (incl. " ALL ") expands identically to the /all path', async () => {
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'search', mode: 'async', platform: 'all' });
    expect(res.status).toBe(202);
    expect(res.body.results).toHaveLength(canonicalPlatforms(DESCRIPTORS).length);

    // Case/space-tolerant 'all' — same expansion
    const res2 = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'search', mode: 'async', platform: ' ALL ' });
    expect(res2.status).toBe(202);
    expect(res2.body.results).toHaveLength(canonicalPlatforms(DESCRIPTORS).length);
  });

  it("EDGE_ALL_SYNC: 'all' + mode:'sync' → 200 per-entry ceiling/capability, never whole-400", async () => {
    const res = await request(app)
      .post('/api/platform/all/scrape')
      .send({ action: 'search', mode: 'sync' });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('sync');
    const reddit = res.body.results.find((r) => r.platform === 'reddit');
    const twitter = res.body.results.find((r) => r.platform === 'twitter');
    expect(reddit).toMatchObject({ success: true, status: 'completed' });
    // twitter knows 'search' but is not sync-capable → not_sync_capable entry
    expect(twitter).toMatchObject({ success: false, status: 'failed' });
    expect(twitter.error.message).toBe('action not sync-eligible');
  });

  it('EDGE_NONSTRING_MEMBER: non-string array member → per-entry failed, sibling still queues', async () => {
    const res = await request(app)
      .post('/api/platform/all/scrape')
      .send({ action: 'search', mode: 'async', platform: ['reddit', 42] });
    expect(res.status).toBe(202);
    expect(res.body.results).toHaveLength(2);
    const bad = res.body.results.find((r) => r.platform === '42');
    expect(bad).toMatchObject({ success: false, status: 'failed' });
    expect(bad.error.message).toBe('Unknown platform');
    expect(res.body.results.find((r) => r.platform === 'reddit').status).toBe('queued');
  });

  it('EDGE_ASYNC_ALL_FAILED: async batch where every entry fails → 503 (nothing trackable), results still detail why', async () => {
    const res = await request(app)
      .post('/api/platform/all/scrape')
      .send({ action: 'bogus_xyz', mode: 'async', platform: ['reddit', 'bogus_platform'] });
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('XACT_5000');
    // Per-entry detail is preserved for the caller
    expect(res.body.results).toHaveLength(2);
    expect(res.body.results.every((r) => r.status === 'failed')).toBe(true);
    expect(enq.calls).toHaveLength(0);
  });

  it('EDGE_INVALID_IN_ARRAY: bogus platform → per-entry failed {XACT_4001, validation, Unknown platform}', async () => {
    const res = await request(app)
      .post('/api/platform/all/scrape')
      .send({ action: 'search', mode: 'async', platform: ['reddit', 'bogus'] });
    expect(res.status).toBe(202);
    const bogus = res.body.results.find((r) => r.platform === 'bogus');
    expect(bogus).toMatchObject({ success: false, status: 'failed' });
    expect(bogus.error).toMatchObject({ code: 'XACT_4001', kind: 'validation', message: 'Unknown platform' });
    const reddit = res.body.results.find((r) => r.platform === 'reddit');
    expect(reddit.status).toBe('queued');
  });

  it('EDGE_BATCH_CAP: explicit platform array > 25 → 400', async () => {
    const tooMany = Array.from({ length: MAX_BATCH_PLATFORMS + 1 }, (_, i) => `p${i}`);
    const res = await request(app)
      .post('/api/platform/all/scrape')
      .send({ action: 'search', platform: tooMany });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('XACT_4001');
  });

  it('EDGE_BATCH_DUPES: [x, x, twitter] dedupes post-normalize → single canonical entry', async () => {
    const res = await request(app)
      .post('/api/platform/all/scrape')
      .send({ action: 'search', mode: 'async', platform: ['x', 'x', 'twitter'] });
    expect(res.status).toBe(202);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].platform).toBe('twitter'); // canonical = aliases[0]
  });

  it("'all' scope: POST /all/automate still 400 — batch never leaks to write routes", async () => {
    const res = await request(app)
      .post('/api/platform/all/automate')
      .send({ action: 'search' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Unknown platform');
  });

  it('EDGE_SECRETS_ASYNC: JWT + async + accountIds → job data carries ids, never cookie plaintext', async () => {
    const TEST_USER_ID = makeTestUserId('mode-dispatch-50-2');
    const user = await seedTestUser(TEST_USER_ID, 'mode_dispatch_user');
    try {
      const token = jwt.sign({ userId: user.id, username: user.username }, TEST_SECRET, { expiresIn: '1h' });
      const res = await request(app)
        .post('/api/platform/reddit/scrape')
        .set('Authorization', `Bearer ${token}`)
        .send({
          action: 'user',
          username: 'spez',
          mode: 'async',
          accountIds: ['acc-1'],
        });
      expect(res.status).toBe(202);
      const job = enq.calls[0];
      expect(job.data.userId).toBe(user.id);
      expect(job.data.accountIds).toEqual(['acc-1']);
      expect(job.data.options.sessionCookie).toBeUndefined();
      expect(job.data.options.authCookie).toBeUndefined();
      // Operation.config mirror must not carry secrets either
      expect(job.data.config.options.sessionCookie).toBeUndefined();
      expect(job.data.config.options.authCookie).toBeUndefined();
    } finally {
      await cleanupTestUser(TEST_USER_ID);
    }
  });

  it('EDGE_TRACKING_CONFIG: detached tracking-row config contains no credential keys (sync body-cookie still reaches scrape)', async () => {
    _setSyncBudgetMs(50);
    const runCalls = [];
    _setScrapeImpl(async (p, a, o) => { runCalls.push({ platform: p, action: a, options: o }); await sleep(200); return { done: true }; });
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({
        action: 'search',
        mode: 'sync',
        query: 'hi',
        sessionCookie: 'PLAIN_SECRET',
        authToken: 'PLAIN_TOKEN',
        ct0: 'PLAIN_CT0',
        password: 'PLAIN_PW',
      });
    expect(res.status).toBe(202);
    expect(res.body.degraded_reason).toBe('upstream_timeout');
    const cfg = JSON.parse(store.rows.get(res.body.operationId).config);
    expect(cfg.platform).toBe('reddit');
    expect(cfg.degraded_from).toBe('sync_ceiling');
    expect(cfg.options.query).toBe('hi');
    for (const k of ['sessionCookie', 'authToken', 'ct0', 'password']) {
      expect(cfg.options).not.toHaveProperty(k);
    }
    // The run options DID carry the cookie (legacy sync flow) — persistence
    // is the only boundary that strips credentials.
    expect(runCalls[0].options.sessionCookie).toBe('PLAIN_SECRET');
  });

  it('EDGE_ACCOUNTIDS_BATCH: JWT + accountIds + platform[] — cookie resolved per-platform; entry failures stay per-entry', async () => {
    const TEST_USER_ID = makeTestUserId('mode-dispatch-acct');
    const user = await seedTestUser(TEST_USER_ID, 'mode_dispatch_acct');
    const cookie = { clientId: 'cid-1', clientSecret: 'sec-1', username: 'gw_user' };
    const acct = await prisma.facebookAccount.create({
      data: {
        userId: user.id,
        label: 'reddit:gw-test',
        encryptedCookie: encryptCookie(JSON.stringify(cookie)),
      },
    });
    try {
      const token = jwt.sign({ userId: user.id, username: user.username }, TEST_SECRET, { expiresIn: '1h' });

      // reddit 'search' is sync-capable → cookie resolved inside its entry
      // task (bounded by the per-platform ceiling); twitter 'search' is known
      // but unlisted → async entry carries accountIds for the worker-side
      // re-resolve. Real prisma read of the seeded account row.
      const res = await request(app)
        .post('/api/platform/all/scrape')
        .set('Authorization', `Bearer ${token}`)
        .send({ action: 'search', platform: ['reddit', 'x'], accountIds: [acct.id] });
      expect(res.status).toBe(200);
      const reddit = res.body.results.find((r) => r.platform === 'reddit');
      const twitter = res.body.results.find((r) => r.platform === 'twitter');
      expect(reddit).toMatchObject({ success: true, status: 'completed' });
      const redditCall = scrapeSpy.calls.find((c) => c.platform === 'reddit');
      expect(redditCall.options.accountId).toBe(acct.id);
      expect(redditCall.options.authCookie).toMatchObject({ clientId: 'cid-1', clientSecret: 'sec-1' });
      expect(redditCall.options.clientSecret).toBe('sec-1'); // merged from decrypted cookie
      expect(twitter).toMatchObject({ success: true, status: 'queued' });
      expect(enq.calls[0].data.accountIds).toEqual([acct.id]);

      // Per-entry isolation: bogus accountId → reddit entry fails, twitter
      // still queues — a failed cookie resolve never fails the whole batch.
      scrapeSpy.calls.length = 0;
      enq.calls.length = 0;
      const res2 = await request(app)
        .post('/api/platform/all/scrape')
        .set('Authorization', `Bearer ${token}`)
        .send({ action: 'search', platform: ['reddit', 'x'], accountIds: ['bogus-acc-id'] });
      expect(res2.status).toBe(200);
      const r2 = res2.body.results.find((r) => r.platform === 'reddit');
      const p2 = res2.body.results.find((r) => r.platform === 'twitter');
      expect(r2).toMatchObject({ success: false, status: 'failed' });
      expect(r2.error.message).toContain('Selected account not found');
      expect(p2).toMatchObject({ success: true, status: 'queued' });
    } finally {
      await prisma.facebookAccount.delete({ where: { id: acct.id } }).catch(() => {});
      await cleanupTestUser(TEST_USER_ID);
    }
  });
});

// ─── jobQueue internals (seam + real prisma — no vi.mock) ────────────────────

describe('jobQueue addJob/getJob — EDGE_QUEUE_ADD_FAIL + EDGE_STATUS_FLAP', () => {
  it('explicit async + enqueue failure at dispatch → 503 (no orphan queued row promised)', async () => {
    _setEnqueueImpl(async () => { throw new Error('redis down'); });
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'user', mode: 'async' });
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('XACT_5000');
  });

  it('timeout → tracking create fails → enqueue fails → 503 (route-level, in-flight scrape never re-enqueued)', async () => {
    _setSyncBudgetMs(50);
    _setScrapeImpl(async () => { await sleep(300); return { late: true }; });
    const failingStore = makeFakeStore();
    failingStore.create = async () => { throw new Error('prisma down'); };
    _setOperationStore(failingStore);
    _setEnqueueImpl(async () => { throw new Error('redis down'); });

    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'search', mode: 'sync' });
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('XACT_5000');
    // The in-flight scrape was NOT re-enqueued — spec Never, no double execution
    expect(enq.calls.length).toBe(0);
  });

  it('EDGE_ACCOUNTIDS_TYPE: non-array truthy accountIds → 400 validation (not silently dropped)', async () => {
    for (const bad of ['acc-1', 42, { id: 'acc-1' }]) {
      const res = await request(app)
        .post('/api/platform/reddit/scrape')
        .send({ action: 'search', accountIds: bad });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('accountIds must be an array of account ids');
    }
    expect(scrapeSpy.calls).toHaveLength(0);
  });

  it('EDGE_ALL_PATH_NORMALIZE: /all/scrape/ and /all/SCRAPE admit like /all/scrape', async () => {
    for (const path of ['/api/platform/all/scrape/', '/api/platform/all/SCRAPE']) {
      const res = await request(app)
        .post(path)
        .send({ action: 'search', mode: 'async' });
      expect(res.status).toBe(202);
      expect(res.body.results.length).toBeGreaterThan(0);
    }
    // ...but never the automate route
    const res = await request(app)
      .post('/api/platform/all/automate/')
      .send({ action: 'search' });
    expect(res.status).toBe(400);
  });

  it('EDGE_CALLBACK_URL: body callbackUrl hoisted into Bull job config (never scraper options)', async () => {
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .send({ action: 'user', mode: 'async', callbackUrl: 'https://hook.example/done' });
    expect(res.status).toBe(202);
    expect(enq.calls[0].data.config.callbackUrl).toBe('https://hook.example/done');
    expect(enq.calls[0].data.options.callbackUrl).toBeUndefined();
  });

  it('EDGE_QUEUE_ADD_FAIL: addJob marks the operation row failed when queue.add throws (real prisma)', async () => {
    _setOperationsQueue({ add: async () => { throw new Error('redis down'); } });
    try {
      await expect(addJob('scrape', {
        platform: 'reddit',
        action: 'search',
        options: {},
        userId: null,
        consumerId: 'jev',
        config: { marker: 'edge-queue-add-fail' },
      })).rejects.toThrow('redis down');

      // The row created before queue.add must be 'failed', never orphan-'queued'.
      const row = await prisma.operation.findFirst({
        where: { type: 'scrape', config: { contains: 'edge-queue-add-fail' } },
        orderBy: { createdAt: 'desc' },
      });
      expect(row).toBeTruthy();
      expect(row.status).toBe('failed');
      expect(row.error).toContain('enqueue failed');
      expect(row.completedAt).not.toBeNull();
      expect(row.consumerId).toBe('jev');
      expect(row.userId).toBeNull();
      await prisma.operation.delete({ where: { id: row.id } });
    } finally {
      _resetOperationsQueue();
    }
  });

  it('normalizeBullState: failed mid-retry → processing; terminal/exhausted states pass through', () => {
    expect(normalizeBullState('failed', 1, 3, 'queued')).toBe('processing');
    expect(normalizeBullState('failed', 3, 3, 'queued')).toBe('failed');
    expect(normalizeBullState('completed', 1, 3, 'queued')).toBe('completed');
    expect(normalizeBullState('active', 0, 3, 'queued')).toBe('active');
    expect(normalizeBullState(null, 0, 3, 'queued')).toBe('queued');
    // Non-numeric attempt metadata → raw Bull state (terminal stays terminal)
    expect(normalizeBullState('failed', undefined, undefined, 'queued')).toBe('failed');
    expect(normalizeBullState('failed', 'x', 3, 'queued')).toBe('failed');
    expect(normalizeBullState('completed', undefined, undefined, 'queued')).toBe('completed');
  });

  it('EDGE_STATUS_FLAP: getJob reports processing while a Bull job is mid-retry (seam + real row)', async () => {
    const op = await prisma.operation.create({
      data: { type: 'scrape', status: 'queued', config: '{}' },
    });
    try {
      // Bull 'failed' with attemptsMade < attempts → NOT terminal
      _setOperationsQueue({
        getJob: async () => ({
          progress: async () => 40,
          getState: async () => 'failed',
          attemptsMade: 1,
          opts: { attempts: 3 },
        }),
      });
      const mid = await getJob(op.id);
      expect(mid.status).toBe('processing');
      expect(mid.progress).toBe(40);

      // Retries exhausted → terminal 'failed' surfaces
      _setOperationsQueue({
        getJob: async () => ({
          progress: async () => 0,
          getState: async () => 'failed',
          attemptsMade: 3,
          opts: { attempts: 3 },
        }),
      });
      expect((await getJob(op.id)).status).toBe('failed');

      // Redis hiccup → falls back to DB state, never 500s
      _setOperationsQueue({ getJob: async () => { throw new Error('redis hiccup'); } });
      expect((await getJob(op.id)).status).toBe('queued');
    } finally {
      _resetOperationsQueue();
      await prisma.operation.delete({ where: { id: op.id } }).catch(() => {});
    }
  });
});

// ─── End-to-end async verification (real queue events + real prisma) ────────

describe('async job lifecycle — real operationsQueue events on real Operation rows', () => {
  /** Poll getJob until status lands on `want` (event handlers are async). */
  async function waitStatus(id, want, timeoutMs = 4000) {
    const deadline = Date.now() + timeoutMs;
    let job = null;
    while (Date.now() < deadline) {
      job = await getJob(id);
      if (job && job.status === want) return job;
      await sleep(40);
    }
    return job;
  }

  it('Bull "completed" event → row completed + result readable via getJob AND GET /api/ai/action/status/:id', async () => {
    const op = await prisma.operation.create({
      data: { type: 'scrape', status: 'processing', config: JSON.stringify({ platform: 'reddit', action: 'search' }), startedAt: new Date() },
    });
    try {
      operationsQueue.emit('completed', { id: op.id, data: { operationId: op.id, type: 'scrape' } }, { posts: 3 });
      const job = await waitStatus(op.id, 'completed');
      expect(job.status).toBe('completed');
      expect(job.result).toEqual({ posts: 3 });

      // The consumer-facing poll route returns the same truth
      const res = await request(app).get(`/api/ai/action/status/${op.id}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('completed');
      expect(res.body.data.result).toEqual({ posts: 3 });
    } finally {
      await prisma.operation.delete({ where: { id: op.id } }).catch(() => {});
    }
  });

  it('Bull "failed" event → row failed + error; a cancelled row is never clobbered', async () => {
    const op = await prisma.operation.create({
      data: { type: 'scrape', status: 'processing', config: '{}', startedAt: new Date() },
    });
    const cancelled = await prisma.operation.create({
      data: { type: 'scrape', status: 'cancelled', config: '{}', completedAt: new Date() },
    });
    try {
      operationsQueue.emit('failed', { id: op.id, data: { operationId: op.id, type: 'scrape' }, attemptsMade: 3 }, new Error('upstream exploded'));
      const job = await waitStatus(op.id, 'failed');
      expect(job.status).toBe('failed');
      expect(job.error.message).toContain('upstream exploded');

      // cancelled row + late 'completed' event → stays cancelled
      operationsQueue.emit('completed', { id: cancelled.id, data: { operationId: cancelled.id, type: 'scrape' } }, { sneaky: true });
      await sleep(200);
      const row = await prisma.operation.findUnique({ where: { id: cancelled.id } });
      expect(row.status).toBe('cancelled');
    } finally {
      await prisma.operation.deleteMany({ where: { id: { in: [op.id, cancelled.id] } } }).catch(() => {});
    }
  });
});
