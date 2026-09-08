// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TelemetryConsumer — Native Redis Stream Consumer Group reader with 7-day rolling retention (AD-23).
 * Consumes stream:benchmark:telemetry, correlates two-phase events by runId, and trims stream via XTRIM MINID.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { unflattenPayload } from '../../../src/core/telemetry-emitter.js';
import { BenchmarkScoringEngine } from '../../../src/benchmark/scoring-engine.js';
import { defaultBenchmarkStateManager } from '../../../src/benchmark/state-manager.js';

export const BENCHMARK_STREAM_KEY = 'stream:benchmark:telemetry';
export const BENCHMARK_CONSUMER_GROUP = 'benchmark_telemetry_workers';
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export class TelemetryConsumer {
  /** @type {import('../../../src/core/types.js').RedisClientLike | null} */
  #redisClient = null;

  /** @type {import('@prisma/client').PrismaClient | null} */
  #prisma = null;

  /** @type {string} */
  #streamKey;

  /** @type {string} */
  #groupName;

  /** @type {string} */
  #consumerName;

  /** @type {boolean} */
  #isRunning = false;
  #batchCounter = 0;

  /** @type {Function | null} */
  #scoreProcessor = null;

  /**
   * @param {Object} [options]
   * @param {import('../../../src/core/types.js').RedisClientLike} [options.redisClient]
   * @param {import('@prisma/client').PrismaClient} [options.prisma]
   * @param {string} [options.streamKey]
   * @param {string} [options.groupName]
   * @param {string} [options.consumerName]
   * @param {Function} [options.scoreProcessor]
   */
  constructor(options = {}) {
    this.#redisClient = options.redisClient || null;
    this.#prisma = options.prisma || null;
    this.#streamKey = options.streamKey || BENCHMARK_STREAM_KEY;
    this.#groupName = options.groupName || BENCHMARK_CONSUMER_GROUP;
    this.#consumerName =
      options.consumerName || `worker_${process.pid}_${Math.random().toString(36).substring(7)}`;
    this.#scoreProcessor = options.scoreProcessor || null;
  }

  /**
   * Ensure Redis client is available.
   * @returns {Promise<import('../../../src/core/types.js').RedisClientLike | null>}
   */
  async ensureRedis() {
    if (this.#redisClient) {
      return this.#redisClient;
    }

    try {
      const { createClient } = await import('redis');
      const url =
        process.env.REDIS_URL ||
        (process.env.REDIS_HOST
          ? `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}`
          : 'redis://localhost:6379');
      const client = createClient({ url });
      client.on('error', (err) => {
        console.warn('[TelemetryConsumer] Redis error:', (err instanceof Error ? err.message : String(err)));
      });
      await client.connect();
      this.#redisClient = /** @type {import('../../../src/core/types.js').RedisClientLike} */ (client);
      return this.#redisClient;
    } catch (err) {
      console.warn('[TelemetryConsumer] Redis connection failed:', (err instanceof Error ? err.message : String(err)));
      return null;
    }
  }

  /**
   * Ensure Prisma client is available.
   * @returns {Promise<import('@prisma/client').PrismaClient | null>}
   */
  async ensurePrisma() {
    if (this.#prisma) {
      return this.#prisma;
    }

    try {
      const { default: prismaInstance } = await import('../../lib/prisma.js');
      this.#prisma = prismaInstance;
      return this.#prisma;
    } catch (err) {
      console.warn('[TelemetryConsumer] Prisma unavailable:', (err instanceof Error ? err.message : String(err)));
      return null;
    }
  }

  /**
   * Initialize consumer group with MKSTREAM: true, ignoring BUSYGROUP error if already exists.
   * @returns {Promise<void>}
   */
  async initGroup() {
    const client = await this.ensureRedis();
    if (!client) {
      return;
    }

    try {
      if (typeof client.xGroupCreate === 'function') {
        await client.xGroupCreate(this.#streamKey, this.#groupName, '$', { MKSTREAM: true });
      } else if (typeof client.xgroup === 'function') {
        await client.xgroup('CREATE', this.#streamKey, this.#groupName, '$', 'MKSTREAM');
      }
    } catch (err) {
      const msg = String(err instanceof Error ? err.message : err);
      if (!msg.includes('BUSYGROUP')) {
        throw err;
      }
    }
  }

  /**
   * Correlate raw telemetry events by runId into rollup metrics.
   * @param {Array<Record<string, unknown>>} events
   * @returns {Array<Record<string, unknown>>}
   */
  aggregateRuns(events) {
    /** @type {Map<string, { runEvent: Record<string, unknown> | null, requests: Array<Record<string, unknown>> }>} */
    const runMap = new Map();

    for (const evt of events) {
      const runId = String(evt.runId || '');
      if (!runId) continue;

      if (!runMap.has(runId)) {
        runMap.set(runId, { runEvent: null, requests: [] });
      }
      const entry = runMap.get(runId);

      if (evt.type === 'telemetry:run') {
        entry.runEvent = evt;
      } else if (evt.type === 'telemetry:request') {
        entry.requests.push(evt);
      }
    }

    const aggregated = [];
    for (const [runId, { runEvent, requests }] of runMap.entries()) {
      const scraperId = String(runEvent?.scraperId || requests[0]?.scraperId || 'unknown');
      const platform = String(runEvent?.platform || requests[0]?.platform || 'unknown');
      const category = String(runEvent?.category || 'social');
      const isSuccess = runEvent ? Boolean(runEvent.isSuccess) : true;
      const itemCount = runEvent ? Number(runEvent.itemCount || 0) : 0;
      const durationMs = runEvent ? Number(runEvent.durationMs || 0) : 0;

      let totalLatency = 0;
      let totalProxyBytes = 0;
      let false200Count = 0;
      let checkpointCount = 0;
      let failedRequestCount = 0;

      for (const req of requests) {
        totalLatency += Number(req.latencyMs || 0);
        totalProxyBytes += Number(req.proxyBytes || 0);
        if (req.isFalse200) false200Count++;
        if (req.isCheckpoint) checkpointCount++;
        if (Number(req.httpStatus || 200) >= 400) failedRequestCount++;
      }

      const requestCount = requests.length;
      const avgLatencyMs = requestCount > 0 ? Math.round(totalLatency / requestCount) : durationMs;

      aggregated.push({
        runId,
        scraperId,
        platform,
        category,
        isSuccess,
        itemCount,
        durationMs,
        requestCount,
        avgLatencyMs,
        totalProxyBytes,
        false200Count,
        checkpointCount,
        failedRequestCount,
        storeMetrics: runEvent?.storeMetrics || null,
      });
    }

    return aggregated;
  }

  /**
   * Process a batch of messages from the stream via XREADGROUP.
   * @param {Object} [opts]
   * @param {number} [opts.count]
   * @param {number} [opts.blockMs]
   * @returns {Promise<{ processedCount: number, errorCount: number }>}
   */
  async processBatch(opts = {}) {
    const count = opts.count || 50;
    const blockMs = opts.blockMs !== undefined ? opts.blockMs : 2000;
    const client = await this.ensureRedis();

    if (!client) {
      return { processedCount: 0, errorCount: 0 };
    }

    let rawStreamEntries = null;

    try {
      if (typeof client.xReadGroup === 'function') {
        rawStreamEntries = await client.xReadGroup(
          this.#groupName,
          this.#consumerName,
          [{ key: this.#streamKey, id: '>' }],
          { COUNT: count, BLOCK: blockMs }
        );
      } else if (typeof client.xreadgroup === 'function') {
        rawStreamEntries = await client.xreadgroup(
          'GROUP',
          this.#groupName,
          this.#consumerName,
          'COUNT',
          count,
          'BLOCK',
          blockMs,
          'STREAMS',
          this.#streamKey,
          '>'
        );
      }
    } catch (err) {
      console.warn('[TelemetryConsumer] Read error:', (err instanceof Error ? err.message : String(err)));
      return { processedCount: 0, errorCount: 1 };
    }

    if (!rawStreamEntries || !Array.isArray(rawStreamEntries) || rawStreamEntries.length === 0) {
      return { processedCount: 0, errorCount: 0 };
    }

    /** @type {string[]} */
    const idsToAck = [];
    /** @type {Array<Record<string, unknown>>} */
    const parsedEvents = [];
    let errorCount = 0;

    for (const streamObj of rawStreamEntries) {
      const messages = streamObj?.messages || [];
      for (const msg of messages) {
        const id = msg?.id;
        if (!id) continue;
        idsToAck.push(id);

        try {
          const parsed = unflattenPayload(msg.message || {});
          parsedEvents.push(parsed);
        } catch (err) {
          errorCount++;
          console.warn(`[TelemetryConsumer] Corrupted entry ${id}:`, (err instanceof Error ? err.message : String(err)));
        }
      }
    }

    // Aggregate runs and execute custom processor or persist baseline rollups
    if (parsedEvents.length > 0) {
      const rollups = this.aggregateRuns(parsedEvents);
      if (typeof this.#scoreProcessor === 'function') {
        try {
          await this.#scoreProcessor(rollups);
        } catch (procErr) {
          console.error('[TelemetryConsumer] Score processor error:', procErr.message);
        }
      } else {
        const engine = new BenchmarkScoringEngine();
        const stateManager = defaultBenchmarkStateManager;

        // Group rollups by scraperId for aggregate multi-run scoring
        const runsByScraper = {};
        for (const r of rollups) {
          if (!runsByScraper[r.scraperId]) runsByScraper[r.scraperId] = [];
          runsByScraper[r.scraperId].push(r);
        }

        for (const [scraperId, runs] of Object.entries(runsByScraper)) {
          try {
            const rawMetrics = engine.aggregateTelemetryRollups(runs);
            const category = runs[0]?.category || 'social';
            const platform = runs[0]?.platform || 'unknown';
            const scoringResult = engine.calculateScores(rawMetrics, category);

            await stateManager.recordEvaluation(scraperId, scoringResult, {
              platform,
              category,
              runs,
              sampleCount: runs.length,
            });
          } catch (scoreErr) {
            console.warn(`[TelemetryConsumer] Benchmark evaluation warning for ${scraperId}:`, scoreErr.message);
          }
        }
      }
    }

    // Acknowledge all processed IDs after successful processing/persistence
    if (idsToAck.length > 0) {
      try {
        if (typeof client.xAck === 'function') {
          await client.xAck(this.#streamKey, this.#groupName, idsToAck);
        } else if (typeof client.xack === 'function') {
          await client.xack(this.#streamKey, this.#groupName, ...idsToAck);
        }
      } catch (err) {
        console.error('[TelemetryConsumer] XACK failure:', (err instanceof Error ? err.message : String(err)));
      }
    }

    // Rolling 7-day retention trimming periodically (AD-23)
    if (idsToAck.length > 0 || (this.#batchCounter++ % 10 === 0)) {
      try {
        const sevenDaysAgoThreshold = String(Date.now() - SEVEN_DAYS_MS) + '-0';
        if (typeof client.xTrim === 'function') {
          await client.xTrim(this.#streamKey, 'MINID', sevenDaysAgoThreshold, { strategyModifier: '~' });
        } else if (typeof client.xtrim === 'function') {
          await client.xtrim(this.#streamKey, 'MINID', '~', sevenDaysAgoThreshold);
        }
      } catch (trimErr) {
        console.warn('[TelemetryConsumer] XTRIM MINID warning:', (trimErr instanceof Error ? trimErr.message : String(trimErr)));
      }
    }

    return { processedCount: idsToAck.length, errorCount };
  }

  /**
   * Start continuous consumption loop.
   */
  async start() {
    if (this.#isRunning) return;
    this.#isRunning = true;
    await this.initGroup();

    while (this.#isRunning) {
      try {
        await this.processBatch();
      } catch (err) {
        console.error('[TelemetryConsumer] Loop error:', (err instanceof Error ? err.message : String(err)));
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  /**
   * Graceful stop of the consumer loop.
   */
  stop() {
    this.#isRunning = false;
  }
}

export const defaultTelemetryConsumer = new TelemetryConsumer();
