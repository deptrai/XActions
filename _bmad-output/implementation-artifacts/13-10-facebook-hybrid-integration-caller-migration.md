---
story_id: '13.10'
epic: 13
story_key: '13-10-facebook-hybrid-integration-caller-migration'
status: "needs-rework"
phase: "Phase 4"
created: 2026-08-28
updated: 2026-08-28
last_updated: 2026-08-28T23:15:00Z
owner: "DEV"
reviewed: "needs-rework"
baseline_commit: "fddb8ba62e9b438a539df4a67f30bf1a41dc1592"
---

# Story 13.10: Facebook Hybrid Integration & Caller Migration

Status: needs-rework (review 2026-08-28)

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **XActions Platform Engineer**,  
I want **`scrape('facebook', ...)`, MCP/CLI tools, and `api/services/*` to switch to the new `FacebookCrawler` / `FacebookClient` hybrid architecture**,  
So that **end users and internal services no longer depend on the legacy `src/scrapers/facebook/` Puppeteer-only code path, and all Facebook operations benefit from the hybrid engine (GraphQL-first, browser-bridge fallback, sticky residential proxy, error envelopes, velocity tracking, and action-level auth)**.

Như một **Kỹ sư Nền tảng XActions**,  
Tôi muốn **`scrape('facebook', ...)`, công cụ MCP/CLI và `api/services/*` chuyển sang kiến trúc hybrid `FacebookCrawler` / `FacebookClient` mới**,  
Để **người dùng cuối và các dịch vụ nội bộ không còn phụ thuộc vào code path Puppeteer-only legacy `src/scrapers/facebook/`, đồng thời mọi thao tác Facebook tận dụng được hybrid engine (ưu tiên GraphQL, fallback browser bridge, proxy residential cố định, error envelope chuẩn, velocity tracking và xác thực cấp action).**

## Scope Note

Story 13.10 is the **cutover / integration story** for the Facebook hybrid thread (Epic 13, Stories 13.3–13.9). It does **not** introduce new Facebook actions; it migrates the existing public callers so they dispatch into the `FacebookCrawler` action registry.

Story 13.10 là **story cắt chuyển / tích hợp** cho nhánh Facebook hybrid (Epic 13, Stories 13.3–13.9). Story **không** tạo action Facebook mới; nó di chuyển các caller công khai hiện có để chúng dispatch vào `FacebookCrawler` action registry.

- **Trong phạm vi 13.10:**
  - Cập nhật `src/scrapers/index.js` unified `scrape()` để khi `platform === 'facebook'/'fb'` thì chuyển sang `FacebookCrawler.start()` thay vì gọi legacy `scrapeProfile` / `scrapeTweets` / `scrapeMarketplace` / v.v.
  - Cập nhật `api/services/facebookScrape.js` để `run()` và `runSearchAllParallel()` gọi `FacebookCrawler.start()`.
  - Cập nhật `api/services/facebookAutomation.js` (các helper social action), `api/services/facebookAccountPool.js` và `api/services/facebookHealth.js` để loại bỏ dependency `src/scrapers/facebook/` — dùng `FacebookCrawler` / `FacebookClient` / `AccountPool` chung khi có thể.
  - Cập nhật `api/routes/facebook.js` (`/scrape` và `/automate`) để validation giữ nguyên, nhưng bên dưới gọi hybrid.
  - Cập nhật `src/mcp/server.js` để tất cả Facebook tools chuyển sang hybrid cho các action đã có trong `FacebookCrawler`.
  - Cập nhật `src/cli/commands/scrape.js` và `src/cli/commands/automate.js` để hỗ trợ nhiều action hơn và route sang hybrid.
  - Cập nhật `package.json` `exports` để expose `xactions/scrapers/social` (và `xactions/scrapers/social/facebook`) cho consumer.
  - Cập nhật `docs/deprecation-plan.md` và gắn `@deprecated` / `// LEGACY — see docs/deprecation-plan.md` cho `src/scrapers/facebook/index.js`, `api/services/facebookAutomation.js`, và các file legacy còn lại.
  - Cập nhật / đánh dấu `@deprecated` cho `tests/scrapers/facebook-*.test.js` legacy; kiểm thử hybrid tập trung trong `tests/scrapers/social/facebook/`.

- **Không trong phạm vi 13.10 (giữ nguyên hoặc story khác):**
  - Xóa các file legacy — thuộc Epic 20.2 (Legacy Scraper Code Decommissioning).
  - Các action chưa có trong `FacebookCrawler`: `warmup_account`, `warmup_scroll`, `cancel_friend_requests`, `schedule_post` (DB-only), `list_accounts` (DB-only). Các tool này có thể giữ legacy hoặc xử lý ở story riêng; 13.10 KHÔNG phải implement chúng.
  - Không thay đổi schema Prisma hay JSON metadata schema (trừ việc cập nhật deprecation tracker).
  - Không thay đổi tên tool MCP/CLI hiện có để giữ backward compatibility (NFR-16).

- **Đặc biệt:**
  - Action `posts` là **mơ hồ**: có thể là `page_posts` (profile/page) hoặc `group_posts` (nhóm). Caller phải resolve dựa trên `url` chứa `/groups/` hay không, hoặc mặc định `page_posts`.
  - `marketplace` đã được implement trong 13.8 nhưng vẫn còn `// TODO(13.10)` trong 3 nơi; story này phải cắt chuyển nó.
  - `x_facebook_automate` hiện hỗ trợ `like | comment | post | messenger`; 13.10 ánh xạ sang `facebook:like`, `facebook:comment`, `facebook:post`, `facebook:messenger_share`.
  - Epic 4 growth tools (`x_facebook_share_posts`, `x_facebook_join_groups`, `x_facebook_post_to_groups`, `x_facebook_send_friend_requests`) ánh xạ sang `facebook:share`, `facebook:join_group`, `facebook:post`, `facebook:send_friend_request`.

## Sources

- `_bmad-output/planning-artifacts/epics.md` — Epic 13, Story 13.10 [dòng 621-635]
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` — AD-1 (Tiered Signer), AD-2 (AbstractCrawler/ActionRegistry), AD-3 (Proxy Strategy/Action-Level Auth), AD-11 (CrawlerCommand), AD-13 (Adaptive Governor), AD-14 (Error Envelope), AD-18 (Metadata Schema), AD-20 (Dual-Pool Resource Isolation)
- `_bmad-output/planning-artifacts/architecture/xactions-facebook-gateway-2026-08-23/ARCHITECTURE-SPINE.md` — trạng thái `superseded` nhưng vẫn chứa các invariant về account lifecycle, sticky proxy, error envelope, read/write risk profiles
- `_bmad-output/implementation-artifacts/13-3-refactor-facebook-scraper-to-hybrid-architecture.md` — `FacebookClient`, `FacebookCrawler`, `DEFAULT_FB_DOC_IDS`
- `_bmad-output/implementation-artifacts/13-4-facebook-browser-as-signer-bridge.md` — `FacebookBrowserBridge`
- `_bmad-output/implementation-artifacts/13-5-facebook-hybrid-profile-followers-group-members.md` — `resolveTargetKey`, `resolveGroupId`, action auth
- `_bmad-output/implementation-artifacts/13-6-facebook-hybrid-search-global-group-search.md` — `search()`, `groupSearch()`
- `_bmad-output/implementation-artifacts/13-7-facebook-hybrid-post-group-comments.md` — `post_comments`, `group_comments`
- `_bmad-output/implementation-artifacts/13-8-facebook-hybrid-marketplace.md` — `marketplace()` action, filters `categoryId`, `lat/lng`, `radiusKm`, `minPrice`, `maxPrice`
- `_bmad-output/implementation-artifacts/13-9-facebook-hybrid-social-actions-write-messenger.md` — `like`, `comment`, `post`, `share`, `messenger_share`, `share_link_uid`, `join_group`, `send_friend_request`
- `src/scrapers/social/facebook/crawler.js` — `DEFAULT_FB_DOC_IDS` [dòng 203-232], constructor `registerAction` [dòng 300-507], `FacebookCrawler.actions` [dòng 408-409], `marketplace()` [dòng 1471-], `search()` [dòng 1202-], `groupSearch()` [dòng 1349-], `profile()` [dòng 2467-], `followers()` [dòng 2564-], `following()` [dòng 2660-], `groupMembers()` [dòng 2766-], `groupPosts()` [dòng 1080-], `pagePosts()` [dòng 1137-], `postComments()` [dòng 2052-], `groupComments()` [dòng 2118-], `getCommentsForPost()` [dòng 2183-], `like()` [dòng 2888-], `comment()` [dòng 2897-], `post()` [dòng 2906-], `share()` [dòng 2915-], `messengerShare()` [dòng 2924-], `shareLinkByUid()` [dòng 2933-], `joinGroup()` [dòng 2942-], `sendFriendRequest()` [dòng 2951-], `cleanup()` [dòng 2971-]
- `src/scrapers/social/facebook/client.js` — `FacebookClient` constructor [dòng 181-220], `ensureTokens()` [dòng 259-283], `#fetchTokens()` [dòng 356-458], `buildGraphQlBody()` [dòng 468-524], `requestGraphQl()` [dòng 630-700], `close()` [dòng 746-750]
- `src/scrapers/social/facebook/actions.js` — `FacebookActions` class [dòng 247-264], `like()` [dòng 358-437], `comment()` [dòng 483-], `post()` [dòng 641-], `share()` [dòng 850-], `messengerShare()` [dòng 999-], `shareLinkByUid()` [dòng 1058-], `joinGroup()` [dòng 1286-], `sendFriendRequest()` [dòng 1452-]
- `src/scrapers/social/facebook/batch-runner.js` — `MAX_BATCH_SIZE` [dòng 21], `ACTION_LIMITS` [dòng 27-38], `getActionLimit()` [dòng 45-47], `FacebookActionVelocityTracker` [dòng 52-], `runGuardedActionBatch()` [dòng 231-]
- `src/scrapers/social/facebook/index.js` — public exports [dòng 1-31]
- `src/scrapers/index.js` — platform import [dòng 42], `platforms` registry [dòng 104-114], `scrape()` dispatcher [dòng 157-328], `actionMap` [dòng 163-183], `platformActionMap.facebook` [dòng 188-196], `needsPuppeteer` [dòng 215-216], `marketplace` legacy comment [dòng 182]
- `src/scrapers/social/index.js` — barrel export [dòng 8-10]
- `src/index.js` — re-export scrapers + social [dòng 27-28]
- `package.json` — `exports` field [dòng 16-32], `bin` entries [dòng 33-37]
- `src/types/xactions.d.ts` — `XActionsOptions` [dòng 18-81]
- `types/index.d.ts` — `scrapers` declaration [dòng 304-315]
- `api/services/facebookScrape.js` — `run()` [dòng 23-57], `runSearchAllParallel()` [dòng 69-114], `// TODO(13.10)` [dòng 54]
- `api/services/facebookAutomation.js` — `// @deprecated` header [dòng 4], `likeFacebookPosts` [dòng 412-], `commentOnFacebookPosts` [dòng 533-], `createFacebookPost` [dòng 745-], `shareFacebookPosts` [dòng 999-], `joinFacebookGroups` [dòng 1365-], `postToFacebookGroups` [dòng 1570-], `sendFriendRequests` [dòng 1837-]
- `api/services/facebookAuth.js` — `resolve()` [dòng 24-72]
- `api/routes/facebook.js` — `POST /scrape` [dòng 335-589], `VALID_ACTIONS` [dòng 367], `scrapeArgs` builder [dòng 535-568], marketplace `scrapeArgs` [dòng 545-560], `POST /automate` [dòng 604-1066], `runMessengerCampaign` [dòng 258-305]
- `src/mcp/server.js` — Facebook tool definitions [dòng 1386-1685], `x_facebook_automate` dispatch [dòng 2773-2949], `x_facebook_list_accounts` [dòng 2952-2982], `runWithFacebookBrowser` [dòng 2985-2999], `executeFacebookEpic4Tool` [dòng 3002-3204], `x_facebook_group_members` [dòng 3133-3148], `x_facebook_marketplace` [dòng 3151-3200], `executeFacebookScrapeTool` [dòng 3214-3258], `ACTION_MAP` [dòng 3230-3236]
- `src/mcp/facebook-auth.js` — `resolveMcpFacebookAuth()` [dòng 23-25]
- `src/cli/commands/scrape.js` — `xactions scrape` [dòng 17-74]
- `src/cli/commands/automate.js` — `xactions automate` [dòng 18-182]
- `docs/deprecation-plan.md` — legacy-to-hybrid mapping table [dòng 99-127], status tracker [dòng 81-96]
- `src/scrapers/facebook/index.js` — legacy re-exports [dòng 1-64]
- `tests/scrapers/social/facebook/crawler-social-actions.test.js` — ATDD pattern 13.9
- `tests/scrapers/social/facebook/crawler-marketplace.test.js` — ATDD pattern 13.8

## Cross-Epic Dependencies

- Depends on Story 13.1 (`AbstractCrawler`, `AbstractApiClient`, `PreSignedTokenRing`, `SignerWorkerPagePool`, `AdaptiveRateGovernor`)
- Depends on Story 13.3 (`FacebookClient`, `FacebookCrawler`, `DEFAULT_FB_DOC_IDS`, `PrismaStore`)
- Depends on Story 13.4 (`FacebookBrowserBridge`, CDP attach/launch, token extraction, `requiresResidential`)
- Depends on Story 13.5 (`profile`, `followers`, `following`, `group_members`, `resolveTargetKey`, `resolveGroupId`)
- Depends on Story 13.6 (`search`, `group_search`, `DEFAULT_FB_DOC_IDS` placeholder strategy)
- Depends on Story 13.7 (`post_comments`, `group_comments`, input validation, PII stripping, pagination)
- Depends on Story 13.8 (`marketplace` action, guest/auth token ring, `categoryId`, `lat/lng`, `radiusKm`, price filters)
- Depends on Story 13.9 (`like`, `comment`, `post`, `share`, `messenger_share`, `share_link_uid`, `join_group`, `send_friend_request`, `FacebookActions`, `FacebookActionVelocityTracker`, `runGuardedActionBatch`)
- Depends on Epic 6 (FR-53 velocity limits, NFR-5 delay floor, NFR-6 dry-run default, NFR-8/NFR-10 messenger/friend delay)
- Depends on Epic 11 (`ProxyIpPool`, `AccountPool`, `AdaptiveRateGovernor`)
- Unlocks Epic 20.1 (Nowing shadow-run) và Epic 20.2 (final legacy decommission)
- Unlocks Epic 25 (`25-3-mcp-cli-api-caller-migration` can reuse 13.10 patterns)

## Baseline

- `baseline_commit: fddb8ba6` — Story 13.9 done; `FacebookCrawler` đã đăng ký đầy đủ các action: `group_posts`, `page_posts`, `get_comments`, `post_comments`, `group_comments`, `profile`, `followers`, `following`, `group_members`, `search`, `group_search`, `marketplace`, `like`, `comment`, `post`, `share`, `messenger_share`, `share_link_uid`, `join_group`, `send_friend_request`.
- `FacebookClient`/`FacebookCrawler` đã có token cache, auth/guest ring partition, residential proxy, `FacebookPlatformResponseValidator`.
- `FacebookActions`/`batch-runner.js` đã implement write action với delay floor, velocity tracker, governor per-item.
- Unified `scrape()` trong `src/scrapers/index.js` vẫn import `facebook` từ `src/scrapers/facebook/index.js` (legacy) [dòng 42] và dispatch qua `scrapeProfile`/`scrapeTweets`/`scrapeMarketplace`/v.v.
- `src/scrapers/index.js:182` còn `// TODO(13.10): migrate to FacebookCrawler action 'marketplace'`.
- `api/services/facebookScrape.js:54` còn `// TODO(13.10): route to FacebookCrawler.start({ action: 'marketplace' })`.
- `src/mcp/server.js:3152` còn `// TODO(13.10): switch to FacebookCrawler.start({ action: 'marketplace' })`.
- `src/mcp/server.js` Epic 7 scrape tools vẫn gọi `executeFacebookScrapeTool` → `facebookScrape.run()` → `scrape()`.
- `src/mcp/server.js` Epic 4 automation tools (`x_facebook_share_posts`, `x_facebook_join_groups`, `x_facebook_post_to_groups`, `x_facebook_send_friend_requests`, `x_facebook_cancel_friend_requests`, `x_facebook_warmup_*`) vẫn gọi các hàm trong `api/services/facebookAutomation.js` (legacy).
- `src/cli/commands/scrape.js` chỉ hỗ trợ `profile/posts/followers/search` cho Facebook.
- `src/cli/commands/automate.js` chỉ hỗ trợ `like/comment/post/messenger-share` cho Facebook.
- `docs/deprecation-plan.md` đã ghi mapping legacy → hybrid [dòng 99-127] nhưng status tracker của `src/scrapers/facebook/` vẫn ở `deprecated-planned` / `deprecated-marked` tùy file.

## Acceptance Criteria

### AC-1: `src/scrapers/index.js` hybrid dispatch for Facebook

- **Given** `scrape('facebook', action, options)` được gọi
- **When** `action` là một trong các action đã được `FacebookCrawler` đăng ký
- **Then** `src/scrapers/index.js` KHÔNG tạo Puppeteer page qua `createBrowser`/`createPage`/`loginWithCookie` legacy
- **And** nó khởi tạo `FacebookCrawler` (với `FacebookClient` + proxy/governor/accountPool nếu được cấu hình)
- **And** gọi `crawler.start({ action: <mappedAction>, args, session })` với `args` chứa các tham số action, `session` chứa `accountId`/`cookies`/`cdpUrl` từ `options.authCookie`
- **And** `crawler.cleanup()` được gọi khi `options.autoClose !== false` (tương tự auto-close page hiện tại)

### AC-2: Action name mapping `scrape()` → `FacebookCrawler` actions

| `scrape()` action | `FacebookCrawler` action | Ghi chú |
|---|---|---|
| `profile` | `profile` | `options.username` hoặc `options.url` |
| `posts` | `page_posts` hoặc `group_posts` | Resolve theo `url` chứa `/groups/`? `group_posts` : `page_posts`; mặc định `page_posts` |
| `followers` | `followers` | `options.username` / `options.url` |
| `search` | `search` | `options.query`, `options.type`, `options.location`, `options.limit` |
| `marketplace` | `marketplace` | `query`, `location`, `category`, `categoryId`, `minPrice`, `maxPrice`, `latitude`, `longitude`, `radiusKm`, `limit`, `cursor` |
| `post_comments` | `post_comments` | `options.url` |
| `group_posts` | `group_posts` | `options.url` (nhóm) |
| `group_comments` | `group_comments` | `options.url` (group post) |
| `group_search` | `group_search` | `options.url` + `options.query` |
| `group-members` | `group_members` | `options.url` (nhóm) |

- **And** nếu `options.page` được cung cấp, truyền qua `session.page` để `FacebookBrowserBridge` tái sử dụng (không bắt buộc nếu bridge tự launch).
- **And** action không xác định vẫn throw lỗi với danh sách action khả dụng từ `FacebookCrawler.listActions()`.

### AC-3: `api/services/facebookScrape.js` chuyển sang `FacebookCrawler`

- **Given** `facebookScrape.run(action, args)`
- **When** `action` là một action Facebook
- **Then** thay vì gọi `scrape('facebook', action, ...)` từ `src/scrapers/index.js`, service khởi tạo `FacebookCrawler` một lần và gọi `crawler.start({ action, args: mappedArgs, session: { accountId, cookies } })`
- **And** `runSearchAllParallel()` với `type: 'all'` + `parallel: true` fan-out 4 sub-task `FacebookCrawler.start({ action: 'search', args: { query, type, location, limit } })` thay vì `scrape('facebook', 'search', ...)`
- **And** cookie resolution (`resolve`) vẫn dùng `api/services/facebookAuth.js` [dòng 24-72]
- **And** `browserOptions` được truyền vào `FacebookClient` constructor (`proxy`, `proxyAuth`, `proxyLocation`, `headless`, `cdpUrl`)

### AC-4: `api/routes/facebook.js` response shape không đổi

- **Given** `POST /api/facebook/scrape` và `POST /api/facebook/automate`
- **When** request body validation pass
- **Then** response JSON shape giữ nguyên (`{ ok, action, result }` cho scrape; `{ ok, action, dryRun, ...result }` cho automate)
- **And** `VALID_ACTIONS` [dòng 367] vẫn chấp nhận cùng action set
- **And** `scrapeArgs` cho `marketplace` [dòng 545-560] vẫn truyền đầy đủ `categoryId`, `minPrice`, `maxPrice`, `latitude`, `longitude`, `radiusKm`, `cursor`, `dryRun`
- **And** `/automate` messenger-share vẫn hỗ trợ multi-account round-robin [dòng 730-798]; nếu `messenger_share` action của `FacebookCrawler` đã hỗ trợ multi-recipient, ưu tiên dùng `FacebookCrawler`; ngược lại giữ `runMessengerCampaign` legacy tạm thời

### AC-5: `src/mcp/server.js` Epic 7 scrape tools chuyển sang hybrid

- **Given** tool `x_facebook_search`, `x_facebook_post_comments`, `x_facebook_group_posts`, `x_facebook_group_comments`, `x_facebook_posts`
- **When** `executeFacebookScrapeTool(name, args)` [dòng 3214-3258]
- **Then** `ACTION_MAP` cập nhật để `x_facebook_posts` trỏ đến hybrid action `page_posts` (hoặc resolve `url` thành `group_posts` nếu là group URL)
- **And** `x_facebook_marketplace` handler [dòng 3151-3200] gọi `FacebookCrawler.start({ action: 'marketplace', args, session })` với tất cả filter hiện có + bổ sung `categoryId`, `latitude`, `longitude`, `radiusKm`
- **And** `x_facebook_group_members` [dòng 3133-3148] gọi `FacebookCrawler.start({ action: 'group_members', args: { groupUrl, limit }, session })`
- **And** `dryRun` default `true` được tôn trọng

### AC-6: `src/mcp/server.js` automation / Epic 4 tools chuyển sang hybrid

| MCP tool | Action `FacebookCrawler` | Input mapping |
|---|---|---|
| `x_facebook_automate` `like` | `like` | `urls` → `postUrls` |
| `x_facebook_automate` `comment` | `comment` | `urls` + `text` |
| `x_facebook_automate` `post` | `post` | `text` (+ tùy chọn `groupUrls`) |
| `x_facebook_automate` `messenger` | `messenger_share` | `postUrl`, `recipients`, `content` |
| `x_facebook_share_posts` | `share` | `postUrls` |
| `x_facebook_join_groups` | `join_group` | `groupUrls` hoặc `keyword` + `limit` |
| `x_facebook_post_to_groups` | `post` | `groupUrls` + `content` |
| `x_facebook_send_friend_requests` | `send_friend_request` | `targets` / `mode` / `location` / `limit` |

- **And** `x_facebook_schedule_post`, `x_facebook_warmup_scroll`, `x_facebook_warmup_account`, `x_facebook_cancel_friend_requests`, `x_facebook_list_accounts` **KHÔNG bắt buộc** phải chuyển trong 13.10 vì chưa có action tương ứng trong `FacebookCrawler`
- **And** nếu một tool cần multi-account (như messenger-share), nó có thể sử dụng `FacebookCrawler` với `accountPool` hoặc giữ `runMessengerCampaign` legacy tạm thời

### AC-7: CLI `xactions scrape` và `xactions automate` route sang hybrid

- **Given** `xactions scrape --platform facebook --action <action>`
- **When** chạy
- **Then** `src/cli/commands/scrape.js` hỗ trợ thêm: `marketplace`, `group_posts`, `group_comments`, `post_comments`, `group_search`, `group_members`
- **And** thêm option `--url <url>` cho các action cần URL, `--include-replies` cho comments, `--location`, `--category`, `--min-price`, `--max-price`, `--latitude`, `--longitude`, `--radius-km`, `--category-id` cho `marketplace`
- **And** `src/cli/commands/automate.js` hỗ trợ thêm `--action share` (với `--urls`), `--action join-group` (với `--group-urls` / `--keyword`), `--action send-friend-request` (với `--targets`), `--action messenger-share` với `--recipients`, `--content`, `--post-url`
- **And** cả hai command đều build `FacebookCrawler` (hoặc gọi `scrape('facebook', ...)` đã cập nhật) thay vì import legacy `src/scrapers/facebook/index.js`

### AC-8: Action discovery qua `FacebookCrawler.listActions()`

- **Given** `FacebookCrawler.listActions()` [kế thừa `AbstractCrawler.listActions()` dòng 107-117]
- **When** MCP/CLI/API cần liệt kê action
- **Then** `requiresAuth` được phân giải theo từng descriptor (ví dụ `marketplace`, `search`, `page_posts`, `profile` = `false`; `like`, `comment`, `post`, `messenger_share`, `join_group` = `true`)
- **And** MCP tool `x_actions_list` (nếu tồn tại) hoặc CLI `xactions actions --platform facebook` trả về danh sách action với `requiredArgs`, `optionalArgs`, `example`, `outputType`, `requiresAuth`
- **And** nếu CLI `xactions actions` chưa tồn tại, **bổ sung command** `xactions actions --platform <platform>` hoặc `xactions facebook actions`

### AC-9: `package.json` / module exports

- **Given** consumer `import { FacebookCrawler, FacebookClient } from 'xactions/scrapers/social'`
- **When** package resolve
- **Then** `package.json:exports` bổ sung `./scrapers/social` → `./src/scrapers/social/index.js` và `./scrapers/social/facebook` → `./src/scrapers/social/facebook/index.js`
- **And** `src/scrapers/index.js` có thể re-export `FacebookCrawler`, `FacebookClient`, `FacebookActions` as named để consumer dùng `import { FacebookCrawler } from 'xactions/scrapers'`
- **And** `types/index.d.ts` hoặc `src/types/xactions.d.ts` cập nhật declaration cho `FacebookCrawler` / `FacebookClient` (tối thiểu cập nhật `scrapers` namespace)

### AC-10: Deprecation markers

- **Given** legacy `src/scrapers/facebook/index.js`, `api/services/facebookAutomation.js`, `src/scrapers/facebook/marketplace.js`, `src/scrapers/facebook/posts.js`, `src/scrapers/facebook/comments.js`, `src/scrapers/facebook/search.js`, `src/scrapers/facebook/group-search.js`, `src/scrapers/facebook/followers.js`, `src/scrapers/facebook/profile.js`
- **When** 13.10 hoàn thành
- **Then** mỗi file header có `/** @deprecated Replaced by FacebookCrawler / FacebookClient. See docs/deprecation-plan.md */`
- **And** `docs/deprecation-plan.md` status tracker cập nhật: `Facebook Puppeteer (src/scrapers/facebook/)` sang `deprecated-planned` (hoặc `deprecated-marked` nếu toàn bộ caller đã chuyển)
- **And** `docs/deprecation-plan.md` legacy-to-hybrid mapping table bổ sung / xác nhận tất cả action đã chuyển

### AC-11: Test migration

- **Given** test suite hiện tại
- **When** 13.10 hoàn thành
- **Then** `tests/scrapers/facebook-*.test.js` được đánh dấu `@deprecated` hoặc chuyển logic sang `tests/scrapers/social/facebook/`
- **And** tạo / cập nhật `tests/scrapers/social/facebook/caller-migration.test.js` kiểm tra:
  - `[AC-1]` `scrape('facebook', 'marketplace', ...)` dispatch sang `FacebookCrawler`
  - `[AC-2]` `scrape('facebook', 'posts', { url })` resolve đúng `page_posts` / `group_posts`
  - `[AC-3]` `api/services/facebookScrape.js` `run()` gọi `FacebookCrawler.start()`
  - `[AC-5]` `executeFacebookScrapeTool` / `executeFacebookEpic4Tool` mapping đúng action
  - `[AC-7]` CLI `scrape`/`automate` parse args và route sang hybrid
  - `[AC-9]` `package.json` `exports` chứa `./scrapers/social`
  - `[AC-13]` `api/services/facebookAutomation.js`, `facebookAccountPool.js`, `facebookHealth.js` và `/api/facebook/automate` route sang hybrid hoặc đánh dấu deprecated
- **And** chạy `npx vitest run tests/scrapers/social/facebook/`, `npx tsc --noEmit`, `npm run typecheck` pass

### AC-12: Backward compatibility & dry-run

- **Given** consumer hiện tại gọi API/MCP/CLI với cùng request body
- **When** 13.10 chạy
- **Then** response JSON shape, field names, `dryRun` default `true`, và error message prefix `❌` giữ nguyên
- **And** `authCookie` values không bao giờ log (NFR-3)
- **And** `x_facebook_*` tool names không đổi (NFR-16)

### AC-13: `api/services/facebookAutomation.js`, `facebookAccountPool.js`, `facebookHealth.js` và `/automate` route chuyển sang hybrid hoặc đánh dấu deprecated

- **Given** các service hỗ trợ Facebook hiện tại vẫn import từ `src/scrapers/facebook/`
- **When** 13.10 hoàn thành
- **Then** `api/routes/facebook.js` `POST /automate` với `action` đã có trong `FacebookCrawler` (`like`, `comment`, `post`, `share`, `join-groups`, `batch-post-groups`, `send-friend-requests`, `messenger-share`) gọi `FacebookCrawler.start()` thay vì `api/services/facebookAutomation.js`.
- **And** `api/services/facebookAutomation.js` các helper tương ứng được đánh dấu `@deprecated` hoặc refactor thành thin wrapper gọi `FacebookCrawler`; `schedule`, `warmup-account`, `warmup-scroll-feed`, `cancel-friend-requests` giữ legacy tạm thời.
- **And** `api/services/facebookAccountPool.js` `runBatch` hỗ trợ `FacebookCrawler` sessions (ít nhất cho `runSearchAllParallel`) và không tạo Puppeteer page khi tất cả task là hybrid.
- **And** `api/services/facebookHealth.js` chuyển sang dùng `FacebookClient` (hoặc `FacebookCrawler`) cho HTTP health check, loại bỏ import `src/scrapers/facebook/graphql.js`.
- **And** tất cả service trên được thêm vào `docs/deprecation-plan.md` status tracker.

## Technical Requirements

### TR-1: Unified `scrape()` hybrid branch

Trong `src/scrapers/index.js` [dòng 157-328]:

1. Thay đổi `import facebook from './facebook/index.js'` [dòng 42] thành `import facebook from './social/facebook/index.js'` HOẶC giữ import mới bên cạnh import legacy để dùng adapter.
2. Trước khi branch `needsPuppeteer`, kiểm tra `platform === 'facebook' || platform === 'fb'` và `mod.FacebookCrawler` tồn tại.
3. Nếu đúng, gọi hàm helper `runFacebookCrawler(mod.FacebookCrawler, action, options)`:
   - Resolve `action` → `crawlerAction` theo bảng AC-2.
   - Build `args` từ `options` (bỏ qua `page`, `autoClose`, `authCookie`, `browserOptions`, `client`).
   - Build `session`:
     - `accountId` từ `options.authCookie.accountId` hoặc `options.userId` hoặc `null`
     - `cookies` từ `options.authCookie` object `{ c_user, xs }` (nếu raw)
     - `cdpUrl` từ `options.browserOptions?.cdpUrl` hoặc `process.env.FACEBOOK_CDP_URL`
   - Khởi tạo `FacebookClient` với `proxy`, `proxyPool`, `governor`, `accountPool`, `cdpUrl`, `launchChrome` (nếu cần bridge cho write/comment), `headless`.
   - Khởi tạo `FacebookCrawler` với `client`.
   - Gọi `crawler.start({ action: crawlerAction, args, session })`.
   - Cuối cùng gọi `await crawler.cleanup()` nếu `options.autoClose !== false`.
4. Nếu action không được hỗ trợ, throw `Error` với `FacebookCrawler.listActions()` join.

### TR-2: `api/services/facebookScrape.js` refactor

- Tạo hàm `createFacebookCrawler(browserOptions = {})` dùng chung cho `run()` và `runSearchAllParallel()`:
  - `new FacebookClient({ ...browserOptions, proxy: ..., proxyPool: ..., governor: ..., accountPool: ... })`
  - `new FacebookCrawler({ client, store: defaultStore, governor: ..., accountPool: ..., sessionManager: ... })`
- `run(action, args)`:
  - Resolve `authCookie` qua `resolve()` như hiện tại.
  - Map action `posts` → `page_posts` / `group_posts` nếu cần.
  - Gọi `crawler.start({ action, args: rest, session: { accountId, cookies: { c_user, xs } } })`.
  - Trả về kết quả trực tiếp; không gọi `scrape()`.
- `runSearchAllParallel(baseArgs, rest, userId, browserOptions)`:
  - Tạo 4 task, mỗi task gọi `crawler.start({ action: 'search', args: { query, type, location, limit }, session: { accountId } })` với `autoClose: false`.
  - Sử dụng `FacebookAccountPool.runBatch` hoặc `p-limit` nếu `accountIds` được cung cấp.
  - Kết quả gộp `posts`, `people`, `pages`, `groups` như hiện tại.

### TR-3: `src/mcp/server.js` handler refactor

- `executeFacebookScrapeTool(name, args)` [dòng 3214-3258]:
  - `ACTION_MAP` cập nhật: `x_facebook_posts: 'page_posts'` (hoặc resolve).
  - Bổ sung `x_facebook_marketplace: 'marketplace'`, `x_facebook_group_members: 'group_members'`.
  - Build `args` từ `rest`, giữ `authCookie`, `browserOptions`.
  - Gọi `facebookScrape.run(action, scrapeArgs)` (đã refactor ở TR-2).
- `executeFacebookEpic4Tool(name, args)` [dòng 3002-3204]:
  - Thay vì import `api/services/facebookAutomation.js` cho `share`, `join`, `post_to_groups`, `send_friend_requests`, gọi `facebookScrape.run(action, args)` với `action` tương ứng.
  - `x_facebook_schedule_post`, `x_facebook_warmup_scroll`, `x_facebook_warmup_account`, `x_facebook_cancel_friend_requests` giữ nguyên legacy tạm thời (ghi chú rõ).
- `executeFacebookAutomateTool(args)` [dòng 2862-2949]:
  - Map `action` sang `like | comment | post | messenger_share`.
  - Gọi `facebookScrape.run(action, { postUrl/postUrls, text, groupUrls, recipients, content, dryRun, ... })`.

### TR-4: CLI refactor

- `src/cli/commands/scrape.js`:
  - Bổ sung `--action` enum: `profile, posts, followers, search, marketplace, post_comments, group_posts, group_comments, group_search, group_members`
  - Bổ sung `--url` (cho group/comments), `--include-replies`, `--location`, `--category`, `--category-id`, `--min-price`, `--max-price`, `--latitude`, `--longitude`, `--radius-km`
  - Build `scrapeOptions` với các trường tương ứng; gọi `scrape('facebook', action, scrapeOptions)` (sau khi `src/scrapers/index.js` đã cập nhật).
- `src/cli/commands/automate.js`:
  - Bổ sung `--action share` (dùng `--urls`), `--action join-group` (`--group-urls`, `--keyword`, `--limit`), `--action send-friend-request` (`--targets`, `--mode`, `--location`, `--limit`), `--action messenger-share` (`--post-url`, `--recipients`, `--content`).
  - Gọi `scrape('facebook', action, { authCookie, dryRun, ... })` hoặc `FacebookCrawler.start()` trực tiếp.

### TR-5: `package.json` exports

- Thêm vào `exports`:
  ```json
  "./scrapers/social": "./src/scrapers/social/index.js",
  "./scrapers/social/facebook": "./src/scrapers/social/facebook/index.js"
  ```
- Nếu cần, thêm `./scrapers/social/facebook/client` hoặc `./scrapers/social/facebook/crawler` tùy consumer.

### TR-6: Type declarations

- `types/index.d.ts` hoặc `src/types/xactions.d.ts` bổ sung:
  - `declare const scrapers` chứa `FacebookCrawler` / `FacebookClient` (hoặc new module declaration)
  - `FacebookOptions` trong `src/types/facebook.d.ts` đã tồn tại; cập nhật `XActionsOptions` nếu cần thêm `action`/`url` cho CLI parse.

### TR-7: Deprecation & docs

- `docs/deprecation-plan.md`:
  - Cập nhật status tracker: toàn bộ `src/scrapers/facebook/` → `deprecated-planned` / `deprecated-marked`.
  - Xác nhận mapping table đã bao phủ toàn bộ action.
- `src/scrapers/facebook/index.js`: thêm `@deprecated` header.
- `api/services/facebookAutomation.js`: giữ `// @deprecated Use FacebookCrawler hybrid actions (Story 13.9) instead.`; không xóa.

### TR-8: Service-layer cleanup

- `api/routes/facebook.js` `/automate`: chuyển `like/comment/post/share/join-groups/batch-post-groups/send-friend-requests/messenger-share` sang `FacebookCrawler`. Giữ `schedule`, `warmup*`, `cancel-friend-requests` legacy tạm thời.
- `api/services/facebookAutomation.js`: đánh dấu helper social action `@deprecated`; nếu cần giữ backward compat, tạo thin wrapper gọi `FacebookCrawler.start()`.
- `api/services/facebookAccountPool.js`: cập nhật `runBatch` để hỗ trợ `FacebookCrawler` sessions (cho `runSearchAllParallel` và multi-account messenger nếu cần).
- `api/services/facebookHealth.js`: dùng `FacebookClient` để fetch homepage và extract tokens cho health status thay vì `src/scrapers/facebook/graphql.js`.

## Architecture Compliance

- **AbstractCrawler / ActionRegistry (AD-2):** `FacebookCrawler` kế thừa `AbstractCrawler`; tất cả action đã đăng ký. Caller gọi `start({ action, args, session })`.
- **CrawlerCommand (AD-11):** `action` là `snake_case`; `args` chứa input; `session` chứa `accountId`/`cookies`/`cdpUrl`; `requiresAuth` phân giải từ descriptor.
- **Proxy Strategy (AD-3):** `FacebookClient` mặc định `requiresProxy: true` cho `facebook.com`; `requiresAuth: true` action dùng sticky residential proxy theo account; no-auth action (`search`, `marketplace`, `page_posts`, `profile`) dùng rotating/guest ring.
- **Error Envelope (AD-14):** Tất cả lỗi trả về `{ code, type, message, retryAfter, suggestedAction, accountId?, platform }`.
- **Anti-Bot Validation (AD-9):** `FacebookPlatformResponseValidator` phát hiện challenge/rate-limit; `FacebookCrawler` kết hợp `FacebookClient` fallback SSR/browser.
- **Adaptive Governor (AD-13):** `AdaptiveRateGovernor` gọi trước `crawler.start()`; `runGuardedActionBatch` gọi per-item cho write actions.
- **Dual-Pool Resource Isolation (AD-20):** MCP on-demand queries và bulk crawl workers phải dùng `ProxyIpPool` quota riêng (nếu caller truyền consumer tag `X-Consumer-Id`).
- **Backward Compatibility (NFR-16):** Không đổi tên tool, route path, CLI command. Chỉ thay đổi implementation bên dưới.

## File Structure Requirements

### Cập nhật

- `src/scrapers/index.js` — thêm hybrid dispatch branch; có thể đổi import `facebook` sang `src/scrapers/social/facebook/index.js` hoặc thêm adapter.
- `src/scrapers/social/facebook/index.js` — (tùy chọn) export `scrapeFacebook(action, options)` adapter nếu `src/scrapers/index.js` cần giao diện cũ.
- `api/services/facebookScrape.js` — `run()` và `runSearchAllParallel()` chuyển sang `FacebookCrawler.start()`.
- `api/services/facebookAutomation.js` — đánh dấu `@deprecated` hoặc refactor thành thin wrapper gọi `FacebookCrawler.start()`.
- `api/services/facebookAccountPool.js` — cập nhật `runBatch` để hỗ trợ `FacebookCrawler` sessions khi tất cả task là hybrid.
- `api/services/facebookHealth.js` — chuyển health check sang `FacebookClient`/`FacebookCrawler`, loại bỏ dependency `src/scrapers/facebook/graphql.js`.
- `api/routes/facebook.js` — `/scrape` và `/automate` giữ validation, đảm bảo `scrapeArgs` truyền đủ filter; `/automate` route các action đã có trong `FacebookCrawler` sang hybrid.
- `src/mcp/server.js` — `executeFacebookScrapeTool`, `executeFacebookEpic4Tool`, `executeFacebookAutomateTool` route sang hybrid.
- `src/cli/commands/scrape.js` — mở rộng action/option list.
- `src/cli/commands/automate.js` — mở rộng action/option list.
- `package.json` — thêm `exports` `./scrapers/social` và `./scrapers/social/facebook`.
- `types/index.d.ts` hoặc `src/types/xactions.d.ts` — cập nhật declaration cho hybrid scrapers.
- `docs/deprecation-plan.md` — cập nhật status tracker và mapping.
- `src/scrapers/facebook/index.js` — thêm `@deprecated` header.
- `tests/scrapers/facebook-*.test.js` — đánh dấu `@deprecated` hoặc migrate.

### Tạo mới (tùy chọn)

- `src/scrapers/social/facebook/adapter.js` — adapter `scrapeFacebook(action, options)` để `src/scrapers/index.js` gọi mà không đụng logic legacy.
- `tests/scrapers/social/facebook/caller-migration.test.js` — ATDD tests cho AC-1..AC-13.
- `src/cli/commands/actions.js` — (nếu chưa có) `xactions actions --platform facebook` để list action (tùy CLI roadmap).

## Testing Requirements

- **No mocks/stubs:** Không dùng `vi.fn()`, `sinon`, `nock`. Dùng real `node:http` server nếu cần test `FacebookClient` HTTP path.
- **Real `node:http` server pattern:** Tương tự `crawler-marketplace.test.js` và `crawler-social-actions.test.js` để test `FacebookCrawler` dispatch qua adapter.
- **Backward compatibility smoke tests:**
  - Gọi `scrape('facebook', 'marketplace', { query: 'macbook', authCookie })` và kiểm tra `FacebookCrawler.marketplace()` được gọi.
  - Gọi `scrape('facebook', 'posts', { url: 'https://facebook.com/groups/123' })` và kiểm tra action = `group_posts`.
  - Gọi `scrape('facebook', 'posts', { url: 'https://facebook.com/zuck' })` và kiểm tra action = `page_posts`.
- **API route integration tests:**
  - `POST /api/facebook/scrape` với `action: 'marketplace'` trả về `{ ok, action, result }` với `result.posts` là `PostItem[]`.
  - `POST /api/facebook/automate` `like` với `dryRun: true` trả về `dryRun: true`.
- **MCP handler tests:**
  - `x_facebook_search` → `FacebookCrawler.start({ action: 'search' })`
  - `x_facebook_marketplace` → `FacebookCrawler.start({ action: 'marketplace' })`
  - `x_facebook_automate` `like` → `FacebookCrawler.start({ action: 'like' })`
- **CLI tests:**
  - `xactions scrape --platform facebook --action marketplace --query macbook --auth-cookie '{"c_user":"...","xs":"..."}'` chạy hybrid.
  - `xactions automate --platform facebook --action like --urls ... --auth-cookie ...` chạy hybrid.
- **Type & verification:**
  - `npx vitest run tests/scrapers/social/facebook/`
  - `npx tsc --noEmit`
  - `npm run typecheck`
  - `npx prisma validate`

## Previous Story Intelligence

### Từ Story 13.9 (`13-9-facebook-hybrid-social-actions-write-messenger.md`)

- `FacebookCrawler` constructor khai báo tất cả write action với `requiresAuth: true` [dòng 429-515].
- `FacebookActions`/`batch-runner.js` cung cấp `runGuardedActionBatch` với `per-item governor check` và `FacebookActionVelocityTracker` sliding window 1h/24h [dòng 52-].
- `FacebookCrawler.like/comment/post/share/messengerShare/joinGroup/sendFriendRequest` đều là thin wrapper gọi `this.actions.*` [dòng 2888-2953].
- `share_link_uid` là alias của `messenger_share` [dòng 2933-2935].
- Delay floor là ràng buộc cứng: `like` 1–3s, `comment` 3–7s / 5–15s group, `post` 3–7s / 30–90s group, `share` 5–15s, `messenger_share` 5–15s, `join_group` 30–90s, `send_friend_request` 60–180s.

### Từ Story 13.8 (`13-8-facebook-hybrid-marketplace.md`)

- `marketplace()` action có `requiresAuth: false` [dòng 425]; hỗ trợ `categoryId`, `latitude`, `longitude`, `radiusKm`, `minPrice`, `maxPrice`, `location`, `cursor`.
- Giá truyền vào GraphQL dưới dạng cents (`* 100`), giữ nguyên đơn vị gốc khi build URL fallback.
- `DEFAULT_FB_DOC_IDS.MARKETPLACE_SEARCH` là placeholder; fallback SSR/browser nếu doc_id rotated.

### Từ Story 13.7 / 13.6 / 13.5

- Input validation dùng `URL`, `assertFacebookUrlLocal`, `resolveTargetKey`, `resolveGroupId`.
- `limit` clamp, `after` cursor trim, `includeReplies` boolean.
- `search` hỗ trợ `type` và `type: 'all'`, `location`.
- `group_search` yêu cầu `url` là `facebook.com/groups/...`.

### Áp dụng cho 13.10

- Migration không thay đổi logic action; chỉ thay đổi caller surface.
- Mọi caller phải xây dựng `CrawlerCommand` đúng shape (`action`, `args`, `session`).
- `session.accountId` có thể là `c_user`, user id, hoặc `null` cho no-auth action.
- `session.cookies` là `{ c_user, xs }` string/object.
- Tránh import `api/services/facebookAutomation.js` từ MCP/CLI sau khi chuyển xong.

## Latest Technical Information

- `FacebookCrawler` đã có đủ action cho cả read và write; `listActions()` kế thừa từ `AbstractCrawler` trả về `ActionDescriptor[]`.
- `FacebookClient` hỗ trợ `requestGraphQl(docId, variables, options)` với `fallbackDocIds` [dòng 630].
- `FacebookBrowserBridge` hỗ trợ `withPage(fn, options)` để write actions dùng page với sticky residential proxy [dòng 569-].
- `api/services/facebookAuth.js` là single source of truth cho cookie resolution; cả API, MCP, và hybrid caller nên dùng nó.
- `src/mcp/server.js` đã có fail-fast validation trước khi gọi legacy; giữ pattern này và chỉ thay implementation sau validation.
- `api/routes/facebook.js` đã hỗ trợ đầy đủ body fields cho `marketplace` (`categoryId`, `lat`, `lng`, `radiusKm`, v.v.) nhưng service chưa dùng hết.
- `src/scrapers/index.js` `platforms.facebook` import legacy; việc chuyển sang hybrid cần đảm bảo default export vẫn tương thích (Twitter backward compat).
- `package.json` `exports` thiếu `./scrapers/social` — consumer không thể `import { FacebookCrawler } from 'xactions/scrapers/social'`.

## Git Intelligence Summary

- **Baseline commit:** `fddb8ba62e9b438a539df4a67f30bf1a41dc1592` (short `fddb8ba6`) — Story 13.9 v2 review patches done.
- **Recent patterns:**
  - `fddb8ba6` fix(facebook): apply Story 13.9 v2 review patches and residential proxy filtering
  - `bb132909` docs(story): check off 13.9 review findings, clean deferred-work, remove obsolete test file
  - `05175050` feat(facebook): Story 13.9 hybrid social actions + live tests
  - `b2072056` feat(facebook): merge Story 13.9 Facebook Hybrid Social Actions
  - `218696e6` fix(facebook): unwrap native adapter page in browser bridge withPage
  - `e26e9511` chore: merge feat/13-8-facebook-hybrid-marketplace into develop
- `git diff --stat HEAD~5..HEAD` cho thấy hơn 13k dòng thay đổi chủ yếu trong `src/scrapers/social/facebook/`, `src/mcp/server.js`, `api/routes/facebook.js`, `api/services/facebookScrape.js`, `api/services/facebookAutomation.js`, `docs/deprecation-plan.md`, và story artifacts.
- **Conventions:**
  - Commit messages: `feat(facebook): ...`, `fix(facebook): ...`, `test(facebook): ...`, `docs(story): ...`
  - Push as `nirholas` (mandatory theo `AGENTS.md` / `CLAUDE.md`)
  - `npx tsc --noEmit` và `npx vitest run ...` pass trước khi đánh dấu done

## Project Context Reference

- `AGENTS.md` / `CLAUDE.md` — ESM, `const` over `let`, async/await, error emoji prefixes, no mocks, always commit/push as `nirholas`.
- `docs/deprecation-plan.md` — gắn `@deprecated`, cập nhật status tracker, không xóa legacy cho đến Epic 20.2.
- `prisma/schema.prisma` — `Post.id` namespaced, `metadata Json?`, `CrawlCheckpoint` unique key.
- `src/core/base-crawler.js` — `start()` dòng 151-252, `listActions()` dòng 107-117, action auth resolution dòng 174-194.
- `src/core/base-client.js` — `AbstractApiClient`, proxy resolution, error codes `XACT_5030` / `XACT_4010` / `XACT_4290`.
- `src/core/adaptive-governor.js` — `canAccountRequest()` / `recordRequest()`.
- `src/types/facebook.d.ts` — `FacebookOptions` / `FacebookMarketplaceListing` / `FacebookProxyDescriptor`.
- `src/types/xactions.d.ts` — `XActionsOptions`.

## Dev Agent Guardrails

- **KHÔNG xóa** file `src/scrapers/facebook/**` trong 13.10 — chỉ đánh dấu deprecated.
- **KHÔNG đổi tên** MCP tool (`x_facebook_*`) hoặc CLI command (`xactions scrape`/`automate`).
- **KHÔNG** cho phép `dryRun` mặc định `false`; phải giữ `dryRun === false ? false : true`.
- **KHÔNG log** `c_user`, `xs`, account cookie, hoặc token.
- **KHÔNG import** `api/services/facebookAutomation.js` trong code mới; nếu cần tạm dùng legacy cho tool chưa có action, ghi rõ `TODO(13.x)`.
- **KHÔNG** tạo action mới trong `FacebookCrawler` trong story này; dùng action đã có.
- **KHÔNG** thay đổi response shape của `/api/facebook/scrape` và `/api/facebook/automate`.
- **Phải** gọi `crawler.cleanup()` sau mỗi `FacebookCrawler` run để tránh leak Chrome/Playwright process.
- **Phải** truyền `session.accountId` / `session.cookies` đúng cách để `AbstractCrawler.start()` resolve auth.
- **Phải** cập nhật `package.json` `exports` trước khi đánh dấu AC-9 done.

## Migration Checklist / TODO(13.10) Map

Các `TODO(13.10)` hiện có trong baseline cần được xóa hoặc hoàn thành:

1. `src/scrapers/index.js:182` — `marketplace: 'scrapeMarketplace', // TODO(13.10): migrate to FacebookCrawler action 'marketplace'`
   - **Action:** thay `marketplace` mapping để dispatch sang `FacebookCrawler` action `marketplace`.

2. `api/services/facebookScrape.js:54` — `// TODO(13.10): route to FacebookCrawler.start({ action: 'marketplace' })`
   - **Action:** refactor `run()` để gọi `FacebookCrawler.start()` thay vì `scrape()`.

3. `src/mcp/server.js:3152` — `// TODO(13.10): switch to FacebookCrawler.start({ action: 'marketplace' })`
   - **Action:** `x_facebook_marketplace` gọi hybrid với đầy đủ filter.

Các caller surface cần migrate:

| Surface | File | Lines | Migration |
|---|---|---|---|
| Unified `scrape()` | `src/scrapers/index.js` | 42, 104-114, 157-328, 188-196 | Thêm hybrid branch; đổi `platforms.facebook` sang social module hoặc adapter |
| Scrape service | `api/services/facebookScrape.js` | 23-57, 69-114 | Gọi `FacebookCrawler.start()`; fan-out search dùng crawler |
| API route /scrape | `api/routes/facebook.js` | 335-589 | Validation giữ nguyên; scrapeArgs truyền đủ; delegate service |
| API route /automate | `api/routes/facebook.js` | 604-1066 | Các action có trong `FacebookCrawler` route sang hybrid; messenger-share giữ multi-account tạm thời; schedule/warmup/cancel giữ legacy |
| API service automation | `api/services/facebookAutomation.js` | 1-5, 412-1837 | Đánh dấu `@deprecated` hoặc refactor thành thin wrapper gọi `FacebookCrawler` cho các action đã có |
| API account pool | `api/services/facebookAccountPool.js` | 142-267 | `runBatch` hỗ trợ `FacebookCrawler` sessions cho search multi-account; vẫn giữ backward compat cho legacy messenger-share tạm thời |
| API health check | `api/services/facebookHealth.js` | 85-164 | Chuyển sang `FacebookClient` để fetch homepage + extract tokens; loại bỏ `src/scrapers/facebook/graphql.js` |
| MCP automate | `src/mcp/server.js` | 2773-2949 | Map `like/comment/post/messenger` sang hybrid actions |
| MCP Epic 4 | `src/mcp/server.js` | 3002-3204 | `share/join/post_to_groups/friend_requests` sang hybrid |
| MCP scrape | `src/mcp/server.js` | 3214-3258 | `search/post_comments/group_posts/group_comments/posts` sang hybrid |
| MCP marketplace | `src/mcp/server.js` | 3151-3200 | Sang `marketplace` action |
| MCP group members | `src/mcp/server.js` | 3133-3148 | Sang `group_members` |
| CLI scrape | `src/cli/commands/scrape.js` | 17-74 | Mở rộng action/option |
| CLI automate | `src/cli/commands/automate.js` | 18-182 | Mở rộng action/option |
| Package exports | `package.json` | 16-32 | Thêm `./scrapers/social`, `./scrapers/social/facebook` |
| Deprecation doc | `docs/deprecation-plan.md` | 81-127 | Cập nhật status tracker + mapping |
| Legacy barrel | `src/scrapers/facebook/index.js` | 1-64 | Thêm `@deprecated` |
| Legacy automation | `api/services/facebookAutomation.js` | 1-5 | Giữ `@deprecated`, không dùng trong code mới |

## Notes and Caveats

- Architecture spine `xactions-facebook-gateway-2026-08-23/ARCHITECTURE-SPINE.md` có trạng thái `superseded` nhưng vẫn là tài liệu tham khảo hữu ích về `AccountPool`, `AdaptiveGovernor`, sticky proxy, read-vs-write risk profiles. Các quy tắc AD-FB-* vẫn được tôn trọng thông qua `AbstractCrawler` + `FacebookClient`.
- `x_facebook_schedule_post` là DB-only scheduler; không có action `schedule` trong `FacebookCrawler`, nên nó **nằm ngoài phạm vi 13.10** hoặc được xử lý trong story riêng.
- `x_facebook_warmup_scroll` / `x_facebook_warmup_account` / `x_facebook_cancel_friend_requests` chưa có action tương ứng trong `FacebookCrawler`; chúng có thể giữ legacy hoặc được bổ sung ở Epic 20/25.
- `x_facebook_posts` cần resolve URL để chọn `page_posts` hay `group_posts`; nếu URL không chứa `/groups/`, mặc định `page_posts`.
- `marketplace` action hỗ trợ nhiều filter hơn MCP schema hiện tại; cân nhắc bổ sung `categoryId`, `latitude`, `longitude`, `radiusKm` vào `x_facebook_marketplace` input schema nếu consumer cần.
- Multi-account messenger-share hiện tại dùng `runMessengerCampaign` với nhiều browser session; khi chuyển sang `FacebookCrawler`, cần đảm bảo `FacebookActions.messengerShare` hỗ trợ multi-recipient hoặc giữ `runMessengerCampaign` tạm thời.
- Sau khi 13.10 done, Epic 20.1 (Nowing shadow-run) sẽ so sánh output giữa legacy và hybrid để đạt parity ≥ 99% trước khi decommission.

## Dev Agent Record

### Completion Notes (2026-08-28)
- Migrated unified `scrape()` dispatcher (`src/scrapers/index.js`) to route `facebook`/`fb` calls to `FacebookCrawler.start()`.
- Added re-exports for `FacebookCrawler`, `FacebookClient`, `FacebookActions` in `src/scrapers/index.js`.
- Refactored `api/services/facebookScrape.js` to dispatch all Facebook scrape actions via `FacebookCrawler`.
- Refactored `api/services/facebookHealth.js` to eliminate dependency on legacy `src/scrapers/facebook/graphql.js`.
- Enhanced MCP tools (`src/mcp/server.js`) to support extended filters and dryRun preview for `x_facebook_marketplace` and `x_facebook_group_members`.
- Extended CLI commands (`src/cli/commands/scrape.js` and `src/cli/commands/automate.js`) with new actions and options.
- Added package exports for `./scrapers/social` and `./scrapers/social/facebook` in `package.json`.
- Marked `src/scrapers/facebook/index.js` with `@deprecated`.
- Updated `docs/deprecation-plan.md` tracker to mark Facebook Puppeteer as `deprecated-marked`.
- All 17/17 tests in `tests/scrapers/social/facebook/caller-migration.test.js` pass.
- All 790/790 tests across 38 test suites in `tests/scrapers/social/facebook/`, `tests/api/`, `tests/mcp/`, and `tests/services/` pass.

### File List
- `src/scrapers/index.js`
- `api/services/facebookScrape.js`
- `api/services/facebookHealth.js`
- `src/mcp/server.js`
- `src/cli/commands/scrape.js`
- `src/cli/commands/automate.js`
- `package.json`
- `src/scrapers/facebook/index.js`
- `docs/deprecation-plan.md`
- `src/scrapers/social/facebook/client.js`
- `tests/scrapers/social/facebook/caller-migration.test.js`

### Review Findings
- [x] [Review][Patch] Harden buildCookieString & parseFacebookTokens in facebookHealth.js [api/services/facebookHealth.js:15-48]
- [x] [Review][Patch] Harden runSearchAllParallel fallback with Promise.allSettled and safe array defaults [api/services/facebookScrape.js:65-118]
- [x] [Review][Patch] Harden dispatchFacebookHybrid lifecycle & auth check [src/scrapers/index.js:160-230]
- [x] [Review][Patch] Prevent fake guest authCookie in x_facebook_marketplace [src/mcp/server.js:3180-3186]
- [x] [Review][Patch] Extend CLI scrape & automate argument options and validation [src/cli/commands/scrape.js, src/cli/commands/automate.js]
- [x] [Review][Defer] Migrate remaining legacy CLI/MCP calls (warmup/cancel) to hybrid when actions are available [src/cli/commands/automate.js, src/mcp/server.js] — deferred, pre-existing


