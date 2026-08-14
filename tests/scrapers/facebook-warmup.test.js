// Story 6.15 — Session Warming Sequence (ADR-016)
// Pure-module tests for src/scrapers/facebook/warmup.js
import { describe, it, expect, vi } from 'vitest';
import { warmSession } from '../../src/scrapers/facebook/warmup.js';
import { loginWithCookie } from '../../src/scrapers/facebook/index.js';
import { makeFakePage } from '../helpers/fake-page.js';

describe('Story 6.15 — Session Warming Sequence', () => {
  describe('warmSession pure logic & seams (AC1, AC2, AC5, AC6, AC7, AC8)', () => {
    it('warmSession is exported and is a function (AC1, AC2)', () => {
      expect(typeof warmSession).toBe('function');
    });

    it('navigates to Facebook homepage (AC1)', async () => {
      const page = makeFakePage();
      const delayFn = vi.fn(async () => {});
      await warmSession(page, { delayFn, rng: () => 0.5 });
      expect(page.calls.goto).toHaveLength(1);
      expect(page.calls.goto[0].url).toBe('https://www.facebook.com/');
    });

    it('executes wait delays and scroll distances deterministically with rng=0.5 (AC5, AC6)', async () => {
      const page = makeFakePage();
      const delayFn = vi.fn(async () => {});
      const res = await warmSession(page, { delayFn, rng: () => 0.5 });

      // First wait: 3000 + 0.5 * 5000 = 5500ms
      // First scroll: 300 + 0.5 * 500 = 550px
      // Second wait: 2000 + 0.5 * 4000 = 4000ms
      // Second scroll: 200 + 0.5 * 300 = 350px
      // Third wait: 1000 + 0.5 * 3000 = 2500ms
      // 3 mouse moves, each followed by 500 + 0.5 * 1500 = 1250ms delay
      expect(res.steps).toBeDefined();
      expect(res.durationMs).toBeGreaterThanOrEqual(0);
      expect(delayFn).toHaveBeenCalled();

      // Check recorded delay calls include expected values
      const delayMsCalls = delayFn.mock.calls.map((c) => c[0]);
      expect(delayMsCalls).toContain(5500);
      expect(delayMsCalls).toContain(4000);
      expect(delayMsCalls).toContain(2500);
      expect(delayMsCalls).toContain(1250);
    });

    it('executes 3 mouse movements within safe bounds (AC1, AC7)', async () => {
      const viewport = { width: 1280, height: 720 };
      const page = makeFakePage({ viewport });
      const delayFn = vi.fn(async () => {});
      await warmSession(page, { delayFn, rng: () => 0.5 });

      expect(page.calls.mouse.move.length).toBeGreaterThanOrEqual(3);
      for (const move of page.calls.mouse.move) {
        expect(move.x).toBeGreaterThanOrEqual(0);
        expect(move.x).toBeLessThanOrEqual(viewport.width);
        expect(move.y).toBeGreaterThanOrEqual(0);
        expect(move.y).toBeLessThanOrEqual(viewport.height);
      }
    });

    it('skips warming sequence immediately when skipWarmup=true (AC4)', async () => {
      const page = makeFakePage();
      const delayFn = vi.fn(async () => {});
      const res = await warmSession(page, { delayFn, skipWarmup: true });

      expect(res.steps).toEqual(['skip']);
      expect(res.durationMs).toBe(0);
      expect(page.calls.goto).toHaveLength(0);
      expect(delayFn).not.toHaveBeenCalled();
    });

    it('never throws even if page.goto or mouse fails (best-effort resilience)', async () => {
      const page = makeFakePage();
      page.goto = async () => { throw new Error('Network error'); };
      const delayFn = vi.fn(async () => {});

      const res = await warmSession(page, { delayFn });
      expect(res.error).toBeDefined();
      expect(res.steps).toContain('error');
    });
  });

  describe('loginWithCookie warming integration (AC3, AC4)', () => {
    it('loginWithCookie triggers session warming by default (AC3)', async () => {
      const page = makeFakePage();
      const delayFn = vi.fn(async () => {});
      await loginWithCookie(page, { c_user: '100001', xs: 'xs-token' }, { delayFn, rng: () => 0.5 });

      // Check goto was called for homepage warming after login
      const gotoUrls = page.calls.goto.map((c) => c.url);
      expect(gotoUrls).toContain('https://www.facebook.com/');
    });

    it('loginWithCookie skips warming when headless=false and skipWarmup=true (AC4)', async () => {
      const page = makeFakePage();
      const delayFn = vi.fn(async () => {});
      await loginWithCookie(page, { c_user: '100001', xs: 'xs-token' }, { headless: false, skipWarmup: true, delayFn });

      // DelayFn should NOT be called for warming delays
      expect(delayFn).not.toHaveBeenCalled();
    });

    it('loginWithCookie does NOT fail if warming throws an error (best-effort resilience)', async () => {
      const page = makeFakePage();
      let gotoCount = 0;
      page.goto = async (url, opts) => {
        gotoCount++;
        if (gotoCount > 2) throw new Error('Warming network error');
        return { ok: true };
      };
      const delayFn = vi.fn(async () => {});

      await expect(loginWithCookie(page, { c_user: '100001', xs: 'xs-token' }, { delayFn })).resolves.not.toThrow();
      expect(page._fbAccountId).toBe('100001');
    });
  });
});
