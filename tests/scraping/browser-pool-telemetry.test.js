// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * BrowserPool Telemetry & Release Verify Gate Tests — Story 53.6.
 * Validates:
 * 1. TelemetryContext pooled dims (pooled, poolBackend, poolWaitMs) gated by MEDIRUS_BROWSER_BACKEND_METRICS=1.
 * 2. TelemetryEmitter stripping behavior when metrics flag is off vs preserved when on.
 * 3. stealthBrowser & PuppeteerAdapter propagation of pool lease telemetry.
 * 4. scripts/browser-pool-spike.mjs evaluateGateConditions gate criteria evaluation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TelemetryContext } from '../../src/core/telemetry-context.js';
import { TelemetryEmitter } from '../../src/core/telemetry-emitter.js';
import { evaluateGateConditions } from '../../scripts/browser-pool-spike.mjs';
import { launchStealthBrowser } from '../../src/scraping/stealthBrowser.js';
import { PuppeteerAdapter } from '../../src/scrapers/adapters/puppeteer.js';

describe('Story 53.6 — BrowserPool Telemetry Dimensions & Verify Gate', () => {
  const originalEnv = process.env.MEDIRUS_BROWSER_BACKEND_METRICS;

  beforeEach(() => {
    delete process.env.MEDIRUS_BROWSER_BACKEND_METRICS;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.MEDIRUS_BROWSER_BACKEND_METRICS = originalEnv;
    } else {
      delete process.env.MEDIRUS_BROWSER_BACKEND_METRICS;
    }
  });

  describe('TelemetryContext — pool dimensions', () => {
    it('[P0] omits pooled, poolBackend, and poolWaitMs when MEDIRUS_BROWSER_BACKEND_METRICS is unset', () => {
      const ctx = new TelemetryContext({
        scraperId: 'twitter-scraper',
        platform: 'twitter',
        category: 'social',
        action: 'scrape_tweets',
        pooled: true,
        poolBackend: 'chrome',
        poolWaitMs: 42,
      });

      const payload = ctx.toRunPayload({ isSuccess: true });
      expect(payload.browserBackend).toBeUndefined();
      expect(payload.pooled).toBeUndefined();
      expect(payload.poolBackend).toBeUndefined();
      expect(payload.poolWaitMs).toBeUndefined();
    });

    it('[P0] attaches pooled, poolBackend, and poolWaitMs when MEDIRUS_BROWSER_BACKEND_METRICS=1', () => {
      process.env.MEDIRUS_BROWSER_BACKEND_METRICS = '1';

      const ctx = new TelemetryContext({
        scraperId: 'twitter-scraper',
        platform: 'twitter',
        category: 'social',
        action: 'scrape_tweets',
        pooled: true,
        poolBackend: 'chrome',
        poolWaitMs: 35,
      });

      const payload = ctx.toRunPayload({ isSuccess: true });
      expect(payload.pooled).toBe(true);
      expect(payload.poolBackend).toBe('chrome');
      expect(payload.poolWaitMs).toBe(35);
    });

    it('[P1] setPoolTelemetry dynamically updates pool dimensions and browserBackend', () => {
      process.env.MEDIRUS_BROWSER_BACKEND_METRICS = '1';

      const ctx = new TelemetryContext({
        scraperId: 'reddit-scraper',
        platform: 'reddit',
        category: 'social',
        action: 'scrape_posts',
      });

      ctx.setPoolTelemetry({
        pooled: true,
        poolBackend: 'obscura',
        poolWaitMs: 120,
      });

      expect(ctx.pooled).toBe(true);
      expect(ctx.poolBackend).toBe('obscura');
      expect(ctx.browserBackend).toBe('obscura');
      expect(ctx.poolWaitMs).toBe(120);

      const payload = ctx.toRunPayload({ isSuccess: true });
      expect(payload.pooled).toBe(true);
      expect(payload.poolBackend).toBe('obscura');
      expect(payload.browserBackend).toBe('obscura');
      expect(payload.poolWaitMs).toBe(120);
    });

    it('[P1] poolWaitMs NaN is dropped from payload (not emitted as NaN)', () => {
      process.env.MEDIRUS_BROWSER_BACKEND_METRICS = '1';

      const ctx = new TelemetryContext({
        scraperId: 's', platform: 'p',
        category: 'social',
        action: 'a',
        pooled: true,
        poolBackend: 'chrome',
        poolWaitMs: /** @type {any} */ ('abc'),
      });

      const payload = ctx.toRunPayload({ isSuccess: true });
      expect(payload.poolWaitMs).toBeUndefined();
    });

    it('[P1] poolWaitMs: 0 is preserved as 0 (not dropped)', () => {
      process.env.MEDIRUS_BROWSER_BACKEND_METRICS = '1';

      const ctx = new TelemetryContext({
        scraperId: 's', platform: 'p',
        category: 'social',
        action: 'a',
        pooled: true,
        poolBackend: 'chrome',
        poolWaitMs: 0,
      });

      const payload = ctx.toRunPayload({ isSuccess: true });
      expect(payload.poolWaitMs).toBe(0);
    });

    it('[P1] pooled: false is preserved as false (not dropped)', () => {
      process.env.MEDIRUS_BROWSER_BACKEND_METRICS = '1';

      const ctx = new TelemetryContext({
        scraperId: 's', platform: 'p',
        category: 'social',
        action: 'a',
        pooled: false,
      });

      const payload = ctx.toRunPayload({ isSuccess: true });
      expect(payload.pooled).toBe(false);
    });

    it('[P1] toRunPayload runDetails overrides context-level pool dimensions', () => {
      process.env.MEDIRUS_BROWSER_BACKEND_METRICS = '1';

      const ctx = new TelemetryContext({
        scraperId: 'test-scraper',
        platform: 'test',
        category: 'social',
        action: 'a',
        pooled: false,
        poolBackend: 'chrome',
        poolWaitMs: 10,
      });

      const payload = ctx.toRunPayload({
        pooled: true,
        poolBackend: 'obscura',
        poolWaitMs: 75,
      });

      expect(payload.pooled).toBe(true);
      expect(payload.poolBackend).toBe('obscura');
      expect(payload.poolWaitMs).toBe(75);
    });
  });

  describe('TelemetryEmitter — emitRun stripping vs preservation', () => {
    it('[P0] strips all pool telemetry dimensions when MEDIRUS_BROWSER_BACKEND_METRICS is unset', () => {
      delete process.env.MEDIRUS_BROWSER_BACKEND_METRICS;

      const emitter = new TelemetryEmitter();
      /** @type {any[]} */
      const captured = [];
      emitter.emit = (p) => {
        captured.push(p);
        return true;
      };

      emitter.emitRun({
        runId: 'run-123',
        browserBackend: 'chrome',
        pooled: true,
        poolBackend: 'chrome',
        poolWaitMs: 50,
      });

      expect(captured).toHaveLength(1);
      expect(captured[0].browserBackend).toBeUndefined();
      expect(captured[0].pooled).toBeUndefined();
      expect(captured[0].poolBackend).toBeUndefined();
      expect(captured[0].poolWaitMs).toBeUndefined();
    });

    it('[P0] strips pool dims when MEDIRUS_BROWSER_BACKEND_METRICS=0 (truthy-string edge case)', () => {
      process.env.MEDIRUS_BROWSER_BACKEND_METRICS = '0';

      const emitter = new TelemetryEmitter();
      /** @type {any[]} */
      const captured = [];
      emitter.emit = (p) => { captured.push(p); return true; };

      emitter.emitRun({ runId: 'r', browserBackend: 'chrome', pooled: true, poolBackend: 'chrome', poolWaitMs: 10 });

      expect(captured[0].browserBackend).toBeUndefined();
      expect(captured[0].pooled).toBeUndefined();
      expect(captured[0].poolBackend).toBeUndefined();
      expect(captured[0].poolWaitMs).toBeUndefined();
    });

    it('[P0] preserves pool telemetry dimensions when MEDIRUS_BROWSER_BACKEND_METRICS=1', () => {
      process.env.MEDIRUS_BROWSER_BACKEND_METRICS = '1';

      const emitter = new TelemetryEmitter();
      /** @type {any[]} */
      const captured = [];
      emitter.emit = (p) => {
        captured.push(p);
        return true;
      };

      emitter.emitRun({
        runId: 'run-456',
        browserBackend: 'chrome',
        pooled: true,
        poolBackend: 'chrome',
        poolWaitMs: 25,
      });

      expect(captured).toHaveLength(1);
      expect(captured[0].browserBackend).toBe('chrome');
      expect(captured[0].pooled).toBe(true);
      expect(captured[0].poolBackend).toBe('chrome');
      expect(captured[0].poolWaitMs).toBe(25);
    });
  });

  describe('Launcher & Adapter wiring with TelemetryContext', () => {
    it('[P0] launchStealthBrowser invokes setPoolTelemetry on telemetryContext', async () => {
      const mockPage = { close: vi.fn().mockResolvedValue(undefined) };
      const mockContext = { close: vi.fn().mockResolvedValue(undefined) };
      const mockPool = {
        acquire: vi.fn().mockResolvedValue({
          page: mockPage,
          context: mockContext,
          backend: 'chrome',
          waitMs: 18,
          pageMs: 30,
        }),
        release: vi.fn().mockResolvedValue(undefined),
      };

      const mockTelemetryContext = {
        setPoolTelemetry: vi.fn(),
        setBrowserBackend: vi.fn(),
      };

      const handle = await launchStealthBrowser({
        pooled: mockPool,
        telemetryContext: mockTelemetryContext,
      });

      expect(mockPool.acquire).toHaveBeenCalledTimes(1);
      expect(mockTelemetryContext.setPoolTelemetry).toHaveBeenCalledWith({
        pooled: true,
        poolBackend: 'chrome',
        poolWaitMs: 18,
      });
      expect(mockTelemetryContext.setBrowserBackend).toHaveBeenCalledWith('chrome');
      expect(handle).toBeDefined();
    });

    it('[P0] PuppeteerAdapter.launch invokes setPoolTelemetry on telemetryContext', async () => {
      const mockPage = { close: vi.fn().mockResolvedValue(undefined) };
      const mockContext = { close: vi.fn().mockResolvedValue(undefined) };
      const mockPool = {
        acquire: vi.fn().mockResolvedValue({
          page: mockPage,
          context: mockContext,
          backend: 'obscura',
          waitMs: 42,
          pageMs: 65,
        }),
        release: vi.fn().mockResolvedValue(undefined),
      };

      const mockTelemetryContext = {
        setPoolTelemetry: vi.fn(),
        setBrowserBackend: vi.fn(),
      };

      const adapter = new PuppeteerAdapter();
      const wrapped = await adapter.launch({
        pooled: mockPool,
        telemetryContext: mockTelemetryContext,
      });

      expect(mockPool.acquire).toHaveBeenCalledTimes(1);
      expect(mockTelemetryContext.setPoolTelemetry).toHaveBeenCalledWith({
        pooled: true,
        poolBackend: 'obscura',
        poolWaitMs: 42,
      });
      expect(mockTelemetryContext.setBrowserBackend).toHaveBeenCalledWith('obscura');
      expect(wrapped._pooled).toBe(true);
      expect(wrapped._backend).toBe('obscura');
    });
  });

  describe('Spike Verify Gate — evaluateGateConditions', () => {
    it('[P0] passes when all criteria are satisfied (no fatals, no leaks, 0 failures)', () => {
      const sampleRuns = [
        {
          backend: 'chrome',
          mode: 'pool-isolated-context',
          jobs: 4,
          isolation: { sharedContextLeak: true, isolatedContextLeak: false },
          metrics: { succeeded: 4, failed: 0, wallMs: 1200 },
        },
      ];

      const res = evaluateGateConditions(sampleRuns);
      expect(res.pass).toBe(true);
      expect(res.reasons).toHaveLength(0);
    });

    it('[P0] fails when a run encountered a fatal error', () => {
      const sampleRuns = [
        {
          backend: 'chrome',
          mode: 'pool-isolated-context',
          jobs: 4,
          fatal: 'Connection closed unexpectedly',
        },
      ];

      const res = evaluateGateConditions(sampleRuns);
      expect(res.pass).toBe(false);
      expect(res.reasons[0]).toContain('encountered fatal error');
    });

    it('[P0] fails when isolated context leaked state (isolatedContextLeak === true)', () => {
      const sampleRuns = [
        {
          backend: 'chrome',
          mode: 'pool-isolated-context',
          jobs: 4,
          isolation: { isolatedContextLeak: true },
          metrics: { succeeded: 4, failed: 0 },
        },
      ];

      const res = evaluateGateConditions(sampleRuns);
      expect(res.pass).toBe(false);
      expect(res.reasons[0]).toContain('isolatedContextLeak is true');
    });

    it('[P0] fails when one or more jobs failed in gate mode', () => {
      const sampleRuns = [
        {
          backend: 'chrome',
          mode: 'pool-isolated-context',
          jobs: 4,
          isolation: { isolatedContextLeak: false },
          metrics: { succeeded: 3, failed: 1 },
        },
      ];

      const res = evaluateGateConditions(sampleRuns);
      expect(res.pass).toBe(false);
      expect(res.reasons[0]).toContain('had 1 failed jobs out of 4');
    });

    it('[P1] fails when isolation probe returned an error object', () => {
      const res = evaluateGateConditions([
        { backend: 'chrome', mode: 'pool-isolated-context', jobs: 4,
          isolation: { error: 'Navigation timeout' },
          metrics: { succeeded: 4, failed: 0 } },
      ]);
      expect(res.pass).toBe(false);
      expect(res.reasons[0]).toContain('isolation probe failed');
    });

    it('[P1] fails when isolatedContextLeak is undefined (not explicitly false)', () => {
      const res = evaluateGateConditions([
        { backend: 'chrome', mode: 'pool-isolated-context', jobs: 4,
          isolation: {},
          metrics: { succeeded: 4, failed: 0 } },
      ]);
      expect(res.pass).toBe(false);
      expect(res.reasons[0]).toContain('expected false');
    });

    it('[P1] fails when run has no metrics field (malformed)', () => {
      const res = evaluateGateConditions([
        { backend: 'chrome', mode: 'pool-isolated-context', jobs: 4 },
      ]);
      expect(res.pass).toBe(false);
      expect(res.reasons[0]).toContain('no metrics');
    });

    it('[P1] fails when runs array is empty', () => {
      const res = evaluateGateConditions([]);
      expect(res.pass).toBe(false);
      expect(res.reasons[0]).toContain('No runs were executed');
    });
  });
});
