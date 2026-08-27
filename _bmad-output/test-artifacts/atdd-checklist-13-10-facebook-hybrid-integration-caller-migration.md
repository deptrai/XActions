---
storyId: "13.10"
storyKey: "13-10-facebook-hybrid-integration-caller-migration"
storyFile: "_bmad-output/implementation-artifacts/13-10-facebook-hybrid-integration-caller-migration.md"
atddChecklistPath: "_bmad-output/test-artifacts/atdd-checklist-13-10-facebook-hybrid-integration-caller-migration.md"
stepsCompleted:
  - 'step-01-preflight-and-context'
  - 'step-02-generation-mode'
  - 'step-03-test-strategy'
  - 'step-04-generate-tests'
  - 'step-04c-aggregate'
  - 'step-05-validate-and-complete'
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-08-27'
generatedTestFiles:
  - "tests/scrapers/social/facebook/caller-migration.test.js"
inputDocuments:
  - "_bmad-output/implementation-artifacts/13-10-facebook-hybrid-integration-caller-migration.md"
  - "_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md"
  - "src/scrapers/index.js"
  - "api/services/facebookScrape.js"
  - "src/mcp/server.js"
  - "src/cli/commands/scrape.js"
  - "src/cli/commands/automate.js"
  - "package.json"
  - "docs/deprecation-plan.md"
---

# ATDD Checklist — Story 13.10: Facebook Hybrid Integration & Caller Migration

## Test Scenarios & Acceptance Criteria Mapping

| ID | Category | Scenario Description | Priority | Test File | Target AC |
|---|---|---|:---:|---|:---:|
| **TS-13.10-01** | Unified Dispatch | `scrape('facebook', 'marketplace', options)` dispatches to `FacebookCrawler.start()` without Puppeteer page launch | P0 | `tests/scrapers/social/facebook/caller-migration.test.js` | AC-1, TR-1 |
| **TS-13.10-02** | Unified Dispatch | `scrape('facebook', 'search', options)` dispatches to `FacebookCrawler.search()` | P0 | `tests/scrapers/social/facebook/caller-migration.test.js` | AC-1, TR-1 |
| **TS-13.10-03** | Action Mapping | `scrape('facebook', 'posts', { url: '.../groups/...' })` resolves to `group_posts` | P0 | `tests/scrapers/social/facebook/caller-migration.test.js` | AC-2 |
| **TS-13.10-04** | Action Mapping | `scrape('facebook', 'posts', { url: '.../zuck' })` resolves to `page_posts` | P0 | `tests/scrapers/social/facebook/caller-migration.test.js` | AC-2 |
| **TS-13.10-05** | Error Handling | `scrape('facebook', 'unknown_action')` throws informative error with registered actions | P1 | `tests/scrapers/social/facebook/caller-migration.test.js` | AC-2 |
| **TS-13.10-06** | Scrape Service | `facebookScrape.run('marketplace', args)` dispatches to `FacebookCrawler.start()` directly | P0 | `tests/scrapers/social/facebook/caller-migration.test.js` | AC-3, TR-2 |
| **TS-13.10-07** | Scrape Service | `facebookScrape.runSearchAllParallel()` fans out 4 search categories using `FacebookCrawler` | P0 | `tests/scrapers/social/facebook/caller-migration.test.js` | AC-3, TR-2 |
| **TS-13.10-08** | MCP Scrapers | `executeFacebookScrapeTool` routes `x_facebook_marketplace` to `FacebookCrawler.marketplace()` | P0 | `tests/scrapers/social/facebook/caller-migration.test.js` | AC-5, TR-3 |
| **TS-13.10-09** | MCP Automation | `executeFacebookEpic4Tool` routes `share`, `join_groups`, `post_to_groups`, `send_friend_requests` to hybrid | P0 | `tests/scrapers/social/facebook/caller-migration.test.js` | AC-6, TR-3 |
| **TS-13.10-10** | CLI Scrape | `xactions scrape` supports extended actions: `marketplace`, `group_posts`, `group_comments` | P1 | `tests/scrapers/social/facebook/caller-migration.test.js` | AC-7, TR-4 |
| **TS-13.10-11** | CLI Automate | `xactions automate` supports `share`, `join-group`, `send-friend-request`, `messenger-share` | P1 | `tests/scrapers/social/facebook/caller-migration.test.js` | AC-7, TR-4 |
| **TS-13.10-12** | Action Discovery | `FacebookCrawler.listActions()` returns all registered actions with accurate `requiresAuth` | P1 | `tests/scrapers/social/facebook/caller-migration.test.js` | AC-8 |
| **TS-13.10-13** | Module Exports | `package.json` exports include `./scrapers/social` and `./scrapers/social/facebook` | P0 | `tests/scrapers/social/facebook/caller-migration.test.js` | AC-9, TR-5 |
| **TS-13.10-14** | Deprecation | Legacy `src/scrapers/facebook/index.js` has `@deprecated` banner | P2 | `tests/scrapers/social/facebook/caller-migration.test.js` | AC-10, TR-7 |
| **TS-13.10-15** | Deprecation Plan | `docs/deprecation-plan.md` tracker updated to `deprecated-marked` | P2 | `tests/scrapers/social/facebook/caller-migration.test.js` | AC-10, TR-7 |
| **TS-13.10-16** | Backward Compat | Write actions enforce `dryRun: true` default and no mutations without explicit flag | P0 | `tests/scrapers/social/facebook/caller-migration.test.js` | AC-12 |
| **TS-13.10-17** | Health Service | `api/services/facebookHealth.js` uses `FacebookClient` instead of legacy `graphql.js` | P1 | `tests/scrapers/social/facebook/caller-migration.test.js` | AC-13, TR-8 |

## Execution Status

- **Status:** GREEN PHASE COMPLETE (17/17 tests passing)
- **Test File:** `tests/scrapers/social/facebook/caller-migration.test.js`
- **Result:** All 17 ATDD unit/integration tests verified and passing.
- **Next Step:** Run `/bmad-code-review` to perform final review before merging into develop.

