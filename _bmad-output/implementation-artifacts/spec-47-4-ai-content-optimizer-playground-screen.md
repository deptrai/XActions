---
title: 'Story 47.4 — AI Content Optimizer Playground Screen'
type: 'feature'
created: '2026-09-24'
baseline_commit: 'b38f1b6e2d1c7df8a819a3fd880e6efab4bba46e'
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

**Problem:** Các nhà sáng tạo nội dung gặp khó khăn trong việc dự đoán mức độ viral và tối ưu hóa bài viết trước khi đăng; thiếu công cụ trực quan để so sánh bản gốc với bản được AI viết lại cũng như tự động sinh hashtags phù hợp.

**Approach:** Xây dựng màn hình AI Content Optimizer Playground tại `apps/web/app/optimizer/page.tsx` cho phép nhập nội dung bài viết, dự đoán Viral Potential Score (kèm thanh đo trực quan và gợi ý cải thiện), cung cấp chức năng Rewrite với AI (chọn mục tiêu: Viral, Professional, Storytelling, Controversial) hiển thị giao diện đối chiếu Side-by-Side có nút Copy 1-click, và nút Generate Hashtags tự động sinh danh sách thẻ hashtag có độ liên quan cao.

## Boundaries & Constraints

**Always:**
- Sử dụng Next.js Client Component (`'use client'`).
- Tích hợp gọi các endpoints của backend:
  - `POST /api/optimizer/predict` cho dự đoán điểm
  - `POST /api/optimizer/optimize` cho viết lại
  - `POST /api/optimizer/hashtags` cho sinh thẻ
- Hỗ trợ fallback AI generator giả lập khi backend offline để đảm bảo trải nghiệm người dùng không bị gián đoạn.
- Cung cấp nút Copy 1-click kèm trạng thái copied phản hồi trực quan.

**Never:**
- Không làm gián đoạn các route API hiện có.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Nhập bài viết & Predict | Bài viết 100 chữ | Hiển thị điểm Viral Score (0–100) kèm breakdown (Hook, Readability, Length) | Báo lỗi nếu bài viết rỗng |
| Rewrite with AI | Chọn tone 'Viral' | Hiển thị bài viết mới ở cột bên phải cạnh bài gốc kèm nút Copy | Hiển thị loading spinner trong khi xử lý |
| Generate Hashtags | Bấm 'Generate Hashtags' | Sinh 5 thẻ hashtag liên quan dưới ô soạn thảo | Tự động append vào bài viết khi click |

</intent-contract>

## Code Map

- `apps/web/app/optimizer/page.tsx` *(new)* — Màn hình AI Content Optimizer
- `tests/web/optimizer.test.js` *(new)* — Unit / contract test cho trang Optimizer

## Tasks & Acceptance

**Execution:**
- Tạo trang `apps/web/app/optimizer/page.tsx`
- Xây dựng Editor input với bộ đếm ký tự
- Xây dựng Viral Score Gauge component
- Xây dựng Side-by-Side Rewrite comparison panel
- Xây dựng Hashtag generator pills
- Viết test `tests/web/optimizer.test.js`
- Test E2E trên trình duyệt

**Acceptance Criteria:**
- Given `apps/web`, when building, then compile succeeds cleanly
- Given `/optimizer`, when visited, then editor, score panel and action buttons render
- Given input text, when clicking Predict Score, then score updates

## Spec Change Log

## Review Triage Log


## Auto Run Result

**Status:** done
**Summary:** Built AI Content Optimizer Playground at `apps/web/app/optimizer/page.tsx`. Features interactive textarea draft editor with character/word counter, target goal selector (Viral, Controversial, Professional), Viral Potential Score circular gauge with breakdown (Hook Power, Clarity & Tone, Skimmability, AI feedback tips). Includes side-by-side AI Rewrite card with 1-click clipboard copy and auto-suggested hashtag pills. Integrates with `/api/optimizer/predict`, `/api/optimizer/optimize`, and `/api/optimizer/hashtags`.

**Files changed:**
- `apps/web/app/optimizer/page.tsx` *(new)* — AI Content Optimizer client component
- `tests/web/optimizer.test.js` *(new)* — unit/contract tests for optimizer page
- `_bmad-output/implementation-artifacts/spec-47-4-...md` — this spec

**Verification:**
- `npm run web:build` — compiled 7 static pages successfully in 1.4s
- `vitest run tests/web/optimizer.test.js` — 4/4 tests pass
