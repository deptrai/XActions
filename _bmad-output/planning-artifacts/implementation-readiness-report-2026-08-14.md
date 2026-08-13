---
stepsCompleted:
  - document-discovery
  - prd-analysis
  - epic-coverage-validation
  - ux-alignment
  - epic-quality-review
  - final-assessment
assessmentDate: 2026-08-14
project: XActions
includedFiles:
  prd:
    - _bmad-output/planning-artifacts/prds/prd-XActions-2026-08-14-epic7/prd.md
    - _bmad-output/planning-artifacts/prds/prd-XActions-2026-08-14-epic7/validation-report.md
  architecture:
    - _bmad-output/planning-artifacts/architecture.md
    - _bmad-output/architecture-artifacts/epic7-2026-08-14/ARCHITECTURE-SPINE.md
    - _bmad-output/architecture-artifacts/epic7-2026-08-14/STORIES.md
    - _bmad-output/architecture-artifacts/epic7-2026-08-14/DECISIONS.md
    - _bmad-output/architecture-artifacts/epic7-2026-08-14/MEMLOG.md
  epics:
    - _bmad-output/planning-artifacts/epics-full.md
  ux:
    - _bmad-output/planning-artifacts/ux/DESIGN.md
    - _bmad-output/planning-artifacts/ux/EXPERIENCE.md
notes:
  - Selected epics-full.md over epics.md (newer and contains Epic 7).
  - Included architecture-artifacts/epic7-2026-08-14/ even though it lives outside planning-artifacts.
  - Included validation-report.md as part of the PRD shard.
---

# Implementation Readiness Assessment Report

**Date:** 2026-08-14
**Project:** XActions

## Document Inventory

### PRD
- `prds/prd-XActions-2026-08-14-epic7/prd.md` (16,220 bytes, 2026-08-14)
- `prds/prd-XActions-2026-08-14-epic7/validation-report.md` (9,586 bytes, 2026-08-14)

### Architecture
- `architecture.md` (46,292 bytes, 2026-08-12)
- `architecture-artifacts/epic7-2026-08-14/ARCHITECTURE-SPINE.md` (10,359 bytes, 2026-08-14)
- `architecture-artifacts/epic7-2026-08-14/STORIES.md` (11,819 bytes, 2026-08-14)
- `architecture-artifacts/epic7-2026-08-14/DECISIONS.md` (2,709 bytes, 2026-08-14)
- `architecture-artifacts/epic7-2026-08-14/MEMLOG.md` (2,846 bytes, 2026-08-14)

### Epics & Stories
- `epics-full.md` (38,678 bytes, 2026-08-14)

### UX
- `ux/DESIGN.md` (9,741 bytes, 2026-08-08)
- `ux/EXPERIENCE.md` (11,494 bytes, 2026-08-08)

---

## PRD Analysis

### Functional Requirements

- **FR-55:** Account health check — HTTP GET `facebook.com/` với cookie, parse `fb_dtsg` từ HTML, xác thực `c_user`/`xs` từ cookie jar, kiểm tra checkpoint, trả về `{ status, reason, lastCheckAt }`, cache TTL 5 phút.
- **FR-56:** Account pool & parallel runner — phân bổ task cho account live, proxy affinity, `p-limit@7.2.0`, `maxConcurrency` 4-8, delay 3-8s, retry checkpoint, trả `results[] + accountUsage`.
- **FR-57:** Search Facebook multi-type — `query`, `type` (`posts`/`people`/`pages`/`groups`/`all`), `location`, `limit`, `authCookie`, `parallel`; `all` mặc định sequential, `parallel: true` fan-out 4 task; trả object 4 mảng hoặc mảng theo `type`.
- **FR-58:** Scrape post comments — `postUrl`, `limit`, `includeReplies`; chuyển sort, scroll, mở replies; trả comments với `replies[]` khi `includeReplies: true`.
- **FR-59:** Scrape group posts — `groupUrl`, `limit`; mobile UA 390x844; trả posts hoặc `note` nếu private/restricted.
- **FR-60:** Scrape group comments — `postUrl` trong group, `limit`, `includeReplies`; verify `facebook.com/groups/`; gọi `scrapeFacebookComments`.
- **FR-61:** Hydration JSON extraction — parse `<script data-content-len>`, walk `__typename`, hỗ trợ `Story`, `Comment`, `User`, `Page`, `Group`, `MarketplaceListing`; DOM fallback.
- **FR-62:** GraphQL replay (deferred Phase 3) — capture `doc_id`, replay bằng `axios`, fallback hydration/DOM.
- **FR-63:** Unified Facebook scrape service — `api/services/facebookScrape.js` với `run`/`runBatch`; API `POST /scrape` và MCP tools mới gọi service; không duplicate logic.

**Total FRs:** 9

### Non-Functional Requirements

- **NFR-10:** Không lưu trữ — chỉ trả JSON, không ghi DB kết quả scrape.
- **NFR-11:** Health check nhanh — < 2 giây, không mở browser.
- **NFR-12:** Concurrency cap — mặc định 4, tối đa 8 browsers.
- **NFR-13:** Privacy — cookie/token không log/echo.
- **NFR-14:** Resilience — DOM fallback khi hydration/GraphQL fail.
- **NFR-15:** Read velocity — scroll delay 1-3 giây, max 50 scrolls/task.

**Total NFRs:** 6

### Additional Requirements / Constraints

- **MVP scope:** FR-55..FR-61, FR-63 trong Epic 7; FR-62 deferred Phase 3.
- **Out of scope:** UI, storage/analytics, write automation, Facebook Ads/Business, PII, reaction/liker list.
- **Success metrics:** SM-1 (`type: 'all'` 4 loại), SM-2 (100 comments < 90s), SM-3 (runBatch 4x nhanh hơn sequential), SM-4 (health ≥ 95% accuracy).
- **Open questions resolved:** `FacebookAccountHealth` Prisma, `type: 'all'` sequential default, `FacebookAccount.proxy`, `p-limit`, no TLS/JA3.

### PRD Completeness Assessment

PRD Epic 7 đã đầy đủ FR/NFR, UJ cụ thể, non-goals rõ ràng, success metrics testable. Validation report cũ đã resolve tất cả high/medium findings. Không còn open question. Sẵn sàng sang epic coverage validation.

---

## Epic Coverage Validation

### Coverage Matrix

| FR Number | PRD Requirement | Epic Coverage | Status |
|-----------|-----------------|---------------|--------|
| FR-55 | Account health check | Story 7.1 | ✓ Covered |
| FR-56 | Account pool & parallel runner | Story 7.2 | ✓ Covered |
| FR-57 | Search Facebook multi-type | Story 7.3 | ✓ Covered |
| FR-58 | Scrape post comments | Story 7.4 | ✓ Covered |
| FR-59 | Scrape group posts | Story 7.5 | ✓ Covered |
| FR-60 | Scrape group comments | Story 7.6 | ✓ Covered |
| FR-61 | Hydration JSON extraction | Story 7.7 | ✓ Covered |
| FR-62 | GraphQL replay | **Not in any Epic 7 story** | ⚠️ Deferred to Phase 3 |
| FR-63 | Unified Facebook scrape service | Story 7.8 | ✓ Covered |

### NFR Coverage

| NFR Number | Requirement | Covered | Note |
|------------|-------------|---------|------|
| NFR-10 | Không lưu trữ | ✓ | Across all stories / architecture |
| NFR-11 | Health check < 2s | ✓ | Story 7.1 |
| NFR-12 | Concurrency cap 4-8 | ✓ | Story 7.2 |
| NFR-13 | Privacy cookie values | ✓ | Stories 7.1, 7.8, architecture |
| NFR-14 | DOM fallback | ✓ | Story 7.7 |
| NFR-15 | Read velocity 1-3s / max 50 scrolls | ✓ | Story 7.3, 7.4, 7.5 |

### Missing / Deferred Requirements

- **FR-62 (GraphQL replay):** Epics catalog lists FR55-FR63, but no story implements FR-62. PRD explicitly defers FR-62 to Phase 3. **Recommendation:** Update `epics-full.md` Epic 7 header to `FRs: FR55-FR61, FR63` hoặc thêm footnote rằng FR-62 deferred, để tránh nhầm coverage.

### Coverage Statistics

- **Total PRD FRs:** 9
- **FRs covered in Epic 7 stories:** 8
- **Coverage percentage:** 88.9% (FR-62 intentionally deferred)

---

## UX Alignment Assessment

### UX Document Status

- **Found:** `ux/DESIGN.md` (design tokens) và `ux/EXPERIENCE.md` (dashboard flows).
- **Epic 7 UI scope:** PRD §5, §6.2, và `architecture.md` đều xác định **không có UI** cho Epic 7 — chỉ API + MCP.

### Alignment Issues

- Không có issue nghiêm trọng. UX docs mô tả dashboard Facebook Automation (`/platforms/facebook`) nhưng không đề cập đến các tool mới (`x_facebook_search`, comments, group posts) của Epic 7.
- Các feature Epic 7 đều là headless JSON outputs, phù hợp với kiến trúc API/MCP.

### Warnings

- **Future UI gap:** Khi Phase sau xây UI cho lead-gen dashboard, cần cập nhật `ux/EXPERIENCE.md` để thêm các tab/cards cho search đa loại, post comments, group posts/comments.
- **Raw JSON display:** UX `DESIGN.md`/`EXPERIENCE.md` khuyến nghị không hiển thị raw JSON mặc định; các kết quả Epic 7 hiện tại là JSON thuần, nên UI tương lai cần structured result panel.

---

## Epic Quality Review

### Epic 7 — Facebook Advanced Scraping & Multi-Account Parallel Execution

#### Epic Structure

| Check | Status | Note |
|---|---|---|
| User-centric title | ✓ | Mô tả khả năng người dùng có thể làm (scrape + parallel). |
| User outcome goal | ✓ | "Expand Facebook scraping to support multi-type search... using a pool of live accounts." |
| Independent value | ✓ | Cung cấp lead-gen / market-research capability; không phải technical milestone. |
| No forward epic dependencies | ✓ | Phụ thuộc Epic 6 (anti-detection) — previous epic, hợp lệ. |

#### Story Quality

| Story | User Value | Sizing | AC Clarity | Notes |
|---|---|---|---|---|
| 7.1 Health Check | ✓ | Small-Medium | ⚠️ | AC ghi "parses `fb_dtsg` and `c_user` from the HTML" — trái với PRD/validation report (`c_user` từ cookie jar, `fb_dtsg` từ HTML). |
| 7.2 Account Pool | ✓ | Medium | ✓ | Có thể hơi lớn nhưng tách được. |
| 7.3 Multi-Type Search | ✓ | Large | ⚠️ | AC "returns normalized results matching the `type` shape" còn mơ hồ. Nên thêm exact field list/object schema. |
| 7.4 Post Comments | ✓ | Medium | ✓ | Tốt. |
| 7.5 Group Posts | ✓ | Small | ✓ | Tốt. |
| 7.6 Group Comments | ✓ | Small | ✓ | Tốt, nhưng AC nên nêu rõ signature gọi `scrapeFacebookComments`. |
| 7.7 Hydration JSON | ✓ | Small | ✓ | Tốt. |
| 7.8 API/MCP Surface | ✓ | Medium | ✓ | Tốt. |

#### Dependency Analysis

| Dependency | Status | Notes |
|---|---|---|
| 7.3 → 7.8 | ⚠️ **Forward dependency** | 7.3 cần `facebookScrapeService` (từ 7.8) để dispatch search. |
| 7.4 → 7.8 | ⚠️ **Forward dependency** | 7.4 cần `facebookScrapeService` (từ 7.8). |
| 7.5 → 7.8 | ⚠️ **Forward dependency** | 7.5 cần `facebookScrapeService` (từ 7.8). |
| 7.6 → 7.4 | ✓ | Nằm sau trong numbering, hợp lệ. |

**Recommendation:** Đổi thứ tự story thành 7.1 → 7.2 → 7.7 → 7.8 → 7.3 → 7.4 → 7.5 → 7.6 (khớp `STORIES.md` implementation order), hoặc đánh dấu 7.8 là prerequisite cho 7.3/7.4/7.5.

#### Database/Schema Timing

- `FacebookAccount.proxy` (encryptedProxy) và `FacebookAccountHealth` model cần cho 7.1 và 7.2. Migration nằm trong `ARCHITECTURE-SPINE.md` Migrations, không phải một story riêng — chấp nhận được nếu coi là cross-cutting.

#### Best Practices Compliance Checklist

- [x] Epic delivers user value
- [x] Epic can function independently
- [ ] Stories appropriately sized — 7.3 hơi lớn
- [ ] No forward dependencies — 7.3/7.4/7.5 phụ thuộc 7.8
- [x] Database tables created when needed
- [ ] Clear acceptance criteria — 7.3 AC mơ hồ
- [x] Traceability to FRs maintained

#### Quality Findings by Severity

🔴 **Critical:** Không có.

🟠 **Major:**
1. Forward dependency 7.3/7.4/7.5 → 7.8. Cần reorder hoặc ghi rõ 7.8 là prerequisite.
2. Story 7.1 AC sai: `c_user` không parse từ HTML mà từ cookie jar.
3. Story 7.3 AC mơ hồ: "normalized results matching the `type` shape" — cần object schema cụ thể.

🟡 **Minor:**
- Story 7.3 size lớn; có thể split thành `searchFacebook` (core) + `all` fan-out wrapper nếu cần.
- `epics-full.md` Epic 7 header nên ghi rõ FR-62 deferred hoặc đổi FR range thành FR55-FR61, FR63.

---

## Summary and Recommendations

### Overall Readiness Status

**READY with conditions** — Epic 7 có thể chuyển sang implementation nếu 3 major findings dưới đây được giải quyết hoặc accept rõ ràng.

### Critical Issues Requiring Immediate Action

1. **Forward dependency 7.3/7.4/7.5 → 7.8** — Nên reorder stories hoặc ghi rõ 7.8 là prerequisite.
2. **AC 7.1 `c_user` parse từ HTML** — Sai so với PRD (`c_user` từ cookie jar). Dễ sửa nhưng dễ gây bug.
3. **AC 7.3 "normalized results matching the `type` shape" mơ hồ** — Cần schema chính xác để dev test.

### Recommended Next Steps

- [x] Sửa `epics-full.md` Story 7.1 AC: `fb_dtsg` từ HTML, `c_user`/`xs` từ cookie jar.
- [x] Bổ sung object schema cho `searchFacebook` `type: 'all'` vào `epics-full.md` Story 7.3.
- [x] Thêm dependency note cho 7.3/7.4/7.5 → 7.8 và 7.8 → 7.1/7.2/7.7.
- [x] Cập nhật `epics-full.md` Epic 7 header ghi rõ FR-62 deferred.

### Final Note

Tất cả các vấn đề từ epic quality review đã được sửa trong `epics-full.md` (commit `7816f56`). Epic 7 hiện ở trạng thái **READY for implementation**.
