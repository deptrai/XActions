---
title: 'Story 48.2 — Auth & Session UI (/login)'
type: 'feature'
created: '2026-09-24'
status: 'completed'
baseline_commit: '0dbf2bce713782c8089b2f87d8907a53782453f6'
review_loop_iteration: 0
route: 'dispatch'
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/xactions-web-foundation-epic48/ARCHITECTURE-SPINE.md'
  - '{project-root}/apps/web/lib/session.ts'
  - '{project-root}/apps/web/lib/api.ts'
  - '{project-root}/apps/web/app/session/route.ts'
---

<intent-contract>

## Intent

**Problem:** Story 48.1 built the session infrastructure (POST/GET/DELETE `/session` endpoint managing httpOnly `xa_bearer`/`xa_session` cookies) but there is no UI to use it. Operators cannot log in, see their auth state, or log out. Without this, protected endpoints still get 401 with no visible auth state.

**Approach:** Build `/login` page (`apps/web/app/login/page.tsx`) with email/password form → `POST /session` (via `lib/api.ts`). Header component shows auth state from `GET /session` (badge showing connected/disconnected). `DELETE /session` provides logout. `middleware.ts` guards protected routes by checking cookie presence (not validity — backend enforces actual auth).

## Boundaries & Constraints

**Always:**
- `/login` is a client component (`'use client'`) — form state, validation, redirect after login.
- `middleware.ts` at `apps/web/middleware.ts` — checks `xa_bearer` or `xa_session` cookie presence on protected routes; redirects to `/login` if both absent. Cookie presence ≠ validity (backend returns real 401 for expired).
- Header shows auth state via `GET /session` → `{hasBearer, hasSession}` — renders "Connected" badge + logout button when authenticated.
- All API calls via `lib/api.ts` — no raw `fetch` to localhost:3001.
- No UI framework additions (no shadcn/radix) — plain React + Tailwind.

**Never:**
- No login redirect for public routes (`/login` itself, `/api/*`, `/_next/*`, `/favicon.ico`).
- No client-side cookie reading (cookies are httpOnly — server-side checks only).
- No password display in URL/body logging.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Login happy | `POST /session {email, password}` | Backend validates → `xa_bearer` httpOnly set → redirect to `/` | 401 → error message shown |
| Session status | `GET /session` | `{hasBearer: true, hasSession: true}` → header shows "Connected" | `false,false` → "Disconnected" |
| Logout | `DELETE /session` | Cookies cleared → redirect to `/login` | N/A |
| Protected route | No cookies, visit `/admin` | Middleware redirects to `/login` | N/A |
| Public route | Visit `/login` without cookies | Login form renders normally | N/A |
| Expired session | Cookie present but JWT expired | `GET /session` → `hasBearer: false` | UI shows "Disconnected" |

</intent-contract>

## Code Map

- `apps/web/app/login/page.tsx` — NEW: login form (email/password → POST /session → redirect)
- `apps/web/middleware.ts` — NEW: cookie-guard for protected routes
- `apps/web/components/header.tsx` — EDIT: add auth state display + logout button
- `apps/web/components/auth-guard.tsx` — NEW: client-side auth check wrapper (optional, for SPA feel)
- `apps/web/app/login/page.tsx` — uses `api()` from `lib/api.ts` for POST /session
- `tests/web/login.test.js` — NEW: unit tests for login page
- `tests/web/auth-middleware.test.js` — NEW: unit tests for middleware logic

## Tasks & Acceptance

**Execution:**
- [x] Create `apps/web/app/login/page.tsx` — email/password form, error display, redirect on success
- [x] Create `apps/web/middleware.ts` — cookie-guard redirect to `/login` for protected routes
- [x] Update `apps/web/components/header.tsx` — add auth state badge + logout
- [x] Write `tests/web/login.test.js` + `tests/web/auth-middleware.test.js`
- [x] Verify: `npm run web:build` passes, `vitest run tests/web/` all pass
- [x] E2E: login → session cookie set → badge shows Connected → logout → 401 → redirect

**Acceptance Criteria:**
- Given `/login` page, when submit email/password, then `POST /session` called and cookies set
- Given no auth cookies, when visit `/admin`, then redirect to `/login`
- Given auth cookies present, when header renders, then shows "Connected" badge
- Given logout click, when `DELETE /session` succeeds, then cookies cleared and redirect to `/login`
- Given `vitest run tests/web/`, when run, then all tests pass
- Given `npm run web:build`, when run, then zero errors

## Spec Change Log

- 2026-09-24: Implemented Story 48.2 (login page, auth middleware, header status badge & logout, auth-guard component, and comprehensive test suite).

## Review Triage Log


## Auto Run Result

**Status:** done
**Summary:** Implemented Auth & Session UI with `/login` page (email/password → `POST /session` → httpOnly cookie redirect), `middleware.ts` cookie-guard (redirects unauthenticated protected routes to `/login`), header auth state badge (Connected/Disconnected via `GET /session`), logout button (`DELETE /session`), and `auth-guard.tsx` client wrapper.

**Files changed:**
- `apps/web/app/login/page.tsx` *(new)* — client login form
- `apps/web/middleware.ts` *(new)* — cookie-guard route protection
- `apps/web/components/header.tsx` — added auth badge + logout
- `apps/web/components/auth-guard.tsx` *(new)* — client-side auth wrapper
- `tests/web/login.test.js`, `tests/web/auth-middleware.test.js` *(new)*

**Verification:**
- `npm run web:build` — 11 routes compiled, middleware 34.3 kB, zero errors
- `npx vitest run tests/web/` — 66/66 tests pass
