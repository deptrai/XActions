# Epic 34 Architecture Spine — Update Report 2026-09-08

## What was changed

The architecture spine `ARCHITECTURE-SPINE.md` and its companion `metrics-catalog.md` were updated to close the findings raised by the 2026-09-08 Reviewer Gate (rubric-walker + tech-currency + adversarial).

### Key amendments

1. **AD-23 — Redis Stream retention fixed**  
   - Removed invalid "7-day TTL" language (Redis Streams have no per-entry TTL).  
   - Set `MAXLEN ~ 1000000` and defined rolling retention via `XTRIM ... MINID ~ <seven_days_ago_ms>` in the consumer.  
   - Declared `telemetry-consumer.js` as a native Redis Stream consumer-group reader (`XREADGROUP` + `XACK`) — not a Bull worker.

2. **AD-24 — Emission primitive fixed**  
   - `setImmediate` only; `queueMicrotask` removed to prevent event-loop starvation and NFR-19 violations.

3. **AD-25 — Centralized instrumentation tightened**  
   - Added `TelemetryContext` threaded through `session.telemetry` so `AbstractCrawler.start()` and `AbstractApiClient.request()` contribute to one correlated run.  
   - Corrected `base-client.js` filename (not `base-api-client.js`).

4. **AD-26 — Knock-out gate data contract fixed**  
   - Gate field names now map 1:1 to `metrics-catalog.md` metric paths (`true_success_rate`, `field_fill_rate`, `false_200_rate`, `schema_integrity_rate`).

5. **AD-27 — Thin-event extension points corrected**  
   - `benchmark_health`/`benchmark_alert` belong in `ThinEvent` typedef and `RedisStreamPublisher.publish()` — **not** `MetadataSchemaRegistry` or `prisma-store.js`.  
   - `ThinEvent` gains optional `scraperId`; fallback is `"UNKNOWN"` (not `"B"`).

6. **AD-28 — Category map aligned to brownfield code**  
   - Catalog profiles now map to `CATEGORY_VALUES` (`ecom`, `realestate`, `recruitment`, `b2b`, `fnb_merchant`, `healthcare`, `legal`, etc.).

7. **AD-29 — Two-phase correlated telemetry envelope (new)**  
   - `telemetry:request` emitted by `AbstractApiClient.request()` with transport metrics.  
   - `telemetry:run` emitted by `AbstractCrawler.start()` with run shape.  
   - Redis `XADD` fields are flat `Record<string, string>`.

8. **AD-30 — Validator-to-telemetry bridge (new)**  
   - `AbstractPlatformResponseValidator.validateResponse()` returns `{ isValid, isFalse200, isCheckpoint, isRateLimit, isAuthExpired, reason? }` and writes into the shared telemetry context.

9. **AD-31 — Single-writer tier state machine (new)**  
   - `BenchmarkStateManager` is the sole mutator of `hash:scraper:health_tier`; `ScraperHealthScore` gains `consecutiveCleanRuns` and `requalifiedAt`.  
   - 24-hour knock-out window ignores pre-`requalifiedAt` failures to stop demote/promote oscillation.

10. **AD-32 — Health tier cache (new)**  
    - In-memory `HealthTierCache` with 30s refresh; PG warmup on startup; fail-safe fallback to `"C"` if a recent Tier C record exists, otherwise `"UNKNOWN"`.

11. **AD-33 — Item count + canary isolation (new)**  
    - `extractItemCount(result)` handles `{ items, posts, data, records, results, count }` return shapes.  
    - Canary runs use `session.isCanary = true`; governor bypasses account velocity/quota for canary traffic.

12. **AD-34 — Scraper identity + category binding (new)**  
    - Every crawler declares `scraperId` (`<platform>-<variant>`) and `category` (a `CATEGORY_VALUES` entry); both are stamped on every event.

### Structural seed changes

- Domain logic: `src/benchmark/` instead of `src/services/benchmark/`.
- Background workers: `api/services/benchmark/` (consistent with existing `api/services/retentionScheduler.js` and `jobQueue.js`).
- CLI command: `src/cli/commands/benchmark.js` (consistent with existing `registerBenchmarkCommand` pattern).

### Stack corrections

- Node.js: `>= 20.18.1` (was `>= 18`; project `package.json` enforces this, Node 18 is EOL).
- Redis Client: explicitly `node-redis` 4.x (`redis@^4.6.11`).
- `node-cron` 4.x: primary scheduling pattern.
- Bull 4.x: discrete job enqueueing only, **not** a Redis Stream consumer.

### Companion fixes

- `metrics-catalog.md`:  
  - Tier C now says "no auto-cutoff; human-in-the-loop" (removed contradictory `auto-gate`).  
  - Category profiles mapped to code `CATEGORY_VALUES`.  
  - Removed the duplicated Telemetry Schema block.

### Story file alignment

Stories `34-1` through `34-8` were updated to use the corrected paths, the `setImmediate`-only rule, the `XREADGROUP` consumer, the `HealthTierCache`, the synchronous `formatPayload` + async `publish()` enrichment pattern, `UNKNOWN` fallback, `isCanary` bypass, and `BenchmarkStateManager` single-writer flow.

### Validation

- `lint_spine.py` passes with **0 findings**.
- The original validation report remains in `ARCHITECTURE-VALIDATION-REPORT-2026-09-08.md` (before fixes) and `ARCHITECTURE-VALIDATION-REPORT-2026-09-08.html`.

## Status

`ARCHITECTURE-SPINE.md` is now **ready for story freeze** pending a final re-review if the team wants independent confirmation.

## Open questions still outstanding

1. Canary auth strategy for auth-required platforms (dedicated test accounts or public endpoints only?)
2. Long-term PostgreSQL retention policy for `ScraperHealthScore` and `ScraperCanaryRun` (90 days assumed).
