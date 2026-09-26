---
title: 'Story 50.4: Per-Consumer Rate-Limit Bucket + Anonymous Free Tier + x402 Route Config + Observability Dashboard'
type: 'feature'
created: '2026-09-27'
status: 'in-progress'
route: 'dispatch'
review_loop_iteration: 0
followup_review_recommended: false
epic: 50
story_number: 50.4
phase: 'Epic 50 — Public Scrape Gateway'
priority: 'high'
baseline_commit: '409448fa6f8742d8fa8f9ff12ec58da6f23ae9be'
warnings: []
context:
  - _bmad-output/implementation-artifacts/epic-50-context.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/architecture/architecture-xactions-public-scrape-gateway-2026-09-26/ARCHITECTURE-SPINE.md
  - _bmad-output/implementation-artifacts/spec-50-3-unified-envelope-request-id-error-envelope.md
  - src/core/distributed-token-bucket.js
  - api/middleware/x402.js
  - api/config/x402-config.js
  - api/routes/platform.js
  - api/services/gatewayEnvelope.js
---

<intent-contract>

## Intent

**Problem:** Hiện tại route gateway `POST /api/platform/:platform/scrape` chưa có quota isolation giữa các machine consumer: một consumer (ví dụ `jev`) gọi ồ ạt có thể làm cạn kiệt upstream rate limits hoặc proxy pools của các consumer khác (`nowing`, `chainlens`). Anonymous callers không có ranh giới free tier rõ ràng (10 req/min) và không có đường dẫn chuyển tiếp sang x402 crypto pay-per-call khi hết free quota. Đồng thời, platform operator thiếu một trang quan sát (`/gateway/monitor/`) và metrics endpoint để giám sát hạn mức bucket, tỷ lệ degrade 202 theo lý do (`upstream_timeout`, `cf_challenge`, `upstream_rate_limit`, `queue_fallback`), sức khỏe upstream, và tra cứu `request_id` end-to-end.

**Approach:**
1. **Backend Quota Engine:**
   - Xây dựng middleware `api/middleware/gatewayQuota.js` tích hợp `globalDistributedTokenBucket` (`src/core/distributed-token-bucket.js`).
   - Bucket key format: `{derived_consumer_id}:{platform}:{action}` cho named consumers, và `anonymous:{client_ip}:{platform}:{action}` cho anonymous callers.
   - Parse env `XACTIONS_CONSUMER_QUOTAS` (JSON định dạng: `{"jev":{"reddit:search":"100/min"},"default":"60/min"}`).
   - Consumer `internal` (hoặc JWT admin) được unmetered.
   - Anonymous free tier: default 10 requests/min per IP + platform + action.
   - Khi quota cạn: Nếu x402 được cấu hình và caller gửi payment header hoặc action là `premium` → chuyển tiếp qua x402 payment gate; nếu không → trả về HTTP `429` với unified `ErrorEnvelope`:
     `{success: false, error: {code: 'XACT_4029', kind: 'consumer_quota', message: 'Quota exceeded for consumer', status: 429, request_id, retryable: true, retry_after_ms}}` kèm header `Retry-After`.
   - Chặn giả mạo (Anti-spoofing): Header `X-Consumer-Id` chỉ là observability hint. Định danh bucket bắt buộc dùng `req.consumer.consumerId` (đã được crypto-derive từ Bearer key bởi `serviceAuth`).
2. **x402 Integration:**
   - Mở rộng `buildRouteConfig()` trong `api/middleware/x402.js` để bao quát route family `POST /api/platform/:platform/scrape`.
   - Bổ sung bảng giá per-action trong `AI_OPERATION_PRICES` (ví dụ `scrape:reddit:search: $0.01`, `scrape:pumpfun:fetch_coin_meta: $0.005`, etc.).
   - Settle timing: Verify payment trước khi thực thi, settle sau response (với `202` async/degrade, settle ngay khi accept).
3. **Observability Ring Buffer & Admin Endpoint:**
   - Tạo module `api/services/gatewayMetrics.js` duy trì một in-memory circular ring buffer gồm 1000 calls gần nhất.
   - Record call metrics: `timestamp, request_id, consumer_id, platform, action, mode, duration_ms, degraded_reason, status`.
   - Endpoint `GET /api/admin/gateway/metrics` (bảo vệ bởi admin auth hoặc JWT) tổng hợp:
     - Thống kê bucket hiện tại (fill %, RPM, 429-count).
     - 24h rolling degrade rate phân loại theo `degraded_reason`.
     - Phân bổ lưu lượng: `internal`, `named`, `anonymous`, `x402-paid`.
     - Upstream latency p50/p95/p99 per-platform.
     - Lookup log trace theo `request_id`.
4. **Frontend Observability Dashboard:**
   - Xây dựng dashboard tại `apps/web/app/gateway/monitor/page.tsx` sử dụng `@/lib/api`:
     - Quota panel: Bảng tiêu thụ theo `consumer_id × platform × action`.
     - Degrade panel: Biểu đồ tỷ lệ 202 degrade và lý do.
     - Upstream health: Latency percentile và error rate.
     - Traffic share: Pie chart phân bổ người gọi.
     - Request trace lookup: Ô input nhập `request_id` hiển thị chi tiết call trace.

## Boundaries & Constraints

**Always:**
- Identity xác định quota PHẢI lấy từ `req.consumer.consumerId` (Bearer-derived), KHÔNG BAO GIỜ đọc từ header `X-Consumer-Id`.
- Quota 429 response BẮT BUỘC tuân thủ C-10 ErrorEnvelope: `code: 'XACT_4029'`, `kind: 'consumer_quota'`, `retryable: true`, `retry_after_ms` và header `Retry-After`.
- `internal` consumer luôn unmetered (không bị chặn quota).
- Anonymous callers bị giới hạn theo IP + platform + action (10 req/min).
- Ring buffer metrics là in-memory, thread-safe, không được leak memory vượt quá 1000 items.
- Endpoint `/api/admin/gateway/metrics` phải yêu cầu xác thực admin/JWT.
- Frontend `/gateway/monitor/` dùng client-side fetch qua `api()`, xử lý gracefully khi chưa có dữ liệu.

**Never:**
- KHÔNG dùng `X-Consumer-Id` header để quyết định quota bucket.
- KHÔNG làm chậm request latency của sync lane > 5ms cho việc tính quota.
- KHÔNG throw unhandled exceptions nếu Redis token bucket bị lỗi (fallback sang in-memory token bucket của `DistributedTokenBucket`).
- KHÔNG ghi credentials hay headers nhạy cảm vào metrics ring buffer.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| HAPPY_QUOTA_ALLOW | Bearer `jev` gọi `reddit/search` trong hạn mức | Request tiếp tục vào gateway dispatch, HTTP 200/202 | N/A |
| ERR_QUOTA_EXHAUSTED | Bearer `jev` vượt quá 100/min | HTTP 429 `{success:false, error:{code:'XACT_4029', kind:'consumer_quota', message:'quota exceeded', status:429, request_id, retryable:true, retry_after_ms}}` + `Retry-After: N` | 429 ErrorEnvelope |
| HAPPY_ANON_FREE | Anonymous gọi trong 10/min | HTTP 200/202 bình thường | N/A |
| ERR_ANON_EXHAUSTED | Anonymous vượt 10/min không có x402 header | HTTP 429 `{code:'XACT_4029', kind:'consumer_quota', ...}` | 429 ErrorEnvelope |
| HAPPY_ANON_X402 | Anonymous vượt 10/min kèm `X-PAYMENT` header hợp lệ | Thanh toán x402 được verify và request được thông qua | x402 payment flow |
| EDGE_SPOOF_HEADER | Anonymous gửi `X-Consumer-Id: jev` | Bị gom vào anonymous bucket theo IP, không được hưởng quota của `jev` | Chặn gian lận |
| HAPPY_INTERNAL_UNMETERED | `internal` consumer (dashboard user) gọi liên tục | Luôn được allow, không bị 429 | N/A |
| HAPPY_METRICS_GET | GET `/api/admin/gateway/metrics` với Admin token | HTTP 200 với payload tổng hợp quotas, degrades, upstreams, call traces | N/A |
| ERR_METRICS_UNAUTH | GET `/api/admin/gateway/metrics` không token | HTTP 401 Unauthorized ErrorEnvelope | 401 |
| HAPPY_REQUEST_ID_LOOKUP | Search `req_xxx` trên monitor dashboard | Trả về thông tin call chi tiết từ ring buffer | N/A |

</intent-contract>

## Code Map

- `api/middleware/gatewayQuota.js` — **NEW**: Quota enforcement middleware using `DistributedTokenBucket`, reads `XACTIONS_CONSUMER_QUOTAS`, tracks IP for anonymous, handles 429 ErrorEnvelope, delegates to x402 when quota exhausted.
- `api/services/gatewayMetrics.js` — **NEW**: In-memory ring buffer (1000 items), calculates aggregated stats (p50/p95/p99, degrade breakdown, quota usage, trace lookup).
- `api/routes/admin.js` (hoặc mount route mới) — **PATCH/EXTEND**: Endpoint `GET /api/admin/gateway/metrics` protected by admin auth.
- `api/middleware/x402.js` — **PATCH**: Add gateway scrape route family to `buildRouteConfig()`, support dynamic per-platform action prices.
- `api/routes/platform.js` — **PATCH**: Mount `gatewayQuota` middleware after `eitherAuth` on `POST /:platform/scrape`, log calls to `gatewayMetrics`.
- `apps/web/app/gateway/monitor/page.tsx` — **NEW**: Frontend monitor UI with Quota table, Degrade chart, Health gauges, Traffic breakdown, and Request ID trace finder.
- `tests/gateway/consumer-quota.test.js` — **NEW**: Comprehensive test suite for per-consumer limits, anonymous buckets, anti-spoofing, 429 shapes, and x402 gating.
- `tests/gateway/gateway-metrics.test.js` — **NEW**: Unit & integration tests for ring buffer, aggregations, and admin endpoint.

## Tasks & Acceptance

**Execution:**
- [x] `api/services/gatewayMetrics.js` -- CREATE -- Ring buffer logger + stats aggregator + trace lookup
- [x] `api/middleware/gatewayQuota.js` -- CREATE -- Per-consumer bucket + anonymous rate limit + 429 ErrorEnvelope + x402 escalation
- [x] `api/middleware/x402.js` -- PATCH -- Extend `buildRouteConfig` for `/api/platform/:platform/scrape`
- [x] `api/routes/platform.js` -- PATCH -- Mount `gatewayQuota` & record metrics into `gatewayMetrics`
- [x] `api/routes/admin.js` -- PATCH -- Add `GET /api/admin/gateway/metrics`
- [x] `apps/web/app/gateway/monitor/page.tsx` -- CREATE -- Full monitor dashboard
- [x] `tests/gateway/consumer-quota.test.js` -- CREATE -- Test quota enforcement, anti-spoofing, 429 ErrorEnvelope
- [x] `tests/gateway/gateway-metrics.test.js` -- CREATE -- Test ring buffer metrics & admin endpoint

**Acceptance Criteria:**
- Given a valid Bearer token for `jev`, when requests exceed `XACTIONS_CONSUMER_QUOTAS` rate, then gateway returns `429` with `kind: 'consumer_quota'` and `Retry-After`.
- Given an anonymous caller with no token, when they send `X-Consumer-Id: jev`, then their quota is strictly IP-bucketed under the anonymous free tier (anti-spoofing passed).
- Given internal consumers (dashboard JWT), when scraping, then requests are never throttled by the gateway quota.
- Given `GET /api/admin/gateway/metrics`, when requested by admin, then returns real-time aggregated metrics including degrade reasons and trace logs.
- Given the `/gateway/monitor/` page, when loaded, then operators can inspect live usage, degrade rate over 24h, and lookup traces by `request_id`.

## Verification

- `npx vitest run tests/gateway/consumer-quota.test.js`
- `npx vitest run tests/gateway/gateway-metrics.test.js`
- `npx vitest run tests/gateway/`
- Browser / Curl verification on `GET /api/admin/gateway/metrics` and `POST /api/platform/reddit/scrape` with quota limits.

---

## Review Triage Log

Reviewer status: 3 fan-out review subagents (blind-hunter / edge-case-hunter / verification-gap) ran in sessions without filesystem tools — returned no findings. Triage performed by the implementer directly (all files read during implementation + tests written + full-suite verification).

| # | Finding | Sev | Verdict | Action |
|---|---------|-----|---------|--------|
| 1 | `gatewayQuota.getClientIp` falls back to `X-Forwarded-For` when `req.ip` unset — on LB deployments with trust-proxy on, anonymous callers can rotate fake IPs to bypass the IP-bucketed free tier | medium | accepted-risk | IP-trust config is a deployment concern (Express `trust proxy` setting); documented in middleware header comment. Not a 50.4 blocker. |
| 2 | Batch (`platform:'all'`) consumes 1 token for up to 25 platforms | low | accepted-by-design | Quota is per-request, batch is 1 HTTP call. Spec does not pin per-platform token weighting. |
| 3 | `getMetricsSummary` division-by-zero on empty buffer | low | false-positive | Guarded: `totalCalls > 0` ternaries on `degradeRate` and `errorRate`. |
| 4 | `consumerUsage` key parsing `split(':')` breaks if action id ever contains ':' | low | accepted-risk | Action ids are a closed enum (`[a-z_]`); documented assumption. |
| 5 | x402 `buildRouteConfig` gateway routes had no test | medium | fixed | Added `X402_ROUTE_CONFIG` test asserting route presence + price format — passing. |
| 6 | 429 envelope contract (XACT_4029/kind/retryable/retry_after_ms/Retry-After header) | — | verified | Asserted in `ERR_QUOTA_EXHAUSTED`. |
| 7 | Monitor page type-check | — | verified | `tsc --noEmit` clean for `app/gateway/monitor/page.tsx`. |
| 8 | serviceAuth contract change (absent header → anonymous lane, replacing 50.1 fail-closed) is an intentional Story 50.4 contract upgrade | medium | accepted-by-design | Tests `HAPPY_ANON` and `VG-1: EDGE_PROD_MISSING_HEADER` updated to the new contract with explanatory comments; presented-invalid-credential still 401s (`EDGE_PROD_NO_KEYS`, `ERR_MALFORMED` unchanged). |

**Deferred items:** none new for 50.4. (Carried from 50.3: `session-cookie-shim.test.js` pre-existing failures — verified not caused by 50.3; still deferred to epic-end retrospective.)

## Auto Run Result

- `npx vitest run tests/gateway/consumer-quota.test.js tests/gateway/gateway-metrics.test.js` → **11/11 pass**
- `npx vitest run tests/gateway/ tests/web/api-envelope-guard.test.js tests/api/contract/envelope.test.js` → **160/160 pass**
- `cd apps/web && npx tsc --noEmit` → gateway/monitor page **clean**
- Full vitest suite run (all tests) → see e2e section below.
- Status: **done** (pending e2e live test below).
