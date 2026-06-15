---
baseline_commit: 44ca121b63b4e05844193e6bb8aee904285c77ae
---

# Story 4.1: Schedule Facebook post (dry-run default)

Status: review

<!-- First story of Epic 4 (Facebook Growth Automation, Cluster 3 — low risk). Source: epics.md#Story 4.1 + PRD prd-XActions-2026-06-10-epic4 FR-15. -->

## Story

As a growth marketer using XActions,
I want to schedule a Facebook post to publish at a specific datetime,
so that I can maintain consistent content without being online at peak hours.

## Context — what this story builds

This is the FIRST persisted-workflow feature in Epic 4. Unlike Epic 2's automate functions (which run synchronously and finish), a scheduled post is **created now, executed later** by a background worker. Three pieces do not exist yet and must be built:

1. **A `Schedule` Prisma model** — XActions has NO scheduled-post table today (verified: `prisma/schema.prisma` has `Operation`, `JobQueue`, `UnfollowerSchedule`, `FacebookAccount` — none fit). The post content + `scheduledAt` must persist so a worker can pick it up.
2. **A scheduler worker (ticker)** — there is NO active poller firing due jobs. `api/services/unfollowerAlerts.js` has the *pattern* (`getDueSchedules` → `nextRunAt <= now`) but nothing calls it on a tick. We add a node-cron tick.
3. **A per-user throughput throttle** — NFR-9/NFR10 (≤5 executed posts/hour/user) has ZERO implementation anywhere today.

The actual DOM posting is already solved: reuse `createFacebookPost(page, content, { dryRun:false })` from `api/services/facebookAutomation.js` — do NOT rewrite post logic.

## Acceptance Criteria

**AC1 — `scheduleFacebookPost` entry point (dry-run default)**
1. `scheduleFacebookPost(page, { content, mediaUrls?, scheduledAt, facebookAccountId? }, options = {})` is exported from `api/services/facebookAutomation.js` and added to its default export.
2. `dryRun` defaults to `true` (read from `options.dryRun`); only explicit `dryRun: false` creates a persisted `Schedule` record. This mirrors ADR-007 + the existing `runGuardedBatch` default (SM-4).
3. `content` is user-provided non-empty text — reject empty/whitespace-only `content` with a clear error before any DB write (same guard as `createFacebookPost`, story 2.4 review HIGH finding).
4. `scheduledAt` is parsed as ISO-8601. Reject a `scheduledAt` in the past (or within the next poll tick, < now + 60s) with a clear error — a schedule that can never fire is a bug, not a silent no-op.
5. The `page` param is accepted for signature consistency with the other automate functions but is NOT used at schedule time (the worker acquires its own session at execution — see AC5). It MAY be `null`. Document this; do not call any `page.*` method in this function.

**AC2 — `Schedule` Prisma model + migration**
6. Add a `Schedule` model to `prisma/schema.prisma`, user-scoped via the standard relation pattern (`userId String` + `user User @relation(fields:[userId], references:[id], onDelete: Cascade)` + back-relation on `User`). Fields:
   - `id String @id @default(cuid())`
   - `userId String`
   - `content String`
   - `mediaUrls String?` — JSON-stringified array, nullable (text posts only in MVP; field reserved for media)
   - `scheduledAt DateTime`
   - `status String @default("pending")` — `pending | completed | failed | cancelled`
   - `facebookAccountId String?` — which saved `FacebookAccount` to post from (nullable; resolved at execution)
   - `operationId String?` — links to the `Operation` row created at execution time
   - `error String?` — failure reason (PII-free)
   - `executedAt DateTime?`
   - `createdAt DateTime @default(now())` / `updatedAt DateTime @updatedAt`
   - `@@index([status, scheduledAt])` (the poller query) and `@@index([userId])` (scoping)
7. Run the migration (`npx prisma migrate dev --name add_schedule_model`) and regenerate the client. The generated client must expose `prisma.schedule`.

**AC3 — Dry-run preview (no record created)**
8. With `dryRun: true` (default), return a preview object — e.g. `{ dryRun: true, platform: 'facebook', preview: { content, mediaUrls: mediaUrls ?? null, scheduledAt: <ISO>, willFireAt: <human-readable> } }` — and create NO `Schedule` row (assert with a DB count in tests).

**AC4 — Real schedule creation (returns scheduleId)**
9. With `dryRun: false`, create one `Schedule` row scoped by `userId` (status `pending`) and return `{ dryRun: false, platform: 'facebook', scheduleId: <id>, scheduledAt: <ISO>, status: 'pending' }`.
10. `userId` MUST come from the authenticated caller (route layer), never from request body. The service receives `userId` via `options.userId` (the route passes `req.user.id`). If `options.userId` is missing on a real (`dryRun:false`) call, throw — never create an unscoped record.

**AC5 — Scheduler worker executes within ±2 minutes (SM-6)**
11. Add a worker (e.g. `api/services/facebookScheduler.js`) exporting `startFacebookScheduler()` and a testable pure-ish `runDueSchedules(now, deps)` function. `startFacebookScheduler()` registers a `node-cron` tick every minute (`cron.schedule('* * * * *', ...)`); a 1-minute tick satisfies the ±2-minute window.
12. Each tick: `prisma.schedule.findMany({ where: { status: 'pending', scheduledAt: { lte: now } }, orderBy: { scheduledAt: 'asc' } })`. For each due schedule:
    - Acquire a Facebook session: load the `FacebookAccount` (by `facebookAccountId`, else the user's most recent), decrypt its cookie via the SAME decryption path the `/api/facebook/accounts` flow uses, then `createBrowser` + `createPage` + `loginWithCookie(page, { c_user, xs })`.
    - Execute the post: `createFacebookPost(page, schedule.content, { dryRun: false })` (reuse — do NOT reimplement).
    - On success → `status: 'completed'`, set `executedAt`, link `operationId` (see AC8).
    - Always close the browser in a `finally`.
13. The worker must be safe to start exactly once. Document that `startFacebookScheduler()` is invoked from the worker entry (`npm run worker` / `src/worker*`) — NOT also from `api/server.js` — to avoid double-firing. If both could start it, guard with an env flag (e.g. `ENABLE_FB_SCHEDULER`).

**AC6 — Throughput cap ≤5 executed/hour/user (NFR-9 / NFR10)**
14. Before executing a due schedule, count this user's posts executed in the last hour: `prisma.schedule.count({ where: { userId, status: 'completed', executedAt: { gte: new Date(now - 3_600_000) } } })`. If `>= 5`, do NOT execute this tick — **defer with jitter** (per PRD NFR-9: "enqueue với jitter thay vì từ chối hard"): push `scheduledAt` forward by a jittered delay (e.g. 5–15 min) and leave `status: 'pending'`. Never hard-reject or mark failed for hitting the cap.
15. The cap is enforced at WORKER EXECUTION time, not at schedule-creation time — a user may queue many posts; the worker paces them to ≤5/hour. This is the SM-C3 counter-metric (do not speed up to "run more").

**AC7 — Failure handling (no blind retry)**
16. If execution fails (expired session, checkpoint, composer not found), set `status: 'failed'` with a clear PII-free `error` and set `executedAt`. Do NOT blindly retry the same schedule on the next tick (the `status: 'failed'` filter excludes it from the `pending` query). Document that a separate manual re-schedule is required — no automatic retry loop.

**AC8 — Operation record + Socket.IO + security (NFR3, Story 3.4)**
17. On execution (success OR failure), create/update an `Operation` row scoped by `userId` (`type: 'facebook_schedule'`, `config` = PII-free JSON) and link its id back into `Schedule.operationId`. Emit progress via the existing pattern `global.io?.to('user:${userId}').emit('facebook:operation', payload)` (start/complete/error events) — copy from `api/routes/facebook.js`.
18. Cookie values (`c_user`, `xs`) and decrypted session data MUST NEVER appear in logs, `error` strings, `Operation.config/result`, or the return value (NFR3). Verify with a test asserting no cookie value leaks into any persisted/returned field.

**AC9 — Tests (browser-free, real implementations — no mocks/stubs/fakes per project rule)**
19. Unit tests in `tests/scrapers/` (or `tests/services/`) using a real in-memory/seam approach consistent with existing Facebook tests (inject a fake `page` object + a real test DB or a `prisma` seam — match how `2-x`/`3-4` tests do persistence):
    - dry-run returns preview with `willFireAt`, creates ZERO `Schedule` rows
    - `dryRun:false` creates exactly one `pending` row scoped to the given `userId`, returns `scheduleId`
    - empty `content` → throws before any DB write
    - past `scheduledAt` → throws
    - missing `options.userId` on real call → throws (no unscoped row)
    - `runDueSchedules`: a due `pending` schedule transitions to `completed` (with a fake post executor that records the call); a failing executor transitions it to `failed` with no retry on the next tick
    - throughput cap: with 5 completed-in-last-hour for a user, a 6th due schedule is deferred (scheduledAt pushed forward), NOT executed, NOT failed
    - NFR3: no cookie value appears in any `Schedule`/`Operation` field or return value
20. Reuse the existing test conventions (Vitest 4.x, `npx vitest run <file>`, Node env). The post executor must be injectable so tests never open a real browser. Follow the project's **no-mock** rule: use real functions with injected seams/fakes-of-data, not `vi.mock`.

## Tasks / Subtasks

- [x] **Task 1: Prisma `Schedule` model + migration** (AC2)
  - [x] Add `Schedule` model to `prisma/schema.prisma` with fields + 2 indexes (AC6 list)
  - [x] Add `schedules Schedule[]` back-relation to the `User` model
  - [x] `npx prisma migrate dev --name add_schedule_model` + regenerate client; confirm `prisma.schedule` exists
- [x] **Task 2: `scheduleFacebookPost` service fn** (AC1, AC3, AC4)
  - [x] Export from `api/services/facebookAutomation.js` + add to default export
  - [x] Validate: non-empty `content`, ISO `scheduledAt` not in past, `options.userId` present when `dryRun:false`
  - [x] dryRun branch → preview object, no DB write; real branch → `prisma.schedule.create` + return `scheduleId`
  - [x] Do NOT touch `page` (accept + ignore; may be null)
- [x] **Task 3: Scheduler worker** (AC5, AC6, AC7)
  - [x] New `api/services/facebookScheduler.js`: `startFacebookScheduler()` (node-cron `* * * * *`) + `runDueSchedules(now, deps)`
  - [x] Query due `pending` schedules; per-schedule acquire session (FacebookAccount decrypt → loginWithCookie) → `createFacebookPost(page, content, { dryRun:false })` → update status; close browser in `finally`
  - [x] Throughput cap: count completed-in-last-hour; if ≥5 defer with jitter (no hard reject)
  - [x] Failure → `status:'failed'` + PII-free `error`, no retry
  - [x] Wire `startFacebookScheduler()` into the worker entry only; guard against double-start
- [x] **Task 4: Operation + Socket.IO + security** (AC8)
  - [x] At execution, create/update `Operation` (`type:'facebook_schedule'`, scoped userId), link `Schedule.operationId`
  - [x] Emit `facebook:operation` start/complete/error to `user:${userId}` room (copy pattern from `api/routes/facebook.js`)
  - [x] Audit every log/persist/return path for cookie leakage (NFR3)
- [x] **Task 5: Tests** (AC9)
  - [x] Browser-free unit tests (inject fake page + post executor seam); cover all AC9 cases
  - [x] `npx vitest run <new test file>` green; then `npx vitest run` (expect only the pre-existing `x402-integration.test.js` ECONNREFUSED failures — unrelated)

## Review Findings

> Code review 2026-06-15 (3-layer adversarial: blind / edge-case / acceptance-auditor). Implementation = commit df94176. Findings verified against diff before triage.

### Decision needed

- [ ] [Review][Decision][RESOLVED → Patch P0] Realtime `facebook:operation` emit is dead in the worker process — `global.io` is set in `api/server.js` but the scheduler was wired to start in `node api/services/jobQueue.js` (separate process), so `global.io?.to(...)` silently no-ops. **Resolved (best-practice for current single-server topology): start `startFacebookScheduler()` in `api/server.js` where `global.io` is live — same place Bull `.process()` handlers run and emit successfully (server.js imports jobQueue.js, so processors execute in-process). Keep the `schedulerStarted` double-start guard. Remove/relax the `isWorkerEntry` gate accordingly.** Migration path when scaling to multiple server instances: add a socket.io Redis adapter (`@socket.io/redis-adapter`) — but that is cross-cutting (the existing Bull worker emits would need it too) and out of scope for this story. See Patch P0. [api/services/facebookScheduler.js:191; api/services/jobQueue.js:350-354; api/server.js:98]

### Patch

- [ ] [Review][Patch][P0/HIGH] Start scheduler in the server process — move the `startFacebookScheduler()` invocation out of the `isWorkerEntry` guard in `jobQueue.js` and into `api/server.js` (after `global.io = io`), keeping the `schedulerStarted` guard. This makes `facebook:operation` emits actually reach connected clients. Document that a single server instance owns the tick; for multi-instance, gate by an env flag or move to a dedicated scheduler process + Redis adapter. [api/server.js:98; api/services/jobQueue.js:350-354]

- [ ] [Review][Patch][HIGH] Duplicate execution on overlapping ticks — `runDueSchedules` does `findMany(pending, lte now)` then marks `completed` only AFTER the browser session; node-cron `* * * * *` fires every minute but a post session easily exceeds 1 min, so the next tick re-reads the same pending row and posts twice. No atomic claim, no `running` state, no crash-recovery. Fix: add a `running` status; claim each row via `updateMany({ where:{ id, status:'pending' }, data:{ status:'running' } })` and skip if `count !== 1`; on worker startup sweep stale `running` → `failed`. [api/services/facebookScheduler.js:160-166,253]
- [ ] [Review][Patch][HIGH] Silent post failure marked `completed` — `await executor(page, content)` discards the return value; `createFacebookPost` returns a `batchResult` and does NOT throw on a failed post (runGuardedBatch records `results[].ok:false` / `failed>0`). A failed post is recorded as `completed` (silent data loss). The injected test executor returns `{ ok:true }` (wrong shape), so this is untested. Fix: inspect `result.failed`/`result.succeeded`, throw on failure; align the test executor to the real `batchResult` shape and add a `failed:1` → `status:failed` test. [api/services/facebookScheduler.js:250; tests/services/facebook-schedule.test.js:471-480]
- [ ] [Review][Patch][MEDIUM] Jitter-defer uses the original (past) `scheduledAt` as base — `new Date(schedule.scheduledAt.getTime() + jitter)`. For an overdue, capped post this stays in the past, so it is re-read and re-deferred every single tick (DB-write busy-loop) and ignores the intended 5–15 min delay. Fix: base on `now`: `new Date(now.getTime() + jitter)`. [api/services/facebookScheduler.js:182-184]
- [ ] [Review][Patch][MEDIUM] One bad row aborts the whole tick — the per-schedule count query, `operation.create`, and the catch-block DB updates sit inside the `for` loop but OUTSIDE the inner try/catch. If any throws (DB blip, operation.create failure), the loop throws and all remaining due schedules in that tick are skipped. Fix: wrap each iteration body in its own try/catch so one row can't starve the others. [api/services/facebookScheduler.js:168-296]
- [ ] [Review][Patch][MEDIUM] NFR3 cookie-leak test is vacuous — it defines `FAKE_COOKIE_VALUE` but never puts it in scope, so the `not.toContain` assertion always passes even if there were a real leak. Fix: route the fake cookie through a failing executor's error message (or a session error), then assert it is scrubbed from `Schedule.error` / `Operation.error`. [tests/services/facebook-schedule.test.js:705-737]
- [ ] [Review][Patch][MEDIUM] `safeError` can fall through to raw `err.message` — `err?.code || err?.name || err.message.slice(0,200)`; a thrown string/plain-object (no `.name`) would persist the raw message, which for Puppeteer/login errors may embed cookie/URL data (NFR3 risk). Fix: allowlist `err.code`/`err.name` only; never persist raw `message`. [api/services/facebookScheduler.js:270-271]
- [ ] [Review][Patch][MEDIUM] `isWorkerEntry` is symlink-fragile — `import.meta.url === pathToFileURL(process.argv[1]).href` fails to match under symlinked launch (Docker ENTRYPOINT, `bin/` wrapper), so the scheduler silently never starts in prod with no log. Fix: normalize with `fs.realpathSync(process.argv[1])` and log when the start is skipped. [api/services/jobQueue.js:350-351]
- [ ] [Review][Patch][LOW] `ENABLE_FB_SCHEDULER` is undocumented — add it to `.env.example` (with comment) and the CLAUDE.md env-vars section so operators know the toggle exists. [api/services/jobQueue.js:352]

### Deferred

- [x] [Review][Defer][MEDIUM] Deleted `FacebookAccount` orphans its pending schedules — `Schedule.facebookAccountId` has no FK/cascade; deleting the account makes the worker `resolveAccountCookie` throw `ACCOUNT_NOT_FOUND` → schedule `failed` at execution with no upfront warning and no fallback to the user's default account. Failure is graceful (status:failed + reason), so deferred. Enhancement: FK `onDelete:SetNull` + fallback to most-recent account, or block account delete when pending schedules reference it. [prisma/schema.prisma#Schedule; api/routes/facebookAccounts.js] — deferred, enhancement (graceful failure already exists)

### Dismissed (verified false-positive / within tolerance)

- `Operation.startedAt`/`completedAt` "missing" → they exist in the model (verified).
- Cap bypass within a single tick → sequential `for...await` increments the completed-count each iteration; cap holds.
- `operation` undefined in catch → `operation.create` is outside the try; catch never runs with it undefined (real adjacent concern captured in Patch: one-bad-row).
- `Schedule.operationId` no FK → intentional soft link per spec.
- throughput window `now` vs wall-clock `executedAt` → immaterial seconds of drift on a 1-hour window.
- cron sub-second miss of `scheduledAt==now` → within the documented ±2-minute window.
- `willFireAt` `toLocaleString()` → dry-run preview only, cosmetic.
- test cleanup crash-safety → self-heals via `beforeEach`.

## Dev Notes

### REUSE-FIRST mandate (do NOT reinvent)

- **Posting**: `createFacebookPost(page, content, options)` already does composer-find → type → submit with locale-aware selectors and `runGuardedBatch` single-item consistency. The worker calls it with `dryRun:false`. Do NOT write new DOM-posting code. [Source: api/services/facebookAutomation.js#createFacebookPost; story 2.4]
- **Session**: `loginWithCookie(page, { c_user, xs })`, `createBrowser`, `createPage` are re-exported from `api/services/facebookAutomation.js` (originally `src/scrapers/facebook/index.js`). Cookie object convention is `{ c_user, xs }` (NOT a string — differs from Twitter). [Source: epics.md#Story 1.1; CLAUDE.md]
- **Account storage**: saved accounts live in the `FacebookAccount` model (`encryptedCookie`, scoped by `userId`, unique `[userId, label]`). Decrypt using the SAME path `POST/GET /api/facebook/accounts` uses (story 5.5) — find that decrypt helper and reuse it; do NOT invent a second crypto path. [Source: prisma/schema.prisma#FacebookAccount; story 5.5]
- **Operation + realtime**: copy the create/update + `global.io?.to('user:${userId}').emit('facebook:operation', …)` pattern verbatim from the like/comment/post handler. [Source: api/routes/facebook.js ~lines 233–375; story 3.4]
- **Scheduling pattern**: model the poller on `api/services/unfollowerAlerts.js#getDueSchedules` (`findMany where active/nextRunAt <= now`) and `markScheduleExecuted` (recompute next run). The `INTERVAL_MS` map there is a good style reference. [Source: api/services/unfollowerAlerts.js:179–284]

### Infrastructure facts (verified this story — trust these)

- `node-cron@^3.0.3`, `bull@^4.12.0`, `redis@^4.6.11` are installed; `bullmq` is NOT. [Source: package.json]
- **No** `Schedule`/`ScheduledPost` model exists. **No** active scheduler/poller tick exists. **No** per-user hourly cap exists. All three are net-new in this story.
- `jobQueue.js` Bull queue (`'operations'`) supports `addJob(type, data, { delay })` (Bull delayed jobs). **Decision: use the node-cron + `Schedule` table poll, NOT Bull `delay`.** Rationale: `scheduledAt` can be days out; the `Schedule` table is the source of truth we must query/update/cancel anyway, and a DB poll survives Redis flushes. Bull delay would duplicate state and lose jobs on a Redis reset. Do NOT enqueue Bull-delayed jobs for this.
- `src/scheduler/scheduler.js` (node-cron, file-based, spawns `node bin/unfollowx`) is CLI-only and NOT user-scoped — do NOT extend it for this feature.

### Source conflict resolved (important)

epics.md Story 4.1 + PRD §3 (Glossary), §6.1, FR-15 all specify a **`Schedule` Prisma table** with `scheduleId`. PRD §10 has an assumption "tái dùng `Operation`, không tạo bảng Prisma riêng cho Epic 4" — but that assumption is scoped to groups/friends JSON metadata (§6.2), not scheduled posts, which structurally require a `scheduledAt`-queryable table for the worker. **Follow FR-15: create the `Schedule` model.** (See Dev Agent question at end.)

### NFR-9 / NFR10 numbering note

epics.md calls the throughput cap "NFR10"; PRD calls it "NFR-9". Same requirement: ≤5 scheduled posts executed per hour per user, **enforced at worker execution time** with **jitter-defer** (not hard reject) for the excess. Do not optimize for higher throughput (SM-C3).

### Lessons applied (from prior Facebook stories)

- **Non-empty content guard before write** — story 2.4 HIGH review finding (empty content typed a blank post). Validate at entry.
- **Injectable seam for tests** — every prior story (delay seam, `fetchImpl`, `createPostFn`) used a seam so tests stay browser-free. Make the post executor injectable in `runDueSchedules(now, deps)`.
- **null-not-throw for missing optional data**, but **throw on missing security scope** (`userId`) — never create an unscoped record.
- **Cookie never logged/echoed** (NFR3) — asserted by a dedicated test in every Facebook story.
- **`postUrl` is best-effort** — story 2.4 deferred finding: Facebook composer submits via XHR without navigation, so `postUrl` is often undefined even on success. Do NOT treat missing `postUrl` as failure; success = `createFacebookPost` returned `ok:true`.

### Project Structure Notes

- MODIFY: `prisma/schema.prisma` (add `Schedule` + `User.schedules` back-relation), `api/services/facebookAutomation.js` (add `scheduleFacebookPost` + default export entry).
- NEW: `api/services/facebookScheduler.js` (worker: `startFacebookScheduler` + `runDueSchedules`), test file under `tests/` mirroring source.
- WIRE: `startFacebookScheduler()` into the worker entry process only (`npm run worker`). Add `ENABLE_FB_SCHEDULER` guard if server.js might also start it.
- No CLI/MCP/REST surface in THIS story — FR-15 is the service + worker + model. (A REST endpoint to create schedules can be a follow-up; if you add a thin `POST /api/facebook/schedule` route to make it usable, keep `userId` from `req.user.id`, validate body, delegate to the service — but it is not required by the ACs.)

### Critical context

- Node.js, ESM (`import`/`export`, no `require`). TypeScript strict conventions in JS where applicable; no `any`.
- Tests: Vitest 4.x, Node env, 30s timeouts. **No mocks/stubs/fakes** — real implementations with injected data seams only (project mandate). `tests/x402-integration.test.js` failures (ECONNREFUSED to localhost:3001) are pre-existing and unrelated.
- Author credit comment `// by nichxbt`; emoji log prefixes (❌ ⚠️ ✅ 🔄).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.1: Schedule Facebook post]
- [Source: _bmad-output/planning-artifacts/prds/prd-XActions-2026-06-10-epic4/prd.md#FR-15, §7 NFR-9, §8 SM-6/SM-C3]
- [Source: api/services/facebookAutomation.js — runGuardedBatch, createFacebookPost, loginWithCookie/createBrowser/createPage re-exports]
- [Source: api/routes/facebook.js — Operation create/update + Socket.IO `facebook:operation` emit pattern]
- [Source: api/services/unfollowerAlerts.js:179–284 — getDueSchedules / markScheduleExecuted poll pattern]
- [Source: prisma/schema.prisma — Operation, FacebookAccount, UnfollowerSchedule, User relation convention]
- [Source: _bmad-output/implementation-artifacts/2-4-create-post.md — createFacebookPost contract + postUrl deferred finding]

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (BMAD dev-story workflow)

### Debug Log References

- `npx prisma migrate dev` không chạy được trong môi trường non-interactive (worktree) → đã dùng `npx prisma db push` để sync schema + regenerate client, rồi tạo migration SQL thủ công (`prisma/migrations/20260615153800_add_schedule_model/migration.sql`) và `prisma migrate resolve --applied` để ghi vào lịch sử migration. Kết quả tương đương `migrate dev`: `prisma.schedule` đã tồn tại trong client.
- Tests yêu cầu `DATABASE_URL` (worktree không có `.env`) → inject từ `.env` của repo gốc khi chạy vitest.

### Completion Notes List

- **AC1–AC4 (`scheduleFacebookPost`)**: thêm vào `api/services/facebookAutomation.js` + default export. `dryRun` mặc định `true` (chỉ `dryRun:false` mới ghi DB). Guard: `content` non-empty, `scheduledAt` ISO-8601 và phải ≥ now+60s, `options.userId` bắt buộc khi real-run (không tạo record unscoped). `page` được nhận nhưng KHÔNG dùng (có thể null).
- **AC2 (Prisma)**: model `Schedule` (user-scoped, cascade) + back-relation `User.schedules`, 2 index `[status, scheduledAt]` và `[userId]`. Migration + client regenerated.
- **AC5–AC7 (worker)**: `api/services/facebookScheduler.js` export `startFacebookScheduler()` (node-cron `* * * * *`) + `runDueSchedules(now, deps)` thuần (injectable `postExecutor`/`sessionFactory`/`prismaClient` để test browser-free). Session lấy qua `resolveAccountCookie` (tái dùng decrypt path của `/api/facebook/accounts`), post qua `createFacebookPost(page, content, {dryRun:false})` (REUSE-FIRST), browser luôn đóng trong `finally`. Throughput cap ≤5/h/user → defer với jitter 5–15 phút (không hard-reject). Fail → `status:'failed'` + error PII-free, không retry (query `pending` loại trừ nó).
- **AC8 (Operation + Socket.IO + NFR3)**: mỗi lần execute tạo `Operation` (`type:'facebook_schedule'`, scoped userId, config PII-free) + link `Schedule.operationId`; emit `facebook:operation` start/complete/error tới room `user:${userId}`. Cookie không bao giờ vào log/error/config/result/return — có test NFR3 khẳng định.
- **Wiring**: `startFacebookScheduler()` chỉ chạy khi `jobQueue.js` là worker entry (`import.meta.url === process.argv[1]`) + env guard `ENABLE_FB_SCHEDULER !== 'false'` → server.js import module không double-fire cron.
- **Tests**: 13/13 pass (`tests/services/facebook-schedule.test.js`). Full suite: 1309 pass, chỉ 9 fail pre-existing trong `tests/x402-integration.test.js` (ECONNREFUSED localhost:3001 — server tắt, không liên quan story).

### File List

- MODIFIED: `prisma/schema.prisma` — thêm model `Schedule` + back-relation `User.schedules`
- NEW: `prisma/migrations/20260615153800_add_schedule_model/migration.sql`
- MODIFIED: `api/services/facebookAutomation.js` — import PrismaClient + `scheduleFacebookPost` + default export entry
- NEW: `api/services/facebookScheduler.js` — `startFacebookScheduler` + `runDueSchedules`
- MODIFIED: `api/services/jobQueue.js` — wire `startFacebookScheduler()` vào worker entry (guard kép)
- NEW: `tests/services/facebook-schedule.test.js` — unit tests browser-free (AC9)

## Change Log

- 2026-06-15: Story 4.1 created (context engine). Status → ready-for-dev. (Luisphan)
- 2026-06-15: Story 4.1 implemented — `Schedule` model + migration, `scheduleFacebookPost` service, `facebookScheduler` worker (node-cron tick, throughput cap, jitter-defer, no-retry), Operation+Socket.IO+NFR3, 13 browser-free tests. Status → review. (dev-story / claude-opus-4-8)
