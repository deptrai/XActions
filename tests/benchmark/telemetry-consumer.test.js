import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TelemetryConsumer } from '../../api/services/benchmark/telemetry-consumer.js';

describe('TelemetryConsumer Unit Tests', () => {
  let mockRedis;
  let mockPrisma;
  let consumer;

  beforeEach(() => {
    mockRedis = {
      xGroupCreate: vi.fn().mockResolvedValue('OK'),
      xgroup: vi.fn().mockResolvedValue('OK'),
      xReadGroup: vi.fn(),
      xreadgroup: vi.fn(),
      xAck: vi.fn().mockResolvedValue(1),
      xack: vi.fn().mockResolvedValue(1),
      xTrim: vi.fn().mockResolvedValue(0),
      xtrim: vi.fn().mockResolvedValue(0),
    };

    mockPrisma = {
      scraperHealthScore: {
        create: vi.fn().mockResolvedValue({ id: 'health-1' }),
      },
    };

    consumer = new TelemetryConsumer({
      redisClient: mockRedis,
      prisma: mockPrisma,
      streamKey: 'stream:benchmark:telemetry',
      groupName: 'benchmark_telemetry_workers',
    });
  });

  it('safely initializes consumer group with MKSTREAM and ignores BUSYGROUP errors', async () => {
    // Normal first init
    await consumer.initGroup();
    expect(mockRedis.xGroupCreate).toHaveBeenCalledWith(
      'stream:benchmark:telemetry',
      'benchmark_telemetry_workers',
      '$',
      expect.objectContaining({ MKSTREAM: true })
    );

    // Second init where BUSYGROUP is returned
    mockRedis.xGroupCreate.mockRejectedValueOnce(new Error('BUSYGROUP Consumer Group name already exists'));
    await expect(consumer.initGroup()).resolves.not.toThrow();
  });

  it('reads messages via XREADGROUP, acknowledges with XACK, and trims stream with XTRIM MINID', async () => {
    mockRedis.xReadGroup.mockResolvedValueOnce([
      {
        name: 'stream:benchmark:telemetry',
        messages: [
          {
            id: '1725782400000-0',
            message: {
              type: 'telemetry:request',
              runId: 'run-1',
              scraperId: 'twitter-hybrid',
              platform: 'twitter',
              latencyMs: '200',
              httpStatus: '200',
              isFalse200: 'false',
            },
          },
          {
            id: '1725782400001-0',
            message: {
              type: 'telemetry:run',
              runId: 'run-1',
              scraperId: 'twitter-hybrid',
              platform: 'twitter',
              category: 'social',
              action: 'search',
              durationMs: '500',
              itemCount: '10',
              isSuccess: 'true',
            },
          },
        ],
      },
    ]);

    const result = await consumer.processBatch({ count: 10, blockMs: 100 });

    expect(result.processedCount).toBe(2);
    expect(mockRedis.xAck).toHaveBeenCalledWith(
      'stream:benchmark:telemetry',
      'benchmark_telemetry_workers',
      ['1725782400000-0', '1725782400001-0']
    );
    expect(mockRedis.xTrim).toHaveBeenCalledWith(
      'stream:benchmark:telemetry',
      'MINID',
      expect.any(String),
      { strategyModifier: '~' }
    );
  });

  it('still acknowledges corrupted messages to avoid stalling the PEL', async () => {
    mockRedis.xReadGroup.mockResolvedValueOnce([
      {
        name: 'stream:benchmark:telemetry',
        messages: [
          {
            id: 'corrupt-1',
            message: {
              type: 'invalid',
              storeMetrics_json: 'INVALID_JSON{',
            },
          },
        ],
      },
    ]);

    const result = await consumer.processBatch({ count: 1 });
    expect(result.processedCount).toBe(1);
    expect(mockRedis.xAck).toHaveBeenCalledWith(
      'stream:benchmark:telemetry',
      'benchmark_telemetry_workers',
      ['corrupt-1']
    );
  });

  it('aggregates correlated requests and run into rollup data', () => {
    const events = [
      {
        type: 'telemetry:request',
        runId: 'run-A',
        scraperId: 'facebook-hybrid',
        platform: 'facebook',
        latencyMs: 150,
        httpStatus: 200,
        proxyBytes: 2000,
        isFalse200: false,
      },
      {
        type: 'telemetry:request',
        runId: 'run-A',
        scraperId: 'facebook-hybrid',
        platform: 'facebook',
        latencyMs: 350,
        httpStatus: 200,
        proxyBytes: 3000,
        isFalse200: false,
      },
      {
        type: 'telemetry:run',
        runId: 'run-A',
        scraperId: 'facebook-hybrid',
        platform: 'facebook',
        category: 'social',
        action: 'posts',
        durationMs: 600,
        itemCount: 15,
        isSuccess: true,
      },
    ];

    const aggregated = consumer.aggregateRuns(events);
    expect(aggregated).toHaveLength(1);
    expect(aggregated[0].scraperId).toBe('facebook-hybrid');
    expect(aggregated[0].requestCount).toBe(2);
    expect(aggregated[0].avgLatencyMs).toBe(250);
    expect(aggregated[0].totalProxyBytes).toBe(5000);
    expect(aggregated[0].isSuccess).toBe(true);
  });
});
