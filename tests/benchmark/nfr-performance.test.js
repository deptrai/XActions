import { describe, it, expect, vi } from 'vitest';
import { AbstractCrawler } from '../../src/core/base-crawler.js';
import { TelemetryEmitter } from '../../src/core/telemetry-emitter.js';

class BenchmarkCrawler extends AbstractCrawler {
  constructor(deps = {}) {
    super({
      name: 'benchmark-platform',
      ...deps,
    });
    this.registerAction({
      action: 'simulate',
      category: 'social',
      requiresAuth: false,
      handler: async () => {
        // Fast deterministic computation
        let sum = 0;
        for (let j = 0; j < 5000; j++) {
          sum += j;
        }
        return { items: [1, 2, 3, 4, 5], sum };
      },
    });
  }
}

describe('Story 34.2: NFR-19 Telemetry Performance & Overhead Verification', () => {
  it('adds strictly less than 2ms differential latency overhead (NFR-19)', async () => {
    const mockRedis = {
      xAdd: vi.fn().mockResolvedValue('msg-id-1'),
      xadd: vi.fn().mockResolvedValue('msg-id-1'),
    };
    const emitter = new TelemetryEmitter({
      redisClient: mockRedis,
      maxBuffer: 5000,
    });

    const crawlerWithTelemetry = new BenchmarkCrawler({
      telemetryEmitter: emitter,
    });

    const crawlerBaseline = new BenchmarkCrawler({
      telemetryEmitter: null,
    });

    // Warm up V8 JIT for both
    for (let i = 0; i < 20; i++) {
      await crawlerBaseline.start({ action: 'simulate', args: {} });
      await crawlerWithTelemetry.start({ action: 'simulate', args: {} });
    }

    const iterations = 100;

    // 1. Measure baseline without telemetry
    const startBaseline = performance.now();
    for (let i = 0; i < iterations; i++) {
      await crawlerBaseline.start({ action: 'simulate', args: {} });
    }
    const avgDurationBaseline = (performance.now() - startBaseline) / iterations;

    // 2. Measure with telemetry
    const startWithTelemetry = performance.now();
    for (let i = 0; i < iterations; i++) {
      await crawlerWithTelemetry.start({ action: 'simulate', args: {} });
    }
    const avgDurationWithTelemetry = (performance.now() - startWithTelemetry) / iterations;

    const differentialOverhead = Math.max(0, avgDurationWithTelemetry - avgDurationBaseline);

    // Differential overhead must be strictly < 2ms (NFR-19)
    expect(differentialOverhead).toBeLessThan(2.0);
  });

  it('circuit breaker drops events cleanly without blocking when buffer exceeds maxBuffer', () => {
    const mockRedis = {
      xAdd: vi.fn().mockResolvedValue('msg-1'),
      xadd: vi.fn().mockResolvedValue('msg-1'),
    };
    const emitter = new TelemetryEmitter({
      redisClient: mockRedis,
      maxBuffer: 100,
    });

    for (let i = 0; i < 200; i++) {
      emitter.emit({ id: i, payload: 'test' });
    }

    const metrics = emitter.getMetrics();
    expect(metrics.queuedCount).toBe(100);
    expect(metrics.droppedCount).toBe(100);
  });

  it('fire-and-forget execution never crashes crawler even when emitter rejects', async () => {
    const brokenEmitter = {
      emitRun: vi.fn().mockImplementation(() => {
        throw new Error('Redis connection crashed fatally');
      }),
      emitRequest: vi.fn().mockImplementation(() => {
        throw new Error('Redis connection crashed fatally');
      }),
    };

    const crawler = new BenchmarkCrawler({
      telemetryEmitter: brokenEmitter,
    });

    // Crawler must finish and return result without throwing the emitter error
    const result = await crawler.start({ action: 'simulate', args: {} });
    expect(result).toBeDefined();
    expect(result.items).toHaveLength(5);
  });
});
