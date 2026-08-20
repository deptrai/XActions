// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, test, expect, beforeEach } from 'vitest';
import {
  AdaptiveRateGovernor,
  PlatformRateLimit,
  globalAdaptiveRateGovernor,
} from '../../src/core/adaptive-governor.js';
import { ProxyIpPool } from '../../src/proxy/proxy-pool.js';

describe('Story 11.4 — Adaptive Infrastructure-Aware Rate Limiter & Account Protection Governor (ATDD Red Phase)', () => {
  let pool;
  let governor;

  beforeEach(() => {
    pool = new ProxyIpPool({
      proxies: [
        'http://p1.example.com:8080',
        'http://p2.example.com:8080',
        'http://p3.example.com:8080',
        'http://p4.example.com:8080',
        'http://p5.example.com:8080',
        'http://p6.example.com:8080',
        'http://p7.example.com:8080',
        'http://p8.example.com:8080',
        'http://p9.example.com:8080',
        'http://p10.example.com:8080',
      ],
    });
    governor = new AdaptiveRateGovernor({ proxyPool: pool });
  });

  describe('AC-1: Dynamic Throughput Calculation by Live Proxy Health', () => {
    test.skip('should compute nominal throughput = healthyCount * baseRps * throttleFactor at 100% health', () => {
      governor.setPlatformLimit('twitter', {
        baseReqPerSecondPerProxy: 2,
        throttleFactor: 1.0,
      });

      const throughput = governor.getMaxThroughput('twitter');
      expect(throughput).toBe(20);
    });

    test.skip('should scale throughput down by 50% when healthy proxy count falls below 50% of total', () => {
      governor.setPlatformLimit('twitter', {
        baseReqPerSecondPerProxy: 2,
        throttleFactor: 1.0,
      });

      for (let i = 1; i <= 6; i++) {
        pool.quarantine(`http://p${i}.example.com:8080`, 60000);
      }

      const throughput = governor.getMaxThroughput('twitter');
      expect(throughput).toBe(4);
    });

    test.skip('should return 0 throughput (pause) when healthy proxy ratio is under 10% or below floor', () => {
      governor.setPlatformLimit('twitter', {
        baseReqPerSecondPerProxy: 2,
        throttleFactor: 1.0,
      });

      for (let i = 1; i <= 10; i++) {
        pool.quarantine(`http://p${i}.example.com:8080`, 60000);
      }

      const throughput = governor.getMaxThroughput('twitter');
      expect(throughput).toBe(0);
    });

    test.skip('should throttle throughput to 25% when redis consumer lag exceeds 10,000', () => {
      governor.setPlatformLimit('twitter', {
        baseReqPerSecondPerProxy: 2,
        throttleFactor: 1.0,
      });

      governor.updateRedisConsumerLag(15000);

      const throughput = governor.getMaxThroughput('twitter');
      expect(throughput).toBe(5);
    });
  });

  describe('AC-2: Account-Level Token-Bucket Sliding Window & Velocity', () => {
    test.skip('should reject requests when account request velocity exceeds safeRequestsPerMinute', () => {
      governor.setPlatformLimit('twitter', {
        safeRequestsPerMinute: 3,
      });

      expect(governor.canAccountRequest('acc_1', 'twitter')).toBe(true);

      governor.recordRequest('acc_1', 'twitter');
      governor.recordRequest('acc_1', 'twitter');
      governor.recordRequest('acc_1', 'twitter');

      expect(governor.getAccountVelocity('acc_1', 'twitter')).toBe(3);
      expect(governor.canAccountRequest('acc_1', 'twitter')).toBe(false);
    });

    test.skip('should increment global currentReqPerSecond counter on recordRequest', () => {
      governor.recordRequest('acc_1', 'twitter');
      governor.recordRequest('acc_2', 'twitter');

      const status = governor.getStatus();
      expect(status.currentReqPerSecond).toBeGreaterThanOrEqual(2);
    });
  });

  describe('AC-3: Programmatic Hibernation, Bot Challenges & Wake', () => {
    test.skip('should put account into hibernation on recordRateLimit and reject requests', () => {
      governor.recordRateLimit('acc_limited', 'twitter', 5000);

      expect(governor.isHibernating('acc_limited', 'twitter')).toBe(true);
      expect(governor.canAccountRequest('acc_limited', 'twitter')).toBe(false);
    });

    test.skip('should support recordBotChallenge with custom hibernation window', () => {
      governor.recordBotChallenge('acc_bot', 'twitter', 15 * 60 * 1000);

      expect(governor.isHibernating('acc_bot', 'twitter')).toBe(true);
      const status = governor.getStatus();
      const accountEntry = status.hibernatingAccounts.find((h) => h.accountId.includes('acc_bot'));
      expect(accountEntry).toBeDefined();
      expect(accountEntry.reason).toBe('bot_challenge');
    });

    test.skip('should immediately restore account availability on wakeAccount', () => {
      governor.recordRateLimit('acc_wake', 'twitter', 60000);
      expect(governor.isHibernating('acc_wake', 'twitter')).toBe(true);

      governor.wakeAccount('acc_wake', 'twitter');
      expect(governor.isHibernating('acc_wake', 'twitter')).toBe(false);
      expect(governor.canAccountRequest('acc_wake', 'twitter')).toBe(true);
    });

    test.skip('should automatically prune expired hibernating accounts in getStatus()', async () => {
      governor.recordRateLimit('acc_short', 'twitter', 50);

      expect(governor.isHibernating('acc_short', 'twitter')).toBe(true);

      await new Promise((r) => setTimeout(r, 80));

      expect(governor.isHibernating('acc_short', 'twitter')).toBe(false);
      const status = governor.getStatus();
      const entry = status.hibernatingAccounts.find((h) => h.accountId.includes('acc_short'));
      expect(entry).toBeUndefined();
    });
  });

  describe('AC-4: No-Auth Platform Handling with Synthetic Key', () => {
    test.skip('should track and limit no-auth platform requests under synthetic noauth key', () => {
      governor.setPlatformLimit('chotot', {
        requiresAuth: false,
        safeRequestsPerMinute: 2,
      });

      expect(governor.canAccountRequest('noauth', 'chotot')).toBe(true);

      governor.recordRequest('noauth', 'chotot');
      governor.recordRequest('noauth', 'chotot');

      expect(governor.getAccountVelocity('noauth', 'chotot')).toBe(2);
      expect(governor.canAccountRequest('noauth', 'chotot')).toBe(false);
    });
  });

  describe('AC-5 & AC-6: Governor Status Shape & Global Singleton', () => {
    test.skip('should return complete GovernorStatus shape matching schema', () => {
      const status = governor.getStatus();

      expect(status).toHaveProperty('healthyProxyCount');
      expect(status).toHaveProperty('totalProxyCount');
      expect(status).toHaveProperty('healthyProxyRatio');
      expect(status).toHaveProperty('currentReqPerSecond');
      expect(status).toHaveProperty('redisConsumerLag');
      expect(status).toHaveProperty('hibernatingAccounts');
      expect(status).toHaveProperty('throttleLevel');
      expect(Array.isArray(status.hibernatingAccounts)).toBe(true);
    });

    test.skip('should assign throttleLevel as backpressure when redis lag exceeds threshold', () => {
      governor.updateRedisConsumerLag(12000);
      expect(governor.getStatus().throttleLevel).toBe('backpressure');

      governor.updateRedisConsumerLag(2000);
      expect(governor.getStatus().throttleLevel).toBe('normal');
    });

    test.skip('should assign throttleLevel as critical when healthy proxy ratio is under 10%', () => {
      for (let i = 1; i <= 10; i++) {
        pool.quarantine(`http://p${i}.example.com:8080`, 60000);
      }

      expect(governor.getStatus().throttleLevel).toBe('critical');
    });

    test.skip('should provide globalAdaptiveRateGovernor singleton instance', () => {
      expect(globalAdaptiveRateGovernor).toBeInstanceOf(AdaptiveRateGovernor);
    });
  });
});
