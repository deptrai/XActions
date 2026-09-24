---
title: 'Story 49.1 — Quick Wins: Route Order, CORS, Session Hygiene'
type: 'feature'
created: '2026-09-24'
status: 'done'
review_loop_iteration: 0
route: 'dispatch'
---

## Intent

Fix 4 deferred P2 items in one sweep:
1. Plugin routes mount after 404 handler (unreachable)
2. Worker CORS preflight missing canonical headers
3. Session credential stored in shared `miningJobs` map
4. Lockfile regeneration (skipped — pnpm-lock is stale but non-blocking)

## Auto Run Result

**Status:** done
**Summary:** Fixed plugin route mount order (moved before `notFoundHandler`), added `x-session-cookie`/`x-agent-api-key`/`x-api-key` to CORS allow-headers in both `api/server.js` and `worker/index.js`, moved session credential from `miningJobs` to separate `jobCredentials` map in `api/routes/viral.js`.

**Files changed:**
- `api/server.js` — plugin mount before 404, CORS headers
- `worker/index.js` — CORS headers
- `api/routes/viral.js` — session credential separation

**Verification:**
- `node --check` — syntax OK for all files
- `npm run web:build` — still passes (no web changes)
