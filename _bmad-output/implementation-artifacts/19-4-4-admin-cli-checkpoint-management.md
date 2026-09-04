---
story_id: "19.4.4"
epic: 19
story_key: "19-4-4-admin-cli-checkpoint-management"
status: "done"
phase: "Phase 5"
created: "2026-09-04"
updated: "2026-09-04"
owner: "DEV"
reviewed: "Approved"
baseline_commit: "78e22d445496386bead1aa6402ef67aeb05301b5"
---

# Story 19.4.4: Admin CLI — Checkpoint Management

Status: ready-for-dev

## ⚠️ Critical Constraints / Architecture Variance

1. **Extend Existing `xactions admin checkpoints` Group** — Story 19.4 already created `checkpoints list` in `src/cli/commands/admin.js`. This story adds `resume`, `pause`, and `retry` subcommands under `xactions admin checkpoints`, plus an alias group `xactions admin checkpoint <list|resume|pause|retry>` (singular alias matching the established pattern in 19.4.2 and 19.4.3).
2. **Regression Prevention on Description**:
   - `tests/cli/admin-unified.test.js:262` tests `expect(checkpointsHelp).not.toMatch(/resume|pause|retry/i);`.
   - The description of the command group MUST NOT contain the words `resume`, `pause`, or `retry`.
   - Use: `.description('Manage crawl checkpoints (list, inspect, and update checkpoints)')`.
3. **REST-First with In-Process Fallback**:
   - For `resume <checkpointId>`: Call `POST /api/checkpoints/:id/resume`. If remote API is unreachable and `--url` was not provided, fall back to in-process `resumeCheckpoint(checkpointId, { prisma })`.
   - For `pause <checkpointId>`: Call `POST /api/checkpoints/:id/pause`. If remote API is unreachable and `--url` was not provided, fall back to in-process `pauseCheckpoint(checkpointId, { prisma })`.
   - For `retry <checkpointId>`: Call `POST /api/checkpoints/:id/retry`. If remote API is unreachable and `--url` was not provided, fall back to in-process `retryCheckpoint(checkpointId, { prisma })`.
4. **Dual Output Modes (CLI Formatted + Raw JSON)**:
   - Human-readable: Clean terminal messages with `chalk` and emojis (✅, ⚠️, ❌), displaying checkpoint ID, target, previous status, and updated status.
   - Machine-readable: Valid JSON output via `JSON.stringify(..., null, 2)` when `--json` is supplied.
5. **Standard Option Flags**:
   - `--url <url>`: Base API URL (defaults to `http://localhost:3001` or `resolveBaseUrl`).
   - `--token <token>`: Bearer token for admin authentication (`headers: { Authorization: 'Bearer ...' }`).
   - `--json`: Output raw JSON.
6. **No Direct DB Access in Remote Mode**: CLI queries REST endpoint first. In-process fallback only loads Prisma if local fallback is required.
7. **No Mocks in Tests**: Test against real `Command` and real checkpoint manager functions.

[Source: `_bmad-output/planning-artifacts/epics.md` lines 1098–1107; `api/routes/checkpoints.js`; `src/store/checkpoint-manager.js`]

---

## Story

As an **Internal Automation Operator**,  
I want **the commands `xactions admin checkpoints resume <checkpointId>`, `pause <checkpointId>`, and `retry <checkpointId>` (along with `xactions admin checkpoint ...` aliases)**,  
so that **I can inspect, pause, resume, and retry crawl pipelines from the terminal when an ingestion task stalls, encounters rate limits, or fails**.

---

## Acceptance Criteria

### AC-1: CLI Command Registration & Help Contract

- **Given** the `xactions admin` command group
- **When** the operator runs `xactions admin checkpoints --help` or `xactions admin checkpoint --help`
- **Then** the output lists:
  - `list`: List crawl checkpoints with filtering and pagination
  - `resume <checkpointId>`: Resume a paused, failed, or stalled checkpoint
  - `pause <checkpointId>`: Pause a running or stalled checkpoint
  - `retry <checkpointId>`: Retry a failed checkpoint
- **And** all subcommands support options `--url <url>`, `--token <token>`, `--json`

### AC-2: Resume Checkpoint via REST or In-Process Manager

- **Given** a paused, stalled, or failed checkpoint ID
- **When** the operator runs `xactions admin checkpoints resume <checkpointId>` (or `admin checkpoint resume ...`)
- **Then** the command attempts `POST /api/checkpoints/:id/resume` with Bearer token
- **And** on success, prints a confirmation showing the checkpoint ID, target key, and new status (`running`)
- **And** if `--json` is passed, outputs `{ success: true, data: { checkpoint: { ... } } }`
- **And** if the remote API is unreachable and no explicit `--url` was given, falls back to in-process `resumeCheckpoint(checkpointId, { prisma })`

### AC-3: Pause Checkpoint via REST or In-Process Manager

- **Given** an active or running checkpoint ID
- **When** the operator runs `xactions admin checkpoints pause <checkpointId>` (or `admin checkpoint pause ...`)
- **Then** the command attempts `POST /api/checkpoints/:id/pause` with Bearer token
- **And** on success, prints a confirmation showing the checkpoint ID and updated status (`paused`)
- **And** if `--json` is passed, outputs `{ success: true, data: { checkpoint: { ... } } }`
- **And** if the remote API is unreachable and no explicit `--url` was given, falls back to in-process `pauseCheckpoint(checkpointId, { prisma })`

### AC-4: Retry Checkpoint via REST or In-Process Manager

- **Given** a failed checkpoint ID
- **When** the operator runs `xactions admin checkpoints retry <checkpointId>` (or `admin checkpoint retry ...`)
- **Then** the command attempts `POST /api/checkpoints/:id/retry` with Bearer token
- **And** on success, prints a confirmation showing the checkpoint ID and reset status (`running`)
- **And** if `--json` is passed, outputs `{ success: true, data: { checkpoint: { ... } } }`
- **And** if the remote API is unreachable and no explicit `--url` was given, falls back to in-process `retryCheckpoint(checkpointId, { prisma })`

### AC-5: Error Handling & Validation

- **Given** missing required arguments
- **When** the operator runs `resume`, `pause`, or `retry` without `<checkpointId>`
- **Then** Commander displays an argument validation error
- **And** when the checkpoint is not found (404), it prints the error cleanly with `printCliError(err, { json: options.json })`

---

## Developer Context & Implementation Guidance

### Key Files & Locations

| Component | File Path | Role |
|---|---|---|
| CLI Command Entry | `src/cli/commands/admin.js` | Add `resume`, `pause`, `retry` to `checkpointsCmd`, register alias `adminCmd.command('checkpoint')` |
| CLI Error Formatter | `src/cli/shared.js` | Uses `printCliError`, `resolveBaseUrl`, `fetchAdminJson`, `formatCheckpointList` |
| Checkpoint Manager | `src/store/checkpoint-manager.js` | `listCheckpoints`, `resumeCheckpoint`, `pauseCheckpoint`, `retryCheckpoint` |
| Checkpoint REST Routes | `api/routes/checkpoints.js` | Lines 160–252 (`GET /api/checkpoints`, `POST /:id/resume`, `POST /:id/pause`, `POST /:id/retry`) |
| Integration Tests | `tests/cli/admin-checkpoints.test.js` | Vitest test suite for checkpoint CLI subcommands |

### Implementation Pattern for `admin.js`

```javascript
// Helper to register checkpoint subcommands on either 'checkpoints' or 'checkpoint' alias
const registerCheckpointSubcommands = (cmd) => {
  // 1. Existing list command...
  // 2. resume command:
  cmd
    .command('resume <checkpointId>')
    .description('Resume a paused, failed, or stalled checkpoint')
    .option('--url <url>', 'Base API / Daemon URL (default: http://localhost:3001)')
    .option('--token <token>', 'Bearer token for admin authentication')
    .option('--json', 'Output raw JSON')
    .action(async (checkpointId, options) => {
      let prisma;
      try {
        const baseUrl = resolveBaseUrl(options.url);
        let body;
        try {
          const result = await fetchAdminJson(`${baseUrl}/api/checkpoints/${encodeURIComponent(checkpointId)}/resume`, {
            method: 'POST',
            token: options.token,
          });
          if (result.ok) {
            body = result.body;
          } else if (options.url) {
            const errDetail = typeof result.body === 'object' && result.body?.error ? (result.body.error.message || result.body.error) : result.statusText;
            throw new Error(`Remote checkpoint resume failed: HTTP ${result.status} ${errDetail}`);
          }
        } catch (err) {
          if (options.url) throw err;
        }

        if (!body) {
          const { default: sharedPrisma } = await import('../../../api/lib/prisma.js');
          prisma = sharedPrisma;
          const { resumeCheckpoint } = await import('../../store/checkpoint-manager.js');
          const checkpoint = await resumeCheckpoint(checkpointId, { prisma });
          body = { success: true, data: { checkpoint } };
        }

        if (options.json) {
          console.log(JSON.stringify(body, null, 2));
          return;
        }

        const cp = body.data?.checkpoint || body;
        console.log(chalk.green(`\n✔ Checkpoint resumed: ${chalk.bold(cp.id || checkpointId)}`));
        console.log(chalk.dim(`  Target: ${cp.targetType}:${cp.targetKey} | Status: ${cp.status}\n`));
      } catch (err) {
        printCliError(err instanceof Error ? err : new Error(String(err)), { json: options.json });
      } finally {
        await disconnectPrismaUnlessShared(prisma, true);
      }
    });

  // 3. pause command (POST /api/checkpoints/:id/pause, fallback to pauseCheckpoint)
  // 4. retry command (POST /api/checkpoints/:id/retry, fallback to retryCheckpoint)
};

// Register on both plural and singular:
const checkpointsCmd = adminCmd
  .command('checkpoints')
  .description('Manage crawl checkpoints (list, inspect, and update checkpoints)');
registerCheckpointSubcommands(checkpointsCmd);

const checkpointCmd = adminCmd
  .command('checkpoint')
  .description('Manage crawl checkpoints (alias for checkpoints)');
registerCheckpointSubcommands(checkpointCmd);
```

---

## Testing Plan

1. **Unit & CLI Verification (`tests/cli/admin-checkpoints.test.js`)**:
   - Verify `xactions admin checkpoints --help` and `xactions admin checkpoint --help` list `list`, `resume`, `pause`, and `retry`.
   - Test in-process fallback for `pause`, `resume`, and `retry` on real/seeded checkpoint records.
   - Test `--json` flag formats valid JSON output for all actions.
   - Test error handling when an unknown checkpoint ID is provided.
2. **Regression Check**:
   - Run all existing admin test suites (`admin-unified`, `admin-status`, `admin-stream`, `admin-proxies`, `admin-accounts`).

---

## Completion Status

- **Status**: `done`
- **Reviewed**: `Approved`
- **Notes**: Implemented resume, pause, and retry commands on both checkpoints and checkpoint alias groups, with REST API execution, in-process fallback, and 9/9 unit tests passing.

---

## Review Findings

- ✅ **Clean review — all layers passed.**
  - Blind Hunter: Pass
  - Edge Case Hunter: Pass
  - Verification Gap: Pass (9/9 tests passing)
  - Acceptance Auditor: Pass (AC-1 through AC-5 satisfied)
