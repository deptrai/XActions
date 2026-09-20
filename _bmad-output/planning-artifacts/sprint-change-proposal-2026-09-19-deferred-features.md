---
title: "Sprint Change Proposal — Retro Epic 41 + FUTURE-WORK Activation"
created: 2026-09-19
date: 2026-09-19
status: approved
author: "BMad Dev Agent (Correct Course)"
trigger: "Promote retrospective action items + deferred FUTURE-WORK features into actionable Epic/Story backlog"
mode: batch
---

# Sprint Change Proposal — Deferred Features → Story Backlog

> **⚠️ REVISED 2026-09-19 (post-approval):** User quyết định **append vào epic cũ** thay vì tạo Epic 42/43 mới. Mapping cuối cùng:
> - Avatar pHash → **Story 41.3** (Epic 41) — `ready-for-dev`
> - Instagram session verify → **Story 35.5** (Epic 35) — `ready-for-dev`
> - Marketplace filters → **Story 13.11** (Epic 13) — `ready-for-dev`
> - GraphQL Replay → **Story 13.12** (Epic 13) — `backlog-blocked` (gated)
> - Fingerprint spoofing → **Story 27.5** (Epic 27) — `backlog-blocked` (gated)
> - Zalo Personal → **Story 33.3** (Epic 33) — `backlog-blocked` (gated)
> - YouTube Advanced → **Story 33.4** (Epic 33) — `backlog-blocked` (gated)
> Epic 42/43 **không tồn tại**. Epic 13/35/41 flipped `done → in-progress`; retro 13/35/41 có addendum.

## Section 1 — Issue Summary

### Problem Statement

Ba nguồn công việc tồn đọng chưa được chuyển thành Epic/Story chính thức trong backlog:

1. **Retro Epic 41 (2026-09-19)** ghi nhận 1 action item mở: *"Avatar Perceptual Hashing (pHash) — tích hợp thuật toán pHash ở client để nhận diện và gom cụm avatar cross-platform khi URL ảnh từ CDN khác nhau"* — nhưng **Epic 42 chưa tồn tại** trong `epics.md`, item này đang lơ lửng không có chủ.
2. **`FUTURE-WORK.md`** chứa 5 tính năng deferred có điều kiện kích hoạt — cần rà soát điều kiện nào đã thỏa để promote thành story, điều kiện nào chưa thì giữ deferred nhưng có story-stub rõ ràng.
3. **`sprint-status.yaml` action_items** còn 1 mục `status: open` (`epic-35-retro-item-4`): live-verify Instagram session persistence ≥10 requests — là **verification task**, không phải feature story, nhưng cần được đưa vào backlog dưới dạng story để không bị quên.

### Discovery Context

- **Ngày phát hiện:** 2026-09-19, sau khi Epic 41 retrospective được chấp nhận (verdict: `accepted`).
- **Nguồn:** `epic-41-retrospective.md` Phase 5 Action Items; `FUTURE-WORK.md` sections FR-62 / Marketplace / Fingerprint / Zalo / YouTube; `sprint-status.yaml` action_items.
- **Bằng chứng:** Epic 41 retro Action Item #1 (owner: dev, status: open); `sprint-status.yaml:296-302` (`epic-35-retro-item-4`, owner: Luis, status: open); `FUTURE-WORK.md` 5 deferred sections.

---

## Section 2 — Impact Analysis

### 2.1 Epic Impact

| Epic hiện có | Ảnh hưởng |
|---|---|
| Epic 41 (OSINT Registries + Entity Resolution) | **Done** — action item pHash là công việc mới, không sửa epic đã đóng. Cần Epic kế tiếp. |
| Epic 33 (Zalo OA + YouTube VN) | **Done** — Zalo Personal & YouTube Advanced là mở rộng, không sửa epic đã đóng. |
| Epic 35 (Reddit/Medium/Instagram) | **Done accepted-with-open-items** — item-4 (live-verify) là follow-up, promote thành story trong epic mới. |
| Epic 27 (Anti-Detection & Session Resilience) | **Done** — Canvas/WebGL/Audio spoofing mở rộng FingerprintManager/stealthBrowser, cần epic mới hoặc story trong epic mới. |
| Epic 13 (Facebook Hybrid) | **Done** — Marketplace advanced filters mở rộng `marketplace()` action đã có. |

**Kết luận:** Tất cả công việc mới đều cần **Epic mới (Epic 42)** hoặc story bổ sung vào epic mới — không sửa đổi epic đã đóng.

### 2.2 Story Impact

- **Không** story nào đang in-progress bị ảnh hưởng.
- Story mới sẽ được tạo trong Epic 42 (và có thể Epic 43 nếu scope lớn).

### 2.3 Artifact Conflicts

| Artifact | Cần cập nhật? | Chi tiết |
|---|---|---|
| `epics.md` | ✅ Có | Thêm Epic 42 (và có thể Epic 43) với đầy đủ Business Context / Scope / Stories / Success Metrics / Risks. |
| `prd.md` | ✅ Có | Thêm FR mới cho các tính năng được promote (FR-109..FR-11x) + cập nhật traceability table. |
| `FUTURE-WORK.md` | ✅ Có | Đánh dấu các mục được promote → "Reactivated 2026-09-19 → Epic 42/43"; giữ deferred cho mục chưa thỏa điều kiện. |
| `sprint-status.yaml` | ✅ Có | Thêm `epic-42` entries + story slugs; chuyển `epic-35-retro-item-4` thành story reference hoặc giữ action_item liên kết story mới. |
| `CANONICAL-DOCS.md` | ⚠️ Minor | Cập nhật registry nếu epic/PRD thay đổi. |
| `architecture.md` | ⚠️ Minor | Thêm AD cho pHash module + GraphQL Replay nếu được approve. |

### 2.4 Technical Impact

| Hạng mục | Trạng thái codebase hiện tại | Net-new work |
|---|---|---|
| Avatar pHash | ❌ Chưa có — `entity-resolver.js` chỉ so `avatar` URL string equality (`avatar_match` +30) | Pure-JS dHash/aHash/pHash + Hamming distance + image fetch+decode (no image dep hiện có) |
| FR-62 GraphQL Replay | 🟡 Partial — `FacebookClient.requestGraphQl()` đã replay doc_id qua HTTP; nhưng chưa có **capture→store→replay engine** tổng quát | doc_id capture hook, replay cache (redis/sqlite), rotation detector |
| Marketplace Adv. Filters | 🟢 ~70% done — `marketplace()` đã có minPrice/maxPrice/category/categoryId/radiusKm/lat/lng/cursor | Thiếu: `sortBy` (price_asc/desc, date), `condition` (new/used), MCP `inputSchema` chưa expose radiusKm/lat/lng/categoryId/sort |
| Canvas/WebGL/Audio Spoof | 🟡 Partial — `stealthBrowser.js` chỉ spoof WebGL vendor/renderer tĩnh (line 295-302); FingerprintManager có profile tĩnh | Canvas noise injection, AudioContext fingerprint spoof, dynamic WebGL buffer noise |
| Zalo Personal Messaging | ❌ Chưa có — chỉ OA API (public) | Reverse engineer private mobile/Web API — research spike trước |
| YouTube VN Advanced | 🟡 Partial — descriptor có search/channel_videos/video_detail/comments/trending | InnerTube live chat, Shorts analytics, subscriber history |
| Instagram Session Verify | 🟢 Code done — `ensureSession`/`saveSession`/`loadSession` + SocialAccount persist | Chỉ cần **live verification run** — không code mới |

---

## Section 3 — Recommended Approach

**Chọn: Option 1 — Direct Adjustment (thêm Epic/Story mới vào backlog).**

### Rationale

- Không cần rollback — mọi công việc đều là net-new hoặc mở rộng, không xung đột code đã merge.
- MVP không bị ảnh hưởng — các epic 10–41 đều `done`; đây là Phase 9 mới.
- Một số mục deferred chưa thỏa điều kiện kích hoạt → ta tạo **story stub với trạng thái `backlog-blocked`** rõ ràng thay vì promote mù.

### Proposed Epic Structure

Đề xuất **1 Epic mới (Epic 42)** gộm các story đủ điều kiện + **Epic 43 (Conditional Backlog)** cho các mục chưa thỏa điều kiện:

- **Epic 42 — OSINT & Intelligence Hardening** (actionable now):
  - 42.1 Avatar pHash (net-new, unblocked)
  - 42.2 Instagram Session Live-Verification (action item → story)
  - 42.3 Marketplace Advanced Filters — Remainder (sort/condition/MCP-schema, partial unblocked)

- **Epic 43 — Advanced Platform Capabilities (Conditional/Gated)**:
  - 43.1 FR-62 GraphQL Replay Engine (blocked: cần doc_id stability evidence)
  - 43.2 Canvas/WebGL/Audio Fingerprint Spoofing (blocked: cần confirm FR-40..54 stable + checkpoint rate >5%)
  - 43.3 Zalo Personal Messaging (blocked: cần 2-week research spike + legal review — tạo research spike story)
  - 43.4 YouTube VN Advanced (blocked: cần Epic 33.2 stable ≥2 tuần production)

### Effort & Risk

| Story | Effort | Risk |
|---|---|---|
| 42.1 pHash | Medium (2–3d) | Low — pure JS, no new dep nếu decode PNG/JPEG thủ công hoặc thêm 1 dep nhẹ |
| 42.2 IG Session Verify | Low (0.5d) | Low — run-only, cần credentials + stable proxy |
| 42.3 Marketplace Filters | Low–Medium (1–2d) | Low — extend existing validated action |
| 43.1 GraphQL Replay | High (5d+) | High — doc_id rotation brittle |
| 43.2 Fingerprint Spoof | Medium–High (3–4d) | Medium — cần test trên bot-challenge targets |
| 43.3 Zalo Personal | High (research 2w) | High — legal/compliance + reverse engineering |
| 43.4 YouTube Advanced | Medium (2–3d) | Medium — InnerTube unofficial |

---

## Section 4 — Detailed Change Proposals

### Proposal A — epics.md: Add Epic 42 + Epic 43

**OLD:** (file kết thúc ở Epic 41)

**NEW:** Append sau Epic 41:

```markdown
# Epic 42: OSINT & Intelligence Hardening

## Business Context
Epic 41 retrospective phát hiện `EntityResolver` chỉ so khớp avatar bằng URL string — khi cùng
một ảnh được serve qua CDN khác nhau (fbcdn vs cdninstagram vs github avatars), URL khác nhau
→ miss match. Đồng thời Epic 35 còn 1 open verification item và Marketplace filters thiếu
sort/condition + chưa expose đầy đủ qua MCP.

## Scope
**Trong scope:**
- `src/osint/phash.js` (pure JS): dHash/aHash + Hamming distance; fetch+decode avatar (JPEG/PNG).
- `EntityResolver` nâng cấp: `avatar_match` signal dùng pHash similarity (Hamming ≤ threshold)
  thay vì chỉ URL equality; async scoring.
- Instagram live session verification (≥10 requests, stable proxy) — nghiệm thu metric Epic 35.
- Marketplace `sortBy` (relevance/price_asc/price_desc/date_listed), `condition` (new/used),
  expose `radiusKm/latitude/longitude/categoryId/sortBy/condition` vào MCP `inputSchema`.

**Ngoài scope:**
- Không persist pHash/PII (Option D).
- Không port Python image libs — pure JS only.

## Stories
- **Story 42.1**: Avatar Perceptual Hashing — pHash module + EntityResolver async avatar signal.
- **Story 42.2**: Instagram Session Persistence — live verification ≥10 requests.
- **Story 42.3**: Marketplace Advanced Filters — sortBy/condition + MCP schema exposure.

## Success Metrics
- pHash match 2 ảnh giống nhau qua CDN khác nhau với Hamming distance ≤ 10 (64-bit).
- `identityClusters[]` merge đúng khi avatar URL khác nhưng ảnh giống.
- Instagram: ≥10 requests liên tiếp không challenge trên stable proxy.
- MCP `x_facebook_marketplace` chấp nhận sortBy/condition/radiusKm/lat/lng.
```

```markdown
# Epic 43: Advanced Platform Capabilities (Conditional Backlog)

## Business Context
Các tính năng deferred trong FUTURE-WORK.md có điều kiện kích hoạt rõ ràng. Epic này là
conditional backlog — mỗi story chỉ chuyển `ready-for-dev` khi điều kiện kích hoạt được
xác nhận bởi Product Council.

## Scope (gated)
- FR-62 GraphQL Replay Engine (Facebook/Universal) — bypass headless.
- Canvas/WebGL/Audio fingerprint spoofing cho bot-challenge targets.
- Zalo Personal Messaging (research spike → implementation).
- YouTube VN Advanced (live chat, Shorts analytics, subscriber history).

## Stories (all `backlog-blocked` pending activation conditions)
- **Story 43.1**: GraphQL Replay Engine — doc_id capture + replay cache + rotation fallback.
  - Activation: ≥80% doc_id stable 30 ngày + replay cache storage + Council approve.
- **Story 43.2**: Advanced Fingerprint Spoofing — canvas/WebGL/audio noise injection.
  - Activation: FR-40..54 stable + checkpoint rate >5% confirmed.
- **Story 43.3**: Zalo Personal Messaging — RESEARCH SPIKE (2 tuần) trước, implementation sau.
  - Activation: research spike done + Nowing need + legal/compliance approve.
- **Story 43.4**: YouTube VN Advanced — InnerTube live chat + Shorts + subscriber history.
  - Activation: Epic 33.2 stable ≥2 tuần production + API quota optimization.
```

---

### Proposal B — prd.md: Add FR-109..FR-114 + traceability

```markdown
* **FR-109 (Avatar Perceptual Hashing for Entity Resolution):** `EntityResolver` dùng pHash
  (dHash/aHash, Hamming distance) để so khớp avatar cross-platform khi CDN URL khác nhau.
  Pure JS, async, không persist (Option D). (Epic 42.1)
* **FR-110 (Instagram Session Stability Verification):** Nghiệm thu `InstagramClient` duy trì
  session ≥10 requests liên tiếp không challenge dưới stable proxy. (Epic 42.2)
* **FR-111 (Marketplace Advanced Filters — Sort & Condition):** Bổ sung `sortBy`
  (relevance/price_asc/price_desc/date_listed) và `condition` (new/used) vào `marketplace()`
  action; expose đầy đủ `radiusKm/latitude/longitude/categoryId/sortBy/condition` qua MCP
  `x_facebook_marketplace` inputSchema. (Epic 42.3)
* **FR-112 (GraphQL Replay Engine — conditional):** Capture `doc_id` + tokens từ Puppeteer,
  replay bằng HTTP client với replay cache (redis/sqlite) và DOM/hydration fallback khi
  doc_id rotate. (Epic 43.1 — gated)
* **FR-113 (Advanced Canvas/WebGL/Audio Fingerprint Spoofing — conditional):** Inject noise
  động vào canvas getImageData/toDataURL, WebGL buffer, AudioContext/AnalyserNode cho
  bot-challenge targets. (Epic 43.2 — gated)
* **FR-114 (Zalo Personal Messaging — conditional, research-gated):** Cào Zalo cá nhân
  (tin nhắn, nhóm, friend list) qua reverse-engineered private API sau research spike.
  (Epic 43.3 — gated)
* **FR-115 (YouTube VN Advanced Data — conditional):** Live stream chat, Shorts analytics,
  subscriber history qua InnerTube/extended API. (Epic 43.4 — gated)
```

Traceability table: thêm `Epic 42 → FR-109,110,111` và `Epic 43 → FR-112,113,114,115`.

---

### Proposal C — FUTURE-WORK.md: mark promoted / keep deferred

```markdown
## Facebook Marketplace Advanced Filters
**Trạng thái:** 🟢 Partially Reactivated 2026-09-19 → Epic 42.3 (sort/condition/MCP-exposure remainder).
minPrice/maxPrice/category/categoryId/radiusKm/geo đã implement sẵn trong crawler.

## Advanced Fingerprint Spoofing (Canvas / WebGL / Audio)
**Trạng thái:** 🟡 Story stub created → Epic 43.2 (backlog-blocked). Awaiting FR-40..54 stable + checkpoint-rate confirmation.

## FR-62: GraphQL Replay
**Trạng thái:** 🟡 Story stub created → Epic 43.1 (backlog-blocked). Awaiting doc_id 30-day stability evidence.

## Zalo Personal Messaging Scrape — Deferred
**Trạng thái:** 🟡 Research spike stub → Epic 43.3 (backlog-blocked). Needs 2-week research + legal review.

## YouTube VN Advanced Features — Deferred
**Trạng thái:** 🟡 Story stub → Epic 43.4 (backlog-blocked). Needs Epic 33.2 stable ≥2 tuần production.
```

---

### Proposal D — sprint-status.yaml: add epic-42, epic-43 + link action item

```yaml
  epic-42: backlog
  42-1-avatar-perceptual-hashing-entity-resolver: backlog
  42-2-instagram-session-persistence-live-verify: backlog
  42-3-marketplace-advanced-filters-sort-condition: backlog
  epic-42-retrospective: optional

  epic-43: backlog
  43-1-graphql-replay-engine-conditional: backlog-blocked
  43-2-canvas-webgl-audio-fingerprint-spoofing-conditional: backlog-blocked
  43-3-zalo-personal-messaging-research-spike-conditional: backlog-blocked
  43-4-youtube-vn-advanced-data-conditional: backlog-blocked
  epic-43-retrospective: optional
```

Và cập nhật action_item:
```yaml
  - id: "epic-35-retro-item-4-live-verify-instagram-session-persistenc"
    status: in-progress   # was: open → now tracked as story 42-2
    ref: "_bmad-output/implementation-artifacts/stories/42-2-instagram-session-persistence-live-verify.md"
```

---

### Proposal E — architecture.md: add AD entries (minor)

- **AD-46**: Avatar pHash — pure-JS perceptual hashing in `src/osint/phash.js`, async entity signal, Option D no-persist.
- **AD-47** (conditional): GraphQL Replay — capture→cache→replay with DOM fallback.

---

## Section 5 — Implementation Handoff

### Scope Classification: **Moderate**

- Epic 42: 3 stories — moderate backlog reorganization + dev implementation.
- Epic 43: 4 conditional story stubs — PO gating, không dev ngay.

### Handoff Recipients

| Vai trò | Trách nhiệm |
|---|---|
| **Product Owner** | Approve Epic 42/43 structure, xác nhận activation conditions Epic 43, update sprint-status. |
| **Developer Agent** | Implement Epic 42.1 (pHash), 42.3 (Marketplace filters); run Epic 42.2 (IG verify). |
| **PM / Architect** | Gate-review Epic 43 stories khi activation conditions thỏa; AD-46/47 doc. |
| **Luis (owner)** | Provide Instagram credentials + stable proxy cho story 42.2 live-verify. |

### Success Criteria

- `epics.md` có Epic 42 (3 stories) + Epic 43 (4 conditional stubs).
- `prd.md` có FR-109..115 + traceability.
- `FUTURE-WORK.md` phản ánh trạng thái promoted/blocked chính xác.
- `sprint-status.yaml` có epic-42/43 entries; item-4 chuyển in-progress → story 42-2.
- Story files cho Epic 42 được tạo (ready-for-dev) trong `implementation-artifacts/stories/`.
- Epic 43 stories giữ `backlog-blocked` với activation conditions ghi rõ.

---

*Generated by Correct Course workflow — 2026-09-19.*
