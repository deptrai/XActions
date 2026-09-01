// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// by nichxbt
/**
 * Integration Tests — Story 10.6: Admin Retention REST API.
 * Uses supertest against the real Express app and a real test database; no mocks.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import app from '../../api/server.js';
import { prisma, cleanupTestDatabase } from '../store/test-prisma-client.js';

const TEST_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-12345';

function makeUserToken(user) {
  return jwt.sign(
    { userId: user.id, username: user.username, isAdmin: user.isAdmin },
    TEST_SECRET,
    { expiresIn: '1h' }
  );
}

async function seedUser(overrides = {}) {
  const id = `test_retention_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return prisma.user.create({
    data: {
      id,
      username: `retention_user_${id}`,
      email: `${id}@example.com`,
      password: await bcrypt.hash('TestPassword123!', 10),
      isAdmin: false,
      credits: 100,
      ...overrides,
    },
  });
}

describe('Story 10.6: Admin Retention API — Authentication & Authorization (AC5)', () => {
  let adminUser;
  let regularUser;

  beforeAll(async () => {
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = TEST_SECRET;
    }
    await cleanupTestDatabase();
    adminUser = await seedUser({ isAdmin: true, username: 'retention_admin' });
    regularUser = await seedUser({ isAdmin: false, username: 'retention_regular' });
  });

  afterAll(async () => {
    if (adminUser || regularUser) {
      const ids = [adminUser?.id, regularUser?.id].filter(Boolean);
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    await cleanupTestDatabase();
    await prisma.$disconnect();
  });

  it('POST /api/admin/retention/cleanup returns 401 when unauthenticated', async () => {
    const res = await request(app).post('/api/admin/retention/cleanup');
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  it('POST /api/admin/retention/cleanup returns 403 for a regular user', async () => {
    const token = makeUserToken(regularUser);
    const res = await request(app)
      .post('/api/admin/retention/cleanup')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBeDefined();
  });

  it('GET /api/admin/retention/stats returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/admin/retention/stats');
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  it('GET /api/admin/retention/stats returns 403 for a regular user', async () => {
    const token = makeUserToken(regularUser);
    const res = await request(app)
      .get('/api/admin/retention/stats')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBeDefined();
  });

  it('POST /api/admin/retention/cleanup returns 200 for an admin user', async () => {
    const token = makeUserToken(adminUser);
    const res = await request(app)
      .post('/api/admin/retention/cleanup')
      .set('Authorization', `Bearer ${token}`)
      .send({ dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.dryRun).toBe(true);
    expect(typeof res.body.data.postsEligible).toBe('number');
    expect(typeof res.body.data.commentsEligible).toBe('number');
    expect(typeof res.body.data.checkpointsEligible).toBe('number');
  });

  it('GET /api/admin/retention/stats returns 200 for an admin user', async () => {
    const token = makeUserToken(adminUser);
    const res = await request(app)
      .get('/api/admin/retention/stats')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.posts).toBeDefined();
    expect(res.body.data.comments).toBeDefined();
    expect(res.body.data.checkpoints).toBeDefined();
    expect(res.body.data.thresholds).toBeDefined();
  });

  it('POST /api/admin/retention/cleanup accepts x-admin-key when ADMIN_API_KEY is set', async () => {
    process.env.ADMIN_API_KEY = 'test-admin-key-12345';
    const res = await request(app)
      .post('/api/admin/retention/cleanup')
      .set('x-admin-key', 'test-admin-key-12345')
      .send({ dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    delete process.env.ADMIN_API_KEY;
  });
});

describe('Story 10.6: Admin Retention API — Cleanup & Stats Behavior', () => {
  let adminUser;
  let adminToken;

  beforeAll(async () => {
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = TEST_SECRET;
    }
    adminUser = await seedUser({ isAdmin: true, username: 'retention_admin_behavior' });
    adminToken = makeUserToken(adminUser);
  });

  afterAll(async () => {
    if (adminUser) {
      await prisma.user.deleteMany({ where: { id: adminUser.id } });
    }
    await cleanupTestDatabase();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanupTestDatabase();
  });

  it('POST /api/admin/retention/cleanup performs dry-run without deleting records', async () => {
    const oldDate = new Date(Date.now() - 35 * 86400000);
    await prisma.post.create({
      data: {
        id: 'twitter:ret_1',
        platform: 'twitter',
        externalId: 'ret_1',
        category: 'social',
        authorId: 'a',
        authorName: 'A',
        content: 'Old post',
        crawledAt: oldDate,
      },
    });

    const res = await request(app)
      .post('/api/admin/retention/cleanup')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ dryRun: true, retentionDays: 30 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.dryRun).toBe(true);
    expect(res.body.data.postsEligible).toBe(1);
    expect(res.body.data.commentsEligible).toBe(0);
    expect(await prisma.post.count()).toBe(1);
  });

  it('POST /api/admin/retention/cleanup deletes records when dryRun is false', async () => {
    const oldDate = new Date(Date.now() - 35 * 86400000);
    await prisma.post.create({
      data: {
        id: 'twitter:ret_2',
        platform: 'twitter',
        externalId: 'ret_2',
        category: 'social',
        authorId: 'a',
        authorName: 'A',
        content: 'Old post',
        crawledAt: oldDate,
      },
    });

    const res = await request(app)
      .post('/api/admin/retention/cleanup')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ dryRun: false, retentionDays: 30 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.dryRun).toBe(false);
    expect(res.body.data.postsDeleted).toBe(1);
    expect(await prisma.post.count()).toBe(0);
  });

  it('GET /api/admin/retention/stats reflects seeded records', async () => {
    const oldDate = new Date(Date.now() - 35 * 86400000);
    await prisma.post.create({
      data: {
        id: 'twitter:ret_3',
        platform: 'twitter',
        externalId: 'ret_3',
        category: 'social',
        authorId: 'a',
        authorName: 'A',
        content: 'Old post',
        crawledAt: oldDate,
      },
    });

    const res = await request(app)
      .get('/api/admin/retention/stats?rawDays=30')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.posts.total).toBe(1);
    expect(res.body.data.posts.olderThan30d).toBeGreaterThanOrEqual(1);
  });

  it('POST /api/admin/retention/cleanup returns 500 with error envelope on invalid platform', async () => {
    const res = await request(app)
      .post('/api/admin/retention/cleanup')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ dryRun: true, platform: 'not-a-platform' });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('XACT_5000');
    expect(res.body.error.message).toContain('Unsupported platform filter');
  });

  it('POST /api/admin/retention/cleanup overlaps with an in-flight run are rejected', async () => {
    const oldDate = new Date(Date.now() - 35 * 86400000);
    await prisma.post.create({
      data: {
        id: 'twitter:ret_4',
        platform: 'twitter',
        externalId: 'ret_4',
        category: 'social',
        authorId: 'a',
        authorName: 'A',
        content: 'Old post',
        crawledAt: oldDate,
      },
    });

    const { runGuardedRetention } = await import('../../api/services/retentionScheduler.js');
    // Acquire lock without releasing
    const { acquireRetentionLock } = await import('../../api/services/retentionScheduler.js');
    acquireRetentionLock();

    try {
      const res = await request(app)
        .post('/api/admin/retention/cleanup')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ dryRun: false, retentionDays: 30 });

      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('XACT_5000');
      expect(res.body.error.message).toContain('already running');
    } finally {
      const { releaseRetentionLock } = await import('../../api/services/retentionScheduler.js');
      releaseRetentionLock();
    }
  });
});
