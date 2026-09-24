---
title: 'Story 48.5 — Fleet & Account Manager (/accounts, /proxies, /sessions)'
type: 'feature'
created: '2026-09-24'
status: 'done'
baseline_commit: '509b7aa98d7798d9a1d0d53da2cba951dd80f2cf'
review_loop_iteration: 0
route: 'dispatch'
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/xactions-web-foundation-epic48/ARCHITECTURE-SPINE.md'
  - '{project-root}/apps/web/lib/api.ts'
  - '{project-root}/apps/web/lib/realtime.ts'
  - '{project-root}/apps/web/components/sidebar.tsx'
  - '{project-root}/apps/web/app/admin/page.tsx'
---

<intent-contract>

## Intent

**Problem:** Admin page (48.4) shows proxies/accounts read-only. Operators need CRUD management: add/remove accounts, health-check proxies, view session expiry/hibernation state per account.

**Approach:** 3 new pages under `apps/web/app/`:
- `/accounts` — account pool list (username, platform, health status, warmup score, last active) + add/remove + health check trigger
- `/proxies` — proxy pool CRUD (add proxy URL, health check, rotation stats, quarantine/release)
- `/sessions` — per-account session state: expiry countdown, hibernation status, wake/probe/rotate actions

All via `api()` through BFF. Backend mounts: `/api/proxies`, `/api/admin`, `/api/facebook/accounts`, `/api/checkpoints`.

## Boundaries & Constraints

**Always:**
- `'use client'` components.
- `api()` helper — zero raw `fetch` to absolute URLs.
- Universal layout (sidebar + header already render).
- Realtime updates via `lib/realtime.ts` polling fallback.
- Sidebar nav items added for all 3 pages.

**Never:**
- No new backend routes.
- No shadcn/radix.
- No raw fetch.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Accounts list | `api('GET','/api/admin/accounts')` | Table with username, platform, health, warmup score | 401 → seeded data |
| Add account | `api('POST','/api/admin/accounts')` | New row appears | Error → inline message |
| Proxy health | `api('GET','/api/proxies')` | Health table with latency, success rate | Offline → seeded data |
| Session expiry | `api('GET','/api/admin/sessions')` | Expiry countdown per account | Expired → "Expired" badge |

</intent-contract>

## Code Map

- `apps/web/app/accounts/page.tsx` — NEW: account pool management
- `apps/web/app/proxies/page.tsx` — NEW: proxy pool management
- `apps/web/app/sessions/page.tsx` — NEW: session state per account
- `apps/web/components/sidebar.tsx` — EDIT: add Accounts, Proxies, Sessions nav items
- `tests/web/accounts.test.js`, `proxies.test.js`, `sessions.test.js` — NEW

## Tasks & Acceptance

**Execution:**
- [ ] `apps/web/app/accounts/page.tsx` — account pool list + add/remove + health check
- [ ] `apps/web/app/proxies/page.tsx` — proxy pool CRUD + health + rotation stats
- [ ] `apps/web/app/sessions/page.tsx` — session expiry + hibernation + actions
- [ ] `apps/web/components/sidebar.tsx` — add 3 nav items
- [ ] `tests/web/{accounts,proxies,sessions}.test.js` — unit tests
- [ ] `npm run web:build` passes
- [ ] `vitest run tests/web/` all pass
- [ ] E2E browser verify

**Acceptance Criteria:**
- Given `/accounts`, when loaded, then account pool table renders with health status
- Given `/proxies`, when loaded, then proxy pool table renders with health metrics
- Given `/sessions`, when loaded, then session state per account renders
- Given `npm run web:build`, when run, then zero errors
- Given `vitest run tests/web/`, when run, then all tests pass

## Spec Change Log

## Review Triage Log


## Auto Run Result

**Status:** done
**Summary:** Implemented Fleet & Account Manager with 3 pages: `/accounts` (account pool with username, platform, health, warmup score, add/remove, health check), `/proxies` (proxy pool CRUD with protocol, pool tier, latency, success rate, quarantine/release), `/sessions` (per-account session expiry countdown, hibernation status, wake/probe/rotate). Sidebar updated.

**Files changed:**
- `apps/web/app/accounts/page.tsx`, `proxies/page.tsx`, `sessions/page.tsx` *(new)*
- `apps/web/components/sidebar.tsx` — added Accounts, Proxies, Sessions nav items
- `tests/web/{accounts,proxies,sessions}.test.js` *(new)*

**Verification:**
- `npm run web:build` — 18 routes compiled, zero errors
- `npx vitest run tests/web/` — 99/99 tests pass
