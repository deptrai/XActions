# Epic 13 Retrospective: High-Throughput Hybrid Scraping Engine (Twitter & Facebook Refactor)

Status: done  
Date: 2026-09-08

## Summary

Epic 13 là **largest epic** — refactor toàn bộ Twitter và Facebook scraper sang hybrid architecture (`AbstractCrawler`/`AbstractApiClient`). Gồm 17 sub-stories (13.1, 13.2.1-13.2.17, 13.3-13.10).

Epic complete across:

| Story | Status | Outcome |
|---|---|---|
| 13.1 Tiered Signer Architecture | done | Token ring worker pool |
| 13.2.1-13.2.17 Twitter Hybrid features | done | Profile, threads, search, media, lists, DMs, scheduler, social graph, v.v. |
| 13.3 Facebook Hybrid refactor | done | `FacebookCrawler` trên `AbstractCrawler` |
| 13.4 Facebook Browser-as-Signer | done | Browser cung cấp signed request |
| 13.5-13.9 Facebook features | done | Profile/followers, search, comments, marketplace, actions |
| 13.10 Facebook integration caller migration | done | `src/scrapers/index.js` dispatcher |

Final verification: nhiều test suites cho Twitter + Facebook, số lượng tests lớn nhất codebase.

**Epic 13 đã merge toàn bộ vào main/develop qua nhiều worktree.**

## What Went Well

1. **Hybrid architecture thay thế legacy hoàn toàn**
   - `AbstractCrawler`/`AbstractApiClient` giúp Twitter/FB share pattern với các platform khác.
   - Token ring worker pool phân tán rate limit.

2. **Sub-stories split rõ ràng**
   - 17 sub-stories cho Twitter giúp parallelize work.
   - Mỗi feature có file test riêng.

3. **Worktree workflow**
   - Nhiều story được implement trong worktree riêng, merge qua PR.
   - Giảm conflict khi nhiều feature song song.

## What Was Difficult

1. **Scope khổng lồ**
   - 17 Twitter stories + 5 Facebook stories.
   - GraphQL schema migration (13.2.13) yêu cầu audit 55 action (13.2.14).

2. **Twitter GraphQL schema drift**
   - `graphql.js` legacy bị kill (`0aa4aa2e`).
   - 55-action audit tốn effort.

3. **Facebook browser-as-signer**
   - Browser phải authenticate rồi cung cấp signed request.
   - Cookie/headless synchronization phức tạp.

4. **Guest auth research**
   - Twitter guest search (13.2.15) là research story.
   - Không phải lúc nào cũng ổn định.

## Key Decisions

1. **Kill legacy `graphql.js` + `facebookAutomation.js`**
   - `test: kill graphql.js + facebookAutomation.js mutants (+67 tests)`.
   - Move to hybrid architecture.

2. **Browser-as-signer pattern**
   - Facebook dùng Puppeteer để lấy signed request.
   - Sau đó gọi HTTP APIs.

3. **Caller migration**
   - `src/scrapers/index.js` unified dispatcher.
   - Old `src/client/` sẽ decommission trong Epic 20/26.

## Follow-up Recommendations

1. **Epic 20 decommission legacy**
   - `src/client/`, `src/scrapers/twitter/`, `src/scrapers/facebook/`, `src/scrapers/threads/`, `src/scrapers/twitter/http/` cần remove.
   - Chờ Epic 13-18 complete.

2. **Twitter GraphQL schema monitor**
   - Schema thay đổi thường xuyên — cần canary.

3. **Facebook integration tests real**
   - Cần real cookie test cho Facebook actions.

## Final State

- Epic 13 status: **done**
- All 17 Twitter sub-stories + 5 Facebook stories: **done**
- Retrospective: **done**
- Hybrid architecture ready cho Epic 15, 17, 18, 21, 22
