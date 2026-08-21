# Story 12.1 — Terminal ASCII QR Code Login Module with Countdown & Timeout

**Story ID:** 12.1  
**Epic:** 12 — Frictionless Authentication (Terminal QR & CDP Attach)  
**Status:** done  
**Owner:** DEV  
**Source:** `epics.md` Story 12.1, `prd.md` FR-68, `ARCHITECTURE-SPINE.md` AD-5 & AD-15, `ux/EXPERIENCE-UNIVERSAL-2026-08-21.md` Flows C1/C2, existing `src/utils/qrcode.js`, `src/core/base-login.js`, `src/cli/index.js`, `src/core/session-manager.js`, `src/client/Scraper.js`.

---

```yaml
baseline_commit: 3aa51d782c5a2bc3f4ec13c7df48ffeb9127814b
```

---

## Story

As a **CLI User**,  
I want **đăng nhập bằng cách quét mã QR ASCII trực tiếp trên terminal với đếm ngược 60s, timeout 120s, và polling cookie ngầm**,  
so that **tôi không cần copy-paste token, không để lộ credential, và quy trình xác thực diễn ra liền mạch trên cả TTY và non-TTY environments**.

---

## Acceptance Criteria

### AC-1: `displayTerminalQrCode(data)` render mã QR ASCII tỉ lệ 1:1 trên terminal

* **Given** `src/utils/qrcode.js` export `displayTerminalQrCode(data, options = {})`
* **When** gọi `await displayTerminalQrCode('https://x.com/i/qr?code=abc123')` từ terminal TTY
* **Then** terminal hiển thị mã QR dạng ASCII với tỉ lệ khối 1:1 (`small: true`), padding phù hợp, và có thể quét bằng điện thoại
* **And** nếu terminal width < 80 cols, tự động dùng `small: true` hoặc thu nhỏ để QR không bị vỡ
* **And** nếu `options.showUrl === true`, in URL/plain text bên dưới QR để user có thể copy fallback

### AC-2: Đếm ngược 60s và timeout 120s với polling 1s

* **Given** QR đã được hiển thị
* **When** hệ thống bắt đầu `checkLoginState()`
* **Then** mỗi giây:
  * Kiểm tra trạng thái đăng nhập qua `cookies.json` hoặc callback `onCheckLoginState`
  * Cập nhật dòng `⏳ Scan the QR code. Expires in XXs...` trên cùng một dòng (overwrite via `process.stdout.write` + `\r`)
  * Dừng ngay khi `checkLoginState()` trả về `true` (đã nhận đủ cookies)
* **And** sau 60s, hiển thị cảnh báo `⚠️  QR expiring soon...` và tiếp tục đếm
* **And** sau 120s, nếu chưa đăng nhập, throw `PlatformError({ type: 'TIMEOUT', code: 'XACT_4080', suggestedAction: 'RETRY' })` với message `[QR EXPIRED] Login timeout (120s). Run again to generate a new QR code.`
* **And** khi thành công, xóa QR khỏi terminal và in `✅ Account active` kèm `accountId`

### AC-3: Hỗ trợ Non-TTY fallback (`--qr-url`, `--push`, `--cdp`)

* **Given** user chạy `xactions login --qr` trong môi trường non-TTY (CI, server, pipe)
* **When** `process.stdout.isTTY === false`
* **Then** thay vì render QR, CLI in URL + short code ra stdout:
  * `Open this URL on your phone: https://x.com/i/qr?code=abc123`
  * `Short code: ABC-123`
* **And** với `--push`, hệ thống gửi notification/short code đến configured push provider (stub/fallback log nếu provider chưa cấu hình)
* **And** với `--cdp`, chuyển sang flow CDP attach của Story 12.2 thay vì QR (re-use `xactions auth --launch-chrome`)

### AC-4: CLI `xactions login --qr` với flags mở rộng

* **Given** `src/cli/index.js` đã có command `login` hỏi `auth_token` + `ct0` thủ công
* **When** refactor command `login` thành `program.command('login').option('--qr', 'Use QR code login').option('--qr-url <url>', 'Provide pre-generated QR URL').option('--push', 'Send push notification for non-TTY').option('--cdp', 'Use CDP attach instead of QR').option('--platform <platform>', 'Platform to authenticate', 'twitter').option('--timeout <seconds>', 'QR timeout', '120')`
* **Then** khi `--qr`, gọi `TerminalQrLogin.login()` và render QR
* **And** khi không `--qr`, giữ nguyên flow nhập cookie thủ công hiện tại để bảo toàn backward compatibility
* **And** khi `--platform facebook`, required cookies là `c_user` và `xs`; khi `--platform twitter` (default), required cookies là `auth_token` và `ct0`

### AC-5: `AbstractLogin` contract và `TerminalQrLogin` implementation

* **Given** `src/core/base-login.js` có class `AbstractLogin` trừu tượng
* **When** tạo `src/core/login/terminal-qr.js` với `class TerminalQrLogin extends AbstractLogin`
* **Then** `TerminalQrLogin` implement `async login()` trả về `LoginResult = { accountId, cookies, tokens, expiresAt }` theo `src/core/types.js`
* **And** constructor nhận `{ platform, requiredCookies, getQrCode, checkLoginState, cookiePath }` — nếu `getQrCode/checkLoginState` chưa có, default dùng file `~/.xactions/cookies.json` hoặc `~/.xactions/cookies-<platform>.json`
* **And** `src/core/login/terminal-qr.js` cung cấp `generateShortCode()` để tạo mã 6 ký tự cho non-TTY

### AC-6: Tự động lưu cookie vào session storage sau khi quét

* **Given** user đã quét QR và `checkLoginState()` trả về `true`
* **When** `TerminalQrLogin.login()` phát hiện đủ required cookies
* **Then** đọc cookies từ nguồn (file hoặc callback), lưu vào `~/.xactions/cookies.json` với `mode 0o600`
* **And** gọi `SessionManager.set(accountId, loginResult)` để các crawler/API client sau này có thể lấy session
* **And** đối với Twitter, nếu có `auth_token` và `ct0`, tùy chọn verify bằng `Scraper.me()` (nếu không có network, skip verify và log warning)

### AC-7: Error messages theo convention `[QR ...]`

* **Given** QR hết hạn, account bị checkpoint, hoặc thiếu cookies
* **When** lỗi xảy ra trong quá trình QR login
* **Then** throw `PlatformError` hoặc in message với prefix rõ ràng:
  * `[QR EXPIRED] ...` — timeout hoặc server-side QR expired
  * `[ACCOUNT CHECKPOINTED] ...` — platform yêu cầu xác minh thêm
  * `[QR INVALID] ...` — QR URL/data không hợp lệ, không thể render
  * `[LOGIN FAILED] ...` — chung chung cho lỗi còn lại
* **And** không in raw stack trace ra terminal; `process.exitCode = 1` khi lỗi nghiêm trọng

### AC-8: Kiểm thử

* **Given** test suite chạy
* **When** chạy `npx vitest run tests/utils/qrcode.test.js tests/core/login/terminal-qr.test.js tests/cli/login.test.js`
* **Then** tất cả test pass, bao gồm:
  * `displayTerminalQrCode` render output chứa ký tự ASCII QR (`\u2588`, `\u2580`, `\u2584` hoặc khoảng trắng)
  * `TerminalQrLogin` timeout sau 120s (dùng fake timers)
  * `TerminalQrLogin` resolve khi `checkLoginState` trả về `true`
  * CLI parser `--qr --platform facebook --timeout 60` parse đúng flags
  * Non-TTY detection trả về URL/short code thay vì QR
  * Cookie saving ghi file với quyền `0o600`
* **And** full suite `npx vitest run` vẫn 0 failed; không regression

---

## Tasks / Subtasks

- [x] **Task 1: Mở rộng `src/utils/qrcode.js`** (AC-1)
  - [x] 1.1 Thêm/đổi tên `renderTerminalQr` thành `displayTerminalQrCode(data, options)`
  - [x] 1.2 Hỗ trợ `small: true`, tự động fit terminal width, optional `showUrl`
  - [x] 1.3 Giữ backward compat với `renderTerminalQr` cũ nếu đang được dùng
- [x] **Task 2: Tạo `src/core/login/terminal-qr.js`** (AC-2, AC-5, AC-6)
  - [x] 2.1 `class TerminalQrLogin extends AbstractLogin`
  - [x] 2.2 Implement `login()` với countdown, polling 1s, timeout 120s
  - [x] 2.3 `generateShortCode()` cho non-TTY với `crypto.randomInt`
  - [x] 2.4 Save cookies + `SessionManager.set()`
- [x] **Task 3: Cập nhật CLI `src/cli/index.js`** (AC-3, AC-4, AC-7)
  - [x] 3.1 Thêm options `--qr`, `--qr-url`, `--push`, `--cdp`, `--platform`, `--timeout` cho command `login`
  - [x] 3.2 Điều phối TTY vs non-TTY
  - [x] 3.3 Giữ flow nhập cookie thủ công khi không có `--qr`
- [x] **Task 4: Tích hợp `SessionManager` và cookie storage** (AC-6)
  - [x] 4.1 Đọc/ghi `~/.xactions/cookies.json` với fs `mode 0o600`
  - [x] 4.2 Map platform → required cookies (`twitter: auth_token, ct0`; `facebook: c_user, xs`)
  - [x] 4.3 Optional verify bằng `Scraper.me()` cho Twitter
- [x] **Task 5: Xử lý lỗi theo convention** (AC-7)
  - [x] 5.1 Dùng `PlatformError` với `type: 'TIMEOUT' | 'CHECKPOINT' | 'INVALID'` và prefix `[QR ...]`
  - [x] 5.2 Không leak stack trace
- [x] **Task 6: Viết tests** (AC-8)
  - [x] 6.1 `tests/utils/qrcode.test.js` (7 tests passing)
  - [x] 6.2 `tests/core/login/terminal-qr.test.js` (9 tests passing)
  - [x] 6.3 `tests/cli/login.test.js` (2 tests passing)

### Review Findings (AI)
- [x] [Review][Patch] Pre-aborted Signal Guard [src/core/login/terminal-qr.js]
- [x] [Review][Patch] In-Flight Poll Locking [src/core/login/terminal-qr.js]
- [x] [Review][Patch] Default Cookie File Polling from disk [src/core/login/terminal-qr.js]
- [x] [Review][Patch] Cookie Key Validation via getRequiredCookies [src/core/login/terminal-qr.js]
- [x] [Review][Patch] Cryptographically Secure Shortcode via crypto.randomInt [src/core/login/terminal-qr.js]
- [x] [Review][Patch] Multi-Platform Cookie Path Isolation [src/core/login/terminal-qr.js]
- [x] [Review][Patch] CLI Safe Timeout & Flags Dispatch (--cdp, --push) [src/cli/index.js]
- [x] [Review][Patch] Comprehensive Test Coverage & 0o600 Permission Tests [tests/core/login/terminal-qr.test.js]

---

## Senior Developer Review (AI)

**Review Outcome:** Approved  
**Review Date:** 2026-08-21  
**Total Action Items:** 8 resolved / 8 total  
**Severity Breakdown:** 4 High, 4 Medium, 0 Low  

### Action Items
- [x] Resolved: Pre-aborted signal rejection implemented.
- [x] Resolved: In-flight polling locking added to prevent overlapping calls.
- [x] Resolved: Default disk cookie polling enabled when no custom callback provided.
- [x] Resolved: Platform required cookie keys validated before resolving login.
- [x] Resolved: Crypto random shortcode generation using `crypto.randomInt`.
- [x] Resolved: Isolated cookie file storage per platform (`cookies.json`, `cookies-<platform>.json`).
- [x] Resolved: Safe timeout parsing and CDP attach dispatch in CLI.
- [x] Resolved: File permissions mode `0o600` verified with automated tests.

---

## Dev Agent Record

### Agent Model Used
Antigravity (SWE-Agent) + Serena LSP context.

### Completion Notes List
* ✅ Implemented `displayTerminalQrCode` with responsive 1:1 ASCII rendering, small matrix for < 80 columns, and plain text Non-TTY fallback.
* ✅ Implemented `TerminalQrLogin` extending `AbstractLogin` with 120s timeout, countdown timer, zero dangling timer leaks, and platform checkpoint handling.
* ✅ Implemented secure shortcode generator using `crypto.randomInt`.
* ✅ Added safe cookie file storage with file mode `0o600` and `SessionManager` integration.
* ✅ Updated CLI `xactions login` with `--qr`, `--qr-url`, `--push`, `--cdp`, `--platform`, `--timeout`.
* ✅ All 18 ATDD unit and integration tests passing cleanly with 0 mocks.

### File List
* `src/utils/qrcode.js` (MODIFIED)
* `src/core/login/terminal-qr.js` (NEW)
* `src/core/index.js` (MODIFIED)
* `src/cli/index.js` (MODIFIED)
* `tests/utils/qrcode.test.js` (NEW)
* `tests/core/login/terminal-qr.test.js` (NEW)
* `tests/cli/login.test.js` (NEW)
* `_bmad-output/implementation-artifacts/atdd-checklist-12-1-terminal-ascii-qr-code-login-module.md` (MODIFIED)
* `_bmad-output/implementation-artifacts/12-1-terminal-ascii-qr-code-login-module.md` (MODIFIED)
* `_bmad-output/implementation-artifacts/sprint-status.yaml` (MODIFIED)

### Change Log
* 2026-08-21: Story 12.1 implemented, reviewed, patched, and verified. Status updated to `done`.
