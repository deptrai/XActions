# Technology Currency & Web-Research Review — Epic 34 Architecture Spine

**Reviewer:** Technology Currency & Web-Research Lens  
**Target:** `/Users/luisphan/Documents/GitHub/XActions/_bmad-output/planning-artifacts/architecture/xactions-benchmark-epic34/ARCHITECTURE-SPINE.md`  
**Date:** 2026-09-08  
**Scope:** Epic 34 (Scraper Benchmark & Reliability Suite) Stack, Architectural Decisions (AD-23 to AD-28), and Implementation Assumptions  

---

## 1. Verdict

**CONDITIONAL PASS (REVISION REQUIRED BEFORE STORY FREEZE)**

The overall architectural direction (two-tier telemetry, centralized base crawler/client hooks, hard knock-out scoring gates, alert-only Tier C) is sound and leverages existing project technologies. However, there are **two critical technical inconsistencies** in the architecture spine regarding data retention primitives and queue consumption, along with **three high-priority currency discrepancies** (Node.js engine pinning, microtask event loop starvation under high concurrency, and stream capacity sizing) that must be amended before implementation begins.

---

## 2. Critical Findings

### CRIT-1: Redis Stream "7-Day TTL" is Technically Inconsistent with Redis Stream Primitives
- **Location:** `ARCHITECTURE-SPINE.md` Section "Design Paradigm" (line 20), Section "Invariants & Rules" AD-23 (line 50), and Story 34.1 Intent (line 25).
- **The Issue:** The architecture spine asserts:
  > `Raw telemetry events are fire-and-forget XADD to stream:benchmark:telemetry (Redis Stream, MAXLEN ~ 500000, 7-day TTL).`
  Redis Streams **do not support per-entry TTL or time-to-live expiration semantics on individual messages**. In Redis (including Redis 7.x), setting a key-level TTL via `EXPIRE stream:benchmark:telemetry <seconds>` applies to the **entire key**. If an engineer executes `EXPIRE` on the stream key, the entire stream (including telemetry emitted seconds ago) will be purged at the expiration deadline. If refreshed on every write, the key never expires.
- **Evidence & Verification:**
  - In Redis 7.x, message eviction within a stream is achieved exclusively through:
    1. Count-based trimming: `XADD ... MAXLEN [~] <count>` or `XTRIM ... MAXLEN [~] <count>`
    2. Time-based trimming: `XADD ... MINID [~] <id>` or `XTRIM ... MINID [~] <id>`. Since Redis Stream IDs default to millisecond timestamps (`<millisecondsTime>-<sequenceNumber>`), a rolling 7-day window must be enforced via `MINID ~ <Date.now() - 7 * 86400 * 1000>`.
  - The repository's existing Redis stream implementation in `/Users/luisphan/Documents/GitHub/XActions/src/utils/redis-stream-publisher.js` (lines 52–59, 83–90, 196–221) already implements both `MAXLEN` and `MINID` strategy modifiers for `node-redis` v4.
- **Impact:** Misleading specification that will cause implementers to either write invalid `EXPIRE` commands (destroying stream history) or fail to implement rolling time-based trimming.
- **Required Fix:** Amend AD-23 to clarify that retention in `stream:benchmark:telemetry` is enforced via `MAXLEN ~ 1000000` (count ceiling) and rolling time-based trimming via `MINID ~ <seven_days_ago_ms>` executed by the consumer worker or scheduled maintenance, not via key TTL.

---

### CRIT-2: Conflation of Bull Queue Worker with Redis Stream Consumer Loop
- **Location:** `ARCHITECTURE-SPINE.md` Section "Structural Seed" (line 116), Section "Stack" (line 102), and Story 34.1 Code Map (line 59).
- **The Issue:** Story 34.1 lists:
  > `src/services/benchmark/telemetry-consumer.js — Bull worker consuming Redis Stream → PostgreSQL`
  And the Spine states: `Bull 4.x (scoring worker scheduling)` and `telemetry-consumer.js # Redis Stream → Prisma rollup worker`.
  Bull 4.x operates exclusively on **Redis Lists and Sorted Sets** (`BRPOPLPUSH`, `ZADD`, Lua scripts); it is **not a Redis Stream consumer client**. Bull queues cannot natively subscribe to or ingest from a Redis Stream.
- **Evidence & Verification:**
  - Redis Streams require a consumer group read loop (`xReadGroup` / `xAck`) or streaming poll.
  - In the XActions codebase, `api/services/jobQueue.js` registers Bull processors for discrete operations (`operationsQueue.process`).
  - Scheduling in the existing codebase (`api/services/retentionScheduler.js`, `api/services/facebookScheduler.js`, `api/services/tweetScheduler.js`) is implemented via `node-cron` with PostgreSQL advisory locks, explicitly rejecting Bull delayed/repeatable jobs to avoid state loss during Redis restarts (`_bmad-output/implementation-artifacts/4-1-schedule-post.md` line 166).
- **Impact:** Implementers will face impedance mismatch attempting to configure Bull as a stream consumer.
- **Required Fix:** Disentangle the two components:
  1. `telemetry-consumer.js`: Direct Redis Stream consumer group reader (`xReadGroup` with `stream:benchmark:telemetry`, group `benchmark_rollup_workers`) that batches events and flushes hourly aggregates to PostgreSQL.
  2. Scoring & Canary Triggering: If Bull 4.x is used, it should be reserved for enqueuing hourly scoring jobs (`queue.add('calculate-health-score', { scraperId })`); or align with the repository's prevailing pattern of `node-cron` scheduled tasks.

---

## 3. High Findings

### HIGH-1: Node.js Engine Pinning Mismatch (Node >= 18 vs >= 20.18.1)
- **Location:** `ARCHITECTURE-SPINE.md` Section "Stack" (line 99).
- **The Issue:** The spine states `Node.js >= 18`.
- **Evidence & Verification:**
  - In `/Users/luisphan/Documents/GitHub/XActions/package.json` line 230:
    ```json
    "engines": {
      "node": ">=20.18.1"
    }
    ```
  - Node.js 18 reached End-of-Life (EOL) on **April 30, 2025**.
  - Current active runtime is Node.js 26 (`v26.5.0` on local system). Node 20.x and 22.x are the active LTS lines.
  - Project code relies on modern native ES module behavior, undici 7.x, and fetch APIs that require Node 20+.
- **Impact:** Downstream tooling, Dockerfiles, and CI pipelines following the spine could attempt builds on Node 18, which violates `package.json` engines and breaks dependencies like `undici@^7.29.0`.
- **Required Fix:** Update `ARCHITECTURE-SPINE.md` Stack table from `Node.js >= 18` to `Node.js >= 20.18.1` (or Node 20+ LTS).

---

### HIGH-2: `queueMicrotask` Risk of Event Loop Starvation Under Scraper Concurrency
- **Location:** `ARCHITECTURE-SPINE.md` Section "Invariants & Rules" AD-24 (line 56).
- **The Issue:** AD-24 states:
  > `TelemetryEmitter.emit() executes via setImmediate or queueMicrotask — never awaited in AbstractCrawler.start() or AbstractApiClient.request().`
- **Evidence & Verification:**
  - In the Node.js event loop, `queueMicrotask` schedules tasks in the microtask queue, which drains to completion **before** the event loop yields to the next phase (timers, I/O poll, check).
  - If scrapers process hundreds or thousands of elements concurrently, chaining emissions via `queueMicrotask` can starve the event loop I/O polling, directly violating NFR-19 (< 1% scraper throughput overhead).
  - In contrast, `setImmediate` queues callbacks in the `check` phase, allowing the event loop to complete network I/O and crawler execution before processing telemetry flushes.
- **Impact:** High-volume scrape runs using `queueMicrotask` can cause event loop lag, delayed network packet handling, and artificial crawler latency.
- **Required Fix:** Remove `queueMicrotask` from AD-24. Specify `setImmediate` exclusively, combined with an in-memory batch buffer and the 1,000-item circuit breaker.

---

### HIGH-3: Stream Capacity Sizing (`MAXLEN ~ 500000` vs 15+ Continuous Platforms)
- **Location:** `ARCHITECTURE-SPINE.md` Section "Invariants & Rules" AD-23 (line 50).
- **The Issue:** `MAXLEN ~ 500000` is asserted for a 7-day retention window across 15+ platforms.
- **Evidence & Verification:**
  - 7 days = 10,080 minutes.
  - 15 platforms running continuous crawling (e.g. 10 HTTP requests/min per platform) produce:
    `15 platforms * 10 req/min * 10,080 min = 1,512,000 events / 7 days`.
  - At 500,000 entries, high-frequency crawl runs will evict telemetry within ~2.3 days.
  - The repository's primary thin event stream `stream:social:raw_posts` in `/Users/luisphan/Documents/GitHub/XActions/src/utils/redis-stream-publisher.js` (line 87) defaults to `MAXLEN 1,000,000`.
  - In Redis 7.x, 1,000,000 stream entries in listpack chunks consume approximately 120–180 MB of RAM, well within standard server allocations (1–2 GB+).
- **Impact:** Premature eviction of production telemetry before the 7-day rolling window completes, impairing trend evaluation and historical canary comparisons.
- **Required Fix:** Increase default capacity in AD-23 to `MAXLEN ~ 1000000` (consistent with `stream:social:raw_posts`), or explicitly define sampling when scrape volume exceeds threshold.

---

## 4. Medium / Low Findings

### MED-1: `hash:scraper:health_tier` Needs Client-Side Memory Caching to Meet NFR-19
- **Location:** `ARCHITECTURE-SPINE.md` AD-23 & Diagram (lines 29–30), Story 34.1 Code Map (line 58).
- **The Issue:** The architecture describes `hash:scraper:health_tier` as providing O(1) lookups for enriching thin events.
- **Reality Check:**
  - Redis `HGET hash:scraper:health_tier <scraperId>` is an O(1) Redis command, but it is an asynchronous network call (~0.5ms–2ms network latency).
  - If `redis-stream-publisher.js` awaits `HGET` on every scraped post, this adds cumulative network I/O on the critical emission path.
  - Scraper health tiers only change when the scoring worker runs (hourly or daily).
- **Required Fix:** Specify that `redis-stream-publisher.js` (or a dedicated `HealthTierCache`) maintains an in-memory Map cache with a short TTL (e.g. 30–60 seconds) populated via periodic `HGETALL`, ensuring truly synchronous in-memory O(1) reads without network overhead on the scrape path.

---

### MED-2: Redis Stream Publisher Responsibility Overload
- **Location:** `ARCHITECTURE-SPINE.md` Structural Seed (line 118):
  `src/utils/redis-stream-publisher.js # Health tier cache + thin event enrichment`
- **Reality Check:**
  - `src/utils/redis-stream-publisher.js` is already an established, 380-line core utility handling thin event formatting, client lifecycle, group creation, and stream publishing for Nowing.
  - Merging health tier caching, fallback resolution (`default B`), and alert enrichment into this file overloads its single responsibility.
- **Required Fix:** Create a dedicated helper `src/services/benchmark/health-cache.js` or `src/utils/health-tier-cache.js`, and compose it within `redis-stream-publisher.js` or `telemetry-emitter.js`.

---

### MED-3: Inconsistency in Missing Tier Fallback (`B` vs `UNKNOWN`)
- **Location:** `ARCHITECTURE-SPINE.md` Consistency Conventions (line 91) vs Story 34.1 Table (line 50).
- **The Issue:**
  - Spine line 91 states: `benchmark_health values: "A", "B", "C", "UNKNOWN"`.
  - Story 34.1 line 50 and AC5 state: `Missing → default B`.
- **Reality Check:** An un-benchmarked or newly added scraper is genuinely `"UNKNOWN"` until its first canary probe or 24-hour evaluation window. Setting it to `"B"` masks missing telemetry and could prevent operators from realizing a new scraper is un-monitored.
- **Required Fix:** Align convention so that un-evaluated scrapers default to `"UNKNOWN"`, while legacy/fallback consumers gracefully treat `"UNKNOWN"` as non-alerting.

---

### LOW-1: PostgreSQL JSONB GIN Indexing for `metricsSnapshot`
- **Location:** `ARCHITECTURE-SPINE.md` Data & formats (line 92) and Story 34.1 Technical Notes (line 78).
- **The Issue:** `metricsSnapshot` is typed as `Json` in Prisma (PostgreSQL `JSONB`). B-tree indexes are placed on `[platform, evaluatedAt]` and `[scraperId, evaluatedAt]`.
- **Reality Check:** For MVP, queries only filter by `scraperId` and `evaluatedAt` to render scorecards, which B-tree handles efficiently. If future queries filter inside `metricsSnapshot` (e.g. finding runs with `false_200 == true`), a PostgreSQL GIN index (`CREATE INDEX ... USING GIN (metricsSnapshot)`) will be required via raw migration SQL (`prisma migrate dev --create-only`), as Prisma schema syntax does not support GIN indexes natively.
- **Status:** Acceptable for MVP; document as a note for Phase 2 query optimization.

---

## 5. Version & Technology Evidence Table

| Component | Spine Version | Actual Project / Installed Version | Status | Evidence & Compatibility Notes |
|---|---|---|---|---|
| **Node.js** | `>= 18` | `v26.5.0` (active) / `package.json: >=20.18.1` | **DISCREPANCY (HIGH)** | Node 18 is EOL (April 2025). `package.json` engines strictly enforces `>=20.18.1`. Update spine. |
| **Redis Server** | `7.x` | Redis 7.x (Stream `MAXLEN`, `XADD`, `XTRIM`) | **VERIFIED** | Server supports Streams with `MAXLEN ~`, `MINID ~`, and Consumer Groups. |
| **Redis Client** | Not specified | `redis@4.7.1` (`^4.6.11` in `package.json`) | **VERIFIED** | `node-redis` v4 supports `xAdd(..., { TRIM: { strategy: 'MAXLEN' / 'MINID' } })`. Already verified in `src/utils/redis-stream-publisher.js`. |
| **PostgreSQL** | `15+` | PostgreSQL 15+ target | **VERIFIED** | Fully compatible with Prisma 5.22. Native `JSONB`, `DOUBLE PRECISION`, descending B-tree indexes. |
| **Prisma ORM** | Not specified | `prisma@5.22.0`, `@prisma/client@5.22.0` (`^5.7.1`) | **VERIFIED** | Existing models (`Post`, `Comment`, `EngagementDaily`) already use `Json?`, `Float`, and `DateTime`. |
| **Bull Queue** | `4.x` | `bull@4.16.5` (`^4.12.0` in `package.json`) | **VERIFIED (SCOPED)** | Bull 4.x is installed. Compatible with Node 20+, but operates on Redis Lists/Sets, NOT Redis Streams. |
| **Vitest** | `4.x` | `vitest@4.1.11` (`^4.0.18` in `package.json`) | **VERIFIED** | `vitest.config.js` exists, configured with `node` environment and `forks` pool. |
| **node-cron** | Not in spine | `node-cron@4.6.0` (`^4.6.0` in `package.json`) | **COMPATIBLE ALTERNATIVE** | Used across existing schedulers (`retentionScheduler`, `facebookScheduler`, `tweetScheduler`) with Postgres advisory locks. |

---

## 6. Suggested Fixes & Open Questions

### Actionable Fixes for Architecture Spine

1. **Update AD-23 (Two-Tier Benchmark Architecture):**
   ```text
   Replace:
   "Raw telemetry events are fire-and-forget XADD to stream:benchmark:telemetry (Redis Stream, MAXLEN ~ 500000, 7-day TTL)."
   With:
   "Raw telemetry events are fire-and-forget XADD to stream:benchmark:telemetry (Redis Stream, MAXLEN ~ 1000000). Rolling 7-day data retention is enforced by the telemetry consumer worker via periodic XTRIM stream:benchmark:telemetry MINID ~ <now - 7 days>. No key-level EXPIRE is set on the stream."
   ```

2. **Update AD-24 (Non-Blocking Telemetry Emission):**
   ```text
   Replace:
   "TelemetryEmitter.emit() executes via setImmediate or queueMicrotask..."
   With:
   "TelemetryEmitter.emit() executes via setImmediate exclusively (avoiding microtask event-loop starvation)..."
   ```

3. **Update Stack Table:**
   ```text
   Replace:
   | Node.js | >= 18 |
   With:
   | Node.js | >= 20.18.1 |
   ```

4. **Clarify Stream Consumer vs. Scoring Worker Topology:**
   - Explicitly define `telemetry-consumer.js` as a direct Redis Stream Consumer Group worker (`XREADGROUP`).
   - Define whether `scoring-engine.js` execution is triggered on an hourly `node-cron` tick (consistent with `retentionScheduler.js`) or enqueued via Bull `operationsQueue`.

### Open Questions for Team
1. **Canary probe execution context:** Will synthetic canary probes run inside the same process as the crawler or as isolated worker jobs to prevent proxy pool starvation?
2. **Health tier fallback:** Should un-evaluated scrapers report `UNKNOWN` or `B` to Nowing? (Recommendation: `UNKNOWN` in telemetry, with consumer treating `UNKNOWN` as non-blocking).

---
*Report filed by Technology Currency & Web-Research Lens for Epic 34 Gate.*
