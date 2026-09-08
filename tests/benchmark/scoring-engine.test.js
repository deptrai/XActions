// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, vi } from 'vitest';
import { safeRatio } from '../../src/utils/safe-ratio.js';
import {
  BenchmarkScoringEngine,
  clamp,
  normalizeMetric,
  PILLAR_WEIGHTS,
  KNOCK_OUT_GATES,
  CATEGORY_EXCLUSIONS,
  METRIC_CONFIGS,
} from '../../src/benchmark/scoring-engine.js';
import { BenchmarkStateManager } from '../../src/benchmark/state-manager.js';

describe('Story 34.4: Benchmark Scoring Engine Unit & Integration Tests', () => {
  describe('safeRatio Utility Tests (AC 1)', () => {
    it('returns standard division when denominator is non-zero', () => {
      expect(safeRatio(10, 2)).toBe(5);
      expect(safeRatio(0, 10)).toBe(0);
      expect(safeRatio(95, 100)).toBe(0.95);
    });

    it('returns fallback when denominator is 0, null, or undefined', () => {
      expect(safeRatio(10, 0, 1.0)).toBe(1.0);
      expect(safeRatio(10, 0, 0)).toBe(0);
      expect(safeRatio(10, null, 0.5)).toBe(0.5);
      expect(safeRatio(10, undefined, 1.0)).toBe(1.0);
      expect(safeRatio(10, NaN, 1.0)).toBe(1.0);
    });

    it('returns 0 when numerator is null, undefined, or NaN', () => {
      expect(safeRatio(null, 10)).toBe(0);
      expect(safeRatio(undefined, 10)).toBe(0);
      expect(safeRatio(NaN, 10)).toBe(0);
    });
  });

  describe('Core Normalization & Clamping Math (AC 1)', () => {
    it('clamps values strictly within [0, 100]', () => {
      expect(clamp(150, 0, 100)).toBe(100);
      expect(clamp(-25, 0, 100)).toBe(0);
      expect(clamp(85.5, 0, 100)).toBe(85.5);
    });

    it('normalizes standard positive metrics correctly', () => {
      const config = { target: 0.95, fail: 0.60, inverted: false };
      // Value at or above target gives 100
      expect(normalizeMetric(0.95, config)).toBe(100);
      expect(normalizeMetric(0.99, config)).toBe(100);

      // Value at or below fail gives 0
      expect(normalizeMetric(0.60, config)).toBe(0);
      expect(normalizeMetric(0.40, config)).toBe(0);

      // Midpoint: (0.775 - 0.60) / (0.95 - 0.60) = 0.175 / 0.35 = 0.5 -> 50
      expect(normalizeMetric(0.775, config)).toBeCloseTo(50, 1);
    });

    it('normalizes inverted metrics where lower is better', () => {
      const config = { target: 3500, fail: 15000, inverted: true };
      // Latency <= 3500ms gives 100
      expect(normalizeMetric(3500, config)).toBe(100);
      expect(normalizeMetric(1200, config)).toBe(100);

      // Latency >= 15000ms gives 0
      expect(normalizeMetric(15000, config)).toBe(0);
      expect(normalizeMetric(25000, config)).toBe(0);

      // Midpoint: (15000 - 9250) / (15000 - 3500) = 5750 / 11500 = 0.5 -> 50
      expect(normalizeMetric(9250, config)).toBeCloseTo(50, 1);
    });

    it('handles null, undefined or NaN values by returning 0', () => {
      const config = { target: 100, fail: 0, inverted: false };
      expect(normalizeMetric(null, config)).toBe(0);
      expect(normalizeMetric(undefined, config)).toBe(0);
      expect(normalizeMetric(NaN, config)).toBe(0);
    });
  });

  describe('4-Pillar Scoring & Category Denominator Re-normalization (AC 1, AC 3)', () => {
    const engine = new BenchmarkScoringEngine();

    it('computes 4 pillars and composite Health Score for perfect social scraper', () => {
      const perfectMetrics = {
        true_success_rate: 0.99,
        latency_p95: 2000,
        checkpoint_rate: 0.001,
        proxy_quarantine_rate: 0.01,
        field_fill_rate: 0.99,
        schema_integrity_rate: 0.99,
        data_freshness: 60,
        comment_completeness: 0.95,
        duplicate_ratio: 0.005,
        spam_noise_ratio: 0.01,
        contact_accuracy: 0.90,
        false_200_rate: 0.001,
        proxy_bytes_per_1k: 20 * 1024 * 1024,
        account_burn_rate: 0.0001,
        retry_overhead: 0.05,
      };

      const result = engine.calculateScores(perfectMetrics, 'social');
      expect(result.healthScore).toBeGreaterThanOrEqual(95);
      expect(result.tier).toBe('A');
      expect(result.knockoutTriggered).toBe(false);
      expect(result.pillars.stability).toBe(100);
      expect(result.pillars.quality).toBe(100);
      expect(result.pillars.noise).toBe(100);
      expect(result.pillars.cost).toBe(100);
    });

    it('excludes comment_completeness on ecommerce and re-normalizes quality pillar', () => {
      const ecomMetrics = {
        true_success_rate: 0.98,
        latency_p95: 3500,
        checkpoint_rate: 0.005,
        proxy_quarantine_rate: 0.05,
        field_fill_rate: 0.95,
        schema_integrity_rate: 0.98,
        data_freshness: 300,
        // comment_completeness missing or 0 - should be excluded
        comment_completeness: 0,
        duplicate_ratio: 0.02,
        spam_noise_ratio: 0.05,
        contact_accuracy: 0.85,
        false_200_rate: 0.01,
        proxy_bytes_per_1k: 50 * 1024 * 1024,
        account_burn_rate: 0.001,
        retry_overhead: 0.15,
      };

      const result = engine.calculateScores(ecomMetrics, 'ecom');
      // Should achieve 100 on Quality despite comment_completeness being 0
      expect(result.pillars.quality).toBe(100);
      expect(result.tier).toBe('A');
    });

    it('excludes comment_completeness, contact_accuracy, and data_freshness on b2b registry', () => {
      const b2bMetrics = {
        true_success_rate: 0.98,
        latency_p95: 3000,
        checkpoint_rate: 0,
        proxy_quarantine_rate: 0.01,
        field_fill_rate: 0.96,
        schema_integrity_rate: 0.99,
        // N/A fields set to 0
        comment_completeness: 0,
        contact_accuracy: 0,
        data_freshness: 999999,
        duplicate_ratio: 0.01,
        spam_noise_ratio: 0.01,
        false_200_rate: 0,
        proxy_bytes_per_1k: 30 * 1024 * 1024,
        account_burn_rate: 0,
        retry_overhead: 0.05,
      };

      const result = engine.calculateScores(b2bMetrics, 'b2b');
      expect(result.pillars.quality).toBe(100);
      expect(result.pillars.noise).toBe(100);
      expect(result.tier).toBe('A');
    });
  });

  describe('Non-Compensatory Hard Knock-Out Gates (AC 2, AD-26)', () => {
    const engine = new BenchmarkScoringEngine();

    it('forces Tier C when True Success Rate < 80% even with high composite score', () => {
      const failingSuccess = {
        true_success_rate: 0.75, // FAILS GATE (< 80%)
        latency_p95: 1000,
        checkpoint_rate: 0,
        proxy_quarantine_rate: 0,
        field_fill_rate: 1.0,
        schema_integrity_rate: 1.0,
        data_freshness: 10,
        comment_completeness: 1.0,
        duplicate_ratio: 0,
        spam_noise_ratio: 0,
        contact_accuracy: 1.0,
        false_200_rate: 0,
        proxy_bytes_per_1k: 1024 * 1024,
        account_burn_rate: 0,
        retry_overhead: 0,
      };

      const result = engine.calculateScores(failingSuccess, 'social');
      expect(result.knockoutTriggered).toBe(true);
      expect(result.knockoutReasons).toContain('True Success Rate < 80%');
      expect(result.tier).toBe('C');
    });

    it('forces Tier C when Essential Field Fill Rate < 85%', () => {
      const failingFieldFill = {
        true_success_rate: 0.99,
        latency_p95: 1500,
        checkpoint_rate: 0,
        proxy_quarantine_rate: 0,
        field_fill_rate: 0.80, // FAILS GATE (< 85%)
        schema_integrity_rate: 1.0,
        data_freshness: 60,
        comment_completeness: 0.95,
        duplicate_ratio: 0.01,
        spam_noise_ratio: 0.01,
        contact_accuracy: 0.90,
        false_200_rate: 0,
        proxy_bytes_per_1k: 20 * 1024 * 1024,
        account_burn_rate: 0,
        retry_overhead: 0.05,
      };

      const result = engine.calculateScores(failingFieldFill, 'social');
      expect(result.knockoutTriggered).toBe(true);
      expect(result.knockoutReasons).toContain('Essential Field Fill Rate < 85%');
      expect(result.tier).toBe('C');
    });

    it('forces Tier C when False 200 Rate > 15%', () => {
      const failingFalse200 = {
        true_success_rate: 0.90,
        latency_p95: 2000,
        checkpoint_rate: 0,
        proxy_quarantine_rate: 0,
        field_fill_rate: 0.95,
        schema_integrity_rate: 0.98,
        data_freshness: 60,
        comment_completeness: 0.95,
        duplicate_ratio: 0.01,
        spam_noise_ratio: 0.01,
        contact_accuracy: 0.90,
        false_200_rate: 0.20, // FAILS GATE (> 15%)
        proxy_bytes_per_1k: 20 * 1024 * 1024,
        account_burn_rate: 0,
        retry_overhead: 0.05,
      };

      const result = engine.calculateScores(failingFalse200, 'social');
      expect(result.knockoutTriggered).toBe(true);
      expect(result.knockoutReasons).toContain('False 200 Rate > 15%');
      expect(result.tier).toBe('C');
    });

    it('forces Tier C when Schema Integrity Rate < 90%', () => {
      const failingSchema = {
        true_success_rate: 0.95,
        latency_p95: 2000,
        checkpoint_rate: 0,
        proxy_quarantine_rate: 0,
        field_fill_rate: 0.95,
        schema_integrity_rate: 0.88, // FAILS GATE (< 90%)
        data_freshness: 60,
        comment_completeness: 0.95,
        duplicate_ratio: 0.01,
        spam_noise_ratio: 0.01,
        contact_accuracy: 0.90,
        false_200_rate: 0.01,
        proxy_bytes_per_1k: 20 * 1024 * 1024,
        account_burn_rate: 0,
        retry_overhead: 0.05,
      };

      const result = engine.calculateScores(failingSchema, 'social');
      expect(result.knockoutTriggered).toBe(true);
      expect(result.knockoutReasons).toContain('Schema Integrity Rate < 90%');
      expect(result.tier).toBe('C');
    });

    it('collects multiple knockout reasons if several gates trigger', () => {
      const multiFailure = {
        true_success_rate: 0.70,
        field_fill_rate: 0.60,
        false_200_rate: 0.25,
        schema_integrity_rate: 0.80,
      };

      const result = engine.calculateScores(multiFailure, 'social');
      expect(result.knockoutTriggered).toBe(true);
      expect(result.knockoutReasons.length).toBe(4);
      expect(result.tier).toBe('C');
    });

    it('assigns Tier B when score is in [70, 89] without knock-out trigger', () => {
      const degradedMetrics = {
        true_success_rate: 0.92, // Passes gate (>= 80%)
        latency_p95: 6000,
        checkpoint_rate: 0.015,
        proxy_quarantine_rate: 0.10,
        field_fill_rate: 0.90, // Passes gate (>= 85%)
        schema_integrity_rate: 0.94, // Passes gate (>= 90%)
        data_freshness: 800,
        comment_completeness: 0.80,
        duplicate_ratio: 0.04,
        spam_noise_ratio: 0.08,
        contact_accuracy: 0.75,
        false_200_rate: 0.04, // Passes gate (<= 15%)
        proxy_bytes_per_1k: 150 * 1024 * 1024,
        account_burn_rate: 0.003,
        retry_overhead: 0.25,
      };

      const result = engine.calculateScores(degradedMetrics, 'social');
      expect(result.knockoutTriggered).toBe(false);
      expect(result.healthScore).toBeGreaterThanOrEqual(70);
      expect(result.healthScore).toBeLessThan(90);
      expect(result.tier).toBe('B');
    });

    it('assigns Tier C when score is < 70 without any knock-out gate being triggered', () => {
      const lowScoreMetrics = {
        true_success_rate: 0.82, // Passes gate (>= 80%)
        latency_p95: 14000, // Very slow
        checkpoint_rate: 0.04,
        proxy_quarantine_rate: 0.22,
        field_fill_rate: 0.86, // Passes gate (>= 85%)
        schema_integrity_rate: 0.91, // Passes gate (>= 90%)
        data_freshness: 3200,
        comment_completeness: 0.55,
        duplicate_ratio: 0.14,
        spam_noise_ratio: 0.22,
        contact_accuracy: 0.45,
        false_200_rate: 0.12, // Passes gate (<= 15%)
        proxy_bytes_per_1k: 450 * 1024 * 1024,
        account_burn_rate: 0.018,
        retry_overhead: 0.90,
      };

      const result = engine.calculateScores(lowScoreMetrics, 'social');
      expect(result.knockoutTriggered).toBe(false);
      expect(result.healthScore).toBeLessThan(70);
      expect(result.tier).toBe('C');
    });
  });

  describe('BenchmarkStateManager & Re-qualification Epoch (AC 4, AD-31)', () => {
    it('filters out failures older than requalifiedAt epoch', () => {
      const stateManager = new BenchmarkStateManager();
      const requalifiedAt = new Date('2026-09-08T12:00:00Z');

      const events = [
        { runId: 'run-1', ts: '2026-09-08T10:00:00Z', isSuccess: false }, // Older than epoch
        { runId: 'run-2', ts: '2026-09-08T11:59:59Z', isSuccess: false }, // Older than epoch
        { runId: 'run-3', ts: '2026-09-08T12:05:00Z', isSuccess: true },  // After epoch
        { runId: 'run-4', ts: '2026-09-08T13:00:00Z', isSuccess: true },  // After epoch
      ];

      const filtered = stateManager.filterTelemetryByEpoch(events, requalifiedAt);
      expect(filtered.length).toBe(2);
      expect(filtered.map(e => e.runId)).toEqual(['run-3', 'run-4']);
    });

    it('records evaluation and persists state into PostgreSQL, Redis hash, and RAM cache', async () => {
      const mockPrisma = {
        scraperHealthScore: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'score-1', ...data })),
        },
      };

      const mockRedis = {
        hSet: vi.fn().mockResolvedValue(1),
      };

      const mockCache = {
        get: vi.fn().mockReturnValue('UNKNOWN'),
        set: vi.fn(),
      };

      const stateManager = new BenchmarkStateManager({
        prisma: mockPrisma,
        redisClient: mockRedis,
        healthTierCache: mockCache,
      });

      const scoringResult = {
        healthScore: 94.5,
        tier: 'A',
        knockoutTriggered: false,
        knockoutReasons: [],
        pillars: { stability: 95, quality: 94, noise: 96, cost: 92 },
        rawMetrics: { true_success_rate: 0.98 },
      };

      const persisted = await stateManager.recordEvaluation('twitter-hybrid', scoringResult, {
        category: 'social',
        evaluatedAt: new Date('2026-09-08T15:00:00Z'),
      });

      expect(persisted.scraperId).toBe('twitter-hybrid');
      expect(persisted.tier).toBe('A');
      expect(mockPrisma.scraperHealthScore.create).toHaveBeenCalled();

      // Contract Check: Assert all required non-nullable schema columns are passed to Prisma
      const createCall = mockPrisma.scraperHealthScore.create.mock.calls[0][0];
      expect(createCall.data).toHaveProperty('platform', 'twitter');
      expect(createCall.data).toHaveProperty('stabilityScore', 95);
      expect(createCall.data).toHaveProperty('qualityScore', 94);
      expect(createCall.data).toHaveProperty('noiseScore', 96);
      expect(createCall.data).toHaveProperty('costScore', 92);
      expect(createCall.data).toHaveProperty('sampleCount');
      expect(createCall.data).toHaveProperty('metricsSnapshot');

      expect(mockRedis.hSet).toHaveBeenCalledWith('hash:scraper:health_tier', { 'twitter-hybrid': 'A' });
      expect(mockCache.set).toHaveBeenCalledWith('twitter-hybrid', 'A');
    });

    it('enforces AD-31 State Machine: prevents promotion from Tier C until 5 clean runs', async () => {
      // Mock existing record in Tier C with 3 clean runs
      const mockPrisma = {
        scraperHealthScore: {
          findFirst: vi.fn().mockResolvedValue({ tier: 'C', consecutiveCleanRuns: 3, requalifiedAt: null }),
          create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'score-2', ...data })),
        },
      };

      const mockCache = {
        get: vi.fn().mockReturnValue('C'),
        set: vi.fn(),
      };

      const stateManager = new BenchmarkStateManager({
        prisma: mockPrisma,
        healthTierCache: mockCache,
      });

      const cleanScoringResult = {
        healthScore: 92.0,
        tier: 'A', // Proposed tier A
        knockoutTriggered: false,
        knockoutReasons: [],
        pillars: { stability: 92, quality: 92, noise: 92, cost: 92 },
      };

      // Run 4: consecutiveCleanRuns becomes 4 (< 5), tier remains C
      const eval4 = await stateManager.recordEvaluation('twitter-hybrid', cleanScoringResult);
      expect(eval4.tier).toBe('C');
      expect(eval4.consecutiveCleanRuns).toBe(4);
      expect(eval4.requalifiedAt).toBeNull();

      // Run 5: consecutiveCleanRuns becomes 5 (>= 5), tier promotes to B with requalifiedAt epoch
      mockPrisma.scraperHealthScore.findFirst.mockResolvedValueOnce({
        tier: 'C',
        consecutiveCleanRuns: 4,
        requalifiedAt: null,
      });

      const eval5 = await stateManager.recordEvaluation('twitter-hybrid', cleanScoringResult);
      expect(eval5.tier).toBe('B');
      expect(eval5.consecutiveCleanRuns).toBe(5);
      expect(eval5.requalifiedAt).toBeInstanceOf(Date);
    });
  });

  describe('24-Hour Synthetic Dataset Simulation (AC 5, AC 6)', () => {
    const engine = new BenchmarkScoringEngine();

    it('aggregates multi-run rollups into accurate benchmark scores under 500ms', () => {
      const startTime = performance.now();

      // Synthetic 24-hour run rollups for 5 platforms
      const platforms = [
        {
          scraperId: 'twitter-hybrid',
          category: 'social',
          runs: Array.from({ length: 24 }, () => ({
            isSuccess: true,
            requestCount: 10,
            failedRequestCount: 0,
            false200Count: 0,
            checkpointCount: 0,
            totalProxyBytes: 1024 * 1024,
            avgLatencyMs: 1800,
            itemCount: 20,
            storeMetrics: { fieldFillRate: 0.98, schemaValid: true, duplicates: 0 },
          })),
        },
        {
          scraperId: 'shopee-ecom',
          category: 'ecom',
          runs: Array.from({ length: 24 }, () => ({
            isSuccess: true,
            requestCount: 5,
            failedRequestCount: 0,
            false200Count: 0,
            checkpointCount: 0,
            totalProxyBytes: 2 * 1024 * 1024,
            avgLatencyMs: 2500,
            itemCount: 50,
            storeMetrics: { fieldFillRate: 0.96, schemaValid: true, duplicates: 1 },
          })),
        },
        {
          scraperId: 'masothue-procurement',
          category: 'b2b',
          runs: Array.from({ length: 24 }, () => ({
            isSuccess: true,
            requestCount: 2,
            failedRequestCount: 0,
            false200Count: 0,
            checkpointCount: 0,
            totalProxyBytes: 512 * 1024,
            avgLatencyMs: 2200,
            itemCount: 1,
            storeMetrics: { fieldFillRate: 0.99, schemaValid: true, duplicates: 0 },
          })),
        },
        {
          scraperId: 'degraded-scraper',
          category: 'social',
          runs: Array.from({ length: 24 }, () => ({
            isSuccess: true,
            requestCount: 8,
            failedRequestCount: 1,
            false200Count: 0,
            checkpointCount: 0,
            totalProxyBytes: 3 * 1024 * 1024,
            avgLatencyMs: 6000,
            itemCount: 10,
            storeMetrics: { fieldFillRate: 0.90, schemaValid: true, duplicates: 1 },
          })),
        },
        {
          scraperId: 'failing-scraper',
          category: 'social',
          runs: Array.from({ length: 24 }, (_, i) => ({
            isSuccess: i % 2 === 0, // 50% success rate -> triggers True Success < 80%
            requestCount: 5,
            failedRequestCount: 2,
            false200Count: 1,
            checkpointCount: 1,
            totalProxyBytes: 5 * 1024 * 1024,
            avgLatencyMs: 9000,
            itemCount: 5,
            storeMetrics: { fieldFillRate: 0.70, schemaValid: false, duplicates: 2 },
          })),
        },
      ];

      for (const p of platforms) {
        const aggregated = engine.aggregateTelemetryRollups(p.runs);
        const evaluation = engine.calculateScores(aggregated, p.category);

        if (p.scraperId === 'failing-scraper') {
          expect(evaluation.tier).toBe('C');
          expect(evaluation.knockoutTriggered).toBe(true);
        } else if (p.scraperId === 'degraded-scraper') {
          expect(evaluation.tier).toBe('B');
          expect(evaluation.knockoutTriggered).toBe(false);
          expect(evaluation.healthScore).toBeGreaterThanOrEqual(70);
          expect(evaluation.healthScore).toBeLessThan(90);
        } else {
          expect(evaluation.tier).toBe('A');
          expect(evaluation.knockoutTriggered).toBe(false);
          expect(evaluation.healthScore).toBeGreaterThanOrEqual(90);
        }
      }

      const elapsed = performance.now() - startTime;
      expect(elapsed).toBeLessThan(500); // NFR: under 500ms total
    });

    it('penalizes zero-item scrapes in aggregateTelemetryRollups with proxy_bytes_per_1k = 500MB (score 0)', () => {
      const zeroItemRuns = [
        {
          isSuccess: false,
          requestCount: 5,
          failedRequestCount: 5,
          false200Count: 0,
          checkpointCount: 0,
          totalProxyBytes: 10 * 1024 * 1024,
          avgLatencyMs: 4000,
          itemCount: 0,
          storeMetrics: null,
        },
      ];

      const aggregated = engine.aggregateTelemetryRollups(zeroItemRuns);
      expect(aggregated.proxy_bytes_per_1k).toBe(500 * 1024 * 1024);

      const evaluation = engine.calculateScores(aggregated, 'social');
      expect(evaluation.normalizedMetrics.proxy_bytes_per_1k).toBe(0);
      expect(evaluation.tier).toBe('C'); // Fails true success rate gate as well
    });
  });
});
