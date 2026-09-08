import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TelemetryEmitter, flattenPayload, unflattenPayload } from '../../src/core/telemetry-emitter.js';

describe('TelemetryEmitter Unit Tests', () => {
  let mockRedisClient;
  let emitter;

  beforeEach(() => {
    mockRedisClient = {
      xAdd: vi.fn().mockResolvedValue('1725782400000-0'),
      xadd: vi.fn().mockResolvedValue('1725782400000-0'),
    };
    emitter = new TelemetryEmitter({ redisClient: mockRedisClient, streamKey: 'stream:benchmark:telemetry' });
  });

  it('flattens nested object payloads to flat string records with _json suffix', () => {
    const raw = {
      type: 'telemetry:run',
      runId: 'abc-123',
      itemCount: 20,
      isSuccess: true,
      storeMetrics: { fieldFillRate: 0.98, duplicates: 0 },
    };

    const flat = flattenPayload(raw);
    expect(flat.type).toBe('telemetry:run');
    expect(flat.runId).toBe('abc-123');
    expect(flat.itemCount).toBe('20');
    expect(flat.isSuccess).toBe('true');
    expect(typeof flat.storeMetrics_json).toBe('string');
    expect(JSON.parse(flat.storeMetrics_json)).toEqual({ fieldFillRate: 0.98, duplicates: 0 });

    const unflat = unflattenPayload(flat);
    expect(unflat.itemCount).toBe(20);
    expect(unflat.isSuccess).toBe(true);
    expect(unflat.storeMetrics).toEqual({ fieldFillRate: 0.98, duplicates: 0 });
  });

  it('emits non-blocking via setImmediate with execution time < 1ms', async () => {
    const start = performance.now();
    emitter.emitRun({
      type: 'telemetry:run',
      runId: 'test-run-1',
      scraperId: 'twitter-hybrid',
      platform: 'twitter',
      isSuccess: true,
    });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(1.0); // < 1ms per NFR-19
    // Wait for setImmediate to flush
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockRedisClient.xAdd).toHaveBeenCalledTimes(1);
    expect(emitter.getMetrics().emittedCount).toBe(1);
    expect(emitter.getMetrics().droppedCount).toBe(0);
  });

  it('drops events silently when circuit breaker exceeds 1,000 buffered items', async () => {
    // Fill buffer up to 1000 items
    for (let i = 0; i < 1000; i++) {
      emitter.emitRequest({
        type: 'telemetry:request',
        runId: `run-${i}`,
        latencyMs: 100,
      });
    }

    expect(emitter.getMetrics().queuedCount).toBe(1000);
    expect(emitter.getMetrics().droppedCount).toBe(0);

    // 1001th item should be dropped by circuit breaker
    emitter.emitRequest({
      type: 'telemetry:request',
      runId: 'overflow-run',
      latencyMs: 200,
    });

    expect(emitter.getMetrics().droppedCount).toBe(1);

    // Let the setImmediate drain the queue
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(emitter.getMetrics().emittedCount).toBe(1000);
  });

  it('catches Redis errors gracefully without throwing', async () => {
    const failingRedis = {
      xAdd: vi.fn().mockRejectedValue(new Error('Connection refused')),
    };
    const failingEmitter = new TelemetryEmitter({ redisClient: failingRedis });

    expect(() => {
      failingEmitter.emitRun({ runId: 'fail-test' });
    }).not.toThrow();

    await new Promise((resolve) => setImmediate(resolve));
    expect(failingEmitter.getMetrics().errorCount).toBe(1);
  });
});
