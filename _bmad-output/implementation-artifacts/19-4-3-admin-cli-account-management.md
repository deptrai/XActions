---
story_id: "19.4.3"
epic: 19
story_key: "19-4-3-admin-cli-account-management"
status: "ready-for-dev"
phase: "Phase 5"
created: "2026-09-04"
updated: "2026-09-04"
owner: "DEV"
reviewed: "Pending"
baseline_commit: "586591abb5a35ea6f582f3c7ae092a95c4cf7e72"
---

# Story 19.4.3: Admin CLI — Account Management

Status: ready-for-dev

## ⚠️ Critical Constraints / Architecture Variance

1. **Extend Existing `xactions admin accounts` Group** — Story 19.4 already created `accounts list` in `src/cli/commands/admin.js`. This story adds `wake` and `rotate` subcommands under `xactions admin accounts`, plus an alias group `xactions admin account <list|wake|rotate>` (singular alias matching the established pattern in 19.4.2).
2. **REST-First with In-Process Fallback**:
   - For `wake <accountId>`: Attempt `POST /api/admin/accounts/wake` with body `{ accountId, platform }` (or `POST /api/admin/accounts/:id/wake`). If remote API is unreachable and no explicit `--url` was provided, fall back to `globalAccountPool.markAvailable(accountId, platform)`.
   - For `rotate <accountId> [platform]`: Attempt `POST /api/admin/accounts/rotate` with body `{ accountId, platform }` (or `POST /api/admin/accounts/:id/rotate`). If remote API is unreachable, fall back to `globalAccountPool.getNextAvailable(platform)`.
3. **409 Conflict Handling on Non-Hibernating Wake**: If the server returns 409 Conflict (`Account is not currently in hibernation`), the CLI must print an informative message rather than crashing, or return `{ success: false, error: "..." }` when `--json` is specified.
4. **Dual Output Modes (CLI Formatted + Raw JSON)**:
   - Human-readable: Clear terminal messages with `chalk` and emojis (✅, ⚠️, ❌).
   - Machine-readable: Valid JSON output via `JSON.stringify(..., null, 2)` when `--json` is supplied.
5. **Standard Option Flags**:
   - `--platform <platform>`: Target platform filter/scope (e.g. `twitter`, `facebook`, `threads`, `bluesky`, `mastodon`).
   - `--url <url>`: Base API URL (defaults to `http://localhost:3001` or `resolveBaseUrl`).
   - `--token <token>`: Bearer token for admin authentication (`headers: { Authorization: 'Bearer ...' }`).
   - `--json`: Output raw JSON.
6. **No Direct DB Access & No Browser / Puppeteer**: CLI only invokes REST API or `AccountPool`.
7. **No Mocks in Tests**: Test against real `Command` and real `AccountPool` / Express instances.

[Source: `_bmad-output/planning-artifacts/epics.md` lines 1086–1097; `api/routes/admin.js:510–601`; `src/core/account-pool.js:217–332`]

---

## Story

As an **Internal Automation Operator**,  
I want **the commands `xactions admin accounts wake <accountId>` and `xactions admin accounts rotate <accountId> [platform]` (along with `xactions admin account ...` aliases)**,  
so that **I can inspect, wake hibernating accounts, and rotate assigned crawler accounts directly from the terminal without restarting services**.

---

## Acceptance Criteria

### AC-1: CLI Command Registration & Help Contract

- **Given** the `xactions admin` command group
- **When** the operator runs `xactions admin accounts --help` or `xactions admin account --help`
- **Then** the output lists:
  - `list`: List all accounts with hibernation status and velocity
  - `wake <accountId>`: Wake an account from hibernation
  - `rotate <accountId> [platform]`: Rotate to the next available account in the pool
- **And** `wake` supports options `-p, --platform <platform>`, `--url <url>`, `--token <token>`, `--json`
- **And** `rotate` supports options `-p, --platform <platform>`, `--url <url>`, `--token <token>`, `--json`

### AC-2: Wake Account via REST or In-Process Pool

- **Given** an account in hibernation (e.g., `acc_tw_01`)
- **When** the operator runs `xactions admin accounts wake acc_tw_01 --platform twitter` (or `admin account wake ...`)
- **Then** the command attempts `POST /api/admin/accounts/wake` with Bearer token
- **And** on success, prints a confirmation that the account is now active and ready
- **And** if `--json` is passed, outputs `{ success: true, accountId: "acc_tw_01", status: "active", message: "..." }`
- **And** if the account is not in hibernation, handles the 409 status cleanly with a warning message
- **And** if the remote API is unreachable and no explicit `--url` was given, falls back to in-process `globalAccountPool.markAvailable(accountId, platform)`

### AC-3: Rotate Account via REST or In-Process Pool

- **Given** an active or rate-limited account in the pool
- **When** the operator runs `xactions admin accounts rotate acc_tw_01 twitter` (or `admin account rotate ...`)
- **Then** the command attempts `POST /api/admin/accounts/rotate` with Bearer token
- **And** on success, prints both the previous account ID and the next assigned account ID
- **And** if `--json` is passed, outputs `{ success: true, previousAccountId: "...", nextAccountId: "...", platform: "..." }`
- **And** if the remote API is unreachable and no explicit `--url` was given, falls back to in-process `globalAccountPool.getNextAvailable(platform)`

### AC-4: Error Handling & Validation

- **Given** missing required arguments
- **When** the operator runs `wake` or `rotate` without `<accountId>`
- **Then** Commander displays an argument validation error
- **And** when the account is not found (404), it prints the error cleanly with `printCliError(err, { json: options.json })`

---

## Developer Context & Implementation Guidance

### Key Files & Locations

| Component | File Path | Role |
|---|---|---|
| CLI Command Entry | `src/cli/commands/admin.js` | Add `wake` and `rotate` to `accountsCmd`, register alias `adminCmd.command('account')` |
| CLI Error Formatter | `src/cli/shared.js` | Uses `printCliError`, `resolveBaseUrl`, `fetchAdminJson` |
| Account Pool Core | `src/core/account-pool.js` | `globalAccountPool.markAvailable(accountId, platform)`, `globalAccountPool.getNextAvailable(platform)` |
| Admin REST Routes | `api/routes/admin.js` | Lines 510–601 (`POST /api/admin/accounts/wake`, `POST /api/admin/accounts/rotate`) |
| Integration Tests | `tests/cli/admin-accounts.test.js` | Vitest test suite for account CLI subcommands |

### Implementation Pattern for `admin.js`

```javascript
// Helper to register account subcommands on either 'accounts' or 'account' alias
const registerAccountSubcommands = (cmd) => {
  // 1. Existing list command...
  // 2. wake command:
  cmd
    .command('wake <accountId>')
    .description('Wake an account from hibernation')
    .option('-p, --platform <platform>', 'Account platform')
    .option('--url <url>', 'Base API / Daemon URL (default: http://localhost:3001)')
    .option('--token <token>', 'Bearer token for admin authentication')
    .option('--json', 'Output raw JSON')
    .action(async (accountId, options) => {
      // 1. REST call: POST /api/admin/accounts/wake with body { accountId, platform: options.platform }
      // 2. Fallback: globalAccountPool.markAvailable(accountId, options.platform)
    });

  // 3. rotate command:
  cmd
    .command('rotate <accountId> [platform]')
    .description('Rotate to the next available account in the pool')
    .option('-p, --platform <platform>', 'Account platform (alternative to argument)')
    .option('--url <url>', 'Base API / Daemon URL (default: http://localhost:3001)')
    .option('--token <token>', 'Bearer token for admin authentication')
    .option('--json', 'Output raw JSON')
    .action(async (accountId, platformArg, options) => {
      const platform = platformArg || options.platform;
      // 1. REST call: POST /api/admin/accounts/rotate with body { accountId, platform }
      // 2. Fallback: globalAccountPool.getNextAvailable(platform)
    });
};

// Register on both plural and singular:
const accountsCmd = adminCmd
  .command('accounts')
  .description('Manage account pool (list, wake, and rotate accounts)');
registerAccountSubcommands(accountsCmd);

const accountCmd = adminCmd
  .command('account')
  .description('Manage account pool (alias for accounts)');
registerAccountSubcommands(accountCmd);
```

---

## Testing Plan

1. **Unit & CLI Verification (`tests/cli/admin-accounts.test.js`)**:
   - Verify `xactions admin accounts --help` and `xactions admin account --help` list `list`, `wake`, and `rotate`.
   - Test in-process fallback for `wake` on a hibernating account record.
   - Test in-process fallback for `rotate` and verify the next available account is returned.
   - Test `--json` flag formats valid JSON output for all commands.
   - Test error handling when an unknown account ID is provided.
2. **Regression Check**:
   - Run all existing admin test suites (`admin-unified`, `admin-status`, `admin-stream`, `admin-proxies`).

---

## Completion Status

- **Status**: `ready-for-dev`
- **Notes**: Master implementation guide for Story 19.4.3 Admin CLI Account Management.
