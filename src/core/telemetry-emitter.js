// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TelemetryEmitter — Non-blocking benchmark telemetry dispatcher (AD-24, AD-29).
 * Features setImmediate dispatch, in-memory circuit breaker (>1000 buffer), and flat string wire contract.
 * @author nich (@nichxbt)
 * @license MIT
 */

/**
 * Serialize an object into a flat Record<string, string> compatible with Redis Stream XADD.
 * Nested objects/arrays are JSON stringified under fields suffixed with '_json'.
 * @param {Record<string, unknown>} obj
 * @returns {Record<string, string>}
 */
export function flattenPayload(obj) {
  if (!obj || typeof obj !== 'object') return {};
  /** @type {Record<string, string>} */
  const result = {};

  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined || val === null) {
      continue;
    }
    if (typeof val === 'object') {
      const targetKey = key.endsWith('_json') ? key : `${key}_json`;
      try {
        result[targetKey] = JSON.stringify(val);
      } catch {
        result[targetKey] = '{}';
      }
    } else {
      result[key] = String(val);
    }
  }

  return result;
}

/**
 * Reconstruct a flat Record<string, string> back into a typed object.
 * Deserializes fields suffixed with '_json' and parses booleans and numbers.
 * @param {Record<string, string>} record
 * @returns {Record<string, unknown>}
 */
export function unflattenPayload(record) {
  if (!record || typeof record !== 'object') return {};
  /** @type {Record<string, unknown>} */
  const result = {};

  for (const [key, val] of Object.entries(record)) {
    if (key.endsWith('_json')) {
      const originalKey = key.slice(0, -5);
      try {
        result[originalKey] = JSON.parse(val);
      } catch {
        result[originalKey] = val;
      }
    } else if (val === 'true') {
      result[key] = true;
    } else if (val === 'false') {
      result[key] = false;
    } else if (/^-?\d+$/.test(val) && (val === '0' || (!val.startsWith('0') && Number(val) <= Number.MAX_SAFE_INTEGER))) {
      result[key] = parseInt(val, 10);
    } else if (/^-?\d+\.\d+$/.test(val)) {
      result[key] = parseFloat(val);
    } else {
      result[key] = val;
    }
  }

  return result;
}

export class TelemetryEmitter {
  /** @type {import('./types.js').RedisClientLike | null} */
  #redisClient = null;

  /** @type {string} */
  #streamKey;

  /** @type {number} */
  #maxLen;

  /** @type {number} */
  #maxBuffer;

  /** @type {Array<Record<string, unknown>>} */
  #queue = [];

  /** @type {boolean} */
  #isScheduled = false;

  /** @type {number} */
  #emittedCount = 0;

  /** @type {number} */
  #droppedCount = 0;

  /** @type {number} */
  #errorCount = 0;

  /**
   * @param {Object} [options]
   * @param {import('./types.js').RedisClientLike} [options.redisClient]
   * @param {string} [options.streamKey]
   * @param {number} [options.maxLen]
   * @param {number} [options.maxBuffer]
   */
  constructor(options = {}) {
    this.#redisClient = options.redisClient || null;
    this.#streamKey = options.streamKey || process.env.BENCHMARK_STREAM_KEY || 'stream:benchmark:telemetry';
    this.#maxLen = Number(options.maxLen || process.env.BENCHMARK_STREAM_MAXLEN || 1000000);
    this.#maxBuffer = Number(options.maxBuffer || 1000);
  }

  /**
   * Sets or replaces active Redis client.
   * @param {import('./types.js').RedisClientLike | null} client
   */
  setClient(client) {
    this.#redisClient = client;
  }

  /**
   * Get operational metrics for circuit breaker and emission telemetry.
   * @returns {{ queuedCount: number, emittedCount: number, droppedCount: number, errorCount: number }}
   */
  getMetrics() {
    return {
      queuedCount: this.#queue.length,
      emittedCount: this.#emittedCount,
      droppedCount: this.#droppedCount,
      errorCount: this.#errorCount,
    };
  }

  /**
   * Ensure Redis client is connected.
   * @returns {Promise<import('./types.js').RedisClientLike | null>}
   */
  async ensureClient() {
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
        console.warn('[TelemetryEmitter] Redis client warning:', (err instanceof Error ? err.message : String(err)));
      });
      await client.connect();
      this.#redisClient = /** @type {import('./types.js').RedisClientLike} */ (client);
      return this.#redisClient;
    } catch (err) {
      console.warn('[TelemetryEmitter] Failed to connect to Redis:', (err instanceof Error ? err.message : String(err)));
      return null;
    }
  }

  /**
   * Enqueue event for non-blocking emission via setImmediate.
   * Circuit breaker drops event when buffer exceeds maxBuffer (1,000 items).
   * @param {Record<string, unknown>} payload
   * @returns {boolean} true if queued, false if dropped
   */
  emit(payload) {
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    if (this.#queue.length >= this.#maxBuffer) {
      this.#droppedCount++;
      return false;
    }

    this.#queue.push(payload);
    this._scheduleFlush();
    return true;
  }

  /**
   * Emit run completion telemetry event.
   * @param {Record<string, unknown>} payload
   * @returns {boolean}
   */
  emitRun(payload) {
    return this.emit({ ...payload, type: 'telemetry:run' });
  }

  /**
   * Emit individual transport request telemetry event.
   * @param {Record<string, unknown>} payload
   * @returns {boolean}
   */
  emitRequest(payload) {
    return this.emit({ ...payload, type: 'telemetry:request' });
  }

  /**
   * Public flush method to synchronously or asynchronously drain pending queue (e.g. before shutdown).
   * @returns {Promise<void>}
   */
  async flush() {
    await this._flush();
  }

  /**
   * Schedule flush via setImmediate to preserve I/O polling phase (AD-24).
   * @private
   */
  _scheduleFlush() {
    if (this.#isScheduled) {
      return;
    }
    this.#isScheduled = true;
    setImmediate(() => {
      this.#isScheduled = false;
      this._flush().catch((err) => {
        console.error('[TELEMETRY] Unexpected flush failure:', (err instanceof Error ? err.message : String(err)));
      });
    });
  }

  /**
   * Drain in-memory queue to Redis Stream.
   * @private
   */
  async _flush() {
    if (this.#queue.length === 0) {
      return;
    }

    const batch = this.#queue.splice(0, this.#queue.length);
    const client = await this.ensureClient();

    if (!client) {
      this.#errorCount += batch.length;
      console.error(`[TELEMETRY] Dropped ${batch.length} events: Redis client unavailable`);
      return;
    }

    for (const item of batch) {
      try {
        const flatRecord = flattenPayload(item);

        // 1. node-redis v4+ API (camelCase)
        if (typeof client.xAdd === 'function') {
          await client.xAdd(this.#streamKey, '*', flatRecord, {
            TRIM: {
              strategy: 'MAXLEN',
              strategyModifier: '~',
              threshold: this.#maxLen,
            },
          });
          this.#emittedCount++;
        }
        // 2. ioredis API (lowercase)
        else if (typeof client.xadd === 'function') {
          const flatArgs = Object.entries(flatRecord).flat();
          await client.xadd(this.#streamKey, 'MAXLEN', '~', this.#maxLen, '*', ...flatArgs);
          this.#emittedCount++;
        } else {
          throw new Error('Redis client lacks xAdd/xadd capability');
        }
      } catch (err) {
        this.#errorCount++;
        console.error('[TELEMETRY] Dispatch error:', (err instanceof Error ? err.message : String(err)));
      }
    }
  }
}

export const defaultTelemetryEmitter = new TelemetryEmitter();
