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

- [x] 4.0 — Expand `tsconfig.json` to `src/client/**/*.js` and record the initial error baseline
- [x] 4.1 — Type `src/client` HTTP client modules
- [x] 4.2 — Type `src/scrapers/twitter/http` modules + `src/scrapers/twitter/validator.js`
- [x] 4.3 — Type `src/scrapers/adapters` modules
- [x] 4.4 — Type `src/scrapers/twitter/index.js`
- [x] 4.5 — Type `src/scrapers/facebook` domain modules and coupled `api/lib/prisma.js` + `api/services/facebookAutomation.js`
  - Added JSDoc types across `src/scrapers/facebook/*.js` and updated `src/types/facebook.d.ts`.
  - Typed `api/lib/prisma.js` and `api/services/facebookAutomation.js`.
  - `npm run typecheck` now passes with **0 errors** for the full `tsconfig.json` include list.
  - Fixed vitest regressions: `normalizeFollower` and `normalizeSearchResult` now coerce empty strings to `null`.
- [x] 4.6 — Type `src/scrapers/bluesky`, `src/scrapers/mastodon`, `src/scrapers/threads`
  - Added JSDoc `@typedef` types for clients, options, and response data; used `Record<string, unknown>` and `import('puppeteer')` / `import('@atproto/api')` references.
  - Replaced `path.reduce` in Bluesky `xrpc` with a typed `for` loop and `Record<string, unknown>` casts.
  - Fixed `puppeteer.launch` `headless` expression in Threads to `options.headless === false ? false : true` (semantics preserved, type-safe).
  - Annotated fetch `headers` in Mastodon as `Record<string, string>` and internal `api` helper as `Promise<unknown>` to allow downstream casts.
  - `npm run typecheck` now passes with **0 errors**.
  - `npx vitest run tests/scrapers tests/cli` passes (1081 passed, 14 skipped).
- [x] 4.7 — Type `src/scrapers/index.js` and `src/index.js` / `src/algorithmBuilder.js`
  - Added JSDoc types across `src/algorithmBuilder.js` (actions, scraping, session flow).
  - Added `VisibleTweet`, `VisibleUser`, `Persona*`, `ThreadItem`, `TierInfo`, and other types to `src/types/xactions.d.ts`.
  - Typed `src/scrapers/index.js` page-launch helpers and `__xactions_browser` extension.
  - Fixed barrel re-exports in `src/index.js` and added JSDoc for `browserScripts`, `managers`, `plugins`.
  - Also typed the root manager files (`articlePublisher`, `bookmarkManager`, `businessTools`, `creatorStudio`, `discoveryExplore`, `dmManager`, `engagementManager`, `grokIntegration`, `notificationManager`, `pollCreator`, `postComposer`, `premiumManager`, `profileManager`, `settingsManager`, `spacesManager`) and `src/personaEngine.js`.
  - `npm run typecheck` passes with **0 errors**.
- [x] 4.8 — Type `src/plugins/loader.js` and `src/plugins/manager.js`
  - Replaced `Object` JSDoc with `Record<string, unknown>`, casted page-evaluate results, and resolved plugin registry unknowns.
  - `tests/plugins/loader.test.js` passes (17 tests).
- [ ] 4.9 — Type `src/api` (Prisma, services, routes) and `src/workflows`
- [ ] 4.10 — Type `src/mcp` server and tools
- [ ] 4.11 — Type remaining `src/{agents,ai,a2a,analytics,streaming,utils,automation}`
- [ ] 4.12 — Add missing `.d.ts` declarations for untyped dependencies
- [ ] 4.13 — Final `npm run typecheck` (entire `src` + `api`) and full `npx vitest run`

Status: Phase 4.7 and 4.8 completed. `src/scrapers/index.js`, `src/index.js`, `src/algorithmBuilder.js`, root manager files, `src/personaEngine.js`, and `src/plugins/loader.js`/`manager.js` are now typed. `npm run typecheck` passes with **0 errors** and targeted `npx vitest run tests/plugins/loader.test.js tests/scrapers/facebook-index.test.js` passes (151 tests).

## Verification baseline

- Test: `npx vitest run tests/scrapers tests/cli`
- API smoke: `npx vitest run tests/api/facebook-automate-routes.test.js`
- Type: `npm run typecheck`
- Pre-existing type error baseline: **137 errors** (as of Phase 2 completion)
- Current type error count: **0 errors** for the full `tsconfig.json` include list (`src/core`, `src/client`, `src/scrapers/twitter`, `src/scrapers/facebook`, `src/scrapers/adapters`, `src/scrapers/bluesky`, `src/scrapers/mastodon`, `src/scrapers/threads`, `src/types`, `api/lib/prisma.js`, `api/services/facebookAutomation.js`).

## Notes

- This file was recreated during Phase 2 because `.devin/plans/` was not present in the repo. Commit it so the plan persists.
- Always commit and push as `nirholas <nich@xactions.app>`.
