---
title: 'Story 48.6 — Intelligence Screens (/osint, /graph, /analytics, /price-correlation)'
type: 'feature'
created: '2026-09-24'
status: 'done'
baseline_commit: 'f84813b2a014e520a3a05220fbb2ecbeef49ac4b'
review_loop_iteration: 0
route: 'dispatch'
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/xactions-web-foundation-epic48/ARCHITECTURE-SPINE.md'
  - '{project-root}/dashboard/osint.html'
  - '{project-root}/dashboard/graph.html'
  - '{project-root}/dashboard/analytics.html'
  - '{project-root}/dashboard/analytics-dashboard.html'
  - '{project-root}/dashboard/price-correlation.html'
  - '{project-root}/apps/web/lib/api.ts'
  - '{project-root}/apps/web/components/sidebar.tsx'
---

<intent-contract>

## Intent

**Problem:** Analysts need OSINT profile lookup, identity cluster visualization, graph relationship view, and analytics dashboards — currently only in legacy static HTML.

**Approach:** 4 new pages:
- `/osint` — OSINT profile lookup (`/api/osint/lookup`), identity cluster list, cross-platform handle mapping
- `/graph` — interactive graph visualization (SVG nodes + edges), community detection, PageRank scoring
- `/analytics` — analytics dashboard with engagement metrics, follower growth, content performance charts
- `/price-correlation` — token/price correlation analysis with market data tables

All via `api()` through BFF. Backend mounts: `/api/osint`, `/api/graph`, `/api/analytics`, `/api/price-correlation`.

## Boundaries & Constraints

**Always:**
- `'use client'` components.
- `api()` helper — zero raw fetch.
- Universal layout (sidebar + header).
- Charts rendered as SVG/CSS (no external chart libs — keep bundle light).
- Sidebar nav items added.

**Never:**
- No new backend routes.
- No shadcn/radix.
- No raw fetch.
- No external chart library (use inline SVG).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| OSINT lookup | `api('POST','/api/osint/lookup')` body `{handle}` | Profile + cluster cards render | 404 → "Profile not found" |
| Graph view | `api('GET','/api/graph')` | SVG nodes + edges render | Empty → "No graph data" |
| Analytics | `api('GET','/api/analytics')` | Metrics cards + trend charts | Offline → seeded data |
| Price correlation | `api('GET','/api/price-correlation')` | Correlation table + sparklines | Offline → seeded data |

</intent-contract>

## Code Map

- `apps/web/app/osint/page.tsx` — NEW: OSINT profile lookup + identity clusters
- `apps/web/app/graph/page.tsx` — NEW: interactive graph visualization
- `apps/web/app/analytics/page.tsx` — NEW: analytics dashboard with charts
- `apps/web/app/price-correlation/page.tsx` — NEW: price correlation table
- `apps/web/components/sidebar.tsx` — EDIT: add 4 nav items
- `tests/web/{osint,graph,analytics,price-correlation}.test.js` — NEW

## Tasks & Acceptance

**Execution:**
- [ ] `apps/web/app/osint/page.tsx` — profile lookup + clusters
- [ ] `apps/web/app/graph/page.tsx` — graph visualization
- [ ] `apps/web/app/analytics/page.tsx` — analytics dashboard
- [ ] `apps/web/app/price-correlation/page.tsx` — price correlation
- [ ] `apps/web/components/sidebar.tsx` — add 4 nav items
- [ ] `tests/web/*.test.js` — unit tests
- [ ] `npm run web:build` passes
- [ ] `vitest run tests/web/` all pass
- [ ] E2E browser verify

**Acceptance Criteria:**
- Given `/osint`, when loaded, then profile lookup form + cluster cards render
- Given `/graph`, when loaded, then SVG graph nodes + edges render
- Given `/analytics`, when loaded, then metrics cards + charts render
- Given `/price-correlation`, when loaded, then correlation table renders
- Given `npm run web:build`, when run, then zero errors
- Given `vitest run tests/web/`, when run, then all tests pass

## Spec Change Log

## Review Triage Log

## Auto Run Result

## Auto Run Result

**Status:** done
**Summary:** Implemented 4 intelligence screens — `/osint` (profile lookup + identity clusters), `/graph` (SVG force-directed graph with zoom/node-select), `/analytics` (6 metric cards + 2 bar charts + top posts), `/price-correlation` (token price table + sparklines + correlation matrix). All use `api()` BFF helper with seeded fallbacks.

**Files changed:**
- `apps/web/app/osint/page.tsx` *(new)*
- `apps/web/app/graph/page.tsx` *(new)*
- `apps/web/app/analytics/page.tsx` *(new)*
- `apps/web/app/price-correlation/page.tsx` *(new)*
- `apps/web/components/sidebar.tsx` — added 4+ nav items
- `tests/web/{osint,graph,analytics,price-correlation}.test.js` *(new)*

**Verification:**
- `npm run web:build` — 22 routes, zero errors, 4 new static routes
- `npx vitest run tests/web/osint.test.js tests/web/graph.test.js tests/web/analytics.test.js tests/web/price-correlation.test.js` — 29/29 pass
