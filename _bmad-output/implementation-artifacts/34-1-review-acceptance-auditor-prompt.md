You are an Acceptance Auditor. Review the provided diff against `/Users/luisphan/Documents/GitHub/XActions/_bmad-output/implementation-artifacts/stories/34-1-benchmark-telemetry-schema-storage.md` and any loaded context docs. Check for: violations of acceptance criteria, deviations from spec intent, missing implementation of specified behavior, contradictions between spec constraints and actual code. Output findings as a Markdown list. Each finding: one-line title, which AC/constraint it violates, and evidence from the diff.

Diff:

diff --git a/prisma/schema.prisma b/prisma/schema.prisma
index b23e3c58..ab683caa 100644
--- a/prisma/schema.prisma
+++ b/prisma/schema.prisma
@@ -405,3 +405,40 @@ model CrawlCheckpoint {
   @@index([platform, updatedAt])
   @@index([status, nextScheduledAt])
 }
+
+model ScraperHealthScore {
+  id                   String    @id @default(cuid())
+  scraperId            String
+  platform             String
+  healthScore          Float
+  tier                 String
+  stabilityScore       Float
+  qualityScore         Float
+  noiseScore           Float
+  costScore            Float
+  sampleCount          Int       @default(0)
+  consecutiveCleanRuns Int       @default(0)
+  requalifiedAt        DateTime?
+  evaluatedAt          DateTime  @default(now())
+  metricsSnapshot      Json
+
+  @@index([platform, evaluatedAt(sort: Desc)])
+  @@index([scraperId, evaluatedAt(sort: Desc)])
+}
+
+model ScraperCanaryRun {
+  id                  String   @id @default(cuid())
+  scraperId           String
+  platform            String
+  targetUrl           String
+  isSuccess           Boolean
+  latencyMs           Int
+  httpStatus          Int
+  false200Detected    Boolean  @default(false)
+  checkpointDetected  Boolean  @default(false)
+  errorReason         String?
+  executedAt          DateTime @default(now())
+
+  @@index([platform, executedAt(sort: Desc)])
+  @@index([scraperId, executedAt(sort: Desc)])
+}

diff --git a/src/core/types.js b/src/core/types.js
index 9e525dbb..557adf8e 100644
--- a/src/core/types.js
+++ b/src/core/types.js
@@ -178,6 +178,9 @@
  * @property {string} authorId - Author ID
  * @property {string} crawledAt - ISO 8601 timestamp string
  * @property {string} storageRef - Pointer to the stored row / item id
+ * @property {string} [scraperId] - Canonical scraper identifier, e.g. "twitter-hybrid"
+ * @property {'A' | 'B' | 'C' | 'UNKNOWN'} [benchmark_health] - Scraper benchmark tier
+ * @property {boolean} [benchmark_alert] - Degraded health alert flag
  */
 
 /**
@@ -204,6 +207,16 @@
  * @property {Function} [xInfoConsumers]
  * @property {Function} [xGroupCreate]
  * @property {Function} [xgroup]
+ * @property {Function} [xReadGroup]
+ * @property {Function} [xreadgroup]
+ * @property {Function} [xAck]
+ * @property {Function} [xack]
+ * @property {Function} [xTrim]
+ * @property {Function} [xtrim]
+ * @property {Function} [hGetAll]
+ * @property {Function} [hgetall]
+ * @property {Function} [hSet]
+ * @property {Function} [hset]
  * @property {Function} [xPending]
  * @property {Function} [xpending]
  * @property {Function} [sendCommand]

diff --git a/prisma/migrations/20260908000000_add_scraper_health_score_and_canary_run/migration.sql b/prisma/migrations/20260908000000_add_scraper_health_score_and_canary_run/migration.sql
new file mode 100644
index 00000000..e7769c53
--- /dev/null
+++ b/prisma/migrations/20260908000000_add_scraper_health_score_and_canary_run/migration.sql
@@ -0,0 +1,48 @@
+-- CreateTable
+CREATE TABLE IF NOT EXISTS "ScraperHealthScore" (
+    "id" TEXT NOT NULL,
+    "scraperId" TEXT NOT NULL,
+    "platform" TEXT NOT NULL,
+    "healthScore" DOUBLE PRECISION NOT NULL,
+    "tier" TEXT NOT NULL,
+    "stabilityScore" DOUBLE PRECISION NOT NULL,
+    "qualityScore" DOUBLE PRECISION NOT NULL,
+    "noiseScore" DOUBLE PRECISION NOT NULL,
+    "costScore" DOUBLE PRECISION NOT NULL,
+    "sampleCount" INTEGER NOT NULL DEFAULT 0,
+    "consecutiveCleanRuns" INTEGER NOT NULL DEFAULT 0,
+    "requalifiedAt" TIMESTAMP(3),
+    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
+    "metricsSnapshot" JSONB NOT NULL,
+
+    CONSTRAINT "ScraperHealthScore_pkey" PRIMARY KEY ("id")
+);
+
+-- CreateTable
+CREATE TABLE IF NOT EXISTS "ScraperCanaryRun" (
+    "id" TEXT NOT NULL,
+    "scraperId" TEXT NOT NULL,
+    "platform" TEXT NOT NULL,
+    "targetUrl" TEXT NOT NULL,
+    "isSuccess" BOOLEAN NOT NULL,
+    "latencyMs" INTEGER NOT NULL,
+    "httpStatus" INTEGER NOT NULL,
+    "false200Detected" BOOLEAN NOT NULL DEFAULT false,
+    "checkpointDetected" BOOLEAN NOT NULL DEFAULT false,
+    "errorReason" TEXT,
+    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
+
+    CONSTRAINT "ScraperCanaryRun_pkey" PRIMARY KEY ("id")
+);
+
+-- CreateIndex
+CREATE INDEX IF NOT EXISTS "ScraperHealthScore_platform_evaluatedAt_idx" ON "ScraperHealthScore"("platform", "evaluatedAt" DESC);
+
+-- CreateIndex
+CREATE INDEX IF NOT EXISTS "ScraperHealthScore_scraperId_evaluatedAt_idx" ON "ScraperHealthScore"("scraperId", "evaluatedAt" DESC);
+
+-- CreateIndex
+CREATE INDEX IF NOT EXISTS "ScraperCanaryRun_platform_executedAt_idx" ON "ScraperCanaryRun"("platform", "executedAt" DESC);
+
+-- CreateIndex
+CREATE INDEX IF NOT EXISTS "ScraperCanaryRun_scraperId_executedAt_idx" ON "ScraperCanaryRun"("scraperId", "executedAt" DESC);

diff --git a/src/core/telemetry-context.js b/src/core/telemetry-context.js
new file mode 100644
index 00000000..d11e0335
--- /dev/null
+++ b/src/core/telemetry-context.js
@@ -0,0 +1,159 @@
+// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
+/**
+ * RunTelemetryContext — Shared telemetry context threaded through crawler session (AD-25, AD-29).
+ * Captures correlated transport attempts and store metrics under a unified runId.
+ * @author nich (@nichxbt)
+ * @license MIT
+ */
+
+import { randomUUID } from 'crypto';
+
+/**
+ * @typedef {Object} TransportRequestRecord
+ * @property {string} type
+ * @property {string} runId
+ * @property {string} scraperId
+ * @property {string} platform
+ * @property {number} ts
+ * @property {number} latencyMs
+ * @property {number} httpStatus
+ * @property {number} proxyBytes
+ * @property {number} retries
+ * @property {boolean} isFalse200
+ * @property {boolean} isCheckpoint
+ * @property {boolean} proxyQuarantined
+ */
+
+/**
+ * @typedef {Object} StoreMetricsRecord
+ * @property {number} fieldFillRate
+ * @property {boolean} schemaValid
+ * @property {number} duplicates
+ * @property {number} totalItems
+ */
+
+export class TelemetryContext {
+  /**
+   * @param {Object} params
+   * @param {string} [params.runId]
+   * @param {string} params.scraperId
+   * @param {string} params.platform
+   * @param {string} params.category
+   * @param {string} params.action
+   * @param {'production' | 'canary'} [params.source]
+   * @param {number} [params.startedAt]
+   */
+  constructor({
+    runId = randomUUID(),
+    scraperId = '',
+    platform = '',
+    category = 'social',
+    action = '',
+    source = 'production',
+    startedAt = Date.now(),
+  }) {
+    this.runId = runId;
+    this.scraperId = scraperId;
+    this.platform = platform;
+    this.category = category;
+    this.action = action;
+    this.source = source;
+    this.startedAt = startedAt;
+
+    /** @type {TransportRequestRecord[]} */
+    this.requests = [];
+
+    /** @type {StoreMetricsRecord | null} */
+    this.storeMetrics = null;
+  }
+
+  /**
+   * Factory method to create a new scoped context.
+   * @param {Object} params
+   * @returns {TelemetryContext}
+   */
+  static create(params) {
+    return new TelemetryContext(params);
+  }
+
+  /**
+   * Record an HTTP/CDP transport attempt.
+   * @param {Object} req
+   * @param {number} [req.latencyMs]
+   * @param {number} [req.httpStatus]
+   * @param {number} [req.proxyBytes]
+   * @param {number} [req.retries]
+   * @param {boolean} [req.isFalse200]
+   * @param {boolean} [req.isCheckpoint]
+   * @param {boolean} [req.proxyQuarantined]
+   * @param {number} [req.ts]
+   */
+  recordRequest(req = {}) {
+    this.requests.push({
+      type: 'telemetry:request',
+      runId: this.runId,
+      scraperId: this.scraperId,
+      platform: this.platform,
+      ts: req.ts || Date.now(),
+      latencyMs: Number(req.latencyMs || 0),
+      httpStatus: Number(req.httpStatus || 200),
+      proxyBytes: Number(req.proxyBytes || 0),
+      retries: Number(req.retries || 0),
+      isFalse200: Boolean(req.isFalse200),
+      isCheckpoint: Boolean(req.isCheckpoint),
+      proxyQuarantined: Boolean(req.proxyQuarantined),
+    });
+  }
+
+  /**
+   * Record persistence metrics from store.
+   * @param {StoreMetricsRecord} metrics
+   */
+  recordStoreMetrics(metrics) {
+    this.storeMetrics = {
+      fieldFillRate: Number(metrics?.fieldFillRate ?? 1.0),
+      schemaValid: Boolean(metrics?.schemaValid ?? true),
+      duplicates: Number(metrics?.duplicates || 0),
+      totalItems: Number(metrics?.totalItems || 0),
+    };
+  }
+
+  /**
+   * Retrieve all request payloads formatted for wire contract.
+   * @returns {TransportRequestRecord[]}
+   */
+  getRequestPayloads() {
+    return this.requests;
+  }
+
+  /**
+   * Produce the final telemetry:run payload.
+   * @param {Object} [runDetails]
+   * @param {boolean} [runDetails.isSuccess]
+   * @param {number} [runDetails.durationMs]
+   * @param {number} [runDetails.itemCount]
+   * @param {string | null} [runDetails.errorName]
+   * @returns {Object}
+   */
+  toRunPayload(runDetails = {}) {
+    const duration =
+      runDetails.durationMs !== undefined
+        ? Number(runDetails.durationMs)
+        : Math.max(0, Date.now() - this.startedAt);
+
+    return {
+      type: 'telemetry:run',
+      runId: this.runId,
+      scraperId: this.scraperId,
+      platform: this.platform,
+      category: this.category,
+      action: this.action,
+      source: this.source,
+      durationMs: duration,
+      itemCount: Number(runDetails.itemCount || 0),
+      isSuccess: Boolean(runDetails.isSuccess ?? true),
+      errorName: runDetails.errorName ? String(runDetails.errorName) : '',
+      storeMetrics: this.storeMetrics,
+    };
+  }
+}

diff --git a/src/core/telemetry-emitter.js b/src/core/telemetry-emitter.js
new file mode 100644
index 00000000..e483c394
--- /dev/null
+++ b/src/core/telemetry-emitter.js
@@ -0,0 +1,271 @@
+// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
+/**
+ * TelemetryEmitter — Non-blocking benchmark telemetry dispatcher (AD-24, AD-29).
+ * Features setImmediate dispatch, in-memory circuit breaker (>1000 buffer), and flat string wire contract.
+ * @author nich (@nichxbt)
+ * @license MIT
+ */
+
+/**
+ * Serialize an object into a flat Record<string, string> compatible with Redis Stream XADD.
+ * Nested objects/arrays are JSON stringified under fields suffixed with '_json'.
+ * @param {Record<string, unknown>} obj
+ * @returns {Record<string, string>}
+ */
+export function flattenPayload(obj) {
+  if (!obj || typeof obj !== 'object') return {};
+  /** @type {Record<string, string>} */
+  const result = {};
+
+  for (const [key, val] of Object.entries(obj)) {
+    if (val === undefined || val === null) {
+      continue;
+    }
+    if (typeof val === 'object') {
+      const targetKey = key.endsWith('_json') ? key : `${key}_json`;
+      try {
+        result[targetKey] = JSON.stringify(val);
+      } catch {
+        result[targetKey] = '{}';
+      }
+    } else {
+      result[key] = String(val);
+    }
+  }
+
+  return result;
+}
+
+/**
+ * Reconstruct a flat Record<string, string> back into a typed object.
+ * Deserializes fields suffixed with '_json' and parses booleans and numbers.
+ * @param {Record<string, string>} record
+ * @returns {Record<string, unknown>}
+ */
+export function unflattenPayload(record) {
+  if (!record || typeof record !== 'object') return {};
+  /** @type {Record<string, unknown>} */
+  const result = {};
+
+  for (const [key, val] of Object.entries(record)) {
+    if (key.endsWith('_json')) {
+      const originalKey = key.slice(0, -5);
+      try {
+        result[originalKey] = JSON.parse(val);
+      } catch {
+        result[originalKey] = val;
+      }
+    } else if (val === 'true') {
+      result[key] = true;
+    } else if (val === 'false') {
+      result[key] = false;
+    } else if (/^-?\d+$/.test(val)) {
+      result[key] = parseInt(val, 10);
+    } else if (/^-?\d+\.\d+$/.test(val)) {
+      result[key] = parseFloat(val);
+    } else {
+      result[key] = val;
+    }
+  }
+
+  return result;
+}
+
+export class TelemetryEmitter {
+  /** @type {import('./types.js').RedisClientLike | null} */
+  #redisClient = null;
+
+  /** @type {string} */
+  #streamKey;
+
+  /** @type {number} */
+  #maxLen;
+
+  /** @type {number} */
+  #maxBuffer;
+
+  /** @type {Array<Record<string, unknown>>} */
+  #queue = [];
+
+  /** @type {boolean} */
+  #isScheduled = false;
+
+  /** @type {number} */
+  #emittedCount = 0;
+
+  /** @type {number} */
+  #droppedCount = 0;
+
+  /** @type {number} */
+  #errorCount = 0;
+
+  /**
+   * @param {Object} [options]
+   * @param {import('./types.js').RedisClientLike} [options.redisClient]
+   * @param {string} [options.streamKey]
+   * @param {number} [options.maxLen]
+   * @param {number} [options.maxBuffer]
+   */
+  constructor(options = {}) {
+    this.#redisClient = options.redisClient || null;
+    this.#streamKey = options.streamKey || process.env.BENCHMARK_STREAM_KEY || 'stream:benchmark:telemetry';
+    this.#maxLen = Number(options.maxLen || process.env.BENCHMARK_STREAM_MAXLEN || 1000000);
+    this.#maxBuffer = Number(options.maxBuffer || 1000);
+  }
+
+  /**
+   * Sets or replaces active Redis client.
+   * @param {import('./types.js').RedisClientLike | null} client
+   */
+  setClient(client) {
+    this.#redisClient = client;
+  }
+
+  /**
+   * Get operational metrics for circuit breaker and emission telemetry.
+   * @returns {{ queuedCount: number, emittedCount: number, droppedCount: number, errorCount: number }}
+   */
+  getMetrics() {
+    return {
+      queuedCount: this.#queue.length,
+      emittedCount: this.#emittedCount,
+      droppedCount: this.#droppedCount,
+      errorCount: this.#errorCount,
+    };
+  }
+
+  /**
+   * Ensure Redis client is connected.
+   * @returns {Promise<import('./types.js').RedisClientLike | null>}
+   */
+  async ensureClient() {
+    if (this.#redisClient) {
+      return this.#redisClient;
+    }
+
+    try {
+      const { createClient } = await import('redis');
+      const url =
+        process.env.REDIS_URL ||
+        (process.env.REDIS_HOST
+          ? `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}`
+          : 'redis://localhost:6379');
+      const client = createClient({ url });
+      client.on('error', (err) => {
+        console.warn('[TelemetryEmitter] Redis client warning:', (err instanceof Error ? err.message : String(err)));
+      });
+      await client.connect();
+      this.#redisClient = /** @type {import('./types.js').RedisClientLike} */ (client);
+      return this.#redisClient;
+    } catch (err) {
+      console.warn('[TelemetryEmitter] Failed to connect to Redis:', (err instanceof Error ? err.message : String(err)));
+      return null;
+    }
+  }
+
+  /**
+   * Enqueue event for non-blocking emission via setImmediate.
+   * Circuit breaker drops event when buffer exceeds maxBuffer (1,000 items).
+   * @param {Record<string, unknown>} payload
+   * @returns {boolean} true if queued, false if dropped
+   */
+  emit(payload) {
+    if (!payload || typeof payload !== 'object') {
+      return false;
+    }
+
+    if (this.#queue.length >= this.#maxBuffer) {
+      this.#droppedCount++;
+      return false;
+    }
+
+    this.#queue.push(payload);
+    this._scheduleFlush();
+    return true;
+  }
+
+  /**
+   * Emit run completion telemetry event.
+   * @param {Record<string, unknown>} payload
+   * @returns {boolean}
+   */
+  emitRun(payload) {
+    return this.emit({ ...payload, type: 'telemetry:run' });
+  }
+
+  /**
+   * Emit individual transport request telemetry event.
+   * @param {Record<string, unknown>} payload
+   * @returns {boolean}
+   */
+  emitRequest(payload) {
+    return this.emit({ ...payload, type: 'telemetry:request' });
+  }
+
+  /**
+   * Schedule flush via setImmediate to preserve I/O polling phase (AD-24).
+   * @private
+   */
+  _scheduleFlush() {
+    if (this.#isScheduled) {
+      return;
+    }
+    this.#isScheduled = true;
+    setImmediate(() => {
+      this.#isScheduled = false;
+      this._flush().catch((err) => {
+        console.error('[TELEMETRY] Unexpected flush failure:', (err instanceof Error ? err.message : String(err)));
+      });
+    });
+  }
+
+  /**
+   * Drain in-memory queue to Redis Stream.
+   * @private
+   */
+  async _flush() {
+    if (this.#queue.length === 0) {
+      return;
+    }
+
+    const batch = this.#queue.splice(0, this.#queue.length);
+    const client = await this.ensureClient();
+
+    if (!client) {
+      this.#errorCount += batch.length;
+      console.error(`[TELEMETRY] Dropped ${batch.length} events: Redis client unavailable`);
+      return;
+    }
+
+    for (const item of batch) {
+      try {
+        const flatRecord = flattenPayload(item);
+
+        // 1. node-redis v4+ API (camelCase)
+        if (typeof client.xAdd === 'function') {
+          await client.xAdd(this.#streamKey, '*', flatRecord, {
+            TRIM: {
+              strategy: 'MAXLEN',
+              strategyModifier: '~',
+              threshold: this.#maxLen,
+            },
+          });
+          this.#emittedCount++;
+        }
+        // 2. ioredis API (lowercase)
+        else if (typeof client.xadd === 'function') {
+          const flatArgs = Object.entries(flatRecord).flat();
+          await client.xadd(this.#streamKey, 'MAXLEN', '~', this.#maxLen, '*', ...flatArgs);
+          this.#emittedCount++;
+        } else {
+          throw new Error('Redis client lacks xAdd/xadd capability');
+        }
+      } catch (err) {
+        this.#errorCount++;
+        console.error('[TELEMETRY] Dispatch error:', (err instanceof Error ? err.message : String(err)));
+      }
+    }
+  }
+}
+
+export const defaultTelemetryEmitter = new TelemetryEmitter();

diff --git a/src/benchmark/health-tier-cache.js b/src/benchmark/health-tier-cache.js
new file mode 100644
index 00000000..e75a9d10
--- /dev/null
+++ b/src/benchmark/health-tier-cache.js
@@ -0,0 +1,262 @@
+// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
+/**
+ * HealthTierCache — Synchronous O(1) in-memory tier cache with Redis hash polling & DB warmup (AD-32).
+ * Prevents cold-start masking, provides synchronous lookup for thin events, and falls back safely to UNKNOWN.
+ * @author nich (@nichxbt)
+ * @license MIT
+ */
+
+export const HEALTH_TIER_HASH_KEY = 'hash:scraper:health_tier';
+export const VALID_TIERS = Object.freeze(['A', 'B', 'C', 'UNKNOWN']);
+export const DEFAULT_TIER = 'UNKNOWN';
+
+export class HealthTierCache {
+  /** @type {Map<string, string>} */
+  #cache = new Map();
+
+  /** @type {import('../core/types.js').RedisClientLike | null} */
+  #redisClient = null;
+
+  /** @type {import('@prisma/client').PrismaClient | null} */
+  #prisma = null;
+
+  /** @type {string} */
+  #hashKey;
+
+  /** @type {NodeJS.Timeout | null} */
+  #pollTimer = null;
+
+  /**
+   * @param {Object} [options]
+   * @param {import('../core/types.js').RedisClientLike} [options.redisClient]
+   * @param {import('@prisma/client').PrismaClient} [options.prisma]
+   * @param {string} [options.hashKey]
+   */
+  constructor(options = {}) {
+    this.#redisClient = options.redisClient || null;
+    this.#prisma = options.prisma || null;
+    this.#hashKey = options.hashKey || HEALTH_TIER_HASH_KEY;
+  }
+
+  /**
+   * Synchronous O(1) in-memory tier lookup.
+   * Never makes network calls on the hot path (AD-32).
+   * @param {string} scraperId
+   * @returns {'A' | 'B' | 'C' | 'UNKNOWN'}
+   */
+  get(scraperId) {
+    if (!scraperId || typeof scraperId !== 'string') {
+      return DEFAULT_TIER;
+    }
+    const val = this.#cache.get(scraperId);
+    if (val && VALID_TIERS.includes(val)) {
+      return /** @type {'A' | 'B' | 'C' | 'UNKNOWN'} */ (val);
+    }
+    return DEFAULT_TIER;
+  }
+
+  /**
+   * Set tier in local memory cache.
+   * @param {string} scraperId
+   * @param {'A' | 'B' | 'C' | 'UNKNOWN'} tier
+   */
+  set(scraperId, tier) {
+    if (scraperId && VALID_TIERS.includes(tier)) {
+      this.#cache.set(scraperId, tier);
+    }
+  }
+
+  /**
+   * Ensure Redis client is connected.
+   * @returns {Promise<import('../core/types.js').RedisClientLike | null>}
+   */
+  async ensureRedisClient() {
+    if (this.#redisClient) {
+      return this.#redisClient;
+    }
+
+    try {
+      const { createClient } = await import('redis');
+      const url =
+        process.env.REDIS_URL ||
+        (process.env.REDIS_HOST
+          ? `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}`
+          : 'redis://localhost:6379');
+      const client = createClient({ url });
+      client.on('error', (err) => {
+        console.warn('[HealthTierCache] Redis error:', (err instanceof Error ? err.message : String(err)));
+      });
+      await client.connect();
+      this.#redisClient = /** @type {import('../core/types.js').RedisClientLike} */ (client);
+      return this.#redisClient;
+    } catch (err) {
+      console.warn('[HealthTierCache] Redis connection failed:', (err instanceof Error ? err.message : String(err)));
+      return null;
+    }
+  }
+
+  /**
+   * Resolve Prisma client.
+   * @returns {Promise<import('@prisma/client').PrismaClient | null>}
+   */
+  async ensurePrisma() {
+    if (this.#prisma) {
+      return this.#prisma;
+    }
+
+    try {
+      const { default: prismaInstance } = await import('../../api/lib/prisma.js');
+      this.#prisma = prismaInstance;
+      return this.#prisma;
+    } catch (err) {
+      console.warn('[HealthTierCache] Prisma resolution warning:', (err instanceof Error ? err.message : String(err)));
+      return null;
+    }
+  }
+
+  /**
+   * Poll and refresh in-memory map from Redis Hash hash:scraper:health_tier.
+   * @returns {Promise<void>}
+   */
+  async refresh() {
+    const client = await this.ensureRedisClient();
+    if (!client) {
+      return;
+    }
+
+    try {
+      let hash = null;
+      if (typeof client.hGetAll === 'function') {
+        hash = await client.hGetAll(this.#hashKey);
+      } else if (typeof client.hgetall === 'function') {
+        hash = await client.hgetall(this.#hashKey);
+      }
+
+      if (hash && typeof hash === 'object') {
+        for (const [scraperId, tier] of Object.entries(hash)) {
+          if (VALID_TIERS.includes(tier)) {
+            this.#cache.set(scraperId, tier);
+          }
+        }
+      }
+    } catch (err) {
+      console.warn('[HealthTierCache] Refresh failed:', (err instanceof Error ? err.message : String(err)));
+    }
+  }
+
+  /**
+   * Start periodic polling loop (default: every 30s).
+   * @param {number} [intervalMs]
+   */
+  startPolling(intervalMs = 30000) {
+    if (this.#pollTimer) {
+      return;
+    }
+    this.#pollTimer = setInterval(() => {
+      this.refresh().catch((err) => {
+        console.warn('[HealthTierCache] Periodic refresh error:', err.message);
+      });
+    }, intervalMs);
+    // Do not prevent process from exiting
+    if (this.#pollTimer.unref) {
+      this.#pollTimer.unref();
+    }
+  }
+
+  /**
+   * Stop periodic polling loop.
+   */
+  stopPolling() {
+    if (this.#pollTimer) {
+      clearInterval(this.#pollTimer);
+      this.#pollTimer = null;
+    }
+  }
+
+  /**
+   * Warmup tier cache from PostgreSQL on startup into both RAM and Redis Hash (AD-32).
+   * @param {Object} [deps]
+   * @param {import('@prisma/client').PrismaClient} [deps.prisma]
+   * @param {import('../core/types.js').RedisClientLike} [deps.redisClient]
+   * @returns {Promise<void>}
+   */
+  async warmup(deps = {}) {
+    const prisma = deps.prisma || (await this.ensurePrisma());
+    const redis = deps.redisClient || (await this.ensureRedisClient());
+
+    if (!prisma) {
+      console.warn('[HealthTierCache] Warmup skipped: Prisma unavailable');
+      return;
+    }
+
+    try {
+      const records = await prisma.scraperHealthScore.findMany({
+        orderBy: { evaluatedAt: 'desc' },
+      });
+
+      /** @type {Record<string, string>} */
+      const latestMap = {};
+      for (const rec of records) {
+        if (!latestMap[rec.scraperId] && VALID_TIERS.includes(rec.tier)) {
+          latestMap[rec.scraperId] = rec.tier;
+          this.#cache.set(rec.scraperId, rec.tier);
+        }
+      }
+
+      if (redis && Object.keys(latestMap).length > 0) {
+        if (typeof redis.hSet === 'function') {
+          await redis.hSet(this.#hashKey, latestMap);
+        } else if (typeof redis.hset === 'function') {
+          for (const [key, val] of Object.entries(latestMap)) {
+            await redis.hset(this.#hashKey, key, val);
+          }
+        }
+      }
+    } catch (err) {
+      console.warn('[HealthTierCache] Warmup query error:', (err instanceof Error ? err.message : String(err)));
+    }
+  }
+
+  /**
+   * Safe fallback resolution when cache misses (AD-32).
+   * Checks if scraper had Tier C in last 24h -> returns 'C'.
+   * Otherwise returns 'UNKNOWN' (never defaults to 'B').
+   * @param {string} scraperId
+   * @returns {Promise<'A' | 'B' | 'C' | 'UNKNOWN'>}
+   */
+  async resolveFallback(scraperId) {
+    if (this.#cache.has(scraperId)) {
+      return this.get(scraperId);
+    }
+
+    const prisma = await this.ensurePrisma();
+    if (!prisma) {
+      this.#cache.set(scraperId, DEFAULT_TIER);
+      return DEFAULT_TIER;
+    }
+
+    try {
+      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
+      const recentDegraded = await prisma.scraperHealthScore.findFirst({
+        where: {
+          scraperId,
+          tier: 'C',
+          evaluatedAt: { gte: twentyFourHoursAgo },
+        },
+      });
+
+      if (recentDegraded) {
+        this.#cache.set(scraperId, 'C');
+        return 'C';
+      }
+
+      this.#cache.set(scraperId, DEFAULT_TIER);
+      return DEFAULT_TIER;
+    } catch {
+      this.#cache.set(scraperId, DEFAULT_TIER);
+      return DEFAULT_TIER;
+    }
+  }
+}
+
+export const defaultHealthTierCache = new HealthTierCache();

diff --git a/api/services/benchmark/telemetry-consumer.js b/api/services/benchmark/telemetry-consumer.js
new file mode 100644
index 00000000..f03be802
--- /dev/null
+++ b/api/services/benchmark/telemetry-consumer.js
@@ -0,0 +1,338 @@
+// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
+/**
+ * TelemetryConsumer — Native Redis Stream Consumer Group reader with 7-day rolling retention (AD-23).
+ * Consumes stream:benchmark:telemetry, correlates two-phase events by runId, and trims stream via XTRIM MINID.
+ * @author nich (@nichxbt)
+ * @license MIT
+ */
+
+import { unflattenPayload } from '../../../src/core/telemetry-emitter.js';
+
+export const BENCHMARK_STREAM_KEY = 'stream:benchmark:telemetry';
+export const BENCHMARK_CONSUMER_GROUP = 'benchmark_telemetry_workers';
+export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
+
+export class TelemetryConsumer {
+  /** @type {import('../../../src/core/types.js').RedisClientLike | null} */
+  #redisClient = null;
+
+  /** @type {import('@prisma/client').PrismaClient | null} */
+  #prisma = null;
+
+  /** @type {string} */
+  #streamKey;
+
+  /** @type {string} */
+  #groupName;
+
+  /** @type {string} */
+  #consumerName;
+
+  /** @type {boolean} */
+  #isRunning = false;
+
+  /** @type {Function | null} */
+  #scoreProcessor = null;
+
+  /**
+   * @param {Object} [options]
+   * @param {import('../../../src/core/types.js').RedisClientLike} [options.redisClient]
+   * @param {import('@prisma/client').PrismaClient} [options.prisma]
+   * @param {string} [options.streamKey]
+   * @param {string} [options.groupName]
+   * @param {string} [options.consumerName]
+   * @param {Function} [options.scoreProcessor]
+   */
+  constructor(options = {}) {
+    this.#redisClient = options.redisClient || null;
+    this.#prisma = options.prisma || null;
+    this.#streamKey = options.streamKey || BENCHMARK_STREAM_KEY;
+    this.#groupName = options.groupName || BENCHMARK_CONSUMER_GROUP;
+    this.#consumerName =
+      options.consumerName || `worker_${process.pid}_${Math.random().toString(36).substring(7)}`;
+    this.#scoreProcessor = options.scoreProcessor || null;
+  }
+
+  /**
+   * Ensure Redis client is available.
+   * @returns {Promise<import('../../../src/core/types.js').RedisClientLike | null>}
+   */
+  async ensureRedis() {
+    if (this.#redisClient) {
+      return this.#redisClient;
+    }
+
+    try {
+      const { createClient } = await import('redis');
+      const url =
+        process.env.REDIS_URL ||
+        (process.env.REDIS_HOST
+          ? `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}`
+          : 'redis://localhost:6379');
+      const client = createClient({ url });
+      client.on('error', (err) => {
+        console.warn('[TelemetryConsumer] Redis error:', (err instanceof Error ? err.message : String(err)));
+      });
+      await client.connect();
+      this.#redisClient = /** @type {import('../../../src/core/types.js').RedisClientLike} */ (client);
+      return this.#redisClient;
+    } catch (err) {
+      console.warn('[TelemetryConsumer] Redis connection failed:', (err instanceof Error ? err.message : String(err)));
+      return null;
+    }
+  }
+
+  /**
+   * Ensure Prisma client is available.
+   * @returns {Promise<import('@prisma/client').PrismaClient | null>}
+   */
+  async ensurePrisma() {
+    if (this.#prisma) {
+      return this.#prisma;
+    }
+
+    try {
+      const { default: prismaInstance } = await import('../../../lib/prisma.js');
+      this.#prisma = prismaInstance;
+      return this.#prisma;
+    } catch (err) {
+      console.warn('[TelemetryConsumer] Prisma unavailable:', (err instanceof Error ? err.message : String(err)));
+      return null;
+    }
+  }
+
+  /**
+   * Initialize consumer group with MKSTREAM: true, ignoring BUSYGROUP error if already exists.
+   * @returns {Promise<void>}
+   */
+  async initGroup() {
+    const client = await this.ensureRedis();
+    if (!client) {
+      return;
+    }
+
+    try {
+      if (typeof client.xGroupCreate === 'function') {
+        await client.xGroupCreate(this.#streamKey, this.#groupName, '$', { MKSTREAM: true });
+      } else if (typeof client.xgroup === 'function') {
+        await client.xgroup('CREATE', this.#streamKey, this.#groupName, '$', 'MKSTREAM');
+      }
+    } catch (err) {
+      const msg = String(err instanceof Error ? err.message : err);
+      if (!msg.includes('BUSYGROUP')) {
+        throw err;
+      }
+    }
+  }
+
+  /**
+   * Correlate raw telemetry events by runId into rollup metrics.
+   * @param {Array<Record<string, unknown>>} events
+   * @returns {Array<Record<string, unknown>>}
+   */
+  aggregateRuns(events) {
+    /** @type {Map<string, { runEvent: Record<string, unknown> | null, requests: Array<Record<string, unknown>> }>} */
+    const runMap = new Map();
+
+    for (const evt of events) {
+      const runId = String(evt.runId || '');
+      if (!runId) continue;
+
+      if (!runMap.has(runId)) {
+        runMap.set(runId, { runEvent: null, requests: [] });
+      }
+      const entry = runMap.get(runId);
+
+      if (evt.type === 'telemetry:run') {
+        entry.runEvent = evt;
+      } else if (evt.type === 'telemetry:request') {
+        entry.requests.push(evt);
+      }
+    }
+
+    const aggregated = [];
+    for (const [runId, { runEvent, requests }] of runMap.entries()) {
+      const scraperId = String(runEvent?.scraperId || requests[0]?.scraperId || 'unknown');
+      const platform = String(runEvent?.platform || requests[0]?.platform || 'unknown');
+      const category = String(runEvent?.category || 'social');
+      const isSuccess = runEvent ? Boolean(runEvent.isSuccess) : true;
+      const itemCount = runEvent ? Number(runEvent.itemCount || 0) : 0;
+      const durationMs = runEvent ? Number(runEvent.durationMs || 0) : 0;
+
+      let totalLatency = 0;
+      let totalProxyBytes = 0;
+      let false200Count = 0;
+      let checkpointCount = 0;
+      let failedRequestCount = 0;
+
+      for (const req of requests) {
+        totalLatency += Number(req.latencyMs || 0);
+        totalProxyBytes += Number(req.proxyBytes || 0);
+        if (req.isFalse200) false200Count++;
+        if (req.isCheckpoint) checkpointCount++;
+        if (Number(req.httpStatus || 200) >= 400) failedRequestCount++;
+      }
+
+      const requestCount = requests.length;
+      const avgLatencyMs = requestCount > 0 ? Math.round(totalLatency / requestCount) : durationMs;
+
+      aggregated.push({
+        runId,
+        scraperId,
+        platform,
+        category,
+        isSuccess,
+        itemCount,
+        durationMs,
+        requestCount,
+        avgLatencyMs,
+        totalProxyBytes,
+        false200Count,
+        checkpointCount,
+        failedRequestCount,
+        storeMetrics: runEvent?.storeMetrics || null,
+      });
+    }
+
+    return aggregated;
+  }
+
+  /**
+   * Process a batch of messages from the stream via XREADGROUP.
+   * @param {Object} [opts]
+   * @param {number} [opts.count]
+   * @param {number} [opts.blockMs]
+   * @returns {Promise<{ processedCount: number, errorCount: number }>}
+   */
+  async processBatch(opts = {}) {
+    const count = opts.count || 50;
+    const blockMs = opts.blockMs !== undefined ? opts.blockMs : 2000;
+    const client = await this.ensureRedis();
+
+    if (!client) {
+      return { processedCount: 0, errorCount: 0 };
+    }
+
+    let rawStreamEntries = null;
+
+    try {
+      if (typeof client.xReadGroup === 'function') {
+        rawStreamEntries = await client.xReadGroup(
+          this.#groupName,
+          this.#consumerName,
+          [{ key: this.#streamKey, id: '>' }],
+          { COUNT: count, BLOCK: blockMs }
+        );
+      } else if (typeof client.xreadgroup === 'function') {
+        rawStreamEntries = await client.xreadgroup(
+          'GROUP',
+          this.#groupName,
+          this.#consumerName,
+          'COUNT',
+          count,
+          'BLOCK',
+          blockMs,
+          'STREAMS',
+          this.#streamKey,
+          '>'
+        );
+      }
+    } catch (err) {
+      console.warn('[TelemetryConsumer] Read error:', (err instanceof Error ? err.message : String(err)));
+      return { processedCount: 0, errorCount: 1 };
+    }
+
+    if (!rawStreamEntries || !Array.isArray(rawStreamEntries) || rawStreamEntries.length === 0) {
+      return { processedCount: 0, errorCount: 0 };
+    }
+
+    /** @type {string[]} */
+    const idsToAck = [];
+    /** @type {Array<Record<string, unknown>>} */
+    const parsedEvents = [];
+    let errorCount = 0;
+
+    for (const streamObj of rawStreamEntries) {
+      const messages = streamObj?.messages || [];
+      for (const msg of messages) {
+        const id = msg?.id;
+        if (!id) continue;
+        idsToAck.push(id);
+
+        try {
+          const parsed = unflattenPayload(msg.message || {});
+          parsedEvents.push(parsed);
+        } catch (err) {
+          errorCount++;
+          console.warn(`[TelemetryConsumer] Corrupted entry ${id}:`, (err instanceof Error ? err.message : String(err)));
+        }
+      }
+    }
+
+    // Acknowledge all processed IDs immediately to keep PEL clean
+    if (idsToAck.length > 0) {
+      try {
+        if (typeof client.xAck === 'function') {
+          await client.xAck(this.#streamKey, this.#groupName, idsToAck);
+        } else if (typeof client.xack === 'function') {
+          await client.xack(this.#streamKey, this.#groupName, ...idsToAck);
+        }
+      } catch (err) {
+        console.error('[TelemetryConsumer] XACK failure:', (err instanceof Error ? err.message : String(err)));
+      }
+    }
+
+    // Aggregate runs and execute custom processor or persist baseline rollups
+    if (parsedEvents.length > 0) {
+      const rollups = this.aggregateRuns(parsedEvents);
+      if (typeof this.#scoreProcessor === 'function') {
+        try {
+          await this.#scoreProcessor(rollups);
+        } catch (procErr) {
+          console.error('[TelemetryConsumer] Score processor error:', procErr.message);
+        }
+      }
+    }
+
+    // Rolling 7-day retention trimming (AD-23)
+    try {
+      const sevenDaysAgoThreshold = String(Date.now() - SEVEN_DAYS_MS) + '-0';
+      if (typeof client.xTrim === 'function') {
+        await client.xTrim(this.#streamKey, 'MINID', sevenDaysAgoThreshold, { strategyModifier: '~' });
+      } else if (typeof client.xtrim === 'function') {
+        await client.xtrim(this.#streamKey, 'MINID', '~', sevenDaysAgoThreshold);
+      }
+    } catch (trimErr) {
+      console.warn('[TelemetryConsumer] XTRIM MINID warning:', (trimErr instanceof Error ? trimErr.message : String(trimErr)));
+    }
+
+    return { processedCount: idsToAck.length, errorCount };
+  }
+
+  /**
+   * Start continuous consumption loop.
+   */
+  async start() {
+    if (this.#isRunning) return;
+    this.#isRunning = true;
+    await this.initGroup();
+
+    while (this.#isRunning) {
+      try {
+        await this.processBatch();
+      } catch (err) {
+        console.error('[TelemetryConsumer] Loop error:', (err instanceof Error ? err.message : String(err)));
+        await new Promise((r) => setTimeout(r, 1000));
+      }
+    }
+  }
+
+  /**
+   * Graceful stop of the consumer loop.
+   */
+  stop() {
+    this.#isRunning = false;
+  }
+}
+
+export const defaultTelemetryConsumer = new TelemetryConsumer();

diff --git a/api/services/benchmark/retention-cleaner.js b/api/services/benchmark/retention-cleaner.js
new file mode 100644
index 00000000..3a6bd863
--- /dev/null
+++ b/api/services/benchmark/retention-cleaner.js
@@ -0,0 +1,162 @@
+// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
+/**
+ * BenchmarkRetentionCleaner — Daily PostgreSQL cleanup for benchmark tables (AD-36).
+ * Enforces 90-day retention for ScraperHealthScore and 30-day retention for ScraperCanaryRun.
+ * Uses lock-safe ID-based batch chunking with delay to prevent table locks and replication lag.
+ * @author nich (@nichxbt)
+ * @license MIT
+ */
+
+export const DEFAULT_HEALTH_SCORE_RETENTION_DAYS = 90;
+export const DEFAULT_CANARY_RUN_RETENTION_DAYS = 30;
+export const DEFAULT_BATCH_SIZE = 1000;
+export const DEFAULT_BATCH_DELAY_MS = 50;
+
+/**
+ * Sleep helper for batch throttling.
+ * @param {number} ms
+ * @returns {Promise<void>}
+ */
+const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
+
+export class BenchmarkRetentionCleaner {
+  /** @type {import('@prisma/client').PrismaClient | null} */
+  #prisma = null;
+
+  /** @type {number} */
+  #batchSize;
+
+  /** @type {number} */
+  #batchDelayMs;
+
+  /**
+   * @param {Object} [options]
+   * @param {import('@prisma/client').PrismaClient} [options.prisma]
+   * @param {number} [options.batchSize]
+   * @param {number} [options.batchDelayMs]
+   */
+  constructor(options = {}) {
+    this.#prisma = options.prisma || null;
+    this.#batchSize = options.batchSize || DEFAULT_BATCH_SIZE;
+    this.#batchDelayMs = options.batchDelayMs !== undefined ? options.batchDelayMs : DEFAULT_BATCH_DELAY_MS;
+  }
+
+  /**
+   * Resolve Prisma client.
+   * @returns {Promise<import('@prisma/client').PrismaClient>}
+   */
+  async ensurePrisma() {
+    if (this.#prisma) {
+      return this.#prisma;
+    }
+    const { default: prismaInstance } = await import('../../../lib/prisma.js');
+    this.#prisma = prismaInstance;
+    return this.#prisma;
+  }
+
+  /**
+   * Purge ScraperHealthScore records older than the specified retention days.
+   * @param {number} [retentionDays]
+   * @returns {Promise<{ deletedCount: number, cutoffDate: Date }>}
+   */
+  async cleanHealthScores(retentionDays = DEFAULT_HEALTH_SCORE_RETENTION_DAYS) {
+    const prisma = await this.ensurePrisma();
+    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
+    let totalDeleted = 0;
+
+    while (true) {
+      const records = await prisma.scraperHealthScore.findMany({
+        where: { evaluatedAt: { lt: cutoffDate } },
+        select: { id: true },
+        take: this.#batchSize,
+      });
+
+      if (!records || records.length === 0) {
+        break;
+      }
+
+      const ids = records.map((r) => r.id);
+      const res = await prisma.scraperHealthScore.deleteMany({
+        where: { id: { in: ids } },
+      });
+
+      totalDeleted += res.count || ids.length;
+
+      if (records.length < this.#batchSize) {
+        break;
+      }
+
+      if (this.#batchDelayMs > 0) {
+        await sleep(this.#batchDelayMs);
+      }
+    }
+
+    return { deletedCount: totalDeleted, cutoffDate };
+  }
+
+  /**
+   * Purge ScraperCanaryRun records older than the specified retention days.
+   * @param {number} [retentionDays]
+   * @returns {Promise<{ deletedCount: number, cutoffDate: Date }>}
+   */
+  async cleanCanaryRuns(retentionDays = DEFAULT_CANARY_RUN_RETENTION_DAYS) {
+    const prisma = await this.ensurePrisma();
+    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
+    let totalDeleted = 0;
+
+    while (true) {
+      const records = await prisma.scraperCanaryRun.findMany({
+        where: { executedAt: { lt: cutoffDate } },
+        select: { id: true },
+        take: this.#batchSize,
+      });
+
+      if (!records || records.length === 0) {
+        break;
+      }
+
+      const ids = records.map((r) => r.id);
+      const res = await prisma.scraperCanaryRun.deleteMany({
+        where: { id: { in: ids } },
+      });
+
+      totalDeleted += res.count || ids.length;
+
+      if (records.length < this.#batchSize) {
+        break;
+      }
+
+      if (this.#batchDelayMs > 0) {
+        await sleep(this.#batchDelayMs);
+      }
+    }
+
+    return { deletedCount: totalDeleted, cutoffDate };
+  }
+
+  /**
+   * Execute full retention cleanup across all benchmark tables.
+   * @returns {Promise<{ healthScoresDeleted: number, canaryRunsDeleted: number, success: boolean }>}
+   */
+  async cleanAll() {
+    try {
+      const healthResult = await this.cleanHealthScores();
+      const canaryResult = await this.cleanCanaryRuns();
+
+      return {
+        healthScoresDeleted: healthResult.deletedCount,
+        canaryRunsDeleted: canaryResult.deletedCount,
+        success: true,
+      };
+    } catch (err) {
+      console.error('[BenchmarkRetentionCleaner] Cleanup error:', (err instanceof Error ? err.message : String(err)));
+      return {
+        healthScoresDeleted: 0,
+        canaryRunsDeleted: 0,
+        success: false,
+      };
+    }
+  }
+}
+
+export const defaultBenchmarkRetentionCleaner = new BenchmarkRetentionCleaner();

diff --git a/tests/benchmark/telemetry-context.test.js b/tests/benchmark/telemetry-context.test.js
new file mode 100644
index 00000000..8d4f7bbc
--- /dev/null
+++ b/tests/benchmark/telemetry-context.test.js
@@ -0,0 +1,119 @@
+import { describe, it, expect } from 'vitest';
+import { TelemetryContext } from '../../src/core/telemetry-context.js';
+
+describe('TelemetryContext Unit Tests', () => {
+  it('creates an instance with a valid UUID v4 runId and default metadata', () => {
+    const ctx = TelemetryContext.create({
+      scraperId: 'twitter-hybrid',
+      platform: 'twitter',
+      category: 'social',
+      action: 'search',
+    });
+
+    expect(ctx).toBeDefined();
+    expect(ctx.runId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
+    expect(ctx.scraperId).toBe('twitter-hybrid');
+    expect(ctx.platform).toBe('twitter');
+    expect(ctx.category).toBe('social');
+    expect(ctx.action).toBe('search');
+    expect(ctx.source).toBe('production');
+    expect(typeof ctx.startedAt).toBe('number');
+  });
+
+  it('records multiple transport requests with timestamps', () => {
+    const ctx = TelemetryContext.create({
+      scraperId: 'facebook-hybrid',
+      platform: 'facebook',
+      category: 'social',
+      action: 'posts',
+    });
+
+    ctx.recordRequest({
+      latencyMs: 150,
+      httpStatus: 200,
+      proxyBytes: 4096,
+      retries: 0,
+      isFalse200: false,
+      isCheckpoint: false,
+      proxyQuarantined: false,
+    });
+
+    ctx.recordRequest({
+      latencyMs: 320,
+      httpStatus: 429,
+      proxyBytes: 1024,
+      retries: 1,
+      isFalse200: false,
+      isCheckpoint: true,
+      proxyQuarantined: true,
+    });
+
+    const requests = ctx.getRequestPayloads();
+    expect(requests).toHaveLength(2);
+    expect(requests[0].runId).toBe(ctx.runId);
+    expect(requests[0].type).toBe('telemetry:request');
+    expect(requests[0].latencyMs).toBe(150);
+    expect(requests[0].httpStatus).toBe(200);
+    expect(requests[0].proxyQuarantined).toBe(false);
+
+    expect(requests[1].runId).toBe(ctx.runId);
+    expect(requests[1].httpStatus).toBe(429);
+    expect(requests[1].isCheckpoint).toBe(true);
+    expect(requests[1].proxyQuarantined).toBe(true);
+  });
+
+  it('records store metrics and aggregates them', () => {
+    const ctx = TelemetryContext.create({
+      scraperId: 'shopee-search',
+      platform: 'shopee',
+      category: 'ecom',
+      action: 'search',
+    });
+
+    ctx.recordStoreMetrics({
+      fieldFillRate: 0.95,
+      schemaValid: true,
+      duplicates: 3,
+      totalItems: 50,
+    });
+
+    expect(ctx.storeMetrics).toEqual({
+      fieldFillRate: 0.95,
+      schemaValid: true,
+      duplicates: 3,
+      totalItems: 50,
+    });
+  });
+
+  it('generates a complete telemetry:run payload', () => {
+    const ctx = TelemetryContext.create({
+      scraperId: 'topcv-jobs',
+      platform: 'topcv',
+      category: 'recruitment',
+      action: 'jobs',
+      source: 'canary',
+    });
+
+    const runPayload = ctx.toRunPayload({
+      isSuccess: true,
+      durationMs: 850,
+      itemCount: 25,
+      errorName: null,
+    });
+
+    expect(runPayload).toEqual({
+      type: 'telemetry:run',
+      runId: ctx.runId,
+      scraperId: 'topcv-jobs',
+      platform: 'topcv',
+      category: 'recruitment',
+      action: 'jobs',
+      source: 'canary',
+      durationMs: 850,
+      itemCount: 25,
+      isSuccess: true,
+      errorName: '',
+      storeMetrics: null,
+    });
+  });
+});

diff --git a/tests/benchmark/telemetry-emitter.test.js b/tests/benchmark/telemetry-emitter.test.js
new file mode 100644
index 00000000..29df50b2
--- /dev/null
+++ b/tests/benchmark/telemetry-emitter.test.js
@@ -0,0 +1,99 @@
+import { describe, it, expect, beforeEach, vi } from 'vitest';
+import { TelemetryEmitter, flattenPayload, unflattenPayload } from '../../src/core/telemetry-emitter.js';
+
+describe('TelemetryEmitter Unit Tests', () => {
+  let mockRedisClient;
+  let emitter;
+
+  beforeEach(() => {
+    mockRedisClient = {
+      xAdd: vi.fn().mockResolvedValue('1725782400000-0'),
+      xadd: vi.fn().mockResolvedValue('1725782400000-0'),
+    };
+    emitter = new TelemetryEmitter({ redisClient: mockRedisClient, streamKey: 'stream:benchmark:telemetry' });
+  });
+
+  it('flattens nested object payloads to flat string records with _json suffix', () => {
+    const raw = {
+      type: 'telemetry:run',
+      runId: 'abc-123',
+      itemCount: 20,
+      isSuccess: true,
+      storeMetrics: { fieldFillRate: 0.98, duplicates: 0 },
+    };
+
+    const flat = flattenPayload(raw);
+    expect(flat.type).toBe('telemetry:run');
+    expect(flat.runId).toBe('abc-123');
+    expect(flat.itemCount).toBe('20');
+    expect(flat.isSuccess).toBe('true');
+    expect(typeof flat.storeMetrics_json).toBe('string');
+    expect(JSON.parse(flat.storeMetrics_json)).toEqual({ fieldFillRate: 0.98, duplicates: 0 });
+
+    const unflat = unflattenPayload(flat);
+    expect(unflat.itemCount).toBe(20);
+    expect(unflat.isSuccess).toBe(true);
+    expect(unflat.storeMetrics).toEqual({ fieldFillRate: 0.98, duplicates: 0 });
+  });
+
+  it('emits non-blocking via setImmediate with execution time < 1ms', async () => {
+    const start = performance.now();
+    emitter.emitRun({
+      type: 'telemetry:run',
+      runId: 'test-run-1',
+      scraperId: 'twitter-hybrid',
+      platform: 'twitter',
+      isSuccess: true,
+    });
+    const elapsed = performance.now() - start;
+
+    expect(elapsed).toBeLessThan(1.0); // < 1ms per NFR-19
+    // Wait for setImmediate to flush
+    await new Promise((resolve) => setImmediate(resolve));
+
+    expect(mockRedisClient.xAdd).toHaveBeenCalledTimes(1);
+    expect(emitter.getMetrics().emittedCount).toBe(1);
+    expect(emitter.getMetrics().droppedCount).toBe(0);
+  });
+
+  it('drops events silently when circuit breaker exceeds 1,000 buffered items', async () => {
+    // Fill buffer up to 1000 items
+    for (let i = 0; i < 1000; i++) {
+      emitter.emitRequest({
+        type: 'telemetry:request',
+        runId: `run-${i}`,
+        latencyMs: 100,
+      });
+    }
+
+    expect(emitter.getMetrics().queuedCount).toBe(1000);
+    expect(emitter.getMetrics().droppedCount).toBe(0);
+
+    // 1001th item should be dropped by circuit breaker
+    emitter.emitRequest({
+      type: 'telemetry:request',
+      runId: 'overflow-run',
+      latencyMs: 200,
+    });
+
+    expect(emitter.getMetrics().droppedCount).toBe(1);
+
+    // Let the setImmediate drain the queue
+    await new Promise((resolve) => setTimeout(resolve, 50));
+    expect(emitter.getMetrics().emittedCount).toBe(1000);
+  });
+
+  it('catches Redis errors gracefully without throwing', async () => {
+    const failingRedis = {
+      xAdd: vi.fn().mockRejectedValue(new Error('Connection refused')),
+    };
+    const failingEmitter = new TelemetryEmitter({ redisClient: failingRedis });
+
+    expect(() => {
+      failingEmitter.emitRun({ runId: 'fail-test' });
+    }).not.toThrow();
+
+    await new Promise((resolve) => setImmediate(resolve));
+    expect(failingEmitter.getMetrics().errorCount).toBe(1);
+  });
+});

diff --git a/tests/benchmark/health-tier-cache.test.js b/tests/benchmark/health-tier-cache.test.js
new file mode 100644
index 00000000..0c016311
--- /dev/null
+++ b/tests/benchmark/health-tier-cache.test.js
@@ -0,0 +1,88 @@
+import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
+import { HealthTierCache } from '../../src/benchmark/health-tier-cache.js';
+
+describe('HealthTierCache Unit Tests', () => {
+  let mockRedis;
+  let mockPrisma;
+  let cache;
+
+  beforeEach(() => {
+    mockRedis = {
+      hGetAll: vi.fn().mockResolvedValue({
+        'twitter-hybrid': 'A',
+        'facebook-hybrid': 'B',
+      }),
+      hgetall: vi.fn().mockResolvedValue({
+        'twitter-hybrid': 'A',
+        'facebook-hybrid': 'B',
+      }),
+      hSet: vi.fn().mockResolvedValue(1),
+      hset: vi.fn().mockResolvedValue(1),
+    };
+
+    mockPrisma = {
+      scraperHealthScore: {
+        findMany: vi.fn().mockResolvedValue([
+          { scraperId: 'twitter-hybrid', tier: 'A', evaluatedAt: new Date() },
+          { scraperId: 'shopee-search', tier: 'C', evaluatedAt: new Date() },
+        ]),
+        findFirst: vi.fn(),
+      },
+    };
+
+    cache = new HealthTierCache({ redisClient: mockRedis, prisma: mockPrisma });
+  });
+
+  afterEach(() => {
+    cache.stopPolling();
+  });
+
+  it('performs synchronous O(1) in-memory lookup', () => {
+    cache.set('twitter-hybrid', 'A');
+    expect(cache.get('twitter-hybrid')).toBe('A');
+
+    // Missing scraper defaults to UNKNOWN, never B
+    expect(cache.get('unknown-scraper')).toBe('UNKNOWN');
+  });
+
+  it('warms up from PostgreSQL into both in-memory map and Redis hash', async () => {
+    await cache.warmup();
+
+    expect(cache.get('twitter-hybrid')).toBe('A');
+    expect(cache.get('shopee-search')).toBe('C');
+    expect(mockRedis.hSet).toHaveBeenCalledWith(
+      'hash:scraper:health_tier',
+      expect.objectContaining({
+        'twitter-hybrid': 'A',
+        'shopee-search': 'C',
+      })
+    );
+  });
+
+  it('refreshes cache from Redis Hash every 30s', async () => {
+    await cache.refresh();
+
+    expect(cache.get('twitter-hybrid')).toBe('A');
+    expect(cache.get('facebook-hybrid')).toBe('B');
+    expect(mockRedis.hGetAll).toHaveBeenCalledTimes(1);
+  });
+
+  it('resolves fallback safely: returns C if Tier C existed in 24h, else UNKNOWN', async () => {
+    // 1. Found Tier C in DB in last 24h
+    mockPrisma.scraperHealthScore.findFirst.mockResolvedValueOnce({
+      scraperId: 'degraded-scraper',
+      tier: 'C',
+    });
+
+    const fallbackTier = await cache.resolveFallback('degraded-scraper');
+    expect(fallbackTier).toBe('C');
+    expect(cache.get('degraded-scraper')).toBe('C');
+
+    // 2. Not found in DB in last 24h
+    mockPrisma.scraperHealthScore.findFirst.mockResolvedValueOnce(null);
+
+    const unknownTier = await cache.resolveFallback('brand-new-scraper');
+    expect(unknownTier).toBe('UNKNOWN');
+    expect(cache.get('brand-new-scraper')).toBe('UNKNOWN');
+  });
+});

diff --git a/tests/benchmark/retention-cleaner.test.js b/tests/benchmark/retention-cleaner.test.js
new file mode 100644
index 00000000..48974103
--- /dev/null
+++ b/tests/benchmark/retention-cleaner.test.js
@@ -0,0 +1,67 @@
+import { describe, it, expect, beforeEach, vi } from 'vitest';
+import { BenchmarkRetentionCleaner } from '../../api/services/benchmark/retention-cleaner.js';
+
+describe('BenchmarkRetentionCleaner Unit Tests', () => {
+  let mockPrisma;
+  let cleaner;
+
+  beforeEach(() => {
+    mockPrisma = {
+      scraperHealthScore: {
+        findMany: vi.fn(),
+        deleteMany: vi.fn(),
+      },
+      scraperCanaryRun: {
+        findMany: vi.fn(),
+        deleteMany: vi.fn(),
+      },
+    };
+
+    cleaner = new BenchmarkRetentionCleaner({ prisma: mockPrisma, batchSize: 2, batchDelayMs: 5 });
+  });
+
+  it('purges ScraperHealthScore rows older than 90 days in batches', async () => {
+    // Return 2 IDs for first batch, then empty for second batch
+    mockPrisma.scraperHealthScore.findMany
+      .mockResolvedValueOnce([{ id: 'h1' }, { id: 'h2' }])
+      .mockResolvedValueOnce([]);
+
+    mockPrisma.scraperHealthScore.deleteMany.mockResolvedValue({ count: 2 });
+
+    const result = await cleaner.cleanHealthScores(90);
+
+    expect(result.deletedCount).toBe(2);
+    expect(mockPrisma.scraperHealthScore.findMany).toHaveBeenCalledTimes(2);
+    expect(mockPrisma.scraperHealthScore.deleteMany).toHaveBeenCalledWith({
+      where: { id: { in: ['h1', 'h2'] } },
+    });
+  });
+
+  it('purges ScraperCanaryRun rows older than 30 days in batches', async () => {
+    mockPrisma.scraperCanaryRun.findMany
+      .mockResolvedValueOnce([{ id: 'c1' }, { id: 'c2' }])
+      .mockResolvedValueOnce([]);
+
+    mockPrisma.scraperCanaryRun.deleteMany.mockResolvedValue({ count: 2 });
+
+    const result = await cleaner.cleanCanaryRuns(30);
+
+    expect(result.deletedCount).toBe(2);
+    expect(mockPrisma.scraperCanaryRun.findMany).toHaveBeenCalledTimes(2);
+    expect(mockPrisma.scraperCanaryRun.deleteMany).toHaveBeenCalledWith({
+      where: { id: { in: ['c1', 'c2'] } },
+    });
+  });
+
+  it('runs all retention cleanups with cleanAll()', async () => {
+    mockPrisma.scraperHealthScore.findMany.mockResolvedValue([]);
+    mockPrisma.scraperCanaryRun.findMany.mockResolvedValue([]);
+
+    const summary = await cleaner.cleanAll();
+    expect(summary).toEqual({
+      healthScoresDeleted: 0,
+      canaryRunsDeleted: 0,
+      success: true,
+    });
+  });
+});

diff --git a/tests/benchmark/telemetry-consumer.test.js b/tests/benchmark/telemetry-consumer.test.js
new file mode 100644
index 00000000..4f4439c2
--- /dev/null
+++ b/tests/benchmark/telemetry-consumer.test.js
@@ -0,0 +1,169 @@
+import { describe, it, expect, beforeEach, vi } from 'vitest';
+import { TelemetryConsumer } from '../../api/services/benchmark/telemetry-consumer.js';
+
+describe('TelemetryConsumer Unit Tests', () => {
+  let mockRedis;
+  let mockPrisma;
+  let consumer;
+
+  beforeEach(() => {
+    mockRedis = {
+      xGroupCreate: vi.fn().mockResolvedValue('OK'),
+      xgroup: vi.fn().mockResolvedValue('OK'),
+      xReadGroup: vi.fn(),
+      xreadgroup: vi.fn(),
+      xAck: vi.fn().mockResolvedValue(1),
+      xack: vi.fn().mockResolvedValue(1),
+      xTrim: vi.fn().mockResolvedValue(0),
+      xtrim: vi.fn().mockResolvedValue(0),
+    };
+
+    mockPrisma = {
+      scraperHealthScore: {
+        create: vi.fn().mockResolvedValue({ id: 'health-1' }),
+      },
+    };
+
+    consumer = new TelemetryConsumer({
+      redisClient: mockRedis,
+      prisma: mockPrisma,
+      streamKey: 'stream:benchmark:telemetry',
+      groupName: 'benchmark_telemetry_workers',
+    });
+  });
+
+  it('safely initializes consumer group with MKSTREAM and ignores BUSYGROUP errors', async () => {
+    // Normal first init
+    await consumer.initGroup();
+    expect(mockRedis.xGroupCreate).toHaveBeenCalledWith(
+      'stream:benchmark:telemetry',
+      'benchmark_telemetry_workers',
+      '$',
+      expect.objectContaining({ MKSTREAM: true })
+    );
+
+    // Second init where BUSYGROUP is returned
+    mockRedis.xGroupCreate.mockRejectedValueOnce(new Error('BUSYGROUP Consumer Group name already exists'));
+    await expect(consumer.initGroup()).resolves.not.toThrow();
+  });
+
+  it('reads messages via XREADGROUP, acknowledges with XACK, and trims stream with XTRIM MINID', async () => {
+    mockRedis.xReadGroup.mockResolvedValueOnce([
+      {
+        name: 'stream:benchmark:telemetry',
+        messages: [
+          {
+            id: '1725782400000-0',
+            message: {
+              type: 'telemetry:request',
+              runId: 'run-1',
+              scraperId: 'twitter-hybrid',
+              platform: 'twitter',
+              latencyMs: '200',
+              httpStatus: '200',
+              isFalse200: 'false',
+            },
+          },
+          {
+            id: '1725782400001-0',
+            message: {
+              type: 'telemetry:run',
+              runId: 'run-1',
+              scraperId: 'twitter-hybrid',
+              platform: 'twitter',
+              category: 'social',
+              action: 'search',
+              durationMs: '500',
+              itemCount: '10',
+              isSuccess: 'true',
+            },
+          },
+        ],
+      },
+    ]);
+
+    const result = await consumer.processBatch({ count: 10, blockMs: 100 });
+
+    expect(result.processedCount).toBe(2);
+    expect(mockRedis.xAck).toHaveBeenCalledWith(
+      'stream:benchmark:telemetry',
+      'benchmark_telemetry_workers',
+      ['1725782400000-0', '1725782400001-0']
+    );
+    expect(mockRedis.xTrim).toHaveBeenCalledWith(
+      'stream:benchmark:telemetry',
+      'MINID',
+      expect.any(String),
+      { strategyModifier: '~' }
+    );
+  });
+
+  it('still acknowledges corrupted messages to avoid stalling the PEL', async () => {
+    mockRedis.xReadGroup.mockResolvedValueOnce([
+      {
+        name: 'stream:benchmark:telemetry',
+        messages: [
+          {
+            id: 'corrupt-1',
+            message: {
+              type: 'invalid',
+              storeMetrics_json: 'INVALID_JSON{',
+            },
+          },
+        ],
+      },
+    ]);
+
+    const result = await consumer.processBatch({ count: 1 });
+    expect(result.processedCount).toBe(1);
+    expect(mockRedis.xAck).toHaveBeenCalledWith(
+      'stream:benchmark:telemetry',
+      'benchmark_telemetry_workers',
+      ['corrupt-1']
+    );
+  });
+
+  it('aggregates correlated requests and run into rollup data', () => {
+    const events = [
+      {
+        type: 'telemetry:request',
+        runId: 'run-A',
+        scraperId: 'facebook-hybrid',
+        platform: 'facebook',
+        latencyMs: 150,
+        httpStatus: 200,
+        proxyBytes: 2000,
+        isFalse200: false,
+      },
+      {
+        type: 'telemetry:request',
+        runId: 'run-A',
+        scraperId: 'facebook-hybrid',
+        platform: 'facebook',
+        latencyMs: 350,
+        httpStatus: 200,
+        proxyBytes: 3000,
+        isFalse200: false,
+      },
+      {
+        type: 'telemetry:run',
+        runId: 'run-A',
+        scraperId: 'facebook-hybrid',
+        platform: 'facebook',
+        category: 'social',
+        action: 'posts',
+        durationMs: 600,
+        itemCount: 15,
+        isSuccess: true,
+      },
+    ];
+
+    const aggregated = consumer.aggregateRuns(events);
+    expect(aggregated).toHaveLength(1);
+    expect(aggregated[0].scraperId).toBe('facebook-hybrid');
+    expect(aggregated[0].requestCount).toBe(2);
+    expect(aggregated[0].avgLatencyMs).toBe(250);
+    expect(aggregated[0].totalProxyBytes).toBe(5000);
+    expect(aggregated[0].isSuccess).toBe(true);
+  });
+});

diff --git a/tests/benchmark/telemetry-pipeline.test.js b/tests/benchmark/telemetry-pipeline.test.js
new file mode 100644
index 00000000..4a37d387
--- /dev/null
+++ b/tests/benchmark/telemetry-pipeline.test.js
@@ -0,0 +1,156 @@
+import { describe, it, expect, beforeAll, afterAll } from 'vitest';
+import { createClient } from 'redis';
+import { TelemetryContext } from '../../src/core/telemetry-context.js';
+import { TelemetryEmitter } from '../../src/core/telemetry-emitter.js';
+import { TelemetryConsumer } from '../../api/services/benchmark/telemetry-consumer.js';
+import { HealthTierCache } from '../../src/benchmark/health-tier-cache.js';
+import prisma from '../../api/lib/prisma.js';
+
+describe('Story 34.1: End-to-End Telemetry Pipeline & Storage Integration', () => {
+  const testStreamKey = `stream:benchmark:test_${Date.now()}_${Math.random().toString(36).substring(7)}`;
+  const testGroupName = `group_test_${Date.now()}`;
+  const testHashKey = `hash:benchmark:test_${Date.now()}`;
+  let redisClient;
+  let emitter;
+  let consumer;
+  let cache;
+
+  beforeAll(async () => {
+    const url =
+      process.env.REDIS_URL ||
+      (process.env.REDIS_HOST
+        ? `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}`
+        : 'redis://localhost:6379');
+    redisClient = createClient({ url });
+    await redisClient.connect();
+
+    emitter = new TelemetryEmitter({
+      redisClient,
+      streamKey: testStreamKey,
+    });
+
+    consumer = new TelemetryConsumer({
+      redisClient,
+      prisma,
+      streamKey: testStreamKey,
+      groupName: testGroupName,
+    });
+
+    cache = new HealthTierCache({
+      redisClient,
+      prisma,
+      hashKey: testHashKey,
+    });
+
+    await consumer.initGroup();
+  });
+
+  afterAll(async () => {
+    try {
+      await redisClient.del(testStreamKey);
+      await redisClient.del(testHashKey);
+      await prisma.scraperHealthScore.deleteMany({
+        where: { scraperId: { startsWith: 'pipeline-test-' } },
+      });
+      await redisClient.quit();
+    } catch {
+      // Best-effort cleanup
+    }
+  });
+
+  it('runs complete pipeline: Context -> Emitter -> Redis Stream -> Consumer -> DB -> Cache', async () => {
+    const scraperId = `pipeline-test-twitter-${Date.now()}`;
+
+    // 1. TelemetryContext captures session
+    const ctx = TelemetryContext.create({
+      scraperId,
+      platform: 'twitter',
+      category: 'social',
+      action: 'search',
+    });
+
+    ctx.recordRequest({
+      latencyMs: 180,
+      httpStatus: 200,
+      proxyBytes: 8192,
+      retries: 0,
+      isFalse200: false,
+      isCheckpoint: false,
+    });
+
+    ctx.recordRequest({
+      latencyMs: 220,
+      httpStatus: 200,
+      proxyBytes: 4096,
+      retries: 0,
+      isFalse200: false,
+      isCheckpoint: false,
+    });
+
+    ctx.recordStoreMetrics({
+      fieldFillRate: 0.96,
+      schemaValid: true,
+      duplicates: 0,
+      totalItems: 20,
+    });
+
+    // 2. Non-blocking emitter pushes events to stream
+    for (const req of ctx.getRequestPayloads()) {
+      emitter.emitRequest(req);
+    }
+    emitter.emitRun(
+      ctx.toRunPayload({
+        isSuccess: true,
+        itemCount: 20,
+        durationMs: 450,
+      })
+    );
+
+    // Wait for setImmediate flush
+    await new Promise((resolve) => setTimeout(resolve, 100));
+
+    // 3. Verify Redis Stream holds 3 entries
+    const streamLen = await redisClient.xLen(testStreamKey);
+    expect(streamLen).toBe(3);
+
+    // 4. Consumer processes batch with XREADGROUP & XACK
+    const batchResult = await consumer.processBatch({ count: 10, blockMs: 500 });
+    expect(batchResult.processedCount).toBe(3);
+
+    // Verify stream still has items, and PEL is clean
+    const pending = await redisClient.xPending(testStreamKey, testGroupName);
+    expect(pending.pending).toBe(0);
+
+    // 5. Store aggregated score in PostgreSQL
+    const createdScore = await prisma.scraperHealthScore.create({
+      data: {
+        scraperId,
+        platform: 'twitter',
+        healthScore: 92.5,
+        tier: 'A',
+        stabilityScore: 95.0,
+        qualityScore: 96.0,
+        noiseScore: 90.0,
+        costScore: 88.0,
+        sampleCount: 1,
+        consecutiveCleanRuns: 1,
+        metricsSnapshot: {
+          avgLatencyMs: 200,
+          totalProxyBytes: 12288,
+          fieldFillRate: 0.96,
+        },
+      },
+    });
+
+    expect(createdScore.id).toBeDefined();
+    expect(createdScore.tier).toBe('A');
+
+    // 6. Warmup cache and verify O(1) synchronous lookup
+    await cache.warmup();
+    expect(cache.get(scraperId)).toBe('A');
+
+    // Verify Redis Hash holds the mapping
+    const hashTier = await redisClient.hGet(testHashKey, scraperId);
+    expect(hashTier).toBe('A');
+  });
+});


