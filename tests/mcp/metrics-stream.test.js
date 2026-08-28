// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for GET /metrics/stream endpoint (Story 14.3)
 * @author nich (@nichxbt)
 * @license MIT
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import { StreamMetricsCollector } from '../../src/utils/stream-metrics-collector.js';

describe('Story 14.3: GET /metrics/stream API Endpoint Tests', () => {
  let server;
  let serverUrl;

  const mockCollector = new StreamMetricsCollector({
    redisClient: {
      xLen: async () => 4200,
      xPending: async () => ({ pending: 15 }),
      xInfoStream: async () => ({
        length: 4200,
        entriesAdded: 4500,
        firstEntry: ['1700000000000-0'],
      }),
      xInfoConsumers: async () => [{ name: 'c1', idle: 12000 }],
    },
    maxLen: 1000000,
  });

  beforeAll(async () => {
    const app = express();
    app.use(express.json());

    app.get('/metrics/stream', async (_req, res) => {
      try {
        const metrics = await mockCollector.getMetrics({ forceRefresh: true });
        res.json(metrics);
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    app.get('/admin/stream/metrics', async (_req, res) => {
      try {
        const metrics = await mockCollector.getMetrics({ forceRefresh: true });
        res.json({ success: true, metrics });
      } catch (err) {
        res.status(500).json({ success: false, error: String(err) });
      }
    });

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    serverUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('GET /metrics/stream returns 200 OK with full StreamMetrics JSON body', async () => {
    const resp = await fetch(`${serverUrl}/metrics/stream`);
    expect(resp.status).toBe(200);

    const body = await resp.json();
    expect(body).toHaveProperty('eventsPerSecond');
    expect(body).toHaveProperty('pendingMessages');
    expect(body).toHaveProperty('consumerLag');
    expect(body).toHaveProperty('droppedEvents');
    expect(body).toHaveProperty('lastAckTime');
    expect(body).toHaveProperty('maxLen');
    expect(body).toHaveProperty('minId');

    expect(body.pendingMessages).toBe(4200);
    expect(body.consumerLag).toBe(15);
    expect(body.droppedEvents).toBe(300); // 4500 - 4200
    expect(body.lastAckTime).toBe(12);
    expect(body.minId).toBe('1700000000000-0');
  });

  it('GET /admin/stream/metrics returns 200 OK with envelope and metrics', async () => {
    const resp = await fetch(`${serverUrl}/admin/stream/metrics`);
    expect(resp.status).toBe(200);

    const body = await resp.json();
    expect(body.success).toBe(true);
    expect(body.metrics.pendingMessages).toBe(4200);
  });
});
