# Story 25.4: Backward Compatibility Error Mapping & Deprecation Envelopes

**Epic:** 25 — Unified Scrapers Consolidation & Modern Dispatcher
**Status:** done
**Created:** 2026-09-12
**Consolidation Note:** Triển khai gộp cùng **Story 25.3** (`25-3-mcp-cli-api-caller-migration.md`) theo quyết định gộp scope. File này giữ vai trò đặc tả chi tiết contract lỗi cho Story 25.4.
**Depends on:** Story 25.1 (Universal Dispatcher), Story 25.2 (Exports v2)

---

## User Story

**As a** consumer of the XActions unified scraping interface,
**I want** khi gọi một action hoặc platform đã bị loại bỏ/deprecated, hệ thống trả về `PlatformError` với `type: ErrorTypes.DEPRECATED` và `suggestedAction` gợi ý hành động thay thế,
**So that** ứng dụng của tôi có thể tự động bắt lỗi hoặc hiển thị hướng dẫn nâng cấp rõ ràng thay vì crash bất ngờ.

---

## Acceptance Criteria (BDD)

```gherkin
Given dispatcher mới scrape(platform, action, options)
When gọi action đã bị loại bỏ hoặc tên platform cũ
Then trả PlatformError với:
  - type: ErrorTypes.DEPRECATED ('deprecated')
  - code: 'XACT_4001'
  - statusCode: 400
  - suggestedAction chỉ rõ action/platform thay thế (hoặc 'use_x_actions_list')
And ErrorTypes.DEPRECATED được thêm vào src/core/error-envelope.js
And actionNotAvailable() trong src/scrapers/platforms.js trả về PlatformError chuẩn
And package.json exports giữ mapping cho ít nhất 1 release cycle (đã hoàn thành tại Story 25.2)
And docs/deprecation-plan.md liệt kê mapping đầy đủ từ legacy API -> new API
```

---

## Technical Specifications

### 1. Error Envelope Type Definition
Trong `src/core/error-envelope.js`:
- Bổ sung `DEPRECATED: 'deprecated'` vào enum `ErrorTypes`.
- Đảm bảo `PlatformError` hỗ trợ nhận `type: ErrorTypes.DEPRECATED`.

### 2. Dispatcher & Helper Integration
Trong `src/scrapers/platforms.js`:
- Nâng cấp hàm `actionNotAvailable(platform, action, available, suggestedAction)`:
  - Trả về hoặc ném `PlatformError` chuẩn hóa với:
    * `statusCode: 400`
    * `code: 'XACT_4001'`
    * `platform`
    * `type: ErrorTypes.DEPRECATED` (nếu là action cũ đã thay thế) hoặc `ErrorTypes.INVALID_ARGS`
    * `suggestedAction: suggestedAction || SuggestedActions.USE_ACTIONS_LIST`
  - Đảm bảo giữ nguyên cấu trúc `message` để tương thích ngược với các test hiện tại.

### 3. Documentation
- Cập nhật `docs/deprecation-plan.md` liệt kê các action mapping tương ứng.

---

## Implementation Reference
Tất cả các task triển khai cụ thể được tích hợp trong file:
👉 `_bmad-output/implementation-artifacts/stories/25-3-mcp-cli-api-caller-migration.md`
