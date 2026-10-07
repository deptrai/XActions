# Adversarial Seam Review: Epic 34 — Scraper Benchmark & Reliability Suite

**Reviewer Role:** Adversarial Seam Reviewer (BMad Architecture Reviewer Gate)  
**Date:** 2026-09-08  
**Status:** PASS WITH REVISIONS (Architectural Seams Identified)  
**Target Architecture:** `_bmad-output/planning-artifacts/architecture/xactions-benchmark-epic34/ARCHITECTURE-SPINE.md`  
**Referenced Specifications:**
- `_bmad-output/specs/spec-scraper-benchmark/SPEC.md`
- `_bmad-output/specs/spec-scraper-benchmark/metrics-catalog.md`
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` (Parent AD-1 to AD-22)
- Story Files: `_bmad-output/implementation-artifacts/stories/34-*.md` (Stories 34.1 to 34.8)
- Existing Codebase: `src/core/base-crawler.js`, `src/core/base-client.js`, `src/core/platform-validator.js`, `src/utils/redis-stream-publisher.js`, `src/store/prisma-store.js`, `src/store/store-with-redis.js`, `prisma/schema.prisma`

---

## 1. Executive Verdict

**Verdict: PASS WITH REVISIONS**

The architectural spine for Epic 34 provides a strong high-level conceptual framework (4-pillar scoring, non-compensatory knock-out gates, two-tier telemetry, and alert-only Tier C policy). However, when attacking the spine as an adversary constructing pairs of implementation units one level down, **six major architectural seams** emerge where two teams or stories, each strictly obeying every current Architectural Decision (AD-23 through AD-28 and parent ADs), will produce colliding, incompatible, or silent-failing implementations.

The most critical vulnerabilities are:
1. **The Telemetry Payload Decomposition Seam (Story 34.1 vs 34.2 vs metrics-catalog.md):** `AbstractCrawler.start()` has no runtime visibility into HTTP transport metrics (`proxy_bytes`, `http_status`, `retries`) or downstream data metrics (`field_fill_rate`, `schema_integrity`), and Redis `XADD` will serialize nested objects into unusable `"[object Object]"` strings unless a unified wire contract is enforced.
2. **Validator Contract vs Scoring Metric Naming Seam (Story 34.3 vs 34.4 vs 34.1):** Naming and interface divergence across `false200Detected`, `false_200`, and `false_200_rate` will cause knock-out gates to evaluate undefined metrics and fail open.
3. **Dual Ownership of Tier Mutation & Re-qualification Race (Story 34.4 vs 34.8):** Hourly aggregate scoring and per-run re-qualification promotion race to mutate `hash:scraper:health_tier` with no shared state machine.
4. **Cache Invalidation & Cold-Start Failure Masking (Story 34.4 vs 34.6):** Uncached scrapers default to Tier B, silently masking failing Tier C scrapers on Redis restarts or worker cold starts.
5. **Thin Event Enrichment Path Disconnect (Story 34.6 vs PrismaStore vs StoreWithRedis):** Story 34.6 targets `src/store/prisma-store.js`, which contains zero Redis publishing logic, and injects asynchronous lookups into a synchronous payload formatter.
6. **Heterogeneous Handler Return Shapes in Item Extraction (Story 34.2 vs Platform Crawlers):** Simple `Array.isArray()` checks collapse object returns (`{ posts, cursor }`) to `itemCount: 1`, skewing all per-1k-record cost and noise formulas.

To reach production readiness, the spine must be tightened with **new architectural decisions (AD-29 through AD-34)** and explicit normative contracts.

---

## 2. Critical Divergence Holes

### Seam 1: Telemetry Payload Schema & Serialization Mismatch
- **Conflicting Units:** Story 34.1 (`ScraperHealthScore` & Redis stream consumer) vs Story 34.2 (`AbstractCrawler.start()` hooks) vs `metrics-catalog.md`.
- **Governing ADs:** AD-23 (Two-Tier Telemetry Architecture), AD-24 (Non-Blocking Telemetry Emission), AD-25 (Centralized Instrumentation).
- **The Divergence:**
  1. *Serialization Breakdown in Redis:* Redis Streams (`XADD`) store flat field-value string pairs. `RedisStreamPublisher` in `src/utils/redis-stream-publisher.js` executes `Object.entries(payload).flat()`. In `metrics-catalog.md` (lines 106-139 and 198-231), the telemetry schema is deeply nested:
     ```json
     {
       "stability": { "latency_ms": 320, "http_status": 200, "retry_count": 0 },
       "quality": { "field_fill_rate": 0.94, "schema_integrity": 0.98 },
       "noise": { "empty_result": false, "false_200": false },
       "cost": { "proxy_bytes": 45120 }
     }
     ```
     If Story 34.2 emits this nested object directly via `XADD`, Redis stores `"stability": "[object Object]"`. The scoring consumer in Story 34.4 reading `stream:benchmark:telemetry` cannot parse sub-fields and crashes or reads `NaN`.
  2. *Runtime Visibility Disconnect (Scope Blindness):* AD-25 states that instrumentation is confined to `AbstractCrawler.start()` and `AbstractApiClient.request()`. But at the level of `AbstractCrawler.start()`:
     - `proxy_bytes`, `http_status`, and `retry_count` exist only inside `AbstractApiClient.request()`.
     - `field_fill_rate` and `schema_integrity` exist only after batch insertion in `src/store/prisma-store.js`.
     - `AbstractCrawler.start()` only knows `startTime`, `durationMs`, and whether `entry.handler()` threw an exception.
  3. If Team 34.2 instruments `AbstractCrawler.start()` with the flat sample shown in Story 34.2 (`{ action, durationMs, itemCount, error, session }`), Team 34.4 (implementing `scoring-engine.js`) will find that none of the 13 metrics from `metrics-catalog.md` are present in the stream.
- **Why Current ADs Fail to Prevent It:** AD-23 specifies *where* data is stored (Redis Stream + PostgreSQL) but does not specify the wire envelope, payload flattening rule, or how client-level transport telemetry correlates with crawl-level execution telemetry.
- **Remediation Required (AD-29):** Formally define a two-phase correlated telemetry envelope:
  - `telemetry:request` emitted by `AbstractApiClient.request()` with transport metrics (`proxyBytes`, `statusCode`, `latencyMs`, `retryCount`, `false200Detected`).
  - `telemetry:run` emitted by `AbstractCrawler.start()` with execution context (`runId`, `scraperId`, `action`, `itemCount`, `durationMs`, `success`).
  - Flattening/JSON-stringification rules for Redis `XADD`.

---

### Seam 2: Structural Validator Contract vs Scoring Metric Naming
- **Conflicting Units:** Story 34.3 (`AbstractPlatformResponseValidator` extensions) vs Story 34.4 (`scoring-engine.js` knock-out gates) vs Story 34.1 (`ScraperCanaryRun`).
- **Governing ADs:** AD-9 (Anti-Bot Payload Validation), AD-26 (Hard Knock-Out Gates).
- **The Divergence:**
  - Story 34.3 implements `isFalse200()` returning `{ false200Detected: boolean, reason: string }` and `isCheckpoint()` returning `{ checkpointDetected: boolean, reason: string }`.
  - Story 34.1's Prisma schema specifies `false200Detected Boolean` and `checkpointDetected Boolean` in `ScraperCanaryRun`.
  - `metrics-catalog.md` defines metrics under snake_case: `noise.false_200`, `stability.checkpoint_triggered`, and gate condition `false_200_rate > 0.15`.
  - Story 34.4 checks `KNOCK_OUT_GATES`:
    ```javascript
    { name: 'false_200_rate', condition: v => v > 0.15, reason: 'False 200 Rate > 15%' }
    ```
  - Story 34.2 hooks `entry.handler(command.args, session)` in `base-crawler.js`. `base-crawler.js` does NOT hold a reference to `this.responseValidator`—the validator belongs to `AbstractApiClient` inside `base-client.js`.
  - Result: The validator detects a False-200 in the HTTP response body, but `AbstractCrawler.start()` has no contract to receive that flag from `AbstractApiClient`. The emitted telemetry event omits `false200Detected`. In `scoring-engine.js`, `false_200_rate` evaluates to `0 / total = 0.00`. The hard knock-out gate NEVER triggers, and poisoned 200 OK scrape data is scored as 100% healthy.
- **Why Current ADs Fail to Prevent It:** AD-9 defines the validator role for anti-bot detection; AD-26 defines the mathematical knock-out thresholds. No AD establishes the propagation contract between `AbstractApiClient.responseValidator` and the telemetry pipeline.
- **Remediation Required (AD-30):** Mandate that `AbstractApiClient.request()` attaches validator diagnostics (`validationResult: { isFalse200, isCheckpoint, reason }`) to the client response/context, which is published directly to `stream:benchmark:telemetry` under the canonical field `false_200: boolean`.

---

### Seam 3: Re-qualification Race & Dual Mutation of Health Tiers
- **Conflicting Units:** Story 34.4 (`scoring-engine.js` hourly rollup) vs Story 34.8 (`requalification.js` promotion logic).
- **Governing ADs:** AD-26 (Hard Knock-Out Gates), AD-27 (Alert-Only Tier C, Human-in-the-Loop).
- **The Divergence:**
  - Story 34.4 runs hourly, computing composite scores across a rolling 24-hour window, enforcing knock-out gates, and persisting `tier` (`A`, `B`, or `C`) into `ScraperHealthScore` and `hash:scraper:health_tier`.
  - Story 34.8 implements re-qualification:
    > "Re-qualification: scraper must produce 5 consecutive clean canary runs or production runs to promote Tier C → B → A. Reset: any run violating knock-out gates resets the clean-run counter."
  - **The Collision:**
    1. Scraper `pasgo-merchant` drops to Tier C at 10:00 UTC due to False 200 rate.
    2. Engineer fixes the selector at 10:15 UTC.
    3. Canary runner (Story 34.7) runs hourly or on-demand probes. By 10:35 UTC, 5 consecutive clean runs pass.
    4. Story 34.8's re-qualification workflow promotes `pasgo-merchant` to Tier B, updating `hash:scraper:health_tier` to `"B"`.
    5. At 11:00 UTC, Story 34.4's scheduled scoring engine executes its 24-hour rolling rollup. Because the 24-hour window still contains the morning's 400 failed requests, the 24-hour False 200 rate is still > 15%.
    6. Story 34.4 enforces AD-26 knock-out gate, overwrites `hash:scraper:health_tier` back to `"C"`, and triggers a new alert.
    7. Dual ownership creates an infinite oscillation loop: Re-qualification promotes, Hourly Rollup demotes.
  - Furthermore, `ScraperHealthScore` stores only hourly snapshots. Where is the state of `consecutive_clean_runs` persisted across processes? Neither Story 34.1 nor `schema.prisma` provides a state column or table for this counter.
- **Why Current ADs Fail to Prevent It:** AD-26 specifies knock-out gates for scoring; AD-27 specifies human-in-the-loop alert behavior. Neither AD defines state ownership of tier transitions, quarantine flags, or how re-qualification overrides historical rolling windows.
- **Remediation Required (AD-31):** Establish a single state machine for Tier transitions:
  - Add `consecutive_clean_runs` and `quarantine_status` to `ScraperHealthScore` or a dedicated Redis key `hash:scraper:requalification_state`.
  - When a scraper is promoted via re-qualification, establish an epoch boundary (`requalified_at`) so the scoring engine ignores pre-requalification failures in rolling window calculations.

---

## 3. High-Risk Seams

### Seam 4: Redis Health Tier Cache Invalidation & Cold-Start Failure Masking
- **Conflicting Units:** Story 34.4 (`scoring-engine.js`) vs Story 34.6 (Nowing thin event enrichment in `redis-stream-publisher.js`).
- **Governing ADs:** AD-27 (Alert-Only Tier C, Human-in-the-Loop).
- **The Divergence:**
  - Story 34.4 populates `hash:scraper:health_tier` when the scoring worker runs.
  - Story 34.6 performs an O(1) Redis lookup on `hash:scraper:health_tier` when emitting every thin event:
    ```javascript
    const healthTier = await this.getHealthTier(scraperId);
    // Boundary rule: "Default to B if health tier is missing (new scraper or first run)"
    ```
  - **The Flaw:** If the Redis cluster restarts, evicts the key under memory pressure, or if an API worker boots before the first hourly scoring cycle, `hash:scraper:health_tier` is completely empty.
  - Every active scraper—including catastrophic Tier C scrapers that are actively poisoning data—evaluates to `null`, falls back to Tier `"B"`, and emits `benchmark_alert: false`.
  - Failing scrapers produce unflagged thin events for up to 60 minutes. Nowing ingests corrupted data without triggering operator alerts.
- **Why Current ADs Fail to Prevent It:** AD-27 declares that lookup is from Redis cache and not PostgreSQL, but provides no cache priming, warming, or persistent fallback guarantee.
- **Remediation Required (AD-32):** 
  - The scoring engine must persist the latest health tier to PostgreSQL `ScraperHealthScore`.
  - On service initialization, `RedisStreamPublisher` or the benchmark service must execute a cache-warming query loading all latest tiers from PostgreSQL into `hash:scraper:health_tier`.
  - If a scraper has a historical Tier C record in PostgreSQL within 24 hours, fallback MUST default to `"C"` (safe failure mode), not `"B"`.

---

### Seam 5: Thin Event Publishing Path Divergence & Synchronous Contract Violation
- **Conflicting Units:** Story 34.6 (`Nowing Integration Health Flag`) vs `src/utils/redis-stream-publisher.js` vs `src/store/prisma-store.js` vs `src/store/store-with-redis.js`.
- **Governing ADs:** AD-7 (Dual-Channel Protocol: HTTP/SSE + Redis Stream), AD-27 (Alert-Only Tier C).
- **The Divergence:**
  1. *Wrong File Target:* Story 34.6's Code Map specifies modifying `src/store/prisma-store.js` as the thin event publishing path. An audit of `src/store/prisma-store.js` confirms it contains ZERO Redis publishing code; it only writes to PostgreSQL via Prisma. Thin event publishing is located in `src/store/store-with-redis.js` and individual crawler pipelines. Modifying `prisma-store.js` as instructed will not enrich thin events.
  2. *Async Poisoning in Synchronous Contract:* Story 34.6 proposes:
     ```javascript
     // In RedisStreamPublisher.formatPayload(item, scraperId)
     const healthTier = await this.getHealthTier(scraperId);
     ```
     In `src/utils/redis-stream-publisher.js`, `formatPayload(item)` is a purely synchronous method called inside loops:
     ```javascript
     formatPayload(item) { ... }
     ```
     If Team 34.6 makes `formatPayload` async, every caller that invokes `formatPayload(item)` synchronously receives a `Promise` instead of an object. The subsequent `Object.entries(payload).flat()` receives a Promise object and fails or serializes `Promise` metadata into Redis.
- **Why Current ADs Fail to Prevent It:** AD-7 establishes the dual-channel protocol at an abstract level without locking down the synchronous/asynchronous interface boundaries of `RedisStreamPublisher`.
- **Remediation Required (AD-32):**
  - Clarify that thin event enrichment occurs in `RedisStreamPublisher.publish()` or in an in-memory cached lookup `getHealthTierSync(scraperId)` that reads a local in-process cache populated via Redis pub/sub or periodic refresh, preserving the synchronous signature of `formatPayload()`.
  - Correct the Code Map to reference `src/store/store-with-redis.js` and `src/utils/redis-stream-publisher.js`.

---

### Seam 6: Item Count Extraction on Heterogeneous Platform Handler Returns
- **Conflicting Units:** Story 34.2 (`AbstractCrawler.start()` telemetry hook) vs Concrete Platform Crawlers (Twitter, Threads, Shopee, Masothue).
- **Governing ADs:** AD-2 (Unified Base Crawler and Client Contracts), AD-25 (Centralized Instrumentation).
- **The Divergence:**
  - Story 34.2 proposes the following extraction in `AbstractCrawler.start()`:
    ```javascript
    itemCount: Array.isArray(result) ? result.length : (result ? 1 : 0)
    ```
  - Across XActions scrapers, handlers return diverse data shapes:
    - Twitter profile: `{ user: { ... }, tweets: [...] }`
    - Search queries: `{ items: [...], nextCursor: "abc" }`
    - Pagination wrappers: `{ data: [...], pagination: { count: 50 } }`
    - Void / Action triggers: `{ success: true }`
  - In a search crawl returning `{ items: [50 items], nextCursor: "..." }`:
    - `Array.isArray(result)` is `false`.
    - `result ? 1 : 0` evaluates to `1`.
  - The telemetry emitter records `item_count: 1` instead of `50`.
  - Corrupted metrics:
    - `noise.empty_result` incorrectly evaluates true when items array is empty but wrapper object exists.
    - `cost.proxy_bytes_per_1k_records` calculates `bytes / (1 / 1000) = bytes * 1000` (off by a factor of 50,000x!).
    - The Cost pillar score collapses to 0.
- **Why Current ADs Fail to Prevent It:** AD-25 prescribes zero changes to platform subclasses, assuming `AbstractCrawler.start()` can inspect `result` generically, but omits a standard item-counting resolution protocol.
- **Remediation Required (AD-33):** Specify a standard `extractItemCount(result)` helper in `AbstractCrawler`:
  1. Check `Array.isArray(result) -> result.length`.
  2. Check `result?.items && Array.isArray(result.items) -> result.items.length`.
  3. Check `result?.posts && Array.isArray(result.posts) -> result.posts.length`.
  4. Check `result?.data && Array.isArray(result.data) -> result.data.length`.
  5. Check `typeof result?.count === 'number' -> result.count`.
  6. Otherwise fallback to `(result ? 1 : 0)`.

---

## 4. Medium & Low Seams

### Seam 7: Category Applicability vs Telemetry Payload Incomplete Metadata
- **Conflicting Units:** Story 34.2 (Telemetry emitter) vs Story 34.4 (Scoring engine category profiles) vs AD-28.
- **Risk:** Medium.
- **The Divergence:**
  - AD-28 mandates category-aware metric profiles (e.g. `registry` excludes `comment_completeness`, `contact_accuracy`, `data_freshness`).
  - If Team 34.2 emits telemetry without `category` (only emitting `scraper_id`), the scoring engine in Story 34.4 must maintain a hardcoded mapping of `scraper_id -> category` or query the database.
  - If a new crawler is registered under a category not hardcoded in the scoring engine, AD-28 cannot re-normalize weights, causing division-by-zero or applying inappropriate gates.
- **Remediation:** Mandate that `category` is a required field on all crawlers extending `AbstractCrawler` (`this.category || 'social'`) and must be included in every telemetry event emitted.

---

### Seam 8: Canary Probes Consuming Rate Governor Quotas (AD-13 & AD-20 Conflict)
- **Conflicting Units:** Story 34.7 (`canary-runner.js`) vs Parent AD-13 (Adaptive Rate Governor) vs AD-20 (Dual-Pool Resource Isolation).
- **Risk:** Medium.
- **The Divergence:**
  - Story 34.7 calls `AbstractCrawler.start({ action: 'canary', url })` hourly per platform.
  - `AbstractCrawler.start()` enforces `governor.recordRequest(accountId)` (AD-13).
  - AD-20 splits concurrency into Realtime (30%) and Bulk (70%). Canary probes are neither user realtime requests nor bulk production scrapes.
  - If an account is already near its velocity ceiling, a synthetic canary probe can trip the governor into hibernation, causing production customer scrapes to fail.
- **Remediation:** Canary probe calls must pass `{ isCanary: true }` in command options, allowing the governor to bypass account exhaustion limits or execute against dedicated canary accounts.

---

### Seam 9: Duplicated Telemetry Schema Discrepancy in `metrics-catalog.md`
- **Conflicting Units:** `metrics-catalog.md` lines 106-139 vs lines 198-231.
- **Risk:** Low.
- **The Divergence:**
  - Lines 106-139 include `data_freshness_seconds`, `checkpoint_triggered`, and `duplicate_rate`.
  - Lines 198-231 represent a partial duplicate block with different indentation and omitted fields.
  - Two developers copying the schema snippet from different sections of the document will build mismatched TypeScript interfaces.
- **Remediation:** Deduplicate `metrics-catalog.md` to establish a single authoritative JSON schema.

---

## 5. Suggested New & Tightened Architectural Decisions

To make the Epic 34 spine airtight, the following architectural decisions should be added to `ARCHITECTURE-SPINE.md`:

### AD-29: Two-Phase Correlated Telemetry Envelope & Redis Serialization Contract
- **Statement:** Telemetry emission is separated into two correlated event types over `stream:benchmark:telemetry`:
  1. `telemetry:request` emitted by `AbstractApiClient.request()` containing `{ correlationId, scraperId, platform, latencyMs, proxyBytes, httpStatus, retries, isFalse200, isCheckpoint }`.
  2. `telemetry:run` emitted by `AbstractCrawler.start()` containing `{ correlationId, scraperId, platform, category, action, durationMs, itemCount, isSuccess, errorName }`.
- **Wire Contract:** All Redis Stream entries MUST be flat key-value pairs where nested objects or arrays are strictly serialized using `JSON.stringify()`. No raw nested JavaScript objects may be passed to `XADD`.

### AD-30: Validator-to-Telemetry Diagnostic Bridge
- **Statement:** When `AbstractApiClient.request()` receives an HTTP response, it executes `this.responseValidator.validate(response)`. The validator returns an explicit `PlatformValidationResult` structure:
  ```typescript
  interface PlatformValidationResult {
    isValid: boolean;
    isFalse200: boolean;
    isCheckpoint: boolean;
    isRateLimit: boolean;
    reason?: string;
  }
  ```
  These flags are immediately bound to the request execution context and forwarded into the `telemetry:request` event. The scoring engine evaluates `false_200_rate` strictly against `isFalse200: true`.

### AD-31: Unified Tier Transition State Machine & Re-qualification Epochs
- **Statement:** State ownership of `tier` transitions belongs exclusively to a unified state manager (`BenchmarkStateManager`):
  1. `hash:scraper:health_tier` is the authoritative cache; `ScraperHealthScore` is the durable history.
  2. Re-qualification requires 5 consecutive clean canary runs recorded in `ScraperCanaryRun` with `isSuccess = true`, `false200Detected = false`, and `checkpointDetected = false`.
  3. When re-qualification promotes a scraper (C → B), it sets `requalified_at = now()` in the scraper's state.
  4. The hourly scoring engine rolling-window aggregation MUST discard telemetry recorded prior to `requalified_at` for knock-out gate evaluation, preventing historical failures from reversing re-qualifications.

### AD-32: Health Tier Cache Warming, Resilient Fallback & Synchronous Lookup
- **Statement:**
  1. `RedisStreamPublisher` maintains an in-memory `Map<string, string>` of `scraperId -> tier` synchronized via Redis key subscription or 30-second TTL cache, ensuring `formatPayload()` remains strictly synchronous.
  2. On service startup, API and worker processes execute `warmupHealthTierCache()` which reads the latest tier per scraper from PostgreSQL `ScraperHealthScore` into Redis.
  3. If a scraper has no cache entry and no PostgreSQL record, it defaults to `"B"`. If a scraper has an active Tier C record in PostgreSQL, it MUST NOT fall back to `"B"`.

### AD-33: Generic Item Count Resolution Protocol in Base Crawler
- **Statement:** In `AbstractCrawler.start()`, item count for telemetry is resolved via `extractItemCount(result)`:
  ```javascript
  function extractItemCount(res) {
    if (!res) return 0;
    if (Array.isArray(res)) return res.length;
    for (const key of ['items', 'posts', 'data', 'records', 'results']) {
      if (Array.isArray(res[key])) return res[key].length;
    }
    if (typeof res.count === 'number') return res.count;
    return 1;
  }
  ```

### AD-34: Category Identity Binding on Base Crawler
- **Statement:** Every crawler subclassing `AbstractCrawler` must declare `readonly category: PlatformCategory` (one of `'social' | 'ecommerce' | 'directory' | 'registry' | 'fnb' | 'healthcare' | 'legal'`). `AbstractCrawler.start()` automatically attaches `this.category` to every emitted telemetry event, guaranteeing that the scoring engine can apply AD-28 metric exclusions without external database lookups.

---

## 6. Review Summary Table

| Seam ID | Conflicting Units | Severity | Root Cause | Proposed Solution |
|---|---|---|---|---|
| **S-01** | Story 34.1 vs 34.2 vs Catalog | **CRITICAL** | Redis `XADD` flattens nested objects to `"[object Object]"`; Crawler lacks client/store metrics. | AD-29 (Correlated two-phase envelope + JSON wire contract) |
| **S-02** | Story 34.3 vs 34.4 vs 34.1 | **CRITICAL** | Naming mismatch (`false200Detected` vs `false_200`); no bridge between validator & crawler. | AD-30 (Diagnostic bridge on `AbstractApiClient`) |
| **S-03** | Story 34.4 vs 34.8 | **CRITICAL** | Re-qualification promotion overwritten by hourly 24h rolling rollup; no shared state machine. | AD-31 (Unified state machine + `requalified_at` epoch) |
| **S-04** | Story 34.4 vs 34.6 | **HIGH** | Redis cold start/eviction defaults all scrapers to Tier B, suppressing Tier C alerts. | AD-32 (Postgres warmup + safe fallback) |
| **S-05** | Story 34.6 vs PrismaStore | **HIGH** | Story targets non-publishing store; async lookup inside synchronous formatter. | AD-32 (Sync in-memory cache + correct store mapping) |
| **S-06** | Story 34.2 vs Platform Crawlers | **HIGH** | `Array.isArray()` miscounts object returns (`{ posts }`), skewing noise and cost by 50,000x. | AD-33 (`extractItemCount` resolution protocol) |
| **S-07** | Story 34.2 vs 34.4 (AD-28) | **MEDIUM** | Telemetry lacks `category`, breaking dynamic weight re-normalization. | AD-34 (Mandatory `category` on `AbstractCrawler`) |
| **S-08** | Story 34.7 vs Parent AD-13 | **MEDIUM** | Synthetic canary probes consume production velocity quotas and trigger hibernation. | Add `{ isCanary: true }` governor bypass flag |
| **S-09** | `metrics-catalog.md` | **LOW** | Duplicated schema blocks with divergent fields. | Deduplicate lines 106-139 and 198-231 |
