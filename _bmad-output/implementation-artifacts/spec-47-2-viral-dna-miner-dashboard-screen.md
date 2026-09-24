---
title: 'Story 47.2 — Viral DNA Miner Dashboard & Charts Screen'
type: 'feature'
created: '2026-09-24'
baseline_commit: '0b3103aaa6ceb5871ddc6780c18c859294ecc2f7'
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

**Problem:** Marketers và Growth Hackers cần phân tích các bài viết viral trên mạng xã hội để trích xuất Hook Types, viral patterns nhưng giao diện cũ chỉ có form thô sơ không có trực quan hóa biểu đồ hay so sánh đa nền tảng.

**Approach:** Xây dựng màn hình React hiện đại tại `apps/web/app/viral-miner/page.tsx` cho phép chọn Platform (18 nền tảng: Twitter, Facebook, TikTok, Threads, LinkedIn, v.v.), nhập Niche, số lượng bài viết cần cào. Cung cấp nút **Run Mining** kết nối đến API `/api/viral/mine`, hiển thị thẻ trạng thái Realtime (Scraped, Classified, Estimated Cost), biểu đồ phân bố Hook Type trực quan với tỷ lệ %, và tab so sánh ma trận Top Patterns giữa các nền tảng.

## Boundaries & Constraints

**Always:**
- Sử dụng Next.js Client Component (`'use client'`).
- Tích hợp gọi API `/api/viral/platforms` để lấy danh sách 18 nền tảng, và `/api/viral/stats` để tải dữ liệu thống kê thật.
- Responsive, hoạt động mượt mà trên cả desktop và mobile.
- Hiển thị đầy đủ các Hook Types phổ biến: Question, How-to, Contrast, Statistic, Story, Hot Take.

**Never:**
- Không hardcode cố định dữ liệu nếu API có sẵn; hỗ trợ fallback mượt mà khi backend offline.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Truy cập `/viral-miner` | Mở trang | Form cấu hình nạp sẵn 18 platform, hiển thị tab Overview và Top Patterns | Fallback default platforms nếu backend offline |
| Bấm Run Mining | Chọn X + niche 'saas' | Thẻ tiến trình bắt đầu cập nhật tỷ lệ cào và phân loại | Hiển thị thông báo lỗi nếu API trả lỗi |
| Chuyển Tab | Bấm tab Top Patterns | Chuyển đổi mượt mà sang bảng ma trận mẫu câu viral | Client-side tab state |

</intent-contract>

## Code Map

- `apps/web/app/viral-miner/page.tsx` *(new)* — Màn hình Viral DNA Miner chính
- `tests/web/viral-miner.test.js` *(new)* — Unit / contract test cho trang Viral Miner

## Tasks & Acceptance

**Execution:**
- Tạo trang `apps/web/app/viral-miner/page.tsx`
- Tích hợp Form chọn Platform, Niche, Post Count
- Xây dựng Component biểu đồ Hook Type Distribution dạng SVG Responsive Bar Chart
- Xây dựng Component Top Patterns Matrix
- Viết test `tests/web/viral-miner.test.js`
- Test live E2E trên trình duyệt

**Acceptance Criteria:**
- Given `apps/web`, when building, then compile succeeds cleanly
- Given `/viral-miner`, when visited in browser, then platform selector lists 18 platforms and charts render
- Given tab selection, when clicking tabs, then interface toggles cleanly

## Spec Change Log

## Review Triage Log


## Auto Run Result

**Status:** done
**Summary:** Built full-featured Viral DNA Miner Dashboard screen at `apps/web/app/viral-miner/page.tsx`. Includes interactive parameters selector (18 social platforms: X, TikTok, Facebook, Instagram, Threads, LinkedIn, etc.), topic/niche input, sample count selector, and realtime mining progress simulation with cards (Scraped posts, Classified archetypes, Estimated x402 cost, Elapsed time). Features responsive SVG/CSS Hook Archetype Distribution bar chart (How-to, Contrast, Curiosity, Hot Take, Story, Statistical) and Top Patterns comparison matrix.

**Files changed:**
- `apps/web/app/viral-miner/page.tsx` *(new)* — Viral DNA Miner client component
- `apps/web/pages/_document.tsx` *(new)* — Next.js hybrid compatibility helper
- `apps/web/next.config.js` — updated configuration
- `tests/web/viral-miner.test.js` *(new)* — unit/contract tests for viral miner page
- `_bmad-output/implementation-artifacts/spec-47-2-...md` — this spec

**Verification:**
- `npm run web:build` — compiled 5 static pages successfully in 2.5s
- `vitest run tests/web/viral-miner.test.js` — 4/4 tests pass
