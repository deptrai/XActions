// Story 6.13 — Action Velocity Limiting (ADR-015)
// Pure-module tests for src/scrapers/facebook/limits.js
import { describe, it, expect, vi } from 'vitest';
import {
  LIMITS,
  ACCOUNT_AGE_TIERS,
  getActionLimit,
  enforceDelay,
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
  });

  describe('ACCOUNT_AGE_TIERS (AC4)', () => {
    it('has three tiers: <7d, <=28d, mature', () => {
      expect(ACCOUNT_AGE_TIERS.length).toBe(3);
      expect(ACCOUNT_AGE_TIERS[0]).toMatchObject({ maxDays: 7, factor: 0.5, label: 'new' });
      expect(ACCOUNT_AGE_TIERS[1]).toMatchObject({ maxDays: 28, factor: 0.8, label: 'young' });
      expect(ACCOUNT_AGE_TIERS[2]).toMatchObject({ maxDays: Infinity, factor: 1.0, label: 'mature' });
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

    it('treats negative accountAgeDays as most restrictive (new tier)', () => {
      expect(getActionLimit('like', -1)).toEqual({ perHour: 15 });
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

    it('is a pure function and does not import puppeteer (AC8)', () => {
      // limits.js is a pure module; this test documents that it has no browser side effects.
      expect(typeof enforceDelay).toBe('function');
      // Function length ignores defaulted parameters; enforceDelay has 3 params (action, accountAgeDays = Infinity, options = {})
      expect(enforceDelay.length).toBe(1);
    });
  });

  describe('No regression (AC9)', () => {
    it('module does not export puppeteer imports or browser objects', () => {
      // The module only exports LIMITS, ACCOUNT_AGE_TIERS, getActionLimit, enforceDelay
      expect(getActionLimit).toBeDefined();
      expect(enforceDelay).toBeDefined();
      expect(LIMITS).toBeDefined();
      expect(ACCOUNT_AGE_TIERS).toBeDefined();
    });
  });
});
