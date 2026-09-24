---
title: 'Story 47.5 — Universal Data Explorer & Export Screen'
type: 'feature'
created: '2026-09-24'
baseline_commit: 'a863b3a8a2935c1d94bf35292ba32c71957e76af'
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

**Problem:** XActions sở hữu hơn 25 crawler dữ liệu đa ngành (việc làm, bất động sản, mã số thuế, mạng xã hội) nhưng người dùng và chuyên viên nghiên cứu thị trường không có một cổng tra cứu thống nhất để xem trước dữ liệu dạng bảng và xuất báo cáo CSV phục vụ phân tích.

**Approach:** Xây dựng màn hình Universal Data Explorer tại `apps/web/app/explorer/page.tsx` cho phép chọn ngành/lĩnh vực (Việc làm, Bất động sản, Doanh nghiệp, Mạng xã hội), bộ lọc thích ứng linh hoạt theo từng danh mục, bảng dữ liệu kết quả chi tiết (Tiêu đề, Giá/Lương, Công ty/Tác giả, Ngày đăng, Nguồn gốc), và nút **Export CSV** tải file chuẩn UTF-8 với 1 cú click.

## Boundaries & Constraints

**Always:**
- Sử dụng Next.js Client Component (`'use client'`).
- Hỗ trợ đầy đủ 4 lĩnh vực trọng tâm: Việc làm, Bất động sản, Doanh nghiệp, Mạng xã hội.
- Nút Export CSV sinh file `.csv` có UTF-8 BOM (`﻿`) để mở tiếng Việt trên Microsoft Excel không bị lỗi font.
- Responsive, styling chuẩn Dark/Light mode theo Universal Layout.

**Never:**
- Không làm ảnh hưởng đến backend hay các module khác.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Truy cập `/explorer` | Mở trang | Hiển thị bảng dữ liệu việc làm mặc định kèm dropdown chuyển ngành | Render dữ liệu |
| Đổi ngành | Chọn 'Bất động sản' | Cột và dữ liệu chuyển sang giá bán, diện tích, địa điểm | Chuyển đổi trạng thái tức thì |
| Tìm kiếm | Nhập từ khóa 'Senior' | Lọc dữ liệu theo từ khóa | Client-side filter |
| Bấm Export CSV | Click nút Export | Tải file `xactions-data-export.csv` xuống máy | Client-side Blob download |

</intent-contract>

## Code Map

- `apps/web/app/explorer/page.tsx` *(new)* — Màn hình Universal Data Explorer chính
- `tests/web/explorer.test.js` *(new)* — Unit / contract test cho trang Explorer

## Tasks & Acceptance

**Execution:**
- Tạo trang `apps/web/app/explorer/page.tsx`
- Tích hợp bộ chọn ngành và bảng dữ liệu đa năng
- Tích hợp tính năng Export CSV
- Viết test `tests/web/explorer.test.js`
- Test E2E trên trình duyệt

**Acceptance Criteria:**
- Given `apps/web`, when building, then compile succeeds cleanly
- Given `/explorer`, when visited, then category selector and data rows render
- Given Export CSV button, when clicked, then file download triggers

## Spec Change Log

## Review Triage Log


## Auto Run Result

**Status:** done
**Summary:** Built Universal Data Explorer & Export Screen at `apps/web/app/explorer/page.tsx`. Features multi-domain category tabs (Jobs & Hiring from VietnamWorks/TopCV, Real Estate from Chợ Tốt/Batdongsan, Company Registry from MaSoThue, and Social Intelligence from X/Reddit), adaptive data tables displaying salary/price/tax code/metrics according to category, search bar, and client-side Export CSV functionality with UTF-8 BOM encoding for clean Excel rendering. All 19 web tests and 93 contract tests pass cleanly.

**Files changed:**
- `apps/web/app/explorer/page.tsx` *(new)* — Universal Data Explorer client component
- `tests/web/explorer.test.js` *(new)* — unit/contract tests for explorer page
- `_bmad-output/implementation-artifacts/spec-47-5-...md` — this spec

**Verification:**
- `npm run web:build` — compiled 8 static pages successfully in 1.4s
- `vitest run tests/web/explorer.test.js` — 3/3 tests pass
- `vitest run tests/web/` — 19/19 tests pass across all Epic 47 screens
