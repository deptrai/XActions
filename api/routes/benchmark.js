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

/**
 * Factory function to create benchmark router with dependency injection for testing.
 * @param {Object} [deps]
 * @param {import('@prisma/client').PrismaClient} [deps.prisma]
 * @param {import('../../src/benchmark/health-tier-cache.js').HealthTierCache} [deps.healthTierCache]
 * @param {import('../services/benchmark/alerting.js').AlertDispatcher} [deps.alertDispatcher]
 * @param {import('../services/benchmark/requalification.js').RequalificationService} [deps.requalificationService]
 * @returns {Router}
 */
export function createBenchmarkRouter(deps = {}) {
  const router = Router();
  const prisma = deps.prisma || prismaClient;
  const healthTierCache = deps.healthTierCache || defaultHealthTierCache;
  const alertDispatcher = deps.alertDispatcher || defaultAlertDispatcher;
  const requalificationService = deps.requalificationService || defaultRequalificationService;

  /**
   * GET /summary
   * Aggregate summary of all monitored scrapers, tier counts, and average system health score.
   */
  router.get('/summary', async (req, res) => {
    try {
      const records = await prisma.scraperHealthScore.findMany({
        distinct: ['scraperId'],
        orderBy: { evaluatedAt: 'desc' },
      });

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
      res.status(500).json({ error: 'Failed to retrieve benchmark summary', message: err.message });
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
      const detail = await prisma.scraperHealthScore.findFirst({
        where: { scraperId: id },
        orderBy: { evaluatedAt: 'desc' },
      });

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
      res.status(500).json({ error: 'Failed to retrieve scraper detail', message: err.message });
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
      const history = await prisma.scraperHealthScore.findMany({
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
      });

      res.json({
        scraperId: id,
        history: history.reverse(), // Chronological order for charts
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to retrieve scraper history', message: err.message });
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
      res.status(500).json({ error: 'Failed to retrieve benchmark alerts', message: err.message });
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
      res.status(500).json({ error: 'Failed to evaluate scraper re-qualification', message: err.message });
    }
  });

  return router;
}

export default createBenchmarkRouter();
