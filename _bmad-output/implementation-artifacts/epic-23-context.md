# Epic 23 Context: Bluesky & Mastodon on AbstractCrawler

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Hoàn thiện hai platform scraper HTTP-only nhẹ (Bluesky qua AT Protocol, Mastodon qua REST API) trên kiến trúc `AbstractCrawler` + `AbstractApiClient` chung, để chúng sử dụng cùng pipeline proxy, governor, retry, và response validation như Twitter/Facebook, đồng thời cung cấp interface thống nhất cho CLI/MCP/AI agent.

## Stories

- Story 23.1: Bluesky AT Protocol Client
- Story 23.2: Bluesky Hybrid Crawler
- Story 23.3: Mastodon REST API Client
- Story 23.4: Mastodon Hybrid Crawler
- Story 23.5: Bluesky & Mastodon Response Validators
- Story 23.6: Bluesky & Mastodon Integration & Caller Migration

## Requirements & Constraints

- Cả hai platform đều HTTP-only, không cần Puppeteer, dùng public API với optional auth.
- Bluesky default service `https://public.api.bsky.app`; Mastodon default instance `https://mastodon.social` nhưng có thể override.
- Mọi request qua `AbstractApiClient` phải đi qua `governor.recordRequest()` và proxy rotation.
- Dữ liệu trả về chuẩn hóa theo `ProfileItem` / `PostItem` với ID namespaced: `bluesky:${uri|handle}` và `mastodon:${instance}:${id}`.
- Mọi crawler phải đăng ký `PlatformResponseValidator` để phân biệt valid payload, bot challenge, rate-limit, và auth failure.
- Legacy `src/scrapers/bluesky/index.js` và `src/scrapers/mastodon/index.js` phải được đánh dấu `@deprecated` và cập nhật `docs/deprecation-plan.md`.
- Error handling dùng error envelope chuẩn `{ code, type, message, retryAfter, suggestedAction, platform }`; `suggestedAction` là một trong các giá trị hợp lệ (`retry_after_delay`, `rotate_proxy`, `rotate_account`, `hibernate_account`, `relogin`, `wait`, `reduce_rate`, `contact_support`).

## Technical Decisions

- `BlueskyClient` và `MastodonClient` kế thừa `AbstractApiClient`; `sign()` có thể là no-op vì đây là public API.
- `BlueskyCrawler`/`MastodonCrawler` kế thừa `AbstractCrawler`, khai báo `ActionRegistry` với tên `action` dạng snake_case (`profile`, `followers`, `following`, `get_user_feed`, `search`, `hashtag`, `trending`, ...).
- Bluesky pagination dùng `cursor` trong query; Mastodon dùng `max_id` hoặc `Link` header.
- Response validators implement `AbstractPlatformResponseValidator` với `isValidPayload()`, `isBotChallenge()`, `isRateLimit()`, `isAuthExpired()`.
- Anti-bot rule: nếu action no-auth và validator báo rate-limit/challenge → throw `RateLimitError` và xoay proxy; nếu có auth thì hibernate account 15–30 phút và chuyển account.

## UX & Interaction Patterns

- Dashboard có tab `/platforms/bluesky` và `/platforms/mastodon` với optional auth collapsible.
- Scrape tab cards: Search posts, Profile feed, Followers, Following, Hashtag, Trending (Mastodon).
- User nhập handle/query/instance → dry-run preview → run scrape.

## Cross-Story Dependencies

- Story 23.5 phụ thuộc `AbstractPlatformResponseValidator` đã tồn tại trong `src/core/platform-validator.js`.
- Story 23.1–23.4 cần kiến trúc `AbstractCrawler`/`AbstractApiClient` và `ProxyIpPool`/`AccountPool` đã ổn định (Epic 10–11).
- Story 23.6 phụ thuộc hoàn thành 23.1–23.5 để migrate caller và cập nhật package exports.
