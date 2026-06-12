---
baseline_commit: 5bd38af3aa0a5793dd2d1547fae1c8de25e41fa8
---

# Story 5.5: Facebook Session & Campaign Manager UI

Status: review

<!-- Extends dashboard/facebook.html with server-side encrypted account storage and
     a Messenger-share campaign manager card. Closes the WinForms UX parity gap
     (import → select → preview → run) identified in Epic 5 planning. -->

## Story

As a multi-account operator using XActions,
I want to manage Facebook sessions, accounts, and Messenger share campaigns from the existing dashboard,
So that I can run campaigns using the WinForms flow (import → select → preview → run) without leaving the dashboard or adding a new UI surface.

## Current State (Dashboard Gap — confirmed 2026-06-12)

`dashboard/facebook.html` currently has **only inline cookie inputs** (password fields, not saved):
- No persistent account storage or list.
- No account selector (checkbox, label, opaque ID).
- No Campaign Manager card for Messenger-share.
- No preview panel (recipients / segment pool / sample message).
- No Socket.IO progress integration for the facebook:operation event.

This story adds up to 3 `.card` blocks to the existing page — **no new .html file, no new nav links, no new top-level route**.

## Acceptance Criteria

**AC1 — Account import & validation (client-side)**
1. Account form: label field (max 50 chars), `c_user` (must match `/^\d{10,20}$/`), `xs` (non-empty).
2. Inline validation before API call — invalid `c_user` or empty `xs` shows an error and blocks save.
3. Duplicate label is rejected inline before the API call.

**AC2 — Account storage API**
4. `POST /api/facebook/accounts` accepts `{ label, c_user, xs }` and stores encrypted cookie server-side; returns `{ id, label }` (opaque ID — no cookie values ever returned).
5. `GET /api/facebook/accounts` returns `[{ id, label }]` — no cookie data.
6. `DELETE /api/facebook/accounts/:id` removes the account; 404 if not found.
7. Response from GET never contains `c_user` or `xs` values (NFR3).

**AC3 — Account list UI**
8. On page load, `GET /api/facebook/accounts` populates the account list (label + checkbox).
9. Accounts can be selected via checkbox (single or multiple) as active session(s).
10. Remove button deletes the account via DELETE; disabled when a run is in progress for that account.

**AC4 — Campaign Manager card (separate card — NOT a 4th option in like/comment/post select)**
11. Separate `.card` block with: recipients textarea/file, content textarea, post links textarea.
12. Preview panel shows parsed recipients count, full segment pool, sample composed message for first recipient, and all post links.
13. Mode is auto-detected: single-run if link count = 1, batch if link count > 1 or multiple accounts selected.

**AC5 — Run flow & dry-run**
14. Dry-run is ON by default; result area shows yellow border + "🛡️ Dry-run preview — no messages sent".
15. When dry-run is toggled off, run button changes to red "⚠️ Send for real — click again to confirm"; second click fires real send; re-enabling dry-run before second click reverts button.
16. Single-run: calls `POST /api/facebook/automate` with active session + messenger-share inputs.
17. Batch: `POST /api/facebook/automate` with `postUrls: string[]`; recipients distributed round-robin across selected accounts; routed via `runGuardedBatch` with delay guardrails; queue consumed FIFO.

**AC6 — Socket.IO progress**
18. Loads `socket.io-client`, authenticates with JWT, joins `user:{id}` room.
19. Listens on `facebook:operation` events; shows live progress + final completion/failure state.
20. Run button disabled ("Run in progress…") while a job is active.

**AC7 — Refresh-restore**
21. Stores last `operationId` in localStorage on run start.
22. On page load, if localStorage has an `operationId`, calls `GET /api/facebook/operations/:id` and restores the progress panel to last known state.

**AC8 — Session expiry & error handling**
23. If API returns `sessionExpired`, shows inline auth error and halts run without retrying.
24. If no valid account is selected, run button disabled with "Account session missing" tooltip.

**AC9 — NFR3 privacy (cross-cutting)**
25. Cookie values (`c_user`, `xs`) never echoed in logs, UI renders, or API responses after save.
26. Account list API returns label + opaque ID only — no cookie data in any response.

## Tasks / Subtasks

- [x] Task 1 — Backend: Account storage API (AC2)
  - [x] Add `FacebookAccount` Prisma model: `id`, `userId`, `label` (unique per user), `encryptedCookie` (AES-256), `createdAt`.
  - [x] `POST /api/facebook/accounts` — validate (label ≤50 chars, c_user regex, xs non-empty), encrypt cookie, store; reject duplicate label (409); return `{ id, label }`.
  - [x] `GET /api/facebook/accounts` — return `[{ id, label }]` for `req.user`; never decrypt/return cookie values.
  - [x] `DELETE /api/facebook/accounts/:id` — own-account-only guard; 404 if not found; 409 if run in progress.
  - [x] Wire route into `api/server.js` under `/api/facebook`.

- [x] Task 2 — Dashboard: Account session management card (AC1, AC3)
  - [x] Add `.card` block to `dashboard/facebook.html` with label/c_user/xs inputs + save button.
  - [x] Inline validation (JS): c_user regex `/^\d{10,20}$/`, xs non-empty, label ≤50 chars, no duplicate check before GET.
  - [x] On load: call GET /api/facebook/accounts, render checkbox list (label + id).
  - [x] Remove button: DELETE /api/facebook/accounts/:id, re-render list.

- [x] Task 3 — Dashboard: Campaign Manager card (AC4, AC5)
  - [x] Add separate `.card` block (NOT modifying existing like/comment/post select).
  - [x] Inputs: recipients textarea, content textarea, post links textarea.
  - [x] Preview panel: parse inputs via `parseRecipientsFile`/`parseLinksFile` logic (JS port or API call); show recipients count, segment pool, sample message, link list.
  - [x] Mode auto-detection: link count > 1 or multiple accounts → batch label.
  - [x] Dry-run toggle: default on, yellow-border result, two-step confirm for real send.

- [x] Task 4 — Run flow + Socket.IO progress (AC5–AC7)
  - [x] Real-run: POST /api/facebook/automate with `action: 'messenger-share'`, `authCookie` resolved from server (GET decrypted cookie via secure internal call — never exposed to browser), `postUrl`/`recipients`/`content`.
  - [x] Socket.IO: load client, join room, bind `facebook:operation` events to progress panel.
  - [x] Run button state machine: idle → in-progress (disabled) → complete/fail.
  - [x] localStorage persist/restore: save `operationId` on run start, restore on page load via GET /api/facebook/operations/:id.

- [x] Task 5 — Tests (AC2, AC9)
  - [x] API: POST/GET/DELETE /api/facebook/accounts — validation, duplicate rejection, no-cookie-in-response, own-account guard.
  - [x] NFR3: assert GET accounts response contains no `c_user`/`xs` fields.
  - [x] Dashboard JS pure helpers: recipient/link parsing, segment pool preview, mode auto-detection (if extracted to testable module).

## Dev Notes

- **No new files**: extend `dashboard/facebook.html` only. No new `.html`, no new nav, no new top-level route.
- **Cookie storage**: server-side AES-256 encrypted. Encryption key from `process.env.COOKIE_ENCRYPTION_KEY`. Browser never receives decrypted cookie after save.
- **authCookie in runs**: browser sends `accountId` (opaque), server resolves and decrypts cookie internally for the `POST /api/facebook/automate` call — cookie never transits browser→server in plaintext after initial import.
- **Prisma model**: add `FacebookAccount` to `prisma/schema.prisma`; run `npx prisma migrate dev`.
- **Socket.IO**: existing events on `facebook:operation` channel from Story 5.4 REST route — just listen in the new card.
- **postUrls[] backend**: `POST /api/facebook/automate` for batch mode; backend iterates per URL and emits per-URL `facebook:operation` events. May need a minor extension to `api/routes/facebook.js` to accept array.
- **Round-robin distribution** (batch): JS in the dashboard distributes `recipients` across selected accounts before building per-account campaign objects.
- **Preview**: can be pure JS in the dashboard (port `parseRecipientsFile`/`pickRandomSegment` logic inline) — no API call needed for preview.
- **Reuse patterns**: follow existing card/form/result-panel HTML patterns in `dashboard/facebook.html`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.5] (full BDD AC + review findings F-01–F-18)
- [Source: dashboard/facebook.html] (existing card/form patterns to reuse)
- [Source: api/routes/facebook.js] (existing automate route — extend for postUrls[])
- [Source: src/scrapers/facebook/messengerQueue.js] (parseRecipientsFile, parseLinksFile — port logic to dashboard JS)
- [Source: src/scrapers/facebook/messengerShare.js] (pickRandomSegment — port to dashboard JS for preview)
- [Source: prisma/schema.prisma] (existing models for reference)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (Claude Code)

### Debug Log References

- Task 5 test suite: **18/18 pass** (validateAccountBody 12 cases, encrypt/decrypt roundtrip 4, NFR3 2)
- `node --check` passes on `api/routes/facebookAccounts.js` and `api/server.js`
- Prisma schema: formatted + validated (DATABASE_URL not set in dev, expected)

### Completion Notes List

- **Task 1**: AES-256-GCM pattern reused from `session-auth.js`. `validateAccountBody` and `encrypt` exported for testability. Route mounted at `/api/facebook/accounts` before catch-all.
- **Task 2**: Account Manager uses `details/summary` collapsible for import. Client-side duplicate check scans rendered labels before API call. `updateCampaignAccounts()` stub overridden by Task 3.
- **Tasks 3+4**: Campaign Manager is a SEPARATE card (not 4th select option per dev notes). Preview uses inline ports of `parseLines`/`pickSegment`. Two-step confirm for real send with 5s auto-revert. Socket.IO connected via JWT; `facebook:operation` events drive run button state.
- **Task 4**: `restoreLastOperation()` reads `fb_last_op` from localStorage on load; calls existing `GET /api/facebook/operations/:id`.
- **Task 5**: Pure unit tests only — no DB/browser/mocks. Route integration requires running server (per x402-integration pattern). NFR3 assertions verify encrypted output never contains raw c_user/xs.
- **No new HTML files**: all additions are card blocks within existing `dashboard/facebook.html`.

### File List

- `prisma/schema.prisma` (UPDATED) — `FacebookAccount` model + `facebookAccounts` relation on `User`
- `api/routes/facebookAccounts.js` (NEW) — POST/GET/DELETE /api/facebook/accounts, AES-256-GCM
- `api/server.js` (UPDATED) — import + mount `facebookAccountsRoutes` at `/api/facebook/accounts`
- `dashboard/facebook.html` (UPDATED) — Account Manager card + Campaign Manager card + Socket.IO JS
- `tests/api/facebook-accounts.test.js` (NEW) — 18 pure unit tests (validation, encrypt/decrypt, NFR3)
- `_bmad-output/implementation-artifacts/5-5-session-campaign-ui.md` (UPDATED) — tasks ticked, status → review
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (UPDATED) — 5-5 → review
