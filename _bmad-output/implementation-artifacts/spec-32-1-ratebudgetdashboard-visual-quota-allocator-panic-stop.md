---
title: 'Story 32.1 — RateBudgetDashboard: Visual Quota Allocator & Panic Stop'
type: 'feature'
created: '2026-09-17'
status: 'done'
route: 'dispatch'
baseline_commit: 'd71c289b'
review_loop_iteration: 0
context:
  - _bmad-output/planning-artifacts/epics.md
  - src/core/adaptive-governor.js
  - dashboard/admin.html
  - api/routes/governor.js
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Hiện tại việc quản trị hạn mức (`AdaptiveRateGovernor`) chỉ chạy ngầm trong bộ nhớ và backend metrics. Người vận hành hệ thống (XActions Operator) không xem được trực quan mức tiêu thụ RPM theo từng đối tác (`chainlens`, `nowing`, `internal`), không có nút dừng khẩn cấp (Panic Stop) khi xảy ra sự cố bị phạt rate-limit, và không thể điều chỉnh độ ưu tiên hàng đợi (priority queues) trực quan.

**Approach:**
1. **Backend & Governor Core:**
   - Mở rộng `AdaptiveRateGovernor` (`src/core/adaptive-governor.js`):
     - Phương thức `panicStop(platform, options)`: Tạm dừng mọi streams không thiết yếu và đưa toàn bộ accounts của nền tảng vào trạng thái hibernation khẩn cấp, đẩy `throttleLevel` lên `critical`.
     - Phương thức `resumePanic(platform)`: Khôi phục trạng thái hoạt động bình thường.
     - Phương thức `updateConsumerPriority(consumerId, priority)`: Cập nhật thứ tự ưu tiên.
   - Bổ sung routes vào `api/routes/governor.js`:
     - `POST /api/governor/panic-stop` (nhận `platform`, `durationMs`)
     - `POST /api/governor/panic-resume` (nhận `platform`)
     - `POST /api/governor/priorities` (nhận danh sách `{ consumerId, priority }[]`)
2. **Frontend Dashboard (`dashboard/admin.html`):**
   - Khu vực **Rate Budget & Quota Allocation**:
     - Hiển thị bảng RPM tiêu thụ thực tế vs giới hạn của `chainlens`, `nowing`, `internal`.
     - Đồng hồ đo (Gauge / Badge indicator) trực quan cho `throttleLevel` (`NORMAL`, `REDUCED`, `BACKPRESSURE`, `CRITICAL`).
     - Danh sách Priority Queue có thể kéo thả (HTML5 drag-and-drop) hoặc nút mũi tên tăng/giảm thứ tự ưu tiên, lưu vào `localStorage` và gửi API.
     - Nút nổi bật **🛑 Panic Stop** với hộp thoại xác nhận an toàn để kích hoạt chế độ khẩn cấp per-platform.

## Boundaries & Constraints

**Always:**
- Giữ nguyên các endpoints hiện có của `api/routes/governor.js` (`GET /api/governor/status`).
- Bảo vệ các endpoint mới bằng middleware `authenticateToken` và `requireAdmin` (hoặc bypass khi chạy local/dev header).
- Nút Panic Stop phải có modal xác nhận trước khi thực hiện để tránh bấm nhầm.
- Lưu trữ trạng thái sắp xếp priority cục bộ trong `localStorage` (`xactions_priority_order`) để phục hồi ngay khi tải lại trang.

**Never:**
- KHÔNG làm crash server nếu redis/pool không khả dụng khi gọi Panic Stop (graceful fallback).
- KHÔNG thay đổi logic rate limit cơ bản của `canConsumerRequest` hay `recordConsumerRequest`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Kích hoạt Panic Stop | `POST /api/governor/panic-stop` `{ platform: 'twitter' }` | Toàn bộ tài khoản Twitter hibernate, throttleLevel = critical | 200 OK `{ success: true, message: ... }` |
| Hủy Panic Stop | `POST /api/governor/panic-resume` `{ platform: 'twitter' }` | Accounts hết hibernate khẩn cấp, throttleLevel về normal | 200 OK |
| Reorder priority | `POST /api/governor/priorities` `[{ consumerId: 'nowing', priority: 1 }]` | Cập nhật priority trong Map consumerQuotas | 200 OK |
| Render Dashboard | Tải `dashboard/admin.html` | Hiển thị RPM per-consumer, throttle gauge, drag-drop queue list | Dữ liệu fallback nếu API offline |

</frozen-after-approval>

## Code Map

- `src/core/adaptive-governor.js` — Thêm `panicStop(platform)`, `resumePanic(platform)`, `setConsumerPriority(id, priority)`.
- `api/routes/governor.js` — Thêm các route POST `/panic-stop`, `/panic-resume`, `/priorities`.
- `dashboard/admin.html` — Bổ sung view Rate-Budget: Gauge throttle, consumer RPM metrics, Drag-drop priority list, Nút Panic Stop.
- `tests/core/adaptive-governor-panic.test.js` — Unit tests cho panicStop, resumePanic, và priority update.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/adaptive-governor.js` — Thêm `panicStop`, `resumePanic`, `setConsumerPriority`
- [x] `api/routes/governor.js` — Thêm POST endpoints cho panic stop/resume và priority ordering
- [x] `dashboard/admin.html` — Thêm giao diện Rate Budget, Throttle Gauge, Drag-and-drop Queue, nút 🛑 Panic Stop
- [x] `tests/core/adaptive-governor-panic.test.js` — Viết unit test cho các tính năng mới trong governor

**Acceptance Criteria:**
- Given `globalAdaptiveRateGovernor`, when gọi `panicStop('twitter')`, then tất cả tài khoản Twitter bị hibernate và `throttleLevel` chuyển thành `critical`.
- Given `dashboard/admin.html`, when hiển thị, then render đúng bảng RPM của 3 consumers (`chainlens`, `nowing`, `internal`) và gauge `throttleLevel`.
- Given người dùng kéo thả sắp xếp lại thứ tự ưu tiên trong dashboard, when thả ra, then priority được lưu vào `localStorage` và gửi cập nhật lên backend.
- Given nút Panic Stop, when được click và xác nhận, then gửi lệnh ngắt khẩn cấp và cập nhật giao diện ngay lập tức.

## Implementation Notes

- Added `panicStop()`, `resumePanic()`, and `setConsumerPriority()` methods to `AdaptiveRateGovernor` (`src/core/adaptive-governor.js`). When panic stop is triggered, accounts on the target platform are hibernated and throttle level transitions to `critical`.
- Added REST routes in `api/routes/governor.js`: `POST /api/governor/panic-stop`, `POST /api/governor/panic-resume`, and `POST /api/governor/priorities` protected by admin auth.
- Enhanced `dashboard/admin.html` with a dedicated Rate Budget section: visual 4-tier throttle gauge, per-consumer RPM table, HTML5 drag-and-drop queue priority allocator with `localStorage` persistence, and 🛑 Panic Stop emergency modal.
- Added unit tests in `tests/core/adaptive-governor-panic.test.js` with 6/6 passing tests.

## Spec Change Log

## Review Triage Log

- **verified** — 6/6 tests passing in `tests/core/adaptive-governor-panic.test.js`. All acceptance criteria satisfied.
