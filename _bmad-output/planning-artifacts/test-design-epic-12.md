---
title: "Test Design & Quality Strategy: Epic 12 - Frictionless Authentication (Story 12.1)"
date: "2026-08-21"
author: "BMad Master Test Architect"
epic: 12
story: "12.1"
status: "APPROVED"
---

# Test Design & Quality Strategy: Epic 12 (Story 12.1 — Terminal ASCII QR Code Login)

**Target Story:** `12.1: Terminal ASCII QR Code Login Module with Countdown & Timeout`  
**Module Path:** `src/utils/qrcode.js` & CLI `src/cli/commands/auth.js`  
**Quality Marshal:** Master Test Architect (BMad TEA)  

---

## 1. System & Architecture Context

Story 12.1 giải quyết bài toán đăng nhập không cần mật khẩu thô cho người dùng CLI/Agent thông qua cơ chế quét mã QR hiển thị trực tiếp trên Terminal bằng ký tự ASCII chuẩn 1:1 (`\u2588`, `\u2580`, `\u2584`), kết hợp thanh đếm ngược thời gian thực (Countdown Timer) và cơ chế polling kiểm tra phiên đăng nhập an toàn.

### 1.1. Luồng Hoạt Động Cốt Lõi (Architecture Flow)
```
[Login Provider (Twitter/FB/Zalo/WeChat)]
                │ (Emit QR URL / Base64)
                ▼
      [displayTerminalQrCode(data)] ───► Terminal ASCII (TTY) / Fallback URL (Non-TTY)
                │
                ├──► [Countdown Timer: 60s] (Visual Bar / Ticker)
                │
                └──► [checkLoginState()] (1s Polling Loop, 120s Max Timeout)
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
      [Scan Success]              [Timeout / Expired]
              │                           │
  [Save Session Cookie]         [Throw QrExpiredError]
              │                           │
   [Clean Terminal & Exit]      [Clear Timers & Teardown]
```

---

## 2. Risk Assessment Matrix

| Risk ID | Category | Description | Prob (1-3) | Imp (1-3) | Score (P×I) | Mitigation & Test Strategy |
|:---:|:---:|---|:---:|:---:|:---:|---|
| **R-01** | **TECH** | Non-TTY crash: Process chạy trong CI/Pipe bị vỡ escape sequence hoặc crash do `process.stdout.columns` undefined. | 3 | 2 | **6 (HIGH)** | Mock `process.stdout.isTTY = false` và `columns = undefined`; test tự động chuyển sang raw URL + short code format. |
| **R-02** | **TECH** | Timer Leak / Dangling Handles: Vòng lặp đếm ngược 60s hoặc polling 120s không được `clearInterval()` / `unref()`, làm treo test suite hoặc process Node.js. | 3 | 3 | **9 (CRITICAL)** | Viết test kiểm tra dọn dẹp timer ngay khi login thành công hoặc khi timeout/error xảy ra; sử dụng fake/real timer assertions. |
| **R-03** | **UX** | QR Wrapping trên terminal hẹp (<80 cột) làm méo hình ASCII khiến camera điện thoại không đọc được. | 2 | 3 | **6 (HIGH)** | Kiểm thử logic auto-scale (`small: true`) khi `process.stdout.columns < 80`. |
| **R-04** | **DATA** | Race condition giữa lúc user vừa quét xong và timer 120s hết hạn cùng 1 tick. | 2 | 2 | **4 (MED)** | Trạng thái máy hữu hạn (`STATE: IDLE -> PENDING -> SUCCESS -> EXPIRED`) ngăn chặn transition sau khi đã kết thúc. |
| **R-05** | **SEC** | Cookie phiên không được mã hóa hoặc văng plain-text ra terminal logs. | 1 | 3 | **3 (LOW)** | Kiểm tra output console tuyệt đối không in auth token hay session cookies nhạy cảm. |

---

## 3. Test Coverage Matrix & Scenario Decomposition

### 3.1. Test Suites Phân Tầng

```
tests/utils/qrcode.test.js
├── describe('displayTerminalQrCode()')
│   ├── [P0] render ASCII QR matrix on TTY terminal
│   ├── [P0] render fallback text URL & shortcode on non-TTY environment
│   ├── [P1] auto-adjust to compact matrix when terminal width < 80 cols
│   └── [P1] handle base64 image data vs raw URL string
│
├── describe('checkLoginState() polling & lifecycle')
│   ├── [P0] resolve immediately when cookie/token is detected
│   ├── [P0] abort and reject with QrExpiredError after 120s timeout
│   ├── [P0] clean up all active intervals/timeouts on completion (zero leaks)
│   ├── [P1] handle account checkpointed response ([ACCOUNT CHECKPOINTED])
│   └── [P1] support manual abort via AbortSignal / cancel()
│
└── describe('Countdown Timer & Terminal UX')
    ├── [P1] update remaining seconds ticker on interval tick
    └── [P2] clear countdown line cleanly on terminal upon success
```

---

## 4. Detailed Test Scenarios (BDD Specifications)

### Scenario 1: Render ASCII QR code trên TTY Terminal (P0)
- **Given** URL đăng nhập `https://x.com/i/flow/qr?token=xyz123` và môi trường TTY (`process.stdout.isTTY = true`)
- **When** gọi `displayTerminalQrCode(url)`
- **Then** output trả về chuỗi chứa các ký tự ASCII block (`\u2588` / `\u2580` / `\u2584` hoặc khoảng trắng)
- **And** không ném lỗi ra ngoài process.

### Scenario 2: Fallback an toàn trên môi trường Non-TTY / CI (P0)
- **Given** môi trường Non-TTY (`process.stdout.isTTY = false` hoặc `undefined`)
- **When** gọi `displayTerminalQrCode(url)`
- **Then** output không chứa escape sequences điều khiển con trỏ terminal
- **And** in ra rõ ràng URL đăng nhập và hướng dẫn thao tác trên thiết bị di động.

### Scenario 3: Polling vòng lặp kiểm tra phiên & Tự động hủy Timer (P0)
- **Given** polling function `checkFn` giả lập trả về `null` trong 2 lần gọi đầu và `{ cookies: 'auth_token=valid' }` ở lần thứ 3
- **When** gọi `pollLoginState({ checkFn, intervalMs: 10, timeoutMs: 1000 })`
- **Then** promise resolve về kết quả authenticated cookie
- **And** toàn bộ background timer bị hủy ngay lập tức, không còn active interval nào chạy nền.

### Scenario 4: Timeout 120s và Báo lỗi [QR EXPIRED] (P0)
- **Given** polling function `checkFn` liên tục trả về `null`
- **When** thời gian vượt quá `timeoutMs` (hoặc 120s)
- **Then** promise reject với `QrExpiredError` mang mã `[QR EXPIRED]`
- **And** timer tự giải phóng tài nguyên.

### Scenario 5: Xử lý tài khoản bị dính Checkpoint (P1)
- **Given** polling function `checkFn` trả về `{ status: 'checkpoint_required' }`
- **When** gọi `pollLoginState()`
- **Then** throw lỗi `AccountCheckpointedError` với thông báo `[ACCOUNT CHECKPOINTED] Vui lòng mở trình duyệt để xác minh danh tính`.

---

## 5. Quality Gates & Acceptance Criteria

| Chỉ số Chất lượng | Ngưỡng Tối thiểu (Threshold) | Phương pháp Đo lường |
|---|:---:|---|
| **P0 Pass Rate** | **100%** | Vitest suite `tests/utils/qrcode.test.js` |
| **P1 Pass Rate** | **100%** | Vitest suite `tests/utils/qrcode.test.js` |
| **Line Coverage** | **≥ 95%** | `vitest --coverage` trên `src/utils/qrcode.js` |
| **Timer Leak** | **0 Dangling Handles** | Node process exits cleanly sau khi test xong |
| **Non-TTY Compliance** | **Pass 100%** | Test case chạy với `process.stdout.isTTY = false` |

---

## 6. Sẵn Sàng Triển Khai (Ready for ATDD)

Test Design đã được phê duyệt và sẵn sàng để tạo Story Spec + Red-phase Acceptance Tests qua lệnh:
👉 `/bmad-testarch-atdd 12.1`
