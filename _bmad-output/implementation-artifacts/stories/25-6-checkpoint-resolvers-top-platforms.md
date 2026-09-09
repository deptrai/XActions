---
title: 'Story 25.6: Checkpoint Resolvers for Top Platforms'
type: 'feature'
created: '2026-09-09'
status: 'done'
review_loop_iteration: 0
context:
  - src/scrapers/social/facebook/crawler.js
  - src/scrapers/social/twitter/crawler.js
  - src/scrapers/social/tiktok/crawler.js
  - src/scrapers/social/threads/crawler.js
  - src/scrapers/ecom/shopee/crawler.js
  - src/scrapers/realestate/batdongsan/crawler.js
  - src/core/base-crawler.js
  - src/core/types.js
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Các crawler con đã gọi `saveCheckpoint()` nhưng mỗi crawler tự quyết định `targetType` / `targetKey` theo cách riêng. Để Auto Checkpoint Lookup hoạt động đáng tin cậy, cần đăng ký `checkpointResolver` nhất quán cho các action chính của Facebook, Twitter, TikTok, Threads, Shopee, Batdongsan.

**Approach:**
1. Trong mỗi crawler con, thêm `checkpointResolver` vào `registerAction()` cho các paginated actions.
2. `checkpointResolver` trả về `{ targetType, targetKey, cursorField, fallbackCursorFields }` với `targetKey` được chuẩn hóa (sorted key-value, trim, lowercase, không chứa pagination params).
3. Đảm bảo resolver chỉ chạy cho action hỗ trợ `cursor`/`after`/`page`/v.v.
4. Đối với action chưa lưu checkpoint (Shopee `search_products`), bổ sung `saveCheckpoint()` trước khi thêm resolver.

## Boundaries & Constraints

**Always:**
- Chỉ sửa file `crawler.js` của các platform được liệt kê và file test tương ứng.
- `targetKey` phải ổn định, deterministic, và không phụ thuộc vào `limit`/`cursor`/`page`/`offset`.
- Giữ nguyên `saveCheckpoint()` calls hiện có; chỉ thêm resolver vào `registerAction`.
- `cursorField` phải là field mà action handler thực sự đọc (ví dụ `'after'` cho các action comment dùng `args.after`, `'page'` cho Batdongsan/Shopee). `AbstractCrawler` sẽ inject `lastCursor` vào đúng field này.
- `fallbackCursorFields` chứa các field khác cũng có thể chứa cursor; `AbstractCrawler` dùng nó để detect caller đã truyền cursor chưa (nếu đã truyền thì không override).
- `targetKey` phải khớp chính xác với key đang được `saveCheckpoint()` ghi vào DB; nếu format hiện tại không ổn định, phải chuẩn hóa **cả resolver và saveCheckpoint** về cùng một format.

**Ask First:**
- Nếu cần thay đổi cách `targetKey` đang được lưu hiện tại (ví dụ Facebook marketplace đã dùng key phức tạp).
- Nếu một action cần `targetKey` đặc biệt (ví dụ `post_comments` cần `postId` làm key).

**Never:**
- Không thay đổi `targetKey` format đang được lưu trong `CrawlCheckpoint` nếu sẽ làm hỏng lookup.
- Không đăng ký resolver cho action không phải pagination.
- Không hardcode logic từ crawler con vào `AbstractCrawler`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Facebook group_posts | `args: { groupId: '123' }` | `targetType: 'group'`, `targetKey: '123'`, `cursorField: 'cursor', fallbackCursorFields: ['after']` | Resolver trả `null` nếu `groupId` missing |
| Facebook page_posts | `args: { pageId: '456' }` | `targetType: 'page'`, `targetKey: '456'`, `cursorField: 'cursor', fallbackCursorFields: ['after']` | Resolver trả `null` nếu `pageId` missing |
| Facebook search | `args: { query: 'ai', type: 'posts' }` | `targetType: 'search'`, `targetKey: 'ai:posts'`, `cursorField: 'cursor', fallbackCursorFields: ['after']` | Trim + lowercase query/type |
| Facebook group_search | `args: { groupUrl: 'https://fb.com/g/123', query: 'ai' }` | `targetType: 'search'`, `targetKey: '123:ai'`, `cursorField: 'cursor', fallbackCursorFields: ['after']` | Resolve groupId từ URL |
| Facebook marketplace | `args: { query: 'laptop', location: 'HCMC', minPrice: 100 }` | `targetType: 'marketplace'`, `targetKey: 'laptop:HCMC::100:'` (khớp format hiện tại), `cursorField: 'after'`, `fallbackCursorFields: ['cursor']` | Bỏ qua params undefined/null/empty |
| Facebook get_comments | `args: { postId: 'post_123' }` | `targetType: 'post_comments'`, `targetKey: 'post_123'`, `cursorField: 'after'`, `fallbackCursorFields: ['cursor']` | Resolver trả `null` nếu postId missing |
| Facebook post_comments | `args: { url: 'https://fb.com/...' }` | `targetType: 'post_comments'`, `targetKey: resolvedPostExternalId`, `cursorField: 'after'`, `fallbackCursorFields: ['cursor']` | Dùng `extractPostExternalId` |
| Facebook group_comments | `args: { url: 'https://fb.com/groups/...' }` | `targetType: 'group_comments'`, `targetKey: resolvedPostExternalId`, `cursorField: 'after'`, `fallbackCursorFields: ['cursor']` | Dùng `extractPostExternalId` |
| Facebook group_members | `args: { groupId: '123' }` hoặc `groupUrl` | `targetType: 'group_members'`, `targetKey: '123'`, `cursorField: 'cursor', fallbackCursorFields: ['after']` | Resolve groupId từ `groupUrl` hoặc `groupId` |
| Facebook followers | `args: { username: 'zuck' }` hoặc `url` | `targetType: 'followers'`, `targetKey: 'zuck'`, `cursorField: 'cursor', fallbackCursorFields: ['after']` | Dùng `resolveTargetKey` |
| Facebook following | `args: { username: 'zuck' }` hoặc `url` | `targetType: 'following'`, `targetKey: 'zuck'`, `cursorField: 'cursor', fallbackCursorFields: ['after']` | Dùng `resolveTargetKey` |
| Twitter search | `args: { query: 'ai', type: 'Latest' }` | `targetType: 'search'`, `targetKey: 'ai'`, `cursorField: 'cursor', fallbackCursorFields: ['after']` | Dùng `args.query` làm key; `type` chỉ ảnh hưởng product, không đổi key |
| Twitter hashtag | `args: { tag: 'AI' }` | `targetType: 'hashtag'`, `targetKey: 'ai'`, `cursorField: 'cursor', fallbackCursorFields: ['after']` | Strip `#`, lowercase |
| Twitter followers | `args: { username: 'elonmusk' }` | `targetType: 'followers'`, `targetKey: 'elonmusk'`, `cursorField: 'cursor', fallbackCursorFields: ['after']` | Dùng `resolveUsername` |
| Twitter following | `args: { username: 'elonmusk' }` | `targetType: 'following'`, `targetKey: 'elonmusk'`, `cursorField: 'cursor', fallbackCursorFields: ['after']` | Dùng `resolveUsername` |
| Twitter likes | `args: { tweetId: '123' }` | `targetType: 'likes'`, `targetKey: '123'`, `cursorField: 'cursor', fallbackCursorFields: ['after']` | Dùng `resolveTweetId` |
| Twitter bookmarks | `args: {}` | `targetType: 'bookmarks'`, `targetKey: 'self'`, `cursorField: 'cursor', fallbackCursorFields: ['after']` | `accountId` fallback `'self'` |
| Twitter list_members | `args: { listId: '123' }` hoặc `listUrl` | `targetType: 'list_members'`, `targetKey: 'twitter:list:123'`, `cursorField: 'cursor', fallbackCursorFields: ['after']` | Extract listId từ URL |
| Twitter media | `args: { username: 'elonmusk' }` | `targetType: 'media'`, `targetKey: 'twitter:user:elonmusk'`, `cursorField: 'cursor', fallbackCursorFields: ['after']` | Dùng `resolveUsername` |
| TikTok search | `args: { query: 'viral' }` | `targetType: 'search'`, `targetKey: 'viral'`, `cursorField: 'cursor', fallbackCursorFields: ['after']` | Trim query |
| TikTok hashtag_feed | `args: { tag: 'foryou' }` | `targetType: 'hashtag'`, `targetKey: 'foryou'`, `cursorField: 'cursor', fallbackCursorFields: ['after']` | Trim + lowercase |
| TikTok get_post_comments | `args: { videoId: '123' }` | `targetType: 'post_comments'`, `targetKey: '123'`, `cursorField: 'cursor', fallbackCursorFields: ['after']`, `fallbackCursorFields: ['after']` | Dùng videoId |
| Threads get_user_feed | `args: { username: 'zuck' }` | `targetType: 'user_feed'`, `targetKey: 'zuck'`, `cursorField: 'cursor', fallbackCursorFields: ['after']` | Trim + lowercase |
| Threads search | `args: { query: 'ai' }` | `targetType: 'search'`, `targetKey: 'ai'`, `cursorField: 'cursor', fallbackCursorFields: ['after']` | Trim query |
| Threads get_post_comments | `args: { postId: 'CuZ7X9_sF9y' }` | `targetType: 'post_comments'`, `targetKey: 'CuZ7X9_sF9y'`, `cursorField: 'cursor', fallbackCursorFields: ['after']`, `fallbackCursorFields: ['after']` | Dùng postId |
| Shopee search_products | `args: { keyword: 'phone' }` | `targetType: 'search'`, `targetKey: 'phone'`, `cursorField: 'page'` | Phải thêm `saveCheckpoint()` trong handler |
| Batdongsan search_listings | `args: { city: 'hanoi', category: 'can-ho' }` | `targetType: 'listings'`, `targetKey: 'SG:0:38'` (khớp format hiện tại), `cursorField: 'page'` | `city` map qua `CITY_ALIAS_MAP` |
| Missing required arg | `args: {}` | Không lookup checkpoint | `checkpointResolver` trả `null` |

## Code Map

- `src/scrapers/social/facebook/crawler.js` — resolvers cho `group_posts`, `page_posts`, `search`, `group_search`, `marketplace`, `get_comments`, `post_comments`, `group_comments`, `group_members`, `followers`, `following`.
- `src/scrapers/social/twitter/crawler.js` — resolvers cho `search`, `hashtag`, `followers`, `following`, `likes`, `bookmarks`, `list_members`, `media`.
- `src/scrapers/social/tiktok/crawler.js` — resolvers cho `search`, `hashtag_feed`, `get_post_comments`.
- `src/scrapers/social/threads/crawler.js` — resolvers cho `get_user_feed`, `search`, `get_post_comments`.
- `src/scrapers/ecom/shopee/crawler.js` — resolver cho `search_products` **và thêm `saveCheckpoint()` trong `searchProducts()`**.
- `src/scrapers/realestate/batdongsan/crawler.js` — resolver cho `search_listings` với `cursorField: 'page'`.

## Tasks & Acceptance

**Execution:**
- [x] Facebook — đăng ký `checkpointResolver` cho `group_posts`, `page_posts`, `search`, `group_search`, `marketplace`, `get_comments`, `post_comments`, `group_comments`, `group_members`, `followers`, `following`.
- [x] Twitter — đăng ký cho `search`, `hashtag`, `followers`, `following`, `likes`, `bookmarks`, `list_members`, `media`.
- [x] TikTok — đăng ký cho `search`, `hashtag_feed`, `get_post_comments`.
- [x] Threads — đăng ký cho `get_user_feed`, `search`, `get_post_comments`.
- [x] Shopee — thêm `saveCheckpoint()` trong `searchProducts()` và đăng ký resolver cho `search_products`.
- [x] Batdongsan — đăng ký resolver cho `search_listings` với `cursorField: 'page'`.
- [x] `tests/scrapers/social/facebook/checkpoint-resolver.test.js` — test Facebook resolvers.
- [x] `tests/scrapers/social/twitter/checkpoint-resolver.test.js` — test Twitter resolvers.
- [x] `tests/scrapers/social/tiktok/checkpoint-resolver.test.js` — test TikTok resolvers.
- [x] `tests/scrapers/social/threads/checkpoint-resolver.test.js` — test Threads resolvers.
- [x] `tests/scrapers/ecom/shopee/checkpoint-resolver.test.js` — test Shopee resolver.
- [x] `tests/scrapers/realestate/batdongsan/checkpoint-resolver.test.js` — test Batdongsan resolver.

**Acceptance Criteria:**
- Given action `group_posts` với `args: { groupId: '123' }`, then `checkpointResolver` trả `{ targetType: 'group', targetKey: '123', cursorField: 'cursor' }`.
- Given action `marketplace` với `args: { query: 'laptop', location: 'HCMC', minPrice: 100, limit: 20 }`, then `targetKey` là `'laptop:HCMC::100:'` (khớp format `saveCheckpoint` hiện tại, không chứa `limit`).
- Given action không đủ required args, then `checkpointResolver` trả `null` và không lookup checkpoint.
- Given `store.getCheckpoint()` trả `lastCursor`, then `AbstractCrawler.start()` inject vào `args` đúng field (`cursor`, `after`, hoặc `page`).

## Spec Change Log

- 2026-09-09 — Tạo story từ sprint-change-proposal-2026-09-09-checkpoint-resume.md.
- 2026-09-09 — Patch sau validation: bổ sung Shopee `saveCheckpoint` missing, Batdongsan `cursorField: 'page'`, `fallbackCursorFields: ['after']` cho comment/marketplace/followers actions, chuẩn hóa `targetKey` khớp format `saveCheckpoint` hiện tại.
- 2026-09-09 — Implementation complete: resolvers registered for Facebook (11 actions), Twitter (8 actions), TikTok (3 actions), Threads (3 actions), Shopee (1 action + saveCheckpoint added), Batdongsan (1 action). 34/34 resolver unit tests pass; 16/16 core checkpoint tests pass; 429/429 regression tests pass.

## Design Notes

- `targetKey` được tạo bằng cách: lấy các key-value quan trọng, sort alphabet, join bằng `|`. Ví dụ: `['query', 'laptop'], ['location', 'hcmc']` → `'location=hcmc|query=laptop'`. **Tuy nhiên**, để không làm hỏng lookup, `targetKey` phải khớp chính xác với format mà `saveCheckpoint()` đang ghi. Ví dụ:
  - Facebook marketplace: `[query, location, category, categoryId, minPrice, maxPrice].filter(v => v != null && v !== '').join(':')`
  - Batdongsan: `${city}:${cateCode}:${ptype}`
  - Facebook search: `${query}:${type}`
  - Facebook group_search: `${groupId}:${rawQuery}`
- `cursorField` mặc định là `'cursor'`; nếu platform dùng `after` hoặc `page`, phải set `cursorField` và `fallbackCursorFields` tương ứng.
- Không cần sửa `saveCheckpoint()` calls hiện có **trừ Shopee `search_products`** vì hiện tại chưa lưu checkpoint.
- Với các action dùng `after` thay `cursor` (Facebook `get_comments`, `post_comments`, `group_comments`, `marketplace`, `followers`, `following`, `group_members`; TikTok/Threads `get_post_comments`), `cursorField` phải là `'after'` và `fallbackCursorFields: ['cursor']` để `AbstractCrawler` detect caller-supplied cursor đồng thời inject vào đúng field.

## Verification

**Commands:**
- `npx vitest run tests/scrapers/social/facebook/checkpoint-resolver.test.js`
- `npx vitest run tests/scrapers/social/twitter/checkpoint-resolver.test.js`
- `npx vitest run tests/scrapers/social/tiktok/checkpoint-resolver.test.js`
- `npx vitest run tests/scrapers/social/threads/checkpoint-resolver.test.js`
- `npx vitest run tests/scrapers/ecom/shopee/checkpoint-resolver.test.js`
- `npx vitest run tests/scrapers/realestate/batdongsan/checkpoint-resolver.test.js`
- `npx vitest run tests/core/base-crawler.checkpoint.test.js` — đảm bảo ACL vẫn hoạt động.
