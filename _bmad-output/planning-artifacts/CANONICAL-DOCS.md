---
date: 2026-08-21
skill: bmad-check-implementation-readiness
---

# Canonical Document Registry — XActions Implementation Readiness

Để giải quyết tình trạng trùng lặp và lỗi thời, hội đồng sản phẩm/kiến trúc quyết định các tài liệu dưới đây là **canonical** cho giai đoạn triển khai hiện tại. Các phiên bản khác trong repo vẫn được giữ lại để tham khảo lịch sử nhưng phải được coi là deprecated hoặc archive.

## Canonical PRD

| File | Lý do chọn | Trạng thái |
|---|---|---|
| `_bmad-output/planning-artifacts/prd.md` | Mới nhất (2026-08-19, approved), bao gồm FR-85..88 và NFR-17 từ readiness assessment. | **Canonical** |
| `_bmad-output/planning-artifacts/prd-facebook-epics-5-6-2026-08-21.md` | Tổng hợp FR23–FR54 cho Epics 5, 5b, 6. | **Canonical** |

### Deprecated PRDs

| File | Trạng thái | Lý do |
|---|---|---|
| `prds/prd-XActions-2026-06-08/prd.md` | Deprecated | Đã được hợp nhất vào `epics-full.md` FR1–14 và `prd.md` cho Epics 10–20. |
| `prds/prd-XActions-2026-06-10-epic4/prd.md` | Deprecated | Đã được hợp nhất vào `epics-full.md` FR15–23. |
| `prds/prd-XActions-2026-08-14-epic7/prd.md` | Deprecated | Nội dung FR-55..63 đã được cập nhật trong `epics-full.md`; FR-62 deferred. |
| `prds/prd-XActions-2026-08-18-universal-scraping-engine/prd.md` | Deprecated | Là bản nháp trước khi `prd.md` được bổ sung appendix FR-85..88 / NFR-17. |

## Canonical Architecture

| File | Lý do chọn | Trạng thái |
|---|---|---|
| `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` | Mới nhất (2026-08-19, r3), đầy đủ ADR cho toàn bộ hybrid engine. | **Canonical** |

### Architecture đi kèm (supplemental, không phải duplicate)

| File | Mục đích |
|---|---|
| `ARCHITECTURE-DEV-REVIEW-2026-08-18.md` | Dev review notes — giữ để tham khảo. |
| `ARCHITECTURE-EPIC10-PM-REVIEW-2026-08-18.md` | PM review cho Epic 10. |
| `ARCHITECTURE-EPIC10-REVIEW-2026-08-18.md` | Technical review cho Epic 10. |
| `ARCHITECTURE-UPDATE-GATE-2026-08-18.md` | Update gate notes. |
| `ARCHITECTURE-UPDATE-GATE-2026-08-18-R3.md` | r3 update gate. |
| `ARCHITECTURE-UX-REVIEW-2026-08-18.md` | UX findings cần được chuyển thành epic/story. |
| `EPIC10-DECISION-LOG-2026-08-18.md` | Decision log. |
| `architecture-ecosystem-manus-killer-2026-08-20/ARCHITECTURE-SPINE.md` | **External ecosystem artifact** (chainlens + nowing), đã commit để tham khảo, không phải canonical của XActions. |

**Lưu ý:** `architecture.md` (whole, 45K) đã được đánh dấu deprecated. Nội dung còn giá trị đã được hợp nhất vào `ARCHITECTURE-SPINE.md`.

### UX Remediation Canonical

| File | Mục đích |
|---|---|
| `FUTURE-WORK.md` | **Canonical backlog** cho deferred scope (FR-62, FR49–FR51, Phase 3). |
| `architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-UX-REVIEW-2026-08-18.md` | Bản gốc 10 findings. |
| `architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-UX-REMEDIATION-2026-08-21.md` | **Canonical remediation** — map F1–F10 sang epic/story và AC bổ sung. |

## Canonical Epics & Stories

| File | Phạm vi | Trạng thái |
|---|---|---|
| `_bmad-output/planning-artifacts/epics-full.md` | Epics 1–9 (Facebook) + 5b/7/8/9 | **Canonical** |
| `_bmad-output/planning-artifacts/epics.md` | Epics 10–20 (Universal Hybrid Engine) | **Canonical** |

Hai file này bổ sung nhau; sẽ merge thành một `epics.md` duy nhất trong tương lai nếu kích thước cho phép.

## Canonical UX

| File | Trạng thái |
|---|---|
| `_bmad-output/planning-artifacts/ux/DESIGN.md` | **Canonical design tokens**; đã bổ sung New Components cho hybrid engine / admin dashboard. |
| `_bmad-output/planning-artifacts/ux/EXPERIENCE.md` | Lỗi thời (2026-06-19); còn giá trị cho Facebook/X dashboard cũ. |
| `_bmad-output/planning-artifacts/ux/EXPERIENCE-UNIVERSAL-2026-08-21.md` | **Canonical** cho operator, AI agent, multi-platform, CDP, MCP/CLI flows. |
| `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-UX-REVIEW-2026-08-18.md` | Bản gốc 10 findings. |
| `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-UX-REMEDIATION-2026-08-21.md` | **Canonical remediation** — map F1–F10 sang epic/story. |

## Actions tiếp theo

1. ✅ Cập nhật frontmatter các PRD deprecated.
2. ✅ Bổ sung `canonical: true` vào `prd.md`.
3. ✅ Tạo `prd-canonicalization-addendum.md` để giải quyết FR/NFR numbering conflicts.
4. ✅ Cập nhật `epics.md` dependency map.
5. ✅ Tạo `ARCHITECTURE-UX-REMEDIATION-2026-08-21.md` map F1–F10 sang epic/story.
6. ✅ Tạo `EXPERIENCE-UNIVERSAL-2026-08-21.md` và cập nhật `DESIGN.md` với New Components.
7. Còn lại: chỉnh sửa epic/story cụ thể để bổ sung AC từ F1–F10.

## External / Ecosystem Artifacts (Committed for Reference)

| File | Mục đích |
|---|---|
| `briefs/brief-ecosystem-manus-killer-2026-08-20/brief.md` | Product brief cho ecosystem chainlens + nowing (Manus-Killer). |
| `briefs/brief-ecosystem-manus-killer-2026-08-20/addendum.md` | Addendum của brief trên. |
| `architecture/architecture-ecosystem-manus-killer-2026-08-20/ARCHITECTURE-SPINE.md` | Architecture spine cho ecosystem chainlens + nowing. |
| `scratch/*` | Triage/review artifacts từ subagent (liên quan XActions metadata schema, shopee schema, v.v.). |
| `test-artifacts/atdd-checklist-34-D3*.md` | ATDD checklists cho billing system (nhiều khả năng thuộc dự án nowing/chainlens, đã commit theo yêu cầu). |

## Source Code (Newly Tracked)

| Path | Ghi chú |
|---|---|
| `apps/api/src/billing/` | Billing code + tests (credit balance, credit admission guard). |
| `apps/api/src/search/providers/dev/` | Search provider dev code + tests. |
| `apps/web/public/chainlens-logo*.svg` | Chainlens brand assets. |
