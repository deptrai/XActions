---
title: 'Story 34.2: Production Telemetry Hooks in AbstractCrawler'
type: 'feature'
created: '2026-09-08'
updated: '2026-09-08'
status: 'done'
epic: 34
story_number: 34.2
phase: 'MVP'
priority: 'high'
baseline_commit: '9ac9b319'
context:
  - _bmad-output/specs/spec-scraper-benchmark/SPEC.md
  - _bmad-output/specs/spec-scraper-benchmark/metrics-catalog.md
  - _bmad-output/planning-artifacts/architecture/xactions-benchmark-epic34/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/epics.md#epic-34
  - _bmad-output/planning-artifacts/backlog-epic-34.md
  - src/core/base-crawler.js
  - src/core/base-client.js
  - src/core/telemetry-context.js
  - src/core/telemetry-emitter.js
  - src/store/prisma-store.js
  - src/core/types.js
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Hiện tại hơn 15 crawler nền tảng (Twitter, Facebook, Threads, Shopee, TopCV, Zalo, YouTube...) chưa phát bất kỳ telemetry nào khi cào dữ liệu thực tế (production). Nếu sửa đổi trực tiếp mã nguồn của từng crawler riêng lẻ sẽ phá vỡ tính đóng gói (encapsulation), gây trùng lặp mã nguồn và tạo gánh nặng bảo trì khổng lồ. Đồng thời, việc phát telemetry trên hot path đòi hỏi độ trễ cực thấp (< 1% overhead theo NFR-19), không được phép làm nghẽn luồng trả về dữ liệu của crawler.

**Approach:**
1. **Centralized Instrumentation (AD-25):**
   - Tập trung toàn bộ việc thu thập telemetry tại 2 lớp trừu tượng cơ sở: `AbstractCrawler.start()` (`src/core/base-crawler.js`) và `AbstractApiClient.request()` (`src/core/base-client.js`), cùng `PrismaStore.storeBatch()` (`src/store/prisma-store.js`).
   - Giữ nguyên vẹn 100% mã nguồn của các platform crawlers hiện hữu (`src/scrapers/*/{client,crawler}.js`).
2. **Scraper Identity & Category Binding (AD-34):**
   - Bổ sung `readonly scraperId` (format `<platform>-<variant>`, e.g. `twitter-hybrid`, mặc định `${this.name}-hybrid`) và `readonly category` (từ `CATEGORY_VALUES`) trên `AbstractCrawler`.
   - Các crawler con có thể kế thừa hoặc ghi đè thuộc tính này để định danh chính xác biến thể scraper.
3. **Item-Count Resolution & Canary Governor Bypass (AD-33):**
   - Cài đặt phương thức chuẩn hóa `extractItemCount(result)` trên `AbstractCrawler`: xử lý mảng trực tiếp, quét các thuộc tính mảng phổ biến (`items`, `posts`, `data`, `records`, `results`), đọc thuộc tính số `count`/`total`, hoặc mặc định là 1 nếu là object đơn lẻ, 0 nếu rỗng/null. Ngăn chặn triệt để hiện tượng object kết quả bị đếm sai thành 1 làm thổi phồng chi phí proxy (`proxy_bytes_per_1k`).
   - Khi chạy ở chế độ canary probe (`session.isCanary = true`), `AbstractCrawler` và `AdaptiveRateGovernor` bỏ qua việc tính quota velocity và hibernation của tài khoản production, tránh làm cạn kiệt tài khoản production (AD-13, AD-33, AD-35).
4. **Scoped TelemetryContext Threading (AD-25, AD-29):**
   - `AbstractCrawler.start(command)` khởi tạo một instance `TelemetryContext` với `runId` (UUID v4) duy nhất và gắn vào `session.telemetry`.
   - Để bảo đảm 100% requests và store operations được đo đạc ngay cả khi các crawler con không truyền `session` vào các helper nội bộ, `AbstractCrawler.start()` tự động gán `this.client.telemetryContext = telemetry` và `this.store.telemetryContext = telemetry` (dọn dẹp trong `finally`).
   - `AbstractApiClient.request()` đo đạc chi tiết từng attempt: `latencyMs`, `httpStatus`, `proxyBytes` (từ `content-length` hoặc buffer), `retries`, `isFalse200`, `isCheckpoint`, `proxyQuarantined`, và ghi nhận trực tiếp vào `options.session?.telemetry || options.telemetryContext || this.telemetryContext`.
5. **Store-Side Metrics Capture (AD-29):**
   - Tích hợp vào `PrismaStore.storeBatch()`: tính toán số lượng trùng lặp (`duplicates = chunk.length - res.count` từ `createMany({ skipDuplicates: true })`) và tỷ lệ schema valid thông qua `MetadataSchemaRegistry`, sau đó ghi vào context telemetry.
6. **Non-Blocking Fire-and-Forget Emission (AD-24, AD-29):**
   - Trong khối `finally` của `AbstractCrawler.start()`, crawler phát một sự kiện tổng hợp `telemetry:run` cùng tất cả các sự kiện `telemetry:request` thông qua `defaultTelemetryEmitter` bằng `setImmediate` không chờ đợi (`.catch(() => {})`), đảm bảo overhead < 1% và không bao giờ crash crawler nếu Redis gặp sự cố.

## Boundaries & Constraints

**Always:**
- Không sửa đổi bất kỳ file crawler con nào trong `src/scrapers/*/{client,crawler}.js` (Zero platform modification per AD-25).
- Phát telemetry phải là fire-and-forget qua `setImmediate` độc quyền (cấm `queueMicrotask` để không làm nghẽn I/O poll phase per AD-24).
- Số lượng item cào được phải được giải quyết qua `this.extractItemCount(result)` (AD-33).
- Băng thông proxy (`proxyBytes`) phải được đọc từ tầng transport (`content-length` header hoặc payload byte length), không tuần tự hóa lại response data.
- Bỏ qua governor rate limits khi `session.isCanary = true` (AD-33).
- Mọi ngoại lệ phát sinh trong quá trình phát telemetry phải được bắt và log stderr `[TELEMETRY]`, tuyệt đối không throw ra return path của crawler.

**Ask First:**
- Nếu cần thay đổi chữ ký phương thức `AbstractCrawler.start(command)` hoặc thay đổi cấu trúc trả về của các action.

**Never:**
- Không `await` lệnh phát telemetry trong `start()` hoặc `request()`.
- Không thực hiện query `SELECT` riêng biệt để đếm duplicate; phải sử dụng delta trả về từ `createMany({ skipDuplicates: true })`.
- Không làm gián đoạn hay thay đổi kết quả dữ liệu trả về của crawler.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected Output | Error Handling |
|---|---|---|---|
| Scrape thành công | `crawler.start({ action: 'search', args: { q: 'ai' } })` | Trả về `result` bình thường; phát `telemetry:run` (`isSuccess: true`) và các `telemetry:request` | Emitter lỗi → bắt ngoại lệ, log `[TELEMETRY]`, crawler vẫn trả về kết quả bình thường |
| Scrape ném ngoại lệ | Handler của action ném `PlatformError` | Re-throw lỗi ra ngoài caller; khối `finally` phát `telemetry:run` (`isSuccess: false`, `errorName`) | Re-throw lỗi gốc của crawler, không bị nuốt bởi telemetry |
| Action trả về object bọc mảng | Handler trả về `{ posts: [p1, p2, p3], pageInfo: {...} }` | `extractItemCount` trả về `3`, không phải `1` | Null hoặc undefined → trả về `0` |
| Client gửi request qua proxy | `client.request('GET', url, { session })` | Ghi nhận attempt vào `session.telemetry` với `latencyMs`, `httpStatus`, `proxyBytes`, `retries` | Lỗi mạng rớt kết nối → ghi nhận `httpStatus: 0`, không crash client |
| Chạy canary probe | `crawler.start({ action: 'search', session: { isCanary: true } })` | Governor bỏ qua velocity check; `TelemetryContext` có `source: 'canary'` | Canary probe không tiêu tốn quota tài khoản production |
| Lưu trữ dữ liệu qua PrismaStore | `store.storeBatch(posts, { session })` | Ghi nhận `duplicates` và `schemaValid` vào `session.telemetry` | `session` không có telemetry context → bỏ qua ghi telemetry an toàn |

</frozen-after-approval>

## User Story

As a **Platform Architecture Engineer & Data Pipeline Operator**,  
I want **centralized telemetry hooks implemented in `AbstractCrawler`, `AbstractApiClient`, and `PrismaStore` with non-blocking fire-and-forget dispatch and canary governor bypass**,  
So that **all 15+ platform scrapers automatically produce granular, correlated telemetry for stability, quality, noise, and cost metrics with <1% latency overhead (NFR-19) without modifying any individual platform crawler subclasses**.

---

## Acceptance Criteria (BDD)

### AC 1: Scraper Identity & Category Defaults on AbstractCrawler (AD-34)
- **Given** class `AbstractCrawler` trong `src/core/base-crawler.js`
- **When** một crawler được khởi tạo hoặc kế thừa từ `AbstractCrawler`
- **Then** crawler có thuộc tính `scraperId`: mặc định là `${this.name}-hybrid` (hoặc `${this.name}`) nếu chưa được set, và cho phép crawler con định nghĩa rõ (e.g. `twitter-hybrid`, `pasgo-merchant`).
- **And** crawler có thuộc tính `category`: mặc định là `'social'` (hoặc kế thừa từ action descriptor), và phải thuộc danh sách `CATEGORY_VALUES`.
- **And** crawler có thuộc tính `telemetryEmitter`: mặc định là `defaultTelemetryEmitter` từ `src/core/telemetry-emitter.js`, cho phép inject qua `deps.telemetryEmitter`.

### AC 2: Intelligent Item-Count Resolution (AD-33)
- **Given** phương thức `extractItemCount(result)` trên `AbstractCrawler`
- **When** crawler hoàn tất một action và trả về kết quả
- **Then** nếu `result` là mảng (`Array.isArray(result)`), trả về `result.length`.
- **And** nếu `result` là đối tượng chứa mảng thuộc một trong các key `items`, `posts`, `data`, `records`, `results`, trả về độ dài của mảng đó.
- **And** nếu `result` là đối tượng chứa thuộc tính số `count` hoặc `total` (`typeof result.count === 'number'`), trả về giá trị số đó.
- **And** nếu `result` là đối tượng đơn lẻ hợp lệ không chứa các thuộc tính trên, trả về `1`.
- **And** nếu `result` là `null`, `undefined`, hoặc falsy, trả về `0`.

### AC 3: TelemetryContext Lifecycle & Correlated Run Emission in AbstractCrawler.start() (AD-25, AD-29)
- **Given** phương thức `start(command)` của `AbstractCrawler`
- **When** một lệnh cào dữ liệu được thực thi
- **Then** crawler tạo một `TelemetryContext` với `runId` UUID v4, `scraperId`, `platform: this.name`, `category`, `action: command.action`, và `source: command.session?.isCanary ? 'canary' : 'production'`.
- **And** crawler gắn context này vào `session.telemetry`, đồng thời gắn `this.client.telemetryContext = telemetry` (nếu client tồn tại) và `this.store.telemetryContext = telemetry` (nếu store tồn tại) để hứng trọn vẹn các lời gọi không truyền session.
- **And** trong khối `finally` sau khi handler hoàn tất (thành công hoặc có lỗi):
  - Dọn dẹp context tạm: `if (this.client) this.client.telemetryContext = null; if (this.store) this.store.telemetryContext = null;`.
  - Tính toán `durationMs = Date.now() - startTime`.
  - Tính toán `itemCount = this.extractItemCount(result)`.
  - Tạo payload `telemetry:run` với `isSuccess: !error`, `errorName: error?.name || error?.code || ''`.
  - Gọi `this.telemetryEmitter.emitRun(runPayload)` không chờ đợi (`setImmediate`).
  - Lấy danh sách các request attempts qua `telemetry.getRequestPayloads()` và gọi `this.telemetryEmitter.emitRequest(req)` cho từng request.
  - Bắt toàn bộ lỗi từ emitter với `.catch(() => {})` để bảo vệ return path của crawler.

### AC 4: Canary Governor Bypass (AD-13, AD-33, AD-35)
- **Given** lệnh cào dữ liệu với cờ `session.isCanary: true`
- **When** `AbstractCrawler.start(command)` và `AbstractApiClient.request(method, url, options)` thực hiện kiểm tra rate governor
- **Then** crawler và client bỏ qua kiểm tra hibernation của tài khoản (`canAccountRequest`), bỏ qua velocity quota limit, và bỏ qua ghi nhận velocity request (`recordRequest`), bảo vệ tài khoản production không bị tiêu hao quota.

### AC 5: Transport Metrics Recording in AbstractApiClient.request() (AD-25, AD-29, AD-30)
- **Given** phương thức `request(method, url, options)` trong `src/core/base-client.js`
- **When** một request mạng được thực hiện (qua HTTP client hoặc CDP agent)
- **Then** client xác định `telemetryContext` từ `options.session?.telemetry || options.telemetryContext || this.telemetryContext`.
- **And** client đo thời gian phản hồi: `latencyMs = Date.now() - requestStart`.
- **And** client xác định dung lượng băng thông `proxyBytes`: từ header `content-length` hoặc độ dài byte của body/data response.
- **And** client ghi nhận số lần retry `retries: attempt`.
- **And** client kiểm tra chẩn đoán thông qua `responseValidator`:
  - `isFalse200`: kiểm tra qua `this.responseValidator?.isFalse200?.(response)` hoặc `this.responseValidator?.validateResponse?.(response)?.isFalse200` (mặc định `false`).
  - `isCheckpoint`: kiểm tra qua `this.responseValidator?.isLoginWall?.(response) || this.responseValidator?.isBotChallenge?.(response)` (mặc định `false`).
- **And** client gọi `telemetryContext.recordRequest(...)` với đầy đủ các trường transport metrics, kể cả khi request thất bại hoặc rớt mạng (với `httpStatus: response?.status !== undefined ? Number(response.status) : 0`).

### AC 6: Persistence Layer Metrics Capture in PrismaStore.storeBatch() (AD-29)
- **Given** phương thức `storeBatch(posts, opts)` trong `src/store/prisma-store.js`
- **When** lưu trữ một lô bài viết với `opts.session?.telemetry || opts.telemetryContext || this.telemetryContext`
- **Then** store ghi nhận số lượng item hợp lệ qua schema validation của `MetadataSchemaRegistry`.
- **And** store tính toán số lượng bản ghi bị trùng lặp: `duplicates = chunk.length - (createManyResult?.count ?? chunk.length)`.
- **And** store gọi `telemetryContext.recordStoreMetrics({ fieldFillRate, schemaValid, duplicates, totalItems })`.

### AC 7: Strict Non-Blocking & Latency Overhead Constraint (NFR-19)
- **Given** pipeline cào dữ liệu tích hợp đầy đủ telemetry hooks
- **When** đo đạc thời gian thực thi của telemetry instrumentation trong benchmark test
- **Then** tổng độ trễ bổ sung (overhead) của telemetry hooks phải < 1% thời gian cào dữ liệu (hoặc < 2ms đối với các tác vụ nhanh < 200ms).
- **And** bộ phát telemetry phải hoàn toàn không đồng bộ và không làm tăng bộ nhớ quá 5% (NFR-19).

### AC 8: Zero Platform Scraper Modification Verification
- **Given** toàn bộ 15+ platform crawlers trong `src/scrapers/`
- **When** kiểm tra git diff sau khi tích hợp hooks
- **Then** không có bất kỳ file nào trong thư mục `src/scrapers/` bị sửa đổi hoặc thêm mới (AD-25).
- **And** tất cả crawler kế thừa `AbstractCrawler` tự động phát telemetry chuẩn xác.

---

## Technical Notes & Contracts

### 1. AbstractCrawler Hook Architecture (`src/core/base-crawler.js`)

```javascript
import { defaultTelemetryEmitter } from './telemetry-emitter.js';
import { TelemetryContext } from './telemetry-context.js';

// Inside constructor:
this.scraperId = deps.scraperId || `${this.name}-hybrid`;
this.category = deps.category || 'social';
this.telemetryEmitter = deps.telemetryEmitter || defaultTelemetryEmitter;

// Item count extractor (AD-33)
extractItemCount(result) {
  if (!result) return 0;
  if (Array.isArray(result)) return result.length;
  if (typeof result === 'object') {
    for (const key of ['items', 'posts', 'data', 'records', 'results']) {
      if (Array.isArray(result[key])) return result[key].length;
    }
    if (typeof result.count === 'number') return result.count;
    if (typeof result.total === 'number') return result.total;
    return 1;
  }
  return 1;
}

// start(command) execution wrapper
const telemetry = TelemetryContext.create({
  scraperId: this.scraperId,
  platform: this.name,
  category: this.category || entry.descriptor.category || 'social',
  action: command.action,
  source: command.session?.isCanary ? 'canary' : 'production',
});

const session = {
  ...(command.session || {}),
  requiresAuth: actionRequiresAuth,
  telemetry,
  ...(accountId ? { accountId } : { accountId: null }),
};

if (this.client) {
  this.client.telemetryContext = telemetry;
}
if (this.store) {
  this.store.telemetryContext = telemetry;
}

const startTime = Date.now();
let result = null;
let error = null;

try {
  result = await entry.handler(command.args, session);
  return result;
} catch (err) {
  error = err;
  throw err;
} finally {
  if (this.client) this.client.telemetryContext = null;
  if (this.store) this.store.telemetryContext = null;

  const durationMs = Date.now() - startTime;
  const itemCount = this.extractItemCount(result);

  const runPayload = telemetry.toRunPayload({
    isSuccess: !error,
    durationMs,
    itemCount,
    errorName: error ? (error.name || error.code || 'Error') : '',
  });

  try {
    this.telemetryEmitter.emitRun(runPayload);
    for (const req of telemetry.getRequestPayloads()) {
      this.telemetryEmitter.emitRequest(req);
    }
  } catch (emitErr) {
    console.error('[TELEMETRY] Failed to emit run telemetry:', emitErr.message);
  }
}
```

### 2. AbstractApiClient.request() Hook (`src/core/base-client.js`)

```javascript
const telemetry = opts.session?.telemetry || opts.telemetryContext || this.telemetryContext;
const requestStart = Date.now();

// When recording transport attempts:
const latencyMs = Date.now() - requestStart;
const proxyBytes = Number(response?.headers?.['content-length'] || response?.headers?.['Content-Length'] || 0) ||
  (response?.data ? Buffer.byteLength(typeof response.data === 'string' ? response.data : JSON.stringify(response.data)) : 0);

const isFalse200 = Boolean(
  this.responseValidator?.isFalse200?.(response) ??
  this.responseValidator?.validateResponse?.(response)?.isFalse200 ??
  false
);

const isCheckpoint = Boolean(
  (typeof this.responseValidator?.isLoginWall === 'function' && this.responseValidator.isLoginWall(response)) ||
  (typeof this.responseValidator?.isBotChallenge === 'function' && this.responseValidator.isBotChallenge(response))
);

if (telemetry && typeof telemetry.recordRequest === 'function') {
  telemetry.recordRequest({
    latencyMs,
    httpStatus: response?.status !== undefined ? Number(response.status) : 0,
    proxyBytes,
    retries: attempt,
    isFalse200,
    isCheckpoint,
    proxyQuarantined: isQuarantined,
    ts: requestStart,
  });
}
```

### 3. PrismaStore.storeBatch() Hook (`src/store/prisma-store.js`)

```javascript
const telemetry = opts.session?.telemetry || opts.telemetryContext || this.telemetryContext;
let totalDuplicates = 0;
let schemaValidCount = 0;

// On each chunk createMany:
const res = await this.#prisma?.post.createMany({
  data: chunk,
  skipDuplicates: true,
});
if (res && typeof res.count === 'number') {
  totalDuplicates += (chunk.length - res.count);
}

if (telemetry && typeof telemetry.recordStoreMetrics === 'function') {
  telemetry.recordStoreMetrics({
    fieldFillRate: posts.length > 0 ? (schemaValidCount / posts.length) : 1.0,
    schemaValid: schemaValidCount === posts.length,
    duplicates: totalDuplicates,
    totalItems: posts.length,
  });
}
```

---

## Code Map

- `src/core/base-crawler.js` (UPDATE):
  - Bổ sung `scraperId`, `category`, `telemetryEmitter`.
  - Cài đặt `extractItemCount(result)`.
  - Cài đặt telemetry context lifecycle và `finally` emission trong `start(command)`.
  - Cài đặt canary bypass cho rate governor.
- `src/core/base-client.js` (UPDATE):
  - Tích hợp `telemetryContext.recordRequest()` trong `request()`.
  - Đo `latencyMs`, `proxyBytes`, `retries`, `isFalse200`, `isCheckpoint`.
  - Hỗ trợ canary bypass cho governor account check.
- `src/store/prisma-store.js` (UPDATE):
  - Tích hợp `telemetryContext.recordStoreMetrics()` trong `storeBatch()`.
  - Tính toán `duplicates` qua delta `createMany(skipDuplicates)`.
- `tests/benchmark/abstract-crawler-telemetry.test.js` (NEW): Unit tests cho telemetry hooks trong `AbstractCrawler`.
- `tests/benchmark/abstract-api-client-telemetry.test.js` (NEW): Unit tests cho transport hooks trong `AbstractApiClient`.
- `tests/benchmark/prisma-store-telemetry.test.js` (NEW): Unit tests cho store-side metrics trong `PrismaStore`.
- `tests/benchmark/nfr-performance.test.js` (NEW): Micro-benchmark kiểm chứng NFR-19 overhead < 1%.

---

## Tasks / Subtasks

- [x] **Phase 1: AbstractCrawler Instrumentation (`src/core/base-crawler.js`)**
  - [x] Bổ sung các trường `scraperId`, `category`, `telemetryEmitter` vào constructor của `AbstractCrawler` (AC 1).
  - [x] Triển khai hàm `extractItemCount(result)` hỗ trợ mảng, object bọc mảng, trường `count`/`total`, và object đơn lẻ (AC 2).
  - [x] Tích hợp `session.isCanary` bypass rate governor velocity check (AC 4).
  - [x] Triển khai khởi tạo `TelemetryContext` và khối `finally` phát `telemetry:run` cùng `telemetry:request` qua `telemetryEmitter` (AC 3).
  - [x] Tự động gán và dọn dẹp `this.client.telemetryContext` và `this.store.telemetryContext` (AC 3).

- [x] **Phase 2: AbstractApiClient Transport Instrumentation (`src/core/base-client.js`)**
  - [x] Xác định `telemetryContext` từ `options.session?.telemetry || options.telemetryContext || this.telemetryContext` (AC 5).
  - [x] Đo đạc `latencyMs`, giải quyết `proxyBytes`, `retries`, `isFalse200`, `isCheckpoint` (AC 5).
  - [x] Ghi nhận attempt vào `telemetryContext.recordRequest()` cả trường hợp thành công và thất bại (AC 5).
  - [x] Bỏ qua account hibernation check khi `options.session?.isCanary: true` (AC 4).

- [x] **Phase 3: PrismaStore Persistence Instrumentation (`src/store/prisma-store.js`)**
  - [x] Nhận diện `telemetryContext` từ `opts.session?.telemetry || opts.telemetryContext || this.telemetryContext` trong `storeBatch` (AC 6).
  - [x] Tính toán số lượng `duplicates` từ `createMany(skipDuplicates: true)` delta (AC 6).
  - [x] Ghi nhận `fieldFillRate`, `schemaValid`, `duplicates`, `totalItems` vào `telemetryContext.recordStoreMetrics()` (AC 6).

- [x] **Phase 4: Test Suites & NFR-19 Verification**
  - [x] Xây dựng unit tests `tests/benchmark/abstract-crawler-telemetry.test.js` kiểm tra vòng đời telemetry và re-throw error trong `AbstractCrawler` (AC 3, AC 4).
  - [x] Xây dựng unit tests `tests/benchmark/abstract-api-client-telemetry.test.js` kiểm tra transport metrics trong `AbstractApiClient` (AC 5).
  - [x] Xây dựng unit tests `tests/benchmark/prisma-store-telemetry.test.js` kiểm tra duplicate và schema metrics trong `PrismaStore` (AC 6).
  - [x] Xây dựng micro-benchmark `tests/benchmark/nfr-performance.test.js` đo lường telemetry overhead < 1% thỏa mãn NFR-19 (AC 7).
  - [x] Chạy kiểm thử hồi quy toàn diện đảm bảo không có platform crawler nào bị ảnh hưởng (AC 8).

### Review Findings

- [x] [Review][Patch] Propagate canary flag to client via telemetryContext or this.client.isCanary [src/core/base-client.js:522]
- [x] [Review][Patch] Avoid JSON.stringify(res.data) in proxyBytes calculation to uphold NFR-19 [src/core/base-client.js:664]
- [x] [Review][Patch] Remove redundant provider.quarantine call on 429/403 in retry loop [src/core/base-client.js:863]
- [x] [Review][Patch] Allow action descriptor category to override default social category [src/core/base-crawler.js:43]
- [x] [Review][Patch] Capture storeMetrics on schema validation failure and accumulate metrics across batches [src/store/prisma-store.js:208]
- [x] [Review][Patch] Restrict isFalse200 to 2xx responses and support composite validateResponse [src/core/base-client.js:675]
- [x] [Review][Patch] Support scalar numbers in extractItemCount and move delayWithJitter inside try/finally [src/core/base-crawler.js:140]
- [x] [Review][Patch] Add differential comparison in nfr-performance test and verify context threading on client/store [tests/benchmark/nfr-performance.test.js:58]


---

## Dev Notes & Architecture Guardrails

### 1. Centralized Instrumentation Rule (AD-25)
- **NGHIÊM CẤM:** Không được thêm code telemetry vào bất kỳ class con nào trong `src/scrapers/` (TwitterCrawler, FacebookCrawler, ZaloCrawler...). Toàn bộ instrumentation bắt buộc nằm trong `AbstractCrawler` và `AbstractApiClient`.

### 2. Item-Count Resolution Pattern (AD-33)
- Các crawler trả về kết quả dưới nhiều hình dạng khác nhau:
  - Direct array: `[PostItem, PostItem]` -> `length`
  - Object with array property: `{ posts: [...], pageInfo: {...} }` -> `posts.length`
  - Object with results: `{ results: [...] }` -> `results.length`
  - Single object: `{ profile: ProfileItem }` -> `1`
  - Count object: `{ count: 42 }` -> `42`
- Hàm `extractItemCount(result)` phải quét an toàn theo thứ tự trên trước khi fallback về `1` hoặc `0`.

### 3. Non-Blocking Overhead Constraint (AD-24, NFR-19)
- Tuyệt đối không `await this.telemetryEmitter.emitRun()`.
- Phát qua `setImmediate` và bọc try/catch không làm gián đoạn giá trị trả về của crawler.

### 4. Previous Story Learnings (Story 34.1)
- `TelemetryEmitter` đã có sẵn các phương thức `emitRun()`, `emitRequest()`, `getMetrics()`, và wire contract flattening với `_json`.
- `TelemetryContext` đã hỗ trợ `recordRequest()`, `recordStoreMetrics()`, và `toRunPayload()`.
- Sử dụng trực tiếp các class đã được test và verify trong Story 34.1.

---

## Dev Agent Record

### Agent Model Used
claude-sonnet-5[1m]

### Debug Log References
- Khảo sát mã nguồn `src/core/base-crawler.js`, `src/core/base-client.js`, và `src/store/prisma-store.js`.
- Hoàn thành chu trình RED-GREEN-REFACTOR cho 4 phases.
- Khắc phục ưu tiên mã lỗi `error.code || error.name` trong `AbstractCrawler.start()` khối `finally`.
- Tích hợp telemetry tracking và canary bypass trong `AbstractApiClient.request()`.
- Tích hợp tính toán số lượng duplicate và validation rate trong `PrismaStore.storeBatch()`.
- Xác minh tiêu chuẩn NFR-19: overhead < 2ms, memory growth < 5%, hoàn toàn non-blocking.

### Completion Notes List
- 100% Acceptance Criteria (AC 1 -> AC 8) đã được triển khai và kiểm chứng.
- Tuân thủ nghiêm ngặt nguyên tắc Centralized Instrumentation (AD-25): 0 files trong `src/scrapers/` bị sửa đổi.
- 4 test suites mới hoàn chỉnh với 20/20 test cases passing.
- Toàn bộ 40/40 test cases trong `tests/benchmark/` đều vượt qua thành công.

### File List
- `src/core/base-crawler.js` (UPDATE)
- `src/core/base-client.js` (UPDATE)
- `src/store/prisma-store.js` (UPDATE)
- `tests/benchmark/abstract-crawler-telemetry.test.js` (NEW)
- `tests/benchmark/abstract-api-client-telemetry.test.js` (NEW)
- `tests/benchmark/prisma-store-telemetry.test.js` (NEW)
- `tests/benchmark/nfr-performance.test.js` (NEW)
- `_bmad-output/implementation-artifacts/stories/34-2-production-telemetry-hooks.md` (UPDATE)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (UPDATE)

### Change Log
- 2026-09-08: Đã áp dụng và kiểm chứng 100% (8/8) review patches từ quy trình code review. Trạng thái chuyển sang `done`.
- 2026-09-08: Triển khai hoàn tất Phase 1 đến Phase 4 của Story 34.2, chuyển trạng thái sang `review`.

### Status
done