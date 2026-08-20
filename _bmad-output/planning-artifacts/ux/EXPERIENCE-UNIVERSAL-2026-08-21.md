---
status: draft
updated: 2026-08-21
sources:
  - ARCHITECTURE-UX-REVIEW-2026-08-18.md
  - architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-UX-REMEDIATION-2026-08-21.md
---

# EXPERIENCE-UNIVERSAL-2026-08-21.md — Universal Operator, AI & Multi-Platform Flows

Tài liệu này bổ sung `EXPERIENCE.md` để cover các persona và flows mới trong Epics 10–20: **Platform Operator**, **AI Agent / MCP Consumer**, **Nowing Integrator**, và **Data Scientist**.

---

## Personas

1. **Platform Operator (Ops)** — giám sát proxy, account, checkpoints, stream metrics qua dashboard/CLI.
2. **AI Agent (Claude / Cursor / Antigravity)** — gọi MCP tools để kích hoạt crawl, lấy schema, kiểm tra status.
3. **Nowing Integrator** — nhận thin events từ Redis Stream, query schema, đối soát dữ liệu.
4. **Data Scientist** — xuất dataset JSONL/CSV, resume/pause checkpoints.
5. **CLI Power User** — chạy `xactions login --qr`, `xactions status`, `xactions admin`.

---

## Operator Dashboard Flows

### Flow O1: Operator phát hiện proxy pool cạn

1. Operator mở dashboard `/admin/proxies`.
2. Status card hiển thị `7/15 healthy` màu `warning`.
3. Alert banner: "Proxy pool below healthy floor. Suggested action: Add proxies or pause bulk jobs."
4. Operator clicks "Pause bulk jobs" → API gọi governor throttle.
5. Table cập nhật `throttleLevel` trong 5s.

### Flow O2: Operator resume checkpoint bị lỗi

1. Operator mở `/admin/checkpoints`.
2. Data table hiển thị checkpoint `shopee:search:iphone15` status `failed`.
3. Operator clicks "Retry" inline.
4. API `POST /checkpoints/:id/retry`.
5. Row chuyển `running`, progress bar xuất hiện.

---

## AI Agent / MCP Flows

### Flow A1: AI agent khám phá action

1. Agent gọi MCP `x_actions_list`.
2. Hệ thống trả `{ platform, actions: [{ action, description, requiredArgs, example }] }`.
3. Agent gọi `x_crawl --platform shopee --action search_products --query "iphone 15"`.
4. Response 3-Layer JSON Envelope: `result`, `metadata`, `artifactRef`.

### Flow A2: AI agent nhận lỗi có actionable

1. Agent gọi crawl bị rate-limit.
2. Response error envelope: `{ code: 429, type: 'rate_limit', message: '...', retryAfter: 60000, suggestedAction: 'wait_60s_or_rotate_proxy' }`.
3. Agent tự động wait 60s hoặc gọi `x_rotate_proxy`.

---

## CLI Flows

### Flow C1: Terminal QR Login (TTY)

1. User chạy `xactions login --qr --platform facebook`.
2. Terminal hiển thị ASCII QR + countdown 60s.
3. User quét bằng điện thoại.
4. System polls cookie, hiển thị `✅ Account active`.

### Flow C2: Non-TTY QR Login

1. User chạy trên server / CI: `xactions login --qr`.
2. Non-TTY detected → in URL + short code.
3. User mở URL trên điện thoại hoặc app.
4. Webhook/push confirm → CLI tiếp tục.

### Flow C3: Operator CLI Status

1. User chạy `xactions status`.
2. CLI output blocks hiển thị:
   - Proxy pool: `12/15 healthy`
   - Governor throttle: `level 2`
   - Redis lag: `1,240 messages`
   - Hibernating accounts: `[fb:123 18m left]`

### Flow C4: Admin CLI Checkpoints

1. User chạy `xactions checkpoints list --platform shopee`.
2. Plain text table hoặc `--json` để pipe.
3. User chạy `xactions checkpoints retry --id <id>`.

---

## CDP Remote Attach Flow

### Flow R1: LinkedIn scrape qua CDP

1. User chạy `xactions auth --launch-chrome`.
2. Chrome mở với `--remote-debugging-port=9222`.
3. User đăng nhập LinkedIn thủ công.
4. Agent gọi `x_crawl --platform linkedin --action search_jobs --query "AI Engineer"`.
5. Hệ thống kết nối CDP, thêm Gaussian jitter 3–7s, chạy headless page.

---

## Multi-Platform New-User Flow

### Flow N1: First crawl across 3 platforms

1. New user opens `/platforms`.
2. Sidebar lists: X/Twitter, Facebook, Threads, TikTok, Shopee, Batdongsan, TopCV.
3. User selects `Shopee` → Account selector (no auth required).
4. User enters query `iphone 15` → Dry-run preview.
5. User unchecks dry-run → `Run Live`.
6. Result panel: 50 products with price, image, link.
7. User exports to CSV / JSONL.

---

## Component Mapping

| Component | Flows sử dụng | File tham chiếu |
|---|---|---|
| Admin Status Card | O1, O2, C3 | `DESIGN.md` New Components |
| Alert Banner | O1, A2 | `DESIGN.md` New Components |
| Data Table | O2, C4 | `DESIGN.md` New Components |
| Schema Viewer | A1, N1 | `DESIGN.md` New Components |
| Stream Metrics Chart | O1, C3 | `DESIGN.md` New Components |
| CLI Output Blocks | C3, C4 | `DESIGN.md` New Components |

---

*Draft by Sally / UX Designer, 2026-08-21.*
