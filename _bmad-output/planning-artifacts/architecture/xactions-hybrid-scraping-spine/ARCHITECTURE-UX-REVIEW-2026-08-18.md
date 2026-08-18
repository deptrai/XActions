# UX Review — XActions Universal Hybrid Scraping Architecture (r3)

**Persona:** Sally / UX Designer  
**Target:** `ARCHITECTURE-SPINE.md` (r3)  
**Date:** 2026-08-18  
**Method:** User & operator journey lens + operational observability lens + AI-agent consumption lens.

---

## Verdict

🟡 **Spine kỹ thuật ổn định, nhưng thiếu góc nhìn trải nghiệm người dùng và vận hành.** Không có vấn đề nào block kiến trúc, nhưng 6 UX gap cần được giải quyết trong Epic/Story cụ thể trước khi release. Các gap chủ yếu nằm ở: khả năng quan sát trạng thái (observability), khám phá lệnh (discoverability), và thông điệp lỗi khi hệ thống tự điều tiết.

---

## UX Findings

### F1 — MCP HTTP/SSE daemon thiếu hướng dẫn vận hành cho người dùng
* **AD liên quan:** AD-7
* **Vấn đề:** Spine quy định `MCP_TRANSPORT=http` và port 3001, nhưng không nói rõ:
  - Người dùng khởi động daemon bằng lệnh nào? (`npm run mcp` vẫn default `stdio`).
  - Làm sao biết daemon đã chạy? Chỉ có `GET /health`, chưa có CLI status hoặc dashboard tile.
  - Khi nào nên dùng HTTP/SSE, khi nào nên dùng stdio? Hướng dẫn này ảnh hưởng đến cả dev lẫn người dùng cuối.
* **Đề xuất UX:** Thêm `xactions daemon start/status/stop` vào CLI; dashboard hiển thị daemon state; AD-7 bổ sung `Rule 5: startup UX`.

### F2 — Terminal QR Login chưa cover môi trường không có TTY
* **AD liên quan:** AD-5
* **Vấn đề:** QR ASCII đếm ngược 60s là ổn cho terminal tương tác, nhưng:
  - Headless server / Docker / CI không có TTY thì QR không hiển thị.
  - Không có fallback URL hoặc push notification để user confirm trên điện thoại khi không xem được terminal.
  - Thiếu thông báo rõ ràng khi timeout hoặc tài khoản bị checkpoint.
* **Đề xuất UX:** AD-5 thêm `Rule 4: Non-TTY fallback` — in URL + short code, hoặc support webhook/push để user confirm từ app. Lỗi timeout phải có actionable message: "QR hết hạn — gọi lại `xactions login --qr` hoặc dùng `--cdp`".

### F3 — Adaptive Rate Governor thiếu "outward-facing" status
* **AD liên quan:** AD-13
* **Vấn đề:** Governor tự động giảm tốc, hibernation tài khoản, pause bulk khi thiếu proxy — đây là những hành vi ảnh hưởng trực tiếp user. Nhưng architecture không quy định:
  - User thấy gì khi crawl bị chậm? Silent pause là trải nghiệm tồi.
  - Làm sao biết tài khoản đang hibernation còn bao lâu?
  - Dashboard/CLI cần hiển thị healthy proxy ratio, current throughput, pending lag.
* **Đề xuất UX:** Thêm `Rule 6` vào AD-13: mọi quyết định throttle/hibernation phải ghi trạng thái công khai qua `GET /governor/status` và CLI `xactions status`. Thông điệp gợi ý hành động, ví dụ: "Tài khoản `fb:123` đang hibernation 18 phút vì WAF challenge. Đổi proxy hoặc thử lại sau."

### F4 — CrawlCheckpoint ẩn hoàn toàn với user/operator
* **AD liên quan:** AD-10, AD-12
* **Vấn đề:** Checkpoint là nội bộ; user/operator không thấy tiến độ crawl, last cursor, hay có thể resume/pause/retry một target.
* **Đề xuất UX:** Bổ sung API/CLI surface: `GET /checkpoints`, `xactions checkpoints list --platform shopee --target-key "iphone 15"`. Dashboard hiển thị checkpoint table với `lastCrawledAt`, `lastCursor`, `status` (running/paused/failed).

### F5 — Multi-platform actions khó khám phá
* **AD liên quan:** AD-11
* **Vấn đề:** Mỗi platform có registry action snake_case (`search_products`, `get_hashtag_feed`, v.v.), nhưng AI agent và CLI user không biết platform nào hỗ trợ action gì trừ khi đọc code.
* **Đề xuất UX:** AD-11 bổ sung `Rule 3: Discovery` — mọi crawler phải cung cấp `listActions()` trả về `{ action, description, requiredArgs, example }`. MCP tool `x_actions_list` hoặc CLI `xactions actions --platform shopee`.

### F6 — Error taxonomy chưa friendly cho AI agents và operators
* **AD liên quan:** AD-9
* **Vấn đề:** `PlatformResponseValidator` trả về `RateLimitError`, nhưng chưa quy định payload lỗi cho MCP/HTTP. AI agent nhận lỗi không biết nên retry, rotate proxy, hay hibernation.
* **Đề xuất UX:** Định nghĩa error envelope chuẩn: `{ code, type, message, retryAfter, suggestedAction, accountId? }`. Ví dụ `type: "rate_limit"` → `suggestedAction: "wait_60s_or_rotate_proxy"`. Nowing consumer dùng `suggestedAction` để quyết định.

### F7 — Redis Stream lag/drop chưa có giao diện giám sát
* **AD liên quan:** AD-7
* **Vấn đề:** `MAXLEN ~ 1,000,000` hoặc `MINID` vẫn có thể drop dữ liệu nếu consumer chậm dài hạn. User/operator cần thấy: throughput, consumer lag, drop rate, replay point.
* **Đề xuất UX:** Bổ sung metrics endpoint / dashboard panel cho Redis Stream: `eventsPerSecond`, `pendingMessages`, `droppedEvents`, `lastAckTime`. Cảnh báo khi lag vượt ngưỡng.

### F8 — Data model `metadata` JSON thiếu schema contract cho consumer
* **AD liên quan:** AD-4
* **Vấn đề:** `Post.metadata` chứa `price`, `salary`, `phone`, v.v. nhưng Nowing không biết field nào có cho từng platform/category. `metadata Json?` là "túi đen" đối với consumer.
* **Đề xuất UX:** Thêm `Rule 6` vào AD-4: mỗi platform/category phải publish JSON Schema hoặc TypeScript type cho `metadata`. MCP/CLI cung cấp `x_schema_get --platform shopee --category ecom`. Hoặc dùng Prisma Json validation + shared type package.

### F9 — Internal Operator Dashboard chưa được định nghĩa UX
* **AD liên quan:** AD-7, AD-10, AD-13, AD-19
* **Vấn đề:** Spine đề cập "XActions Internal Operator Dashboard" trong diagram nhưng chưa có AD chi tiết về UX dashboard. Với 4 hệ thống con (proxy pool, checkpoints, governor, stream), dashboard là nơi duy nhất giúp operator nội bộ hiểu tình trạng.
* **Đề xuất UX:** Dashboard dùng nội bộ, auth bằng admin API key. Có 5 views: Jobs, Proxies, Accounts, Checkpoints, Stream Metrics. Mỗi view hiển thị real-time status và actions cơ bản (pause/resume/retry).

### F10 — Backward compatibility với CLI cũ (`unfollowx`)
* **AD liên quan:** AD-2
* **Vấn đề:** `src/client/` là legacy Twitter client. Người dùng cũ của `xactions` CLI quen gõ `xactions unfollow` hoặc `xactions get_followers` — nếu abstraction mới ở `src/core` thay đổi API surface, user sẽ gặp lỗi không rõ lý do.
* **Đề xuất UX:** AD-2 `Rule 4: Backward Compatibility` — legacy CLI commands map vào `CrawlerCommand` với action tương ứng (`x_get_followers` → `{ action: 'followers', platform: 'twitter' }`). Error message rõ ràng nếu lệnh cũ không còn hỗ trợ.

---

## Recommendations by Priority

### P0 — Trước Epic 11/12
- F3 (Governor status), F5 (Action discovery), F6 (Error envelope) — ảnh hưởng đến cả MCP, CLI, và Nowing integration.

### P1 — Cùng Epic 10/13
- F4 (Checkpoint visibility), F7 (Stream metrics), F2 (QR non-TTY fallback).

### P2 — Sau MVP
- F1 (Daemon startup UX), F8 (Metadata schema), F9 (Dashboard views), F10 (Legacy CLI mapping).

---

## Open UX Questions

1. **Target persona ưu tiên:** Operator kỹ thuật, AI agent, hay end-user marketer? Mỗi persona cần surface khác nhau.
2. **Alert channel:** Khi governor phát hiện proxy cạn hoặc account hibernation, cảnh báo qua dashboard, email, Slack, hay webhook?
3. **Mobile/TTY support cho QR:** Có hỗ trợ gửi QR qua Telegram/Signal không?
4. **Dashboard framework:** Dùng dashboard/ hiện có (Express static), Next.js, hay tích hợp vào Nowing dashboard?

---

*Review by Sally — focused on how humans and AI agents feel, understand, and recover when using XActions.*
