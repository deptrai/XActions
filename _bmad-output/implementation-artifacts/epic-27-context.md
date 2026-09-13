# Epic 27 Context: Anti-Detection & Session Resilience

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 27 là epic *infrastructure hardening* đặt trên các layer hiện có (`AdaptiveRateGovernor`, `AccountPool`, `ProxyIpPool`, `StealthBrowser`). Mục tiêu: biến anti-detection và session resilience từ reactive sang proactive, liên tục, và tự phục hồi — XActions không bị phát hiện qua TLS/JA4, timezone/locale lệch, hay proxy-UA mismatch; account hỏng được rút khỏi rotation trước khi nhiễm dữ liệu; challenge page được nhận diện đúng thay vì misclassify thành empty data.

## Stories

- Story 27.1: FingerprintManager — TLS/JA4 Spoofing & Geo-Consistent Profiles
- Story 27.2: SessionHealthOrchestrator — Continuous Health Score & Circuit Breaker
- Story 27.3: ChallengeSignatureDetector — Automated Bot-Detection Page Detection

## Requirements & Constraints

- **Fingerprint completeness:** pool fingerprint phải gồm UA, viewport, timezone, locale, colorDepth, platform, WebGL vendor/renderer, fonts, `navigator.hardwareConcurrency`, `navigator.deviceMemory`.
- **Geo-consistency:** derive region từ proxy IP → chọn timezone/locale khớp region đó; `launchStealthBrowser()` consume `FingerprintManager.getForAccount(accountId)` để fingerprint + proxy + timezone nhất quán per account.
- **TLS/JA4 spoofing:** optional nhưng handshake outbound phải khớp OS/Browser đã chọn (system proxy, custom `tls` agent, hoặc external tool). `got-scraping` đã là dep và có impersonate/TLS.
- **Persistence:** fingerprint persist per account — tránh rotation nhanh gây re-auth.
- **Session health (27.2):** score `[0,100]` từ errors/rate-limit/challenge/latency/payload-completeness/proxy-health; `<30` mở circuit breaker → `sick`; half-open sau cooldown gửi recovery probe (read-only); `governor.getStatus()` expose `healthScores` + `circuitBreakerStates`; `dashboard/admin.html` có cột health + wake/probe.
- **Challenge detection (27.3):** detector dùng chung bởi `AbstractApiClient` (HTTP body) và `AbstractCrawler` (page content); match `cf-challenge`, `cf-turnstile`, `__cf_chl`, `arkose`, `captcha`, `challenge-running`, `data-testid="challenge"`, `window.__初始状态`, FB `checkpoint`, Twitter `unusual-login`; trả `{detected,type,confidence,suggestedHibernationMs}`; auto `governor.recordBotChallenge()`.

## Technical Decisions

- **Existing surfaces (không duplicate — DoD):** `AntiDetection.generateFingerprint()` (`src/agents/antiDetection.js`) chỉ trả 5 field (viewport/userAgent/timezone/locale/colorDepth) — thiếu platform/WebGL/fonts/hardwareConcurrency/deviceMemory. `launchStealthBrowser()`/`createStealthPage()` (`src/scraping/stealthBrowser.js`) randomize ad-hoc và hardcode `platform`/`--lang`/WebGL — phải refactor consume FingerprintManager. `ProxyIpPool` có sticky binding + providers hỗ trợ `country`/`region`/`residential`. `SessionManager` chỉ in-memory (không persist).
- **Persistence pattern:** Prisma có `SocialAccount`, `SocialAccountHealth`, `ScraperHealthScore`, `FacebookAccountHealth` — fingerprint per-account nên reuse/extend `SocialAccount` metadata hoặc 1 model mới, không phát minh store riêng.
- **TLS spoofing:** `got-scraping` + `undici` đã trong package.json; integration optional — interface pluggable (system proxy / custom tls agent / external).
- **Circuit breaker reuse:** `AdaptiveRateGovernor.hibernateAccount()` + `AccountPool.markUnavailable()` đã tồn tại — SessionHealthOrchestrator orchestrate chứ không re-implement.
- **Geo region:** proxy record đã mang `country`/`region` (providers.js) — FingerprintManager map region→timezone/locale, không cần geo-IP service riêng.

## Cross-Story Dependencies

- **Điều kiện kích hoạt Epic 27–32:** Epic 20/24/25/26 (cleanup, dispatcher, decommission) phải stable trên single `AbstractCrawler`/`AbstractApiClient` contract; architecture review xác nhận các manager mới fit `src/core/` + `src/scrapers/social/` mà không cần core rewrite. (Epic 26 done, Epic 20/24 vẫn backlog — rủi ro ghi trong spec.)
- **27.1 độc lập** với 27.2/27.3 nhưng là nền: fingerprint/geo phải xong trước khi health scoring và challenge detection đáng tin cậy.
- **27.2** phụ thuộc `governor.recordBotChallenge()` từ **27.3** detector để có tín hiệu challenge chính xác.
- **DoD chung:** tests trong `tests/core|scrapers|admin/`; `npm run typecheck` + `vitest run` pass; cập nhật `docs/` (architecture.md, stealth-scraping.md, streaming.md, api-reference.md); UI mới reflect trong `dashboard/admin.html`.
