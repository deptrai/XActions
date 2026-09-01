---
story_key: "11-9-dual-pool-consumer-quota"
epic: 11
story_num: 9
status: "ready-for-dev"
baseline_commit: "745db53726a045fd6c4dea6a97eb0bac6f0cfeac"
related_ads:
  - "AD-20"
  - "AD-3"
  - "AD-13"
---

# Story 11.9: Dual-Pool Resource Isolation & Multi-Consumer Quota (Backfill AD-20)

**Story ID:** 11.9  
**Epic:** 11 — Resilient Network & Proxy Pool Management  
**Status:** ready-for-dev  
**Owner:** DEV  
**Source:** `ARCHITECTURE-SPINE.md` (AD-20, AD-3, AD-13, AD-7), `epics.md` (Epic 11, FR-66B), `prd.md` (FR-66, FR-66B, NFR-11..18).  

---

## User Story

As a **Platform Infrastructure Engineer & Multi-Consumer Service Operator**,  
I want **`ProxyIpPool` và `AdaptiveRateGovernor` triển khai cơ chế phân vùng tài nguyên kép (30% Realtime Pool / 70% Bulk Pool), cơ chế mượn proxy linh hoạt (dynamic yield) khi Realtime Pool cạn kiệt, và quản lý hạn ngạch độc lập (Rate Limit Quota) theo người tiêu thụ (`X-Consumer-Id: nowing | chainlens | internal`)**,  
So that **các truy vấn on-demand thời gian thực từ Nowing AI Hub và ChainLens-Research không bao giờ bị nghẽn (starved) bởi các tác vụ cào dữ liệu hàng loạt ngầm (bulk background crawling), đồng thời bảo vệ hệ thống khỏi tình trạng lạm dụng tài nguyên giữa các consumer**.

---

## Acceptance Criteria

### AC-1: Dual-Pool Proxy Capacity Partitioning (30% Realtime / 70% Bulk)
* **Given** `ProxyIpPool` được khởi tạo với danh sách $N$ proxy khỏe
* **When** hệ thống kích hoạt chế độ Dual-Pool
* **Then** tổng lượng proxy được phân bổ theo tỷ lệ cấu hình (mặc định: `realtimeRatio: 0.30` - 30% và `bulkRatio: 0.70` - 70%, tối thiểu 1 proxy cho mỗi pool khi $N \ge 2$)
* **And** `ProxyIpPool` cung cấp các phương thức chọn pool rõ ràng:
  - `getProxy({ pool: 'realtime' | 'bulk', accountId, requiresResidential })`
  - `getRealtimeProxy(options)`
  - `getBulkProxy(options)`
* **And** danh sách proxy trong Realtime Pool ưu tiên phục vụ các request on-demand (MCP Daemon, live interactive API) với timeout ngặt nghèo (5s).

### AC-2: Realtime-to-Bulk Dynamic Proxy Yielding
* **Given** toàn bộ proxy trong phân vùng Realtime Pool đang bận hoặc bị quarantine ($0$ proxy khả dụng trong Realtime)
* **When** có một request đến với `pool: 'realtime'`
* **Then** `ProxyIpPool` tự động kích hoạt cơ chế `yieldFromBulk`: tạm thời mượn (borrow/yield) một proxy khỏe từ phân vùng Bulk Pool để phục vụ request Realtime ưu tiên cao
* **And** nếu cả Bulk Pool cũng không còn proxy khỏe (100% quarantined) ➔ kích hoạt `Standby Backoff` 30s và trả về `ProxyDeadError` / Error Envelope `XACT_4003` (`proxy_exhausted`).
* **And** khi request Realtime hoàn tất, proxy mượn được hoàn trả trạng thái về Bulk Pool mà không làm sai lệch chỉ số phân vùng.

### AC-3: Consumer Identification via Header & Bearer Token Authentication
* **Given** request gửi tới HTTP REST API, MCP HTTP/SSE Daemon (`http://localhost:3001/mcp`) hoặc internal crawler pipeline
* **When** request chứa header `X-Consumer-Id` (ví dụ `nowing`, `chainlens`, `internal`) và `Authorization: Bearer <token>`
* **Then** middleware/daemon trích xuất và xác thực:
  - `consumerId`: chuẩn hóa về `nowing` | `chainlens` | `internal` (mặc định `internal` nếu không truyền)
  - `apiKey`: đối soát với biến môi trường `XACTIONS_MCP_API_KEY` / `XACTIONS_API_TOKEN` (nếu có cấu hình)
* **And** gán ngữ cảnh `{ consumerId, pool: isRealtime ? 'realtime' : 'bulk' }` vào request context cho BaseClient và Governor xử lý.

### AC-4: Dedicated Consumer Quota Enforcement (ChainLens 10 RPM & Nowing Workspace Plan)
* **Given** `AdaptiveRateGovernor` cấu hình hạn ngạch consumer độc lập qua `setConsumerQuota(consumerId, quotaConfig)`
* **When** consumer gửi request:
  - `chainlens`: hạn ngạch cố định 10 RPM (Requests Per Minute) dedicated cho Luồng A (Live Domain Grounding)
  - `nowing`: hạn ngạch theo workspace plan (mặc định 60 RPM hoặc cấu hình qua env `NOWING_RATE_LIMIT_RPM`)
  - `internal`: không giới hạn hoặc hạn ngạch mặc định của hệ thống
* **Then** `governor.canConsumerRequest(consumerId)` kiểm tra token bucket / sliding window 60s của consumer đó
* **And** nếu vượt quá quota: từ chối request với mã lỗi `XACT_4291` (`type: 'rate_limit'`, `message: 'Consumer quota exceeded for <consumerId>'`, `suggestedAction: 'reduce_rate'`, `retryAfter: <seconds>`)
* **And** `governor.recordConsumerRequest(consumerId)` ghi nhận timestamp request vào sliding window của consumer.

### AC-5: Request Pipeline Dual-Pool Routing in BaseClient & Scrapers
* **Given** `AbstractApiClient` dispatch request HTTP qua `request(method, url, options)`
* **When** `options.pool` được truyền (`'realtime'` hoặc `'bulk'`) hoặc suy luận từ consumer context (`options.consumerId` từ MCP ➔ `'realtime'`, background crawl ➔ `'bulk'`)
* **Then** `AbstractApiClient` yêu cầu proxy từ `proxyPool` theo đúng phân vùng (`pool: options.pool`)
* **And** kiểm tra cả `governor.canConsumerRequest(consumerId)` (nếu có `consumerId`) lẫn `governor.canAccountRequest(accountId, platform)` (nếu auth-required).
* **And** không làm phá vỡ logic sticky proxy per account đối với các action `requiresAuth: true`.

### AC-6: MCP Server & HTTP Middleware Quota Gate with Standard Error Envelope
* **Given** MCP tools được gọi qua `src/mcp/server.js` (cả transport Stdio và HTTP/SSE Streamable)
* **When** AI Agent hoặc downstream service (ChainLens / Nowing) thực thi tool (`x_search_tweets`, `x_facebook_group_posts`, `x_shopee_search`, v.v.)
* **Then** server kiểm tra consumer quota trước khi thực thi tool handler
* **And** nếu bị rate-limit bởi consumer quota hoặc governor backpressure: wrap lỗi trả về chuẩn 3-Layer JSON Envelope (`wrapToolError`) với `ErrorTypes.RATE_LIMIT` và `suggestedAction: 'reduce_rate'`.

### AC-7: Dual-Pool Observability in Status API, Governor & Admin Endpoints
* **Given** `StatusApi`, `AdaptiveRateGovernor`, và `ProxyIpPool`
* **When** gọi `GET /governor/status`, CLI `xactions status`, hoặc `GET /api/admin/proxies`
* **Then** response trả về chi tiết phân vùng và hạn ngạch:
  - `dualPool`: `{ realtime: { total, healthy, quarantined }, bulk: { total, healthy, quarantined }, yieldedCount }`
  - `consumerQuotas`: `{ [consumerId]: { rpmLimit, usedInWindow, remaining, isThrottled } }`
* **And** CLI và Admin Dashboard hiển thị trực quan tỷ lệ phân bổ 30/70 và tình trạng quota của từng consumer.

### AC-8: Strict TypeScript Definitions & Zero-Mock Verification
* **Given** `types/proxy.d.ts`, `types/core.d.ts`, và `types/index.d.ts`
* **When** chạy kiểm tra kiểu dữ liệu `npx tsc --noEmit`
* **Then** định nghĩa đầy đủ interface cho DualPool options, ConsumerQuota, ConsumerStatus, và các method mở rộng
* **And** 100% bộ kiểm thử trong `tests/proxy/` và `tests/core/` chạy bằng real instances (Zero-Mock Rule), không dùng `vi.mock()` hay stub.

---

## Tasks / Subtasks Checklist

- [ ] **Task 1: ProxyIpPool Dual-Pool Partitioning & Dynamic Yielding (`src/proxy/proxy-pool.js`)**
  - [ ] 1.1 Thêm cấu hình `realtimeRatio` (mặc định 0.3) và `bulkRatio` (mặc định 0.7) trong constructor `ProxyIpPool`.
  - [ ] 1.2 Cập nhật cấu trúc phân vùng nội bộ: chia danh sách `#proxies` thành 2 partition ảo (`realtime` và `bulk`) dựa trên chỉ số index hoặc tagging, duy trì tính nhất quán khi thêm/xóa proxy.
  - [ ] 1.3 Triển khai `getRealtimeProxy(options)` và `getBulkProxy(options)` hỗ trợ cả sticky và round-robin theo từng pool.
  - [ ] 1.4 Triển khai cơ chế `yieldFromBulk`: khi Realtime Pool hết proxy khỏe, mượn tạm proxy từ Bulk Pool và tăng `yieldedCount`.
  - [ ] 1.5 Cung cấp `getPoolStats()` trả về số lượng total, healthy, quarantined theo từng pool `realtime` / `bulk`.

- [ ] **Task 2: AdaptiveRateGovernor Multi-Consumer Quota Management (`src/core/adaptive-governor.js`)**
  - [ ] 2.1 Định nghĩa class `ConsumerQuotaConfig` với `consumerId`, `rpmLimit`, `burstLimit`, `priority`.
  - [ ] 2.2 Khởi tạo quota mặc định: `chainlens` (10 RPM), `nowing` (60 RPM / env configurable), `internal` (1000 RPM / unmetered).
  - [ ] 2.3 Triển khai `setConsumerQuota(consumerId, config)`, `canConsumerRequest(consumerId)`, `recordConsumerRequest(consumerId)`.
  - [ ] 2.4 Cập nhật `getStatus()` trả về thêm `consumerQuotas` và `dualPoolStats`.

- [ ] **Task 3: BaseClient & Request Pipeline Dual-Pool Routing (`src/core/base-client.js`)**
  - [ ] 3.1 Nhận `options.pool` (`'realtime'` | `'bulk'`) và `options.consumerId` trong `RequestOptions`.
  - [ ] 3.2 Tự động gán `pool: 'realtime'` khi có `consumerId === 'nowing'` hoặc `'chainlens'` hoặc khi được gọi từ MCP on-demand.
  - [ ] 3.3 Kiểm tra `governor.canConsumerRequest(consumerId)` trước khi dispatch request; nếu fail throw `RateLimitError` kèm envelope `XACT_4291`.
  - [ ] 3.4 Gọi `proxyPool.getProxy({ pool, accountId, requiresResidential })` để lấy proxy đúng phân vùng.

- [ ] **Task 4: MCP Daemon & HTTP Middleware Consumer Quota Integration (`src/mcp/server.js`, `api/middleware/auth.js`)**
  - [ ] 4.1 Tạo middleware `identifyConsumer` trích xuất `X-Consumer-Id` và Bearer token từ headers trong Express và Streamable HTTP transport.
  - [ ] 4.2 Tích hợp kiểm tra quota consumer trong `CallToolRequestSchema` handler của MCP Server.
  - [ ] 4.3 Trả về `PlatformError` chuẩn hóa khi consumer quota bị vượt quá.

- [ ] **Task 5: StatusApi & Admin API Updates (`src/core/status-api.js`, `api/routes/admin.js`)**
  - [ ] 5.1 Cập nhật `StatusApi.prototype.getGovernorStatus()` bao gồm `dualPool` và `consumerQuotas`.
  - [ ] 5.2 Bổ sung endpoint `GET /api/admin/proxies/dual-pool` hoặc cập nhật `GET /api/admin/proxies` hiển thị trạng thái realtime/bulk.

- [ ] **Task 6: TypeScript Types Synchronization (`types/core.d.ts`, `types/proxy.d.ts`)**
  - [ ] 6.1 Bổ sung type definitions cho `DualPoolStats`, `ConsumerQuotaConfig`, `ConsumerStatus`, `ProxyPoolOptions`.
  - [ ] 6.2 Đồng bộ method signatures của `AdaptiveRateGovernor` và `ProxyIpPool`.

- [ ] **Task 7: Real-Instance Unit & Integration Tests**
  - [ ] 7.1 Tạo `tests/proxy/dual-pool-proxy.test.js`: kiểm thử phân chia 30/70, yield logic khi realtime cạn, sticky proxy trong dual-pool.
  - [ ] 7.2 Tạo `tests/core/consumer-quota-governor.test.js`: kiểm thử quota 10 RPM của ChainLens, workspace quota của Nowing, sliding window reset, error envelope.
  - [ ] 7.3 Tạo `tests/mcp/mcp-consumer-quota.test.js`: kiểm thử luồng end-to-end qua MCP handler với `X-Consumer-Id`.

---

## Dev Notes

### 1. Phân Tích Hiện Trạng & Vấn Đề Cần Giải Quyết (Root Cause)
* **Hiện trạng `src/proxy/proxy-pool.js`:** Đang quản lý danh sách proxy phẳng `#proxies = []` với 2 chế độ lấy proxy `getNext()` (round-robin) và `getStickyProxy(accountId)` (sticky hash). Toàn bộ crawler ngầm (bulk crawl) và AI agent on-demand (MCP tools) dùng chung 1 pool duy nhất.
* **Hậu quả khi tải cao:** Khi background crawl worker chạy cào hàng nghìn bài viết/bình luận, toàn bộ proxy bị chiếm dụng hoặc bị quarantine tạm thời. Khi AI Agent (Nowing / ChainLens) gửi on-demand query (cần phản hồi trong <5s), request bị xếp hàng hoặc dính proxy đang bị rate-limit, dẫn đến timeout và suy giảm nghiêm trọng trải nghiệm người dùng (TRINITY-9).
* **Giải pháp AD-20:**
  1. **Dual-Pool 30/70:** Tách biệt 30% năng lực proxy dành riêng cho Realtime Pool và 70% cho Bulk Pool.
  2. **Dynamic Yielding:** Realtime pool được quyền mượn tạm (yield) proxy từ Bulk pool khi cạn kiệt, nhưng Bulk pool không được xâm phạm Realtime pool.
  3. **Multi-Consumer Quota:** Phân định rõ lưu lượng của Nowing, ChainLens, Internal qua `X-Consumer-Id`, áp quota độc lập.

### 2. Thiết Kế Chi Tiết Phân Vùng Dual-Pool (`src/proxy/proxy-pool.js`)
```javascript
// Phân bổ tỷ lệ proxy
const total = this.#proxies.length;
const realtimeCount = Math.max(1, Math.floor(total * this.realtimeRatio));
// Realtime partition: [0 ... realtimeCount - 1]
// Bulk partition: [realtimeCount ... total - 1]
```
* Khi `options.pool === 'realtime'`:
  1. Tìm kiếm trong dải Realtime partition.
  2. Nếu không có proxy khỏe và `yieldFromBulk !== false`: tìm trong dải Bulk partition và tăng `yieldedCount`.
  3. Nếu vẫn không có: trả về `null` (kích hoạt backoff).
* Khi `options.pool === 'bulk'`:
  1. Chỉ tìm kiếm trong dải Bulk partition.
  2. Không bao giờ mượn sang Realtime partition để bảo toàn năng lực cho AI Agent.

### 3. Thiết Kế Multi-Consumer Quota (`src/core/adaptive-governor.js`)
* Lưu trữ sliding window timestamps cho từng consumer:
  ```javascript
  #consumerRequestTimestamps = new Map(); // Map<consumerId, number[]>
  #consumerQuotas = new Map([
    ['chainlens', { rpmLimit: 10, burstLimit: 5 }],
    ['nowing', { rpmLimit: Number(process.env.NOWING_RATE_LIMIT_RPM) || 60, burstLimit: 15 }],
    ['internal', { rpmLimit: 1000, burstLimit: 100 }]
  ]);
  ```
* Hàm `canConsumerRequest(consumerId)`:
  - Cắt tỉa timestamps cũ hơn 60s (`Date.now() - 60000`).
  - So sánh `timestamps.length < quota.rpmLimit`.
  - Trả về `boolean`.

### 4. Consumer Identification & Header Contract
* Headers nhận diện:
  - `X-Consumer-Id: chainlens` ➔ ChainLens Research Agent.
  - `X-Consumer-Id: nowing` ➔ Nowing Platform Orchestrator.
  - `X-Consumer-Id: internal` (hoặc omitted) ➔ Internal CLI/Dashboard.
  - `Authorization: Bearer <token>` ➔ Khớp với `process.env.XACTIONS_MCP_API_KEY`.
* Mã lỗi chuẩn khi vi phạm quota (AD-14 / `src/core/error-envelope.js`):
  ```json
  {
    "code": "XACT_4291",
    "type": "rate_limit",
    "message": "Consumer quota exceeded for 'chainlens'. Limit: 10 RPM",
    "retryAfter": 12,
    "suggestedAction": "reduce_rate"
  }
  ```

### 5. Các File Cần Chỉnh Sửa & Bổ Sung
1. `src/proxy/proxy-pool.js` — Phân vùng 30/70, `getRealtimeProxy`, `getBulkProxy`, yield logic, `getPoolStats()`.
2. `src/core/adaptive-governor.js` — `setConsumerQuota`, `canConsumerRequest`, `recordConsumerRequest`, `getConsumerStatus`, tích hợp `dualPoolStats`.
3. `src/core/base-client.js` — Nhận diện `pool` và `consumerId` trong `request()`, gọi kiểm tra quota và lấy proxy tương ứng.
4. `src/core/status-api.js` — Cập nhật payload `getGovernorStatus()` với `dualPool` và `consumerQuotas`.
5. `src/mcp/server.js` — Middleware kiểm tra `X-Consumer-Id` và quota gate trước khi execute tool.
6. `api/middleware/auth.js` — Header extraction helper cho `X-Consumer-Id`.
7. `api/routes/admin.js` — Expose dual-pool stats trong admin proxy endpoints.
8. `types/core.d.ts` & `types/proxy.d.ts` — TypeScript types declarations.
9. `tests/proxy/dual-pool-proxy.test.js` (NEW) — Test suite kiểm thử dual-pool.
10. `tests/core/consumer-quota-governor.test.js` (NEW) — Test suite kiểm thử consumer quota.

---

## Dev Agent Record

### Implementation Plan
1. Đọc và phân tích kỹ lưỡng các module liên quan (`proxy-pool.js`, `adaptive-governor.js`, `base-client.js`, `server.js`).
2. Mở rộng `ProxyIpPool` với cơ chế phân vùng tỷ lệ 30/70, methods `getRealtimeProxy`, `getBulkProxy`, và logic `yieldFromBulk`.
3. Mở rộng `AdaptiveRateGovernor` với sliding window token bucket cho `chainlens`, `nowing`, `internal`.
4. Kết nối `BaseClient` và `MCP Server` với consumer identification và dual-pool routing.
5. Cập nhật `StatusApi` và admin routes để expose metrics.
6. Viết đầy đủ unit & integration tests zero-mock và kiểm tra type check `npx tsc --noEmit`.

### Completion Notes
- Story file được tạo với đầy đủ 8 Acceptance Criteria BDD chi tiết, tasks checklist, và dev notes chuyên sâu.
- Tuân thủ toàn diện các Architectural Decisions: AD-20 (Dual-Pool & Consumer Quota), AD-3 (Proxy Pool), AD-13 (Adaptive Rate Governor), AD-14 (Error Envelope).

---

## File List

* `_bmad-output/implementation-artifacts/11-9-dual-pool-consumer-quota.md` (NEW)

---

## Change Log

- 2026-09-02: Khởi tạo Story 11.9 backfill AD-20 — Dual-Pool Resource Isolation (30% Realtime / 70% Bulk) & Multi-Consumer Quota (ChainLens 10 RPM, Nowing plan-based quota). Status: `ready-for-dev`.
