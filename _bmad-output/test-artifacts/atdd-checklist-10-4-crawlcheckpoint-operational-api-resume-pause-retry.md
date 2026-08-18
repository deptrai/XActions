---
storyId: '10.4'
storyKey: '10-4-crawlcheckpoint-operational-api-resume-pause-retry'
storyFile: '_bmad-output/implementation-artifacts/10-4-crawlcheckpoint-operational-api-resume-pause-retry.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-10-4-crawlcheckpoint-operational-api-resume-pause-retry.md'
stepsCompleted:
  - 'step-01-preflight-and-context'
  - 'step-02-generation-mode'
  - 'step-03-test-strategy'
  - 'step-04-generate-tests'
  - 'step-04c-aggregate'
lastStep: 'step-04c-aggregate'
lastSaved: '2026-08-19T05:25:00.000Z'
generatedTestFiles:
  - 'tests/store/checkpoint-manager.test.js'
  - 'tests/api/checkpoints-routes.test.js'
---

# ATDD Checklist — Story 10.4: CrawlCheckpoint Operational API (Resume / Pause / Retry)

## 1. Story & Acceptance Criteria Overview

- **Story ID:** 10.4
- **Story Key:** `10-4-crawlcheckpoint-operational-api-resume-pause-retry`
- **Module Under Test:** `src/store/checkpoint-manager.js` & `api/routes/checkpoints.js`
- **Primary Patterns:** Service Layer CRUD + State Machine, Express Route Adapter with Dual-Channel Auth (JWT + A2A Permissions), Status Guard Transitions (`running`, `paused`, `failed`, `completed`, `stalled`), CLI Command Integration.

---

## 2. Test Strategy & Levels Matrix

| Test Group | Scope / Target | Priority | Test File |
|---|---|---|---|
| **Service CRUD & Filters** | `listCheckpoints`, `getCheckpoint`, limit capping, search filters | P0 | `tests/store/checkpoint-manager.test.js` |
| **Service State Transitions** | `resumeCheckpoint`, `pauseCheckpoint`, `retryCheckpoint` logic | P0 | `tests/store/checkpoint-manager.test.js` |
| **Service State Transition Guards** | Illegal transition validation (`XACT_4002`), 404 not found (`XACT_4041`) | P0 | `tests/store/checkpoint-manager.test.js` |
| **API Authentication & Authorization** | 401 unauth, 403 non-admin, 200 admin, 200 A2A `checkpoint:manage` | P0 | `tests/api/checkpoints-routes.test.js` |
| **API Endpoints & Envelope Contracts** | `GET /`, `GET /:id`, `POST /:id/resume`, `POST /:id/pause`, `POST /:id/retry` | P1 | `tests/api/checkpoints-routes.test.js` |
| **CLI Commands** | `xactions checkpoints list`, `show`, `resume`, `pause`, `retry` | P1 | `tests/cli/checkpoints-cli.test.js` (or inline integration) |

---

## 3. Acceptance Criteria Coverage Mapping

### AC1 — List checkpoints (`listCheckpoints` & `GET /api/checkpoints`)
- [x] `returns paginated checkpoints with total count, limit, and offset` (P0)
- [x] `filters checkpoints by platform, targetType, targetKey (substring), and status` (P0)
- [x] `caps limit to 500 and sorts by updatedAt desc by default` (P1)

### AC2 — Show one checkpoint (`getCheckpoint` & `GET /api/checkpoints/:id`)
- [x] `returns single checkpoint by ID with all expected fields` (P0)
- [x] `throws PlatformError 404 (XACT_4041) when checkpoint ID is not found` (P0)

### AC3 — Resume a checkpoint (`resumeCheckpoint` & `POST /api/checkpoints/:id/resume`)
- [x] `transitions status to running and sets nextScheduledAt to now` (P0)
- [x] `throws PlatformError 400 (XACT_4002) when resuming an already running or completed checkpoint` (P0)

### AC4 — Pause a checkpoint (`pauseCheckpoint` & `POST /api/checkpoints/:id/pause`)
- [x] `transitions status to paused and sets nextScheduledAt to null` (P0)
- [x] `throws PlatformError 400 (XACT_4002) when pausing a paused, failed, or completed checkpoint` (P0)

### AC5 — Retry a checkpoint (`retryCheckpoint` & `POST /api/checkpoints/:id/retry`)
- [x] `transitions status to running, resets errorCount to 0, preserves lastCursor, and sets nextScheduledAt to now` (P0)
- [x] `throws PlatformError 400 (XACT_4002) when retrying a running, paused, or completed checkpoint` (P0)

### AC6 — Authorization Middleware
- [x] `returns 401 when request is unauthenticated` (P0)
- [x] `returns 403 when authenticated user lacks admin role and checkpoint:manage permission` (P0)
- [x] `grants access when authenticated as admin user` (P0)
- [x] `grants access when authenticated as A2A agent with checkpoint:manage permission` (P0)

---

## 4. Red-Phase Test Execution Instructions

Run the red-phase test scaffolds to verify that all tests fail before implementation:

```bash
npx vitest run tests/store/checkpoint-manager.test.js
npx vitest run tests/api/checkpoints-routes.test.js
```
