# Story 19.3: Dashboard Stream Metrics & Alerts View

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **Reliability Engineer**,  
I want **a dashboard view that displays Redis Stream throughput, consumer lag, dropped events, and active alerts**,  
so that **I can detect early when Nowing consumers fall behind or when stream events are dropped, and configure alert channels without modifying environment files manually**.

## Acceptance Criteria

### AC-1: Stream Metrics & Alerts Tab in Admin Dashboard
- **Given** the operator opens `/admin`
- **When** the page loads
- **Then** a new tab **"📊 Stream Metrics & Alerts"** is visible alongside existing tabs
- **And** navigating to `/admin#stream` or `/admin/stream` activates this tab by default

### AC-2: Real-Time Stream Metrics Display & Cards
- **Given** the "Stream Metrics & Alerts" view is active
- **When** the dashboard fetches `GET /api/admin/stream/metrics`
- **Then** it renders real-time metric cards and timeseries graphs for:
  - `Events / Second` — current throughput (`eventsPerSecond`)
  - `Pending Messages` — unacknowledged consumer messages (`pendingMessages`)
  - `Consumer Lag` — consumer group lag behind stream head (`consumerLag`)
  - `Dropped Events` — dropped or dead-letter messages count (`droppedEvents`)
  - `Last Ack Time` — relative timestamp since last consumer acknowledgment (`lastAckTime`)

### AC-3: Active Alerts Panel & Threshold Highlights
- **Given** the "Stream Metrics & Alerts" view is open
- **When** stream lag exceeds thresholds (`pendingMessages > 50,000` or `lastAckTime > 60s`)
- **Then** the Active Alerts card displays a prominent warning badge and details of the triggered alert
- **And** the corresponding metric card highlights with `--error` or `--warning` border/glow
- **And** when conditions normalize, alerts automatically resolve to "Healthy"

### AC-4: Alert Channel Configuration & Connectivity Test
- **Given** the Alert Channels configuration panel in the stream view
- **When** the operator updates `ALERT_WEBHOOK` URL or `ALERT_EMAIL` and clicks **Save Configuration**
- **Then** the dashboard calls `POST /api/admin/stream/alerts/config` with Bearer auth
- **And** clicking **Test Alert** sends a test notification via `POST /api/admin/stream/alerts/test` and displays delivery result feedback

### AC-5: Real-Time 5-Second Auto-Refresh
- **Given** the "Stream Metrics & Alerts" view is active
- **When** left open in the browser
- **Then** it automatically polls `GET /api/admin/stream/metrics` and `GET /api/admin/stream/alerts` every **5 seconds**
- **And** pauses polling during manual action execution and clears timers on tab switch

### AC-6: Authentication & Authorization
- **Given** requests to `/api/admin/stream/*`
- **When** executed by client
- **Then** `authToken` Bearer header is verified via `authenticateToken` + `requireAdmin`
- **And** unauthorized requests receive 401/403 and display clear permission feedback

### AC-7: Mobile-Responsive Layout
- **Given** a viewport narrower than 768px
- **When** the stream metrics view renders
- **Then** metric cards stack into a clean vertical grid and tables/panels remain horizontally scrollable without clipping

## Tasks / Subtasks

- [ ] Task 1: Update backend admin routes for stream alert configuration & test (AC: #4, #6)
  - [ ] 1.1 Add `POST /api/admin/stream/alerts/config` endpoint in `api/routes/admin.js` to update in-memory alert destinations
  - [ ] 1.2 Add `POST /api/admin/stream/alerts/test` endpoint in `api/routes/admin.js` to trigger a synthetic test alert
  - [ ] 1.3 Ensure `authenticateToken` and `requireAdmin` guards on all stream endpoints
- [ ] Task 2: Implement UI layout in `dashboard/admin.html` (AC: #1, #2, #3, #4, #7)
  - [ ] 2.1 Add tab button and panel container `#tab-stream` to `dashboard/admin.html`
  - [ ] 2.2 Add top metric cards (`eventsPerSecond`, `pendingMessages`, `consumerLag`, `droppedEvents`, `lastAckTime`)
  - [ ] 2.3 Add Active Alerts panel with severity badges and trigger descriptions
  - [ ] 2.4 Add Alert Channels configuration form (Webhook URL, Email, Test & Save buttons)
- [ ] Task 3: Implement client-side Stream Metrics controller (AC: #2, #3, #4, #5)
  - [ ] 3.1 Write `loadStreamMetrics()` helper calling `/api/admin/stream/metrics` and `/api/admin/stream/alerts`
  - [ ] 3.2 Implement threshold checks (`pendingMessages > 50000`, `lastAckTime > 60s`) with dynamic color updates
  - [ ] 3.3 Implement `saveAlertConfig()` and `sendTestAlert()` action handlers with toast notifications
  - [ ] 3.4 Wire 5s polling loop in `switchTab('stream')` and cleanup in `beforeunload`
- [ ] Task 4: Integration testing and verification (AC: #1-#7)
  - [ ] 4.1 Create `tests/dashboard/admin-stream-metrics.test.js` covering AC-1 to AC-7 with real DOM and HTTP fixture
  - [ ] 4.2 Verify threshold warnings, alert testing, 5s refresh cycle, and auth protection
  - [ ] 4.3 Run full dashboard test suite (`admin-checkpoints.test.js`, `admin-proxies-accounts.test.js`, `admin-stream-metrics.test.js`)

## Dev Notes

### Relevant Architecture Patterns and Constraints

1. **Static HTML/JS Client**: `dashboard/admin.html` is vanilla JS and CSS variables (`--bg-primary`, `--bg-secondary`, `--accent`, `--success`, `--error`, `--warning`). No external charting packages (Chart.js/D3) without build step; use lightweight CSS bars / SVG sparklines or clean stat tiles.
2. **Zero Direct DB/Redis Access from Client**: All telemetry is read through Express `/api/admin/stream/*` endpoints.
3. **Stream Metrics Backend**:
   - `src/utils/stream-metrics-collector.js` provides `defaultStreamMetricsCollector.getMetrics()`.
   - `src/utils/stream-alerts.js` provides `defaultStreamAlertEngine.getAlertStatus()`.
4. **Alert Trigger Invariant**:
   - Warning threshold 1: `pendingMessages > 50,000`
   - Warning threshold 2: `lastAckTime > 60,000 ms` (60s)

### Project Structure Notes

- **Modified Files**:
  - `api/routes/admin.js` — add stream alert config and test endpoints
  - `dashboard/admin.html` — add `#tab-stream`, metrics tiles, alert panels, and controller
  - `_bmad-output/implementation-artifacts/sprint-status.yaml` — update story status
- **New Files**:
  - `_bmad-output/implementation-artifacts/19-3-dashboard-stream-metrics-alerts-view.md` — this story specification
  - `tests/dashboard/admin-stream-metrics.test.js` — comprehensive integration tests

### References

- [Source: `_bmad-output/planning-artifacts/epics.md#Story 19.3`, lines 1041-1053]
- [Source: `_bmad-output/implementation-artifacts/epic-19-context.md`, lines 13, 31, 34]
- [Source: `src/utils/stream-metrics-collector.js`]
- [Source: `src/utils/stream-alerts.js`]
- [Source: `api/routes/admin.js`, lines 290-315]

## Dev Agent Record

### Agent Model Used

claude-sonnet-5[1m]

### Debug Log References

- Story status updated to `ready-for-dev` in `_bmad-output/implementation-artifacts/sprint-status.yaml`.
- Existing stream endpoints in `api/routes/admin.js` tested and confirmed live.

### Completion Notes List

- TBD

### File List

- `_bmad-output/implementation-artifacts/19-3-dashboard-stream-metrics-alerts-view.md` (new)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (update)
