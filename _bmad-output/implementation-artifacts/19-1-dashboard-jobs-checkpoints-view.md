---
story_id: "19.1"
epic: 19
story_key: "19-1-dashboard-jobs-checkpoints-view"
status: "ready-for-dev"
phase: "Phase 5"
created: 2026-09-01
updated: 2026-09-01
owner: "DEV"
reviewed: "Pending"
baseline_commit: ""
---

# Story 19.1: Dashboard Jobs & Checkpoints View

Status: ready-for-dev

## ⚠️ Critical Constraints / Architecture Variance

The following decisions are non-negotiable and override any earlier language in this story or external references:

1. **No DB Access from the Dashboard** — The dashboard is a static HTML/JS client. It must call the existing HTTP API (`/api/checkpoints`, `/api/governor/status`, `/metrics/stream`). It must never import Prisma, read the database, or bypass `checkpoint:manage` / admin authorization.
2. **Reuse Existing Backend** — The checkpoint CRUD + lifecycle API in `api/routes/checkpoints.js` and `src/store/checkpoint-manager.js` is already implemented (Story 10.4). This story only adds the **view layer** and SSE/polling refresh.
3. **Single Admin HTML Surface** — Extend the existing `dashboard/admin.html` with a new tabbed view, rather than creating a separate page. The admin route `/admin` already serves this file.
4. **No Mocks in Tests** — Dashboard tests must drive real DOM / real `fetch` against the Express server or a local HTTP fixture. No `vi.fn` stubs.
5. **No Inline Epic/Story References in Source Code** — Do not add comments like `# Epic 19, # Story 19.1` to source files. Comments explain why, not what.

[Source: `ARCHITECTURE-SPINE.md` AD-19, lines 320-330; `epics.md` Epic 19, Story 19.1, lines 1016-1027]

## Story

As an **Operations Manager**,  
I want **a dashboard view that displays all crawl jobs and checkpoints with their resume/pause/failed status and last cursor/timestamp progress**,  
so that **I can monitor and control the crawl pipeline without using the terminal**.

## Acceptance Criteria

### AC-1: Jobs & Checkpoints Tab in Admin Dashboard

- **Given** the operator opens `/admin`
- **When** the page loads
- **Then** a new tab **"Jobs & Checkpoints"** is visible alongside existing tabs
- **And** the tab is active by default when navigating to `/admin#jobs` or `/admin/checkpoints`

[Source: `epics.md` Epic 19, Story 19.1, lines 1022-1027]

### AC-2: Checkpoints Data Table

- **Given** the "Jobs & Checkpoints" view is active
- **When** the dashboard fetches data
- **Then** it renders a table with columns:
  - `Platform` — `platform`
  - `Target` — combined `targetType` / `targetKey`
  - `Status` — `status` (running, paused, failed, completed, stalled)
  - `Last Activity` — `lastCrawledAt` rendered as relative time
  - `Last Cursor` — `lastCursor` or `lastTimestamp`
  - `Errors` — `errorCount`
  - `Actions` — Resume / Pause / Retry buttons
- **And** rows are clickable to open a detail panel or modal showing the full checkpoint record

[Source: `epics.md` Epic 19, Story 19.1, line 1024; `src/store/checkpoint-manager.js`, lines 11-17]

### AC-3: Inline Checkpoint Actions

- **Given** a checkpoint row with action buttons
- **When** the operator clicks **Resume**, **Pause**, or **Retry**
- **Then** the dashboard calls the corresponding endpoint:
  - `POST /api/checkpoints/:id/resume`
  - `POST /api/checkpoints/:id/pause`
  - `POST /api/checkpoints/:id/retry`
- **And** on success, the table refreshes and the row status updates
- **And** on failure, an inline error toast/banner appears with the error message

[Source: `api/routes/checkpoints.js`, lines 209-251; `src/store/checkpoint-manager.js`, lines 169-272]

### AC-4: Real-Time Updates

- **Given** the "Jobs & Checkpoints" view is open
- **When** the operator leaves the page open
- **Then** the table refreshes every **30 seconds** using SSE or polling
- **And** the refresh preserves the current filter/sort state

[Source: `epics.md` Epic 19, Story 19.1, line 1026; `ARCHITECTURE-SPINE.md` AD-19, lines 324, 327]

### AC-5: Filtering & Sorting

- **Given** the checkpoints table
- **When** the operator interacts with filter controls
- **Then** they can filter by:
  - `platform`
  - `targetType`
  - `status`
  - `targetKey` substring
- **And** they can sort by `lastCrawledAt`, `updatedAt`, `status`, `platform`
- **And** the dashboard passes these as query params to `GET /api/checkpoints`

[Source: `api/routes/checkpoints.js`, lines 164-187; `src/store/checkpoint-manager.js`, lines 48-131]

### AC-6: Authentication & Authorization

- **Given** the dashboard client
- **When** it calls `/api/checkpoints`
- **Then** it sends the `authToken` from `localStorage` as a `Bearer` header
- **And** unauthenticated or non-admin/non-`checkpoint:manage` users are redirected to `/login`
- **And** 403 responses show a clear "Insufficient permissions" message

[Source: `api/routes/checkpoints.js`, lines 38-127; `api/middleware/auth.js`]

### AC-7: Mobile-Responsive Layout

- **Given** a viewport narrower than 768px
- **When** the table renders
- **Then** it collapses into cards or a horizontally scrollable table
- **And** action buttons remain reachable

[Source: `ux/DESIGN.md`, lines 31-44; `ux/EXPERIENCE.md`, lines 339-343]

## Tasks / Subtasks

- [ ] Task 1: Update `dashboard/admin.html` with Jobs & Checkpoints tab and layout
  - [ ] 1.1 Add new tab button and tab panel to the tab navigation
  - [ ] 1.2 Add table skeleton, filter bar, and pagination controls
  - [ ] 1.3 Apply existing dark-theme CSS variables and responsive rules
- [ ] Task 2: Implement checkpoint data fetching and rendering
  - [ ] 2.1 Write `fetchCheckpoints(filters, sort, pagination)` helper using `fetch` + `Bearer` token
  - [ ] 2.2 Render rows with status badges, relative times, and action buttons
  - [ ] 2.3 Handle empty, loading, and error states
- [ ] Task 3: Implement inline resume / pause / retry actions
  - [ ] 3.1 Add click handlers that call `POST /api/checkpoints/:id/{action}`
  - [ ] 3.2 Confirm action with a non-blocking inline prompt or disable-with-spinner UX
  - [ ] 3.3 Refresh table after mutation and show success/error feedback
- [ ] Task 4: Implement real-time refresh (30s)
  - [ ] 4.1 Set up `setInterval` or `EventSource` for periodic refresh
  - [ ] 4.2 Clear interval/source on tab switch / page unload
  - [ ] 4.3 Avoid refresh while an action is in flight
- [ ] Task 5: Implement filtering, sorting, and pagination
  - [ ] 5.1 Bind filter inputs to query params
  - [ ] 5.2 Add sortable column headers
  - [ ] 5.3 Add pagination controls tied to `limit` / `offset` / `total`
- [ ] Task 6: Add dashboard tests
  - [ ] 6.1 Add `tests/dashboard/admin-checkpoints.test.js` using Vitest + real DOM + local HTTP fixture
  - [ ] 6.2 Verify table renders checkpoints from `GET /api/checkpoints`
  - [ ] 6.3 Verify resume/pause/retry buttons call the correct endpoints
  - [ ] 6.4 Verify 30s refresh cycle and auth failure handling
- [ ] Task 7: Run validations
  - [ ] 7.1 Run `vitest run tests/dashboard/admin-checkpoints.test.js`
  - [ ] 7.2 Run `vitest run tests/api/checkpoints-routes.test.js` to ensure no regression
  - [ ] 7.3 Run `npm run typecheck` if configured

## Dev Notes

### What Already Exists (Do Not Rebuild)

- **Model**: `CrawlCheckpoint` in `prisma/schema.prisma` with fields `id, platform, targetType, targetKey, status, lastCursor, lastTimestamp, lastCrawledAt, nextScheduledAt, errorCount, createdAt, updatedAt`.
- **Service**: `src/store/checkpoint-manager.js` provides `listCheckpoints`, `getCheckpoint`, `resumeCheckpoint`, `pauseCheckpoint`, `retryCheckpoint` with full state-machine validation.
- **API**: `api/routes/checkpoints.js` mounts `GET /api/checkpoints`, `GET /api/checkpoints/:id`, `POST /api/checkpoints/:id/{resume,pause,retry}` with `requireCheckpointManage` middleware.
- **Auth**: `requireCheckpointManage` accepts admin JWT, A2A API key with `checkpoint:manage`, or A2A bearer token with `checkpoint:manage`.
- **CLI**: `src/cli/commands/checkpoints.js` and `src/cli/commands/admin.js` already consume the same backend.
- **Tests**: `tests/api/checkpoints-routes.test.js`, `tests/store/checkpoint-manager.test.js`, `tests/cli/checkpoint-cli.test.js` provide patterns for real-DB and real-route tests.

[Source: `prisma/schema.prisma`, lines 389-407; `src/store/checkpoint-manager.js`; `api/routes/checkpoints.js`; `tests/api/checkpoints-routes.test.js`]

### Files to Modify

1. **`dashboard/admin.html`** — add new tab, panel, table, filters, and JavaScript.
2. **`tests/dashboard/admin-checkpoints.test.js`** — new Vitest test file.

### Files to Read but Not Modify

- `api/routes/checkpoints.js` — contract for checkpoint endpoints.
- `src/store/checkpoint-manager.js` — state machine and validation rules.
- `api/middleware/auth.js` — admin / `checkpoint:manage` permission model.
- `dashboard/admin.html` existing tab JS (socket.io tabs, x402 tab) — follow the same event-binding pattern.

### Architecture Compliance

- **No new backend endpoints** for this story unless a missing `/admin/*` route is strictly required by the dashboard. Prefer reusing `/api/checkpoints` and `/api/governor/status`.
- **Static HTML/JS only** in `dashboard/`. No React, Vue, or build step. Use vanilla JS and CSS variables matching the existing dark theme.
- **Error Envelope**: dashboard must parse the standard `{ success: false, error: { code, message, suggestedAction } }` shape returned by `api/routes/checkpoints.js` error handler.
- **Polling vs SSE**: polling with `setInterval` is acceptable for 30s refresh. SSE is optional; if implemented, use the existing Socket.io connection already established in `dashboard/admin.html` or add a lightweight `EventSource` to a new `/admin/checkpoints/sse` endpoint only if backend changes are approved.

### UX Requirements

- Follow `dashboard/admin.html` dark theme (`--bg-primary`, `--bg-secondary`, `--accent`, `--success`, `--error`, `--warning`).
- Status badges:
  - `running` → `--success`
  - `paused` → `--warning`
  - `failed` → `--error`
  - `completed` → `--accent`
  - `stalled` → `--warning` with pulse
- Use the existing emoji microcopy convention from `EXPERIENCE.md` (✅ ❌ ⚠️ 🛡️ 🚀) for toasts only; status text should be plain English.
- Table header should include count summary: e.g. "Showing 12 of 47 checkpoints".
- Empty state: icon + "No checkpoints yet. Start a crawl to see jobs here."

### Security & Performance

- Store `authToken` only in `localStorage` as already done; attach as `Authorization: Bearer <token>`.
- Cap `limit` to 500 (backend already enforces).
- Debounce filter `targetKey` input to ~300ms before fetching.
- Cancel in-flight `fetch` on unmount/tab switch using `AbortController`.

### Testing Notes

- Use `vitest` with `jsdom` or `happy-dom` only if necessary. Preferred: real Node `http` server fixture that serves `dashboard/admin.html` and a mocked checkpoint JSON endpoint, then use `undici`/`node-fetch` or `playwright` to assert rendered output.
- Because the dashboard uses `localStorage`, tests must set `global.localStorage` or run in a real browser context.
- For action-button tests, intercept `fetch` calls and assert URL + method. No mocks means record actual request logs and assert against them, or run against a real test server.
- Clean up test checkpoints via `tests/store/test-prisma-client.js` pattern if database is used.

## Dev Agent Record

### Agent Model Used

claude-opus-5[1m]

### Debug Log References

- Sprint status updated to `ready-for-dev` in `_bmad-output/implementation-artifacts/sprint-status.yaml`.
- Existing dashboard served at `/admin` by `api/server.js`, line 520.
- Existing checkpoint REST API at `/api/checkpoints` mounted in `api/server.js`, line 351.

### Completion Notes List

- TBD

### File List

- `dashboard/admin.html` (update)
- `tests/dashboard/admin-checkpoints.test.js` (new)

### Change Log

- 2026-09-01: Created comprehensive story context for Story 19.1 — Dashboard Jobs & Checkpoints View.
