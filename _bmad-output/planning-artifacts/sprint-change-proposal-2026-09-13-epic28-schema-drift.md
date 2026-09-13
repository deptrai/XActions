# Sprint Change Proposal — Epic 28: Schema Drift & Selector Resilience

**Date:** 2026-09-13  
**Status:** ✅ Approved by user 2026-09-13 — edits applied to epics.md  
**Author:** Luisphan (Developer)  
**Target:** Epic 28 (Stories 28.1, 28.2, 28.3)  
**Trigger:** Pre-implementation architectural review & alignment of Epic 28  

---

## 1. Issue Summary

### Problem Statement
Epic 28 ("Schema Drift & Selector Resilience") được lập kế hoạch nhằm bảo vệ tính toàn vẹn của dữ liệu cào và chủ động phát hiện sự thay đổi DOM từ các mạng xã hội. Trước khi bước vào triển khai, việc rà soát kỹ thuật (Pre-implementation Architecture Review) là bắt buộc nhằm:
1. **Tránh trùng lặp & xung đột thư viện:** Đảm bảo `SchemaDriftGuard` tận dụng engine JSON Schema có sẵn trong `src/core/metadata-schema-registry.js` thay vì thêm thư viện ngoài nặng nề (như Zod/Ajv lớn), giữ nguyên tiêu chuẩn zero-dependency ESM của core.
2. **Bổ sung Error Enum thiếu sót:** `ErrorTypes.DEGRADED_DATA` hiện chưa có trong `src/core/error-envelope.js`, cần được chuẩn hóa trước khi các crawler ném lỗi.
3. **Chuẩn hóa tích hợp Observability & Admin UI:** Xác định rõ ràng cơ chế kết nối giữa `SelectorCanary` với `AdaptiveRateGovernor.getStatus()` và giao diện `dashboard/admin.html` để đồng bộ với kiến trúc Epic 19/27.
4. **Xác định rõ ràng CLI interface:** Định vị chính xác lệnh `suggest-selector` trong hệ thống CLI hiện có (`src/cli/commands/`).

---

## 2. Impact Analysis

### Epic Impact
- **Epic 28 Scope:** Giữ nguyên 3 stories cốt lõi (28.1, 28.2, 28.3), không cắt giảm tính năng.
- **Tiến độ Sprint:** Epic 27 đã hoàn thành 100% (`done`). Epic 28 là bước đi kế tiếp trong **Phase B — Infrastructure Hardening**, tạo nền tảng vững chắc cho Epic 29 (Real-time Streaming & Webhooks) và Epic 30 (Cross-platform Sync).

### Story Impact
- **Story 28.1 (`SchemaDriftGuard`)**:
  - Tích hợp vào `AbstractCrawler.start()` / `validateItem()`.
  - Đăng ký bộ schema chuẩn: `PostItemSchema`, `ProfileItemSchema`, `CommentItemSchema` sử dụng `validateSchemaNode` có sẵn.
  - Phân loại rõ ràng:
    - `complete`: 100% trường bắt buộc hợp lệ, không lỗi type.
    - `degraded`: Thiếu trường optional, score ≥ 70 → gắn metadata `dataQuality: { score, missingFields }`.
    - `corrupted`: Thiếu trường bắt buộc hoặc score < 70 → ném `PlatformError(ErrorTypes.DEGRADED_DATA)`.
- **Story 28.2 (`SelectorCanary`)**:
  - Tạo scheduled worker `src/services/selectorCanary.js` (tích hợp Bull Queue / standalone interval).
  - Target bộ public test URLs định sẵn cho 4 platform chính: Twitter/X, Facebook, YouTube, Threads.
  - Khi success rate < 80% trong 2 lần liên tiếp: ghi nhận `driftDetected: true` vào governor status và emit event alert qua kênh thông báo hiện có.
  - `dashboard/admin.html`: Thêm indicator / widget hiển thị trạng thái Canary trong tab Stream/Proxies.
- **Story 28.3 (`AutoSelectorFallback`)**:
  - Module core `src/core/auto-selector-fallback.js` phân tích DOM tree (sử dụng Heuristic text/attribute matching).
  - Đăng ký lệnh CLI: `xactions schema suggest-selector` hoặc `xactions tools suggest-selector`.

### Technical & Architectural Impact
- `src/core/error-envelope.js`: Thêm `ErrorTypes.DEGRADED_DATA = 'degraded_data'`.
- `src/core/base-crawler.js`: Mở rộng `validateItem` gọi qua `SchemaDriftGuard`.
- `src/core/adaptive-governor.js` & `src/core/status-api.js`: Thêm trường `selectorDrift: Record<string, DriftStatus>` vào `getGovernorStatus()`.
- `types/core.d.ts`: Khai báo types `SchemaDriftGuard`, `DriftClassification`, `SelectorCanaryResult`.

---

## 3. Recommended Approach

**Lựa chọn:** **Option 1 — Direct Adjustment & Spec Hardening (Điều chỉnh trực tiếp & Tinh chỉnh Spec)**

### Lý do:
- Toàn bộ nền tảng cốt lõi (`MetadataSchemaRegistry`, `AbstractCrawler`, `AdaptiveRateGovernor`, Bull Queue) đã sẵn sàng trong codebase.
- Không có lý do để rollback hay giảm scope MVP vì data quality là yêu cầu sống còn của hệ thống cào dữ liệu.
- Làm mịn các tiêu chí chấp nhận (AC) của 3 story sẽ giúp quá trình `bmad-build` diễn ra trơn tru, không gặp lỗi thiếu kiểu hoặc sai sót cấu trúc.

---

## 4. Detailed Change Proposals

### Proposal 1: Cập nhật `src/core/error-envelope.js`
```diff
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
  DEPRECATED: 'deprecated',
+ DEGRADED_DATA: 'degraded_data',
});
```

### Proposal 2: Thiết kế `SchemaDriftGuard` (Story 28.1)
- Tận dụng `src/core/metadata-schema-registry.js`.
- Không cài thêm thư viện npm; sử dụng JSON Schema evaluator thuần ESM.
- Công thức tính điểm:
  $$\text{Score} = \max(0, 100 - (\text{missingRequired} \times 35) - (\text{typeErrors} \times 15) - (\text{missingOptional} \times 5))$$
  - Nếu $\text{missingRequired} > 0$ hoặc $\text{Score} < 70 \implies \text{corrupted}$.
  - Nếu $\text{missingRequired} = 0$ và $\text{typeErrors} = 0$ và $\text{Score} \ge 95 \implies \text{complete}$.
  - Ngược lại $\implies \text{degraded}$.

### Proposal 3: Thiết kế `SelectorCanary` (Story 28.2)
- Service đặt tại `src/services/selector-canary.js`.
- Cấu hình public canary targets tại `config/canary-targets.json`:
  - `twitter`: profiles (`elonmusk`), search hashtag (`#tech`).
  - `facebook`: public pages (`Meta`).
  - `youtube`: trending feed, public video detail.
  - `threads`: public user profile.
- Tích hợp governor: Khi `driftDetected === true`, `governor.getStatus()` gắn cờ `platformDrift[platform] = { alert: true, successRate, lastProbe }`.
- Giao diện Admin: Hiển thị badge canary status trên `dashboard/admin.html`.

### Proposal 4: Thiết kế `AutoSelectorFallback` (Story 28.3)
- Thuật toán Heuristic DOM Search:
  1. Parse HTML DOM tree.
  2. Filter các node chứa text tương tự (`levenshtein` / substring) hoặc thuộc tính tương ứng với expected shape.
  3. Xây dựng CSS selector tối giản và ổn định (ưu tiên `data-testid`, `role`, `aria-*`, sau đó tới semantic tags, hạn chế obfuscated hash classes).
  4. Đánh điểm độ tin cậy (`confidenceScore` từ 0.0 đến 1.0).
- CLI Command: Tích hợp vào `src/cli/commands/schema.js` hoặc `src/cli/commands/tools.js`:
  ```bash
  xactions tools suggest-selector --platform twitter --url https://x.com/elonmusk --field tweet_text
  ```

---

## 5. Implementation Handoff & Plan

| Thứ tự | Story ID | Công việc chính | Deliverables |
|---|---|---|---|
| **1** | **Story 28.1** | `SchemaDriftGuard`, `ErrorTypes.DEGRADED_DATA`, Crawler Item validation | `src/core/schema-drift-guard.js`, update `base-crawler.js`, `tests/core/schema-drift-guard.test.js` |
| **2** | **Story 28.2** | `SelectorCanary` background service, Canary targets config, Admin dashboard widget | `src/services/selector-canary.js`, `config/canary-targets.json`, `tests/services/selector-canary.test.js` |
| **3** | **Story 28.3** | `AutoSelectorFallback` DOM analyzer engine & CLI command | `src/core/auto-selector-fallback.js`, CLI handler, `tests/core/auto-selector-fallback.test.js` |

---

## 6. Success Criteria
- `npm run typecheck` 0 errors.
- 100% unit & integration test suites pass cho cả 3 stories.
- Dữ liệu rác/hỏng bị chặn ngay lập tức với `ErrorTypes.DEGRADED_DATA`.
- Selector canary tự động cảnh báo trước khi xảy ra sự cố diện rộng.
- Công cụ CLI gợi ý selector thay thế chính xác với confidence score rõ ràng.
