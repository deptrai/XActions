---
story_id: "19.3"
epic: 19
story_key: "19-3-dashboard-stream-metrics-alerts-view"
status: "in-review"
baseline_commit: "bee4a4d7a1c3463807da528dceb423903f45a7eb"
phase: "Phase 5"
created: 2026-09-01
updated: 2026-09-01
owner: "DEV"
reviewed: "Pending"
---

# Story 19.3: Dashboard Stream Metrics & Alerts View

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## ⚠️ Critical Constraints / Architecture Variance

The following decisions are non-negotiable and override any earlier language in this story or external references:

1. **No Direct DB or In-Memory Singleton Access from Dashboard** — The dashboard is a static HTML/JS client (`dashboard/admin.html`). It communicates exclusively via REST endpoints (`/metrics/stream`, `/api/admin/stream/metrics`, `/api/admin/stream/alerts`, `/api/admin/x402/webhooks`).
2. **Single Admin HTML Surface** — Extend `dashboard/admin.html` with a new tabbed view `📊 Stream Metrics & Alerts` (DOM id: `tab-streams`, tab button: `tab-btn-streams`) rather than introducing a separate HTML page.
3. **Reuse Existing Backend APIs** — Backend APIs in `api/routes/admin.js` (`GET /api/admin/stream/metrics`, `GET /api/admin/stream/alerts`) and `api/server.js` (`GET /metrics/stream`) already exist. If alert configuration (webhook/email) is missing, implement lightweight `POST /api/admin/stream/alerts/config` without duplicating `StreamAlertEngine` logic.
4. **Real-time Polling / Auto-refresh (5s interval)** — View updates metrics, chart, and alerts every 5 seconds when the Stream Metrics tab is active, pausing or stopping cleanly when switching tabs or unloading.
5. **No External Chart Libraries** — Build the line chart with vanilla SVG/CSS inside `dashboard/admin.html`. Do not add npm charting dependencies.
6. **No Mocks in Tests** — Tests in `tests/` must use real DOM simulation or real HTTP calls against Express test server fixtures without `vi.fn` or mock libraries.
7. **No Inline Epic/Story References in Source Code** — Do not put comments like `// Story 19.3` inside production code.

[Source: `ARCHITECTURE-SPINE.md` AD-19, lines 320-330; `epics.md` Epic 19, Story 19.3, lines 1041-1053]

## Story

As a **Reliability Engineer**,  
I want **a dashboard view displaying Redis Stream throughput, consumer lag, dropped events and alerts**,  
so that **I detect early when the Nowing consumer is slow or the stream drops data**.

## Acceptance Criteria

### AC-1: Stream Metrics & Alerts Tab in Admin Dashboard
- **Given** the operator opens `/admin` (or `/admin.html`)
- **When** the page loads
- **Then** a new tab **"📊 Stream Metrics & Alerts"** is present in the navigation tab bar (`.tab-nav`)
- **And** navigating to `/admin#streams` activates this tab automatically.
- **And** `handleHashRoute()` and the initial hash check both recognize `hash === 'streams'`.

[Source: `epics.md` Epic 19, Story 19.3, lines 1041-1042; `dashboard/admin.html` lines 1907-1931]

### AC-2: Stream Metrics Summary Cards
- **Given** the "Stream Metrics & Alerts" tab is active
- **When** data is fetched from `GET /api/admin/stream/metrics` (or `GET /metrics/stream`)
- **Then** summary cards display:
  - **Events/sec:** `eventsPerSecond`
  - **Pending Messages:** `pendingMessages`
  - **Consumer Lag:** `consumerLag`
  - **Dropped Events:** `droppedEvents`
  - **Last Ack Idle:** `lastAckTime` (seconds)
  - **Max Length:** `maxLen`

[Source: `epics.md` Epic 19, Story 19.3, line 1043; `src/utils/stream-metrics-collector.js` lines 274-282]

### AC-3: Stream Metrics Line Chart
- **Given** the "Stream Metrics & Alerts" tab is active
- **When** metrics are fetched
- **Then** a line chart renders at least two series:
  - `eventsPerSecond`
  - `pendingMessages`
- **And** a horizontal alert threshold line at `pendingMessages = 50,000`
- **And** the chart supports time range toggles: **5 minutes, 1 hour, 24 hours** (or placeholders when historical data is unavailable).

[Source: `epics.md` Epic 19, Story 19.3, line 1044; `ux/DESIGN.md` lines 265-269, 320-328]

### AC-4: Active Alerts List
- **Given** the "Stream Metrics & Alerts" tab is loaded
- **When** alerts are fetched from `GET /api/admin/stream/alerts`
- **Then** a list displays the 5 most recent active alerts with:
  - Alert type (`redis_stream_lag`, `redis_stream_consumer_lag`, `redis_stream_ack`)
  - Threshold and current value
  - Timestamp
  - Severity badge (warning/error based on threshold)
- **And** if no alerts are active, show an empty state: "✓ No active alerts".

[Source: `epics.md` Epic 19, Story 19.3, line 1045; `src/utils/stream-alerts.js` lines 99-134, 228-234]

### AC-5: Real-Time Auto-Refresh (5s)
- **Given** the "Stream Metrics & Alerts" view is visible
- **When** left open
- **Then** it auto-refreshes data every **5 seconds** without resetting chart zoom or form state
- **And** auto-refresh is paused when switching to another tab.

[Source: `epics.md` Epic 19, Story 19.3, line 1046]

### AC-6: Alert Test Button (Optional)
- **Given** the "Stream Metrics & Alerts" tab is active
- **When** the operator clicks a **"Test Alert"** button
- **Then** the dashboard calls `POST /api/admin/stream/alerts/test` (or uses `StreamAlertEngine.checkAndAlert()` on the backend)
- **And** a test alert is returned and rendered in the alerts list.

[Source: `epics.md` Epic 19, Story 19.3, line 1047; `src/utils/stream-alerts.js` lines 68-79, 99-134]

## Tasks / Subtasks

- [x] Task 1: Verify and extend backend stream metrics/alerts endpoints (AC: #2, #4, #6)
  - [x] Confirm `GET /api/admin/stream/metrics` returns `{ success: true, metrics: { eventsPerSecond, pendingMessages, consumerLag, droppedEvents, lastAckTime, maxLen, minId } }`.
  - [x] Confirm `GET /api/admin/stream/alerts` returns `{ success: true, alerts: { activeAlerts, lastAlertTimestamp, totalAlertsTriggered } }`.
  - [x] Add `POST /api/admin/stream/alerts/test` in `api/routes/admin.js` to trigger a test alert through `StreamAlertEngine`.
- [x] Task 2: Build UI components in `dashboard/admin.html` (AC: #1, #2, #3, #4)
  - [x] Add `<button class="tab-btn" onclick="switchTab('streams')">📊 Stream Metrics & Alerts</button>` to `.tab-nav`.
  - [x] Add `<div id="tab-streams" class="tab-content">` panel with grid layout.
  - [x] Render 6 top metrics stat boxes with DOM ids:
    - `stream-events-per-second`
    - `stream-pending-messages`
    - `stream-consumer-lag`
    - `stream-dropped-events`
    - `stream-last-ack-time`
    - `stream-max-len`
  - [x] Render SVG line chart with id `stream-chart`:
    - Series `eventsPerSecond` (blue) and `pendingMessages` (purple/red) using `<polyline>` or `<path>`.
    - Dashed horizontal threshold line at `pendingMessages = 50,000`.
    - Y-axis auto-scales to fit both series plus threshold.
    - X-axis labels formatted by range: `HH:mm:ss` (5m), `HH:mm` (1h), `MMM dd HH:mm` (24h).
  - [x] Render Active Alerts table/list with id `stream-alerts-body` and severity badges (warning/error).
  - [x] Add time range toggles with ids `stream-range-5m`, `stream-range-1h`, `stream-range-24h` that control history pruning and x-axis label density.
- [x] Task 3: Client-side polling and event dispatchers (AC: #2, #3, #4, #5)
  - [x] Implement `loadStreamMetricsAndAlerts()` fetching `/api/admin/stream/metrics` and `/api/admin/stream/alerts`.
  - [x] Maintain a rolling history buffer (e.g. last 288 points = ~24h at 5s interval) for chart series.
  - [x] Setup 5s `setInterval` active only while `tab-streams` is displayed, with `AbortController` and `fetchWithTimeout`.
  - [x] Pause auto-refresh on tab switch; clear on `beforeunload` by adding `stopStreamsRefresh()` to the existing handler.
- [x] Task 4: Automated E2E & unit verification (AC: #1, #2, #3, #4, #5)
  - [x] Add tests in `tests/admin/dashboard-stream-metrics-alerts.test.js` verifying API routes and client behavior.
  - [x] Add Playwright E2E spec `tests/e2e/admin-stream-metrics-alerts.e2e.test.js` using a fixture HTTP server.
  - [x] Run targeted test suites to verify no regressions (full suite times out; admin + E2E pass).

## Dev Notes

- **Existing Backend Files to Touch / Reference:**
  - `api/routes/admin.js`: `GET /api/admin/stream/metrics` (line 291) and `GET /api/admin/stream/alerts` (line 304) already exist. Verify auth and error envelope. Optionally add `POST /api/admin/stream/alerts/test`.
  - `src/utils/stream-metrics-collector.js`: `defaultStreamMetricsCollector.getMetrics()` returns `StreamMetrics` shape (lines 274-282). It has 5s cache TTL.
  - `src/utils/stream-alerts.js`: `defaultStreamAlertEngine.getAlertStatus()` returns `{ activeAlerts, lastAlertTimestamp, totalAlertsTriggered }` (lines 228-234). Thresholds default to `pendingMessages > 50,000`, `consumerLag > 50,000`, `lastAckTime > 60s`.
  - `src/mcp/server.js`: `GET /metrics/stream` returns raw `StreamMetrics` (no envelope). Prefer `/api/admin/stream/metrics` for dashboard.
  - `dashboard/admin.html`: Add tab HTML, CSS styling, SVG chart renderer, stat cards, and polling logic. Reuse existing `fetchWithTimeout`, `esc`, `jsEsc`, toast helpers, and tab switcher patterns from Story 19.2.

- **Data Shapes:**
  - `GET /api/admin/stream/metrics` -> `{ success: true, metrics: { eventsPerSecond, pendingMessages, consumerLag, droppedEvents, lastAckTime, maxLen, minId } }`
    - `minId` may be `null` when the stream has no entries; render as `—`.
    - `eventsPerSecond` may be `0` on first sample; chart should clamp negative/infinite values to `0`.
  - `GET /api/admin/stream/alerts` -> `{ success: true, alerts: { activeAlerts: [{ alert, threshold, value, timestamp, metrics }], lastAlertTimestamp, totalAlertsTriggered } }`
  - `POST /api/admin/stream/alerts/test` -> `{ success: true, triggered: true, alerts: [...] }`

- **Frontend Chart Approach:**
  - Use an SVG `<svg>` element with `<polyline>` or `<path>` for each series.
  - Maintain a `streamMetricsHistory` array of `{ timestamp: number, eventsPerSecond: number, pendingMessages: number }`.
  - On each poll, push the latest point with `Date.now()`. Prune to last 288 points (24h at 5s) and, if a shorter range is selected, filter to points within that window.
  - Map data values to SVG coordinates with `viewBox="0 0 800 200"`.
  - Draw a dashed horizontal threshold line at `pendingMessages = 50,000`.
  - Time range toggles only affect x-axis labels and pruning; the chart still renders the available history.
  - Format x-axis labels by range: `HH:mm:ss` for 5m, `HH:mm` for 1h, `MMM dd HH:mm` for 24h.

- **CSS Styling:**
  - Reuse existing `.stats-bar`, `.stat-box`, `.stat-value`, `.stat-label` classes.
  - Add `.stream-chart-container`, `.stream-chart-series`, `.stream-chart-threshold`, `.alert-banner`, `.alert-critical`, `.alert-warning` classes.
  - Use existing CSS variables (`--bg-primary`, `--success`, `--warning`, `--error`, etc.).

- **Tab Switching & Polling:**
  - Add `tab-streams` to `switchTab` and the URL-hash auto-activation logic used by Story 19.2.
  - **CRITICAL:** Update `handleHashRoute()` and the initial hash check to include `hash === 'streams'`.
  - Use constants `STREAMS_REFRESH_INTERVAL_MS = 5000` and `STREAMS_FETCH_TIMEOUT_MS = 8000`.
  - Use `streamsActiveFetch` AbortController and `fetchWithTimeout` to avoid race conditions.
  - **CRITICAL:** Add `stopStreamsRefresh()` to the `beforeunload` handler alongside `stopCheckpointRefresh()` and `stopProxiesRefresh()`.

- **Testing:**
  - Unit tests should mount a fixture Express app with mock `StreamMetricsCollector` and `StreamAlertEngine` instances.
  - Verify `GET /api/admin/stream/metrics` and `GET /api/admin/stream/alerts` return correct envelopes.
  - If `POST /api/admin/stream/alerts/test` is added, verify it returns `{ success: true, triggered: true }`.
  - Playwright E2E should serve `admin.html` from a fixture HTTP server, stub `/api/admin/stream/metrics`, `/api/admin/stream/alerts`, and `/api/admin/stream/alerts/test`, and assert that tab, stat cards, chart, and alerts list are rendered.

### Project Structure Notes

- Frontend files remain in `dashboard/` directory.
- REST routes remain under `api/routes/`.
- No new external client-side packages; vanilla JavaScript + SVG matching existing `dashboard/admin.html` style.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md`#Story 19.3: Dashboard Stream Metrics & Alerts View]
- [Source: `_bmad-output/planning-artifacts/ux/DESIGN.md` lines 246-248, 265-269, 320-328]
- [Source: `_bmad-output/planning-artifacts/prd.md` FR-85, NFR-17]
- [Source: `_bmad-output/implementation-artifacts/19-2-dashboard-proxies-accounts-view.md`]
- [Source: `src/utils/stream-metrics-collector.js`]
- [Source: `src/utils/stream-alerts.js`]
- [Source: `api/routes/admin.js`]
- [Source: `src/mcp/server.js`]
- [Source: `src/core/adaptive-governor.js`]

## Dev Agent Record

### Agent Model Used
claude-opus-5

### Debug Log References
- `tests/admin/dashboard-stream-metrics-alerts.test.js` — 3/3 passed.
- `tests/e2e/admin-stream-metrics-alerts.e2e.test.js` — 5/5 passed.
- `npx vitest run tests/admin/` — 6/6 passed (includes Story 19.2 regressions).
- `npx playwright test tests/e2e/admin-stream-metrics-alerts.e2e.test.js` — 5/5 passed.

### Completion Notes List
- Added `POST /api/admin/stream/alerts/test` in `api/routes/admin.js` that triggers `defaultStreamAlertEngine.checkAndAlert()` with elevated test metrics.
- Extended `dashboard/admin.html` with a new `📊 Stream Metrics & Alerts` tab (`tab-streams`), 6 stat boxes, SVG line chart for `eventsPerSecond` and `pendingMessages`, 50,000 threshold line, time range toggles (5m/1h/24h), and active alerts list with severity badges.
- Implemented `loadStreamMetricsAndAlerts()`, rolling 17280-point history buffer, `startStreamsRefresh()` / `stopStreamsRefresh()` with 5s `setInterval`, `AbortController`, and `fetchWithTimeout`.
- Wired tab switching, hash routing (`#streams`), and `beforeunload` cleanup.
- Added `tests/admin/dashboard-stream-metrics-alerts.test.js` with fixture Express routes and Playwright E2E spec `tests/e2e/admin-stream-metrics-alerts.e2e.test.js` using a fixture HTTP server.

### File List
- `api/routes/admin.js` (modified)
- `dashboard/admin.html` (modified)
- `tests/admin/dashboard-stream-metrics-alerts.test.js` (new)
- `tests/e2e/admin-stream-metrics-alerts.e2e.test.js` (new)
- `_bmad-output/implementation-artifacts/19-3-dashboard-stream-metrics-alerts-view.md` (modified)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)

### Project Structure Notes

- Frontend files remain in `dashboard/` directory.
- REST routes remain under `api/routes/`.
- No new external client-side packages; vanilla JavaScript + SVG matching existing `dashboard/admin.html` style.

## Review Findings

Code review executed by 4 review lenses (Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor). Findings triaged and applied below.

### Applied Patches

- `dashboard/admin.html`
  - `fetchWithTimeout` now honors an external `AbortSignal` while still enforcing timeout, preventing in-flight leaks when `stopStreamsRefresh()` aborts mid-request.
  - `renderStreamAlerts` escapes all interpolated text and validates numeric threshold/value before computing severity.
  - Added `formatDuration` and rendered `lastAckTime` as a readable duration (e.g., `2m`) instead of raw seconds.
  - SVG chart now uses a fixed `[now - rangeMs, now]` x-axis window and `preserveAspectRatio="xMidYMid meet"` to prevent distortion.
  - Added `stream-connection-status` badge showing Live / Stale / Loading state based on request success.
  - `STREAMS_MAX_HISTORY` corrected from `288` to `17280` points for true 24h at 5s interval.
- `api/routes/admin.js`
  - Added null-guards on `defaultStreamMetricsCollector` and `defaultStreamAlertEngine` returning `503` when engines are unavailable.
- `tests/e2e/admin-stream-metrics-alerts.e2e.test.js`
  - Updated `last-ack-time` expectation from `120s` to `2m` to match `formatDuration`.

### Deferred / Dismissed Findings

- **Severity calculation**: Frontend uses `value > threshold * 1.5` as the critical/warning split. This is a presentational heuristic; the alert engine itself only emits alerts when a threshold is exceeded. Severity labels are not persisted and can be adjusted later if UX defines a stricter rule.
- **Auth test coverage**: E2E fixture server stubs auth. Unit tests for `authenticateToken`/`requireAdmin` on stream endpoints are not added because the existing auth middleware is already covered by other admin route tests.
- **Test alert side-effects**: `POST /api/admin/stream/alerts/test` intentionally overrides `pendingMessages` and `lastAckTime` to force an alert and is gated to admin tokens; this is the intended operator-facing behavior.
- **Tooltips / hover state**: Not required by the acceptance criteria; can be added in a future UX polish pass.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md`#Story 19.3: Dashboard Stream Metrics & Alerts View]
- [Source: `_bmad-output/planning-artifacts/ux/DESIGN.md`]
- [Source: `src/utils/stream-metrics-collector.js`]
- [Source: `src/utils/stream-alerts.js`]
- [Source: `api/routes/admin.js`]
