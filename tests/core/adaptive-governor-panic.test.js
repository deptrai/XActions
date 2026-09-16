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
});
