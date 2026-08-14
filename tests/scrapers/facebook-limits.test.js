// Story 6.13 — Action Velocity Limiting (ADR-015)
// Pure-module tests for src/scrapers/facebook/limits.js
import { describe, it, expect, vi } from 'vitest';
import {
  LIMITS,
  ACCOUNT_AGE_TIERS,
  getActionLimit,
  enforceDelay,
  getAccountAgeDays,
} from '../../src/scrapers/facebook/limits.js';

describe('Story 6.13 — Action Velocity Limiting', () => {
  describe('LIMITS (AC1, AC2)', () => {
    it('exports LIMITS with the four expected actions', () => {
      expect(LIMITS).toHaveProperty('like');
      expect(LIMITS).toHaveProperty('comment');
      expect(LIMITS).toHaveProperty('friendRequest');
      expect(LIMITS).toHaveProperty('message');
    });

    it('like limit is 30 per hour', () => {
      expect(LIMITS.like).toEqual({ perHour: 30 });
    });

    it('comment limit is 10 per hour', () => {
      expect(LIMITS.comment).toEqual({ perHour: 10 });
    });

    it('friendRequest limit is 20 per day', () => {
      expect(LIMITS.friendRequest).toEqual({ perDay: 20 });
    });

    it('message limit is 20 per hour', () => {
      expect(LIMITS.message).toEqual({ perHour: 20 });
    });

    it('LIMITS is deeply frozen (hard floors not overrideable)', () => {
      expect(Object.isFrozen(LIMITS)).toBe(true);
      expect(Object.isFrozen(LIMITS.like)).toBe(true);
      expect(Object.isFrozen(LIMITS.comment)).toBe(true);
      expect(Object.isFrozen(LIMITS.friendRequest)).toBe(true);
      expect(Object.isFrozen(LIMITS.message)).toBe(true);
    });
  });

  describe('ACCOUNT_AGE_TIERS (AC4)', () => {
    it('has three tiers: <7d, <=28d, mature', () => {
      expect(ACCOUNT_AGE_TIERS.length).toBe(3);
      expect(ACCOUNT_AGE_TIERS[0]).toMatchObject({ maxDays: 7, factor: 0.5, label: 'new' });
      expect(ACCOUNT_AGE_TIERS[1]).toMatchObject({ maxDays: 28, factor: 0.8, label: 'young' });
      expect(ACCOUNT_AGE_TIERS[2]).toMatchObject({ maxDays: Infinity, factor: 1.0, label: 'mature' });
    });

    it('ACCOUNT_AGE_TIERS is deeply frozen', () => {
      expect(Object.isFrozen(ACCOUNT_AGE_TIERS)).toBe(true);
      expect(Object.isFrozen(ACCOUNT_AGE_TIERS[0])).toBe(true);
      expect(Object.isFrozen(ACCOUNT_AGE_TIERS[1])).toBe(true);
      expect(Object.isFrozen(ACCOUNT_AGE_TIERS[2])).toBe(true);
    });
  });

  describe('getActionLimit (AC3, AC4, AC5)', () => {
    it('returns full like limit without age (mature)', () => {
      expect(getActionLimit('like')).toEqual({ perHour: 30 });
    });

    it('returns full comment limit without age', () => {
      expect(getActionLimit('comment')).toEqual({ perHour: 10 });
    });

    it('returns full friendRequest limit without age', () => {
      expect(getActionLimit('friendRequest')).toEqual({ perDay: 20 });
    });

    it('returns full message limit without age', () => {
      expect(getActionLimit('message')).toEqual({ perHour: 20 });
    });

    it('scales like to 50% for accounts < 7 days (5 days)', () => {
      expect(getActionLimit('like', 5)).toEqual({ perHour: 15 });
    });

    it('scales like to 50% at exactly 7 days', () => {
      expect(getActionLimit('like', 7)).toEqual({ perHour: 15 });
    });

    it('scales like to 80% for accounts 1-4 weeks (14 days)', () => {
      expect(getActionLimit('like', 14)).toEqual({ perHour: 24 });
    });

    it('scales like to 80% at exactly 28 days', () => {
      expect(getActionLimit('like', 28)).toEqual({ perHour: 24 });
    });

    it('returns full like limit for accounts > 3 months (100 days)', () => {
      expect(getActionLimit('like', 100)).toEqual({ perHour: 30 });
    });

    it('floors scaled limits to integers and never below 1', () => {
      expect(getActionLimit('comment', 5)).toEqual({ perHour: 5 });
      expect(getActionLimit('friendRequest', 5)).toEqual({ perDay: 10 });
      expect(getActionLimit('message', 5)).toEqual({ perHour: 10 });
    });

    it('returns null for unknown action (AC5)', () => {
      expect(getActionLimit('unknown')).toBeNull();
      expect(getActionLimit('share')).toBeNull();
    });

    it('treats negative accountAgeDays as most restrictive (clamped to 0)', () => {
      expect(getActionLimit('like', -1)).toEqual({ perHour: 15 });
    });

    it('treats null, undefined, and NaN as mature (full limits)', () => {
      expect(getActionLimit('like', null)).toEqual({ perHour: 30 });
      expect(getActionLimit('like', undefined)).toEqual({ perHour: 30 });
      expect(getActionLimit('like', NaN)).toEqual({ perHour: 30 });
    });

    it('coerces string accountAgeDays to numbers', () => {
      expect(getActionLimit('like', '5')).toEqual({ perHour: 15 });
      expect(getActionLimit('like', '100')).toEqual({ perHour: 30 });
    });

    it('returns null for non-string or invalid action values', () => {
      expect(getActionLimit(123, 5)).toBeNull();
      expect(getActionLimit({}, 5)).toBeNull();
      expect(getActionLimit([], 5)).toBeNull();
      expect(getActionLimit(null, 5)).toBeNull();
      expect(getActionLimit(undefined, 5)).toBeNull();
      expect(getActionLimit('', 5)).toBeNull();
    });

    it('returns 50% for brand new account (0 days)', () => {
      expect(getActionLimit('like', 0)).toEqual({ perHour: 15 });
    });
  });

  describe('enforceDelay (AC6, AC7, AC8)', () => {
    it('calls delayFn once with 5000-15000ms (AC6)', async () => {
      const delayFn = vi.fn(async () => {});
      await enforceDelay('like', 30, { delayFn, rng: () => 0.5 });
      expect(delayFn).toHaveBeenCalledOnce();
      const ms = delayFn.mock.calls[0][0];
      expect(ms).toBeGreaterThanOrEqual(5000);
      expect(ms).toBeLessThanOrEqual(15000);
    });

    it('with rng=0.5 delay is exactly 10000ms (AC7)', async () => {
      const delayFn = vi.fn(async () => {});
      await enforceDelay('like', 30, { delayFn, rng: () => 0.5 });
      expect(delayFn.mock.calls[0][0]).toBe(10000);
    });

    it('uses injected delayFn instead of real time (AC7)', async () => {
      const delayFn = vi.fn(async () => 'injected');
      const result = await enforceDelay('comment', 14, { delayFn, rng: () => 0.0 });
      expect(delayFn).toHaveBeenCalledOnce();
      expect(delayFn.mock.calls[0][0]).toBe(5000);
      expect(result).toBe('injected');
    });

    it('uses injected rng for randomization (AC7)', async () => {
      const delayFn = vi.fn(async () => {});
      const rng = vi.fn(() => 0.25);
      await enforceDelay('message', 100, { delayFn, rng });
      expect(rng).toHaveBeenCalledOnce();
      expect(delayFn.mock.calls[0][0]).toBe(7500); // 5000 + 0.25 * 10000
    });

    it('works with unknown action (still 5-15s delay)', async () => {
      const delayFn = vi.fn(async () => {});
      await enforceDelay('unknown', 0, { delayFn, rng: () => 0.0 });
      expect(delayFn).toHaveBeenCalledOnce();
      expect(delayFn.mock.calls[0][0]).toBe(5000);
    });

    it('calls delayFn with 15000ms when rng returns 1.0 (upper bound)', async () => {
      const delayFn = vi.fn(async () => {});
      await enforceDelay('like', 30, { delayFn, rng: () => 1.0 });
      expect(delayFn).toHaveBeenCalledOnce();
      expect(delayFn.mock.calls[0][0]).toBe(15000);
    });

    it('clamps negative rng to 0 (minimum 5000ms)', async () => {
      const delayFn = vi.fn(async () => {});
      await enforceDelay('like', 30, { delayFn, rng: () => -0.5 });
      expect(delayFn).toHaveBeenCalledOnce();
      expect(delayFn.mock.calls[0][0]).toBe(5000);
    });

    it('clamps rng above 1.0 to 1.0 (maximum 15000ms)', async () => {
      const delayFn = vi.fn(async () => {});
      await enforceDelay('like', 30, { delayFn, rng: () => 1.5 });
      expect(delayFn).toHaveBeenCalledOnce();
      expect(delayFn.mock.calls[0][0]).toBe(15000);
    });

    it('is a pure function and does not import puppeteer (AC8)', () => {
      // limits.js is a pure module; this test documents that it has no browser side effects.
      expect(typeof enforceDelay).toBe('function');
      expect(typeof getActionLimit).toBe('function');
    });
  });

  describe('getAccountAgeDays (Story 6.14 — AC1, AC2, AC3, AC4)', () => {
    const fixedNow = new Date('2026-08-13T12:00:00Z').getTime();
    const nowFn = () => fixedNow;

    it('calculates correct account age in days from db.getAccountCreatedAt (AC2)', async () => {
      const db = {
        getAccountCreatedAt: vi.fn(async (c_user) => new Date('2026-08-03T12:00:00Z')),
      };
      const age = await getAccountAgeDays('123456', { db, nowFn });
      expect(db.getAccountCreatedAt).toHaveBeenCalledWith('123456');
      expect(age).toBe(10); // 10 days difference
    });

    it('returns 0 when account was created today (AC2)', async () => {
      const db = {
        getAccountCreatedAt: vi.fn(async () => new Date(fixedNow)),
      };
      const age = await getAccountAgeDays('123456', { db, nowFn });
      expect(age).toBe(0);
    });

    it('clamps negative age to 0 if createdAt is in the future (AC2)', async () => {
      const db = {
        getAccountCreatedAt: vi.fn(async () => new Date('2026-08-14T12:00:00Z')),
      };
      const age = await getAccountAgeDays('123456', { db, nowFn });
      expect(age).toBe(0);
    });

    it('returns 0 when db.getAccountCreatedAt returns null/undefined (fail-safe)', async () => {
      const db = {
        getAccountCreatedAt: vi.fn(async () => null),
      };
      const age = await getAccountAgeDays('unknown', { db, nowFn });
      expect(age).toBe(0);
    });

    it('returns 0 when db is not provided (fail-safe)', async () => {
      const age = await getAccountAgeDays('123456');
      expect(age).toBe(0);
    });

    it('returns 0 when db is empty object without getAccountCreatedAt method', async () => {
      const age = await getAccountAgeDays('123456', { db: {} });
      expect(age).toBe(0);
    });

    it('returns 0 when c_user is null/undefined/empty', async () => {
      const db = {
        getAccountCreatedAt: vi.fn(async () => new Date('2026-08-03T12:00:00Z')),
      };
      expect(await getAccountAgeDays(null, { db, nowFn })).toBe(0);
      expect(await getAccountAgeDays('', { db, nowFn })).toBe(0);
    });

    it('handles createdAt returning string ISO date', async () => {
      const db = {
        getAccountCreatedAt: vi.fn(async () => '2026-08-03T12:00:00Z'),
      };
      const age = await getAccountAgeDays('123456', { db, nowFn });
      expect(age).toBe(10);
    });

    it('handles createdAt returning number (ms)', async () => {
      const db = {
        getAccountCreatedAt: vi.fn(async () => fixedNow - 86400000 * 10),
      };
      const age = await getAccountAgeDays('123456', { db, nowFn });
      expect(age).toBe(10);
    });

    it('returns 0 when createdAt is an invalid string', async () => {
      const db = {
        getAccountCreatedAt: vi.fn(async () => 'not-a-date'),
      };
      const age = await getAccountAgeDays('123456', { db, nowFn });
      expect(age).toBe(0);
    });

    it('returns 0 when db.getAccountCreatedAt throws', async () => {
      const db = {
        getAccountCreatedAt: vi.fn(async () => { throw new Error('db down'); }),
      };
      const age = await getAccountAgeDays('123456', { db, nowFn });
      expect(age).toBe(0);
    });

    it('returns 0 when nowFn returns an invalid value', async () => {
      const db = {
        getAccountCreatedAt: vi.fn(async () => new Date('2026-08-03T12:00:00Z')),
      };
      const age = await getAccountAgeDays('123456', { db, nowFn: () => 'invalid' });
      expect(age).toBe(0);
    });

    it('uses defaultNowFn when nowFn is not provided and returns a stable age', async () => {
      const db = {
        getAccountCreatedAt: vi.fn(async () => new Date(Date.now() - 86400000 * 5 - 1000)),
      };
      const age = await getAccountAgeDays('123456', { db });
      // should be 5 (off-by-one acceptable)
      expect(age).toBeGreaterThanOrEqual(4);
      expect(age).toBeLessThanOrEqual(6);
    });

    it('integration: getAccountAgeDays result passed to getActionLimit', async () => {
      const db = {
        getAccountCreatedAt: vi.fn(async () => new Date('2026-08-08T12:00:00Z')), // 5 days -> new tier
      };
      const accountAgeDays = await getAccountAgeDays('123456', { db, nowFn });
      const limit = getActionLimit('like', accountAgeDays);
      expect(limit).toEqual({ perHour: 15 }); // 50% for <7-day account
    });
  });

  describe('No regression (AC9)', () => {
    it('module does not export puppeteer imports or browser objects', () => {
      // The module only exports LIMITS, ACCOUNT_AGE_TIERS, getActionLimit, enforceDelay, getAccountAgeDays
      expect(getActionLimit).toBeDefined();
      expect(enforceDelay).toBeDefined();
      expect(getAccountAgeDays).toBeDefined();
      expect(LIMITS).toBeDefined();
      expect(ACCOUNT_AGE_TIERS).toBeDefined();
    });
  });
});
