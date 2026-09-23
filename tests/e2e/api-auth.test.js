// tests/e2e/api-auth.test.js
// Auth endpoint validation with a real DB user.
// Rate-limited auth endpoints are kept <= 10 calls per window to stay deterministic.
// by nichxbt
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../api/server.js';
import { seedTestUser, cleanupTestUser, makeTestUserId, TEST_SECRET } from '../api/fixtures/test-user.js';
import { nextTestId } from '../utils/test-ids.js';
const TEST_SCOPE = 'e2e-api-auth';

const TEST_USER_ID = makeTestUserId('auth-e2e');

let testUser;

beforeAll(async () => {
  testUser = await seedTestUser(TEST_USER_ID, 'auth_e2e_user');
});

afterAll(async () => {
  await cleanupTestUser(TEST_USER_ID);
});

describe('Auth endpoints', () => {
  it.each([
    [nextTestId(TEST_SCOPE, 'E2E', 'P1'), 'empty body', {}, ['username', 'password']],
    [nextTestId(TEST_SCOPE, 'E2E', 'P1'), 'invalid username', { username: 'ab', password: 'validpassword123' }, ['username']],
    [nextTestId(TEST_SCOPE, 'E2E', 'P1'), 'invalid email', { username: 'validuser', password: 'validpassword123', email: 'not-an-email' }, ['email']],
    [nextTestId(TEST_SCOPE, 'E2E', 'P1'), 'password too short', { username: 'validuser', password: 'short' }, ['password']],
  ])(`[%s] POST /api/auth/register with %s → 400`,
    async (id, desc, body, expectedPaths) => {
      const res = await request(app).post('/api/auth/register').send(body);
      expect(res.status).toBe(400);
      // Story 46.2 — canonical VALIDATION_FAILED envelope; Zod issues live in error.details.issues
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      const paths = (res.body.error.details?.issues ?? []).map((e) => e.path);
      for (const path of expectedPaths) {
        expect(paths).toContain(path);
      }
    }
  );

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P2')}] POST /api/auth/register with existing username → 400`, async () => {
    const res = await request(app).post('/api/auth/register').send({
      username: testUser.username,
      password: 'validpassword123',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/already taken/i);
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P2')}] POST /api/auth/login with empty body → 400`, async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    const paths = (res.body.error.details?.issues ?? []).map((e) => e.path);
    expect(paths).toContain('identifier');
    expect(paths).toContain('password');
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P2')}] POST /api/auth/login with invalid credentials → 401`, async () => {
    const res = await request(app).post('/api/auth/login').send({
      identifier: testUser.username,
      password: 'wrongpassword123',
    });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/invalid credentials/i);
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P2')}] POST /api/auth/login with valid credentials → 200`, async () => {
    const res = await request(app).post('/api/auth/login').send({
      identifier: testUser.username,
      password: testUser.password,
    });
    expect(res.status).toBe(200);
    // Story 46.2 — canonical success envelope: { success:true, data:{token,user} }
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('token');
    expect(res.body.data.user.username).toBe(testUser.username);
  });

  // Story 46.2 — missing token fails Zod validation (400 VALIDATION_FAILED);
  // a structurally-present but malformed token fails jwt.verify (401).
  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P0')}] POST /api/auth/refresh with no token → 400`, async () => {
    const res = await request(app).post('/api/auth/refresh').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P0')}] POST /api/auth/refresh with malformed token → 401`, async () => {
    const res = await request(app).post('/api/auth/refresh').send({ token: 'not.a.jwt' });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  // Protected endpoint auth guards (not auth-rate-limited)
  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P2')}] GET /api/operations without Authorization header → 401`, async () => {
    const res = await request(app).get('/api/operations');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P2')}] GET /api/user without Authorization header → 401`, async () => {
    const res = await request(app).get('/api/user');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P2')}] Protected endpoint with malformed Bearer token → 401`, async () => {
    const res = await request(app)
      .get('/api/operations')
      .set('Authorization', 'Bearer this.is.not.a.real.jwt');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P2')}] Protected endpoint with wrong scheme (no Bearer) → 401`, async () => {
    const res = await request(app)
      .get('/api/operations')
      .set('Authorization', 'Basic dXNlcjpwYXNz');
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/token/i);
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] Protected endpoint accepts token signed with { id } payload (Story 8.3)`, async () => {
    const token = jwt.sign({ id: testUser.id, username: testUser.username }, TEST_SECRET, { expiresIn: '1h' });
    const res = await request(app)
      .get('/api/operations')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
