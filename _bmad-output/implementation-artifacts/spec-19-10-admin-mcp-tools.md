---
title: 'Story 19.10: Admin MCP Tools for AI Agents'
type: 'feature'
created: '2026-09-05'
status: 'done'
review_loop_iteration: 0
baseline_commit: '6b793c4b0e2352f2bcf5ff253be37db2cb330373'
context:
  - _bmad-output/implementation-artifacts/epic-19-context.md
  - _bmad-output/implementation-artifacts/19-4-5-admin-cli-stream-metrics-alerts.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** XActions MCP server hiện có 140+ công cụ scraping/automation nhưng chưa có công cụ admin nào. AI agents không thể hỏi trạng thái hệ thống, kiểm soát proxy pool, đánh thức account, hay quản lý checkpoints qua MCP.

**Approach:** Thêm một nhóm `x_admin_*` tools vào `src/mcp/server.js`, mapping trực tiếp đến các singleton/REST APIs đã dùng bởi `xactions admin` CLI và dashboard. Tools yêu cầu quyền `admin` và trả về cùng JSON envelope 3 lớp.

## Boundaries & Constraints

**Always:**
- Tất cả admin tools phải bắt đầu bằng `x_admin_`.
- Mỗi tool kiểm tra quyền `admin` trước khi thực thi (throw `PlatformError` với `code: 'XACT_4003'` nếu thiếu quyền).
- Reuse logic từ `src/cli/commands/admin.js` và `api/routes/admin.js` bằng cách gọi cùng singletons (`globalProxyPool`, `globalAccountPool`, `checkpoint-manager.js`, `defaultStreamAlertEngine`) thay vì duplicate logic.
- Input schema tuân theo JSON Schema của MCP SDK (`type: 'object'`, khai báo `properties` và `required` rõ ràng).
- Trả về kết quả qua `wrapToolResult` / `wrapToolError` 3-layer envelope.

**Ask First:**
- Nếu cần bổ sung tool `x_admin_retention_trigger` hoặc `x_admin_license_list` ngoài 7 tool đã liệt kê trong ACs.
- Nếu muốn hỗ trợ cả HTTP/SSE transport với admin-key thay vì chỉ user JWT.

**Never:**
- Không thêm logic business mới; chỉ wrap/expose existing admin CLI/REST capabilities.
- Không mở direct DB access từ MCP tools; dùng managers/routes hiện có.
- Không mock trong tests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH | `x_admin_status` với user có `isAdmin=true` | Trả về governor status, proxy health, hibernating accounts | N/A |
| AUTH_DENIED | `x_admin_status` với user không có `isAdmin` | Envelope `success: false`, `code: XACT_4003` | `PlatformError` |
| PROXY_QUARANTINE | `x_admin_proxy_quarantine` với proxy URL hợp lệ | Quarantine proxy, trả về healthyCount/totalCount | `XACT_4001` nếu proxy không tồn tại |
| ACCOUNT_WAKE | `x_admin_account_wake` với account đang hibernating | Đánh thức account, trả về `status: 'active'` | `XACT_4090` nếu account không hibernating |
| CHECKPOINT_RETRY | `x_admin_checkpoint_action {id, action: 'retry'}` trên checkpoint `failed` | Chuyển status thành `running` | `XACT_4002` nếu action không hợp lệ với status hiện tại |

</frozen-after-approval>

## Code Map

- `src/mcp/server.js:97-260` -- `TOOLS` array; thêm định nghĩa 7 `x_admin_*` tools vào đây.
- `src/mcp/server.js:2791-2970` -- `executeTool` dispatcher; thêm nhánh `x_admin_*` gọi `executeAdminTool`.
- `src/cli/commands/admin.js:34-860` -- Reference implementation cho proxy/account/checkpoint/stream CLI; reuse cùng managers.
- `api/routes/admin.js:362-600` -- REST handlers cho proxy/account; MCP tools gọi cùng singletons thay vì copy logic.
- `src/store/checkpoint-manager.js:175-272` -- `resumeCheckpoint`, `pauseCheckpoint`, `retryCheckpoint` dùng cho `x_admin_checkpoint_action`.
- `src/utils/stream-alerts.js:258-320` -- `defaultStreamAlertEngine.getAlertStatus()` và `testAlert()` dùng cho `x_admin_stream_*`.
- `tests/mcp/server.test.js` -- Kiểm tra TOOLS array và conventions.
- `tests/mcp/admin-tools.test.js` -- *mới* kiểm tra executeAdminTool với real singletons.

## Tasks & Acceptance

**Execution:**
- [x] `src/mcp/server.js` -- Thêm 7 tool definitions vào `TOOLS`: `x_admin_status`, `x_admin_proxies_list`, `x_admin_proxy_quarantine`, `x_admin_accounts_list`, `x_admin_account_wake`, `x_admin_checkpoints_list`, `x_admin_checkpoint_action`, `x_admin_stream_metrics`, `x_admin_stream_alerts`. (Mở rộng từ 7 lên 9 tool để bao phủ stream metrics/alerts — đây là phần còn thiếu từ Story 19.4.5.)
- [x] `src/mcp/server.js` -- Implement `executeAdminTool(name, args)` với `requireAdmin()` check, sau đó dispatch đến managers/REST.
- [x] `src/mcp/server.js` -- Thêm `name.startsWith('x_admin_')` vào `executeTool` dispatcher.
- [x] `tests/mcp/admin-tools.test.js` -- Viết tests: list tools, auth denied, happy path cho status/proxy/account/checkpoint/stream, error cases.
- [x] `_bmad-output/implementation-artifacts/19-10-admin-mcp-tools.md` -- Tạo story file tổng hợp (sau khi implement xong).
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- Cập nhật `19-10-admin-mcp-tools` thành `done`.

**Acceptance Criteria:**
- Given MCP server đang chạy, when gọi `x_admin_status`, then trả về governor status, proxy health, hibernating accounts.
- Given `x_admin_proxies_list`, when gọi với quyền admin, then trả về danh sách proxies với status và partition.
- Given `x_admin_account_wake`, when gọi với account đang hibernating, then đánh thức account và trả về active status.
- Given `x_admin_checkpoint_action` với `action: 'retry'`, when checkpoint ở trạng thái `failed`, then chuyển thành `running`.
- Given user không có quyền admin, when gọi bất kỳ `x_admin_*` tool, then trả về `success: false` với `code: XACT_4003`.
- Given `x_admin_stream_metrics` và `x_admin_stream_alerts`, when gọi, then trả về metrics và alert status tương tự CLI.

## Spec Change Log

<!-- Append-only. -->

## Design Notes

Admin tools được thiết kế như một lớp wrapper mỏng trên CLI logic:
- `x_admin_status` gọi `globalStatusApi.getGovernorStatus()` sau `refreshGovernorConsumerLag`.
- `x_admin_proxies_list` gọi `globalProxyPool.listProxies()`.
- `x_admin_proxy_quarantine` gọi `globalProxyPool.quarantine(proxyKey)`.
- `x_admin_accounts_list` gọi `globalAccountPool.listAccountDetails(platform)`.
- `x_admin_account_wake` gọi `globalAccountPool.markAvailable(accountId, platform)`.
- `x_admin_checkpoints_list` gọi `listCheckpoints({ prisma })`.
- `x_admin_checkpoint_action` gọi `resumeCheckpoint`/`pauseCheckpoint`/`retryCheckpoint` theo `action`.
- `x_admin_stream_metrics` gọi `defaultStreamMetricsCollector.getMetrics()`.
- `x_admin_stream_alerts` gọi `defaultStreamAlertEngine.getAlertStatus()`.

Quyền admin được kiểm tra bằng cách truy vấn `prisma.user.findUnique({ where: { id: userId } })` hoặc xử lý `args.token` nếu có. Trong MCP context hiện tại không có `req.user`, nên tools chấp nhận `args.token` (JWT) hoặc `args.userId` — nếu không có thì reject. Điều này phù hợp với việc AI agents có thể được cấp token admin.

## Verification

**Commands:**
- `npx vitest run tests/mcp/server.test.js` -- expected: all tool definition tests pass.
- `npx vitest run tests/mcp/admin-tools.test.js` -- expected: 9+ admin tool tests pass.
