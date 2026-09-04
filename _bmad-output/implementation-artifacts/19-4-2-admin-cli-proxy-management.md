---
story_id: "19.4.2"
epic: 19
story_key: "19-4-2-admin-cli-proxy-management"
status: "ready-for-dev"
phase: "Phase 5"
created: "2026-09-04"
updated: "2026-09-04"
owner: "DEV"
reviewed: "Pending"
baseline_commit: "add7c4d5b248a335502c3ef3bb76ee46b3e2a44b"
---

# Story 19.4.2: Admin CLI — Proxy Management

Status: ready-for-dev

## ⚠️ Critical Constraints / Architecture Variance

1. **Extend Existing `xactions admin proxies` Group** — Story 19.4 already created the `proxies list` subcommand in `src/cli/commands/admin.js`. This story adds `quarantine` and `release` subcommands under `xactions admin proxies`, plus a friendly alias command group `xactions admin proxy <quarantine|release|list>` so operators can use either singular or plural naturally (`admin proxies ...` or `admin proxy ...`).
2. **REST-First with In-Process Fallback** — Follow the pattern established in 19.4 and 19.4.1:
   - **URL Encoding for Proxy Keys**: Proxy keys contain protocols, ports, and colons (e.g. `http://1.2.3.4:8080`). When calling REST endpoints, ALWAYS use `encodeURIComponent(proxyKey)` for path parameters (`/api/admin/proxies/${encodeURIComponent(proxyKey)}/quarantine`), matching `safeDecode` on the server (`api/routes/admin.js:439`). Alternatively, pass `{ proxy: proxyKey, durationMs, reason }` in the POST JSON body to `/api/admin/proxies/quarantine`.
   - For `quarantine`: Call `POST /api/admin/proxies/${encodeURIComponent(proxyKey)}/quarantine` (or `/api/admin/proxies/quarantine` with body `{ proxy: proxyKey, durationMs, reason }`). If remote is unreachable or `--url` was not explicitly provided, fall back to in-process `globalProxyPool.quarantine(proxyKey, durationMs)`.
   - For `release`: Call `POST /api/admin/proxies/${encodeURIComponent(proxyKey)}/release` (or `/api/admin/proxies/release` with body `{ proxy: proxyKey }`). If remote is unreachable, fall back to in-process `globalProxyPool.release(proxyKey)`.
3. **Dual Output Modes (CLI Formatted + Raw JSON)**:
   - Without `--json`: Print aligned, color-coded human-readable confirmation using `chalk` and standard emojis (✅, ⚠️, ❌).
   - With `--json`: Print JSON response `{ success: true, ... }` via `JSON.stringify(..., null, 2)`.
4. **Standard Option Flags**:
   - `--url <url>`: Base API URL (defaults to `http://localhost:3001` or `resolveBaseUrl`).
   - `--token <token>`: Bearer token for admin authentication (`headers: { Authorization: 'Bearer ...' }`).
   - `--duration <ms>`: (For `quarantine`) Duration in milliseconds for the quarantine period.
   - `-r, --reason <reason>`: (For `quarantine`) Optional reason for quarantine.
   - `--json`: Output raw JSON.
5. **No Direct DB Access & No Browser / Puppeteer**: CLI only invokes REST API or `ProxyPool`. No puppeteer imports.
6. **No Inline Story References in Source Code**: Do not write comments like `// Story 19.4.2` in `src/`.
7. **No Mocks in Tests**: Test against real `Command` instances and real `ProxyPool` / Express instances.

[Source: `_bmad-output/planning-artifacts/epics.md` lines 1075–1085; `_bmad-output/implementation-artifacts/epic-19-context.md`; `api/routes/admin.js:425–488`; `src/proxy/proxy-pool.js:477–555`]

---

## Story

As an **Internal Automation Operator**,  
I want **the commands `xactions admin proxies quarantine <proxyKey>` and `xactions admin proxies release <proxyKey>` (along with `xactions admin proxy ...` aliases)**,  
so that **I can inspect, quarantine, and release proxies from the command line when an IP is rate-limited, blocked, or restored**.

---

## Acceptance Criteria

### AC-1: CLI Command Registration & Help Contract

- **Given** the `xactions admin` command group
- **When** the operator runs `xactions admin proxies --help` or `xactions admin proxy --help`
- **Then** the output lists:
  - `list`: List all registered proxies with status, partition, and failure count
  - `quarantine <proxyKey>`: Manually quarantine a proxy by its key
  - `release <proxyKey>`: Manually release a proxy from quarantine
- **And** `quarantine` supports options `--duration <ms>`, `--url <url>`, `--token <token>`, `--json`
- **And** `release` supports options `--url <url>`, `--token <token>`, `--json`

### AC-2: Quarantine Proxy via REST or In-Process Pool

- **Given** a registered proxy key (e.g., `http://1.2.3.4:8080`)
- **When** the operator runs `xactions admin proxies quarantine http://1.2.3.4:8080` (or `admin proxy quarantine ...`)
- **Then** the command attempts `POST /api/admin/proxies/:key/quarantine` with optional `durationMs` and Bearer token
- **And** on success, prints a confirmation with the quarantined key, remaining healthy count, and total count
- **And** if `--json` is passed, outputs `{ success: true, quarantined: "...", healthyCount: N, totalCount: M }`
- **And** if the remote API is unreachable and no explicit `--url` was given, it falls back to in-process `globalProxyPool.quarantine(key, durationMs)`

### AC-3: Release Proxy via REST or In-Process Pool

- **Given** a quarantined proxy key
- **When** the operator runs `xactions admin proxies release http://1.2.3.4:8080` (or `admin proxy release ...`)
- **Then** the command attempts `POST /api/admin/proxies/:key/release` with optional Bearer token
- **And** on success, prints a confirmation that the proxy was released from quarantine along with current healthy count
- **And** if `--json` is passed, outputs `{ success: true, released: true, proxy: "...", healthyCount: N, totalCount: M }`
- **And** if the remote API is unreachable and no explicit `--url` was given, it falls back to in-process `globalProxyPool.release(key)`

### AC-4: Error Handling & Validation

- **Given** missing or invalid proxy key arguments
- **When** the operator runs `quarantine` or `release` without `<proxyKey>`
- **Then** Commander displays a clear argument validation error
- **And** when the proxy is not found or the API returns 400/404, it prints the error cleanly with `printCliError(err, { json: options.json })`

---

## Developer Context & Implementation Guidance

### Key Files & Locations

| Component | File Path | Role |
|---|---|---|
| CLI Command Entry | `src/cli/commands/admin.js` | Add `quarantine` and `release` to `proxiesCmd`, register alias `adminCmd.command('proxy')` |
| CLI Error Formatter | `src/cli/shared.js` | Uses `printCliError`, `resolveBaseUrl`, `fetchAdminJson`, `parseCliPositiveInt` |
| Proxy Pool Core | `src/proxy/proxy-pool.js` | `globalProxyPool.quarantine(proxy, durationMs)`, `globalProxyPool.release(proxy)`, `globalProxyPool.listProxies()` |
| Admin REST Routes | `api/routes/admin.js` | Lines 425–488 (`POST /api/admin/proxies/:key/quarantine`, `POST /api/admin/proxies/:key/release`) |
| Integration Tests | `tests/cli/admin-proxies.test.js` | Vitest test suite for proxy CLI subcommands |

### Implementation Pattern for `admin.js`

```javascript
// Inside registerAdminCommand(program):
// 1. Extend proxiesCmd with quarantine and release:
proxiesCmd
  .command('quarantine <proxyKey>')
  .description('Manually quarantine a proxy by key')
  .option('-d, --duration <ms>', 'Quarantine duration in milliseconds')
  .option('-r, --reason <reason>', 'Optional reason for quarantine')
  .option('--url <url>', 'Base API / Daemon URL (default: http://localhost:3001)')
  .option('--token <token>', 'Bearer token for admin authentication')
  .option('--json', 'Output raw JSON')
  .action(async (proxyKey, options) => {
    // 1. REST call: POST /api/admin/proxies/quarantine with body { proxy: proxyKey, durationMs, reason }
    // 2. Fallback: globalProxyPool.quarantine(proxyKey, durationMs)
  });

proxiesCmd
  .command('release <proxyKey>')
  .description('Manually release a proxy from quarantine')
  .option('--url <url>', 'Base API / Daemon URL (default: http://localhost:3001)')
  .option('--token <token>', 'Bearer token for admin authentication')
  .option('--json', 'Output raw JSON')
  .action(async (proxyKey, options) => {
    // 1. REST call: POST /api/admin/proxies/release with body { proxy: proxyKey }
    // 2. Fallback: globalProxyPool.release(proxyKey)
  });

// 2. Register alias command group 'proxy' that mirrors 'proxies' (list, quarantine, release)
```

---

## Testing Plan

1. **Unit & CLI Verification (`tests/cli/admin-proxies.test.js`)**:
   - Verify `xactions admin proxies --help` lists `list`, `quarantine`, and `release`.
   - Verify `xactions admin proxy --help` works identically.
   - Execute in-process fallback for `quarantine` on an in-memory `ProxyPool` fixture.
   - Execute in-process fallback for `release` and verify the proxy status transitions from `quarantined` back to `healthy`.
   - Test `--json` flag formats valid JSON output for both actions.
   - Test error handling when proxy is not in pool.
2. **Regression Check**:
   - Run `npx vitest run tests/cli/admin-unified.test.js` to ensure zero regressions on earlier command group contracts.

---

## Completion Status

- **Status**: `ready-for-dev`
- **Notes**: Comprehensive story specification generated with full architecture compliance, REST endpoints, in-process fallbacks, and test guidelines.
