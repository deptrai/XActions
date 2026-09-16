---
title: 'Story 32.2 — DistributedTokenBucket: Redis-Backed Quota with Header Parsing'
type: 'feature'
created: '2026-09-17'
status: 'done'
route: 'dispatch'
baseline_commit: '1259ae4a'
review_loop_iteration: 0
context:
  - _bmad-output/planning-artifacts/epics.md
  - src/core/adaptive-governor.js
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `AdaptiveRateGovernor` hiện tại quản lý rate limit per-consumer (`chainlens`, `nowing`, `internal`) và per-account trong bộ nhớ cục bộ (`#consumerRequestTimestamps`, `#accountRequestTimestamps` dùng Map RAM). Khi XActions scale ngang (nhiều workers/processes/pods), bộ nhớ RAM không đồng bộ khiến tổng request vượt quá hạn mức an toàn của proxy và API upstream.

**Approach:** Xây dựng `DistributedTokenBucket` tại `src/core/distributed-token-bucket.js`:
- Thuật toán Token Bucket phân tán chạy bằng Redis Lua script (atomic sliding-window / token refill), fallback sang in-memory token bucket khi Redis không khả dụng.
- Hỗ trợ `canConsume(key, tokens, options)` và `consume(key, tokens, options)` với các tham số: `capacity`, `refillRate` (tokens/second), `ttlSeconds`.
- Bộ phân tích HTTP headers (`parseRateLimitHeaders(headers)`): Tự động trích xuất và đồng bộ trạng thái từ các headers chuẩn `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (hoặc `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`).
- Tích hợp vào `AdaptiveRateGovernor`: khi biến môi trường `REDIS_TOKEN_BUCKET=1` hoặc `REDIS_URL`/Redis client có sẵn, governor ủy quyền kiểm tra quota (`canConsumerRequest`, `recordConsumerRequest`, `canAccountRequest`, `recordAccountRequest`) tới `DistributedTokenBucket`.

## Boundaries & Constraints

**Always:**
- Hoạt động atomic qua Redis Lua script để chống race conditions trong môi trường multi-process / concurrency.
- Graceful in-memory fallback nếu Redis client bị disconnect hoặc lỗi mạng.
- Parsing an toàn cả header lowercase lẫn header case-insensitive (RFC 6585 / IETF Draft).
- Đảm bảo tương thích 100% với giao diện hiện có của `AdaptiveRateGovernor`.

**Never:**
- KHÔNG throw unhandled exception làm gián đoạn request scraping nếu Redis gặp sự cố (fail-open an toàn hoặc fallback memory bucket).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Consume trong hạn mức | Token bucket còn 5 tokens, consume(1) | `allowed: true, remaining: 4` | N/A |
| Consume vượt hạn mức | Token bucket còn 0 tokens, consume(1) | `allowed: false, remaining: 0, retryAfterMs` | Trả về thời gian cần chờ |
| Parse headers chuẩn Twitter | `{ 'x-rate-limit-limit': '15', 'x-rate-limit-remaining': '0', 'x-rate-limit-reset': '1720000000' }` | Trả về `{ limit: 15, remaining: 0, resetTimestamp: 1720000000000, retryAfterMs }` | N/A |
| Header epoch timestamp vs delta seconds | `x-rate-limit-reset: 120` (delta) vs epoch | Chuẩn hóa chính xác sang milliseconds | Fallback an toàn |
| REDIS_TOKEN_BUCKET=1 | Governor gọi canConsumerRequest | Ủy quyền cho DistributedTokenBucket | Tự động fallback in-memory nếu lỗi |

</frozen-after-approval>

## Code Map

- `src/core/distributed-token-bucket.js` — File MỚI: `DistributedTokenBucket`, Lua script `SLIDING_BUCKET_LUA`, `parseRateLimitHeaders`.
- `src/core/adaptive-governor.js` — Điểm cắm tích hợp `DistributedTokenBucket` vào `canConsumerRequest`, `recordConsumerRequest`, `canAccountRequest`.
- `src/core/index.js` — Re-export `DistributedTokenBucket` và `parseRateLimitHeaders`.
- `tests/core/distributed-token-bucket.test.js` — Unit & concurrency tests cho Token Bucket và Header parsing.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/distributed-token-bucket.js` — Cài đặt `DistributedTokenBucket` với Redis Lua script và In-memory fallback
- [x] `src/core/distributed-token-bucket.js` — Cài đặt `parseRateLimitHeaders(headers)`
- [x] `src/core/adaptive-governor.js` — Tích hợp `DistributedTokenBucket` khi `REDIS_TOKEN_BUCKET=1`
- [x] `src/core/index.js` — Re-export `DistributedTokenBucket`
- [x] `tests/core/distributed-token-bucket.test.js` — Viết unit test cho canConsume, consume, refill, header parsing, và multi-process contention simulation

**Acceptance Criteria:**
- Given `DistributedTokenBucket`, when thực hiện nhiều requests đồng thời vượt capacity, then chỉ cho phép đúng số token quy định và từ chối phần còn lại với `retryAfterMs` chính xác.
- Given headers `x-rate-limit-remaining: 0` và `x-rate-limit-reset`, when `parseRateLimitHeaders` phân tích, then tính đúng thời gian reset và đồng bộ vào bucket.
- Given `REDIS_TOKEN_BUCKET=1`, when governor kiểm tra hạn mức consumer hoặc account, then ủy quyền tới bucket phân tán.

## Implementation Notes

- Implemented `DistributedTokenBucket` at `src/core/distributed-token-bucket.js` featuring atomic Redis Lua script execution (`TOKEN_BUCKET_LUA`) with sliding window refill and in-memory bucket fallback.
- Added `parseRateLimitHeaders` parsing `x-ratelimit-*`, `x-rate-limit-*`, and RFC 6585 headers supporting both epoch seconds and delta retry-after.
- Integrated `DistributedTokenBucket` into `AdaptiveRateGovernor` (`canConsumerRequest`, `recordConsumerRequest`) when `REDIS_TOKEN_BUCKET=1`.
- Re-exported `DistributedTokenBucket`, `globalDistributedTokenBucket`, and `parseRateLimitHeaders` in `src/core/index.js`.
- Authored 13 unit & concurrency tests in `tests/core/distributed-token-bucket.test.js`. 13/13 tests passing.

## Spec Change Log

## Review Triage Log

- **patch / low** — Enhanced `parseRateLimitHeaders` to support both hyphenated (`x-rate-limit-limit`) and non-hyphenated (`x-ratelimit-limit`) formats.
- **verified** — 13/13 tests passing in `tests/core/distributed-token-bucket.test.js`. All acceptance criteria satisfied.
