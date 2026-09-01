# Epic 19 Context: Internal Operator Dashboard, Admin CLI & Operational Observability

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Provide a unified web dashboard (`dashboard/admin.html`), an administrative CLI (`xactions admin`), and dedicated `/admin/*` REST/MCP surfaces for operators and reliability engineers. This enables real-time visibility, lifecycle control over crawlers, checkpoints, proxy health, account hibernation, and Redis Stream metrics without requiring direct database access or manual SQL scripts.

## Stories

- Story 19.1: Dashboard Jobs & Checkpoints View
- Story 19.2: Dashboard Proxies & Accounts View
- Story 19.3: Dashboard Stream Metrics & Alerts View
- Story 19.4: Admin CLI — Unified Command Group
- Story 19.4.1: Admin CLI — Status
- Story 19.4.2: Admin CLI — Proxy Management
- Story 19.4.3: Admin CLI — Account Management
- Story 19.4.4: Admin CLI — Checkpoint Management
- Story 19.4.5: Admin CLI — Stream Metrics & Alerts
- Story 19.7: Admin REST API — Proxy Management
- Story 19.8: Admin REST API — Account & Checkpoint Management
- Story 19.9: Admin REST API — Stream Metrics & Alerts
- Story 19.10: Admin MCP Tools

## Requirements & Constraints

- **Zero Direct DB Access from Frontend**: The dashboard is a static HTML/JS client served at `/admin` (via `dashboard/admin.html`). It must interact only with existing or admin REST endpoints with `Bearer` auth or internal admin tokens.
- **Strict Role-Based Access Control**: All admin dashboard tabs, `/admin/*` REST endpoints, and `xactions admin` CLI commands require `admin` role or explicit `checkpoint:manage` capability (for checkpoint operations).
- **Real-Time Visibility & Auto-Refresh**: 
  - Jobs & Checkpoints view auto-refreshes every 30s.
  - Proxies & Accounts view auto-refreshes every 5s.
  - Stream Metrics & Alerts view auto-refreshes every 5s.
- **Alerting Thresholds**:
  - `pendingMessages > 50,000` or `lastAckTime > 60s` triggers active warning alerts in UI and CLI.
- **No Mocks in Tests**: All automated tests must run against real DOM / Express server instances or real test fixtures with clean lifecycle teardown.

## Technical Decisions

- **Single Admin HTML Surface**: Expand `dashboard/admin.html` with tabbed views rather than adding separate pages.
- **Vanilla JS + CSS Variables**: Maintain existing dark theme (`--bg-primary`, `--bg-secondary`, `--accent`, `--success`, `--error`, `--warning`) without heavy frontend build tools (React/Vue).
- **Lifecycle Actions Delegation**:
  - Checkpoint actions call `POST /api/checkpoints/:id/{resume,pause,retry}`.
  - Proxy actions call `POST /admin/proxies/:key/{quarantine,release}` or the underlying pool methods.
  - Account actions call `POST /admin/accounts/:id/{wake,rotate}` validating `hibernating` state (returning 409 Conflict if ineligible).
- **Backend Route Wrapping**: Admin REST endpoints in `api/routes/admin.js` wrap existing internal managers (`checkpoint-manager.js`, `ProxyPool`, `AccountPool`, stream metrics) to ensure backwards compatibility without duplicating business logic.

## UX & Interaction Patterns

- Tab navigation: "Jobs & Checkpoints" (`#jobs`), "Proxies & Accounts" (`#proxies`), "Stream Metrics & Alerts" (`#stream`), alongside existing session/stream tabs.
- Clean status badges: `healthy`/`running` (green/success), `quarantined`/`paused`/`stalled` (warning/yellow), `failed`/`error` (red/error), `completed` (accent/blue).
- Inline action controls with feedback banners / toasts (using emoji microcopy convention ✅ ❌ ⚠️ 🛡️ 🚀).
- Responsive table & card collapse on mobile viewports (< 768px).

## Cross-Story Dependencies

- Story 19.1 builds on Story 10.4 (`CrawlCheckpoint` model & API in `api/routes/checkpoints.js`).
- Story 19.2 builds on Epic 11 (`ProxyIPPool`, `AccountPool`, quarantine logic).
- Story 19.3 builds on Story 14.3 (`Realtime Thin Event Redis Stream`).
- Story 19.4.x CLI & Story 19.7-19.10 REST/MCP wrap the same operational services that power the dashboard views.
