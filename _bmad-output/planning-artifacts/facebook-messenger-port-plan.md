# Port Plan: SST_TOOL_FB (C# WinForms) → XActions (Node.js/Playwright)

> Nguồn: `auto-crawl-tiktok-post-fb/automation-facebook/SST_TOOL_FB` (.NET Framework 4.6.2, WinForms, Playwright + xNet).
> Đích: XActions Facebook adapter (`src/scrapers/facebook/`, `api/services/facebookAutomation.js`) — tái dùng hạ tầng đã build (Epic 1–3).
> Ngày: 2026-06-10.

## 1. Bối cảnh & nguyên tắc

SST_TOOL_FB là tool "chăm sóc Page": đăng nhập nhiều tài khoản Facebook, **share một post tới các Page qua Messenger** kèm nội dung nhắn tin, với proxy rotation và chạy đồng thời nhiều account. XActions đã có sẵn nền tảng Facebook (cookie login, scrape, automate like/comment/post, guardrail dry-run, đa surface). Port = **lấp phần tính năng C# có mà XActions chưa có**, tái dùng tối đa hạ tầng hiện hữu thay vì viết lại.

Nguyên tắc port:
- **REUSE-FIRST (bắt buộc):** mọi story phải tái dùng hạ tầng có sẵn trước; chỉ viết mới phần C# có mà XActions thực sự chưa có (xem §2 cột "CẦN PORT"). Cấm viết lại loop/concurrency/dry-run/login/dispatch/persistence — chúng đã tồn tại.
- Tái dùng `runGuardedBatch` (dry-run default, delay seam, bounded batch) cho mọi write mới.
- Tái dùng `loginWithCookie`, dispatcher `scrape()`, Operation persistence, CLI/MCP/API surfaces.
- Mỗi function mới chỉ là `actionFn` cấp cho guardrail, KHÔNG tự dựng vòng lặp/đa luồng.
- KHÔNG port: license/anti-piracy (`fuck/*`), WinForms UI, auto-update, WebView2, Selenium (XActions dùng Playwright/Puppeteer).
- Mọi automation mới mặc định dry-run (ADR-007), không log cookie (NFR3).

## 2. Gap Analysis — C# feature ↔ XActions

### ✅ ĐÃ CÓ trong XActions (không cần port, chỉ map lại)

| C# feature | XActions tương đương |
|---|---|
| Cookie login (c_user/xs) | `loginWithCookie(page, { c_user, xs })` |
| Multi-account grid | array accounts + `runGuardedBatch` |
| Dry-run / batch / delay | `runGuardedBatch` guardrail |
| Operation tracking | Prisma `Operation` (Story 3.4) |
| CLI / MCP / REST surfaces | Story 3.1 / 3.2 / 3.3 |
| Proxy config (per-session) | dispatcher `browserOptions.proxy` (đã hỗ trợ truyền vào) |

### 🔨 CẦN PORT (C# có, XActions CHƯA có) — đây là phần việc thật

| # | Feature | C# nguồn | Độ phức tạp |
|---|---|---|---|
| P1 | **Share post → Pages qua Messenger** (core) | `Main.cs:Post()` lines 582–799 | Cao |
| P2 | **Messenger message compose & send** (random `**`, line-by-line, emoji strip) | `Main.cs:Post()` 744–799 | Trung |
| P3 | **GraphQL token scraping** (fb_dtsg, lsd, jazoest, hsi, __spin_r/t) | `Main.cs:Post()` 225–251 | Trung |
| P4 | **Messenger Business CTA check** (GraphQL doc_id 29460155383630960) | `Main.cs:Post()` 558–581 | Trung |
| P5 | **Page list fetch via Graph API** (ad account → facebook_pages) | `getPage.cs:GetPagesFromCookie()` | Trung |
| P6 | **Proxy rotation 3 providers** (proxyfb, tmproxy, shoplike) | `proxyfb.cs`, `proxyTM.cs`, `shopLike.cs` | Thấp |
| P7 | **uid/pass login mode** (bait cookie + fill form + Continue) | `Main.cs:Post()` 294–425 | Trung |
| P8 | **2FA seed handling** (32-char TOTP seed) | `MNST_DT1.cs` parse | Thấp |
| P9 | **Multi-account concurrency** (SemaphoreSlim N song song) | `Main.cs:button1_Click()` | Trung |
| P10 | **File-queue FIFO** (uid.txt pop thread-safe, content/link files) | `Main.cs:Post()` | Thấp |

### ❌ KHÔNG PORT (cố ý loại)

- `fuck/MachineValidator.cs`, `fuck/cracklabomemaychet.cs` — license/anti-piracy. Nếu cần license, làm lại từ đầu với backend riêng.
- WinForms UI (`Main`, `Form2`, `Form3`, `ucTMA_*`, `UIHelper`, `UIShape`) — XActions là CLI/MCP/API/dashboard.
- `AutoUpdater.NET`, WebView2, Selenium refs — không liên quan.
- TikTok: **không có code TikTok trong project này** (tên repo gây hiểu nhầm).

## 3. Lộ trình triển khai (4 story — gộp theo epic)

10 feature cần port gom thành **4 story** (mỗi story = 1 epic), đi qua chu trình create-story → dev → 3-layer review.

### Story 5.1 — Facebook GraphQL/HTTP layer
> Nền tảng cho share. Tái dùng `axios`/fetch + pattern `src/scrapers/twitter/http/`. Rủi ro thấp, browser-free test được.
Gồm: token scraper (P3 — fb_dtsg/lsd/jazoest/hsi/spin_r/spin_t), page list via Graph API (P5 — ad account → facebook_pages), Messenger Business CTA check (P4 — GraphQL doc_id). Đặt ở `src/scrapers/facebook/graphql.js`. Anchored regex thay split chain.

### Story 5.2 — Messenger share automation (CORE — khó nhất)
> Tính năng chính C# có mà XActions chưa. Mọi write route qua `runGuardedBatch`, dry-run mặc định.
Gồm: share post → page qua Messenger (P1 — share button + "via Messenger" fallback chain), compose & send message (P2 — random `**`, line-by-line Shift+Enter, emoji strip, detect "Couldn't send"), batch campaign entry point (P1+P9+P10 — `messengerShareCampaign` qua `runGuardedBatch`, FIFO queue). Selectors UNVERIFIED → `selectors-facebook.md`, cần live verify.

### Story 5.3 — Auth modes & proxy
> Độc lập với P2, làm song song được.
Gồm: uid/pass login mode (P7 — bait-cookie + fill form + Continue), 2FA TOTP (P8 — 32-char seed qua `otplib`), proxy rotation 3 providers (P6 — proxyfb/tmproxy/shoplike, wire vào `browserOptions.proxy`).

### Story 5.4 — Input/queue & surfaces
> Khâu cuối — nối campaign vào người dùng.
Gồm: file/queue inputs (P10 — target pages/contents/links, FIFO, random segment), expose qua CLI/MCP/API (`automate --action messenger-share`, MCP action `messenger`, REST). Dry-run mặc định, additive không phá surface cũ.

<!-- Chi tiết feature P1-P10 ở §2. Thứ tự đề xuất: 5.1 → 5.3 → 5.2 → 5.4. -->

## 4. Rủi ro & điểm cần lưu ý

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| **Selectors Messenger share UNVERIFIED** | Cao | Selector fallback chain như C#; ghi `selectors-facebook.md`; cần live FB session để verify (giống Q3) |
| **GraphQL doc_id hardcoded dễ vỡ** | Cao | doc_id `29460155383630960` Facebook đổi bất kỳ lúc nào; cần fallback + cảnh báo rõ khi response sai shape |
| **Account ban risk (write thật)** | Cao | dry-run mặc định, delay 1-3s, bounded batch, cảnh báo account-risk (đã có trong guardrail) |
| **xNet header mimicry** | Trung | Port headers sec-ch-ua/dpr/viewport sang fetch; một số là anti-bot, cần giữ |
| **Token scraping phụ thuộc HTML split** | Trung | C# split chuỗi thô; nên dùng regex có anchor + test fixture |
| **Pháp lý/ToS** | Cao | Tool share hàng loạt qua Messenger ~ spam risk; giữ ở mức user tự chịu trách nhiệm, document rõ |

## 5. Chiến lược test (theo chuẩn XActions)

- **Browser-free unit tests**: token parser, message random-split, emoji strip, proxy response parse, page-list parse — dùng fixture, `delay: () => {}`.
- **Guardrail routing tests**: messenger share route qua `runGuardedBatch`, dry-run không gọi actionFn, spy DOM fn.
- **Selector docs**: mọi selector Messenger UNVERIFIED → `docs/agents/selectors-facebook.md` mục mới "Messenger Share"; verify checklist cần account thật.
- **Contract tests**: CLI/MCP/API additive, không phá surface cũ.
- Bài học từ 14 story trước: delay seam bắt buộc, mock không bypass logic, verify thay vì tin record, null-guard cho mọi injectable fn.

## 6. Thứ tự đề xuất

1. **Story 5.1** trước (HTTP/token nền tảng, rủi ro thấp, browser-free test được nhiều).
2. **Story 5.3 (proxy phần)** (độc lập, nhanh).
3. **Story 5.2** (core, khó nhất — cần live verify selectors).
4. **Story 5.3 (auth phần)** (uid/pass + 2FA nâng cao).
5. **Story 5.4** (queue + surfaces).

Mỗi story: tạo bằng `bmad-create-story`, review bằng `bmad-code-review`. Story 5.2 (Messenger DOM) sẽ có phần UNVERIFIED tie vào verify checklist như Epic 1.

## 7. Ước lượng quy mô

- **4 story** (mỗi epic = 1 story; gộp từ 10 feature ở §2).
- Phần lớn HTTP/parse/proxy tái dùng pattern → nhanh (P1, P3).
- Phần khó tập trung ở **Story 5.2** (Messenger DOM) — cần account Facebook thật để verify, giống các deferred Q3 hiện tại.
