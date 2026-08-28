# ATDD Checklist — Story 13.5: Facebook Hybrid Profile, Followers & Group Members

**Story ID:** `13.5`  
**Story Key:** `13-5-facebook-hybrid-profile-followers-group-members`  
**Epic:** 13 (High-Throughput Hybrid Scraping Engine — Twitter & Facebook Refactor)  
**Phase:** Red Phase Scaffold  
**Date:** 2026-08-27  
**Author:** Master Test Architect  

---

## 1. Acceptance Criteria Mapping & Test Status

| AC | Requirement Description | Test File & Test Description | Target Phase | Status |
|---|---|---|---|---|
| **AC-1** | `FacebookCrawler` extends `AbstractCrawler` (`requiresAuth = true`, `platform = 'facebook'`); `FacebookClient` extends `AbstractApiClient` (`client = 'got'`, `requiresAuth = true`) | `tests/scrapers/social/facebook/crawler-profile.test.js` > `[P0] FacebookCrawler and FacebookClient should inherit base contracts and require auth (AC-1)` | Contract | 🔴 RED |
| **AC-2** | Register `profile`, `followers`, `following`, `group_members` actions in `ActionRegistry` with descriptors | `tests/scrapers/social/facebook/crawler-profile.test.js` > `[P0] should register profile, followers, following, group_members actions in ActionRegistry (AC-2)` | Action Registry | 🔴 RED |
| **AC-3** | `FacebookClient.requestGraphQl()` acts as dispatcher with doc_ids / LSD / DTSG / spin tokens and handles doc_id rotation | `tests/scrapers/social/facebook/crawler-profile.test.js` > `[P0] FacebookClient should dispatch GraphQL queries with dynamic security tokens (AC-3)` | Dispatcher | 🔴 RED |
| **AC-4** | `crawler.start({ action: 'profile', args: { username|url } })` extracts profile, returns `ProfileItem` (`id: facebook:${externalId}`) with bio, avatar, followersCount | `tests/scrapers/social/facebook/crawler-profile.test.js` > `[P0] should crawl profile by username or URL and return normalized ProfileItem (AC-4, AC-7)` | Core Crawler | 🔴 RED |
| **AC-5** | `crawler.start({ action: 'followers', args: { username, limit } })` paginates via cursor and returns `ProfileItem[]`; `following` is best-effort | `tests/scrapers/social/facebook/crawler-profile.test.js` > `[P0] should crawl followers with cursor pagination and handle following gracefully (AC-5, AC-7)` | Pagination | 🔴 RED |
| **AC-6** | `crawler.start({ action: 'group_members', args: { groupUrl, limit } })` parses groupId, validates URL via SSRF guard, returns `ProfileItem[]` | `tests/scrapers/social/facebook/crawler-profile.test.js` > `[P0] should crawl group_members with URL resolution and SSRF guard (AC-6, AC-7)` | Group Scraper | 🔴 RED |
| **AC-7** | Namespaced ID format (`facebook:${externalId}`) and `ProfileItem` contract validation | `tests/scrapers/social/facebook/crawler-profile.test.js` > `[P1] normalizeFacebookProfile, normalizeFacebookFollower, normalizeFacebookGroupMember should enforce namespaced ID (AC-7)` | Normalizer | 🔴 RED |
| **AC-8** | PrismaStore mapping (`PostItem` with `publishedAt: null`, category `social`) and checkpoint recording (`saveCheckpoint`) | `tests/scrapers/social/facebook/crawler-profile.test.js` > `[P0] should persist profiles as PostItem batches to PrismaStore and save crawl checkpoint (AC-8)` | Storage & State | 🔴 RED |
| **AC-9** | Deprecation markers on legacy `scrapeProfile`, `scrapeFollowers`, `scrapeGroupMembers` | `docs/deprecation-plan.md` & legacy JSDoc review | Deprecation | 🔴 RED |
| **AC-10**| Zero-mock compliance with realistic Node.js HTTP test server | All tests in `tests/scrapers/social/facebook/crawler-profile.test.js` | Quality Gate | 🔴 RED |

---

## 2. Test Execution Commands

```bash
# Run Story 13.5 Profile, Followers & Group Members test suite
npx vitest run tests/scrapers/social/facebook/crawler-profile.test.js

# Run full Facebook regression test suite
npx vitest run tests/scrapers/social/facebook/

# Typecheck validation
npx tsc --noEmit
```

---

## 3. Red Phase Verification Sign-off

- [x] Test scaffolds created with deterministic assertions and realistic local test server.
- [x] Zero mocks / stubs / fakes used (strictly complies with `AGENTS.md` and `CLAUDE.md`).
- [x] All 8 test cases in `crawler-profile.test.js` intentionally fail with missing action handlers / normalizer functions before Story 13.5 implementation begins.
