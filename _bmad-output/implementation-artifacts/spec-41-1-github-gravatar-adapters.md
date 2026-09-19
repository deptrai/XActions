---
title: 'Story 41.1 — GitHub + Gravatar OSINT adapters'
type: 'feature'
created: '2026-09-19'
baseline_revision: '9bc770444fd466d92a807868fa86a6b2b912946a'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** `x_social_find_profiles` (Epic 36) thiếu 2 nguồn identity mở giàu metadata nhất — GitHub và Gravatar — dù chúng là public API zero-auth, không tốn proxy. Kết quả fan-out hiện chỉ quét social/marketplace, bỏ sót developer & identity registries.

**Approach:** Thêm 2 adapter Tier-0 (direct HTTP fetch, không browser/proxy): GitHub (`api.github.com/users/{username}`, queryType `username`) và Gravatar (`api.gravatar.com/v3/profiles/{sha256(email)}`, queryType `email`). Mỗi adapter gồm descriptor + client (extends `AbstractApiClient`) + crawler (extends `AbstractCrawler`), đăng ký vào `DESCRIPTORS` + `PROFILE_ACTION_MAP` + `PLATFORM_TIMEOUTS_MS`. Rate limit GitHub qua `DistributedTokenBucket` (60 req/h unauthenticated, 5000 req/h khi có `GITHUB_TOKEN`).

## Boundaries & Constraints

**Always:**
- Follow existing descriptor contract: `aliases[]`, `mapAction`, `mapArgs`, `createClient`, `createCrawler` (pattern từ `masothue`/`reddit`).
- Crawler extends `AbstractCrawler`, client extends `AbstractApiClient`, register actions via `registerAction` (snake_case).
- GitHub rate limit enforced via `globalDistributedTokenBucket.consume()` — capacity 60 (unauth) hoặc 5000 (có `GITHUB_TOKEN`), refillRate tương ứng per-hour; throw `RateLimitError` (XACT_4291) khi `allowed:false` với `retryAfterMs` từ bucket.
- Gravatar: SHA-256 hex của email (lowercase, trimmed) trong path; dùng `node:crypto` `createHash`.
- Cả 2 platform: `requiresAuth = false`, `requiresProxy = false` (direct fetch, Tier-0, timeout ~4-5s).
- `normalizeToProfileItems` phải map được response GitHub/Gravatar thành `ProfileItem` (username/name/avatar/profileUrl/bio/followers).
- ESM, `// by nichxbt` credit, emoji error prefixes, real implementations only (no mocks).
- Đăng ký cả 2 vào `PROFILE_ACTION_MAP`: `github: { username: 'profile' }`, `gravatar: { email: 'profile' }`.

**Never:**
- Không port code Python từ Mr.Holmes; không dorking, breach-check, BFS profiler, Maigret-scan (ngoài scope Epic 41).
- Không persist PII vào Prisma (Option D — in-memory per-request only).
- Không dùng Puppeteer/browser cho 2 adapter này.
- Không thay đổi output contract `profiles[]` (entity resolution `identityClusters[]` là Story 41.2, KHÔNG làm ở đây).
- Không mock network calls trong integration test.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| GitHub happy path | queryType=username, query="nichxbt" | ProfileItem platform=github, username, name, avatar, profileUrl=github.com/..., bio, followers | none |
| GitHub 404 user | username không tồn tại | platformStatus status=error, category SCRAPE_ERROR | normalize empty / error envelope |
| GitHub rate limit | bucket exhausted (60/h) | RateLimitError XACT_4291, retryAfterMs>0, category RATE_LIMITED | classifyPlatformError → RATE_LIMITED |
| GitHub token | GITHUB_TOKEN env set | capacity 5000, header Authorization | none |
| Gravatar happy path | queryType=email, query="a@b.c" | fetch sha256(email) path, ProfileItem platform=gravatar, avatar + linked accounts | none |
| Gravatar 404 | email không có profile | empty profiles[] / graceful | not fatal |
| Auto-detect | query="a@b.c" | detectQueryType → email → chỉ gravatar (và email-platforms khác) chạy | — |
| Timeout | platform hangs | withTimeout → OSINT_TIMEOUT, circuit++ | classify → PLATFORM_TIMEOUT |

</intent-contract>

## Code Map

- `src/mcp/osint-find-profiles.js` — `PROFILE_ACTION_MAP` (thêm `github`, `gravatar`), `PLATFORM_TIMEOUTS_MS` (thêm Tier-0 entries ~4-5s), `buildScrapeArgs` (email path đã có `args.email`; username path đã có `args.username`), `detectQueryType` (email/username đã detect sẵn).
- `src/scrapers/index.js` — import 2 descriptor mới + thêm vào `DESCRIPTORS` registration array (sau `ipLegalDescriptor`).
- `src/scrapers/procurement/masothue/descriptor.js` — reference descriptor contract (aliases/mapAction/mapArgs/createClient/createCrawler).
- `src/scrapers/social/reddit/crawler.js` — reference `AbstractCrawler` + `registerAction` (HTTP-only, requiresAuth=false).
- `src/scrapers/procurement/masothue/client.js` — reference `AbstractApiClient` subclass (`request()` override, getDefaultHeaders, requiresProxy flag).
- `src/core/distributed-token-bucket.js` — `globalDistributedTokenBucket.consume(key, tokens, {capacity, refillRate, ttlSeconds})` → `{allowed, remaining, retryAfterMs}`.
- `src/core/error-envelope.js` — `RateLimitError` (XACT_4291), `PlatformError`, `ErrorTypes`, `SuggestedActions`.
- `src/core/base-client.js` — `AbstractApiClient.request(method, url, options)` → `{body, statusCode, headers}`; transport `undici`/`got`.
- `src/core/base-crawler.js` — `AbstractCrawler.registerAction({action, handler, ...})`, `start({action, args, session})`.
- `tests/mcp/osint-find-profiles.test.js` — existing test pattern (real descriptor injection into DESCRIPTORS, no mocks).
- NEW `src/scrapers/identity/github/` — client.js, crawler.js, descriptor.js, index.js.
- NEW `src/scrapers/identity/gravatar/` — client.js, crawler.js, descriptor.js, index.js.

## Tasks & Acceptance

**Execution:**
- `src/scrapers/identity/github/client.js` — `GitHubClient extends AbstractApiClient`: baseUrl `https://api.github.com`, requiresAuth=false, requiresProxy=false; method `getUser(username)` → GET `/users/{username}`; inject `Authorization: Bearer $GITHUB_TOKEN` khi env set; rate-limit gate via `globalDistributedTokenBucket.consume('osint:github', 1, {capacity, refillRate})` trước request, throw RateLimitError khi `!allowed`.
- `src/scrapers/identity/github/crawler.js` — `GitHubCrawler extends AbstractCrawler`: name/platform `github`, requiresAuth=false; `registerAction` `profile` → `client.getUser(args.username)`, normalize → ProfileItem-shape object.
- `src/scrapers/identity/github/descriptor.js` — aliases `['github','gh']`; actionMap `{profile:'profile'}`; mapArgs pass `username`; createClient→GitHubClient, createCrawler→GitHubCrawler.
- `src/scrapers/identity/github/index.js` — re-export client/crawler/descriptor + createGitHubCrawler factory.
- `src/scrapers/identity/gravatar/client.js` — `GravatarClient extends AbstractApiClient`: baseUrl `https://api.gravatar.com`, requiresAuth=false, requiresProxy=false; `getProfileByEmail(email)` → sha256hex(lowercase(trim(email))) → GET `/v3/profiles/{hash}`.
- `src/scrapers/identity/gravatar/crawler.js` — `GravatarCrawler extends AbstractCrawler`: name/platform `gravatar`; `registerAction` `profile` → `client.getProfileByEmail(args.email)`, normalize.
- `src/scrapers/identity/gravatar/descriptor.js` — aliases `['gravatar']`; actionMap `{profile:'profile'}`; mapArgs pass `email`; factories.
- `src/scrapers/identity/gravatar/index.js` — re-exports + factory.
- `src/scrapers/index.js` — import + register 2 descriptors vào DESCRIPTORS array.
- `src/mcp/osint-find-profiles.js` — add `github: { username: 'profile' }` và `gravatar: { email: 'profile' }` vào `PROFILE_ACTION_MAP`; add `github: 4000`, `gravatar: 4000` vào `PLATFORM_TIMEOUTS_MS` (Tier-0); ensure `buildScrapeArgs` email branch sets `args.email` (đã có).
- `tests/mcp/osint-github-gravatar.test.js` — unit tests: descriptor registration, mapArgs, sha256 email hashing, GitHub rate-limit gate behavior (real DistributedTokenBucket memory fallback), normalizeToProfileItems on real GitHub/Gravatar response shapes. <1.5s, no mocks (inject real descriptor / use memory bucket).

**Acceptance Criteria:**
- Given query `nichxbt` queryType username, when `x_social_find_profiles` runs, then `platformStatus` includes `github` with status ok và `profiles[]` chứa ProfileItem platform=github.
- Given query `someone@example.com` queryType email, when tool runs, then `gravatar` platform được dispatch với sha256(email) path và không gọi GitHub.
- Given GitHub bucket exhausted, when dispatch, then github platformStatus status=error với error.category=RATE_LIMITED và retryAfterMs>0.
- Given `GITHUB_TOKEN` set, when GitHub client builds request, then Authorization header present và bucket capacity=5000.
- Given auto query `@user` (username shape), when detect, then queryType=username → github chạy, gravatar skip (no username lookup).

## Spec Change Log

## Review Triage Log

### 2026-09-19 — Review pass (self-review, no subagents per user directive)
- verdicts: 6 findings — high 0, medium 0, low 3, false 2, maybe-false 1
- findings:
  - `[low]` `[reject]` `createGitHubCrawler`/`createGravatarCrawler` ép `instanceof` — duck-typed client bị wrap thành real client; nhưng `scrape()` đi qua `descriptor.createCrawler` (truyền `deps.client` trực tiếp, không qua factory), và test dùng `new Crawler` trực tiếp — không ai gặp defect này trong flow chính.
  - `[false]` `[reject]` `#toProfile` GitHub `username: u.login` undefined khi response thiếu login — `getUser` return null trên 404/non-2xx trước, `#toProfile` chỉ nhận valid user object → unreachable.
  - `[low]` `[reject]` `status===404` check sau try/catch là dead code — `request()` throw PlatformError trước khi return; giữ làm defensive guard, harmless.
  - `[false]` `[reject]` `#gateRateLimit` consume token ngay cả khi platform timeout — by design, rate-limit gate phải chạy trước mọi request bất kể deadline; không phải defect.
  - `[low]` `[reject]` Gravatar `optionalArgs:['query']` nhưng `getProfile` đọc cả `args.query` — cosmetic descriptor metadata, không ảnh hưởng dispatch.
  - `[maybe-false]` `[defer]` `details: resp?.data` trong nhánh 429/403 sau catch — resp undefined khi request throw nên branch này chỉ chạy khi request return non-2xx (hiếm vì handleError throw); nếu xảy ra thì chỉ mất details, không sai kết quả.

## Auto Run Result

**Summary:** Implemented Story 41.1 — added two zero-auth, Tier-0 direct-fetch OSINT identity adapters (GitHub `username`, Gravatar `email`) to the `x_social_find_profiles` fan-out matrix, with GitHub rate-limiting enforced via `DistributedTokenBucket` (60/h unauth, 5000/h with `GITHUB_TOKEN`).

**Files changed:**
- `src/scrapers/identity/github/{client,crawler,descriptor,index}.js` — GitHub REST adapter (`api.github.com/users/{u}`), rate-gated, login→username normalization.
- `src/scrapers/identity/gravatar/{client,crawler,descriptor,index}.js` — Gravatar v3 adapter (`api.gravatar.com/v3/profiles/{sha256(email)}`), verifiedAccounts surfacing.
- `src/scrapers/index.js` — registered `github`/`gh`/`gravatar` aliases into `DESCRIPTORS`.
- `src/mcp/osint-find-profiles.js` — added `github:{username:profile}` + `gravatar:{email:profile}` to `PROFILE_ACTION_MAP`; `github:4000`/`gravatar:4000` to `PLATFORM_TIMEOUTS_MS`.
- `tests/mcp/osint-github-gravatar.test.js` — 18 tests covering registration, hashing, rate-limit gate, normalization, 404 handling, routing.

**Review findings:** 0 patched, 1 deferred (dead `details` branch — cosmetic), 5 rejected (4 low cosmetic/unreachable, 2 false). No high/medium findings.

**Verification:**
- `vitest run tests/mcp/osint-github-gravatar.test.js` → 18/18 pass.
- `vitest run tests/mcp/osint-find-profiles.test.js` → 30/30 pass (no regression).
- Node smoke: `DESCRIPTORS.github|gh|gravatar` registered; `mapAction`/`mapArgs` pipeline resolves `username`/`email` correctly.

**Residual risks:** GitHub/Gravatar adapters not yet exercised against live APIs (unit tests use injected transport + captured response shapes); `identityClusters[]` (Story 41.2) still pending.

## Design Notes

Rate-limit gate: `capacity=60`, `refillRate=60/3600` (~0.0167 tok/s) cho unauth; `capacity=5000`, `refillRate=5000/3600` khi `GITHUB_TOKEN`. Bucket key `osint:github` (platform-wide, không per-account vì zero-auth). `consume` trước mỗi request; `!allowed` → `RateLimitError` với `retryAfterMs` từ response.

Gravatar v3 profile response có `display_name`, `avatar_url`, `profile_url`, `accounts[]` — normalizeToProfileItems map qua `name`/`avatar`/`profileUrl`; `accounts[]` nhét vào `metadata.raw` (sanitizeRaw đã handle). GitHub `/users/{u}` trả `login,name,avatar_url,html_url,bio,followers,company,location,public_repos` — toItem đọc `login`→username? Cần map `login`→username, `html_url`→profileUrl, `avatar_url`→avatar, `followers`→followersCount trong normalizer của crawler (vì toItem chỉ nhận `username`/`profileUrl`/`avatar`/`followers`/`followersCount`).

## Verification

**Commands:**
- `npx vitest run tests/mcp/osint-github-gravatar.test.js` — expected: all pass <1.5s
- `npx vitest run tests/mcp/osint-find-profiles.test.js` — expected: existing tests still pass (no regression)
- `node -e "import('./src/scrapers/index.js').then(m=>console.log(Object.keys(m.DESCRIPTORS).filter(k=>/github|gravatar/.test(k))))"` — expected: github + gravatar registered
