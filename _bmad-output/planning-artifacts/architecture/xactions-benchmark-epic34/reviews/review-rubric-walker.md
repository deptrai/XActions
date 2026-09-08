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
