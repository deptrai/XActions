// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 34.8: Active Alerting & Re-qualification Workflow Unit & Integration Tests.
 * Tests outbound alert dispatch, 1-hour deduplication window, suppression flag,
 * 5-clean-run re-qualification state transitions (AD-31), CLI alerts command, and API endpoints.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Command } from 'commander';
import { AlertDispatcher } from '../../api/services/benchmark/alerting.js';
import { RequalificationService } from '../../api/services/benchmark/requalification.js';
import {
  registerBenchmarkCommand,
  formatAlertsTable,
} from '../../src/cli/commands/benchmark.js';
import { createBenchmarkRouter } from '../../api/routes/benchmark.js';

describe('Story 34.8: Active Alerting & Re-qualification Workflow', () => {
  let logSpy;
  let errorSpy;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('AlertDispatcher Unit Tests', () => {
    it('dispatches alert with structured payload and manual_review_required action', async () => {
      const dispatchedAlerts = [];
      const dispatcher = new AlertDispatcher({
        dispatchSeam: async (alert) => {
          dispatchedAlerts.push(alert);
        },
      });

      const outcome = await dispatcher.dispatchAlert({
        scraperId: 'pasgo-merchant',
        platform: 'fnb',
        previousTier: 'B',
        currentTier: 'C',
        healthScore: 62.1,
        reason: 'False 200 Rate > 15%',
      });

      expect(outcome.dispatched).toBe(true);
      expect(outcome.deduped).toBe(false);
      expect(dispatchedAlerts.length).toBe(1);

      const alert = dispatchedAlerts[0];
      expect(alert.alert_id).toBeDefined();
      expect(alert.scraper_id).toBe('pasgo-merchant');
      expect(alert.platform).toBe('fnb');
      expect(alert.previous_tier).toBe('B');
      expect(alert.current_tier).toBe('C');
      expect(alert.health_score).toBe(62.1);
      expect(alert.reason).toBe('False 200 Rate > 15%');
      expect(alert.action).toBe('manual_review_required');
    });

    it('enforces 1-hour deduplication window per scraper', async () => {
      const dispatchedAlerts = [];
      const dispatcher = new AlertDispatcher({
        dedupWindowMs: 3600000, // 1 hour
        dispatchSeam: async (alert) => {
          dispatchedAlerts.push(alert);
        },
      });

      // First alert
      const first = await dispatcher.dispatchAlert({
        scraperId: 'twitter-hybrid',
        platform: 'twitter',
        currentTier: 'C',
        healthScore: 55.0,
      });
      expect(first.dispatched).toBe(true);
      expect(first.deduped).toBe(false);

      // Immediate second alert for same scraper -> deduplicated
      const second = await dispatcher.dispatchAlert({
        scraperId: 'twitter-hybrid',
        platform: 'twitter',
        currentTier: 'C',
        healthScore: 50.0,
      });
      expect(second.dispatched).toBe(false);
      expect(second.deduped).toBe(true);
      expect(dispatchedAlerts.length).toBe(1); // Not dispatched twice
    });

    it('suppresses outbound dispatch when BENCHMARK_ALERTS=false but preserves in history', async () => {
      const origEnv = process.env.BENCHMARK_ALERTS;
      process.env.BENCHMARK_ALERTS = 'false';

      try {
        const dispatchedAlerts = [];
        const dispatcher = new AlertDispatcher({
          dispatchSeam: async (alert) => {
            dispatchedAlerts.push(alert);
          },
        });

        const outcome = await dispatcher.dispatchAlert({
          scraperId: 'shopee-hybrid',
          platform: 'shopee',
          currentTier: 'C',
          healthScore: 68.0,
        });

        expect(outcome.dispatched).toBe(false);
        expect(dispatchedAlerts.length).toBe(0);

        // Still recorded in alert history
        const history = dispatcher.getAlerts();
        expect(history.length).toBe(1);
        expect(history[0].scraper_id).toBe('shopee-hybrid');
      } finally {
        if (origEnv !== undefined) {
          process.env.BENCHMARK_ALERTS = origEnv;
        } else {
          delete process.env.BENCHMARK_ALERTS;
        }
      }
    });
  });

  describe('RequalificationService Unit Tests (AD-31)', () => {
    it('promotes Tier C scraper to Tier B after 5 consecutive clean canary runs', async () => {
      const mockPrisma = {
        scraperCanaryRun: {
          findMany: vi.fn().mockResolvedValue([
            { isSuccess: true, false200Detected: false, checkpointDetected: false },
            { isSuccess: true, false200Detected: false, checkpointDetected: false },
            { isSuccess: true, false200Detected: false, checkpointDetected: false },
            { isSuccess: true, false200Detected: false, checkpointDetected: false },
            { isSuccess: true, false200Detected: false, checkpointDetected: false },
          ]),
        },
        scraperHealthScore: {
          findFirst: vi.fn().mockResolvedValue({ id: 'score_1', tier: 'C' }),
          update: vi.fn().mockResolvedValue({ id: 'score_1', tier: 'B' }),
        },
      };

      const mockCache = {
        set: vi.fn(),
      };

      const service = new RequalificationService({
        prisma: mockPrisma,
        healthTierCache: mockCache,
      });

      const outcome = await service.checkAndRequalify('pasgo-merchant');

      expect(outcome.requalified).toBe(true);
      expect(outcome.promotedTo).toBe('B');
      expect(outcome.consecutiveCleanRuns).toBe(5);
      expect(outcome.requalifiedAt).toBeDefined();

      // In-memory cache updated
      expect(mockCache.set).toHaveBeenCalledWith('pasgo-merchant', 'B');

      // PostgreSQL record updated
      expect(mockPrisma.scraperHealthScore.update).toHaveBeenCalledWith({
        where: { id: 'score_1' },
        data: expect.objectContaining({
          tier: 'B',
          consecutiveCleanRuns: 5,
        }),
      });
    });

    it('rejects promotion when fewer than 5 consecutive clean runs exist', async () => {
      const mockPrisma = {
        scraperCanaryRun: {
          findMany: vi.fn().mockResolvedValue([
            { isSuccess: true, false200Detected: false, checkpointDetected: false },
            { isSuccess: true, false200Detected: false, checkpointDetected: false },
            { isSuccess: false, false200Detected: true, checkpointDetected: false }, // Failure breaks streak
            { isSuccess: true, false200Detected: false, checkpointDetected: false },
            { isSuccess: true, false200Detected: false, checkpointDetected: false },
          ]),
        },
      };

      const service = new RequalificationService({ prisma: mockPrisma });
      const outcome = await service.checkAndRequalify('shopee-hybrid');

      expect(outcome.requalified).toBe(false);
      expect(outcome.consecutiveCleanRuns).toBe(2);
      expect(outcome.reason).toContain('Requires 5 consecutive clean runs');
    });

    it('supports manual operator re-qualification override', async () => {
      const mockPrisma = {
        scraperHealthScore: {
          findFirst: vi.fn().mockResolvedValue({ id: 'score_2', tier: 'C' }),
          update: vi.fn().mockResolvedValue({ id: 'score_2', tier: 'B' }),
        },
      };

      const mockCache = { set: vi.fn() };
      const service = new RequalificationService({ prisma: mockPrisma, healthTierCache: mockCache });

      const res = await service.manualRequalify('twitter-hybrid', { operator: 'alice' });

      expect(res.requalified).toBe(true);
      expect(res.promotedTo).toBe('B');
      expect(res.manual).toBe(true);
      expect(res.operator).toBe('alice');
      expect(mockCache.set).toHaveBeenCalledWith('twitter-hybrid', 'B');
    });
  });

  describe('CLI xactions benchmark alerts Subcommand', () => {
    it('formats an ASCII table of recent alerts', () => {
      const alerts = [
        {
          scraper_id: 'pasgo-merchant',
          platform: 'fnb',
          previous_tier: 'B',
          current_tier: 'C',
          health_score: 62.1,
          reason: 'False 200 Rate > 15%',
          evaluated_at: '2026-09-08T10:00:00Z',
        },
      ];

      const table = formatAlertsTable(alerts);
      expect(table).toContain('pasgo-merchant');
      expect(table).toContain('fnb');
      expect(table).toContain('False 200 Rate > 15%');
    });

    it('returns a friendly message when no alerts exist', () => {
      const table = formatAlertsTable([]);
      expect(table).toContain('No active or recent benchmark alerts');
    });

    it('executes alerts subcommand and outputs JSON with --format json', async () => {
      const mockDispatcher = {
        getAlerts: vi.fn().mockReturnValue([
          {
            alert_id: '123',
            scraper_id: 'twitter-hybrid',
            current_tier: 'C',
            reason: 'Rate limit',
          },
        ]),
      };

      const program = new Command();
      registerBenchmarkCommand(program, { alertDispatcher: mockDispatcher });

      await program.parseAsync(['node', 'test', 'benchmark', 'alerts', '--format', 'json']);

      expect(logSpy).toHaveBeenCalled();
      const output = JSON.parse(logSpy.mock.calls[0][0]);
      expect(Array.isArray(output)).toBe(true);
      expect(output[0].scraper_id).toBe('twitter-hybrid');
    });
  });

  describe('REST API Alert & Requalification Endpoints', () => {
    let app;
    let mockAlertDispatcher;
    let mockRequalificationService;

    beforeEach(() => {
      mockAlertDispatcher = {
        getAlerts: vi.fn().mockReturnValue([
          { alert_id: 'a1', scraper_id: 'pasgo-merchant', current_tier: 'C' },
        ]),
      };

      mockRequalificationService = {
        checkAndRequalify: vi.fn().mockResolvedValue({
          requalified: true,
          scraperId: 'pasgo-merchant',
          promotedTo: 'B',
        }),
      };

      app = express();
      app.use(express.json());
      app.use(
        '/api/benchmark',
        createBenchmarkRouter({
          alertDispatcher: mockAlertDispatcher,
          requalificationService: mockRequalificationService,
        })
      );
    });

    it('GET /api/benchmark/alerts returns recent alerts array', async () => {
      const res = await request(app).get('/api/benchmark/alerts');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('alerts');
      expect(res.body.alerts.length).toBe(1);
      expect(res.body.alerts[0].scraper_id).toBe('pasgo-merchant');
    });

    it('POST /api/benchmark/requalify/:id triggers scraper evaluation', async () => {
      const res = await request(app).post('/api/benchmark/requalify/pasgo-merchant');
      expect(res.status).toBe(200);
      expect(res.body.requalified).toBe(true);
      expect(res.body.promotedTo).toBe('B');
      expect(mockRequalificationService.checkAndRequalify).toHaveBeenCalledWith('pasgo-merchant');
    });

    it('POST /api/benchmark/requalify/:id rejects invalid scraper IDs with 400', async () => {
      const longId = 'x'.repeat(129);
      const res = await request(app).post(`/api/benchmark/requalify/${longId}`);
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'Invalid scraper ID');
    });
  });
});
