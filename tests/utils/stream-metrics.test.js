// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, test, expect } from 'vitest';
import { StreamMetricsReader, refreshGovernorConsumerLag } from '../../src/utils/stream-metrics.js';
import { AdaptiveRateGovernor } from '../../src/core/adaptive-governor.js';

describe('StreamMetricsReader & Governor Lag Integration Tests', () => {
  test('should return 0 safely when no client or unreachable connection', async () => {
    const reader = new StreamMetricsReader({
      redisClient: {
        xPending: async () => {
          throw new Error('Connection refused');
        },
      },
    });

    const pending = await reader.getPendingCount();
    expect(pending).toBe(0);
    await reader.close();
  });

  test('should parse pending count correctly from mock redis response', async () => {
    const reader = new StreamMetricsReader({
      redisClient: {
        xPending: async () => ({ pending: 1420, count: 1420 }),
      },
    });

    const pending = await reader.getPendingCount();
    expect(pending).toBe(1420);
    await reader.close();
  });

  test('should refresh governor consumer lag using refreshGovernorConsumerLag helper', async () => {
    const governor = new AdaptiveRateGovernor();
    const reader = new StreamMetricsReader({
      redisClient: {
        xPending: async () => ({ pending: 12500 }),
      },
    });

    const lag = await refreshGovernorConsumerLag(governor, reader);
    expect(lag).toBe(12500);
    expect(governor.getRedisConsumerLag()).toBe(12500);
    expect(governor.getStatus().throttleLevel).toBe('backpressure');
    await reader.close();
  });
});
