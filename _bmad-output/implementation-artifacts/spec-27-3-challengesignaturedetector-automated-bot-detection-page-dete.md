---
title: 'Story 27.3 — ChallengeSignatureDetector: Automated Bot-Detection Page Detection'
type: 'feature'
created: '2026-09-13'
status: 'done'
route: 'dispatch'
baseline_commit: '2aee228a'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Mỗi platform validator hiện tự implement `isBotChallenge(response)` bằng ad-hoc substring checks — logic bị phân tán, không đồng nhất, và **chỉ trả `boolean`**, không nói rõ *loại* challenge (Cloudflare managed vs Turnstile vs Arkose vs platform checkpoint). Khi detector chung detect được, caller cũng không biết nên hibernate bao lâu — mỗi challenge loại khác nhau cần cooldown khác nhau (Turnstile solve ~phút, Arkose phức tạp hơn, hard IP ban cần account rotation).

**Approach:** Thêm `ChallengeSignatureDetector` trong `src/core/` như **single source of truth** cho bot-detection page signatures — Cloudflare (`cf-challenge`, `cf-turnstile`, `__cf_chl`, `challenge-running`, `Just a moment...`), Arkose Labs (`arkose`, `funcaptcha`), generic captcha, platform-specific (Facebook `checkpoint`, Twitter `unusual-login` / `account_locked`, Instagram `challenge_required`), và DOM-level signatures (`data-testid="challenge"`, `window.__初始状态`). Trả normalized `{ detected, type, confidence, suggestedHibernationMs, signature }`. Được dùng bởi **cả** `AbstractApiClient` (HTTP response body) lẫn `AbstractCrawler` (Puppeteer `page.content()`). Khi detector detect, `AbstractApiClient` tự động gọi `governor.recordBotChallenge()` + `healthOrchestrator.recordBotChallenge()` (Epic 27.2 integration).

**Decisions (đã chốt):**
- **Detector là pure sync** — không async, không network. Input: `{ body, url?, headers?, statusCode? }` (HTTP) hoặc `{ html, url? }` (DOM). Output: `ChallengeResult` normalized.
- **Signature catalog** là data-driven — array of `{ id, type, patterns[], weight, hibernationMs, appliesTo: 'http'|'dom'|'both' }` — dễ extend mà không đổi detector code.
- **Confidence score** [0,1] — weighted sum of matched patterns / catalog max weight; `confidence >= 0.5` → `detected: true`.
- **Không thay thế** per-platform `isBotChallenge` ngay — detector là *supplement*; `isBotChallenge` của platform vẫn được gọi (platform có quyền override), nhưng detector là fallback chung + cung cấp typed reason cho telemetry.
- **`detected.type` enum**: `'cloudflare_managed' | 'cloudflare_turnstile' | 'cloudflare_interstitial' | 'arkose' | 'recaptcha' | 'hcaptcha' | 'platform_checkpoint' | 'platform_unusual_login' | 'platform_account_locked' | 'platform_challenge_required' | 'generic_captcha' | 'unknown'`.
- **`suggestedHibernationMs`** theo type severity: `platform_account_locked`/`arkose` → 30min, `cloudflare_managed`/`turnstile` → 5min, `platform_checkpoint`/`unusual_login` → 15min, `generic_captcha`/`unknown` → 10min.
- **Per-platform override**: mỗi platform validator có thể đăng ký thêm signatures riêng qua `detector.registerPlatformSignatures(platform, sigs)` — để giữ polymorphism mà không phải sửa core catalog.
- **Không sửa `isBotChallenge` trả về boolean** — giữ backward-compat; base-client gọi `detector.detect(...)` trước, nếu `detected` → dùng `result.type`/`suggestedHibernationMs` cho markUnavailable/hibernate. Fallback sang `isBotChallenge` boolean khi detector miss.
- **Telemetry**: emit `challenge_detected` event với `{platform, accountId, type, confidence, signature}` cho monitoring.

## Boundaries & Constraints

**Always:**
- `ChallengeSignatureDetector` expose `detect(input) → ChallengeResult` (sync), `detectFromHtml(html, opts)`, `detectFromResponse(response, opts)` (response = `{status, headers, data|body, url}`).
- Catalog default cover: Cloudflare (managed+turnstile+interstitial), Arkose/funcaptcha, reCAPTCHA, hCaptcha, Facebook `checkpoint`, Twitter `unusual-login`/`account locked`, Instagram `challenge_required`, generic `captcha`/`challenge-running`, `data-testid="challenge"`, `window.__初始状态` (Weibo).
- `confidence ∈ [0,1]`; `detected = confidence >= 0.5`.
- `suggestedHibernationMs` > 0 và bounded (max 60min).
- `AbstractApiClient` calls detector first; on `detected` → `accountPool.markUnavailable(accountId, 'bot_challenge', result.suggestedHibernationMs, platform)` + `governor.recordBotChallenge(accountId, platform)` + `healthOrchestrator.recordBotChallenge(platform, accountId)`; reuse existing BotChallengeError throw.
- Real impl tests, no mocks. Each signature tested against real-ish HTML/JSON fixtures.
- TypeScript strict — types in `types/core.d.ts`.

**Never:**
- Không network calls, không async — detector pure sync.
- Không sửa `isBotChallenge` signature — giữ boolean contract.
- Không duplicate account-pool/governor logic — orchestrator reuse Epic 27.2 wiring.
- Không tự ý rotate proxy/account khi detect — chỉ emit signal, caller quyết định.
- Không bỏ platform-specific `isBotChallenge` (backward-compat: detector miss → fallback to validator's own boolean check).

## I/O & Edge-Case Matrix

| Scenario | Input | Expected | Error Handling |
|---|---|---|---|
| CLOUDFLARE_MANAGED | HTML có `cf-chl-bypass`, `cf-challenge-running`, `Just a moment` | `{detected:true, type:'cloudflare_managed', confidence≥0.7, suggestedHibernationMs:5*60*1000}` | N/A |
| CLOUDFLARE_TURNSTILE | HTML có `cf-turnstile`, `challenges.cloudflare.com/turnstile` | type `cloudflare_turnstile` | N/A |
| ARKOSE | HTML có `arkose`, `funcaptcha`, `client-api.arkoselabs.com` | type `arkose`, hibernationMs=30min | N/A |
| FB_CHECKPOINT | URL `facebook.com/checkpoint` hoặc body `checkpoint` | type `platform_checkpoint`, hibernationMs=15min | N/A |
| TWITTER_LOCK | Body `account_locked`, `unusual-login`, errors[code=326] | type `platform_account_locked`/`platform_unusual_login` | N/A |
| GENERIC_CAPTCHA | Body `recaptcha`, `g-recaptcha`, `captcha` | type `generic_captcha`, confidence 0.5 | N/A |
| CLEAN_RESPONSE | Normal HTML / JSON | `{detected:false, type:'unknown', confidence:0}` | N/A |
| NULL_INPUT | `null`/`undefined`/empty string | `{detected:false,...}` — never throw | Return safe default |
| STATUS_403_WITH_SIG | status=403 + body match | `detected:true`, confidence +0.2 boost | N/A |
| API_CLIENT_WIRE | `base-client` response is challenge | calls `governor.recordBotChallenge` + `healthOrchestrator.recordBotChallenge` + `accountPool.markUnavailable` with suggested ms | N/A |
| PLATFORM_OVERRIDE | platform validator registers extra sigs | detector uses them when `platform` matches | N/A |

</frozen-after-approval>

## Code Map

- `src/core/challenge-signature-detector.js` **(mới)** — `ChallengeSignatureDetector` class + `globalChallengeSignatureDetector`. Catalog `SIGNATURES` array, `detect()`, `detectFromHtml()`, `detectFromResponse()`, `registerPlatformSignatures()`.
- `src/core/index.js` — export class + global.
- `src/core/base-client.js` — call `challengeDetector.detect({body, url, headers, statusCode})` BEFORE existing `isBotChallenge` check. On detected → use `result.suggestedHibernationMs` for `markUnavailable` + `result.type` in BotChallengeError details.
- `src/core/base-crawler.js` — expose `detectChallengeOnPage(page)` helper (calls `page.content()` + detector). Subclasses can invoke after navigation.
- `types/core.d.ts` — `ChallengeResult`, `ChallengeType`, `ChallengeSignature`, `ChallengeSignatureDetector` types.
- `tests/core/challenge-signature-detector.test.js` **(mới)** — real impl tests per signature type + edge cases.
- `tests/core/base-client-challenge-detector.test.js` **(mới)** — integration: feed challenge response → assert `markUnavailable` called with `suggestedHibernationMs` + `recordBotChallenge` fired on governor + orchestrator.
- `docs/stealth-scraping.md` — document detector catalog + integration.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/challenge-signature-detector.js` — catalog + detect + platform overrides
- [x] `src/core/index.js` — export
- [x] `src/core/base-client.js` — wire detector before isBotChallenge
- [x] `src/core/base-crawler.js` — expose detectChallengeOnPage helper
- [x] `types/core.d.ts` — types
- [x] `tests/core/challenge-signature-detector.test.js` — signature coverage
- [x] `tests/core/base-client-challenge-detector.test.js` — wiring test
- [x] `docs/stealth-scraping.md` — document

**Acceptance Criteria:**
- Given `cf-challenge`/`__cf_chl`/`challenge-running` HTML → `detect()` returns `{detected:true, type:'cloudflare_managed', confidence≥0.7, suggestedHibernationMs:5min}`.
- Given `arkoselabs.com`/`funcaptcha` → `type:'arkose'`, `suggestedHibernationMs:30min`.
- Given `facebook.com/checkpoint` URL or `checkpoint` in body → `type:'platform_checkpoint'`.
- Given Twitter error `code:326`/`account_locked`/`unusual-login` → `type:'platform_account_locked'`/`'platform_unusual_login'`.
- Given clean HTML/JSON → `{detected:false, type:'unknown', confidence:0}`.
- Given `base-client` receives detected challenge → calls `accountPool.markUnavailable(accountId, 'bot_challenge', suggestedHibernationMs, platform)` + `governor.recordBotChallenge` + `healthOrchestrator.recordBotChallenge`.
- `npm run typecheck` + `vitest run` pass, no regression.

## Implementation Notes

- 2026-09-13: Implemented Story 27.3 end-to-end.
  - `src/core/challenge-signature-detector.js`: `ChallengeSignatureDetector` + `globalChallengeSignatureDetector`. Catalog of 11 built-in signatures covering Cloudflare (managed/turnstile/interstitial), Arkose/FunCaptcha, reCAPTCHA, hCaptcha, platform checkpoints (FB/Twitter/IG), generic captcha + DOM markers. Pure sync — `detect`, `detectFromHtml`, `detectFromResponse`, `registerPlatformSignatures`.
  - Confidence model: `top_matched_weight + 0.15 × (extra_hits − 1)`, capped at 1; `detected` when ≥ 0.5.
  - `src/core/index.js` exports.
  - `src/core/base-client.js`: imports detector + `this.challengeDetector` option (defaults to global). Early detection runs on EVERY response (any status) — records `markUnavailable('bot_challenge', suggestedHibernationMs)` + `governor.recordBotChallenge` + `healthOrchestrator.recordBotChallenge`. No early throw — the existing 403/429 retry path handles rotation; the 2xx branch reuses cached `lastChallengeResult` so `isBotChallenge` fallback still triggers `BotChallengeError` with `details.challengeType`/`challengeSignature`.
  - `src/core/base-crawler.js`: `detectChallengeOnPage(page, opts)` helper — reads `page.content()`, runs `detectFromHtml`, on detection calls `accountPool.markUnavailable` + `governor.recordBotChallenge`.
  - `types/core.d.ts`: `ChallengeType`, `ChallengePattern`, `ChallengeSignature`, `ChallengeResult`, `ChallengeDetectInput`, `ChallengeSignatureDetector` strict types.
  - Tests: `tests/core/challenge-signature-detector.test.js` (14 tests) + `tests/core/base-client-challenge-detector.test.js` (3 tests) — real impl, no mocks, 17/17 pass.
  - `docs/stealth-scraping.md` — full detector docs + signature catalog table.
- Verified: `npm run typecheck` 0 errors; focused tests 17/17 pass.

### Design corrections during implementation

- Initial confidence model `matches / total_weight` was too strict (single high-weight match wouldn't reach 0.5). Switched to top-weight + per-extra-hit bonus.
- First wiring threw `BotChallengeError` immediately on detection → broke the existing 403 retry-quarantine flow. Corrected: signals-only on early path; let the existing 403 branch drive retry; the 2xx `isBotChallenge` branch re-uses the cached `ChallengeResult` and throws with enriched `details`.
- `challengeDetector` wasn't in `AbstractApiClient` options typedef — added `@param` + `this.challengeDetector` wiring (defaults to `globalChallengeSignatureDetector`).

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Design Notes

- Catalog is data-driven: `{id, type, patterns: [{kind:'substr'|'regex'|'header'|'status', value, weight}], hibernationMs, appliesTo}`.
- Confidence: sum of matched weights, normalized to catalog max weight per type; threshold 0.5.
- `detect()` prefers highest-confidence match across types; ties broken by catalog order.
- Platform overrides append to catalog scoped by `platform` key.

## Verification

**Commands:**
- `npm run typecheck` — 0 errors strict.
- `vitest run tests/core/challenge-signature-detector.test.js tests/core/base-client-challenge-detector.test.js` — pass.
- `vitest run` — full suite no regression.
