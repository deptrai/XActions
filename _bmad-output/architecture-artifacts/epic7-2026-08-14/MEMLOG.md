# Memlog — Epic 7 Architecture

## 1. What problem does this system solve?

Epic 7 mở rộng khả năng **đọc** Facebook của XActions để phục vụ lead generation và market research: search đa loại (posts/people/pages/groups), scrape comments của post, scrape posts/comments trong group, và chạy song song bằng nhiều account đã nuôi. Tất cả xuất JSON, không ghi dữ liệu trong XActions.

## 2. Who are the actors and what are the inputs/outputs?

- **Actors:** người dùng growth/marketing, AI agent qua MCP, API client.
- **Inputs:** `query`, `postUrl`, `groupUrl`, `authCookie`/`accountId`, `type`, `limit`, `parallel`, `maxConcurrency`.
- **Outputs:** JSON arrays/objects với `platform: 'facebook'`, kèm `note` khi bị giới hạn.

## 3. What are the main components?

- `FacebookAccountHealthService` — kiểm tra account live qua HTTP, lưu cache.
- `FacebookAccountPool` — quản lý pool tài khoản, gán task, giới hạn concurrency, proxy affinity.
- `FacebookScrapeService` — điều phối `run` (single) và `runBatch` (parallel) cho API/MCP; dispatch qua `scrape('facebook', action, args)` hoặc fan-out `type: 'all'` nội bộ.
- `FacebookAuthResolver` — helper resolve `authCookie` (`{ c_user, xs }` hoặc `{ accountId }`) dùng chung cho API + MCP.
- `FacebookScrapers` — các hàm Puppeteer: `searchFacebook`, `scrapeFacebookComments`, `scrapeFacebookGroupPosts`, `extractHydrationJson`.
- `API route` `POST /api/facebook/scrape` — REST surface.
- `MCP tool handlers` — 5 tools mới: `x_facebook_search`, `x_facebook_post_comments`, `x_facebook_group_posts`, `x_facebook_group_comments`, `x_facebook_posts`.
- `Prisma` — `FacebookAccount` + `FacebookAccountHealth`.

## 4. What are the boundaries and integration points?

- **Prisma/DB:** lưu account, health cache. Kết quả scrape KHÔNG lưu.
- **Puppeteer:** mở browser, login cookie, page interactions. Mỗi task mở browser riêng.
- **axios:** health check + Phase-3 GraphQL replay fallback.
- **MCP SDK:** tool đăng ký trong `src/mcp/server.js`.
- **p-limit:** concurrency cap cho `runBatch`.
- **Proxy rotation:** `src/scrapers/facebook/proxy.js` và `FacebookAccount.proxy`.

## 5. What are the risks, constraints, and decisions?

- **Account checkpoint** — cần health check trước và retry khi gặp checkpoint giữa chừng.
- **Concurrency cap** — mặc định 4, max 8 browsers để giảm risk.
- **Proxy affinity** — mỗi account gắn proxy cố định nếu có.
- **No TLS/JA3 impersonation** — `axios` + headers thật là đủ cho Epic 7; chỉ cân nhắc `node-libcurl-ja3` nếu Phase-3 GraphQL bị block.
- **p-limit@7.2.0 pin exact** — dùng cho concurrency cap, wrapper cho delay/proxy.
- **No data storage** — chỉ trả JSON, không ghi DB.
