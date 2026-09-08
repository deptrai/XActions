---
title: 'Story 34.1: Benchmark Telemetry Schema & Storage'
type: 'feature'
created: '2026-09-08'
updated: '2026-09-08'
status: 'done'
epic: 34
story_number: 34.1
phase: 'MVP'
priority: 'high'
baseline_commit: 'd6ea5754'
context:
  - _bmad-output/specs/spec-scraper-benchmark/SPEC.md
  - _bmad-output/specs/spec-scraper-benchmark/metrics-catalog.md
  - _bmad-output/planning-artifacts/architecture/xactions-benchmark-epic34/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/epics.md#epic-34
  - _bmad-output/planning-artifacts/backlog-epic-34.md
  - _bmad-output/planning-artifacts/sprint-change-proposal-2026-09-08-benchmark-v2.md
  - _bmad-output/planning-artifacts/review-epic34-synthesis-2026-09-08.md
  - prisma/schema.prisma
  - src/utils/redis-stream-publisher.js
  - src/core/types.js
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nowing (B2B Lead Hub) phụ thuộc vào dữ liệu trích xuất từ 15+ nền tảng của XActions nhưng hiện chưa có hạ tầng telemetry chuẩn mực để đo lường định lượng và khách quan 4 trụ cột: độ ổn định (stability), chất lượng dữ liệu (quality), độ nhiễu (noise), và chi phí tài nguyên (cost). Nếu ghi trực tiếp dữ liệu thô của từng lượt scrape vào PostgreSQL sẽ gây hiện tượng write amplification và cạn kiệt connection pool nghiêm trọng. Đồng thời, đường dẫn trả về dữ liệu (return path) của crawler đòi hỏi độ trễ cực thấp (< 1% overhead theo NFR-19), không được phép bị block bởi việc gửi dữ liệu giám sát.

**Approach:**
1. **Kiến trúc lưu trữ 2 tầng (Two-Tier Storage Architecture - AD-23):**
   - **Tầng 1 (Hot/Raw Stream):** Dữ liệu telemetry thô được gửi qua Redis Stream `stream:benchmark:telemetry` với cấu hình `MAXLEN ~ 1000000`. Cơ chế rolling retention 7 ngày được thực thi định kỳ bởi consumer thông qua `XTRIM stream:benchmark:telemetry MINID ~ <seven_days_ago_ms>`. Nghiêm cấm sử dụng `EXPIRE` trên stream key (vì Redis Stream không hỗ trợ TTL từng entry, lệnh `EXPIRE` sẽ xóa sổ toàn bộ stream).
   - **Tầng 2 (Cold/Aggregated Store):** PostgreSQL thông qua Prisma chỉ lưu trữ các bản ghi tổng hợp (rollups) theo giờ/ngày trong model `ScraperHealthScore` (retention 90 ngày per AD-36) và các kết quả synthetic probe trong model `ScraperCanaryRun` (retention 30 ngày per AD-36).
2. **Prisma Models trong `prisma/schema.prisma`:**
   - Thêm model `ScraperHealthScore`: lưu trữ Health Score (0-100), phân hạng Tier (`A`, `B`, `C`, `UNKNOWN`), điểm thành phần 4 trụ cột, `metricsSnapshot` (Json), cùng các trường quản lý trạng thái tái chuẩn hóa `consecutiveCleanRuns` và `requalifiedAt` theo thiết kế State Machine (AD-31).
   - Thêm model `ScraperCanaryRun`: lưu trữ kết quả kiểm tra định kỳ (synthetic canary probes) bao gồm trạng thái thành công, latency, HTTP status, cờ `false200Detected`, `checkpointDetected`, và `errorReason`.
3. **TelemetryContext trong `src/core/telemetry-context.js` (AD-25, AD-29):**
   - Cung cấp lớp quản trị ngữ cảnh phiên cào dữ liệu với định danh tương quan `runId` (UUID v4).
   - Thu thập chi tiết các lượt gọi mạng (`telemetry:request`) từ client và thông số lưu trữ (`storeMetrics`) để phát sinh sự kiện tổng hợp (`telemetry:run`).
4. **TelemetryEmitter trong `src/core/telemetry-emitter.js` (AD-24, AD-29):**
   - Bộ phát telemetry non-blocking thực thi hoàn toàn qua `setImmediate` (nghiêm cấm `queueMicrotask` để tránh làm đói I/O loop).
   - Tích hợp in-memory circuit breaker tự động drop event khi buffer vượt quá 1,000 items (fire-and-forget), cung cấp `getMetrics()` để kiểm tra trạng thái drop.
   - Chuẩn hóa phẳng (flat `Record<string, string>`) cho wire contract của Redis Stream `XADD`, tự động serialize JSON cho các trường phức tạp có hậu tố `_json`.
   - Hỗ trợ tương thích kép client Redis (`node-redis` v4 & `ioredis`).
5. **HealthTierCache trong `src/benchmark/health-tier-cache.js` (AD-32):**
   - Cung cấp cache trong bộ nhớ `Map<scraperId, tier>` truy xuất đồng bộ O(1) cho luồng phát thin-events của `RedisStreamPublisher`.
   - Polling làm mới từ Redis Hash `hash:scraper:health_tier` mỗi 30 giây.
   - Hàm `warmup()` khi khởi động server nạp tier mới nhất từ PostgreSQL `ScraperHealthScore` vào cả bộ nhớ và Redis Hash để chống cold-start masking.
   - Fallback an toàn: nếu không có cache, kiểm tra DB nếu có Tier C trong 24h thì trả về `"C"`; nếu hoàn toàn không có dữ liệu thì trả về `"UNKNOWN"` (tuyệt đối không mặc định là `"B"`).
6. **TelemetryConsumer trong `api/services/benchmark/telemetry-consumer.js` (AD-23):**
   - Consumer Group Reader đọc trực tiếp bằng API native Redis Stream (`XREADGROUP` + `XACK`, group `benchmark_telemetry_workers`) với cơ chế tạo group an toàn (`MKSTREAM: true` và bọc xử lý `BUSYGROUP`).
   - Hỗ trợ non-busy polling bằng `BLOCK` hoặc backoff sleep khi stream rỗng.
   - Tự động gọi `XTRIM MINID` duy trì cửa sổ trượt 7 ngày trên mỗi chu kỳ đọc.
   - Ghép nối sự kiện `telemetry:run` và `telemetry:request` theo `runId`, tổng hợp rollup chỉ số và ghi vào `ScraperHealthScore` (chuẩn bị điểm nối cho Scoring Engine trong Story 34.4).
7. **RetentionCleaner trong `api/services/benchmark/retention-cleaner.js` (AD-36):**
   - Định kỳ dọn dẹp các bản ghi PostgreSQL quá hạn (`ScraperHealthScore` > 90 ngày, `ScraperCanaryRun` > 30 ngày) bằng batch chunking có độ trễ để chống khóa bảng.
8. **Types Khai Báo trong `src/core/types.js`:**
   - Cập nhật `RedisClientLike` với đầy đủ các hàm Stream Consumer (`xReadGroup`, `xAck`, `xTrim`) và Hash (`hGetAll`, `hSet`).
   - Cập nhật `ThinEvent` với các trường mở rộng `scraperId`, `benchmark_health`, `benchmark_alert`.

## Boundaries & Constraints

**Always:**
- Áp dụng triệt để mô hình 2 tầng: Dữ liệu thô của production scrape chỉ gửi vào Redis Stream `stream:benchmark:telemetry`; chỉ ghi PostgreSQL cho các bản ghi tổng hợp rollups và canary probe.
- Quá trình phát telemetry (`TelemetryEmitter.emit`) phải chạy qua `setImmediate` và không bao giờ được `await` trên hot path của crawler/client.
- Redis Stream rolling retention phải được thực thi bằng `XTRIM ... MINID ~ <timestamp>` trong consumer loop; tuyệt đối không gọi `EXPIRE` trên stream key.
- Truy xuất hạng sức khỏe (Health Tier) phục vụ enrich thin-event phải là thao tác đọc đồng bộ từ `HealthTierCache` in-memory (0 network call).
- Khi scraper chưa từng được đánh giá, hạng sức khỏe trả về bắt buộc là `"UNKNOWN"` (không được tự ý gán nhãn `"B"`).
- Mã nguồn của các platform crawlers hiện hữu (Twitter, Facebook, Zalo, YouTube...) phải được giữ nguyên vẹn (Centralized Instrumentation - AD-25).

**Ask First:**
- Nếu cần thay đổi tên Redis Stream key (`stream:benchmark:telemetry`), tên consumer group (`benchmark_telemetry_workers`), hoặc cấu trúc model Prisma.
- Nếu muốn bổ sung thêm trường ngoài Telemetry Schema chuẩn đã quy định trong `metrics-catalog.md`.

**Never:**
- Không sử dụng Bull 4.x để làm consumer cho Redis Streams (Bull không tương thích cấu trúc Stream của Redis).
- Không sử dụng `queueMicrotask` cho việc phát telemetry (vi phạm NFR-19 do làm đói I/O loop khi concurrency cao).
- Không để bất kỳ ngoại lệ nào phát sinh từ telemetry làm gián đoạn hoặc crash luồng cào dữ liệu chính.
- Không ghi đè hay thay thế file `src/utils/redis-stream-publisher.js` hiện có; chỉ chuẩn bị điểm tích hợp cho Story 34.6.
- Không triển khai logic tính điểm 4 trụ cột phức tạp của Story 34.4 trong Story 34.1; Story 34.1 chỉ chuẩn hóa dữ liệu tổng hợp và pipeline lưu trữ.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected Output | Error Handling |
|---|---|---|---|
| Phát telemetry request | `emitter.emitRequest(reqPayload)` | `XADD` vào `stream:benchmark:telemetry` dạng flat string record | Redis lỗi → bắt ngoại lệ, ghi log stderr `[TELEMETRY]`, không throw |
| Phát telemetry run | `emitter.emitRun(runPayload)` | `XADD` vào `stream:benchmark:telemetry` | Buffer > 1,000 items → circuit breaker ngắt và drop event âm thầm |
| Kiểm tra metrics emitter | `emitter.getMetrics()` | `{ queuedCount, emittedCount, droppedCount, errorCount }` | Luôn trả về object chỉ số chính xác |
| Khởi tạo Consumer Group | `consumer.initGroup()` | Tạo group `benchmark_telemetry_workers` với `MKSTREAM` | Nếu group đã tồn tại (`BUSYGROUP`) → bỏ qua và chạy tiếp |
| Consumer đọc stream có dữ liệu | `consumer.processBatch()` | Đọc qua `XREADGROUP`, ghép nối `runId`, ghi DB, gọi `XACK`, chạy `XTRIM MINID` | Entry hỏng/parse lỗi → log warning và vẫn `XACK` để không bị nghẽn PEL |
| Consumer đọc stream rỗng | Stream không có entry mới | Trả về `[]`, áp dụng `BLOCK` hoặc sleep backoff tránh busy spin | Không gây nghẽn CPU |
| Đọc cache tier thành công | `healthTierCache.get('twitter-hybrid')` | Trả về `'A'`, `'B'`, hoặc `'C'` từ bộ nhớ O(1) | Cache miss → tra cứu DB 24h: có Tier C trả về `'C'`, không có trả về `'UNKNOWN'` |
| Scraper mới chưa có dữ liệu | `healthTierCache.get('new-scraper')` | Trả về `'UNKNOWN'` | Không được trả về `'B'` (tránh che giấu scraper chưa benchmark) |
| Rollup ghi vào PostgreSQL | Dữ liệu tổng hợp từ consumer | `prisma.scraperHealthScore.create(...)` | Lỗi DB → ghi log error, retry ở chu kỳ sau |
| Dọn dẹp dữ liệu cũ (AD-36) | Chạy job retention hàng ngày | Xóa `ScraperHealthScore` > 90d, `ScraperCanaryRun` > 30d | Xóa theo batch 1,000 items kèm delay 50ms tránh lock bảng |

</frozen-after-approval>

## User Story

As an **XActions Platform Operator & Nowing Data Consumer**,  
I want **a robust two-tier telemetry schema, non-blocking emitter with circuit breaker, Redis Stream consumer with rolling 7-day retention, and PostgreSQL storage layer**,  
So that **XActions can reliably capture scraper stability, quality, noise, and cost metrics with <1% latency overhead (NFR-19) and store aggregated health rollups for 15+ platforms without database write amplification or scrape pipeline blockage**.

---

## Acceptance Criteria (BDD)

### AC 1: Prisma Models Definition (`ScraperHealthScore` & `ScraperCanaryRun`)
- **Given** file `prisma/schema.prisma`
- **When** thêm định nghĩa các model phục vụ benchmark
- **Then** model `ScraperHealthScore` phải có đầy đủ các trường:
  - `id`: `String @id @default(cuid())`
  - `scraperId`: `String` (định danh dạng `<platform>-<variant>`, e.g. `twitter-hybrid`, `pasgo-merchant`)
  - `platform`: `String`
  - `healthScore`: `Float` (giá trị 0.0 - 100.0)
  - `tier`: `String` (giá trị `'A'`, `'B'`, `'C'`, `'UNKNOWN'`)
  - `stabilityScore`: `Float` (0.0 - 100.0)
  - `qualityScore`: `Float` (0.0 - 100.0)
  - `noiseScore`: `Float` (0.0 - 100.0)
  - `costScore`: `Float` (0.0 - 100.0)
  - `sampleCount`: `Int @default(0)`
  - `consecutiveCleanRuns`: `Int @default(0)` (cho State Machine tái chuẩn hóa per AD-31)
  - `requalifiedAt`: `DateTime?` (mốc thời gian re-qualification epoch per AD-31)
  - `evaluatedAt`: `DateTime @default(now())`
  - `metricsSnapshot`: `Json` (lưu trữ snapshot chi tiết các chỉ số p95_latency, field_fill_rate...)
  - Các index: `@@index([platform, evaluatedAt(sort: Desc)])` và `@@index([scraperId, evaluatedAt(sort: Desc)])`
- **And** model `ScraperCanaryRun` phải có đầy đủ các trường:
  - `id`: `String @id @default(cuid())`
  - `scraperId`: `String`
  - `platform`: `String`
  - `targetUrl`: `String`
  - `isSuccess`: `Boolean`
  - `latencyMs`: `Int`
  - `httpStatus`: `Int`
  - `false200Detected`: `Boolean @default(false)`
  - `checkpointDetected`: `Boolean @default(false)`
  - `errorReason`: `String?`
  - `executedAt`: `DateTime @default(now())`
  - Các index: `@@index([platform, executedAt(sort: Desc)])` và `@@index([scraperId, executedAt(sort: Desc)])`
- **And** lệnh `npx prisma validate` hoàn thành thành công không có lỗi cú pháp.

### AC 2: Non-Blocking Telemetry Emitter (`src/core/telemetry-emitter.js`) & Circuit Breaker
- **Given** module `src/core/telemetry-emitter.js`
- **When** crawler hoặc client gọi phương thức phát telemetry (`emitRun` hoặc `emitRequest`)
- **Then** emitter sử dụng `setImmediate` độc quyền để trì hoãn việc gửi sang pha check của event loop, đảm bảo không làm nghẽn pha I/O polling (AD-24).
- **And** overhead thực thi đo được của hàm phát telemetry phải < 1ms (thỏa mãn NFR-19).
- **And** emitter tích hợp in-memory buffer: nếu số lượng item đang chờ vượt quá 1,000 items (circuit breaker threshold), emitter sẽ drop các event mới và tăng metric `droppedCount` mà không throw lỗi ra ngoài.
- **And** cung cấp phương thức `getMetrics()` trả về object thống kê `{ queuedCount, emittedCount, droppedCount, errorCount }`.
- **And** nếu việc kết nối hoặc gửi lệnh Redis `xAdd` thất bại, emitter bắt toàn bộ ngoại lệ và ghi log dạng `[TELEMETRY] <error>`, bảo vệ return path của crawler.
- **And** hỗ trợ cả hai client driver `node-redis` (v4 camelCase) và `ioredis` (lowercase).

### AC 3: Run Telemetry Context (`src/core/telemetry-context.js`)
- **Given** module `src/core/telemetry-context.js`
- **When** crawler khởi tạo phiên làm việc thông qua `TelemetryContext.create({ scraperId, platform, category, action, source })`
- **Then** một instance ngữ cảnh được tạo với `runId` (UUID v4) duy nhất và timestamp bắt đầu.
- **And** cung cấp phương thức `recordRequest({ latencyMs, httpStatus, proxyBytes, retries, isFalse200, isCheckpoint, proxyQuarantined })` để tích hợp ghi nhận các chỉ số tầng transport từ HTTP client.
- **And** cung cấp phương thức `recordStoreMetrics({ fieldFillRate, schemaValid, duplicates, totalItems })` để ghi nhận các chỉ số tầng persistence.
- **And** cung cấp phương thức `toRunPayload({ isSuccess, durationMs, itemCount, errorName })` xuất ra payload tổng thể hoàn chỉnh sẵn sàng phát qua emitter.

### AC 4: Redis Stream Telemetry Storage Contract & Two-Phase Envelopes
- **Given** Redis Stream key `stream:benchmark:telemetry`
- **When** các sự kiện telemetry được nạp vào stream qua lệnh `XADD`
- **Then** cấu hình stream tuân thủ `MAXLEN ~ 1000000` (xấp xỉ 1 triệu phần tử, tương thích với AD-7).
- **And** mọi giá trị trong bản ghi gửi lên Redis Stream đều ở định dạng chuỗi (`Record<string, string>`). Cung cấp module serialize/deserialize chuyển đổi các trường kiểu đối tượng hoặc mảng sang chuỗi JSON có hậu tố `_json` (`flattenPayload` & `unflattenPayload`) (AD-29).
- **And** hỗ trợ 2 loại phong bì sự kiện (two-phase envelopes) liên kết với nhau qua trường `runId`:
  - `telemetry:request`: `{ type: 'telemetry:request', runId, scraperId, platform, ts, latencyMs, httpStatus, proxyBytes, retries, isFalse200, isCheckpoint, proxyQuarantined }`
  - `telemetry:run`: `{ type: 'telemetry:run', runId, scraperId, platform, category, action, source, durationMs, itemCount, isSuccess, errorName }`

### AC 5: In-Memory Health Tier Cache (`src/benchmark/health-tier-cache.js`) & PostgreSQL Warmup
- **Given** module `src/benchmark/health-tier-cache.js`
- **When** `healthTierCache.get(scraperId)` được gọi đồng bộ trên hot path
- **Then** cache trả về ngay lập tức giá trị tier (`'A'`, `'B'`, `'C'`, `'UNKNOWN'`) từ in-memory `Map` trong thời gian O(1) mà không tạo ra network I/O (AD-32).
- **And** cache hỗ trợ cơ chế polling `refresh()` tự động gọi `HGETALL hash:scraper:health_tier` mỗi 30 giây để cập nhật thay đổi từ scoring engine.
- **And** khi server khởi động, phương thức `warmup({ prisma, redis })` tải bản ghi tier mới nhất của từng scraper từ bảng `ScraperHealthScore` trong PostgreSQL, đồng thời nạp vào cả in-memory Map và Redis Hash `hash:scraper:health_tier`.
- **And** nếu một `scraperId` không có trong cache, cơ chế fallback sẽ tra cứu DB: nếu có bản ghi Tier C trong vòng 24 giờ qua thì trả về `'C'`; nếu không có bản ghi nào thì trả về `'UNKNOWN'` (tuyệt đối không trả về `'B'`).

### AC 6: Redis Stream Consumer Group Reader (`api/services/benchmark/telemetry-consumer.js`) & 7-Day Rolling Retention
- **Given** service `api/services/benchmark/telemetry-consumer.js`
- **When** consumer lắng nghe sự kiện từ `stream:benchmark:telemetry`
- **Then** consumer tự động khởi tạo consumer group `benchmark_telemetry_workers` an toàn bằng cờ `MKSTREAM: true` và bắt lỗi `BUSYGROUP` nếu group đã tồn tại mà không crash tiến trình.
- **And** sử dụng native Redis client `XREADGROUP` với block timeout (e.g. `BLOCK: 2000`) để tránh hiện tượng CPU busy-spin khi stream rỗng.
- **And** tự động gọi `XACK` sau khi xử lý xong từng lô tin nhắn (AD-23). Nếu một entry bị hỏng/lỗi cú pháp JSON, consumer ghi log cảnh báo và vẫn thực hiện `XACK` để không làm kẹt danh sách PEL.
- **And** tại mỗi chu kỳ xử lý, consumer thực thi lệnh `XTRIM stream:benchmark:telemetry MINID ~ <now - 7*86400*1000>` để xóa các phần tử cũ hơn 7 ngày, bảo vệ tài nguyên RAM của Redis.
- **And** gom nhóm các event `telemetry:request` và `telemetry:run` theo `runId` để tổng hợp thành bản ghi chỉ số thô (mẫu số lượng, lỗi, latency trung bình, tỷ lệ thành công) và lưu vào `ScraperHealthScore` hoặc chuyển giao cho handler tính điểm.
- **And** hỗ trợ cơ chế graceful shutdown (dừng vòng lặp đọc và giải phóng kết nối an toàn khi nhận `SIGTERM`/`SIGINT`).

### AC 7: Scheduled PostgreSQL Retention Cleaner (`api/services/benchmark/retention-cleaner.js`)
- **Given** service `api/services/benchmark/retention-cleaner.js`
- **When** job dọn dẹp dữ liệu chạy định kỳ hàng ngày
- **Then** hệ thống thực hiện truy vấn xóa các bản ghi `ScraperHealthScore` có `evaluatedAt < now - 90 days` (AD-36).
- **And** hệ thống thực hiện truy vấn xóa các bản ghi `ScraperCanaryRun` có `executedAt < now - 30 days` (AD-36).
- **And** việc xóa được phân đoạn thành các batch nhỏ (mặc định 1,000 bản ghi) kèm khoảng nghỉ (`batchDelayMs = 50ms`) để tránh gây lock bảng hoặc làm chậm các truy vấn nghiệp vụ.

### AC 8: Types Definitions Update (`src/core/types.js`)
- **Given** file `src/core/types.js`
- **When** cập nhật các định nghĩa TypeScript / JSDoc
- **Then** `RedisClientLike` phải có thêm các hàm: `xReadGroup`, `xreadgroup`, `xAck`, `xack`, `xTrim`, `xtrim`, `hGetAll`, `hgetall`, `hSet`, `hset`.
- **And** `ThinEvent` phải có thêm các thuộc tính mở rộng: `scraperId?: string`, `benchmark_health?: 'A' | 'B' | 'C' | 'UNKNOWN'`, `benchmark_alert?: boolean`.

### AC 9: Zero-Mock Unit & Integration Test Suite Coverage
- **Given** thư mục kiểm thử `tests/benchmark/`
- **When** chạy `npm run test` hoặc `npx vitest run tests/benchmark/`
- **Then** các bài kiểm thử phải tuân thủ nghiêm ngặt nguyên tắc Zero-Mock (sử dụng Prisma Client và Redis Client thật hoặc in-memory / local test containers):
  - `tests/benchmark/telemetry-emitter.test.js`: Kiểm thử non-blocking `setImmediate`, circuit breaker khi buffer > 1,000 qua `getMetrics()`, bắt lỗi an toàn khi Redis ngắt kết nối.
  - `tests/benchmark/telemetry-context.test.js`: Kiểm thử tạo `runId`, ghi nhận transport metrics và store metrics, xuất payload chuẩn.
  - `tests/benchmark/health-tier-cache.test.js`: Kiểm thử in-memory O(1) read, chu kỳ refresh 30s, warmup từ DB, fallback an toàn về `UNKNOWN` và `C`.
  - `tests/benchmark/telemetry-pipeline.test.js`: Kiểm thử tích hợp E2E từ lúc `TelemetryEmitter.emit` -> `stream:benchmark:telemetry` -> `TelemetryConsumer` đọc an toàn, gọi `XACK` và `XTRIM MINID`.
  - `tests/benchmark/retention-cleaner.test.js`: Kiểm thử logic dọn dẹp dữ liệu 90 ngày (health score) và 30 ngày (canary run) theo batch.

---

## Technical Notes & Contracts

### 1. Prisma Schema Details (Thêm vào `prisma/schema.prisma`)

```prisma
model ScraperHealthScore {
  id                   String    @id @default(cuid())
  scraperId            String    // Format: '<platform>-<variant>', e.g. 'twitter-hybrid', 'pasgo-merchant'
  platform             String    // 'twitter', 'facebook', 'pasgo', 'topcv', etc.
  healthScore          Float     // 0.0 - 100.0
  tier                 String    // 'A' | 'B' | 'C' | 'UNKNOWN'
  stabilityScore       Float     // 0.0 - 100.0
  qualityScore         Float     // 0.0 - 100.0
  noiseScore           Float     // 0.0 - 100.0
  costScore            Float     // 0.0 - 100.0
  sampleCount          Int       @default(0)
  consecutiveCleanRuns Int       @default(0) // Số lần canary sạch liên tiếp phục vụ re-qualification (AD-31)
  requalifiedAt        DateTime?             // Mốc thời gian re-qualification epoch (AD-31)
  evaluatedAt          DateTime  @default(now())
  metricsSnapshot      Json      // Lưu p95_latency, field_fill_rate, error_distribution...

  @@index([platform, evaluatedAt(sort: Desc)])
  @@index([scraperId, evaluatedAt(sort: Desc)])
}

model ScraperCanaryRun {
  id                  String   @id @default(cuid())
  scraperId           String
  platform            String
  targetUrl           String
  isSuccess           Boolean
  latencyMs           Int
  httpStatus          Int
  false200Detected    Boolean  @default(false)
  checkpointDetected  Boolean  @default(false)
  errorReason         String?
  executedAt          DateTime @default(now())

  @@index([platform, executedAt(sort: Desc)])
  @@index([scraperId, executedAt(sort: Desc)])
}
```

### 2. Redis Stream Wire Contract & Schemas (AD-29)

Mọi entry trong `stream:benchmark:telemetry` được format thành các cặp key-value dạng chuỗi:

#### Sự kiện Transport Request (`telemetry:request`):
```json
{
  "type": "telemetry:request",
  "runId": "550e8400-e29b-41d4-a716-446655440000",
  "scraperId": "twitter-hybrid",
  "platform": "twitter",
  "ts": "1725782400000",
  "latencyMs": "245",
  "httpStatus": "200",
  "proxyBytes": "15420",
  "retries": "0",
  "isFalse200": "false",
  "isCheckpoint": "false",
  "proxyQuarantined": "false"
}
```

#### Sự kiện Scrape Run Hoàn Tất (`telemetry:run`):
```json
{
  "type": "telemetry:run",
  "runId": "550e8400-e29b-41d4-a716-446655440000",
  "scraperId": "twitter-hybrid",
  "platform": "twitter",
  "category": "social",
  "action": "search",
  "source": "production",
  "durationMs": "1250",
  "itemCount": "20",
  "isSuccess": "true",
  "errorName": ""
}
```

### 3. Redis Key Topology & Consumer Group

- `stream:benchmark:telemetry`: Stream nhận raw telemetry (`MAXLEN ~ 1000000`, 7-day retention via `XTRIM MINID`).
- `hash:scraper:health_tier`: Hash lưu mapping `scraperId -> tier` (`A`, `B`, `C`, `UNKNOWN`) phục vụ tra cứu O(1).
- Consumer Group: `benchmark_telemetry_workers`. Khởi tạo an toàn:
  ```javascript
  try {
    if (typeof client.xGroupCreate === 'function') {
      await client.xGroupCreate('stream:benchmark:telemetry', 'benchmark_telemetry_workers', '$', { MKSTREAM: true });
    } else if (typeof client.xgroup === 'function') {
      await client.xgroup('CREATE', 'stream:benchmark:telemetry', 'benchmark_telemetry_workers', '$', 'MKSTREAM');
    }
  } catch (err) {
    if (!String(err.message || err).includes('BUSYGROUP')) {
      throw err;
    }
  }
  ```

---

## Code Map

- `prisma/schema.prisma` (UPDATE): Thêm model `ScraperHealthScore` và `ScraperCanaryRun`.
- `src/core/types.js` (UPDATE): Cập nhật `RedisClientLike` và `ThinEvent`.
- `src/core/telemetry-context.js` (NEW): Lớp quản lý ngữ cảnh telemetry cho mỗi crawl session.
- `src/core/telemetry-emitter.js` (NEW): Emitter non-blocking thực thi qua `setImmediate` với circuit breaker và `getMetrics()`.
- `src/benchmark/health-tier-cache.js` (NEW): Bộ nhớ cache Tier đồng bộ O(1), cơ chế warmup từ DB và polling 30s.
- `api/services/benchmark/telemetry-consumer.js` (NEW): Consumer group reader cho Redis Stream với rolling 7-day retention và an toàn `BUSYGROUP`.
- `api/services/benchmark/retention-cleaner.js` (NEW): Job dọn dẹp dữ liệu PostgreSQL quá hạn (90 ngày / 30 ngày).
- `tests/benchmark/telemetry-emitter.test.js` (NEW): Unit tests cho TelemetryEmitter và circuit breaker.
- `tests/benchmark/telemetry-context.test.js` (NEW): Unit tests cho TelemetryContext.
- `tests/benchmark/health-tier-cache.test.js` (NEW): Unit tests cho HealthTierCache.
- `tests/benchmark/telemetry-pipeline.test.js` (NEW): Integration tests cho luồng Stream -> Consumer -> DB.
- `tests/benchmark/retention-cleaner.test.js` (NEW): Unit tests cho RetentionCleaner.

---

## Tasks / Subtasks

### Review Findings

- [x] [Review][Patch] Fix broken Prisma dynamic import path in `telemetry-consumer.js` and `retention-cleaner.js` [`api/services/benchmark/telemetry-consumer.js:95`]
- [x] [Review][Patch] Preserve HTTP status code 0 (network/timeout errors) in `TelemetryContext.recordRequest` [`src/core/telemetry-context.js:106`]
- [x] [Review][Patch] Optimize `HealthTierCache.warmup()` with distinct scraperId and selective column loading to prevent memory bloat [`src/benchmark/health-tier-cache.js:175`]
- [x] [Review][Patch] Implement default baseline persistence to `ScraperHealthScore` in `TelemetryConsumer` and ensure XACK is called post-processing [`api/services/benchmark/telemetry-consumer.js:283`]
- [x] [Review][Patch] Fix inaccurate deletion count fallback in `BenchmarkRetentionCleaner` using nullish coalescing [`api/services/benchmark/retention-cleaner.js:77`]
- [x] [Review][Patch] Add standalone indexes for `evaluatedAt` and `executedAt` to optimize retention cleanup queries [`prisma/schema.prisma:425`]
- [x] [Review][Patch] Preserve large numeric identifiers and leading zeros in `unflattenPayload` [`src/core/telemetry-emitter.js:46`]
- [x] [Review][Patch] Add `hGet` / `hget` to `RedisClientLike` in `src/core/types.js` [`src/core/types.js:215`]
- [x] [Review][Patch] Replace fixed 100ms timeout with deterministic metrics polling in `telemetry-pipeline.test.js` [`tests/benchmark/telemetry-pipeline.test.js:105`]
- [x] [Review][Patch] Throttle `XTRIM MINID` in `TelemetryConsumer` to avoid unnecessary Redis overhead on empty batches [`api/services/benchmark/telemetry-consumer.js:295`]


- [x] **Phase 1: Database Schema & Migration (Prisma)**
  - [x] Cập nhật `prisma/schema.prisma` thêm model `ScraperHealthScore` với đầy đủ các trường điểm 4 trụ cột, `consecutiveCleanRuns`, `requalifiedAt`, và indexes (AC 1).
  - [x] Cập nhật `prisma/schema.prisma` thêm model `ScraperCanaryRun` với các cờ `false200Detected`, `checkpointDetected`, và indexes (AC 1).
  - [x] Chạy `npx prisma validate` và tạo migration tương thích với cơ sở dữ liệu hiện tại (AC 1).

- [x] **Phase 2: Types & Context & Non-Blocking Emitter (`src/core/`)**
  - [x] Cập nhật `src/core/types.js` bổ sung các phương thức Redis Stream Consumer vào `RedisClientLike` và các cờ benchmark vào `ThinEvent` (AC 8).
  - [x] Tạo file `src/core/telemetry-context.js` triển khai lớp `TelemetryContext` quản lý `runId`, `recordRequest`, `recordStoreMetrics`, và xuất `toRunPayload` (AC 3).
  - [x] Tạo file `src/core/telemetry-emitter.js` triển khai lớp `TelemetryEmitter`:
    - [x] Thực thi non-blocking bằng `setImmediate` độc quyền (AC 2).
    - [x] Cài đặt in-memory circuit breaker drop event khi hàng đợi vượt quá 1,000 items (AC 2).
    - [x] Cung cấp phương thức `getMetrics()` trả về `{ queuedCount, emittedCount, droppedCount, errorCount }` (AC 2).
    - [x] Chuẩn hóa payload sang flat `Record<string, string>` theo wire contract của Redis Stream (`flattenPayload` & `unflattenPayload`) (AC 4).
    - [x] Bắt toàn bộ lỗi, không throw ra ngoài, ghi log cảnh báo với tiền tố `[TELEMETRY]` (AC 2).
    - [x] Hỗ trợ tương thích kép client `node-redis` và `ioredis` (AC 2).

- [x] **Phase 3: In-Memory Health Tier Cache (`src/benchmark/`)**
  - [x] Tạo file `src/benchmark/health-tier-cache.js` triển khai lớp `HealthTierCache`:
    - [x] Cung cấp phương thức `get(scraperId)` truy xuất đồng bộ O(1) từ in-memory `Map` (AC 5).
    - [x] Cài đặt phương thức `refresh()` lấy dữ liệu từ `HGETALL hash:scraper:health_tier` mỗi 30 giây (AC 5).
    - [x] Cài đặt phương thức `warmup({ prisma, redis })` nạp tier mới nhất từ bảng `ScraperHealthScore` vào bộ nhớ và Redis Hash (AC 5).
    - [x] Xử lý fallback: nếu miss cache, kiểm tra DB nếu có Tier C trong 24h trả về `'C'`, ngược lại trả về `'UNKNOWN'` (AC 5).

- [x] **Phase 4: Telemetry Consumer & Retention Cleaner (`api/services/benchmark/`)**
  - [x] Tạo file `api/services/benchmark/telemetry-consumer.js` triển khai `TelemetryConsumer`:
    - [x] Khởi tạo consumer group an toàn với `MKSTREAM` và bắt lỗi `BUSYGROUP` (AC 6).
    - [x] Đọc stream bằng `xReadGroup` / `xreadgroup` với group `benchmark_telemetry_workers` kèm non-busy timeout (`BLOCK: 2000`) (AC 6).
    - [x] Sau khi xử lý xong lô tin nhắn, gọi `xAck` xác nhận (kể cả message lỗi để tránh kẹt PEL) (AC 6).
    - [x] Thực thi lệnh `xTrim` với tùy chọn `MINID ~ <now - 7*86400*1000>` ở mỗi chu kỳ đọc (AC 6).
    - [x] Gom nhóm các event `telemetry:request` và `telemetry:run` theo `runId`, tổng hợp dữ liệu thô và ghi nhận vào `ScraperHealthScore` (AC 6).
    - [x] Hỗ trợ cơ chế graceful shutdown (AC 6).
  - [x] Tạo file `api/services/benchmark/retention-cleaner.js` triển khai `BenchmarkRetentionCleaner`:
    - [x] Lập lịch dọn dẹp các bản ghi `ScraperHealthScore` cũ hơn 90 ngày theo batch 1,000 items (AC 7).
    - [x] Lập lịch dọn dẹp các bản ghi `ScraperCanaryRun` cũ hơn 30 ngày theo batch 1,000 items (AC 7).

- [x] **Phase 5: Test Suite & Quality Verification**
  - [x] Xây dựng unit tests trong `tests/benchmark/telemetry-emitter.test.js` kiểm tra non-blocking, circuit breaker qua `getMetrics()`, và xử lý lỗi (AC 9).
  - [x] Xây dựng unit tests trong `tests/benchmark/telemetry-context.test.js` kiểm tra vòng đời của `TelemetryContext` (AC 9).
  - [x] Xây dựng unit tests trong `tests/benchmark/health-tier-cache.test.js` kiểm tra O(1) lookup, warmup, refresh, và fallback (AC 9).
  - [x] Xây dựng integration tests trong `tests/benchmark/telemetry-pipeline.test.js` kiểm tra luồng phát tin nhắn vào Redis Stream, Consumer đọc an toàn, gọi XACK và XTRIM MINID (AC 9).
  - [x] Xây dựng unit tests trong `tests/benchmark/retention-cleaner.test.js` kiểm tra logic xóa dữ liệu quá hạn (AC 9).
  - [x] Chạy toàn bộ test suite `npx vitest run tests/benchmark/` đảm bảo 100% tests pass.

---

## Dev Notes & Architecture Guardrails

### 1. Kiến Trúc Hai Tầng & Cơ Chế Giữ Dữ Liệu Stream (AD-23)
- **Tầng 1 (Redis Stream `stream:benchmark:telemetry`):**
  - Giữ toàn bộ log thô của từng request và run.
  - Kích thước stream: `MAXLEN ~ 1000000`.
  - Cửa sổ lưu trữ 7 ngày được duy trì bằng lệnh:
    ```javascript
    const sevenDaysAgoMs = Date.now() - (7 * 24 * 60 * 60 * 1000);
    await redisClient.xTrim('stream:benchmark:telemetry', 'MINID', '~', String(sevenDaysAgoMs));
    ```
  - **CẢNH BÁO:** Tuyệt đối không bao giờ dùng lệnh `EXPIRE` trên stream key vì Redis không hỗ trợ TTL cho từng message trong stream; `EXPIRE` sẽ xóa sạch toàn bộ stream key.
- **Tầng 2 (PostgreSQL):**
  - Chỉ nhận các bản ghi tổng hợp rollups theo giờ/ngày từ scoring engine (`ScraperHealthScore`) và các lần chạy canary (`ScraperCanaryRun`).

### 2. Phát Telemetry Bất Đồng Bộ Tuyệt Đối (AD-24)
- Mọi thao tác gửi telemetry bắt buộc bọc trong `setImmediate`:
  ```javascript
  setImmediate(() => {
    this._dispatch(event).catch(err => {
      console.error('[TELEMETRY] Dispatch failed:', err.message);
    });
  });
  ```
- Không sử dụng `queueMicrotask` vì microtask sẽ xả trước giai đoạn I/O polling của event loop và gây đói tài nguyên mạng khi tải cao.
- In-memory circuit breaker:
  ```javascript
  if (this.queue.length >= 1000) {
    this.droppedCount++;
    return; // Drop silently
  }
  ```

### 3. Nguyên Tắc Single-Writer & State Machine (AD-31)
- Trong các story sau (34.4 và 34.8), `BenchmarkStateManager` sẽ là thực thể duy nhất được quyền ghi vào `hash:scraper:health_tier`. Trong Story 34.1, ta chuẩn bị sẵn trường `consecutiveCleanRuns` và `requalifiedAt` trong model `ScraperHealthScore` để phục vụ logic chuyển trạng thái này.

### 4. Cache Đồng Bộ Cho Thin Events (AD-32)
- Để đảm bảo hàm `formatPayload` của `RedisStreamPublisher` giữ nguyên tính đồng bộ và không làm chậm quá trình xuất dữ liệu thin-event, `HealthTierCache` phải nạp sẵn dữ liệu trong RAM:
  ```javascript
  const tier = healthTierCache.get(scraperId); // Đồng bộ 100%
  ```

### 5. Hệ Thống Được Bảo Tồn (Preserved Systems)
- `src/utils/redis-stream-publisher.js`: Không được sửa đổi làm hỏng các interface hiện tại đang phục vụ phát thin-event cho Nowing Lead Hub.
- `src/core/base-crawler.js` & `src/core/base-client.js`: Không được can thiệp vào logic nghiệp vụ của các crawler trong story này (việc gắn hooks sẽ do Story 34.2 thực hiện).
- `prisma/schema.prisma`: Đảm bảo tất cả các model hiện có (`User`, `Post`, `Comment`, `CrawlCheckpoint`...) giữ nguyên vẹn 100%.

### 6. Git Intelligence & Recent Patterns
- Tham khảo commit `d6ea5754`, `e0beb4e5`, `51deeaf0`: Các module mới đều có cấu trúc rõ ràng, xuất class chuẩn ESM, kèm JSDoc type annotations đầy đủ (`@typedef`, `@param`, `@returns`).
- Không sử dụng các thư viện ngoài chưa có trong `package.json`. Dự án đang dùng `redis@^4.6.11` và `@prisma/client`.

---

## Dev Agent Record

### Agent Model Used
claude-sonnet-5[1m]

### Debug Log References
- Đã kiểm tra đối chiếu schema `prisma/schema.prisma` và `src/core/types.js`.
- Xác nhận các phương thức Redis Stream Consumer cần thiết cho `node-redis` v4.
- Đã hoàn tất review độc lập và áp dụng toàn bộ các khuyến nghị cải tiến chất lượng theo rubric BMad.

### Completion Notes List
- Bổ sung cơ chế `MKSTREAM` và `BUSYGROUP` an toàn khi khởi tạo Consumer Group.
- Bổ sung hàm `getMetrics()` cho Emitter Circuit Breaker.
- Phân định rõ ràng phạm vi trách nhiệm giữa Story 34.1 (thu thập & lưu trữ) và Story 34.4 (tính điểm Health Score).
- Mở rộng types trong `src/core/types.js` (`RedisClientLike` và `ThinEvent`).
- Đã hoàn tất 4 lớp Adversarial Review và áp dụng 10/10 patch findings:
  1. Đã sửa đường dẫn import Prisma Client thành `../../lib/prisma.js` trong cả telemetry-consumer và retention-cleaner.
  2. Đã bảo toàn HTTP status code 0 trong `TelemetryContext.recordRequest` khi gặp lỗi timeout/network drop.
  3. Đã tối ưu `HealthTierCache.warmup()` chỉ select scraperId & tier với `distinct: ['scraperId']` chống tràn RAM.
  4. Đã bổ sung cơ chế lưu trữ baseline rollup vào `ScraperHealthScore` và chuyển `xAck` sau khi xử lý thành công.
  5. Đã sửa lỗi đếm bản ghi xóa trong `BenchmarkRetentionCleaner` bằng nullish coalescing.
  6. Đã thêm standalone indexes cho `evaluatedAt` và `executedAt` trong Prisma schema và migration.
  7. Đã bảo toàn các chuỗi số lớn và số 0 ở đầu trong `unflattenPayload`.
  8. Đã thêm `hGet`/`hget` vào `RedisClientLike`.
  9. Đã thay thế timeout 100ms bằng `emitter.flush()` hoàn toàn deterministic trong pipeline integration test.
  10. Đã điều tiết chu kỳ `XTRIM MINID` tránh quá tải Redis.

### File List
- `prisma/schema.prisma` (UPDATE)
- `prisma/migrations/20260908000000_add_scraper_health_score_and_canary_run/migration.sql` (NEW)
- `src/core/types.js` (UPDATE)
- `src/core/telemetry-context.js` (NEW)
- `src/core/telemetry-emitter.js` (NEW)
- `src/benchmark/health-tier-cache.js` (NEW)
- `api/services/benchmark/telemetry-consumer.js` (NEW)
- `api/services/benchmark/retention-cleaner.js` (NEW)
- `tests/benchmark/telemetry-context.test.js` (NEW)
- `tests/benchmark/telemetry-emitter.test.js` (NEW)
- `tests/benchmark/health-tier-cache.test.js` (NEW)
- `tests/benchmark/retention-cleaner.test.js` (NEW)
- `tests/benchmark/telemetry-consumer.test.js` (NEW)
- `tests/benchmark/telemetry-pipeline.test.js` (NEW)
- `_bmad-output/implementation-artifacts/stories/34-1-benchmark-telemetry-schema-storage.md` (UPDATE)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (UPDATE)
