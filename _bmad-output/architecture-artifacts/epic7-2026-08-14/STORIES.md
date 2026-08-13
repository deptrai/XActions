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
- Trả về `{ status: 'active' | 'checkpoint' | 'dead', reason?, lastCheckAt }`.
- `checkpoint` nếu body chứa `/checkpoint/` hoặc `confirm that you're human`.
- `dead` nếu `fb_dtsg` hoặc `c_user` hoặc `xs` thiếu.
- Cookie values không bao giờ log.

### Implementation Notes

- Dùng `axios`, `buildCookieString` từ `src/scrapers/facebook/graphql.js`.
- Cache kết quả vào `FacebookAccountHealth` (Prisma), TTL 5 phút.
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

- Dùng `p-limit@7.2.0` cho concurrency cap.
- Wrapper xử lý delay giữa các lần launch.
- Proxy affinity: nhóm account theo proxy trước khi gán.

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

- Mở rộng `searchTweets` hiện tại hoặc thêm hàm `searchFacebook`.
- URL patterns:
  - posts: `/search/posts?q=...`
  - people: `/search/people?q=...`
  - pages: `/search/pages?q=...`
  - groups: `/search/groups?q=...`
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

- Dùng `extractHydrationJson` để tìm `Comment` nodes.
- DOM fallback: query role/aria-label selectors.
- Mobile UA không bắt buộc; desktop có thể show nested replies.

## Story 7.5: Scrape Group Posts

**FR:** FR-59
**NFR:** NFR-10, NFR-14, NFR-15
**File target:** `src/scrapers/facebook/index.js` (hàm `scrapeFacebookGroupPosts`)

### Acceptance Criteria

- Input: `groupUrl`, `limit`, `authCookie`.
- Dùng mobile UA (390x844).
- Trả về posts với shape tương tự `scrapeTweets`.
- Trả về `note` nếu group private/restricted và account không phải member.

### Implementation Notes

- `groupUrl` validate chứa `facebook.com/groups/`.
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
- `api/routes/facebook.js` `POST /scrape` gọi `facebookScrapeService`.
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
| `x_facebook_posts` | `posts` | `url` (profile/page), `limit`, `authCookie` |

### API Contract

```
POST /api/facebook/scrape
Body: { action, ...args, authCookie }
Response: { ok: true, action, result }
```

Valid `action`: `profile`, `posts`, `followers`, `search`, `group-members`, `marketplace`, `post_comments`, `group_posts`, `group_comments`, `search_multi` `[ASSUMPTION]`.

## Cross-Cutting Implementation Order

1. 7.1 + 7.7 (infrastructure)
2. 7.2 (parallel runner)
3. 7.8 (service + API + MCP thin wrappers)
4. 7.3, 7.4, 7.5 (read scrapers)
5. 7.6 (group comments wrapper)
