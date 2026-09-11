---
title: 'Story 25.7: Early Termination in Crawler Pagination Loops'
type: 'feature'
created: '2026-09-09'
status: 'review'
baseline_commit: '15472f9e89cc04748e1c1763a883fc8a04b9d0b8'
review_loop_iteration: 0
context:
  - src/core/base-crawler.js
  - src/store/prisma-store.js
  - src/scrapers/social/facebook/crawler.js
  - src/scrapers/social/twitter/crawler.js
  - src/scrapers/social/tiktok/crawler.js
  - src/scrapers/social/threads/crawler.js
  - src/scrapers/ecom/shopee/crawler.js
  - src/scrapers/realestate/batdongsan/crawler.js
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Các crawler con gọi `storeBatch()` nhưng không kiểm tra có bao nhiêu item thực sự được insert. Khi chạy định kỳ, trang đầu tiên có thể toàn bài đã có trong DB, nhưng crawler vẫn tiếp tục cào trang 2, 3, 4... gây lãng phí proxy request.

**Approach:**
1. Sửa các vòng lặp pagination trong crawler con để kiểm tra `await this.shouldStopPagination(items)` sau mỗi `storeBatch()`.
2. Nếu `shouldStopPagination()` trả `true` (tất cả items đã tồn tại), break loop và trả kết quả.
3. Áp dụng cho ít nhất Facebook, Twitter, TikTok trong first pass; các crawler khác làm follow-up.

## Boundaries & Constraints

**Always:**
- Chỉ sửa vòng lặp pagination trong crawler con; không thay đổi `saveCheckpoint()` hoặc `storeBatch()` signature.
- `shouldStopPagination()` phải được gọi sau `storeBatch()` hoặc trước khi fetch trang tiếp theo.
- Giữ `has_next_page` / `pageInfo` handling hiện có; chỉ thêm early-break khi duplicates.
- Nếu `storeBatch()` không trả về metadata (legacy store), `shouldStopPagination()` trả `false` (safe fallback).

**Ask First:**
- Nếu cần thay đổi `AbstractStore` interface để thêm callback thay vì `findExistingIds()`.
- Nếu cần thêm threshold (ví dụ dừng khi >90% duplicates thay vì 100%).

**Never:**
- Không bỏ `saveCheckpoint()` sau khi break; checkpoint vẫn phải được ghi.
- Không thay đổi output shape trả về từ handler.
- Không áp dụng ET cho action non-paginated.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Page 1 all duplicates | `items` đã có trong DB | `shouldStopPagination()` → `true`, break loop | Không throw |
| Page 1 has new items | Một số items mới | `shouldStopPagination()` → `false`, tiếp tục | Không break |
| No store / no metadata | `store` null hoặc `storeBatch` return undefined | `shouldStopPagination()` → `false` | Safe fallback |
| Last page | `has_next_page: false` | Loop tự kết thúc | Không cần ET |
| Empty page | `items: []` | `shouldStopPagination()` → `false` hoặc `true` (tùy impl) | Không break sớm nếu items rỗng |

## Code Map

- `src/core/base-crawler.js` — helper `shouldStopPagination(items)` đã được thêm ở Story 25.5.
- `src/scrapers/social/facebook/crawler.js` — vòng lặp `groupPosts`, `pagePosts`, `search`, `marketplace`, `groupSearch`, `postComments`, `groupComments`, `groupMembers`, `followers`, `following`.
- `src/scrapers/social/twitter/crawler.js` — vòng lặp `search`, `hashtag`, `followers`, `following`, `likes`, `bookmarks`, `media`, `listMembers`.
- `src/scrapers/social/tiktok/crawler.js` — vòng lặp `search`, `hashtag_feed`, `get_post_comments`.
- `src/scrapers/social/threads/crawler.js` — vòng lặp `search`, `get_user_feed`, `get_post_comments`.
- `src/scrapers/ecom/shopee/crawler.js` — vòng lặp `search_products`.
- `src/scrapers/realestate/batdongsan/crawler.js` — vòng lặp `search_listings`.

## Tasks & Acceptance

**Execution:**
- [x] Facebook — thêm `shouldStopPagination()` vào các vòng lặp pagination chính.
- [x] Twitter — thêm `shouldStopPagination()` vào các vòng lặp pagination chính.
- [x] TikTok — thêm `shouldStopPagination()` vào các vòng lặp pagination chính.
- [x] Threads — thêm `shouldStopPagination()` vào các vòng lặp pagination chính.
- [x] Shopee — thêm `shouldStopPagination()` vào `search_products`.
- [x] Batdongsan — thêm `shouldStopPagination()` vào `search_listings`.
- [x] `tests/scrapers/social/facebook/early-termination.test.js` — test ET.
- [x] `tests/scrapers/social/twitter/early-termination.test.js` — test ET.
- [x] `tests/scrapers/social/tiktok/early-termination.test.js` — test ET.
- [x] Integration test: gọi `scrape()` lần 1, lần 2 verify ít request hơn.

**Acceptance Criteria:**
- Given `storeBatch()` trả `insertedCount: 0`, `duplicateCount: N` khi page toàn duplicates, then `shouldStopPagination()` trả `true` và loop break.
- Given `storeBatch()` trả `insertedCount: 1`, `duplicateCount: N-1`, then `shouldStopPagination()` trả `false` và loop tiếp tục.
- Given `shouldStopPagination()` được gọi, then `saveCheckpoint()` vẫn được gọi với `lastCursor` mới nhất trước khi break.
- Given action non-paginated, then `shouldStopPagination()` không được gọi.
- Given test suite, when chạy `npm test`, then không có regression.

## Spec Change Log

- 2026-09-09 — Tạo story từ sprint-change-proposal-2026-09-09-checkpoint-resume.md.
- 2026-09-11 — Implementation notes (dev):
  - Facebook: mask `has_next_page` sau `storeBatch` ở `groupPosts`/`pagePosts`/`#searchByType`/`groupSearch`/`marketplace`/`#processGroupMembersBridgeResult`; in-loop ET trong `followers`/`following`/`groupMembers` (`postItems.slice(pageStart)` per page); `getCommentsForPost` — ET trong `fetchLayer` (normalize per-page ids) + post-extract mask.
  - Twitter: `#persistPostItems` giờ trả aggregate `{insertedCount,totalCount}` (signature params không đổi); in-loop ET trong `#paginateSearch` + `#paginateUserMedia` (per-page `pageItems`/`pagePosts`); mask ở `search`/`hashtag`/`likes`/`bookmarks`/`followers`/`following`/`listMembers`/`media`.
  - TikTok: mask `search`/`hashtagFeed`; `getPostComments` — ET trong `fetchLayer` + post-extract mask qua `storeCommentBatch` result.
  - Threads: mask `getUserFeed` + `searchPosts` (cả GraphQL lẫn SSR path); `getPostComments` — `applyEarlyTermination` closure trong `fetchLayer` (3 return paths) + post-extract mask.
  - Shopee `searchProducts`: `savePosts` không trả metadata → items-fallback `shouldStopPagination(products)` mask `hasNext`. Batdongsan: capture `batch` từ `storeBatch` → `batch ?? listings`.
  - Tests: 16 tests pass (3 file mới). Regression `npm test`: 5770 pass; 1 failure pre-existing flaky (`admin-checkpoints` AC-4, pass khi chạy riêng); 1 failure `tiktok-scraper.e2e` do fixture dùng trùng post id `…789` giữa `video_detail` và `search` — ET đúng (all-dupes → `has_next_page=false`) — đã fix fixture sang id riêng `…795`.
- 2026-09-11 — Validation notes (kiểm chứng đối chiếu codebase, không sửa frozen intent):
  - `shouldStopPagination()` đã tồn tại ở `src/core/base-crawler.js:469`; `storeBatch()` trả `{ insertedCount, duplicateCount, totalCount, schemaValid }` (`prisma-store.js:282`); `findExistingIds` ở `prisma-store.js:466`. Precedent pattern đã ship ở instagram/reddit/medium: `stopPagination = await this.shouldStopPagination(batch ?? posts)` rồi mask `has_next_page`.
  - FB (`followers`/`following`/`groupMembers`) và Twitter (`#persistPostItems` sau `#paginateSearch`) persist POST-LOOP — `storeBatch` không nằm trong vòng lặp fetch. Để tiết kiệm request trong cùng 1 run, đặt `shouldStopPagination(pageItems)` bên trong `while` loop (đường `findExistingIds`), hoặc chấp nhận chỉ tiết kiệm cross-invocation như precedent.
  - FB `postComments`/`groupComments` không gọi `storeBatch` → chỉ dùng items-fallback; verify comment items có `.id` string.
  - Shopee `searchProducts` dùng `savePosts()` (không phải `storeBatch`) và là single-fetch → ET = mask `has_next_page`. Batdongsan `searchListings` single-fetch nhưng có `storeBatch` — cần capture return value (`const batch = await ...`).
  - Twitter: sửa `#paginateSearch` + `#paginateUserMedia` có thể cover phần lớn 8 actions trong 1 chỗ.

## Design Notes

- `shouldStopPagination()` có thể implement bằng `findExistingIds()` hoặc bằng metadata `insertedCount === 0` từ `storeBatch()`.
- Để đơn giản, khuyến nghị dùng `storeBatch()` metadata: nếu `insertedCount === 0 && totalCount > 0` thì break.
- Nếu `storeBatch()` không hỗ trợ metadata, fallback `findExistingIds()` trong helper.

## Verification

**Commands:**
- `npx vitest run tests/scrapers/social/facebook/early-termination.test.js`
- `npx vitest run tests/scrapers/social/twitter/early-termination.test.js`
- `npx vitest run tests/scrapers/social/tiktok/early-termination.test.js`
- `npm test` — regression check toàn bộ.
