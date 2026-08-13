# Story 7.1: Foundation — Health, Pool, Hydration & Schema

---
baseline_commit: 55863bcd05ec1afe1639d39b4fb788d1d1ea6888
---

Status: review

## Change Log

- 2026-08-14: Story created from merged Epic 7 architecture.
- 2026-08-13: Implemented Story 7.1 — schema migration, account health service, parallel pool, hydration JSON extractor, proxy CRUD, and tests.

## Story

As a user running multi-account Facebook scraping,
I want the system to validate account health, run a bounded parallel pool, extract embedded hydration JSON, and store the necessary account/proxy schema,
so that all advanced Facebook scrape actions are reliable, safe, and consistent.

## Acceptance Criteria

**AC1 — Account Health Check (FR-55, NFR-11, NFR-13)**
1. `checkAccountHealth({ c_user, xs })` calls HTTP GET `https://www.facebook.com/` with the cookie.
2. Parses `fb_dtsg` from the HTML; validates `c_user` and `xs` from the response cookie jar.
3. Returns `{ status: 'active' | 'checkpoint' | 'dead', reason?, lastCheckAt }`.
4. `checkpoint` if body contains `/checkpoint/` or `confirm that you're human` / `security check`.
5. `dead` if `fb_dtsg` is missing or the cookie jar lacks `c_user`/`xs`.
6. Caches the result with a 5-minute TTL in `FacebookAccountHealth` (Prisma).
7. Cookie values are never logged.

**AC2 — Account Pool & Parallel Runner (FR-56, NFR-12, NFR-13, NFR-15)**
8. `FacebookAccountPool.runBatch(tasks, { maxConcurrency, delayBetweenLaunches, accountIds })` filters only `active` accounts from health cache.
9. Honors `FacebookAccount.encryptedProxy` if set (decrypt, parse, pass `proxy` + `proxyAuth`).
10. Assigns each task to a live account with matching proxy using round-robin / LRU.
11. Uses `p-limit` with `maxConcurrency` default 4 and maximum 8.
12. Waits `delayBetweenLaunches` (default 3-8s) between browser launches.
13. Builds `userDataDir` per `c_user`.
14. Retries a task on another live account if current one hits checkpoint.
15. Returns `results[]` and an `accountUsage` report.

**AC3 — Hydration JSON Extraction (FR-61, NFR-14)**
16. `extractHydrationJson(page, typenames)` collects all `<script type="application/json" data-content-len>` tags.
17. Recursively walks JSON for objects with matching `__typename`.
18. Supports `Story`, `Comment`, `User`, `Page`, `Group`, `MarketplaceListing`.
19. Falls back to DOM extraction if hydration data is insufficient.

**AC4 — Schema & Proxy CRUD (FR-56, NFR-13)**
20. Prisma migration adds `FacebookAccountHealth` model with `accountId` unique and `FacebookAccountHealthStatus` enum.
21. `FacebookAccount` gets `encryptedProxy` field.
22. `POST /api/facebook/accounts` accepts a plaintext `proxy` string and stores it as `encryptedProxy`.

## Tasks / Subtasks

- [x] **Task 1: Schema migration** (AC4)
  - [x] Update `prisma/schema.prisma` with `FacebookAccountHealthStatus` enum, `FacebookAccountHealth` model, `encryptedProxy` on `FacebookAccount`.
  - [x] Create and run migrations.
- [x] **Task 2: Account Health Service** (AC1)
  - [x] Create `api/services/facebookHealth.js` with `checkAccountHealth({ c_user, xs }, { force })`.
  - [x] Use `axios`, `buildCookieString`, `parseFacebookTokens` from `src/scrapers/facebook/graphql.js`.
  - [x] Cache with 5-minute TTL in `FacebookAccountHealth`.
- [x] **Task 3: Account Pool** (AC2)
  - [x] Create `api/services/facebookAccountPool.js` with `runBatch`.
  - [x] Add `p-limit@7.2.0` to `package.json` and run `npm install`.
  - [x] Implement active account filter, proxy affinity, round-robin/LRU, retry.
- [x] **Task 4: Hydration JSON Extraction** (AC3)
  - [x] Create `src/scrapers/facebook/hydration.js` with `extractHydrationJson(page, typenames)`.
  - [x] Use `page.evaluate` to collect scripts, walk JSON, DOM fallback.
- [x] **Task 5: Proxy CRUD** (AC4)
  - [x] Update `api/routes/facebookAccounts.js` `POST /` to accept and encrypt `proxy`.
  - [x] Add validation for flat proxy string.
- [x] **Task 6: Tests** (all ACs)
  - [x] `tests/services/facebookHealth.test.js`
  - [x] `tests/services/facebookAccountPool.test.js`
  - [x] `tests/scrapers/facebook/hydration.test.js`
  - [x] `tests/api/facebook-accounts.test.js`
  - [x] Run relevant vitest tests and ensure passing.

## Dev Notes

### Critical context

- **Runtime context:** Node.js library + API. Uses Puppeteer, Prisma, Express.
- **ESM only:** `import`/`export`.
- **No mocks rule:** Real implementations only. Tests may use fake `page`/`axios` seam by injecting functions, but no stubbing of internals.
- **Encryption:** Reuse `encrypt`/`decrypt` from `api/routes/facebookAccounts.js` for `encryptedProxy`.
- **Proxy parsing:** Use `parseFlatProxy` from `src/scrapers/facebook/proxy.js`.
- **Health check HTTP:** Must not launch browser. Use `axios` with `Cookie` header; response must carry `c_user`/`xs` cookies for validation.

### Files to modify / create

- `prisma/schema.prisma`
- `prisma/migrations/*` (via `npx prisma migrate dev`)
- `api/services/facebookHealth.js`
- `api/services/facebookAccountPool.js`
- `src/scrapers/facebook/hydration.js`
- `api/routes/facebookAccounts.js`
- `package.json`
- `tests/services/facebookHealth.test.js`
- `tests/services/facebookAccountPool.test.js`
- `tests/scrapers/facebook/hydration.test.js`
- `tests/api/facebook-accounts.test.js`

### References

- `src/scrapers/facebook/index.js` — `createBrowser`, `createPage`, `loginWithCookie`
- `src/scrapers/facebook/proxy.js` — `parseFlatProxy`
- `src/scrapers/facebook/graphql.js` — `buildCookieString`, `parseFacebookTokens`
- `api/routes/facebookAccounts.js` — `encrypt`/`decrypt`, `validateAccountBody`
- `_bmad-output/architecture-artifacts/epic7-2026-08-14/STORIES.md` — Story 7.1
- `_bmad-output/architecture-artifacts/epic7-2026-08-14/ARCHITECTURE-SPINE.md` — schema, story map

## Dev Agent Record

### Agent Model Used

swe-1.7-max

### Debug Log References

- npx prisma db push applied schema changes.
- Added p-limit dependency and installed.

### Completion Notes List

- Prisma schema updated with `FacebookAccountHealth` model/status enum, `encryptedProxy`, and `updatedAt` fields.
- `api/services/facebookHealth.js` created with browser-free HTTP health check, 5-minute Prisma cache, and `fetchImpl` seam.
- `api/services/facebookAccountPool.js` created with `p-limit` concurrency, proxy support, per-c_user profile dir, and checkpoint retry.
- `src/scrapers/facebook/hydration.js` created to extract Facebook hydration JSON by `__typename`.
- `api/routes/facebookAccounts.js` updated to validate and encrypt proxy on POST and PATCH.
- `src/scrapers/facebook/proxy.js` exported `parseFlatProxy` for route and pool reuse.
- Tests added for health, pool, hydration, and account proxy validation.
- Full test suite passed: 139 files, 3492 tests passed, 54 skipped.

### File List

- prisma/schema.prisma
- api/services/facebookHealth.js
- api/services/facebookAccountPool.js
- src/scrapers/facebook/hydration.js
- src/scrapers/facebook/proxy.js
- api/routes/facebookAccounts.js
- package.json
- package-lock.json
- tests/services/facebookHealth.test.js
- tests/services/facebookAccountPool.test.js
- tests/scrapers/facebook/hydration.test.js
- tests/api/facebook-accounts.test.js
- tests/scrapers/facebook-profile.test.js
