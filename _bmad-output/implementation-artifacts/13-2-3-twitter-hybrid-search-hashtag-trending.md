---
story_id: '13.2.3'
epic: 13
story_key: '13-2-3-twitter-hybrid-search-hashtag-trending'
status: "ready-for-dev"
phase: "Phase 2"
created: 2026-08-29
updated: 2026-08-29
last_updated: 2026-08-29
owner: "DEV"
reviewed: "pending"
---

# Story 13.2.3 — Twitter Hybrid Search, Hashtag & Trending

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **Twitter Market Researcher**,  
I want **tìm kiếm toàn cục, theo hashtag, và trending topics bằng kiến trúc hybrid**,  
so that **tôi có thể theo dõi xu hướng và tìm nội dung theo keyword/hashtag với độ trễ thấp**.

---

## Scope Note

Story 13.2.3 triển khai **search, hashtag, và trending actions** cho `TwitterCrawler` dựa trên `AbstractCrawler`/`AbstractApiClient` đã thiết lập ở Story 13.2 và 13.2.1. Story này **bổ sung actions vào `TwitterCrawler` đã có** (không tạo mới từ đầu).

**Lưu ý phụ thuộc quan trọng:** `src/scrapers/social/twitter/` chưa tồn tại trên branch `develop` (Story 13.2 và 13.2.1 chưa implement). Nếu skeleton chưa có, dev phải hoàn thành nền tảng `TwitterCrawler`/`TwitterClient`/`TwitterPlatformResponseValidator` theo AC của Story 13.2 và 13.2.1 trước. Story 13.2.3 chỉ focus vào 3 actions: `search`, `hashtag`, `trending`.

Tất cả output phải chuẩn hóa thành `PostItem` với ID Namespaced `twitter:${externalId}` và ghi vào `PrismaStore` chunk 500 bản ghi. Các legacy function `searchTweets`, `scrapeHashtag`, `scrapeTrending` trong `src/scrapers/twitter/index.js` phải được đánh dấu `@deprecated` và cập nhật `docs/deprecation-plan.md`.

---

## Sources

- `_bmad-output/planning-artifacts/epics.md` — Story 13.2.3 [dòng 466-476], Story 13.2 [dòng 429-439], Story 13.2.1 [dòng 442-452], Story 13.2.2 [dòng 454-464]
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` — AD-1 [dòng 125-133], AD-2 [dòng 134-141], AD-3 [dòng 142-163], AD-4 [dòng 164-174], AD-8 [dòng 201-213], AD-9 [dòng 215-225], AD-10 [dòng 226-232], AD-11 [dòng 233-243], AD-12 [dòng 245-248], AD-13 [dòng 250-260]
- `_bmad-output/implementation-artifacts/13-2-refactor-twitter-scraper-to-hybrid-architecture.md` — nền tảng Story 13.2 (AC-1..AC-4)
- `_bmad-output/implementation-artifacts/13-2-1-twitter-hybrid-profile-relationships.md` — pattern action registration, `TwitterClient` GraphQL dispatch, normalizer, checkpoint, deprecation
- `_bmad-output/implementation-artifacts/13-2-2-twitter-hybrid-thread-likes-bookmarks.md` — pattern `PostItem`/`ProfileItem` normalize, `metadata.tweetId`, `storeBatch`, relay variable handling
- `src/core/base-crawler.js` — `AbstractCrawler` contract & `ActionRegistry` [dòng 21-307]
- `src/core/base-client.js` — `AbstractApiClient` tiered signing, proxy rotation, 429/403 interceptor [dòng 43-893]
- `src/core/types.js` — `PostItem`, `ProfileItem`, `ActionDescriptor`, `CrawlerCommand` [dòng 9-102]
- `src/store/prisma-store.js` — `storeBatch` chunk 500, `saveCheckpoint` [dòng 186-374]
- `src/scrapers/twitter/http/endpoints.js` — GraphQL query IDs: `SearchTimeline` [dòng 85], `buildGraphQLUrl` [dòng 324-332], `buildGraphQLVariables` [dòng 341-556], `RATE_LIMITS` [dòng 247-294], `DEFAULT_FEATURES` [dòng 174-244], REST trends endpoints [dòng 162-165]
- `src/scrapers/twitter/http/search.js` — Legacy HTTP parsers: `buildAdvancedQuery` [dòng 60-97], `searchTweets` [dòng 123-188], `searchUsers` [dòng 206-244], `parseSearchUserInstructions` [dòng 255-298], `scrapeTrending` [dòng 316-334], `scrapeHashtag` [dòng 351-354]
- `src/scrapers/twitter/http/tweets.js` — `parseTweetData` [dòng 77-202], `parseTimelineInstructions` [dòng 219-293]
- `src/scrapers/twitter/index.js` — Legacy Puppeteer: `searchTweets` [dòng 465-528], `scrapeHashtag` [dòng 654-659], `scrapeTrending` [dòng 899-922]
- `src/client/Scraper.js` — Legacy `searchTweets`, `searchProfiles`, `getTrends`, `getExploreTabs`
- `src/scrapers/twitter/validator.js` — `TwitterPlatformResponseValidator` hiện có
- `src/scrapers/social/tiktok/crawler.js` — Pattern mẫu: action registration, checkpoint emission [dòng 61-108]
- `src/scrapers/social/facebook/crawler.js` — Pattern mẫu: `registerAction`, `#normalizePostItem`, checkpoint [dòng 90-200]
- `schemas/twitter/social.json` — Metadata schema, required `tweetId` [dòng 110-112]
- `docs/deprecation-plan.md` — Status tracker [dòng 79-97], legacy-to-hybrid mapping [dòng 98-127]

---

## Cross-Epic Dependencies

- **Phụ thuộc Story 13.2 & 13.2.1:** `src/scrapers/social/twitter/` phải tồn tại `TwitterCrawler`, `TwitterClient`, `TwitterPlatformResponseValidator`, normalizer helpers. Nếu chưa có, dev phải hoàn thành phần nền trước.
- **Phụ thuộc Epic 10.1/10.2:** `AbstractCrawler`, `AbstractApiClient`, `PrismaStore`, `Post`/`Comment`/`CrawlCheckpoint` schema.
- **Phụ thuộc Epic 11:** `ProxyIpPool`, `AdaptiveRateGovernor`, `AccountPool`.
- **Phụ thuộc Story 13.1:** `PreSignedTokenRing`, `SignerWorkerPagePool`.
- **Mở khóa Story 13.2.4** (media) — sử dụng lại `TwitterClient` dispatch pattern.
- **Mở khóa Story 13.2.12** (integration/caller migration).

---

## Acceptance Criteria

### AC-1: Đăng ký action search, hashtag, trending trong `TwitterCrawler`

* **Given** `TwitterCrawler` extends `AbstractCrawler` trong `src/scrapers/social/twitter/crawler.js`
* **When** khởi tạo crawler
* **Then** đăng ký 3 action mới với descriptor đúng `ActionDescriptor` shape:

| action | requiredArgs | optionalArgs | example | outputType | requiresAuth |
|---|---|---|---|---|---|
| `search` | `['query']` | `['filter', 'since', 'until', 'from', 'to', 'minLikes', 'minRetweets', 'lang', 'limit', 'cursor']` | `{ query: 'javascript', filter: 'Latest', limit: 100 }` | `{ posts: PostItem[], pageInfo: { has_next_page: boolean, end_cursor: string \| null } }` | `false` (public guest cho phép, opt-in `accountId` vẫn được tôn trọng) |
| `hashtag` | `['hashtag']` | `['filter', 'since', 'until', 'minLikes', 'minRetweets', 'lang', 'limit', 'cursor']` | `{ hashtag: 'AI', filter: 'Latest', limit: 50 }` | `{ posts: PostItem[], pageInfo: { has_next_page: boolean, end_cursor: string \| null } }` | `false` |
| `trending` | `[]` | `['woeid', 'limit']` | `{ woeid: 1, limit: 30 }` | `{ trends: PostItem[], pageInfo: { has_next_page: false, end_cursor: null } }` | `false` |

* **And** `search`/`hashtag`/`trending` public (guest token / no auth) theo mặc định `requiresAuth: false`, nhưng caller truyền `accountId` rõ ràng vẫn được tôn trọng (opt-in auth, sticky proxy, governor check).
* **And** action names phải `snake_case` theo regex `/^[a-z0-9_]+$/` [src/core/base-crawler.js dòng 84-90].
* **And** `listActions()` trả về đầy đủ action mới đã phân giải `requiresAuth`.

### AC-2: `search` handler — GraphQL SearchTimeline với advanced query composition

* **Given** action `search` đã đăng ký
* **When** gọi `crawler.start({ action: 'search', args: { query: 'javascript', filter: 'Latest', since: '2025-01-01', until: '2025-12-31', from: 'nichxbt', minLikes: 100, limit: 100 } })`
* **Then** handler gọi `SearchTimeline` GraphQL endpoint [queryId: `flaR-PUMshxFWZWPNpq4zA`][src/scrapers/twitter/http/endpoints.js dòng 85] với variables:
  - `rawQuery`: query string đã được nối thêm các advanced operators từ `args` (since, until, from, to, minLikes, minRetweets, lang, filter)
  - `count: Math.min(args.limit, 50)` (Twitter thường trả tối đa 20; vẫn dùng 20 hoặc `limit` nếu < 20)
  - `querySource: 'typed_query'`
  - `product: args.filter` (mặc định `'Latest'`, hỗ trợ `'Top'`, `'Latest'`, `'Photos'`, `'Videos'`, `'People'`)
  - `cursor` nếu `args.cursor` được truyền
* **And** response được parse qua `parseTimelineInstructions` để trích xuất tweets và `cursor-bottom-*` từ `data.search_by_raw_query.search_timeline.timeline.instructions`
* **And** nếu `args.filter === 'People'`, sử dụng `parseSearchUserInstructions` (hoặc tương đương) để trả về `ProfileItem[]` thay vì `PostItem[]`
* **And** mỗi tweet được normalize thành `PostItem` với:
  - `id: twitter:${rest_id}`
  - `externalId: rest_id`
  - `category: 'social'`
  - `content: legacy.full_text`
  - `metadata.tweetId: rest_id` (bắt buộc theo schema)
  - `metadata.sourceMethod: 'search'`
  - `metadata.hashtags`, `metadata.mentions`, `metadata.lang`
  - `metadata.searchQuery: args.query`
  - `metadata.searchFilter: args.filter || 'Latest'`
  - `metadata.isSearchResult: true`
* **And** pagination qua `cursor-bottom-*`; `args.limit` là tổng số tweet tối đa muốn thu thập, dừng khi đủ `limit` hoặc hết cursor
* **And** `pageInfo: { has_next_page: boolean, end_cursor: string | null }`
* **And** deduplication tweet theo `id` (set)
* **And** lưu `CrawlCheckpoint` với `targetType: 'search'`, `targetKey: <rawQuery>` (hoặc hash của rawQuery nếu quá dài)

### AC-3: `hashtag` handler — wrapper quanh `search` với prefix `#`

* **Given** action `hashtag` đã đăng ký
* **When** gọi `crawler.start({ action: 'hashtag', args: { hashtag: 'AI', filter: 'Latest', limit: 50 } })`
* **Then** handler chuẩn hóa hashtag: loại bỏ dấu `#` ở đầu nếu có, sau đó build `query: #<tag>`
* **And** delegate nội bộ đến handler `search` với query đã build, giữ nguyên các tùy chọn filter/limit/cursor
* **And** `PostItem.metadata` bổ sung:
  - `metadata.isHashtag: true`
  - `metadata.hashtag: <tag>` (không có `#`)
  - `metadata.sourceMethod: 'hashtag'`
* **And** lưu `CrawlCheckpoint` với `targetType: 'hashtag'`, `targetKey: <tag>`

### AC-4: `trending` handler — REST trends/place với fallback

* **Given** action `trending` đã đăng ký
* **When** gọi `crawler.start({ action: 'trending', args: { woeid: 1, limit: 30 } })`
* **Then** handler gọi REST endpoint `GET /1.1/trends/place.json?id=<woeid>` [src/scrapers/twitter/http/endpoints.js dòng 165] qua `TwitterClient`
* **And** parse response: `resp[0].trends` là mảng `{ name, tweet_volume, url, promoted_content }`
* **And** mỗi trend được chuẩn hóa thành `PostItem` với:
  - `id: twitter:trend:<woeid>:<trendNameHash>` — vì trend không có external tweet id ổn định, dùng `woeid` + hash của `name` (vd. SHA-256 truncated 16 chars hoặc slug) để tránh trùng lặp
  - `externalId: <trendNameHash>`
  - `category: 'social'`
  - `authorId: 'trending'`
  - `authorName: 'Twitter Trending'`
  - `content: trend.name`
  - `metadata.tweetId: <trendNameHash>` (bắt buộc theo schema)
  - `metadata.isTrending: true`
  - `metadata.trendWoeid: woeid`
  - `metadata.tweetCount: trend.tweet_volume || null`
  - `metadata.trendUrl: trend.url || null`
  - `metadata.isPromoted: Boolean(trend.promoted_content)`
  - `metadata.sourceMethod: 'trending'`
* **And** nếu REST endpoint trả 404/403/401, thử fallback GraphQL `SearchTimeline` với `rawQuery: 'trending'` hoặc `ExploreTrending` nếu đã biết query ID trong tương lai
* **And** `pageInfo: { has_next_page: false, end_cursor: null }` (trends là single-shot)
* **And** lưu `CrawlCheckpoint` với `targetType: 'trending'`, `targetKey: <woeid>`

### AC-5: Chuẩn hóa `PostItem` và lưu trữ Namespaced

* **Given** response hợp lệ
* **When** normalizer chạy
* **Then** `PostItem` có `id: twitter:${rest_id}` (hoặc `twitter:trend:<woeid>:<hash>` cho trends), `platform: 'twitter'`, `externalId: rest_id`, `category: 'social'`, `authorId`, `authorName`, `content`, `mediaUrls`, `likesCount`, `repostsCount`, `repliesCount`, `viewsCount`
* **And** `metadata` phải chứa `tweetId` (required theo `schemas/twitter/social.json` [dòng 110-112]) và các trường phụ thuộc action (search/hashtag/trending)
* **And** `PrismaStore.storeBatch(posts, { validateSchema: true })` ghi theo chunk 500, `skipDuplicates: true`
* **And** checkpoint được cập nhật sau mỗi page với `lastCursor` và `lastCrawledAt`

### AC-6: Deprecation marker và documentation

* **Given** `TwitterCrawler` đã đăng ký action search/hashtag/trending
* **When** kiểm tra legacy code
* **Then** thêm JSDoc `@deprecated` và comment `// LEGACY — see docs/deprecation-plan.md` vào:
  - `searchTweets`, `scrapeHashtag`, `scrapeTrending` trong `src/scrapers/twitter/index.js`
  - `searchTweets`, `searchUsers`, `scrapeTrending`, `scrapeHashtag` trong `src/scrapers/twitter/http/search.js`
  - `searchTweets`, `searchProfiles`, `getTrends`, `getExploreTabs` trong `src/client/Scraper.js` (nếu tồn tại)
* **And** cập nhật `docs/deprecation-plan.md` status tracker: Twitter Search/Hashtag/Trending legacy chuyển từ `deprecated-planned` sang `deprecated-marked`; ghi rõ được thay thế bởi `twitter:search`, `twitter:hashtag`, `twitter:trending`.

### AC-7: Kiểm thử ATDD & smoke

* **Given** repo có `vitest` và `tests/scrapers/social/twitter/`
* **When** chạy `vitest run tests/scrapers/social/twitter/crawler-search-hashtag-trending.test.js`
* **Then** tất cả AC-1..AC-6 có test red-phase hoặc green-phase tương ứng
* **And** test sử dụng local `node:http` server fake GraphQL/REST với JSON response giống Twitter (không mock module — real implementation call real server) [mẫu: tests/scrapers/social/facebook/crawler-marketplace.test.js dòng 64-165]
* **And** có test smoke tùy chọn với `scripts/test-twitter-search-live.mjs` (nếu môi trường có proxy/cookie live) để xác nhận query IDs không stale
* **And** `npx tsc --noEmit` (hoặc `npm run typecheck` nếu script tồn tại) không báo lỗi mới

---

## Tasks / Subtasks

- [ ] **Task 1 — Khởi tạo/mở rộng module `src/scrapers/social/twitter/` (AC-1, AC-2)**
  - [ ] 1.1 Đảm bảo `src/scrapers/social/twitter/index.js` export `TwitterClient`, `TwitterCrawler`, `TwitterPlatformResponseValidator`, normalizer helpers (tạo mới nếu chưa có)
  - [ ] 1.2 Đảm bảo `src/scrapers/social/twitter/client.js` — `TwitterClient` extends `AbstractApiClient`
  - [ ] 1.3 Mở rộng `src/scrapers/social/twitter/crawler.js` — `TwitterCrawler` đăng ký thêm 3 action `search`, `hashtag`, `trending`
  - [ ] 1.4 Đảm bảo `src/scrapers/social/twitter/validator.js` — `TwitterPlatformResponseValidator` xử lý SearchTimeline empty/bot-challenge/rate-limit

- [ ] **Task 2 — Triển khai `TwitterClient` GraphQL/REST dispatch (AC-2, AC-4)**
  - [ ] 2.1 Tái sử dụng `GRAPHQL.SearchTimeline`, `buildGraphQLUrl`, `buildGraphQLVariables`, `DEFAULT_FEATURES` từ `src/scrapers/twitter/http/endpoints.js`
  - [ ] 2.2 Thêm helper `requestRest(path, options)` nếu chưa có, để gọi `/1.1/trends/place.json`
  - [ ] 2.3 Đảm bảo `requestGraphQl` hỗ trợ `__relay_internal__pv__appviewerisloggedinprovider: false` cho guest token (học từ 13.2.2 live verification)
  - [ ] 2.4 Sử dụng `Promise.race` 3s timeout cho `x-client-transaction-id` signing qua `SignerWorkerPagePool` [AD-1]
  - [ ] 2.5 Cấu hình proxy: rotating residential cho no-auth, sticky nếu `accountId` được truyền [AD-3 rule 3b]

- [ ] **Task 3 — Triển khai normalizers (AC-5)**
  - [ ] 3.1 Tạo/mở rộng `src/scrapers/social/twitter/normalize-tweet.js` với `parseTweetResult`, `tweetToPostItem` (tái sử dụng logic từ `src/scrapers/twitter/http/tweets.js:parseTweetData`)
  - [ ] 3.2 Tạo `src/scrapers/social/twitter/normalize-search.js` với `parseTimelineInstructions`, `parseSearchUserInstructions`
  - [ ] 3.3 Tạo `src/scrapers/social/twitter/normalize-trending.js` với `trendToPostItem` và `hashTrendId` (woeid + slug(name))

- [ ] **Task 4 — Triển khai handlers `TwitterCrawler` (AC-2, AC-3, AC-4)**
  - [ ] 4.1 `search(args, session)` → build advanced query, gọi `SearchTimeline`, paginate + dedup + checkpoint
  - [ ] 4.2 `hashtag(args, session)` → normalize `#`, delegate `search`, set `metadata.isHashtag/hashtag`
  - [ ] 4.3 `trending(args, session)` → gọi REST `trends/place`, parse, fallback search nếu cần
  - [ ] 4.4 Cập nhật `CrawlCheckpoint` sau mỗi page và cuối cùng

- [ ] **Task 5 — Lưu trữ và metadata schema (AC-5)**
  - [ ] 5.1 Đảm bảo `tweetToPostItem` trả về `category: 'social'` và `metadata.tweetId = externalId`
  - [ ] 5.2 Mở rộng `schemas/twitter/social.json` để hỗ trợ các trường search/hashtag/trending: `isSearchResult`, `searchQuery`, `searchFilter`, `isHashtag`, `hashtag`, `isTrending`, `trendWoeid`, `tweetCount`, `trendUrl`, `isPromoted`, `sourceMethod`, `cursor`
  - [ ] 5.3 Gọi `this.store.storeBatch(posts, { validateSchema: true })` sau mỗi page; chunk 500

- [ ] **Task 6 — Deprecation markers (AC-6)**
  - [ ] 6.1 Thêm `@deprecated` cho `searchTweets`, `scrapeHashtag`, `scrapeTrending` trong `src/scrapers/twitter/index.js`
  - [ ] 6.2 Thêm `@deprecated` cho `searchTweets`, `searchUsers`, `scrapeTrending`, `scrapeHashtag` trong `src/scrapers/twitter/http/search.js`
  - [ ] 6.3 Thêm `@deprecated` cho `searchTweets`, `searchProfiles`, `getTrends`, `getExploreTabs` trong `src/client/Scraper.js` (nếu tồn tại)
  - [ ] 6.4 Cập nhật `docs/deprecation-plan.md` status tracker

- [ ] **Task 7 — ATDD tests (AC-7)**
  - [ ] 7.1 Tạo `tests/scrapers/social/twitter/crawler-search-hashtag-trending.test.js`
  - [ ] 7.2 Fake server trả về `SearchTimeline` response giống Twitter (2-3 pages + cursor)
  - [ ] 7.3 Fake server trả về `/1.1/trends/place.json` response
  - [ ] 7.4 Test các trường hợp: search with advanced filters, hashtag normalization, trending with woeid, pagination, empty result, invalid filter
  - [ ] 7.5 Chạy `npx tsc --noEmit` hoặc `npm run typecheck`

---

## Dev Notes

### Project Structure Notes

- Module mới phải nằm trong `src/scrapers/social/twitter/` theo AD-8 [dòng 201-213]. Không đặt logic mới trong `src/scrapers/twitter/http/` hoặc `src/client/Scraper.js`.
- `TwitterCrawler` phải extends `AbstractCrawler` từ `src/core/base-crawler.js`.
- `TwitterClient` phải extends `AbstractApiClient` từ `src/core/base-client.js`.
- Normalizer nên tách thành các file nhỏ để tái sử dụng giữa các action: `normalize-tweet.js`, `normalize-search.js`, `normalize-trending.js`.

### Architecture Compliance

- **AD-1:** Mọi request cần `x-client-transaction-id` phải qua `SignerWorkerPagePool.evaluate()` với `Promise.race` timeout 3,000ms (warmup 8,000ms).
- **AD-2:** `AbstractCrawler.start({ action, args, session })` lookup `ActionRegistry` và dispatch đến handler đúng. CLI/MCP chỉ gọi `crawler.start(command)`.
- **AD-3 rule 3b:** `search`/`hashtag`/`trending` là `requiresAuth: false` → rotating residential proxy, guest token. Nếu caller truyền `accountId` → sticky proxy, account velocity check.
- **AD-4:** `Post.id` phải là Namespaced `twitter:${externalId}`. Trend dùng `twitter:trend:<woeid>:<hash>` để đảm bảo uniqueness. `metadata` cần `tweetId` (required).
- **AD-9:** `TwitterPlatformResponseValidator` phải phát hiện payload rác / bot challenge / rate limit từ Twitter (kể cả HTTP 200 kèm error code).
- **AD-11:** Action names phải `snake_case`. `ActionDescriptor` khai báo `requiresAuth` rõ ràng.
- **AD-12:** Mọi action lưu `CrawlCheckpoint` sau mỗi page để resume.

### GraphQL Variables & Relay Gotchas (học từ 13.2.2 live verification)

- SearchTimeline request cần các feature flags mặc định từ `DEFAULT_FEATURES`.
- Một số query mới của Twitter Web yêu cầu `__relay_internal__pv__appviewerisloggedinprovider: false` trong variables để tránh `GRAPHQL_VALIDATION_FAILED` [phát hiện từ live test story 13.2.2].
- Guest token activation (`1.1/guest/activate.json`) hiện trả 404; crawler phải lấy guest token từ browser session hoặc Pre-Signed Token Ring (nếu có). Trong test, dùng `gt` cookie từ live browser.

### Filter Mapping

| User-facing filter | GraphQL `product` | Legacy filter key |
|---|---|---|
| `Top` | `Top` | `top` |
| `Latest` | `Latest` | `latest` / `live` |
| `Photos` | `Photos` | `photos` / `image` |
| `Videos` | `Videos` | `videos` / `video` |
| `People` | `People` | `people` / `user` |

### Trending ID Strategy

Trending REST API trả về `name` (ví dụ `#Bitcoin`, `Messi`) không có stable ID. Sử dụng:

```js
function hashTrendId(woeid, name) {
  const crypto = await import('node:crypto');
  const hash = crypto.createHash('sha256').update(`${woeid}:${name}`).digest('hex').slice(0, 16);
  return `twitter:trend:${woeid}:${hash}`;
}
```

`externalId` = `<woeid>:<hash>` hoặc chỉ `<hash>` tùy convention; phải nhất quán với `Post.id`.

### Testing Standards

- Framework: Vitest 4.x, ESM, real HTTP server fake (không mock module) theo CLAUDE.md Testing Conventions.
- Đặt test trong `tests/scrapers/social/twitter/crawler-search-hashtag-trending.test.js`.
- Mỗi AC phải có ít nhất 1 test case.
- Smoke test live tùy chọn: `scripts/test-twitter-search-live.mjs`.

---

## Dev Agent Record

### Agent Model Used

N/A — story creation

### Debug Log References

- Live API verification 13.2.2: `TweetResultByRestId` HTTP 200 với `__relay_internal__pv__appviewerisloggedinprovider: false`
- Guest token activation 404 (legacy `1.1/guest/activate.json` closed)

### Completion Notes List

- [ ] Đọc xong epics.md Story 13.2.3, 13.2, 13.2.1, 13.2.2
- [ ] Đọc xong ARCHITECTURE-SPINE.md AD-1..AD-13
- [ ] Phân tích legacy `src/scrapers/twitter/http/search.js`, `src/scrapers/twitter/index.js`, `src/client/Scraper.js`
- [ ] Xác định query ID `SearchTimeline` = `flaR-PUMshxFWZWPNpq4zA` [src/scrapers/twitter/http/endpoints.js:85]
- [ ] Xác định REST trends endpoint `/1.1/trends/place.json` [src/scrapers/twitter/http/endpoints.js:165]

### File List

- **Mới / Cập nhật (NEW/UPDATE):**
  - `src/scrapers/social/twitter/crawler.js` — UPDATE: thêm register action `search`, `hashtag`, `trending`
  - `src/scrapers/social/twitter/client.js` — UPDATE: thêm REST request helper nếu cần
  - `src/scrapers/social/twitter/normalize-tweet.js` — NEW/UPDATE
  - `src/scrapers/social/twitter/normalize-search.js` — NEW
  - `src/scrapers/social/twitter/normalize-trending.js` — NEW
  - `src/scrapers/social/twitter/validator.js` — UPDATE
  - `schemas/twitter/social.json` — UPDATE: thêm search/hashtag/trending metadata
  - `docs/deprecation-plan.md` — UPDATE: status tracker
  - `tests/scrapers/social/twitter/crawler-search-hashtag-trending.test.js` — NEW
  - `scripts/test-twitter-search-live.mjs` — NEW (tùy chọn)
  - `src/scrapers/twitter/index.js` — UPDATE: `@deprecated` markers
  - `src/scrapers/twitter/http/search.js` — UPDATE: `@deprecated` markers
  - `src/client/Scraper.js` — UPDATE: `@deprecated` markers (nếu tồn tại)
