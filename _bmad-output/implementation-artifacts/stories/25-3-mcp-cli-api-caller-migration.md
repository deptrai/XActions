# Story 25.3: MCP / CLI / API Caller Migration & Backward Compatibility Error Mapping

**Epic:** 25 — Unified Scrapers Consolidation & Modern Dispatcher
**Status:** done
**Created:** 2026-09-12
**Consolidates:** Story 25.3 (Caller Migration) + Story 25.4 (Backward Compatibility Error Mapping)
**Depends on:** Story 25.1 (Universal Dispatcher — done), Story 25.2 (Exports v2 — done)

---

## User Story

**As a** maintainer and API/CLI/MCP consumer of XActions,
**I want** mọi caller nội bộ trong `src/mcp/`, `src/cli/`, `api/` ngừng import trực tiếp từ các thư mục legacy (`src/client/Scraper.js`, `src/scrapers/{twitter,facebook,threads,bluesky,mastodon}/`), đồng thời hệ thống trả về error envelope chuẩn (`PlatformError` với `type: ErrorTypes.DEPRECATED` và `suggestedAction`) khi gọi action đã bị loại bỏ hoặc platform cũ,
**So that** toàn bộ codebase sử dụng unified dispatcher `scrape(platform, action, options)` và `CrawlerCommand`, tạo điều kiện an toàn cho việc decommission hoàn toàn legacy code trong Epic 26 mà không gây breaking changes cho user hiện tại.

---

## Acceptance Criteria (BDD)

### AC 1: Caller Import Audit & Migration (từ Story 25.3)

```gherkin
Given codebase tại src/mcp/, src/cli/, api/
When chạy grep/import audit
Then không còn bất kỳ import nào từ:
  - src/client/Scraper.js
  - src/scrapers/twitter/ (bao gồm twitter/http/)
  - src/scrapers/facebook/ (bao gồm facebook/proxy.js, limits.js, messenger*)
  - src/scrapers/threads/
  - src/scrapers/bluesky/
  - src/scrapers/mastodon/
And các caller chuyển sang gọi scrape(platform, action, options) hoặc import từ src/scrapers/index.js / src/scrapers/social/
And unfollowx CLI commands được map vào CrawlerCommand hoặc trả suggestedAction (NFR-16)
And tests E2E cho MCP/CLI pass với dispatcher mới
```

### AC 2: Error Mapping & Deprecation Envelopes (từ Story 25.4)

```gherkin
Given unified dispatcher scrape(platform, action, options)
When caller gọi một action đã bị loại bỏ hoặc deprecated trên một platform
Then dispatcher trả về PlatformError (hoặc throw) với:
  - type: ErrorTypes.DEPRECATED ('deprecated')
  - code: 'XACT_4001' (hoặc mã lỗi chuẩn)
  - statusCode: 400
  - message: nêu rõ action đã deprecated và platform
  - suggestedAction: chỉ rõ action/platform thay thế hợp lệ (hoặc 'use_x_actions_list')
And ErrorTypes.DEPRECATED được định nghĩa trong src/core/error-envelope.js
And actionNotAvailable() trong src/scrapers/platforms.js trả về PlatformError tương thích
```

### AC 3: Backward Compatibility & Documentation (từ Story 25.4)

```gherkin
Given package.json exports đã ổn định từ Story 25.2
When kiểm tra docs/deprecation-plan.md
Then tài liệu liệt kê đầy đủ mapping từ legacy API -> new API:
  - Danh sách legacy function/action -> CrawlerCommand action tương ứng
  - Danh sách legacy CLI/MCP calls -> scrape() calls tương ứng
  - Thời hạn duy trì shim (ít nhất 1 release cycle trước khi xóa ở Epic 26)
And npm run typecheck (tsc --noEmit) pass 100% (0 errors)
And npm test pass 100% trên toàn bộ test suite
```

---

## Technical Analysis & Guardrails

### 1. Danh sách file cần migrate (Phát hiện qua Audit thực tế)

Qua kiểm tra toàn bộ `src/mcp/`, `src/cli/`, `api/`, chỉ có đúng 7 vị trí còn import trực tiếp từ legacy paths:

| File cần sửa | Import legacy hiện tại | Giải pháp thay thế chuẩn |
|---|---|---|
| `src/mcp/local-tools.js:32-35` | `createBrowser as fbCreateBrowser, createPage as fbCreatePage, loginWithCookie as fbLoginWithCookie from '../scrapers/facebook/index.js'` | Đổi sang import từ `../scrapers/index.js` (đã export sẵn `createBrowser`, `createPage`, `loginWithCookie`). |
| `api/routes/facebookAccounts.js:25` | `import { parseFlatProxy } from '../../src/scrapers/facebook/proxy.js'` | Chuyển `parseFlatProxy` vào `src/scrapers/social/facebook/proxy.js` (hoặc `src/utils/proxy.js`) và re-export tại legacy path để giữ compat. |
| `api/services/facebookAccountPool.js:27,29` | `import { createBrowser, createPage, loginWithCookie } from '../../src/scrapers/facebook/index.js'`<br>`import { parseFlatProxy } from '../../src/scrapers/facebook/proxy.js'` | Đổi `createBrowser/createPage/loginWithCookie` sang `../../src/scrapers/index.js`. Đổi `parseFlatProxy` sang `../../src/scrapers/social/facebook/proxy.js`. |
| `api/services/tweetScheduler.js:20` | `import { createBrowser, createPage, loginWithCookie } from '../../src/scrapers/twitter/index.js'` | Đổi sang import từ `../../src/scrapers/index.js`. |
| `api/services/facebookAutomation.js:11,15` | `import { loginWithCookie, createBrowser, createPage } from '../../src/scrapers/facebook/index.js'`<br>`import { getActionLimit, enforceDelay } from '../../src/scrapers/facebook/limits.js'` | Đổi browser helpers sang `../../src/scrapers/index.js`. Đặt `limits.js` vào `src/scrapers/social/facebook/limits.js` (re-export tại legacy). |
| `src/cli/commands/automate.js:49-51` | `await import('../../scrapers/facebook/index.js')`<br>`await import('../../scrapers/facebook/messengerQueue.js')`<br>`await import('../../scrapers/facebook/messengerShare.js')` | Đổi browser helpers sang `../../scrapers/index.js`. Messenger functions dùng qua `FacebookActions` / `FacebookCrawler` hoặc social module. |
| `src/cli/commands/connect.js:144` | `await import('../../scrapers/twitter/index.js')` | Đổi sang `await import('../../scrapers/index.js')`. |

### 2. Error Envelope: Thêm `ErrorTypes.DEPRECATED`

Trong `src/core/error-envelope.js`:
```js
export const ErrorTypes = Object.freeze({
  RATE_LIMIT: 'rate_limit',
  BOT_CHALLENGE: 'bot_challenge',
  AUTH_EXPIRED: 'auth_expired',
  PROXY_EXHAUSTED: 'proxy_exhausted',
  HIBERNATION: 'hibernation',
  INVALID_ARGS: 'invalid_args',
  NOT_FOUND: 'not_found',
  TARGET_NOT_FOUND: 'target_not_found',
  INTERNAL: 'internal',
  DEPRECATED: 'deprecated', // <-- Story 25.4
});
```

### 3. Nâng cấp `actionNotAvailable` trong `src/scrapers/platforms.js`

Hiện tại:
```js
export function actionNotAvailable(platform, action, available) {
  const err = new Error(
    `Action "${action}" not available on platform "${platform}". Available: ${available.join(', ')}`
  );
  err.statusCode = 400;
  err.code = 'XACT_4001';
  return err;
}
```

Nâng cấp:
- Trả về `PlatformError` instance (hoặc Error tương thích có `statusCode: 400`, `code: 'XACT_4001'`, `platform`, `type`).
- Nếu action nằm trong danh sách deprecated/known-replaced actions, gán `type = ErrorTypes.DEPRECATED` và `suggestedAction` trỏ tới action mới.
- Nếu action không xác định, gán `type = ErrorTypes.INVALID_ARGS` và `suggestedAction = SuggestedActions.USE_ACTIONS_LIST`.
- Giữ nguyên message string format `Action "${action}" not available on platform "${platform}". Available: ...` để không làm fail các test hiện có (`tests/scrapers/dispatcher.test.js`).

### 4. Cập nhật `docs/deprecation-plan.md`

Bổ sung Section 10: Mapping chi tiết các legacy caller sang new API/dispatcher:
- Bảng tra cứu các lệnh CLI `unfollowx` -> `scrape()` action
- Bảng tra cứu MCP tools -> `scrape()` action
- Quy định xử lý khi gọi action bị deprecated

---

## Implementation Tasks

- [ ] **Task 1: Core Error Envelope & Platforms Helper (Story 25.4)**
  - [ ] Thêm `DEPRECATED: 'deprecated'` vào `ErrorTypes` trong `src/core/error-envelope.js`
  - [ ] Cập nhật `actionNotAvailable` trong `src/scrapers/platforms.js` để trả về `PlatformError` với `type: ErrorTypes.DEPRECATED` / `INVALID_ARGS` và `suggestedAction`
  - [ ] Thêm map các deprecated actions phổ biến (ví dụ legacy aliases) với suggested alternative tương ứng
  - [ ] Viết test xác nhận `PlatformError` trả về đúng format khi gọi action deprecated / không hợp lệ

- [ ] **Task 2: Migrate Facebook Proxy & Limits Helpers**
  - [ ] Tạo `src/scrapers/social/facebook/proxy.js` chứa `parseFlatProxy` (và re-export ngược về `src/scrapers/facebook/proxy.js` để bảo toàn compat)
  - [ ] Tạo `src/scrapers/social/facebook/limits.js` chứa `getActionLimit`, `enforceDelay` (và re-export ngược về `src/scrapers/facebook/limits.js`)
  - [ ] Cập nhật `api/routes/facebookAccounts.js` import từ `social/facebook/proxy.js`
  - [ ] Cập nhật `api/services/facebookAccountPool.js` import từ `social/facebook/proxy.js` và `src/scrapers/index.js`
  - [ ] Cập nhật `api/services/facebookAutomation.js` import từ `social/facebook/limits.js` và `src/scrapers/index.js`

- [ ] **Task 3: Migrate MCP & CLI Callers (Story 25.3)**
  - [ ] Cập nhật `src/mcp/local-tools.js` thay thế import `src/scrapers/facebook/index.js` bằng `src/scrapers/index.js`
  - [ ] Cập nhật `api/services/tweetScheduler.js` thay thế import `src/scrapers/twitter/index.js` bằng `src/scrapers/index.js`
  - [ ] Cập nhật `src/cli/commands/connect.js` thay thế import `src/scrapers/twitter/index.js` bằng `src/scrapers/index.js`
  - [ ] Cập nhật `src/cli/commands/automate.js` thay thế import `src/scrapers/facebook/index.js` bằng `src/scrapers/index.js`
  - [ ] Chạy kiểm tra: `grep -rnE "from '.*(scrapers/(twitter|facebook|threads|bluesky|mastodon)|client/Scraper)" src/mcp src/cli api` phải trả về **0 kết quả**

- [ ] **Task 4: Documentation & Verification**
  - [ ] Cập nhật `docs/deprecation-plan.md` với Section 10 ghi nhận hoàn thành Caller Migration và Error Mapping
  - [ ] Chạy `npx tsc --noEmit` xác nhận 0 lỗi
  - [ ] Chạy test suite `dispatcher.test.js`, MCP tests, CLI tests xác nhận không regression
  - [ ] Cập nhật `_bmad-output/implementation-artifacts/sprint-status.yaml`

---

## Verification & Testing Guide

```bash
# 1. Audit không còn legacy imports trong src/mcp, src/cli, api
grep -rnE "from '.*(scrapers/(twitter|facebook|threads|bluesky|mastodon)|client/Scraper)" src/mcp src/cli api
# Mong đợi: không có kết quả nào (empty)

# 2. Typecheck 100% clean
npx tsc --noEmit
# Mong đợi: 0 errors

# 3. Test suites
npx vitest run tests/scrapers/dispatcher.test.js
npx vitest run tests/cli/
npx vitest run tests/core/error-envelope.test.js
```
