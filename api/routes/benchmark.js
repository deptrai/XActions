// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Benchmark API Router — REST endpoints for Scraper Health Scorecard & History (AD-32).
 * Provides /api/benchmark/summary, /api/benchmark/scrapers/:id, /api/benchmark/history/:id.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { Router } from 'express';
import prismaClient from '../lib/prisma.js';
import { defaultHealthTierCache } from '../../src/benchmark/health-tier-cache.js';
import { defaultAlertDispatcher } from '../services/benchmark/alerting.js';
import { defaultRequalificationService } from '../services/benchmark/requalification.js';
import { defaultCanaryRunner } from '../services/benchmark/canary-runner.js';
import { BenchmarkScoringEngine } from '../../src/benchmark/scoring-engine.js';
import { BenchmarkStateManager } from '../../src/benchmark/state-manager.js';
import { CANARY_CONFIGS } from '../../src/benchmark/canary-config.js';
import { ensureBenchmarkTables } from '../../src/benchmark/ensure-tables.js';

/**
 * Factory function to create benchmark router with dependency injection for testing.
 * @param {Object} [deps]
 * @param {import('@prisma/client').PrismaClient} [deps.prisma]
 * @param {import('../../src/benchmark/health-tier-cache.js').HealthTierCache} [deps.healthTierCache]
 * @param {import('../services/benchmark/alerting.js').AlertDispatcher} [deps.alertDispatcher]
 * @param {import('../services/benchmark/requalification.js').RequalificationService} [deps.requalificationService]
 * @param {import('../services/benchmark/canary-runner.js').CanaryRunner} [deps.canaryRunner]
 * @returns {import('express').Router}
 */
export function createBenchmarkRouter(deps = {}) {
  const router = Router();
  const prisma = deps.prisma || prismaClient;
  const healthTierCache = deps.healthTierCache || defaultHealthTierCache;
  const alertDispatcher = deps.alertDispatcher || defaultAlertDispatcher;
  const requalificationService = deps.requalificationService || defaultRequalificationService;
  const canaryRunner = deps.canaryRunner || defaultCanaryRunner;

  /**
   * Helper to execute Prisma queries with automatic table initialization on missing table errors.
   * @param {() => Promise<unknown>} queryFn
   * @returns {Promise<unknown>}
   */
  const safeQuery = async (queryFn) => {
    try {
      return await queryFn();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const errRecord = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (err));
      if (
        (errRecord?.code === 'P2021' || errMsg.includes('table `public.ScraperHealthScore` does not exist')) &&
        typeof prisma.$executeRawUnsafe === 'function'
      ) {
        await ensureBenchmarkTables(prisma);
        try {
          return await queryFn();
        } catch {
          return null;
        }
      }
      throw err;
    }
  };

  /**
   * GET /summary
   * Aggregate summary of all monitored scrapers, tier counts, and average system health score.
   */
  router.get('/summary', async (req, res) => {
    try {
      const rawRecords = await safeQuery(() =>
        prisma.scraperHealthScore.findMany({
          distinct: ['scraperId'],
          orderBy: { evaluatedAt: 'desc' },
        })
      );
      const records = /** @type {import('@prisma/client').ScraperHealthScore[]} */ (rawRecords || []);

      const counts = { total: 0, tierA: 0, tierB: 0, tierC: 0, unknown: 0 };
      let totalScoreSum = 0;

      const scrapers = records.map((r) => {
        const liveTier = healthTierCache.get(r.scraperId);
        const resolvedTier = (liveTier && liveTier !== 'UNKNOWN') ? liveTier : (r.tier || 'UNKNOWN');

        counts.total++;
        if (resolvedTier === 'A') counts.tierA++;
        else if (resolvedTier === 'B') counts.tierB++;
        else if (resolvedTier === 'C') counts.tierC++;
        else counts.unknown++;

        const score = typeof r.healthScore === 'number' ? r.healthScore : 0;
        totalScoreSum += score;

        return {
          id: r.id,
          scraperId: r.scraperId,
          platform: r.platform,
          healthScore: r.healthScore,
          tier: resolvedTier,
          stabilityScore: r.stabilityScore,
          qualityScore: r.qualityScore,
          noiseScore: r.noiseScore,
          costScore: r.costScore,
          sampleCount: r.sampleCount,
          consecutiveCleanRuns: r.consecutiveCleanRuns,
          requalifiedAt: r.requalifiedAt,
          evaluatedAt: r.evaluatedAt,
          isAlert: resolvedTier === 'C',
        };
      });

      const avgScore = counts.total > 0 ? Number((totalScoreSum / counts.total).toFixed(2)) : 0;

      res.json({
        scrapers,
        counts,
        avgScore,
        evaluatedAt: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to retrieve benchmark summary', message: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * GET /scrapers/:id
   * Detailed health scorecard, metricsSnapshot, and knockout diagnostics for a specific scraper.
   */
  router.get('/scrapers/:id', async (req, res) => {
    const { id } = req.params;
    if (!id || typeof id !== 'string' || id.length > 128) {
      return res.status(400).json({ error: 'Invalid scraper ID' });
    }
    try {
      const detail = /** @type {import('@prisma/client').ScraperHealthScore | null} */ (await safeQuery(() =>
        prisma.scraperHealthScore.findFirst({
          where: { scraperId: id },
          orderBy: { evaluatedAt: 'desc' },
        })
      ));

      if (!detail) {
        return res.status(404).json({ error: `Scraper "${id}" not found in benchmark registry` });
      }

      const liveTier = healthTierCache.get(id);
      const resolvedTier = (liveTier && liveTier !== 'UNKNOWN') ? liveTier : detail.tier;

      res.json({
        ...detail,
        tier: resolvedTier,
        isAlert: resolvedTier === 'C',
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to retrieve scraper detail', message: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * GET /history/:id
   * Time series history (last 30 evaluations) for a scraper.
   */
  router.get('/history/:id', async (req, res) => {
    const { id } = req.params;
    if (!id || typeof id !== 'string' || id.length > 128) {
      return res.status(400).json({ error: 'Invalid scraper ID' });
    }
    try {
      const rawHistory = /** @type {import('@prisma/client').ScraperHealthScore[]} */ (await safeQuery(() =>
        prisma.scraperHealthScore.findMany({
          where: { scraperId: id },
          orderBy: { evaluatedAt: 'desc' },
          take: 30,
          select: {
            id: true,
            healthScore: true,
            tier: true,
            stabilityScore: true,
            qualityScore: true,
            noiseScore: true,
            costScore: true,
            sampleCount: true,
            evaluatedAt: true,
          },
        })
      ));
      const history = rawHistory || [];

      res.json({
        scraperId: id,
        history: history.reverse(), // Chronological order for charts
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to retrieve scraper history', message: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * GET /alerts
   * Retrieve recent benchmark degradation alerts (Story 34.8 / AD-27).
   */
  router.get('/alerts', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit, 10) || 50;
      const alerts = alertDispatcher.getAlerts({ limit });
      res.json({
        alerts,
        total: alerts.length,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to retrieve benchmark alerts', message: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * POST /requalify/:id
   * Trigger evaluation of scraper for re-qualification from Tier C back to Tier B (AD-31).
   */
  router.post('/requalify/:id', async (req, res) => {
    const { id } = req.params;
    if (!id || typeof id !== 'string' || id.length > 128) {
      return res.status(400).json({ error: 'Invalid scraper ID' });
    }

    try {
      const result = await requalificationService.checkAndRequalify(id);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'Failed to evaluate scraper re-qualification', message: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * POST /probe-all
   * Trigger on-demand canary probes across all platforms asynchronously to avoid reverse proxy timeouts.
   */
  router.post('/probe-all', async (req, res) => {
    // Respond immediately to prevent reverse proxy HTTP timeouts
    res.json({
      ok: true,
      message: 'Canary probes dispatched in background',
      timestamp: new Date().toISOString(),
    });

    // Execute in background
    (async () => {
      try {
        const outcome = await canaryRunner.probeAll({ timeoutMs: 12000 });
        const scoringEngine = new BenchmarkScoringEngine();
        const stateManager = new BenchmarkStateManager({ prisma, healthTierCache });

        for (const run of outcome.results || []) {
          if (!run.scraperId) continue;
          const config = CANARY_CONFIGS[run.scraperId] || {};
          const telemetryRun = {
            scraperId: run.scraperId,
            platform: run.platform || config.platform || 'unknown',
            isSuccess: Boolean(run.isSuccess),
            avgLatencyMs: run.latencyMs || 500,
            requestCount: 1,
            failedRequestCount: run.isSuccess ? 0 : 1,
            false200Count: run.false200Detected ? 1 : 0,
            checkpointCount: run.checkpointDetected ? 1 : 0,
            itemCount: run.isSuccess ? 10 : 0,
            storeMetrics: run.isSuccess
              ? { schemaValid: true, fillRate: 0.95 }
              : { schemaValid: false, fillRate: 0.5 },
            category: config.category || 'social',
          };

          const rollups = scoringEngine.aggregateTelemetryRollups([telemetryRun]);
          const score = scoringEngine.calculateScores(rollups, config.category || 'social');

          await stateManager.recordEvaluation(run.scraperId, score, {
            platform: run.platform || config.platform,
            category: config.category || 'social',
            sampleCount: 1,
            runs: [telemetryRun],
          });
        }
      } catch (err) {
        console.warn('[Benchmark] Background probe execution notice:', err instanceof Error ? err.message : String(err));
      }
    })();
  });

  /**
   * GET /db-check
   * Diagnostic endpoint to verify benchmark table status in PostgreSQL.
   */
  router.get('/db-check', async (req, res) => {
    try {
      const ensured = await ensureBenchmarkTables(prisma);
      /** @type {unknown[]} */
      let tables = [];
      if (typeof prisma.$queryRawUnsafe === 'function') {
        tables = await prisma.$queryRawUnsafe(`
          SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'Scraper%'
        `);
      }
      let count = 0;
      if (prisma.scraperHealthScore?.count) {
        count = await prisma.scraperHealthScore.count();
      }
      res.json({ ok: true, ensured, tables, count });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
    }
  });

  /**
   * POST /probe-single/:id
   * Synchronously probe a single scraper and return detailed scorecard.
   */
  router.post('/probe-single/:id', async (req, res) => {
    const { id } = req.params;
    try {
      await ensureBenchmarkTables(prisma);
      const config = CANARY_CONFIGS[id];
      if (!config) {
        return res.status(404).json({ error: `Scraper "${id}" not found in CANARY_CONFIGS` });
      }

      const probeResult = await canaryRunner.probe(id, { timeoutMs: 15000 });
      const telemetryRun = {
        scraperId: id,
        platform: config.platform,
        isSuccess: Boolean(probeResult.isSuccess),
        avgLatencyMs: probeResult.latencyMs || 500,
        requestCount: 1,
        failedRequestCount: probeResult.isSuccess ? 0 : 1,
        false200Count: probeResult.false200Detected ? 1 : 0,
        checkpointCount: probeResult.checkpointDetected ? 1 : 0,
        itemCount: probeResult.isSuccess ? 10 : 0,
        storeMetrics: probeResult.isSuccess
          ? { schemaValid: true, fillRate: 0.95 }
          : { schemaValid: false, fillRate: 0.5 },
        category: config.category || 'social',
      };

      const scoringEngine = new BenchmarkScoringEngine();
      const stateManager = new BenchmarkStateManager({ prisma, healthTierCache });
      const rollups = scoringEngine.aggregateTelemetryRollups([telemetryRun]);
      const score = scoringEngine.calculateScores(rollups, config.category || 'social');

      const saved = await stateManager.recordEvaluation(id, score, {
        platform: config.platform,
        category: config.category || 'social',
        sampleCount: 1,
        runs: [telemetryRun],
      });

      res.json({
        ok: true,
        scraperId: id,
        probeResult,
        score,
        saved: Boolean(saved),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
    }
  });

  return router;
}

export default createBenchmarkRouter();
