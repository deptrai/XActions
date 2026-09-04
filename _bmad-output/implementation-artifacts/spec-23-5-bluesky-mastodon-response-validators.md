---
title: 'Story 23.5: Bluesky & Mastodon Response Validators'
type: 'feature'
created: '2026-09-04'
baseline_commit: '06eb25425b5a21245a37123b8ab47a6509f62fb9'
status: 'done'
review_loop_iteration: 1
context:
  - src/core/platform-validator.js
  - src/scrapers/social/twitter/validator.js
  - src/scrapers/social/threads/validator.js
  - src/core/base-client.js
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 23 cần `BlueskyClient`/`MastodonClient` kế thừa `AbstractApiClient`, nhưng pipeline xử lý lỗi chung chưa biết cách phân loại payload hợp lệ, bot challenge, rate-limit và auth failure cho hai nền tảng HTTP-only này.

**Approach:** Implement `BlueskyPlatformResponseValidator` và `MastodonPlatformResponseValidator` kế thừa `AbstractPlatformResponseValidator`, bổ sung `isAuthExpired`, và viết test matrix theo đúng các dạng phản hồi của AT Protocol và Mastodon REST API.

## Boundaries & Constraints

**Always:**
- Đặt file validator trong `src/scrapers/social/bluesky/validator.js` và `src/scrapers/social/mastodon/validator.js`.
- Implement `isValidPayload`, `isBotChallenge`, `isRateLimit`, `isAuthExpired` theo đúng signature `AbstractPlatformResponseValidator`.
- Nhận diện response qua `response.status` / `response.statusCode` và `response.data` / `response.body` (giống các validator hiện có).
- Trả về `boolean`, không throw trong validator.
- Giữ `AbstractPlatformResponseValidator` là abstract class; thêm `isAuthExpired` với default `false` để không break các validator cũ.
- Viết unit test với bao phủ matrix happy path + error cases.

**Ask First:**
- Nếu cần thay đổi `AbstractApiClient` để gọi `isAuthExpired` trong pipeline 2xx (ngoài `handleError` 401/403/429 hiện có).

**Never:**
- Không tạo client/crawler cho Bluesky/Mastodon (thuộc Story 23.1–23.4, 23.6).
- Không sửa logic validator của Facebook/Threads/TikTok/Twitter.
- Không gắn `@deprecated` vào legacy scraper trong story này.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Bluesky valid profile | `{ status: 200, data: { did: 'did:plc:abc', handle: 'user.bsky.social', displayName: 'User' } }` | `isValidPayload=true`, `isBotChallenge=false`, `isRateLimit=false`, `isAuthExpired=false` | N/A |
| Bluesky valid feed array | `{ status: 200, data: { feed: [{ post: { uri: '...', author: { did: '...' } } }] } }` | `isValidPayload=true` | N/A |
| Bluesky XRPC error NotFound | `{ status: 400, data: { error: 'NotFound', message: 'Profile not found' } }` | `isValidPayload=false` | N/A |
| Bluesky rate limit | `{ status: 429, data: { error: 'RateLimitExceeded' } }` | `isRateLimit=true` | N/A |
| Bluesky auth expired | `{ status: 401, data: { error: 'AuthenticationRequired' } }` | `isAuthExpired=true` | N/A |
| Mastodon valid profile | `{ status: 200, data: { id: '123', username: 'user', display_name: 'User', url: '...' } }` | `isValidPayload=true` | N/A |
| Mastodon valid array | `{ status: 200, data: [{ id: '1', content: '...' }] }` | `isValidPayload=true` | N/A |
| Mastodon 401 invalid token | `{ status: 401, data: { error: 'The access token is invalid' } }` | `isAuthExpired=true` | N/A |
| Mastodon 403 forbidden | `{ status: 403, data: { error: 'This action is not allowed' } }` | `isBotChallenge=true` | N/A |
| Mastodon 429 too many | `{ status: 429, data: { error: 'Too many requests' } }` | `isRateLimit=true` | N/A |
| Mastodon error in body string | `{ status: 200, body: '{"error":"Record not found"}' }` | `isValidPayload=false` | N/A |
| Empty/null response | `{ status: 200, data: null }` or `null` | `isValidPayload=false` | N/A |

</frozen-after-approval>

## Code Map

- `src/core/platform-validator.js` — abstract class cần thêm `isAuthExpired` mặc định; không chứa platform-specific logic.
- `src/scrapers/social/twitter/validator.js` và `src/scrapers/social/threads/validator.js` — mẫu cách unwrap `response.data` / `response.body`, lấy status, phát hiện rate-limit từ `errors` array và `status`.
- `src/core/base-client.js:689-762` — pipeline gọi `isRateLimit` → `isBotChallenge` → `isLoginWall` → `isValidPayload` trên 2xx; `handleError` xử lý 401/403/429. `isAuthExpired` chưa được gọi tại đây.
- `src/scrapers/social/index.js` — barrel hiện chưa export `bluesky`/`mastodon` mới; Story 23.5 chỉ tạo validator, export có thể thêm khi client/crawler sẵn sàng hoặc thêm tạm để test import.
- `tests/scrapers/social/bluesky/validator.test.js` — chưa tồn tại, cần tạo.
- `tests/scrapers/social/mastodon/validator.test.js` — chưa tồn tại, cần tạo.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/platform-validator.js` -- thêm `isAuthExpired(response)` với default return `false` và JSDoc -- để các validator cũ kế thừa an toàn và mở rộng interface theo AC Story 23.5.
- [x] `src/scrapers/social/bluesky/validator.js` -- implement `BlueskyPlatformResponseValidator` với `platform='bluesky'`, nhận diện `error` field trong AT Protocol response, phân loại valid/rate-limit/bot-challenge/auth-expired -- validator riêng biệt theo Epic 23.
- [x] `src/scrapers/social/mastodon/validator.js` -- implement `MastodonPlatformResponseValidator` với `platform='mastodon'`, nhận diện HTTP 401/403/429 + `error`/`error_description`, phân loại valid/rate-limit/bot-challenge/auth-expired -- validator riêng biệt theo Epic 23.
- [x] `tests/scrapers/social/bluesky/validator.test.js` -- unit tests cho matrix Bluesky, bao gồm valid payload, error, rate-limit, auth-expired, edge cases -- xác minh AC.
- [x] `tests/scrapers/social/mastodon/validator.test.js` -- unit tests cho matrix Mastodon, bao gồm valid payload, error, 401/403/429, edge cases -- xác minh AC.

**Acceptance Criteria:**
- Given `BlueskyPlatformResponseValidator` kế thừa `AbstractPlatformResponseValidator`, when gọi `isValidPayload`, `isBotChallenge`, `isRateLimit`, `isAuthExpired` với các response mẫu, then kết quả đúng với matrix và `suggestedAction` tương lai có thể map `RELOGIN`/`ROTATE_PROXY`/`WAIT`/`SKIP`.
- Given `MastodonPlatformResponseValidator` kế thừa `AbstractPlatformResponseValidator`, when gặp HTTP 401/403/429 hoặc JSON error body, then validator phân loại đúng auth-expired/bot-challenge/rate-limit.
- Given unit test suite, when chạy `npx vitest run tests/scrapers/social/bluesky/validator.test.js tests/scrapers/social/mastodon/validator.test.js`, then tất cả tests pass.

## Spec Change Log

- 2026-09-04 — Implemented core validators and tests.
- 2026-09-04 — Review loop 1: patched JSDoc `@param {any}` to `{unknown}`, added `isLoginWall`/`isAuthExpired` to `types/core.d.ts`, supported empty collections, unwrapped objects, header rate-limit inspection, and `invalid_token` (RFC 6750); removed `InvalidRequest`/`InvalidHandle` from Bluesky bot-challenge errors; scoped raw body substring matching to HTML/error bodies; added `isLoginWall` for Bluesky adult/takedown walls and Mastodon `AUTHORIZED_FETCH`; expanded test coverage.

## Design Notes

`AbstractApiClient` hiện chưa gọi `isAuthExpired`. Story 23.5 chỉ yêu cầu implement method trên validator; client/crawler của 23.1/23.3 có thể gọi thêm khi cần. Để tránh regression, không sửa `base-client.js` trừ khi được phê duyệt.

## Verification

**Commands:**
- `npx vitest run tests/scrapers/social/bluesky/validator.test.js tests/scrapers/social/mastodon/validator.test.js` -- expected: all pass
- `npx vitest run tests/scrapers/social/twitter/validator.test.js tests/scrapers/facebook/validator.test.js` -- expected: all pass (no regression)
