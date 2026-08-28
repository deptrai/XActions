# Báo cáo checklist validation — Story 13.9: Facebook Hybrid Social Actions (Write & Messenger)

> Trạng thái story: `ready-for-dev`  
> Story file: `_bmad-output/implementation-artifacts/13-9-facebook-hybrid-social-actions-write-messenger.md`  
> Baseline commit: `a35aaac8` | Commit story mới nhất: `c933c84b`  
> Ngôn ngữ báo cáo: `vietnamese` (theo `docs/config.yaml`)  
> Đánh giá theo: `checklist.md`, `epics.md`, `prd-facebook-epics-5-6-2026-08-21.md`, `ARCHITECTURE-SPINE.md`, `deprecation-plan.md`, source code hiện tại.

---

## 1. Thông tin chung

| Mục | Giá trị |
|---|---|
| Story | 13.9 — Facebook Hybrid Social Actions (Write & Messenger) |
| Epic | 13 — High-Throughput Hybrid Scraping Engine (Facebook Refactor) |
| Trạng thái sprint | `13-9-facebook-hybrid-social-actions-write-messenger: ready-for-dev` (`_bmad-output/implementation-artifacts/sprint-status.yaml:90`) |
| Scope chính | Thêm 8 action write (`like`, `comment`, `post`, `share`, `messenger_share`, `share_link_uid`, `join_group`, `send_friend_request`) vào `FacebookCrawler`, dùng `FacebookClient` + `FacebookBrowserBridge`, kế thừa `runGuardedBatch` pattern, đánh dấu legacy deprecated. |
| Files đề xuất tạo/sửa | `src/scrapers/social/facebook/actions.js` (mới), `src/scrapers/social/facebook/crawler.js`, `src/scrapers/social/facebook/index.js`, `docs/deprecation-plan.md`, legacy files trong `src/scrapers/facebook/`. |
| Files tham chiếu cốt lõi | `src/scrapers/social/facebook/crawler.js`, `src/scrapers/social/facebook/client.js`, `src/scrapers/social/facebook/signer-bridge.js`, `src/scrapers/social/facebook/index.js`, `src/core/base-crawler.js`, `src/core/base-client.js`, `src/core/adaptive-governor.js`, `src/scrapers/facebook/limits.js`, `api/services/facebookAutomation.js`, `src/mcp/server.js`, `docs/deprecation-plan.md`. |

---

## 2. Tóm tắt đánh giá

| Loại | Số lượng | Ghi chú nhanh |
|---|---|---|
| **Critical** | 9 | Có khả năng làm implementation fail hoặc vi phạm architecture/dry-run/rate-limit. Cần sửa story trước khi dev. |
| **Enhancement** | 7 | Cải thiện tính đúng đắn, testability, hoặc scope rõ ràng. Nên đưa vào story hoặc ghi `deferred`. |
| **Optimization** | 5 | Cách triển khai nhanh hơn, an toàn hơn, hoặc dễ bảo trì hơn. Có thể thực hiện trong dev. |
| **Phán quyết** | **REVISE** | Story chưa sẵn sàng chuyển `in-progress` mà không chỉnh sửa các vấn đề nghiêm trọng về rate-limit, DOM bridge, GraphQL write body, và reuse legacy file. |

---

## 3. Các vấn đề nghiêm trọng (Critical Issues)

### CR-1: `AdaptiveRateGovernor` / `AccountPool` hiện tại **không thể** enforce velocity limit per action theo giờ/ngày

- **Dẫn chứng**:
  - `src/core/adaptive-governor.js:202-242`: `recordRequest()` / `canAccountRequest()` chỉ giữ timestamp trong 60 giây, tính `safeRequestsPerMinute` theo platform, không biết `like` vs `comment` vs `friend_request`.
  - `src/core/account-pool.js:261-274`: `recordRequest()` cũng chỉ gọi `governor.recordRequest()` và lưu timestamp 60s.
  - `src/scrapers/facebook/limits.js:67-73`: `LIMITS` chỉ có `like`, `comment`, `friendRequest`, `message`; thiếu `post`, `share`, `messenger_share`, `join_group`, `send_friend_request`.
  - `src/scrapers/facebook/limits.js:161-172`: `getActionLimit()` trả về `perHour`/`perDay` nhưng `runGuardedBatch` trong `api/services/facebookAutomation.js:114-124` chỉ lấy `Object.values(limitObj)[0]` và clamp `maxBatch`, **không track theo thời gian thực**.
- **Tác động**: Story AC-10 yêu cầu `like ≤ 30/hr`, `comment ≤ 10/hr`, `post ≤ 5/hr`, `friend ≤ 20/day`. Không có cơ chế sliding-window per-action per-account, dev sẽ không thể đảm bảo AC-10 chỉ bằng `AdaptiveRateGovernor`.
- **Đề xuất**: Thêm `FacebookActionVelocityTracker` trong `actions.js` hoặc mở rộng `AdaptiveRateGovernor` với `setActionLimit(action, perHour, perDay)` và sliding window 1h/24h. Cập nhật `src/scrapers/facebook/limits.js` hoặc tạo map limit riêng cho write actions.

### CR-2: `AbstractCrawler.start()` chỉ gọi governor **một lần** cho cả batch, không per-item

- **Dẫn chứng**: `src/core/base-crawler.js:196-238`: `canAccountRequest()` và `recordRequest()` chạy trước khi gọi handler, sau đó handler tự quản lý vòng lặp.
- **Tác động**: Nếu `like` gửi 20 post trong một batch, governor chỉ thấy 1 request, không kích hoạt hibernation/rotate kịp thời. Dễ vượt `safeRequestsPerMinute`.
- **Đề xuất**: Bắt buộc `runGuardedActionBatch` gọi `governor.canAccountRequest(accountId, 'facebook')` và `governor.recordRequest(accountId, 'facebook')` **trước/sau mỗi item**.

### CR-3: Nguy cơ import trực tiếp `runGuardedBatch` từ `api/services/facebookAutomation.js` — legacy đang được deprecate

- **Dẫn chứng**:
  - Story Task 1 (dòng 289): *"Tái dùng `runGuardedBatch` pattern từ `api/services/facebookAutomation.js:88-280`"*.
  - `docs/deprecation-plan.md:49` và `:93`: `api/services/facebookAutomation.js` social-action helpers đã được liệt kê trong Phase 1 markers và status tracker là `deprecated-marked`.
  - `api/services/facebookAutomation.js:93, 221, 264-272`: `runGuardedBatch` throw plain `Error`, không `PlatformError`; không gọi `governor`; `warning` chỉ có ở real-run; `onProgress` signature khác.
- **Tác động**: Nếu dev hiểu theo nghĩa đen "import & reuse", sẽ phá vỡ AC-12 (deprecation), AD-14 (error envelope), AC-10 (governor integration).
- **Đề xuất**: Viết rõ trong story: **KHÔNG import** từ `api/services/facebookAutomation.js`; chỉ "copy pattern" vào `src/scrapers/social/facebook/actions.js` với tên `runGuardedActionBatch`, dùng `PlatformError`, gọi `governor`, và trả về `ACCOUNT_RISK_WARNING`.

### CR-4: `FacebookBrowserBridge` thiếu public API để evaluate DOM / quản lý page lifecycle

- **Dẫn chứng**:
  - `src/scrapers/social/facebook/signer-bridge.js:388-940`: public methods chỉ có `init`, `extractTokens`, `scrapeProfile`, `scrapeGroupMembers`, `close`.
  - `#getBrowser`, `#getLazyBrowserBridge`, `adapter`, `browser` là private (`#browser`, `this.adapter` public nhưng không có `newPage`/`evaluate` wrapper).
  - `src/scrapers/social/facebook/client.js:229`: `FacebookClient.#getLazyBrowserBridge()` là private method.
- **Tác động**: `FacebookActions` không thể gọi `FacebookBrowserBridge` để navigate/click/type cho `like`, `comment`, `post`, ... mà không truy cập private fields hoặc khởi tạo lại từ đầu.
- **Đề xuất**: Thêm public method `evaluateDom(fn, options)` hoặc `withPage(fn, options)` vào `FacebookBrowserBridge` (hoặc `FacebookClient`). Mở rộng `FacebookClient` thêm `ensureBrowserBridge()` public.

### CR-5: `FacebookClient.buildGraphQlBody()` thiếu các trường bắt buộc cho write mutations

- **Dẫn chứng**:
  - `src/scrapers/social/facebook/client.js:431-476`: body chứa `doc_id`, `variables`, `lsd`, `fb_dtsg`, `jazoest`, `__a`, `__user`, `__comet_req`, `__req`, `__ccg`, `fb_api_caller_class`, `server_timestamps`, `__spin_r/t`, `__rev`, `__hsi`.
  - `src/scrapers/facebook/graphqlSend.js:80-110`: legacy gửi thêm `__hs`, `__hsi`, `__dyn`, `__csr`, `__hsdp`, `__hblp`, `__s`, `dpr`, `__spin_b`, `x_fb_lsd`, `fb_api_req_friendly_name`.
  - `src/scrapers/social/facebook/signer-bridge.js:47-121` / `client.js:340-420`: token extraction không parse `__dyn`, `__csr`, `__hs`, `__hsdp`, `__hblp`, `__s`, `dpr`.
- **Tác động**: Write mutation qua GraphQL có khả năng bị Facebook reject vì thiếu `__dyn`/`__csr`/`x_fb_lsd`. AC-6 yêu cầu fallback DOM, nhưng nếu primary path là GraphQL thì sẽ fail ngay.
- **Đề xuất**: Mở rộng `extractFacebookTokensScript` / `#fetchTokens` để parse các trường này (với fallback rỗng) và thêm vào `buildGraphQlBody`. Hoặc coi DOM là path chính, GraphQL là optional.

### CR-6: Không có cơ chế fallback/rotate nhiều `doc_id`

- **Dẫn chứng**:
  - `src/scrapers/social/facebook/client.js:485-545`: `requestGraphQl(docId, ...)` chỉ nhận **một** `docId`.
  - Khi `data.errors` xuất hiện, chỉ throw `XACT_5000` hoặc `XACT_4010`/`XACT_4290`, không tự rotate doc_id.
- **Tác động**: NFR-7 yêu cầu graceful fallback khi `doc_id` rotated; AC-6 yêu cầu "rotate doc_id dự phòng". Story chưa chỉ định cách rotate.
- **Đề xuất**: Cho phép `requestGraphQl` nhận `fallbackDocIds: string[]` hoặc `FacebookActions` tự giữ map `docId -> fallback list`. Khi GraphQL fail với `XACT_5000`, thử doc_id tiếp theo trước khi fallback DOM.

### CR-7: Delay floor trong AC-1 mâu thuẫn với PRD Epic 6 / legacy code

- **Dẫn chứng**:
  - Story AC-1 bảng: `post` delay floor 3–7s; `join_group` 2–5s ("per group min 30s").
  - `api/services/facebookAutomation.js:1225`: `GROUP_ACTION_DELAY_FLOOR_MS = 30000`.
  - `api/services/facebookAutomation.js:1472-1548`: `postToSingleGroup` dùng 30–90s.
  - `prd-facebook-epics-5-6-2026-08-21.md:180, 183, 185`: NFR-5 delay floor cao hơn Twitter, NFR-10 friend 60–180s.
- **Tác động**: `post` to group và `join_group` nếu chạy 3–7s sẽ vi phạm Cluster-1 30s floor, dễ bị checkpoint.
- **Đề xuất**:
  - `like`: 1–3s (giữ).
  - `comment`: 3–7s hoặc 5–15s.
  - `post` (profile): 3–7s.
  - `post` (group): **30–90s**.
  - `share`: 5–15s.
  - `messenger_share` / `share_link_uid`: 5–15s.
  - `join_group`: **30–90s**.
  - `send_friend_request`: 60–180s.

### CR-8: Mã lỗi AC-11 (`XACT_4291`) mâu thuẫn với convention hiện tại

- **Dẫn chứng**:
  - Story AC-11: "Rate limit 429 → `XACT_4291` / `suggestedAction: 'rotate_account'`".
  - `src/scrapers/social/facebook/client.js:547-556`: GraphQL code 368 → `XACT_4290` / `RATE_LIMIT`.
  - `src/core/base-crawler.js:200-208`: hibernation → `XACT_4291`.
  - `src/core/base-client.js:612-619`: upstream rate limit → `XACT_4290`.
- **Tác động**: Dev sẽ bối rối giữa `XACT_4290` (upstream rate limit / GraphQL 368) và `XACT_4291` (account hibernation). Dễ gán sai code.
- **Đề xuất**: Sửa AC-11: `429` upstream → `XACT_4290` + `suggestedAction: 'rotate_proxy'/'rotate_account'`; `account hibernation` → `XACT_4291` + `suggestedAction: 'rotate_account'`.

### CR-9: `messenger_share` GraphQL path sử dụng mutation dành cho business CTA

- **Dẫn chứng**:
  - `src/scrapers/facebook/graphql.js:47`: `MESSENGER_CTA_DOC_ID = '29460155383630960'`.
  - `src/scrapers/facebook/graphqlSend.js:63-110`: gửi `MWChatBusinessCTAAdsSenderMutation` với `page_id` / `actor_id` là UID.
  - `src/scrapers/facebook/messengerShare.js:30-55`: đã xác nhận share dialog one-click bỏ caption; direct URL `messages/t/{uid}` đáng tin cậy hơn.
- **Tác động**: `MWChatBusinessCTAAdsSenderMutation` có thể yêu cầu page/ad permission, không phù hợp cho personal messenger share. Nếu đặt làm primary path, dev sẽ mất thời gian capture doc_id không dùng được.
- **Đề xuất**: Đảo ngược ưu tiên: **primary = direct Messenger URL (`messages/t/{uid}`)**, **secondary = share dialog recipient avatar**, **tertiary = GraphQL CTA mutation** nếu capture được doc_id hợp lệ.

---

## 4. Cơ hội cải tiến (Enhancement Opportunities)

### EN-1: Thêm `FacebookActionVelocityTracker` hoặc mở rộng `AdaptiveRateGovernor`

- **Lý do**: Giải quyết CR-1/CR-2. Cần tracking per-action per-account với sliding window 1h/24h.
- **Đề xuất**: Thêm phương thức `recordAction(accountId, action)` / `canDoAction(accountId, action)` vào `AdaptiveRateGovernor`, hoặc class mới `FacebookActionVelocityTracker` được inject vào `FacebookActions`.

### EN-2: Merge `share_link_uid` vào `messenger_share`

- **Lý do**: `share_link_uid` chỉ là `messenger_share` với 1 `recipientUid`. Tạo action riêng gây duplicate code và registry.
- **Đề xuất**: Giữ `messenger_share` với `recipientUids: string[]`; nếu caller muốn 1 UID thì truyền mảng 1 phần tử. Có thể giữ `share_link_uid` như alias handler gọi `messengerShare`.

### EN-3: Làm rõ `mediaUrls` trong `post` là reserved, chưa implement

- **Lý do**: Upload media qua Facebook composer rất phức tạp, cần GraphQL file upload. Legacy `postToFacebookGroups` (`api/services/facebookAutomation.js:1603-1609`) cũng để `mediaUrls` "accepted but not yet implemented".
- **Đề xuất**: Sửa AC-5: `mediaUrls` được accept/validate nhưng **text-only trong MVP**, ghi `note` rõ ràng.

### EN-4: Cập nhật `x_facebook_automate` action enum trong `src/mcp/server.js`

- **Dẫn chứng**: `src/mcp/server.js:2871-2873`: `VALID_ACTIONS = ['like', 'comment', 'post', 'messenger']`.
- **Lý do**: Sau 13.9 sẽ có 8 action mới, nhưng MCP tool không có `share`, `join_group`, `send_friend_request`, `messenger_share`, `share_link_uid`.
- **Đề xuất**: Story ghi rõ "MCP routing thuộc 13.10" (đã có) **HOẶC** yêu cầu cập nhật enum `VALID_ACTIONS` ngay trong 13.9 để tool `x_facebook_automate` có thể gọi. Nếu giữ nguyên, ghi chú rõ rủi ro "không có caller".

### EN-5: Thêm `requiresResidential: true` vào mọi write request và bridge

- **Lý do**: `FacebookClient.request()` (`base-client.js:559-561`) truyền `opts.requiresResidential` đến `resolveProxy`, nhưng `FacebookBrowserBridge.#resolveProxy` (`signer-bridge.js:464-497`) không truyền. Write action cần residential proxy.
- **Đề xuất**: `FacebookActions` luôn gọi `client.requestGraphQl(..., { requiresResidential: true })` và mở rộng `FacebookBrowserBridge` để request residential proxy.

### EN-6: Thêm `friendlyNames` cho write `doc_id`

- **Lý do**: `FacebookClient.buildGraphQlBody:473` chỉ set `fb_api_req_friendly_name` khi `this.friendlyNames[docId]` tồn tại.
- **Đề xuất**: Bổ sung `friendlyNames` cho `LIKE_MUTATION`, `COMMENT_MUTATION`, `POST_MUTATION`, `SHARE_MUTATION`, `MESSENGER_SHARE_MUTATION`, `JOIN_GROUP_MUTATION`, `SEND_FRIEND_REQUEST_MUTATION`.

### EN-7: Đưa `resolvePostFeedbackContext` thành public hoặc utility

- **Dẫn chứng**: `FacebookCrawler.#resolvePostFeedbackContext` private (`crawler.js:853-933`). AC-3/AC-6 nói "tái dụng".
- **Đề xuất**: Đổi thành public `resolvePostFeedbackContext` hoặc tách vào `src/scrapers/social/facebook/resolve-post-feedback.js`.

---

## 5. Đề xuất tối ưu (Optimizations)

### OP-1: Tái sử dụng một `page` trong suốt batch thay vì mỗi item một page mới

- **Lý do**: `FacebookBrowserBridge.extractTokens` tạo page mới mỗi lần (`signer-bridge.js:587`). Nếu `like` 20 post, mở 20 browser context/page rất nặng và dễ bị anti-bot.
- **Đề xuất**: `FacebookBrowserBridge.withPage(fn, options)` tạo 1 page, set cookies, chạy `fn(page)` cho từng item, cuối cùng đóng page.

### OP-2: Cache token/lời gọi `ensureTokens` một lần cho cả batch

- **Lý do**: `FacebookClient.ensureTokens` có cache 5 phút (`client.js:40, 243-267`). Nhưng nếu action tự động extract lại mỗi item thì không tận dụng.
- **Đề xuất**: `FacebookActions` gọi `client.ensureTokens(accountId, cookies, { requiresAuth: true })` **một lần** trước batch, sau đó truyền tokens vào `requestGraphQl` hoặc bridge.

### OP-3: Validate toàn bộ input trước khi mở browser / gửi request

- **Lý do**: Fail-fast, tránh mở browser rồi mới phát hiện URL invalid.
- **Đề xuất**: `FacebookActions.<action>` normalize array, validate tất cả `postUrl`/`groupUrl`/`text`, clamp `maxBatch`/`limit`, rồi mới vào vòng lặp real write.

### OP-4: Tách `runGuardedActionBatch` thành module riêng

- **Lý do**: `actions.js` sẽ rất lớn nếu chứa cả batch runner và 8 handlers.
- **Đề xuất**: Tạo `src/scrapers/social/facebook/batch-runner.js` chứa `runGuardedActionBatch`, `enforceActionDelay`, `getActionLimit`, `FacebookActionVelocityTracker`.

### OP-5: Dùng `CrawlCheckpoint` cho write actions mà không gửi `action_result` vào Redis stream

- **Lý do**: `FacebookCrawler.#saveCheckpoint` (`crawler.js:2309-2364`) lặp `items` để gửi Redis stream, truy cập `item.id`, `item.externalId`... Nếu `items` là action results sẽ crash.
- **Đề xuất**: Gọi `#saveCheckpoint(action, targetKey, null, [], false)` cho write actions, hoặc thêm `saveActionCheckpoint` riêng.

---

## 6. Ghi chú cho LLM / Dev Agent

- **Đừng dùng `vi.fn()` / mock**: Test plan yêu cầu real `node:http` server. `FacebookClient` có `httpClient` seam (`base-client.js:57, 570-573`) — cho phép test gắn local `node:http` server mà không mock.
- **Tạo seam cho DOM**: `FacebookBrowserBridge` cần public `withPage` hoặc `evaluateDom` để test khô (dry-run) và integration không phải chạm private fields.
- **Thiết kế `FacebookActions` với dependency injection**: `client`, `governor`, `accountPool`, `proxyProvider`, `runGuardedActionBatch`, `actionVelocityTracker` nên được truyền vào constructor hoặc `crawler` instance để test dễ dàng.
- **Tránh copy-paste `runGuardedBatch` cũ**: Viết mới `runGuardedActionBatch` dùng `PlatformError`, có `governor`, `actionVelocityTracker`, và per-action `delayMin`/`delayMax` clamp.
- **Giữ `dryRun` default `true`**: Dùng `args.dryRun !== false` thay vì `args.dryRun ?? true` để `null`/`undefined` cũng là dry-run (NFR-6).
- **PII strip chỉ log/preview, không strip trước khi gửi**: `text`/`message` gửi lên Facebook phải nguyên vẹn; chỉ strip khi lưu `CrawlCheckpoint`, Redis stream, hoặc trả về `dryRun` preview.
- **Deprecation markers**: Chỉ cần thêm `@deprecated` JSDoc + comment `// LEGACY — see docs/deprecation-plan.md`, không xóa code (theo `docs/deprecation-plan.md:36-45, 75-78`).

---

## 7. Phán quyết cuối cùng

**Verdict: REVISE (Cần chỉnh sửa story trước khi chuyển in-progress).**

Story 13.9 đã có scope rõ ràng, trích dẫn đúng các nguồn, và nắm bắt đúng mục tiêu hybrid. Tuy nhiên, nó chứa nhiều lỗ hổng nghiêm trọng sẽ khiến implementation:

1. Không đạt velocity limits theo giờ/ngày.
2. Không tích hợp được DOM evaluate do `FacebookBrowserBridge` thiếu public API.
3. Có nguy cơ reuse file legacy đang deprecate.
4. Gửi GraphQL write body thiếu các trường anti-bot quan trọng.
5. Mâu thuẫn delay floor với PRD/legacy.
6. Không có cơ chế fallback/rotate doc_id.

**Hành động tiếp theo được đề xuất:**

1. Chỉnh sửa story file (`13-9-...md`) để:
   - Viết rõ `runGuardedActionBatch` mới, không import `api/services/facebookAutomation.js`.
   - Bổ sung `FacebookActionVelocityTracker` / per-action rate limiter.
   - Sửa delay floor theo nhóm (`post` group 30s, `join_group` 30s, `friend_request` 60–180s).
   - Sửa mã lỗi AC-11 (`XACT_4290` vs `XACT_4291`).
   - Đảo ưu tiên `messenger_share` (direct URL → share dialog → GraphQL CTA).
   - Đánh dấu `mediaUrls` reserved.
2. Tạo các task phụ:
   - Mở rộng `FacebookBrowserBridge` public DOM API.
   - Mở rộng `FacebookClient.buildGraphQlBody` / token extraction.
   - Thêm `resolvePostFeedbackContext` public hoặc utility.
3. Sau khi story chỉnh sửa, chạy lại validation checklist rồi mới chuyển `in-progress`.

---

## 8. Phụ lục: Các dòng code tham chiếu chính

| File | Dòng | Ý nghĩa |
|---|---|---|
| `src/scrapers/social/facebook/crawler.js` | 200-222 | `DEFAULT_FB_DOC_IDS` hiện chỉ có read doc_ids, chưa có write mutations. |
| `src/scrapers/social/facebook/crawler.js` | 280-423 | Constructor `FacebookCrawler` đăng ký action, chưa có 8 write actions. |
| `src/scrapers/social/facebook/crawler.js` | 853-933 | `#resolvePostFeedbackContext` private, không tái dùng được. |
| `src/scrapers/social/facebook/crawler.js` | 2309-2364 | `#saveCheckpoint` gửi Redis stream theo `items`, cần cẩn thận với action results. |
| `src/scrapers/social/facebook/client.js` | 40 | `DEFAULT_TOKEN_TTL_MS = 5 phút`. |
| `src/scrapers/social/facebook/client.js` | 184-204 | `browserBridge` khởi tạo khi có `cdpUrl`/`launchChrome`; `#getLazyBrowserBridge` private. |
| `src/scrapers/social/facebook/client.js` | 243-421 | `ensureTokens` và token cache. |
| `src/scrapers/social/facebook/client.js` | 431-476 | `buildGraphQlBody` thiếu `__dyn`/`__csr`/`x_fb_lsd`... |
| `src/scrapers/social/facebook/client.js` | 485-545 | `requestGraphQl` chỉ xử lý 1 `docId`, không rotate. |
| `src/scrapers/social/facebook/client.js` | 547-556 | GraphQL code 368 → `XACT_4290`. |
| `src/scrapers/social/facebook/signer-bridge.js` | 47-121 | `extractFacebookTokensScript` không parse `__dyn`/`__csr`/`__hs`... |
| `src/scrapers/social/facebook/signer-bridge.js` | 464-497 | `#resolveProxy` không truyền `requiresResidential`. |
| `src/scrapers/social/facebook/signer-bridge.js` | 569- | Public methods thiếu DOM evaluate/page lifecycle. |
| `src/core/base-crawler.js` | 151-251 | `start()` chỉ gọi governor một lần. |
| `src/core/base-crawler.js` | 197-238 | Governor hibernation → `XACT_4291`. |
| `src/core/base-client.js` | 184-232 | `resolveProxy` hỗ trợ `requiresResidential`. |
| `src/core/base-client.js` | 506-522 | `request()` gọi `governor.canAccountRequest` + `recordRequest` một lần. |
| `src/core/base-client.js` | 612-619 | Upstream rate limit → `XACT_4290`. |
| `src/core/adaptive-governor.js` | 202-242 | Chỉ tracking 60s, không per-action per-hour. |
| `src/scrapers/facebook/limits.js` | 67-79 | `LIMITS` thiếu nhiều write actions. |
| `src/scrapers/facebook/limits.js` | 189-195 | `enforceDelay` hardcode 5–15s, không phân biệt action. |
| `api/services/facebookAutomation.js` | 93-274 | `runGuardedBatch` legacy: plain `Error`, không governor, `enforceDelay` 5–15s. |
| `api/services/facebookAutomation.js` | 1225, 1472-1548, 1654 | Group/join/friend delay floors 30s/60s. |
| `api/services/facebookAutomation.js` | 1603-1609 | `mediaUrls` reserved, not implemented. |
| `src/mcp/server.js` | 2871-2873 | `x_facebook_automate` `VALID_ACTIONS` thiếu các action mới. |
| `docs/deprecation-plan.md` | 49, 93 | `api/services/facebookAutomation.js` helpers đã `deprecated-marked`. |

---

*Kết thúc báo cáo.*
