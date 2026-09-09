# Epic 35 Context: Reddit, Medium & Instagram Scraper Expansion

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Mở rộng XActions scraping engine để hỗ trợ ba nguồn dữ liệu mới: **Reddit** (community discussion), **Medium** (long-form content), và **Instagram** (visual social + influencer). Mục tiêu là cung cấp `PostItem`/`ProfileItem`/`CommentItem` chuẩn hóa cho Nowing AI Lead Hub thông qua kiến trúc `AbstractCrawler`/`AbstractApiClient` hiện có, với mỗi nền tảng chọn adapter phù hợp (HTTP, RSS, Puppeteer, hoặc hybrid).

## Stories

- Story 35.1: Reddit Scraper (Client + Crawler + Validator + Tests)
- Story 35.2: Medium Scraper (Client + Crawler + Validator + Tests)
- Story 35.3: Instagram Scraper (Client + Crawler + Session/Proxy + Tests)
- Story 35.4: Unified ProxyProvider Injection + SocialAccount Schema + Docs & Selector Registry

## Requirements & Constraints

- Mỗi platform triển khai theo pattern `client.js`, `crawler.js`, `normalizer.js`, `validator.js`, `index.js` trong `src/scrapers/social/<platform>/`.
- Output normalized phải là `PostItem[]`, `ProfileItem[]`, `CommentItem[]`, hoặc `CommunityItem[]`.
- Tất cả `Client` mới extends `AbstractApiClient`/`AbstractCrawler` và chấp nhận `ProxyProvider`/`proxy` option.
- Reddit: HTTP-first, RSS fallback khi `.json` 403, Puppeteer stealth bridge tùy chọn cho full data (comments, user, search).
- Medium: RSS-first, HTML/Puppeteer fallback nếu RSS thay đổi hoặc `medium.com/@x` trả 403.
- Instagram: hybrid — `instagrapi` Python bridge hoặc Puppeteer public scraping; yêu cầu proxy, session persistence, device emulation.
- Proxy mặc định `country-us` hoặc residential cho US platforms; `country-vn` chỉ dùng cho VN platforms.
- Rate limit xử lý tại `Client`; delay 1–3s giữa các request trừ khi rate limit headers cho phép nhanh hơn.
- `SocialAccount`/`SocialAccountHealth` là canonical storage cho session/cookie/proxy với AES-256-GCM encryption.
- `vitest` tests pass cho tất cả module mới.

## Technical Decisions

- **AD-35**: Reddit HTTP-first + RSS fallback + Puppeteer stealth bridge; Medium RSS-first + HTML/Puppeteer fallback.
- **AD-36**: Instagram hybrid (`instagrapi` bridge hoặc Puppeteer).
- **AD-37**: Tất cả platform mới inject `ProxyProvider` từ `src/proxy/`.
- **AD-38**: Proxy `country-us` hoặc residential cho Reddit/Medium/Instagram.
- **AD-39**: `SocialAccount` thay thế `FacebookAccount` cho platform mới.
- **IN-7**: Mọi client mới hỗ trợ `transport` option (`'http' | 'puppeteer' | 'rss'`).

## Cross-Story Dependencies

- 35.1, 35.2, 35.3 cùng phụ thuộc `src/core/base-client.js`, `base-crawler.js`, `platform-validator.js`, `types.js`, `error-envelope.js`.
- 35.4 cung cấp `ProxyProvider` injection và `SocialAccount` schema, nên các story 35.1–35.3 tạm fallback `PROXY_URL` env và chưa bắt buộc `SocialAccount`.
