# Story 12.1 — Terminal ASCII QR Code Login Module with Countdown & Timeout

**Story ID:** 12.1  
**Epic:** 12 — Frictionless Authentication (Terminal QR & CDP Attach)  
**Status:** ready-for-dev  
**Owner:** DEV  
**Source:** `epics.md` Story 12.1, `prd.md` FR-68, `ARCHITECTURE-SPINE.md` AD-5 & AD-15, `ux/EXPERIENCE-UNIVERSAL-2026-08-21.md` Flows C1/C2, existing `src/utils/qrcode.js`, `src/core/base-login.js`, `src/cli/index.js`, `src/core/session-manager.js`, `src/client/Scraper.js`.

---

```yaml
baseline_commit: f6240457f5c6c0f7a8f6b8e3b8c8d9e0f1a2b3c4d
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
* **When` lỗi xảy ra trong quá trình QR login
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

- [ ] **Task 1: Mở rộng `src/utils/qrcode.js`** (AC-1)
  - [ ] 1.1 Thêm/đổi tên `renderTerminalQr` thành `displayTerminalQrCode(data, options)`
  - [ ] 1.2 Hỗ trợ `small: true`, tự động fit terminal width, optional `showUrl`
  - [ ] 1.3 Giữ backward compat với `renderTerminalQr` cũ nếu đang được dùng
- [ ] **Task 2: Tạo `src/core/login/terminal-qr.js`** (AC-2, AC-5, AC-6)
  - [ ] 2.1 `class TerminalQrLogin extends AbstractLogin`
  - [ ] 2.2 Implement `login()` với countdown, polling 1s, timeout 120s
  - [ ] 2.3 `generateShortCode()` cho non-TTY
  - [ ] 2.4 Save cookies + `SessionManager.set()`
- [ ] **Task 3: Cập nhật CLI `src/cli/index.js`** (AC-3, AC-4, AC-7)
  - [ ] 3.1 Thêm options `--qr`, `--qr-url`, `--push`, `--cdp`, `--platform`, `--timeout` cho command `login`
  - [ ] 3.2 Điều phối TTY vs non-TTY
  - [ ] 3.3 Giữ flow nhập cookie thủ công khi không có `--qr`
- [ ] **Task 4: Tích hợp `SessionManager` và cookie storage** (AC-6)
  - [ ] 4.1 Đọc/ghi `~/.xactions/cookies.json` với fs `mode 0o600`
  - [ ] 4.2 Map platform → required cookies (`twitter: auth_token, ct0`; `facebook: c_user, xs`)
  - [ ] 4.3 Optional verify bằng `Scraper.me()` cho Twitter
- [ ] **Task 5: Xử lý lỗi theo convention** (AC-7)
  - [ ] 5.1 Dùng `PlatformError` với `type: 'TIMEOUT' | 'CHECKPOINT' | 'INVALID'` và prefix `[QR ...]`
  - [ ] 5.2 Không leak stack trace
- [ ] **Task 6: Viết tests** (AC-8)
  - [ ] 6.1 `tests/utils/qrcode.test.js`
  - [ ] 6.2 `tests/core/login/terminal-qr.test.js`
  - [ ] 6.3 `tests/cli/login.test.js`

---

## Dev Notes

### Architecture Compliance

* **AD-5 — Non-Invasive Authentication via Terminal QR & CDP Attach [ADOPTED]** — `src/core/base-login.js`, `src/utils/qrcode.js`, `src/core/session-manager.js`  
  * Rule 2: `AbstractLogin` contract trả về `{ accountId, cookies, tokens, expiresAt }`. `TerminalQrLogin` phải tuân thủ.
  * Rule 3: Sticky IP cho auth-required platforms; `SessionManager` lưu `accountId`; `ProxyIpPool.getStickyProxy(accountId)` phải được gọi nếu cần proxy (không bắt buộc cho QR login nhưng nên lưu `accountId` để crawler sau dùng).
  * Rule 4: Terminal ASCII QR code tỷ lệ 1:1 với `qrcode-terminal` (small: true), 60s countdown, 120s timeout, polling cookie ngầm.

* **AD-15 — Terminal QR Login with Non-TTY Fallback & Clear Auth Feedback [ADOPTED-NEW]** — `src/core/base-login.js`, `src/utils/qrcode.js`, `src/cli/login.js`  
  * Rule 1: Tự động phát hiện TTY; non-TTY thì in URL + short code.
  * Rule 2: Countdown overwrite trên cùng một dòng.
  * Rule 3: Error messages dùng prefix `[QR EXPIRED]`, `[ACCOUNT CHECKPOINTED]`, `[QR INVALID]`, `[LOGIN FAILED]`.

* **AD-2 — Error Envelope Hierarchy [ADOPTED]** — `src/core/error-envelope.js`  
  * Mọi lỗi QR phải là `PlatformError` với `type`, `code`, `suggestedAction`, `platform`, `details`. Không throw raw `Error`.

* **AD-3 — Zero core dependencies [ADOPTED]** — `src/core/` không được phép có npm dependencies. `src/core/login/terminal-qr.js` chỉ được dùng built-in Node và dynamic `import()` nếu cần. `qrcode-terminal` là dev/CLI dep, có thể import trong `src/utils/qrcode.js` (không thuộc `src/core/`).

### Technical Requirements

* **Runtime**: ESM Node.js >= 20.18.1, `type: "module"`.
* **QR rendering**: `qrcode-terminal` `^0.12.0` đã có trong `package.json`. API:
  ```js
  qrcode.generate(text, { small: true }, (output) => { ... })
  ```
  `displayTerminalQrCode` nên là wrapper async xung quanh API này.
* **TTY detection**: `process.stdout.isTTY` (đã có `isTty()` trong `src/utils/qrcode.js`).
* **Cookie path**: `~/.xactions/cookies.json` (tương tự `connect.js`). Nếu multi-platform, có thể dùng `~/.xactions/cookies-<platform>.json`.
* **File permissions**: `0o600` khi ghi cookie file (như `connect.js` `mode: 0o600`).
* **Polling**: dùng `setInterval` hoặc `for` loop với `await setTimeout(1000)`. Nên dùng fake timers trong tests.
* **Short code**: 6 ký tự alphanumeric, loại trừ `0`, `O`, `I`, `1`, `l` để tránh nhầm lẫn.
* **Countdown UX**: dùng `process.stdout.write('\r\x1b[K')` để xóa dòng trước khi in mới, hoặc `process.stdout.clearLine(0) + cursorTo(0)`.

### File Structure Requirements

```
src/
  core/
    base-login.js              # EXISTING — keep abstract contract
    login/
      terminal-qr.js           # NEW — TerminalQrLogin class
    types.js                   # EXISTING — LoginResult typedef
    session-manager.js         # EXISTING — store session after login
    error-envelope.js          # EXISTING — PlatformError
  utils/
    qrcode.js                  # UPDATE — add displayTerminalQrCode
  cli/
    index.js                   # UPDATE — login command options
  client/
    Scraper.js                 # REFERENCE — setCookies / me() for verify
  scrapers/
    twitter/index.js           # REFERENCE — loginWithCookie
    facebook/index.js          # REFERENCE — loginWithCookie
tests/
  utils/qrcode.test.js         # NEW
  core/login/terminal-qr.test.js # NEW
  cli/login.test.js            # NEW
types/
  core.d.ts                    # UPDATE — TerminalQrLogin? (optional)
```

### Library & Framework Requirements

* **Không thêm dependency mới**. Dùng `qrcode-terminal` (`^0.12.0`), `chalk` (`^5.3.0`), `ora` (`^8.0.0`), `commander` (`^12.0.0`), `inquirer` (`^9.2.0`), `node:fs/promises`, `node:os`, `node:path`.
* `src/core/login/terminal-qr.js` **không được** import `qrcode-terminal` tĩnh. Nếu cần render, nhận `renderQr` callback từ `src/utils/qrcode.js` hoặc dùng dynamic import.

### Testing Requirements

* **Framework**: Vitest 4.x, `*.test.js`, ESM.
* **No mocks unless necessary**: Ưu tiên real `qrcode-terminal` output. Có thể stub `fs`/`setTimeout` cho timeout/polling tests.
* **Fake timers**: dùng `vi.useFakeTimers()` để test 120s timeout mà không chờ thực.
* **Coverage**:
  * `displayTerminalQrCode` trả về string output.
  * `TerminalQrLogin` resolve/reject đúng.
  * CLI parse flags.
  * Cookie file permissions.
* **NFR**: full suite `npx vitest run` 0 failed.

### Project Structure Notes

* `src/utils/qrcode.js` giữ mọi thứ về QR rendering; `src/core/login/terminal-qr.js` giữ logic login/orchestration. Không trộn logic countdown/polling vào `src/utils/qrcode.js`.
* `src/cli/index.js` command `login` vẫn là command cấp cao; QR logic được delegate vào `TerminalQrLogin`.
* Giữ backward compatibility: `xactions login` không có flag vẫn hỏi `auth_token` + `ct0`.
* `AbstractLogin` contract trong `src/core/base-login.js` không thay đổi signature; `TerminalQrLogin` extends và implement.

### References

* `[Source: _bmad-output/planning-artifacts/epics.md#Epic 12 / Story 12.1]` — User story, 2 AC gốc.
* `[Source: _bmad-output/planning-artifacts/prd.md#Nhóm 3: Xác Thực Không Ma Sát]` — FR-68 Terminal ASCII QR Code Login.
* `[Source: _bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md#AD-5]` — Non-Invasive Authentication, QR/CDP contract.
* `[Source: _bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md#AD-15]` — Non-TTY fallback & error message convention.
* `[Source: _bmad-output/planning-artifacts/ux/EXPERIENCE-UNIVERSAL-2026-08-21.md#CLI Flows]` — Flow C1/C2: TTY QR vs non-TTY URL + short code.
* `[Source: src/utils/qrcode.js]` — `renderTerminalQr` và `isTty()`.
* `[Source: src/core/base-login.js]` — `AbstractLogin` contract.
* `[Source: src/core/types.js]` — `LoginResult` typedef.
* `[Source: src/core/session-manager.js]` — `SessionManager.set()`.
* `[Source: src/core/error-envelope.js]` — `PlatformError`, `ErrorTypes`, `SuggestedActions`.
* `[Source: src/cli/index.js]` — command `login` hiện tại.
* `[Source: src/cli/commands/connect.js]` — pattern lưu cookie `0o600` và verify session.
* `[Source: src/client/Scraper.js]` — `setCookies`, `loadCookies`, `me()`.
* `[Source: src/scrapers/twitter/index.js]` — `loginWithCookie` và cookie shape.
* `[Source: package.json]` — `qrcode-terminal`, `chalk`, `ora`, `commander`, `inquirer` versions.

---

## Dev Agent Record

### Agent Model Used

Devin (SWE-1.7 Max) + Serena LSP context.

### Debug Log References

* `src/utils/qrcode.js` — QR ASCII rendering.
* `src/core/login/terminal-qr.js` — login orchestration, countdown, polling.
* `src/cli/index.js` — `login` command flags and flow dispatch.
* `src/core/session-manager.js` — session persistence.

### Completion Notes List

* [ ] `displayTerminalQrCode` implemented and renders scannable ASCII QR.
* [ ] `TerminalQrLogin` extends `AbstractLogin` and returns `LoginResult`.
* [ ] Countdown 60s + timeout 120s + 1s polling implemented.
* [ ] TTY detection and non-TTY URL/short code fallback implemented.
* [ ] CLI `xactions login --qr --platform <twitter|facebook>` works.
* [ ] Error messages follow `[QR ...]` convention.
* [ ] Cookie saved securely (`0o600`) and `SessionManager` updated.
* [ ] Tests added and full suite passes.

### File List

* `src/utils/qrcode.js` (UPDATE)
* `src/core/login/terminal-qr.js` (NEW)
* `src/cli/index.js` (UPDATE)
* `src/core/index.js` (UPDATE — optional export `TerminalQrLogin`)
* `types/core.d.ts` (UPDATE — optional)
* `tests/utils/qrcode.test.js` (NEW)
* `tests/core/login/terminal-qr.test.js` (NEW)
* `tests/cli/login.test.js` (NEW)
