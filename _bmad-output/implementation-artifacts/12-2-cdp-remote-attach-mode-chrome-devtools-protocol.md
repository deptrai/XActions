# Story 12.2 — CDP Remote Attach Mode with Launch Helper & Gaussian Jitter

**Story ID:** 12.2  
**Epic:** 12 — Frictionless Authentication (Terminal QR & CDP Attach)  
**Status:** ready-for-dev  
**Owner:** DEV  
**Source:** `epics.md` Story 12.2, `prd.md` FR-69, `ARCHITECTURE-SPINE.md` AD-5 & AD-15, `ux/EXPERIENCE-UNIVERSAL-2026-08-21.md` Flow R1, existing `src/scrapers/adapters/**`, `src/core/base-crawler.js`, `src/core/base-login.js`, `src/cli/commands/connect.js`, `src/agents/antiDetection.js`.

---

```yaml
baseline_commit: 7a27c5e7f5c6c0f7a8f6b8e3b8c8d9e0f1a2b3c4d
```

---

## Story

As a **Power User**,  
I want **kết nối XActions trực tiếp vào Chrome thật của tôi qua cổng 9222 với helper tự mở Chrome và độ trễ ngẫu nhiên Gaussian**,  
so that **hệ thống sử dụng nguyên vẹn profile và fingerprint thật của tôi để cào LinkedIn/TopCV mà không bị phát hiện automation**.

---

## Acceptance Criteria

### AC-1: CLI helper `xactions auth --launch-chrome` mở Chrome với CDP port

* **Given** user chạy `xactions auth --launch-chrome` (hoặc `unfollowx auth --launch-chrome` để tương thích ngược) từ terminal
* **When** CLI xử lý lệnh
* **Then** hệ thống phát hiện đường dẫn Chrome theo platform (macOS/Windows/Linux) và spawn Chrome với flags:  
  `--remote-debugging-port=9222 --user-data-dir=<dedicated>` (và các flags chống automation leak nếu cần)
* **And** in ra terminal thông tin: `CDP listening on http://localhost:9222`, hướng dẫn user đăng nhập thủ công trên Chrome thật
* **And** hỗ trợ `--port <n>` để đổi cổng, `--user-data-dir <path>` để dùng profile riêng, `--headful` mặc định (mở cửa sổ Chrome thật)
* **And** nếu Chrome đã mở trên port đó, CLI in cảnh báo và dùng endpoint hiện có thay vì spawn mới

### AC-2: `launchBrowserWithCdp(cdpUrl)` kết nối Playwright/Puppeteer vào Chrome thật

* **Given** `src/core/cdp-launcher.js` export `launchBrowserWithCdp(cdpUrl)` nhận `cdpUrl` dạng `http://localhost:9222`
* **When** gọi `await launchBrowserWithCdp('http://localhost:9222')`
* **Then** nếu `XACTIONS_SCRAPER_ADAPTER=playwright` hoặc adapter mặc định là `playwright`, sử dụng `playwright.chromium.connectOverCDP(cdpUrl)` để lấy `Browser` từ Chrome thật
* **And** nếu dùng `puppeteer`, sử dụng `puppeteer.connect({ browserWSEndpoint: <ws từ http://localhost:9222/json/version> })`
* **And** trả về một `AdapterBrowser` hợp đồng hiện tại: `{ _native, _adapter: 'playwright' | 'puppeteer', _browserType: 'chromium' }`, tương thích với `createPage()` của `src/scrapers/twitter/index.js` và `src/scrapers/facebook/index.js`
* **And** nếu kết nối thất bại, throw `PlatformError({ type: PROXY_EXHAUSTED hoặc AUTH_EXPIRED tùy lỗi, code: 'XACT_5030' | 'XACT_4010', suggestedAction: 'RELOGIN' | 'CONTACT_SUPPORT' })` với message rõ ràng

### AC-3: Adapter contract mở rộng `connect(cdpUrl, options)`

* **Given** `src/scrapers/adapters/base.js` định nghĩa phương thức `async connect(cdpUrl, options = {})`
* **When** `PlaywrightAdapter.connect()` được gọi với `cdpUrl`
* **Then** sử dụng `chromium.connectOverCDP(cdpUrl, options)` và trả về `{ _native, _adapter: this.name, _browserType: 'chromium' }`
* **And** khi `PuppeteerAdapter.connect()` được gọi, nó gọi `GET http://<host>:<port>/json/version` để lấy `webSocketDebuggerUrl`, rồi `puppeteer.connect({ browserWSEndpoint, defaultViewport: null })` để giữ nguyên viewport/profile của Chrome thật
* **And** `src/scrapers/adapters/index.js` hỗ trợ `getAdapter().connect(cdpUrl)` và giữ backward-compatible với `launch()`

### AC-4: `AbstractCrawler` khởi tạo trang qua CDP trong `init()`

* **Given** `src/core/base-crawler.js` có phương thức `async init()`
* **When** một crawler con (ví dụ `LinkedInCrawler` tương lai) gọi `await this.launchBrowserWithCdp(session.cdpUrl)` trong `init()`
* **Then** `launchBrowserWithCdp` trả về browser + page mà không spawn process mới
* **And** crawler lưu page/browser vào `this.page` / `this.browser` để tái sử dụng trong các action `search()`, `getPostDetail()`, `getComments()`
* **And** `AbstractCrawler` constructor chấp nhận `deps.cdpUrl` hoặc `deps.client` đã có CDP; `types/core.d.ts` cập nhật `AbstractCrawler` constructor option thêm `cdpUrl?: string`

### AC-5: Gaussian Jitter 3–7s giữa các thao tác cào

* **Given** hệ thống đang chạy CDP attach mode
* **When** crawler thực hiện liên tiếp các hành động (goto, evaluate, scroll, click)
* **Then** mỗi khoảng nghỉ được tính bằng phân phối Gaussian với `mean = 5000ms`, `stdev = 1000ms`, sau đó clamp vào `[3000, 7000]` ms
* **And** helper `gaussianDelay(min, max, mean, stdev)` được đặt tại `src/utils/gaussian-delay.js` và có thể dùng `AntiDetection.addJitter` từ `src/agents/antiDetection.js` làm tham khảo (Box-Muller)
* **And** jitter chỉ áp dụng khi `requiresAuth === true` hoặc option `cdp: true` được bật, không làm chậm HTTP-only path

### AC-6: Không ghi đè profile/fingerprint thật của Chrome

* **Given` Chrome được attach qua CDP
* **When** `createPage(browser)` được gọi
* **Then** không set viewport, user agent, cookie, hoặc `evaluateOnNewDocument` stealth patches vô tội vạ — phải giữ nguyên profile đang mở
* **And** chỉ set cookie/headers khi action yêu cầu (qua `page.context().addCookies` cho Playwright hoặc `page.setCookie` cho Puppeteer), và phải lấy từ `SessionManager`
* **And** không dùng `--headless` khi attach; Chrome thật đã headful theo mặc định

### AC-7: Xử lý lỗi CDP rõ ràng và actionable

* **Given` Chrome chưa mở cổng 9222, hoặc đã đóng, hoặc không tìm thấy Chrome executable
* **When` `launchBrowserWithCdp()` hoặc `xactions auth --launch-chrome` gặp lỗi
* **Then** throw/in ra `PlatformError` hoặc message với prefix `[CDP ERROR]`:
  * `Chrome not found at <path>. Install Chrome or set --chrome-path.`
  * `Could not connect to Chrome on port 9222. Run 'xactions auth --launch-chrome' first.`
  * `Chrome DevTools endpoint returned empty. Please refresh the browser and retry.`
* **And` CLI không crash với stack trace dài; `process.exitCode = 1` nếu lỗi nghiêm trọng

### AC-8: Kiểm thử

* **Given` test suite chạy
* **When` chạy `npx vitest run tests/core/cdp-launcher.test.js tests/cli/auth.test.js`
* **Then** tất cả test pass, bao gồm:
  * Unit test `gaussianDelay` trả về giá trị trong `[3000, 7000]`
  * Unit test `launchBrowserWithCdp` với mock CDP JSON endpoint (không cần Chrome thật)
  * Unit test `PlaywrightAdapter.connect` / `PuppeteerAdapter.connect` mock `connectOverCDP` / `puppeteer.connect`
  * Unit test CLI parser `xactions auth --launch-chrome --port 9333` parse đúng flags
  * Integration test (optional, marked skip nếu không có Chrome thật) kiểm tra Chrome path detection
* **And` full suite vẫn pass: `npx vitest run` với 0 regression

---

## Tasks / Subtasks

- [ ] **Task 1: Tạo module CDP launcher core** (AC-2, AC-7)
  - [ ] 1.1 Tạo `src/core/cdp-launcher.js` với `launchBrowserWithCdp(cdpUrl)` và `fetchCdpWsEndpoint(cdpUrl)`
  - [ ] 1.2 Tạo `src/utils/gaussian-delay.js` với `gaussianDelay(min, max, mean, stdev)`
  - [ ] 1.3 Export từ `src/core/index.js` nếu cần
- [ ] **Task 2: Mở rộng Adapter contract với `connect()`** (AC-3)
  - [ ] 2.1 Thêm `connect(cdpUrl, options)` vào `BaseAdapter`
  - [ ] 2.2 Implement `PlaywrightAdapter.connect()` dùng `chromium.connectOverCDP`
  - [ ] 2.3 Implement `PuppeteerAdapter.connect()` dùng `puppeteer.connect` với WebSocket debugger URL
  - [ ] 2.4 Cập nhật `types` nếu cần
- [ ] **Task 3: Tích hợp CDP vào `AbstractCrawler`** (AC-4)
  - [ ] 3.1 Thêm `launchBrowserWithCdp(cdpUrl)` vào `src/core/base-crawler.js` hoặc import từ `cdp-launcher`
  - [ ] 3.2 Cập nhật `AbstractCrawler` constructor nhận `cdpUrl`
  - [ ] 3.3 Cập nhật `types/core.d.ts` cho `AbstractCrawler` constructor
- [ ] **Task 4: Xây dựng CLI `auth` với `--launch-chrome`** (AC-1, AC-7)
  - [ ] 4.1 Tạo `src/cli/commands/auth.js` với `authCommand` và `registerAuthCommand`
  - [ ] 4.2 Thêm `xactions auth --launch-chrome --port <n> --user-data-dir <path>`
  - [ ] 4.3 Đăng ký command trong `src/cli/index.js`
  - [ ] 4.4 Hỗ trợ detect Chrome executable theo platform
- [ ] **Task 5: Áp dụng Gaussian Jitter** (AC-5)
  - [ ] 5.1 Sử dụng `gaussianDelay` trong crawler actions khi `cdp: true`
  - [ ] 5.2 Đảm bảo jitter không làm chậm HTTP path
- [ ] **Task 6: Viết tests** (AC-8)
  - [ ] 6.1 `tests/core/cdp-launcher.test.js`
  - [ ] 6.2 `tests/cli/auth.test.js`
  - [ ] 6.3 Bổ sung unit test cho `PlaywrightAdapter.connect` / `PuppeteerAdapter.connect`

---

## Dev Notes

### Architecture Compliance

* **AD-5 — Non-Invasive Authentication via Terminal QR & CDP Attach [ADOPTED]** — `src/core/base-login.js`, `src/utils/qrcode.js`, `src/core/session-manager.js`  
  * Rule 2: Kết nối vào Chrome thật qua cổng 9222; Chrome phải được launch với `--remote-debugging-port=9222` và `--user-data-dir=<dedicated>`. Áp dụng Gaussian Jitter (3–7s) khi cào LinkedIn/TopCV.
  * Rule 3: `AbstractLogin` contract trả về `{ accountId, cookies, tokens, expiresAt }`. Mọi QR/CDP/cookie flow phải cùng shape.
  * Rule 4: Auth-required platforms bắt buộc sticky IP; `SessionManager` lưu `accountId`; `ProxyIpPool.getStickyProxy(accountId)` trả về proxy được gán.

* **AD-15 — Terminal QR Login with Non-TTY Fallback & Clear Auth Feedback [ADOPTED-NEW]** — `src/core/base-login.js`, `src/utils/qrcode.js`, `src/cli/login.js`  
  * Rule 3: Error messages dùng prefix rõ ràng, ví dụ `[QR EXPIRED] ...` hoặc `[ACCOUNT CHECKPOINTED] ...`. CDP errors phải theo cùng convention: `[CDP ERROR] ...`.

* **AD-2 — Error Envelope Hierarchy [ADOPTED]** — `src/core/error-envelope.js`  
  * Mọi lỗi CDP phải là `PlatformError` với `type`, `code`, `suggestedAction`, `platform`, `details`. Không throw raw `Error`.

* **AD-3 — Zero core dependencies [ADOPTED]** — `src/core/` không được phép có npm dependencies. `src/core/cdp-launcher.js` chỉ được dùng built-in Node (`child_process`, `fs`, `path`, `os`, `http`) và dynamic `import()` cho `playwright`/`puppeteer` trong runtime. Logic kết nối thực sự nên ở `src/scrapers/adapters/`.

* **AD-9 — Multi-Framework Adapter Layer [ADOPTED]** — `src/scrapers/adapters/`  
  * Mọi tương tác browser phải đi qua adapter. CDP attach phải là một phương thức `connect()` trong adapter contract, không phải logic ad-hoc trong scraper.

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
* **Gaussian Jitter**: dùng Box-Muller transform, clamp `[3000, 7000]` ms. Có thể tái sử dụng `gaussianRandom` trong `src/agents/antiDetection.js`.
* **TTY / Non-TTY**: CLI phát hiện `process.stdout.isTTY` để in hướng dẫn phù hợp.

### File Structure Requirements

```
src/
  core/
    cdp-launcher.js          # NEW — launchBrowserWithCdp + Chrome spawn helper
    base-crawler.js          # UPDATE — integrate cdpUrl / launchBrowserWithCdp
  scrapers/
    adapters/
      base.js                # UPDATE — add abstract connect()
      playwright.js          # UPDATE — implement connectOverCDP
      puppeteer.js           # UPDATE — implement connect via WS endpoint
    twitter/index.js         # PRESERVE — createBrowser/createPage vẫn hoạt động
    facebook/index.js        # PRESERVE — createBrowser/createPage vẫn hoạt động
  cli/
    commands/
      auth.js                # NEW — xactions auth --launch-chrome
    index.js                 # UPDATE — registerAuthCommand(program)
  utils/
    gaussian-delay.js        # NEW
  agents/
    antiDetection.js         # REFERENCE — use gaussianRandom pattern
tests/
  core/cdp-launcher.test.js  # NEW
  cli/auth.test.js           # NEW
  scrapers/adapters/playwright.test.js # UPDATE or NEW — test connect()
  scrapers/adapters/puppeteer.test.js  # UPDATE or NEW — test connect()
types/
  core.d.ts                  # UPDATE — AbstractCrawler constructor cdpUrl
```

### Library & Framework Requirements

* **Không thêm dependency mới**. Dùng `playwright`, `puppeteer`, `chalk`, `ora`, `commander`, `node:child_process`, `node:os`, `node:path`, `node:fs/promises`.
* **qrcode-terminal** (`^0.12.0`) đã có cho Story 12.1; Story 12.2 không dùng.
* **Playwright `connectOverCDP`**: cần playwright >= 1.10; hiện tại `^1.62.1` đáp ứng.
* **Puppeteer `connect`**: cần puppeteer >= 5; hiện tại `^24.34.0` đáp ứng.

### Testing Requirements

* **Framework**: Vitest 4.x, `*.test.js`, ESM.
* **No mocks unless necessary**: Ưu tiên real implementation với stubbed subprocess / HTTP endpoint. Có thể mock `playwright.chromium.connectOverCDP` và `puppeteer.connect`.
* **Coverage**:
  * `gaussianDelay` trả về đúng khoảng và ≥ 0.
  * `fetchCdpWsEndpoint` parse JSON từ `/json/version`.
  * `PlaywrightAdapter.connect` / `PuppeteerAdapter.connect` trả về adapter-shaped browser.
  * CLI parse flags `--launch-chrome`, `--port`, `--user-data-dir`.
  * Error path: CDP endpoint unreachable, Chrome path not found.
* **NFR**: full suite `npx vitest run` phải vẫn 0 failed; không regression ở `tests/core/crawler-governor.test.js` hay `tests/scrapers/**`.

### Project Structure Notes

* `src/core/cdp-launcher.js` phải **zero npm deps** — không `import 'playwright'` tĩnh. Dùng dynamic `import()` trong runtime hoặc delegate cho adapter.
* `src/scrapers/adapters/base.js` là nơi định nghĩa `connect()` chuẩn; không duplicate logic connect trong từng scraper.
* `src/cli/commands/auth.js` phải tách biệt command registration khỏi `src/cli/index.js`, tương tự pattern `registerConnectCommand`, `registerDoctorCommand`.
* `AbstractCrawler` giữ tính trừu tượng; CDP launch helper có thể là instance method hoặc utility function được gọi trong `init()` của crawler con.
* Không xóa hay thay đổi API của `src/scrapers/twitter/index.js` và `src/scrapers/facebook/index.js` để bảo toàn backward compatibility.

### References

* `[Source: _bmad-output/planning-artifacts/epics.md#Epic 12 / Story 12.2]` — User story, 2 AC gốc.
* `[Source: _bmad-output/planning-artifacts/prd.md#Nhóm 3: Xác Thực Không Ma Sát]` — FR-69 CDP Remote Attach Mode.
* `[Source: _bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md#AD-5]` — CDP Attach Mode, Chrome flags, Gaussian Jitter.
* `[Source: _bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md#AD-15]` — Error message convention.
* `[Source: _bmad-output/planning-artifacts/ux/EXPERIENCE-UNIVERSAL-2026-08-21.md#CDP Remote Attach Flow]` — Flow R1: `xactions auth --launch-chrome` → CDP → jitter 3-7s.
* `[Source: src/core/base-crawler.js]` — `AbstractCrawler` constructor, `start()`, `init()` contract.
* `[Source: src/core/base-login.js]` — `AbstractLogin` contract `{ accountId, cookies, tokens, expiresAt }`.
* `[Source: src/core/session-manager.js]` — `SessionManager` lưu trữ session.
* `[Source: src/scrapers/adapters/playwright.js]` — `PlaywrightAdapter.launch()` pattern.
* `[Source: src/scrapers/adapters/puppeteer.js]` — `PuppeteerAdapter.launch()` pattern.
* `[Source: src/scrapers/twitter/index.js]` — `createBrowser({ adapter })`, `createPage(browser)`.
* `[Source: src/cli/commands/connect.js]` — Pattern register CLI command với spinner, message, cleanup.
* `[Source: src/cli/index.js]` — Import và đăng ký command.
* `[Source: src/agents/antiDetection.js]` — `gaussianRandom`, `addJitter`.
* `[Source: package.json]` — Playwright, Puppeteer versions.

---

## Dev Agent Record

### Agent Model Used

Devin (SWE-1.7 Max) + Serena LSP context.

### Debug Log References

* `src/core/cdp-launcher.js` — CDP connection logic, error envelope.
* `src/scrapers/adapters/playwright.js` — `connectOverCDP` integration.
* `src/scrapers/adapters/puppeteer.js` — WebSocket debugger URL fetch + connect.
* `src/cli/commands/auth.js` — Chrome launch helper CLI.

### Completion Notes List

* [ ] `launchBrowserWithCdp(cdpUrl)` implemented and returns adapter-shaped browser.
* [ ] `xactions auth --launch-chrome` spawns Chrome with `--remote-debugging-port=9222`.
* [ ] Gaussian Jitter helper created and used in CDP scraping path.
* [ ] Adapters implement `connect(cdpUrl, options)`.
* [ ] Tests added and full suite passes.

### File List

* `src/core/cdp-launcher.js` (NEW)
* `src/utils/gaussian-delay.js` (NEW)
* `src/scrapers/adapters/base.js` (UPDATE)
* `src/scrapers/adapters/playwright.js` (UPDATE)
* `src/scrapers/adapters/puppeteer.js` (UPDATE)
* `src/core/base-crawler.js` (UPDATE)
* `src/cli/commands/auth.js` (NEW)
* `src/cli/index.js` (UPDATE)
* `src/core/index.js` (UPDATE — optional export)
* `types/core.d.ts` (UPDATE)
* `tests/core/cdp-launcher.test.js` (NEW)
* `tests/cli/auth.test.js` (NEW)
* `tests/scrapers/adapters/playwright.test.js` (UPDATE or NEW)
* `tests/scrapers/adapters/puppeteer.test.js` (UPDATE or NEW)
