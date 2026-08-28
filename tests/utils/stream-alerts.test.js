// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for Stream Alert Engine (Story 14.3)
 * @author nich (@nichxbt)
 * @license MIT
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StreamAlertEngine } from '../../src/utils/stream-alerts.js';

describe('Story 14.3: StreamAlertEngine Unit & Contract Tests', () => {
  it('does not trigger alerts when metrics are within healthy thresholds', async () => {
    let webhookCalled = false;
    const engine = new StreamAlertEngine({
      webhookSender: async () => {
        webhookCalled = true;
      },
    });

    const healthyMetrics = {
      eventsPerSecond: 10,
      pendingMessages: 1000,
      consumerLag: 50,
      droppedEvents: 0,
      lastAckTime: 5,
      maxLen: 1000000,
      minId: '1-0',
    };

    const result = await engine.checkAndAlert(healthyMetrics);
    expect(result.triggered).toBe(false);
    expect(result.alerts).toEqual([]);
    expect(webhookCalled).toBe(false);
  });

  it('triggers alert when pendingMessages exceeds 50,000 threshold', async () => {
    let capturedPayload = null;
    const engine = new StreamAlertEngine({
      webhookUrl: 'https://webhook.test/alerts',
      webhookSender: async (url, payload) => {
        capturedPayload = payload;
      },
    });

    const highPendingMetrics = {
      eventsPerSecond: 50,
      pendingMessages: 55000,
      consumerLag: 100,
      droppedEvents: 0,
      lastAckTime: 10,
      maxLen: 1000000,
      minId: '1-0',
    };

    const result = await engine.checkAndAlert(highPendingMetrics);
    expect(result.triggered).toBe(true);
    expect(result.alerts.some((a) => a.alert === 'redis_stream_lag')).toBe(true);
    expect(capturedPayload).toBeDefined();
    expect(capturedPayload.alert).toBe('redis_stream_lag');
    expect(capturedPayload.value).toBe(55000);
    expect(capturedPayload.threshold).toBe(50000);
  });

  it('triggers alert when lastAckTime exceeds 60s threshold', async () => {
    let capturedPayload = null;
    const engine = new StreamAlertEngine({
      webhookUrl: 'https://webhook.test/alerts',
      webhookSender: async (url, payload) => {
        capturedPayload = payload;
      },
    });

    const highAckMetrics = {
      eventsPerSecond: 0,
      pendingMessages: 500,
      consumerLag: 50,
      droppedEvents: 0,
      lastAckTime: 75,
      maxLen: 1000000,
      minId: '1-0',
    };

    const result = await engine.checkAndAlert(highAckMetrics);
    expect(result.triggered).toBe(true);
    expect(result.alerts.some((a) => a.alert === 'redis_stream_ack')).toBe(true);
    expect(capturedPayload.alert).toBe('redis_stream_ack');
    expect(capturedPayload.value).toBe(75);
    expect(capturedPayload.threshold).toBe(60);
  });

  it('enforces cooldown period between alerts of the same type', async () => {
    let callCount = 0;
    const engine = new StreamAlertEngine({
      cooldownMs: 300000, // 5 min
      webhookUrl: 'https://webhook.test/alerts',
      webhookSender: async () => {
        callCount++;
      },
    });

    const highPendingMetrics = {
      eventsPerSecond: 50,
      pendingMessages: 60000,
      consumerLag: 100,
      droppedEvents: 0,
      lastAckTime: 10,
      maxLen: 1000000,
      minId: '1-0',
    };

    const res1 = await engine.checkAndAlert(highPendingMetrics);
    expect(res1.triggered).toBe(true);
    expect(callCount).toBe(1);

    // Immediate second call should be suppressed by cooldown
    const res2 = await engine.checkAndAlert(highPendingMetrics);
    expect(res2.triggered).toBe(false);
    expect(res2.suppressedByCooldown).toBe(true);
    expect(callCount).toBe(1);
  });

  it('provides getAlertStatus() with latest alert state', async () => {
    const engine = new StreamAlertEngine({
      webhookSender: async () => {},
    });

    const status1 = engine.getAlertStatus();
    expect(status1.activeAlerts.length).toBe(0);

    await engine.checkAndAlert({
      eventsPerSecond: 10,
      pendingMessages: 65000,
      consumerLag: 100,
      droppedEvents: 0,
      lastAckTime: 10,
      maxLen: 1000000,
      minId: '1-0',
    });

    const status2 = engine.getAlertStatus();
    expect(status2.activeAlerts.length).toBe(1);
    expect(status2.activeAlerts[0].alert).toBe('redis_stream_lag');
    expect(status2.lastAlertTimestamp).toBeDefined();
  });
});
