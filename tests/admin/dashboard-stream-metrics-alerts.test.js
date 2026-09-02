import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { StreamMetricsCollector } from '../../src/utils/stream-metrics-collector.js';
import { StreamAlertEngine } from '../../src/utils/stream-alerts.js';

describe('Story 19.3: Dashboard Stream Metrics & Alerts API', () => {
  let app;
  let metricsCollector;
  let alertEngine;

  beforeEach(async () => {
    // Use lightweight fixture instances to avoid real Redis.
    metricsCollector = new StreamMetricsCollector({
      redisClient: null,
      cacheTtlMs: 0,
      maxLen: 1000000,
    });

    alertEngine = new StreamAlertEngine({
      pendingMessagesThreshold: 50000,
      consumerLagThreshold: 50000,
      lastAckTimeThreshold: 60,
      cooldownMs: 0,
      webhookUrl: null,
      emailRecipients: null,
    });

    // Wire the same routes used in production, but with fixture instances.
    app = express();
    app.use(express.json());

    app.get('/api/admin/stream/metrics', async (_req, res) => {
      try {
        const metrics = await metricsCollector.getMetrics();
        res.json({ success: true, metrics });
      } catch (err) {
        res.status(500).json({ success: false, error: (err instanceof Error ? err.message : String(err)) });
      }
    });

    app.get('/api/admin/stream/alerts', (_req, res) => {
      try {
        const status = alertEngine.getAlertStatus();
        res.json({ success: true, alerts: status });
      } catch (err) {
        res.status(500).json({ success: false, error: (err instanceof Error ? err.message : String(err)) });
      }
    });

    app.post('/api/admin/stream/alerts/test', async (_req, res) => {
      try {
        const testMetrics = {
          eventsPerSecond: 1234.56,
          pendingMessages: 75000,
          consumerLag: 2500,
          droppedEvents: 1000,
          lastAckTime: 120,
          maxLen: 1000000,
          minId: '1725000000000-0',
        };
        const result = await alertEngine.checkAndAlert(testMetrics);
        res.json({ success: true, ...result });
      } catch (err) {
        res.status(500).json({ success: false, error: (err instanceof Error ? err.message : String(err)) });
      }
    });
  });

  it('GET /api/admin/stream/metrics returns StreamMetrics envelope', async () => {
    const res = await request(app).get('/api/admin/stream/metrics');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.metrics).toBeDefined();
    expect(typeof res.body.metrics.eventsPerSecond).toBe('number');
    expect(typeof res.body.metrics.pendingMessages).toBe('number');
    expect(typeof res.body.metrics.consumerLag).toBe('number');
    expect(typeof res.body.metrics.droppedEvents).toBe('number');
    expect(typeof res.body.metrics.lastAckTime).toBe('number');
    expect(typeof res.body.metrics.maxLen).toBe('number');
    expect(res.body.metrics).toHaveProperty('minId');
  });

  it('GET /api/admin/stream/alerts returns alert status envelope', async () => {
    const res = await request(app).get('/api/admin/stream/alerts');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.alerts).toBeDefined();
    expect(Array.isArray(res.body.alerts.activeAlerts)).toBe(true);
    expect(res.body.alerts).toHaveProperty('lastAlertTimestamp');
    expect(typeof res.body.alerts.totalAlertsTriggered).toBe('number');
  });

  it('POST /api/admin/stream/alerts/test triggers a test alert', async () => {
    const res = await request(app).post('/api/admin/stream/alerts/test');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.triggered).toBe(true);
    expect(Array.isArray(res.body.alerts)).toBe(true);
    expect(res.body.alerts.length).toBeGreaterThan(0);

    const alertTypes = res.body.alerts.map(a => a.alert);
    expect(alertTypes).toContain('redis_stream_lag');
    expect(alertTypes).toContain('redis_stream_ack');

    const lagAlert = res.body.alerts.find(a => a.alert === 'redis_stream_lag');
    expect(lagAlert.threshold).toBe(50000);
    expect(lagAlert.value).toBe(75000);

    // After triggering, the alert status should reflect the new alert
    const statusRes = await request(app).get('/api/admin/stream/alerts');
    expect(statusRes.body.alerts.totalAlertsTriggered).toBeGreaterThan(0);
    expect(statusRes.body.alerts.activeAlerts.length).toBeGreaterThan(0);
  });
});
