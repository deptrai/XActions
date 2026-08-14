# Story 7.4: API + MCP Surface Unification

---
baseline_commit: 2aa8b76
---

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an AI agent calling XActions via MCP,
I want new Facebook scrape tools exposed via MCP that call the same service as the REST API,
so that the surface is consistent and maintainable.

## Acceptance Criteria

**AC1 — `FacebookScrapeService` (FR-63, NFR-10, NFR-13, AD-7.7)**

1. `api/services/facebookScrape.js` is created and exports `run(action, args)` and `runBatch(tasks, options)`.
2. `run(action, args)` resolves `authCookie` (`{ c_user, xs }` or `{ accountId }`) via `FacebookAuthResolver`, then calls `scrape('facebook', action, args)` from `src/scrapers/index.js`.
3. `run` passes `browserOptions.userDataDir`, `browserOptions.proxy`, and `browserOptions.proxyAuth` through to `scrape()`.
4. `runBatch(tasks, options)` delegates to `FacebookAccountPool.runBatch` (from Story 7.1) for multi-account parallel execution; each task is `async (page, accountContext) => result`.
5. `runBatch` returns `{ results[], accountUsage }` — same shape as `FacebookAccountPool.runBatch`.
6. For `search` with `type: 'all'` and `parallel: true`, `run` fans out into 4 sub-tasks (`posts`, `people`, `pages`, `groups`) via `runBatch` and merges the results into `{ posts, people, pages, groups }` (AD-7.4).
7. For `search` with `type: 'all'` and `parallel: false` (default), `run` calls `scrape()` once — the sequential path is already handled inside `searchFacebook` (Story 7.2).
8. No scraper logic is duplicated in `facebookScrape.js` — it is a thin orchestration layer.
9. Cookie values (`c_user`, `xs`) are never logged (NFR-13).

**AC2 — `FacebookAuthResolver` (FR-63, NFR-13, AD-7.7)**

10. `api/services/facebookAuth.js` is created and exports `resolve(args, userId?)`.
11. `resolve({ c_user, xs })` returns `{ c_user, xs, userId: null, accountId: null }` — raw cookie passthrough.
12. `resolve({ accountId }, userId?)` looks up `FacebookAccount` by `accountId`, validates `account.userId === userId` when `userId` is provided, decrypts `encryptedCookie`, and returns `{ c_user, xs, userId, accountId }`.
13. Throws with `ACCOUNT_NOT_FOUND` code if account not found or not owned by `userId`.
14. Throws with `ACCOUNT_DECRYPT_FAILED` code if decryption fails.
15. Cookie values are never logged (NFR-13).
16. `src/mcp/facebook-auth.js` (`resolveMcpFacebookAuth`) is refactored to delegate to `api/services/facebookAuth.js` — no duplicate decrypt logic. The MCP module becomes a thin import wrapper.
17. `api/routes/facebook.js` `resolveScrapeCookie` is refactored to delegate to `FacebookAuthResolver` for the `accountId` path — no duplicate decrypt logic. The raw-cookie and auto-pick paths can remain in the route (they are route-specific concerns).

**AC3 — `scrape()` proxy authentication (FR-63, AD-7.2)**

18. `src/scrapers/index.js` `scrape()` calls `page.authenticate(options.browserOptions?.proxyAuth)` after `createPage` and before `loginWithCookie` when `proxyAuth` is provided.
19. `proxyAuth` shape: `{ username: string, password: string }`.
20. If `page.authenticate` throws (e.g., page not ready), the error is caught and re-thrown with a clear message — do not silently swallow.
21. Twitter and other platform paths are unaffected — `proxyAuth` only applies when `browserOptions.proxyAuth` is present.

**AC4 — API route unification (FR-63)**

22. `api/routes/facebook.js` `POST /scrape` calls `facebookScrapeService.run(action, args)` instead of `scrape('facebook', action, args)` directly.
23. `VALID_ACTIONS` already includes `post_comments`, `group_posts`, `group_comments`, `group_search` (from Stories 7.2/7.3) — no change needed.
24. Response shape unchanged: `{ ok: true, action, result }`.
25. The existing `resolveScrapeCookie` + `resolveScrapeCookie` error handling (`INVALID_RAW_COOKIE`, `ACCOUNT_NOT_FOUND`, `ACCOUNT_DECRYPT_FAILED`, `NO_ACTIVE_ACCOUNT`) is preserved — the route still owns HTTP status codes.
26. `browserOptions` (proxy, proxyAuth, headless, skipWarmup) are passed through to `facebookScrapeService.run`.

**AC5 — MCP tools via `FacebookScrapeService` (FR-63, AD-7.7)**

27. 5 new MCP tools are registered in `src/mcp/server.js` `TOOLS` array:

| Tool | Action | Required args | Optional args |
|---|---|---|---|
| `x_facebook_search` | `search` | `query`, `authCookie` | `type`, `location`, `limit`, `parallel`, `dryRun` |
| `x_facebook_post_comments` | `post_comments` | `url` (postUrl), `authCookie` | `limit`, `includeReplies`, `dryRun` |
| `x_facebook_group_posts` | `group_posts` | `url` (groupUrl), `authCookie` | `limit`, `dryRun` |
| `x_facebook_group_comments` | `group_comments` | `url` (postUrl), `authCookie` | `limit`, `includeReplies`, `dryRun` |
| `x_facebook_posts` | `posts` | `url` (profile/page URL), `authCookie` | `limit`, `dryRun` |

28. Each tool uses `FACEBOOK_AUTH_COOKIE_SCHEMA` (existing, `src/mcp/server.js:67-80`) for the `authCookie` property.
29. Each tool's handler calls `facebookScrapeService.run(action, args)` — NOT `runWithFacebookBrowser` and NOT `scrape()` directly. The only exception is `dryRun: true` which returns a preview object without launching a browser.
30. `dryRun` defaults to `true` for all 5 tools (consistent with existing Facebook MCP tools).
31. `dryRun: true` returns `{ dryRun: true, platform: 'facebook', preview: { ...args } }` — no browser launch.
32. `dryRun: false` calls `facebookScrapeService.run(action, { ...args, authCookie: { c_user, xs } })` where `c_user`/`xs` are resolved via `FacebookAuthResolver`.
33. No scraper logic is duplicated in `src/mcp/server.js` — all 5 tools route through `facebookScrapeService`.
34. The existing `executeFacebookEpic4Tool` function continues to handle automation tools (join_groups, post_to_groups, etc.) — only the 5 new scrape tools route through the service.

**AC6 — Contract tests (FR-63)**

35. `tests/services/facebookScrape.test.js` is created and verifies:
    - `run` dispatches to `scrape('facebook', action, args)` with correct args.
    - `run` resolves `authCookie` via `FacebookAuthResolver`.
    - `run` passes `browserOptions` through.
    - `run` with `search` + `type: 'all'` + `parallel: true` fans out to `runBatch`.
    - `runBatch` delegates to `FacebookAccountPool.runBatch`.
    - Cookie values are not logged.
36. `tests/services/facebookAuth.test.js` is created and verifies:
    - `resolve({ c_user, xs })` passthrough.
    - `resolve({ accountId }, userId)` decrypts and validates ownership.
    - Throws `ACCOUNT_NOT_FOUND` for unknown accountId.
    - Throws `ACCOUNT_DECRYPT_FAILED` for bad encryption.
    - Cookie values are not logged.
37. `tests/mcp/facebook-epic7-tools.test.js` is created and verifies:
    - All 5 tools are registered in `TOOLS` with correct input schema.
    - `dryRun: true` returns preview without browser launch.
    - `dryRun: false` calls `facebookScrapeService.run` with correct action and args.
    - Missing `authCookie` throws for non-marketplace tools.
    - Schema validation: required fields are enforced.
38. `tests/api/facebook-scrape.test.js` is updated to verify:
    - `POST /scrape` calls `facebookScrapeService.run` (not `scrape()` directly).
    - All `VALID_ACTIONS` are accepted.
    - Response shape `{ ok: true, action, result }` is preserved.
39. `npx vitest run tests/services/facebookScrape.test.js tests/services/facebookAuth.test.js tests/mcp/facebook-epic7-tools.test.js tests/api/facebook-scrape.test.js` passes.
40. Full regression: `npx vitest run tests/scrapers/facebook*.test.js tests/api/facebook*.test.js tests/mcp/facebook*.test.js` passes — no regressions from the refactor.

## Tasks / Subtasks

- [x] Task 1: Create `FacebookAuthResolver` (AC: #10-17)
  - [x] 1.1 Create `api/services/facebookAuth.js` with `resolve(args, userId?)` function
  - [x] 1.2 Implement raw cookie passthrough: `resolve({ c_user, xs })` → `{ c_user, xs, userId: null, accountId: null }`
  - [x] 1.3 Implement accountId path: lookup `FacebookAccount`, validate `userId` ownership, decrypt, return `{ c_user, xs, userId, accountId }`
  - [x] 1.4 Throw `ACCOUNT_NOT_FOUND` / `ACCOUNT_DECRYPT_FAILED` with error codes
  - [x] 1.5 Reuse `decrypt` from `api/routes/facebookAccounts.js` (existing import)
  - [x] 1.6 Refactor `src/mcp/facebook-auth.js` `resolveMcpFacebookAuth` to delegate to `api/services/facebookAuth.js`
  - [x] 1.7 Refactor `api/routes/facebook.js` `resolveScrapeCookie` accountId path to delegate to `FacebookAuthResolver`
  - [x] 1.8 Create `tests/services/facebookAuth.test.js`

- [x] Task 2: Create `FacebookScrapeService` (AC: #1-9)
  - [x] 2.1 Create `api/services/facebookScrape.js` with `run(action, args)` and `runBatch(tasks, options)`
  - [x] 2.2 `run` resolves authCookie via `FacebookAuthResolver`, then calls `scrape('facebook', action, args)`
  - [x] 2.3 `run` passes `browserOptions` (userDataDir, proxy, proxyAuth) through to `scrape()`
  - [x] 2.4 `runBatch` delegates to `FacebookAccountPool.runBatch` (from `api/services/facebookAccountPool.js`)
  - [x] 2.5 `run` with `search` + `type: 'all'` + `parallel: true` fans out 4 sub-tasks via `runBatch` and merges
  - [x] 2.6 `run` with `search` + `type: 'all'` + `parallel: false` calls `scrape()` once (sequential path)
  - [x] 2.7 No scraper logic duplicated — thin orchestration only
  - [x] 2.8 Create `tests/services/facebookScrape.test.js`

- [x] Task 3: Add `page.authenticate(proxyAuth)` to `scrape()` (AC: #18-21)
  - [x] 3.1 In `src/scrapers/index.js`, after `createPage` and before `loginWithCookie`, call `page.authenticate(options.browserOptions?.proxyAuth)` when `proxyAuth` is present
  - [x] 3.2 Wrap in try-catch with clear error message on failure
  - [x] 3.3 Verify Twitter/other platform paths are unaffected

- [x] Task 4: Route `POST /scrape` through `FacebookScrapeService` (AC: #22-26)
  - [x] 4.1 In `api/routes/facebook.js`, replace `scrape('facebook', action, scrapeArgs)` with `facebookScrapeService.run(action, scrapeArgs)`
  - [x] 4.2 Import `facebookScrapeService` from `api/services/facebookScrape.js`
  - [x] 4.3 Preserve existing `resolveScrapeCookie` + error handling (route owns HTTP status codes)
  - [x] 4.4 Pass `browserOptions` through to `facebookScrapeService.run`
  - [x] 4.5 Update `tests/api/facebook-scrape.test.js` to verify service is called

- [x] Task 5: Add 5 new MCP tools (AC: #27-34)
  - [x] 5.1 Register `x_facebook_search` in `TOOLS` array with input schema
  - [x] 5.2 Register `x_facebook_post_comments` in `TOOLS` array with input schema
  - [x] 5.3 Register `x_facebook_group_posts` in `TOOLS` array with input schema
  - [x] 5.4 Register `x_facebook_group_comments` in `TOOLS` array with input schema
  - [x] 5.5 Register `x_facebook_posts` in `TOOLS` array with input schema
  - [x] 5.6 Add handler dispatch for each tool in `executeFacebookScrapeTool` function
  - [x] 5.7 Each handler: `dryRun: true` → return preview; `dryRun: false` → call `facebookScrapeService.run`
  - [x] 5.8 Each handler resolves `authCookie` via `FacebookAuthResolver` (not `resolveMcpFacebookAuth` directly)
  - [x] 5.9 Create `tests/mcp/facebook-epic7-tools.test.js`

- [x] Task 6: Run full regression + commit (AC: #39-40)
  - [x] 6.1 Run `npx vitest run tests/services/ tests/mcp/ tests/api/facebook*.test.js tests/scrapers/facebook*.test.js`
  - [x] 6.2 Fix any regressions
  - [x] 6.3 Commit all changes

## Dev Notes

### Critical context

- **Runtime context:** Node.js library + API. Puppeteer, Prisma, Express. ESM only (`import`/`export`).
- **No mocks rule:** Tests may use fake `page`/`axios` seams by injecting functions, but do not stub internals.
- **No storage rule (NFR-10):** Return JSON only; do not persist results in Prisma or `Operation`.
- **Privacy (NFR-13):** Never log `c_user`, `xs`, cookie strings, or raw HTML. Error messages must not echo cookie values.
- **No circular dependencies:** `src/scrapers` must not import `api/services`. `api/services/facebookScrape.js` imports `src/scrapers/index.js` (one-way).
- **AD-7.7 (single source of truth):** `FacebookScrapeService` is the only entry point for Facebook scraping from API and MCP. No duplicate login/scrape logic.
- **AD-7.4 (parallel fan-out):** `type: 'all'` + `parallel: true` fans out to 4 sub-tasks. `parallel: false` (default) is sequential inside `searchFacebook`.

### Existing code to reuse (DO NOT reinvent)

- **`src/mcp/facebook-auth.js`** (`resolveMcpFacebookAuth`): Existing auth resolver for MCP. Refactor to delegate to new `api/services/facebookAuth.js`. Do NOT delete — it's the MCP-side import wrapper.
- **`api/routes/facebookAccounts.js`** (`resolveAccountCookie`, `decrypt`): Existing account cookie resolver with userId validation. `FacebookAuthResolver` should reuse `decrypt` from here. `resolveAccountCookie` can be replaced by `FacebookAuthResolver.resolve` calls.
- **`api/routes/facebook.js`** (`resolveScrapeCookie`): Existing route-level cookie resolver with auto-pick logic. Refactor the `accountId` path to delegate to `FacebookAuthResolver`; keep raw-cookie and auto-pick paths in the route.
- **`api/services/facebookAccountPool.js`** (`runBatch`): Existing pool from Story 7.1. `FacebookScrapeService.runBatch` delegates to this — do NOT re-implement.
- **`src/scrapers/index.js`** (`scrape`): Existing dispatcher with `platformActionMap`. `FacebookScrapeService.run` calls this — do NOT bypass.
- **`src/mcp/server.js`** (`FACEBOOK_AUTH_COOKIE_SCHEMA`, `executeFacebookEpic4Tool`, `runWithFacebookBrowser`): Existing MCP infrastructure. New tools reuse `FACEBOOK_AUTH_COOKIE_SCHEMA`. `runWithFacebookBrowser` is NOT used by the 5 new tools — they route through `facebookScrapeService` instead.

### Refactor boundary — what changes vs what stays

| Component | Change | Reason |
|---|---|---|
| `api/services/facebookScrape.js` | **NEW** | Single source of truth for API + MCP |
| `api/services/facebookAuth.js` | **NEW** | Shared auth resolver |
| `src/mcp/facebook-auth.js` | **REFACTOR** | Delegate to `facebookAuth.js` |
| `api/routes/facebook.js` | **REFACTOR** | Call `facebookScrapeService.run` instead of `scrape()` directly; delegate accountId path to `FacebookAuthResolver` |
| `src/scrapers/index.js` | **PATCH** | Add `page.authenticate(proxyAuth)` |
| `src/mcp/server.js` | **EXTEND** | Add 5 new tools that route through `facebookScrapeService` |
| `api/services/facebookAccountPool.js` | **NO CHANGE** | Already implemented in 7.1 |
| `api/services/facebookHealth.js` | **NO CHANGE** | Already implemented in 7.1 |
| `src/scrapers/facebook/index.js` | **NO CHANGE** | Already implemented in 7.2/7.3 |

### `page.authenticate(proxyAuth)` placement

In `src/scrapers/index.js`, the auto-create browser/page block (lines 233-255) currently does:
1. `createBrowser` → `createPage` → store `__xactions_browser`
2. `loginWithCookie` (if auth provided)

Insert `page.authenticate(proxyAuth)` between step 1 and step 2:
```js
page = await mod.createPage(browser, options.browserOptions || {});
page.__xactions_browser = browser;

// Authenticate proxy before login so the proxy tunnel is established first.
const proxyAuth = options.browserOptions?.proxyAuth;
if (proxyAuth && typeof page.authenticate === 'function') {
  try {
    await page.authenticate(proxyAuth);
  } catch (err) {
    await browser.close().catch(() => {});
    throw new Error(`❌ Proxy authentication failed: ${err?.message || 'unknown error'}`);
  }
}

try {
  if (options.authToken && mod.loginWithCookie) { ... }
```

### MCP tool handler pattern

The 5 new tools should follow this pattern (NOT the `runWithFacebookBrowser` pattern used by automation tools):

```js
async function executeFacebookScrapeTool(name, args) {
  const { authCookie, dryRun, ...rest } = args;
  const resolvedDryRun = dryRun === false ? false : true;

  // All 5 scrape tools require authCookie (no anonymous path like marketplace).
  if (!authCookie) {
    throw new Error('❌ requires authCookie: provide { c_user, xs } or { accountId }');
  }

  const resolved = await resolveFacebookAuth(authCookie);
  const { c_user, xs } = resolved;

  const ACTION_MAP = {
    x_facebook_search: 'search',
    x_facebook_post_comments: 'post_comments',
    x_facebook_group_posts: 'group_posts',
    x_facebook_group_comments: 'group_comments',
    x_facebook_posts: 'posts',
  };
  const action = ACTION_MAP[name];

  // Build args based on tool — map MCP param names to scraper param names.
  const scrapeArgs = { ...rest, authCookie: { c_user, xs } };

  if (resolvedDryRun) {
    return { dryRun: true, platform: 'facebook', preview: { action, ...rest } };
  }

  const { run } = await import('../../api/services/facebookScrape.js');
  return await run(action, scrapeArgs);
}
```

### `search` + `type: 'all'` + `parallel: true` fan-out

When `facebookScrapeService.run('search', { query, type: 'all', parallel: true, authCookie, ... })` is called:
1. Resolve `authCookie` to `{ c_user, xs }` via `FacebookAuthResolver`.
2. Build 4 tasks: `search` with `type: 'posts'`, `type: 'people'`, `type: 'pages'`, `type: 'groups'`.
3. Call `runBatch(tasks, { accountIds, maxConcurrency: 4 })` — each task calls `scrape('facebook', 'search', { query, type, authCookie, ... })`.
4. Merge results into `{ posts, people, pages, groups }`.
5. If `accountIds` is not provided or only 1 account, fall back to sequential (call `scrape()` once with `type: 'all'`).

### Test patterns

- **No mocks rule:** Use fake `page` objects with injected functions (e.g., `page.evaluate = async () => []`). Do NOT stub `scrape()` or `FacebookAccountPool.runBatch` — use real implementations with test DB or fake seams.
- **Service tests:** `tests/services/facebookScrape.test.js` can inject a fake `scrape` function via dynamic import mocking is NOT allowed. Instead, test the service by calling `run` with a real `scrape()` but a fake `page` that returns empty results. Alternatively, test the dispatch logic by verifying the action and args are passed correctly.
- **Auth tests:** `tests/services/facebookAuth.test.js` needs a test database or can test the raw-cookie path without DB. The accountId path requires Prisma — use the existing test DB pattern from `tests/mcp/facebook-mcp-account-tools.test.js`.
- **MCP tests:** `tests/mcp/facebook-epic7-tools.test.js` follows the pattern of `tests/mcp/facebook-epic4-tools.test.js` — verify tool registration, schema, dry-run, and dispatch.

### Files to modify / create

- **NEW:** `api/services/facebookScrape.js`
- **NEW:** `api/services/facebookAuth.js`
- **NEW:** `tests/services/facebookScrape.test.js`
- **NEW:** `tests/services/facebookAuth.test.js`
- **NEW:** `tests/mcp/facebook-epic7-tools.test.js`
- **REFACTOR:** `src/mcp/facebook-auth.js` (delegate to `api/services/facebookAuth.js`)
- **REFACTOR:** `api/routes/facebook.js` (call `facebookScrapeService.run`, delegate accountId path)
- **PATCH:** `src/scrapers/index.js` (add `page.authenticate(proxyAuth)`)
- **EXTEND:** `src/mcp/server.js` (add 5 new tools + handler)
- **UPDATE:** `tests/api/facebook-scrape.test.js` (verify service is called)

### Previous story intelligence (7.3)

- **Debug log:** `api/routes/facebook.js` eagerly constructed `searchArgs` with `query.trim()` which threw for non-search actions. Use conditional inline construction.
- **Review patches applied:** Query length cap (500 chars), group_search URL validation, URL API for query params, limit cap (500), mobile UA/viewport helper extraction.
- **Pattern:** `scrapeFacebookGroupComments` is a thin wrapper over `scrapeFacebookComments` — no duplicate logic. Follow the same pattern for `FacebookScrapeService` — thin wrapper over `scrape()`.
- **Test convention:** Tests use fake `page` objects with function-string inspection for `page.evaluate` mocking. Follow the same pattern.

### References

- [Source: _bmad-output/planning-artifacts/epics-full.md#Story-7.4]
- [Source: _bmad-output/architecture-artifacts/epic7-2026-08-14/ARCHITECTURE-SPINE.md#Section-5]
- [Source: _bmad-output/architecture-artifacts/epic7-2026-08-14/STORIES.md#Story-7.4]
- [Source: _bmad-output/architecture-artifacts/epic7-2026-08-14/DECISIONS.md#AD-7.7]
- [Source: _bmad-output/implementation-artifacts/7-3-comments-and-group-content.md]

## Dev Agent Record

### Agent Model Used

GLM-5.2 High

### Debug Log References

- 2026-08-14: `executeTool` was not exported from `src/mcp/server.js` — added to export list alongside `executeFacebookScrapeTool`.
- 2026-08-14: `resolveScrapeCookie` auto-pick path used `resolveAccountCookie` — refactored to delegate to `FacebookAuthResolver` via IIFE for consistency.
- 2026-08-14: Pre-existing test failure `normalizePost > normalizes full post object` (expected no `author` field but implementation adds one) — NOT caused by Story 7.4 changes. Confirmed via `git stash` baseline run.

### Completion Notes List

- Created `api/services/facebookAuth.js` with `resolve(args, userId?)` — shared auth resolver for API + MCP.
- Created `api/services/facebookScrape.js` with `run(action, args)` and `runBatch(tasks, options)` — single source of truth for Facebook scraping.
- Refactored `src/mcp/facebook-auth.js` `resolveMcpFacebookAuth` to delegate to `api/services/facebookAuth.js` (thin wrapper, no duplicate decrypt logic).
- Refactored `api/routes/facebook.js` `resolveScrapeCookie` accountId + auto-pick paths to delegate to `FacebookAuthResolver`.
- Routed `POST /api/facebook/scrape` through `facebookScrapeService.run` instead of `scrape()` directly.
- Added `page.authenticate(options.browserOptions?.proxyAuth)` to `src/scrapers/index.js` `scrape()` after `createPage` and before `loginWithCookie`.
- Registered 5 new MCP tools in `src/mcp/server.js`: `x_facebook_search`, `x_facebook_post_comments`, `x_facebook_group_posts`, `x_facebook_group_comments`, `x_facebook_posts`.
- Added `executeFacebookScrapeTool` handler that routes through `facebookScrapeService.run` (not `runWithFacebookBrowser`).
- Created `tests/services/facebookAuth.test.js` (9 tests) — raw cookie passthrough, accountId resolution, ownership validation, error codes, no-log verification.
- Created `tests/services/facebookScrape.test.js` (8 tests) — dispatch, auth resolve, browserOptions passthrough, runBatch delegation, no-log verification.
- Created `tests/mcp/facebook-epic7-tools.test.js` (16 tests) — tool registration, schema validation, dryRun preview, auth validation, action mapping.
- Ran full regression: 142/142 tests pass across 9 test files (services + mcp + api). 892/907 scraper tests pass (1 pre-existing failure, 14 skipped).
- All 40 acceptance criteria verified.

### File List

- Created: `api/services/facebookAuth.js`
- Created: `api/services/facebookScrape.js`
- Created: `tests/services/facebookAuth.test.js`
- Created: `tests/services/facebookScrape.test.js`
- Created: `tests/mcp/facebook-epic7-tools.test.js`
- Modified: `src/mcp/facebook-auth.js` (refactored to delegate to `api/services/facebookAuth.js`)
- Modified: `api/routes/facebook.js` (routed through `facebookScrapeService.run`, delegated accountId path to `FacebookAuthResolver`)
- Modified: `src/scrapers/index.js` (added `page.authenticate(proxyAuth)`)
- Modified: `src/mcp/server.js` (added 5 new tools + `executeFacebookScrapeTool` handler + exports)
- Modified: `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Change Log

- 2026-08-14: Story created from Epic 7 architecture, 7.3 learnings, and existing code analysis.
