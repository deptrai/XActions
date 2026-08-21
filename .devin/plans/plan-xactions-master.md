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
- [ ] 3.3 — Type core data modules (`account-pool.js`, `base-client.js`, `base-crawler.js`, `proxy-pool.js` providers)
- [ ] 3.4 — Type controller/entry modules (`terminal-qr.js`, etc.)
- [ ] 3.5 — Add missing `.d.ts` declarations for untyped packages (e.g., `qrcode-terminal`)
- [ ] 3.6 — Run `npm run typecheck` until zero errors
- [ ] 3.7 — Run full test suite and fix any regressions

Current status: in progress. Type errors reduced from **137** to **115**; `npx vitest run tests/core` passes (121 passed).

## Phase 4 — Convert remaining source tree to TypeScript

- [ ] Convert `src/scrapers` (twitter, facebook modules, etc.)
- [ ] Convert `src/client` HTTP client modules
- [ ] Convert `src/mcp` server modules
- [ ] Convert `src/api` routes and services
- [ ] Update root `tsconfig.json` to include the whole `src` tree
- [ ] Final `npm run typecheck` and full test run

Status: pending (details to be refined in Phase 3).

## Verification baseline

- Test: `npx vitest run tests/scrapers tests/cli`
- API smoke: `npx vitest run tests/api/facebook-automate-routes.test.js`
- Type: `npm run typecheck`
- Pre-existing type error baseline: **137 errors** (as of Phase 2 completion)
- Current type error count: **133 errors** (after Phase 3.1 fixes in `error-envelope.js` and `types.js`)

## Notes

- This file was recreated during Phase 2 because `.devin/plans/` was not present in the repo. Commit it so the plan persists.
- Always commit and push as `nirholas <nich@xactions.app>`.
