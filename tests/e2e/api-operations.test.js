// tests/e2e/api-operations.test.js
// Operations endpoint guards and validation with a real DB user.
// by nichxbt
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../api/server.js';
import {
  seedTestUser,
  cleanupTestUser,
  makeTestToken,
  makeTestUserId,
} from '../api/fixtures/test-user.js';
import { nextTestId } from '../utils/test-ids.js';

const TEST_USER_ID = makeTestUserId('operations-e2e');

let token;

beforeAll(async () => {
  const result = await seedTestUser(TEST_USER_ID, 'operations_e2e_user');
  token = result.token;
});

afterAll(async () => {
  await cleanupTestUser(TEST_USER_ID);
});

describe('Operations endpoints', () => {
  // ─── Auth guard ──────────────────────────────────────────────────────────

  it(`[${nextTestId('E2E')}] GET /api/operations without auth → 401`, async () => {
    const res = await request(app).get('/api/operations');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it(`[${nextTestId('E2E')}] GET /api/operations with malformed token → 401`, async () => {
    const res = await request(app)
      .get('/api/operations')
      .set('Authorization', 'Bearer bad.token.here');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it(`[${nextTestId('E2E')}] GET /api/operations with no Bearer scheme → 401`, async () => {
    const res = await request(app)
      .get('/api/operations')
      .set('Authorization', 'Token sometoken');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/token/i);
  });

  it(`[${nextTestId('E2E')}] GET /api/operations/status/:id without auth → 401`, async () => {
    const res = await request(app).get('/api/operations/status/some-operation-id');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it(`[${nextTestId('E2E')}] POST /api/operations/cancel/:id without auth → 401`, async () => {
    const res = await request(app).post('/api/operations/cancel/some-operation-id');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it(`[${nextTestId('E2E')}] POST /api/operations/unfollow-non-followers without auth → 401`, async () => {
    const res = await request(app)
      .post('/api/operations/unfollow-non-followers')
      .send({ maxUnfollows: 10 });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  // ─── Non-existent user token ──────────────────────────────────────────────

  it(`[${nextTestId('E2E')}] GET /api/operations with fake (non-existent user) JWT → 401`, async () => {
    const fakeToken = makeTestToken(makeTestUserId('nonexistent'), makeTestUserId('ghost'));
    const res = await request(app)
      .get('/api/operations')
      .set('Authorization', `Bearer ${fakeToken}`);
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  // ─── Validation with real user but no Twitter/Facebook connection ───────────

  it.each([
    [nextTestId('E2E'), 'unfollow-non-followers', { maxUnfollows: 10 }],
    [nextTestId('E2E'), 'unfollow-everyone', { maxUnfollows: 10 }],
    [nextTestId('E2E'), 'detect-unfollowers', {}],
  ])(`[%s] POST /api/operations/%s with auth but no platform session → 400`, async (id, action, body) => {
    const res = await request(app)
      .post(`/api/operations/${action}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  // ─── Pagination query params (auth guard fires first) ─────────────────────

  it(`[${nextTestId('E2E')}] GET /api/operations?page=1&limit=5 without auth → 401`, async () => {
    const res = await request(app).get('/api/operations?page=1&limit=5');
    expect(res.status).toBe(401);
  });

  it(`[${nextTestId('E2E')}] GET /api/operations?status=pending without auth → 401`, async () => {
    const res = await request(app).get('/api/operations?status=pending');
    expect(res.status).toBe(401);
  });

  // ─── Response shape contract (error responses) ────────────────────────────

  it(`[${nextTestId('E2E')}] 401 error response is JSON with error field`, async () => {
    const res = await request(app).get('/api/operations');
    expect(res.headers['content-type']).toMatch(/json/);
    expect(typeof res.body.error).toBe('string');
  });
});
