# Epic 12 Context: Frictionless Authentication (Terminal QR & CDP Attach)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 12 loại bỏ ma sát đăng nhập cho CLI XActions bằng hai chế độ: Terminal QR hiển thị mã QR ASCII trực tiếp trên console với countdown 60s, timeout 120s, fallback khi chạy non-TTY; và CDP Attach để kết nối Chrome thật qua cổng 9222 để giữ nguyên profile, fingerprint, vượt anti-bot. Đích cuối là user có thể xác thực an toàn, nhanh chóng trên mọi môi trường (máy local, Docker, CI, headless server) mà không bị kẹt ở prompt nhập cookie thủ công.

## Stories

- Story 12.1: Terminal ASCII QR Code Login Module with Countdown & Timeout
- Story 12.2: CDP Remote Attach Mode with Launch Helper & Gaussian Jitter
- Story 12.3: Multi-Browser Path Resolution & Advanced Anti-Automation Flags

## Requirements & Constraints

- `process.stdout.isTTY` phải được kiểm tra trước khi render QR; non-TTY in URL + short code thay vì ký tự ASCII QR.
- QR ASCII dùng tỷ lệ 1:1, tự động `small: true` khi terminal width < 80 cột.
- Countdown 60s cảnh báo, timeout 120s, polling cookie mỗi 1s.
- Sinh short code 6 ký tự bằng `crypto.randomInt()`, tập ký tự loại `0, 1, I, O, L`.
- CLI hỗ trợ `--qr`, `--qr-url <url>`, `--push`, `--cdp`, `--platform <platform>`, `--timeout <seconds>`; giữ backward compatibility với nhập cookie thủ công.
- Cookie lưu với `mode: 0o600`, đường dẫn `~/.xactions/cookies-<platform>.json`.
- `AbstractLogin` trả về `{ accountId, cookies, tokens, expiresAt }`; `SessionManager` đăng ký phiên.
- CDP: kết nối Chrome thật tại `http://localhost:9222`; launch helper hỗ trợ multi-platform path resolution, port scan 9222–9322, anti-detection flags; cleanup process khi `SIGINT`/`SIGTERM`.
- Thông báo lỗi chuẩn: `[QR EXPIRED] ...`, `[ACCOUNT CHECKPOINTED] ...`, `[QR INVALID] ...`, `[LOGIN CANCELLED] ...`; không dùng emoji trong lỗi AD-15.

## Technical Decisions

- AD-5: `src/core/base-login.js` + `src/utils/qrcode.js` + `src/core/session-manager.js`; `qrcode-terminal` package; CDP port 9222; sticky IP per account.
- AD-15: TTY detection trước QR render; non-TTY fallback URL/short code/push/CDP; terminal size < 80 cols thì `small: true`; error message plain text với prefix rõ ràng; timeout 120s, `[QR EXPIRED] Run again with 'xactions login --qr' or use '--cdp' if you have a running Chrome.`
- Hệ thống anti-detection CDP: `--disable-blink-features=AutomationControlled`, `--exclude-switches=enable-automation`, `--disable-infobars`, `--disable-background-timer-throttling`, `--disable-renderer-backgrounding`, `--headless=new`.
- Multi-platform executable resolution: macOS `/Applications/...`, Windows `%PROGRAMFILES%/%LOCALAPPDATA%`, Linux `/usr/bin/...` + `/snap/bin/chromium`.

## Cross-Story Dependencies

- Story 12.2 cần `AbstractLogin` contract từ Story 12.1.
- Epic 18.3 (LinkedIn CDP) bị block cho tới khi Epic 12.2 hoàn thành.
