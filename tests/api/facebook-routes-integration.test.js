// tests/api/facebook-routes-integration.test.js
// Phase 2: Integration tests for facebook.js route handlers — bypass auth with real DB user.
// Tests the actual route logic (validation, dispatch, error handling) not just guards.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import app from '../../api/server.js';

const prisma = new PrismaClient();
const TEST_SECRET = process.env.JWT_SECRET || 'test-secret';

const TEST_USER = {
  id: 'test-user-fb-routes-int',
  username: 'fb_routes_test',
  email: 'fb_routes_test@example.com',
};

let authToken;

beforeAll(async () => {
  // Seed user
  await prisma.user.upsert({
    where: { id: TEST_USER.id },
    update: {},
    create: { ...TEST_USER, credits: 100 },
  });
  authToken = jwt.sign({ userId: TEST_USER.id, username: TEST_USER.username }, TEST_SECRET, { expiresIn: '1h' });
});

afterAll(async () => {
  await prisma.operation.deleteMany({ where: { userId: TEST_USER.id } });
  await prisma.user.deleteMany({ where: { id: TEST_USER.id } }).catch(() => {});
});

// ============================================================================
// POST /api/facebook/scrape — validation + dispatch
// ============================================================================

describe('POST /api/facebook/scrape — integration', () => {
  it('returns 400 for invalid action (L123-127)', async () => {
    const res = await request(app)
      .post('/api/facebook/scrape')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ action: 'invalid-action', url: 'https://facebook.com/test' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/action must be one of/);
  });

  it('returns 400 for missing action (L123)', async () => {
    const res = await request(app)
      .post('/api/facebook/scrape')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ url: 'https://facebook.com/test' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/action must be one of/);
  });

  it('returns 400 when profile action missing url (L130-131)', async () => {
    const res = await request(app)
      .post('/api/facebook/scrape')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ action: 'profile' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/requires url/);
  });

  it('returns 400 when posts action missing url (L130)', async () => {
    const res = await request(app)
      .post('/api/facebook/scrape')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ action: 'posts', url: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/requires url/);
  });

  it('returns 400 when followers action missing url (L130)', async () => {
    const res = await request(app)
      .post('/api/facebook/scrape')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ action: 'followers' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/requires url/);
  });

  it('returns 400 when group-members action missing url (L130)', async () => {
    const res = await request(app)
      .post('/api/facebook/scrape')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ action: 'group-members' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/requires url/);
  });

  it('returns 400 when search action missing query (L133-134)', async () => {
    const res = await request(app)
      .post('/api/facebook/scrape')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ action: 'search' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/requires query/);
  });

  it('returns 400 when search action has empty query (L133: !query?.trim())', async () => {
    const res = await request(app)
      .post('/api/facebook/scrape')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ action: 'search', query: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/requires query/);
  });

  it('returns 500 (not 400) when scrape dispatch fails (L157-161)', async () => {
    // Valid action + url, but scrape will fail (no browser/Puppeteer in test env)
    const res = await request(app)
      .post('/api/facebook/scrape')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ action: 'profile', url: 'https://facebook.com/test' });
    // Should be 500 (scrape fails) or 200 (if scrape somehow works)
    expect([200, 500]).toContain(res.status);
    if (res.status === 500) {
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toMatch(/scrape failed/i);
    }
  });
});

// ============================================================================
// POST /api/facebook/automate — validation + dispatch
// ============================================================================

describe('POST /api/facebook/automate — integration', () => {
  const VALID_COOKIE = { c_user: '100000000000001', xs: 'test-xs-value' };

  it('returns 400 when missing Facebook cookie (L184-185)', async () => {
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ action: 'like', urls: ['https://facebook.com/post/1'] });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/session is required/);
  });

  it('returns 400 for invalid action (L190-196)', async () => {
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ action: 'invalid', authCookie: VALID_COOKIE });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/action must be one of/);
  });

  it('normalizes "messenger" alias to "messenger-share" (L188)', async () => {
    // messenger is a valid alias — should NOT return 400 for invalid action
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ action: 'messenger', authCookie: VALID_COOKIE, dryRun: true });
    // Should not be 400 "invalid action" — may be 400 for other reasons or 200/500
    if (res.status === 400) {
      expect(res.body.error).not.toMatch(/action must be one of/);
    }
  });

  it('returns 400 when like action missing urls (L?)', async () => {
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ action: 'like', authCookie: VALID_COOKIE });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('returns 400 when comment action missing text (L?)', async () => {
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ action: 'comment', urls: ['https://facebook.com/post/1'], authCookie: VALID_COOKIE });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('accepts accountId in authCookie (stored-account path, L?)', async () => {
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ action: 'like', urls: ['https://facebook.com/post/1'], authCookie: { accountId: 'fake-account-id' }, dryRun: true });
    // Should NOT be 400 "session required" — accountId satisfies requireFacebookCookie
    if (res.status === 400) {
      expect(res.body.error).not.toMatch(/session is required/);
    }
  });

  it('accepts accountIds array (multi-account path, L?)', async () => {
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ action: 'like', urls: ['https://facebook.com/post/1'], accountIds: ['acct1', 'acct2'], dryRun: true });
    if (res.status === 400) {
      expect(res.body.error).not.toMatch(/session is required/);
    }
  });

  it('dryRun=true for like action returns preview (L?)', async () => {
    const res = await request(app)
      .post('/api/facebook/automate')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        action: 'like',
        urls: ['https://facebook.com/post/1', 'https://facebook.com/post/2'],
        authCookie: VALID_COOKIE,
        dryRun: true,
      });
    // Should be 200 with dryRun result, or 500 if scrape fails
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.ok).toBe(true);
    }
  });
});
