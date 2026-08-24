# Story 12.2 — CDP Remote Attach Mode with Launch Helper & Gaussian Jitter

**Story ID:** 12.2  
**Epic:** 12 — Frictionless Authentication (Terminal QR & CDP Attach)  
**Status:** done  
**Owner:** DEV  
**Source:** `epics.md` Story 12.2, `prd.md` FR-69, `ARCHITECTURE-SPINE.md` AD-5 & AD-15, `ux/EXPERIENCE-UNIVERSAL-2026-08-21.md` Flow R1, existing `src/scrapers/adapters/**` (BaseAdapter, PlaywrightAdapter, PuppeteerAdapter — `connect()` already defined), `src/core/base-crawler.js`, `src/core/base-login.js`, `src/cli/commands/login.js` (has `--cdp` stub from 12.1), `src/cli/commands/connect.js`, `src/agents/antiDetection.js`.

**Cross-Epic Dependency:** Story 12.2 unblocks **Epic 18.3 (LinkedIn B2B Lead & Job Scraper)** and enables auth-required scraping on **TopCV** / **VietnamWorks** where CDP attach preserves a real browser profile (AD-5 Rule 2, AD-8).

---

```yaml
baseline_commit: 7a27c5e7f5c6c0f7a8f6b8e3b8c8d9e0f1a2b3c4d
```

---

## Story

As a **Power User**,  
I want **một helper CLI tự mở Chrome với cổng remote debugging 9222, để tôi đăng nhập LinkedIn/TopCV thủ công trên Chrome thật, rồi kết nối XActions qua CDP với độ trễ Gaussian 3-7s giữa các thao tác**,  
so that **hệ thống sử dụng nguyên vẹn profile, cookie và fingerprint thật của tôi để cào LinkedIn/TopCV mà không bị phát hiện automation**.

---

## Acceptance Criteria

### AC-1: CLI helper `xactions auth --launch-chrome` mở Chrome với CDP port

* **Given** user chạy `xactions auth --launch-chrome` từ terminal (primary CLI bin is `xactions`; legacy `unfollowx` is a non-executable stub and must not be assumed)
* **When** CLI xử lý lệnh
* **Then** hệ thống phát hiện đường dẫn Chrome theo platform:  
  - macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`  
  - Windows: `C:\Program Files\Google\Chrome\Application\chrome.exe` hoặc `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`  
  - Linux: tìm trong `$PATH` với `google-chrome`, `google-chrome-stable`, `chromium`, `chromium-browser`
* **And** spawn Chrome với flags:  
  `--remote-debugging-port=9222 --user-data-dir=<dedicated> --no-first-run --no-default-browser-check`  
  (không dùng `--headless` mặc định; `--headless` chỉ được hỗ trợ như một flag tùy chọn cho CI/automation)
* **And** in ra terminal thông tin: `CDP listening on http://localhost:9222`, hướng dẫn user đăng nhập thủ công trên Chrome thật
* **And** hỗ trợ `--port <n>` để đổi cổng (mặc định `9222`), `--user-data-dir <path>` để dùng profile riêng, `--chrome-path <path>` để chỉ định binary, `--headful` mặc định (mở cửa sổ Chrome thật)
* **And** nếu Chrome đã mở trên port đó, CLI in cảnh báo và dùng endpoint hiện có thay vì spawn mới
* **And** phát hiện `process.stdout.isTTY`; nếu non-TTY (CI/Docker/headless), in URL/text hướng dẫn thay vì dùng escape sequences (AD-15 Rule 1)
* **And** user-data-dir mặc định được cách ly theo platform/account, tạo với quyền `0o700` nếu chưa tồn tại, và ghi config/cookie với `0o600` khi lưu trạng thái

### AC-2: `launchBrowserWithCdp(cdpUrl)` kết nối Playwright/Puppeteer vào Chrome thật

* **Given** `src/core/cdp-launcher.js` export `launchBrowserWithCdp(cdpUrl)` nhận `cdpUrl` dạng `http://localhost:9222`
* **When** gọi `await launchBrowserWithCdp('http://localhost:9222')`
* **Then** nếu `XACTIONS_SCRAPER_ADAPTER=playwright` hoặc adapter mặc định là `playwright`, sử dụng `chromium.connectOverCDP(cdpUrl)` để lấy `Browser` từ Chrome thật
* **And** nếu dùng `puppeteer`, sử dụng `puppeteer.connect({ browserWSEndpoint: <ws từ http://localhost:9222/json/version> })`
* **And** trả về một `AdapterBrowser` hợp đồng hiện tại: `{ _native, _adapter: 'playwright' | 'puppeteer', _browserType: 'chromium' }`, tương thích với `createPage()` của `src/scrapers/twitter/index.js` và `src/scrapers/facebook/core.js`
* **And** kết quả thành công phải có thể lưu thành `LoginResult = { accountId, cookies, tokens, expiresAt }` theo contract `AbstractLogin` để `SessionManager` lưu session (AD-5 Rule 3)
* **And** nếu kết nối thất bại, throw `PlatformError` với `type`/`code` phù hợp:  
  - Chrome không tìm thấy / không chạy: `type: 'internal'`, `code: 'XACT_5030'`, `suggestedAction: 'RELOGIN'`  
  - Không có session hợp lệ cho nền tảng: `type: 'auth_expired'`, `code: 'XACT_4010'`, `suggestedAction: 'RELOGIN'`

### AC-3: Adapter contract `connect(cdpUrl, options)` — sử dụng implementation sẵn có

* **Given** `src/scrapers/adapters/base.js` đã định nghĩa phương thức `async connect(cdpUrl, options = {})` (line 126-133); `PlaywrightAdapter.connect()` (line 296-309) đã dùng `chromium.connectOverCDP`; `PuppeteerAdapter.connect()` (line 235-258) đã fetch `/json/version` và dùng `puppeteer.connect`
* **When** `getAdapter().connect(cdpUrl)` được gọi
* **Then** `src/scrapers/adapters/index.js` phục vụ `getAdapter().connect(cdpUrl)` và giữ backward-compatible với `launch()`
* **And** `BaseAdapter.newPage()` cần hỗ trợ option `preserveProfile: true` để khi CDP mode không tạo context/viewport/user-agent mới (AC-6)
* **And** cập nhật `types` nếu cần để phản ánh `preserveProfile` trong `NewPageOptions`

### AC-4: `AbstractCrawler` khởi tạo trang qua CDP trong `init()`

* **Given** `src/core/base-crawler.js` có phương thức `async init()`
* **When** một crawler con (ví dụ `LinkedInCrawler` tương lai) gọi `await this.launchBrowserWithCdp(this.cdpUrl)` trong `init()`
* **Then** `launchBrowserWithCdp` trả về browser + page mà không spawn process mới
* **And** crawler lưu page/browser vào `this.page` / `this.browser` để tái sử dụng trong các action `search()`, `getPostDetail()`, `getComments()`
* **And** `AbstractCrawler` constructor chấp nhận `deps.cdpUrl` hoặc `deps.client` đã có CDP; `types/core.d.ts` cập nhật `AbstractCrawler` constructor option thêm `cdpUrl?: string`
* **And** `command.session.cdpUrl` hoặc `SessionManager.get(accountId).cdpUrl` được dùng để truyền CDP URL từ CLI xuống crawler

### AC-5: Gaussian Jitter 3–7s giữa các thao tác cào

* **Given** hệ thống đang chạy CDP attach mode
* **When** crawler thực hiện liên tiếp các hành động (goto, evaluate, scroll, click)
* **Then** mỗi khoảng nghỉ được tính bằng phân phối Gaussian với `mean = 5000ms`, `stdev = 1000ms`, sau đó clamp vào `[3000, 7000]` ms
* **When** crawler thực hiện hành động
* **Then** áp dụng `gaussianDelay(3000, 7000, 5000, 1000)` từ `src/utils/gaussian-delay.js`

### AC-6: Không ghi đè profile/fingerprint thật của Chrome

* **Given** Chrome được attach qua CDP
* **When** `createPage(browser)` được gọi
* **Then** nếu `options.preserveProfile === true`, không set viewport, user agent, hoặc stealth patches

### AC-7: Xử lý lỗi CDP rõ ràng và actionable

* **Given** lỗi kết nối
* **Then** in ra thông báo lỗi plain text prefix `[CDP ERROR]` và thoát với `process.exitCode = 1`

### AC-8: Kiểm thử

* **Then** tất cả các test suite chạy pass

---

## Tasks / Subtasks

- [x] **Task 1: Tạo module CDP launcher core** (AC-1, AC-2, AC-7)
  - [x] 1.1 Tạo `src/core/cdp-launcher.js` với `launchBrowserWithCdp(cdpUrl)` và `fetchCdpWsEndpoint(cdpUrl)` (chỉ dùng built-in Node: `child_process`, `fs`, `path`, `os`, `http`); delegate actual browser connection tới `getAdapter().connect(cdpUrl)`
  - [x] 1.2 Export `gaussianRandom` từ `src/agents/antiDetection.js` và tạo `src/utils/gaussian-delay.js` với `gaussianDelay(min, max, mean, stdev)` Box-Muller transform
  - [x] 1.3 Export `launchBrowserWithCdp`, `launchChrome`, `getChromeExecutablePath`, `getDefaultUserDataDir`, `buildChromeArgs`, `fetchCdpWsEndpoint` từ `src/core/index.js`
- [x] **Task 2: Mở rộng Adapter contract với `connect()`** (AC-3)
  - [x] 2.1 `BaseAdapter.connect()` đã tồn tại
  - [x] 2.2 `PlaywrightAdapter.connect()` đã dùng `chromium.connectOverCDP`
  - [x] 2.3 `PuppeteerAdapter.connect()` đã fetch WS URL
  - [x] 2.4 Cập nhật `PlaywrightAdapter.newPage()` và `PuppeteerAdapter.newPage()` để hỗ trợ `options.preserveProfile: true` (AC-6); cập nhật `src/types/adapters.d.ts`
- [x] **Task 3: Tích hợp CDP vào `AbstractCrawler`** (AC-4, AC-5)
  - [x] 3.1 Thêm `launchBrowserWithCdp(cdpUrl)` vào `src/core/base-crawler.js`
  - [x] 3.2 Cập nhật `AbstractCrawler` constructor nhận `deps.cdpUrl`
  - [x] 3.3 Cập nhật `types/core.d.ts` cho `AbstractCrawler` constructor và methods
  - [x] 3.4 Thêm helper `delayWithJitter(min, max)` vào `AbstractCrawler`
- [x] **Task 4: Xây dựng CLI `auth` với `--launch-chrome`** (AC-1, AC-7)
  - [x] 4.1 Tạo `src/cli/commands/auth.js` với `registerAuthCommand`
  - [x] 4.2 Thêm `xactions auth --launch-chrome --port <n> --user-data-dir <path> --chrome-path <path> --headless`
  - [x] 4.3 Đăng ký command trong `src/cli/index.js`
  - [x] 4.4 Cập nhật `src/cli/commands/login.js` hướng dẫn `xactions auth --launch-chrome` khi dùng `--cdp`
  - [x] 4.5 Hỗ trợ detect Chrome executable theo platform (macOS, Windows, Linux) và fallback `--chrome-path`
- [x] **Task 5: Áp dụng Gaussian Jitter** (AC-5)
  - [x] 5.1 Triển khai `gaussianDelay` trong `src/utils/gaussian-delay.js` với Box-Muller transform
  - [x] 5.2 Đảm bảo jitter không làm chậm HTTP path
- [x] **Task 6: Bảo toàn profile/fingerprint khi CDP** (AC-6)
  - [x] 6.1 Cập nhật `createPage(browser)` trong `src/scrapers/twitter/index.js` để truyền `preserveProfile: true` khi CDP
  - [x] 6.2 Cập nhật `createPage()` trong `src/scrapers/facebook/core.js` tương tự
  - [x] 6.3 Đảm bảo adapter `newPage` không ghi đè profile khi `preserveProfile: true`
- [x] **Task 7: Viết tests** (AC-8)
  - [x] 7.1 `tests/core/cdp-launcher.test.js` (10/10 tests pass)
  - [x] 7.2 `tests/cli/auth.test.js` (3/3 tests pass)
  - [x] 7.3 `tests/utils/gaussian-delay.test.js` (5/5 tests pass)
  - [x] 7.4 Unit tests cho `PlaywrightAdapter` / `PuppeteerAdapter` `newPage` với `preserveProfile: true` (pass)
  - [x] 7.5 Unit tests cho `AbstractCrawler` CDP methods trong `tests/core/base-crawler.test.js` (pass)

---

## Dev Notes

### Architecture Compliance

* **AD-5 — Non-Invasive Authentication via Terminal QR & CDP Attach [ADOPTED]** — `src/core/base-login.js`, `src/utils/qrcode.js`, `src/core/session-manager.js`  
  * Rule 1: Terminal QR Login đã làm trong Story 12.1.
  * Rule 2: Kết nối vào Chrome thật qua cổng 9222; Chrome phải được launch với `--remote-debugging-port=9222` và `--user-data-dir=<dedicated>`. Áp dụng Gaussian Jitter (3–7s) khi cào LinkedIn/TopCV.
  * Rule 3: `AbstractLogin` contract trả về `{ accountId, cookies, tokens, expiresAt }`. Mọi QR/CDP/cookie flow phải cùng shape; CDP auth cần lưu kết quả này qua `SessionManager`.
  * Rule 4: Auth-required platforms (LinkedIn, TopCV, Facebook, TikTok, Shopee, X, Threads, VietnamWorks) buộc một tài khoản gắn với một proxy cố định (sticky IP) trong suốt session. `SessionManager` lưu `accountId`; `ProxyIpPool.getStickyProxy(accountId)` trả về proxy được gán. Không xoay IP khi dùng CDP attach.

* **AD-15 — Terminal QR Login with Non-TTY Fallback & Clear Auth Feedback [ADOPTED-NEW]** — `src/core/base-login.js`, `src/utils/qrcode.js`, `src/cli/login.js`  
  * Rule 1: TTY detection `process.stdout.isTTY` — non-TTY phải in text/plain hướng dẫn.
  * Rule 3: Error messages dùng prefix rõ ràng, ví dụ `[QR EXPIRED] ...` hoặc `[ACCOUNT CHECKPOINTED] ...`. CDP errors phải theo cùng convention: `[CDP ERROR] ...`, dùng plain text, **no emoji**.
  * Rule 4: Terminal size adaptation (QR ASCII tự động nhỏ lại khi terminal < 80 cols) — áp dụng tương tự cho text output của CDP helper.

* **AD-2 — Error Envelope Hierarchy [ADOPTED]** — `src/core/error-envelope.js`  
  * Mọi lỗi CDP phải là `PlatformError` với `type`, `code`, `suggestedAction`, `platform`, `details`. Không throw raw `Error`.

* **AD-3 — Zero core dependencies [ADOPTED]** — `src/core/` không được phép có npm dependencies. `src/core/cdp-launcher.js` chỉ được dùng built-in Node (`child_process`, `fs`, `path`, `os`, `http`) và delegate connect cho `src/scrapers/adapters/` (dynamic). Không `import 'playwright'`/`import 'puppeteer'` tĩnh trong `src/core/`.

* **AD-9 — Multi-Framework Adapter Layer [ADOPTED]** — `src/scrapers/adapters/`  
  * Mọi tương tác browser phải đi qua adapter. CDP attach đã là phương thức `connect()` trong adapter contract. Cần bổ sung `preserveProfile` option trong `newPage()` để không ghi đè profile Chrome thật.

### Technical Requirements

* **Runtime**: ESM Node.js >= 20.18.1, `type: "module"`.
* **Browser frameworks**: Playwright `^1.62.1` and Puppeteer `^24.34.0` đã có sẵn trong `package.json`. Không thêm dependency mới.
* **CDP Protocol**:
  * Playwright: `chromium.connectOverCDP(endpointURL, options)` — trả về `Browser` kết nối sẵn.
  * Puppeteer: Lấy `webSocketDebuggerUrl` từ `http://localhost:9222/json/version` rồi `puppeteer.connect({ browserWSEndpoint })`.
* **Chrome launch flags** (cho `--launch-chrome`):
  * `--remote-debugging-port=9222`
  * `--user-data-dir=<dedicated>`
  * `--no-first-run --no-default-browser-check` (tránh hộp thoại)
  * Không dùng `--headless` mặc định — CDP mode là headful.
* **Chrome path detection**:
  * macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
  * Windows: `C:\Program Files\Google\Chrome\Application\chrome.exe` hoặc `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`
  * Linux: `google-chrome`, `google-chrome-stable`, `chromium`, `chromium-browser` (tìm trong `$PATH`)
* **Gaussian Jitter**: dùng Box-Muller transform, clamp `[3000, 7000]` ms. Tái sử dụng `gaussianRandom` từ `src/agents/antiDetection.js` (cần export) thay vì copy logic.
* **TTY / Non-TTY**: CLI phát hiện `process.stdout.isTTY` để in hướng dẫn phù hợp.
* **Session persistence**: CDP URL có thể lưu trong `SessionManager` theo `accountId` hoặc global config; CLI `auth --launch-chrome` cần expose URL để crawler lấy qua `SessionManager` hoặc `CrawlerCommand.session.cdpUrl`.

### File Structure Requirements

```
src/
  core/
    cdp-launcher.js          # NEW — launchBrowserWithCdp + Chrome spawn helper, zero npm deps
    base-crawler.js          # UPDATE — add cdpUrl, launchBrowserWithCdp, jitter wrapper
  scrapers/
    adapters/
      base.js                # EXISTING — connect() abstract, add preserveProfile option to newPage
      playwright.js          # UPDATE — preserveProfile in newPage, connect() already done
      puppeteer.js           # UPDATE — preserveProfile in newPage, connect() already done
      index.js               # EXISTING — getAdapter().connect(cdpUrl) works
    twitter/index.js         # PRESERVE — createBrowser/createPage, truyền preserveProfile khi CDP
    facebook/core.js         # UPDATE — createPage tương tự Twitter, truyền preserveProfile
  cli/
    commands/
      auth.js                # NEW — xactions auth --launch-chrome
      login.js               # UPDATE — xử lý --cdp stub từ 12.1 (dispatch hoặc loại bỏ)
    index.js                 # UPDATE — registerAuthCommand(program)
  utils/
    gaussian-delay.js        # NEW — wrapper quanh gaussianRandom từ antiDetection.js
  agents/
    antiDetection.js         # UPDATE — export gaussianRandom nếu cần
tests/
  core/cdp-launcher.test.js  # NEW
  cli/auth.test.js           # NEW
  scrapers/adapters/playwright.test.js # UPDATE — test preserveProfile + connect
  scrapers/adapters/puppeteer.test.js  # UPDATE — test preserveProfile + connect
types/
  core.d.ts                  # UPDATE — AbstractCrawler constructor cdpUrl + NewPageOptions preserveProfile
```

### Library & Framework Requirements

* **Không thêm dependency mới**. Dùng `playwright`, `puppeteer`, `chalk`, `ora`, `commander`, `node:child_process`, `node:os`, `node:path`, `node:fs/promises`, `node:http`.
* **qrcode-terminal** (`^0.12.0`) đã có cho Story 12.1; Story 12.2 không dùng.
* **Playwright `connectOverCDP`**: cần playwright >= 1.10; hiện tại `^1.62.1` đáp ứng.
* **Puppeteer `connect`**: cần puppeteer >= 5; hiện tại `^24.34.0` đáp ứng.

### Testing Requirements

* **Framework**: Vitest 4.x, `*.test.js`, ESM.
* **No mocks unless necessary**: Ưu tiên real implementation với stubbed subprocess / HTTP endpoint. Có thể mock `playwright.chromium.connectOverCDP` và `puppeteer.connect`.
* **Coverage**:
  * `gaussianDelay` trả về đúng khoảng và ≥ 0.
  * `fetchCdpWsEndpoint` parse JSON từ `/json/version`.
  * `PlaywrightAdapter.connect` / `PuppeteerAdapter.connect` (đã tồn tại) trả về adapter-shaped browser.
  * `PlaywrightAdapter.newPage` / `PuppeteerAdapter.newPage` với `preserveProfile: true` không set viewport/user-agent.
  * CLI parse flags `--launch-chrome`, `--port`, `--user-data-dir`.
  * Error path: CDP endpoint unreachable, Chrome path not found.
* **NFR**: full suite `npx vitest run` phải vẫn 0 failed; không regression ở `tests/core/crawler-governor.test.js` hay `tests/scrapers/**`.

### ATDD Artifacts
* Checklist: `_bmad-output/test-artifacts/atdd-checklist-12-2-cdp-remote-attach-mode-chrome-devtools-protocol.md`
* Core Tests: `tests/core/cdp-launcher.test.js`
* Delay Tests: `tests/utils/gaussian-delay.test.js`
* CLI Tests: `tests/cli/auth.test.js`

### Project Structure Notes

* `src/core/cdp-launcher.js` phải **zero npm deps** — không `import 'playwright'` tĩnh. Dùng dynamic `import('../scrapers/adapters/index.js')` trong runtime hoặc delegate `connect()` cho adapter.
* `src/scrapers/adapters/base.js` là nơi định nghĩa `connect()` chuẩn; không duplicate logic connect trong từng scraper. **Note**: Playwright/Puppeteer `connect()` đã implement, dev chỉ cần bổ sung `preserveProfile` trong `newPage()`.
* `src/cli/commands/auth.js` phải tách biệt command registration khỏi `src/cli/index.js`, tương tự pattern `registerConnectCommand`, `registerDoctorCommand`.
* `src/cli/commands/login.js` đã có `--cdp` stub từ Story 12.1; cần quyết định dispatch sang `auth --launch-chrome` hoặc loại bỏ để tránh nhầm lẫn.
* `AbstractCrawler` giữ tính trừu tượng; CDP launch helper có thể là instance method hoặc utility function được gọi trong `init()` của crawler con.
* Không xóa hay thay đổi API của `src/scrapers/twitter/index.js` và `src/scrapers/facebook/core.js` để bảo toàn backward compatibility; chỉ thêm option `preserveProfile`.
* CDP mode detection: truyền flag qua `AdapterBrowser` (ví dụ `_cdp: true`) hoặc qua `options.preserveProfile` khi gọi `newPage`, để adapter biết khi nào giữ nguyên profile.

### References

* `[Source: _bmad-output/planning-artifacts/epics.md#Epic 12 / Story 12.2]` — User story, acceptance gốc, dependency với Epic 18.3.
* `[Source: _bmad-output/planning-artifacts/prd.md#Nhóm 3: Xác Thực Không Ma Sát]` — FR-69 CDP Remote Attach Mode.
* `[Source: _bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md#AD-5]` — CDP Attach Mode, Chrome flags, Gaussian Jitter, Sticky IP.
* `[Source: _bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md#AD-15]` — Error message convention, TTY detection.
* `[Source: _bmad-output/planning-artifacts/ux/EXPERIENCE-UNIVERSAL-2026-08-21.md#CDP Remote Attach Flow]` — Flow R1: `xactions auth --launch-chrome` → CDP → jitter 3-7s.
* `[Source: src/scrapers/adapters/base.js]` — `BaseAdapter.connect()` abstract method (line 126-133).
* `[Source: src/scrapers/adapters/playwright.js]` — `PlaywrightAdapter.connect()` dùng `connectOverCDP` (line 296-309).
* `[Source: src/scrapers/adapters/puppeteer.js]` — `PuppeteerAdapter.connect()` fetch WS URL (line 235-258).
* `[Source: src/core/base-crawler.js]` — `AbstractCrawler` constructor, `start()`, `init()` contract.
* `[Source: src/core/base-login.js]` — `AbstractLogin` contract `{ accountId, cookies, tokens, expiresAt }`.
* `[Source: src/core/session-manager.js]` — `SessionManager` lưu trữ session.
* `[Source: src/core/error-envelope.js]` — `PlatformError` hierarchy and `ErrorTypes`.
* `[Source: src/scrapers/twitter/index.js]` — `createBrowser({ adapter })`, `createPage(browser)`.
* `[Source: src/scrapers/facebook/core.js]` — `createBrowser`, `createPage`.
* `[Source: src/cli/commands/login.js]` — Existing `login --cdp` stub from 12.1.
* `[Source: src/cli/commands/connect.js]` — Pattern register CLI command với spinner, message, cleanup.
* `[Source: src/cli/index.js]` — Import và đăng ký command.
* `[Source: src/agents/antiDetection.js]` — `gaussianRandom`, `addJitter`.
* `[Source: package.json]` — Playwright, Puppeteer versions, CLI bin `xactions`.
* `[Source: types/core.d.ts]` — AbstractCrawler constructor types.

---

## Dev Agent Record

### Agent Model Used

Devin (SWE-1.7 Max) + Serena LSP context.

### Debug Log References

* `src/core/cdp-launcher.js` — CDP connection logic, Chrome spawn, error envelope.
* `src/scrapers/adapters/playwright.js` — `connectOverCDP` + `newPage(preserveProfile)`.
* `src/scrapers/adapters/puppeteer.js` — WebSocket debugger URL fetch + `newPage(preserveProfile)`.
* `src/cli/commands/auth.js` — Chrome launch helper CLI.
* `src/cli/commands/login.js` — CDP flag dispatch từ 12.1.

### Completion Notes List

* [x] `launchBrowserWithCdp(cdpUrl)` implemented and returns adapter-shaped browser.
* [x] `xactions auth --launch-chrome` spawns Chrome with `--remote-debugging-port=9222`.
* [x] Gaussian Jitter helper created and used in CDP scraping path.
* [x] Adapters implement `connect(cdpUrl, options)` (already done) and `newPage({ preserveProfile: true })`.
* [x] `AbstractCrawler` accepts `cdpUrl` và CDP session passed from CLI.
* [x] Tests added and full suite passes (182 files, 3999 tests passed, 0 failures).

### File List

* `src/core/cdp-launcher.js` (NEW)
* `src/utils/gaussian-delay.js` (NEW)
* `src/cli/commands/auth.js` (NEW)
* `src/scrapers/adapters/base.js` (UPDATE — preserveProfile option)
* `src/scrapers/adapters/playwright.js` (UPDATE — preserveProfile)
* `src/scrapers/adapters/puppeteer.js` (UPDATE — preserveProfile)
* `src/core/base-crawler.js` (UPDATE)
* `src/cli/commands/login.js` (UPDATE — xử lý stub --cdp)
* `src/cli/index.js` (UPDATE)
* `src/core/index.js` (UPDATE — export)
* `src/agents/antiDetection.js` (UPDATE — export gaussianRandom)
* `src/scrapers/twitter/index.js` (UPDATE — preserveProfile passthrough)
* `src/scrapers/facebook/core.js` (UPDATE — preserveProfile passthrough)
* `types/core.d.ts` (UPDATE)
* `tests/core/cdp-launcher.test.js` (NEW)
* `tests/cli/auth.test.js` (NEW)
* `tests/scrapers/adapters/playwright.test.js` (UPDATE or NEW)
* `tests/scrapers/adapters/puppeteer.test.js` (UPDATE or NEW)

### Review Findings

- [x] [Review][Patch] Await getAdapter() call in launchBrowserWithCdp [`src/core/cdp-launcher.js:226`]
- [x] [Review][Patch] Box-Muller u1 === 0 guard against -Infinity [`src/utils/gaussian-delay.js:4-6`]
- [x] [Review][Patch] Add min <= max normalization in gaussianRandom [`src/utils/gaussian-delay.js:14`]
- [x] [Review][Patch] Prevent unhandled error event on spawned Chrome child process [`src/core/cdp-launcher.js:146`]
- [x] [Review][Patch] Terminate spawned Chrome process on polling timeout [`src/core/cdp-launcher.js:160-170`]
- [x] [Review][Patch] Safe protocol normalization for cdpUrl [`src/core/cdp-launcher.js:71`]
- [x] [Review][Patch] Explicitly bind remote debugging to 127.0.0.1 [`src/core/cdp-launcher.js:56`]
