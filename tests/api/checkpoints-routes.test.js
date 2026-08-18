// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Acceptance & Integration Tests — Story 10.4: Checkpoint Operational API Routes.
 * Uses supertest against the real Express app and a real test database.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import app from '../../api/server.js';
import { prisma, cleanupTestDatabase } from '../store/test-prisma-client.js';
import { generateApiKey, generateToken } from '../../src/a2a/auth.js';

const TEST_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-12345';

function makeUserToken(user) {
  return jwt.sign(
    { userId: user.id, username: user.username, isAdmin: user.isAdmin },
    TEST_SECRET,
    { expiresIn: '1h' }
  );
}

async function seedUser(overrides = {}) {
  const id = `test_ckpt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return prisma.user.create({
    data: {
      id,
      username: `ckpt_user_${id}`,
      email: `${id}@example.com`,
      password: await bcrypt.hash('TestPassword123!', 10),
      isAdmin: false,
      credits: 100,
      ...overrides,
    },
  });
}

let checkpointCounter = 0;
async function seedCheckpoint(overrides = {}) {
  checkpointCounter += 1;
  return prisma.crawlCheckpoint.create({
    data: {
      platform: 'twitter',
      targetType: 'profile',
      targetKey: `nichxbt_${checkpointCounter}`,
      status: 'running',
      errorCount: 0,
      ...overrides,
    },
  });
}

describe('Story 10.4: Checkpoints HTTP API — Authentication & Authorization (AC6)', () => {
  let adminUser;
  let regularUser;
  let a2aApiKey;
  let a2aToken;

  beforeAll(async () => {
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = TEST_SECRET;
    }
    await cleanupTestDatabase();
    adminUser = await seedUser({ isAdmin: true, username: 'ckpt_admin' });
    regularUser = await seedUser({ isAdmin: false, username: 'ckpt_regular' });
    a2aApiKey = (await generateApiKey('test-checkpoints-apikey', ['checkpoint:manage'])).key;
    a2aToken = await generateToken('test-checkpoints-bearer', ['checkpoint:manage']);
  });

  afterAll(async () => {
    if (adminUser || regularUser) {
      const ids = [adminUser?.id, regularUser?.id].filter(Boolean);
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    await cleanupTestDatabase();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.crawlCheckpoint.deleteMany({});
  });

  it('GET /api/checkpoints returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/checkpoints');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('XACT_4001');
  });

  it('GET /api/checkpoints returns 403 for a regular non-admin user', async () => {
    const token = makeUserToken(regularUser);
    const res = await request(app)
      .get('/api/checkpoints')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('XACT_4003');
  });

  it('GET /api/checkpoints returns 200 for an admin user', async () => {
    const token = makeUserToken(adminUser);
    const res = await request(app)
      .get('/api/checkpoints')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.checkpoints)).toBe(true);
  });

  it('GET /api/checkpoints returns 200 with an A2A API key that has checkpoint:manage', async () => {
    const res = await request(app)
      .get('/api/checkpoints')
      .set('X-Agent-API-Key', a2aApiKey);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.checkpoints)).toBe(true);
  });

  it('GET /api/checkpoints returns 200 with an A2A Bearer token that has checkpoint:manage', async () => {
    const res = await request(app)
      .get('/api/checkpoints')
      .set('Authorization', `Bearer ${a2aToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.checkpoints)).toBe(true);
  });
});

describe('Story 10.4: Checkpoints HTTP API — CRUD & Lifecycle Endpoints (AC1-AC5)', () => {
  let adminUser;
  let a2aApiKey;
  let adminToken;

  beforeAll(async () => {
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = TEST_SECRET;
    }
    await cleanupTestDatabase();
    adminUser = await seedUser({ isAdmin: true, username: 'ckpt_admin_lifecycle' });
    adminToken = makeUserToken(adminUser);
    a2aApiKey = (await generateApiKey('test-checkpoints-apikey-lifecycle', ['checkpoint:manage'])).key;
  });

  afterAll(async () => {
    if (adminUser) {
      await prisma.user.deleteMany({ where: { id: adminUser.id } });
    }
    await cleanupTestDatabase();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.crawlCheckpoint.deleteMany({});
  });

  it('GET /api/checkpoints returns paginated, filtered results', async () => {
    await seedCheckpoint({ platform: 'twitter', targetKey: 'alpha' });
    await seedCheckpoint({ platform: 'facebook', targetKey: 'beta' });

    const res = await request(app)
      .get('/api/checkpoints?platform=twitter')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.checkpoints).toHaveLength(1);
    expect(res.body.data.checkpoints[0].platform).toBe('twitter');
    expect(res.body.data.total).toBe(1);
  });

  it('GET /api/checkpoints/:id returns 404 for an unknown id', async () => {
    const res = await request(app)
      .get('/api/checkpoints/non_existent_cuid_999')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('XACT_4041');
  });

  it('POST /api/checkpoints/:id/resume updates a paused checkpoint to running', async () => {
    const paused = await seedCheckpoint({ status: 'paused', nextScheduledAt: null });
    const res = await request(app)
      .post(`/api/checkpoints/${paused.id}/resume`)
      .set('X-Agent-API-Key', a2aApiKey);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.checkpoint.status).toBe('running');
    expect(res.body.data.checkpoint.nextScheduledAt).toBeTruthy();
  });

  it('POST /api/checkpoints/:id/resume returns 400 for an illegal transition', async () => {
    const running = await seedCheckpoint({ status: 'running' });
    const res = await request(app)
      .post(`/api/checkpoints/${running.id}/resume`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('XACT_4002');
  });

  it('POST /api/checkpoints/:id/pause updates a running checkpoint to paused', async () => {
    const running = await seedCheckpoint({ status: 'running', nextScheduledAt: new Date() });
    const res = await request(app)
      .post(`/api/checkpoints/${running.id}/pause`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.checkpoint.status).toBe('paused');
    expect(res.body.data.checkpoint.nextScheduledAt).toBeNull();
  });

  it('POST /api/checkpoints/:id/retry resets errorCount and transitions to running', async () => {
    const failed = await seedCheckpoint({
      status: 'failed',
      errorCount: 5,
      lastCursor: 'preserved_cursor',
      nextScheduledAt: null,
    });
    const res = await request(app)
      .post(`/api/checkpoints/${failed.id}/retry`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.checkpoint.status).toBe('running');
    expect(res.body.data.checkpoint.errorCount).toBe(0);
    expect(res.body.data.checkpoint.lastCursor).toBe('preserved_cursor');
  });

  it('POST /api/checkpoints/:id/retry works for a paused checkpoint', async () => {
    const paused = await seedCheckpoint({
      status: 'paused',
      errorCount: 2,
      nextScheduledAt: null,
    });
    const res = await request(app)
      .post(`/api/checkpoints/${paused.id}/retry`)
      .set('X-Agent-API-Key', a2aApiKey);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.checkpoint.status).toBe('running');
    expect(res.body.data.checkpoint.errorCount).toBe(0);
  });
});
