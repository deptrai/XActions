# Story 13.9 — BMad Code Review Triage (Step 3)

**Review target:** `_bmad-output/review-13.9.diff`  
**Spec:** `_bmad-output/implementation-artifacts/13-9-facebook-hybrid-social-actions-write-messenger.md`  
**Review mode:** `full`  
**Layers active:** `blind-hunter`, `acceptance-auditor`, `edge-case-hunter`, `verification-gap`

**Method note:** Mọi finding đã được xác nhận bằng cách đọc lại source file tương ứng trong working tree (không chỉ dựa vào diff hunk) trước khi gán mức độ nghiêm trọng và bucket.

---

## Tóm tắt tổng quan

- **Số finding gốc:** Blind Hunter (24), Acceptance Auditor (19), Edge Case Hunter (19), Verification Gap (10)
- **Sau deduplicate:** 28 finding duy nhất
- **Dismissed:** 3 (xem mục cuối)
- **Phán quyết tổng thể:** `REJECT` — cần major rework trước khi merge.

---

## Danh sách finding đã tổng hợp

### 1. Live action handlers chỉ là stub (no-op)

- **id:** 1
- **source:** blind-hunter + acceptance-auditor + verification-gap
- **title:** Tất cả live write actions chỉ `page.goto` rồi trả kết quả giả mạo
- **location:** `src/scrapers/social/facebook/actions.js` (like `:186-209`, comment `:309-318`, post `:421-427`, share `:503-506`, messenger_share `:581-584`, join_group `:690-693`, send_friend_request `:772-775`)
- **detail:** Mỗi action đều có nhánh `dryRun: false` nhưng thực chất chỉ navigate đến target rồi trả `liked/shared/joined/ok = true` hoặc `postId/commentId` fake. Không có click Like, gửi comment, mở composer, mở share dialog, paste link/message, click Join, click Add Friend, hay parse kết quả thật.
- **severity:** high
- **bucket:** patch

### 2. Messenger share thiếu cả 3 fallback path

- **id:** 2
- **source:** blind-hunter + acceptance-auditor
- **title:** `messenger_share` không thực hiện primary/secondary/tertiary path
- **location:** `src/scrapers/social/facebook/actions.js:544-608`
- **detail:** Không paste `postUrl`/`message` vào Messenger composer, không mở share dialog, không dùng `FacebookClient.requestGraphQl` với `MWChatBusinessCTAAdsSenderMutation`. `message` và `recipientNames` được khai báo nhưng bị bỏ qua. Các helper `stripEmojiSurrogates`, `pickRandomSegment` được định nghĩa nhưng không dùng.
- **severity:** high
- **bucket:** patch

### 3. GraphQL write-mutation plumbing chưa được xây dựng

- **id:** 3
- **source:** blind-hunter + acceptance-auditor
- **title:** Anti-bot fields, `friendlyNames`, `fallbackDocIds`, `requiresResidential` cho GraphQL bị thiếu
- **location:** `src/scrapers/social/facebook/client.js:431-475`, `client.js:485-568`, `signer-bridge.js:47-121`, `crawler.js:224-230`
- **detail:** `buildGraphQlBody` không thêm `__dyn`, `__csr`, `__hs`, `__hsdp`, `__hblp`, `__s`, `dpr`, `x_fb_lsd`, `fb_api_req_friendly_name`. `extractFacebookTokensScript` không parse các token này. `friendlyNames` là `{}`, `DEFAULT_FB_DOC_IDS` chứa placeholder, `requestGraphQl` không hỗ trợ `fallbackDocIds`.
- **severity:** high
- **bucket:** patch

### 4. Residential proxy không được yêu cầu cho write session

- **id:** 4
- **source:** acceptance-auditor + blind-hunter
- **title:** Không có `requiresResidential: true` trên bridge/GraphQL cho write actions
- **location:** `src/scrapers/social/facebook/actions.js` (các `withPage` call), `signer-bridge.js:464-497`, `client.js:623-642`
- **detail:** Mọi action live đều gọi `bridge.withPage(fn, { accountId, cookies })` mà không truyền `requiresResidential`. `#resolveProxy` không nhận/cấu hình residential. `client.requestGraphQl` không bao giờ được gọi từ actions.
- **severity:** high
- **bucket:** patch

### 5. `withPage` tạo page mới cho mỗi item, thiếu `evaluateDom`, không tái sử dụng page trong batch

- **id:** 5
- **source:** blind-hunter + acceptance-auditor + edge-case-hunter
- **title:** `FacebookBrowserBridge.withPage` không tái sử dụng page trong suốt batch
- **location:** `src/scrapers/social/facebook/signer-bridge.js:945-972`
- **detail:** Mỗi lần `withPage` gọi `adapter.newPage(browser, { preserveProfile: false })` và đóng ở `finally`. Do `runGuardedActionBatch` gọi `withPage` mỗi item, một batch 30 like sẽ tạo 30 page. Không có `evaluateDom` public. Đây là vi phạm OP-1 và AC-17.
- **severity:** high
- **bucket:** patch
- **decision:** Option 1 — mỗi action gọi `bridge.withPage` một lần cho cả batch; `runGuardedActionBatch` nhận `options.page` và truyền vào `fn(item, i, { page })`; `withPage` tạo 1 page, set cookies, chạy `fn(page)`, cuối cùng đóng page (OP-1, AC-17).

### 6. `runGuardedActionBatch` không clamp delay theo action floor

- **id:** 6
- **source:** blind-hunter + acceptance-auditor + edge-case-hunter
- **title:** Caller có thể bypass delay floor bằng `delayMin: 0, delayMax: 0`
- **location:** `src/scrapers/social/facebook/batch-runner.js:114-121`, `batch-runner.js:158-159`
- **detail:** `enforceActionDelay` chỉ clamp `min >= 0` và `max >= min`; `runGuardedActionBatch` dùng `delayMin`/`delayMax` từ caller trực tiếp mà không so sánh với `ACTION_LIMITS` floor. `send_friend_request` có thể bị gọi với `0ms` delay.
- **severity:** high
- **bucket:** patch

### 7. `FacebookActionVelocityTracker` không đúng contract và ghi sai mã lỗi

- **id:** 7
- **source:** acceptance-auditor + edge-case-hunter
- **title:** Velocity tracker thiếu `getActionLimit`, dùng `XACT_4290` thay vì `XACT_4291`
- **location:** `src/scrapers/social/facebook/batch-runner.js:37-106`, `batch-runner.js:182-189`
- **detail:** Spec yêu cầu `canDoAction`/`recordAction`/`getActionLimit`. Code dùng `canExecute`/`record`, không có `getActionLimit`. Khi vượt giới hạn ném `XACT_4290` trong khi spec quy định `XACT_4291` cho velocity/hibernation, `XACT_4290` dành cho upstream rate-limit.
- **severity:** high
- **bucket:** patch

### 8. Mã lỗi / `suggestedAction` không khớp spec

- **id:** 8
- **source:** acceptance-auditor
- **title:** `XACT_4010`, `XACT_5030` dùng sai `suggestedAction`; `XACT_4290` bị dùng cho velocity
- **location:** `src/scrapers/social/facebook/actions.js:129`, `actions.js:212-219` (và các action tương tự), `batch-runner.js:183`
- **detail:** `XACT_4010` thiếu auth phải `suggestedAction: 'relogin'`, code dùng `ROTATE_ACCOUNT`. `XACT_5030` (không có bridge) phải `suggestedAction: 'wait'`, code dùng `ROTATE_ACCOUNT`. Velocity breach phải `XACT_4291`.
- **severity:** high
- **bucket:** patch

### 9. `assertFacebookUrlLocal` trong `actions.js` quá yếu và trùng lặp với `core.js`

- **id:** 9
- **source:** blind-hunter + acceptance-auditor + edge-case-hunter + verification-gap
- **title:** Có hai `assertFacebookUrlLocal` khác nhau, bản mới yếu hơn
- **location:** `src/scrapers/social/facebook/actions.js:21-35`, `src/scrapers/facebook/core.js:348-367`, `src/scrapers/social/facebook/crawler.js:31`
- **detail:** `actions.js` định nghĩa guard trả `boolean`, chấp nhận `fb.com`, `messenger.com`, `fb.watch`, đường dẫn tương đối `/`, và chỉ check `g.includes('/groups/')` (có thể bị đánh lừa bởi query). `core.js` có guard ném lỗi, chỉ chấp nhận `facebook.com`. `crawler.js` import bản `core.js`; write actions dùng bản `actions.js` -> drift.
- **severity:** high
- **bucket:** patch

### 10. `resolvePostFeedbackContext` public nhưng không được dùng

- **id:** 10
- **source:** blind-hunter + acceptance-auditor
- **title:** `resolvePostFeedbackContext` public nhưng actions không gọi
- **location:** `src/scrapers/social/facebook/crawler.js:2981-2983`, `actions.js:186-209` (like), `actions.js:309-318` (comment), `actions.js:503-506` (share)
- **detail:** Hàm đã được public nhưng `like`, `comment`, `share` không gọi để lấy `feedback_id` cho GraphQL path. AC-19 yêu cầu tái sử dụng.
- **severity:** high
- **bucket:** patch

### 11. `runGuardedActionBatch` ghi lại request kể cả khi item thất bại

- **id:** 11
- **source:** blind-hunter
- **title:** Failed items vẫn được ghi vào governor và velocity tracker
- **location:** `src/scrapers/social/facebook/batch-runner.js:210-218`
- **detail:** Sau khi `fn` throw và bị catch thành `{ ok: false, error: ... }`, runner vẫn gọi `governor.recordRequest` và `velocityTracker.record` nếu `!dryRun`, làm tăng sai số lượng hành động đã thực hiện.
- **severity:** high
- **bucket:** patch

### 12. Comment action không chọn `group_comment` delay floor và không submit

- **id:** 12
- **source:** acceptance-auditor + edge-case-hunter
- **title:** `comment` luôn dùng `actionName: 'comment'` 3–7s, không dùng `group_comment` 5–15s
- **location:** `src/scrapers/social/facebook/actions.js:247-343`, `batch-runner.js:23-24`
- **detail:** `ACTION_LIMITS.group_comment` đã định nghĩa nhưng không bao giờ được chọn. Comment không press Enter/click send, trả `commentId` fake.
- **severity:** high
- **bucket:** patch

### 13. `post` action không mở composer, không submit, `mediaUrls` không xử lý, `maxBatch` thiếu `force`

- **id:** 13
- **source:** blind-hunter + acceptance-auditor + edge-case-hunter
- **title:** `post` live path là no-op, `mediaUrls` ignored, `maxBatch` không có `force`
- **location:** `src/scrapers/social/facebook/actions.js:358-451`
- **detail:** Chỉ `page.goto(targetUrl)` rồi trả `post_${Date.now()}`. `mediaUrls` được chấp nhận nhưng không đọc/validate. `maxBatch` bị clamp cứng 20, không có `force` để vượt giới hạn. `isGroup` dựa trên bất kỳ target nào chứa `/groups/`, có thể ép delay 30–90s cho profile post trong batch hỗn hợp.
- **severity:** high
- **bucket:** patch

### 14. `share`, `messenger_share`, `join_group` bỏ qua `maxBatch` và `message`

- **id:** 14
- **source:** blind-hunter + acceptance-auditor + edge-case-hunter
- **title:** `share`, `messenger_share`, `join_group` không clamp `maxBatch`
- **location:** `src/scrapers/social/facebook/actions.js:464-506` (share), `actions.js:544-608` (messenger), `actions.js:640-714` (join)
- **detail:** Ba action này truyền toàn bộ mảng vào `runGuardedActionBatch` mà không slice. `runGuardedActionBatch` cũng không hỗ trợ `maxBatch` từ bên trong. `share` và `messenger_share` cũng bỏ qua `message`.
- **severity:** high
- **bucket:** patch

### 15. `join_group` và `send_friend_request` bỏ qua các tham số quan trọng

- **id:** 15
- **source:** acceptance-auditor + blind-hunter + edge-case-hunter
- **title:** `join_group` bỏ qua `keyword`, `limit`, `maxBatch`; `send_friend_request` bỏ qua `mode`, `location`
- **location:** `src/scrapers/social/facebook/crawler.js:513-522` (join registry), `actions.js:630-714` (join handler), `crawler.js:524-533` (friend registry), `actions.js:719-798` (friend handler)
- **detail:** `join_group` khai báo `requiredArgs: []` mặc dù spec yêu cầu `groupUrls` hoặc `groupIds`. `keyword`, `limit`, `maxBatch` không dùng. `send_friend_request` không dùng `mode`/`location`.
- **severity:** medium
- **bucket:** patch

### 16. Per-item error isolation trả object thường thay vì `PlatformError`

- **id:** 16
- **source:** acceptance-auditor
- **title:** `runGuardedActionBatch` catch non-PlatformError trả `{ item, ok: false, error }` không khớp output contract
- **location:** `src/scrapers/social/facebook/batch-runner.js:202-207`
- **detail:** Kết quả lỗi không chứa các field theo `outputType` (vd `postUrl`, `recipientUid`) và không phải `PlatformError`.
- **severity:** medium
- **bucket:** patch

### 17. `FacebookActions` không resolve sticky residential proxy

- **id:** 17
- **source:** acceptance-auditor
- **title:** `proxyPool` được inject nhưng không gọi `getStickyProxy` với `requiresResidential`
- **location:** `src/scrapers/social/facebook/actions.js:81-100`
- **detail:** `FacebookActions` nhận `proxyPool` nhưng không dùng. Proxy resolution hoàn toàn ủy thác cho `client`/`bridge` mà không truyền residential flag.
- **severity:** high
- **bucket:** patch

### 18. `send_friend_request` regex quá permissive

- **id:** 18
- **source:** blind-hunter + edge-case-hunter
- **title:** Regex target cho friend request chấp nhận `...` và dấu chấm cuối
- **location:** `src/scrapers/social/facebook/actions.js:746-757`
- **detail:** `/^[a-zA-Z0-9.]{3,50}$/` chấp nhận chuỗi toàn dấu chấm hoặc kết thúc bằng dấu chấm.
- **severity:** medium
- **bucket:** patch

### 19. `share_link_uid` output shape không khớp AC-1

- **id:** 19
- **source:** acceptance-auditor
- **title:** `share_link_uid` trả `{ results: [...], dryRun }` thay vì object đơn
- **location:** `src/scrapers/social/facebook/crawler.js:502-511`, `actions.js:619-628`
- **detail:** AC-1 quy định `share_link_uid` output là `{ ok, postUrl, recipientUid, method?, error? }`. Hiện tại alias này gọi `messengerShare` và trả cấu trúc mảng.
- **severity:** medium
- **bucket:** patch

### 20. `stripEmojiSurrogates` lược bỏ cả ký tự non-emoji

- **id:** 20
- **source:** blind-hunter
- **title:** Regex surrogate pair xóa CJK Extension B, ký hiệu toán học cùng emoji
- **location:** `src/scrapers/social/facebook/actions.js:54-57`
- **detail:** `/[\uD800-\uDBFF][\uDC00-\uDFFF]/g/` xóa mọi ký tự Unicode supplementary-plane, không chỉ emoji.
- **severity:** low
- **bucket:** patch

### 21. `client.ensureBrowserBridge` bỏ qua `profileDir` khi `userDataDir` rỗng

- **id:** 21
- **source:** edge-case-hunter
- **title:** `ensureBrowserBridge` không dùng `profileDir` làm `userDataDir`
- **location:** `src/scrapers/social/facebook/client.js:623-642`
- **detail:** Constructor `#createBrowserBridge` dùng `userDataDir || profileDir`, nhưng `ensureBrowserBridge` tách riêng `userDataDir` và `profileDir` -> profile bị bỏ qua nếu chỉ set `profileDir`.
- **severity:** medium
- **bucket:** patch

### 22. `shareLinkByUid.js` vẫn import từ `api/services/facebookAutomation.js`

- **id:** 22
- **source:** acceptance-auditor
- **title:** Legacy scraper vẫn import từ file `deprecated-marked`
- **location:** `src/scrapers/facebook/shareLinkByUid.js:19`
- **detail:** Mặc dù file được gắn `@deprecated`, nó vẫn import `runGuardedBatch` từ `api/services/facebookAutomation.js`, vi phạm AC-16.
- **severity:** medium
- **bucket:** patch

### 23. Test coverage chỉ kiểm tra dry-run, thiếu verify live path / delay / governor

- **id:** 23
- **source:** verification-gap + acceptance-auditor
- **title:** Tests không cover live DOM, delay floor, governor/tracker recording, PII, group_post, metadata
- **location:** `tests/scrapers/social/facebook/crawler-actions.test.js`
- **detail:** 13 test đều chạy `dryRun: true`; không có test `dryRun: false` với fake `FacebookBrowserBridge` để verify `withPage` được gọi. Không kiểm tra `governor.recordRequest`/`velocityTracker.record`, `enforceActionDelay` kết quả, `group_post` action name, `previewText` PII, `maxBatch` clamp, metadata registry, `fallbackDocIds`, anti-bot fields.
- **severity:** high
- **bucket:** patch

### 24. `tests/crawler-actions.test.js` dùng `mockGov` stub, vi phạm “no mocks/stubs”

- **id:** 24
- **source:** acceptance-auditor
- **title:** Test dùng `mockGov` thay vì `AdaptiveRateGovernor` thật
- **location:** `tests/scrapers/social/facebook/crawler-actions.test.js:149-155`
- **detail:** `CLAUDE.md`/`AGENTS.md` cấm mock/stub. Test dùng `mockGov` với `canAccountRequest`/`recordRequest` no-op.
- **severity:** medium
- **bucket:** patch

### 25. `crawler-actions.test.js` tên file không khớp spec

- **id:** 25
- **source:** acceptance-auditor
- **title:** Tên test file `crawler-actions.test.js` khác với `crawler-social-actions.test.js` trong spec
- **location:** `tests/scrapers/social/facebook/crawler-actions.test.js`
- **detail:** AC-13 và file list đặt tên `crawler-social-actions.test.js`. Đã tạo `crawler-actions.test.js`.
- **severity:** low
- **bucket:** patch

### 26. `DEFAULT_FB_DOC_IDS` write mutation placeholders không được dùng

- **id:** 26
- **source:** verification-gap
- **title:** Placeholder `LIKE_MUTATION`... không được tham chiếu trong actions hay tests
- **location:** `src/scrapers/social/facebook/crawler.js:224-230`
- **detail:** Các placeholder được thêm nhưng không có code nào sử dụng, không có test khẳng định.
- **severity:** medium
- **bucket:** defer

### 27. PII strip khác nhau giữa `actions.js` và `crawler.js`

- **id:** 27
- **source:** blind-hunter
- **title:** `stripPii` trong `actions.js` và `crawler.js` dùng regex/replacement khác nhau
- **location:** `src/scrapers/social/facebook/actions.js:42-47`, `crawler.js:237-249`
- **detail:** Cùng một dữ liệu có thể bị redact khác nhau tùy code path. Nên thống nhất thành một utility.
- **severity:** low
- **bucket:** patch

### 28. `api/services/facebookAutomation.js` không được gắn `@deprecated` trong file

- **id:** 28
- **source:** blind-hunter (clarified)
- **title:** File `facebookAutomation.js` thiếu marker `@deprecated`/`LEGACY` trong header
- **location:** `api/services/facebookAutomation.js:1-3`
- **detail:** Deprecation plan đánh dấu status `deprecated-marked` nhưng file source vẫn chỉ có BSL header, không có `// LEGACY` hay `@deprecated`.
- **severity:** low
- **bucket:** patch

---

## Dismissed findings

| id | source | lý do dismiss |
|---|---|---|
| D1 | blind-hunter | License header Apache 2.0 không nhất quán với BSL 1.1 — root `LICENSE` là Apache 2.0 và hầu hết `src/` cũng Apache 2.0; chỉ legacy files mới BSL 1.1. Không phải issue. |
| D2 | blind-hunter | `docs/deprecation-plan.md` không xuất hiện trong diff — file đã được cập nhật trong working tree (mapping table và status tracker đã tồn tại), không thuộc phạm vi diff này. |
| D3 | blind-hunter | `crawler-actions.test.js:1886` không tồn tại (file chỉ có 433 dòng), là line number sai/hallucinated. |

---

## Phân bố severity & bucket

| severity | count | bucket | count |
|---|---|---|---|
| high | 17 | patch | 25 |
| medium | 8 | decision_needed | 1 |
| low | 3 | defer | 1 |
|  |  | dismissed | 3 |

---

## Verdict tổng thể

`REJECT / NEEDS MAJOR REWORK`

Cần major rework trên toàn bộ live action handlers, GraphQL write plumbing, bridge page reuse, delay floor enforcement, velocity/error contract, SSRF guard, proxy residential wiring, và test coverage trước khi merge.
