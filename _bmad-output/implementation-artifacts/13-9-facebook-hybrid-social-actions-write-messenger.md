---
story_id: '13.9'
epic: 13
story_key: '13-9-facebook-hybrid-social-actions-write-messenger'
status: "ready-for-dev"
phase: "Phase 4"
created: 2026-08-28
updated: 2026-08-28
last_updated: 2026-08-28
owner: "DEV"
reviewed: "Pending"
baseline_commit: "a35aaac8"
---

# Story 13.9: Facebook Hybrid Social Actions (Write & Messenger)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **Facebook Automation Operator**,  
I want **thực hiện các hành động viết (like, comment, post, share, messenger-share, share_link_uid, join_group, send_friend_request) trên Facebook thông qua kiến trúc hybrid thay vì legacy Puppeteer**,  
So that **các hành động tương tác được quản lý bởi `FacebookClient`, sticky proxy, governor và error envelope chuẩn, giảm rủi ro checkpoint và tăng khả năng tái sử dụng cho MCP/CLI/API**.

## Scope Note

Story 13.9 triển khai **Facebook social write actions** trong `FacebookCrawler`/`FacebookClient` thay vì các hàm legacy `src/scrapers/facebook/` (Puppeteer-only). Các action này là **write/mutating** nên bắt buộc `requiresAuth: true`, `dryRun` mặc định `true`, và phải tuân thủ rate limit / delay floor của Epic 6 (FR-53, NFR-5, NFR-6, NFR-8, NFR-10).

Vì Facebook write mutations chủ yếu là **browser-facing DOM hoặc GraphQL mutation bảo mật cao, dễ xoay doc_id**, phương án mặc định sử dụng `FacebookBrowserBridge` (CDP/Playwright) cho các thao tác DOM (như `like`, `comment`, `post`, `join_group`, `send_friend_request`, `messenger_share`), kết hợp `FacebookClient.requestGraphQl()` cho các mutation endpoint đã biết (ví dụ `MWChatBusinessCTAAdsSenderMutation` để gửi Messenger link qua UID). Tất cả write actions phải đi qua `runGuardedBatch`-style bounded batch với delay jitter.

Scope cụ thể:
- **Trong phạm vi 13.9:** đăng ký action, định nghĩa input/output, dry-run gate, delay/velocity guard, fallback an toàn, gắn `@deprecated` cho legacy files liên quan.
- **Không trong phạm vi:** chuyển hướng toàn bộ MCP/CLI/API caller sang hybrid — thuộc Story 13.10 (Integration & Caller Migration). Tuy nhiên 13.9 **có thể** thêm `TODO(13.10)` notes tại caller surfaces.
- **Đặc biệt:** `share_link_uid` có thể được triển khai như action riêng hoặc alias/fallback của `messenger_share` tùy theo kết quả phân tích live DOM.

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
- `src/scrapers/social/facebook/crawler.js` — `FacebookCrawler` constructor, `DEFAULT_FB_DOC_IDS` [dòng 200-222], `registerAction` pattern [dòng 305-423], `resolveTargetKey` [dòng 104-158], `resolveGroupId` [dòng 167-195], `#normalizePostItem` [dòng 432-496], `marketplace()` handler pattern [dòng 1600-1700]
- `src/scrapers/social/facebook/client.js` — `requestGraphQl()` [dòng 485-545], `buildGraphQlBody()` [dòng 431-476], `ensureTokens()` / token cache [dòng 212-421], auth/guest token ring partition [dòng 448-451]
- `src/scrapers/social/facebook/index.js` — exports [dòng 1-30]
- `src/scrapers/facebook/messengerShare.js` — `shareToMessenger`, `sendMessageToThread`, SELECTORS, verified share dialog flow [dòng 57-450]
- `src/scrapers/facebook/shareLinkByUid.js` — `shareLinkByUid`, `shareLinkByUidCampaign`, direct `messages/t/{uid}` approach [dòng 1-237]
- `src/scrapers/facebook/graphqlSend.js` — server-side `sendMessageToUidServerSide`, `MWChatBusinessCTAAdsSenderMutation` form data [dòng 1-155]
- `src/scrapers/facebook/messengerQueue.js` — `buildCampaignQueue`, `parseRecipientsFile`, `parseLinksFile` [dòng 1-179]
- `src/scrapers/facebook/graphql.js` — `MESSENGER_CTA_DOC_ID = '29460155383630960'` [dòng 47], `checkMessengerCTA` [dòng 353-438], `sendMessageToUid` [dòng 461-545]
- `src/scrapers/facebook/index.js` — legacy re-exports, `// LEGACY — see docs/deprecation-plan.md` pattern [dòng 1-64]
- `api/services/facebookAutomation.js` — `runGuardedBatch`, `likeFacebookPosts`, `commentOnFacebookPosts` (AC2.2/2.3), `createFacebookPost`, `shareFacebookPosts`, `ACCOUNT_RISK_WARNING`, delay validation [dòng 43-500]
- `src/mcp/server.js` — `x_facebook_automate` (like/comment/post/messenger), `x_facebook_share_posts`, `x_facebook_join_groups`, `x_facebook_send_friend_requests`, `x_facebook_post_to_groups` tool definitions [dòng 1386-1540, 2772-2870, 3230-3236]
- `src/core/base-crawler.js` — `start()` action auth resolution, account pool resolution, governor, jitter [dòng 151-251]
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
- `FacebookClient.requestGraphQl` / `buildGraphQlBody` đã sẵn sàng với auth/guest token ring partition, sticky proxy, residential proxy requirement.
- `FacebookBrowserBridge` (Playwright default, Puppeteer fallback) đã triển khai token extraction; DOM evaluate cho write actions chưa được sử dụng (13.8 chuyển SSR fallback thay vì DOM evaluate).
- Legacy write modules còn nguyên vẹn trong `src/scrapers/facebook/`:
  - `messengerShare.js` — share post qua Messenger dialog
  - `shareLinkByUid.js` — share link trực tiếp qua `messages/t/{uid}`
  - `graphqlSend.js` — server-side `sendMessageToUidServerSide`
  - `messengerQueue.js` — parse recipients/links/content
  - `graphql.js` — `MESSENGER_CTA_DOC_ID`, `checkMessengerCTA`, `sendMessageToUid`
  - `api/services/facebookAutomation.js` — `likeFacebookPosts`, `commentOnFacebookPosts`, `createFacebookPost`, `shareFacebookPosts`, `runGuardedBatch`
- `docs/deprecation-plan.md` chưa có mapping cho các hàm write legacy → hybrid actions; cần cập nhật.
- MCP tools `x_facebook_automate`, `x_facebook_share_posts`, `x_facebook_join_groups`, `x_facebook_send_friend_requests`, `x_facebook_post_to_groups` hiện vẫn gọi legacy automation service.

## Acceptance Criteria

### AC-1: Đăng ký các action write trong `FacebookCrawler`

- **Given** `FacebookCrawler` trong `src/scrapers/social/facebook/crawler.js`
- **When** khởi tạo
- **Then** đăng ký thêm các action trong constructor:

| action | requiredArgs | optionalArgs | outputType | requiresAuth | delay floor |
|---|---|---|---|---|---|
| `like` | `postUrl` | `dryRun`, `delayMin`, `delayMax`, `maxBatch` | `{ results: { postUrl, liked, alreadyLiked, error? }[], dryRun: boolean }` | `true` | 1–3s |
| `comment` | `postUrl`, `text` | `dryRun`, `delayMin`, `delayMax`, `maxBatch` | `{ results: { postUrl, commentId?, error? }[], dryRun: boolean }` | `true` | 1–3s |
| `post` | `text` | `mediaUrls`, `groupUrls`, `groupIds`, `dryRun`, `delayMin`, `delayMax`, `maxBatch` | `{ results: { targetUrl, postId?, error? }[], dryRun: boolean }` | `true` | 3–7s |
| `share` | `postUrl` | `dryRun`, `delayMin`, `delayMax`, `maxBatch`, `message` | `{ results: { postUrl, shared, error? }[], dryRun: boolean }` | `true` | 3–7s |
| `messenger_share` | `postUrl` | `recipientUids`, `recipientNames`, `message`, `dryRun`, `delayMin`, `delayMax`, `maxBatch` | `{ results: { recipientUid, ok, method?, error? }[], dryRun: boolean }` | `true` | 5–15s |
| `share_link_uid` | `postUrl`, `recipientUid` | `message`, `dryRun`, `delayMin`, `delayMax` | `{ ok, postUrl, recipientUid, method?, error? }` | `true` | 5–15s |
| `join_group` | `groupUrls` hoặc `groupIds` | `keyword`, `limit`, `dryRun`, `delayMin`, `delayMax`, `maxBatch` | `{ results: { groupUrl, joined, error? }[], dryRun: boolean }` | `true` | 2–5s (per group min 30s theo PRD Cluster-1) |
| `send_friend_request` | `targets` | `mode`, `location`, `limit`, `dryRun`, `delayMin`, `delayMax`, `maxBatch` | `{ results: { target, ok, error? }[], dryRun: boolean }` | `true` | 60–180s (NFR-10) |

- **And** tất cả action trên khai báo `requiresAuth: true` (override cấp platform `FacebookCrawler.requiresAuth = true`)
- **And** `listActions()` trả về đầy đủ action với `requiredArgs`, `optionalArgs`, `example`, `outputType`, `requiresAuth`
- **And** `postUrls` / `groupUrls` / `groupIds` chấp nhận `string` hoặc `string[]` để batch

### AC-2: `FacebookActions` module (hoặc `FacebookClient` action methods)

- **Given** `src/scrapers/social/facebook/` cần thêm logic write
- **When** triển khai
- **Then** tạo `src/scrapers/social/facebook/actions.js` (hoặc mở rộng `FacebookClient` / `FacebookCrawler`) chứa các phương thức write
- **And** mỗi phương thức:
  - Nhận `args` và `session` (có `accountId`, `cookies`, `cdpUrl` tùy chọn)
  - Resolve account từ `AccountPool` nếu thiếu
  - Gắn **sticky residential proxy** theo `accountId` suốt session
  - Đảm bảo `dryRun: true` mặc định
  - Không log cookie/token
  - Trả về `PlatformError` chuẩn với `suggestedAction` khi lỗi

### AC-3: Like action

- **Given** `postUrl` là URL bài viết Facebook hợp lệ
- **When** gọi `crawler.start({ action: 'like', args: { postUrl, dryRun: false }, session })`
- **Then** `FacebookCrawler.like(args, session)`:
  1. Validate `postUrl` bằng `assertFacebookUrlLocal` / `resolveTargetKey` style, reject nếu không phải `facebook.com` URL → `XACT_4001`
  2. `FacebookBrowserBridge` navigate đến `postUrl` với sticky proxy, anti-leak browser args
  3. Tìm Like button theo locale-aware selectors (`[aria-label*="Like"]`, `[aria-label*="Thích"]`, `[aria-label*="Bỏ thích"]`)
  4. Nếu đã like → trả `{ alreadyLiked: true, liked: false }`; nếu chưa → click với human-like delay 1–3s
  5. Verify bằng Unlike button xuất hiện
  6. Trả `{ postUrl, liked: true, alreadyLiked: false }` (hoặc `dryRun: true` preview)
- **And** nếu GraphQL `like` mutation doc_id đã capture, có thể dùng `requestGraphQl` làm primary path, DOM làm fallback
- **And** tuân thủ velocity limit `likes ≤ 30/hr` theo FR-53

### AC-4: Comment action

- **Given** `postUrl` và `text`
- **When** gọi `crawler.start({ action: 'comment', args: { postUrl, text }, session })`
- **Then** `FacebookCrawler.comment(args, session)`:
  1. Validate `postUrl` và `text` (non-empty, `text.length ≤ 8000`)
  2. Navigate đến `postUrl`, tìm comment input (`[role="textbox"][contenteditable="true"]`, aria-label chứa "Viết..." / "Write...")
  3. Type `text` với human-like typing delay (tham khảo `typeMessage` trong `messengerShare.js`)
  4. Nếu `dryRun: true` → preview text và dừng
  5. Nếu `dryRun: false` → gửi comment (Enter hoặc nút gửi), chờ phản hồi, trả `commentId` nếu parse được
  6. Strip PII từ `text` trước khi lưu/log (NFR-11)
- **And** tuân thủ `comments ≤ 10/hr` theo FR-53

### AC-5: Post action

- **Given** `text` và tùy chọn `mediaUrls`, `groupUrls`/`groupIds`
- **When** gọi `crawler.start({ action: 'post', args: { text, groupUrls: ['https://www.facebook.com/groups/xxx'] }, session })`
- **Then** `FacebookCrawler.post(args, session)`:
  1. Validate `text` non-empty, `mediaUrls` là array URL hợp lệ, `groupUrls` chứa `/groups/`
  2. Với mỗi target (profile timeline hoặc group), navigate đến composer URL
  3. Mở composer (`[role="button"][aria-label*="Tạo bài viết"]` / `"Create post"`)
  4. Nhập `text` và attachment (nếu có) qua `FacebookBrowserBridge`
  5. `dryRun: true` → preview, không submit
  6. `dryRun: false` → submit, trả `postId` hoặc `postUrl` nếu parse được
  7. Delay floor 3–7s, max batch 10 group posts (20 với `force: true`) theo NFR-6 / Cluster-1

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

- **Given** `postUrl` và danh sách `recipientUids` / `recipientNames`
- **When** gọi `crawler.start({ action: 'messenger_share', args: { postUrl, recipientUids, message }, session })`
- **Then** `FacebookCrawler.messengerShare(args, session)` hỗ trợ **hai phương thức chính**:
  1. **GraphQL mutation path** (nếu doc_id hợp lệ): dùng `FacebookClient.requestGraphQl()` với `doc_id` tương đương `MWChatBusinessCTAAdsSenderMutation` (legacy `29460155383630960` tại `src/scrapers/facebook/graphql.js:47` hoặc doc_id mới), gửi link đến từng `recipientUid`
  2. **Direct Messenger URL path** (fallback DOM): navigate `https://www.facebook.com/messages/t/{recipientUid}`, paste `postUrl` (và `message` nếu có) vào compose box, press Enter / click send button (`shareLinkByUid.js` pattern)
  3. **Share dialog path** (cuối cùng): mở share dialog trên bài viết, chọn recipient avatar có aria-label chứa `via Messenger` / `qua Messenger` (`messengerShare.js` pattern)
- **And** `share_link_uid` có thể là alias hoặc variant của `messenger_share` khi chỉ có 1 `recipientUid`
- **And** delay floor 5–15s giữa các recipient (NFR-8)
- **And** message compose strip emoji nếu cấu hình (tái dùng `stripEmojiSurrogates`, `pickRandomSegment` từ `messengerShare.js:104-126`)
- **And** kết quả mỗi recipient `{ recipientUid, ok, method, error? }`

### AC-8: Join group action

- **Given** `groupUrls` hoặc `groupIds` hoặc `keyword`
- **When** gọi `crawler.start({ action: 'join_group', args: { groupUrls, keyword, limit }, session })`
- **Then** `FacebookCrawler.joinGroup(args, session)`:
  1. Resolve từng group URL thành `groupId` qua `resolveGroupId`, reject non-group URL → `XACT_4001`
  2. Navigate đến group page hoặc `facebook.com/groups/{groupId}`
  3. Tìm nút "Join Group" / "Tham gia nhóm" theo locale-aware selector
  4. `dryRun: true` → preview; `dryRun: false` → click, verify trạng thái pending/member
  5. Delay **min 30s** giữa các group theo PRD Cluster-1, max batch 20

### AC-9: Send friend request action

- **Given** `targets` (array URL/UID) hoặc `mode: 'suggestions' | 'location'`
- **When** gọi `crawler.start({ action: 'send_friend_request', args: { targets, limit }, session })`
- **Then** `FacebookCrawler.sendFriendRequest(args, session)`:
  1. Validate target là Facebook profile URL hoặc numeric UID
  2. Navigate đến profile, tìm nút "Add Friend" / "Thêm bạn bè"
  3. `dryRun: true` → preview; `dryRun: false` → click, verify
  4. Delay **60–180s** giữa các request (NFR-10), `limit ≤ 20/day`
  5. Trả `{ results: { target, ok, error? }[], dryRun: boolean }`

### AC-10: Dry-run gate, delay floor và governor

- **Given** bất kỳ write action
- **When** gọi `crawler.start(...)`
- **Then** `dryRun` mặc định `true` (NFR-6); muốn thực thi phải truyền `dryRun: false` rõ ràng
- **And** cookie/token không bị log
- **And** mỗi action đi qua `AdaptiveRateGovernor` với velocity limit tương ứng:
  - `like`: ≤ 30/hr
  - `comment`: ≤ 10/hr
  - `post`: ≤ 5/hr (theo NFR-9 scheduler cap, có thể điều chỉnh)
  - `messenger_share`: bảo thủ hơn default like/comment (NFR-8)
  - `send_friend_request`: ≤ 20/day, 60–180s delay
- **And** nếu thiếu account từ `AccountPool` → `XACT_4010` với `suggestedAction: 'relogin'`
- **And** action `requiresAuth: true` bắt buộc account + sticky residential proxy (AD-3 rule 3b)

### AC-11: Error envelope và fallback

- **Given** bất kỳ write action gặp lỗi
- **When** thực thi
- **Then** trả về `PlatformError` với `code`, `type`, `message`, `retryAfter`, `suggestedAction` (AD-14)
- **And** phân loại lỗi:
  - Challenge/Captcha/Login wall → `XACT_4010` / `suggestedAction: 'hibernate_account'`
  - Rate limit 429 → `XACT_4291` / `suggestedAction: 'rotate_account'`
  - Proxy hết → `XACT_5030` / `suggestedAction: 'wait'`
  - Invalid args → `XACT_4001` / `suggestedAction: 'use_x_actions_list'`
- **And** KHÔNG throw panic khi doc_id rotated hoặc DOM selector thất bại; ghi `note` và thử fallback path

### AC-12: Deprecation markers

- **Given** legacy modules trong `src/scrapers/facebook/`
- **When** triển khai Story 13.9
- **Then** gắn JSDoc `@deprecated` và comment `// LEGACY — see docs/deprecation-plan.md` cho:
  - `src/scrapers/facebook/messengerShare.js` (replaced by `facebook:messenger_share`)
  - `src/scrapers/facebook/shareLinkByUid.js` (replaced by `facebook:share_link_uid` / `facebook:messenger_share`)
  - `src/scrapers/facebook/graphqlSend.js` (replaced by `FacebookClient.requestGraphQl` / `facebook:messenger_share`)
  - `src/scrapers/facebook/messengerQueue.js` (replaced by batch handling trong `FacebookCrawler`)
- **And** cập nhật `docs/deprecation-plan.md`:
  - Thêm vào bảng `Legacy Facebook Functions → Hybrid Actions`:
    - `shareToMessenger` / `messengerShareCampaign` → `facebook:messenger_share`
    - `shareLinkByUid` / `shareLinkByUidCampaign` → `facebook:share_link_uid`
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
  - `[AC-2]` `FacebookActions` / client action methods load
  - `[AC-3]` `like` input validation, `XACT_4001` cho non-Facebook URL, dry-run preview
  - `[AC-4]` `comment` text validation, PII strip, dry-run
  - `[AC-5]` `post` group URL validation, max batch clamp, dry-run
  - `[AC-6]` `share` postUrl validation, dry-run
  - `[AC-7]` `messenger_share` recipient list validation, GraphQL body build với `MWChatBusinessCTAAdsSenderMutation`-style variables, direct-URL fallback
  - `[AC-8]` `join_group` non-group URL rejection, delay min
  - `[AC-9]` `send_friend_request` limit ≤ 20, delay floor 60–180s
  - `[AC-10]` no account → `XACT_4010`
  - `[AC-11]` error envelope shape
  - `[AC-12]` `@deprecated` JSDoc tồn tại trong legacy files
- **And** chạy `npx vitest run tests/scrapers/social/facebook/` và `npx tsc --noEmit` pass

## Tasks / Subtasks

1. [ ] **Tạo `src/scrapers/social/facebook/actions.js`**
   - [ ] Định nghĩa `FacebookActions` class (hoặc module) với các phương thức: `like`, `comment`, `post`, `share`, `messengerShare`, `shareLinkByUid`, `joinGroup`, `sendFriendRequest`
   - [ ] Tiêm `client`, `browserBridge`, `governor`, `accountPool`, `proxyPool` từ constructor
   - [ ] Tái dùng `runGuardedBatch` pattern từ `api/services/facebookAutomation.js:88-280`
   - [ ] Đảm bảo `dryRun` mặc định `true`, không log cookie/token

2. [ ] **Mở rộng `DEFAULT_FB_DOC_IDS` cho write mutations (placeholder)**
   - [ ] Thêm placeholders: `LIKE_MUTATION`, `COMMENT_MUTATION`, `POST_MUTATION`, `SHARE_MUTATION`, `MESSENGER_SHARE_MUTATION`, `JOIN_GROUP_MUTATION`, `SEND_FRIEND_REQUEST_MUTATION`
   - [ ] Để `null` / `fb_xxx_doc` cho đến khi capture từ live session

3. [ ] **Đăng ký action trong `FacebookCrawler` constructor**
   - [ ] `like`, `comment`, `post`, `share`, `messenger_share`, `share_link_uid`, `join_group`, `send_friend_request`
   - [ ] Khai báo `requiresAuth: true`, `requiredArgs`, `optionalArgs`, `example`, `outputType`
   - [ ] Handler gọi `this.actions.<method>(args, session)`

4. [ ] **Implement `like` / `comment` / `post` / `share` handlers**
   - [ ] Sử dụng `FacebookBrowserBridge` navigate + DOM evaluate
   - [ ] Locale-aware selectors (en/vi), fallback chain
   - [ ] Human-like click/type/scroll delays
   - [ ] Verify kết quả sau khi thực hiện
   - [ ] `dryRun: true` chỉ trả về preview, không tương tác DOM

5. [ ] **Implement `messenger_share` / `share_link_uid` handlers**
   - [ ] Path 1: `FacebookClient.requestGraphQl()` với mutation doc_id placeholder
   - [ ] Path 2: `messages/t/{uid}` + clipboard paste (`shareLinkByUid.js` pattern)
   - [ ] Path 3: share dialog + recipient avatar click (`messengerShare.js` pattern)
   - [ ] Tái dùng `stripEmojiSurrogates`, `pickRandomSegment`, `composeMessage` từ `messengerShare.js:96-146`

6. [ ] **Implement `join_group` / `send_friend_request` handlers**
   - [ ] `joinGroup`: resolve group ID, validate `/groups/`, DOM click "Join", delay min 30s
   - [ ] `sendFriendRequest`: validate target URL/UID, DOM click "Add Friend", delay 60–180s, limit ≤ 20

7. [ ] **Tích hợp `AdaptiveRateGovernor` và `AccountPool`**
   - [ ] Gọi `governor.canAccountRequest(accountId, 'facebook')` trước mỗi action
   - [ ] Velocity limit theo action type (like/comment/post/share/messenger/friend)
   - [ ] Hibernation / rotate account trên challenge/rate-limit

8. [ ] **Input validation & SSRF guard**
   - [ ] Validate URL là `facebook.com`, `pathname` hợp lệ
   - [ ] Reject path traversal, non-Facebook domain, empty text
   - [ ] Clamp `limit`, `maxBatch`, `delayMin`/`delayMax` hợp lý
   - [ ] PII strip cho `text`, `message` (NFR-11)

9. [ ] **Cập nhật `docs/deprecation-plan.md`**
   - [ ] Thêm mapping legacy write functions → hybrid actions
   - [ ] Cập nhật status tracker `Facebook Legacy Social Actions` → `deprecated-marked`

10. [ ] **Viết tests**
    - [ ] `tests/scrapers/social/facebook/crawler-social-actions.test.js`
    - [ ] Real `node:http` server, không mock
    - [ ] Cover AC-1 đến AC-13

11. [ ] **Chạy verification**
    - [ ] `npx vitest run tests/scrapers/social/facebook/`
    - [ ] `npx tsc --noEmit`
    - [ ] `npx prisma validate`

## Dev Notes

### Relevant architecture patterns and constraints

- **Action-Level Auth (AD-3 rule 3b, AD-11 rule 3):** Mọi write action khai báo `requiresAuth: true` để `AbstractCrawler.start()` resolve `accountId` từ `AccountPool`, gắn sticky proxy, và không bao giờ rơi vào guest token ring. `FacebookClient.buildGraphQlBody` sẽ buộc `__user` lấy từ token cache.
- **Dry-Run Default (NFR-6):** Tất cả write actions mặc định `dryRun: true`. Real writes yêu cầu explicit `dryRun: false`.
- **Delay Floor (NFR-5, NFR-8, NFR-10):** Facebook write actions phải có delay rộng hơn Twitter. Sử dụng `delayMin`/`delayMax` injectable để test dễ dàng.
- **No Cookie/Token Logging:** Không log `c_user`, `xs`, `fb_dtsg`, `lsd` trong bất kỳ error/console nào.
- **Browser Bridge Scope:** `FacebookBrowserBridge` hiện là signer-token bridge; 13.8 đã ghi note "KHÔNG hỗ trợ DOM evaluate". Story 13.9 **mở rộng bridge** để hỗ trợ DOM evaluate cho write actions, hoặc tạo helper `evaluateDom` riêng trong `actions.js`.
- **Residential Proxy Mandatory:** Sau 13.8, `FacebookClient` mặc định `requiresProxy=true` cho real domain. Action 13.9 phải truyền `ProxyIpPool` residential.

### Source tree components to touch

- `src/scrapers/social/facebook/crawler.js` — đăng ký action, handlers delegate
- `src/scrapers/social/facebook/actions.js` — (file mới) write action logic
- `src/scrapers/social/facebook/client.js` — `requestGraphQl` cho mutation path
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
- **Tái dùng legacy logic:** Tái dùng selectors, delay utilities, message composer từ `messengerShare.js`, `shareLinkByUid.js`, `facebookAutomation.js` thay vì viết lại.
- **Error Envelope:** Mọi lỗi trả về `PlatformError` với `code`, `type`, `message`, `suggestedAction`.
- **PII Stripping (NFR-11):** Strip phone/email từ `text`, `message`, `authorName` trước khi trả về/lưu.
- **Metadata Schema (AD-18):** Nếu lưu kết quả write action vào `Post`/`Comment` thì phải validate với schema tại `schemas/facebook/social.json`.
- **Velocity Limit:**
  - `like`: 30/hr
  - `comment`: 10/hr
  - `post`: 5/hr
  - `friend_request`: 20/day, 60–180s delay
  - `join_group`: 30s min delay

## Architecture Compliance

- **AbstractCrawler (AD-2):** `FacebookCrawler` kế thừa `AbstractCrawler`; action đăng ký qua `ActionRegistry`; `start()` dispatch đến handler.
- **CrawlerCommand (AD-11):** Action nhận `{ action, args, session }`; `args` chứa `dryRun`, `delayMin`, `delayMax`, `maxBatch`, etc.
- **Proxy Strategy (AD-3):** `requiresAuth: true` ⇒ `AccountPool` + `proxyPool.getStickyProxy(accountId)` + residential proxy. Không xoay IP per-request.
- **Error Envelope (AD-14):** Mọi lỗi trả về `{ code, type, message, retryAfter, suggestedAction, accountId?, platform }`.
- **Anti-Bot Validation (AD-9):** `FacebookPlatformResponseValidator` phát hiện challenge/rate-limit; `FacebookCrawler` throw `RateLimitError`/`BotChallengeError` khi cần.
- **3-Tier Gap-Filling (AD-10):** Ghi `CrawlCheckpoint` với `targetType` là tên action và `targetKey` là URL/UID để hỗ trợ resume/retry.
- **Metadata Schema Contract (AD-18):** Mọi output dữ liệu lưu vào `Post`/`Comment` phải tuân thủ `schemas/facebook/social.json`.

## Library & Framework Requirements

- `puppeteer` / `playwright` — qua `FacebookBrowserBridge` cho DOM evaluate
- `got-scraping` hoặc `undici` — qua `AbstractApiClient` / `FacebookClient` cho GraphQL mutation
- `@prisma/client` — `PrismaStore` (nếu lưu checkpoint)
- `vitest` — tests
- `node:http` — test server
- Không thêm runtime dependency mới.

## File Structure Requirements

**Cập nhật / Tạo mới:**
- `src/scrapers/social/facebook/crawler.js` — thêm 8 action trong constructor
- `src/scrapers/social/facebook/actions.js` — (mới) write action methods
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
- `src/api/services/facebookAutomation.js` — logic legacy giữ nguyên sau khi gắn `@deprecated`; chuyển hướng trong 13.10

## Testing Requirements

- **Real `node:http` server:** Test phải tạo server local, mock `GET /` cho token extraction, `POST /api/graphql/` cho mutation responses.
- **No mocks/stubs:** Không dùng `vi.fn()`, `sinon`, `nock`.
- **Browser-free unit tests cho pure utilities:**
  - `stripEmojiSurrogates`, `pickRandomSegment`, `composeMessage` nếu tái dùng từ `messengerShare.js`
  - Input validation, URL parsing, limit clamp, delay validation
- **Integration tests bắt buộc:**
  - `[AC-1]` action registration
  - `[AC-3]` `like` dry-run + invalid URL
  - `[AC-4]` `comment` dry-run + PII strip
  - `[AC-5]` `post` group URL validation + max batch
  - `[AC-6]` `share` dry-run
  - `[AC-7]` `messenger_share` GraphQL body build + direct-URL fallback
  - `[AC-8]` `join_group` non-group URL rejection
  - `[AC-9]` `send_friend_request` delay floor + limit
  - `[AC-10]` no account → `XACT_4010`
  - `[AC-12]` `@deprecated` JSDoc tồn tại
- **Chạy verification:**
  - `npx vitest run tests/scrapers/social/facebook/crawler-social-actions.test.js`
  - `npx vitest run tests/scrapers/social/facebook/`
  - `npx tsc --noEmit`
  - `npx prisma validate`

## Previous Story Intelligence

### Từ Story 13.8 (`13-8-facebook-hybrid-marketplace.md`)

- **Action-level auth resolution:** `FacebookCrawler` constructor khai báo `requiresAuth` per action; `AbstractCrawler.start()` tính `actionRequiresAuth = descriptor.requiresAuth ?? this.requiresAuth` [dòng 174]. Write action phải set `requiresAuth: true` explicit.
- **Token ring partition:** `FacebookClient.buildGraphQlBody` phân biệt `authLsd` (account-bound) và `guestLsd` (guest token ring) [dòng 448-451]. Write action với account phải đảm bảo lấy từ auth ring.
- **Residential proxy requirement:** `FacebookClient` mặc định `requiresProxy=true` cho real domain; thiếu proxy throw `XACT_5030` [project context / 13.8 swe-max review]. Tests local `127.0.0.1` được miễn.
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

- Write actions cần DOM evaluate path chính (do Facebook write mutations volatile).
- GraphQL path là optional optimization khi doc_id được capture.
- Input validation phải chặt chẽ như 13.7 (`URL`, `pathname`, `XACT_4001`).
- Tất cả write actions `requiresAuth: true`, sticky proxy, account pool.
- Delay floor và velocity limit là ràng buộc cứng (PRD Epic 6).

## Latest Technical Information

- **Facebook GraphQL doc_id pattern:** Facebook Comet sử dụng persisted query `doc_id` + `variables` object, gửi đến `https://www.facebook.com/api/graphql/` dạng `application/x-www-form-urlencoded` [web research: deepwiki.com/fb-aio].
- **Known messenger doc_id:** Legacy `MWChatBusinessCTAAdsSenderMutation` sử dụng `doc_id = 29460155383630960` tại `src/scrapers/facebook/graphql.js:47` và `graphqlSend.js:104`. Đây là điểm khởi đầu cho `messenger_share` GraphQL path; khả năng cao doc_id này đã/xoay nên cần capture mới từ live session.
- **Graph API v26.0:** `/{object-id}/likes` và `/{post-id}/comments` hỗ trợ POST để like/comment, nhưng yêu cầu Page access token — không áp dụng trực tiếp cho user automation. Do đó 13.9 dùng internal GraphQL / DOM thay vì Graph API.
- **Messenger direct URL:** `https://www.facebook.com/messages/t/{uid}` mở conversation trực tiếp, có thể paste URL qua clipboard API và gửi [verified trong `shareLinkByUid.js`]. Đây là fallback đáng tin cậy khi GraphQL mutation không ổn định.
- **Facebook share dialog:** Recipient avatar có aria-label chứa `"via Messenger"` / `"qua Messenger"` là one-click send; caption bị discard [xác nhận live trong `messengerShare.js:30-55`].
- **Doc_id volatility:** Instaloader/Instagram research cho thấy Meta GraphQL doc_id thay đổi thường xuyên; cần fallback và không throw panic khi doc_id rotated [web research: instaloader commit 8fb0b20].
- **Rate limits from PRD (real project context):** Likes ≤ 30/hr, comments ≤ 10/hr, friend requests ≤ 20/day [FR-53]. Messenger mass-share cần delay bảo thủ hơn [NFR-8]. Friend request delay 60–180s không override [NFR-10].

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
- `docs/deprecation-plan.md` — gắn `@deprecated` JSDoc, cập nhật status tracker, không xóa legacy cho đến Epic 20.2.
- `prisma/schema.prisma` — `Post.id` namespaced, `metadata Json?`, `CrawlCheckpoint` unique key.
- `src/core/metadata-schema-registry.js` — load/validate schema theo `schemas/<platform>/<category>.json`.
- `src/core/base-crawler.js` — `start()`, account resolution, governor, action-level auth.
- `src/core/base-client.js` — `AbstractApiClient`, proxy resolution, `XACT_5030` / `XACT_4010`.

## Dev Agent Record

### Agent Model Used

SWE-1.7 Max

### Debug Log References

### Completion Notes List

### File List

**Dự kiến tạo mới:**
- `src/scrapers/social/facebook/actions.js`
- `tests/scrapers/social/facebook/crawler-social-actions.test.js`

**Dự kiến cập nhật:**
- `src/scrapers/social/facebook/crawler.js`
- `src/scrapers/social/facebook/index.js`
- `src/scrapers/facebook/messengerShare.js`
- `src/scrapers/facebook/shareLinkByUid.js`
- `src/scrapers/facebook/graphqlSend.js`
- `src/scrapers/facebook/messengerQueue.js`
- `docs/deprecation-plan.md`

**Không sửa (chỉ ghi TODO 13.10):**
- `src/scrapers/index.js`
- `api/routes/facebook.js`
- `src/mcp/server.js`
- `src/api/services/facebookAutomation.js` (chỉ gắn `@deprecated` / comment)
