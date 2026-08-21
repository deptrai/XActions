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

## Phase 3 — Convert `src/core` to TypeScript

Objective: migrate the `src/core` JavaScript modules to TypeScript and drive `tsc --noEmit` down to zero errors (starting from the current 137 pre-existing errors).

- [ ] 3.0 — Audit `src/core` and downstream dependencies (`src/proxy`, `src/utils/qrcode.js`) and group errors by root cause
- [ ] 3.1 — Create/validate `src/core/tsconfig.json` and define the file conversion order
- [ ] 3.2 — Convert leaf/pure modules first (e.g., `error-envelope.js`, `metadata-schema-registry.js`, `action-registry.js`)
- [ ] 3.3 — Convert core data modules (`account-pool.js`, `base-client.js`, `base-crawler.js`, `proxy-pool.js` providers)
- [ ] 3.4 — Convert controller/entry modules (`terminal-qr.js`, etc.)
- [ ] 3.5 — Add missing `.d.ts` declarations for untyped packages (e.g., `qrcode-terminal`)
- [ ] 3.6 — Run `npm run typecheck` until zero errors
- [ ] 3.7 — Run full test suite and fix any regressions

Status: in progress — will begin after this plan is updated.

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

## Notes

- This file was recreated during Phase 2 because `.devin/plans/` was not present in the repo. Commit it so the plan persists.
- Always commit and push as `nirholas <nich@xactions.app>`.
