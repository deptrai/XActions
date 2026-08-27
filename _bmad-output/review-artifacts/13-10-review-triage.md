# Code Review Triage — Story 13.10 Facebook Hybrid Integration & Caller Migration

**Review date:** 2026-08-28  
**Scope:** diff from `9521da09` to `HEAD` (`f13730bf` + `32c09102`)  
**Review layers:** Verification Gap (PASS/JSON), Acceptance Auditor (PASS/JSON), Edge Case Hunter (PASS/JSON), Blind Hunter (connection error, no artifact).  
**Verification:** `npx tsc --noEmit` (PASS), `npx vitest run tests/scrapers/social/facebook/caller-migration.test.js` (17/17 PASS).

## Applied Patches (committed with this review)

| Finding | File | Fix |
|---|---|---|
| `getArrayResult()` untyped + mis-maps `pages` to `posts` | `api/services/facebookScrape.js` | Added JSDoc types, made `posts`/`people` fallbacks key-specific, removed generic `val.posts` fallthrough. |
| GraphQL placeholder `fb_*` docIds no longer filtered | `src/scrapers/social/facebook/client.js` | Restored `!d.startsWith('fb_')` guard in `requestGraphQl` to avoid sending default placeholder doc IDs. |
| Read actions default to `requiresAuth: true` | `src/scrapers/social/facebook/crawler.js` | Added `requiresAuth: false` to `group_posts`, `get_comments`, `post_comments`, `group_comments`, `followers`, `following`, `group_members`, `group_search`. |
| `posts` -> `page_posts`/`group_posts` without resolving `pageId`/`groupId` | `src/scrapers/index.js` | `dispatchFacebookHybrid` now resolves `pageId`/`groupId`/`groupUrl` from `url`/`username` before calling `crawler.start`. |

## Deferred to Epic 20.2 / 13.10 Follow-up

- `POST /api/facebook/automate` still routes to legacy `facebookAutomation.js`.
- CLI `xactions automate` still runs legacy Puppeteer automation.
- MCP `executeFacebookAutomateTool` / `executeFacebookEpic4Tool` still use legacy helpers.
- `facebookAccountPool.runBatch` still launches Puppeteer pages.
- `facebookHealth.js` still uses raw `axios`, not `FacebookClient`.
- `types/index.d.ts` missing `FacebookCrawler`/`FacebookClient`/`FacebookActions` declarations.
- Legacy `src/scrapers/facebook/*.js` files (other than `index.js`) lack `@deprecated` headers.
- `src/scrapers/index.js` still imports/exports legacy `facebook` module and contains a dead-code Puppeteer branch.

See `deferred-work.md` for full ledger.

## AC Status from Acceptance Auditor

| AC | Status | Notes |
|---|---|---|
| AC-1 | PASS | `scrape('facebook'/'fb')` dispatches to `FacebookCrawler`. |
| AC-2 | PASS after patch | `posts` -> `page_posts`/`group_posts` resolution now resolves `pageId`/`groupId`. |
| AC-3 | PARTIAL | `facebookScrape.run()` still goes through `scrape()`; `runSearchAllParallel` multi-account path still uses `FacebookAccountPool` Puppeteer. |
| AC-4 | PARTIAL | `POST /scrape` OK; `POST /automate` legacy. |
| AC-5 | PARTIAL | `marketplace`/`group_members` OK via `facebookScrape.run`; other tools not fully verified. |
| AC-6 | FAIL | `x_facebook_automate` and Epic-4 tools not hybrid. |
| AC-7 | PARTIAL | CLI `scrape` OK; CLI `automate` legacy. |
| AC-8 | PARTIAL after patch | `listActions()` now reports correct `requiresAuth`; no `xactions actions` CLI command. |
| AC-9 | PARTIAL | `package.json` exports OK; type declarations missing. |
| AC-10 | PARTIAL | `index.js` and `docs/deprecation-plan.md` OK; other legacy files lack banners. |
| AC-11 | FAIL | Tests are weak smoke tests; several surfaces not actually invoked. |
| AC-12 | PARTIAL | `dryRun` default preserved; `messenger-share` still legacy. |
| AC-13 | FAIL | `/automate`, `facebookAutomation.js`, `facebookAccountPool.js`, `facebookHealth.js` not migrated. |

## Recommended Next Steps

1. Decide whether the remaining legacy caller surfaces (CLI/MCP/REST automate) are in 13.10 scope or deferred to Epic 20.2.
2. If 13.10 scope: migrate `executeFacebookAutomateTool`, `executeFacebookEpic4Tool`, `POST /automate`, and `xactions automate` to `FacebookCrawler.start()`.
3. If 20.2 scope: keep `sprint-status` at `needs-rework` until the deferred ledger is closed.
4. Add real integration tests that invoke the handlers and assert hybrid dispatch (not just module import).
