---
title: 'Story 48.4 — Admin Console Full Parity (/admin)'
type: 'feature'
created: '2026-09-24'
status: 'completed'
baseline_commit: '27a7d6123e48efdc68c17345ee562f2a45c31c50'
review_loop_iteration: 0
route: 'dispatch'
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/xactions-web-foundation-epic48/ARCHITECTURE-SPINE.md'
  - '{project-root}/dashboard/admin.html'
  - '{project-root}/apps/web/app/admin/page.tsx'
  - '{project-root}/apps/web/lib/api.ts'
  - '{project-root}/apps/web/lib/realtime.ts'
  - '{project-root}/apps/web/components/sidebar.tsx'
---

<intent-contract>

## Intent

**Problem:** `apps/web/app/admin/page.tsx` from Story 48.1 was a basic skeleton with 4 tabs. Legacy `dashboard/admin.html` (3119 lines) has deeper sections: checkpoint list with pause/resume/retry, proxy pool health table, stream metrics + alert channels, x402 payment ledger, rate budget quota, scraper accounts & hibernation, platform drift detection. The Next.js version needs full parity.

**Approach:** Rewrite `apps/web/app/admin/page.tsx` to match ALL sections of `dashboard/admin.html`:
- **Jobs & Checkpoints tab**: checkpoint table (id, crawler, target, status, itemsScraped, lastActive) with pause/resume/retry actions via `api('POST', '/api/checkpoints/:id/{pause,resume,retry}')`.
- **Proxies & Accounts tab**: Rate Budget & Quota Allocation section, Proxy Budget & Tier (Epic 40), Proxy Pool & Health table, Scraper Accounts & Hibernation section.
- **Stream Metrics & Alerts tab**: Stream Throughput chart placeholder, Active Stream Alerts, Alert Channels Configuration.
- **x402 Payments tab**: Payments by Operation, Recent Payments, Webhook Configuration.
- **Live Sessions tab**: Active session cards with progress bars and real-time activity log streams.
- All sections use `api()` helper for data fetching, socket.io via `lib/realtime.ts` for live updates.

## Boundaries & Constraints

**Always:**
- `'use client'` component.
- All API calls through `api()` — zero raw `fetch('http://localhost:3001/...')`.
- Socket updates via `lib/realtime.ts` polling fallback (socket.io-client not installed).
- Universal layout (sidebar + header already render).
- Match legacy `admin.html` structure section-for-section.

**Never:**
- No new backend routes.
- No shadcn/radix.
- No raw fetch.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Checkpoints load | `api('GET','/api/checkpoints')` | Table renders with status badges + action buttons | 401 → "Authentication required" |
| Pause checkpoint | `api('POST','/api/checkpoints/:id/pause')` | Row status → paused | Error → inline message |
| Proxy pool | `api('GET','/api/proxies')` | Health table renders | Offline → mock seed data |
| Stream alerts | `api('GET','/api/streams/alerts')` | Alert list + channel config | Offline → seeded alerts |
| Payments | `api('GET','/api/x402/payments')` | Payment ledger table | Offline → seeded data |

</intent-contract>

## Code Map

- `apps/web/app/admin/page.tsx` — REWRITE: full parity with dashboard/admin.html (3119 lines → React component)
- `tests/web/admin.test.js` — UPDATE: cover all sections

## Tasks & Acceptance

**Execution:**
- [x] Rewrite `apps/web/app/admin/page.tsx` with all 5 tab sections matching legacy admin.html
- [x] Wire `api()` calls for checkpoints, proxies, streams, payments
- [x] Socket/polling via `lib/realtime.ts` for live updates
- [x] Update `tests/web/admin.test.js` for full section coverage
- [x] `npm run web:build` passes
- [x] `vitest run tests/web/` all pass
- [x] E2E browser verify all tabs

**Acceptance Criteria:**
- Given `/admin`, when loaded, then all 5 tabs render with correct sections
- Given checkpoint row, when pause clicked, then status changes to paused
- Given proxies tab, when loaded, then rate budget + proxy pool + hibernation sections render
- Given stream tab, when loaded, then throughput + alerts + channels render
- Given payments tab, when loaded, then payment stats + recent + webhook config render
- Given `npm run web:build`, when run, then zero errors
- Given `vitest run tests/web/`, when run, then all tests pass

## Spec Change Log

- 2026-09-24: Completed full rewrite of `apps/web/app/admin/page.tsx` and updated unit tests in `tests/web/admin.test.js` for 100% test passing and production build clean compilation.

## Review Triage Log

- Story 48.4 implementation completed and verified against all acceptance criteria.

## Auto Run Result

- `npm run web:build`: Success (zero errors, static output generated for /admin).
- `npx vitest run tests/web/`: 15 test suites passed, 99 tests passed, 0 failures.
