// tests/gateway/service-auth.test.js
// Contract tests for Story 50.1 — Service-Auth Lane (Bearer→Consumer Derivation)
// Covers the full 15-row I/O & Edge-Case Matrix in the spec.
// by nichxbt

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { serviceAuth, eitherAuth, loadServiceKeyMap, _resetServiceKeyMap } from '../../api/middleware/serviceAuth.js';
import { ApiError } from '../../api/middleware/envelope.js';
import { authenticate } from '../../api/middleware/auth.js';
import { seedTestUser, cleanupTestUser, makeTestUserId, TEST_SECRET } from '../api/fixtures/test-user.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function mockRes() {
  const res = {
    statusCode: 0,
    body: null,
    headersSent: false,
    status(code) { this.statusCode = code; this.headersSent = true; return this; },
    json(payload) { this.body = payload; return this; },
    setHeader() {},
  };
  return res;
}

function captureNext() {
  const state = { called: false, error: undefined };
  const next = (err) => { state.called = true; state.error = err; };
  return { state, next };
}

function makeReq({ bearer, consumerId, headers = {} } = {}) {
  const h = { ...headers };
  if (bearer !== undefined) h.authorization = `Bearer ${bearer}`;
  if (consumerId !== undefined) h['x-consumer-id'] = consumerId;
  return { headers: h };
}

const TEST_USER_ID = makeTestUserId('service-auth-50-1');
let testUser;

const JEV_KEY = 'sk_jev_test_token_0001';
const NOWING_KEY = 'sk_nowing_test_token_0002';
const LEGACY_KEY = 'legacy-mcp-key-9999';
const UNKNOWN_CONSUMER_KEY = 'sk_unknown_consumer_0003';
const VALID_SERVICE_MAP = JSON.stringify({
  [JEV_KEY]: { consumer_id: 'jev', tier: 'internal' },
  [NOWING_KEY]: { consumer_id: 'nowing', tier: 'metered' },
  [UNKNOWN_CONSUMER_KEY]: { consumer_id: 'random-unknown' },
});

const ORIGINAL_ENV = { ...process.env };

async function setup() {
  testUser = await seedTestUser(TEST_USER_ID, 'service_auth_test_user');
}
async function teardown() {
  await cleanupTestUser(TEST_USER_ID);
  process.env = { ...ORIGINAL_ENV };
  _resetServiceKeyMap();
}
beforeEach(async () => {
  process.env = { ...ORIGINAL_ENV };
  _resetServiceKeyMap();
  await setup();
});
afterEach(teardown);

// ─── serviceAuth direct (no JWT in front) ────────────────────────────────────

describe('serviceAuth middleware — Bearer→consumer derivation', () => {
  it('HAPPY_SERVICE_KEY: valid Bearer maps to configured consumer_id', async () => {
    process.env.XACTIONS_SERVICE_KEYS = VALID_SERVICE_MAP;
    _resetServiceKeyMap();
    const req = makeReq({ bearer: JEV_KEY, consumerId: 'chainlens' });
    const res = mockRes();
    const { state, next } = captureNext();

    await serviceAuth(req, res, next);

    expect(state.error).toBeUndefined();
    expect(req.consumer).toBeDefined();
    expect(req.consumer.consumerId).toBe('jev');
    expect(req.consumer.source).toBe('serviceAuth');
    expect(req.consumer.tier).toBe('internal');
    expect(req.consumer.apiKeyValid).toBe(true);
    expect(req.consumerHint).toBe('chainlens'); // observability hint preserved
  });

  it('HAPPY_LEGACY_KEY: XACTIONS_MCP_API_KEY maps to internal', async () => {
    process.env.XACTIONS_SERVICE_KEYS = '';
    process.env.XACTIONS_MCP_API_KEY = LEGACY_KEY;
    const req = makeReq({ bearer: LEGACY_KEY });
    const res = mockRes();
    const { state, next } = captureNext();

    await serviceAuth(req, res, next);

    expect(state.error).toBeUndefined();
    expect(req.consumer.consumerId).toBe('internal');
    expect(req.consumer.source).toBe('serviceAuth');
    expect(req.consumer.apiKeyValid).toBe(true);
  });

  it('HAPPY_ANON_DEV: no keys + NODE_ENV=development → anonymous internal', async () => {
    process.env.XACTIONS_SERVICE_KEYS = '';
    process.env.XACTIONS_MCP_API_KEY = '';
    process.env.XACTIONS_API_TOKEN = '';
    process.env.NODE_ENV = 'development';
    const req = makeReq({});
    const res = mockRes();
    const { state, next } = captureNext();

    await serviceAuth(req, res, next);

    expect(state.error).toBeUndefined();
    expect(req.consumer.consumerId).toBe('internal');
    expect(req.consumer.source).toBe('anonymous');
    expect(req.consumer.apiKeyValid).toBe(true);
  });

  it('EDGE_PROD_NO_KEYS: prod + no keys + invalid bearer → fail-closed 401', async () => {
    process.env.XACTIONS_SERVICE_KEYS = '';
    process.env.XACTIONS_MCP_API_KEY = '';
    process.env.XACTIONS_API_TOKEN = '';
    process.env.NODE_ENV = 'production';
    const req = makeReq({ bearer: 'anything' });
    const res = mockRes();
    const { state, next } = captureNext();

    await serviceAuth(req, res, next);

    expect(state.error).toBeInstanceOf(ApiError);
    expect(state.error.statusCode).toBe(401);
    expect(state.error.code).toBe('XACT_4001');
    expect(state.error.type).toBe('auth');
    expect(req.consumer).toBeUndefined();
  });

  it('VG-1: EDGE_PROD_MISSING_HEADER: prod + no keys + no authorization header → fail-closed 401', async () => {
    process.env.XACTIONS_SERVICE_KEYS = '';
    process.env.XACTIONS_MCP_API_KEY = '';
    process.env.XACTIONS_API_TOKEN = '';
    process.env.NODE_ENV = 'production';
    const req = makeReq({}); // no bearer header at all
    const res = mockRes();
    const { state, next } = captureNext();

    await serviceAuth(req, res, next);

    expect(state.error).toBeInstanceOf(ApiError);
    expect(state.error.statusCode).toBe(401);
    expect(state.error.code).toBe('XACT_4001');
    expect(state.error.type).toBe('auth');
    expect(req.consumer).toBeUndefined();
  });

  it('ERR_INVALID_BEARER: unknown Bearer → 401', async () => {
    process.env.XACTIONS_SERVICE_KEYS = VALID_SERVICE_MAP;
    const req = makeReq({ bearer: 'wrong-token-xxx' });
    const res = mockRes();
    const { state, next } = captureNext();

    await serviceAuth(req, res, next);

    expect(state.error).toBeInstanceOf(ApiError);
    expect(state.error.statusCode).toBe(401);
    expect(state.error.code).toBe('XACT_4001');
    expect(state.error.type).toBe('auth');
    expect(req.consumer).toBeUndefined();
  });

  it('ERR_MALFORMED: non-Bearer scheme → 401', async () => {
    process.env.XACTIONS_SERVICE_KEYS = VALID_SERVICE_MAP;
    const req = { headers: { authorization: 'Token abc123' } };
    const res = mockRes();
    const { state, next } = captureNext();

    await serviceAuth(req, res, next);

    expect(state.error).toBeInstanceOf(ApiError);
    expect(state.error.statusCode).toBe(401);
  });

  it('ERR_SPOOF: forged X-Consumer-Id cannot override Bearer-derived identity', async () => {
    process.env.XACTIONS_SERVICE_KEYS = VALID_SERVICE_MAP;
    _resetServiceKeyMap();
    const req = makeReq({ bearer: JEV_KEY, consumerId: 'internal' });
    const res = mockRes();
    const { state, next } = captureNext();

    await serviceAuth(req, res, next);

    expect(state.error).toBeUndefined();
    expect(req.consumer.consumerId).toBe('jev'); // Bearer wins
    expect(req.consumerHint).toBe('internal'); // hint logged
  });

  it('EDGE_MALFORMED_KEYS_ENV: malformed JSON → empty map + WARN (fail-closed on named keys)', async () => {
    process.env.XACTIONS_SERVICE_KEYS = '{not-valid-json';
    process.env.XACTIONS_MCP_API_KEY = LEGACY_KEY;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    _resetServiceKeyMap();
    const map = loadServiceKeyMap();
    expect(map).toEqual({});
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();

    const req = makeReq({ bearer: LEGACY_KEY });
    const res = mockRes();
    const { state, next } = captureNext();
    await serviceAuth(req, res, next);
    expect(req.consumer.consumerId).toBe('internal'); // legacy still works
  });

  it('EDGE_UNKNOWN_CONSUMER: Bearer valid but maps to unknown consumer → normalizeConsumerId → internal', async () => {
    process.env.XACTIONS_SERVICE_KEYS = VALID_SERVICE_MAP;
    const req = makeReq({ bearer: UNKNOWN_CONSUMER_KEY });
    const res = mockRes();
    const { state, next } = captureNext();

    await serviceAuth(req, res, next);

    expect(state.error).toBeUndefined();
    expect(req.consumer.consumerId).toBe('internal'); // unknown → internal
  });

  it('EDGE_EMPTY_HEADER: empty X-Consumer-Id → consumerHint normalized to internal', async () => {
    process.env.XACTIONS_SERVICE_KEYS = VALID_SERVICE_MAP;
    _resetServiceKeyMap();
    const req = { headers: { authorization: `Bearer ${JEV_KEY}`, 'x-consumer-id': '' } };
    const res = mockRes();
    const { state, next } = captureNext();

    await serviceAuth(req, res, next);

    expect(state.error).toBeUndefined();
    expect(req.consumer.consumerId).toBe('jev');
    expect(req.consumerHint).toBe('internal'); // normalized
  });

  it('EDGE_MULTI_HEADER: duplicate X-Consumer-Id → first header wins', async () => {
    process.env.XACTIONS_SERVICE_KEYS = VALID_SERVICE_MAP;
    const req = { headers: { authorization: `Bearer ${JEV_KEY}`, 'x-consumer-id': ['chainlens', 'nowing'] } };
    const res = mockRes();
    const { state, next } = captureNext();

    await serviceAuth(req, res, next);

    expect(state.error).toBeUndefined();
    expect(req.consumerHint).toBe('chainlens'); // first wins via normalizeConsumerId's Array.isArray check
  });
});

// ─── eitherAuth composer ─────────────────────────────────────────────────────

describe('eitherAuth — JWT-first then serviceAuth fallback', () => {
  it('HAPPY_USER_JWT: valid user JWT → req.user set + req.consumer.source=userJWT', async () => {
    const token = jwt.sign({ userId: testUser.id, username: testUser.username }, TEST_SECRET, { expiresIn: '1h' });
    const req = makeReq({ bearer: token });
    const res = mockRes();
    const { state, next } = captureNext();

    await eitherAuth(req, res, next);

    expect(state.error).toBeUndefined();
    expect(req.user).toBeDefined();
    expect(req.user.id).toBe(testUser.id);
    expect(req.consumer).toBeDefined();
    expect(req.consumer.source).toBe('userJWT');
    expect(req.consumer.consumerId).toBe('internal');
  });

  it('fallback: expired JWT → serviceAuth tries Bearer-as-service-key → fails → 401', async () => {
    process.env.XACTIONS_SERVICE_KEYS = VALID_SERVICE_MAP;
    const expired = jwt.sign({ userId: testUser.id, username: testUser.username }, TEST_SECRET, { expiresIn: '-1s' });
    const req = makeReq({ bearer: expired });
    const res = mockRes();
    const { state, next } = captureNext();

    await eitherAuth(req, res, next);

    expect(state.error).toBeInstanceOf(ApiError);
    expect(state.error.statusCode).toBe(401);
    // JWT verify fails → serviceAuth tries the same token as service key → not in map → 401
  });

  it('fallback: valid service key → JWT fails → serviceAuth succeeds', async () => {
    process.env.XACTIONS_SERVICE_KEYS = VALID_SERVICE_MAP;
    _resetServiceKeyMap();
    const req = makeReq({ bearer: JEV_KEY, consumerId: 'nowing' });
    const res = mockRes();
    const { state, next } = captureNext();

    await eitherAuth(req, res, next);

    expect(state.error).toBeUndefined();
    expect(req.user).toBeUndefined(); // serviceAuth never sets req.user
    expect(req.consumer.consumerId).toBe('jev');
    expect(req.consumer.source).toBe('serviceAuth');
  });

  it('EDGE_COOKIE_PLUS_BEARER: cookie ignored — Authorization Bearer resolves via serviceAuth', async () => {
    process.env.XACTIONS_SERVICE_KEYS = VALID_SERVICE_MAP;
    _resetServiceKeyMap();
    const req = {
      headers: {
        authorization: `Bearer ${JEV_KEY}`,
        cookie: 'session=fake-jwt-cookie',
      },
    };
    const res = mockRes();
    const { state, next } = captureNext();

    await eitherAuth(req, res, next);

    // JWT lane fails on Bearer (service key not a JWT)
    // serviceAuth resolves jev
    expect(req.consumer.consumerId).toBe('jev');
    expect(req.consumer.source).toBe('serviceAuth');
  });
});

// ─── Route-level integration tests (platform.js) ─────────────────────────────

import express from 'express';
import request from 'supertest';
import platformRouter from '../../api/routes/platform.js';

describe('platform.js route-level auth scoping (Story 50.1 ACs)', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    // Mount platformRouter under /api/platform
    app.use('/api/platform', platformRouter);
    // Error middleware for canonical envelopes
    app.use((err, req, res, next) => {
      const status = err.statusCode || err.status || 500;
      res.status(status).json({ success: false, error: { code: err.code || 'INTERNAL', message: err.message } });
    });
  });

  it('service Bearer reaches POST /:platform/scrape handler (not blocked by router.use)', async () => {
    process.env.XACTIONS_SERVICE_KEYS = VALID_SERVICE_MAP;
    _resetServiceKeyMap();

    // Call scrape with service key + missing action → handler validates action and returns 400
    // If router.use(authenticate) had intercepted, we'd get 401 UNAUTHORIZED.
    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .set('Authorization', `Bearer ${JEV_KEY}`)
      .send({}); // missing action

    // 400 means handler was REACHED (action is required) — auth passed!
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain('action is required');
  });

  it('EDGE_ACCOUNTIDS_NO_USER: service caller with accountIds gets 400 validation error (no TypeError crash)', async () => {
    process.env.XACTIONS_SERVICE_KEYS = VALID_SERVICE_MAP;
    _resetServiceKeyMap();

    const res = await request(app)
      .post('/api/platform/reddit/scrape')
      .set('Authorization', `Bearer ${JEV_KEY}`)
      .send({ action: 'search', accountIds: ['acc-123'] });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.message).toContain('Stored account resolution requires user session');
  });

  it('non-scrape routes remain user-JWT only: service key gets 401 on /accounts', async () => {
    process.env.XACTIONS_SERVICE_KEYS = VALID_SERVICE_MAP;
    _resetServiceKeyMap();

    const res = await request(app)
      .get('/api/platform/reddit/accounts')
      .set('Authorization', `Bearer ${JEV_KEY}`);

    // Accounts route only has authenticate — service key is not a valid JWT → 401
    expect(res.status).toBe(401);
  });
});
