# Epic 13 Context: High-Throughput Hybrid Scraping Engine (Twitter & Facebook Refactor)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Xây dựng động cơ cào lai (hybrid) tốc độ cao cho Twitter/X và Facebook bằng cách kết hợp HTTP GraphQL/REST client (`AbstractApiClient`) với Pre-Signed Token Ring, Signer Worker Page Pool (3s timeout) và Proxy/Account Pool. Mục tiêu là giảm ≥85% RAM so với Puppeteer full-headless, đạt throughput >500 req/s, và chuẩn hóa dữ liệu đầu ra thành `PostItem` / `ProfileItem` / `CommentItem` với Namespaced ID `${platform}:${externalId}`. Đây là nền tảng cho các nền tảng sau này (Threads, TikTok, Shopee, v.v.).

## Stories

- Story 13.1: Tiered Signer Architecture (Pre-Signed Token Ring & Worker Page Pool)
- Story 13.2: Refactor Twitter Scraper to Hybrid Architecture
- Story 13.2.1: Twitter Hybrid Profile & Relationships
- Story 13.2.2: Twitter Hybrid Thread, Likes & Bookmarks
- Story 13.2.3: Twitter Hybrid Search, Hashtag & Trending
- Story 13.2.4: Twitter Hybrid Media Scraper
- Story 13.2.5: Twitter Hybrid Lists, Communities & Spaces
- Story 13.2.6: Twitter Hybrid Content Composition (Post, Reply, Quote)
- Story 13.2.7: Twitter Hybrid Content Scheduling
- Story 13.2.8: Twitter Hybrid Engagement (Like & Retweet)
- Story 13.2.9: Twitter Hybrid Social Graph (Follow, Block, Mute, Bookmark)
- Story 13.2.10: Twitter Hybrid Direct Messaging
- Story 13.2.11: Twitter Hybrid List Management
- Story 13.2.12: Twitter Hybrid Integration & Caller Migration
- Story 13.3: Refactor Facebook Scraper to Hybrid Architecture
- Story 13.4: Facebook Browser-as-Signer Integration
- Story 13.5: Facebook Hybrid Profile, Followers & Group Members
- Story 13.6: Facebook Hybrid Search (Global + Group Search)
- Story 13.7: Facebook Hybrid Post & Group Comments
- Story 13.8: Facebook Hybrid Marketplace
- Story 13.9: Facebook Hybrid Social Actions (Write & Messenger)
- Story 13.10: Facebook Hybrid Integration & Caller Migration

## Requirements & Constraints

- Tất cả crawler mới phải kế thừa `AbstractCrawler` và sử dụng `CrawlerCommand` contract (`action`, `args`, `requiresAuth`, `targetKey`).
- `AbstractApiClient` là lớp cơ sở cho mọi HTTP client; hỗ trợ `got-scraping` / `undici`, proxy pool, adaptive governor, và error envelope chuẩn `PlatformError`.
- Dữ liệu đầu ra phải chuẩn hóa thành `PostItem` / `ProfileItem` / `CommentItem` với `id` dạng `${platform}:${externalId}` và `metadata` JSONB.
- Guest request dùng Pre-Signed Token Ring (`gt`, `lsd`, `jazoest`) + Rotating Proxy; auth request dùng Account Pool + Sticky Proxy.
- Write/mutation action bắt buộc `dryRun=true` mặc định, delay floor (1–7s tùy loại), không log cookie/token, và trả về `PlatformError` với `suggestedAction`.
- Mọi hàm legacy trong `src/scrapers/twitter/` và `src/scrapers/facebook/` phải được gắn `@deprecated` và ghi nhận trong `docs/deprecation-plan.md` để xóa ở Epic 20.2.

## Technical Decisions

- Sử dụng `src/scrapers/social/twitter/` cho kiến trúc hybrid mới; legacy nằm trong `src/scrapers/twitter/`.
- `TwitterClient` extends `AbstractApiClient` tại `src/scrapers/social/twitter/client.js`.
- `TwitterCrawler` extends `AbstractCrawler` tại `src/scrapers/social/twitter/crawler.js`.
- GraphQL query IDs tập trung trong `src/scrapers/twitter/http/endpoints.js` (hiện tại) và được import bởi cả client mới và cũ.
- `x-client-transaction-id` được ký qua `SignerWorkerPagePool` với timeout 3s; fallback về guest nếu ký thất bại.
- Facebook sử dụng DocID GraphQL và Browser-as-Signer bridge để lấy `lsd`, `fb_dtsg`, `jazoest`, `spin`.

## Cross-Story Dependencies

- Story 13.1 (Tiered Signer) là nền tảng cho 13.2.x và 13.3–13.10.
- Các story 13.2.x có thể chạy song song sau khi 13.1 ổn định.
- Story 13.2.12 (Integration) phụ thuộc vào 13.2.1–13.2.11.
- Story 13.10 (Facebook Integration) phụ thuộc vào 13.3–13.9.
- Epic 13 phụ thuộc Epic 10 (interfaces, Prisma, metadata schema) và Epic 11 (proxy, rate limiter, governor).
