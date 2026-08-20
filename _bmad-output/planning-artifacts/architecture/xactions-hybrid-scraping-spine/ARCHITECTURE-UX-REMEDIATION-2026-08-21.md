---
date: 2026-08-21
status: canonical-input
source: ARCHITECTURE-UX-REVIEW-2026-08-18.md
---

# Architecture UX Remediation — Mapping F1–F10 to Epics & Stories

Tài liệu này chuyển 10 UX findings từ `ARCHITECTURE-UX-REVIEW-2026-08-18.md` thành các epic/story cụ thể để implementation team có thể xử lý. Các finding được ưu tiên P0/P1/P2 như trong bản review gốc.

## Executive Summary

| ID | Finding | Priority | Owner Epic | Owner Story | Trạng thái |
|---|---|---|---|---|---|
| F3 | Governor status outward-facing | P0 | Epic 11 / Epic 19 | 11.4 (surface) / 19.3, 19.6 (dashboard/CLI) | In progress |
| F5 | Multi-platform action discovery | P0 | Epic 10 / Epic 14 | 10.1 (`listActions()`) / 14.2 (`x_actions_list`) | In progress |
| F6 | Friendly error envelope for AI/operator | P0 | Epic 10 | 10.1 (`PlatformError.toEnvelope()`) | In progress |
| F4 | CrawlCheckpoint visibility | P1 | Epic 10 / Epic 19 | 10.4 (API/CLI) / 19.1, 19.5, 19.7 (dashboard/CLI/REST) | Ready-for-dev |
| F7 | Redis Stream metrics monitoring | P1 | Epic 14 / Epic 19 | 14.3 (stream metrics) / 19.3, 19.6, 19.7 | In progress |
| F2 | Terminal QR non-TTY fallback | P1 | Epic 12 | 12.1 (update with non-TTY fallback) | Ready-for-dev |
| F1 | MCP daemon startup/status/stop UX | P2 | Epic 14 / Epic 19 | 14.2 (`xactions daemon` CLI) / 19.8 (`x_admin_status`) | In progress |
| F8 | Metadata schema contract | P2 | Epic 10 | 10.5 (`x_schema_get`, schema registry) | Done |
| F9 | Internal Operator Dashboard views | P2 | Epic 19 | 19.1–19.8 (5 views + CLI/MCP) | In progress |
| F10 | Legacy CLI backward compatibility | P2 | Epic 14 | 14.2 (`unfollowx` command mapping / actionable errors) | Ready-for-dev |

## P0 — Must resolve before Epics 11/12 implementation

### F3 — Adaptive Rate Governor thiếu outward-facing status

- **Mô tả:** Khi governor tự động giảm tốc / hibernation tài khoản, user/operator không biết điều gì đang xảy ra.
- **Yêu cầu UX:**
  - CLI `xactions status` hiển thị `governor.status`, healthy proxy ratio, current throughput, pending lag.
  - Dashboard/Admin CLI hiển thị tài khoản đang hibernation còn bao lâu.
  - Thông điệp gợi ý hành động: `Tài khoản fb:123 đang hibernation 18 phút...`
- **Mapping:**
  - **Story 11.4:** `GovernorStatusApi` shape + REST/CLI surface.
  - **Story 19.3:** Dashboard Stream Metrics view thêm governor status.
  - **Story 19.6:** Admin CLI `xactions admin status`.
  - **Story 19.8:** MCP tool `x_admin_status`.
- **AC bổ sung:**
  - `GET /governor/status` trả về `{ healthyProxyCount, totalProxyCount, healthyProxyRatio, currentReqPerSecond, redisConsumerLag, hibernatingAccounts[], throttleLevel }`.
  - CLI `xactions status` in bảng với cột `platform`, `accountId`, `status`, `hibernationEndsAt`, `suggestedAction`.

### F5 — Multi-platform actions khó khám phá

- **Mô tả:** AI agent / CLI user không biết platform nào hỗ trợ action gì.
- **Yêu cầu UX:**
  - Mọi crawler cung cấp `listActions()` trả về `{ action, description, requiredArgs, example }`.
  - MCP tool `x_actions_list` và CLI `xactions actions --platform <platform>`.
- **Mapping:**
  - **Story 10.1:** `AbstractCrawler.listActions()` + `ActionRegistry`.
  - **Story 14.2:** MCP tool `x_actions_list` và CLI `xactions actions`.
- **AC bổ sung:**
  - `x_actions_list` trả về object `{ platform, actions[] }`.
  - CLI `xactions actions --platform shopee` in bảng action/description.

### F6 — Error taxonomy chưa friendly cho AI agents và operators

- **Mô tả:** `PlatformResponseValidator` trả `RateLimitError` nhưng chưa quy định payload lỗi.
- **Yêu cầu UX:** Error envelope chuẩn `{ code, type, message, retryAfter, suggestedAction, accountId? }`.
- **Mapping:**
  - **Story 10.1:** `AbstractErrorEnvelope` / `PlatformError.toEnvelope()`.
  - **Story 10.5:** `invalid_args` validation error trả với `suggestedAction`.
- **AC bổ sung:**
  - `RateLimitError.toEnvelope()` trả `{ type: 'rate_limit', retryAfter: 60000, suggestedAction: 'wait_60s_or_rotate_proxy' }`.
  - AI agent có thể dùng `suggestedAction` để quyết định.

## P1 — Cùng Epic 10/13 hoặc ngay sau P0

### F4 — CrawlCheckpoint ẩn hoàn toàn với user/operator

- **Mapping:**
  - **Story 10.4:** `GET /checkpoints`, resume/pause/retry API/CLI.
  - **Story 19.1:** Dashboard Jobs & Checkpoints view.
  - **Story 19.5:** Admin CLI `xactions checkpoints ...`.
  - **Story 19.7:** `GET/POST /admin/checkpoints/...`.
- **UX:** Table với `lastCrawledAt`, `lastCursor`, `status` (running/paused/failed), action buttons.

### F7 — Redis Stream lag/drop chưa có giao diện giám sát

- **Mapping:**
  - **Story 14.3:** Metrics endpoint `GET /metrics/stream` trả `eventsPerSecond`, `pendingMessages`, `droppedEvents`, `lastAckTime`.
  - **Story 19.3:** Dashboard Stream Metrics & Alerts view.
  - **Story 19.6:** Admin CLI `xactions admin stream metrics`.
  - **Story 19.7:** `GET /admin/stream/metrics`.
- **UX:** Alert khi `pendingMessages > 50,000` hoặc `lastAckTime > 60s` (NFR-17).

### F2 — Terminal QR Login chưa cover môi trường không có TTY

- **Mapping:**
  - **Story 12.1:** Thêm non-TTY fallback.
- **Yêu cầu UX:**
  - Khi `isTty === false`, in URL + short code hoặc hỗ trợ webhook/push để user confirm từ app.
  - Lỗi timeout có actionable message: `QR hết hạn — gọi lại xactions login --qr hoặc dùng --cdp`.
- **AC bổ sung:**
  - `renderTerminalQr` nhận option `{ nonTtyFallback: true }`.
  - Test `xactions login --qr` trong Docker container không TTY trả về URL và short code.

## P2 — Sau MVP

### F1 — MCP HTTP/SSE daemon thiếu hướng dẫn vận hành

- **Mapping:**
  - **Story 14.2:** CLI `xactions daemon start/status/stop`.
  - **Story 19.8:** MCP tool `x_admin_status` trả daemon state.
- **UX:** Dashboard tile hiển thị daemon state; CLI `xactions daemon status` trả port, transport, health.

### F8 — Data model `metadata` JSON thiếu schema contract

- **Mapping:**
  - **Story 10.5:** `metadata-schema-registry.js`, `GET /schemas/:platform/:category`, `x_schema_get`, `xactions schema get`.
- **UX:** Consumer có thể query schema trước khi đọc `metadata`.

### F9 — Internal Operator Dashboard chưa được định nghĩa UX

- **Mapping:**
  - **Epic 19 — Stories 19.1–19.8:** 5 views (Jobs, Proxies, Accounts, Checkpoints, Stream Metrics) + CLI + MCP.
- **UX:** Admin dashboard, auth bằng admin API key, real-time status, action buttons cơ bản.

### F10 — Backward compatibility với CLI cũ (`unfollowx`)

- **Mapping:**
  - **Story 14.2:** Legacy CLI command map sang `CrawlerCommand`.
- **UX:** `xactions unfollow` → `{ action: 'unfollow', platform: 'twitter' }`; error message rõ ràng nếu lệnh cũ không còn hỗ trợ.

## Recommendation

- **Ngay lập tức (P0):** Bổ sung AC cho Story 10.1, 11.4, 14.2, 19.3, 19.6, 19.8 để cover F3, F5, F6.
- **Sprint kế (P1):** Implement F4, F7, F2.
- **Sau MVP (P2):** F1, F8, F9, F10.
