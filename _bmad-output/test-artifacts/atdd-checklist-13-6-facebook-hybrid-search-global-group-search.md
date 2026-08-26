# ATDD Checklist — Story 13.6: Facebook Hybrid Search (Global + Group Search)

**Story ID:** `13.6`  
**Story Key:** `13-6-facebook-hybrid-search-global-group-search`  
**Epic:** 13 (High-Throughput Hybrid Scraping Engine — Twitter & Facebook Refactor)  
**Phase:** Red Phase Scaffold  
**Date:** 2026-08-28  
**Author:** Master Test Architect  

---

## 1. Acceptance Criteria Mapping & Test Status

| AC | Requirement Description | Test File & Test Description | Target Phase | Status |
|---|---|---|---|---|
| **AC-1** | `FacebookCrawler` extends `AbstractCrawler`; `search` and `group_search` actions registered in constructor; `listActions()` includes them | `tests/scrapers/social/facebook/crawler-search.test.js` > `[P0] should register search and group_search actions in ActionRegistry (AC-1)` | Action Registry | 🔴 RED |
| **AC-2** | `crawler.start({ action: 'search', args: { query, type, location, limit, cursor } })` returns `PostItem[]` for single type or `{ posts, people, pages, groups, pageInfo }` for `type: 'all'` | `tests/scrapers/social/facebook/crawler-search.test.js` > `[P0] should search posts/people/pages/groups and return PostItem[] with pageInfo (AC-2, AC-5, AC-6)` | Core Search | 🔴 RED |
| **AC-3** | `crawler.start({ action: 'group_search', args: { groupUrl, query, limit, cursor } })` resolves groupId, validates URL, returns `{ posts, pageInfo, note? }` | `tests/scrapers/social/facebook/crawler-search.test.js` > `[P0] should search inside a group and return posts with checkpoint (AC-3, AC-8)` | Group Search | 🔴 RED |
| **AC-4** | `FacebookClient.requestGraphQl()` dispatches search `doc_id` with `lsd`/`fb_dtsg`/`jazoest`/variables; falls back to SSR/browser on missing doc_id or error | `tests/scrapers/social/facebook/crawler-search.test.js` > `[P0] FacebookClient.requestGraphQl should POST correct search doc_id and tokens (AC-4)` | Dispatcher | 🔴 RED |
| **AC-5** | Namespaced IDs (`facebook:${externalId}`); all search results normalized to `PostItem` with `isSearchResult`, `searchType`, `query`, `resultType` metadata | `tests/scrapers/social/facebook/crawler-search.test.js` > `[P1] search results should have namespaced IDs and schema-valid metadata (AC-5, AC-10)` | Normalizer | 🔴 RED |
| **AC-6** | `type` ∈ `['posts','people','pages','groups','all']`; `location` appended to query; pagination via `pageInfo.has_next_page` / `end_cursor` | `tests/scrapers/social/facebook/crawler-search.test.js` > `[P0] should append location to query and support type all (AC-6)` | Search Types | 🔴 RED |
| **AC-7** | Input validation: non-empty query, valid type, positive limit ≤ 500; `groupUrl` SSRF guard rejects non-Facebook URLs | `tests/scrapers/social/facebook/crawler-search.test.js` > `[P0] should reject invalid type, empty query, and non-Facebook group URL (AC-7)` | Validation | 🔴 RED |
| **AC-8** | `PrismaStore.storeBatch` persists search results; `saveCheckpoint` with `targetType: 'search'` and deterministic `targetKey`; thin events emitted | `tests/scrapers/social/facebook/crawler-search.test.js` > `[P0] should persist search results and save checkpoint (AC-8)` | Storage & State | 🔴 RED |
| **AC-9** | `@deprecated` JSDoc added to `searchFacebook`, `searchTweets`, `scrapeFacebookGroupSearch`; `docs/deprecation-plan.md` updated | `docs/deprecation-plan.md` & legacy JSDoc review | Deprecation | 🔴 RED |
| **AC-10** | `schemas/facebook/social.json` accepts search result metadata; `metadataSchemaRegistry.validateMetadata` passes | `tests/scrapers/social/facebook/crawler-search.test.js` > `[P1] search result PostItem metadata should validate against facebook:social schema (AC-10)` | Schema | 🔴 RED |
| **AC-11** | Zero-mock compliance with realistic Node.js HTTP test server; new test file `crawler-search.test.js` created | `tests/scrapers/social/facebook/crawler-search.test.js` | Quality Gate | 🔴 RED |

---

## 2. Test Execution Commands

```bash
# Run Story 13.6 Search & Group Search test suite
npx vitest run tests/scrapers/social/facebook/crawler-search.test.js

# Run full Facebook hybrid regression test suite
npx vitest run tests/scrapers/social/facebook/

# Typecheck validation
npx tsc --noEmit
```

---

## 3. Red Phase Verification Sign-off

- [x] Test scaffolds created with deterministic assertions and realistic local test server.
- [x] Zero mocks / stubs / fakes used (strictly complies with AGENTS.md and CLAUDE.md).
- [x] All test cases in `crawler-search.test.js` intentionally fail with missing action handlers / normalizer functions before Story 13.6 implementation begins.
