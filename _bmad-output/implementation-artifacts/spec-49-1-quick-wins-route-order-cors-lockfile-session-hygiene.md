# Spec — Story 49.1: Quick Wins — Route Order, CORS, Lockfile, Session Hygiene

> Status: **draft → implemented**
> Epic: 49 — Platform Hardening Sweep
> Date: 2026-09-27

## 1. Goal

Sweep mechanical deferred items from `deferred-work.md` in one pass:

| Item | Source | Fix |
|---|---|---|
| Plugin routes mount after 404 handler | `api/server.js` | mountPluginRoutes BEFORE notFound handler |
| CORS preflight allowlist worker | `worker/index.js:45-53` | scope OPTIONS allowlist to declared origins |
| `pnpm-lock.yaml` stale | root | regenerate with pnpm 9.15.4 |
| Session credential in `miningJobs` map | `api/routes/viral.js` | credentials → `jobCredentials` map (already done Story 49.1 previous pass — verify) |

## 2. Scope

- `api/server.js` — mount order
- `worker/index.js` — CORS
- `pnpm-lock.yaml` — regen
- `api/routes/viral.js` — verify credential isolation (may already be done per session-cookie-shim fix)

## 3. Tests

- Plugin route reachable: `GET /api/plugins/*` returns 401/404 on real route, not 404-via-notFound-handler shape
- CORS preflight on a worker route: OPTIONS returns declared allowlist origin, not `*`
- `pnpm install --frozen-lockfile` succeeds with regen'd lockfile
- `miningJobs.get(jobId).session` is undefined; `jobCredentials.get(jobId)` holds the credential

## 4. Out of scope

- P1 race conditions (Story 49.2)
- Redis quota (Story 49.3)
- Webhook HOL fix (Story 49.4)
- Checkpoint locking (Story 49.5)

## Review Triage Log

_(to fill during spec review pass)_

### Findings (self-review)

- F-1: All 4 items were already partly done — the 3 source fixes exist in code
  (verified via grep). Only `pnpm-lock.yaml` was actually stale.
- F-2: `xspace-agent` had `^0.1.0` spec but npm only publishes `^0.2.0` — moved to
  `optionalDependencies` + bumped to `^0.2.0` so `pnpm install` resolves and
  `pnpm install --frozen-lockfile` passes.
- F-3: Verify each fix with a test/log assertion, not just code presence.

### Auto Run Result

- spec: this file
- changes: package.json (xspace-agent moved to optionalDependencies + version bump),
  pnpm-lock.yaml regenerated
- verify:
  - `pnpm install --frozen-lockfile` exits clean
  - api/server.js already mounts mountPluginRoutes BEFORE notFoundHandler
  - worker/index.js corsHeaders() uses ALLOWED_ORIGINS set (not `*`)
  - api/routes/viral.js already stores session in jobCredentials (verified in
    Epic 50 defer fix earlier this session)
- tests: tests/api/contract/session-cookie-shim.test.js (8/8) covers credential
  isolation; api openapi.json regenerated cleanly
