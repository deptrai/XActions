import { describe, it, expect, beforeEach } from 'vitest';
import { AdaptiveRateGovernor } from '../../src/core/adaptive-governor.js';

describe('Story 32.1 — AdaptiveRateGovernor: Panic Stop & Quota Priority Allocator', () => {
  let governor;

  beforeEach(() => {
    governor = new AdaptiveRateGovernor();
  });

  describe('panicStop & resumePanic', () => {
    it('activates emergency panic stop for a specific platform and sets throttleLevel to critical', () => {
      const res = governor.panicStop('twitter', { durationMs: 10000 });
      expect(res.success).toBe(true);
      expect(res.platform).toBe('twitter');
      expect(res.throttleLevel).toBe('critical');

      const status = governor.getStatus();
      expect(status.throttleLevel).toBe('critical');
      expect(status.panicStoppedPlatforms).toContain('twitter');
      expect(governor.isHibernating('twitter:*')).toBe(true);
    });

    it('activates emergency panic stop globally for all platforms', () => {
      governor.panicStop('all');
      const status = governor.getStatus();
      expect(status.throttleLevel).toBe('critical');
      expect(status.panicStoppedPlatforms).toContain('all');
    });

    it('resumes panic stop for a specific platform', () => {
      governor.panicStop('threads');
      expect(governor.getStatus().panicStoppedPlatforms).toContain('threads');

      const res = governor.resumePanic('threads');
      expect(res.success).toBe(true);
      expect(governor.getStatus().panicStoppedPlatforms).not.toContain('threads');
      expect(governor.isHibernating('threads:*')).toBe(false);
    });

    it('resumes all panic stops when platform is "all"', () => {
      governor.panicStop('twitter');
      governor.panicStop('mastodon');
      expect(governor.getStatus().panicStoppedPlatforms.length).toBe(2);

      governor.resumePanic('all');
      expect(governor.getStatus().panicStoppedPlatforms).toHaveLength(0);
      expect(governor.getStatus().throttleLevel).not.toBe('critical');
    });
  });

  describe('setConsumerPriority', () => {
    it('updates priority for known consumers and reflects in getStatus()', () => {
      const ok1 = governor.setConsumerPriority('nowing', 1);
      const ok2 = governor.setConsumerPriority('chainlens', 2);
      expect(ok1).toBe(true);
      expect(ok2).toBe(true);

      const status = governor.getStatus();
      expect(status.consumerQuotas.nowing.priority).toBe(1);
      expect(status.consumerQuotas.chainlens.priority).toBe(2);
    });

    it('returns false when consumer is unknown or missing', () => {
      expect(governor.setConsumerPriority('unknown_consumer', 5)).toBe(false);
      expect(governor.setConsumerPriority('', 1)).toBe(false);
    });
  });

  describe('Durable panic state (Story 32 fix)', () => {
    it('restores panic state from Redis keys on construction', async () => {
      // Simulate a panic written by a previous process
      const fakeRedis = {
        keys: async (pattern) => (pattern === 'xact:panic:*' ? ['xact:panic:twitter', 'xact:panic:mastodon'] : []),
        get: async () => null,
        set: async () => 'OK',
        del: async () => 1,
      };
      const g = new AdaptiveRateGovernor({ redis: fakeRedis });
      // #restorePanicsFromRedis is fire-and-forget — wait a tick for it to land
      await new Promise((r) => setTimeout(r, 20));
      const status = g.getStatus();
      expect(status.panicStoppedPlatforms).toContain('twitter');
      expect(status.panicStoppedPlatforms).toContain('mastodon');
      expect(status.throttleLevel).toBe('critical');
    });

    it('isPanicStoppedAsync reads the durable Redis panic key for cross-instance panics', async () => {
      const store = new Map();
      const fakeRedis = {
        keys: async () => [],
        get: async (k) => store.get(k) ?? null,
        set: async (k, v) => { store.set(k, v); return 'OK'; },
        del: async (k) => { store.delete(k); return 1; },
      };
      const g = new AdaptiveRateGovernor({ redis: fakeRedis });
      // In-memory says no panic…
      expect(g.getStatus().panicStoppedPlatforms).toHaveLength(0);
      // …but another instance wrote a durable panic for 'twitter'
      await fakeRedis.set('xact:panic:twitter', 'emergency');
      expect(await g.isPanicStoppedAsync('twitter')).toBe(true);
      expect(await g.isPanicStoppedAsync('bluesky')).toBe(false);
      // A global panic applies to every platform
      await fakeRedis.set('xact:panic:all', 'global');
      expect(await g.isPanicStoppedAsync('anything')).toBe(true);
    });

    it('wildcard hibernation (platform:*) matches concrete accounts after panicStop', () => {
      governor.panicStop('twitter', { durationMs: 10000 });
      // panicStop hibernates 'twitter:*' — a concrete account must match it.
      expect(governor.isHibernating('twitter:acc123')).toBe(true);
      expect(governor.isHibernating('twitter:acc999', 'twitter')).toBe(true);
      // Other platforms unaffected
      expect(governor.isHibernating('bluesky:acc1')).toBe(false);
    });
  });
});
