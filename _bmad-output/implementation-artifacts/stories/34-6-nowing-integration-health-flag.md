# Story 34.6: Nowing Integration Health Flag & Stream Events

## Story
- **As a** Nowing downstream pipeline consumer and B2B data engineer,
- **I want** thin events published to `stream:social:raw_posts` to include scraper identification and benchmark health status (`scraperId`, `benchmark_health`, `benchmark_alert`),
- **So that** Nowing receives clear visibility into scraper reliability and can flag degraded Tier C data for operator intervention without breaking automated ingestion.

---

## Acceptance Criteria

### AC 1: ThinEvent Schema Enrichment
- **Given** the `ThinEvent` schema in `src/core/types.js` and `types/core.d.ts`,
- **When** defining event payload types,
- **Then**:
  - `ThinEvent` includes `scraperId?: string`.
  - `ThinEvent` includes `benchmark_health: 'A' | 'B' | 'C' | 'UNKNOWN'`.
  - `ThinEvent` includes `benchmark_alert: boolean | string`.
  - `benchmark_ts?: string` (ISO 8601 timestamp of benchmark tagging).

### AC 2: Synchronous O(1) Payload Enrichment in RedisStreamPublisher
- **Given** an instance of `RedisStreamPublisher`,
- **When** `formatPayload(item, scraperId)` is executed,
- **Then**:
  - It retrieves the current health tier synchronously from `HealthTierCache.get(scraperId)` in O(1) time without async network I/O on the hot path (AD-32).
  - If `scraperId` is not found or unranked, it resolves safely to `"UNKNOWN"` (never defaulting to `"B"`), per AD-32.
  - If `item.benchmark_health` is already explicitly provided, that value is preserved.
  - `benchmark_alert` is set to `"true"` if and only if `benchmark_health === 'C'`, otherwise `"false"`.
  - All emitted fields in the Redis Stream XADD record are formatted as strings.

### AC 3: Human-in-the-Loop Tier C Ingestion Guarantee (AD-27)
- **Given** a scraper evaluated as Tier C (health score < 70 or knock-out gate triggered),
- **When** thin events are published by that scraper,
- **Then**:
  - The event is published to `stream:social:raw_posts` with `benchmark_health: "C"` and `benchmark_alert: "true"`.
  - Ingestion is **not** halted or dropped automatically (AD-27: human decides cutoff).
  - Downstream consumers (Nowing) receive the event with the alert flag.

### AC 4: Scraper ID Propagation from BaseCrawler
- **Given** scrapers extending `BaseCrawler` (e.g. Twitter, Facebook, Threads, TikTok, Zalo, YouTube, etc.),
- **When** publishing thin events to Redis stream,
- **Then**:
  - The crawler's `this.scraperId` is passed into `publisher.publish(...)` or embedded in the item.
  - `RedisStreamPublisher` records `scraperId` in the published thin event.

### AC 5: Sub-Millisecond Benchmark Lookup Performance (NFR)
- **Given** 1,000 consecutive calls to `formatPayload` with health tier lookups,
- **When** measuring lookup latency,
- **Then**:
  - The average in-memory tier resolution overhead is strictly < 0.1ms per event (sub-millisecond constraint satisfied).

### AC 6: Test Suite & Zero Regression
- **Given** unit and integration test suites,
- **When** running `vitest run tests/benchmark/nowing-integration.test.js` and `vitest run tests/store/redis-stream-publisher.test.js`,
- **Then**:
  - 100% of Nowing integration tests pass (Tier A, Tier B, Tier C, UNKNOWN, fallback, latency).
  - All existing crawler stream tests pass with zero regression.

---

## Architecture & Technical Guardrails

### 1. Synchronous Cache vs Async Redis (AD-32)
`RedisStreamPublisher.formatPayload` must remain strictly synchronous. Never call `await redis.hget` inside `formatPayload`. The health tier is read from `HealthTierCache` in-memory Map which polls Redis `hash:scraper:health_tier` every 30s.

### 2. AD-32 Safe Fallback Alignment
Never default unranked scrapers to `"B"`. An un-benchmarked scraper has unknown reliability; defaulting to `"B"` would mask unmonitored scrapers. The default is `"UNKNOWN"`. If PostgreSQL has a Tier C record within 24 hours, `resolveFallback(scraperId)` resolves to `"C"`.

### 3. String-Only Values for Redis XADD
Redis Streams (XADD) requires all key-value entries to be strings. `benchmark_alert` must be formatted as `"true"` or `"false"`.

---

## Code Map

- `src/core/types.js` (UPDATE): Update JSDoc `@typedef {Object} ThinEvent` with benchmark fields.
- `types/core.d.ts` (UPDATE): Update TypeScript `ThinEvent` interface.
- `src/utils/redis-stream-publisher.js` (UPDATE): Inject `HealthTierCache`, update `formatPayload()` and `publish()` to support `scraperId` and benchmark tagging.
- `src/scrapers/social/twitter/crawler.js` (UPDATE): Pass `scraperId` to `publish`.
- `src/scrapers/social/facebook/crawler.js` (UPDATE): Pass `scraperId` to `publish`.
- `src/scrapers/social/threads/crawler.js` (UPDATE): Pass `scraperId` to `publish`.
- `src/scrapers/social/tiktok/crawler.js` (UPDATE): Pass `scraperId` to `publish`.
- `src/scrapers/social/youtube/crawler.js` (UPDATE): Pass `scraperId` to `publish`.
- `src/scrapers/social/zalo/crawler.js` (UPDATE): Pass `scraperId` to `publish`.
- `tests/store/redis-stream-publisher.test.js` (UPDATE): Update contract tests for new benchmark fields.
- `tests/benchmark/nowing-integration.test.js` (NEW): Integration tests for Nowing stream event tagging.

---

## Tasks / Subtasks

- [x] **Phase 1: Types & RedisStreamPublisher Core Enhancement (`src/core/types.js`, `types/core.d.ts`, `src/utils/redis-stream-publisher.js`)**
  - [x] Update `ThinEvent` definitions in `src/core/types.js` and `types/core.d.ts` (AC 1).
  - [x] Inject `healthTierCache` in `RedisStreamPublisher` constructor (AC 2).
  - [x] Update `formatPayload(item, scraperId)` to include `scraperId`, `benchmark_health`, `benchmark_alert` (AC 2, AC 3).
  - [x] Support flexible `publish(streamKey, item, scraperId)` and `publish(item, scraperId)` (AC 2, AC 4).
  - [x] Update existing `tests/store/redis-stream-publisher.test.js` to match enhanced payload (AC 6).

- [x] **Phase 2: Crawler Stream Emissions with Scraper ID (`src/scrapers/*`)**
  - [x] Thread `this.scraperId` into `publisher.publish(...)` in `TwitterCrawler` (AC 4).
  - [x] Thread `this.scraperId` into `publisher.publish(...)` in `FacebookCrawler` (AC 4).
  - [x] Thread `this.scraperId` into `publisher.publish(...)` in `ThreadsCrawler` (AC 4).
  - [x] Thread `this.scraperId` into `publisher.publish(...)` in `TikTokCrawler` (AC 4).
  - [x] Thread `this.scraperId` into `publisher.publish(...)` in `YouTubeCrawler` (AC 4).
  - [x] Thread `this.scraperId` into `publisher.publish(...)` in `ZaloCrawler` (AC 4).

- [x] **Phase 3: Integration Tests & Verification (`tests/benchmark/nowing-integration.test.js`)**
  - [x] Test Tier A thin event tagging (`benchmark_health: "A"`, `benchmark_alert: "false"`) (AC 1, AC 2).
  - [x] Test Tier B thin event tagging (`benchmark_health: "B"`, `benchmark_alert: "false"`) (AC 1, AC 2).
  - [x] Test Tier C thin event tagging (`benchmark_health: "C"`, `benchmark_alert: "true"`) with non-blocking emission (AC 2, AC 3).
  - [x] Test UNKNOWN fallback for missing/unranked scrapers (AC 2).
  - [x] Benchmark latency test confirming < 0.1ms lookup overhead (AC 5).
  - [x] End-to-end crawler thin event verification (AC 4, AC 6).

---

## Dev Agent Record

### Agent Model Used
claude-sonnet-5[1m]

### Implementation Plan
1. Chuẩn hóa đặc tả và ACs cho Story 34.6.
2. Cập nhật `src/core/types.js` và `types/core.d.ts`.
3. Cập nhật `src/utils/redis-stream-publisher.js` với synchronous O(1) `HealthTierCache`.
4. Cập nhật các crawler để truyền `this.scraperId`.
5. Viết test suite `tests/benchmark/nowing-integration.test.js` và cập nhật `tests/store/redis-stream-publisher.test.js`.
6. Chạy toàn bộ benchmark test suite và regression test.

### Debug Log
- Khắc phục lỗi format test `tests/store/redis-stream-publisher.test.js` do bổ sung `benchmark_health: 'UNKNOWN'` và `benchmark_alert: 'false'` trong thin event schema.
- Thêm `vi.restoreAllMocks()` trong `afterEach` tại `tests/benchmark/scorecard-cli.test.js` ngăn rò rỉ spy giữa các bài test.

### Completion Notes
- Hoàn thành đầy đủ 3 Phase theo đúng đặc tả BDD và các yêu cầu kiến trúc AD-27, AD-32.
- 16 test files với 136 tests benchmark vượt qua 100%.

### File List
- `_bmad-output/implementation-artifacts/stories/34-6-nowing-integration-health-flag.md` (UPDATE)
- `src/core/types.js` (UPDATE)
- `types/core.d.ts` (UPDATE)
- `src/utils/redis-stream-publisher.js` (UPDATE)
- `src/scrapers/social/twitter/crawler.js` (UPDATE)
- `src/scrapers/social/facebook/crawler.js` (UPDATE)
- `src/scrapers/social/threads/crawler.js` (UPDATE)
- `src/scrapers/social/tiktok/crawler.js` (UPDATE)
- `src/scrapers/social/youtube/crawler.js` (UPDATE)
- `src/scrapers/social/zalo/crawler.js` (UPDATE)
- `src/scrapers/healthcare/crawler.js` (UPDATE)
- `src/scrapers/legal/ip-trademark/crawler.js` (UPDATE)
- `src/scrapers/procurement/b2b-registry-extended/index.js` (UPDATE)
- `src/scrapers/vehicles/automotive/crawler.js` (UPDATE)
- `src/scrapers/fnb/merchant/crawler.js` (UPDATE)
- `tests/store/redis-stream-publisher.test.js` (UPDATE)
- `tests/benchmark/scorecard-cli.test.js` (UPDATE)
- `tests/benchmark/nowing-integration.test.js` (NEW)

### Change Log
- 2026-09-08: Chuẩn hóa đặc tả BDD Story 34.6, khắc phục mâu thuẫn AD-32 (thay thế fallback B bằng UNKNOWN), thiết lập 3 Phase và chuyển trạng thái sang `ready-for-dev`.
- 2026-09-08: Hoàn thành triển khai và test suite cho Story 34.6, chuyển trạng thái sang `review`.
- 2026-09-08: Hoàn tất 4 tầng Adversarial Code Review, xác minh 100% ACs, AD-27 và AD-32. Đánh dấu `done`.

### Status
done

---

## Senior Developer Review (AI)

### Review Summary (2026-09-08)
- **Review Outcome:** Approved (Pass with Flying Colors)
- **Layer 1 (AC Verification):** Đạt 100% AC 1 đến AC 6 (ThinEvent schema enrichment, synchronous O(1) in-memory tier resolution, non-blocking ingestion guarantee, scraperId propagation, latency < 0.1ms, zero regression).
- **Layer 2 (Architecture & Security):**
  - Tuân thủ AD-27: Tier C đánh dấu `benchmark_alert: "true"` nhưng không ngắt dòng dữ liệu (human-in-the-loop).
  - Tuân thủ AD-32: Lookup đồng bộ không network I/O; fallback an toàn về `UNKNOWN` khi unranked (không mặc định là B).
- **Layer 3 (Code Quality & Performance):**
  - Thử nghiệm 1,000 lần lặp formatPayload hoàn tất trong ~9ms (< 0.01ms mỗi sự kiện, vượt xa tiêu chuẩn NFR < 0.1ms).
  - Hỗ trợ đa dạng chữ ký gọi hàm `publish` linh hoạt cho mọi crawler.
- **Layer 4 (Edge Cases & Resilience):**
  - Giữ nguyên các cờ override nếu đã được thiết lập trước.
  - Định dạng chuẩn chuỗi string cho Redis Stream XADD.
- **Test Suite Verification:** 16 test files với 136 tests benchmark đạt 100% pass rate. Không có lỗi hồi quy.

