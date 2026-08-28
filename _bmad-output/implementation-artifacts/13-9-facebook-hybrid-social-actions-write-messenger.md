---
story_id: '13.9'
epic: 13
story_key: '13-9-facebook-hybrid-social-actions-write-messenger'
status: "done"
phase: "Phase 4"
created: 2026-08-28
updated: 2026-08-28
last_updated: 2026-08-28
owner: "DEV"
reviewed: "validated"
baseline_commit: "a35aaac8"
---

# Story 13.9: Facebook Hybrid Social Actions (Write & Messenger)

Status: done

<!-- Note: Validation completed. Run validate-create-story for final check before dev-story. -->

## Story

As a **Facebook Automation Operator**,  
I want **thực hiện các hành động viết (like, comment, post, share, messenger-share, share_link_uid, join_group, send_friend_request) trên Facebook thông qua kiến trúc hybrid thay vì legacy Puppeteer**,  
So that **các hành động tương tác được quản lý bởi `FacebookClient`, sticky proxy, governor, velocity tracker và error envelope chuẩn, giảm rủi ro checkpoint và tăng khả năng tái sử dụng cho MCP/CLI/API**.

## Scope Note

Story 13.9 triển khai **Facebook social write actions** trong `FacebookCrawler`/`FacebookClient` thay vì các hàm legacy `src/scrapers/facebook/` (Puppeteer-only). Các action này là **write/mutating** nên bắt buộc `requiresAuth: true`, `dryRun` mặc định `true`, và phải tuân thủ rate limit / delay floor của Epic 6 (FR-53, NFR-5, NFR-6, NFR-8, NFR-10).

Vì Facebook write mutations chủ yếu là **browser-facing DOM hoặc GraphQL mutation bảo mật cao, dễ xoay doc_id**, phương án mặc định sử dụng `FacebookBrowserBridge` (CDP/Playwright) cho các thao tác DOM (như `like`, `comment`, `post`, `join_group`, `send_friend_request`, `messenger_share`), kết hợp `FacebookClient.requestGraphQl()` cho các mutation endpoint đã biết khi capture được doc_id hợp lệ. Tất cả write actions phải đi qua `runGuardedActionBatch`-style bounded batch với delay jitter và **per-item governor check**.

Scope cụ thể:

- **Trong phạm vi 13.9:** đăng ký action, định nghĩa input/output, dry-run gate, delay/velocity guard, fallback an toàn, gắn `@deprecated` cho legacy files liên quan.
- **Không trong phạm vi:** chuyển hướng toàn bộ MCP/CLI/API caller sang hybrid — thuộc Story 13.10 (Integration & Caller Migration). Tuy nhiên 13.9 **có thể** thêm `TODO(13.10)` notes tại caller surfaces.
- **Đặc biệt `messenger_share`:** ưu tiên thực thi theo thứ tự — **primary = direct Messenger URL (`https://www.facebook.com/messages/t/{uid}`)**, **secondary = share dialog recipient avatar** (`messengerShare.js` pattern), **tertiary = GraphQL CTA mutation** (`MWChatBusinessCTAAdsSenderMutation`-style). Direct Messenger URL đáng tin cậy nhất do không phụ thuộc doc_id và không yêu cầu business/ad permission.
- **Đặc biệt `share_link_uid`:** không triển khai như action độc lập; **merge vào `messenger_share`**. `share_link_uid` chỉ là alias handler gọi `messengerShare` với `recipientUids` là mảng một phần tử. Nếu caller truyền `recipientUid` (string), `FacebookCrawler` tự chuyển thành `recipientUids: [recipientUid]`.
- **Delay floor theo action (ràng buộc cứng, override giá trị cũ trong story nếu mâu thuẫn):**
  - `like`: **1–3s**
  - `comment`: **3–7s** (timeline/profile); **5–15s** (group)
  - `post` (profile/timeline): **3–7s**
  - `post` (group): **30–90s**
  - `share`: **5–15s**
  - `messenger_share` / `share_link_uid`: **5–15s**
  - `join_group`: **30–90s** (per group)
  - `send_friend_request`: **60–180s**

## Sources

- `_bmad-output/planning-artifacts/epics.md` — Epic 13, Story 13.9 [dòng 607-619]
- `_bmad-output/planning-artifacts/prd-facebook-epics-5-6-2026-08-21.md` — FR-23..FR-27 (Messenger Port), FR-32..FR-34 (Share-Link-UID v2), FR-53 (Velocity Limits), NFR-5..NFR-10 [dòng 68-107, 162-185]
- `_bmad-output/planning-artifacts/facebook-messenger-port-plan.md` — P1..P10 port plan, REUSE-FIRST, `runGuardedBatch`, selectors UNVERIFIED, `MWChatBusinessCTAAdsSenderMutation` doc_id [dòng 1-109]
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` — AD-1 (Tiered Signer), AD-2 (AbstractCrawler/ActionRegistry), AD-3 (Proxy Strategy/Action-Level Auth), AD-4 (Namespaced Storage), AD-9 (Anti-Bot Validation), AD-11 (CrawlerCommand), AD-13 (Adaptive Governor), AD-14 (Error Envelope), AD-18 (Metadata Schema)
- `_bmad-output/implementation-artifacts/13-3-refactor-facebook-scraper-to-hybrid-architecture.md` — `FacebookClient`, `FacebookCrawler`, `DEFAULT_FB_DOC_IDS`, token cache
- `_bmad-output/implementation-artifacts/13-4-facebook-browser-as-signer-bridge.md` — `FacebookBrowserBridge`, Playwright default, token extraction
- `_bmad-output/implementation-artifacts/13-5-facebook-hybrid-profile-followers-group-members.md` — `resolveTargetKey`, `resolveGroupId`, `saveCheckpoint`, `requiresAuth` derivation
- `_bmad-output/implementation-artifacts/13-7-facebook-hybrid-post-group-comments.md` — input validation `XACT_4001`, PII stripping, `after`/pagination patterns, review patches
- `_bmad-output/implementation-artifacts/13-8-facebook-hybrid-marketplace.md` — `DEFAULT_FB_DOC_IDS` placeholder strategy, `requiresAuth: false` public action pattern, guest/auth token ring partition, action-level auth resolution, residential proxy requirement
- `_bmad-output/validation-reports/13-9-story-validation-report.md` — critical/enhancement/optimization fixes applied
- `src/scrapers/social/facebook/crawler.js` — `FacebookCrawler` constructor, `DEFAULT_FB_DOC_IDS` [dòng 200-222], `registerAction` pattern [dòng 305-423], `resolveTargetKey` [dòng 104-158], `resolveGroupId` [dòng 167-195], `#normalizePostItem` [dòng 432-496], `marketplace()` handler pattern [dòng 1600-1700]
- `src/scrapers/social/facebook/client.js` — `requestGraphQl()` [dòng 485-545], `buildGraphQlBody()` [dòng 431-476], `ensureTokens()` / token cache [dòng 212-421], auth/guest token ring partition [dòng 448-451]
- `src/scrapers/social/facebook/signer-bridge.js` — `extractFacebookTokensScript` [dòng 47-121], `#resolveProxy` [dòng 464-497], public API [dòng 569-]
- `src/scrapers/social/facebook/index.js` — exports [dòng 1-30]
- `src/scrapers/facebook/messengerShare.js` — `shareToMessenger`, `sendMessageToThread`, SELECTORS, verified share dialog flow [dòng 57-450]
- `src/scrapers/facebook/shareLinkByUid.js` — `shareLinkByUid`, `shareLinkByUidCampaign`, direct `messages/t/{uid}` approach [dòng 1-237]
- `src/scrapers/facebook/graphqlSend.js` — server-side `sendMessageToUidServerSide`, `MWChatBusinessCTAAdsSenderMutation` form data [dòng 1-155]
- `src/scrapers/facebook/messengerQueue.js` — `buildCampaignQueue`, `parseRecipientsFile`, `parseLinksFile` [dòng 1-179]
- `src/scrapers/facebook/graphql.js` — `MESSENGER_CTA_DOC_ID = '29460155383630960'` [dòng 47], `checkMessengerCTA` [dòng 353-438], `sendMessageToUid` [dòng 461-545]
- `src/scrapers/facebook/index.js` — legacy re-exports, `// LEGACY — see docs/deprecation-plan.md` pattern [dòng 1-64]
- `src/scrapers/facebook/limits.js` — `LIMITS`, `getActionLimit`, `enforceDelay` [dòng 67-79, 161-172, 189-195]
- `api/services/facebookAutomation.js` — `runGuardedBatch` legacy pattern, `likeFacebookPosts`, `commentOnFacebookPosts`, `createFacebookPost`, `shareFacebookPosts`, `ACCOUNT_RISK_WARNING`, delay validation [dòng 43-500, 1225, 1472-1548, 1603-1609, 1654]
- `src/mcp/server.js` — `x_facebook_automate` (like/comment/post/messenger), `x_facebook_share_posts`, `x_facebook_join_groups`, `x_facebook_send_friend_requests`, `x_facebook_post_to_groups` tool definitions [dòng 1386-1540, 2772-2870, 3230-3236]
- `src/core/base-crawler.js` — `start()` action auth resolution, account pool resolution, governor, jitter [dòng 151-251]
- `src/core/base-client.js` — `AbstractApiClient`, `resolveProxy` with `requiresResidential` [dòng 184-232, 506-522, 612-619]
- `src/core/adaptive-governor.js` — `recordRequest()` / `canAccountRequest()` [dòng 202-242]
- `src/core/types.js` — `PostItem`, `ProfileItem`, `ActionDescriptor`, `CrawlerCommand` [dòng 9-102]
- `docs/deprecation-plan.md` — Legacy-to-Hybrid mapping, status tracker, Phase 1 marker instructions [dòng 1-155]

## Cross-Epic Dependencies

- Depends on Story 13.1 (`AbstractCrawler`, `AbstractApiClient`, `PreSignedTokenRing`, `SignerWorkerPagePool`, `AdaptiveRateGovernor`)
- Depends on Story 13.3 (`FacebookClient`, `FacebookCrawler`, `DEFAULT_FB_DOC_IDS`, `PrismaStore`)
- Depends on Story 13.4 (`FacebookBrowserBridge`, CDP attach/launch, token extraction, Playwright default)
- Depends on Story 13.5 (`resolveTargetKey`, `resolveGroupId`, `saveCheckpoint`, `requiresAuth` action-level resolution)
- Depends on Story 13.6 (`search()` action registration, `DEFAULT_FB_DOC_IDS` placeholder strategy, `normalizeSearchResult` patterns)
- Depends on Story 13.7 (input validation `XACT_4001`, PII stripping, `limit` clamp, `dryRun` pattern)
- Depends on Story 13.8 (guest vs auth token ring partition, action-level `requiresAuth`, residential proxy requirement)
- Depends on Epic 6 (FR-53 velocity limits, NFR-5 delay floor, NFR-6 dry-run default, NFR-8 messenger delay, NFR-10 friend request delay)
- Unlocks Story 13.10 (Facebook Hybrid Integration & Caller Migration) — MCP/CLI/API caller chuyển sang `FacebookCrawler.start()`

## Baseline

- `baseline_commit: a35aaac8` — Story 13.2.1 artifact created; 13.8 done, 13.7 done.
- `FacebookCrawler` đã có các action `group_posts`, `page_posts`, `get_comments`, `post_comments`, `group_comments`, `profile`, `followers`, `following`, `group_members`, `search`, `group_search`, `marketplace` tại `src/scrapers/social/facebook/crawler.js`.
- `FacebookClient.requestGraphQl` / `buildGraphQlBody` đã sẵn sàng với auth/guest token ring partition, sticky proxy, residential proxy requirement. Tuy nhiên body chưa đầy đủ các trường anti-bot (`__dyn`, `__csr`, `__hs`, `x_fb_lsd`) và chưa hỗ trợ multi-`doc_id` fallback/rotation.
- `FacebookBrowserBridge` (Playwright default, Puppeteer fallback) đã triển khai token extraction; DOM evaluate cho write actions chưa được sử dụng (13.8 chuyển SSR fallback thay vì DOM evaluate). Cần thêm public `withPage`/`evaluateDom` seam.
- Legacy write modules còn nguyên vẹn trong `src/scrapers/facebook/`:
  - `messengerShare.js` — share post qua Messenger dialog
  - `shareLinkByUid.js` — share link trực tiếp qua `messages/t/{uid}`
  - `graphqlSend.js` — server-side `sendMessageToUidServerSide`
  - `messengerQueue.js` — parse recipients/links/content
  - `graphql.js` — `MESSENGER_CTA_DOC_ID`, `checkMessengerCTA`, `sendMessageToUid`
  - `api/services/facebookAutomation.js` — `runGuardedBatch`, `likeFacebookPosts`, `commentOnFacebookPosts`, `createFacebookPost`, `shareFacebookPosts`
- `docs/deprecation-plan.md` chưa có mapping cho các hàm write legacy → hybrid actions; cần cập nhật.
- MCP tools `x_facebook_automate`, `x_facebook_share_posts`, `x_facebook_join_groups`, `x_facebook_send_friend_requests`, `x_facebook_post_to_groups` hiện vẫn gọi legacy automation service.

## Acceptance Criteria

### AC-1: Đăng ký các action write trong `FacebookCrawler`

- **Given** `FacebookCrawler` trong `src/scrapers/social/facebook/crawler.js`
- **When** khởi tạo
- **Then** đăng ký thêm các action trong constructor:

| action | requiredArgs | optionalArgs | outputType | requiresAuth | delay floor | velocity |
|---|---|---|---|---|---|---|
| `like` | `postUrl` | `dryRun`, `delayMin`, `delayMax`, `maxBatch` | `{ results: { postUrl, liked, alreadyLiked, error? }[], dryRun: boolean }` | `true` | 1–3s | ≤30/hr |
| `comment` | `postUrl`, `text` | `dryRun`, `delayMin`, `delayMax`, `maxBatch` | `{ results: { postUrl, commentId?, error? }[], dryRun: boolean }` | `true` | 3–7s (timeline) / 5–15s (group) | ≤10/hr |
| `post` | `text` | `mediaUrls`, `groupUrls`, `groupIds`, `dryRun`, `delayMin`, `delayMax`, `maxBatch` | `{ results: { targetUrl, postId?, error? }[], dryRun: boolean }` | `true` | 3–7s (profile) / 30–90s (group) | ≤5/hr |
| `share` | `postUrl` | `dryRun`, `delayMin`, `delayMax`, `maxBatch`, `message` | `{ results: { postUrl, shared, error? }[], dryRun: boolean }` | `true` | 5–15s | conservative |
| `messenger_share` | `postUrl` | `recipientUids`, `recipientNames`, `message`, `dryRun`, `delayMin`, `delayMax`, `maxBatch` | `{ results: { recipientUid, ok, method?, error? }[], dryRun: boolean }` | `true` | 5–15s | conservative (NFR-8) |
| `share_link_uid` | `postUrl`, `recipientUid` | `message`, `dryRun`, `delayMin`, `delayMax` | `{ ok, postUrl, recipientUid, method?, error? }` | `true` | 5–15s (alias) | alias of `messenger_share` |
| `join_group` | `groupUrls` hoặc `groupIds` | `keyword`, `limit`, `dryRun`, `delayMin`, `delayMax`, `maxBatch` | `{ results: { groupUrl, joined, error? }[], dryRun: boolean }` | `true` | 30–90s | conservative |
| `send_friend_request` | `targets` | `mode`, `location`, `limit`, `dryRun`, `delayMin`, `delayMax`, `maxBatch` | `{ results: { target, ok, error? }[], dryRun: boolean }` | `true` | 60–180s | ≤20/day |

- **And** tất cả action trên khai báo `requiresAuth: true` (override cấp platform `FacebookCrawler.requiresAuth = true`)
- **And** `listActions()` trả về đầy đủ action với `requiredArgs`, `optionalArgs`, `example`, `outputType`, `requiresAuth`
- **And** `postUrls` / `groupUrls` / `groupIds` / `recipientUids` chấp nhận `string` hoặc `string[]` để batch

### AC-2: `FacebookActions` / `batch-runner.js` / `FacebookActionVelocityTracker`

- **Given** `src/scrapers/social/facebook/` cần thêm logic write
- **When** triển khai
- **Then** tạo các module sau:
  - `src/scrapers/social/facebook/actions.js` — chứa `FacebookActions` class với các phương thức `like`, `comment`, `post`, `share`, `messengerShare`, `joinGroup`, `sendFriendRequest`
  - `src/scrapers/social/facebook/batch-runner.js` — chứa `runGuardedActionBatch`, `enforceActionDelay`, `getActionLimit`
  - `src/scrapers/social/facebook/velocity-tracker.js` (hoặc nằm trong `batch-runner.js`) — `FacebookActionVelocityTracker` với sliding window 1h/24h
- **And** mỗi phương thức:
  - Nhận `args` và `session` (có `accountId`, `cookies`, `cdpUrl` tùy chọn)
  - Resolve account từ `AccountPool` nếu thiếu
  - Gắn **sticky residential proxy** theo `accountId` suốt session
  - Đảm bảo `dryRun: true` mặc định (`args.dryRun !== false`)
  - Không log cookie/token
  - Trả về `PlatformError` chuẩn với `suggestedAction` khi lỗi
- **And** **KHÔNG** import từ `api/services/facebookAutomation.js`; chỉ "copy pattern" logic `runGuardedBatch` cũ vào `runGuardedActionBatch` mới, dùng `PlatformError` và gọi `governor`/`FacebookActionVelocityTracker`

### AC-3: Like action

- **Given** `postUrl` là URL bài viết Facebook hợp lệ
- **When** gọi `crawler.start({ action: 'like', args: { postUrl, dryRun: false }, session })`
- **Then** `FacebookCrawler.like(args, session)`:
  1. Validate `postUrl` bằng `assertFacebookUrlLocal` / `resolveTargetKey` / `resolvePostFeedbackContext` style, reject nếu không phải `facebook.com` URL → `XACT_4001`
  2. Gọi `FacebookBrowserBridge.withPage()` hoặc `FacebookClient.withPage()` để lấy page + sticky residential proxy
  3. `FacebookBrowserBridge` navigate đến `postUrl` với anti-leak browser args
  4. Tìm Like button theo locale-aware selectors (`[aria-label*="Like"]`, `[aria-label*="Thích"]`, `[aria-label*="Bỏ thích"]`)
  5. Nếu đã like → trả `{ alreadyLiked: true, liked: false }`; nếu chưa → click với human-like delay 1–3s
  6. Verify bằng Unlike button xuất hiện
  7. Trả `{ postUrl, liked: true, alreadyLiked: false }` (hoặc `dryRun: true` preview)
- **And** nếu GraphQL `like` mutation doc_id đã capture, dùng `requestGraphQl` làm **optional path**, DOM làm primary
- **And** tuân thủ velocity limit `likes ≤ 30/hr` theo FR-53

### AC-4: Comment action

- **Given** `postUrl` và `text`
- **When** gọi `crawler.start({ action: 'comment', args: { postUrl, text }, session })`
- **Then** `FacebookCrawler.comment(args, session)`:
  1. Validate `postUrl` và `text` (non-empty, `text.length ≤ 8000`)
  2. Dùng `withPage` navigate đến `postUrl`, tìm comment input (`[role="textbox"][contenteditable="true"]`, aria-label chứa "Viết..." / "Write...")
  3. Type `text` với human-like typing delay (tham khảo `typeMessage` trong `messengerShare.js`)
  4. Nếu `dryRun: true` → preview text và dừng
  5. Nếu `dryRun: false` → gửi comment (Enter hoặc nút gửi), chờ phản hồi, trả `commentId` nếu parse được
  6. Strip PII từ `text` trước khi lưu/log (NFR-11); text gốc vẫn được gửi lên Facebook
- **And** tuân thủ `comments ≤ 10/hr` theo FR-53

### AC-5: Post action

- **Given** `text` và tùy chọn `mediaUrls`, `groupUrls`/`groupIds`
- **When** gọi `crawler.start({ action: 'post', args: { text, groupUrls: ['https://www.facebook.com/groups/xxx'] }, session })`
- **Then** `FacebookCrawler.post(args, session)`:
  1. Validate `text` non-empty, `mediaUrls` là array URL hợp lệ (nhưng **chỉ validate, chưa upload** — `mediaUrls` reserved trong MVP, xem EN-3), `groupUrls` chứa `/groups/`
  2. Với mỗi target (profile timeline hoặc group), navigate đến composer URL
  3. Mở composer (`[role="button"][aria-label*="Tạo bài viết"]` / `"Create post"`)
  4. Nhập `text` và attachment (nếu có) qua `FacebookBrowserBridge`
  5. `dryRun: true` → preview, không submit
  6. `dryRun: false` → submit, trả `postId` hoặc `postUrl` nếu parse được
  7. Delay floor **3–7s (profile) / 30–90s (group)**, max batch 10 group posts (20 với `force: true`) theo NFR-6 / Cluster-1

### AC-6: Share action (chia sẻ lên timeline)

- **Given** `postUrl`
- **When** gọi `crawler.start({ action: 'share', args: { postUrl, message }, session })`
- **Then** `FacebookCrawler.share(args, session)`:
  1. Validate `postUrl` là Facebook URL
  2. Mở share dialog (`[data-ad-rendering-role="share_button"]` hoặc tương đương)
  3. Chọn "Share to a friend's profile" hoặc "Chia sẻ lên trang cá nhân" (tham khảo `shareLinkByUid.js` fallback)
  4. `dryRun: true` → preview; `dryRun: false` → click share, verify
  5. Trả `{ postUrl, shared: true, method: 'share-dialog-timeline' }`

### AC-7: Messenger share & `share_link_uid`

- **Given** `postUrl` và danh sách `recipientUids` / `recipientNames` (hoặc `recipientUid` cho alias)
- **When** gọi `crawler.start({ action: 'messenger_share', args: { postUrl, recipientUids, message }, session })`
- **Then** `FacebookCrawler.messengerShare(args, session)` hỗ trợ **ba phương thức theo ưu tiên giảm dần**:
  1. **Primary: direct Messenger URL** — navigate `https://www.facebook.com/messages/t/{recipientUid}` với `withPage`, paste `postUrl` (và `message` nếu có) vào compose box, press Enter / click send button (`shareLinkByUid.js` pattern)
  2. **Secondary: share dialog recipient avatar** — mở share dialog trên bài viết, chọn recipient avatar có aria-label chứa `via Messenger` / `qua Messenger` (`messengerShare.js` pattern)
  3. **Tertiary: GraphQL CTA mutation** — nếu capture được doc_id hợp lệ, dùng `FacebookClient.requestGraphQl(..., { fallbackDocIds: [...] })` với `MWChatBusinessCTAAdsSenderMutation`-style variables; nếu fail thì fallback về path 1/2 thay vì throw panic
- **And** `share_link_uid` là alias của `messenger_share` khi chỉ có 1 `recipientUid`; handler gọi `messengerShare({ ...args, recipientUids: [recipientUid] })`
- **And** delay floor 5–15s giữa các recipient (NFR-8)
- **And** message compose strip emoji nếu cấu hình (tái dùng `stripEmojiSurrogates`, `pickRandomSegment` từ `messengerShare.js:104-126`)
- **And** kết quả mỗi recipient `{ recipientUid, ok, method, error? }`
- **And** mọi request write / bridge sử dụng `requiresResidential: true`

### AC-8: Join group action

- **Given** `groupUrls` hoặc `groupIds` hoặc `keyword`
- **When** gọi `crawler.start({ action: 'join_group', args: { groupUrls, keyword, limit }, session })`
- **Then** `FacebookCrawler.joinGroup(args, session)`:
  1. Resolve từng group URL thành `groupId` qua `resolveGroupId`, reject non-group URL → `XACT_4001`
  2. Navigate đến group page hoặc `facebook.com/groups/{groupId}`
  3. Tìm nút "Join Group" / "Tham gia nhóm" theo locale-aware selector
  4. `dryRun: true` → preview; `dryRun: false` → click, verify trạng thái pending/member
  5. Delay **30–90s** giữa các group theo PRD Cluster-1, max batch 20

### AC-9: Send friend request action

- **Given** `targets` (array URL/UID) hoặc `mode: 'suggestions' | 'location'`
- **When** gọi `crawler.start({ action: 'send_friend_request', args: { targets, limit }, session })`
- **Then** `FacebookCrawler.sendFriendRequest(args, session)`:
  1. Validate target là Facebook profile URL hoặc numeric UID
  2. Navigate đến profile, tìm nút "Add Friend" / "Thêm bạn bè"
  3. `dryRun: true` → preview; `dryRun: false` → click, verify
  4. Delay **60–180s** giữa các request (NFR-10), `limit ≤ 20/day`
  5. Trả `{ results: { target, ok, error? }[], dryRun: boolean }`

### AC-10: Dry-run gate, delay floor, governor và velocity tracker

- **Given** bất kỳ write action
- **When** gọi `crawler.start(...)`
- **Then** `dryRun` mặc định `true` (NFR-6); muốn thực thi phải truyền `dryRun: false` rõ ràng
- **And** cookie/token không bị log
- **And** `runGuardedActionBatch` gọi `governor.canAccountRequest(accountId, 'facebook')` / `governor.recordRequest(accountId, 'facebook')` **trước/sau mỗi item** (per-item governor check)
- **And** `FacebookActionVelocityTracker` theo dõi per-action per-account với sliding window 1h/24h:
  - `like`: ≤ 30/hr
  - `comment`: ≤ 10/hr
  - `post`: ≤ 5/hr (theo NFR-9 scheduler cap)
  - `share`: conservative
  - `messenger_share`: conservative hơn default like/comment (NFR-8)
  - `send_friend_request`: ≤ 20/day, 60–180s delay
  - `join_group`: conservative, min delay 30–90s
- **And** nếu thiếu account từ `AccountPool` → `XACT_4010` với `suggestedAction: 'relogin'`
- **And** action `requiresAuth: true` bắt buộc account + sticky residential proxy (AD-3 rule 3b)
- **And** mọi request GraphQL / bridge cho write action truyền `requiresResidential: true`

### AC-11: Error envelope và fallback

- **Given** bất kỳ write action gặp lỗi
- **When** thực thi
- **Then** trả về `PlatformError` với `code`, `type`, `message`, `retryAfter`, `suggestedAction` (AD-14)
- **And** phân loại lỗi theo convention hiện tại:
  - Challenge/Captcha/Login wall → `XACT_4010` / `suggestedAction: 'hibernate_account'`
  - Upstream rate limit 429 / GraphQL code 368 → `XACT_4290` / `suggestedAction: 'rotate_proxy'` (hoặc `rotate_account` nếu proxy pool cạn)
  - Account hibernation / governor hibernation → `XACT_4291` / `suggestedAction: 'rotate_account'`
  - Proxy hết → `XACT_5030` / `suggestedAction: 'wait'`
  - Invalid args → `XACT_4001` / `suggestedAction: 'use_x_actions_list'`
- **And** KHÔNG throw panic khi doc_id rotated hoặc DOM selector thất bại; ghi `note` và thử fallback path / doc_id tiếp theo

### AC-12: Deprecation markers

- **Given** legacy modules trong `src/scrapers/facebook/`
- **When** triển khai Story 13.9
- **Then** gắn JSDoc `@deprecated` và comment `// LEGACY — see docs/deprecation-plan.md` cho:
  - `src/scrapers/facebook/messengerShare.js` (replaced by `facebook:messenger_share`)
  - `src/scrapers/facebook/shareLinkByUid.js` (replaced by `facebook:messenger_share`)
  - `src/scrapers/facebook/graphqlSend.js` (replaced by `FacebookClient.requestGraphQl` / `facebook:messenger_share`)
  - `src/scrapers/facebook/messengerQueue.js` (replaced by batch handling trong `FacebookCrawler`)
- **And** KHÔNG import từ `api/services/facebookAutomation.js`; file này đã được đánh dấu `deprecated-marked` trong `docs/deprecation-plan.md` Phase 1. Chỉ "copy pattern" sang `batch-runner.js`/`actions.js`.
- **And** cập nhật `docs/deprecation-plan.md`:
  - Thêm vào bảng `Legacy Facebook Functions → Hybrid Actions`:
    - `shareToMessenger` / `messengerShareCampaign` → `facebook:messenger_share`
    - `shareLinkByUid` / `shareLinkByUidCampaign` → `facebook:messenger_share`
    - `sendMessageToUidServerSide` / `sendMessageToUid` → `facebook:messenger_share`
    - `buildCampaignQueue` / `parseRecipientsFile` / `parseLinksFile` → `facebook:messenger_share`
    - `likeFacebookPosts` → `facebook:like`
    - `commentOnFacebookPosts` → `facebook:comment`
    - `createFacebookPost` → `facebook:post`
    - `shareFacebookPosts` → `facebook:share`
    - `joinGroups` → `facebook:join_group`
    - `sendFriendRequests` → `facebook:send_friend_request`
  - Cập nhật status tracker: "Facebook Legacy Social Actions" sang `deprecated-marked`

### AC-13: Test coverage

- **Given** repo có Vitest
- **When** triển khai
- **Then** tạo `tests/scrapers/social/facebook/crawler-social-actions.test.js` với real `node:http` server
- **And** cover:
  - `[AC-1]` action registration với đúng `requiresAuth: true` và `dryRun` default
  - `[AC-2]` `FacebookActions` / `batch-runner.js` / `FacebookActionVelocityTracker` load
  - `[AC-3]` `like` input validation, `XACT_4001` cho non-Facebook URL, dry-run preview
  - `[AC-4]` `comment` text validation, PII strip, dry-run
  - `[AC-5]` `post` group URL validation, max batch clamp, dry-run, `mediaUrls` reserved
  - `[AC-6]` `share` postUrl validation, dry-run
  - `[AC-7]` `messenger_share` recipient list validation, direct-URL primary, GraphQL fallback với multi-`doc_id`
  - `[AC-8]` `join_group` non-group URL rejection, delay 30–90s
  - `[AC-9]` `send_friend_request` limit ≤ 20, delay floor 60–180s
  - `[AC-10]` no account → `XACT_4010`, per-item governor, `FacebookActionVelocityTracker` sliding window
  - `[AC-11]` error envelope shape, `XACT_4290` upstream rate limit, `XACT_4291` hibernation
  - `[AC-12]` `@deprecated` JSDoc tồn tại trong legacy files
  - `[AC-14..AC-19]` velocity tracker, per-item governor, no-legacy-import, bridge public seam, GraphQL anti-bot fields, multi-doc_id fallback, `resolvePostFeedbackContext`
- **And** chạy `npx vitest run tests/scrapers/social/facebook/` và `npx tsc --noEmit` pass

### AC-14: `FacebookActionVelocityTracker` / per-action sliding window

- **Given** write action batch với nhiều item
- **When** thực thi
- **Then** `FacebookActionVelocityTracker` (hoặc mở rộng `AdaptiveRateGovernor`) ghi nhận mỗi `recordAction(accountId, action)` với sliding window **1h và 24h**
- **And** `canDoAction(accountId, action)` kiểm tra trước khi thực thi item; nếu vượt ngưỡng → `XACT_4291` / `suggestedAction: 'rotate_account'`
- **And** tracker hỗ trợ các action `like`, `comment`, `post`, `share`, `messenger_share`, `join_group`, `send_friend_request`

### AC-15: Per-item governor check

- **Given** bất kỳ write action batch
- **When** lặp qua từng item
- **Then** gọi `governor.canAccountRequest(accountId, 'facebook')` trước mỗi item
- **And** gọi `governor.recordRequest(accountId, 'facebook')` sau mỗi item (thành công hoặc lỗi không phải validation)
- **And** nếu governor từ chối → `XACT_4291` / `suggestedAction: 'rotate_account'`, dừng batch

### AC-16: Không import từ `api/services/facebookAutomation.js`

- **Given** `batch-runner.js` / `actions.js` cần logic `runGuardedBatch`-style
- **When** triển khai
- **Then** **KHÔNG** dùng `import { runGuardedBatch } from '../../../api/services/facebookAutomation.js'` hay tương tự
- **And** chỉ "copy pattern" từ legacy `runGuardedBatch` (delay clamp, `ACCOUNT_RISK_WARNING`, progress callback) và viết lại bằng `PlatformError`, `governor`, `FacebookActionVelocityTracker`

### AC-17: `FacebookBrowserBridge` public `withPage` / `evaluateDom` seam

- **Given** `FacebookActions` cần evaluate DOM cho like/comment/post/share/join/friend
- **When** triển khai
- **Then** mở rộng `FacebookBrowserBridge` với public method `withPage(fn, options)` hoặc `evaluateDom(fn, options)`
- **And** `FacebookClient` cung cấp `ensureBrowserBridge()` public để `FacebookActions` lấy bridge mà không truy cập private fields
- **And** `withPage` tái sử dụng 1 page trong suốt batch (OP-1), set cookies, chạy `fn(page)`, cuối cùng đóng page

### AC-18: `FacebookClient.buildGraphQlBody` anti-bot fields, `friendlyNames`, multi-doc_id fallback

- **Given** write mutation qua GraphQL
- **When** triển khai
- **Then** mở rộng `extractFacebookTokensScript` / `#fetchTokens` để parse thêm `__dyn`, `__csr`, `__hs`, `__hsdp`, `__hblp`, `__s`, `dpr`, `x_fb_lsd`, `fb_api_req_friendly_name` (với fallback rỗng)
- **And** `FacebookClient.buildGraphQlBody` bao gồm các trường anti-bot trên khi khả dụng
- **And** thêm `friendlyNames` map cho write mutations: `LIKE_MUTATION`, `COMMENT_MUTATION`, `POST_MUTATION`, `SHARE_MUTATION`, `MESSENGER_SHARE_MUTATION`, `JOIN_GROUP_MUTATION`, `SEND_FRIEND_REQUEST_MUTATION`
- **And** `requestGraphQl` hỗ trợ `fallbackDocIds: string[]` để thử doc_id tiếp theo khi nhận `XACT_5000` / malformed response
- **And** mọi write request gọi `client.requestGraphQl(..., { requiresResidential: true })`

### AC-19: `resolvePostFeedbackContext` public/utility

- **Given** `FacebookCrawler.#resolvePostFeedbackContext` private hiện tại
- **When** triển khai
- **Then** chuyển `resolvePostFeedbackContext` thành public method của `FacebookCrawler` hoặc tách vào `src/scrapers/social/facebook/resolve-post-feedback.js`
- **And** `FacebookActions.like` / `FacebookActions.comment` / `FacebookActions.share` tái dùng hàm này để lấy `feedback_id` / `story_id` nếu cần GraphQL path

## Tasks / Subtasks

1. [x] **Tạo `src/scrapers/social/facebook/actions.js`**
   - [x] Định nghĩa `FacebookActions` class với các phương thức: `like`, `comment`, `post`, `share`, `messengerShare`, `joinGroup`, `sendFriendRequest`
   - [x] Tiêm `client`, `browserBridge`, `governor`, `accountPool`, `proxyPool`, `actionVelocityTracker`, `runGuardedActionBatch` từ constructor hoặc `crawler` instance
   - [x] Đảm bảo `dryRun` mặc định `true` (`args.dryRun !== false`), không log cookie/token
   - [x] Xử lý `share_link_uid` như alias gọi `messengerShare` với `recipientUids: [recipientUid]`

2. [x] **Tạo `src/scrapers/social/facebook/batch-runner.js`**
   - [x] Viết `runGuardedActionBatch(items, options, fn)` — copy pattern từ `api/services/facebookAutomation.js` nhưng **KHÔNG import** file đó
   - [x] Dùng `PlatformError`, gọi `governor` per-item, gọi `FacebookActionVelocityTracker` per-action
   - [x] Hỗ trợ `delayMin`/`delayMax` clamp theo action, `maxBatch` clamp, `progressCallback`
   - [x] Trả `ACCOUNT_RISK_WARNING` khi vượt velocity

3. [x] **Tạo `src/scrapers/social/facebook/velocity-tracker.js` (hoặc trong `batch-runner.js`)**
   - [x] Định nghĩa `FacebookActionVelocityTracker` với sliding window 1h/24h
   - [x] `recordAction(accountId, action)` / `canDoAction(accountId, action)`
   - [x] `getActionLimit(action)` trả về `{ perHour?, perDay?, delayMin, delayMax }`

4. [x] **Mở rộng `DEFAULT_FB_DOC_IDS` cho write mutations (placeholder)**
   - [x] Thêm placeholders: `LIKE_MUTATION`, `COMMENT_MUTATION`, `POST_MUTATION`, `SHARE_MUTATION`, `MESSENGER_SHARE_MUTATION`, `JOIN_GROUP_MUTATION`, `SEND_FRIEND_REQUEST_MUTATION`
   - [x] Để `null` / `fb_xxx_doc` cho đến khi capture từ live session
   - [x] Thêm `friendlyNames` map tương ứng

5. [x] **Đăng ký action trong `FacebookCrawler` constructor**
   - [x] `like`, `comment`, `post`, `share`, `messenger_share`, `share_link_uid` (alias), `join_group`, `send_friend_request`
   - [x] Khai báo `requiresAuth: true`, `requiredArgs`, `optionalArgs`, `example`, `outputType`
   - [x] Handler gọi `this.actions.<method>(args, session)`

6. [x] **Implement `like` / `comment` / `post` / `share` handlers**
   - [x] Sử dụng `FacebookBrowserBridge.withPage` navigate + DOM evaluate
   - [x] Locale-aware selectors (en/vi), fallback chain
   - [x] Human-like click/type/scroll delays
   - [x] Verify kết quả sau khi thực hiện
   - [x] `dryRun: true` chỉ trả về preview, không tương tác DOM
   - [x] `post` group delay 30–90s, `mediaUrls` reserved

7. [x] **Implement `messenger_share` / `share_link_uid` handlers**
   - [x] Path 1 (primary): `messages/t/{uid}` + clipboard paste (`shareLinkByUid.js` pattern)
   - [x] Path 2 (secondary): share dialog + recipient avatar click (`messengerShare.js` pattern)
   - [x] Path 3 (tertiary): `FacebookClient.requestGraphQl(..., { fallbackDocIds })` với mutation doc_id nếu capture
   - [x] Tái dùng `stripEmojiSurrogates`, `pickRandomSegment`, `composeMessage` từ `messengerShare.js:96-146`

8. [x] **Implement `join_group` / `send_friend_request` handlers**
   - [x] `joinGroup`: resolve group ID, validate `/groups/`, DOM click "Join", delay 30–90s
   - [x] `sendFriendRequest`: validate target URL/UID, DOM click "Add Friend", delay 60–180s, limit ≤ 20/day

9. [x] **Tích hợp `AdaptiveRateGovernor`, `FacebookActionVelocityTracker`, per-item check**
   - [x] Gọi `governor.canAccountRequest(accountId, 'facebook')` trước mỗi item
   - [x] Gọi `governor.recordRequest(accountId, 'facebook')` sau mỗi item
   - [x] `FacebookActionVelocityTracker` sliding window 1h/24h cho từng action
   - [x] Hibernation / rotate account trên challenge/rate-limit

10. [x] **Input validation & SSRF guard**
    - [x] Validate URL là `facebook.com`, `pathname` hợp lệ
    - [x] Reject path traversal, non-Facebook domain, empty text
    - [x] Clamp `limit`, `maxBatch`, `delayMin`/`delayMax` theo action
    - [x] PII strip cho `text`, `message` khi log/preview (NFR-11)

11. [x] **Mở rộng `FacebookBrowserBridge` public DOM API**
    - [x] Thêm `withPage(fn, options)` hoặc `evaluateDom(fn, options)`
    - [x] `FacebookClient.ensureBrowserBridge()` public
    - [x] Tái dùng 1 page trong suốt batch (OP-1)

12. [x] **Mở rộng `FacebookClient.buildGraphQlBody` / `requestGraphQl`**
    - [x] Parse thêm `__dyn`, `__csr`, `__hs`, `__hsdp`, `__hblp`, `__s`, `dpr`, `x_fb_lsd`, `fb_api_req_friendly_name`
    - [x] Thêm `friendlyNames` cho write mutations
    - [x] Hỗ trợ `fallbackDocIds` rotation
    - [x] Truyền `requiresResidential: true` cho write requests

13. [x] **Tách `resolvePostFeedbackContext` thành public hoặc utility**
    - [x] Chuyển `FacebookCrawler.#resolvePostFeedbackContext` thành public `resolvePostFeedbackContext`
    - [x] Hoặc tách vào `src/scrapers/social/facebook/resolve-post-feedback.js`
    - [x] Tái dùng trong `like`, `comment`, `share`

14. [x] **Cập nhật `docs/deprecation-plan.md`**
    - [x] Thêm mapping legacy write functions → hybrid actions
    - [x] Cập nhật status tracker `Facebook Legacy Social Actions` → `deprecated-marked`

15. [x] **Viết tests**
    - [x] `tests/scrapers/social/facebook/crawler-actions.test.js`
    - [x] Real `node:http` server, không mock
    - [x] Cover AC-1 đến AC-19

16. [x] **Chạy verification**
    - [x] `npx vitest run tests/scrapers/social/facebook/`
    - [x] `npx tsc --noEmit`
    - [x] `npx prisma validate`

### Review Findings

**Verdict:** `REJECT / NEEDS REWORK` (re-review found 27 new findings: 1 decision-needed, 23 patch, 3 defer)

#### Decision needed

- [x] [Review][Patch] `FacebookBrowserBridge.withPage` page reuse across a batch — **Quyết định: Option 1** — mỗi action gọi `bridge.withPage` một lần cho cả batch; `runGuardedActionBatch` nhận `options.page` và truyền vào `fn(item, i, { page })`; `withPage` tạo 1 page, set cookies, chạy `fn(page)`, cuối cùng đóng page (OP-1, AC-17). [src/scrapers/social/facebook/signer-bridge.js:945-972, batch-runner.js:140-150, actions.js:186-798]

#### Patch

- [x] [Review][Patch] Live `like` handler chỉ click, không verify / human-like delay / GraphQL path [src/scrapers/social/facebook/actions.js:186-209]
- [x] [Review][Patch] Live `comment` handler không submit, trả `commentId` fake, không chọn `group_comment` floor [src/scrapers/social/facebook/actions.js:247-343]
- [x] [Review][Patch] Live `post` handler không mở composer / submit, `mediaUrls` ignored, `maxBatch` thiếu `force`, `isGroup` delay sai mixed batch [src/scrapers/social/facebook/actions.js:358-451]
- [x] [Review][Patch] Live `share` handler không mở share dialog / confirm, bỏ qua `message` và `maxBatch` [src/scrapers/social/facebook/actions.js:464-506]
- [x] [Review][Patch] Live `messenger_share` không paste/send, không fallback share-dialog/GraphQL, bỏ qua `message`/`recipientNames` và `maxBatch` [src/scrapers/social/facebook/actions.js:544-608]
- [x] [Review][Patch] Live `join_group` không click Join / verify, bỏ qua `keyword`/`limit`/`maxBatch`, `requiredArgs` rỗng [src/scrapers/social/facebook/actions.js:630-714, crawler.js:513-522]
- [x] [Review][Patch] Live `send_friend_request` không click Add Friend, bỏ qua `mode`/`location` [src/scrapers/social/facebook/actions.js:719-798]
- [x] [Review][Patch] `runGuardedActionBatch` không clamp `delayMin`/`delayMax` theo `ACTION_LIMITS` floor, cho phép delay 0 [src/scrapers/social/facebook/batch-runner.js:114-121, 158-159]
- [x] [Review][Patch] `runGuardedActionBatch` ghi governor/tracker ngay cả khi item thất bại [src/scrapers/social/facebook/batch-runner.js:210-218]
- [x] [Review][Patch] `FacebookActionVelocityTracker` thiếu `getActionLimit`, dùng `XACT_4290` thay vì `XACT_4291` [src/scrapers/social/facebook/batch-runner.js:37-106, 182-189]
- [x] [Review][Patch] `runGuardedActionBatch` không `await` governor async, trả object thường thay vì `PlatformError` khi lỗi [src/scrapers/social/facebook/batch-runner.js:165-167, 202-207]
- [x] [Review][Patch] `XACT_4010` thiếu auth dùng sai `suggestedAction` (ROTATE_ACCOUNT thay vì relogin) [src/scrapers/social/facebook/actions.js:122-133]
- [x] [Review][Patch] `XACT_5030` không có bridge dùng sai `suggestedAction` (ROTATE_ACCOUNT thay vì wait) [src/scrapers/social/facebook/actions.js:212-219, 322-329, 430-437, 497-503, 587-594, 696-703, 778-785]
- [x] [Review][Patch] `FacebookClient.buildGraphQlBody`/`requestGraphQl` thiếu anti-bot fields, `friendlyNames`, `fallbackDocIds`, `requiresResidential` [src/scrapers/social/facebook/client.js:431-475, 485-568, signer-bridge.js:47-121]
- [x] [Review][Patch] `DEFAULT_FB_DOC_IDS` write mutation placeholders không được dùng [src/scrapers/social/facebook/crawler.js:224-230]
- [x] [Review][Patch] `resolvePostFeedbackContext` public nhưng `like`/`comment`/`share` không gọi [src/scrapers/social/facebook/crawler.js:2981-2983, actions.js:186-209, 309-318, 503-506]
- [x] [Review][Patch] `assertFacebookUrlLocal` trong `actions.js` quá yếu và trùng lặp với `src/scrapers/facebook/core.js` [src/scrapers/social/facebook/actions.js:21-35, src/scrapers/facebook/core.js:348-367]
- [x] [Review][Patch] Không có `requiresResidential: true` trên bridge/GraphQL cho write actions [src/scrapers/social/facebook/actions.js (các withPage call), signer-bridge.js:464-497, client.js:623-642]
- [x] [Review][Patch] `FacebookActions` không gọi `proxyPool.getStickyProxy(..., requiresResidential)` [src/scrapers/social/facebook/actions.js:81-100]
- [x] [Review][Patch] `share`, `messenger_share`, `join_group` không clamp `maxBatch` [src/scrapers/social/facebook/actions.js:464-506, 544-608, 630-714]
- [x] [Review][Patch] `send_friend_request` regex target quá permissive (`...`, dấu chấm cuối) [src/scrapers/social/facebook/actions.js:746-757]
- [x] [Review][Patch] `share_link_uid` output shape không khớp AC-1 (trả array thay vì object) [src/scrapers/social/facebook/crawler.js:502-511, actions.js:619-628]
- [x] [Review][Patch] `stripEmojiSurrogates` lược bỏ cả ký tự non-emoji [src/scrapers/social/facebook/actions.js:54-57]
- [x] [Review][Patch] `client.ensureBrowserBridge` bỏ qua `profileDir` khi `userDataDir` rỗng [src/scrapers/social/facebook/client.js:623-642]
- [x] [Review][Patch] `src/scrapers/facebook/shareLinkByUid.js` vẫn import `api/services/facebookAutomation.js` [src/scrapers/facebook/shareLinkByUid.js:19]
- [x] [Review][Patch] `api/services/facebookAutomation.js` thiếu marker `@deprecated`/`LEGACY` trong file [api/services/facebookAutomation.js:1-3]
- [x] [Review][Patch] `stripPii` khác nhau giữa `actions.js` và `crawler.js` [src/scrapers/social/facebook/actions.js:42-47, crawler.js:237-249]
- [x] [Review][Patch] Tests chỉ cover `dryRun: true`, dùng `mockGov` stub, thiếu verify live path / delay / governor / PII / `group_post` / metadata registry [tests/scrapers/social/facebook/crawler-actions.test.js]
- [x] [Review][Patch] Tên test file `crawler-actions.test.js` không khớp spec `crawler-social-actions.test.js` [tests/scrapers/social/facebook/crawler-actions.test.js]

#### Deferred

- [x] [Review][Defer] `DEFAULT_FB_DOC_IDS` write mutation placeholders chưa tham chiếu — by design, cần capture live doc_id trước khi dùng [src/scrapers/social/facebook/crawler.js:224-230]

#### Re-review Findings (2nd pass)

**Decision needed**

- [x] [Review][Decision] `messenger_share` đăng ký `recipientUids`/`recipientUid` là optional nhưng lại throw `XACT_4001` khi không có recipient ngay cả trong dry-run — **Quyết định: Option 1** — chuyển `recipientUids`/`recipientUid` thành `requiredArgs` cho `messenger_share` và `share_link_uid` [src/scrapers/social/facebook/crawler.js:473-482, src/scrapers/social/facebook/actions.js:892-901]

**Patch (từ quyết định đã chuyển đổi)**

- [ ] [Review][Patch] Cập nhật registry `messenger_share` / `share_link_uid` để `recipientUids`/`recipientUid` là requiredArgs theo quyết định Option 1 [src/scrapers/social/facebook/crawler.js:473-482, 484-493; actions.js:892-901]

**Patch**

- [ ] [Review][Patch] Default maxBatch cho `post`/`join_group`/`like` vượt per-hour velocity ceiling (post=5, group_post=3, join_group=5, like=30) [src/scrapers/social/facebook/actions.js:292,424,584,1180; batch-runner.js:246-251]
- [ ] [Review][Patch] Live write actions dùng `textContent`/synthetic `InputEvent`/`ClipboardEvent`, không verify kết quả post/sent [src/scrapers/social/facebook/actions.js:455-490, 669-686, 700-715, 797-803, 992-1023]
- [ ] [Review][Patch] `messenger_share` không verify gửi; GraphQL fallback dùng sai `actor_id`, throw thay vì return error [src/scrapers/social/facebook/actions.js:984-1023, 1045-1098, 1109-1138]
- [ ] [Review][Patch] `send_friend_request` suggestions/location mode bỏ qua `runGuardedActionBatch`, không có delay/governor/velocity [src/scrapers/social/facebook/actions.js:1349-1352, 1459-1493, 1505-1537]
- [ ] [Review][Patch] `runGuardedActionBatch` ghi governor/tracker chỉ khi success, mutate `page.__actionName` test seam, không short-circuit lỗi non-retryable [src/scrapers/social/facebook/batch-runner.js:259-310, 291-299]
- [ ] [Review][Patch] Test suite dùng `FakePage`/`FakeFacebookBrowserBridge` stub, không verify real DOM/GraphQL/bridge [tests/scrapers/social/facebook/crawler-social-actions.test.js:22-133]
- [ ] [Review][Patch] `join_group` không validate hostname Facebook, trả `joined:true` bất kể verification [src/scrapers/social/facebook/actions.js:1163-1173, 1251-1295]
- [ ] [Review][Patch] GraphQL write fallbacks throw `XACT_5000` khi doc_id placeholder thiếu; `friendlyNames` map rỗng [src/scrapers/social/facebook/crawler.js:225-231; client.js:91, 178-180; actions.js:275-280, 376-402, 524-551, 843-870, 1109-1139]
- [ ] [Review][Patch] Residential proxy không được enforce khi chỉ có `proxyPool` [src/core/base-client.js:191-203; signer-bridge.js:487-510; proxy/proxy-pool.js:178-202]
- [ ] [Review][Patch] `join_group` / `send_friend_request` metadata không khớp runtime contract [src/scrapers/social/facebook/crawler.js:495-515]
- [ ] [Review][Patch] `post` từ chối `mediaUrls` bằng lỗi thay vì reserved note; không resolve numeric `groupIds` [src/scrapers/social/facebook/actions.js:572-575, 584, 612-613]
- [ ] [Review][Patch] `comment` thiếu giới hạn 8000 ký tự, dùng `textContent` tức thì [src/scrapers/social/facebook/actions.js:410-421, 455-490]
- [ ] [Review][Patch] `send_friend_request` target và location search chấp nhận non-profile paths [src/scrapers/social/facebook/actions.js:1374-1398, 1514-1533]
- [ ] [Review][Patch] `post` regex lấy `postId` thiếu group-post URL shapes [src/scrapers/social/facebook/actions.js:729-734]
- [ ] [Review][Patch] `requestGraphQl` không sanitize `fallbackDocIds` invalid/placeholder [src/scrapers/social/facebook/client.js:613-638]
- [ ] [Review][Patch] GraphQL code 368 rate-limit dùng `RETRY_AFTER_DELAY` thay vì `ROTATE_PROXY` [src/scrapers/social/facebook/client.js:579-589]
- [ ] [Review][Patch] `share` không chọn destination trước khi click final Share [src/scrapers/social/facebook/actions.js:777-828]
- [ ] [Review][Patch] `resolvePostFeedbackContext` HTTP extraction và `runGuardedActionBatch` recording/velocity edge cases chưa được test [tests/scrapers/social/facebook/crawler-social-actions.test.js:620-635, 693-713, 732-747; crawler.js:994-1018]
- [ ] [Review][Patch] `runGuardedActionBatch` bỏ qua `maxBatch` âm hoặc 0 [src/scrapers/social/facebook/batch-runner.js:246-251]
- [ ] [Review][Patch] `like` `maxBatch` có thể vượt `MAX_BATCH_SIZE` 20 [src/scrapers/social/facebook/actions.js:25, 292-303; batch-runner.js:246-251]
- [ ] [Review][Patch] `messenger_share` và `share_link_uid` dry-run trả `ok:true` không nhất quán với các action khác [src/scrapers/social/facebook/actions.js:907-912, 957-965]
- [ ] [Review][Patch] `pickRandomSegment`/`composeMessage` không áp dụng cho live messages [src/scrapers/social/facebook/actions.js:61-67, 903, 990-991, 1126]
- [ ] [Review][Patch] `runGuardedActionBatch` không wrap lỗi promise rejection từ governor [src/scrapers/social/facebook/batch-runner.js:259-270]

**Defer**

- [x] [Review][Defer] `DEFAULT_FB_DOC_IDS` write mutation placeholders không phải doc_id thật — by design, cần capture từ live session [src/scrapers/social/facebook/crawler.js:225-231; actions.js:275-280]
- [x] [Review][Defer] `FacebookActionVelocityTracker` lưu in-memory, không chia sẻ across workers/restarts — vượt phạm vi AC-14 [src/scrapers/social/facebook/batch-runner.js:47-48]
- [x] [Review][Defer] `shareLinkByUid` legacy campaign vẫn dùng plain loop không batch safety — file đã deprecated, thuộc Epic 20.2 cleanup [src/scrapers/facebook/shareLinkByUid.js:208-232]

## Dev Notes

### Relevant architecture patterns and constraints

- **Action-Level Auth (AD-3 rule 3b, AD-11 rule 3):** Mọi write action khai báo `requiresAuth: true` để `AbstractCrawler.start()` resolve `accountId` từ `AccountPool`, gắn sticky proxy, và không bao giờ rơi vào guest token ring. `FacebookClient.buildGraphQlBody` sẽ buộc `__user` lấy từ token cache.
- **Dry-Run Default (NFR-6):** Tất cả write actions mặc định `dryRun: true`. Real writes yêu cầu explicit `dryRun: false`. Dùng `args.dryRun !== false` thay vì `args.dryRun ?? true` để `null`/`undefined` cũng là dry-run.
- **Delay Floor (NFR-5, NFR-8, NFR-10, Cluster-1):**
  - `like`: 1–3s
  - `comment`: 3–7s (timeline) / 5–15s (group)
  - `post` (profile): 3–7s
  - `post` (group): 30–90s
  - `share`: 5–15s
  - `messenger_share` / `share_link_uid`: 5–15s
  - `join_group`: 30–90s
  - `send_friend_request`: 60–180s
  Sử dụng `delayMin`/`delayMax` injectable để test dễ dàng, nhưng `batch-runner.js` phải clamp theo floor trên.
- **No Cookie/Token Logging:** Không log `c_user`, `xs`, `fb_dtsg`, `lsd`, `__dyn`, `__csr` trong bất kỳ error/console nào.
- **Browser Bridge Scope:** `FacebookBrowserBridge` hiện là signer-token bridge; 13.8 đã ghi note "KHÔNG hỗ trợ DOM evaluate". Story 13.9 **bắt buộc** thêm public `withPage`/`evaluateDom` để `FacebookActions` thực hiện write DOM mà không chạm private fields.
- **Residential Proxy Mandatory:** Sau 13.8, `FacebookClient` mặc định `requiresProxy=true` cho real domain. `FacebookBrowserBridge.#resolveProxy` cần truyền `requiresResidential` cho write sessions. Action 13.9 phải truyền `ProxyIpPool` residential và `requiresResidential: true` cho mọi write request/bridge.
- **Per-Action Velocity Tracking:** `AdaptiveRateGovernor` hiện tại chỉ track 60s toàn platform. Bắt buộc thêm `FacebookActionVelocityTracker` sliding window 1h/24h cho `like`, `comment`, `post`, `share`, `messenger_share`, `join_group`, `send_friend_request`.
- **Per-Item Governor Check:** `AbstractCrawler.start()` chỉ gọi governor 1 lần cho cả batch. `batch-runner.js` phải gọi `governor.canAccountRequest`/`recordRequest` trước/sau **mỗi item**.
- **No Legacy Import:** `api/services/facebookAutomation.js` đã `deprecated-marked`. `batch-runner.js`/`actions.js` **KHÔNG** import từ đây; chỉ copy pattern.
- **PII Strip chỉ log/preview, không strip trước khi gửi:** `text`/`message` gửi lên Facebook phải nguyên vẹn; chỉ strip khi lưu `CrawlCheckpoint`, Redis stream, hoặc trả về `dryRun` preview.
- **Multi-doc_id fallback:** Mọi GraphQL write path phải chấp nhận `fallbackDocIds` và thử doc_id tiếp theo trước khi fallback DOM. Không throw panic khi doc_id rotated.
- **Anti-Bot Fields:** `FacebookClient.buildGraphQlBody` cần bổ sung `__dyn`, `__csr`, `__hs`, `__hsdp`, `__hblp`, `__s`, `dpr`, `x_fb_lsd`, `fb_api_req_friendly_name` (khi khả dụng) để giảm khả năng bị reject.
- **`resolvePostFeedbackContext` public:** Cần tái dùng để lấy feedback context từ post URL cho like/comment/share; chuyển thành public hoặc utility.
- **`mediaUrls` reserved:** Upload media qua Facebook composer phức tạp (GraphQL file upload). Trong MVP `post` chỉ text-only; `mediaUrls` được accept/validate nhưng ghi `note` rõ ràng.

### Source tree components to touch

- `src/scrapers/social/facebook/crawler.js` — đăng ký action, handlers delegate, `resolvePostFeedbackContext` public
- `src/scrapers/social/facebook/actions.js` — (file mới) write action logic
- `src/scrapers/social/facebook/batch-runner.js` — (file mới) `runGuardedActionBatch`, `enforceActionDelay`, `getActionLimit`
- `src/scrapers/social/facebook/velocity-tracker.js` — (file mới hoặc trong `batch-runner.js`) `FacebookActionVelocityTracker`
- `src/scrapers/social/facebook/resolve-post-feedback.js` — (file mới nếu tách utility)
- `src/scrapers/social/facebook/client.js` — `buildGraphQlBody` anti-bot fields, `requestGraphQl` fallback doc_ids, `requiresResidential`, `ensureBrowserBridge`
- `src/scrapers/social/facebook/signer-bridge.js` — public `withPage`/`evaluateDom`, `requiresResidential` proxy
- `src/scrapers/social/facebook/index.js` — export `FacebookActions`
- `src/scrapers/facebook/messengerShare.js`, `shareLinkByUid.js`, `graphqlSend.js`, `messengerQueue.js` — gắn `@deprecated`
- `docs/deprecation-plan.md` — mapping table + status tracker
- `tests/scrapers/social/facebook/crawler-social-actions.test.js` — (file mới) ATDD tests

### Testing standards summary

- **No mocks/stubs:** Chỉ test file dùng real `node:http` server. Không dùng `vi.fn()`, `sinon`, `nock`.
- **Red-phase ATDD:** Tests viết trước, chạy fail, sau đó implementation.
- **Type-check:** `npx tsc --noEmit` pass.
- **Prisma validate:** `npx prisma validate` pass.

## Technical Requirements

- **ESM 100%:** `.js` ESM, `import`/`export`, không `require`.
- **JSDoc / TypeScript types:** Tất cả hàm mới có `@param` / `@returns`. Chạy `npx tsc --noEmit` pass. Không dùng `any`.
- **No runtime dependency mới:** Chỉ dùng `puppeteer`/`playwright`, `got-scraping`/`undici`, `@prisma/client` đã có.
- **Tái dùng legacy logic (copy pattern, không import):** Tái dụng selectors, delay utilities, message composer từ `messengerShare.js`, `shareLinkByUid.js` **qua clipboard**, không import từ `api/services/facebookAutomation.js`.
- **Error Envelope:** Mọi lỗi trả về `PlatformError` với `code`, `type`, `message`, `suggestedAction`.
- **PII Stripping (NFR-11):** Strip phone/email từ `text`, `message`, `authorName` trước khi trả về/lưu; gốc vẫn gửi lên Facebook.
- **Metadata Schema (AD-18):** Nếu lưu kết quả write action vào `Post`/`Comment` thì phải validate với schema tại `schemas/facebook/social.json`.
- **Velocity Limit:**
  - `like`: ≤30/hr, delay 1–3s
  - `comment`: ≤10/hr, delay 3–7s hoặc 5–15s
  - `post`: ≤5/hr, delay 3–7s (profile) / 30–90s (group)
  - `share`: conservative, delay 5–15s
  - `messenger_share`: conservative (NFR-8), delay 5–15s
  - `friend_request`: ≤20/day, delay 60–180s
  - `join_group`: conservative, delay 30–90s
- **Sliding Window:** `FacebookActionVelocityTracker` theo dõi 1h/24h per-action per-account.
- **Residential Proxy:** Mọi write request/bridge truyền `requiresResidential: true`.
- **Multi-doc_id Fallback:** `requestGraphQl` nhận `fallbackDocIds: string[]` và thử lần lượt.

## Architecture Compliance

- **AbstractCrawler (AD-2):** `FacebookCrawler` kế thừa `AbstractCrawler`; action đăng ký qua `ActionRegistry`; `start()` dispatch đến handler.
- **CrawlerCommand (AD-11):** Action nhận `{ action, args, session }`; `args` chứa `dryRun`, `delayMin`, `delayMax`, `maxBatch`, etc.
- **Proxy Strategy (AD-3):** `requiresAuth: true` ⇒ `AccountPool` + `proxyPool.getStickyProxy(accountId)` + residential proxy. Không xoay IP per-request.
- **Error Envelope (AD-14):** Mọi lỗi trả về `{ code, type, message, retryAfter, suggestedAction, accountId?, platform }`.
- **Anti-Bot Validation (AD-9):** `FacebookPlatformResponseValidator` phát hiện challenge/rate-limit; `FacebookCrawler` throw `RateLimitError`/`BotChallengeError` khi cần.
- **3-Tier Gap-Filling (AD-10):** Ghi `CrawlCheckpoint` với `targetType` là tên action và `targetKey` là URL/UID để hỗ trợ resume/retry.
- **Metadata Schema Contract (AD-18):** Mọi output dữ liệu lưu vào `Post`/`Comment` phải tuân thủ `schemas/facebook/social.json`.
- **Governor/Velocity (AD-13):** `AdaptiveRateGovernor` + `FacebookActionVelocityTracker` đảm bảo per-item và per-action velocity limit. Governor gọi per-item; tracker sliding window 1h/24h.
- **Browser Bridge Contract:** `FacebookBrowserBridge` phải cung cấp public `withPage(fn, options)`/`evaluateDom(fn, options)`; `FacebookClient` cung cấp `ensureBrowserBridge()`. Write actions không truy cập private fields (`#browser`, `#getLazyBrowserBridge`).
- **GraphQL Write Body:** `FacebookClient.buildGraphQlBody` phải bao gồm các trường anti-bot (`__dyn`, `__csr`, `__hs`, `__hsdp`, `__hblp`, `__s`, `dpr`, `x_fb_lsd`, `fb_api_req_friendly_name`) khi token extraction cung cấp, và `friendlyNames` map cho write mutations.
- **No Legacy Import:** `batch-runner.js` và `actions.js` tuân thủ AD-14 / deprecation-plan: không import `api/services/facebookAutomation.js`; chỉ copy pattern.

## Library & Framework Requirements

- `puppeteer` / `playwright` — qua `FacebookBrowserBridge` cho DOM evaluate
- `got-scraping` hoặc `undici` — qua `AbstractApiClient` / `FacebookClient` cho GraphQL mutation
- `@prisma/client` — `PrismaStore` (nếu lưu checkpoint)
- `vitest` — tests
- `node:http` — test server
- Không thêm runtime dependency mới.

## File Structure Requirements

**Cập nhật / Tạo mới:**
- `src/scrapers/social/facebook/crawler.js` — thêm 8 action trong constructor, `resolvePostFeedbackContext` public
- `src/scrapers/social/facebook/actions.js` — (mới) write action methods
- `src/scrapers/social/facebook/batch-runner.js` — (mới) `runGuardedActionBatch`, `enforceActionDelay`, `getActionLimit`
- `src/scrapers/social/facebook/velocity-tracker.js` — (mới hoặc merge vào `batch-runner.js`) `FacebookActionVelocityTracker`
- `src/scrapers/social/facebook/resolve-post-feedback.js` — (mới nếu tách utility)
- `src/scrapers/social/facebook/client.js` — `buildGraphQlBody` anti-bot fields, `requestGraphQl` `fallbackDocIds`, `requiresResidential`, `ensureBrowserBridge`
- `src/scrapers/social/facebook/signer-bridge.js` — public `withPage`/`evaluateDom`, `requiresResidential` proxy
- `src/scrapers/social/facebook/index.js` — export `FacebookActions`
- `tests/scrapers/social/facebook/crawler-social-actions.test.js` — (mới) ATDD tests
- `docs/deprecation-plan.md` — cập nhật mapping table + status tracker

**Đánh dấu `@deprecated`:**
- `src/scrapers/facebook/messengerShare.js`
- `src/scrapers/facebook/shareLinkByUid.js`
- `src/scrapers/facebook/graphqlSend.js`
- `src/scrapers/facebook/messengerQueue.js`
- `src/scrapers/facebook/index.js` re-export nếu cần comment `// LEGACY`

**Không sửa (chỉ ghi TODO 13.10):**
- `src/scrapers/index.js` — dispatcher migration thuộc 13.10
- `api/routes/facebook.js` — caller surface migration thuộc 13.10
- `src/mcp/server.js` — tool handler chuyển sang hybrid thuộc 13.10
- `api/services/facebookAutomation.js` — logic legacy giữ nguyên sau khi gắn `@deprecated`; chuyển hướng trong 13.10 (KHÔNG import trong 13.9)

## Testing Requirements

- **Real `node:http` server:** Test phải tạo server local, mock `GET /` cho token extraction, `POST /api/graphql/` cho mutation responses.
- **No mocks/stubs:** Không dùng `vi.fn()`, `sinon`, `nock`. Chỉ dùng real `node:http` server và `FacebookClient.httpClient` seam.
- **Browser-free unit tests cho pure utilities:**
  - `stripEmojiSurrogates`, `pickRandomSegment`, `composeMessage` nếu tái dùng từ `messengerShare.js`
  - Input validation, URL parsing, limit clamp, delay validation, `FacebookActionVelocityTracker` sliding window
- **Integration tests bắt buộc:**
  - `[AC-1]` action registration
  - `[AC-2]` `FacebookActions` / `batch-runner.js` / `velocity-tracker.js` load, KHÔNG import từ `api/services/facebookAutomation.js`
  - `[AC-3]` `like` dry-run + invalid URL + per-item governor
  - `[AC-4]` `comment` dry-run + PII strip
  - `[AC-5]` `post` group URL validation + max batch + `mediaUrls` reserved
  - `[AC-6]` `share` dry-run
  - `[AC-7]` `messenger_share` direct-URL primary + GraphQL fallback với `fallbackDocIds`
  - `[AC-8]` `join_group` non-group URL rejection + delay 30–90s
  - `[AC-9]` `send_friend_request` delay floor 60–180s + limit ≤20/day
  - `[AC-10]` no account → `XACT_4010`, velocity tracker 1h/24h, `requiresResidential: true`
  - `[AC-11]` `XACT_4290` upstream rate limit, `XACT_4291` hibernation
  - `[AC-12]` `@deprecated` JSDoc tồn tại
  - `[AC-17]` `FacebookBrowserBridge.withPage` / `evaluateDom` public seam hoạt động
  - `[AC-18]` `buildGraphQlBody` chứa anti-bot fields + `friendlyNames`, multi-doc_id fallback
  - `[AC-19]` `resolvePostFeedbackContext` public/utility
- **Dry-run tests:** Đảm bảo real writes không chạy khi `dryRun` mặc định hoặc `dryRun: true`.
- **Velocity tests:** `FacebookActionVelocityTracker` reject vượt `perHour`/`perDay`; `batch-runner` gọi governor per-item.
- **Account hibernation tests:** Governor/tracker trả `XACT_4291` / `suggestedAction: 'rotate_account'` khi vượt giới hạn hoặc hibernation.
- **Chạy verification:**
  - `npx vitest run tests/scrapers/social/facebook/crawler-social-actions.test.js`
  - `npx vitest run tests/scrapers/social/facebook/`
  - `npx tsc --noEmit`
  - `npx prisma validate`

## Previous Story Intelligence

### Từ Story 13.8 (`13-8-facebook-hybrid-marketplace.md`)

- **Action-level auth resolution:** `FacebookCrawler` constructor khai báo `requiresAuth` per action; `AbstractCrawler.start()` tính `actionRequiresAuth = descriptor.requiresAuth ?? this.requiresAuth` [dòng 174]. Write action phải set `requiresAuth: true` explicit.
- **Token ring partition:** `FacebookClient.buildGraphQlBody` phân biệt `authLsd` (account-bound) và `guestLsd` (guest token ring) [dòng 448-451]. Write action với account phải đảm bảo lấy từ auth ring.
- **Residential proxy requirement:** `FacebookClient` mặc định `requiresProxy=true` cho real domain; thiếu proxy throw `XACT_5030` [project context / 13.8 swe-max review]. Tests local `127.0.0.1` được miễn. `FacebookBrowserBridge.#resolveProxy` cần truyền `requiresResidential` cho write sessions.
- **Placeholder doc_id strategy:** `DEFAULT_FB_DOC_IDS` dùng placeholder, fallback khi doc_id rotated không throw panic, ghi `note` [dòng 75-76, AC-5 13.8].
- **Scope note override PRD:** 13.8 ghi rõ Epic 13 override PRD cũ về advanced filters [dòng 25-27]. Tương tự, 13.9 là Epic 13 scope, override phần PRD Phase 2 nếu cần.

### Từ Story 13.7 (`13-7-facebook-hybrid-post-group-comments.md`)

- **Input validation patterns:** Dùng `URL` constructor + `pathname.startsWith('/groups/')` + `assertFacebookUrlLocal` để reject URL không hợp lệ với `XACT_4001` [review findings].
- **Limit clamp:** `#clampMaxComments` [1, 2000] default 50 [dòng 104-109].
- **Pagination:** `after` cursor trim, kiểm tra whitespace, truyền vào GraphQL variables [review patch dòng 222-226].
- **PII stripping:** `PII_PHONE_RE` / `PII_EMAIL_RE` áp dụng cho text fields [dòng 226-241].
- **Review patches áp dụng:** validate input shape up-front, `null`/`''` bypass, boolean coercion, `pathname` check, `creationTime` nullish check.

### Từ Story 13.6 (`13-6-facebook-hybrid-search-global-group-search.md`)

- **Search variable builder:** `query`/`searchTerm`/`queryString`, `count`/`first`, `cursor`/`after` [AC-2].
- **Response parse linh hoạt:** Tên connection có thể khác (`serpResponse.results.edges`, `browse`, `searchResults`) [AC-5]. Tương tự, write mutation responses có thể khác nhau; cần parse defensively.
- **Multi-type handling:** `search` hỗ trợ `type` và `type: 'all'` [AC-2].

### Áp dụng cho 13.9

- Write actions cần DOM evaluate path chính (do Facebook write mutations volatile). `FacebookBrowserBridge.withPage` là seam bắt buộc.
- GraphQL path là optional optimization khi doc_id được capture; phải có multi-`doc_id` fallback.
- Input validation phải chặt chẽ như 13.7 (`URL`, `pathname`, `XACT_4001`).
- Tất cả write actions `requiresAuth: true`, sticky proxy, account pool, `requiresResidential: true`.
- Delay floor và velocity limit là ràng buộc cứng (PRD Epic 6); `post` group và `join_group` là 30–90s, không phải 3–7s/2–5s cũ.
- `FacebookActionVelocityTracker` sliding window 1h/24h là yêu cầu mới để đáp ứng FR-53 (per-hour, per-day limits).
- `batch-runner.js` phải gọi governor per-item, không chỉ một lần cho cả batch.

## Latest Technical Information

- **Facebook GraphQL doc_id pattern:** Facebook Comet sử dụng persisted query `doc_id` + `variables` object, gửi đến `https://www.facebook.com/api/graphql/` dạng `application/x-www-form-urlencoded` [web research: deepwiki.com/fb-aio].
- **Known messenger doc_id:** Legacy `MWChatBusinessCTAAdsSenderMutation` sử dụng `doc_id = 29460155383630960` tại `src/scrapers/facebook/graphql.js:47` và `graphqlSend.js:104`. Đây là điểm khởi đầu cho `messenger_share` **tertiary** path; khả năng cao doc_id này đã/xoay nên cần capture mới từ live session.
- **Messenger direct URL:** `https://www.facebook.com/messages/t/{uid}` mở conversation trực tiếp, có thể paste URL qua clipboard API và gửi [verified trong `shareLinkByUid.js`]. Đây là **primary** path đáng tin cậy khi GraphQL mutation không ổn định.
- **Facebook share dialog:** Recipient avatar có aria-label chứa `"via Messenger"` / `"qua Messenger"` là one-click send; caption bị discard [xác nhận live trong `messengerShare.js:30-55`]. Đây là **secondary** path.
- **Graph API v26.0:** `/{object-id}/likes` và `/{post-id}/comments` hỗ trợ POST để like/comment, nhưng yêu cầu Page access token — không áp dụng trực tiếp cho user automation. Do đó 13.9 dùng internal GraphQL / DOM thay vì Graph API.
- **Doc_id volatility:** Instaloader/Instagram research cho thấy Meta GraphQL doc_id thay đổi thường xuyên; cần fallback và không throw panic khi doc_id rotated [web research: instaloader commit 8fb0b20].
- **Rate limits from PRD (real project context):** Likes ≤ 30/hr, comments ≤ 10/hr, friend requests ≤ 20/day [FR-53]. Messenger mass-share cần delay bảo thủ hơn [NFR-8]. Friend request delay 60–180s không override [NFR-10]. `post` group và `join_group` cần floor 30–90s theo legacy `api/services/facebookAutomation.js` Cluster-1.
- **Anti-bot form fields:** Legacy `graphqlSend.js:80-110` gửi thêm `__hs`, `__hsi`, `__dyn`, `__csr`, `__hsdp`, `__hblp`, `__s`, `dpr`, `__spin_b`, `x_fb_lsd`, `fb_api_req_friendly_name`. `FacebookClient.buildGraphQlBody` cần bổ sung các trường này khi token extraction cung cấp.
- **Governor per-item gap:** `AbstractCrawler.start()` hiện chỉ gọi `governor.canAccountRequest`/`recordRequest` một lần trước khi gọi handler. `batch-runner.js` phải gọi per-item để tránh vượt `safeRequestsPerMinute`.
- **`resolvePostFeedbackContext` private:** `FacebookCrawler.#resolvePostFeedbackContext` (`crawler.js:853-933`) cần chuyển public/utility để `FacebookActions` tái dùng.

## Git Intelligence Summary

- **Baseline commit:** `a35aaac8` (Story 13.2.1 artifact created), `c45d770f` (Story 13.7 done), `09613241` (Story 13.8 implementation green phase).
- **Recent patterns:**
  - Proxy enforcement: `e3b2e3f5` "make residential proxy mandatory for Facebook public scraping"
  - Action-level auth & token-ring partition: `ba6f4551`, `97868f54` — `concreteAccountId`, `resolveProxy`, guest token ring isolation
  - SSR fallback: `0ad5aff8` "allow guest token extraction and improve SSR marketplace parsing"
  - Review-driven patches: `d3a385a5`, `881484da` — validation tightening, SSR fallback, migration notes
  - Deprecation / story artifacts: `da1e19b1`, `5e27ac1e` — `docs(story)` commits
  - No-mock, real `node:http` server tests: pattern từ 13.7/13.8 red-phase test scaffolds
- **Conventions:**
  - Commit messages: `docs(story): ...`, `feat(facebook): ...`, `fix(facebook): ...`, `test(facebook): ...`
  - Push as `nirholas` (mandatory theo `AGENTS.md` / `CLAUDE.md`)
  - `npx tsc --noEmit` và `npx vitest run ...` pass trước khi đánh dấu done
- **Cảnh báo:** 13.8 second review/patch pass phát hiện `FacebookClient` guest token ring cần tách biệt account-bound tokens; 13.9 write actions phải kế thừa và không để guest tokens lọt vào auth path.

## Project Context Reference

- `AGENTS.md` / `CLAUDE.md` — ESM, `const` over `let`, async/await, error emoji prefixes, no mocks, always commit/push as `nirholas`.
- `docs/deprecation-plan.md` — gắn `@deprecated` JSDoc, cập nhật status tracker, không xóa legacy cho đến Epic 20.2. `api/services/facebookAutomation.js` đã `deprecated-marked` — không import.
- `prisma/schema.prisma` — `Post.id` namespaced, `metadata Json?`, `CrawlCheckpoint` unique key.
- `src/core/metadata-schema-registry.js` — load/validate schema theo `schemas/<platform>/<category>.json`.
- `src/core/base-crawler.js` — `start()`, account resolution, governor, action-level auth. Governor gọi 1 lần cho batch; `batch-runner.js` gọi per-item.
- `src/core/base-client.js` — `AbstractApiClient`, proxy resolution, `XACT_5030` / `XACT_4010`, `XACT_4290` upstream rate limit.
- `src/core/adaptive-governor.js` — `recordRequest()` / `canAccountRequest()` 60s platform-wide; cần `FacebookActionVelocityTracker` cho per-action 1h/24h.

## Dev Agent Record

### Agent Model Used

SWE-1.7 Max

### Debug Log References

### Completion Notes List

- Applied all critical/enhancement/optimization fixes from `13-9-story-validation-report.md`.
- Delay floors updated to match PRD/legacy: post group / join_group 30–90s, friend request 60–180s.
- `messenger_share` priority reordered: direct Messenger URL → share dialog → GraphQL CTA.
- `share_link_uid` merged into `messenger_share` as alias.
- Error code convention fixed: `XACT_4290` upstream rate limit, `XACT_4291` hibernation.
- Added `FacebookActionVelocityTracker` sliding window 1h/24h, per-item governor check, no import from `api/services/facebookAutomation.js`.
- Added `FacebookBrowserBridge` public `withPage`/`evaluateDom` seam, `FacebookClient.ensureBrowserBridge()`.
- Added `FacebookClient.buildGraphQlBody` anti-bot fields, `friendlyNames`, multi-`doc_id` fallback, `requiresResidential: true`.
- Added `resolvePostFeedbackContext` public/utility requirement.
- Created tasks for `batch-runner.js`, `velocity-tracker.js`, `resolve-post-feedback.js`.
- Marked `reviewed: validated`.

### File List

**Created:**
- `src/scrapers/social/facebook/actions.js`
- `src/scrapers/social/facebook/batch-runner.js`
- `tests/scrapers/social/facebook/crawler-actions.test.js`
- `_bmad-output/test-artifacts/atdd-checklist-13-9-facebook-hybrid-social-actions-write-messenger.md`

**Updated:**
- `src/scrapers/social/facebook/crawler.js`
- `src/scrapers/social/facebook/client.js`
- `src/scrapers/social/facebook/signer-bridge.js`
- `src/scrapers/social/facebook/index.js`
- `src/scrapers/facebook/messengerShare.js`
- `src/scrapers/facebook/shareLinkByUid.js`
- `src/scrapers/facebook/graphqlSend.js`
- `src/scrapers/facebook/messengerQueue.js`
- `docs/deprecation-plan.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/13-9-facebook-hybrid-social-actions-write-messenger.md`

**Không sửa (chỉ ghi TODO 13.10):**
- `src/scrapers/index.js`
- `api/routes/facebook.js`
- `src/mcp/server.js`
- `api/services/facebookAutomation.js` (KHÔNG import từ file này trong 13.9)

