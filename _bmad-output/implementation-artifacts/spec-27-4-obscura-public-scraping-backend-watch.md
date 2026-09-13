---
title: 'Story 27.4 — Obscura Browser Backend: Public-Scraping Transport & Watch/Promote Gate'
type: 'feature'
created: '2026-09-13'
status: 'approved'
route: 'dispatch'
baseline_commit: '8cdf3fc8'
review_loop_iteration: 0
context:
  - '_bmad-output/planning-artifacts/sprint-change-proposal-2026-09-13-obscura-backend.md'
  - '_bmad-output/planning-artifacts/prd.md#FR-102'
  - '_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md#AD-23'
  - 'scripts/obscura-spike.mjs'
  - 'src/scraping/stealthBrowser.js'
  - 'src/scrapers/adapters/puppeteer.js'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** XActions chỉ có một browser backend — Chrome qua `puppeteer.launch()`. Chrome nặng (~200MB+ RAM/tab, ~300MB binary) khi cào khối lượng lớn guest-visible data (profile/tweet/search) vốn không cần đăng nhập. [Obscura](https://github.com/h4ckf0r0day/obscura) — engine headless Rust, CDP-compatible, ~30MB — là ứng viên thay thế, nhưng spike chứng minh nó **không phải drop-in hoàn chỉnh**: engine non-Chromium tự render nên **không mount `data-testid` trên SPA sau-auth** (React hydration fail trên `/home`,`/explore`) và **`waitUntil:'networkidle2'` treo hoàn toàn** trên v0.2.2.

**Approach:** Thêm **pluggable browser backend** vào `stealthBrowser.js` — `chrome` (default, giữ nguyên mọi path sau-login) và `obscura` (opt-in, chỉ cho scraping công khai). Kèm **guard** chặn post-auth modules dùng `obscura`, **CI spike** so sánh hai backend, và **watch/promote gate** theo dõi Obscura release để mở rộng phạm vi khi hydration/networkidle2 được fix.

**Decisions (đã chốt trong spec):**
- **Backend là opt-in, không đổi default.** Resolution: `options.backend` → env `XACTIONS_BROWSER_BACKEND` → `'chrome'` (default) → `XACTIONS_BROWSER_BACKEND_FALLBACK` (default `'chrome'`). `obscura` dùng `puppeteer-core.connect({ browserWSEndpoint })` tới `options.wsEndpoint || env OBSCURA_WS_ENDPOINT || 'ws://127.0.0.1:9222'`.
- **Điểm vào chung = `adapter.launch()`, KHÔNG chỉ `launchStealthBrowser`.** Public scrapers lấy browser qua `BaseAdapter.launch()` — `PuppeteerAdapter.launch()` (`src/scrapers/adapters/puppeteer.js`) là implementation dùng bởi instagram/medium/facebook/reddit/tiktok bridges. `launchStealthBrowser` chỉ có **1 caller** (`b2b-registry-extended`). Vì vậy backend phải được thread ở **adapter layer** (`PuppeteerAdapter.launch/connect` đọc `options.backend`/`env`), và `launchStealthBrowser` giữ cùng contract cho caller trực tiếp. KHÔNG refactor `browserDriver`/`browserAutomation`/`signer-bridge` sang obscura trong story này — những đường đó là post-auth, giữ chrome.
- **Obscura = backend dưới transport `puppeteer`, KHÔNG phải transport mới.** Architecture spine (`xactions-epic35` IN-7, `xactions-hybrid-scraping-spine`) đã định `transport: 'http'|'puppeteer'|'rss'` — Obscura nằm dưới `puppeteer` nên không phá contract.
- **`networkidle0` là waitUntil chuẩn duy nhất cho path Obscura.** Obscura 0.2.2 treo `networkidle2` (network-event emission chưa hoàn chỉnh — issues #886/#643/#683). Spike đã đổi sang `networkidle0`. Mọi `page.goto`/`waitForNavigation` trên backend `obscura` phải dùng `networkidle0`/`load`/`domcontentloaded`.
- **Guard post-auth bằng `requiresAuth` đã phân giải — KHÔNG registry riêng.** Codebase đã có `requiresAuth` action-level (base-crawler.js:177 `actionDesc.requiresAuth ?? this.requiresAuth`, base-client.js:711). Guard reuses cờ này: khi action/caller resolve `requiresAuth===true` và backend `==='obscura'` → ném `PlatformError{ type: ErrorTypes.INVALID_ARGS, suggestedAction: 'use chrome backend' }`. KHÔNG duy trì `AUTH_REQUIRED_ACTIONS` list riêng (drift). Caller truyền `requiresAuth` xuống launch options; bridge/adapter đọc từ descriptor đã phân giải.
- **Fingerprint patches tái dùng, không tắt.** `createStealthPage` vẫn apply `evaluateOnNewDocument` patch (webdriver/languages/platform/WebGL) — Obscura `--stealth` ẩn `webdriver` nhưng patch UA/timezone/locale của FingerprintManager vẫn cần cho geo-consistency (Story 27.1). Verify không xung đột trong test.
- **`userDataDir` → `--storage-dir` mapping, không silent-drop.** Chrome persistent profile ≠ Obscura cookie/storage persistence. Khi `backend==='obscura'` và có `userDataDir`, map sang `OBSCURA_STORAGE_DIR` cho `obscura serve` (document; binary Obscura do user chạy ngoài process — không spawn trong `launchStealthBrowser`).
- **Watch → Verify → Promote, có gate — KHÔNG auto-update.** `docs/obscura-watch.md` liệt kê issue theo dõi. Promotion chỉ xảy ra khi `obscura-spike.mjs` chạy xanh trên target sau-auth (`/home` mount `data-testid`). Khi đó mới mở `obscura-for-auth` opt-in (không bao giờ default) qua change request riêng.
- **Primary/Fallback mirror adapter chain — chỉ public-scraping.** `XACTIONS_BROWSER_BACKEND` chọn primary; `XACTIONS_BROWSER_BACKEND_FALLBACK` (mặc định `chrome`) là backend dự phòng khi primary `connect` fail. Fallback direction: `obscura→chrome` luôn an toàn (chrome mạnh hơn); `chrome→obscura` CHỈ được phép trên public-scraping path — trên post-auth path guard (AC-2) vẫn throw trước, không fallback vào `obscura`.
- **Backend telemetry — record dimension, KHÔNG browser-probe canary.** `CanaryRunner` (Epic 34) probe bằng `fetch` HTTP — nó **không bao giờ launch browser**, nên không thể "chạy CANARY_CONFIGS trên cả hai backend" qua canary. Scope telemetry chỉ là: gắn `browserBackend` vào telemetry run **khi một browser launch/probe thật xảy ra** (`emitRun` kế `scraperId`,`platform`,`latencyMs`,`isSuccess`,…). Per-backend comparison thực tế chạy qua `obscura-spike.mjs BACKEND=both` (đo `ms`/PASS per-target) — đó là benchmark artifact, không phải canary. Bật qua `XACTIONS_BROWSER_BACKEND_METRICS=1` (default off). Không sửa `CanaryRunner` trong story này.

## Boundaries & Constraints

**Always:**
- `backend==='chrome'`/unset → `puppeteer.launch()` y như hiện tại (không import `puppeteer-core`); `backend==='obscura'` → `import('puppeteer-core')` động + `connect({ browserWSEndpoint })`; gắn `browser.__backend`.
- Backend resolution đặt ở **adapter layer** (`PuppeteerAdapter.launch/connect`) cho scraper bridges, và `launchStealthBrowser` cho caller trực tiếp — cùng contract `options.backend`/`env`.
- **Teardown contract per-backend:** `chrome` → `browser.close()` (kill process); `obscura` → `browser.disconnect()` (giữ `obscura serve` chạy ngoài). Caller teardown phải đọc `browser.__backend` — KHÔNG gọi `close()` trên `obscura` (giết server chia sẻ) và KHÔNG `disconnect()` trên chrome (để process sót).
- Mọi navigation trên `obscura` dùng `waitUntil:'networkidle0'`/`load`/`domcontentloaded`; cấm `'networkidle2'`.
- Post-auth (`requiresAuth===true`) reject `obscura` bằng `PlatformError{ type: INVALID_ARGS }` — không silent fallback.
- Giữ `puppeteer` + `puppeteer-extra` + stealth plugin làm default; `puppeteer-core` promote lên `dependencies` trực tiếp.

**Never:**
- KHÔNG đổi default sang `obscura`.
- KHÔNG để post-auth action dùng `obscura` (React hydration fail → miss `data-testid`) — kể cả qua fallback `chrome→obscura` trên post-auth path.
- KHÔNG spawn `obscura` process trong `launchStealthBrowser` — server quản lý ngoài (`obscura serve --stealth`); connect-only giữ `disconnect()` không `close()`.
- KHÔNG auto-promote/auto-update khi Obscura release mới — luôn qua spike-verify gate.
- KHÔNG thêm dependency mới ngoài `puppeteer-core` (đã có); tái dùng `validateSchemaNode`-style zero-dep approach.

**Ask-first:**
- Trước khi bật `obscura-for-auth` opt-in (cần change request + spike xanh + human approve).
- Trước khi map `userDataDir`→`--storage-dir` cho production session (cookie persistence semantics khác Chrome).

## Acceptance Criteria

### AC-1: Pluggable backend ở adapter layer + `launchStealthBrowser`
* **Given** `PuppeteerAdapter.launch/connect` (`src/scrapers/adapters/puppeteer.js`) và `launchStealthBrowser(options)`
* **When** caller resolve `options.backend` hoặc env `XACTIONS_BROWSER_BACKEND`
* **Then** `backend==='chrome'`/unset → `puppeteer.launch()` như hiện tại; `backend==='obscura'` → `puppeteer-core.connect({ browserWSEndpoint })` tới `options.wsEndpoint || OBSCURA_WS_ENDPOINT || 'ws://127.0.0.1:9222'`; cả hai gắn `browser.__backend`
* **And** một public scraper bridge (vd `reddit/bridge.js` hoặc `medium/bridge.js`) thread `options.backend`/`requiresAuth` xuống `adapter.launch()` — chứng minh backend đến được scraper, không chỉ `launchStealthBrowser`
* **And** teardown đọc `browser.__backend`: `obscura`→`disconnect()`, `chrome`→`close()`

### AC-2: Post-auth guard qua `requiresAuth` đã phân giải
* **Given** `requiresAuth` action-level đã resolve (`actionDesc.requiresAuth ?? this.requiresAuth`, base-crawler.js:177)
* **When** caller/bridge resolve `requiresAuth===true` và backend `==='obscura'`
* **Then** ném `PlatformError{ type: INVALID_ARGS, message:'obscura backend không hỗ trợ post-auth (React hydration chưa mount data-testid)', suggestedAction:'dùng chrome backend' }` — không chạy, không registry riêng.

### AC-2b: Primary/fallback backend
* **Given** `XACTIONS_BROWSER_BACKEND` (primary) và `XACTIONS_BROWSER_BACKEND_FALLBACK` (fallback, default `chrome`)
* **When** primary `connect`/`launch` throw trên public-scraping path
* **Then** retry một lần với fallback backend khác primary; log `⚠️ [stealth] primary backend <p> failed → fallback <f>`
* **And** `obscura→chrome` luôn được phép; `chrome→obscura` CHỈ trên public-scraping path — trên post-auth path AC-2 vẫn throw (không fallback vào `obscura`)
* **And** browser trả về gắn `__backend` = backend thực tế dùng (primary hoặc fallback)

### AC-2c: Per-backend telemetry + spike benchmark (KHÔNG qua CanaryRunner)
* **Given** `XACTIONS_BROWSER_BACKEND_METRICS=1` và `emitRun` telemetry của Epic 34
* **When** một browser launch/probe thật ghi telemetry
* **Then** telemetry run mang thêm field `browserBackend` ('chrome'|'obscura') cạnh `scraperId`,`platform`,`latencyMs`,`isSuccess`,`false200Detected`,`checkpointDetected`; default OFF → field vắng khi env không bật
* **And** per-backend comparison (latency/success/RAM) chạy qua `obscura-spike.mjs BACKEND=both` — report per-backend `ms`/PASS, KHÔNG phải CanaryRunner (vì canary probe bằng HTTP fetch, không launch browser)
* **And** `CanaryRunner` không bị sửa trong story này

### AC-3: Spike verification matrix (CI/manual)
* **Given** `scripts/obscura-spike.mjs` (đã tồn tại)
* **When** chạy `BACKEND=both node scripts/obscura-spike.mjs` với `obscura serve --stealth` đang chạy
* **Then** cả `chrome` và `obscura` PASS trên `example-static`, `cloudflare-challenge`, `fingerprint-sannysoft`, `xcom-guest`; guard test assert post-auth path throw trên `obscura`
* **And** script dùng `networkidle0`; skip nhẹ nhàng khi không có `obscura serve` (không fail build)

### AC-4: Docs + watch/promote gate
* **Given** `docs/obscura-backend.md` và `docs/obscura-watch.md`
* **When** dev/operator đọc
* **Then** `obscura-backend.md` mô tả cài đặt, `obscura serve --stealth`, env vars, ma trận target phù hợp (guest scrape) vs không phù hợp (post-auth)
* **And** `obscura-watch.md` liệt kê issue theo dõi (#531 hydration, #886/#643/#683 network-idle, #817/#866 SPA) + **promote gate**: release mới → chạy `BACKEND=both` spike → `/home` `data-testid` mount xanh → mới mở `obscura-for-auth` opt-in qua change request

### AC-5: Dependency hygiene
* **Given** `package.json`
* **When** kiểm tra
* **Then** `puppeteer-core` là direct dependency (pin `^24.x` tương thích `puppeteer` hiện có); không dependency mới nào khác.

## Test Notes
- Unit: backend resolution (option > env > default > fallback); fallback direction rules (`obscura→chrome` ok; `chrome→obscura` chỉ public); guard throw trên `requiresAuth===true` + `obscura` (kể cả qua fallback).
- Teardown: assert `disconnect()` trên `obscura`, `close()` trên `chrome` đọc từ `__backend`.
- Telemetry: assert `browserBackend` field xuất hiện khi `XACTIONS_BROWSER_BACKEND_METRICS=1`, vắng khi off.
- Adapter: `PuppeteerAdapter.launch({backend:'obscura'})` → connect ws (integration, env-gated).
- Integration (skip khi không có server): connect `ws://127.0.0.1:9222`, `goto` example.com `networkidle0`, assert `__backend==='obscura'`, `disconnect()` không kill server.
- Vitest 4.x, no mocks — `obscura` test là integration opt-in (env-gated), không bắt buộc cho CI build xanh.

## Non-Goals
- KHÔNG thay Chrome cho post-auth automation.
- KHÔNG spawn/quản lý `obscura` binary lifecycle trong library.
- KHÔNG refactor `browserDriver`/`browserAutomation`/`signer-bridge`/CDP-launcher sang `obscura` — đó là post-auth paths, giữ chrome.
- KHÔNG sửa `CanaryRunner` (Epic 34) — nó probe HTTP, không launch browser; per-backend benchmark qua spike.
- KHÔNG viết lại `puppeteer-extra` stealth plugin cho CDP-connect (Obscura `--stealth` đã cover phần lớn).
