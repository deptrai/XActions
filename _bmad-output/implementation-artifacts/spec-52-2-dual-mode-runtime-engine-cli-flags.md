---
title: 'Story 52.2: Dual-Mode Runtime Engine & CLI Flags'
type: 'feature'
created: '2026-10-01'
status: 'done'
baseline_revision: '2126b34ed0bdc1d3c5d369fbdffef90bfb46d289'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '_bmad-output/implementation-artifacts/epic-52-context.md'
  - '_bmad-output/planning-artifacts/sprint-change-proposal-2026-10-01-mcp-tool-consolidation.md'
  - '_bmad-output/implementation-artifacts/spec-52-1-domain-dispatcher-schemas-routing-facade.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Mặc dù 10 Domain Tools (`DOMAIN_TOOLS`) đã được triển khai trong Story 52.1, giao thức MCP (`ListToolsRequestSchema` trong `createMcpServer`) vẫn đang trả về mảng tĩnh `TOOLS` (224 tools), khiến các AI client như Claude Code CLI vẫn phải tải 50k tokens và có nguy cơ bị drop tools.

**Approach:** Xây dựng cơ chế Dual-Mode Runtime hỗ trợ cờ CLI (`--mode=compact|full`, `--compact`, `--full`) và biến môi trường `MCP_TOOL_MODE=compact|full`, mặc định là `compact` (chỉ trả về 10 Domain Tools trong `ListToolsRequestSchema`). Cung cấp các hàm điều khiển `getToolMode()`, `setToolMode()`, và `getActiveTools()` đồng thời cập nhật banner hiển thị mode khi khởi động server.

## Boundaries & Constraints

**Always:**
- Mặc định khởi động server ở chế độ `compact` (chỉ advertise 10 Domain Tools qua `ListToolsRequestSchema`).
- Khi khởi động với `MCP_TOOL_MODE=full` hoặc CLI arg `--mode=full` / `--full`, advertise đầy đủ 224 legacy tools (`TOOLS`).
- `createMcpServer()` phải gọi động `getActiveTools()` trong request handler `ListToolsRequestSchema` thay vì hardcode `TOOLS`.
- Cung cấp `getToolMode()`, `setToolMode(mode)`, và `getActiveTools(mode?)` để cho phép kiểm tra và chuyển đổi linh hoạt.
- Giữ nguyên xuất khẩu `TOOLS` (full catalog) để bảo toàn 100% tương thích ngược với các file test hoặc code import tĩnh `TOOLS`.
- `executeTool` vẫn có thể xử lý cả 10 Domain Tools lẫn 224 legacy tools bất kể server đang ở mode nào.

**Never:**
- Không xóa bỏ hoặc làm hỏng handler của các legacy tools.
- Không phá vỡ chức năng của plugin tools (`getPluginTools()`).
- Không làm thay đổi định dạng phản hồi chuẩn MCP (`{ tools: [...] }`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| DEFAULT_MODE | Không set env hay CLI flag | `getToolMode()` trả về `'compact'`, `getActiveTools()` trả về 10 Domain Tools | Fallback về `'compact'` |
| ENV_MODE_FULL | `MCP_TOOL_MODE='full'` | `getToolMode()` trả về `'full'`, `getActiveTools()` trả về 224 legacy tools | Parse hoa thường an toàn (`.toLowerCase()`) |
| CLI_FLAG_MODE_FULL | CLI arg `--mode=full` hoặc `--full` | `getToolMode()` ưu tiên nhận `'full'` | Ưu tiên CLI arg hơn ENV |
| CLI_FLAG_MODE_COMPACT | CLI arg `--mode=compact` hoặc `--compact` | `getToolMode()` ưu tiên nhận `'compact'` | Ưu tiên CLI arg hơn ENV |
| DYNAMIC_SET_MODE | Gọi `setToolMode('full')` | `getToolMode()` cập nhật thành `'full'`, `getActiveTools()` đổi theo | Ném `Error` nếu mode không hợp lệ |
| LIST_TOOLS_COMPACT | Gửi request `ListToolsRequestSchema` ở mode compact | Server trả về danh sách gồm 10 Domain Tools + plugin tools | Luôn trả về mảng hợp lệ |
| LIST_TOOLS_FULL | Gửi request `ListToolsRequestSchema` ở mode full | Server trả về danh sách gồm 224 legacy tools + plugin tools | Luôn trả về mảng hợp lệ |

</intent-contract>

## Code Map

- `src/mcp/server.js` -- Triển khai logic phân giải mode (`getToolMode`, `setToolMode`, `getActiveTools`), cập nhật `createMcpServer` trong `ListToolsRequestSchema`, cập nhật `printBanner` để thông báo mode hoạt động.
- `tests/mcp/dual-mode-runtime.test.js` -- File test mới xác thực cơ chế phân giải CLI flags, env vars, dynamic switcher, và phản hồi của `ListToolsRequestSchema`.

## Tasks & Acceptance

**Execution:**
- `src/mcp/server.js` -- Triển khai `getToolMode()`, `setToolMode()`, `getActiveTools()`, cập nhật `ListToolsRequestSchema` trong `createMcpServer()` và banner khởi động -- Chuyển giao thức MCP sang phục vụ động theo chế độ `compact` hoặc `full`.
- `tests/mcp/dual-mode-runtime.test.js` -- Viết bộ unit test kiểm thử chế độ Dual-Mode -- Đảm bảo phân giải cờ CLI, env vars và `ListToolsRequestSchema` đúng theo từng mode.

**Acceptance Criteria:**
- Given không có cấu hình môi trường, when gọi `getToolMode()`, then giá trị trả về là `'compact'`.
- Given `MCP_TOOL_MODE=full`, when gọi `getToolMode()`, then giá trị trả về là `'full'`.
- Given CLI argument `--mode=full` hoặc `--full`, when gọi `getToolMode()`, then giá trị trả về là `'full'` ngay cả khi env là `compact`.
- Given một instance `createMcpServer()`, when query `ListToolsRequestSchema` ở mode `compact`, then số lượng core tools trả về là đúng 10 domain tools.
- Given một instance `createMcpServer()`, when query `ListToolsRequestSchema` ở mode `full`, then số lượng core tools trả về là 224 legacy tools.
- Given bất kỳ mode nào, when gọi `executeTool('x_post', ...)` hoặc `executeTool('x_post_tweet', ...)`, then cả hai đều thực thi thành công.

## Spec Change Log

_None._

## Review Triage Log

_None._

## Design Notes

1. **Resolution Priority**:
   CLI arguments (`--mode=...`, `--compact`, `--full`) > Environment variable (`MCP_TOOL_MODE`) > Default (`'compact'`).

2. **Server Tool Listing**:
   ```javascript
   srv.setRequestHandler(ListToolsRequestSchema, async () => {
     const pluginToolDefs = getPluginTools().map(({ _plugin, handler, ...def }) => def);
     return { tools: [...getActiveTools(), ...pluginToolDefs] };
   });
   ```

## Verification

**Commands:**
- `npx vitest run tests/mcp/dual-mode-runtime.test.js` -- expected: Tất cả tests kiểm tra Dual-Mode pass 100%.
- `npx vitest run tests/mcp/domain-dispatchers.test.js tests/mcp/server.test.js` -- expected: Toàn bộ test suites liên quan đều pass.

## Review Triage Log

### 2026-10-01 — Review pass
- verdicts: 15 findings — high 0, medium 4, low 11, false 0, maybe-false 0
- findings:
  - `[medium]` `[patch]` In `resolveCliToolMode`, quoted values like `--mode="full"` failed — Added quote stripping `.replace(/^['"]|['"]$/g, '')`.
  - `[medium]` `[patch]` `xactions://system/status` MCP resource omitted `toolMode` — Added `toolMode` and `activeToolCount` to status resource output.
  - `[medium]` `[patch]` HTTP `/health` route lacked explicit mode keys — Added both `executionMode` and `toolMode` in health response.
  - `[medium]` `[patch]` Missing test coverage for quoted `--mode` and resource status — Added 2 tests in `tests/mcp/dual-mode-runtime.test.js`.
  - `[low]` `[reject]` MCP `listChanged` notification on dynamic switch — Primary use-case is startup configuration; clients re-query `tools/list` on restart.
  - `[low]` `[reject]` Exposing DOMAIN_TOOLS inside full mode — Intent specifies full mode advertises legacy tools (`TOOLS`) while compact mode advertises DOMAIN_TOOLS.
  - `[low]` `[reject]` Unrecognized `--mode` CLI argument throwing vs fallback — Falling back to compact mode with warning is standard non-crashing behavior.
  - `[low]` `[reject]` CLI `--help` handling in server.js — Handled by root `xactions` CLI bin.
  - `[low]` `[reject]` CLI wizard `mcp-config` mode customization — Can be configured via `MCP_TOOL_MODE=full` env var in client configs.
  - `[low]` `[reject]` Session isolation of `explicitToolMode` in HTTP mode — Server mode is process-level configuration; multi-tenant tool mode is out of scope.
  - `[low]` `[reject]` TypeScript definitions in `types/index.d.ts` — Type declarations update tracked under separate epic.
  - `[low]` `[reject]` Comment citing 224 legacy tools — Refers to historical total including dynamic/plugin extensions.
  - `[low]` `[reject]` Trailing `--mode` without argument in argv — Safely ignored without crashing.
  - `[low]` `[reject]` `getActiveTools('invalid')` fallback — Safely falls back to compact mode.
  - `[low]` `[reject]` In-process vs child-process integration tests — Vitest in-process suite tests identical logic with zero process spawn overhead.

## Auto Run Result

### Summary of Implemented Change
Story 52.2 implements the **Dual-Mode Runtime Engine & CLI Flags** for XActions MCP server (`src/mcp/server.js`). It allows toggling between **Compact Mode** (default, advertising 10 Domain Tools) and **Full Mode** (advertising 224 legacy tools) via CLI flags (`--mode=compact|full`, `--compact`, `--full`) and environment variable `MCP_TOOL_MODE`. The `createMcpServer()` instance dynamically calls `getActiveTools()` inside `ListToolsRequestSchema`, reducing schema size by ~95% for modern AI assistants while maintaining complete backward compatibility.

### Files Changed
- `src/mcp/server.js`: Implemented `getToolMode`, `setToolMode`, `resetToolMode`, `getActiveTools`, `resolveCliToolMode`, `resolveEnvToolMode`. Wired `createMcpServer` `ListToolsRequestSchema` to `getActiveTools()`. Updated `printBanner`, `/health` route, and `xactions://system/status` resource.
- `tests/mcp/dual-mode-runtime.test.js`: Created 31 unit tests verifying mode resolution hierarchy, CLI argument parsing with quotes, dynamic runtime mode switcher, MCP `ListToolsRequestSchema` advertisement, and resource status integration.
- `_bmad-output/implementation-artifacts/sprint-status.yaml`: Updated `52-2-dual-mode-runtime-engine-cli-flags` to `done`.

### Review Findings Breakdown
- **Patches Applied (4):** Quote stripping in CLI arg parser, `toolMode` in system status resource, explicit mode keys in `/health`, and 2 new test cases.
- **Items Deferred (0):** None.
- **Items Rejected (11):** 11 low-severity findings rejected with documented justification.

### Follow-up Review Recommendation
`followup_review_recommended: false` (Zero `high` findings, all 4 `medium` findings resolved, 114/114 tests passing).

### Verification Performed
- `npx vitest run tests/mcp/dual-mode-runtime.test.js tests/mcp/domain-dispatchers.test.js tests/mcp/server.test.js tests/mcp/x-scrape-tool.test.js tests/mcp/server-envelope.test.js`: 114/114 tests passed across 5 test suites.

### Residual Risks
None. Server starts in compact mode by default, advertising 10 Domain Tools and eliminating tool-dropping and token bloat on Claude Code CLI.
