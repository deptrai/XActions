---
title: "Architecture UX Remediation Plan"
date: 2026-08-21
review_source: ARCHITECTURE-UX-REVIEW-2026-08-18.md
status: approved
---

# Architecture UX Remediation Plan

Tài liệu này map 10 UX findings (F1–F10) từ `ARCHITECTURE-UX-REVIEW-2026-08-18.md` sang các epic/story cụ thể, acceptance criteria, và mức ưu tiên.

---

## F1 — MCP HTTP/SSE daemon thiếu hướng dẫn vận hành

- **AD liên quan:** AD-7
- **Epic/Story:** Story 14.2 (MCP Tool Exporters & Daemon HTTP/SSE Server)
- **Priority:** P0
- **AC bổ sung:**
  - CLI `xactions daemon start|status|stop` hoạt động.
  - `xactions daemon status` trả về `{ transport, port, pid, healthUrl, startedAt }`.
  - Dashboard hiển thị daemon state tile (online/offline).
  - `README` hoặc `--help` giải thích khi nào dùng `stdio` vs `HTTP/SSE`.

---

## F2 — Terminal QR Login chưa cover môi trường không có TTY

- **AD liên quan:** AD-5
- **Epic/Story:** Story 12.1 (Terminal ASCII QR Login)
- **Priority:** P1
- **AC bổ sung:**
  - `--qr-url` in ra URL để mở trên điện thoại / trình duyệt khi không TTY.
  - `--qr-webhook` hoặc `--qr-push` để user confirm từ app.
  - Non-TTY mode tự phát hiện và in URL thay vì ASCII QR.
  - Timeout message có hành động gợi ý: "QR hết hạn — gọi lại `xactions login --qr` hoặc dùng `--cdp`".

---

## F3 — Adaptive Rate Governor thiếu outward-facing status

- **AD liên quan:** AD-13
- **Epic/Story:** Story 11.4 (Adaptive Rate Limiter & Governor)
- **Priority:** P0
- **AC bổ sung:**
  - `GET /governor/status` trả về `{ healthyProxyCount, totalProxyCount, healthyProxyRatio, currentReqPerSecond, redisConsumerLag, hibernatingAccounts[], throttleLevel }`.
  - CLI `xactions status` hiển thị cùng shape.
  - Thông điệp lỗi / log bao gồm `suggestedAction` khi tài khoản hibernation.

---

## F4 — CrawlCheckpoint ẩn hoàn toàn với user/operator

- **AD liên quan:** AD-10, AD-12
- **Epic/Story:** Story 10.4 (CrawlCheckpoint Operational API) + Story 19.1/19.5 (Dashboard/CLI Checkpoints)
- **Priority:** P1
- **AC bổ sung:**
  - API `GET /checkpoints` với filter `platform`, `targetType`, `status`.
  - CLI `xactions checkpoints list|show|resume|pause|retry`.
  - Dashboard checkpoint table: `lastCrawledAt`, `lastCursor`, `status`.

---

## F5 — Multi-platform actions khó khám phá

- **AD liên quan:** AD-11
- **Epic/Story:** Story 10.1 (Core Domain Interfaces) + Story 10.5 (Metadata Schema)
- **Priority:** P0
- **AC bổ sung:**
  - `AbstractCrawler.listActions()` trả `ActionDescriptor[]` với `action, description, requiredArgs, example, category`.
  - MCP tool `x_actions_list` / CLI `xactions actions --platform <platform>` hoạt động.
  - Document được tự động generate từ registry.

---

## F6 — Error taxonomy chưa friendly cho AI agents và operators

- **AD liên quan:** AD-9
- **Epic/Story:** Story 10.1 (Error Hierarchy)
- **Priority:** P0
- **AC bổ sung:**
  - Error envelope shape: `{ code, type, message, statusCode, isRetryable, retryAfterMs, retryAfter, suggestedAction, accountId?, platform }`.
  - `suggestedAction` enum: `wait_60s_or_rotate_proxy`, `hibernate_account`, `retry_with_backoff`, `check_account_health`.
  - MCP/HTTP trả về error envelope thay vì throw plain text.

---

## F7 — Redis Stream lag/drop chưa có giao diện giám sát

- **AD liên quan:** AD-7
- **Epic/Story:** Story 14.3 (Redis Stream) + Story 19.3 (Stream Metrics & Alerts)
- **Priority:** P1
- **AC bổ sung:**
  - Metrics endpoint `GET /metrics/stream` trả `{ eventsPerSecond, pendingMessages, droppedEvents, lastAckTime }`.
  - Dashboard panel real-time line chart với alert threshold.
  - Alert khi `pendingMessages > 50,000` hoặc `lastAckTime > 60s`.

---

## F8 — Data model `metadata` JSON thiếu schema contract cho consumer

- **AD liên quan:** AD-4
- **Epic/Story:** Story 10.5 (Metadata Schema Contract)
- **Priority:** P2
- **AC bổ sung:**
  - Mỗi `schemas/<platform>/<category>.json` publish JSON Schema.
  - MCP `x_schema_get --platform <p> --category <c>` / CLI `xactions schema get`.
  - `PrismaStore` validate `metadata` trước khi ghi.

---

## F9 — Internal Operator Dashboard chưa được định nghĩa UX

- **AD liên quan:** AD-7, AD-10, AD-13, AD-19
- **Epic/Story:** Epic 19 (Operator Dashboard, Admin CLI & Observability)
- **Priority:** P2
- **AC bổ sung:**
  - 5 views: Jobs, Proxies, Accounts, Checkpoints, Stream Metrics.
  - Auth bằng admin API key hoặc A2A token.
  - Mỗi view có real-time status và actions cơ bản (pause/resume/retry).
  - Design tokens xem `ux/DESIGN.md` và `ux/EXPERIENCE-UNIVERSAL-2026-08-21.md`.

---

## F10 — Backward compatibility với CLI cũ (`unfollowx`)

- **AD liên quan:** AD-2
- **Epic/Story:** Story 14.2 (MCP/CLI) + Story 20.1 (Nowing Cutover)
- **Priority:** P2
- **AC bổ sung:**
  - Legacy commands (`xactions unfollow`, `xactions get_followers`, v.v.) map vào `CrawlerCommand` với `{ action, platform }`.
  - Error message rõ ràng nếu lệnh cũ không còn hỗ trợ: "Command `<old>` moved to `xactions crawl --platform twitter --action followers`".
  - `unfollowx` alias vẫn hoạt động với deprecation warning.

---

## Summary

| F# | Finding | Story/Epic | Priority | Status |
|---|---|---|---|---|
| F1 | Daemon startup UX | 14.2 | P0 | Planned |
| F2 | QR non-TTY fallback | 12.1 | P1 | Planned |
| F3 | Governor status | 11.4 | P0 | Planned |
| F4 | Checkpoint visibility | 10.4, 19.1/19.5 | P1 | Planned |
| F5 | Action discovery | 10.1, 10.5 | P0 | Planned |
| F6 | Error envelope | 10.1 | P0 | Planned |
| F7 | Stream metrics | 14.3, 19.3 | P1 | Planned |
| F8 | Metadata schema | 10.5 | P2 | Planned |
| F9 | Operator dashboard | Epic 19 | P2 | Planned |
| F10 | Legacy CLI mapping | 14.2, 20.1 | P2 | Planned |

---

*Approved by BMad Product Council & UX Designer Sally, 2026-08-21.*
