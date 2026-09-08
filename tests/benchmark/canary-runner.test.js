// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 34.7: Synthetic Canary Probe Scheduler Unit & Integration Tests.
 * Tests hourly canary probe execution, dedicated probe account isolation (AD-35),
 * False-200 and Checkpoint detection, telemetry emission (AD-33), and database persistence.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CanaryRunner } from '../../api/services/benchmark/canary-runner.js';
import { AccountPool } from '../../src/core/account-pool.js';

describe('Story 34.7: CanaryRunner Synthetic Probe Tests', () => {
  let mockPrisma;
  let mockTelemetryEmitter;
  let accountPool;

  beforeEach(() => {
    mockPrisma = {
      scraperCanaryRun: {
        create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'cuid_123', ...data })),
      },
    };

    mockTelemetryEmitter = {
      emitRun: vi.fn().mockReturnValue(true),
    };

    accountPool = new AccountPool();
  });

  describe('AD-35: Dedicated Probe Account Isolation & Fallback Guard', () => {
    it('fails probe and logs error when auth is required but no probe account exists', async () => {
      // Register only standard/production accounts (probe is false or omitted)
      accountPool.registerAccounts('twitter', ['prod_user_001', 'prod_user_002'], {
        credentials: {
          prod_user_001: { authToken: 'token_123' },
          prod_user_002: { authToken: 'token_456' },
        },
      });

      const runner = new CanaryRunner({
        prisma: mockPrisma,
        telemetryEmitter: mockTelemetryEmitter,
        accountPool,
      });

      const res = await runner.probe('twitter-hybrid');

      expect(res.isSuccess).toBe(false);
      expect(res.errorReason).toContain('Dedicated probe account unavailable (AD-35)');
      expect(res.httpStatus).toBe(401);

      // Verify failure persisted to ScraperCanaryRun
      expect(mockPrisma.scraperCanaryRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          scraperId: 'twitter-hybrid',
          isSuccess: false,
          errorReason: expect.stringContaining('AD-35'),
        }),
      });

      // Verify failure telemetry emitted with isCanary: true
      expect(mockTelemetryEmitter.emitRun).toHaveBeenCalledWith(
        expect.objectContaining({
          scraperId: 'twitter-hybrid',
          source: 'canary',
          isCanary: true,
          success: false,
        })
      );
    });

    it('proceeds with probe when a dedicated probe account is available in AccountPool', async () => {
      // Register dedicated probe account
      accountPool.registerAccounts('twitter', ['probe-twitter-001'], {
        credentials: {
          'probe-twitter-001': { probe: true, authToken: 'probe_token_999' },
        },
      });

      const mockFetch = vi.fn().mockResolvedValueOnce({
        status: 200,
        text: () => Promise.resolve('{"data":{"user":{"result":{"timeline":{}}}}}'),
      });

      const runner = new CanaryRunner({
        prisma: mockPrisma,
        telemetryEmitter: mockTelemetryEmitter,
        accountPool,
        fetchSeam: mockFetch,
      });

      const res = await runner.probe('twitter-hybrid');

      expect(mockFetch).toHaveBeenCalled();
      expect(res.scraperId).toBe('twitter-hybrid');
      expect(res.httpStatus).toBe(200);
      expect(res.isSuccess).toBe(true);
      expect(res.false200Detected).toBe(false);
      expect(res.checkpointDetected).toBe(false);
    });
  });

  describe('False-200 and Checkpoint Detection during Canary Probes', () => {
    it('detects Cloudflare False-200 challenge on HTTP 200 and marks isSuccess: false', async () => {
      const cloudflareHtml = `
        <!DOCTYPE html>
        <html><head><title>Just a moment...</title></head>
        <body>
          <div id="cf-browser-verification">Checking your browser before accessing...</div>
        </body></html>
      `;

      const mockFetch = vi.fn().mockResolvedValueOnce({
        status: 200,
        text: () => Promise.resolve(cloudflareHtml),
      });

      const runner = new CanaryRunner({
        prisma: mockPrisma,
        telemetryEmitter: mockTelemetryEmitter,
        fetchSeam: mockFetch,
      });

      const res = await runner.probe('shopee-hybrid');

      expect(res.isSuccess).toBe(false);
      expect(res.httpStatus).toBe(200);
      expect(res.false200Detected).toBe(true);
      expect(res.errorReason).toContain('False 200');

      // Check ScraperCanaryRun schema recording
      expect(mockPrisma.scraperCanaryRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          scraperId: 'shopee-hybrid',
          false200Detected: true,
          isSuccess: false,
        }),
      });
    });

    it('detects login wall checkpoint on PasGo F&B and marks checkpointDetected: true', async () => {
      const loginWallHtml = `
        <!DOCTYPE html>
        <html><body>
          <form id="login">
            <h2>Đăng nhập để tiếp tục</h2>
            <input type="password" name="pwd" />
          </form>
        </body></html>
      `;

      const mockFetch = vi.fn().mockResolvedValueOnce({
        status: 200,
        text: () => Promise.resolve(loginWallHtml),
      });

      const runner = new CanaryRunner({
        prisma: mockPrisma,
        telemetryEmitter: mockTelemetryEmitter,
        fetchSeam: mockFetch,
      });

      const res = await runner.probe('pasgo-merchant');

      expect(res.isSuccess).toBe(false);
      expect(res.checkpointDetected).toBe(true);
      expect(res.errorReason).toContain('Checkpoint or login wall');

      expect(mockPrisma.scraperCanaryRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          scraperId: 'pasgo-merchant',
          checkpointDetected: true,
          isSuccess: false,
        }),
      });
    });
  });

  describe('Timeout and Transport Failure Handling', () => {
    it('handles probe timeout gracefully with HTTP 504 and isSuccess: false', async () => {
      const mockFetch = vi.fn().mockImplementation(() => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        return Promise.reject(error);
      });

      const runner = new CanaryRunner({
        prisma: mockPrisma,
        telemetryEmitter: mockTelemetryEmitter,
        fetchSeam: mockFetch,
        timeoutMs: 100, // short timeout for test
      });

      const res = await runner.probe('masothue');

      expect(res.isSuccess).toBe(false);
      expect(res.httpStatus).toBe(504);
      expect(res.errorReason).toContain('timed out');

      expect(mockPrisma.scraperCanaryRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          scraperId: 'masothue',
          httpStatus: 504,
          isSuccess: false,
        }),
      });
    });

    it('handles network connection error gracefully with HTTP 502', async () => {
      const mockFetch = vi.fn().mockRejectedValueOnce(new Error('ECONNREFUSED 127.0.0.1:443'));

      const runner = new CanaryRunner({
        prisma: mockPrisma,
        telemetryEmitter: mockTelemetryEmitter,
        fetchSeam: mockFetch,
      });

      const res = await runner.probe('youtube-crawler');

      expect(res.isSuccess).toBe(false);
      expect(res.httpStatus).toBe(502);
      expect(res.errorReason).toContain('ECONNREFUSED');
    });

    it('returns error when scraperId is not recognized in canary configuration', async () => {
      const runner = new CanaryRunner({
        prisma: mockPrisma,
        telemetryEmitter: mockTelemetryEmitter,
      });

      const res = await runner.probe('non-existent-scraper');

      expect(res.isSuccess).toBe(false);
      expect(res.errorReason).toContain('not found in canary configuration');
    });
  });

  describe('probeAll and Scheduler Execution', () => {
    it('runs probeAll across all configured scrapers and returns aggregate counts', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        text: () => Promise.resolve('{"data":{"items":[{"id":"1"}]}}'),
      });

      // Register probe accounts for auth-required scrapers
      accountPool.registerAccounts('twitter', ['probe-twitter-001'], {
        credentials: { 'probe-twitter-001': { probe: true } },
      });
      accountPool.registerAccounts('facebook', ['probe-facebook-001'], {
        credentials: { 'probe-facebook-001': { probe: true } },
      });
      accountPool.registerAccounts('zalo', ['probe-zalo-001'], {
        credentials: { 'probe-zalo-001': { probe: true } },
      });

      const runner = new CanaryRunner({
        prisma: mockPrisma,
        telemetryEmitter: mockTelemetryEmitter,
        accountPool,
        fetchSeam: mockFetch,
      });

      const summary = await runner.probeAll();

      expect(summary.total).toBeGreaterThan(0);
      expect(summary.succeeded + summary.failed).toBe(summary.total);
      expect(Array.isArray(summary.results)).toBe(true);
      expect(summary.results.length).toBe(summary.total);
    });

    it('prevents overlapping probeAll executions using mutex flag', async () => {
      const slowFetch = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ status: 200, text: () => Promise.resolve('ok') }), 50))
      );
      const runner = new CanaryRunner({
        prisma: mockPrisma,
        telemetryEmitter: mockTelemetryEmitter,
        fetchSeam: slowFetch,
      });

      // Start slow probeAll
      const p1 = runner.probeAll();
      // Immediate second call should be skipped
      const p2 = await runner.probeAll();

      expect(p2.skipped).toBe(true);
      await p1;
    });

    it('starts and stops cron scheduler without error', () => {
      const runner = new CanaryRunner({
        prisma: mockPrisma,
        telemetryEmitter: mockTelemetryEmitter,
      });

      expect(() => runner.startScheduler('0 * * * *')).not.toThrow();
      expect(() => runner.stopScheduler()).not.toThrow();
    });
  });
});
