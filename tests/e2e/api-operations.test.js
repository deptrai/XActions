// by nichxbt
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../api/server.js';

describe('Operations endpoints', () => {
  // ─── Auth guard ──────────────────────────────────────────────────────────

  it('GET /api/operations without auth → 401', async () => {
    const res = await request(app).get('/api/operations');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('GET /api/operations with malformed token → 401', async () => {
    const res = await request(app)
      .get('/api/operations')
      .set('Authorization', 'Bearer bad.token.here');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('GET /api/operations with no Bearer scheme → 401', async () => {
    const res = await request(app)
      .get('/api/operations')
      .set('Authorization', 'Token sometoken');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/token/i);
  });

  it('GET /api/operations/status/:id without auth → 401', async () => {
    const res = await request(app).get('/api/operations/status/some-operation-id');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('POST /api/operations/cancel/:id without auth → 401', async () => {
    const res = await request(app).post('/api/operations/cancel/some-operation-id');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('POST /api/operations/unfollow-non-followers without auth → 401', async () => {
    const res = await request(app)
      .post('/api/operations/unfollow-non-followers')
      .send({ maxUnfollows: 10 });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('POST /api/operations/unfollow-everyone without auth → 401', async () => {
    const res = await request(app)
      .post('/api/operations/unfollow-everyone')
      .send({ maxUnfollows: 10 });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('POST /api/operations/detect-unfollowers without auth → 401', async () => {
    const res = await request(app)
      .post('/api/operations/detect-unfollowers')
      .send({});
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  // ─── Token that passes signature but references non-existent user ─────────

  it('GET /api/operations with fake (non-existent user) JWT → 401', async () => {
    const jwt = await import('jsonwebtoken');
    const secret = process.env.JWT_SECRET || 'test-secret';
    const fakeToken = jwt.default.sign(
      { userId: 'nonexistent-user-000', username: 'ghost' },
      secret,
      { expiresIn: '1h' }
    );

    const res = await request(app)
      .get('/api/operations')
      .set('Authorization', `Bearer ${fakeToken}`);

    // With DB: 401 "User not found"
    // Without DB: 500 "Authentication error"
    expect([401, 500]).toContain(res.status);
  });

  // ─── Pagination query params (auth guard fires first) ─────────────────────

  it('GET /api/operations?page=1&limit=5 without auth → 401', async () => {
    const res = await request(app)
      .get('/api/operations?page=1&limit=5');
    expect(res.status).toBe(401);
  });

  it('GET /api/operations?status=pending without auth → 401', async () => {
    const res = await request(app)
      .get('/api/operations?status=pending');
    expect(res.status).toBe(401);
  });

  // ─── Response shape contract (error responses) ────────────────────────────

  it('401 error response is JSON with error field', async () => {
    const res = await request(app).get('/api/operations');
    expect(res.headers['content-type']).toMatch(/json/);
    expect(typeof res.body.error).toBe('string');
  });
});
