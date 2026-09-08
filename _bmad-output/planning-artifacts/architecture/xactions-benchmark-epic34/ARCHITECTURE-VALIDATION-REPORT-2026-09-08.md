# Architecture Rubric Walker Review: Epic 34 — Scraper Benchmark & Reliability Suite

**Reviewer Role:** Rubric Walker (BMad Architecture Reviewer Gate)  
**Date:** 2026-09-08  
**Status:** PASS WITH FINDINGS (Revisions Required Prior to Story Freezing)  
**Target Architecture:** `/Users/luisphan/Documents/GitHub/XActions/_bmad-output/planning-artifacts/architecture/xactions-benchmark-epic34/ARCHITECTURE-SPINE.md`  
**Referenced Specifications & Context:**
- `_bmad-output/planning-artifacts/architecture/xactions-benchmark-epic34/.memlog.md`
- `_bmad-output/specs/spec-scraper-benchmark/SPEC.md`
- `_bmad-output/specs/spec-scraper-benchmark/metrics-catalog.md`
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` (Parent Spine, especially AD-2, AD-7, AD-9, AD-13, AD-18)
- `_bmad-output/planning-artifacts/backlog-epic-34.md`
- Brownfield Codebase:
  - `src/core/base-crawler.js` (AbstractCrawler)
  - `src/core/base-client.js` (AbstractApiClient)
  - `src/core/types.js` (ThinEvent, PostItem, CommentItem)
  - `src/core/metadata-schema-registry.js` (MetadataSchemaRegistry)
  - `src/core/platform-validator.js` (Platform Validators)
  - `src/utils/redis-stream-publisher.js` (RedisStreamPublisher)
  - `src/store/prisma-store.js` & `src/store/store-with-redis.js` (Persistence Layer)
  - `prisma/schema.prisma` (PostgreSQL Schema)
- Sibling Reviews:
  - `_bmad-output/planning-artifacts/architecture/xactions-benchmark-epic34/reviews/review-tech-currency.md`
  - `_bmad-output/planning-artifacts/architecture/xactions-benchmark-epic34/reviews/review-adversarial.md`

---

## 1. Verdict

**VERDICT: PASS WITH FINDINGS**

The architectural spine for Epic 34 demonstrates strong conceptual alignment with the driving specification (`SPEC.md`). The four-pillar scoring model (Stability 35%, Quality 30%, Noise 20%, Cost 15%), non-compensatory knock-out gates (AD-26), two-tier storage topology (AD-23), and human-in-the-loop alert-only Tier C policy (AD-27) establish a defensible benchmark suite for Nowing ingestion.

However, auditing the spine against the Good-Spine Checklist and brownfield implementation realities reveals **3 Critical Findings**, **4 High Findings**, and **3 Medium/Low Findings**. These issues represent concrete divergence vectors where independent implementation units will either fail to integrate, violate existing repository conventions, or execute invalid Redis/Node.js operations.

The findings must be rectified in `ARCHITECTURE-SPINE.md` before story implementation commences.

---

## 2. Good-Spine Rubric Checklist Evaluation

| Rubric Item | Status | Evaluation Summary |
|---|---|---|
| **1. Fixes real divergence points below and misses none** | **PARTIAL** | Core scoring and storage are framed, but the telemetry aggregation bridge between `AbstractCrawler` and `AbstractApiClient`, and the item extraction normalization from heterogeneous action handlers are unaddressed divergence holes. |
| **2. Every AD rule is enforceable & prevents divergence** | **PARTIAL** | AD-26 (Knock-Out Gates) and AD-28 (Category Weights) are fully enforceable. AD-23 specifies non-existent Redis TTL primitives. AD-24 permits `queueMicrotask` which risks event loop starvation. AD-25 lacks an aggregation context. |
| **3. Nothing under Deferred allows divergence** | **PASS WITH NOTE** | Core deferred items (microservice separation, auto-remediation, public SLA) are safely partitioned. However, NFR-21 is claimed as covered in frontmatter while deferred to Phase 2 in the body text. |
| **4. Named technology is verified-current** | **FAIL** | Node.js is pinned to `>= 18` (EOL April 2025) while `package.json` enforces `>= 20.18.1`. Bull 4.x is misidentified as a Redis Stream consumer. Redis Stream TTL is conflated with key expiration. |
| **5. Ratifies rather than contradicts brownfield code** | **FAIL** | Spine references non-existent `src/services/` directory (actual: `api/services/`), non-existent `src/core/base-api-client.js` (actual: `src/core/base-client.js`), and misattributes thin event schema extension to `MetadataSchemaRegistry` (AD-18). |
| **6. Covers driving spec capabilities** | **PASS** | CAP-1 through CAP-5 are fully mapped across AD-23 to AD-28. |
| **7. Inherited parent spine invariants maintained** | **PASS WITH NOTE** | Parent AD-2, AD-7, AD-9, AD-13 are respected. Stream sizing in AD-23 (`MAXLEN ~ 500000`) is inconsistently smaller than parent AD-7 (`MAXLEN ~ 1000000`). |
| **8. Operational & environmental envelope complete** | **PARTIAL** | Telemetry consumer daemon topology, proxy/account isolation for synthetic canaries, and cold-start cache fallbacks are omitted. |

---

## 3. Critical Findings

### CRIT-1: Thin Event Schema Extension Point Misattribution (AD-18 vs RedisStreamPublisher/types.js)
- **Checklist Item:** Ratifies rather than contradicts brownfield code / Every AD rule is enforceable.
- **Location:** `ARCHITECTURE-SPINE.md` Section "Consistency Conventions" (line 42).
- **The Finding:**  
  The spine asserts:
  > `Thin event schema extended with benchmark_health and benchmark_alert via MetadataSchemaRegistry (AD-18) — backward-compatible with existing consumers.`
- **Codebase Reality:**
  - `src/core/metadata-schema-registry.js` is strictly designed to validate dynamic JSON schemas for `Post.metadata` (`metadata Json?` column in PostgreSQL) against files under `schemas/<platform>/<category>.json`. It has zero role in defining, serializing, or validating Redis Stream thin events.
  - Thin events are published to `stream:social:raw_posts` exclusively through `RedisStreamPublisher.formatPayload(item)` in `src/utils/redis-stream-publisher.js`.
  - The type definition for thin events is defined as `ThinEvent` in `src/core/types.js` (lines 173–182).
- **Impact:**  
  Engineers assigned to Story 34.6 will attempt to modify `schemas/` and `MetadataSchemaRegistry`, which will not affect the Redis Stream output received by Nowing. Furthermore, injecting asynchronous Redis reads into `formatPayload()` without proper caching will break the synchronous contract of `RedisStreamPublisher`.
- **Enforceable Fix:**  
  Amend `ARCHITECTURE-SPINE.md` to identify the true extension points:
  1. Extend `@typedef {Object} ThinEvent` in `src/core/types.js` to include `benchmark_health` (`'A' | 'B' | 'C' | 'UNKNOWN'`) and `benchmark_alert` (`boolean`).
  2. Extend `RedisStreamPublisher.formatPayload()` in `src/utils/redis-stream-publisher.js` to enrich payloads using an in-memory cached lookup of `hash:scraper:health_tier`.

---

### CRIT-2: Telemetry Coordination & Metric Aggregation Gap Between AbstractCrawler and AbstractApiClient (AD-25)
- **Checklist Item:** Fixes real divergence points below and misses none / Rule prevents stated divergence.
- **Location:** `ARCHITECTURE-SPINE.md` AD-25 (line 60), Story 34.2.
- **The Finding:**  
  AD-25 mandates:
  > `All telemetry capture lives in AbstractCrawler.start() (start/end timing, item count, error capture) and AbstractApiClient.request() (latency, HTTP status, proxy bytes, retries). Platform crawlers do NOT override or extend telemetry methods.`
- **Codebase Reality:**
  - `AbstractCrawler` (`src/core/base-crawler.js`) and `AbstractApiClient` (`src/core/base-client.js`) are completely independent, decoupled classes.
  - In actual crawlers (e.g. `src/scrapers/social/tiktok/crawler.js`, `src/scrapers/social/threads/crawler.js`), the crawler either creates an internal client instance or uses Puppeteer.
  - `AbstractApiClient.request()` executes HTTP calls with retry and account rotation loops. The metrics collected inside `request()` (`proxy_bytes`, `retries`, `latency`, `status`) live inside private loop variables and are never surfaced to `AbstractCrawler.start()`.
  - Conversely, `AbstractCrawler.start()` wraps `entry.handler(command.args, session)` in lines 241–253 of `src/core/base-crawler.js`. The return value of `entry.handler` is heterogeneous: some actions return `PostItem[]`, some return paginated envelopes (`{ listings: [...], cursor }`), and some return simple status objects.
- **Impact:**  
  Without a coordinated telemetry context, `AbstractCrawler.start()` cannot observe network/cost metrics (`proxy_bytes`, `retries`), and `AbstractApiClient.request()` cannot observe run-level identity (`scraper_id`, `category`, `field_fill_rate`). If both emit separate events, telemetry will be fragmented. If only `AbstractCrawler` emits, cost and network stability metrics will be empty.
- **Enforceable Fix:**  
  Add an explicit Telemetry Aggregation Pattern to AD-25:
  1. `AbstractCrawler.start()` initializes a scoped `TelemetryContext` object attached to `session.telemetry = new RunTelemetryContext(scraperId, platform)`.
  2. `AbstractApiClient.request(method, url, options)` checks for `options.telemetryContext || options.session?.telemetry` and records bytes, latency, status, and retry attempts into that context.
  3. `AbstractCrawler.start()` extracts item counts via a normalized helper (`extractItemCount(result)`) in its `finally` block and dispatches a single aggregated run event to `TelemetryEmitter.emit()`.

---

### CRIT-3: Incompatible Redis Stream Primitives & Conflated Consumer Topology (AD-23, Story 34.1)
- **Checklist Item:** Named tech is verified-current / Every AD rule is enforceable.
- **Location:** `ARCHITECTURE-SPINE.md` AD-23 (lines 20, 50), Story 34.1 Code Map.
- **The Finding:**  
  1. *Invalid Redis Stream TTL:* AD-23 states: `stream:benchmark:telemetry (Redis Stream, MAXLEN ~ 500000, 7-day TTL)`. In Redis 7.x, Streams do not support per-message TTL or rolling expiration. Applying `EXPIRE stream:benchmark:telemetry <seconds>` sets a key-level expiration that destroys the entire stream when triggered.
  2. *Bull Queue vs Redis Stream Mismatch:* Story 34.1 defines `src/services/benchmark/telemetry-consumer.js — Bull worker consuming Redis Stream -> PostgreSQL`. Bull 4.x operates exclusively on Redis Lists and Sorted Sets (`BRPOPLPUSH`, `ZADD`). It has no native capability to ingest from or acknowledge Redis Streams.
  3. *Stream Capacity Under-sizing:* `MAXLEN ~ 500000` across 15+ continuous crawling platforms is insufficient for 7 days. At 10 req/min across 15 scrapers, >1.5M events are produced weekly, leading to premature eviction at ~2.3 days.
- **Impact:**  
  Developers will implement faulty `EXPIRE` commands that periodically drop all telemetry, attempt to configure Bull workers against Redis Streams leading to runtime crashes, and suffer telemetry data loss from stream under-sizing.
- **Enforceable Fix:**  
  Update AD-23 and Story 34.1:
  1. Capacity: Set `MAXLEN ~ 1000000` (consistent with parent AD-7 `stream:social:raw_posts`).
  2. Retention: Enforce rolling 7-day retention via consumer-driven `XTRIM stream:benchmark:telemetry MINID ~ <seven_days_ago_ms>`. No key-level `EXPIRE`.
  3. Consumer: Define `telemetry-consumer.js` as a native Redis Stream Consumer Group loop using `xReadGroup` / `xAck` under consumer group `benchmark_telemetry_workers`. Bull 4.x is restricted to scheduled batch jobs (e.g. hourly scoring).

---

## 4. High Findings

### HIGH-1: Scraper Identification Mismatch in Thin Event Enrichment Path (AD-27, Story 34.6)
- **Checklist Item:** Fixes real divergence points below and misses none.
- **Location:** `ARCHITECTURE-SPINE.md` AD-27 (line 70), Story 34.6 Code Map & Technical Notes.
- **The Finding:**  
  `hash:scraper:health_tier` stores health tiers keyed by `scraper_id` (e.g. `twitter-hybrid`, `facebook-playwright`, `tiktok-api`). However, existing crawlers (`src/scrapers/social/tiktok/crawler.js`, `src/scrapers/social/threads/crawler.js`, etc.) emit thin events via:
  ```javascript
  await publisher.publish({
    id: item.id,
    platform: 'tiktok',
    externalId: item.externalId,
    category: 'social',
    authorId: item.authorId,
    crawledAt: toIsoDate(item.crawledAt),
    storageRef: item.id,
  });
  ```
  `ThinEvent` and `formatPayload(item)` only receive `platform: 'tiktok'`. They do not have access to `scraper_id`.
- **Impact:**  
  If a platform has multiple scrapers (e.g. `twitter-hybrid` and `twitter-browser`), `formatPayload` cannot resolve which scraper produced the item. If it attempts to look up by `platform`, the lookup fails or collides. Under Story 34.6 fallback rules, all events will default to `benchmark_health: "B"`, masking Tier C scrapers from Nowing.
- **Enforceable Fix:**  
  Explicitly update `ThinEvent` typedef in `src/core/types.js` to include an optional `scraperId?: string`. Update base crawler publishing to pass `scraperId` (derived from `this.scraperId`) into `publisher.publish(item, this.scraperId)`.

---

### HIGH-2: Subsystem Directory & Architectural Placement Contradiction
- **Checklist Item:** Ratifies rather than contradicts brownfield code.
- **Location:** `ARCHITECTURE-SPINE.md` Section "Structural Seed" (lines 114–120), `backlog-epic-34.md`.
- **The Finding:**  
  1. The spine establishes a new top-level service directory: `src/services/benchmark/` for `telemetry-consumer.js`, `scoring-engine.js`, `scorecard.js`, `canary-runner.js`, and `alerting-service.js`.
  2. In the actual XActions brownfield repository, `src/services/` does not exist. All persistent backend services, queue consumers, and background workers reside in `api/services/` (`api/services/jobQueue.js`, `api/services/retentionScheduler.js`, `api/services/facebookScheduler.js`). Core domain logic resides in `src/` (e.g. `src/core/`, `src/scrapers/`, `src/utils/`).
  3. `backlog-epic-34.md` references `src/core/base-api-client.js`. The actual file in the repository is `src/core/base-client.js`.
  4. Scheduled jobs in XActions follow `node-cron` with PostgreSQL advisory locks (see `api/services/retentionScheduler.js`), not Bull repeatable jobs, to prevent state loss on Redis restarts.
- **Impact:**  
  Fractures the repository layout, causes broken module imports, and introduces conflicting background scheduling mechanisms.
- **Enforceable Fix:**  
  Align structural seed with existing repository layout:
  - Core domain logic (evaluation math, emitter, canary runner, CLI): `src/benchmark/` (or `src/core/benchmark/`).
  - Background workers and daemons (stream consumer, cron schedulers): `api/services/benchmark/`.
  - Correct all references of `base-api-client.js` to `src/core/base-client.js`.

---

### HIGH-3: Node.js Runtime Pinning Mismatch (AD-23 / Stack Table)
- **Checklist Item:** Named tech is verified-current.
- **Location:** `ARCHITECTURE-SPINE.md` Section "Stack" (line 99).
- **The Finding:**  
  The spine states `Node.js >= 18`.
- **Codebase Reality:**
  - `package.json` line 230 explicitly enforces:
    ```json
    "engines": {
      "node": ">=20.18.1"
    }
    ```
  - Node.js 18 reached official End-of-Life (EOL) on April 30, 2025.
  - Active development runtime on local machines is Node 26 (`v26.5.0`), with Node 20 LTS as the minimum supported deployment target. Critical dependencies like `undici@^7.29.0` require Node 20+.
- **Impact:**  
  Downstream tooling, Dockerfiles, and CI pipelines configured against the spine will fail engine validation checks and encounter runtime module incompatibilities.
- **Enforceable Fix:**  
  Update Stack table in `ARCHITECTURE-SPINE.md` to `Node.js >= 20.18.1` (Node 20+ LTS).

---

### HIGH-4: Invariant Contradiction on Tier C Ingestion Policy (metrics-catalog.md vs AD-27 & SPEC.md)
- **Checklist Item:** Rule prevents stated divergence / Inherited parent spine invariants maintained.
- **Location:** `_bmad-output/specs/spec-scraper-benchmark/metrics-catalog.md` (line 75) vs `ARCHITECTURE-SPINE.md` AD-27 (line 70) and `SPEC.md`.
- **The Finding:**  
  - `metrics-catalog.md` line 75 specifies:  
    `Tier C: Critical (<60). Action: Immediate alert, auto-gate from Nowing ingestion until re-qualified.`
  - `ARCHITECTURE-SPINE.md` AD-27 and `SPEC.md` explicitly mandate:  
    `Alert-Only Tier C. Tier C scrapers fire immediate alerts to operators... but do NOT auto-cutoff from Nowing ingestion. Scrapers continue emitting thin events to stream:social:raw_posts tagged with benchmark_health: "C" and benchmark_alert: true. The cutoff decision is strictly human-in-the-loop.`
- **Impact:**  
  This direct specification contradiction will cause engineers working on Story 34.4, 34.6, and 34.8 to diverge. Implementing an automated gate will abruptly halt data ingestion for Nowing clients, violating the human-in-the-loop invariant.
- **Enforceable Fix:**  
  Update `metrics-catalog.md` line 75 to replace `auto-gate from Nowing ingestion until re-qualified` with `tag thin events with benchmark_alert: true; no automated ingestion cutoff (human-in-the-loop per AD-27)`.

---

## 5. Medium / Low Findings

### MED-1: Internal Contradiction on NFR-21 (Covered vs Deferred)
- **Checklist Item:** Nothing under Deferred allows divergence.
- **Location:** `ARCHITECTURE-SPINE.md` Frontmatter `nfr_coverage` vs Section "Deferred Decisions" (line 130).
- **The Finding:**  
  The frontmatter explicitly claims coverage of `NFR-21` (`nfr_coverage: NFR-19, NFR-20, NFR-21`). However, under "Deferred Decisions", the text states:
  > `Per-Item Telemetry Sampling (NFR-21): Deferred to Phase 2. MVP emits one telemetry event per scrape run / batch, not per individual post.`
- **Impact:** Ambiguity on whether Story 34.2 must implement item-level sampling.
- **Fix:** Clarify that MVP fulfills NFR-21 via run-level batching (one event per batch/run), while individual post-level probabilistic sampling is deferred to Phase 2.

---

### MED-2: Event Loop Starvation Risk via `queueMicrotask` in AD-24
- **Checklist Item:** Every AD rule is enforceable & actually prevents stated divergence.
- **Location:** `ARCHITECTURE-SPINE.md` AD-24 (line 56).
- **The Finding:**  
  AD-24 allows: `TelemetryEmitter.emit() executes via setImmediate or queueMicrotask`. Microtasks run before the Node.js event loop yields to the I/O poll phase. High-concurrency scraper emissions chained via `queueMicrotask` can starve network socket I/O, violating NFR-19 (<1% latency overhead).
- **Impact:** Unintended latency spikes during high-throughput crawl runs.
- **Fix:** Restrict emission strictly to `setImmediate` with an in-memory ring buffer.

---

### MED-3: Missing Operational & Environmental Envelope for Synthetic Canary Probes (Story 34.7)
- **Checklist Item:** Operational/environmental envelope complete.
- **Location:** `ARCHITECTURE-SPINE.md` Structural Seed & AD-23.
- **The Finding:**  
  The spine does not define the execution envelope for `canary-runner.js`:
  1. Does the canary probe consume production proxy credentials and bandwidth?
  2. Does it execute inside the crawler daemon process or as a separate isolated process?
  3. If a platform requires authenticated sessions, does the canary consume production user sessions?
- **Impact:** Risk of canary probes exhausting proxy pool bandwidth or invalidating production authentication tokens during hourly checks.
- **Fix:** Specify that canary probes use dedicated lightweight probe proxies and unauthenticated public endpoints where possible, operating in a separate worker thread.

---

### LOW-1: Missing Fallback State Convention Consistency ("UNKNOWN" vs "B")
- **Checklist Item:** Fixes real divergence points below and misses none.
- **Location:** `ARCHITECTURE-SPINE.md` Section "Consistency Conventions" (line 91) vs Story 34.1 / 34.6.
- **The Finding:**  
  Spine line 91 defines: `benchmark_health values: "A", "B", "C", "UNKNOWN"`. However, Story 34.1 and 34.6 state that unranked scrapers default to `"B"`.
- **Impact:** Setting un-evaluated scrapers to Tier B artificially masks missing monitoring coverage.
- **Fix:** Standardize that un-benchmarked scrapers report `"UNKNOWN"`. Nowing consumers treat `"UNKNOWN"` as non-alerting while operators see it as un-benchmarked.

---

## 6. Actionable Fixes & Open Questions

### Actionable Fixes for `ARCHITECTURE-SPINE.md`
1. **Amend AD-23 (Two-Tier Storage & Sizing):**
   Set stream capacity to `MAXLEN ~ 1000000`. Remove key-level TTL language; replace with rolling consumer-driven trimming via `XTRIM stream:benchmark:telemetry MINID ~ <seven_days_ago_ms>`.
2. **Amend AD-24 (Non-Blocking Emission):**
   Remove `queueMicrotask`; mandate `setImmediate` exclusively.
3. **Amend AD-25 (Centralized Instrumentation Context):**
   Specify `TelemetryContext` passed through crawler `session` so `AbstractApiClient.request()` can accumulate transport metrics into the run event emitted by `AbstractCrawler.start()`.
4. **Amend AD-27 & Thin Event Extension (CRIT-1 & HIGH-1):**
   Remove reference to `MetadataSchemaRegistry` for thin events. Define extension in `src/core/types.js` (`ThinEvent`) and `src/utils/redis-stream-publisher.js`, with `scraperId` parameter support.
5. **Update Stack & Directories (HIGH-2 & HIGH-3):**
   Update Node.js requirement to `>= 20.18.1`. Update folder seed to place background workers in `api/services/benchmark/` and domain logic in `src/benchmark/`. Fix `base-api-client.js` to `src/core/base-client.js`.
6. **Harmonize `metrics-catalog.md` (HIGH-4):**
   Update line 75 of `metrics-catalog.md` to remove `auto-gate` and align with AD-27 alert-only policy.

### Open Questions for Architecture Gate
1. **Canary Account Isolation:** Should platforms requiring authentication (e.g. Facebook, Instagram) maintain dedicated synthetic canary accounts in `FacebookAccount` model, or should canaries only probe public unauthenticated endpoints?
2. **PostgreSQL Retention Policy:** What is the long-term retention period for `ScraperHealthScore` and `ScraperCanaryRun` in PostgreSQL? (Recommendation: 90 days rolling via `retentionScheduler.js`).

---
*Report filed by Architecture Rubric Walker for Epic 34 Review Gate.*


---

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


---

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
