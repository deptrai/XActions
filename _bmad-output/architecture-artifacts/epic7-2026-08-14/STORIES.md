# Epic 7 Stories — Implementation Spec

- **Epic:** 7 — Facebook Advanced Scraping & Multi-Account Parallel Execution
- **Architecture Spine:** `ARCHITECTURE-SPINE.md`
- **PRD:** `_bmad-output/planning-artifacts/prds/prd-XActions-2026-08-14-epic7/prd.md`

## Story 7.1: Foundation — Health, Pool, Hydration & Schema

**FR:** FR-55, FR-56, FR-61  
**NFR:** NFR-10, NFR-11, NFR-12, NFR-13, NFR-14, NFR-15  
**File targets:** `api/services/facebookHealth.js` `[ASSUMPTION]`, `api/services/facebookAccountPool.js` `[ASSUMPTION]`, `src/scrapers/facebook/hydration.js` `[ASSUMPTION]`, `api/routes/facebookAccounts.js`, Prisma schema

### Acceptance Criteria

Account health:
- `checkAccountHealth({ c_user, xs })` gọi HTTP GET `https://www.facebook.com/` với cookie.
- Parse `fb_dtsg` từ HTML; xác thực `c_user` và `xs` từ cookie jar.
- Trả về `{ status: 'active' | 'checkpoint' | 'dead', reason?, lastCheckAt }`; DB lưu enum `FacebookAccountHealthStatus`.
- `checkpoint` nếu body chứa `/checkpoint/` hoặc `confirm that you're human` / `security check`.
- `dead` nếu `fb_dtsg` hoặc `c_user` hoặc `xs` thiếu.
- Cookie values không bao giờ log.
- Cache TTL 5 phút; `checkAccountHealth(..., { force })` trả cache nếu `lastCheckAt` < 5 phút, nếu `force: true` hoặc hết TTL thì fetch lại.

Account pool:
- `FacebookAccountPool.runBatch(tasks, { maxConcurrency: 4, delayBetweenLaunches, accountIds })`.
- Lọc active accounts từ health cache TTL 5 phút.
- Honor `FacebookAccount.proxy` nếu có.
- Gán task round-robin / LRU trong số account active với proxy khớp.
- Mỗi task mở browser riêng với `userDataDir: buildUserDataDir(c_user)`.
- `delayBetweenLaunches` mặc định 3-8 giây.
- `maxConcurrency` mặc định 4, tối đa 8 (dùng `p-limit@7.2.0`).
- Retry task sang account khác nếu checkpoint giữa chừng.
- Trả về `results[]` + `accountUsage` report.

Hydration:
- `extractHydrationJson(page, typenames)` collect tất cả `<script type="application/json" data-content-len>`.
- Walk JSON đệ quy, lọc theo `__typename`.
- Hỗ trợ `Story`, `Comment`, `User`, `Page`, `Group`, `MarketplaceListing`.
- Trả về dữ liệu tương đương DOM extraction.
- DOM fallback khi hydration không đủ.

Schema / proxy:
- `FacebookAccountHealth` model với `accountId` unique, enum `FacebookAccountHealthStatus`, relation 1-1.
- Thêm `encryptedProxy` vào `FacebookAccount`.
- `POST /api/facebook/accounts` nhận `proxy` plaintext dạng `"host:port"` hoặc `"host:port:user:pass"`, lưu encrypted thành `encryptedProxy`; cân nhắc `PATCH /:id`.

### Implementation Notes

- Dùng `axios`, `buildCookieString` từ `src/scrapers/facebook/graphql.js`.
- Hàm pure `parseFacebookTokens` đã có thể tái dùng để lấy `fb_dtsg`.
- Dùng `p-limit@7.2.0` pin exact; cập nhật `package.json` (`"p-limit": "7.2.0"`) và chạy `npm install` trước khi chạy.
- Wrapper xử lý delay giữa các lần launch.
- Proxy affinity: API nhận plaintext `proxy`, lưu encrypted thành `FacebookAccount.encryptedProxy`; `FacebookAccountPool` decrypt trước khi dùng `parseFlatProxy` để lấy `server`, `username`, `password`; truyền `proxy: server` cho `createBrowser` và `proxyAuth: { username, password }` qua `scrape('facebook', action, { browserOptions: { proxy: server, proxyAuth }, ... })`; `scrape()` gọi `page.authenticate(proxyAuth)` sau `createPage` và trước `loginWithCookie`.
- `p-limit` slot giữ cho đến khi task thành công hoặc hết retry; nếu checkpoint, lấy account khác trong cùng slot rồi thử lại.
- `extractHydrationJson` dùng `page.evaluate` để lấy nội dung script tags; JSON parse an toàn; đệ quy object/array, collect nodes có `__typename` nằm trong `typenames`.
- Migrations:
  1. `npx prisma migrate dev --name add_facebook_account_fields` — thêm `encryptedProxy` + `updatedAt` vào `FacebookAccount`.
  2. `npx prisma migrate dev --name add_facebook_account_health` — tạo bảng `FacebookAccountHealth`.

## Story 7.2: Multi-Type Facebook Search

**FR:** FR-57  
**NFR:** NFR-10, NFR-14, NFR-15  
**File target:** `src/scrapers/facebook/index.js` (hàm `searchFacebook`)

### Acceptance Criteria

- Input: `query`, `type` (`posts`, `people`, `pages`, `groups`, `all`), `location`, `limit`, `authCookie`, `parallel`.
- `type: 'all'` mặc định sequential trên 1 account.
- `type: 'all'` với `parallel: true` phân 4 task cho 4 account.
- Trả về object `{ posts, people, pages, groups }` với `platform: 'facebook'`.
- Ví dụ `type: 'all'`:
  ```js
  {
    posts: [{ id, text, author, timestamp, url, platform: 'facebook' }],
    people: [{ id, name, username, profileUrl, image, platform: 'facebook' }],
    pages: [{ id, name, category, likes, pageUrl, image, platform: 'facebook' }],
    groups: [{ id, name, members, privacy, groupUrl, image, platform: 'facebook' }]
  }
  ```
- `type: 'posts'` returns `Array<{ id, text, author, timestamp, url, platform: 'facebook' }>`.
- `type: 'people'` returns `Array<{ id, name, username, profileUrl, image, platform: 'facebook' }>`.
- `type: 'pages'` returns `Array<{ id, name, category, likes, pageUrl, image, platform: 'facebook' }>`.
- `type: 'groups'` returns `Array<{ id, name, members, privacy, groupUrl, image, platform: 'facebook' }>`.
- URL patterns:
  - posts: `/search/posts/?q=...`
  - people: `/search/people/?q=...`
  - pages: `/search/pages/?q=...`
  - groups: `/search/groups/?q=...`
- Supports pagination scroll (max 50 scrolls, delay 1-3s).

### Implementation Notes

- Thêm `searchFacebook(page, query, options)` trong `src/scrapers/facebook/index.js` để xử lý `type` và `location`; giữ `searchTweets` là thin wrapper gọi `searchFacebook` để backward-compat.
- Mở rộng `src/scrapers/index.js` `scrape()` với `platformActionMap`: nếu `platform === 'facebook'` thì `search` map tới `searchFacebook`, `post_comments` → `scrapeFacebookComments`, `group_posts` → `scrapeFacebookGroupPosts`, `group_comments` → `scrapeFacebookGroupComments`; nếu không thì fallback về `actionMap` toàn cục.
- `type: 'all'` mặc định sequential; với `parallel: true`, `FacebookScrapeService` tự fan-out thành 4 task `search` rồi gộp.
- Tái dùng `extractHydrationJson` làm primary extraction.
- DOM fallback với role/aria-label selectors.

## Story 7.3: Comments & Group Content

**FR:** FR-58, FR-59, FR-60  
**NFR:** NFR-10, NFR-14, NFR-15  
**File target:** `src/scrapers/facebook/index.js` (hàm `scrapeFacebookComments`, `scrapeFacebookGroupPosts`, `scrapeFacebookGroupComments`)

### Acceptance Criteria

Post comments:
- Input: `postUrl`, `limit`, `includeReplies`, `authCookie`.
- Mở post permalink, chuyển sort từ "Most relevant" sang "All comments" nếu có.
- Scroll, mở "View more comments" / "X replies".
- Mỗi comment trả về `{ id, authorName, authorUrl, text, timestamp, likes, replies[], parentId }`.
- `replies[]` chỉ có khi `includeReplies: true`.

Group posts:
- Input: `groupUrl`, `limit`, `authCookie`.
- Dùng mobile UA (390x844): `page.setUserAgent(...)` + `page.setViewport({ width: 390, height: 844, isMobile: true })` trước khi `page.goto`.
- Trả về posts với shape tương tự `scrapeTweets`.
- Trả về `note` nếu group private/restricted và account không phải member.

Group comments:
- Input: group `postUrl`, `limit`, `includeReplies`, `authCookie`.
- Verify `postUrl` chứa `facebook.com/groups/`.
- Gọi `scrapeFacebookComments({ page, postUrl, limit, includeReplies, authCookie })`.
- Trả về cùng comment shape.
- Trả về `note` nếu group private hoặc comments bị giới hạn.

### Implementation Notes

- Validate `postUrl` / `groupUrl` bằng `assertFacebookUrl(...)` trước `page.goto`.
- Đảm bảo `groupUrl` chứa `facebook.com/groups/`.
- `scrapeFacebookGroupPosts`: group feed trên mobile thường có `m.facebook.com/groups/{id}`; fallback nếu mobile redirect hoặc yêu cầu đăng nhập.
- `scrapeFacebookGroupComments` là thin wrapper quanh `scrapeFacebookComments`; không duplicate logic.
- Dùng `extractHydrationJson` để tìm `Comment` nodes.
- DOM fallback: query role/aria-label selectors.
- Mobile UA không bắt buộc cho comments; desktop có thể show nested replies.

## Story 7.4: API + MCP Surface Unification

**FR:** FR-63  
**NFR:** NFR-10, NFR-13  
**File targets:** `api/services/facebookScrape.js`, `api/services/facebookAuth.js`, `api/routes/facebook.js`, `src/mcp/server.js`

### Acceptance Criteria

- Tạo `api/services/facebookScrape.js` với `run(action, args)` và `runBatch(tasks, options)`.
- `FacebookScrapeService` resolve `authCookie` (`{ c_user, xs }` hoặc `{ accountId }`) qua helper `FacebookAuthResolver` dùng chung cho cả API và MCP; validate `userId` khi `accountId` được cung cấp; MCP tools truyền `userId` từ client context khi dùng `accountId`.
- `FacebookScrapeService` gọi `scrape('facebook', action, args)` từ `src/scrapers/index.js`, với `browserOptions.userDataDir`, `browserOptions.proxy`, `browserOptions.proxyAuth`.
- `scrape()` gọi `page.authenticate(options.proxyAuth)` sau `createPage` và trước `loginWithCookie`.
- `api/routes/facebook.js` `POST /scrape` gọi `facebookScrapeService.run` và cập nhật `VALID_ACTIONS` thêm `post_comments`, `group_posts`, `group_comments`.
- MCP tools mới gọi `facebookScrapeService`.
- Không duplicate login/scrape logic.
- Mỗi tool có contract tests trong `tests/mcp/`.

### API Contract

```
POST /api/facebook/scrape
Body: { action, ...args, authCookie }
Response: { ok: true, action, result }
```

Valid `action`: `profile`, `posts`, `followers`, `search`, `group-members`, `marketplace`, `post_comments`, `group_posts`, `group_comments`.

### MCP Tools

| Tool | Action | Args |
|---|---|---|
| `x_facebook_search` | `search` | `query`, `type`, `location`, `limit`, `authCookie`, `parallel` |
| `x_facebook_post_comments` | `post_comments` | `postUrl`, `limit`, `includeReplies`, `authCookie` |
| `x_facebook_group_posts` | `group_posts` | `groupUrl`, `limit`, `authCookie` |
| `x_facebook_group_comments` | `group_comments` | `postUrl`, `limit`, `includeReplies`, `authCookie` |
| `x_facebook_posts` | `posts` | `url` (profile/page), `limit`, `authCookie` — thin wrapper, tương đương `x_scrape` `platform: facebook, action: posts` |

## Schema Reference

```prisma
enum FacebookAccountHealthStatus {
  active
  checkpoint
  dead
}

model FacebookAccount {
  id              String   @id @default(cuid())
  userId          String
  label           String
  encryptedCookie String
  encryptedProxy  String?  // flat proxy string ("host:port" hoặc "host:port:user:pass") đã encrypt; API field vẫn gọi là `proxy`
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  health          FacebookAccountHealth?

  @@unique([userId, label])
  @@index([userId])
}

model FacebookAccountHealth {
  id          String   @id @default(cuid())
  accountId   String   @unique
  status      FacebookAccountHealthStatus
  reason      String?
  lastCheckAt DateTime
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  account     FacebookAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([accountId])
}
```

Response shapes:

```js
// search type: 'all'
{
  posts: [{ id, text, author, timestamp, url, platform: 'facebook' }],
  people: [{ id, name, username, profileUrl, image, platform: 'facebook' }],
  pages: [{ id, name, category, likes, pageUrl, image, platform: 'facebook' }],
  groups: [{ id, name, members, privacy, groupUrl, image, platform: 'facebook' }]
}

// comment
{ id, authorName, authorUrl, text, timestamp, likes, replies[], parentId }
```

## Test Plan

| Story | Test File | Focus |
|---|---|---|
| 7.1 | `tests/services/facebookHealth.test.js` | `checkAccountHealth` active/checkpoint/dead, TTL, force, no cookie log. |
| 7.1 | `tests/services/facebookAccountPool.test.js` | pool assignment, proxy affinity, concurrency cap, retry slot. |
| 7.4 | `tests/services/facebookScrape.test.js` | `run`/`runBatch` dispatch, auth resolve, proxyAuth truyền đúng. |
| 7.1 | `tests/scrapers/facebook/hydration.test.js` | `extractHydrationJson` walker, `__typename` filter, DOM fallback. |
| 7.2 | `tests/scrapers/facebook/search.test.js` | multi-type search, `all` sequential + parallel, URL patterns, exact shapes. |
| 7.3 | `tests/scrapers/facebook/comments.test.js` | post URL validation, hydration fallback, reply extraction. |
| 7.3 | `tests/scrapers/facebook/group-posts.test.js` | mobile UA, private group `note`, URL validation. |
| 7.3 | `tests/scrapers/facebook/group-comments.test.js` | group post URL validation, thin wrapper. |
| 7.4 | `tests/mcp/facebook-epic7-tools.test.js` | MCP tool input schema, dispatch qua `FacebookScrapeService`, contract tests. |
| 7.4 | `tests/api/facebook-scrape.test.js` | `POST /api/facebook/scrape` action allowlist + proxy + auth. |
| 7.1 | `tests/api/facebook-accounts.test.js` | create với `proxy`, `encryptedProxy`, update proxy (nếu có PATCH). |

## Cross-Cutting Implementation Order

1. 7.1
2. 7.2
3. 7.3
4. 7.4
