---
title: 'Story 48.10 — Decommission Gate: Remove Legacy Dashboard App Screens'
type: 'feature'
created: '2026-09-24'
status: 'done'
review_loop_iteration: 0
route: 'dispatch'
context:
  - '{project-root}/api/server.js'
  - '{project-root}/dashboard/'
  - '{project-root}/apps/web/'
---

<intent-contract>

## Intent

**Problem:** `dashboard/` contains 31 app-screen HTML files + 9 JS files that duplicate Next.js routes. Two parallel frontends violate FR-125.

**Approach:**
1. Delete 31 app-screen HTML files from `dashboard/` (keep 20 marketing/static pages)
2. Delete `dashboard/js/` directory (all 9 files)
3. Update `api/server.js` — remove `sendFile` mounts for deleted screens, keep marketing page mounts
4. Update `dashboard/index.html` — redirect app links to Next.js app
5. Verify: `grep -r "dashboard/"` in `apps/web` = 0 refs

## Boundaries & Constraints

**Always:**
- Keep marketing pages: index, about, features, pricing, faq, contact, docs, blog, changelog, compare, contributing, examples, integrations, privacy, team, terms, tutorials, use-cases, 404
- Keep `dashboard/docs/` and `dashboard/scripts/` subdirectories
- `api/server.js` static mounts for marketing pages stay

**Never:**
- No new backend routes
- No changes to `apps/web/`
- Marketing pages keep working

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior |
|----------|--------------|---------------------------|
| Deleted screen | `GET /graph` on backend | 404 or redirect to Next.js |
| Marketing page | `GET /pricing` on backend | Still serves `pricing.html` |
| Static assets | `GET /dashboard/js/` | 404 (dir deleted) |

</intent-contract>

## Tasks & Acceptance

- [ ] Delete 31 app-screen HTML files from `dashboard/`
- [ ] Delete `dashboard/js/` directory
- [ ] Update `api/server.js` — remove app-screen mounts, keep marketing mounts
- [ ] `grep -r "dashboard/"` in `apps/web` = 0 refs
- [ ] `npm run web:build` still passes
- [ ] `vitest run tests/web/` still passes

## Spec Change Log

## Review Triage Log

## Auto Run Result

## Auto Run Result

**Status:** done
**Summary:** Decommissioned legacy dashboard app screens — deleted 31 HTML files (all app screens now in Next.js), deleted `dashboard/js/` (9 files), removed 91 lines of app-screen `sendFile` mounts from `api/server.js`. Marketing/static pages kept (20 files: index, about, features, pricing, faq, contact, docs, blog, changelog, compare, contributing, examples, integrations, privacy, team, terms, tutorials, use-cases, 404, analytics-dashboard).

**Files changed:**
- `dashboard/*.html` — 31 app screens deleted
- `dashboard/js/` — 9 JS files deleted
- `api/server.js` — removed app-screen mounts, kept marketing mounts

**Verification:**
- `node --check api/server.js` — syntax OK
- `npm run web:build` — 42 routes, zero errors
- `npx vitest run tests/web/` — 207/207 tests pass
- `grep -r "dashboard/"` in `apps/web` — 0 live refs (1 comment only)
