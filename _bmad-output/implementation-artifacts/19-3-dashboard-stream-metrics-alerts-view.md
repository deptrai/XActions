---
story_id: "19.3"
epic: 19
story_key: "19-3-dashboard-stream-metrics-alerts-view"
status: "ready-for-dev"
phase: "Phase 5"
created: 2026-09-01
updated: 2026-09-01
owner: "DEV"
reviewed: "Pending"
baseline_commit: "9782d37a2bc09631e964d9d277c19a2715fe5422"
---

# Story 19.3: Dashboard Stream Metrics & Alerts View

Status: ready-for-dev

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

[Source: `epics.md` Epic 19, Story 19.3, lines 1041-1042; `dashboard/admin.html` lines 615-620]

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

### AC-6: Alert Channel Configuration (optional, only if UI exposed)
- **Given** the operator configures alert channels
- **When** they save `ALERT_WEBHOOK` and/or `ALERT_EMAIL`
- **Then** the values are persisted via environment or a lightweight config endpoint
- **And** alert dispatch uses these values in `StreamAlertEngine`.

[Source: `epics.md` Epic 19, Story 19.3, line 1047; `src/utils/stream-alerts.js` lines 68-69]

## Tasks / Subtasks

- [ ] Task 1: Verify and extend backend stream metrics/alerts endpoints (AC: #2, #4)
  - [ ] Confirm `GET /api/admin/stream/metrics` returns `{ success: true, metrics: { eventsPerSecond, pendingMessages, consumerLag, droppedEvents, lastAckTime, maxLen, minId } }`.
  - [ ] Confirm `GET /api/admin/stream/alerts` returns `{ success: true, alerts: { activeAlerts, lastAlertTimestamp, totalAlertsTriggered } }`.
  - [ ] If missing, add `POST /api/admin/stream/alerts/test` to trigger a test alert through `StreamAlertEngine`.
- [ ] Task 2: Build UI components in `dashboard/admin.html` (AC: #1, #2, #3, #4)
  - [ ] Add `<button class="tab-btn" onclick="switchTab('streams')">📊 Stream Metrics & Alerts</button>` to `.tab-nav`.
  - [ ] Add `<div id="tab-streams" class="tab-content">` panel with grid layout.
  - [ ] Render 6 top metrics stat boxes (`eventsPerSecond`, `pendingMessages`, `consumerLag`, `droppedEvents`, `lastAckTime`, `maxLen`).
  - [ ] Render SVG line chart with `eventsPerSecond` and `pendingMessages` series + alert threshold line.
  - [ ] Render Active Alerts table/list with severity badges.
  - [ ] Add time range toggles (5m / 1h / 24h) that control chart x-axis label density.
- [ ] Task 3: Client-side polling and event dispatchers (AC: #2, #3, #4, #5)
  - [ ] Implement `loadStreamMetricsAndAlerts()` fetching `/api/admin/stream/metrics` and `/api/admin/stream/alerts`.
  - [ ] Maintain a rolling history buffer (e.g. last 288 points = ~24h at 5s interval) for chart series.
  - [ ] Setup 5s `setInterval` active only while `tab-streams` is displayed, with `AbortController` and `fetchWithTimeout`.
  - [ ] Pause auto-refresh on tab switch; clear on `beforeunload`.
- [ ] Task 4: Automated E2E & unit verification (AC: #1, #2, #3, #4, #5)
  - [ ] Add tests in `tests/admin/dashboard-stream-metrics-alerts.test.js` verifying API routes and client behavior.
  - [ ] Add Playwright E2E spec `tests/e2e/admin-stream-metrics-alerts.e2e.test.js` using a fixture HTTP server.
  - [ ] Run full test suite to ensure zero regressions.

## Dev Notes

- **Existing Backend Files to Touch / Reference:**
  - `api/routes/admin.js`: `GET /api/admin/stream/metrics` (line 291) and `GET /api/admin/stream/alerts` (line 304) already exist. Verify auth and error envelope. Optionally add `POST /api/admin/stream/alerts/test`.
  - `src/utils/stream-metrics-collector.js`: `defaultStreamMetricsCollector.getMetrics()` returns `StreamMetrics` shape (lines 274-282). It has 5s cache TTL.
  - `src/utils/stream-alerts.js`: `defaultStreamAlertEngine.getAlertStatus()` returns `{ activeAlerts, lastAlertTimestamp, totalAlertsTriggered }` (lines 228-234). Thresholds default to `pendingMessages > 50,000`, `consumerLag > 50,000`, `lastAckTime > 60s`.
  - `src/mcp/server.js`: `GET /metrics/stream` returns raw `StreamMetrics` (no envelope). Prefer `/api/admin/stream/metrics` for dashboard.
  - `dashboard/admin.html`: Add tab HTML, CSS styling, SVG chart renderer, stat cards, and polling logic. Reuse existing `fetchWithTimeout`, `esc`, `jsEsc`, toast helpers, and tab switcher patterns from Story 19.2.

- **Data Shapes:**
  - `GET /api/admin/stream/metrics` -> `{ success: true, metrics: { eventsPerSecond, pendingMessages, consumerLag, droppedEvents, lastAckTime, maxLen, minId } }`
  - `GET /api/admin/stream/alerts` -> `{ success: true, alerts: { activeAlerts: [{ alert, threshold, value, timestamp, metrics }], lastAlertTimestamp, totalAlertsTriggered } }`
  - `POST /api/admin/stream/alerts/test` -> `{ success: true, triggered: true, alerts: [...] }`

- **Frontend Chart Approach:**
  - Use an SVG `<svg>` element with `<polyline>` or `<path>` for each series.
  - Maintain a `streamMetricsHistory` array of `{ timestamp, eventsPerSecond, pendingMessages }`.
  - On each poll, push the latest point and prune to the selected time range window (or keep last 288 points for 24h).
  - Map data values to SVG coordinates with `viewBox="0 0 800 200"`.
  - Draw a dashed horizontal threshold line at `pendingMessages = 50,000`.
  - Time range toggles only affect x-axis labels and pruning; the chart still renders the available history.

- **CSS Styling:**
  - Reuse existing `.stats-bar`, `.stat-box`, `.stat-value`, `.stat-label` classes.
  - Add `.stream-chart-container`, `.stream-chart-series`, `.stream-chart-threshold`, `.alert-banner`, `.alert-critical`, `.alert-warning` classes.
  - Use existing CSS variables (`--bg-primary`, `--success`, `--warning`, `--error`, etc.).

- **Tab Switching & Polling:**
  - Add `tab-streams` to `switchTab` and the URL-hash auto-activation logic (if any) used by Story 19.2.
  - Use constants `STREAMS_REFRESH_INTERVAL_MS = 5000` and `STREAMS_FETCH_TIMEOUT_MS = 8000`.
  - Use `streamsActiveFetch` AbortController and `fetchWithTimeout` to avoid race conditions.

- **Testing:**
  - Unit tests should mount a fixture Express app with mock `StreamMetricsCollector` and `StreamAlertEngine` instances.
  - Verify `GET /api/admin/stream/metrics` and `GET /api/admin/stream/alerts` return correct envelopes.
  - Playwright E2E should serve `admin.html` from a fixture HTTP server, stub `/api/admin/stream/metrics` and `/api/admin/stream/alerts`, and assert that tab, stat cards, chart, and alerts list are rendered.

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

### Debug Log References

### Completion Notes List

### File List

### Project Structure Notes

- Frontend files remain in `dashboard/` directory.
- REST routes remain under `api/routes/`.
- No new external client-side packages; vanilla JavaScript + SVG matching existing `dashboard/admin.html` style.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md`#Story 19.3: Dashboard Stream Metrics & Alerts View]
- [Source: `_bmad-output/planning-artifacts/ux/DESIGN.md`]
- [Source: `src/utils/stream-metrics-collector.js`]
- [Source: `src/utils/stream-alerts.js`]
- [Source: `api/routes/admin.js`]
