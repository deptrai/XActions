// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, test, expect } from 'vitest';
import { createClient } from 'redis';
import {
  StreamMetricsReader,
  refreshGovernorConsumerLag,
  extractPendingCount,
} from '../../src/utils/stream-metrics.js';
import { AdaptiveRateGovernor } from '../../src/core/adaptive-governor.js';

describe('StreamMetricsReader & Governor Lag Integration Tests', () => {
  test('extractPendingCount normalizes redis and ioredis response shapes', () => {
    expect(extractPendingCount({ pending: 1420, count: 1420 })).toBe(1420);
    expect(extractPendingCount({ count: 99 })).toBe(99);
    expect(extractPendingCount([15000])).toBe(15000);
    expect(extractPendingCount([0])).toBe(0);
    expect(extractPendingCount(null)).toBe(0);
    expect(extractPendingCount(undefined)).toBe(0);
    expect(extractPendingCount('not a number')).toBe(0);
  });

  test('should return 0 safely when no Redis server is available', async () => {
    const reader = new StreamMetricsReader();
    const pending = await reader.getPendingCount();
    expect(pending).toBe(0);
    await reader.close();
  });

  test('should return 0 safely when an external client cannot connect', async () => {
    const client = createClient({
      url: 'redis://127.0.0.1:1',
      socket: {
        connectTimeout: 1000,
        reconnectStrategy: () => false,
      },
    });

    const reader = new StreamMetricsReader({ redisClient: client });
    const pending = await reader.getPendingCount();
    expect(pending).toBe(0);

    await reader.close();
    try {
      await client.quit();
    } catch {
      // Client may never have connected; quit is best-effort.
    }
  });

  test('should refresh governor consumer lag using refreshGovernorConsumerLag helper', async () => {
    const governor = new AdaptiveRateGovernor();
    const reader = new StreamMetricsReader();

    const lag = await refreshGovernorConsumerLag(governor, reader);
    expect(typeof lag).toBe('number');
    expect(governor.getRedisConsumerLag()).toBe(lag);
    await reader.close();
  });
});
