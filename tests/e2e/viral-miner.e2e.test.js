// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * E2E Test Suite — Epic 45: Viral DNA Miner & Decision Plane Analytics
 *
 * Verifies end-to-end flow:
 * 1. Platform discovery (/api/viral/platforms)
 * 2. Real-time corpus mining job initiation & polling (/api/viral/mine)
 * 3. Aggregated viral stats query & hook distribution (/api/viral/stats/:platform/:niche)
 * 4. Prediction backtest execution & report generation (/api/viral/backtest)
 * 5. Raw corpus download endpoint (/api/viral/corpus/:platform/:niche)
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../api/server.js';
import { nextTestId } from '../utils/test-ids.js';

const TEST_SCOPE = 'e2e-viral-miner';

describe('Epic 45 — Viral DNA Miner E2E Pipeline', () => {
  let createdJobId = null;
  let createdReportId = null;

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P0')}] GET /api/viral/platforms returns all 18 supported platforms across 4 categories`, async () => {
    const res = await request(app).get('/api/viral/platforms');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Story 46.2 — canonical envelope: payload lives under data
    expect(res.body.data.total).toBe(18);
    expect(res.body.data.platforms).toHaveProperty('social');
    expect(res.body.data.platforms).toHaveProperty('recruitment');
    expect(res.body.data.platforms).toHaveProperty('realestate');
    expect(res.body.data.platforms).toHaveProperty('ecom');
    expect(res.body.data.platforms.social).toContain('threads');
    expect(res.body.data.platforms.social).toContain('twitter');
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P0')}] GET /api/viral/stats lists all persisted viral stats catalogs`, async () => {
    const res = await request(app).get('/api/viral/stats');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.stats)).toBe(true);
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P0')}] GET /api/viral/stats/threads/ai returns Hook Type distribution and top patterns`, async () => {
    const res = await request(app).get('/api/viral/stats/threads/ai');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.platform).toBe('threads');
    expect(res.body.data.niche).toBe('ai');
    expect(res.body.data.stats).toBeDefined();
    expect(res.body.data.stats.hookTypeDistribution).toBeDefined();
    expect(Array.isArray(res.body.data.stats.topPerformingPatterns)).toBe(true);
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] POST /api/viral/mine creates a new mining job and returns queued status`, async () => {
    const res = await request(app)
      .post('/api/viral/mine')
      .send({
        platform: 'threads',
        niche: 'ai',
        count: 5,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.jobId).toMatch(/^viral-\d+-[a-f0-9]+/);
    expect(res.body.data.status).toBe('queued');
    expect(res.body.data.job.platform).toBe('threads');
    expect(res.body.data.job.niche).toBe('ai');

    createdJobId = res.body.data.jobId;
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] GET /api/viral/mine/:jobId returns job details and progress`, async () => {
    if (!createdJobId) return;

    const res = await request(app).get(`/api/viral/mine/${createdJobId}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.job.id).toBe(createdJobId);
    expect(['queued', 'running', 'completed']).toContain(res.body.data.job.status);
    expect(res.body.data.job.progress).toBeDefined();
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] POST /api/viral/backtest triggers prediction backtesting against actual performance`, async () => {
    const res = await request(app)
      .post('/api/viral/backtest')
      .send({
        platform: 'threads',
        niche: 'ai',
        days: 7,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.reportId).toBeDefined();
    expect(res.body.data.report.platform).toBe('threads');
    expect(res.body.data.report.niche).toBe('ai');

    createdReportId = res.body.data.reportId;
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P1')}] GET /api/viral/backtest/:reportId returns report status`, async () => {
    if (!createdReportId) return;

    const res = await request(app).get(`/api/viral/backtest/${createdReportId}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.report.id).toBe(createdReportId);
    expect(['queued', 'running', 'completed']).toContain(res.body.data.report.status);
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P2')}] GET /api/viral/corpus/:platform/:niche returns raw corpus metadata`, async () => {
    const res = await request(app).get('/api/viral/corpus/threads/ai');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.platform).toBe('threads');
    expect(res.body.data.niche).toBe('ai');
  });

  it(`[${nextTestId(TEST_SCOPE, 'E2E', 'P2')}] POST /api/viral/mine rejects unsupported platforms with 400`, async () => {
    const res = await request(app)
      .post('/api/viral/mine')
      .send({
        platform: 'unsupported_platform_xyz',
        niche: 'ai',
        count: 10,
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_PLATFORM');
  });
});
