import { describe, it, expect } from 'vitest';
import { TelemetryContext } from '../../src/core/telemetry-context.js';

describe('TelemetryContext Unit Tests', () => {
  it('creates an instance with a valid UUID v4 runId and default metadata', () => {
    const ctx = TelemetryContext.create({
      scraperId: 'twitter-hybrid',
      platform: 'twitter',
      category: 'social',
      action: 'search',
    });

    expect(ctx).toBeDefined();
    expect(ctx.runId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(ctx.scraperId).toBe('twitter-hybrid');
    expect(ctx.platform).toBe('twitter');
    expect(ctx.category).toBe('social');
    expect(ctx.action).toBe('search');
    expect(ctx.source).toBe('production');
    expect(typeof ctx.startedAt).toBe('number');
  });

  it('records multiple transport requests with timestamps', () => {
    const ctx = TelemetryContext.create({
      scraperId: 'facebook-hybrid',
      platform: 'facebook',
      category: 'social',
      action: 'posts',
    });

    ctx.recordRequest({
      latencyMs: 150,
      httpStatus: 200,
      proxyBytes: 4096,
      retries: 0,
      isFalse200: false,
      isCheckpoint: false,
      proxyQuarantined: false,
    });

    ctx.recordRequest({
      latencyMs: 320,
      httpStatus: 429,
      proxyBytes: 1024,
      retries: 1,
      isFalse200: false,
      isCheckpoint: true,
      proxyQuarantined: true,
    });

    const requests = ctx.getRequestPayloads();
    expect(requests).toHaveLength(2);
    expect(requests[0].runId).toBe(ctx.runId);
    expect(requests[0].type).toBe('telemetry:request');
    expect(requests[0].latencyMs).toBe(150);
    expect(requests[0].httpStatus).toBe(200);
    expect(requests[0].proxyQuarantined).toBe(false);

    expect(requests[1].runId).toBe(ctx.runId);
    expect(requests[1].httpStatus).toBe(429);
    expect(requests[1].isCheckpoint).toBe(true);
    expect(requests[1].proxyQuarantined).toBe(true);
  });

  it('records store metrics and aggregates them', () => {
    const ctx = TelemetryContext.create({
      scraperId: 'shopee-search',
      platform: 'shopee',
      category: 'ecom',
      action: 'search',
    });

    ctx.recordStoreMetrics({
      fieldFillRate: 0.95,
      schemaValid: true,
      duplicates: 3,
      totalItems: 50,
    });

    expect(ctx.storeMetrics).toEqual({
      fieldFillRate: 0.95,
      schemaValid: true,
      duplicates: 3,
      totalItems: 50,
    });
  });

  it('generates a complete telemetry:run payload', () => {
    const ctx = TelemetryContext.create({
      scraperId: 'topcv-jobs',
      platform: 'topcv',
      category: 'recruitment',
      action: 'jobs',
      source: 'canary',
    });

    const runPayload = ctx.toRunPayload({
      isSuccess: true,
      durationMs: 850,
      itemCount: 25,
      errorName: null,
    });

    expect(runPayload).toEqual({
      type: 'telemetry:run',
      runId: ctx.runId,
      scraperId: 'topcv-jobs',
      platform: 'topcv',
      category: 'recruitment',
      action: 'jobs',
      source: 'canary',
      durationMs: 850,
      itemCount: 25,
      isSuccess: true,
      errorName: '',
      storeMetrics: null,
    });
  });
});
