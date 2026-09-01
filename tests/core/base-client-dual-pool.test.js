// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 11.9 (AD-20) — Base client dual-pool routing & consumer quota gate.
 * Real client, real ProxyIpPool, real AdaptiveRateGovernor — no mocks. The
 * injected httpClient is a real recording function (no network needed).
 *
 * @author nich (@nichxbt)
 * @license MIT
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { AbstractApiClient } from '../../src/core/base-client.js';
import { ProxyIpPool } from '../../src/proxy/proxy-pool.js';
import { AdaptiveRateGovernor } from '../../src/core/adaptive-governor.js';
import { RateLimitError } from '../../src/core/error-envelope.js';

class TestApiClient extends AbstractApiClient {
  name = 'test-client';
  platform = 'twitter';
  requiresAuth = false;
}

/** @param {number} n */
function makePool(n) {
  const pool = new ProxyIpPool();
  for (let i = 1; i <= n; i++) pool.add(`http://u:p@10.0.0.${i}:8080`);
  return pool;
}

describe('Story 11.9 — Base Client Dual-Pool Routing & Consumer Quota (AD-20)', () => {
  let calls;
  let httpClient;
  let client;
  let governor;
  let pool;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T00:00:00Z'));
    calls = [];
    httpClient = async (args) => {
      calls.push(args);
      return { status: 200, headers: {}, data: { ok: true } };
    };
    pool = makePool(10);
    governor = new AdaptiveRateGovernor({ proxyPool: pool });
    client = new TestApiClient({
      proxyPool: pool,
      governor,
      httpClient,
      maxProxyRetries: 1,
      maxAccountRotations: 1,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('AC-4: consumer → pool routing', () => {
    test('on-demand consumers (chainlens/nowing) route to the realtime partition', async () => {
      await client.request('GET', 'https://api.example.com/1', { consumerId: 'chainlens' });
      expect(calls).toHaveLength(1);
      expect(calls[0].proxy.host).toBe('10.0.0.1'); // realtime = indices 0..2

      await client.request('GET', 'https://api.example.com/2', { consumerId: 'nowing' });
      expect(calls[1].proxy.host).toBe('10.0.0.2');
    });

    test('internal traffic routes to the bulk partition', async () => {
      await client.request('GET', 'https://api.example.com/1', { consumerId: 'internal' });
      expect(calls).toHaveLength(1);
      const bulkHosts = new Set(
        pool.listProxies().filter((p) => p.pool === 'bulk').map((p) => p.host)
      );
      expect(bulkHosts.has(calls[0].proxy.host)).toBe(true);
    });

    test('explicit opts.pool wins over the consumer-derived pool', async () => {
      await client.request('GET', 'https://api.example.com/1', {
        consumerId: 'chainlens',
        pool: 'bulk',
      });
      expect(calls).toHaveLength(1);
      const bulkHosts = new Set(
        pool.listProxies().filter((p) => p.pool === 'bulk').map((p) => p.host)
      );
      expect(bulkHosts.has(calls[0].proxy.host)).toBe(true);
    });

    test('no consumerId preserves the legacy whole-pool behavior', async () => {
      await client.request('GET', 'https://api.example.com/1', {});
      expect(calls).toHaveLength(1);
      expect(calls[0].proxy).not.toBeNull();
      // Legacy sticky/round-robin may bind anywhere in the whole pool.
      const allHosts = new Set(pool.listProxies().map((p) => p.host));
      expect(allHosts.has(calls[0].proxy.host)).toBe(true);
    });

    test('consumer ids are trimmed and lowercased', async () => {
      await client.request('GET', 'https://api.example.com/1', { consumerId: '  ChainLens ' });
      expect(calls[0].proxy.host).toBe('10.0.0.1');
    });
  });

  describe('AC-5/AC-6: consumer quota gate inside request()', () => {
    test('records metered consumer requests before dispatch', async () => {
      await client.request('GET', 'https://api.example.com/1', { consumerId: 'chainlens' });
      const status = governor.getConsumerStatus('chainlens');
      expect(status.usedInWindow).toBe(1);
    });

    test('does not record internal (unmetered) requests', async () => {
      await client.request('GET', 'https://api.example.com/1', { consumerId: 'internal' });
      expect(governor.getConsumerStatus('internal').usedInWindow).toBe(0);
    });

    test('throws RateLimitError XACT_4291 when the quota is exhausted', async () => {
      // Fill the chainlens window (10 RPM) directly through the client.
      for (let i = 0; i < 10; i++) {
        await client.request('GET', 'https://api.example.com/x', { consumerId: 'chainlens' });
      }
      expect(calls).toHaveLength(10);

      await expect(
        client.request('GET', 'https://api.example.com/over', { consumerId: 'chainlens' })
      ).rejects.toThrow(RateLimitError);
      expect(calls).toHaveLength(10); // over-quota request never dispatched

      try {
        await client.request('GET', 'https://api.example.com/over', { consumerId: 'chainlens' });
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err.code).toBe('XACT_4291');
        expect(err.statusCode).toBe(429);
        expect(err.suggestedAction).toBe('reduce_rate');
        expect(err.message).toContain('chainlens');
        expect(err.retryAfterMs).toBeGreaterThanOrEqual(1000);
        expect(err.isRetryable).toBe(true);
        expect(err.details).toEqual({ consumerId: 'chainlens', pool: 'realtime' });
      }
    });

    test('quota gate runs before dispatch and does not burn account attempts', async () => {
      governor.setConsumerQuota('chainlens', { rpmLimit: 1 });
      await client.request('GET', 'https://api.example.com/1', { consumerId: 'chainlens' });
      expect(calls).toHaveLength(1);
      await expect(
        client.request('GET', 'https://api.example.com/2', { consumerId: 'chainlens' })
      ).rejects.toThrow(RateLimitError);
      expect(calls).toHaveLength(1);
    });

    test('internal traffic is never throttled even at high volume', async () => {
      for (let i = 0; i < 25; i++) {
        await client.request('GET', 'https://api.example.com/bulk', { consumerId: 'internal' });
      }
      expect(calls).toHaveLength(25);
    });
  });
});
