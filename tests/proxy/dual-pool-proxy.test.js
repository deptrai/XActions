// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 11.9 (AD-20) — Dual-pool resource isolation tests.
 * Real ProxyIpPool instances only — no mocks.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { ProxyIpPool } from '../../src/proxy/proxy-pool.js';
import { PlatformError } from '../../src/core/error-envelope.js';

/** @param {number} n */
function makePool(n) {
  const pool = new ProxyIpPool();
  for (let i = 1; i <= n; i++) {
    pool.add(`http://user:pass@10.0.0.${i}:8080`);
  }
  return pool;
}

describe('Story 11.9 — Dual-Pool Resource Isolation (AD-20)', () => {
  describe('AC-1: 30/70 index-based partitioning', () => {
    test('partitions 10 proxies as 3 realtime / 7 bulk', () => {
      const pool = makePool(10);
      const stats = pool.getPoolStats();
      expect(stats.realtime.total).toBe(3);
      expect(stats.bulk.total).toBe(7);
      expect(stats.realtime.healthy).toBe(3);
      expect(stats.bulk.healthy).toBe(7);
      expect(stats.yieldedCount).toBe(0);
    });

    test('partitions 100 proxies as 30 realtime / 70 bulk', () => {
      const pool = makePool(100);
      const stats = pool.getPoolStats();
      expect(stats.realtime.total).toBe(30);
      expect(stats.bulk.total).toBe(70);
    });

    test('partitions 2 proxies as 1 realtime / 1 bulk (floor of 1)', () => {
      const pool = makePool(2);
      const stats = pool.getPoolStats();
      expect(stats.realtime.total).toBe(1);
      expect(stats.bulk.total).toBe(1);
    });

    test('getBulkProxy never returns a realtime-partition proxy', () => {
      const pool = makePool(10);
      // First three hosts belong to the realtime partition (index order).
      for (let i = 0; i < 10; i++) {
        const proxy = pool.getBulkProxy();
        expect(proxy).not.toBeNull();
        expect(proxy.host.startsWith('10.0.0.')).toBe(true);
        const idx = Number(proxy.host.split('.')[3]);
        expect(idx).toBeGreaterThanOrEqual(4); // indices 3..9 (0-based) = bulk
      }
    });

    test('getProxy defaults to the bulk partition when pool is omitted', () => {
      const pool = makePool(10);
      const realtimeHosts = new Set(
        pool.listProxies().filter((p) => p.pool === 'realtime').map((p) => p.host)
      );
      expect(realtimeHosts.size).toBe(3);
      for (let i = 0; i < 14; i++) {
        const proxy = pool.getProxy();
        expect(proxy).not.toBeNull();
        // Without an explicit pool the selector must serve from bulk, never
        // silently dipping into the realtime partition.
        expect(realtimeHosts.has(proxy.host)).toBe(false);
      }
    });

    test('listProxies tags each entry with its partition', () => {
      const pool = makePool(10);
      const list = pool.listProxies();
      expect(list).toHaveLength(10);
      const realtime = list.filter((p) => p.pool === 'realtime');
      const bulk = list.filter((p) => p.pool === 'bulk');
      expect(realtime).toHaveLength(3);
      expect(bulk).toHaveLength(7);
      expect(realtime[0].host).toBe('10.0.0.1');
      expect(bulk[0].host).toBe('10.0.0.4');
    });
  });

  describe('AC-2: dynamic yield (realtime borrows from bulk, never the reverse)', () => {
    test('realtime yields from bulk when its partition is dry and counts the yield', () => {
      const pool = makePool(3); // realtimeCount = max(1, floor(3*0.3)) = 1
      // Quarantine the lone realtime proxy.
      const list = pool.listProxies();
      const realtimeProxy = list.find((p) => p.pool === 'realtime');
      pool.quarantine(realtimeProxy.server, 60_000);

      const yielded = pool.getRealtimeProxy();
      expect(yielded).not.toBeNull();
      expect(yielded.host).not.toBe(realtimeProxy.host);
      expect(pool.getPoolStats().yieldedCount).toBe(1);

      // The borrowed proxy never leaves the bulk partition.
      const stats = pool.getPoolStats();
      expect(stats.bulk.total).toBe(2);
      expect(stats.realtime.total).toBe(1);
      expect(stats.realtime.quarantined).toBe(1);
    });

    test('yieldedCount accumulates across successive yields', () => {
      const pool = makePool(3);
      const list = pool.listProxies();
      pool.quarantine(list.find((p) => p.pool === 'realtime').server, 60_000);
      expect(pool.getRealtimeProxy()).not.toBeNull();
      // Re-quarantine the yielded bulk proxy so the next realtime request
      // yields again from the remaining bulk proxy.
      const yielded = pool.getRealtimeProxy();
      pool.quarantine(yielded.server, 60_000);
      const last = pool.getRealtimeProxy();
      if (last) {
        expect(pool.getPoolStats().yieldedCount).toBeGreaterThanOrEqual(2);
      }
    });

    test('bulk never borrows from realtime: fully quarantined bulk returns null', () => {
      const pool = makePool(10);
      const list = pool.listProxies();
      for (const p of list.filter((x) => x.pool === 'bulk')) {
        pool.quarantine(p.server, 60_000);
      }
      expect(pool.getBulkProxy()).toBeNull();
      // Realtime capacity is untouched and still available.
      expect(pool.getRealtimeProxy()).not.toBeNull();
    });

    test('yieldFromBulk: false disables borrowing for realtime', () => {
      const pool = makePool(3);
      const list = pool.listProxies();
      pool.quarantine(list.find((p) => p.pool === 'realtime').server, 60_000);
      expect(pool.getProxy({ pool: 'realtime', yieldFromBulk: false })).toBeNull();
      expect(pool.getPoolStats().yieldedCount).toBe(0);
    });
  });

  describe('AC-3: sticky bindings across partitions', () => {
    test('sticky binding created via bulk is honored when yielded to realtime', () => {
      const pool = makePool(3);
      const bulkProxy = pool.getBulkProxy({ accountId: 'acc-1' });
      expect(bulkProxy).not.toBeNull();

      // Quarantine the realtime proxy to force a yield, then ask realtime
      // for the same account — the sticky bulk binding must survive.
      const list = pool.listProxies();
      pool.quarantine(list.find((p) => p.pool === 'realtime').server, 60_000);
      const viaRealtime = pool.getProxy({ pool: 'realtime', accountId: 'acc-1' });
      expect(viaRealtime).not.toBeNull();
      expect(viaRealtime.server).toBe(bulkProxy.server);
    });

    test('getStickyProxy with options.pool restricts NEW bindings to the partition', () => {
      const pool = makePool(10);
      const bound = pool.getStickyProxy('acc-bulk-only', false, { pool: 'bulk' });
      expect(bound).not.toBeNull();
      const list = pool.listProxies();
      const realtimeHosts = new Set(list.filter((p) => p.pool === 'realtime').map((p) => p.host));
      expect(realtimeHosts.has(bound.host)).toBe(false);

      const rtBound = pool.getStickyProxy('acc-rt-only', false, { pool: 'realtime' });
      expect(rtBound).not.toBeNull();
      const bulkHosts = new Set(list.filter((p) => p.pool === 'bulk').map((p) => p.host));
      expect(bulkHosts.has(rtBound.host)).toBe(false);
    });

    test('getStickyProxy without pool preserves legacy whole-pool behavior', () => {
      const pool = makePool(10);
      const bound = pool.getStickyProxy('acc-legacy');
      expect(bound).not.toBeNull();
      // Repeated calls return the same proxy (sticky).
      expect(pool.getStickyProxy('acc-legacy').server).toBe(bound.server);
      // The binding may live anywhere in the whole pool.
      const allHosts = new Set(pool.listProxies().map((p) => p.host));
      expect(allHosts.has(bound.host)).toBe(true);
    });
  });

  describe('AC-4: configuration & edge cases', () => {
    test('default realtimeRatio is 0.30 / bulkRatio 0.70', () => {
      const pool = new ProxyIpPool();
      expect(pool.realtimeRatio).toBe(0.3);
      expect(pool.bulkRatio).toBe(0.7);
    });

    test('custom realtimeRatio is honored', () => {
      const pool = makePool(10);
      const custom = new ProxyIpPool({ realtimeRatio: 0.5 });
      for (let i = 1; i <= 10; i++) custom.add(`http://u:p@10.1.0.${i}:8080`);
      expect(custom.realtimeRatio).toBe(0.5);
      expect(custom.getPoolStats().realtime.total).toBe(5);
      expect(custom.getPoolStats().bulk.total).toBe(5);
      expect(pool.realtimeRatio).toBe(0.3);
    });

    test('realtimeRatio outside 0-1 throws XACT_4001', () => {
      expect(() => new ProxyIpPool({ realtimeRatio: 1.5 })).toThrow(PlatformError);
      try {
        new ProxyIpPool({ realtimeRatio: 2 });
      } catch (err) {
        expect(err.code).toBe('XACT_4001');
      }
    });

    test('mismatched bulkRatio throws XACT_4001', () => {
      expect(() => new ProxyIpPool({ realtimeRatio: 0.3, bulkRatio: 0.5 })).toThrow(PlatformError);
    });

    test('empty pool returns null and zeroed stats', () => {
      const pool = new ProxyIpPool();
      expect(pool.getProxy({ pool: 'realtime' })).toBeNull();
      expect(pool.getBulkProxy()).toBeNull();
      const stats = pool.getPoolStats();
      expect(stats.realtime.total).toBe(0);
      expect(stats.bulk.total).toBe(0);
      expect(stats.yieldedCount).toBe(0);
    });

    test('single proxy pool keeps the lone proxy realtime', () => {
      const pool = makePool(1);
      const stats = pool.getPoolStats();
      expect(stats.realtime.total).toBe(1);
      expect(stats.bulk.total).toBe(0);
      // Realtime still works; there is nothing to yield from but nothing to yield to either.
      expect(pool.getRealtimeProxy()).not.toBeNull();
    });

    test('legacy getNext still rotates the whole pool (backward compatibility)', () => {
      const pool = makePool(10);
      const seen = new Set();
      for (let i = 0; i < 10; i++) {
        seen.add(pool.getNext().host);
      }
      expect(seen.size).toBe(10);
    });
  });
});
