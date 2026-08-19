// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, test, expect, beforeEach } from 'vitest';
import { AccountPool } from '../../src/core/account-pool.js';
import { AdaptiveRateGovernor } from '../../src/core/adaptive-governor.js';
import { PlatformError } from '../../src/core/error-envelope.js';

describe('AccountPool Acceptance Tests (Story 11.1 - TDD Red Phase)', () => {
  let pool;
  let governor;

  beforeEach(() => {
    governor = new AdaptiveRateGovernor();
    pool = new AccountPool({ governor });
  });

  describe('AC-7: Account Registration and Storage', () => {
    test('should register accounts and store platform, credentials, and velocity metadata', () => {
      pool.registerAccounts('twitter', ['tw_acc_1', 'tw_acc_2'], {
        credentials: { tw_acc_1: { token: 'secret' } }
      });

      const accounts = pool.listAccounts('twitter');
      expect(accounts).toHaveLength(2);
      expect(accounts).toContain('tw_acc_1');
      expect(accounts).toContain('tw_acc_2');
    });

    test('should reject re-registering the same accountId under a different platform', () => {
      pool.registerAccounts('twitter', ['shared_acc']);
      expect(() => pool.registerAccounts('facebook', ['shared_acc'])).toThrow(PlatformError);
    });

    test('should reject non-array accountIds input', () => {
      expect(() => pool.registerAccounts('twitter', 'not_an_array')).toThrow(PlatformError);
    });

    test('should redact credentials and proxy auth in getAccount', () => {
      pool.registerAccounts('twitter', ['tw_acc_1'], {
        credentials: { tw_acc_1: { token: 'secret' } },
      });
      pool.setAssignedProxy('tw_acc_1', {
        scheme: 'http',
        host: '1.2.3.4',
        port: 8080,
        server: 'http://1.2.3.4:8080',
        username: 'user',
        password: 'pass',
      });

      const acc = pool.getAccount('tw_acc_1');
      expect(acc.credentials).toBeUndefined();
      expect(acc.assignedProxy.username).toBeUndefined();
      expect(acc.assignedProxy.password).toBeUndefined();
      expect(acc.assignedProxy.server).toBe('http://1.2.3.4:8080');
    });
  });

  describe('AC-8: Account Round-Robin and Availability', () => {
    beforeEach(() => {
      pool.registerAccounts('shopee', ['shopee_1', 'shopee_2', 'shopee_3']);
    });

    test('should rotate accounts in round-robin order', () => {
      const a1 = pool.getNextAvailable('shopee');
      const a2 = pool.getNextAvailable('shopee');
      const a3 = pool.getNextAvailable('shopee');
      const a4 = pool.getNextAvailable('shopee');

      expect(a1).toBe('shopee_1');
      expect(a2).toBe('shopee_2');
      expect(a3).toBe('shopee_3');
      expect(a4).toBe('shopee_1');
    });

    test('should check hasAvailable without mutating round-robin pointer', () => {
      expect(pool.hasAvailable('shopee')).toBe(true);
      const a1 = pool.getNextAvailable('shopee');
      expect(a1).toBe('shopee_1');
      expect(pool.hasAvailable('shopee')).toBe(true);
      const a2 = pool.getNextAvailable('shopee');
      expect(a2).toBe('shopee_2');
    });

    test('should return null when no accounts registered for platform', () => {
      expect(pool.getNextAvailable('unknown_platform')).toBeNull();
      expect(pool.hasAvailable('unknown_platform')).toBe(false);
    });
  });

  describe('AC-9: Account Unavailability, Hibernation, and Velocity', () => {
    beforeEach(() => {
      pool.registerAccounts('threads', ['th_1', 'th_2']);
    });

    test('should skip unavailable/hibernating accounts during round-robin', () => {
      pool.markUnavailable('th_1', 'rate_limit', 60000);

      const a1 = pool.getNextAvailable('threads');
      const a2 = pool.getNextAvailable('threads');
      expect(a1).toBe('th_2');
      expect(a2).toBe('th_2');
    });

    test('should restore account when markAvailable is called', () => {
      pool.markUnavailable('th_1');
      expect(pool.getNextAvailable('threads')).toBe('th_2');

      pool.markAvailable('th_1');
      // Should now be able to pick th_1 again
      const picked = [pool.getNextAvailable('threads'), pool.getNextAvailable('threads')];
      expect(picked).toContain('th_1');
    });

    test('should default markUnavailable to a finite hibernation duration', () => {
      pool.markUnavailable('th_1');
      const acc = pool.getAccount('th_1');
      expect(acc.hibernatingUntil).toBeGreaterThan(Date.now());
      expect(acc.hibernatingUntil).toBeLessThanOrEqual(Date.now() + 15 * 60 * 1000);
    });

    test('should not auto-wake hibernating accounts in hasAvailable', () => {
      pool.markUnavailable('th_1', 'rate_limit', 50);

      // hasAvailable must not mutate state.
      expect(pool.hasAvailable('threads')).toBe(true);

      // getNextAvailable should still be able to wake and pick the expired account.
      return new Promise((resolve) => {
        setTimeout(() => {
          const a1 = pool.getNextAvailable('threads');
          const a2 = pool.getNextAvailable('threads');
          expect(a1).toBe('th_1');
          expect(a2).toBe('th_2');
          resolve();
        }, 80);
      });
    });

    test('should track and return account velocity in 60s sliding window', () => {
      expect(typeof pool.getAccountVelocity).toBe('function');
      expect(pool.getAccountVelocity('th_1')).toBe(0);

      pool.recordRequest('th_1');
      pool.recordRequest('th_1');
      expect(pool.getAccountVelocity('th_1')).toBe(2);
    });

    test('should assign proxy to account record', () => {
      pool.setAssignedProxy('th_1', { server: 'http://1.2.3.4:8080' });
      const acc = pool.getAccount('th_1');
      expect(acc.assignedProxy).toEqual({ server: 'http://1.2.3.4:8080' });
    });
  });

  describe('AC-11: Integration with AdaptiveRateGovernor', () => {
    test('should respect governor hibernation and cooldown status', () => {
      pool.registerAccounts('tiktok', ['tt_1']);
      governor.recordRateLimit('tt_1', 'tiktok', 60000);

      expect(governor.isHibernating('tt_1', 'tiktok')).toBe(true);
      expect(pool.hasAvailable('tiktok')).toBe(false);
      expect(pool.getNextAvailable('tiktok')).toBeNull();

      // Early wake via markAvailable
      pool.markAvailable('tt_1');
      expect(governor.isHibernating('tt_1', 'tiktok')).toBe(false);
      expect(pool.hasAvailable('tiktok')).toBe(true);
      expect(pool.getNextAvailable('tiktok')).toBe('tt_1');
    });
  });
});
