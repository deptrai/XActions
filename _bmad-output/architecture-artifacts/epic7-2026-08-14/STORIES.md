# Epic 7 Stories — Implementation Spec

- **Epic:** 7 — Facebook Advanced Scraping & Multi-Account Parallel Execution
- **Architecture Spine:** `ARCHITECTURE-SPINE.md`
- **PRD:** `_bmad-output/planning-artifacts/prds/prd-XActions-2026-08-14-epic7/prd.md`

## Story 7.1: Account Health Check & Live Filter

**FR:** FR-55
**NFR:** NFR-11, NFR-13
**File target:** `api/services/facebookHealth.js` `[ASSUMPTION]`

### Acceptance Criteria

- `checkAccountHealth({ c_user, xs })` gọi HTTP GET `https://www.facebook.com/` với cookie.
- Parse `fb_dtsg` từ HTML; xác thực `c_user`, `xs` từ cookie jar.
- Trả về `{ status: 'active' | 'checkpoint' | 'dead', reason?, lastCheckAt }`; DB lưu enum `FacebookAccountHealthStatus`.
- `checkpoint` nếu body chứa `/checkpoint/` hoặc `confirm that you're human`.
- `dead` nếu `fb_dtsg` hoặc `c_user` hoặc `xs` thiếu.
- Cookie values không bao giờ log.

### Implementation Notes

- Dùng `axios`, `buildCookieString` từ `src/scrapers/facebook/graphql.js`.
- Cache kết quả vào `FacebookAccountHealth` (Prisma); TTL 5 phút dựa trên `lastCheckAt`.
- `checkAccountHealth({ c_user, xs }, { force })`: trả cache nếu `lastCheckAt` < 5 phút (kể cả `dead`); nếu `force: true` hoặc hết TTL thì fetch lại.
- Hàm pure `parseFacebookTokens` đã có thể tái dùng để lấy `fb_dtsg`.

## Story 7.2: Account Pool & Parallel Runner

**FR:** FR-56
**NFR:** NFR-12, NFR-13, NFR-15
**File target:** `api/services/facebookAccountPool.js` `[ASSUMPTION]`

### Acceptance Criteria

- `facebookScrapeService.runBatch(tasks, { maxConcurrency: 4, delayBetweenLaunches, accountIds })`.
- Lọc active accounts từ health cache TTL 5 phút.
- Honor `FacebookAccount.proxy` nếu có.
- Gán task round-robin / LRU trong số account active với proxy khớp.
- Mỗi task mở browser riêng với `userDataDir: buildUserDataDir(c_user)`.
- `delayBetweenLaunches` mặc định 3-8 giây.
- `maxConcurrency` mặc định 4, tối đa 8.
- Retry task sang account khác nếu checkpoint giữa chừng.
- Trả về `results[]` + `accountUsage` report.

### Implementation Notes

- Dùng `p-limit@7.2.0` pin exact; cập nhật `package.json` (`"p-limit": "7.2.0"`) và chạy `npm install` trước khi chạy.
- Wrapper xử lý delay giữa các lần launch.
- Proxy affinity: API nhận plaintext `proxy` dạng `"host:port"` hoặc `"host:port:user:pass"`, lưu encrypted thành `FacebookAccount.encryptedProxy`; `FacebookAccountPool` decrypt trước khi dùng `parseFlatProxy` để lấy `server`, `username`, `password`; truyền `proxy: server` cho `createBrowser` và `proxyAuth: { username, password }` qua `scrape('facebook', action, { browserOptions: { proxy: server, proxyAuth }, ... })`; `scrape()` gọi `page.authenticate(proxyAuth)` sau `createPage` và trước `loginWithCookie`.
- Health cache TTL 5 phút: `checkAccountHealth` bỏ qua cache nếu `lastCheckAt` > 5 phút hoặc `force: true`.
- Retry không vượt `maxConcurrency`: mỗi `p-limit` slot giữ cho đến khi task thành công hoặc hết retry; nếu checkpoint, lấy account khác trong cùng slot rồi thử lại.

## Story 7.3: Multi-Type Facebook Search

**FR:** FR-57
**NFR:** NFR-10, NFR-14, NFR-15
**File target:** `src/scrapers/facebook/index.js` (hàm `searchFacebook`)

### Acceptance Criteria

- Input: `query`, `type`, `location`, `limit`, `authCookie`, `parallel`.
- `type: 'all'` mặc định sequential trên 1 account.
- `type: 'all'` với `parallel: true` phân 4 task cho 4 account.
- Trả về object `{ posts, people, pages, groups }` với `platform: 'facebook'`.
- Supports pagination scroll (max 50 scrolls, delay 1-3s).

### Implementation Notes

- Thêm `searchFacebook(page, query, options)` trong `src/scrapers/facebook/index.js` để xử lý `type` và `location`; giữ `searchTweets` là thin wrapper gọi `searchFacebook` để backward-compat.
- Mở rộng `src/scrapers/index.js` `scrape()` với `platformActionMap`: nều `platform === 'facebook'` thì `search` map tới `searchFacebook`, `post_comments` → `scrapeFacebookComments`, `group_posts` → `scrapeFacebookGroupPosts`, `group_comments` → `scrapeFacebookGroupComments`; nều không thì fallback về `actionMap` toàn cục.
- URL patterns:
  - posts: `/search/posts/?q=...`
  - people: `/search/people/?q=...`
  - pages: `/search/pages/?q=...`
  - groups: `/search/groups/?q=...`
- `type: 'all'` mặc định sequential; với `parallel: true`, `FacebookScrapeService` tự fan-out thành 4 task `search` rồi gộp.
- Tái dùng `extractHydrationJson` làm primary extraction.

## Story 7.4: Scrape Post Comments

**FR:** FR-58
**NFR:** NFR-10, NFR-14, NFR-15
**File target:** `src/scrapers/facebook/index.js` (hàm `scrapeFacebookComments`)

### Acceptance Criteria

- Input: `postUrl`, `limit`, `includeReplies`, `authCookie`.
- Mở post permalink, chuyển sort từ "Most relevant" sang "All comments" nếu có.
- Scroll, mở "View more comments" / "X replies".
- Mỗi comment trả về `{ id, authorName, authorUrl, text, timestamp, likes, replies[], parentId }`.
- `replies[]` chỉ có khi `includeReplies: true`.

### Implementation Notes

- Validate `postUrl` bằng `assertFacebookUrl(postUrl)` trước `page.goto`.
- Dùng `extractHydrationJson` để tìm `Comment` nodes.
- DOM fallback: query role/aria-label selectors.
- Mobile UA không bắt buộc; desktop có thể show nested replies.

## Story 7.5: Scrape Group Posts

**FR:** FR-59
**NFR:** NFR-10, NFR-14, NFR-15
**File target:** `src/scrapers/facebook/index.js` (hàm `scrapeFacebookGroupPosts`)

### Acceptance Criteria

- Input: `groupUrl`, `limit`, `authCookie`.
- Dùng mobile UA (390x844): `page.setUserAgent(...)` + `page.setViewport({ width: 390, height: 844, isMobile: true })` trước khi `page.goto`.
- Trả về posts với shape tương tự `scrapeTweets`.
- Trả về `note` nếu group private/restricted và account không phải member.

### Implementation Notes

- Validate `groupUrl` bằng `assertFacebookUrl(groupUrl)` và đảm bảo chứa `facebook.com/groups/`.
- Group feed trên mobile thường có `m.facebook.com/groups/{id}`.
- Fallback nếu mobile redirect hoặc yêu cầu đăng nhập.

## Story 7.6: Scrape Group Comments

**FR:** FR-60
**NFR:** NFR-10, NFR-14, NFR-15
**File target:** `src/scrapers/facebook/index.js` (hàm `scrapeFacebookGroupComments`)

### Acceptance Criteria

- Input: group `postUrl`, `limit`, `includeReplies`, `authCookie`.
- Verify `postUrl` chứa `facebook.com/groups/`.
- Gọi `scrapeFacebookComments({ page, postUrl, limit, includeReplies, authCookie })`.
- Trả về cùng comment shape.
- Trả về `note` nếu group private hoặc comments bị giới hạn.

### Implementation Notes

- Validate `postUrl` bằng `assertFacebookUrl(postUrl)` và đảm bảo chứa `facebook.com/groups/`.
- Là thin wrapper quanh `scrapeFacebookComments`; không duplicate logic.

## Story 7.7: Hydration JSON Extraction Fallback

**FR:** FR-61
**NFR:** NFR-14, NFR-15
**File target:** `src/scrapers/facebook/hydration.js` `[ASSUMPTION]`

### Acceptance Criteria

- `extractHydrationJson(page, typenames)` collect tất cả `<script type="application/json" data-content-len>`.
- Walk JSON đệ quy, lọc theo `__typename`.
- Hỗ trợ `Story`, `Comment`, `User`, `Page`, `Group`, `MarketplaceListing`.
- Trả về dữ liệu tương đương DOM extraction.
- DOM fallback khi hydration không đủ.

### Implementation Notes

- Dùng `page.evaluate` để lấy nội dung script tags.
- JSON parse an toàn (catch malformed).
- Đệ quy object/array, collect nodes có `__typename` nằm trong `typenames`.

## Story 7.8: API + MCP Surface Unification

**FR:** FR-63
**NFR:** NFR-10, NFR-13
**File target:** `api/services/facebookScrape.js`, `api/routes/facebook.js`, `src/mcp/server.js`

### Acceptance Criteria

- Tạo `api/services/facebookScrape.js` với `run(action, args)` và `runBatch(tasks, options)`.
- `FacebookScrapeService` resolve `authCookie` (`{ c_user, xs }` hoặc `{ accountId }`) qua helper `api/services/facebookAuth.js` dùng chung cho cả API và MCP; validate `userId` khi `accountId` được cung cấp; MCP tools truyền `userId` từ client context khi dùng `accountId`.
- `FacebookScrapeService` gọi `scrape('facebook', action, args)` từ `src/scrapers/index.js`, với `browserOptions.userDataDir`, `browserOptions.proxy`, `browserOptions.proxyAuth`.
- Mở rộng `src/scrapers/index.js` `scrape()` với `platformActionMap` cho `facebook`: `search` → `searchFacebook`, `post_comments` → `scrapeFacebookComments`, `group_posts` → `scrapeFacebookGroupPosts`, `group_comments` → `scrapeFacebookGroupComments`.
- `scrape()` gọi `page.authenticate(options.proxyAuth)` sau `createPage` và trước `loginWithCookie`.
- `api/routes/facebook.js` `POST /scrape` gọi `facebookScrapeService.run` và cập nhật `VALID_ACTIONS` thêm `post_comments`, `group_posts`, `group_comments`.
- `api/routes/facebookAccounts.js` `POST /` nhận thêm `proxy` plaintext, validate dạng flat string, encrypt thành `encryptedProxy`; cân nhắc thêm `PATCH /:id` để update proxy.
- MCP tools mới gọi `facebookScrapeService`.
- Không duplicate login/scrape logic.
- Mỗi tool có contract tests trong `tests/mcp/`.

### MCP Tools

| Tool | Action | Args |
|---|---|---|
| `x_facebook_search` | `search` | `query`, `type`, `location`, `limit`, `authCookie`, `parallel` |
| `x_facebook_post_comments` | `post_comments` | `postUrl`, `limit`, `includeReplies`, `authCookie` |
| `x_facebook_group_posts` | `group_posts` | `groupUrl`, `limit`, `authCookie` |
| `x_facebook_group_comments` | `group_comments` | `postUrl`, `limit`, `includeReplies`, `authCookie` |
| `x_facebook_posts` | `posts` | `url` (profile/page), `limit`, `authCookie` — thin wrapper, tương đương `x_scrape` `platform: facebook, action: posts` |

### API Contract

```
POST /api/facebook/scrape
Body: { action, ...args, authCookie }
Response: { ok: true, action, result }
```

Valid `action`: `profile`, `posts`, `followers`, `search`, `group-members`, `marketplace`, `post_comments`, `group_posts`, `group_comments`.

## Test Plan

| Story | Test File | Focus |
|---|---|---|
| 7.1 | `tests/services/facebookHealth.test.js` | `checkAccountHealth` active/checkpoint/dead, TTL, force, no cookie log. |
| 7.2 | `tests/services/facebookAccountPool.test.js` | pool assignment, proxy affinity, concurrency cap, retry slot. |
| 7.2 | `tests/services/facebookScrape.test.js` | `run`/`runBatch` dispatch, auth resolve, proxyAuth truyền đúng. |
| 7.3 | `tests/scrapers/facebook/search.test.js` | multi-type search, `all` sequential + parallel, URL patterns. |
| 7.4 | `tests/scrapers/facebook/comments.test.js` | post URL validation, hydration fallback, reply extraction. |
| 7.5 | `tests/scrapers/facebook/group-posts.test.js` | mobile UA, private group `note`, URL validation. |
| 7.6 | `tests/scrapers/facebook/group-comments.test.js` | group post URL validation, thin wrapper. |
| 7.7 | `tests/scrapers/facebook/hydration.test.js` | `extractHydrationJson` walker, `__typename` filter, DOM fallback. |
| 7.8 | `tests/mcp/facebook-epic7-tools.test.js` | MCP tool input schema, dispatch qua `FacebookScrapeService`, contract tests. |
| 7.8 | `tests/api/facebook-scrape.test.js` | `POST /api/facebook/scrape` action allowlist + proxy + auth. |
| 7.8 | `tests/api/facebook-accounts.test.js` | create với `proxy`, `encryptedProxy`, update proxy (nếu có PATCH). |

## Cross-Cutting Implementation Order

1. 7.1 + 7.7 (infrastructure)
2. 7.2 (parallel runner)
3. 7.8 (service + API + MCP thin wrappers)
4. 7.3, 7.4, 7.5 (read scrapers)
5. 7.6 (group comments wrapper)
