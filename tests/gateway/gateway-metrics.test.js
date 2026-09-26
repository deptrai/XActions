// tests/gateway/gateway-metrics.test.js
// Story 50.4 — Gateway Observability Metrics & Trace Lookup
// by nichxbt

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

import adminRouter from '../../api/routes/admin.js';
import {
  recordGatewayCall,
  getMetricsSummary,
  getCallTrace,
  getRecentCalls,
  _resetMetrics,
} from '../../api/services/gatewayMetrics.js';

const ADMIN_KEY = 'test_admin_key_metrics_001';
const ORIGINAL_ENV = { ...process.env };

let app;
beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  _resetMetrics();

  app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
});

afterEach(() => {
  _resetMetrics();
  process.env = { ...ORIGINAL_ENV };
});

describe('gatewayMetrics service unit tests', () => {
  it('records calls and preserves FIFO order within ring buffer capacity', () => {
    for (let i = 1; i <= 5; i++) {
      recordGatewayCall({
        timestamp: i * 1000,
        requestId: `req-${i}`,
        consumerId: 'jev',
        platform: 'reddit',
        action: 'search',
        mode: 'sync',
        durationMs: 100 * i,
        status: 200,
      });
    }

    const calls = getRecentCalls();
    expect(calls.length).toBe(5);
    expect(calls[0].requestId).toBe('req-1');
    expect(calls[4].requestId).toBe('req-5');
  });

  it('bounds at 1000 records without memory leak', () => {
    for (let i = 1; i <= 1050; i++) {
      recordGatewayCall({
        timestamp: i,
        requestId: `req-${i}`,
        consumerId: 'jev',
        platform: 'reddit',
        action: 'search',
        mode: 'sync',
        durationMs: 50,
        status: 200,
      });
    }

    const calls = getRecentCalls();
    expect(calls.length).toBe(1000);
    // Oldest 50 should have been overwritten
    expect(calls[0].requestId).toBe('req-51');
    expect(calls[999].requestId).toBe('req-1050');
  });

  it('calculates p50, p95, p99 latency and aggregates degrade reasons', () => {
    recordGatewayCall({
      timestamp: 1000,
      requestId: 'req-deg-1',
      consumerId: 'nowing',
      platform: 'reddit',
      action: 'search',
      mode: 'async',
      durationMs: 1520,
      status: 202,
      degradedReason: 'upstream_timeout',
    });
    recordGatewayCall({
      timestamp: 2000,
      requestId: 'req-fast-1',
      consumerId: 'jev',
      platform: 'reddit',
      action: 'search',
      mode: 'sync',
      durationMs: 200,
      status: 200,
    });
    recordGatewayCall({
      timestamp: 3000,
      requestId: 'req-429-1',
      consumerId: 'anonymous',
      platform: 'reddit',
      action: 'search',
      mode: 'sync',
      durationMs: 10,
      status: 429,
    });

    const summary = getMetricsSummary();
    expect(summary.totalCalls).toBe(3);
    expect(summary.total429).toBe(1);
    expect(summary.degradeReasons.upstream_timeout).toBe(1);
    expect(summary.trafficSplit.named).toBe(2);
    expect(summary.trafficSplit.anonymous).toBe(1);
    expect(summary.upstreamHealth.reddit).toBeDefined();
    expect(summary.upstreamHealth.reddit.p50).toBeGreaterThanOrEqual(200);
  });

  it('looks up call trace by requestId', () => {
    recordGatewayCall({
      timestamp: 5000,
      requestId: 'find-me-trace-123',
      consumerId: 'chainlens',
      platform: 'x',
      action: 'search',
      mode: 'async',
      durationMs: 450,
      status: 202,
    });

    const trace = getCallTrace('find-me-trace-123');
    expect(trace).toBeTruthy();
    expect(trace.consumerId).toBe('chainlens');
    expect(trace.platform).toBe('x');

    expect(getCallTrace('non-existent')).toBeNull();
  });
});

describe('GET /api/admin/gateway/metrics endpoint', () => {
  it('requires admin authentication', async () => {
    const res = await request(app).get('/api/admin/gateway/metrics');
    // Without admin key/jwt → 401
    expect([401, 403]).toContain(res.status);
  });

  it('returns metrics summary with x-admin-key', async () => {
    recordGatewayCall({
      timestamp: 1000,
      requestId: 'req-admin-check',
      consumerId: 'jev',
      platform: 'reddit',
      action: 'search',
      mode: 'sync',
      durationMs: 80,
      status: 200,
    });

    const res = await request(app)
      .get('/api/admin/gateway/metrics')
      .set('x-admin-key', ADMIN_KEY);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalCalls).toBe(1);
    expect(res.body.data.trafficSplit).toBeDefined();
    expect(res.body.data.degradeReasons).toBeDefined();
  });

  it('GET /api/admin/gateway/trace/:requestId returns call detail or 404', async () => {
    recordGatewayCall({
      timestamp: 2000,
      requestId: 'trace-target-777',
      consumerId: 'jev',
      platform: 'pumpfun',
      action: 'fetch_coin_meta',
      mode: 'sync',
      durationMs: 120,
      status: 200,
    });

    const res = await request(app)
      .get('/api/admin/gateway/trace/trace-target-777')
      .set('x-admin-key', ADMIN_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data.requestId).toBe('trace-target-777');
    expect(res.body.data.platform).toBe('pumpfun');

    const notFoundRes = await request(app)
      .get('/api/admin/gateway/trace/does-not-exist')
      .set('x-admin-key', ADMIN_KEY);
    expect(notFoundRes.status).toBe(404);
  });
});
