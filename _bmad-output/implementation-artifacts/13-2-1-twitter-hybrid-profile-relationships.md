---
story_id: '13.2.1'
epic: 13
story_key: '13-2-1-twitter-hybrid-profile-relationships'
status: "done"
phase: "Phase 2"
created: 2026-08-28
updated: 2026-08-31
last_updated: 2026-08-31
owner: "DEV"
reviewed: "approved"
baseline_commit: "a35aaac828b6d8593dcf39be412ff1dc18ca1417"
---

# Story 13.2.1 — Twitter Hybrid Profile & Relationships

Status: done

### Senior Developer Review (AI)

**Review Outcome:** Approved (Clean review)  
**Date:** 2026-08-31  
**Summary:**
- Đã đăng ký đầy đủ 7 action (`profile`, `followers`, `following`, `likers`, `retweeters`, `list_members`, `non_followers`) trong `TwitterCrawler`.
- Tách normalizer module độc lập `src/scrapers/social/twitter/normalize-relationships.js`.
- Hỗ trợ phân giải username/url an toàn, deduplicate followers/following và tính toán `non_followers` / `mutuals`.
- Tất cả 7/7 tests tại `crawler-profile-relationships.test.js` passed 100%.

## Story

As a **Twitter Growth Marketer**,  
I want **cào hồ sơ, followers, following, likers, retweeters, non-followers và thành viên list bằng `TwitterClient`/`TwitterCrawler` kiến trúc hybrid**,  
so that **tôi có thể xây dựng audience graph và phân tích mối quan hệ mà không cần mở Puppeteer tab mới**.

---

## Tasks / Subtasks

- [x] **Task 1 — Khởi tạo module `src/scrapers/social/twitter/` (AC-1, AC-2)**
  - [x] 1.1 Tạo `src/scrapers/social/twitter/index.js` export `TwitterClient`, `TwitterCrawler`, `TwitterPlatformResponseValidator`, normalizer helpers
  - [x] 1.2 Tạo `src/scrapers/social/twitter/client.js` — `TwitterClient` extends `AbstractApiClient`
  - [x] 1.3 Tạo `src/scrapers/social/twitter/crawler.js` — `TwitterCrawler` extends `AbstractCrawler`, đăng ký 7 action
  - [x] 1.4 Tạo `src/scrapers/social/twitter/validator.js` — `TwitterPlatformResponseValidator` extends `AbstractPlatformResponseValidator`

- [x] **Task 2 — Triển khai `TwitterClient` GraphQL + signing (AC-2)**
  - [x] 2.1 Import `GRAPHQL`, `DEFAULT_FEATURES`, `buildGraphQLUrl`, `buildGraphQLVariables`, `USER_AGENTS`, `BEARER_TOKEN` từ `src/scrapers/twitter/http/endpoints.js`
  - [x] 2.2 Implement `requestGraphQl(queryId, operationName, variables, options)` build URL, headers, cookie
  - [x] 2.3 Implement `signTransactionId(method, path)` dùng `SignerWorkerPagePool.evaluate`
  - [x] 2.4 Tích hợp `PreSignedTokenRing` cho guest token `gt`/`ct0` và auth token `auth_token`/`ct0`
  - [x] 2.5 Cấu hình `client = 'got'`, `platform = 'twitter'`, `requiresProxy = true`, `requiresAuth = true`

- [x] **Task 3 — Triển khai normalizers (AC-4)**
  - [x] 3.1 `normalizeUserProfile` và `profileItemToPostItem` trong `normalize-relationships.js`
  - [x] 3.2 `normalizeLikersResponse` hỗ trợ `favoriters_timeline`, `user.timeline`, `retweeters_timeline`

- [x] **Task 4 — Triển khai handlers `TwitterCrawler` (AC-3)**
  - [x] 4.1 `profile(args, session)` → gọi `UserByScreenName` hoặc `UserByRestId`
  - [x] 4.2 `followers(args, session)` → `Followers` GraphQL + paginate + dedup + checkpoint
  - [x] 4.3 `following(args, session)` → `Following` GraphQL + paginate + dedup + checkpoint
  - [x] 4.4 `likers(args, session)` → `Likes` GraphQL + paginate
  - [x] 4.5 `retweeters(args, session)` → `Retweeters` GraphQL + paginate
  - [x] 4.6 `list_members(args, session)` → `ListMembers` GraphQL + `resolveListId`
  - [x] 4.7 `non_followers(args, session)` → gọi nội bộ `followers` + `following`, tính set difference

- [x] **Task 5 — Lưu trữ và metadata schema (AC-4)**
  - [x] 5.1 `profileItemToPostItem` trả về `category: 'social'` và `metadata.tweetId = externalId`
  - [x] 5.2 `schemas/twitter/social.json` hỗ trợ profile metadata
  - [x] 5.3 `this.#persistPostItems(posts)` sau mỗi page

- [x] **Task 6 — Deprecation markers (AC-5)**
  - [x] 6.1 Thêm `@deprecated` cho legacy methods trong `src/scrapers/twitter/index.js`
  - [x] 6.2 Cập nhật `docs/deprecation-plan.md`

- [x] **Task 7 — Kiểm thử (AC-6)**
  - [x] 7.1 Tạo `tests/scrapers/social/twitter/crawler-profile-relationships.test.js`
  - [x] 7.2 Mock GraphQL responses cho `UserByScreenName`, `Followers`, `Following`, `Retweeters`
  - [x] 7.3 Kiểm tra `listActions()` chứa 7 actions
  - [x] 7.4 All tests pass 100%
