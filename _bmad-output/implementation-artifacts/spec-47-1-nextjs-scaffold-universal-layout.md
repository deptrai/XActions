---
title: 'Story 47.1 — Next.js 15 App Router Scaffold & Universal Layout'
type: 'feature'
created: '2026-09-24'
baseline_commit: '515080055c1c29ab33db5d1408f814ce3a0cf100'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - _bmad-output/implementation-artifacts/epic-46-context.md
  - _bmad-output/planning-artifacts/epics.md
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** XActions hiện tại đang dùng 51 file HTML rời rạc trong `dashboard/` (Vanilla JS, script tags, CSS lặp lại). Không có routing hiện đại, không có component reusability, không có dark/light mode nhất quán, và không thể tận dụng TypeScript API client `@xactions/api-client` đã ship ở Epic 46.

**Approach:** Khởi tạo ứng dụng web hiện đại tại `apps/web/` sử dụng Next.js 15 (App Router), TypeScript, Tailwind CSS, Lucide Icons. Xây dựng Universal Layout hoàn chỉnh gồm: Collapsible Sidebar điều hướng thông minh (liên kết đến Dashboard, Viral Miner, CRM, Optimizer, Data Explorer, API Docs), Top Header với Dark/Light Mode toggle, và Backend Connection Health Badge (tự động ping `http://localhost:3001/api/health` để báo trạng thái online/offline).

## Boundaries & Constraints

**Always:**
- Sử dụng Next.js App Router (`apps/web/app/`).
- TypeScript strict mode.
- Tailwind CSS cho styling hiện đại, responsive.
- Hỗ trợ Dark Mode và Light Mode chuyển đổi mượt mà.
- Hiển thị badge kết nối backend (Live: xanh lá khi `http://localhost:3001/api/health` 200, Offline: xám/đỏ khi mất kết nối).
- Tích hợp dependency `@xactions/api-client` (file-dep: `file:../../packages/api-client`).
- Thêm root npm scripts: `"web:dev": "npm --prefix apps/web run dev"` và `"web:build": "npm --prefix apps/web run build"`.

**Never:**
- Không xóa hay sửa đổi các file trong `dashboard/` (để backwards-compatible cho dashboard tĩnh hiện tại).
- Không phá vỡ backend Express đang chạy.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Truy cập trang chủ `/` | Mở browser tại `http://localhost:3000` | Render Universal Layout với Sidebar, Header, và Overview Stats | Fallback hiển thị giao diện mặc định |
| Backend Online | `http://localhost:3001/api/health` trả 200 | Badge Header hiển thị "Backend Connected" (chấm xanh lá) | Tự động ping định kỳ |
| Backend Offline | Server 3001 tắt | Badge Header hiển thị "Backend Offline" (chấm đỏ) | Không crash UI, hiển thị warning |
| Toggle Theme | Người dùng click nút Dark/Light mode | Giao diện chuyển đổi giữa nền tối và sáng ngay lập tức | Lưu preference vào localStorage |
| Responsive Sidebar | Màn hình nhỏ / click Toggle Sidebar | Sidebar thu gọn thành icon navigation | Mượt mà với CSS transition |

</intent-contract>

## Code Map

- `apps/web/package.json` *(new)* — Dependencies: `next@^15`, `react@^19`, `react-dom@^19`, `lucide-react`, `clsx`, `tailwind-merge`, `@xactions/api-client`
- `apps/web/tsconfig.json` *(new)* — Next.js TypeScript config
- `apps/web/tailwind.config.js` *(new)* — Tailwind styling configuration
- `apps/web/postcss.config.mjs` *(new)* — PostCSS configuration
- `apps/web/app/layout.tsx` *(new)* — Universal Root Layout with ThemeProvider & Sidebar
- `apps/web/app/page.tsx` *(new)* — Main Dashboard Landing overview
- `apps/web/app/globals.css` *(new)* — Tailwind base styles and CSS variables
- `apps/web/components/sidebar.tsx` *(new)* — Collapsible Sidebar component
- `apps/web/components/header.tsx` *(new)* — Top bar with theme toggle & Backend Health badge
- `apps/web/components/backend-status.tsx` *(new)* — Realtime health checker component
- `package.json` — Add `"web:dev"` and `"web:build"` convenience scripts

## Tasks & Acceptance

**Execution:**
- Khởi tạo cấu trúc dự án Next.js 15 tại `apps/web/`
- Viết các component Layout: Sidebar, Header, BackendStatus
- Tạo trang Dashboard overview tổng quan
- Cấu hình Tailwind CSS và Theme Provider
- Tích hợp scripts vào `package.json`
- Chạy `web:build` và xác nhận build thành công không lỗi type

**Acceptance Criteria:**
- Given `apps/web`, when building via `npm run build`, then compilation succeeds with 0 type errors
- Given running app, when visiting `http://localhost:3000`, then Universal Layout renders with Sidebar, Header and Health badge
- Given backend running on port 3001, when loaded, then health badge shows connected
- Given theme toggle button, when clicked, then dark/light mode switches dynamically

## Spec Change Log

## Review Triage Log


## Auto Run Result

**Status:** done
**Summary:** Scaffolded modern Next.js 15 App Router web application under `apps/web/` with TypeScript, Tailwind CSS, and Lucide Icons. Built Universal Layout including Collapsible Sidebar with navigation across all XActions modules (Viral Miner, Follower CRM, Optimizer, Explorer, API Docs), Top Header with Dark/Light Mode switcher (persisting to localStorage), and Backend Connection Status badge (realtime health polling against `http://localhost:3001/api/health`). Built Dashboard Overview screen. Integrated `@xactions/api-client` as workspace file dependency. Production build succeeds cleanly in 2.4s.

**Files changed:**
- `apps/web/package.json` *(new)* — Next.js 15, React 19, Lucide, Tailwind, @xactions/api-client
- `apps/web/tsconfig.json` *(new)* — Next.js TypeScript config
- `apps/web/tailwind.config.js` *(new)* — Tailwind dark-mode configuration
- `apps/web/postcss.config.mjs` *(new)* — PostCSS configuration
- `apps/web/next.config.js` *(new)* — Next.js ESM config
- `apps/web/app/globals.css` *(new)* — Base variables and themes
- `apps/web/app/layout.tsx` *(new)* — Universal layout with Sidebar and Header
- `apps/web/app/page.tsx` *(new)* — Landing Overview screen
- `apps/web/components/sidebar.tsx` *(new)* — Collapsible sidebar navigation
- `apps/web/components/header.tsx` *(new)* — Header with theme toggle & health status
- `apps/web/components/backend-status.tsx` *(new)* — Realtime health badge component
- `package.json` — added `web:dev`, `web:build`, `web:start` scripts
- `tests/web/layout.test.js` *(new)* — unit/contract assertions for web layout
- `_bmad-output/implementation-artifacts/spec-47-1-...md` — this spec

**Verification:**
- `npm run web:build` — compiled successfully in 2.4s, 0 errors
- `vitest run tests/web/layout.test.js` — 4/4 tests pass
