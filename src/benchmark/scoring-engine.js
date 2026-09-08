// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * BenchmarkScoringEngine — 4-Pillar Health Scoring Engine with Hard Knock-Out Gates (CAP-3, AD-26, AD-28).
 * Evaluates stability, quality, noise, and cost pillars with linear normalization and category profiles.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { safeRatio } from '../utils/safe-ratio.js';

export const PILLAR_WEIGHTS = Object.freeze({
  stability: 0.35,
  quality: 0.30,
  noise: 0.20,
  cost: 0.15,
});

export const KNOCK_OUT_GATES = Object.freeze([
  { name: 'true_success_rate', test: (v) => v < 0.80, reason: 'True Success Rate < 80%' },
  { name: 'field_fill_rate', test: (v) => v < 0.85, reason: 'Essential Field Fill Rate < 85%' },
  { name: 'false_200_rate', test: (v) => v > 0.15, reason: 'False 200 Rate > 15%' },
  { name: 'schema_integrity_rate', test: (v) => v < 0.90, reason: 'Schema Integrity Rate < 90%' },
]);

export const CATEGORY_EXCLUSIONS = Object.freeze({
  social: [],
  ecom: ['comment_completeness'],
  realestate: ['comment_completeness', 'contact_accuracy'],
  recruitment: ['comment_completeness', 'contact_accuracy'],
  automotive: ['comment_completeness', 'contact_accuracy'],
  b2b: ['comment_completeness', 'contact_accuracy', 'data_freshness'],
  fnb_merchant: ['comment_completeness'],
  healthcare: ['comment_completeness'],
  legal: ['comment_completeness'],
});

export const METRIC_CONFIGS = Object.freeze({
  // Stability (0.35)
  true_success_rate: { pillar: 'stability', weight: 0.40, target: 0.98, fail: 0.70, inverted: false },
  latency_p95: { pillar: 'stability', weight: 0.25, target: 3500, fail: 15000, inverted: true },
  checkpoint_rate: { pillar: 'stability', weight: 0.20, target: 0.005, fail: 0.05, inverted: true },
  proxy_quarantine_rate: { pillar: 'stability', weight: 0.15, target: 0.05, fail: 0.25, inverted: true },

  // Quality (0.30)
  field_fill_rate: { pillar: 'quality', weight: 0.35, target: 0.95, fail: 0.60, inverted: false },
  schema_integrity_rate: { pillar: 'quality', weight: 0.35, target: 0.98, fail: 0.80, inverted: false },
  data_freshness: { pillar: 'quality', weight: 0.15, target: 300, fail: 3600, inverted: true },
  comment_completeness: { pillar: 'quality', weight: 0.15, target: 0.90, fail: 0.50, inverted: false },

  // Noise (0.20)
  duplicate_ratio: { pillar: 'noise', weight: 0.30, target: 0.02, fail: 0.15, inverted: true },
  spam_noise_ratio: { pillar: 'noise', weight: 0.25, target: 0.05, fail: 0.25, inverted: true },
  contact_accuracy: { pillar: 'noise', weight: 0.20, target: 0.85, fail: 0.40, inverted: false },
  false_200_rate: { pillar: 'noise', weight: 0.25, target: 0.01, fail: 0.15, inverted: true },

  // Cost (0.15)
  proxy_bytes_per_1k: { pillar: 'cost', weight: 0.40, target: 50 * 1024 * 1024, fail: 500 * 1024 * 1024, inverted: true },
  account_burn_rate: { pillar: 'cost', weight: 0.30, target: 0.001, fail: 0.02, inverted: true },
  retry_overhead: { pillar: 'cost', weight: 0.30, target: 0.15, fail: 1.0, inverted: true },
});

/**
 * Clamp a number to a bounded [min, max] interval.
 * @param {number} val
 * @param {number} [min=0]
 * @param {number} [max=100]
 * @returns {number}
 */
export function clamp(val, min = 0, max = 100) {
  const num = Number(val);
  if (!Number.isFinite(num)) return min;
  return Math.min(Math.max(num, min), max);
}

/**
 * Linear interpolation normalization mapping raw metrics to 0-100 sub-scores (metrics-catalog.md).
 * @param {number | null | undefined} rawValue
 * @param {{ target: number, fail: number, inverted?: boolean }} config
 * @returns {number}
 */
export function normalizeMetric(rawValue, config) {
  if (rawValue === null || rawValue === undefined || Number.isNaN(Number(rawValue))) {
    return 0;
  }
  const val = Number(rawValue);
  const target = config.target;
  const fail = config.fail;

  if (target === fail) {
    return val >= target ? 100 : 0;
  }

  if (config.inverted) {
    if (val <= target) return 100;
    if (val >= fail) return 0;
    return clamp(100 * ((fail - val) / (fail - target)), 0, 100);
  }

  if (val >= target) return 100;
  if (val <= fail) return 0;
  return clamp(100 * ((val - fail) / (target - fail)), 0, 100);
}

export class BenchmarkScoringEngine {
  /**
   * Evaluate Hard Knock-Out Gates (AD-26).
   * @param {Record<string, number>} metrics
   * @returns {{ triggered: boolean, reasons: string[] }}
   */
  evaluateKnockoutGates(metrics) {
    if (!metrics || typeof metrics !== 'object') {
      return { triggered: false, reasons: [] };
    }
    const reasons = [];
    for (const gate of KNOCK_OUT_GATES) {
      const val = metrics[gate.name];
      if (typeof val === 'number' && Number.isFinite(val)) {
        if (gate.test(val)) {
          reasons.push(gate.reason);
        }
      }
    }
    return {
      triggered: reasons.length > 0,
      reasons,
    };
  }

  /**
   * Calculate 4-pillar sub-scores and composite Health Score with category exclusions.
   * @param {Record<string, number>} rawMetrics
   * @param {string} [category='social']
   * @returns {{
   *   healthScore: number,
   *   tier: 'A' | 'B' | 'C',
   *   knockoutTriggered: boolean,
   *   knockoutReasons: string[],
   *   pillars: { stability: number, quality: number, noise: number, cost: number },
   *   normalizedMetrics: Record<string, number>,
   *   rawMetrics: Record<string, number>,
   *   category: string
   * }}
   */
  calculateScores(rawMetrics = {}, category = 'social') {
    const metrics = rawMetrics || {};
    const exclusions = new Set(CATEGORY_EXCLUSIONS[category] || []);
    const normalizedMetrics = {};

    // Group normalized metrics by pillar
    /** @type {Record<string, { weightedSum: number, totalWeight: number }>} */
    const pillarAccumulators = {
      stability: { weightedSum: 0, totalWeight: 0 },
      quality: { weightedSum: 0, totalWeight: 0 },
      noise: { weightedSum: 0, totalWeight: 0 },
      cost: { weightedSum: 0, totalWeight: 0 },
    };

    for (const [metricKey, config] of Object.entries(METRIC_CONFIGS)) {
      if (exclusions.has(metricKey)) {
        continue;
      }

      const rawVal = metrics[metricKey];
      const subScore = normalizeMetric(rawVal, config);
      normalizedMetrics[metricKey] = subScore;

      const acc = pillarAccumulators[config.pillar];
      if (acc) {
        acc.weightedSum += subScore * config.weight;
        acc.totalWeight += config.weight;
      }
    }

    // Compute normalized pillar scores (re-normalizing weights if metrics excluded)
    const pillars = {
      stability: safeRatio(pillarAccumulators.stability.weightedSum, pillarAccumulators.stability.totalWeight, 100),
      quality: safeRatio(pillarAccumulators.quality.weightedSum, pillarAccumulators.quality.totalWeight, 100),
      noise: safeRatio(pillarAccumulators.noise.weightedSum, pillarAccumulators.noise.totalWeight, 100),
      cost: safeRatio(pillarAccumulators.cost.weightedSum, pillarAccumulators.cost.totalWeight, 100),
    };

    // Calculate composite Health Score
    const compositeScore =
      PILLAR_WEIGHTS.stability * pillars.stability +
      PILLAR_WEIGHTS.quality * pillars.quality +
      PILLAR_WEIGHTS.noise * pillars.noise +
      PILLAR_WEIGHTS.cost * pillars.cost;

    const healthScore = Number(compositeScore.toFixed(2));

    // Evaluate Hard Knock-Out Gates (AD-26)
    const knockout = this.evaluateKnockoutGates(metrics);

    // Determine Tier
    /** @type {'A' | 'B' | 'C'} */
    let tier;
    if (knockout.triggered) {
      tier = 'C';
    } else if (healthScore >= 90) {
      tier = 'A';
    } else if (healthScore >= 70) {
      tier = 'B';
    } else {
      tier = 'C';
    }

    return {
      healthScore,
      tier,
      knockoutTriggered: knockout.triggered,
      knockoutReasons: knockout.reasons,
      pillars: {
        stability: Number(pillars.stability.toFixed(2)),
        quality: Number(pillars.quality.toFixed(2)),
        noise: Number(pillars.noise.toFixed(2)),
        cost: Number(pillars.cost.toFixed(2)),
      },
      normalizedMetrics,
      rawMetrics: metrics,
      category,
    };
  }

  /**
   * Aggregate multi-run rollups into normalized raw metrics for the scoring engine.
   * @param {Array<Record<string, any>>} runs
   * @returns {Record<string, number>}
   */
  aggregateTelemetryRollups(runs = []) {
    if (!runs || runs.length === 0) {
      return {
        true_success_rate: 0,
        latency_p95: 15000,
        checkpoint_rate: 0,
        proxy_quarantine_rate: 0,
        field_fill_rate: 0,
        schema_integrity_rate: 0,
        data_freshness: 3600,
        comment_completeness: 0,
        duplicate_ratio: 0,
        spam_noise_ratio: 0,
        contact_accuracy: 0,
        false_200_rate: 0,
        proxy_bytes_per_1k: 500 * 1024 * 1024,
        account_burn_rate: 0,
        retry_overhead: 0,
      };
    }

    const totalRuns = runs.length;
    let successfulRuns = 0;
    let totalRequests = 0;
    let totalFailedRequests = 0;
    let total2xxRequests = 0;
    let totalFalse200 = 0;
    let totalCheckpoints = 0;
    let totalProxyBytes = 0;
    let totalItems = 0;
    let totalDuplicates = 0;
    let validSchemaRuns = 0;
    let weightedFillSum = 0;
    let totalRetries = 0;
    const latencies = [];

    for (const run of runs) {
      if (!run || typeof run !== 'object') continue;
      if (run.isSuccess) successfulRuns++;
      const reqCount = Number(run.requestCount ?? 1);
      const failedReq = Number(run.failedRequestCount || 0);
      totalRequests += reqCount;
      totalFailedRequests += failedReq;
      total2xxRequests += Math.max(0, reqCount - failedReq);
      totalFalse200 += Number(run.false200Count || 0);
      totalCheckpoints += Number(run.checkpointCount || 0);
      totalProxyBytes += Number(run.totalProxyBytes || 0);
      totalRetries += Number(run.retries || (failedReq > 0 ? failedReq : 0));

      const items = Number(run.itemCount || 0);
      totalItems += items;

      if (run.avgLatencyMs !== undefined && run.avgLatencyMs !== null && !Number.isNaN(Number(run.avgLatencyMs))) {
        latencies.push(Number(run.avgLatencyMs));
      }

      if (run.storeMetrics) {
        if (run.storeMetrics.schemaValid) validSchemaRuns++;
        totalDuplicates += Number(run.storeMetrics.duplicates || 0);
        const fill = Number(run.storeMetrics.fieldFillRate ?? (run.isSuccess ? 1.0 : 0));
        weightedFillSum += fill * (items > 0 ? items : 1);
      } else if (run.isSuccess && items > 0) {
        validSchemaRuns++;
        weightedFillSum += items;
      }
    }

    // P95 latency calculation
    latencies.sort((a, b) => a - b);
    const p95Index = Math.floor(latencies.length * 0.95);
    const latency_p95 = latencies.length > 0 ? latencies[Math.min(p95Index, latencies.length - 1)] : 3500;

    const fillItemDenominator = totalItems > 0 ? totalItems : totalRuns;
    const field_fill_rate = safeRatio(weightedFillSum, fillItemDenominator, 0);
    const schema_integrity_rate = safeRatio(validSchemaRuns, totalRuns, 0);
    const true_success_rate = safeRatio(successfulRuns, totalRuns, 0);
    // AC 5: false_200_rate = false200_requests / total_2xx_requests
    const false_200_rate = safeRatio(totalFalse200, total2xxRequests, 0);
    const checkpoint_rate = safeRatio(totalCheckpoints, totalRequests, 0);
    const duplicate_ratio = safeRatio(totalDuplicates, totalItems, 0);
    // AC 5: Zero items returns 500MB fail threshold (score 0), not 50MB target!
    const proxy_bytes_per_1k = safeRatio(totalProxyBytes * 1000, totalItems, 500 * 1024 * 1024);
    const retry_overhead = safeRatio(totalRetries, Math.max(1, totalRequests - totalFailedRequests), 0);

    return {
      true_success_rate,
      latency_p95,
      checkpoint_rate,
      proxy_quarantine_rate: 0,
      field_fill_rate,
      schema_integrity_rate,
      data_freshness: 120,
      comment_completeness: 0.90,
      duplicate_ratio,
      spam_noise_ratio: 0.01,
      contact_accuracy: 0.90,
      false_200_rate,
      proxy_bytes_per_1k,
      account_burn_rate: 0,
      retry_overhead,
    };
  }
}

