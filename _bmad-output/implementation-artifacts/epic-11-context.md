# Epic 11 Context: Resilient Network & Proxy Pool Management

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Cung cấp lớp mạng "bọc thép" cho XActions: một ProxyIpPool tập trung quản lý proxy tĩnh và dynamic residential tunnel với cách ly tự động (auto-quarantine) chống rò rỉ IP qua WebRTC/DNS, một AccountPool xoay tài khoản đa nền tảng, và một AdaptiveRateGovernor điều phối tốc độ cào theo năng lực hạ tầng thực tế (số proxy sống, velocity per account, Redis consumer lag). Mục tiêu triệt tiêu nguy cơ die tài khoản hàng loạt, không bao giờ fallback về direct connection, và đảm bảo truy vấn on-demand của consumer (Nowing/ChainLens) không bị bulk crawl starving tài nguyên.

## Stories

- Story 11.1: ProxyIpPool & AccountPool for Sticky/Round-Robin IP and Multi-Account Rotation
- Story 11.2: Static & Dynamic Residential Tunnel Proxy Providers
- Story 11.3: End-to-End Request Pipeline with 429/403 Auto-Quarantine, Exponential Backoff & Two-Mode IP Strategy
- Story 11.4: Adaptive Infrastructure-Aware Rate Limiter & Account Protection Governor (Surface & Backpressure)
- Story 11.5: End-to-End Request Pipeline (Two-Mode IP Strategy)
- Story 11.6: Rate-Limit & Bot-Challenge Defense (Quarantine, Retry, Hibernation)
- Story 11.7: Crawler-Governor Integration & Platform Response Validator Contract
- Story 11.8: SocksNode Dynamic Residential Proxy Provider
- Story 11.9: Proactive Proxy TTL Buffer & Auto-Refresh Interceptor

## Requirements & Constraints

- **FR-66 (Proxy Pool & Auto-Quarantine):** Quản lý tập trung Static & Dynamic Tunnel Proxy; tự động bật cờ chống rò rỉ WebRTC/DNS (`--force-webrtc-ip-handling-policy=disable_non_proxied_udp`, remote DNS resolution); kiểm tra buffer expiration 30s. Quarantine proxy lỗi 5 phút khi gặp 429/403, đổi IP và retry tối đa 3 lần với exponential backoff; Standby Backoff 30s khi 100% proxy bị chặn.
- **FR-66B (Adaptive Rate Limiter):** Điều phối tốc độ scrape theo giới hạn an toàn của nền tảng.
- **NFR-13 (Tự Phục Hồi & Chống Chặn):** Tự động phát hiện proxy chết/rate-limit, cách ly 5 phút, replay 3 lần với exponential backoff — hệ thống không được crash khi nền tảng kích hoạt bảo vệ diện rộng.
- **NFR-15:** Lớp `src/core/` hoàn toàn Zero-Dependency.
- **NFR-17 (Observability):** Expose governor status qua `GET /governor/status` và CLI `xactions status` (healthyProxyCount, healthyProxyRatio, currentReqPerSecond, redisConsumerLag, hibernatingAccounts, throttleLevel); alert khi stream backlog vượt ngưỡng.
- Provider URLs dạng `user:pass@host:port` phải parse đúng scheme/credentials và chuẩn hóa thành `NormalizedProxy`; tương thích `undici.ProxyAgent`, `socks-proxy-agent`, và `playwright.chromium.launch({ proxy })`.

## Technical Decisions

- **AD-3 (Centralized Proxy IP Pool, Anti-Leak & Auth-Mode Proxy Strategy):** Ba chế độ proxy quyết định theo `requiresAuth` hiệu dụng của action (`descriptor.requiresAuth ?? crawler.requiresAuth`): auth-required → sticky IP một account một proxy cả session; optional-auth → sticky khi có account; no-auth → xoay per-request/per-batch. Có Action-Level Auth Granularity với opt-in auth vẫn chịu governor gate, token affinity phân vùng theo auth mode, và invariant: tài khoản đã đăng nhập không bao giờ bị xoay IP per-request. SOCKS5 phải qua agent rõ ràng; không direct fallback.
- **AD-13 (Adaptive Infrastructure-Aware Rate Limiting & Account Protection Governor):** Throughput động `healthyProxyCount × baseReqPerSecondPerProxy × throttleFactor`; giảm 50% khi proxy sống dưới 50%; pause bulk khi dưới 10% (< 5 IPs) và ưu tiên on-demand. Mỗi account có token bucket theo `safeRequestsPerMinute`; hibernation 15–30 phút khi gặp Captcha/WAF; AccountPool tự xoay account. Backpressure khi Redis Stream lag > 10,000 messages.
- **AD-20 (Dual-Pool Resource Isolation & Multi-Consumer Quota):** Realtime Pool 30% proxy capacity cho MCP on-demand (timeout 5s), Bulk Pool 70% cho background crawl; quota per consumer (ChainLens 10 RPM, Nowing theo plan); consumer định danh qua header `X-Consumer-Id`.
- **AD-14 (Operational Status & Error Envelope):** Mọi lỗi MCP/HTTP/CLI dùng shape chuẩn `{ code, type, message, retryAfter, suggestedAction, accountId?, platform }` với type (`rate_limit`, `bot_challenge`, `proxy_exhausted`, `hibernation`, ...) và suggestedAction (`rotate_proxy`, `rotate_account`, `hibernate_account`, ...).
- **AD-7 (Dual-Channel Protocol for Nowing):** MCP HTTP/SSE daemon cho on-demand queries + Redis Stream bulk ingest thin event pointers; tốc độ bulk ingestion bị kiểm soát bởi governor (AD-13).

## Cross-Story Dependencies

- **Implementation order:** 11.1 → 11.2 → 11.4 → 11.7 → 11.5 → 11.6 → 11.3.
- **Story 11.1** là nền tảng: `ProxyIpPool` và `AccountPool` được mọi story khác dùng.
- **Story 11.3** đã hấp thụ Story 11.5 và 11.6 (cùng là phần pipeline `AbstractApiClient.request()` trong `src/core/base-client.js`); giữ riêng để theo dõi interceptor unit, có thể gộp vào 11.5/11.6 nếu cần.
- **Story 11.4** phần core governor đã implement sẵn; phần còn lại là surface (REST/CLI) và Redis lag backpressure wiring — cần `ProxyIpPool` (11.1) đo healthyProxyCount.
- **Story 11.7** cần governor (11.4) và `AbstractCrawler` (Epic 10.1); yêu cầu ít nhất Twitter và Facebook implement `PlatformResponseValidator` riêng.
- **Story 11.8** mở rộng `src/proxy/providers.js` (11.2) và phải tương thích cả sticky lẫn rotating của 11.1.
- **Story 11.9** xây trên `NormalizedProxy` (11.2), `ProxyIpPool` (11.1), và hook `getOrRefreshProxy()` vào `AbstractApiClient` (11.3).
- **Cross-epic:** Epics 13–18 (crawlers) phụ thuộc 11.1–11.4 và 11.3/11.7 (proxy/retry/governor/validator); Epic 19 (admin dashboard) phụ thuộc 11.4 cho governor/proxy/hibernation metrics.
