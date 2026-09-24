---
title: 'Story 48.9 — Account & Misc Screens (/facebook, /unfollowers, /mcp, /extension, /platform, /agent, /security)'
type: 'feature'
created: '2026-09-24'
status: 'done'
review_loop_iteration: 0
route: 'dispatch'
context:
  - '{project-root}/dashboard/facebook.html'
  - '{project-root}/dashboard/unfollowers.html'
  - '{project-root}/dashboard/mcp.html'
  - '{project-root}/dashboard/extension.html'
  - '{project-root}/dashboard/platform.html'
  - '{project-root}/dashboard/agent.html'
  - '{project-root}/dashboard/security.html'
  - '{project-root}/apps/web/lib/api.ts'
  - '{project-root}/apps/web/components/sidebar.tsx'
---

<intent-contract>

## Intent

**Problem:** Users need remaining screens migrated — no app screen should only exist in legacy dashboard.

**Approach:** 7 new pages:
- `/facebook` — Facebook automation panel (login status, actions, results)
- `/unfollowers` — unfollower detection + list + actions
- `/mcp` — MCP server inspector (tools list, status, test calls)
- `/extension` — browser extension status + install guide
- `/platform` — platform overview (all supported platforms, status, features)
- `/agent` — AI agent dashboard (persona list, agent status, run controls)
- `/security` — security status (session health, API keys, audit log)

All via `api()` through BFF.

## Boundaries & Constraints

**Always:**
- `'use client'` components.
- `api()` helper — zero raw fetch.
- Dark mode aware.
- Sidebar nav items added.

**Never:**
- No new backend routes.
- No shadcn/radix.
- No external lib.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Facebook | `api('GET','/api/facebook/status')` | Status + action buttons | Offline → "Not connected" |
| Unfollowers | `api('GET','/api/unfollowers')` | Unfollower list + actions | Empty → "No unfollowers" |
| MCP | `api('GET','/api/mcp/tools')` | Tool list + status | Offline → seeded tools |
| Extension | `api('GET','/api/extension/status')` | Extension status card | Not installed → install guide |
| Platform | `api('GET','/api/platforms')` | Platform cards + status | Offline → seeded platforms |
| Agent | `api('GET','/api/agents')` | Agent list + controls | Empty → "Create agent" CTA |
| Security | `api('GET','/api/security/status')` | Security cards + audit log | Offline → seeded data |

</intent-contract>

## Code Map

- `apps/web/app/facebook/page.tsx` — NEW
- `apps/web/app/unfollowers/page.tsx` — NEW
- `apps/web/app/mcp/page.tsx` — NEW
- `apps/web/app/extension/page.tsx` — NEW
- `apps/web/app/platform/page.tsx` — NEW
- `apps/web/app/agent/page.tsx` — NEW
- `apps/web/app/security/page.tsx` — NEW
- `apps/web/components/sidebar.tsx` — EDIT: add 7 nav items
- `tests/web/{facebook,unfollowers,mcp,extension,platform,agent,security}.test.js` — NEW

## Tasks & Acceptance

**Execution:**
- [ ] `apps/web/app/facebook/page.tsx`
- [ ] `apps/web/app/unfollowers/page.tsx`
- [ ] `apps/web/app/mcp/page.tsx`
- [ ] `apps/web/app/extension/page.tsx`
- [ ] `apps/web/app/platform/page.tsx`
- [ ] `apps/web/app/agent/page.tsx`
- [ ] `apps/web/app/security/page.tsx`
- [ ] `apps/web/components/sidebar.tsx` — add 7 nav items
- [ ] `tests/web/*.test.js`
- [ ] `npm run web:build` passes
- [ ] `vitest run tests/web/` all pass

**Acceptance Criteria:**
- Given each route, when loaded, then page renders with seeded or real data
- Given `npm run web:build`, when run, then zero errors
- Given `vitest run tests/web/`, when run, then all tests pass

## Spec Change Log

## Review Triage Log

## Auto Run Result

## Auto Run Result

**Status:** done
**Summary:** Implemented 7 account/misc screens — `/facebook` (connection status + 4 action cards), `/unfollowers` (list + mutual/verified filter + CSV export), `/mcp` (tool inspector + test calls), `/extension` (install guide + status), `/platform` (12 platform cards + feature badges), `/agent` (agent cards + start/pause/create), `/security` (security items + audit log).

**Files changed:**
- `apps/web/app/{facebook,unfollowers,mcp,extension,platform,agent,security}/page.tsx` *(new)*
- `tests/web/{facebook,unfollowers,mcp,extension,platform,agent,security}.test.js` *(new)*

**Verification:**
- `npm run web:build` — 42 routes, zero errors
- `npx vitest run tests/web/` — 29/29 new tests pass
