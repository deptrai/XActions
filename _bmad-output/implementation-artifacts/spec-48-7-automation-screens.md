---
title: 'Story 48.7 — Automation Screens (/workflows, /automations, /scheduler, /calendar, /a2a, /jev-test)'
type: 'feature'
created: '2026-09-24'
status: 'done'
review_loop_iteration: 0
route: 'dispatch'
context:
  - '{project-root}/dashboard/workflows.html'
  - '{project-root}/dashboard/automations.html'
  - '{project-root}/dashboard/scheduler.html'
  - '{project-root}/dashboard/calendar.html'
  - '{project-root}/dashboard/a2a.html'
  - '{project-root}/dashboard/jev-test.html'
  - '{project-root}/apps/web/lib/api.ts'
  - '{project-root}/apps/web/components/sidebar.tsx'
---

<intent-contract>

## Intent

**Problem:** Operators need workflow builder, automation rules, scheduler/calendar, A2A console, and Jev test console in the new Next.js app.

**Approach:** 6 new pages:
- `/workflows` — workflow builder with step list, condition editor, trigger config
- `/automations` — automation rule CRUD (create, edit, delete, toggle)
- `/scheduler` — job scheduler with cron expressions + next-run display
- `/calendar` — calendar view of scheduled posts/jobs
- `/a2a` — A2A (Agent-to-Agent) console with SSE message stream
- `/jev-test` — Jev test console for testing agent behaviors

All via `api()` through BFF. `/a2a` uses SSE stream (EventSource to `/api/a2a/stream` via BFF verbatim streaming).

## Boundaries & Constraints

**Always:**
- `'use client'` components.
- `api()` helper — zero raw fetch.
- `/a2a` uses native `EventSource` for SSE (NOT socket.io).
- Dark mode aware.
- Sidebar nav items added.

**Never:**
- No new backend routes.
- No shadcn/radix.
- No external chart library.
- No socket.io for A2A (use EventSource SSE).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Workflows | `api('GET','/api/workflows')` | Step list + editor | Empty → "Create workflow" CTA |
| Automations | `api('GET','/api/automations')` | Rule list + toggle | Offline → seeded rules |
| Scheduler | `api('GET','/api/scheduler')` | Job list + cron display | Empty → "Schedule job" CTA |
| Calendar | `api('GET','/api/calendar')` | Calendar grid + events | Empty → blank calendar |
| A2A SSE | `EventSource('/api/a2a/stream')` | Live message stream | Error → reconnect |
| Jev test | `api('POST','/api/jev/test')` | Test result panel | Error → error message |

</intent-contract>

## Code Map

- `apps/web/app/workflows/page.tsx` — NEW: workflow builder
- `apps/web/app/automations/page.tsx` — NEW: automation rule CRUD
- `apps/web/app/scheduler/page.tsx` — NEW: job scheduler
- `apps/web/app/calendar/page.tsx` — NEW: calendar view
- `apps/web/app/a2a/page.tsx` — NEW: A2A console with SSE
- `apps/web/app/jev-test/page.tsx` — NEW: Jev test console
- `apps/web/components/sidebar.tsx` — EDIT: add 6 nav items
- `tests/web/{workflows,automations,scheduler,calendar,a2a,jev-test}.test.js` — NEW

## Tasks & Acceptance

**Execution:**
- [ ] `apps/web/app/workflows/page.tsx`
- [ ] `apps/web/app/automations/page.tsx`
- [ ] `apps/web/app/scheduler/page.tsx`
- [ ] `apps/web/app/calendar/page.tsx`
- [ ] `apps/web/app/a2a/page.tsx` — SSE via EventSource
- [ ] `apps/web/app/jev-test/page.tsx`
- [ ] `apps/web/components/sidebar.tsx` — add 6 nav items
- [ ] `tests/web/*.test.js`
- [ ] `npm run web:build` passes
- [ ] `vitest run tests/web/` all pass

**Acceptance Criteria:**
- Given `/workflows`, when loaded, then step list + editor render
- Given `/automations`, when loaded, then rule list + toggle render
- Given `/scheduler`, when loaded, then job list + cron display render
- Given `/calendar`, when loaded, then calendar grid renders
- Given `/a2a`, when loaded, then SSE stream connects and messages render
- Given `/jev-test`, when loaded, then test form + result panel render

## Spec Change Log

## Review Triage Log

## Auto Run Result

## Auto Run Result

**Status:** done
**Summary:** Implemented 6 automation screens — `/workflows` (step builder with reorder/config), `/automations` (rule CRUD with toggle), `/scheduler` (cron job table), `/calendar` (month grid + day detail), `/a2a` (SSE EventSource message stream + agent list), `/jev-test` (scenario runner + log panel).

**Files changed:**
- `apps/web/app/{workflows,automations,scheduler,calendar,a2a,jev-test}/page.tsx` *(new)*
- `apps/web/components/sidebar.tsx` — 6 nav items (added earlier)
- `tests/web/{workflows,automations,scheduler,calendar,a2a,jev-test}.test.js` *(new)*

**Verification:**
- `npm run web:build` — 28 routes, zero errors
- `npx vitest run tests/web/` — 25/25 new tests pass
