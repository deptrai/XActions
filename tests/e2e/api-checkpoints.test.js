// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * E2E Tests — Story 10.4: CrawlCheckpoint Operational API.
 * Exercises the full Express stack with real DB, real auth, and real A2A credentials.
 * by nichxbt
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../api/server.js';
import {
  cleanupTestUser,
  makeTestToken,
} from '../api/fixtures/test-user.js';
import { prisma } from '../store/test-prisma-client.js';
import { generateApiKey } from '../../src/a2a/auth.js';
import bcrypt from 'bcryptjs';
import { nextTestId } from '../utils/test-ids.js';

const TEST_SCOPE = 'e2e-api-checkpoints';
const TEST_ADMIN_ID = 'e2e-checkpoints-admin';
const TEST_REGULAR_ID = 'e2e-checkpoints-regular';

let adminToken;
let regularToken;
let a2aApiKey;

async function seedUser(userId, username, isAdmin = false) {
  const hashedPassword = await bcrypt.hash('TestPassword123!', 10);
  const user = await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: {
      id: userId,
      username,
      email: `${userId}@example.com`,
      password: hashedPassword,
      credits: 100,
      isAdmin,
    },
  });
  return { user, token: makeTestToken(user.id, user.username) };
}

let checkpointCounter = 0;
async function seedCheckpoint(overrides = {}) {
  checkpointCounter += 1;
  return prisma.crawlCheckpoint.create({
    data: {
      platform: 'twitter',
      targetType: 'profile',
      targetKey: `e2e_ckpt_${checkpointCounter}`,
      status: 'running',
      errorCount: 0,
      ...overrides,
    },
  });
}

async function cleanupCheckpoints() {
  await prisma.crawlCheckpoint.deleteMany({
    where: { targetKey: { startsWith: 'e2e_ckpt_' } },
  });
}

describe('E2E: /api/checkpoints (Story 10.4)', () => {
  beforeAll(async () => {
    const admin = await seedUser(TEST_ADMIN_ID, 'checkpoints_e2e_admin', true);
    adminToken = admin.token;

    const regular = await seedUser(TEST_REGULAR_ID, 'checkpoints_e2e_regular', false);
    regularToken = regular.token;

    a2aApiKey = (await generateApiKey('e2e-checkpoints-apikey', ['checkpoint:manage'])).key;
  });

  afterAll(async () => {
    await cleanupCheckpoints();
    await cleanupTestUser(TEST_ADMIN_ID);
    await cleanupTestUser(TEST_REGULAR_ID);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanupCheckpoints();
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P0')}] GET /api/checkpoints without auth → 401`, async () => {
    const res = await request(app).get('/api/checkpoints');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] GET /api/checkpoints with admin token → 200`, async () => {
    const res = await request(app)
      .get('/api/checkpoints')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.checkpoints)).toBe(true);
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] GET /api/checkpoints with A2A API key → 200`, async () => {
    const res = await request(app)
      .get('/api/checkpoints')
      .set('X-Agent-API-Key', a2aApiKey);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P2')}] GET /api/checkpoints/:id returns checkpoint details`, async () => {
    const checkpoint = await seedCheckpoint({ status: 'paused' });
    const res = await request(app)
      .get(`/api/checkpoints/${checkpoint.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.checkpoint.id).toBe(checkpoint.id);
    expect(res.body.data.checkpoint.status).toBe('paused');
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P2')}] GET /api/checkpoints/:id unknown id → 404`, async () => {
    const res = await request(app)
      .get('/api/checkpoints/non_existent_cuid_999')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] POST /api/checkpoints/:id/resume transitions paused → running`, async () => {
    const checkpoint = await seedCheckpoint({ status: 'paused' });
    const res = await request(app)
      .post(`/api/checkpoints/${checkpoint.id}/resume`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.checkpoint.status).toBe('running');
    expect(res.body.data.checkpoint.nextScheduledAt).toBeTruthy();
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P2')}] POST /api/checkpoints/:id/resume illegal transition → 400`, async () => {
    const checkpoint = await seedCheckpoint({ status: 'running' });
    const res = await request(app)
      .post(`/api/checkpoints/${checkpoint.id}/resume`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] POST /api/checkpoints/:id/pause transitions running → paused`, async () => {
    const checkpoint = await seedCheckpoint({ status: 'running', nextScheduledAt: new Date() });
    const res = await request(app)
      .post(`/api/checkpoints/${checkpoint.id}/pause`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.checkpoint.status).toBe('paused');
    expect(res.body.data.checkpoint.nextScheduledAt).toBeNull();
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] POST /api/checkpoints/:id/retry resets errorCount`, async () => {
    const checkpoint = await seedCheckpoint({ status: 'failed', errorCount: 5, nextScheduledAt: null });
    const res = await request(app)
      .post(`/api/checkpoints/${checkpoint.id}/retry`)
      .set('X-Agent-API-Key', a2aApiKey);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.checkpoint.status).toBe('running');
    expect(res.body.data.checkpoint.errorCount).toBe(0);
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] GET /api/checkpoints filters by platform and status`, async () => {
    await seedCheckpoint({ platform: 'twitter', status: 'running' });
    await seedCheckpoint({ platform: 'facebook', status: 'paused' });

    const res = await request(app)
      .get('/api/checkpoints?platform=twitter&status=running')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.checkpoints).toHaveLength(1);
    expect(res.body.data.checkpoints[0].platform).toBe('twitter');
    expect(res.body.data.checkpoints[0].status).toBe('running');
    expect(res.body.data.total).toBe(1);
  });
});
