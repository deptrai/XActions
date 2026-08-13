// tests/e2e/api-auth.test.js
// Auth endpoint validation with a real DB user.
// Rate-limited auth endpoints are kept <= 10 calls per window to stay deterministic.
// by nichxbt
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../api/server.js';
import { seedTestUser, cleanupTestUser, makeTestUserId } from '../api/fixtures/test-user.js';
import { nextTestId } from '../utils/test-ids.js';

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
    ['empty body', {}, ['username', 'password']],
    ['invalid username', { username: 'ab', password: 'validpassword123' }, ['username']],
    ['invalid email', { username: 'validuser', password: 'validpassword123', email: 'not-an-email' }, ['email']],
    ['password too short', { username: 'validuser', password: 'short' }, ['password']],
  ])(`[${nextTestId('E2E')}] POST /api/auth/register with %s → 400`,
    async (desc, body, expectedPaths) => {
      const res = await request(app).post('/api/auth/register').send(body);
      expect(res.status).toBe(400);
      expect(res.body.errors).toBeInstanceOf(Array);
      const paths = res.body.errors.map((e) => e.path);
      for (const path of expectedPaths) {
        expect(paths).toContain(path);
      }
    }
  );

  it(`[${nextTestId('E2E')}] POST /api/auth/register with existing username → 400`, async () => {
    const res = await request(app).post('/api/auth/register').send({
      username: testUser.user.username,
      password: 'validpassword123',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already taken/i);
  });

  it(`[${nextTestId('E2E')}] POST /api/auth/login with empty body → 400`, async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.body.errors).toBeInstanceOf(Array);
    const paths = res.body.errors.map((e) => e.path);
    expect(paths).toContain('identifier');
    expect(paths).toContain('password');
  });

  it(`[${nextTestId('E2E')}] POST /api/auth/login with invalid credentials → 401`, async () => {
    const res = await request(app).post('/api/auth/login').send({
      identifier: testUser.user.username,
      password: 'wrongpassword123',
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid credentials/i);
  });

  it(`[${nextTestId('E2E')}] POST /api/auth/login with valid credentials → 200`, async () => {
    const res = await request(app).post('/api/auth/login').send({
      identifier: testUser.user.username,
      password: testUser.password,
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user.username).toBe(testUser.user.username);
  });

  it.each([
    ['no token', {}],
    ['malformed token', { token: 'not.a.jwt' }],
  ])(`[${nextTestId('E2E')}] POST /api/auth/refresh with %s → 401`, async (desc, body) => {
    const res = await request(app).post('/api/auth/refresh').send(body);
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  // Protected endpoint auth guards (not auth-rate-limited)
  it(`[${nextTestId('E2E')}] GET /api/operations without Authorization header → 401`, async () => {
    const res = await request(app).get('/api/operations');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it(`[${nextTestId('E2E')}] GET /api/user without Authorization header → 401`, async () => {
    const res = await request(app).get('/api/user');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it(`[${nextTestId('E2E')}] Protected endpoint with malformed Bearer token → 401`, async () => {
    const res = await request(app)
      .get('/api/operations')
      .set('Authorization', 'Bearer this.is.not.a.real.jwt');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it(`[${nextTestId('E2E')}] Protected endpoint with wrong scheme (no Bearer) → 401`, async () => {
    const res = await request(app)
      .get('/api/operations')
      .set('Authorization', 'Basic dXNlcjpwYXNz');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/token/i);
  });
});
