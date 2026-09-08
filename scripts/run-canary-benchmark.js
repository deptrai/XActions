// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Run synthetic canary probes and calculate live benchmark scores.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { CanaryRunner } from '../api/services/benchmark/canary-runner.js';
import { BenchmarkScoringEngine } from '../src/benchmark/scoring-engine.js';
import { BenchmarkStateManager } from '../src/benchmark/state-manager.js';
import { defaultHealthTierCache } from '../src/benchmark/health-tier-cache.js';
import { CANARY_CONFIGS } from '../src/benchmark/canary-config.js';
import prisma from '../api/lib/prisma.js';

async function main() {
  console.log('🚀 [CANARY BENCHMARK] Starting live canary probe evaluation...');

  const runner = new CanaryRunner({ prisma, timeoutMs: 15000 });
  const scoringEngine = new BenchmarkScoringEngine();
  const stateManager = new BenchmarkStateManager({ prisma, healthTierCache: defaultHealthTierCache });

  await defaultHealthTierCache.warmup({ prisma });

  const scraperIds = Object.keys(CANARY_CONFIGS);
  console.log(`📋 Probing ${scraperIds.length} scrapers: ${scraperIds.join(', ')}\n`);

  const results = [];

  for (const scraperId of scraperIds) {
    const config = CANARY_CONFIGS[scraperId];
    process.stdout.write(`⏳ Probing ${scraperId} (${config.targetUrl})... `);

    try {
      const probeResult = await runner.probe(scraperId, { timeoutMs: 15000 });
      const statusIcon = probeResult.isSuccess ? '✅ PASS' : '⚠️ FAIL';
      console.log(`${statusIcon} (${probeResult.latencyMs}ms, HTTP ${probeResult.httpStatus})`);
      if (probeResult.errorReason) {
        console.log(`   Reason: ${probeResult.errorReason}`);
      }

      // Convert probe result into telemetry run format
      const telemetryRun = {
        scraperId,
        platform: config.platform,
        isSuccess: probeResult.isSuccess,
        avgLatencyMs: probeResult.latencyMs || 500,
        requestCount: 1,
        failedRequestCount: probeResult.isSuccess ? 0 : 1,
        false200Count: probeResult.false200Detected ? 1 : 0,
        checkpointCount: probeResult.checkpointDetected ? 1 : 0,
        itemCount: probeResult.isSuccess ? 10 : 0,
        storeMetrics: probeResult.isSuccess
          ? { schemaValid: true, fillRate: 0.96 }
          : { schemaValid: false, fillRate: 0.5 },
        category: config.category || 'social',
      };

      // Score this run using calculateScores
      const rollups = scoringEngine.aggregateTelemetryRollups([telemetryRun]);
      const score = scoringEngine.calculateScores(rollups, config.category || 'social');

      // Persist scorecard evaluation
      await stateManager.recordEvaluation(scraperId, score, {
        platform: config.platform,
        category: config.category || 'social',
        sampleCount: 1,
        runs: [telemetryRun],
      });

      results.push({
        scraperId,
        platform: config.platform,
        tier: score.tier,
        healthScore: score.healthScore,
        isSuccess: probeResult.isSuccess ? 'YES' : 'NO',
        latencyMs: probeResult.latencyMs,
        knockout: score.knockoutTriggered ? score.knockoutReasons[0] : 'None',
      });
    } catch (err) {
      console.log(`❌ ERROR: ${err.message}`);
    }
  }

  console.log('\n📊 ═══════════════════════════════════════════════════════════════');
  console.log('   LIVE CANARY BENCHMARK EVALUATION SCORECARD');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.table(results);
  console.log('═══════════════════════════════════════════════════════════════════');

  const tierCounts = results.reduce((acc, r) => {
    acc[r.tier] = (acc[r.tier] || 0) + 1;
    return acc;
  }, {});

  console.log(`\n🏆 Tier Summary: Tier A: ${tierCounts['A'] || 0} | Tier B: ${tierCounts['B'] || 0} | Tier C: ${tierCounts['C'] || 0}`);
  console.log('✅ Benchmark run complete!\n');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Fatal error in canary runner:', err);
  process.exit(1);
});
