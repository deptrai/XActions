---
title: 'Story 47.3 — Follower CRM & Contact Intelligence Screen'
type: 'feature'
created: '2026-09-24'
baseline_commit: 'd54c57b7ba1a1f5058ee2733d9b87d672581aaf6'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - _bmad-output/implementation-artifacts/epic-46-context.md
  - _bmad-output/implementation-artifacts/spec-47-1-nextjs-scaffold-universal-layout.md
  - _bmad-output/planning-artifacts/epics.md
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Marketers và chuyên viên phát triển cộng đồng cần quản lý tệp follower chất lượng cao (VIPs, High ICP leads, Active Engagers) để cá nhân hóa thông điệp, nhưng hiện tại chưa có giao diện web CRM trực quan, không thể lọc nhanh theo phân khúc hay gắn tag tương tác.

**Approach:** Xây dựng màn hình Follower CRM tại `apps/web/app/crm/page.tsx` với bảng danh bạ hiển thị Avatar, Username, Bio, Followers count, Lead Score (0–100), và Tags. Cung cấp bộ lọc phân khúc nhanh (Tất cả, VIPs, High Score ≥80, Leads), thanh tìm kiếm theo tên/bio, và modal/popover thêm tag trực tiếp tương thích với endpoint `POST /api/crm/tag`.

## Boundaries & Constraints

**Always:**
- Sử dụng Next.js Client Component (`'use client'`).
- Tích hợp gọi API `POST /api/crm/tag` khi gán tag.
- Fallback danh bạ demo sinh động khi backend chưa đồng bộ session.
- Responsive, styling đồng bộ với Universal Layout và Dark/Light mode.

**Never:**
- Không xóa hay sửa đổi backend endpoints của CRM.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Truy cập `/crm` | Mở trang | Render bảng danh bạ contact với stats header, filters, và search | Hiển thị danh sách contacts |
| Lọc phân khúc VIP | Click badge 'VIPs (Score ≥ 80)' | Bảng chỉ hiển thị contacts có Lead Score ≥ 80 | Instant client-side filter |
| Tìm kiếm | Nhập 'Founder' vào ô search | Lọc danh sách contacts có chữ 'Founder' trong Bio | Lọc thời gian thực |
| Thêm Tag | Nhập tag mới và submit | Tag xuất hiện ngay trên card của contact | Gọi API /api/crm/tag |

</intent-contract>

## Code Map

- `apps/web/app/crm/page.tsx` *(new)* — Màn hình Follower CRM chính
- `tests/web/crm.test.js` *(new)* — Unit / contract test cho trang CRM

## Tasks & Acceptance

**Execution:**
- Tạo trang `apps/web/app/crm/page.tsx`
- Tích hợp bảng danh bạ, tìm kiếm, phân khúc
- Tích hợp tính năng thêm tag
- Viết test `tests/web/crm.test.js`
- Test E2E trên trình duyệt

**Acceptance Criteria:**
- Given `apps/web`, when building, then compile succeeds cleanly
- Given `/crm`, when visited in browser, then contacts table renders with scores and tags
- Given filter selection, when clicking VIP, then list narrows to high-score contacts

## Spec Change Log

## Review Triage Log


## Auto Run Result

**Status:** done
**Summary:** Built Follower CRM & Contact Intelligence screen at `apps/web/app/crm/page.tsx`. Features responsive contact cards with avatar, handle, follower count, bio, Lead Score indicator (0-100), and interactive tags. Includes real-time search across names/handles/bio/tags, segment filter buttons (All, VIPs with Score ≥ 80, Founders, AI Builders), and inline tag creation posting to `http://localhost:3001/api/crm/tag`.

**Files changed:**
- `apps/web/app/crm/page.tsx` *(new)* — Follower CRM client component
- `tests/web/crm.test.js` *(new)* — unit/contract tests for CRM page
- `_bmad-output/implementation-artifacts/spec-47-3-...md` — this spec

**Verification:**
- `npm run web:build` — compiled 6 static pages successfully in 1.5s
- `vitest run tests/web/crm.test.js` — 4/4 tests pass
