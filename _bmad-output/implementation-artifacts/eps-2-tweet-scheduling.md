---
baseline_commit: 93cd971d50d6d83d14a22a30cda55ea2aac7ca20
epic: EPS-2
---

# Story EPS-2: Tweet Scheduling (Q1 HIGH)

Status: done

## Implementation log

- **Schema + migration**: `Schedule` extended with `platform`, `thread`, `timezone`, `recurrenceCron`, `queueOrder` + `@@index([platform, status, scheduledAt])`. Migration `20260630160000_add_schedule_platform_fields` backfills existing rows to `platform: 'facebook'`. Applied (`prisma migrate status` → up to date).
- **`scheduleTweet`** (`api/services/tweetScheduling.js`): dry-run default, content/soon/past guards, thread (1–24 follow-ups) validation, IANA timezone validation + wall-clock→UTC parsing, `node-cron.validate` recurrence, `queueOrder`. Real run persists one `platform: 'twitter'` pending row scoped by `userId`.
- **Worker** (`api/services/tweetScheduler.js`): `runDueTweets` + `startTweetScheduler` + `sweepStaleRunningTweets`. 1-min node-cron tick, per-user ≤5 completed/hour cap (twitter-only count) with 5–15min jitter deferral off `now`, atomic `pending→running` claim via `updateMany` count, reuses `postTweet`/`postThread` from `src/postComposer.js`, PII-free `safeErrorString`, Operation linkage (`type: 'tweet_schedule'`), recurring re-arm via `nextRecurrenceAt`, stale-running sweep on startup.
- **REST API** (`api/routes/tweetSchedule.js`): `POST/GET/DELETE /api/tweet-schedule` + `PATCH /reorder`, all auth-scoped to `req.user.id` (body `userId` never trusted).
- **Server wiring** (`api/server.js`): route mounted + `startTweetScheduler()` started behind `ENABLE_TWEET_SCHEDULER` env guard.
- **CLI** (`src/cli/index.js`): `schedule create --content --at [--thread] [--tz] [--recur] [--dry-run]`, `schedule list [--status]`, `schedule cancel <id>`.
- **MCP** (`src/mcp/server.js`): `x_schedule` tool (DB-backed, dry-run default) added; `x_schedule_post` kept but marked deprecated.
- **Dashboard** (`dashboard/calendar.html`): API-backed calendar + drag & drop queue view (`PATCH /reorder`), localStorage fallback when unauthenticated.
- **Tests** (`tests/services/tweet-schedule.test.js`): 29 tests, all green. Covers dry-run default, real-run persistence, empty/past/soon guards, thread/timezone/recurrence/queueOrder validation, throughput cap deferral, platform isolation (facebook rows don't count/invoke), atomic claim (concurrent ticks → 1 exec), failed-result-not-completed, throwing executor → failed, Operation linkage, PII-free error path, recurrence re-arm, queueOrder ordering, stale-running sweep. No mocks/stubs/fakes — injects `postExecutor` + `sessionFactory` deps.
- **Bug fixed during testing**: `parseScheduledAt` tz offset sign was inverted (returned 10:00 UTC for "09:00 Europe/London" instead of 08:00 UTC). Corrected to standard east-positive offset (`tzWallMs - probeMs`) and `probeMs - offsetMs`.

## Story

As a growth marketer using XActions,
I want to schedule tweets (and threads) to publish at a specific datetime with a queue view, recurring support, and timezone awareness,
so that I can maintain a consistent posting cadence without being online at peak hours — without paying for X Premium's native scheduling.

## Context — what this story builds

XActions already has a robust **Facebook** scheduler (`api/services/facebookScheduler.js` + `scheduleFacebookPost` in `api/services/facebookAutomation.js`) that persists to the `Schedule` Prisma model, runs a 1-minute node-cron tick, enforces ≤5 executed/hour/user (NFR-9/NFR10) with jitter deferral, atomically claims rows (pending→running), sweeps stale `running` rows on startup, and emits PII-free Socket.IO operation events. The `Schedule` model already exists but is Facebook-scoped (`facebookAccountId`).

This story mirrors that proven pattern for **Twitter/X** tweets and threads, reusing the same `Schedule` table via a new `platform` discriminator, and reusing the existing `postTweet` / `postThread` browser automation in `src/postComposer.js` for execution. It also wires up the CLI, MCP, REST API, and dashboard surfaces that the issue scope requires.

### Reuse-first decisions

- **Persistence**: extend the existing `Schedule` model with a `platform` field (`twitter` | `facebook`, default `twitter`) + tweet-specific optional fields (`thread` JSON, `timezone`, `recurrenceCron`, `queueOrder`). One table, two platforms — avoids a parallel schema and lets the throughput cap (per user) cover both surfaces uniformly.
- **Execution**: reuse `postTweet` / `postThread` from `src/postComposer.js` — do NOT rewrite tweet posting DOM logic.
- **Worker pattern**: clone `facebookScheduler.js`'s `runDueSchedules` / `startFacebookScheduler` / `sweepStaleRunning` shape into `tweetScheduler.js`, filtered by `platform: 'twitter'`.
- **Create entry point**: clone `scheduleFacebookPost`'s validation + dry-run gate into `scheduleTweet` (in a new `api/services/tweetScheduling.js`).
- **PII safety**: mirror `safeErrorString` (allowlist err.code/err.name only) — Puppeteer errors on x.com can embed session cookie values.

## Acceptance Criteria

**AC1 — `scheduleTweet` entry point (dry-run default)**
1. `scheduleTweet({ content, mediaUrls?, scheduledAt, thread?, timezone?, recurrenceCron? }, options = {})` is exported from `api/services/tweetScheduling.js`.
2. `dryRun` defaults to `true` (from `options.dryRun`); only explicit `dryRun: false` creates a persisted `Schedule` row (mirrors ADR-007 + `scheduleFacebookPost`).
3. `content` non-empty guard; `scheduledAt` ISO-8601 + ≥60s-in-future guard (same as `scheduleFacebookPost`).
4. `thread` (optional array of strings) validates length 2–25 and non-empty entries; when present, `content` is the first tweet and `thread` holds the replies.
5. `timezone` (optional IANA name) is validated against `Intl.supportedValuesOf('timeZone')`; `scheduledAt` is interpreted in that tz then stored as UTC.
6. `recurrenceCron` (optional) validated with `node-cron.validate`; stored on the row so the worker re-arms after execution.

**AC2 — `Schedule` model extension + migration**
7. Add `platform String @default("twitter")`, `thread String?` (JSON), `timezone String?`, `recurrenceCron String?`, `queueOrder Int @default(0)` to `Schedule`. Add `@@index([platform, status, scheduledAt])`. Backfill existing rows to `platform: 'facebook'`.
8. Migration `add_schedule_platform_fields` applied; `npx prisma generate` regenerates the client.

**AC3 — Dry-run preview**
9. `dryRun: true` returns `{ dryRun: true, platform: 'twitter', preview: { content, thread, mediaUrls, scheduledAt: <ISO>, timezone, recurrenceCron, willFireAt } }` and creates NO row.

**AC4 — Real schedule creation**
10. `dryRun: false` + `options.userId` creates one `Schedule` row (`platform: 'twitter'`, status `pending`) and returns `{ dryRun: false, platform: 'twitter', scheduleId, scheduledAt, status: 'pending' }`. Missing `userId` on a real run throws.

**AC5 — Scheduler worker (±2min SLA, NFR10 throughput, atomic claim)**
11. `api/services/tweetScheduler.js` exports `runDueTweets(now, deps)` and `startTweetScheduler()`. The worker queries `Schedule` where `platform: 'twitter'`, `status: 'pending'`, `scheduledAt <= now`, ordered by `queueOrder` then `scheduledAt`.
12. Per-user throughput cap ≤5 completed/hour (window 3_600_000ms); on cap hit, defer `scheduledAt` by jitter 5–15min from `now` (NOT from original `scheduledAt` — avoids busy-loop on overdue rows). Never hard-reject.
13. Atomic claim `pending → running` via `updateMany` count check (prevents double-exec on overlapping ticks).
14. Execution: acquire a Puppeteer page authenticated with the user's `sessionCookie` (reuse the existing scraper login flow), call `postTweet` (single) or `postThread` (thread). Inspect result — a non-throwing failure (`success: false`) marks the row `failed`, not `completed`.
15. On success: `status: completed`, `executedAt`, link an `Operation` row (`type: 'tweet_schedule'`). On failure: `status: failed`, PII-free `error`. Always close the browser.
16. `sweepStaleRunningTweets()` marks pre-existing `running` rows `failed` (`error: 'interrupted'`) on startup — no blind retry.
17. `startTweetScheduler()` registers a `* * * * *` node-cron tick, guarded to start once.

**AC6 — REST API (`api/routes/tweetSchedule.js`)**
18. `POST /api/tweet-schedule` — create (dry-run default; `dryRun:false` + auth user persists). Validates body.
19. `GET /api/tweet-schedule` — list the caller's schedules (optional `status` filter), ordered by `queueOrder` then `scheduledAt`.
20. `DELETE /api/tweet-schedule/:id` — cancel: `pending → cancelled` (only pending rows; running/completed rows are 409).
21. `PATCH /api/tweet-schedule/reorder` — accept `[{ id, queueOrder }]` and persist the new order (drag & drop queue view).
22. All routes require auth (`req.user.id`); never trust a body `userId`.

**AC7 — CLI (`xactions schedule ...`)**
23. `xactions schedule create --content "..." --at <ISO> [--thread t2,t3] [--tz Europe/London] [--recur "0 9 * * *"] [--dry-run false]` — calls `scheduleTweet` (uses the stored session cookie / config user).
24. `xactions schedule list [--status pending]` — prints a table.
25. `xactions schedule cancel <id>` — cancels.

**AC8 — MCP tool `x_schedule`**
26. Add `x_schedule` tool (DB-only, dry-run default) to `src/mcp/server.js` mirroring `x_facebook_schedule_post`. Deprecate (but keep) the old browser-only `x_schedule_post`.

**AC9 — Dashboard**
27. Connect `dashboard/calendar.html` to `GET/POST/DELETE /api/tweet-schedule` (replace localStorage with API fetch, fall back to localStorage when unauthenticated).
28. Add a queue view (drag & drop reorder → `PATCH /api/tweet-schedule/reorder`).

**AC10 — Tests (no mocks/stubs/fakes)**
29. `tests/services/tweet-schedule.test.js` mirrors `facebook-schedule.test.js`: dry-run default, real-run persistence, empty/past/soon guards, throughput cap deferral, atomic claim (concurrent ticks → 1 exec), failed-result-not-completed, PII-free error path, Operation linkage, thread + recurrence + timezone validation.
30. `vitest run` green; no `vi.mock`, no fakes — inject `postExecutor` + `sessionFactory` deps (same seam as Facebook tests).

## Out of scope (deferred)
- Multi-account Twitter switching (Q4 roadmap).
- Media upload at execution time (mediaUrls stored but execution uploads via URL download — deferred to a follow-up; MVP stores the field).
- Analytics on scheduled-post performance (Analytics Dashboard epic).

## File List
- `prisma/schema.prisma` — extend `Schedule`
- `prisma/migrations/*/migration.sql` — new migration
- `api/services/tweetScheduling.js` — `scheduleTweet` (NEW)
- `api/services/tweetScheduler.js` — worker (NEW)
- `api/routes/tweetSchedule.js` — REST (NEW)
- `api/server.js` — mount route + start worker
- `src/cli/index.js` — `schedule` commands
- `src/mcp/server.js` — `x_schedule` tool + handler
- `dashboard/calendar.html` — API + queue view
- `tests/services/tweet-schedule.test.js` — tests (NEW)
