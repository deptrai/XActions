---
title: 'Story 48.3 — Ops & Realtime Screens (/monitor, /status, /run, /benchmark)'
type: 'feature'
created: '2026-09-24'
status: 'completed'
baseline_commit: '26d4c972250daf2685714cba1f9216b87231dd26'
review_loop_iteration: 0
route: 'dispatch'
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/xactions-web-foundation-epic48/ARCHITECTURE-SPINE.md'
  - '{project-root}/dashboard/monitor.html'
  - '{project-root}/dashboard/status.html'
  - '{project-root}/dashboard/run.html'
  - '{project-root}/dashboard/benchmark.html'
  - '{project-root}/apps/web/lib/api.ts'
  - '{project-root}/apps/web/lib/config.ts'
  - '{project-root}/apps/web/components/sidebar.tsx'
---

<intent-contract>

## Intent

**Problem:** Legacy dashboards `monitor.html`, `status.html`, `run.html`, `benchmark.html` show job progress, canary checks, command runner, and benchmark results — but only via static HTML + socket.io CDN. No typed client, no BFF, no universal layout.

**Approach:** Build 4 Next.js pages under `apps/web/app/`:
- `/monitor` — realtime job progress + event feed (socket.io client via `lib/realtime.ts`, or SSE fallback if socket unavailable)
- `/status` — system status: `/api/health`, socket connection state, hibernation status
- `/run` — command runner trigger + progress tracking
- `/benchmark` — benchmark suite results table

All via `lib/api.ts` typed helper through BFF proxy. `lib/realtime.ts` handles socket.io-client connection with cookie auth (reads `xa_bearer`/`xa_session` via session endpoint or passes cookies in handshake).

## Boundaries & Constraints

**Always:**
- `'use client'` components — all interactive pages.
- `lib/realtime.ts` — socket.io-client init, connects to `NEXT_PUBLIC_SOCKET_URL` (default `http://localhost:3001`), passes cookies in handshake.
- If socket.io client unavailable/fails → fallback to `api('GET', '/api/health')` polling every 10s (monitor/status).
- All pages use universal layout (sidebar, header, dark mode).
- `benchmark` shows results table with pass/fail status, duration, throughput.
- `run` has command input + execute button + output log area.

**Never:**
- No raw `fetch('http://localhost:3001/...')` — always `api()`.
- No new backend routes — only existing `/api/health`, `/api/checkpoints`, `/api/streams`, `/api/benchmark`, `/api/operations` mounts.
- No shadcn/radix.
- No mocking socket — if socket.io-client package not installed, use polling fallback via `api()`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Monitor connect | `/monitor` page load | Socket connects to `NEXT_PUBLIC_SOCKET_URL` → progress bars + event feed live | Socket fails → polling fallback |
| Status check | `/status` page load | `/api/health` + socket status + hibernation shown | Backend offline → error banner |
| Run command | POST `/api/operations` body `{command}` | Command queued → output streams to log area | Error → error message shown |
| Benchmark view | `/benchmark` page load | Table of suite results from `/api/benchmark` | Empty → "No benchmark data" |

</intent-contract>

## Code Map

- `apps/web/app/monitor/page.tsx` — NEW: realtime job monitor
- `apps/web/app/status/page.tsx` — NEW: system status page
- `apps/web/app/run/page.tsx` — NEW: command runner
- `apps/web/app/benchmark/page.tsx` — NEW: benchmark results table
- `apps/web/lib/realtime.ts` — NEW: socket.io-client init + cookie auth + polling fallback
- `apps/web/components/sidebar.tsx` — EDIT: add Monitor, Status, Run, Benchmark nav items
- `tests/web/monitor.test.js`, `status.test.js`, `run.test.js`, `benchmark.test.js` — NEW: unit tests

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/lib/realtime.ts` — socket.io client + polling fallback
- [x] `apps/web/app/monitor/page.tsx` — job progress + event feed
- [x] `apps/web/app/status/page.tsx` — health, socket, hibernation status
- [x] `apps/web/app/run/page.tsx` — command runner
- [x] `apps/web/app/benchmark/page.tsx` — benchmark results
- [x] `apps/web/components/sidebar.tsx` — add nav items
- [x] `tests/web/*.test.js` — unit tests for all 4 pages
- [x] `npm run web:build` passes
- [x] `vitest run tests/web/` all pass
- [x] E2E browser verify

**Acceptance Criteria:**
- Given `/monitor`, when loaded, then progress bars and event feed render
- Given `/status`, when loaded, then health + socket + hibernation status shown
- Given `/run`, when command submitted, then output appears in log area
- Given `/benchmark`, when loaded, then results table renders
- Given `npm run web:build`, when run, then zero errors
- Given `vitest run tests/web/`, when run, then all tests pass

## Spec Change Log

## Review Triage Log


## Auto Run Result

**Status:** done
**Summary:** Implemented Ops & Realtime Screens with 4 pages: `/monitor` (realtime job progress + event feed with socket.io → polling fallback via `lib/realtime.ts`), `/status` (system health + socket status + hibernation + uptime grid), `/run` (command runner with preset commands + JSON payload + terminal output), `/benchmark` (reliability scorecard with 4-pillar drill-down + canary probe trigger). Sidebar updated with nav items.

**Files changed:**
- `apps/web/lib/realtime.ts` *(new)* — RealtimeClient with socket.io + polling fallback
- `apps/web/app/monitor/page.tsx`, `status/page.tsx`, `run/page.tsx`, `benchmark/page.tsx` *(new)*
- `apps/web/components/sidebar.tsx` — added 4 nav items
- `tests/web/{monitor,status,run,benchmark}.test.js` *(new)*

**Verification:**
- `npm run web:build` — 15 routes compiled, zero errors
- `npx vitest run tests/web/` — 89/89 tests pass
