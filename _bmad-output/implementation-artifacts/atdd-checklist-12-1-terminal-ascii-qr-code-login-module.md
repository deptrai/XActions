# ATDD Checklist — Story 12.1: Terminal ASCII QR Code Login Module

**Story ID:** 12.1  
**Epic:** 12 — Frictionless Authentication (Terminal QR & CDP Attach)  
**Status:** 🟢 Green (All 18 Acceptance Tests Passing)  
**Generated:** 2026-08-21  

---

## Acceptance Criteria Mapping & Test Status

### AC-1: `displayTerminalQrCode(data)` Render Mã QR ASCII 1:1 trên Terminal (TTY)
* File: `tests/utils/qrcode.test.js`
- [x] `[P0] should render ASCII QR matrix on TTY terminal with 1:1 ratio blocks` ➔ 🟢 **Passing**
- [x] `[P0] should automatically use small matrix when terminal width is narrow (< 80 columns)` ➔ 🟢 **Passing**
- [x] `[P1] should include plain text URL below QR when options.showUrl is true` ➔ 🟢 **Passing**
- [x] `[P1] should throw error if data is empty or invalid` ➔ 🟢 **Passing**
- [x] `[P2] should preserve backward compatibility with renderTerminalQr(text, options)` ➔ 🟢 **Passing**
- [x] `[P0] isTty() helper should accurately reflect process.stdout.isTTY state` ➔ 🟢 **Passing**

---

### AC-2: Đếm Ngược 60s & Timeout 120s với Polling 1s
* File: `tests/core/login/terminal-qr.test.js`
- [x] `[P0] should resolve LoginResult when checkLoginState succeeds within timeout` ➔ 🟢 **Passing**
- [x] `[P0] should abort and throw PlatformError [QR EXPIRED] when timeout (120s) expires` ➔ 🟢 **Passing**
- [x] `[P0] should cleanly clear all background timers on completion (no dangling intervals)` ➔ 🟢 **Passing**
- [x] `[P0] should reject immediately when AbortSignal is pre-aborted` ➔ 🟢 **Passing**

---

### AC-3: Hỗ Trợ Non-TTY Fallback (URL + Short Code)
* File: `tests/utils/qrcode.test.js`
- [x] `[P0] should render plain URL and short code on Non-TTY environments without terminal escapes` ➔ 🟢 **Passing**

---

### AC-4 & AC-7: CLI `xactions login --qr` với Flags Mở Rộng & Error Messages
* File: `tests/cli/login.test.js`
- [x] `[P0] should parse --qr, --qr-url, --push, --cdp, --platform, and --timeout options` ➔ 🟢 **Passing**
- [x] `[P1] should default platform to twitter and timeout to 120s when flags are omitted` ➔ 🟢 **Passing**

---

### AC-5: `AbstractLogin` Contract & `TerminalQrLogin` Class
* File: `tests/core/login/terminal-qr.test.js`
- [x] `[P0] should extend AbstractLogin and have name "terminal-qr"` ➔ 🟢 **Passing**
- [x] `[P0] generateShortCode() should produce a clean 6-character code excluding ambiguous chars` ➔ 🟢 **Passing**
- [x] `[P1] should isolate cookiePath by platform (cookies.json vs cookies-facebook.json)` ➔ 🟢 **Passing**

---

### AC-6: Lưu Cookie An Toàn (`0o600`) & Đồng Bộ `SessionManager`
* File: `tests/core/login/terminal-qr.test.js`
- [x] `[P0] should save cookie file with secure 0o600 file permissions upon success` ➔ 🟢 **Passing**

---

### AC-7: Platform Checkpoint Handling
* File: `tests/core/login/terminal-qr.test.js`
- [x] `[P1] should throw PlatformError [ACCOUNT CHECKPOINTED] when platform returns checkpoint` ➔ 🟢 **Passing**

---

## Tóm Tắt Tiến Độ Kiểm Thử ATDD
* **Tổng số test cases**: 18
* **Đã vượt qua (Passing)**: 18 (100%)
* **Bị bỏ qua (Skipped)**: 0 (0%)
* **Thất bại (Failed)**: 0 (0%)
* **Mocks / Fakes**: 0 (Real implementations only)
