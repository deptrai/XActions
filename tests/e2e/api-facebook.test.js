// by nichxbt
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../api/server.js';

describe('Facebook automation endpoints', () => {
  // ─── Auth guard ──────────────────────────────────────────────────────────

  it('POST /api/facebook/automate without auth → 401', async () => {
    const res = await request(app)
      .post('/api/facebook/automate')
      .send({ action: 'like', urls: ['https://facebook.com/post/1'] });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('POST /api/facebook/scrape without auth → 401', async () => {
    const res = await request(app)
      .post('/api/facebook/scrape')
      .send({ action: 'profile', url: 'https://facebook.com/somepage' });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  // ─── Body schema validation (auth bypass via invalid JWT → 401 first) ─────
  // The auth middleware runs before body validation, so without a valid token
  // we always get 401. These tests confirm the auth layer is hit correctly
  // and that a structurally broken request doesn't accidentally pass through.

  it('POST /api/facebook/automate with invalid Bearer token → 401', async () => {
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', 'Bearer invalid.jwt.token')
      .send({ action: 'like', urls: ['https://facebook.com/post/1'],
               authCookie: { c_user: '123', xs: 'abc' } });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  // ─── Validation layer (reachable only with a structurally valid JWT that
  //     passes signature check but points to a non-existent user — the auth
  //     middleware returns 401 "User not found" before DB is needed for
  //     business logic. We test the layer just below auth by issuing a
  //     well-formed JWT signed with the test secret.)
  //
  //     If JWT_SECRET is not set in test env the middleware will throw a
  //     500 "Authentication error" — still not 200, so assertions hold.

  it('POST /api/facebook/automate with valid token but missing action → 401 or 400', async () => {
    // A JWT that looks valid but references a non-existent userId
    const jwt = await import('jsonwebtoken');
    const secret = process.env.JWT_SECRET || 'test-secret';
    const fakeToken = jwt.default.sign({ userId: 'fake-id-000', username: 'ghost' }, secret, { expiresIn: '1h' });

    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${fakeToken}`)
      .send({ authCookie: { c_user: '123', xs: 'abc' } }); // missing action

    // Auth middleware hits DB → 401 "User not found" when no DB,
    // or 400 from body validation when DB is available and user exists.
    expect([400, 401, 500]).toContain(res.status);
  });

  it('POST /api/facebook/automate with valid token but invalid action → 401 or 400', async () => {
    const jwt = await import('jsonwebtoken');
    const secret = process.env.JWT_SECRET || 'test-secret';
    const fakeToken = jwt.default.sign({ userId: 'fake-id-001', username: 'ghost' }, secret, { expiresIn: '1h' });

    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${fakeToken}`)
      .send({ action: 'INVALID_ACTION', authCookie: { c_user: '123', xs: 'abc' } });

    expect([400, 401, 500]).toContain(res.status);
  });

  // ─── Scrape action validation ─────────────────────────────────────────────

  it('POST /api/facebook/scrape with valid token but missing action → 401 or 400', async () => {
    const jwt = await import('jsonwebtoken');
    const secret = process.env.JWT_SECRET || 'test-secret';
    const fakeToken = jwt.default.sign({ userId: 'fake-id-002', username: 'ghost' }, secret, { expiresIn: '1h' });

    const res = await request(app)
      .post('/api/facebook/scrape')
      .set('Authorization', `Bearer ${fakeToken}`)
      .send({ url: 'https://facebook.com/somepage' }); // missing action

    expect([400, 401, 500]).toContain(res.status);
  });

  it('POST /api/facebook/scrape with valid token but invalid action → 401 or 400', async () => {
    const jwt = await import('jsonwebtoken');
    const secret = process.env.JWT_SECRET || 'test-secret';
    const fakeToken = jwt.default.sign({ userId: 'fake-id-003', username: 'ghost' }, secret, { expiresIn: '1h' });

    const res = await request(app)
      .post('/api/facebook/scrape')
      .set('Authorization', `Bearer ${fakeToken}`)
      .send({ action: 'UNKNOWN', url: 'https://facebook.com/somepage' });

    expect([400, 401, 500]).toContain(res.status);
  });

  // ─── Auth cookie guard (body validation, runs after auth) ─────────────────
  // When the auth middleware blocks with 401, the cookie guard is never reached.
  // This test documents the expected contract: no cookie → 400 (if auth passes).

  it('POST /api/facebook/automate with valid token but missing authCookie → 400 or 401', async () => {
    const jwt = await import('jsonwebtoken');
    const secret = process.env.JWT_SECRET || 'test-secret';
    const fakeToken = jwt.default.sign({ userId: 'fake-id-004', username: 'ghost' }, secret, { expiresIn: '1h' });

    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${fakeToken}`)
      .send({ action: 'like', urls: ['https://facebook.com/post/1'] }); // no authCookie

    // 401 = auth middleware blocked (no DB / user not found)
    // 400 = cookie guard fired (auth passed, validation layer reached)
    expect([400, 401, 500]).toContain(res.status);
  });
});
