---
created: 2026-08-14
trigger: user requested expansion of Facebook scraping capabilities — multi-type search, posts, comments, group posts, group comments, account health filtering, and multi-account parallel execution
mode: batch
---

# Sprint Change Proposal — Facebook Advanced Scraping & Multi-Account Parallel Execution

## 1. Issue Summary

Người dùng yêu cầu mở rộng đáng kể khả năng scrape Facebook của XActions để phục vụ **lead generation** và **market research**, với các tính năng:

- Search đồng thời: posts, people, pages, groups.
- Scrape post comments (top-level + replies).
- Scrape group posts.
- Scrape group comments.
- Lọc account trước khi dùng — chỉ dùng account "live".
- Chạy song song nhiều task với nhiều account để tối ưu tốc độ.
- Làm API và MCP trước, UI tính sau.
- Không lưu trữ dữ liệu scrape trong XActions; chỉ trả JSON.

Các yêu cầu này vượt ra ngoài scope Facebook Platform Extension v1 (PRD `prd-XActions-2026-06-08` §6.2 và PRD Epic 4 `prd-XActions-2026-06-10-epic4` §5-6). Nhiều khía cạnh — multi-account/proxy pool, Marketplace, Groups, comments — từng được defer sang v2/v3.

## 2. Impact Analysis

### 2.1 Epic Impact

| Epic / Story | Tác động | Ghi chú |
|--------------|----------|---------|
| Epic 1 — Facebook Data Reading | Trung bình | `searchTweets`, `scrapeTweets` đã có sẵn, cần mở rộng tính năng và đổi tên rõ nghĩa hơn. |
| Epic 3 — Multi-Surface & Persistence | Trung bình | Cần expose MCP tool mới (`x_facebook_search`, `x_facebook_posts`, `x_facebook_post_comments`, `x_facebook_group_posts`, `x_facebook_group_comments`). Story `3.2.1` hiện backlog nên được giữ lại hoặc merge. |
| Epic 4 — Growth Automation | Thấp | Multi-account/session pool từng bị defer (Cluster 5) nay trở lại nhưng ở dạng đọc, không ghi, nên rủi ro thấp hơn. |
| Epic 5/5b — Messenger/Marketplace | Thấp-Trung bình | `scrapeMarketplace` đã hoạt động; multi-type search mở rộng từ `searchTweets`. |
| Epic 6 — Anti-Detection | Thấp | Tái dùng toàn bộ fingerprint, proxy, warmup; không thay đổi core. |
| **Epic 7 mới** | Cao | Tạo epic mới cho toàn bộ scope này. |

### 2.2 Artifact Conflict

| Artifact | Xung đột? | Chi tiết |
|----------|-----------|----------|
| `prd-XActions-2026-06-08/prd.md` | Có | §6.2 ghi Groups/Marketplace/multi-account ngoài scope MVP. Cần cập nhật hoặc tham chiếu đến Epic 7. |
| `prd-XActions-2026-06-10-epic4/prd.md` | Có | §5 và §6.2 defer Cluster 5 (multi-account/proxy). Cần ghi nhận Epic 7. |
| `epics-full.md` | Có | Chưa có Epic 7; cần thêm. |
| `sprint-status.yaml` | Có | Chưa có epic-7 và stories. Cần thêm. |
| `src/scrapers/facebook/index.js` | Không | Đã có `scrapeTweets`, `searchTweets`, `scrapeMarketplace`, `scrapeGroupMembers`, `graphql.js`. Cần extend, không xoá. |
| `src/scrapers/index.js` | Không | Cần thêm action map. |
| `api/routes/facebook.js` | Không | Cần thêm `VALID_ACTIONS` và service. |
| `src/mcp/server.js` | Không | Cần thêm tool schema + handler. |
| `prisma/schema.prisma` | Trung bình | Cần quyết định thêm `FacebookAccountHealth` model hay dùng cache. |
| `architecture.md` | Trung bình | Addendum A/B nên thêm ADR mới cho hydration/GraphQL và account pool. |

### 2.3 PRD / MVP Impact

- MVP của Facebook Platform Extension v1 không thay đổi.
- Phạm vi mới là **post-MVP**, tạo thành Epic 7 riêng.
- `prd-XActions-2026-06-08` và `prd-XActions-2026-06-10-epic4` cần ghi chú rằng các mục defer nay được phát triển trong Epic 7.

## 3. Recommended Approach

### 3.1 Chiến lược

**Tạo Epic 7 + PRD mới, cập nhật epic catalog và sprint status, không rollback.**

Lý do:
- Code nền tảng (scraper, account pool, anti-detection) đã sẵn sàng từ Epic 1-6.
- Đây là mở rộng tính năng, không phải sửa lỗi.
- Multi-account chỉ dùng để đọc song song, không ghi, nên rủi ro account thấp hơn Cluster 5 gốc.

### 3.2 Kế hoạch thực hiện

| Bước | Hành động | Output |
|------|-----------|--------|
| 1 | Tạo PRD Epic 7 (`prd-XActions-2026-08-14-epic7/prd.md`) | PRD mới |
| 2 | Cập nhật `epics-full.md` thêm Epic 7 | Epic catalog |
| 3 | Cập nhật `sprint-status.yaml` | Backlog tracking |
| 4 | Tạo `facebookScrapeService`, `AccountPool`, `facebookAccountHealth` (Phase 0) | Code Phase 0 |
| 5 | Mở rộng `searchFacebook` multi-type + `scrapeFacebookPosts` (Phase 1) | Code Phase 1 |
| 6 | Implement comments scraper + group posts/comments (Phase 2) | Code Phase 2 |
| 7 | Thêm Hydration JSON / GraphQL replay (Phase 3) | Code Phase 3 |
| 8 | Expose MCP/API tools và contract tests | Surface + tests |

### 3.3 Ước tính effort & rủi ro

- **Effort:** Trung bình-Cao (2-3 tuần, 8 stories).
- **Risk:** Trung bình. Rủi ro chính là selector Facebook thay đổi và account checkpoint khi chạy parallel. Có thể giảm bằng health check và concurrency cap.
- **Timeline impact:** Tùy priority, có thể làm song song với maintenance.

## 4. Detailed Change Proposals

### 4.1 New PRD: `prd-XActions-2026-08-14-epic7/prd.md`

Tài liệu định nghĩa Epic 7: Facebook Advanced Scraping & Multi-Account Parallel Execution.

### 4.2 New Epic 7 (in `epics-full.md`)

**Goal:** Mở rộng khả năng scrape Facebook với multi-type search, comments, group content, account health filtering và parallel execution.

**Stories:**
1. **7.1** Account health check & live filter.
2. **7.2** Account pool & parallel runner.
3. **7.3** Facebook search multi-type.
4. **7.4** Facebook post comments scraper.
5. **7.5** Facebook group posts scraper.
6. **7.6** Facebook group comments scraper.
7. **7.7** Hydration JSON extraction fallback.
8. **7.8** API + MCP surface unification.

### 4.3 Code changes

- `src/scrapers/facebook/index.js` — thêm `searchFacebook`, `scrapeFacebookComments`, `scrapeFacebookGroupPosts`, `scrapeFacebookGroupComments`, `extractHydrationJson`.
- `src/scrapers/index.js` — mở rộng `actionMap`.
- `api/services/facebookScrape.js` — `facebookScrapeService.runBatch(tasks, options)`.
- `api/services/facebookAccountHealth.js` — `checkAccountHealth()`.
- `api/services/facebookAccountPool.js` — `AccountPool` với concurrency limit.
- `api/routes/facebook.js` — thêm actions vào `POST /api/facebook/scrape`.
- `src/mcp/server.js` — thêm `x_facebook_search`, `x_facebook_posts`, `x_facebook_post_comments`, `x_facebook_group_posts`, `x_facebook_group_comments`.
- `prisma/schema.prisma` — thêm `FacebookAccountHealth` model (nếu chọn DB, thay thế Redis cache).

## 5. Handoff Plan

- **Mary / Business Analyst** (tôi): Hoàn tất proposal, PRD, epic catalog.
- **PO / User**: Approve Epic 7 scope và priority.
- **Developer agent**: Implement theo stories.
- **QA / Tester**: Viết contract tests và smoke tests.

## 6. Next Step

Chờ PO approve proposal này trước khi dev agent bắt đầu implement Story 7.1.
