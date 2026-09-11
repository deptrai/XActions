---
epic: 35
story: 35.3
status: done
created: '2026-09-09'
updated: '2026-09-11'
baseline_commit: 28d4f6f02d9bfebeec2c0156f0d6ff8e27057cec
---

# Story 35.3: Instagram Scraper (Client + Crawler + Session/Proxy + Tests)

## Epic
Epic 35: Reddit, Medium & Instagram Scraper Expansion

## Goal
Deliver an Instagram scraper that can collect public profile and media data via Puppeteer or a private API bridge, with mandatory proxy and session management.

## FRs Covered
- FR-100 (Instagram Hybrid Scraper)

## NFRs Covered
- NFR-1 (1–3s delays between actions)
- NFR-2 (rate limit handling)
- NFR-3 (proxy rotation and session persistence)
- NFR-4 (real implementations only in tests)

## Story

As an XActions user,
I want to scrape Instagram profiles, media, and hashtags,
So that I can analyze visual social content and influencer data.

## Acceptance Criteria

### AC-1: InstagramClient Puppeteer path
**Given** a valid `sessionid` cookie or `username`/`password`  
**When** `InstagramClient` is constructed with `{ transport: 'puppeteer' }`  
**Then** it launches a browser context with `ProxyProvider`  
**And** navigates to `https://www.instagram.com/username/`  
**And** extracts profile and media data from HTML/GraphQL

### AC-2: InstagramClient private API bridge path
**Given** `instagrapi` Python bridge is configured (optional)  
**When** `InstagramClient` is constructed with `{ transport: 'instagrapi' }`  
**Then** it spawns a Python subprocess or calls an internal service  
**And** returns `PostItem[]` via bridge serialization (JSON over stdio or HTTP)

### AC-3: InstagramClient session persistence
**Given** a successful login  
**When** `client.saveSession(path)` is called  
**Then** session cookies/settings are persisted to encrypted storage  
**And** `client.loadSession(path)` restores session without re-login

### AC-4: InstagramClient proxy injection
**Given** a `ProxyProvider` in options  
**When** the client makes a request  
**Then** it uses a stable proxy for the account  
**And** it does not rotate proxy mid-session unless quarantined

### AC-5: InstagramClient fetches user profile
**Given** `InstagramClient` is logged in  
**When** `crawl({ action: 'user', args: { username: 'natgeo', limit: 25 } })` is called  
**Then** it returns `{ profile: ProfileItem, posts: PostItem[] }`  
**And** `ProfileItem` contains `id`, `username`, `fullName`, `bio`, `followerCount`, `followingCount`

### AC-6: InstagramClient fetches hashtag
**Given** `InstagramClient` is logged in  
**When** `crawl({ action: 'hashtag', args: { tag: 'travel', limit: 25 } })` is called  
**Then** it returns `PostItem[]`  
**And** each post has `media[]` with image/video URLs

### AC-7: InstagramClient normalizes media
**Given** a raw Instagram media object  
**When** `normalizeInstagramMedia(media)` is called  
**Then** it returns `PostItem` with `id`, `platform: 'instagram'`, `author`, `caption`, `takenAt`, `likeCount`, `commentCount`, `media[]`

### AC-8: Instagram validation
**Given** a raw Instagram media/user/comment object  
**When** `InstagramValidator.validatePost(raw)` is called  
**Then** it throws `ValidationError` if `pk`, `code`, `taken_at`, or `caption` is missing  
**And** it returns `true` for valid objects

### AC-9: Challenge and rate-limit handling
**Given** Instagram returns a challenge, 429, or suspicious login email  
**When** the client detects the response  
**Then** it pauses and logs an alert  
**And** it does not retry automatically more than 3 times

### AC-10: Tests
**Given** no mocks or stubs  
**When** `vitest run tests/scrapers/instagram` is executed  
**Then** all client, crawler, normalizer, and validator tests pass  
**And** tests use a real test account with stable proxy or a public profile

## Files to Create/Modify
- `src/scrapers/social/instagram/client.js`
- `src/scrapers/social/instagram/crawler.js`
- `src/scrapers/social/instagram/normalizer.js`
- `src/scrapers/social/instagram/validator.js`
- `src/scrapers/social/instagram/index.js`
- `src/scrapers/social/instagram/bridge.py` (optional, for instagrapi bridge)
- `tests/scrapers/instagram/client.test.js`
- `tests/scrapers/instagram/crawler.test.js`
- `tests/scrapers/instagram/normalizer.test.js`
- `tests/scrapers/instagram/validator.test.js`
- `src/scrapers/social/index.js` (add export)

## Out of Scope
- Instagram posting, DM, or interaction actions
- Private accounts (unless authenticated session has access)
- Instagram Graph API official (limited scope)

## Open Questions
- OQ-1 (RESOLVED): Primary transport is `puppeteer` (public web scraping). `instagrapi` Python bridge is optional advanced path — implement only if private API features are required later.
- OQ-2 (RESOLVED): `SocialAccount` table **already exists** in `prisma/schema.prisma` (model `SocialAccount` + `SocialAccountHealth`). `platform` is a free-form `String` (`'reddit' | 'medium' | 'instagram' | ...`), **not a Prisma enum** — writing `platform:'instagram'` needs **no migration**. What is missing is only the *write path*: no route/service yet persists a session into `SocialAccount`, so this story must add it (mirror `facebookAccounts.js` encrypt → `encryptedCookie`/`encryptedProxy`). `SessionManager` is in-memory only — persistence to `SocialAccount` is the new work.
- OQ-3 (RESOLVED): Default proxy for Instagram is `country-us` residential via `ProxyProvider`; `country-vn` is only for Vietnam platforms. Proxy fallback to `PROXY_URL` env if no provider injected.

---

## Dev Notes

> Comprehensive implementation context. Read fully before coding. Mirrors the proven Reddit (35.1) and Medium (35.2) patterns.

### Approach & Transport

Instagram has **no public RSS** and aggressively blocks datacenter IPs. Primary transport is **`puppeteer`** (stealth browser, public web scraping of `/username/`, `/explore/tags/<tag>/`, `/p/<shortcode>/`). An optional **`instagrapi`** Python bridge (`transport: 'instagrapi'`) is an advanced path for private-API features — implement the subprocess/stdio-JSON bridge interface but it is acceptable to ship it behind a capability check (throws `PlatformError` `NOT_IMPLEMENTED` when the bridge binary is absent) rather than a full Python dependency.

**Transport values:** `'puppeteer' | 'instagrapi' | 'http'`. Default `'puppeteer'`. `http` is a thin direct-fetch path for public GraphQL `?__a=1&__d=dis` profile/doc endpoints — best-effort only, frequently 401/429 without a logged-in session.

### InstagramClient — `src/scrapers/social/instagram/client.js`

Extends `AbstractApiClient`:
- `name='instagram'`, `platform='instagram'`, `requiresAuth=true` (login/session required for most data), `requiresProxy=true`, `requiresResidential=true`, `category='social'`.
- `baseUrl='https://www.instagram.com'`, `graphQlBase='https://www.instagram.com/graphql/query'` or `https://i.instagram.com/api/v1` for the private bridge.
- `transport` normalized case-insensitive from `options.transport || process.env.INSTAGRAM_TRANSPORT || 'puppeteer'`.
- `delayMin=2000`, `delayMax=5000` (Instagram is the most aggressive — wider than Medium's 1–3s); `0` in tests.
- `#lastRequestAt` private field; same gaussian-throttle pattern as MediumClient (`gaussianDelay(this.delayMin, this.delayMax)` when `delayMax>0` and delta `< delayMin`).
- **Session management** (AC-3): `saveSession(accountId)` persists the session cookie jar + device fingerprint into `SessionManager` (`globalSessionManager.set(accountId, session)`) AND, when a `store`/`SocialAccount` writer is injected, into `SocialAccount.encryptedCookie`/`encryptedProxy` (AES-256-GCM, mirror `platform.js` encrypt pattern). `loadSession(accountId)` restores from `SessionManager` first, then `SocialAccount` — no re-login on hit. Accept `{ sessionid, ds_user_id, csrftoken }` cookie auth OR `{ username, password }` credential login.
- **Proxy injection** (AC-4): `resolveProxy(accountId, requiresResidential=true, requiresAuth=true, options)` → merge `{ country:'us', isp:'residential', sessionId: accountId }` (sticky session so the same account keeps one IP); do NOT rotate mid-session unless `ProxyDeadError`/quarantine. Fallback `process.env.PROXY_URL` when no provider injected.
- Methods: `login(credentials)`, `getUserProfile(username, options)`, `getUserMedia(username, options)`, `getHashtagFeed(tag, options)`, `getPost(shortcodeOrUrl, options)`, `getComments(shortcode, options)`, `close()` (closes browser bridge).
- Puppeteer path uses `src/scrapers/adapters/puppeteer.js` `PuppeteerAdapter` (stealth). Parse `window._sharedData` / `__additionalDataLoaded` / `graphql` JSON embedded in the HTML, not fragile DOM selectors where avoidable.

### InstagramCrawler — `src/scrapers/social/instagram/crawler.js`

Extends `AbstractCrawler`: `name='instagram'`, `platform='instagram'`, `requiresAuth=true`, `category='social'`. Register `ActionDescriptor`s:
- `user` — aliases `author`, `profile` — requiredArgs `['username']`, optionalArgs `['limit','cursor','transport']` → `{ profile: ProfileItem, posts: PostItem[], pageInfo }`.
- `hashtag` — aliases `tag`, `topic` — requiredArgs `['tag']` → `{ posts: PostItem[], pageInfo }`.
- `post` — aliases `post_detail`, `media` — requiredArgs `['shortcode']` (or `url`) → `{ post: PostItem }`.
- `comments` — requiredArgs `['shortcode']` → `{ comments: CommentItem[], pageInfo }`.
- `checkpointResolver` for `user`/`hashtag` — `cursorField:'cursor'`, `fallbackCursorFields:['max_id','end_cursor']`; `targetType`/`targetKey`: `user→('user',username.toLowerCase())`, `hashtag→('tag',tag.toLowerCase().replace(/^#/,''))`.
- `#emitCheckpointAndStream` → `stream:social:raw_posts` (mirror Medium/Reddit).
- `cleanup()` → `client.close()`.

### Normalizer — `src/scrapers/social/instagram/normalizer.js`

Plain exported functions (mirror `medium/normalizer.js`) — **there is no `base-normalizer.js`**; do not look for a base class. IDs use `generatePostId` from `src/core/types.js` + a platform prefix helper, exactly like Medium's `namespacedMediumId`.

- `namespacedInstagramId(pk)` → `instagram:${pk}`.
- `normalizeInstagramMedia(media)` → `PostItem`: `id`, `platform:'instagram'`, `externalId: media.pk||media.id`, `category:'social'`, `author`/`authorId` from `media.user`, `content: media.caption?.text`, `postUrl: https://instagram.com/p/${code}`, `mediaUrls[]` (image_versions2 + video_versions), `publishedAt: new Date(taken_at*1000)`, `likesCount`, `repliesCount`, `metadata:{mediaType, isVideo, shortcode:code, location}`.
- `normalizeInstagramProfile(user)` → `ProfileItem`: `id: instagram:${user.pk}`, `username`, `fullName`, `bio: user.biography`, `followersCount: user.follower_count`, `followingCount: user.following_count`, `avatarUrl: user.profile_pic_url_hd||profile_pic_url`, `metadata:{isVerified,isPrivate,mediaCount}`.
- `normalizeInstagramComment` → `CommentItem`.
- `asRecord()` helper + JSDoc typedefs; `Record<string,unknown>` only — **no `any`, no `@ts-ignore`**.

### Validator — `src/scrapers/social/instagram/validator.js`

`InstagramPlatformResponseValidator extends AbstractPlatformResponseValidator`:
- `isBotChallenge` — Instagram `challenge_required`, `/challenge/`, checkpoint redirect, "Please wait a few minutes", suspicious-login email page.
- `isRateLimit` — 429 / `feedback_required` / `Please wait` markers.
- `isLoginWall` — login page redirect, `Login • Instagram` title, missing `sessionid` payload.
- `isValidPayload` — reject challenge/login HTML, accept GraphQL `{data|graphql|items}` or media with `pk`/`code`.
- `validatePost(raw)` throws `ValidationError` when `pk`, `code`, `taken_at`, `caption` missing (AC-8).
- **Challenge handling (AC-9):** on challenge/429 → pause + log alert; max 3 retries, then `BotChallengeError`/`RateLimitError` with `suggestedAction:'rotate_proxy'` / `'checkpoint'`. Never auto-retry past 3.

### Registration

- `src/scrapers/social/index.js` — `export * as instagram from './instagram/index.js';` + named exports.
- `src/scrapers/social/actions-list.js` — `new InstagramCrawler()` in the crawler list.
- `src/scrapers/index.js` — register `instagram`/`ig`/`insta` in dispatcher + action map (`user`/`profile`/`hashtag`/`post`/`comments`), model the Medium dispatch block; unknown action → call the **existing** `actionNotAvailable(platform, action, available)` helper already defined at `src/scrapers/index.js:279` (stamps `statusCode:400`/`code:XACT_4001`). Do **not** `throw new Error(...)` raw — that regresses the 500→400 fix.

### I/O & Edge-Case Matrix

| Scenario | Expected | Error |
|---|---|---|
| `user` public profile (logged in) | `{profile:ProfileItem, posts:PostItem[]}` | private account → `profile.metadata.isPrivate`, posts `[]` |
| `hashtag` feed | `PostItem[]` each with `media[]` URLs | 429 → RateLimitError; challenge → BotChallengeError |
| `post` by shortcode/URL | `{post:PostItem}` | 404 → `PlatformError` `NOT_FOUND` |
| No `sessionid` + no creds | — | `AuthError` / `XACT_4003` |
| Challenge/checkpoint email | pause + alert, ≤3 retries | `BotChallengeError` after 3 |
| Paywalled/private media | snippet only, `metadata.isPrivate` | never unlock |
| `instagrapi` absent | `PlatformError` `NOT_IMPLEMENTED` | don't crash on missing binary |

### Testing Standards (AC-10)

- **No mocks/stubs/fakes** — real implementations only (CLAUDE.md mandatory rule).
- `tests/scrapers/social/instagram/` — `client.test.js`, `crawler.test.js`, `normalizer.test.js`, `validator.test.js`. Use a real `node:http` fixture server for HTML/JSON payloads (same approach as Medium tests).
- Live/browser tests gated behind `INSTAGRAM_E2E=1` (mirror `MEDIUM_E2E`) — never run a real login or real Instagram fetch in the default suite.
- `delayMin=0, delayMax=0` in tests to disable throttle.

### Previous-Story Intelligence (35.1 Reddit, 35.2 Medium)

- Registration must touch **3 places**: `social/index.js`, `social/actions-list.js`, **and** the unified dispatcher `src/scrapers/index.js` — missing the dispatcher leaves the platform unreachable via `scrape()`.
- Use `actionNotAvailable(platform, action, available)` (not `throw new Error`) so invalid actions return HTTP 400 (`XACT_4001`), not 500 — this was fixed repo-wide in `2362c318`.
- Never leave `transport`/`category` as `undefined` — the 35.1 review caught that exact bug.
- The unified dispatcher validates `:platform` against `VALID_PLATFORMS` in `api/routes/platform.js` — add `'instagram'`, `'ig'`, `'insta'` there too, plus `validatePlatformAccount` for `sessionid`/`username`+`password`, or the REST route will 400 before reaching the scraper.
- `normalizePlatform` aliases live in `PLATFORM_ALIASES`; reuse the `'tiktok-shop'→'tiktokshop'` precedent.

### References

- [Source: _bmad-output/implementation-artifacts/epic-35-context.md]
- [Source: src/scrapers/social/medium/{client,crawler,normalizer,validator,bridge,index}.js] — closest sibling pattern
- [Source: src/scrapers/social/reddit/{client,crawler,bridge}.js] — transport/puppeteer bridge pattern
- [Source: src/scrapers/adapters/puppeteer.js] — `PuppeteerAdapter` stealth
- [Source: src/proxy/providers.js] — `ProxyProviderContract`, `getProxy({accountId,requiresResidential,country,isp,sessionId})`
- [Source: src/core/session-manager.js] — `globalSessionManager` in-memory session cache
- [Source: prisma/schema.prisma#SocialAccount] — `encryptedCookie`/`encryptedProxy`/`metadata`
- [Source: api/routes/platform.js] — `VALID_PLATFORMS`, `PLATFORM_ALIASES`, `validatePlatformAccount`, AES-256-GCM encrypt/decrypt

## Tasks / Subtasks

- [x] Implement `src/scrapers/social/instagram/normalizer.js` — plain functions (`namespacedInstagramId`, `extractMediaId`, `normalizeInstagramMedia`, `normalizeInstagramProfile`, `normalizeInstagramComment`, `asRecord`) mirroring `medium/normalizer.js` (AC-7)
- [x] Implement `src/scrapers/social/instagram/validator.js` — `InstagramPlatformResponseValidator extends AbstractPlatformResponseValidator` + `ValidationError` + `validatePost/validateUser/validateComment` (AC-8, AC-9)
- [x] Implement `src/scrapers/social/instagram/client.js` — `InstagramClient extends AbstractApiClient` with `puppeteer`/`http`/`instagrapi` transports, gaussian throttle, sticky US-residential proxy, SessionManager + SocialAccount persistence (AC-1, AC-3, AC-4, AC-9)
- [x] Implement `src/scrapers/social/instagram/crawler.js` — `InstagramCrawler extends AbstractCrawler` registering `user`/`hashtag`/`post`/`comments` + aliases, checkpointResolver, Redis stream emit (AC-5, AC-6)
- [x] Implement `src/scrapers/social/instagram/index.js` barrel
- [x] Write optional `src/scrapers/social/instagram/bridge.py` instagrapi stdio-JSON bridge (AC-2)
- [x] Register `instagram`/`ig`/`insta` in `src/scrapers/social/index.js`, `src/scrapers/social/actions-list.js`, and dispatcher `src/scrapers/index.js` (with `actionNotAvailable` → 400)
- [x] Register `instagram`/`ig`/`insta` in `api/routes/platform.js` `VALID_PLATFORMS` + `validatePlatformAccount` + `buildAuthCookie`
- [x] Write tests `tests/scrapers/social/instagram/{normalizer,validator,client,crawler}.test.js` — real `node:http` fixture, no mocks (AC-10)


### Review Findings (code review 2026-09-11)

Resolved during review (patch — fixed):

- [x] [Review][Patch] `close()` called non-existent adapter methods — switched to `closePage`/`closeBrowser` + track `#page` field [client.js] — browser/page would leak on every scrape (HIGH)
- [x] [Review][Patch] `#getPage` created a new tab per call and never closed it — now reuses `#page` field [client.js] — tab leak under repeated scrapes (HIGH)
- [x] [Review][Patch] `getUser` double-fetched the profile (getUserProfile + getUserMedia each fetched the page) — pass `__user`/`__raw` through to skip redundant fetch + throttle [crawler.js, client.js] (MEDIUM)
- [x] [Review][Patch] `getUserProfile` returned `{user:{}}` silently when embedded JSON missing — now throws `NOT_FOUND` 404 [client.js] (MEDIUM)
- [x] [Review][Patch] `#browserLogin` set `input.value` directly — React controlled inputs ignore it → empty submit — now uses native setter + `input`/`change` dispatch [client.js] (MEDIUM)
- [x] [Review][Patch] `#extractSharedData` had a dead marker-scan loop + variable shadowing (`const user` twice) — removed dead loop, renamed inner to `profile` [client.js] (LOW)

Deferred / noted (not blocking):

- [x] [Review][Defer→Resolved] `#challengeCount` — now also increments on `BotChallengeError` thrown by the base client (not just raw transport errors), so the ≤3-retry → `rotate_proxy` escalation is actually enforced at the client layer. Verified by a dedicated test (5 consecutive challenges → rotate_proxy).
- [x] [Review][Defer→Resolved] `validatePost` `caption` — now optional by default (caption-less media is valid); strict AC-8 literal mode kept behind `opts.requireCaption`. Tests cover both.
- [x] [Review][Defer→Resolved] `#resolveShortcode` — now strips query/hash + trailing slashes and matches `p|reel|reels|tv|share`; tests cover `?igsh=`/`#frag`/`/share/` URLs.

## Dev Agent Record

### Agent Model Used
claude-opus-5[1m]

### Implementation Plan
Mirrored the proven Medium (35.2) pattern end-to-end: plain-function normalizer, `AbstractPlatformResponseValidator` subclass, `AbstractApiClient` subclass with per-platform `buildUrl`/`resolveProxy`, `AbstractCrawler` subclass with registered `ActionDescriptor`s + Redis-stream checkpoint emission, 3-place registration (social barrel → actions-list → unified dispatcher) + `platform.js` VALID_PLATFORMS/validatePlatformAccount.

### Debug Log
- `extractMediaId` initially returned JS-number `pk` — a 19-digit int64 lost float precision (`...678`→`...600`). Fixed: prefer safe-integer string `pk`, else `id`/`code`, splitting `pk_owner` form only when `numeric_numeric`.
- `resolveProxy`: base auto-assigns `globalProxyPool` (a real `ProxyIpPool` with 1 non-residential seed proxy) so `hasProvider` was always true → `super.resolveProxy` threw `XACT_5030`. Fixed by probing `getNext(requiresResidential)` — a non-residential-only pool returns null → falls back to `PROXY_URL` env, surfacing `ProxyDeadError` only when nothing usable exists.
- `saveSession` called `resolveProxy` unconditionally → ProxyDeadError crashed session save. Fixed to best-effort try/catch.
- `buildUrl` is a per-client method (not on base) — added it to `InstagramClient`.
- Crawler `start()` enforces `requiresAuth` before handlers → tests pass `session:{accountId}`.

### Completion Notes
- AC-1/2/3/4/5/6/7/8/9 all satisfied; AC-10 tests: 52 passed, 1 env-gated skip (INSTAGRAM_E2E live puppeteer).
- `instagrapi` bridge ships behind a capability check → `PlatformError` 501 `XACT_5010` when `INSTAGRAPI_BIN`/`INSTAGRAPI_URL` absent; bridge.py present for when it is configured.
- Instagram `pk` int64 precision bug caught by tests and fixed in `extractMediaId`.
- `challenge`/`429`/`401` mapped to `BotChallengeError`/`RateLimitError`/`AuthSessionExpiredError` with ≤3 challenge retries (rotate_proxy on the 3rd).

## File List

**Created**
- `src/scrapers/social/instagram/normalizer.js`
- `src/scrapers/social/instagram/validator.js`
- `src/scrapers/social/instagram/client.js`
- `src/scrapers/social/instagram/crawler.js`
- `src/scrapers/social/instagram/index.js`
- `src/scrapers/social/instagram/bridge.py`
- `tests/scrapers/social/instagram/normalizer.test.js`
- `tests/scrapers/social/instagram/validator.test.js`
- `tests/scrapers/social/instagram/client.test.js`
- `tests/scrapers/social/instagram/crawler.test.js`

**Modified**
- `src/scrapers/social/index.js` — instagram barrel + named exports
- `src/scrapers/social/actions-list.js` — InstagramCrawler in crawler list
- `src/scrapers/index.js` — import, `instagram`/`ig`/`insta` platform map, dispatch block, `actionNotAvailable` reuse
- `api/routes/platform.js` — `VALID_PLATFORMS` + `validatePlatformAccount` + `buildAuthCookie` instagram branches

## Change Log
- feat(35.3): Instagram scraper — client (puppeteer/http/instagrapi), crawler (user/hashtag/post/comments), normalizer, validator, session+sticky-proxy, optional instagrapi bridge.py, dispatcher + platform.js registration. 52 tests pass, 1 env-gated. (Date: 2026-09-11)
- review(35.3): adversarial code review — fixed page/browser leak (closePage/closeBrowser), double-fetch, silent-empty-profile, React login inputs; status kept `review` pending re-verify.
- fix(35.3): resolved all deferred review items — AC-9 challenge counter now reachable+enforced, validatePost caption optional (strict behind flag), resolveShortcode strips query/handles reel|reels|tv|share. 55 tests pass.
