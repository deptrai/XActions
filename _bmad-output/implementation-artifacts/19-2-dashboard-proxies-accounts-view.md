---
title: 'Story 19.2: Dashboard Proxies & Accounts View'
type: 'feature'
created: '2026-09-01'
status: 'done'
baseline_commit: 'd9363ea94fdd6c0687e40f1ba30ddd42625c9609'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-19-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Automation operators lack real-time visibility into proxy pool health, account hibernation states, crawler velocity, and Redis lag from a web interface, forcing them to run terminal commands or query logs during incident response.

**Approach:** Extend `dashboard/admin.html` with a new "Proxies & Accounts" tab (`#proxies`), backed by `/api/admin/proxies`, `/api/admin/accounts`, and `/governor/status` endpoints, featuring real-time 5-second polling, top metric cards, proxy quarantine/release controls, and account wake/rotate actions.

## Boundaries & Constraints

**Always:**
- Use vanilla JavaScript and CSS variables in `dashboard/admin.html` matching existing dark theme (`--bg-primary`, `--bg-secondary`, `--accent`, `--success`, `--error`, `--warning`).
- Dashboard must communicate exclusively over HTTP/REST using `authToken` Bearer header; zero direct database or Prisma access from the UI.
- All admin proxy/account endpoints require `admin` authorization via `authenticateToken` + `requireAdmin`.
- Auto-refresh every 5 seconds only when the "Proxies & Accounts" tab is active, pausing during in-flight action requests and unmounting on tab switch.
- Tests must use real DOM and real HTTP server fixtures with no mocks (`no vi.fn stubs`).

**Ask First:**
- Adding external UI frameworks or third-party charting libraries to `dashboard/admin.html`.

**Never:**
- Hardcode credentials or expose unredacted proxy passwords in the UI or API responses.
- Bypass governor or account pool state machines when triggering manual wake or quarantine actions.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Active Tab Navigation | Navigate to `/admin#proxies` | "Proxies & Accounts" tab activates, loads metrics, proxy table, account table | Fallback to sessions tab if hash unknown |
| Metric Cards Display | GET `/governor/status` returns status payload | Renders `healthy/total` proxies, `req/sec`, `redisConsumerLag`, and `throttleLevel` badge | Show placeholder `-` on fetch error |
| Manual Proxy Quarantine | Operator clicks "Quarantine" on healthy proxy | Calls `POST /api/admin/proxies/:key/quarantine`, marks quarantined in pool, shows success toast, refreshes table | Inline error toast on failure |
| Manual Proxy Release | Operator clicks "Release" on quarantined proxy | Calls `POST /api/admin/proxies/:key/release`, restores healthy status in pool, shows success toast, refreshes table | Inline error toast on failure |
| Manual Account Wake | Operator clicks "Wake" on hibernating account | Calls `POST /api/admin/accounts/:id/wake`, removes hibernation in AccountPool & Governor, updates UI badge | 409 Conflict if account not hibernating; show error toast |
| Manual Account Rotate | Operator clicks "Rotate" on account | Calls `POST /api/admin/accounts/:id/rotate`, advances round-robin to next available account, updates UI | Show error toast if no alternative accounts available |
| Auth Failure | Expired or non-admin token | Redirect to `/login` or display 403 "Insufficient permissions" toast | Gracefully halt 5s polling cycle |

</frozen-after-approval>

## Code Map

- `dashboard/admin.html` -- Add "Proxies & Accounts" tab button, panels, tables, metrics bar, and JS controller for Story 19.2.
- `src/proxy/proxy-pool.js` -- Add `release(proxy)` / `unquarantine(proxy)` and `listProxies()` helper methods to support full proxy visibility and manual release.
- `src/core/account-pool.js` -- Add `listAllAccountsWithDetails()` helper method to expose platform, status, hibernation details, velocity, and assigned proxy without leaking credentials.
- `api/routes/admin.js` -- Mount `GET /api/admin/proxies`, `POST /api/admin/proxies/:key/quarantine`, `POST /api/admin/proxies/:key/release`, `GET /api/admin/accounts`, `POST /api/admin/accounts/:id/wake`, `POST /api/admin/accounts/:id/rotate` with `authenticateToken` + `requireAdmin`.
- `api/server.js` -- Ensure admin routes and governor status are mounted with clean test lifecycle.
- `tests/dashboard/admin-proxies-accounts.test.js` -- Vitest integration suite verifying tab activation, metric rendering, proxy quarantine/release, account wake/rotate, 5s polling, and auth protection.

## Tasks & Acceptance

**Execution:**
- [x] `src/proxy/proxy-pool.js` -- Add `release(proxy)` / `unquarantine(proxy)` and `listProxies()` methods to `ProxyIpPool` -- Enables operator unquarantine and list introspection without direct private field access.
- [x] `src/core/account-pool.js` -- Add `listAccountDetails()` method to `AccountPool` -- Exposes account metadata, hibernation reasons, remaining time, and velocity safely.
- [x] `api/routes/admin.js` -- Implement `/api/admin/proxies` (GET, POST quarantine, POST release) and `/api/admin/accounts` (GET, POST wake, POST rotate) endpoints -- Provides secure REST facade for dashboard operator actions.
- [x] `dashboard/admin.html` -- Add "Proxies & Accounts" tab, metric overview cards, proxy status table, hibernating/active accounts table, action modals/buttons, and 5s polling loop -- Delivers the required operational web surface.
- [x] `tests/dashboard/admin-proxies-accounts.test.js` -- Create comprehensive integration tests covering AC-1 to AC-7 with real HTTP server and DOM fixture -- Guarantees end-to-end correctness and regression prevention.

**Acceptance Criteria:**
- Given an operator on `/admin`, when clicking the "Proxies & Accounts" tab or loading `/admin#proxies`, then the tab displays top metrics (`healthy/total` proxies, `req/sec`, `consumerLag`, `throttleLevel`), a proxies table, and an accounts table.
- Given a proxy in the proxies table, when clicking "Quarantine" or "Release", then the system updates the proxy status in the pool and updates the row badge immediately.
- Given an account in hibernation, when clicking "Wake", then the system clears the hibernation in AccountPool and AdaptiveRateGovernor, returning the account to active status.
- Given the "Proxies & Accounts" tab is open, when leaving the page active, then data refreshes automatically every 5 seconds without resetting operator inputs or running during in-flight actions.
- Given an unauthenticated or non-admin request, when calling admin endpoints, then it returns 401/403 with appropriate error messages.

### Review Findings

- [x] [Review][Patch] Redact proxy credentials from listProxies() return object [src/proxy/proxy-pool.js:309]
- [x] [Review][Patch] Check composite key in handleWakeAccount when querying governor [api/routes/admin.js:464]
- [x] [Review][Patch] Sanitize durationMs and catch URIError in proxy quarantine/release handlers [api/routes/admin.js:370]
- [x] [Review][Patch] Support query platform parameter in handleWakeAccount and handleRotateAccount [api/routes/admin.js:450]
- [x] [Review][Patch] Expose getHibernationReason in AdaptiveRateGovernor to populate account hibernation details accurately [src/core/adaptive-governor.js:120]

## Spec Change Log

_Empty until the first review loopback._

## Design Notes

- **Proxy Key Encoding**: Proxy keys in URL parameters should support URL-encoded strings (e.g. `encodeURIComponent(proxyKey)`) to safely pass protocols, hosts, and ports.
- **Account Wake Pre-condition**: `wake` endpoint verifies if `record.hibernatingUntil > Date.now()`; if not hibernating, returns `409 Conflict` with message "Account is not currently in hibernation".
- **Redaction Invariant**: Passwords in proxy URLs and account credentials must always be masked (e.g. `***` or omitted) before serializing JSON to the dashboard.

## Verification

**Commands:**
- `npx vitest run tests/dashboard/admin-proxies-accounts.test.js` -- expected: All AC-1 through AC-7 tests pass.
- `npx vitest run tests/dashboard/admin-checkpoints.test.js` -- expected: All Story 19.1 tests pass without regression.
- `npx vitest run tests/api/checkpoints-routes.test.js` -- expected: Existing API tests pass.

**Manual checks (if no CLI):**
- Inspect `/admin#proxies` in browser to verify dark theme consistency, responsive table scrolling on viewport < 768px, and 5-second polling interval.

## Suggested Review Order

**Core Proxy & Account Services**

- Unquarantine and list proxies with redacted credentials
  [`proxy-pool.js:267`](../../src/proxy/proxy-pool.js#L267)

- Safely expose account status, hibernation details, and velocity
  [`account-pool.js:384`](../../src/core/account-pool.js#L384)

**Admin REST API Surface**

- Secure REST facade for proxy quarantine/release, account wake/rotate, and governor status
  [`admin.js:317`](../../api/routes/admin.js#L317)

- Guard test server listen loop against port collisions
  [`server.js:609`](../../api/server.js#L609)

**Dashboard User Interface & Real-time Controller**

- Add Proxies & Accounts tab panel, metric cards, tables, and 5s polling controller
  [`admin.html:618`](../../dashboard/admin.html#L618)

**Automated Tests & Quality Gates**

- End-to-end integration test suite verifying AC-1 through AC-7 against real fixtures
  [`admin-proxies-accounts.test.js:1`](../../tests/dashboard/admin-proxies-accounts.test.js#L1)

