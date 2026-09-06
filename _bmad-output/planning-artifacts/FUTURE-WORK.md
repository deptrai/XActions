---
title: "Future Work & Deferred Scope"
created: 2026-08-21
updated: 2026-08-21
status: approved
---

# Future Work & Deferred Scope

Tài liệu này tập hợp các yêu cầu, ý tưởng, và tính năng bị hoãn lại để tránh scope creep trong các phase hiện tại. Các mục chỉ được mở lại khi đáp ứng điều kiện kích hoạt rõ ràng.

---

## FR-62: GraphQL Replay (Facebook / Universal)

**Nguồn:** `archive/prds/prd-XActions-2026-08-14-epic7/prd.md` §4.5, `archive/epics-1-9-legacy.md` Epic 7.

**Mô tả:** Capture `doc_id` từ `api/graphql` request trong Puppeteer và replay bằng HTTP client (`axios`/`undici`) với `fb_dtsg`, `lsd`, `__dyn`, `__csr`. Fallback sang hydration/DOM nếu `doc_id` rotate.

**Tại sao defer:**
- Cần `doc_id` mapping ổn định ≥ 30 ngày trước khi đầu tư replay engine.
- GraphQL endpoint Facebook có thể thay đổi nhanh, rủi ro brittle cao.
- DOM fallback và hydration extraction (FR-61) đã đủ cho MVP.

**Điều kiện mở lại:**
1. Story 5.1 (GraphQL Layer) và 7.1 (Health/Pool/Hydration) ổn định.
2. ≥ 80% `doc_id` mapping ổn định trong 30 ngày trên production-like traffic.
3. Có replay cache storage (`redis`/`sqlite`) để lưu mapping.
4. Product Council approve Phase 3 scope.

**Impact khi triển khai:**
- Giảm RAM usage (không cần giữ browser tab trong quá trình replay).
- Tăng tốc độ scrape comments/search (10x–50x so với DOM scroll).

---

## Facebook Marketplace Advanced Filters

**Mô tả:** Lọc theo giá min/max, khoảng cách, category, sort by date/price.

**Điều kiện mở lại:** FR-28..FR-31 stable, có real-user feedback.

---

## Advanced Fingerprint Spoofing (Canvas / WebGL / Audio)

**Mô tả:** Spoofing canvas fingerprint, WebGL vendor/renderer, audio context để tránh bot detection nâng cao.

**Điều kiện mở lại:** FR-40..FR-54 stable, checkpoint rate vẫn > 5%.

---

## AI-Generated Content for Growth Automation

**Mô tả:** Tự động sinh nội dung post/comment/friend request message bằng LLM.

**Điều kiện mở lại:** Product Council approve AI content policy, có integration với AI layer hiện có.

---

## Multi-Account Parallel Manager UI

**Mô tả:** Dashboard quản lý nhiều account, proxy assignment, hibernation queue.

**Điều kiện mở lại:** Epic 19 operator dashboard hoàn thành, Epic 7 multi-account stable.

---

## Epic 21–22: ✅ Reactivated (2026-09-05 — Vietnam Market Pivot)

**Trạng thái:** Đã kích hoạt lại. Spec giữ nguyên tại `backlog-epics-21-22.md`. PRD FR-94→96 added. Priority: Phase A — trước Epic 20/27–32.

---

## Zalo Personal Messaging Scrape — Deferred

**Nguồn:** Epic 33.1 scope note (2026-09-05).

**Mô tả:** Cào Zalo cá nhân (tin nhắn, nhóm, friend list) qua mobile API reverse engineering.

**Tại sao defer:**
- Zalo OA API (`openapi.zalo.me`) chỉ cover business/public content — không có personal messaging endpoints.
- Personal Zalo cần reverse engineer Zalo mobile app (gRPC/protobuf) — effort lớn, rủi ro cao.
- OA API + Marketplace đã đủ cho lead generation use case của Nowing.

**Điều kiện mở lại:**
1. Nowing có nhu cầu cụ thể cho Zalo personal data.
2. Zalo mobile API research hoàn tất (minimum 2 tuần dedicated).
3. Product Council approve legal/compliance review.

---

## YouTube VN Advanced Features — Deferred

**Nguồn:** Epic 33.2 scope note (2026-09-05).

**Mô tả:** YouTube VN live stream chat, Shorts analytics, YouTube Music VN, channel subscriber history.

**Tại sao defer:**
- YouTube Data API v3 không cung cấp live chat hoặc subscriber history.
- Cần YouTube InnerTube API (unofficial) hoặc yt-dlp extended features.
- Epic 33.2 MVP (search, channel videos, comments, trending) đã đủ cho Nowing lead generation.

**Điều kiện mở lại:**
1. Epic 33.2 stable trong production ≥ 2 tuần.
2. YouTube API quota optimization hoàn tất (10k units/day limit).

---

*Document owner: BMad Product Council. Reviewed every sprint-end for activation conditions.*
