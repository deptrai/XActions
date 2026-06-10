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

## 3. Lộ trình triển khai (phased, theo story)

Gom 10 feature cần port thành 4 epic, mỗi story đi qua chu trình create-story → dev → 3-layer review (như Facebook Extension đã làm).

### Epic P1 — Facebook GraphQL/HTTP layer (nền tảng cho share)
> Tái dùng pattern HTTP của XActions; thay xNet bằng fetch/undici. Tất cả là đọc/token, rủi ro thấp.

- **Story P1.1 — Token scraper** (P3): `getFacebookTokens(page|cookie)` trả `{ fb_dtsg, lsd, jazoest, hsi, spin_r, spin_t }`. Đặt ở `src/scrapers/facebook/graphql.js`. Test: parse từ HTML fixture (browser-free).
- **Story P1.2 — Page list via Graph API** (P5): `getPagesFromCookie(cookie)` → ad account ID → `facebook_pages` list. Wire vào dispatcher action `pages`. Test: mock HTTP fixture.
- **Story P1.3 — Messenger Business CTA check** (P4): `checkMessengerCTA(pageId, actorId, tokens)` GraphQL doc_id. Test: response-shape parse.

### Epic P2 — Messenger share automation (CORE — phần khó nhất)
> Đây là tính năng chính C# có mà XActions chưa có. Mọi write route qua `runGuardedBatch`, dry-run mặc định.

- **Story P2.1 — Share post → page via Messenger** (P1): `shareToMessenger(page, postUrl, targetPageId)` — tìm share button (selector fallback chain), click "via Messenger". Selectors UNVERIFIED → ghi vào `selectors-facebook.md` mục Messenger, cần live verify (Q-Messenger).
- **Story P2.2 — Compose & send message** (P2): random `**` split, type line-by-line Shift+Enter, strip emoji `\p{Cs}`, detect "Couldn't send" → blocked. Injectable `delay` seam.
- **Story P2.3 — Batch share entry point** (P1+P9+P10): `messengerShareCampaign(accounts, { postUrls, messages, targetPages, dryRun })` route qua `runGuardedBatch`. FIFO queue cho targetPages (thay uid.txt). Expose qua CLI/MCP/API.

### Epic P3 — Auth modes & proxy
- **Story P3.1 — uid/pass login mode** (P7): bait-cookie + fill form + "Continue" handling. Bổ sung vào `loginWithCookie` hoặc thêm `loginWithPassword(page, { uid, pass })`.
- **Story P3.2 — 2FA TOTP** (P8): 32-char seed → TOTP code (thư viện `otplib`). Inject khi login challenge.
- **Story P3.3 — Proxy rotation providers** (P6): `src/scrapers/facebook/proxy/{proxyfb,tmproxy,shoplike}.js`, mỗi cái `rotate(key)`/`current(key)`. Wire vào `browserOptions.proxy`. Test: HTTP fixture.

### Epic P4 — Input/queue & surfaces polish
- **Story P4.1 — File/queue inputs** (P10): đọc danh sách target pages / contents / links từ file hoặc API body; FIFO thread-safe (thay uid.txt/txtnoidung.txt/txtlinkss.txt). Random content segment.
- **Story P4.2 — CLI/MCP/API expose** cho messenger campaign: `xactions automate --action messenger-share`, MCP `x_facebook_automate` action `messenger`, REST `POST /api/facebook/automate` action `messenger`. Dry-run mặc định toàn bộ.

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

1. **Epic P1** trước (HTTP/token nền tảng, rủi ro thấp, browser-free test được nhiều).
2. **Epic P3.3 proxy** (độc lập, nhanh).
3. **Epic P2** (core, khó nhất — cần live verify selectors).
4. **Epic P3.1/P3.2** (auth nâng cao).
5. **Epic P4** (queue + surfaces).

Mỗi story: tạo bằng `bmad-create-story`, review bằng `bmad-code-review`. Selector-dependent stories (P2.x) sẽ có phần UNVERIFIED tie vào verify checklist như Epic 1.

## 7. Ước lượng quy mô

- ~10 story (so với 14 story của Facebook Extension gốc).
- Phần lớn HTTP/parse/proxy tái dùng pattern → nhanh.
- Phần khó tập trung ở Epic P2 (Messenger DOM) — cần account Facebook thật để verify, giống các deferred Q3 hiện tại.
