// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 46.2 — pilot route contract tests.
 *
 * At least one deterministic error path (400/401/404) per pilot group, plus
 * success-envelope coverage for Checkpoints (paginated) and Auth (token).
 *
 * @author nich (@nichxbt)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../../api/server.js';
import { prisma } from '../../store/test-prisma-client.js';
import {
  seedTestUser,
  cleanupTestUser,
  makeTestUserId,
  makeTestToken,
} from '../fixtures/test-user.js';

const expectErrorEnvelope = (res, status, code) => {
  expect(res.status).toBe(status);
  expect(res.body.success).toBe(false);
  expect(res.body.error).toMatchObject({ code, message: expect.any(String) });
};

const expectValidationIssues = (res) => {
  expectErrorEnvelope(res, 400, 'VALIDATION_FAILED');
  const issues = res.body.error.details?.issues;
  expect(Array.isArray(issues)).toBe(true);
  expect(issues.length).toBeGreaterThan(0);
  for (const issue of issues) {
    expect(issue).toMatchObject({
      location: expect.any(String),
      path: expect.any(String),
      code: expect.any(String),
      message: expect.any(String),
    });
  }
};

let user;
let admin;
const userId = makeTestUserId('contract-user');
const adminId = makeTestUserId('contract-admin');

beforeAll(async () => {
  user = await seedTestUser(userId, `contract_${userId.replace(/-/g, '_')}`);
  admin = await seedTestUser(adminId, `contract_${adminId.replace(/-/g, '_')}`, { isAdmin: true });
});

afterAll(async () => {
  await cleanupTestUser(userId);
  await cleanupTestUser(adminId);
});

describe('pilot: /api/auth', () => {
  it('POST /register with empty body → 400 VALIDATION_FAILED', async () => {
    const res = await request(app).post('/api/auth/register').send({});
    expectValidationIssues(res);
  });

  it('POST /register with short password → 400 VALIDATION_FAILED', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'validuser_1', password: 'short' });
    expectValidationIssues(res);
  });

  it('POST /login with bad credentials → 401 UNAUTHORIZED envelope', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: user.username, password: 'wrong-password-1' });
    expectErrorEnvelope(res, 401, 'UNAUTHORIZED');
  });

  it('POST /login success → { success:true, data:{ token } }', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: user.username, password: user.password });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.token).toBe('string');
  });

  it('POST /refresh with missing token → 400 VALIDATION_FAILED', async () => {
    const res = await request(app).post('/api/auth/refresh').send({});
    expectValidationIssues(res);
  });

  it('POST /refresh with garbage token → 401 UNAUTHORIZED', async () => {
    const res = await request(app).post('/api/auth/refresh').send({ token: 'not-a-jwt' });
    expectErrorEnvelope(res, 401, 'UNAUTHORIZED');
  });
});

describe('pilot: /api/viral', () => {
  it('POST /mine with empty body → 400 VALIDATION_FAILED', async () => {
    const res = await request(app).post('/api/viral/mine').send({});
    expectValidationIssues(res);
  });

  it('POST /mine success → success envelope with job payload', async () => {
    const res = await request(app)
      .post('/api/viral/mine')
      .send({ platform: 'threads', niche: 'ai', count: 5 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.job).toBeTruthy();
    // The stored job carries the caller's session credential — never emit it.
    expect('session' in res.body.data.job).toBe(false);
  });

  it('POST /mine with out-of-range count → 400 VALIDATION_FAILED', async () => {
    for (const count of [10001, 'abc']) {
      const res = await request(app)
        .post('/api/viral/mine')
        .send({ platform: 'threads', niche: 'ai', count });
      expectValidationIssues(res);
    }
  });

  it('GET /mine/:jobId unknown job → 404 envelope', async () => {
    const res = await request(app).get('/api/viral/mine/no-such-job-46-2');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBeTruthy();
  });

  it('GET /platforms → success envelope', async () => {
    const res = await request(app).get('/api/viral/platforms');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeTruthy();
  });
});

describe('pilot: /api/crm', () => {
  it('GET /search without credentials → 401 envelope', async () => {
    const res = await request(app).get('/api/crm/search');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBeTruthy();
  });

  it('POST /tag with auth + invalid body → 400 VALIDATION_FAILED', async () => {
    const res = await request(app)
      .post('/api/crm/tag')
      .set('Authorization', `Bearer ${user.token}`)
      .send({});
    expectValidationIssues(res);
  });
});

describe('pilot: /api/optimizer', () => {
  it('POST /optimize with empty body → 400 VALIDATION_FAILED', async () => {
    const res = await request(app).post('/api/optimizer/optimize').send({});
    expectValidationIssues(res);
  });

  it('POST /hashtags with valid body → success envelope', async () => {
    const res = await request(app)
      .post('/api/optimizer/hashtags')
      .send({ text: 'launch day for our new api', count: 3 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeTruthy();
  });
});

describe('pilot: /api/checkpoints', () => {
  it('GET / without credentials → 401 XACT_4001 envelope', async () => {
    const res = await request(app).get('/api/checkpoints');
    expectErrorEnvelope(res, 401, 'XACT_4001');
  });

  it('GET / with non-admin user → 403 XACT_4003 envelope', async () => {
    const res = await request(app)
      .get('/api/checkpoints')
      .set('Authorization', `Bearer ${makeTestToken(user.id, user.username)}`);
    expectErrorEnvelope(res, 403, 'XACT_4003');
  });

  it('GET / with admin → paginated success envelope { data, page }', async () => {
    const res = await request(app)
      .get('/api/checkpoints')
      .set('Authorization', `Bearer ${makeTestToken(admin.id, admin.username)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.page).toMatchObject({ limit: expect.any(Number) });
    expect('cursor' in res.body.page).toBe(true);
  });

  it('GET /?limit=abc → 400 VALIDATION_FAILED (query coercion)', async () => {
    const res = await request(app)
      .get('/api/checkpoints?limit=abc')
      .set('Authorization', `Bearer ${makeTestToken(admin.id, admin.username)}`);
    expectValidationIssues(res);
  });

  it('GET /?cursor=<garbage> → 400 VALIDATION_FAILED (opaque cursor)', async () => {
    const res = await request(app)
      .get('/api/checkpoints?cursor=%%%not-base64%%%')
      .set('Authorization', `Bearer ${makeTestToken(admin.id, admin.username)}`);
    expectErrorEnvelope(res, 400, 'VALIDATION_FAILED');
  });

  it('GET /?limit=1 → follows page.cursor to the next page', async () => {
    const auth = { Authorization: `Bearer ${makeTestToken(admin.id, admin.username)}` };
    const keySuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await prisma.crawlCheckpoint.create({
      data: { platform: 'twitter', targetType: 'profile', targetKey: `contract_cursor_a_${keySuffix}`, status: 'running', errorCount: 0 },
    });
    await prisma.crawlCheckpoint.create({
      data: { platform: 'twitter', targetType: 'profile', targetKey: `contract_cursor_b_${keySuffix}`, status: 'running', errorCount: 0 },
    });

    const page1 = await request(app).get('/api/checkpoints?limit=1&sortBy=createdAt&order=asc').set(auth);
    expect(page1.status).toBe(200);
    expect(page1.body.data).toHaveLength(1);
    expect(typeof page1.body.page.total).toBe('number');
    if (page1.body.page.total > 1) {
      expect(page1.body.page.cursor).toBeTruthy();
      const page2 = await request(app)
        .get(`/api/checkpoints?limit=1&sortBy=createdAt&order=asc&cursor=${encodeURIComponent(page1.body.page.cursor)}`)
        .set(auth);
      expect(page2.status).toBe(200);
      expect(page2.body.data).toHaveLength(1);
      expect(page2.body.data[0].id).not.toBe(page1.body.data[0].id);
    }
  });

  it('GET /?offset=1e20 → 400 VALIDATION_FAILED (offset bounded)', async () => {
    const res = await request(app)
      .get('/api/checkpoints?offset=1e20')
      .set('Authorization', `Bearer ${makeTestToken(admin.id, admin.username)}`);
    expectErrorEnvelope(res, 400, 'VALIDATION_FAILED');
  });

  it('GET /:id unknown → 404 envelope', async () => {
    const res = await request(app)
      .get('/api/checkpoints/ck_does_not_exist_46_2')
      .set('Authorization', `Bearer ${makeTestToken(admin.id, admin.username)}`);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBeTruthy();
  });
});

describe('pilot: /api/session', () => {
  it('POST /save-session without auth → 401 envelope', async () => {
    const res = await request(app).post('/api/session/save-session').send({});
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBeTruthy();
  });

  it('POST /save-session with auth + invalid body → 400 VALIDATION_FAILED', async () => {
    const res = await request(app)
      .post('/api/session/save-session')
      .set('Authorization', `Bearer ${user.token}`)
      .send({});
    expectValidationIssues(res);
  });
});
