---
title: 'Story 25.7: Early Termination in Crawler Pagination Loops'
type: 'feature'
created: '2026-09-09'
status: 'ready-for-dev'
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
- [ ] Facebook — thêm `shouldStopPagination()` vào các vòng lặp pagination chính.
- [ ] Twitter — thêm `shouldStopPagination()` vào các vòng lặp pagination chính.
- [ ] TikTok — thêm `shouldStopPagination()` vào các vòng lặp pagination chính.
- [ ] Threads — thêm `shouldStopPagination()` vào các vòng lặp pagination chính.
- [ ] Shopee — thêm `shouldStopPagination()` vào `search_products`.
- [ ] Batdongsan — thêm `shouldStopPagination()` vào `search_listings`.
- [ ] `tests/scrapers/social/facebook/early-termination.test.js` — test ET.
- [ ] `tests/scrapers/social/twitter/early-termination.test.js` — test ET.
- [ ] `tests/scrapers/social/tiktok/early-termination.test.js` — test ET.
- [ ] Integration test: gọi `scrape()` lần 1, lần 2 verify ít request hơn.

**Acceptance Criteria:**
- Given `storeBatch()` trả `insertedCount: 0`, `duplicateCount: N` khi page toàn duplicates, then `shouldStopPagination()` trả `true` và loop break.
- Given `storeBatch()` trả `insertedCount: 1`, `duplicateCount: N-1`, then `shouldStopPagination()` trả `false` và loop tiếp tục.
- Given `shouldStopPagination()` được gọi, then `saveCheckpoint()` vẫn được gọi với `lastCursor` mới nhất trước khi break.
- Given action non-paginated, then `shouldStopPagination()` không được gọi.
- Given test suite, when chạy `npm test`, then không có regression.

## Spec Change Log

- 2026-09-09 — Tạo story từ sprint-change-proposal-2026-09-09-checkpoint-resume.md.

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
