// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, test, expect } from 'vitest';
import { StatusApi, globalStatusApi } from '../../src/core/status-api.js';
import { AdaptiveRateGovernor } from '../../src/core/adaptive-governor.js';
import { ProxyIpPool } from '../../src/proxy/proxy-pool.js';

describe('Story 11.4 — StatusApi Contract & Governor Integration (ATDD Green Phase)', () => {
  test('should return default zero-state status when constructed without governor', () => {
    const statusApi = new StatusApi();
    const status = statusApi.getGovernorStatus();

    expect(status).toEqual({
      healthyProxyCount: 0,
      totalProxyCount: 0,
      healthyProxyRatio: 0,
      currentReqPerSecond: 0,
      redisConsumerLag: 0,
      hibernatingAccounts: [],
      throttleLevel: 'normal',
    });
  });

  test('should delegate getGovernorStatus() to injected AdaptiveRateGovernor instance', () => {
    const pool = new ProxyIpPool({
      proxies: ['http://proxy1.example.com:8080', 'http://proxy2.example.com:8080'],
    });
    const governor = new AdaptiveRateGovernor({ proxyPool: pool });
    const statusApi = new StatusApi({ governor });

    const status = statusApi.getGovernorStatus();
    expect(status.healthyProxyCount).toBe(2);
    expect(status.totalProxyCount).toBe(2);
    expect(status.healthyProxyRatio).toBe(1.0);
    expect(status.throttleLevel).toBe('normal');
  });

  test('should export globalStatusApi singleton instance', () => {
    expect(globalStatusApi).toBeInstanceOf(StatusApi);
  });
});
