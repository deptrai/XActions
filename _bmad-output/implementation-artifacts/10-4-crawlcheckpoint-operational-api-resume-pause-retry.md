---
story_id: 10.4
story_key: 10-4-crawlcheckpoint-operational-api-resume-pause-retry
epic: 10 — Unified PostgreSQL Storage (Prisma) & Core Interfaces
status: ready-for-dev
---

# 10.4 — CrawlCheckpoint Operational API (Resume / Pause / Retry)

|||
|---|---|
| **Story ID** | 10.4 |
| **Story Key** | `10-4-crawlcheckpoint-operational-api-resume-pause-retry` |
| **Epic** | 10 — Unified PostgreSQL Storage (Prisma) & Core Interfaces |
| **Status** | ready-for-dev |
| **Author** | nich (@nichxbt) |

---

## User Story

**As a** Platform Operator,
**I want** an API and CLI to view, resume, pause, and retry individual crawl checkpoints,
**so that** I can manage crawl progress when containers restart or a target fails.

---

## Business Context

- Epic 10 stores all scraped data in PostgreSQL/Prisma and provides core interfaces for future platform crawlers.
- `CrawlCheckpoint` is the persistent state for 3-tier incremental gap-filling (AD-10): it tracks `lastCursor`, `lastTimestamp`, `lastCrawledAt`, `nextScheduledAt`, `status`, and `errorCount` per `(platform, targetType, targetKey)`.
- Without an operational surface, operators cannot recover a stalled or failed crawl without directly editing the database.
- Story 10.4 is the **control plane** for checkpoints. It does **not** run the crawlers (that belongs to Epics 11–18); it only mutates checkpoint state so crawlers can read it on their next loop.
- Story 10.2 already created the `CrawlCheckpoint` model, `PrismaStore`, and real-DB test infrastructure; Story 10.4 builds the HTTP + CLI operational surface on top of that model.

---

## Acceptance Criteria

### AC1 — List checkpoints

- **Given** the `CrawlCheckpoint` table exists and contains rows
- **When** an authenticated operator with `checkpoint:manage` permission (or admin equivalent) sends `GET /api/checkpoints`
- **Then** the endpoint returns a paginated list with:
  - `checkpoints: Array<CrawlCheckpoint>` — the matching rows.
  - `total: number` — total matching rows (ignoring pagination).
  - `limit: number`, `offset: number` from the request (defaults: `limit=50`, `offset=0`).
- **And** it supports optional query filters:
  - `platform` — exact match.
  - `targetType` — exact match.
  - `targetKey` — substring search (`contains`, `mode: 'insensitive'`).
  - `status` — exact match.
- **And** it sorts by `updatedAt` descending by default (most recently changed first).
- **And** `limit` is capped at `500` to avoid unbounded memory usage.

### AC2 — Show one checkpoint

- **Given** a `CrawlCheckpoint` row with id `ckpt_xxx`
- **When** an authenticated operator with `checkpoint:manage` permission (or admin equivalent) sends `GET /api/checkpoints/:id`
- **Then** the endpoint returns the checkpoint object, including `id`, `platform`, `targetType`, `targetKey`, `status`, `lastCursor`, `lastTimestamp`, `lastCrawledAt`, `nextScheduledAt`, `errorCount`, `createdAt`, `updatedAt`.
- **And** if no row with that `id` exists, it returns `404` with a `PlatformError` (`XACT_4041`, `not_found`).

### AC3 — Resume a checkpoint

- **Given** a `CrawlCheckpoint` row in status `paused`, `failed`, or `stalled`
- **When** an authenticated operator with `checkpoint:manage` permission (or admin equivalent) sends `POST /api/checkpoints/:id/resume`
- **Then** the endpoint updates `status` to `running`, leaves `lastCursor`/`lastTimestamp` unchanged, sets `nextScheduledAt` to `new Date()` if it was `null` or in the past, and returns the updated checkpoint.
- **And** if the row does not exist, it returns `404`.
- **And** if the current status is already `running` or `completed`, it returns `400` (`XACT_4002`, `invalid_state_transition`) with a clear message.

### AC4 — Pause a checkpoint

- **Given** a `CrawlCheckpoint` row in status `running` or `stalled`
- **When** an authenticated operator with `checkpoint:manage` permission (or admin equivalent) sends `POST /api/checkpoints/:id/pause`
- **Then** the endpoint updates `status` to `paused`, sets `nextScheduledAt` to `null`, and returns the updated checkpoint.
- **And** if the row does not exist, it returns `404`.
- **And** if the current status is `paused`, `failed`, or `completed`, it returns `400`.

### AC5 — Retry a checkpoint

- **Given** a `CrawlCheckpoint` row in status `failed` or `stalled`
- **When** an authenticated operator with `checkpoint:manage` permission (or admin equivalent) sends `POST /api/checkpoints/:id/retry`
- **Then** the endpoint updates `status` to `running`, resets `errorCount` to `0`, keeps `lastCursor`/`lastTimestamp` (retry continues from the last known cursor, not from the beginning), sets `nextScheduledAt` to `new Date()`, and returns the updated checkpoint.
- **And** if the row does not exist, it returns `404`.
- **And** if the current status is `running`, `paused`, or `completed`, it returns `400`.

### AC6 — Authorization

- **Given** a request to any `POST /api/checkpoints/:id/{resume|pause|retry}` or `GET /api/checkpoints*` endpoint
- **When** the caller is not authenticated
- **Then** the endpoint returns `401`.
- **And** when the caller is authenticated but is not `admin` and does not have `checkpoint:manage` permission
- **Then** the endpoint returns `403`.

### AC7 — CLI commands

- **Given** the CLI `xactions checkpoints ...`
- **When** the operator runs:
  - `xactions checkpoints list [options]`
  - `xactions checkpoints show <id>`
  - `xactions checkpoints resume <id>`
  - `xactions checkpoints pause <id>`
  - `xactions checkpoints retry <id>`
- **Then** each command uses the same business logic as the HTTP API.
- **And** `list` supports `--platform`, `--target-type`, `--status`, `--target-key`, `--limit`, `--offset`.
- **And** all commands print a concise human-readable summary; with `--json` they print JSON.

### AC8 — Status contract

- **Given** any checkpoint mutation
- **When** the response is returned
- **Then** `status` is one of the allowed values: `running`, `paused`, `failed`, `completed`, `stalled`.
- **And** the API returns ISO-8601 strings for `lastCrawledAt`, `nextScheduledAt`, `createdAt`, `updatedAt` (Express `res.json()` will serialize `Date` objects automatically; Prisma returns `Date` objects).

---

## Tasks / Subtasks

- [ ] **Task 1: Checkpoint service (AC: AC1–AC5)**
  - [ ] Create `src/store/checkpoint-manager.js` with pure business logic:
    - `listCheckpoints({ platform, targetType, targetKey, status, limit, offset, sortBy, order })`
    - `getCheckpoint(id)`
    - `resumeCheckpoint(id)`
    - `pauseCheckpoint(id)`
    - `retryCheckpoint(id)`
  - [ ] Use `api/lib/prisma.js` as the default `PrismaClient` and allow injection for tests.
  - [ ] Validate status transitions in code; throw `PlatformError` (`XACT_4002`, `invalid_state_transition`) for illegal transitions.
  - [ ] Return plain `PrismaCheckpoint` objects; do not add or remove fields.

- [ ] **Task 2: Authorization middleware (AC: AC6)**
  - [ ] Create or reuse an Express-compatible `requireCheckpointManage` middleware.
  - [ ] Support two auth surfaces:
    - JWT user (`api/middleware/auth.js` `authenticateToken`) → `req.user.isAdmin` grants access.
    - A2A agent (`src/a2a/auth.js` `createAuthMiddleware({ required: true })` + `checkPermission(req.agent, 'checkpoint:manage')`) grants access.
  - [ ] Return `401` if no identity is present, `403` if identity lacks permission.

- [ ] **Task 3: API routes (AC: AC1–AC6)**
  - [ ] Create `api/routes/checkpoints.js` as an Express `Router`.
  - [ ] Implement `GET /`, `GET /:id`, `POST /:id/resume`, `POST /:id/pause`, `POST /:id/retry`.
  - [ ] Mount the router in `api/server.js` as `app.use('/api/checkpoints', checkpointsRoutes)` in the feature-routes section (near `app.use('/api/datasets', datasetsRoutes)`).
  - [ ] Use the checkpoint service from Task 1 for all database access.

- [ ] **Task 4: CLI integration (AC: AC7)**
  - [ ] Add a `checkpoints` command group to `src/cli/index.js`.
  - [ ] Commands: `list`, `show <id>`, `resume <id>`, `pause <id>`, `retry <id>`.
  - [ ] `list` options: `--platform`, `--target-type`, `--status`, `--target-key`, `--limit`, `--offset`, `--json`.
  - [ ] Commands use `src/store/checkpoint-manager.js` and `api/lib/prisma.js`.
  - [ ] Disconnect Prisma in `finally` and set `process.exitCode = 1` on errors.

- [ ] **Task 5: Tests (AC: all)**
  - [ ] Create `tests/store/checkpoint-manager.test.js` — unit/integration tests with real DB:
    - seed `CrawlCheckpoint` rows using `prisma.crawlCheckpoint.create`.
    - test `listCheckpoints`, `getCheckpoint`, `resumeCheckpoint`, `pauseCheckpoint`, `retryCheckpoint`.
    - test status-transition guards.
    - clean up with `cleanupTestDatabase()` / `prisma.crawlCheckpoint.deleteMany`.
  - [ ] Create `tests/api/checkpoints-routes.test.js` — `supertest` integration tests:
    - seed a regular user, an admin user, and an A2A API key with `checkpoint:manage`.
    - test `GET /api/checkpoints` and `POST /api/checkpoints/:id/resume` with/without auth and with/without permission.
    - test 404 and 400 state-transition cases.
  - [ ] Create `tests/cli/checkpoints-cli.test.js` — optional, but at least test `list` and `resume` by invoking `src/cli/index.js` through the `program` export or by running the CLI script with `exec`.

---

## Current Implementation State

- The `CrawlCheckpoint` model exists in `prisma/schema.prisma` (lines 389–404) with fields `id`, `platform`, `targetType`, `targetKey`, `status`, `lastCursor`, `lastTimestamp`, `lastCrawledAt`, `nextScheduledAt`, `errorCount`, `createdAt`, `updatedAt`.
- `api/lib/prisma.js` provides a shared `PrismaClient` instance.
- `src/core/error-envelope.js` provides `PlatformError`, `ErrorTypes`, `SuggestedActions`.
- `tests/store/test-prisma-client.js` and `tests/api/fixtures/test-user.js` provide real-DB test helpers.
- No `CrawlCheckpoint` business logic, route, or CLI command exists yet.

---

## Developer Context

### Architecture Decisions Relevant to This Story

- **AD-4 — Namespaced PostgreSQL Storage via Prisma & JSONB GIN Indexing** (`ARCHITECTURE-SPINE.md`)
  - `CrawlCheckpoint` is a Prisma model with `@@unique([platform, targetType, targetKey])`.
  - `id` is `String @id @default(cuid())`; route param `:id` is this CUID.
- **AD-7 — Dual-Channel Microservice Protocol for Nowing** (`ARCHITECTURE-SPINE.md`)
  - Durability rule: every emitted event must be recorded in `CrawlCheckpoint` first. The operational API mutates this state, but it does not itself emit events.
- **AD-10 — 3-Tier Incremental Gap-Filling & Retention Policy** (`ARCHITECTURE-SPINE.md`)
  - Checkpoints store the last cursor/timestamp so crawlers can resume. `retry` must not clear `lastCursor` unless the operator explicitly asks for a full restart (out of scope for this story).
- **Epic 10 Decision Log, Section 2 — Checkpoint Authorization**
  - Who can pause/resume/retry: any identity with `checkpoint:manage` permission or `admin`.
  - Implementation uses `checkPermission(req.agent, 'checkpoint:manage')` for A2A identities and aligns with `src/a2a/auth.js`.

### Files to Read Before Modifying

1. `prisma/schema.prisma` — `CrawlCheckpoint` model (lines 389–404).
2. `api/lib/prisma.js` — shared `PrismaClient` instance and disconnect behavior.
3. `src/core/error-envelope.js` — `PlatformError` shape, `ErrorTypes`, `SuggestedActions`.
4. `src/a2a/auth.js` — `createAuthMiddleware`, `checkPermission`, `generateApiKey`, `validateApiKey`, `validateToken`.
5. `api/middleware/auth.js` — `authMiddleware`/`authenticateToken`, `requireAdmin`.
6. `api/server.js` — route mounting pattern (lines 309–361).
7. `api/routes/admin.js` — example of protected admin routes using `authenticateToken, requireAdmin`.
8. `api/routes/datasets.js` — example of a resource-centric route if available.
9. `src/cli/index.js` — command-group pattern (`dataset`, `stream`, `workflow`, etc.), `chalk`, `program` setup.
10. `tests/store/test-prisma-client.js` — real `PrismaClient` for tests and `cleanupTestDatabase`.
11. `tests/api/fixtures/test-user.js` — `seedTestUser`, `cleanupTestUser`, `makeTestToken`.
12. `tests/api/facebook-routes-integration.test.js` — `supertest` + `app` + auth token pattern.

### Code Conventions

- Pure ESM (`import`/`export`) only.
- License header: `// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.`
- JSDoc for public functions and `@typedef` for options.
- Throw `PlatformError` (not plain `Error`) for business-level errors such as invalid state transitions or missing resources.
- Never mock `PrismaClient` in tests; use the real `xactions_test` PostgreSQL database.
- Commit and push as `nirholas`.

---

## Technical Requirements

### Stack & Versions

- Node.js `>=18.0.0`
- `@prisma/client@^5.7.1`
- PostgreSQL 14+
- `express@^4.18.x` (already in `dependencies`)
- `commander` (already used by `src/cli/index.js`)
- `supertest` for route integration tests (already in `devDependencies`)

### Checkpoint Service API

```js
/**
 * @typedef {Object} ListCheckpointsOptions
 * @property {string} [platform]
 * @property {string} [targetType]
 * @property {string} [targetKey]
 * @property {string} [status]
 * @property {number} [limit]
 * @property {number} [offset]
 * @property {string} [sortBy]
 * @property {'asc'|'desc'} [order]
 */

export async function listCheckpoints(options = {}) { ... }
export async function getCheckpoint(id) { ... }
export async function resumeCheckpoint(id) { ... }
export async function pauseCheckpoint(id) { ... }
export async function retryCheckpoint(id) { ... }
```

### Status Transition Rules

| Current \ Action | resume | pause | retry |
|---|---|---|---|
| `running` | ❌ already running | ✅ paused | ❌ use pause/resume |
| `paused` | ✅ running | ❌ already paused | ✅ running |
| `failed` | ✅ running | ❌ | ✅ running, `errorCount=0` |
| `stalled` | ✅ running | ✅ paused | ✅ running, `errorCount=0` |
| `completed` | ❌ | ❌ | ❌ (operator must create a new checkpoint) |

Transition errors use:

```js
throw new PlatformError({
  type: ErrorTypes.INVALID_ARGS,
  code: 'XACT_4002',
  message: `Cannot ${action} checkpoint with status "${status}"`,
  statusCode: 400,
  suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
});
```

Not-found errors use:

```js
throw new PlatformError({
  type: ErrorTypes.INTERNAL,
  code: 'XACT_4041',
  message: `Checkpoint not found: ${id}`,
  statusCode: 404,
  suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
});
```

### Authorization Middleware

```js
// Pseudo-code for the combined middleware used by /api/checkpoints
export function requireCheckpointManage(req, res, next) {
  const isUserAdmin = req.user?.isAdmin === true;
  const isAgentAllowed = req.agent && checkPermission(req.agent, 'checkpoint:manage');

  if (!isUserAdmin && !isAgentAllowed) {
    return res.status(403).json({
      error: 'checkpoint:manage or admin permission required',
    });
  }
  next();
}
```

In the route file the middleware stack can be:

```js
import { authMiddleware as authenticateToken } from '../middleware/auth.js';
import { createAuthMiddleware, checkPermission } from '../../src/a2a/auth.js';

const optionalA2A = createAuthMiddleware({ required: false });
const requireCheckpoint = (req, res, next) => {
  if (req.user?.isAdmin || checkPermission(req.agent, 'checkpoint:manage')) return next();
  res.status(403).json({ error: 'checkpoint:manage or admin required' });
};

router.get('/', authenticateToken, optionalA2A, requireCheckpoint, listHandler);
```

> **Note:** The exact middleware helper can be placed in `api/middleware/auth.js` or inline in `api/routes/checkpoints.js`.

### Route Responses

All success responses wrap data in a `success: true` / `data` envelope to match existing API patterns:

```js
// GET /api/checkpoints
{
  success: true,
  data: {
    checkpoints: [...],
    total: 123,
    limit: 50,
    offset: 0,
  }
}

// GET /api/checkpoints/:id
{
  success: true,
  data: { checkpoint }
}

// POST /api/checkpoints/:id/resume
{
  success: true,
  data: { checkpoint }
}
```

Error responses wrap `success: false, error`:

```js
{
  success: false,
  error: {
    code: 'XACT_4002',
    message: 'Cannot resume checkpoint with status "running"',
  }
}
```

### CLI Commands

```bash
# List
xactions checkpoints list
xactions checkpoints list --platform twitter --status failed --limit 20
xactions checkpoints list --json

# Show
xactions checkpoints show <id>

# Control
xactions checkpoints resume <id>
xactions checkpoints pause <id>
xactions checkpoints retry <id>
```

CLI action pseudo-code:

```js
checkpointsCmd.command('resume <id>')
  .description('Resume a paused/failed/stalled checkpoint')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    const { default: prisma } = await import('../../api/lib/prisma.js');
    try {
      const { resumeCheckpoint } = await import('../../src/store/checkpoint-manager.js');
      const checkpoint = await resumeCheckpoint(id, { prisma });
      if (options.json) {
        console.log(JSON.stringify(checkpoint, null, 2));
      } else {
        console.log(chalk.green(`✅ Resumed checkpoint ${id}: status = ${checkpoint.status}`));
      }
    } catch (error) {
      console.error(chalk.red(`❌ ${error.message}`));
      process.exitCode = 1;
    } finally {
      try { await prisma.$disconnect(); } catch {}
    }
  });
```

---

## Architecture Compliance

- Hexagonal Architecture: keep database logic in `src/store/checkpoint-manager.js` (service), HTTP surface in `api/routes/checkpoints.js` (adapter), CLI surface in `src/cli/index.js` (adapter). Do not put business rules in routes or CLI.
- `src/core/` must remain free of external dependencies; checkpoint service lives in `src/store/` and imports `api/lib/prisma.js`, which is acceptable.
- Do not modify `prisma/schema.prisma` in this story; the `CrawlCheckpoint` model already exists.
- Reuse `PlatformError` and `ErrorTypes` from `src/core/error-envelope.js`.
- Support both existing auth surfaces (JWT user and A2A agent) to avoid creating a third auth system.

---

## File Structure & Reading Order

| File / Path | Purpose |
|---|---|
| `src/store/checkpoint-manager.js` | **New** — core checkpoint CRUD + state machine |
| `api/routes/checkpoints.js` | **New** — Express routes for `/api/checkpoints` |
| `api/server.js` | **Modify** — mount `checkpointsRoutes` at `/api/checkpoints` |
| `src/cli/index.js` | **Modify** — add `xactions checkpoints` command group |
| `types/checkpoint-manager.d.ts` | **New** — TypeScript declarations for the service (optional but recommended) |
| `types/index.d.ts` | **Modify** — export checkpoint types if created |
| `tests/store/checkpoint-manager.test.js` | **New** — real-DB service tests |
| `tests/api/checkpoints-routes.test.js` | **New** — `supertest` route integration tests |
| `tests/cli/checkpoints-cli.test.js` | **New** — optional CLI tests |
| `tests/store/test-prisma-client.js` | **Read** — shared test client |
| `tests/api/fixtures/test-user.js` | **Read** — test users and tokens |
| `prisma/schema.prisma` | **Read** — `CrawlCheckpoint` model |
| `api/lib/prisma.js` | **Read** — shared `PrismaClient` |
| `src/a2a/auth.js` | **Read** — A2A auth and `checkPermission` |

---

## Testing Requirements

### Environment

- Use the same test database setup as Story 10.2:
  ```bash
  DATABASE_URL_TEST='postgresql://luisphan@localhost:5432/xactions_test?schema=public'
  ```
  (or `DATABASE_URL` if `DATABASE_URL_TEST` is not set).
- Run `npx prisma db push` or `npx prisma migrate deploy` before tests if the `CrawlCheckpoint` table is missing.
- Clean seeded `CrawlCheckpoint` rows between tests with `prisma.crawlCheckpoint.deleteMany({})` or `cleanupTestDatabase()`.

### Service Tests (`tests/store/checkpoint-manager.test.js`)

- `listCheckpoints`:
  - returns all rows with default pagination.
  - filters by `platform`, `status`, `targetKey`.
  - caps `limit` to 500.
  - returns `total` count.
- `getCheckpoint`:
  - returns the correct row.
  - throws `PlatformError` with `statusCode 404` for unknown id.
- `resumeCheckpoint` / `pauseCheckpoint` / `retryCheckpoint`:
  - perform valid transitions and persist to DB.
  - reset `errorCount` on `retry`.
  - set `nextScheduledAt` on `resume` and `retry`.
  - clear `nextScheduledAt` on `pause`.
  - throw `XACT_4002` for invalid transitions.

### Route Tests (`tests/api/checkpoints-routes.test.js`)

- Seed an admin user and a regular user using `tests/api/fixtures/test-user.js`.
- Seed an A2A API key with `checkpoint:manage` using `src/a2a/auth.js` `generateApiKey`.
- Tests:
  - `GET /api/checkpoints` returns 401 without auth.
  - `GET /api/checkpoints` returns 403 for regular non-admin user.
  - `GET /api/checkpoints` returns 200 for admin user.
  - `GET /api/checkpoints` returns 200 for A2A API key with `checkpoint:manage`.
  - `POST /api/checkpoints/:id/resume` mutates status and returns updated checkpoint for allowed caller.
  - `POST /api/checkpoints/:id/resume` returns 400 for illegal transition.
  - `GET /api/checkpoints/:id` returns 404 for unknown id.

### CLI Tests (`tests/cli/checkpoints-cli.test.js`)

- `xactions checkpoints list` runs without error and prints checkpoints.
- `xactions checkpoints resume <id>` updates the checkpoint in the real DB.
- Prefer invoking the commander `program` directly (import `src/cli/index.js` and use `program.parseAsync([...])`) over spawning a subprocess.

### Verification Commands

```bash
npx vitest run tests/store/checkpoint-manager.test.js
npx vitest run tests/api/checkpoints-routes.test.js
npx vitest run tests/store tests/api   # regression with 10.2/10.3
```

---

## Previous Story Intelligence (Story 10.3)

- Real-DB tests are mandatory; do not mock `PrismaClient`.
- `cleanupTestDatabase()` truncates `Post` and `CrawlCheckpoint`; `Comment` rows are cascade-deleted.
- Cursor pagination uses `id` as the cursor and `crawledAt` as a secondary sort key.
- `PlatformError` should use `ErrorTypes.INVALID_ARGS` and `SuggestedActions.USE_ACTIONS_LIST` for client errors.
- `src/cli/index.js` uses `process.exitCode = 1` on errors and disconnects `prisma` in `finally`.

---

## Git Intelligence (Recent Commits)

- `95ce4b4` docs(story): mark Story 10.3 review findings resolved and status done
- `921debd` fix(story 10.3): apply code review patches — real DB tests, CLI, exporter hardening
- `308d66a` docs(story): validate and refine Story 10.3
- `47c16ae` docs(story): create Story 10.3 context and mark ready-for-dev
- Pattern: implementation artifacts live in `_bmad-output/implementation-artifacts/`; runtime code under `src/` and `api/`; tests under `tests/`.

---

## Latest Tech Information

- Prisma 5.x `findMany` with `take`/`skip` is the idiomatic pagination for PostgreSQL.
- Prisma returns `Date` objects; Express `res.json()` serializes them to ISO-8601 strings automatically.
- Express `Router` should be mounted with `app.use('/api/checkpoints', checkpointsRoutes)`.
- `commander` supports nested subcommands with `.command('sub <arg>')` and `.option(...)`.
- `supertest` is the project's existing integration test approach for HTTP routes.

---

## Project Context Reference

- Project: XActions
- Project key: XACT
- Repository: https://github.com/deptrai/XActions
- Tech: Node.js ESM, Prisma, PostgreSQL, Vitest, Express, Commander
- `package.json` engines: `node >=18.0.0`
- Architecture: Hexagonal + Tiered Hybrid Signer + Adaptive Rate Limiter

---

## Warnings & Potential Pitfalls

1. **Do not modify `prisma/schema.prisma` in this story.** The `CrawlCheckpoint` model already exists. If the table is missing in a fresh DB, run `npx prisma db push` or `npx prisma migrate deploy`.
2. **Do not clear `lastCursor` on `retry`.** Retry must continue gap-filling from the last known cursor. Full restart is out of scope.
3. **Do not put state-transition logic in routes or CLI.** Centralize it in `src/store/checkpoint-manager.js` so HTTP, CLI, and MCP can reuse it.
4. **Do not create a new auth system.** Use the existing JWT user (`api/middleware/auth.js`) and A2A agent (`src/a2a/auth.js`) surfaces.
5. **Do not return Prisma internals in error messages.** Use `PlatformError` with `code`, `message`, and `statusCode`.
6. **Do not forget to mount the router in `api/server.js`.** Without `app.use('/api/checkpoints', checkpointsRoutes)`, the endpoints will not exist.
7. **Do not mock Prisma in tests.** Use the real `xactions_test` database.
8. **Do not allow unbounded `limit`.** Cap at `500` and default to `50`.
9. **Do not leak `nextScheduledAt` details in CLI unless `--json`.** Keep human-readable output concise.
10. **Scope boundary:** This story is the checkpoint **control plane**, not the crawler execution engine. It does not schedule Bull jobs or run Puppeteer.

---

## Decisions Record

- `CrawlCheckpoint` is the source of truth for checkpoint state; the API and CLI are read/write surfaces only.
- `resume` sets `status=running` and `nextScheduledAt=now()` so the next crawler loop picks it up immediately.
- `pause` sets `status=paused` and `nextScheduledAt=null` to stop scheduling.
- `retry` resets `errorCount=0`, keeps `lastCursor`/`lastTimestamp`, and sets `status=running` + `nextScheduledAt=now()`.
- Authorization accepts either `req.user.isAdmin` (JWT) or `checkPermission(req.agent, 'checkpoint:manage')` (A2A) to satisfy both existing auth surfaces.
- `src/store/checkpoint-manager.js` is the canonical service module so business logic is shared between HTTP, CLI, and future MCP tools.
- The `CrawlCheckpoint` table is presumed to exist from Story 10.2; no schema changes in this story.

---

## Story Completion Status

- **Status:** `ready-for-dev`
- **Context engine analysis completed:** comprehensive developer guide created.
- **Dev implementation:** not started.
- **Code Review:** not started.

---

## Dev Agent Record

### Agent Model Used

- Context engine / `bmad-create-story`

### Debug Log References

- N/A (story creation)

### Completion Notes List

- Comprehensive context gathered from `epics.md`, `ARCHITECTURE-SPINE.md`, `EPIC10-DECISION-LOG-2026-08-18.md`, `prisma/schema.prisma`, `src/cli/index.js`, `api/server.js`, `src/a2a/auth.js`, and previous story files.
- Story file created and status set to `ready-for-dev`.

### File List

- `_bmad-output/implementation-artifacts/10-4-crawlcheckpoint-operational-api-resume-pause-retry.md` (New: this story file)

### Change Log

- **2026-08-19:** Created Story 10.4 context file and updated sprint status to `ready-for-dev`.
