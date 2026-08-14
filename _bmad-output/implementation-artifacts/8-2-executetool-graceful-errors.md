---
baseline_commit: f6c946e
---

# Story 8.2: Graceful executeTool Unknown Tool Handling

Status: ready-for-dev

## Story

As an MCP client,
I want `executeTool` to return a proper MCP error result instead of throwing,
So that my client does not crash on unknown tools or uninitialized `localTools`.

## Context

- **Source:** PCR6 in `_bmad-output/planning-artifacts/epics-full.md` and `_bmad-output/planning-artifacts/sprint-change-proposal-2026-08-14.md`
- **Problem:** `executeTool` in `src/mcp/server.js` currently throws `Error("Unknown tool: <name>")` when a tool is not in `localTools`, and `localTools?.[toolName]` masks the `null`/`undefined` case but still throws an opaque error. Callers of `executeTool` have to catch and convert to `{ isError: true, content: [...] }`; this is fragile and can leak as an unhandled exception.
- **Scope:** Refactor `executeTool` to validate `localTools` and tool existence internally and return an MCP error result object directly.
- **Impact surface:** `src/mcp/server.js` only. The top-level `CallToolRequestSchema` handler already wraps `executeTool` in try/catch; this story makes `executeTool` itself robust.

## Acceptance Criteria

### AC1 — `localTools` uninitialized

**Given** `localTools` is `null` or `undefined`
**When** `executeTool` is called
**Then** it returns `{ isError: true, content: [{ type: 'text', text: 'Local tools not initialized' }] }`
**And** it does not throw `Cannot read properties of null`

### AC2 — Unknown tool name

**Given** a tool name that does not exist in `localTools`
**When** `executeTool` is called
**Then** it returns `{ isError: true, content: [{ type: 'text', text: 'Unknown tool: <name>' }] }`
**And** it does not throw `Error("Unknown tool")`

### AC3 — Existing successful calls still work

**Given** `localTools` is initialized and the tool name exists
**When** `executeTool` is called
**Then** it continues to call the tool and return the normal result object

## Tasks / Subtasks

- [ ] **Task 1: Read and understand `executeTool` and tests**
  - [ ] Read `src/mcp/server.js` lines 2657–2785 (the `executeTool` function)
  - [ ] Read `src/mcp/local-tools.js` to understand the `toolMap` shape
  - [ ] Read `tests/mcp/server.test.js` and `tests/mcp/*.test.js` for test conventions

- [ ] **Task 2: Refactor `executeTool` to return MCP error results**
  - [ ] At the start of the local-mode branch, if `localTools` is null/undefined, return error result (AC1)
  - [ ] If `toolFn` is not found, return error result with `Unknown tool: ${name}` (AC2)
  - [ ] Keep the `localTools?.[toolName] || localTools?.[name]` resolution logic, but convert the "not found" branch from `throw` to `return`

- [ ] **Task 3: Verify existing error result format matches MCP spec**
  - [ ] Match the shape already used in the `CallToolRequestSchema` catch block (lines 4817–4829):
    ```js
    {
      content: [{ type: 'text', text: JSON.stringify({ error: '...', message: '...' }) }],
      isError: true,
    }
    ```
  - [ ] Or use a simpler `text` message if the existing tests expect plain text. Inspect existing tests first.

- [ ] **Task 4: Add tests**
  - [ ] Add `tests/mcp/server.test.js` cases (or a new `tests/mcp/execute-tool.test.js`):
    - `executeTool` with `localTools = null` returns `isError: true`
    - `executeTool` with unknown tool name returns `isError: true` and message contains `Unknown tool: <name>`
    - `executeTool` with known tool still returns normal result
  - [ ] Ensure tests can override `localTools` by importing the module under test or by exposing a seam

- [ ] **Task 5: Run tests**
  - [ ] `npx vitest run tests/mcp`
  - [ ] `npx vitest run tests/mcp/server.test.js` (or new test file)

## Dev Notes

### Files to touch

| File | Role |
|---|---|
| `src/mcp/server.js` | Main implementation: convert throws in `executeTool` to error result returns |
| `tests/mcp/server.test.js` or `tests/mcp/execute-tool.test.js` | New/updated tests for AC1, AC2, AC3 |

### Code location

- `executeTool` is defined at `src/mcp/server.js` lines 2657–2785.
- The relevant local-mode branch is lines 2774–2783:
  ```js
  const toolFn = localTools?.[toolName] || localTools?.[name];
  if (!toolFn) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return await toolFn(args);
  ```
- `localTools` is declared at line 60 as `let localTools = null;` and assigned at line 2646 inside `initializeLocalMode`.

### Existing error result pattern

The `CallToolRequestSchema` handler (lines 4767–4831) already catches errors and returns:
```js
{
  content: [{ type: 'text', text: JSON.stringify({ error: error.message, ... }) }],
  isError: true,
}
```
`executeTool` should produce the same shape for consistency, so the top-level catch block becomes a safety net rather than the primary converter.

### Testing approach

- If `executeTool` is not exported, either export it for testing or test via the `CallToolRequestSchema` handler.
- The existing `tests/mcp/*.test.js` files import `src/mcp/server.js` and call tools through the exported tool helpers (e.g., `executeFacebookListAccounts`). For this story, the most direct test is to instantiate the MCP server and send a `CallToolRequestSchema` request with an unknown tool.
- Alternatively, if a unit test for `executeTool` is desired, refactor `executeTool` to be exported, or add it to a new testable module. Prefer minimal change: keep `executeTool` private and test through the request handler.

### Guardrails

- Do not change the `throw` behavior for other branches (e.g., fail-fast validation in `executeFacebookAutomateTool`) unless directly related to AC1/AC2.
- Do not change `localTools` initialization timing; only make the function resilient to `null`.
- Preserve the existing result shape for successful calls.

## Dev Agent Record

### Agent Model Used

SWE-1.7 Max

### Completion Notes List

- Modified `executeTool` in `src/mcp/server.js` to return `{ isError: true, content: [{ type: 'text', text: '...' }] }` instead of throwing when `localTools` is uninitialized or the tool name is unknown.
- Added the same guard for `remoteClient` being uninitialized in remote mode.
- Updated `CallToolRequestSchema` handler to propagate `executeTool` error results directly (without wrapping them in `JSON.stringify`).
- Exported `initializeBackend` so tests can reset module state.
- Added `tests/mcp/execute-tool.test.js` covering AC1 (uninitialized localTools), AC2 (unknown tool after init), and AC3 (known tool still works).

### File List

- `src/mcp/server.js` (updated)
- `tests/mcp/execute-tool.test.js` (new)

## Review Findings

(To be filled after code review)
