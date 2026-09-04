---
story_id: "19.10"
epic: 19
story_key: "19-10-admin-mcp-tools"
status: "done"
phase: "Phase 5"
created: "2026-09-05"
updated: "2026-09-05"
owner: "DEV"
reviewed: "Approved"
baseline_commit: "6b793c4b0e2352f2bcf5ff253be37db2cb330373"
---

# Story 19.10: Admin MCP Tools for AI Agents

## Status

done

---

## Critical Constraints / Architecture Variance

1. **Admin Tool Namespace**: All tools start with `x_admin_`.
2. **Admin Privilege Required**: Every tool calls `requireAdmin(args)`, which accepts a `token` or `userId` and throws `PlatformError` with code `XACT_4003` for missing/invalid/expired/non-admin credentials.
3. **No New Business Logic**: Tools wrap existing CLI/REST singletons (`globalProxyPool`, `globalAccountPool`, `checkpoint-manager.js`, `defaultStreamMetricsCollector`, `defaultStreamAlertEngine`, `globalStatusApi`).
4. **No Direct DB Access**: Checkpoints use the shared `prisma` instance imported at the top of `src/mcp/server.js`.
5. **Return Raw Objects**: `executeAdminTool` returns plain objects; the outer `CallTool` handler in `createMcpServer` wraps them in the 3-layer envelope via `wrapToolResult`.
6. **Tests Are Real**: `tests/mcp/admin-tools.test.js` hits real singletons and the local Prisma test database. No mocks.

---

## Story

As an **AI Agent using the XActions MCP server**,  
I want **admin tools exposed through MCP**,  
so that **I can query system status, control proxies, wake accounts, and manage checkpoints without using the CLI or dashboard**.

---

## Acceptance Criteria

### AC-1: Tool Definitions Registered

- **Given** the MCP server `TOOLS` array  
- **When** `src/mcp/server.js` is imported  
- **Then** the following 9 admin tools are present:
  - `x_admin_status`
  - `x_admin_proxies_list`
  - `x_admin_proxy_quarantine`
  - `x_admin_accounts_list`
  - `x_admin_account_wake`
  - `x_admin_checkpoints_list`
  - `x_admin_checkpoint_action`
  - `x_admin_stream_metrics`
  - `x_admin_stream_alerts`

### AC-2: Admin Authentication Gate

- **Given** a user without `isAdmin=true`  
- **When** any `x_admin_*` tool is called  
- **Then** the response is `success: false` with code `XACT_4003`.

### AC-3: System Status

- **Given** an admin token  
- **When** `x_admin_status` is called  
- **Then** it returns governor status, proxy health, and hibernating accounts.

### AC-4: Proxy & Account Management

- **Given** an admin token  
- **When** `x_admin_proxies_list` / `x_admin_proxy_quarantine` / `x_admin_accounts_list` / `x_admin_account_wake` are called  
- **Then** they return the same data as `xactions admin proxies` and `xactions admin accounts` CLI commands.

### AC-5: Checkpoint Management

- **Given** an admin token  
- **When** `x_admin_checkpoints_list` or `x_admin_checkpoint_action { id, action: 'retry' }` is called on a `failed` checkpoint  
- **Then** it returns the list or transitions the checkpoint to `running`.

### AC-6: Stream Metrics & Alerts

- **Given** an admin token  
- **When** `x_admin_stream_metrics` or `x_admin_stream_alerts` is called  
- **Then** it returns the same metrics/alert status as the CLI.

---

## Implementation Notes

- File: `src/mcp/server.js`
  - Added `import jwt from 'jsonwebtoken';`
  - Added lazy loaders: `getProxyPool`, `getCheckpointManager`, `getStreamMetricsCollector`, `getStreamAlertsEngine`
  - Added 9 tool definitions to `TOOLS`
  - Added `resolveUserId`, `requireAdmin`, and `executeAdminTool`
  - Added `name.startsWith('x_admin_')` dispatch in `executeTool`
- File: `tests/mcp/admin-tools.test.js`
  - 13 real-singleton/Prisma tests covering TOOL definitions, auth gates, status, proxies, accounts, checkpoints, and stream metrics/alerts.

---

## Verification

```bash
npx vitest run tests/mcp/server.test.js
npx vitest run tests/mcp/admin-tools.test.js
npx vitest run tests/mcp/execute-tool.test.js
npx vitest run tests/mcp/
```

All 215 MCP tests passed.
