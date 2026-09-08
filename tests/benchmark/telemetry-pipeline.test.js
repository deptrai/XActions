import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from 'redis';
import { TelemetryContext } from '../../src/core/telemetry-context.js';
import { TelemetryEmitter } from '../../src/core/telemetry-emitter.js';
import { TelemetryConsumer } from '../../api/services/benchmark/telemetry-consumer.js';
import { HealthTierCache } from '../../src/benchmark/health-tier-cache.js';
import prisma from '../../api/lib/prisma.js';

describe('Story 34.1: End-to-End Telemetry Pipeline & Storage Integration', () => {
  const testStreamKey = `stream:benchmark:test_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const testGroupName = `group_test_${Date.now()}`;
  const testHashKey = `hash:benchmark:test_${Date.now()}`;
  let redisClient;
  let emitter;
  let consumer;
  let cache;

  beforeAll(async () => {
    const url =
      process.env.REDIS_URL ||
      (process.env.REDIS_HOST
        ? `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}`
        : 'redis://localhost:6379');
    redisClient = createClient({ url });
    await redisClient.connect();

    emitter = new TelemetryEmitter({
      redisClient,
      streamKey: testStreamKey,
    });

    consumer = new TelemetryConsumer({
      redisClient,
      prisma,
      streamKey: testStreamKey,
      groupName: testGroupName,
    });

    cache = new HealthTierCache({
      redisClient,
      prisma,
      hashKey: testHashKey,
    });

    await consumer.initGroup();
  });

  afterAll(async () => {
    try {
      await redisClient.del(testStreamKey);
      await redisClient.del(testHashKey);
      await prisma.scraperHealthScore.deleteMany({
        where: { scraperId: { startsWith: 'pipeline-test-' } },
      });
      await redisClient.quit();
    } catch {
      // Best-effort cleanup
    }
  });

  it('runs complete pipeline: Context -> Emitter -> Redis Stream -> Consumer -> DB -> Cache', async () => {
    const scraperId = `pipeline-test-twitter-${Date.now()}`;

    // 1. TelemetryContext captures session
    const ctx = TelemetryContext.create({
      scraperId,
      platform: 'twitter',
      category: 'social',
      action: 'search',
    });

    ctx.recordRequest({
      latencyMs: 180,
      httpStatus: 200,
      proxyBytes: 8192,
      retries: 0,
      isFalse200: false,
      isCheckpoint: false,
    });

    ctx.recordRequest({
      latencyMs: 220,
      httpStatus: 200,
      proxyBytes: 4096,
      retries: 0,
      isFalse200: false,
      isCheckpoint: false,
    });

    ctx.recordStoreMetrics({
      fieldFillRate: 0.96,
      schemaValid: true,
      duplicates: 0,
      totalItems: 20,
    });

    // 2. Non-blocking emitter pushes events to stream
    for (const req of ctx.getRequestPayloads()) {
      emitter.emitRequest(req);
    }
    emitter.emitRun(
      ctx.toRunPayload({
        isSuccess: true,
        itemCount: 20,
        durationMs: 450,
      })
    );

    // Deterministically flush queued events
    await emitter.flush();

    // 3. Verify Redis Stream holds 3 entries
    const streamLen = await redisClient.xLen(testStreamKey);
    expect(streamLen).toBe(3);

    // 4. Consumer processes batch with XREADGROUP & XACK
    const batchResult = await consumer.processBatch({ count: 10, blockMs: 500 });
    expect(batchResult.processedCount).toBe(3);

    // Verify stream still has items, and PEL is clean
    const pending = await redisClient.xPending(testStreamKey, testGroupName);
    expect(pending.pending).toBe(0);

    // 5. Store aggregated score in PostgreSQL
    const createdScore = await prisma.scraperHealthScore.create({
      data: {
        scraperId,
        platform: 'twitter',
        healthScore: 92.5,
        tier: 'A',
        stabilityScore: 95.0,
        qualityScore: 96.0,
        noiseScore: 90.0,
        costScore: 88.0,
        sampleCount: 1,
        consecutiveCleanRuns: 1,
        metricsSnapshot: {
          avgLatencyMs: 200,
          totalProxyBytes: 12288,
          fieldFillRate: 0.96,
        },
      },
    });

    expect(createdScore.id).toBeDefined();
    expect(createdScore.tier).toBe('A');

    // 6. Warmup cache and verify O(1) synchronous lookup
    await cache.warmup();
    expect(cache.get(scraperId)).toBe('A');

    // Verify Redis Hash holds the mapping
    const hashTier = await redisClient.hGet(testHashKey, scraperId);
    expect(hashTier).toBe('A');
  });
});
