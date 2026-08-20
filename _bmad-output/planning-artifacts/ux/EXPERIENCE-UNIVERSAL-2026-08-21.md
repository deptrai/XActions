---
date: 2026-08-21
status: canonical
---

# XActions Universal Experience — Operator, AI Agent & Multi-Platform Flows

Tài liệu này bổ sung `EXPERIENCE.md` (2026-06-19) — tập trung vào hybrid engine, admin dashboard, MCP/CLI flows, CDP attach, Redis stream metrics, metadata schema, và AI agent discovery. Các flow dưới đây được xây dựng từ `ARCHITECTURE-UX-REMEDIATION-2026-08-21.md`.

## 1. Personas

### 1.1 Operator — Quản lý hệ thống cào
- **Mục tiêu:** Biết hệ thống có khỏe không, tài khoản nào đang hibernation, proxy nào chết, checkpoint nào bị kẹt.
- **Surfaces:** Admin dashboard (`/admin`), CLI `xactions admin ...`, MCP tools `x_admin_*`.
- **Ngôn ngữ:** Tiếng Việt hoặc English, concise, actionable.

### 1.2 AI Agent — Tự động hóa qua MCP
- **Mục tiêu:** Khám phá action nào khả dụng, gọi tool, xử lý lỗi retryable, nhận kết quả structured.
- **Surfaces:** MCP HTTP/SSE (Port 3001), JSON envelope 3 lớp.
- **Ngôn ngữ:** Machine-readable schema + human-readable `message` và `suggestedAction`.

### 1.3 Data Scientist / AI Engineer — Trích xuất dữ liệu
- **Mục tiêu:** Export dataset theo filter, biết metadata schema trước khi query.
- **Surfaces:** CLI `xactions export`, API `POST /export`, MCP `x_dataset_export`.

### 1.4 Developer / Integrator — Tích hợp platform mới
- **Mục tiêu:** Hiểu `AbstractCrawler`, đăng ký metadata schema, kiểm tra stream metrics.
- **Surfaces:** API `/schemas`, `/metrics`, MCP `x_schema_get`.

## 2. Cross-Cutting Principles

- **P1 — Error phải có hành động tiếp theo:** Mọi lỗi trả về cho AI/operator phải có `suggestedAction` (`wait_60s_or_rotate_proxy`, `resume_checkpoint_123`, `check_proxy_health`, v.v.).
- **P2 — Status real-time hoặc near real-time:** Dashboard SSE/polling cập nhật mỗi 5s cho governor, checkpoints, streams.
- **P3 — Khám phá action không cần đọc tài liệu:** `xactions actions --platform <p>` và MCP `x_actions_list` hiển thị đầy đủ action/description/args/example.
- **P4 — Non-TTY fallback cho CLI:** Bất kỳ flow nào cần terminal QR hoặc interactive phải có non-TTY option (`--output-url`, `--webhook`, `--short-code`).
- **P5 — Accessibility floor kế thừa từ `EXPERIENCE.md`:** keyboard navigation, ARIA labels, color+icon, focus, aria-live.

## 3. Operator Dashboard Views

### 3.1 Jobs & Checkpoints View (`/admin/jobs`)
- **Bảng chính:** `platform`, `target`, `status` (running/paused/failed/completed/stalled), `lastCrawledAt`, `lastCursor`, `errorCount`.
- **Actions:** Resume, Pause, Retry, Cancel.
- **Filter:** theo platform, status, date range.
- **Real-time:** SSE cập nhật `status` và `lastCrawledAt`.
- **Empty state:** "Chưa có checkpoint nào. Bắt đầu bằng `xactions start <platform> <target>`."

### 3.2 Proxies & Accounts View (`/admin/proxies`)
- **Bảng proxy:** `ip`, `type` (static/dynamic/tunnel), `healthy`, `quarantineEndsAt`, `lastUsedAt`, `failCount`.
- **Bảng account:** `platform`, `accountId`, `status` (active/hibernation/challenge/dead), `hibernationEndsAt`, `lastActionAt`.
- **Alerts:** Banner khi `healthyProxyRatio < 0.3` hoặc `hibernatingAccounts.length > 5`.
- **Action:** Add proxy, rotate proxy, mark account dead.

### 3.3 Stream Metrics View (`/admin/streams`)
- **Cards:** `eventsPerSecond`, `pendingMessages`, `droppedEvents`, `lastAckTime`, `consumerLag`.
- **Charts:** line chart 5 phút cho `eventsPerSecond` và `pendingMessages`.
- **Alerts:** Alert khi `pendingMessages > 50,000` hoặc `lastAckTime > 60s`.
- **Action:** Pause/resume stream consumer.

### 3.4 Schema Registry View (`/admin/schemas`)
- **Tree:** `platform → category → JSON Schema`.
- **Preview:** Sample `Post.metadata` với schema validation.
- **Action:** Download schema, view MCP tool example.

### 3.5 Governor Status View (`/admin/governor`)
- **Cards:** `healthyProxyCount`, `totalProxyCount`, `healthyProxyRatio`, `currentReqPerSecond`, `throttleLevel`.
- **Bảng account:** `platform`, `accountId`, `status`, `hibernationEndsAt`, `suggestedAction`.
- **Action:** Force wake account, reduce throttle.

## 4. CLI Flows

### 4.1 `xactions status`

```
$ xactions status
Proxy pool: 12/15 healthy (80%)
Governor throttle: normal
Hibernating accounts: 0
Stream lag: 1,230 messages
Last checkpoint: shopee:search:laptop — running (2m ago)
```

### 4.2 `xactions login --qr`

TTY:
```
$ xactions login --qr facebook
Scan QR in 60s:
[QR code]
Login success for account fb_123
```

Non-TTY fallback:
```
$ xactions login --qr facebook --non-tty
Open URL: https://m.facebook.com/login/save-password?...&code=ABC123
Short code: ABC123
```

### 4.3 `xactions actions --platform <platform>`

```
$ xactions actions --platform shopee
ACTION                 DESCRIPTION
crawl.search           Tìm sản phẩm theo từ khóa
crawl.product          Lấy chi tiết sản phẩm
export.dataset         Xuất dataset theo filter
```

### 4.4 `xactions daemon start/stop/status`

```
$ xactions daemon status
MCP daemon: running on port 3001 (HTTP + SSE)
Connected clients: 3
Uptime: 2h 14m
```

## 5. MCP Flows

### 5.1 Tool Discovery

**Request:**
```json
{ "jsonrpc": "2.0", "method": "tools/list", "id": 1 }
```

**Response snippet:**
```json
{
  "tools": [
    {
      "name": "x_actions_list",
      "description": "List available actions for a platform",
      "inputSchema": { "platform": { "type": "string", "enum": ["shopee", "tiktok", ...] } }
    }
  ]
}
```

### 5.2 Error Envelope

Mọi tool error trả:
```json
{
  "isError": true,
  "content": [{
    "type": "text",
    "text": "Rate limit hit",
    "code": "rate_limit",
    "retryAfterMs": 60000,
    "suggestedAction": "wait_60s_or_rotate_proxy"
  }]
}
```

### 5.3 Streaming

AI agent subscribe SSE:
```
GET /sse
Event: x_crawl_event
Payload: { platform, externalId, eventType, timestamp, metadata }
```

## 6. CDP Remote Attach Flow

### 6.1 QR + CDP Option
- **Step 1:** User chạy `xactions login --cdp`.
- **Step 2:** Hệ thống in QR trên terminal hoặc URL nếu non-TTY.
- **Step 3:** User quét QR trên điện thoại.
- **Step 4:** Hệ thống mở local Chrome với `--remote-debugging-port=9222`.
- **Step 5:** `CdpLogin` attach đến browser, pass cookies từ mobile session.
- **Step 6:** Xác nhận `loginState` thành công.

### 6.2 Non-TTY / Server
- User chạy `xactions login --cdp --headful --display` trên server có X11.
- Hoặc `--cdp-url ws://<remote>:9222` để attach đến remote Chrome.

## 7. Multi-Platform New-User Flow

### 7.1 First Run
```
$ xactions start shopee.search --keyword "laptop" --output posts.jsonl
1. Load proxy pool (12 proxies)
2. Initialize signer pool
3. Search Shopee via HTTP + signer
4. Save to PostgreSQL + JSONL
5. Done: 247 posts
```

### 7.2 Adding a New Platform
1. Developer tạo `src/scrapers/<platform>/index.js` extends `AbstractCrawler`.
2. Đăng ký metadata schema `schemas/<platform>/<category>.json`.
3. Chạy `xactions schema validate <platform> <category>`.
4. `xactions actions --platform <platform>` hiển thị action mới.

## 8. Accessibility & Responsive

- Kế thừa `EXPERIENCE.md` accessibility floor.
- Dashboard responsive ≥1280px; mobile view read-only với collapsible cards.
- CLI output hỗ trợ `--json` để pipable.

## 9. Open UX Questions

1. Admin dashboard có cần dark mode? (kế thừa từ `DESIGN.md`)
2. Alert channel: in-app, email, Slack webhook, hoặc cả ba?
3. Có cần i18n cho dashboard (Vietnamese default + English)?
