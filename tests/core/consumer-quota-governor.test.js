// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 11.9 (AD-20) — Multi-consumer quota governor tests.
 * Real AdaptiveRateGovernor instances with a controlled test clock — no mocks.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { AdaptiveRateGovernor } from '../../src/core/adaptive-governor.js';
import { ProxyIpPool } from '../../src/proxy/proxy-pool.js';
import { PlatformError } from '../../src/core/error-envelope.js';

describe('Story 11.9 — Multi-Consumer Quota (AD-20)', () => {
  let governor;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T00:00:00Z'));
    governor = new AdaptiveRateGovernor();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('AC-5: default consumer quotas', () => {
    test('chainlens defaults to 10 RPM', () => {
      const status = governor.getConsumerStatus('chainlens');
      expect(status.consumerId).toBe('chainlens');
      expect(status.rpmLimit).toBe(10);
      expect(status.usedInWindow).toBe(0);
      expect(status.remaining).toBe(10);
      expect(status.isThrottled).toBe(false);
    });

    test('nowing defaults to 60 RPM (env override honored at construction)', () => {
      const plain = new AdaptiveRateGovernor();
      const previous = process.env.NOWING_RATE_LIMIT_RPM;
      try {
        delete process.env.NOWING_RATE_LIMIT_RPM;
        expect(plain.getConsumerStatus('nowing').rpmLimit).toBe(60);

        process.env.NOWING_RATE_LIMIT_RPM = '30';
        const overridden = new AdaptiveRateGovernor();
        expect(overridden.getConsumerStatus('nowing').rpmLimit).toBe(30);
      } finally {
        if (previous === undefined) delete process.env.NOWING_RATE_LIMIT_RPM;
        else process.env.NOWING_RATE_LIMIT_RPM = previous;
      }
    });

    test('internal is unmetered (Infinity)', () => {
      const status = governor.getConsumerStatus('internal');
      expect(status.rpmLimit).toBe(Infinity);
      expect(status.remaining).toBe(Infinity);
      expect(status.isThrottled).toBe(false);
      expect(governor.canConsumerRequest('internal')).toBe(true);
    });
  });

  describe('AC-6: 60s sliding-window enforcement', () => {
    test('chainlens allows exactly 10 requests then throttles', () => {
      for (let i = 0; i < 10; i++) {
        expect(governor.canConsumerRequest('chainlens')).toBe(true);
        governor.recordConsumerRequest('chainlens');
      }
      expect(governor.canConsumerRequest('chainlens')).toBe(false);
      const status = governor.getConsumerStatus('chainlens');
      expect(status.usedInWindow).toBe(10);
      expect(status.remaining).toBe(0);
      expect(status.isThrottled).toBe(true);
    });

    test('window resets 60s after the oldest request (sliding, not fixed)', () => {
      // 3 requests at t=0.
      for (let i = 0; i < 3; i++) governor.recordConsumerRequest('chainlens');
      // 7 more at t=+30s.
      vi.advanceTimersByTime(30_000);
      for (let i = 0; i < 7; i++) governor.recordConsumerRequest('chainlens');
      expect(governor.canConsumerRequest('chainlens')).toBe(false);

      // At t=+59s the 3 oldest are still inside the window → still throttled.
      vi.advanceTimersByTime(29_000);
      expect(governor.canConsumerRequest('chainlens')).toBe(false);

      // At t=+61s the t=0 requests slid out → capacity available again.
      vi.advanceTimersByTime(2_000);
      expect(governor.canConsumerRequest('chainlens')).toBe(true);
      const status = governor.getConsumerStatus('chainlens');
      expect(status.usedInWindow).toBe(7); // only the t=+30s batch remains
      expect(status.remaining).toBe(3);
    });

    test('getConsumerRetryAfterSeconds reports time until the oldest entry expires', () => {
      governor.recordConsumerRequest('chainlens');
      // 60s window + 1s buffer, measured from the record time.
      expect(governor.getConsumerRetryAfterSeconds('chainlens')).toBe(61);
      vi.advanceTimersByTime(10_000);
      expect(governor.getConsumerRetryAfterSeconds('chainlens')).toBe(51);
      expect(governor.getConsumerRetryAfterSeconds('chainlens')).toBeGreaterThanOrEqual(1);
    });

    test('getConsumerRetryAfterSeconds returns at least 1 for an empty window', () => {
      expect(governor.getConsumerRetryAfterSeconds('chainlens')).toBe(1);
    });
  });

  describe('setConsumerQuota', () => {
    test('updates an existing consumer limit', () => {
      governor.setConsumerQuota('chainlens', { rpmLimit: 2 });
      expect(governor.getConsumerStatus('chainlens').rpmLimit).toBe(2);
      governor.recordConsumerRequest('chainlens');
      governor.recordConsumerRequest('chainlens');
      expect(governor.canConsumerRequest('chainlens')).toBe(false);
    });

    test('registers a brand-new consumer', () => {
      governor.setConsumerQuota('custom-agent', { rpmLimit: 5 });
      expect(governor.getConsumerStatus('custom-agent').consumerId).toBe('custom-agent');
      expect(governor.canConsumerRequest('custom-agent')).toBe(true);
    });

    test('rejects invalid rpmLimit with XACT_4001', () => {
      expect(() => governor.setConsumerQuota('chainlens', { rpmLimit: 0 })).toThrow(PlatformError);
      expect(() => governor.setConsumerQuota('chainlens', { rpmLimit: -5 })).toThrow(PlatformError);
      expect(() => governor.setConsumerQuota('chainlens', { rpmLimit: 2.5 })).toThrow(PlatformError);
      try {
        governor.setConsumerQuota('chainlens', { rpmLimit: -1 });
      } catch (err) {
        expect(err.code).toBe('XACT_4001');
      }
    });

    test('rejects an empty consumerId with XACT_4001', () => {
      expect(() => governor.setConsumerQuota('', { rpmLimit: 10 })).toThrow(PlatformError);
    });
  });

  describe('unknown consumers normalize to internal (unmetered)', () => {
    test('canConsumerRequest/recordConsumerRequest never throw for unknown ids', () => {
      expect(governor.canConsumerRequest('who-dis')).toBe(true);
      expect(() => governor.recordConsumerRequest('who-dis')).not.toThrow();
      expect(governor.getConsumerStatus('who-dis').consumerId).toBe('internal');
      expect(governor.getConsumerStatus('who-dis').rpmLimit).toBe(Infinity);
    });

    test('ids are trimmed and lowercased before resolution', () => {
      expect(governor.canConsumerRequest('  ChainLens  ')).toBe(true);
      governor.recordConsumerRequest('CHAINLENS');
      expect(governor.getConsumerStatus('chainlens').usedInWindow).toBe(1);
    });
  });

  describe('AC-7: getStatus observability', () => {
    test('exposes dualPool stats from the real proxy pool', () => {
      const pool = new ProxyIpPool();
      for (let i = 1; i <= 10; i++) pool.add(`http://u:p@10.0.0.${i}:8080`);
      const governed = new AdaptiveRateGovernor({ proxyPool: pool });
      const status = governed.getStatus();
      expect(status.dualPool).toBeDefined();
      expect(status.dualPool.realtime.total).toBe(3);
      expect(status.dualPool.bulk.total).toBe(7);
      expect(status.dualPool.yieldedCount).toBe(0);
    });

    test('exposes dualPool zero stats without a proxy pool', () => {
      const status = governor.getStatus();
      expect(status.dualPool).toEqual({
        realtime: { total: 0, healthy: 0, quarantined: 0 },
        bulk: { total: 0, healthy: 0, quarantined: 0 },
        yieldedCount: 0,
      });
    });

    test('exposes consumerQuotas for all registered consumers', () => {
      governor.recordConsumerRequest('chainlens');
      const quotas = governor.getStatus().consumerQuotas;
      expect(Object.keys(quotas).sort()).toEqual(['chainlens', 'internal', 'nowing']);
      expect(quotas.chainlens.usedInWindow).toBe(1);
      expect(quotas.chainlens.rpmLimit).toBe(10);
      expect(quotas.nowing.rpmLimit).toBe(60);
      expect(quotas.internal.rpmLimit).toBe(Infinity);
    });
  });
});
