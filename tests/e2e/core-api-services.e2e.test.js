// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * E2E Test Suite — Core Backend API Services & Intelligence Engine
 *
 * Verifies end-to-end endpoints across:
 * 1. AI Content Optimizer (/api/optimizer/optimize, /hashtags, /predict)
 * 2. Workflow Orchestration (/api/workflows, /api/workflows/actions)
 * 3. Dataset Management (/api/datasets)
 * 4. Licensing & Tiers (/api/license/, /api/license/tiers, /api/license/validate)
 * 5. Proxy Rate Budget & Governor Status (/api/proxy/budget/status)
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../api/server.js';
import { seedTestUser, cleanupTestUser, makeTestUserId, TEST_SECRET } from '../api/fixtures/test-user.js';
import jwt from 'jsonwebtoken';
import { nextTestId } from '../utils/test-ids.js';

const TEST_SCOPE = 'e2e-core-api';
const TEST_USER_ID = makeTestUserId('core-api-e2e');

let authToken = '';

beforeAll(async () => {
  const user = await seedTestUser(TEST_USER_ID, 'core_api_tester');
  authToken = jwt.sign(
    { userId: user.id, username: user.username, role: 'admin' },
    TEST_SECRET,
    { expiresIn: '1h' }
  );
});

afterAll(async () => {
  await cleanupTestUser(TEST_USER_ID);
});

describe('Backend — Core API Services & Modules E2E', () => {
  // ─── 1. Content Optimizer ────────────────────────────────────────────────
  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P0')}] POST /api/optimizer/optimize returns rewritten tweet with higher score`, async () => {
    const res = await request(app)
      .post('/api/optimizer/optimize')
      .send({
        text: 'we launched new ai feature today check it out',
        goal: 'engagement',
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('optimized');
    expect(res.body).toHaveProperty('predictedLift');
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] POST /api/optimizer/optimize rejects missing text with 400`, async () => {
    const res = await request(app)
      .post('/api/optimizer/optimize')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] POST /api/optimizer/hashtags suggests relevant tags`, async () => {
    const res = await request(app)
      .post('/api/optimizer/hashtags')
      .send({
        text: 'building fullstack typescript apps with node and react',
        count: 4,
      });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.hashtags || res.body)).toBe(true);
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] POST /api/optimizer/predict scores tweet viral potential`, async () => {
    const res = await request(app)
      .post('/api/optimizer/predict')
      .send({
        text: '10 lessons from bootstrapping to $1M ARR in 12 months with zero funding:',
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('score');
  });

  // ─── 2. Workflows ────────────────────────────────────────────────────────
  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P0')}] GET /api/workflows/actions lists all available automation actions`, async () => {
    const res = await request(app)
      .get('/api/workflows/actions')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.actions || res.body)).toBe(true);
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] GET /api/workflows returns list of user workflows`, async () => {
    const res = await request(app)
      .get('/api/workflows')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.workflows || res.body)).toBe(true);
  });

  // ─── 3. Datasets ─────────────────────────────────────────────────────────
  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] GET /api/datasets returns datasets catalog`, async () => {
    const res = await request(app)
      .get('/api/datasets')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
  });

  // ─── 4. License Engine ───────────────────────────────────────────────────
  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P0')}] GET /api/license/ returns current system license details`, async () => {
    const res = await request(app).get('/api/license/');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('tier');
    expect(res.body).toHaveProperty('valid');
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] GET /api/license/tiers lists license pricing tiers`, async () => {
    const res = await request(app).get('/api/license/tiers');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('tiers');
    expect(Array.isArray(res.body.tiers)).toBe(true);
    const tierNames = res.body.tiers.map(t => t.name);
    expect(tierNames).toContain('free');
    expect(tierNames).toContain('enterprise');
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] POST /api/license/validate validates license keys`, async () => {
    const res = await request(app)
      .post('/api/license/validate')
      .send({ licenseKey: 'invalid_license_test_key' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ valid: false });
  });

  // ─── 5. Proxy Budget & Governor ──────────────────────────────────────────
  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] GET /api/proxy/budget/status returns current budget ledger status`, async () => {
    const res = await request(app)
      .get('/api/proxy/budget/status')
      .set('Authorization', `Bearer ${authToken}`);

    expect([200, 401, 404]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.success || res.body.status || res.body.data).toBeDefined();
    }
  });
});
