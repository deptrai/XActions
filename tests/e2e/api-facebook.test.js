// tests/e2e/api-facebook.test.js
// Facebook automation endpoint guards with a real DB user.
// by nichxbt
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../api/server.js';
import {
  seedTestUser,
  cleanupTestUser,
  makeTestToken,
  makeTestUserId,
  makeValidFacebookCookie,
  makeFacebookPostUrl,
  makeFacebookProfileUrl,
  makeFacebookGroupUrl,
  makeAccountId,
} from '../api/fixtures/test-user.js';
import { nextTestId } from '../utils/test-ids.js';
const TEST_SCOPE = 'e2e-api-facebook';

const TEST_USER_ID = makeTestUserId('fb-e2e');
const VALID_COOKIE = makeValidFacebookCookie();

let token;

beforeAll(async () => {
  const result = await seedTestUser(TEST_USER_ID, 'fb_e2e_user');
  token = result.token;
});

afterAll(async () => {
  await cleanupTestUser(TEST_USER_ID);
});

describe('Facebook automation endpoints', () => {
  // ─── Auth guard ──────────────────────────────────────────────────────────

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P2')}] POST /api/facebook/automate without auth → 401`, async () => {
    const res = await request(app)
      .post('/api/facebook/automate')
      .send({ action: 'like', urls: [makeFacebookPostUrl()] });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P2')}] POST /api/facebook/scrape without auth → 401`, async () => {
    const res = await request(app)
      .post('/api/facebook/scrape')
      .send({ action: 'profile', url: makeFacebookProfileUrl() });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P2')}] POST /api/facebook/automate with invalid Bearer token → 401`, async () => {
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', 'Bearer invalid.jwt.token')
      .send({ action: 'like', urls: [makeFacebookPostUrl()], authCookie: VALID_COOKIE });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  // ─── Validation layer (reachable with a real DB user) ─────────────────────

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P2')}] POST /api/facebook/automate with valid token but missing action → 400`, async () => {
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${token}`)
      .send({ authCookie: VALID_COOKIE });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('ok', false);
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P2')}] POST /api/facebook/automate with valid token but invalid action → 400`, async () => {
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'INVALID_ACTION', authCookie: VALID_COOKIE });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/action must be one of/);
  });

  // ─── Scrape action validation ─────────────────────────────────────────────

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P2')}] POST /api/facebook/scrape with valid token but missing action → 400`, async () => {
    const res = await request(app)
      .post('/api/facebook/scrape')
      .set('Authorization', `Bearer ${token}`)
      .send({ url: makeFacebookProfileUrl() });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/action must be one of/);
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P2')}] POST /api/facebook/scrape with valid token but invalid action → 400`, async () => {
    const res = await request(app)
      .post('/api/facebook/scrape')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'UNKNOWN', url: makeFacebookProfileUrl() });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/action must be one of/);
  });

  // ─── Auth cookie guard ────────────────────────────────────────────────────

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P2')}] POST /api/facebook/automate with valid token but missing authCookie → 400`, async () => {
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'like', urls: [makeFacebookPostUrl()] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/session is required/);
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P2')}] POST /api/facebook/automate with non-existent user token → 401`, async () => {
    const fakeToken = makeTestToken(makeTestUserId('nonexistent'), makeTestUserId('ghost'));
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${fakeToken}`)
      .send({ action: 'like', urls: [makeFacebookPostUrl()], authCookie: VALID_COOKIE });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });
});
