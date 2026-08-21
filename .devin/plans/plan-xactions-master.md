# XActions Refactoring Master Plan

This plan tracks the multi-phase refactoring of the XActions Node/MCP/CLI codebase.

## Legend

- `[x]` — completed & verified
- `[~]` — in progress
- `[ ]` — pending

## Phase 0 — Contract, base tests, and TypeScript scaffolding

- [x] Add `connect(cdpUrl)` contract to `AbstractCrawler` and `BaseAdapter`
- [x] Add tests for `AbstractCrawler` and `BaseAdapter`
- [x] Create `tsconfig.json` for `src/core`

Status: completed.

## Phase 1 — Extract CLI commands from `src/cli/index.js`

- [x] Extract all CLI command groups into `src/cli/commands/*.js`
- [x] Reduce `src/cli/index.js` from ~2700 lines to a small orchestrator
- [x] Verify `npx vitest run tests/cli` passes
- [x] Verify `npm run typecheck` has only pre-existing errors (137)

Status: completed, committed, pushed (`main` includes the refactor).

## Phase 2 — Split `src/scrapers/facebook/index.js` into domain modules

- [x] Analyze `src/scrapers/facebook/index.js` (2920 lines) and define module boundaries
- [x] Extract `core.js` — constants, browser helpers, `createBrowser`, `createPage`, utilities
- [x] Extract `auth.js` — `loginWithCookie`, `loginWithPassword`, TOTP, warming integration
- [x] Extract `normalize.js` — normalizers, validators, URL builders, parsers
- [x] Extract `profile.js` — `scrapeProfile`, `scrapeMbasicProfile`
- [x] Extract `posts.js` — `scrapeTweets`, `scrapeMbasicPosts`, `scrapeFacebookGroupPosts`, `extractPostsFromDom`
- [x] Extract `comments.js` — `scrapeFacebookComments`, `scrapeFacebookGroupComments`
- [x] Extract `followers.js` — `scrapeFollowers`, `scrapeGroupMembers`
- [x] Extract `search.js` — `searchTweets`, `searchFacebook`, `searchByType`
- [x] Extract `marketplace.js` — `scrapeMarketplace`
- [x] Extract `group-search.js` — `scrapeFacebookGroupSearch`
- [x] Convert `src/scrapers/facebook/index.js` into a barrel file preserving all public exports and the default object
- [x] Update cross-module imports manually (fixed `normalizeHandle`, `assertFacebookUrlLocal`, `assertNoCheckpoint`)
- [x] Verification
  - `npx vitest run tests/scrapers` — 952 passed, 14 skipped
  - `npx vitest run tests/cli` — 129 passed
  - `npx vitest run tests/api/facebook-automate-routes.test.js` — 26 passed
  - `npm run typecheck` — 137 pre-existing errors, 0 new

Status: completed. Latest commit: `6f51792 — Split monolithic facebook scraper into domain-specific modules.`

## Phase 3 — Make `src/core` (and its `src/proxy`/`src/utils` dependencies) pass TypeScript strict checking

Context: the project runs as Node.js ESM (`package.json` uses `node src/...js` and `tsc --noEmit`). There is no TS transpilation/loader in place, so the immediate goal is to drive `npm run typecheck` to zero errors by adding JSDoc/TypeScript-compatible types to the existing `.js` source. Renaming files to `.ts` would require installing `tsx` or a build step; that remains a future Phase 4 option.

Objective: drive `npm run typecheck` down to zero errors starting from the 137 pre-existing errors (now 133 after the first batch of fixes).

- [x] 3.0 — Audit `src/core` and downstream dependencies (`src/proxy`, `src/utils/qrcode.js`) and group errors by root cause
- [x] 3.1 — Fix the first batch of leaf/pure contract errors:
  - `src/core/error-envelope.js` — typed `RETRYABLE_TYPES` as `Set<string>`, added `isRetryable` to `PlatformError` options, set `this.isRetryable` from options or compute it, removed the getter, used `Record<string, unknown>` for `details`
  - `src/core/types.js` — made `ActionDescriptor` fields optional (`description`, `requiredArgs`, `example`, `outputType`)
- [x] 3.2 — Type `metadata-schema-registry.js` and `action-registry.js`
  - `metadata-schema-registry.js` — added recursive `JsonSchema` JSDoc typedef, typed all
    `MetadataSchemaRegistry` methods and fields, cast unknown `JSON.parse` output, used
    `Record<string, unknown>` and `unknown[]` for data traversal
  - `action-registry.js` — guard `Map.get()` result before accessing `.descriptor`
- [x] 3.3 — Type core data modules (`account-pool.js`, `base-client.js`, `base-crawler.js`, `proxy-pool.js` providers)
- [x] 3.4 — Type controller/entry modules (`terminal-qr.js`, `qrcode.js`)
- [x] 3.5 — Add missing `.d.ts` declarations for untyped packages (`qrcode-terminal`)
- [x] 3.6 — Run `npm run typecheck` until zero errors
- [x] 3.7 — Run full test suite and fix any regressions

Status: completed. Latest commits: `22412d4`, `756377b`. `npm run typecheck` now passes with **0 errors**; `npx vitest run tests/core tests/cli` passes (250 tests).

## Phase 4 — Extend JSDoc types to the remaining `src/` tree

Context: `tsconfig.json` currently type-checks only `src/core/**/*.js`. Phase 4 progressively adds other `src/` directories to `include`, driving `tsc --noEmit` to zero for each slice. Files remain `.js` (no transpiler yet) and are typed via JSDoc.

- [ ] 4.0 — Expand `tsconfig.json` to `src/**/*.js` and record the initial error baseline
- [ ] 4.1 — Type `src/client` HTTP client modules (auth, CookieAuth, TokenManager, GraphQL queries, HTTP scraper)
- [ ] 4.2 — Type `src/scrapers` shared and adapter modules (adapters, shared, normalizers)
- [ ] 4.3 — Type `src/scrapers/facebook` domain modules (core, auth, posts, comments, etc.)
- [ ] 4.4 — Type `src/scrapers/twitter` modules
- [ ] 4.5 — Type `src/mcp` server and tool modules
- [ ] 4.6 — Type `src/api` routes and services
- [ ] 4.7 — Add missing `.d.ts` declarations for untyped dependencies used by the above slices
- [ ] 4.8 — Final `npm run typecheck` (entire `src`) and full `npx vitest run`

Status: in progress (starting from zero errors in `src/core`).

## Verification baseline

- Test: `npx vitest run tests/scrapers tests/cli`
- API smoke: `npx vitest run tests/api/facebook-automate-routes.test.js`
- Type: `npm run typecheck`
- Pre-existing type error baseline: **137 errors** (as of Phase 2 completion)
- Current type error count: **0 errors** (Phase 3 completed; `src/core` and direct dependencies pass `tsc --noEmit`)

## Notes

- This file was recreated during Phase 2 because `.devin/plans/` was not present in the repo. Commit it so the plan persists.
- Always commit and push as `nirholas <nich@xactions.app>`.
