---
title: "Future Work & Deferred Scope"
created: 2026-08-21
updated: 2026-09-21
status: approved
---

# Future Work & Deferred Scope

Tài liệu này tập hợp các yêu cầu, ý tưởng, và tính năng bị hoãn lại để tránh scope creep trong các phase hiện tại. Các mục chỉ được mở lại khi đáp ứng điều kiện kích hoạt rõ ràng.

---

## FR-62: GraphQL Replay (Facebook / Universal)

**Trạng thái:** 🟡 **Story stub → Story 13.12 (Epic 13, `backlog-blocked`).** `FacebookClient.requestGraphQl()` đã replay doc_id qua HTTP, nhưng chưa có capture→cache→replay engine tổng quát. Awaiting activation conditions below.

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

**Trạng thái:** 🟢 **Partially Reactivated 2026-09-19 → Story 13.11 (Epic 13).** `minPrice`/`maxPrice`/`category`/`categoryId`/`radiusKm`/`latitude`/`longitude`/`cursor` đã implement sẵn trong `FacebookCrawler.marketplace()`; phần còn lại (sortBy, condition, MCP/CLI exposure) là Story 13.11.

**Mô tả:** Lọc theo giá min/max, khoảng cách, category, sort by date/price.

**Điều kiện mở lại:** FR-28..FR-31 stable, có real-user feedback.

---

## Advanced Fingerprint Spoofing (Canvas / WebGL / Audio)

**Trạng thái:** 🟡 **Story stub → Story 27.5 (Epic 27, `backlog-blocked`).** Hiện `stealthBrowser.js` chỉ spoof WebGL vendor/renderer tĩnh; canvas/audio noise injection là net-new. Awaiting FR-40..54 stable + checkpoint-rate confirmation.

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

**Trạng thái:** 🟡 **Story stub → Story 33.3 (Epic 33, `backlog-blocked`).** Cần research spike 2 tuần + legal/compliance review trước khi implementation.

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

**Trạng thái:** 🟡 **Story stub → Story 33.4 (Epic 33, `backlog-blocked`).** Cần Epic 33.2 stable ≥2 tuần production + API quota optimization.

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

## Jev Tier-2 Candidates — Deferred (Pending Demand Signal)

**Trạng thái:** 🟡 **Deferred.** Các điểm cắm Jev có giá trị nhưng chưa đủ điều kiện promote thành story — chỉ mở lại khi demand signal dưới đây đúng. Jev decision plane (`jevBrain`) được đặt nền ở Epic 42; các mục này tái dùng nó, không tạo gateway mới.

**Nguồn:** `_bmad-output/forge/jev-typesafe-integration/forged-idea.md`, `docs/architecture.md` §2.8 / AD-48.

| Mục | Vị trí | Vì sao defer | Điều kiện mở lại |
|---|---|---|---|
| **A2A intent routing** | `src/a2a/orchestrator.js`, `skillRegistry.js` | Chỉ đáng khi ≥3 agent/skill cần disambiguation; hiện dispatch đã deterministic qua `agentCard`/`skillRegistry`. | Khi có ≥3 agent/skill route mập mờ mà rule không phân được → promote thành story (`Choice` intent + confidence). |
| **CRM / sentiment tagging** | `src/analytics/followerCRM.js`, `reputation.js`, `sentiment.js` | Lexicon/stopword hiện đủ cho tagging; Jev chỉ thắng khi text mập mờ (sarcasm/ngữ cảnh). | Khi lexicon tagging sai >~15% trên sample thật → `Choice`/`Score` semantic tagging. |
| **xspace `detectSentiment`** | `xspace-agents/.../intelligence/sentiment.ts` | Voice loop cần <1s; call Jev ~300ms+network/turn = rủi ro khựng. Lexicon hiện đủ. | Khi mis-detected sentiment gây bad-response trên Spaces (đo được) → Jev non-blocking song song, fallback lexicon. |

**Nguyên tắc chung:** Jev chỉ đáng nơi cần *judgment ngữ nghĩa mập mờ* — không phải nơi rule/lexicon/numeric đã đúng (xem Epic 42/43 out-of-scope). Mọi call qua `jevBrain`, confidence per-action config, `LLMBrain` fallback.

---

*Document owner: BMad Product Council. Reviewed every sprint-end for activation conditions.*
