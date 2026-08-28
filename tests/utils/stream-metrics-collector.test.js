// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for StreamMetricsCollector (Story 14.3)
 * @author nich (@nichxbt)
 * @license MIT
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StreamMetricsCollector } from '../../src/utils/stream-metrics-collector.js';

describe('Story 14.3: StreamMetricsCollector Unit & Contract Tests', () => {
  it('exports StreamMetricsCollector class and default instance', () => {
    expect(typeof StreamMetricsCollector).toBe('function');
    const collector = new StreamMetricsCollector();
    expect(collector).toBeDefined();
    expect(typeof collector.getMetrics).toBe('function');
  });

  it('returns default zeroed metrics when Redis is unavailable or fails', async () => {
    const mockFailingRedis = {
      xLen: async () => {
        throw new Error('Connection refused');
      },
    };

    const collector = new StreamMetricsCollector({
      redisClient: mockFailingRedis,
      maxLen: 1000000,
    });

    const metrics = await collector.getMetrics({ forceRefresh: true });
    expect(metrics).toEqual({
      eventsPerSecond: 0,
      pendingMessages: 0,
      consumerLag: 0,
      droppedEvents: 0,
      lastAckTime: 0,
      maxLen: 1000000,
      minId: null,
    });
  });

  it('collects full stream metrics correctly from Redis client responses', async () => {
    const mockRedis = {
      xLen: async (key) => 1250,
      xPending: async (key, group) => ({
        pending: 45,
        count: 45,
      }),
      xInfoStream: async (key) => ({
        length: 1250,
        entriesAdded: 1300,
        firstEntry: ['1700000000000-0', ['id', 'facebook:1']],
        lastGeneratedId: '1700000060000-0',
      }),
      xInfoGroups: async (key) => [
        {
          name: 'nowing_nlp_workers',
          pending: 45,
          lastDeliveredId: '1700000055000-0',
        },
      ],
      xInfoConsumers: async (key, group) => [
        {
          name: 'worker_1',
          pending: 45,
          idle: 5000, // 5s idle in ms
        },
      ],
    };

    const collector = new StreamMetricsCollector({
      redisClient: mockRedis,
      maxLen: 1000000,
    });

    const metrics = await collector.getMetrics({ forceRefresh: true });
    expect(metrics.pendingMessages).toBe(1250);
    expect(metrics.consumerLag).toBe(45);
    expect(metrics.droppedEvents).toBe(50); // 1300 - 1250
    expect(metrics.minId).toBe('1700000000000-0');
    expect(metrics.maxLen).toBe(1000000);
    expect(typeof metrics.lastAckTime).toBe('number');
  });

  it('caches metrics for configured TTL (default 5s) unless forceRefresh is true', async () => {
    let callCount = 0;
    const mockRedis = {
      xLen: async () => {
        callCount++;
        return 100 * callCount;
      },
      xPending: async () => ({ count: 10 }),
      xInfoStream: async () => ({ length: 100 }),
    };

    const collector = new StreamMetricsCollector({
      redisClient: mockRedis,
      cacheTtlMs: 5000,
    });

    const m1 = await collector.getMetrics({ forceRefresh: true });
    expect(m1.pendingMessages).toBe(100);
    expect(callCount).toBe(1);

    // Call again within cache TTL
    const m2 = await collector.getMetrics({ forceRefresh: false });
    expect(m2.pendingMessages).toBe(100);
    expect(callCount).toBe(1);

    // Call with forceRefresh = true
    const m3 = await collector.getMetrics({ forceRefresh: true });
    expect(m3.pendingMessages).toBe(200);
    expect(callCount).toBe(2);
  });
});
