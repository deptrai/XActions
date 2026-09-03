---
title: "Sprint Change Proposal — Twitter GraphQL Schema Migration, 55-Action Audit, Scraper Fixes & Frontend UI/UX"
date: 2026-09-02
status: draft
scope: major
---

# Sprint Change Proposal

**Date:** 2026-09-02  
**Project:** XActions  
**Triggering issue:** `TwitterCrawler` 55-action audit phát hiện GraphQL schema mới của X/Twitter đã loại bỏ `legacy` object, khiến các normalizer cũ trả dữ liệu rỗng/null và guest action trả 404. Đồng thời user yêu cầu fix frontend UI/UX, real-data scraper test cho Mastodon/Bluesky/Facebook, và commit.

---

## Section 1 — Issue Summary

### Problem statement
Trong quá trình audit toàn bộ 55 actions của `TwitterCrawler` (Story 13.2, Epic 13), phát hiện các vấn đề sau:

1. **Twitter GraphQL schema mới (tháng 09/2026)** đã thay thế object `legacy` bằng các trường mới:
   - User: `core.name`, `core.screen_name`, `profile_bio.description`, `relationship_counts.followers/following`, `avatar.image_url`, `website.url`, `privacy.protected`, `is_blue_verified`.
   - Tweet: `core.user_results.result.core.*`, `note_tweet.text`, `tweet_counts.*`, `views.count`.
   Hiện tại `parseTweetData` (`src/scrapers/twitter/http/tweets.js`), `parseUserEntry` (`src/scrapers/twitter/http/relationships.js`), `crawler.js` `profile` handler, và `normalize-search.js` vẫn trích `legacy.*`, dẫn đến profile/mèdia/thread trả dữ liệu rỗng hoặc 404.

2. **Twitter guest search bị khóa:** `SearchTimeline` với guest token trả 404. User nhấn mạnh "scape twitter k cần thiết phải có account, nghiên cứu thêm di". Cần nghiên cứu workaround (auth cookie, REST adaptive, syndication, Playwright bridge).

3. **Proxy hiện tại trong `.env` chết:** `sg.premium.socksnode.com:9000` timeout/404, khiến test qua proxy fail. Cần proxy mới hoặc direct connection cho test local.

4. **Mastodon `scrapeTweets(null)` crash** do thiếu guard username, **Bluesky `searchTweets` 403** do cần app-password, **Facebook `human.js`** cần chạy lại test.

5. **Frontend dashboard:** 45 trang HTML cần audit; `sidebar.js` navigation dùng href không đúng file (`/platforms/facebook` thay vì `facebook.html`), mobile bottom nav cần media query, toast/skeleton cần tách thành shared JS, CORS/layout overflow cần fix.

### Evidence
- Inspect `UserByScreenName` guest: `legacy` không còn, `core`/`relationship_counts`/`profile_bio`/`avatar`/`website` có dữ liệu.
- `UserTweets` entries: `core.user_results.result.core.name/screen_name` thay vì `legacy`.
- `code-review-graph` `detect_changes`: 7 files thay đổi, 4 test gaps (`AbstractApiClient`, `bluesky.searchTweets`, `mastodon.createClient`, `mastodon.lookupAccount`).
- Git status: `src/scrapers/facebook/human.js`, `src/scrapers/mastodon/index.js`, `src/scrapers/bluesky/index.js`, `src/scrapers/social/twitter/client.js`, `src/scrapers/social/twitter/crawler.js`, `src/scrapers/twitter/http/endpoints.js`, `src/scrapers/twitter/http/query-id-resolver.js` đang modified.

---

## Section 2 — Impact Analysis

### Epic impact
| Epic | Impact | Required change |
|------|--------|-----------------|
| **Epic 13** (Twitter/Facebook refactor) | **Major** — Story 13.2 tuy status "done" nhưng normalizer chưa đúng schema mới. | Mở lại / bổ sung sub-stories 13.2.13 (schema migration), 13.2.14 (55-action audit), 13.2.15 (guest search research). |
| **Epic 15** (Threads, TikTok) | Minor | Ít ảnh hưởng trực tiếp; chỉ cần lưu ý normalizer pattern khi implement sau. |
| **Epic 19** (Admin dashboard) | Moderate | Frontend fixes trong dashboard ảnh hưởng admin/operator UI. |
| **Epic 23–26** (Bluesky/Mastodon universal, utility consolidation, dispatcher, legacy decommission) | Major | Bluesky/Mastodon cần auth/null fixes; `src/scrapers/index.js` dispatcher cần test với `TwitterCrawler` mới. Decommission chỉ an toàn sau khi audit pass. |

### Story impact
| Story | Current status | Change needed |
|-------|----------------|---------------|
| 13.2 | done | Reopen/add sub-stories vì schema mới phá vỡ AC-2 (namespaced model persistence dữ liệu đúng shape). |
| 13.2.1–13.2.12 | done | Cần regression test sau khi sửa normalizer. |
| 23.1 (Bluesky adapter) | backlog | Nâng priority; cần fix `searchTweets` auth. |
| 23.2 (Mastodon adapter) | backlog | Nâng priority; cần fix `scrapeTweets` null guard. |
| 19.x (dashboard) | in progress / backlog | Cần include UI/UX fixes trong scope. |

### Artifact conflicts
| Artifact | Conflict / update needed |
|----------|--------------------------|
| **PRD** `prd.md` | FR-71 (Twitter Crawler Refactor) cần clarify: "no API fees" không đồng nghĩa "no auth for all actions". Cần note search/hashtag/spaces guest hiện tại bị khóa và đang nghiên cứu workaround. FR-89/FR-90 (Bluesky/Mastodon) cần ghi rõ auth requirement cho search/optional auth. |
| **Architecture Spine** `ARCHITECTURE-SPINE.md` | AD-2 (Unified Base Scraper): cập nhật hướng dẫn parse Twitter schema mới. AD-3 (Proxy): cần proxy mới hoặc direct mode. AD-4 (Storage): metadata schema cần bao gồm `avatar`, `relationship_counts`, `website`. |
| **Story 13.2 artifact** `13-2-refactor-twitter-scraper-to-hybrid-architecture.md` | Status "done" không còn đúng; cần update thành "in progress" hoặc "approved with schema remediation pending". |
| **Implementation artifacts** `6-4-human-physics-easing-motion-curves.md`, `sprint-status.yaml` | `sprint-status.yaml` cần cập nhật trạng thái Story 13.2 và các story mới. |
| **Dashboard / UX** | `sidebar.js`, `common.css`, `config.js`, toast/skeleton cần refactor. |

### Technical impact
- `src/scrapers/twitter/http/tweets.js` — thay đổi logic `parseTweetData` (author, metrics, text, createdAt, media).
- `src/scrapers/twitter/http/relationships.js` — thay đổi `parseUserEntry`.
- `src/scrapers/social/twitter/crawler.js` — sửa `profile` handler + audit 55 action.
- `src/scrapers/social/twitter/normalize-search.js` — sửa `userEntryToProfileItem`.
- `src/scrapers/bluesky/index.js` — app-password login cho fetch client.
- `src/scrapers/mastodon/index.js` — null guard + username validation.
- `src/scrapers/facebook/human.js` — test regression.
- `dashboard/js/sidebar.js`, `dashboard/css/common.css`, `dashboard/js/config.js` — navigation + shared components.

---

## Section 3 — Recommended Approach

### Selected approach
**Hybrid: Option 1 (Direct Adjustment) + partial Option 3 (MVP clarify).**

Không rollback (Option 2) vì refactor hybrid đã đúng hướng, chỉ cần fix schema và audit.

### Rationale
- **Giữ momentum:** Story 13.2 đã đầu tư lớn; sửa normalizer nhanh hơn refactor lại.
- **Rủi ro kiểm soát được:** Schema migration có phạm vi rõ ràng; 55-action audit giúp xác định guest vs auth.
- **MVP clarify:** Nếu không tìm được guest search workaround, PRD cần ghi rõ search/hashtag cần auth cookie hoặc Playwright session, thay vì giữ yêu cầu "không cần account" như một hard constraint.

### Effort estimate
- **High** — ước tính 2–3 ngày làm việc: schema migration (4–6h), 55-action audit (4–6h), Mastodon/Bluesky/Facebook fixes (3–4h), frontend UI/UX (4–6h), real-data tests + commit (2–3h).

### Risk assessment
| Risk | Level | Mitigation |
|------|-------|------------|
| Twitter tiếp tục thay đổi schema | Medium | Dùng `query-id-resolver.js`, thiết kế normalizer fallback `legacy`/`core`. |
| Không tìm được guest search workaround | High | Cải thiện error message, đề xuất auth cookie/CDP, ghi rõ trong PRD. |
| Proxy chết ảnh hưởng test | Medium | Dùng direct connection cho local test; yêu cầu proxy mới cho production. |
| Frontend 45 trang rất rộng | Medium | Phase 1 chỉ fix navigation/shared CSS/JS/mobile; audit chi tiết từng trang sau. |

---

## Section 4 — Detailed Change Proposals

### 4.1 Story changes

#### Story 13.2 — Refactor Twitter Scraper to Hybrid Architecture
**Section:** Status & Acceptance Criteria  
**OLD:**
```
status: done
reviewed: approved
Summary: Umbrella refactor Story 13.2 đã hoàn thành trọn vẹn... Toàn bộ unit/integration test suites đã được triển khai và pass 100%.
```
**NEW:**
```
status: in_progress
reviewed: approved with schema remediation
Summary: Hybrid architecture hoàn thành. Tuy nhiên, Twitter GraphQL schema mới (09/2026) đã loại bỏ `legacy` object; cần sub-stories 13.2.13–13.2.15 để cập nhật normalizer, audit 55 action, và nghiên cứu guest search. Các AC cũ vẫn giữ, thêm AC mới:
- AC-5: `parseTweetData`, `parseUserEntry`, `normalizeUserProfile`, `userEntryToProfileItem` phải đọc được từ `core`/`profile_bio`/`relationship_counts`/`avatar`/`website` khi `legacy` vắng.
- AC-6: `TwitterCrawler.profile`, `media`, `thread` hoạt động với guest token trên account public.
- AC-7: 55 action được audit với trạng thái guest/auth/blocker.
- AC-8: `search`/`hashtag`/`spaces` trả error message rõ ràng khi guest 404; có prototype/proposal cho no-account search.
```
**Rationale:** Phản ánh thực tế phát hiện trong audit; không rollback toàn bộ refactor.

#### New sub-story: 13.2.13 — Twitter GraphQL Schema Migration
**Section:** New story  
**Content:**
```
As a Twitter Crawler maintainer,
I want `parseTweetData`, `parseUserEntry`, and `normalizeUserProfile` to support the new `core`-based GraphQL schema,
so that profile, timeline, thread, and search results produce correct `PostItem`/`ProfileItem`.

Acceptance Criteria:
- Given a `UserByScreenName` response with `core`/`profile_bio`/`relationship_counts`/`avatar` and no `legacy`, `profile` returns correct `ProfileItem`.
- Given a `UserTweets` response with `core.user_results.result.core` and `note_tweet`, `parseTweetData` returns correct text, author, metrics, media.
- Given a `SearchTimeline` response with new people/tweet entries, `userEntryToProfileItem` and `tweetToPostItem` still work.
- Backward compatible with old `legacy` schema if Twitter A/B tests it.
```

#### New sub-story: 13.2.14 — TwitterCrawler 55-Action Guest/Auth Audit
**Section:** New story  
**Content:**
```
As a platform engineer,
I want to audit all 55 registered TwitterCrawler actions,
so that each action has a documented `requiresAuth` flag, endpoint/queryId, and guest vs auth status.

Acceptance Criteria:
- Table of all 55 actions with: name, handler, requiresAuth (registered), actual guest status, blocker, next step.
- Guest audit script runs `profile`, `media`, `thread`, `trending`, `search`, `hashtag`, `spaces`, `download_video` without auth and logs status.
- Auth audit runs with test session/cookie if available; otherwise mark "blocked — needs session".
- Actions requiring auth throw clear `XACT_4010` with `suggestedAction: 'relogin'` when called without session.
```

#### New sub-story: 13.2.15 — Twitter Search Without Account Research
**Section:** New story  
**Content:**
```
As a product owner,
I want a research spike on no-account Twitter search,
so that we can determine if `search`/`hashtag` can work without auth cookie.

Acceptance Criteria:
- Evaluate: (a) auth cookie + `gt`, (b) `x.com/i/api/2/search/adaptive.json`, (c) `syndication.twimg.com`, (d) Playwright/Signer bridge.
- Document feasibility, risk, and effort for each option.
- Implement prototype if any option is viable within 1 day; otherwise update PRD to require auth for search.
```

#### Story 23.1 — Bluesky AT Protocol Scraper
**Section:** Acceptance Criteria  
**OLD:**
```
- search works with public API
```
**NEW:**
```
- search works with public API OR requires app-password login; fetch client must support `com.atproto.server.createSession` and reuse `accessJwt`.
- `searchTweets` throws clear error when credentials missing.
```

#### Story 23.2 — Mastodon REST API Scraper
**Section:** Acceptance Criteria  
**OLD:**
```
- scrapeTweets returns posts for a valid username
```
**NEW:**
```
- scrapeTweets validates username (non-empty string) and throws `TypeError` with clear message if null/empty.
- lookupAccount guards `a.acct`/`a.username` null.
```

### 4.2 PRD modifications

**PRD `prd.md` — Section 3 (FR-71)**  
**OLD:**
```
FR-71 (Twitter Crawler Refactor): Tái cấu trúc bộ cào Twitter trong `src/scrapers/social/twitter/` tuân thủ kiến trúc `AbstractCrawler` và `BaseHybridClient`.
```
**NEW:**
```
FR-71 (Twitter Crawler Refactor): Tái cấu trúc bộ cào Twitter trong `src/scrapers/social/twitter/` tuân thủ kiến trúc `AbstractCrawler` và `BaseHybridClient`. Bộ cào phải thích ứng với GraphQL schema mới của X/Twitter (bỏ `legacy` object, dùng `core`/`profile_bio`/`relationship_counts`/`avatar`/`website`). Public actions (`profile`, `media`, `thread`, `trending`, `download_video`) hoạt động với guest token. `search`/`hashtag`/`spaces` có thể yêu cầu auth cookie nếu X/Twitter đã khóa guest endpoint; cần có error message rõ ràng và research spike no-account search.
```

**PRD `prd.md` — Section 7.1 (FR-89)**  
**OLD:**
```
FR-89 (Bluesky AT Protocol Scraper): ... hỗ trợ optional auth.
```
**NEW:**
```
FR-89 (Bluesky AT Protocol Scraper): ... hỗ trợ optional auth. `searchTweets` yêu cầu app-password login để gọi `app.bsky.feed.searchPosts`; fetch client phải tự động login qua `com.atproto.server.createSession` khi `identifier`/`password` được cung cấp.
```

**PRD `prd.md` — Section 7.1 (FR-90)**  
**OLD:**
```
FR-90 (Mastodon REST API Scraper): ... hỗ trợ optional `accessToken`.
```
**NEW:**
```
FR-90 (Mastodon REST API Scraper): ... hỗ trợ optional `accessToken`. Tất cả public endpoint phải validate username trước khi lookup để tránh crash với null/empty input.
```

### 4.3 Architecture modifications

**Architecture Spine `ARCHITECTURE-SPINE.md` — AD-2**  
**OLD:**
```
Rule 2: `start()` nhận một `CrawlerCommand` object `{ action, args, session }`...
```
**NEW:**
```
Rule 2: `start()` nhận một `CrawlerCommand` object `{ action, args, session }`...
Rule 2a: Normalizer layer (`parseTweetData`, `parseUserEntry`) phải hỗ trợ schema dự phòng (fallback `legacy` → `core`/`note_tweet`/`profile_bio`/`relationship_counts`/`avatar`/`website`) để thích ứng với GraphQL schema mới của X/Twitter. Mỗi platform-specific parser nên tự động fallback giữa các field name thay vì hard-code một schema duy nhất.
```

**Architecture Spine — AD-3 Rule 3b example**  
**NEW note:**
```
Note: No-auth Twitter guest requests currently require a healthy proxy. If the configured proxy pool is dead, the test/development pipeline may fall back to direct connection; production must use a validated proxy provider.
```

### 4.4 UI/UX modifications

No separate UX doc exists; changes live in code:
- `dashboard/js/sidebar.js`: map nav hrefs to actual HTML files; fix mobile bottom nav active state.
- `dashboard/css/common.css`: add mobile media query, fix layout overflow (`overflow-x: auto`, `word-break: break-word`), standardize toast/skeleton CSS.
- `dashboard/js/toast.js` (new) and `dashboard/js/skeleton.js` (new): shared toast and skeleton loader components.
- `dashboard/js/config.js`: centralize `API_BASE`, auth token, CORS origin.
- `api/server.js` (or relevant CORS config): ensure dashboard origin allowed.

---

## Section 5 — Implementation Handoff

### Scope classification
**Moderate to Major.** Cần Developer agent implement, Product Owner/Architect review PRD/epic changes, và tester chạy real-data tests.

### Handoff recipients
| Role | Responsibility |
|------|----------------|
| **Developer agent** | Implement schema migration, normalizer fixes, 55-action audit script, Mastodon/Bluesky/Facebook fixes, frontend navigation/shared CSS/JS. |
| **Product Owner / Architect** | Review/approve PRD FR-71/89/90 updates; approve Epic 13 sub-stories; ghi rõ no-account search constraint. |
| **QA / Tester** | Chạy real-data scripts, unit/integration tests, dashboard E2E. |
| **User (Luisphan)** | Cung cấp proxy mới nếu cần; cung cấp Twitter auth cookie/session nếu muốn test auth actions; phê duyệt Sprint Change Proposal. |

### Success criteria
- `TwitterCrawler.profile('nasa')` guest trả về profile đầy đủ fields.
- `TwitterCrawler.media({ username: 'nasa' })` guest trả về posts.
- 55-action audit table hoàn thành.
- Mastodon `scrapeTweets(null)` throw rõ ràng thay vì crash.
- Bluesky `searchTweets` với fetch client + app-password hoạt động.
- Facebook `human.js` tests pass.
- Frontend navigation hoạt động đúng trên index/run/analytics/docs pages.
- `vitest run` pass (các test liên quan).
- Commit pushed as `nirholas`.

---

## Section 6 — Action Items

1. **(DEV) Update normalizers:** `src/scrapers/twitter/http/tweets.js`, `src/scrapers/twitter/http/relationships.js`, `src/scrapers/social/twitter/crawler.js:1289`, `src/scrapers/social/twitter/normalize-search.js`.
2. **(DEV) Create audit scripts:** `scripts/audit-twitter-guest.mjs`, `scripts/audit-twitter-auth.mjs` (nếu có cookie).
3. **(DEV) Fix Mastodon/Bluesky/Facebook:** `src/scrapers/mastodon/index.js`, `src/scrapers/bluesky/index.js`, chạy `vitest run tests/scrapers/facebook-human.test.js`.
4. **(DEV) Frontend fixes:** `dashboard/js/sidebar.js`, `dashboard/css/common.css`, `dashboard/js/config.js`, tạo `dashboard/js/toast.js` + `dashboard/js/skeleton.js`.
5. **(PO/Architect) Update PRD & Epics:** phê duyệt FR-71/89/90 wording, thêm sub-stories 13.2.13–13.2.15.
6. **(QA) Real-data test matrix:** Twitter/Mastodon/Bluesky/Facebook.
7. **(User) Provide proxy/cookie** nếu cần.
8. **(DEV) Commit & push** khi tests pass.
