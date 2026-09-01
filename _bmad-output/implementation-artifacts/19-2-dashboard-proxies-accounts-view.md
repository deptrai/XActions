---
story_id: "19.2"
epic: 19
story_key: "19-2-dashboard-proxies-accounts-view"
status: "done"
phase: "Phase 5"
created: 2026-09-01
updated: 2026-09-01
owner: "DEV"
reviewed: "Approved"
baseline_commit: "721e0cad8d52cbf1031d279ca84dc7519bfb8e5c"
---

# Story 19.2: Dashboard Proxies & Accounts View

Status: done

## ⚠️ Critical Constraints / Architecture Variance

The following decisions are non-negotiable and override any earlier language in this story or external references:

1. **No Direct DB or In-Memory Singleton Access from Dashboard** — The dashboard is a static HTML/JS client (`dashboard/admin.html`). It communicates exclusively via REST endpoints (`/api/governor/status`, `/api/proxies/*`, `/api/proxies/accounts/*`).
2. **Single Admin HTML Surface** — Extend `dashboard/admin.html` with a new tabbed view `🛡️ Proxies & Accounts` (DOM id: `tab-proxies`, tab button: `tab-btn-proxies`) rather than introducing a separate HTML page.
3. **Reuse Existing Backend APIs** — Backend APIs in `api/routes/governor.js` (`GET /api/governor/status`) and `api/routes/proxies.js` (`POST /api/proxies/quarantine`, `POST /api/proxies/accounts/:id/available`, `POST /api/proxies/accounts/:id/unavailable`) already exist. If un-quarantine / release for proxies is missing in `api/routes/proxies.js` or `src/proxy/proxy-pool.js`, implement `POST /api/proxies/release` (or `unquarantine`) and `proxyPool.release(proxy)` cleanly without breaking contracts.
4. **Real-time Polling / Auto-refresh (5s interval)** — View updates metrics and tables every 5 seconds when the Proxies & Accounts tab is active, pausing or stopping cleanly when switching tabs or unloading.
5. **No Mocks in Tests** — Tests in `tests/` must use real DOM simulation or real HTTP calls against Express test server fixtures without `vi.fn` or mock libraries.
6. **No Inline Epic/Story References in Source Code** — Do not put comments like `// Story 19.2` inside production code.

[Source: `ARCHITECTURE-SPINE.md` AD-19, lines 320-330; `epics.md` Epic 19, Story 19.2, lines 1028-1040]

## Story

As an **Automation Operator**,  
I want **a dashboard view displaying proxy pool health, hibernating accounts, and live crawl throughput**,  
so that **I know when to add proxies, rotate accounts, or manually override hibernations without opening a terminal**.

## Acceptance Criteria

### AC-1: Proxies & Accounts Tab in Admin Dashboard
- **Given** the operator opens `/admin` (or `/admin.html`)
- **When** the page loads
- **Then** a new tab **"🛡️ Proxies & Accounts"** is present in the navigation tab bar (`.tab-nav`)
- **And** navigating to `/admin#proxies` activates this tab automatically.

[Source: `epics.md` Epic 19, Story 19.2, lines 1034-1035; `dashboard/admin.html` lines 615-620]

### AC-2: Proxy Pool & Throttle Metrics Summary Cards
- **Given** the "Proxies & Accounts" tab is active
- **When** data is fetched from `GET /api/governor/status`
- **Then** summary cards display:
  - **Proxy Pool Health:** `healthyProxyCount / totalProxyCount` with percentage / ratio badge
  - **Current Request Rate:** `currentReqPerSecond` (req/s)
  - **Consumer Lag:** `redisConsumerLag` (pending items)
  - **Throttle Level:** `throttleLevel` (e.g. `normal`, `soft_throttle`, `hard_throttle`, `circuit_broken`) styled with contextual status colors (green/yellow/red).

[Source: `epics.md` Epic 19, Story 19.2, line 1036; `src/core/status-api.js` lines 26-34]

### AC-3: Hibernating & Registered Accounts Table
- **Given** the "Proxies & Accounts" tab is loaded
- **When** accounts are fetched from `GET /api/governor/status` and `GET /api/proxies/status`
- **Then** a table lists all hibernating/unavailable accounts showing:
  - `Platform` (e.g., twitter, facebook, threads, tiktok)
  - `Account ID` / `Username`
  - `Status` (Hibernating / Unavailable / Active)
  - `Reason` (e.g., `RATE_LIMITED_429`, `BOT_CHALLENGE`, `AUTH_EXPIRED`)
  - `Remaining Time` (countdown in mm:ss or relative time)
  - `Actions` — **"Wake / Release"** button to manually make the account available again.

[Source: `epics.md` Epic 19, Story 19.2, lines 1037-1038; `src/core/account-pool.js` lines 182-228]

### AC-4: Proxy Management Table & Manual Actions
- **Given** the proxy pool list
- **When** operator inspects the proxies table
- **Then** each proxy shows its server URI/host, protocol, quarantine state, and fail count
- **And** operator can click **"Quarantine"** (with optional duration) to isolate a bad proxy
- **And** operator can click **"Release / Unquarantine"** to manually restore a proxy to the active healthy pool.

[Source: `epics.md` Epic 19, Story 19.2, line 1038; `src/proxy/proxy-pool.js` lines 228-264; `api/routes/proxies.js` lines 62-77]

### AC-5: Real-Time Auto-Refresh (5s)
- **Given** the "Proxies & Accounts" view is visible
- **When** left open
- **Then** it auto-refreshes data every **5 seconds** without flickering or resetting operator form state
- **And** auto-refresh is paused when switching to another tab.

[Source: `epics.md` Epic 19, Story 19.2, line 1039]

## Tasks / Subtasks

- [x] Task 1: Backend proxy release API & ProxyIpPool enhancement (AC: #4)
  - [x] Add `release(proxy)` method in `src/proxy/proxy-pool.js` to delete from `#quarantined` map.
  - [x] Add `POST /api/proxies/release` in `api/routes/proxies.js` to expose un-quarantine functionality.
- [x] Task 2: Build UI components in `dashboard/admin.html` (AC: #1, #2, #3, #4)
  - [x] Add `<button class="tab-btn" onclick="switchTab('proxies')">🛡️ Proxies & Accounts</button>` to `.tab-nav`.
  - [x] Add `<div id="tab-proxies" class="tab-content">` panel with grid layout.
  - [x] Render 4 top metrics stat boxes (`healthyProxies`, `reqPerSecond`, `consumerLag`, `throttleLevel`).
  - [x] Render Hibernating Accounts table with Wake button.
  - [x] Render Proxy Pool list/table with Quarantine / Release actions.
- [x] Task 3: Client-side polling and event dispatchers (AC: #3, #4, #5)
  - [x] Implement `loadProxiesAndAccounts()` fetching `/api/governor/status` and `/api/proxies/status`.
  - [x] Setup 5s `setInterval` active only while `tab-proxies` is displayed.
  - [x] Wire Wake action to `POST /api/proxies/accounts/:id/available`.
  - [x] Wire Quarantine action to `POST /api/proxies/quarantine` and Release to `POST /api/proxies/release`.
- [x] Task 4: Automated E2E & unit verification (AC: #1, #2, #3, #4, #5)
  - [x] Add tests in `tests/admin/dashboard-proxies-accounts.test.js` verifying API routes and client behavior.
  - [x] Run full test suite to ensure zero regressions.

## Dev Notes

- **Existing Backend Files to Touch / Reference:**
  - `src/proxy/proxy-pool.js`: Add `release(proxy)` method to delete entry from `#quarantined` map. Also ensure `listAll()` / `getAll()` or similar accessor is exposed so the admin UI can list proxy details (server, isQuarantined, failCount).
  - `api/routes/proxies.js`:
    - Add `POST /api/proxies/release` to allow manual proxy un-quarantine.
    - Add `GET /api/proxies/list` to return all registered proxies with their health and quarantine status.
    - Add `GET /api/proxies/accounts/list` (or leverage existing `/api/proxies/accounts/next/:platform` / `/api/governor/status`) to list registered and hibernating accounts.
  - `api/routes/governor.js`: Verify output shape matches `StatusApi.getGovernorStatus()`, specifically `hibernatingAccounts` containing `{ accountId, remainingSeconds, reason }`.
  - `dashboard/admin.html`: Add tab HTML, CSS styling, table renderers, and JavaScript polling logic.
- **Data Shapes:**
  - `GET /api/governor/status` -> `{ success: true, status: { healthyProxyCount, totalProxyCount, healthyProxyRatio, currentReqPerSecond, redisConsumerLag, hibernatingAccounts: [{ accountId, remainingSeconds, reason }], throttleLevel } }`
  - `GET /api/proxies/status` -> `{ healthyCount, totalCount, antiLeakFlags, isAllQuarantined }`
  - `GET /api/proxies/list` -> `{ success: true, proxies: [{ server, isQuarantined, quarantinedUntil, failCount }] }`
  - `POST /api/proxies/quarantine` -> body `{ proxy: "http://...", durationMs: 300000 }`
  - `POST /api/proxies/release` -> body `{ proxy: "http://..." }`
  - `POST /api/proxies/accounts/:id/available` -> `{ success: true, accountId, available: true }`
  - `POST /api/proxies/accounts/:id/unavailable` -> body `{ reason: "RATE_LIMITED_429", durationMs: 300000 }` -> `{ success: true, accountId, unavailable: true }`

### Project Structure Notes

- Frontend files remain in `dashboard/` directory.
- REST routes remain under `api/routes/`.
- No new external client-side packages; vanilla JavaScript + DOM manipulation matching existing `dashboard/admin.html` style.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md`#Story 19.2: Dashboard Proxies & Accounts View]
- [Source: `_bmad-output/implementation-artifacts/19-1-dashboard-jobs-checkpoints-view.md`]
- [Source: `src/core/adaptive-governor.js`]
- [Source: `src/proxy/proxy-pool.js`]
- [Source: `api/routes/governor.js`]
- [Source: `api/routes/proxies.js`]

## Dev Agent Record

### Agent Model Used
claude-sonnet-5 / claude-opus-5

### Debug Log References
- Unit test passed: `tests/admin/dashboard-proxies-accounts.test.js` (3/3 passed).
- Playwright live UI verification: verified tab switching, stat cards, hibernating account wake trigger, proxy quarantine and release controls.

### Completion Notes List
- Completed Story 19.2 implementation:
  - Added `ProxyIpPool.prototype.release(proxy)` and `listAll()` in `src/proxy/proxy-pool.js`.
  - Added `POST /api/proxies/release` and `GET /api/proxies/list` in `api/routes/proxies.js`.
  - Added `🛡️ Proxies & Accounts` tab in `dashboard/admin.html` with real-time 5s polling, stat cards, hibernating accounts list with wake action, and proxy list with quarantine/release actions.

### File List
- `src/proxy/proxy-pool.js`
- `api/routes/proxies.js`
- `dashboard/admin.html`
- `tests/admin/dashboard-proxies-accounts.test.js`
- `_bmad-output/implementation-artifacts/19-2-dashboard-proxies-accounts-view.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Project Structure Notes

- Frontend files remain in `dashboard/` directory.
- REST routes remain under `api/routes/`.
- No new external client-side packages; vanilla JavaScript + DOM manipulation matching existing `dashboard/admin.html` style.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md`#Story 19.2: Dashboard Proxies & Accounts View]
- [Source: `_bmad-output/implementation-artifacts/19-1-dashboard-jobs-checkpoints-view.md`]
- [Source: `src/core/adaptive-governor.js`]
- [Source: `src/proxy/proxy-pool.js`]
- [Source: `api/routes/governor.js`]
- [Source: `api/routes/proxies.js`]

## Dev Agent Record

### Agent Model Used
claude-opus-5 / claude-sonnet-5

### Debug Log References
- Checked `src/proxy/proxy-pool.js`, `src/core/account-pool.js`, `api/routes/governor.js`, `api/routes/proxies.js`, `dashboard/admin.html`.

### Completion Notes List
- Ultimate context engine analysis completed - comprehensive developer guide created for Story 19.2.

### File List
- `_bmad-output/implementation-artifacts/19-2-dashboard-proxies-accounts-view.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
