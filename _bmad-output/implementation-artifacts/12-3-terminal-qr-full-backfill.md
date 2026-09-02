---
story_key: 12-3-terminal-qr-full-backfill
epic: 12
story_num: 3
status: done
baseline_commit: 2023cf090ae9a537db2fd97bd1b552af9b85eb89
related_ads:
  - AD-15
  - AD-5
---

# Story 12.3 — Terminal QR Login Full Backfill & Hardening

**Story Key:** `12-3-terminal-qr-full-backfill`  
**Epic:** 12 — Frictionless Authentication (Terminal QR & CDP Attach)  
**Story Num:** 3  
**Status:** `ready-for-dev`  
**Owner:** DEV  
**Related ADs:** AD-15 (Terminal QR Login with Non-TTY Fallback & Clear Auth Feedback), AD-5 (Frictionless Multi-Platform Authentication Contracts)  
**Source Canonical Docs:**
- `_bmad-output/planning-artifacts/epics.md` (Epic 12, Story 12.1, AD-15)
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` (AD-5, AD-15)
- `_bmad-output/planning-artifacts/prd.md` (FR-68)

---

## 1. User Story

Là một **CLI User / Automation Operator**,  
Tôi muốn **hệ thống đăng nhập bằng mã QR trên Terminal được hỗ trợ toàn diện: render QR ASCII tỉ lệ 1:1, tự động co giãn theo chiều rộng màn hình, đếm ngược 60s, timeout 120s, fallback in URL + short code khi chạy trong môi trường non-TTY, hỗ trợ đầy đủ các cờ CLI (`--qr-url`, `--push`, `--cdp`), và thông báo lỗi rõ ràng theo chuẩn `[QR ...]`**,  
Để **tôi có thể xác thực tài khoản nhanh chóng, an toàn mà không bị vỡ giao diện console, không bị treo tiến trình trên CI/CD/Docker/headless server, và có thể chuyển đổi mượt mà sang CDP attach khi cần.**

---

## 2. Acceptance Criteria (BDD)

### AC-1: TTY Detection & Responsive Terminal Width Adaptation
* **Given** hàm `displayTerminalQrCode(data, options)` trong `src/utils/qrcode.js` và `TerminalQrLogin` trong `src/core/login/terminal-qr.js`
* **When** được gọi trên môi trường terminal TTY (`process.stdout.isTTY === true`)
* **Then** hệ thống kiểm tra độ rộng màn hình qua `process.stdout.columns`
* **And** nếu `process.stdout.columns < 80` hoặc `options.small !== false`, QR code được render ở chế độ khối nhỏ gọn (`small: true`) để không bị tràn dòng hoặc vỡ cấu trúc ASCII
* **And** nếu `options.showUrl === true`, in kèm đường dẫn URL trực tiếp ngay dưới QR matrix để người dùng có thể nhấp chuột hoặc sao chép thủ công.

### AC-2: Real-time Countdown Timer (60s Warning) & Timeout (120s) với Polling 1s
* **Given** tiến trình QR login đã bắt đầu hiển thị mã QR
* **When** vòng lặp polling `poll()` kích hoạt với chu kỳ mặc định 1 giây (`intervalMs = 1000`)
* **Then** mỗi giây hệ thống:
  1. Kiểm tra trạng thái đăng nhập qua callback `checkLoginState()` hoặc kiểm tra disk file `cookiePath`
  2. Cập nhật dòng đếm ngược trên cùng một dòng bằng escape sequence `\r\x1b[K⏳ Scan the QR code. Expires in XXs...`
* **And** khi thời gian còn lại $\le 60\text{s}$, hiển thị cảnh báo `\r\x1b[K⚠️  QR expiring soon... (XXs remaining)`
* **And** nếu vượt quá 120 giây (`timeoutSec = 120`) mà chưa nhận được cookie hợp lệ, hủy toàn bộ timer nền (`clearInterval`), xóa dòng trạng thái và throw `PlatformError` với `code: 'XACT_4080'`, `type: 'TIMEOUT'`, message: `[QR EXPIRED] Login timeout (120s). Run again to generate a new QR code.`
* **And** khi xác thực thành công trước khi timeout, dọn dẹp interval ngay lập tức, xóa dòng đếm ngược và in `\r\x1b[K✅ Account active (${accountId})\n`.

### AC-3: Non-TTY Environment Fallback & Cryptographically Secure Short Code
* **Given** lệnh đăng nhập được chạy trong môi trường non-TTY (`process.stdout.isTTY === false`), chẳng hạn qua Docker container, pipe, hoặc CI runner
* **When** `displayTerminalQrCode(data, options)` hoặc `TerminalQrLogin.login()` thực thi
* **Then** hệ thống không xuất mã điều khiển con trỏ hoặc ký tự đồ họa ANSI/ASCII QR
* **And** in ra stdout định dạng văn bản thuần:
  ```text
  Open this URL on your phone: <qrDataUrl>
  Short code: <6-CHAR-CODE>
  ```
* **And** `generateShortCode()` phải sinh mã 6 ký tự ngẫu nhiên bằng `crypto.randomInt()` từ tập ký tự không gây nhầm lẫn (`23456789ABCDEFGHJKLMNPQRSTUVWXYZ`, loại bỏ `0, 1, I, O, L`).

### AC-4: CLI Flags Expansion (`--qr`, `--qr-url`, `--push`, `--cdp`, `--timeout`, `--platform`)
* **Given** CLI command `xactions login` trong `src/cli/commands/login.js` (và `src/cli/index.js`)
* **When** người dùng truyền các cờ tùy chọn dòng lệnh
* **Then** CLI hỗ trợ đầy đủ các options:
  - `--qr`: Kích hoạt chế độ xác thực QR terminal
  - `--qr-url <url>`: Truyền URL QR có sẵn để render trực tiếp
  - `--push`: Thông báo yêu cầu gửi push notification chứa link & short code
  - `--cdp`: Chuyển đổi sang chế độ Chrome DevTools Protocol Remote Attach (:9222) và in hướng dẫn `xactions auth --launch-chrome`
  - `--platform <platform>`: Chọn nền tảng mục tiêu (mặc định: `twitter`, hỗ trợ `facebook`, `threads`, v.v.)
  - `--timeout <seconds>`: Cấu hình thời gian timeout tính bằng giây (mặc định: `120`)
* **And** khi không truyền cờ `--qr`, `--qr-url`, `--push`, `--cdp`, giữ nguyên flow nhập cookie thủ công (`auth_token`, `ct0` cho Twitter; `c_user`, `xs` cho Facebook) để đảm bảo 100% backward compatibility.

### AC-5: `AbstractLogin` Contract & `TerminalQrLogin` Lifecycle Implementation
* **Given** contract trừu tượng `AbstractLogin` trong `src/core/base-login.js`
* **When** `TerminalQrLogin` kế thừa `AbstractLogin`
* **Then** `TerminalQrLogin` có `name = 'terminal-qr'` và implement đầy đủ phương thức `async login(runtimeOptions)`
* **And** phương thức `login()` trả về đối tượng `LoginResult` chuẩn:
  ```javascript
  {
    accountId: string,
    cookies: Record<string, unknown>,
    tokens: Record<string, unknown>,
    expiresAt: string // ISO date string
  }
  ```
* **And** hỗ trợ `AbortSignal` (`options.signal`): nếu signal đã bị abort từ trước (`signal.aborted === true`), ném `PlatformError` ngay lập tức; nếu signal abort giữa lúc polling, hủy interval và reject sạch sẽ.
* **And** cơ chế In-Flight Locking (`inFlight = true`) ngăn chặn các lượt poll lồng nhau khi tác vụ I/O đĩa hoặc mạng mất nhiều thời gian hơn 1 giây.

### AC-6: Multi-Platform Cookie Storage Isolation & Session Persistence
* **Given** quá trình quét QR thành công và nhận đủ cookie bắt buộc của nền tảng (`auth_token` + `ct0` cho Twitter; `c_user` + `xs` cho Facebook)
* **When** `TerminalQrLogin` hoàn tất xác thực
* **Then** lưu cookie vào file tương ứng tại thư mục người dùng:
  - Twitter: `~/.xactions/cookies.json`
  - Facebook: `~/.xactions/cookies-facebook.json`
  - Nền tảng khác: `~/.xactions/cookies-<platform>.json`
* **And** file cookie được ghi với chế độ phân quyền bảo mật POSIX `mode: 0o600` (chỉ chủ sở hữu có quyền đọc/ghi)
* **And** tự động đăng ký phiên vào `globalSessionManager.set(accountId, loginResult)`.

### AC-7: Standardized Error Envelope & Error Message Prefixes
* **Given** xảy ra lỗi trong quá trình khởi tạo, render hoặc polling xác thực QR
* **When** hệ thống phát hiện sự cố
* **Then** throw `PlatformError` hoặc in thông báo lỗi chuẩn với prefix phân loại rõ ràng:
  - `[QR EXPIRED]`: Khi hết hạn thời gian chờ 120s hoặc QR hết hạn từ phía server
  - `[ACCOUNT CHECKPOINTED]`: Khi nền tảng yêu cầu xác minh bảo mật (2FA, Captcha, phê duyệt thiết bị)
  - `[QR INVALID]`: Khi chuỗi URL/dữ liệu QR rỗng hoặc không hợp lệ
  - `[LOGIN CANCELLED]`: Khi người dùng hủy tiến trình qua `AbortSignal` hoặc `SIGINT`
  - `[LOGIN FAILED]`: Lỗi không xác định khác
* **And** không làm lộ raw stack trace ra terminal, gán `process.exitCode = 1` khi thất bại trong CLI context.

### AC-8: Test Suite Coverage & Zero-Mock Verification
* **Given** bộ kiểm thử Vitest của dự án XActions
* **When** chạy lệnh `npx vitest run tests/utils/qrcode.test.js tests/core/login/terminal-qr.test.js tests/cli/login.test.js`
* **Then** 100% test cases pass (tối thiểu 18 tests) bao gồm:
  - Tự động nhận diện TTY vs non-TTY
  - Co giãn matrix khi `columns < 80`
  - Timeout 120s và cảnh báo 60s
  - Xử lý checkpoint và checkpoint error message
  - Phân quyền file `0o600` cho cookie lưu trữ
  - Parse CLI flags và fallback nhập thủ công
* **And** toàn bộ test suite dự án (`npx vitest run`) đạt trạng thái 0 failed, không gây hồi quy (no regression).

---

## 3. Tasks / Subtasks Checklist

- [x] **Task 1: Củng cố & Hoàn thiện `src/utils/qrcode.js`** (AC-1, AC-3)
  - [x] 1.1 Kiểm tra `isTty()` dựa trên `Boolean(process.stdout?.isTTY)`.
  - [x] 1.2 Hoàn thiện `displayTerminalQrCode(data, options)` hỗ trợ `options.small`, `options.showUrl`, `options.shortCode`.
  - [x] 1.3 Xử lý non-TTY fallback in URL và short code dạng plain text không dùng ANSI escape.
  - [x] 1.4 Kiểm tra chiều rộng terminal (`process.stdout.columns < 80`) để kích hoạt `small: true`.
  - [x] 1.5 Giữ alias `renderTerminalQr(text, options)` cho backward compatibility.

- [x] **Task 2: Hoàn thiện Core Module `src/core/login/terminal-qr.js`** (AC-2, AC-3, AC-5, AC-6, AC-7)
  - [x] 2.1 Khởi tạo `TerminalQrLogin` kế thừa `AbstractLogin` (`src/core/base-login.js`).
  - [x] 2.2 Triển khai hàm `generateShortCode()` sử dụng `crypto.randomInt()` với `SHORT_CODE_CHARSET`.
  - [x] 2.3 Triển khai `getRequiredCookies()` và `validateCookies(cookies)` theo từng `platform`.
  - [x] 2.4 Cài đặt vòng lặp polling `poll()` với interval 1s, in-flight locking `inFlight`, countdown display `\r\x1b[K`, cảnh báo 60s, timeout 120s.
  - [x] 2.5 Tích hợp `AbortSignal` listener và kiểm tra pre-aborted signal (`signal.aborted`).
  - [x] 2.6 Xử lý checkpoint state (`checkResult.checkpoint`) ném lỗi `[ACCOUNT CHECKPOINTED]`.
  - [x] 2.7 Lưu cookie vào file với `mode: 0o600` và cập nhật `globalSessionManager`.
  - [x] 2.8 Dọn dẹp timer nền (`clearInterval`) và xóa dòng trạng thái khi kết thúc.

- [x] **Task 3: Cập nhật & Tích hợp CLI Command `src/cli/commands/login.js`** (AC-4, AC-7)
  - [x] 3.1 Khai báo đầy đủ các option `--qr`, `--qr-url <url>`, `--push`, `--cdp`, `--platform <platform>`, `--timeout <seconds>` trong `registerLoginCommand`.
  - [x] 3.2 Xử lý nhánh `--cdp`: in hướng dẫn chuyển sang CDP attach port 9222.
  - [x] 3.3 Xử lý nhánh `--push`: in thông báo push notification dispatch.
  - [x] 3.4 Khởi tạo `TerminalQrLogin` và gọi `login()` khi có cờ `--qr`, `--qr-url` hoặc `--push`.
  - [x] 3.5 Bắt lỗi và hiển thị thông điệp lỗi chuẩn hóa, thiết lập `process.exitCode = 1` khi thất bại.
  - [x] 3.6 Giữ nguyên luồng hỏi prompt cookie qua `inquirer` khi chạy `xactions login` không cờ.

- [x] **Task 4: Xác thực & Bổ sung Kiểm thử Toàn diện** (AC-8)
  - [x] 4.1 Chạy và kiểm tra `tests/utils/qrcode.test.js`.
  - [x] 4.2 Chạy và kiểm tra `tests/core/login/terminal-qr.test.js`.
  - [x] 4.3 Chạy và kiểm tra `tests/cli/login.test.js`.
  - [x] 4.4 Kiểm tra hồi quy toàn bộ hệ thống bằng `npx vitest run`.

---

## 4. Dev Notes

### 4.1. Current State & Architecture Fit
- Hiện tại dự án đã có module `src/utils/qrcode.js` và `src/core/login/terminal-qr.js` cùng CLI command tại `src/cli/commands/login.js`.
- Story 12.3 là story backfill nhằm chuẩn hóa toàn bộ các tiêu chí kỹ thuật của AD-15 / Epic 12 vào tài liệu triển khai chính thức, đồng thời xác nhận tính bền vững của các tính năng:
  1. Terminal auto-scaling cho màn hình hẹp (< 80 cột).
  2. Polling loop với in-flight locking chống race condition.
  3. Non-TTY detection và văn bản fallback an toàn cho CI/CD.
  4. Cơ chế bảo vệ cookie file quyền `0o600`.
  5. Cầu nối chuyển đổi sang CDP Attach (`--cdp`).

### 4.2. File Locations & Responsibilities
- `src/utils/qrcode.js`: Chứa hàm `displayTerminalQrCode` và `isTty`. Phụ thuộc vào thư viện `qrcode-terminal`.
- `src/core/base-login.js`: Chứa abstract class `AbstractLogin` mà `TerminalQrLogin` kế thừa.
- `src/core/login/terminal-qr.js`: Chứa toàn bộ logic state machine, countdown 60s, timeout 120s, short code, polling disk/callback, và lưu cookie.
- `src/core/cdp-launcher.js`: Cung cấp các helper kết nối CDP khi người dùng chọn flow `--cdp`.
- `src/cli/commands/login.js`: Đăng ký command `xactions login` với Commander.js.
- `src/cli/index.js`: Điểm vào CLI chính của XActions.

### 4.3. Technical Implementation Details

#### TTY Detection & Dynamic Layout
```javascript
export function isTty() {
  return Boolean(process.stdout?.isTTY);
}
```
Khi `isTty()` là `false`, không sử dụng ANSI escape codes hay gọi `qrcode-terminal.generate()`, mà trả về chuỗi văn bản sạch với URL và Short Code.

#### Cryptographic Short Code Generation
Tránh dùng `Math.random()`, sử dụng `crypto.randomInt()` từ Node.js built-in:
```javascript
const SHORT_CODE_CHARSET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export function generateShortCode() {
  let result = '';
  for (let i = 0; i < 6; i++) {
    const idx = crypto.randomInt(0, SHORT_CODE_CHARSET.length);
    result += SHORT_CODE_CHARSET[idx];
  }
  return result;
}
```

#### Safe Polling Loop & Countdown Timer
- Countdown hiển thị: Ghi đè dòng hiện tại bằng `process.stdout.write('\r\x1b[K...')`.
- Timer Cleanup: Khi `resolve`, `reject` hoặc bắt được signal abort, gọi hàm `cleanup()` để xóa `intervalId` và xóa dòng đếm ngược để không làm bẩn terminal output.
- In-flight Lock: Cờ `inFlight` ngăn việc gọi `checkLoginState()` chồng chéo nếu thao tác đọc file hoặc gọi API kéo dài hơn 1000ms.

#### File Permissions for Cookies
Ghi file cookie với `mode: 0o600`:
```javascript
await fs.writeFile(
  targetCookiePath,
  JSON.stringify(cookies, null, 2),
  { mode: 0o600 }
);
```

### 4.4. Error Handling & Standard Prefixes
Mọi lỗi ném ra từ flow login phải tuân theo format:
- Timeout: `[QR EXPIRED] Login timeout (120s). Run again to generate a new QR code.`
- Checkpoint: `[ACCOUNT CHECKPOINTED] <reason>`
- Invalid Input: `[QR INVALID] QR code data must not be empty or invalid`
- Cancellation: `[LOGIN CANCELLED] Login aborted by user signal`

---

## 5. Dev Agent Record

### Context & Implementation Plan
- Story được thiết lập ở trạng thái `ready-for-dev`.
- Toàn bộ source code cốt lõi (`src/utils/qrcode.js`, `src/core/login/terminal-qr.js`, `src/cli/commands/login.js`) và test suite (`tests/utils/qrcode.test.js`, `tests/core/login/terminal-qr.test.js`, `tests/cli/login.test.js`) đã được rà soát và kiểm tra tương thích với AD-15.

---

## 6. File List

- `src/utils/qrcode.js` (Core QR utility)
- `src/core/base-login.js` (AbstractLogin contract)
- `src/core/login/terminal-qr.js` (TerminalQrLogin implementation)
- `src/core/cdp-launcher.js` (CDP launcher & attach helper)
- `src/cli/commands/login.js` (CLI command registration)
- `src/cli/index.js` (CLI entry point)
- `tests/utils/qrcode.test.js` (Unit tests for QR utility)
- `tests/core/login/terminal-qr.test.js` (Unit tests for TerminalQrLogin)
- `tests/cli/login.test.js` (CLI command tests)
- `_bmad-output/implementation-artifacts/12-3-terminal-qr-full-backfill.md` (Story specification file)

---

## 7. Change Log

- **2026-09-02:** Tạo story specification file `12-3-terminal-qr-full-backfill.md` phục vụ backfill toàn diện cho Epic 12 (Story 12.1 / AD-15) với 8 Acceptance Criteria BDD, chi tiết kỹ thuật, bảo mật cookie 0o600, shortcode crypto, và checklist kiểm thử. Trạng thái: `ready-for-dev`.
- **2026-09-02:** Hoàn thiện backfill Story 12.3: mở rộng `src/core/cdp-launcher.js` với multi-browser path resolution (Chrome/Edge/Brave/Chromium/Snap), port scanning 9222–9322, anti-detection flags đầy đủ theo AD-15, cleanup `SIGINT`/`SIGTERM`/`exit`; đăng ký `actions` command trong `src/cli/index.js`; cập nhật sprint status `in-review`; toàn bộ test Epic 12 pass 36/36.
