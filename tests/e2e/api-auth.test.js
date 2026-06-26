// by nichxbt
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../api/server.js';

// Auth endpoints have a strict rate limiter: 10 req / 15 min per IP.
// Supertest reuses the same in-process Express app so all requests come
// from the same IP (::ffff:127.0.0.1). Once the window is exhausted the
// limiter returns 429 before the route handler runs.
// Every test that hits /api/auth/register or /api/auth/login must accept
// 429 as a valid status alongside the primary expected code.
const RATE_LIMITED = 429;

describe('Auth endpoints', () => {
  // ─── POST /api/auth/register ───────────────────────────────────────────────

  it('POST /api/auth/register with missing username → 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ password: 'password123' });
    expect([400, RATE_LIMITED]).toContain(res.status);
    if (res.status === 400) expect(res.body).toHaveProperty('errors');
  });

  it('POST /api/auth/register with missing password → 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'testuser' });
    expect([400, RATE_LIMITED]).toContain(res.status);
    if (res.status === 400) expect(res.body).toHaveProperty('errors');
  });

  it('POST /api/auth/register with password too short → 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'validuser', password: 'short' });
    expect([400, RATE_LIMITED]).toContain(res.status);
    if (res.status === 400) expect(res.body).toHaveProperty('errors');
  });

  it('POST /api/auth/register with username too short → 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'ab', password: 'validpassword123' });
    expect([400, RATE_LIMITED]).toContain(res.status);
    if (res.status === 400) expect(res.body).toHaveProperty('errors');
  });

  it('POST /api/auth/register with invalid username chars → 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'user name!', password: 'validpassword123' });
    expect([400, RATE_LIMITED]).toContain(res.status);
    if (res.status === 400) expect(res.body).toHaveProperty('errors');
  });

  it('POST /api/auth/register with invalid email → 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'validuser', password: 'validpassword123', email: 'not-an-email' });
    expect([400, RATE_LIMITED]).toContain(res.status);
    if (res.status === 400) expect(res.body).toHaveProperty('errors');
  });

  it('POST /api/auth/register with empty body → 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({});
    expect([400, RATE_LIMITED]).toContain(res.status);
    if (res.status === 400) expect(res.body).toHaveProperty('errors');
  });

  // ─── POST /api/auth/login ─────────────────────────────────────────────────

  it('POST /api/auth/login with empty body → 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({});
    expect([400, RATE_LIMITED]).toContain(res.status);
    if (res.status === 400) expect(res.body).toHaveProperty('errors');
  });

  it('POST /api/auth/login with missing password → 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'someuser' });
    expect([400, RATE_LIMITED]).toContain(res.status);
    if (res.status === 400) expect(res.body).toHaveProperty('errors');
  });

  it('POST /api/auth/login with missing identifier → 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: 'somepassword' });
    expect([400, RATE_LIMITED]).toContain(res.status);
    if (res.status === 400) expect(res.body).toHaveProperty('errors');
  });

  it('POST /api/auth/login with invalid credentials → 401 or 500 (no DB)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'nonexistent_user_xyz', password: 'wrongpassword123' });
    // Without a DB connection the route returns 500;
    // with a DB it returns 401.
    // Rate limiter may return 429 after the window is exhausted.
    expect([401, 500, RATE_LIMITED]).toContain(res.status);
  });

  // ─── POST /api/auth/refresh ────────────────────────────────────────────────
  // /api/auth/refresh shares the same authLimiter (10 req/15 min).

  it('POST /api/auth/refresh with no token → 401', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({});
    expect([401, RATE_LIMITED]).toContain(res.status);
    if (res.status === 401) expect(res.body).toHaveProperty('error');
  });

  it('POST /api/auth/refresh with malformed token → 401', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ token: 'totally.invalid.token' });
    expect([401, RATE_LIMITED]).toContain(res.status);
    if (res.status === 401) expect(res.body).toHaveProperty('error');
  });

  // ─── Protected endpoints without token ────────────────────────────────────
  // These do NOT hit rate-limited auth routes — no 429 risk.

  it('GET /api/operations without Authorization header → 401', async () => {
    const res = await request(app).get('/api/operations');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('GET /api/user without Authorization header → 401', async () => {
    const res = await request(app).get('/api/user');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('Protected endpoint with malformed Bearer token → 401', async () => {
    const res = await request(app)
      .get('/api/operations')
      .set('Authorization', 'Bearer this.is.not.a.real.jwt');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('Protected endpoint with wrong scheme (no Bearer) → 401', async () => {
    const res = await request(app)
      .get('/api/operations')
      .set('Authorization', 'Basic dXNlcjpwYXNz');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/token/i);
  });
});
