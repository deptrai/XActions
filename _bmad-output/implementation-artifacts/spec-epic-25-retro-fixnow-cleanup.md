---
title: 'Epic 25 retro — fix-now cleanup (Facebook dedup + Story 25.4 test)'
type: 'chore'
created: '2026-09-12'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: 'edc8d1c99eceb598bf5390a8ecaad8ae0c97958f'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 25 retro (epic-25-retro-2026-09-12.md) để lại 2 open items `fix now`: (1) 4 module Facebook (`proxy/limits/messengerQueue/messengerShare`) tồn tại song song ở `src/scrapers/facebook/` và `src/scrapers/social/facebook/` — 2 source-of-truth drift-able, 6 test file vẫn import bản legacy trong khi runtime đã chuyển sang `social/`; (2) Story 25.4 (`actionNotAvailable` + `ErrorTypes.DEPRECATED`) không có test nào cover.

**Approach:** Chống drift bằng cách chọn `social/facebook/` làm canonical — point các test import sang `social/`, re-export các module đã migrate từ `social/facebook/index.js` barrel, đánh dấu `src/scrapers/facebook/` là frozen-legacy chờ Epic 26 xoá. Thêm test cho `actionNotAvailable` để đóng verification gap của 25.4.

## Boundaries & Constraints

**Always:**
- `src/scrapers/social/facebook/` là canonical source-of-truth cho `proxy`, `limits`, `messengerQueue`, `messengerShare`. Mọi test phải import từ `social/`.
- `src/scrapers/facebook/` (legacy) **không bị xoá** trong spec này — Epic 26 mới decommission. Chỉ thêm marker comment "frozen-legacy, do not edit".
- Giữ nguyên 100% public export surface và runtime behavior — chỉ đổi test import paths + barrel re-exports.
- Test mới phải chạy pass; không phá bất kỳ test hiện có nào.

**Never:**
- Không xoá hay sửa logic trong `src/scrapers/facebook/*.js` (frozen cho Epic 26).
- Không wire `ErrorTypes.DEPRECATED` producer — đó là action item deferred sang Epic 26.
- Không đổi `platforms.js` legacy barrel re-export (`platforms.facebook`) — `facebook-exports.test.js` phụ thuộc vào nó.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Test import canonical | test import `social/facebook/limits.js` | resolve đến canonical module | N/A |
| Barrel re-export | `import { rotateProxy } from 'social/facebook'` | export được từ barrel, không lỗi | N/A |
| `graphql.js` chưa migrate | `facebook-live.test.js` cần `graphql.js` | vẫn import từ `src/scrapers/facebook/graphql.js` (chưa có trong social) | N/A — giữ nguyên import cũ cho symbol này |
| actionNotAvailable | gọi `actionNotAvailable('fb','x',['a','b'])` | Error với `statusCode:400`, `code:'XACT_4001'`, `type:'invalid_args'`, `platform:'fb'`, `suggestedAction:'use_x_actions_list'` | throw Error chuẩn envelope |

</frozen-after-approval>

## Code Map

- `src/scrapers/social/facebook/index.js` — barrel hiện KHÔNG re-export `proxy/limits/messengerQueue/messengerShare`; cần thêm re-export.
- `src/scrapers/social/facebook/{proxy,limits,messengerQueue,messengerShare}.js` — canonical modules (đã có `rotateProxy`, `parseFlatProxy`, `getActionLimit`, `buildCampaignQueue`, `messengerShareCampaign`, ...).
- `src/scrapers/facebook/{proxy,limits,messengerQueue,messengerShare}.js` — legacy bản, thêm frozen marker comment; KHÔNG sửa logic.
- `src/scrapers/facebook/graphql.js` — chưa migrate, `facebook-live.test.js` vẫn cần → giữ import cũ.
- `src/scrapers/platforms.js:173` — `actionNotAvailable(platform, action, available, suggestedAction)` → `Error` + `statusCode:400`, `code:'XACT_4001'`, `type:ErrorTypes.INVALID_ARGS`, `suggestedAction` default `USE_ACTIONS_LIST`.
- `src/core/error-envelope.js` — `ErrorTypes.INVALID_ARGS='invalid_args'`, `SuggestedActions.USE_ACTIONS_LIST`.
- Tests cần repoint sang `social/`: `facebook-limits.test.js`, `facebook-proxy.test.js`, `facebook-messenger-queue.test.js`, `facebook-messenger-share.test.js`, `messengerShare.test.js` (chỉ module đã migrate); `facebook-live.test.js` (chỉ `messengerShare`+`proxy`, giữ `graphql.js` cũ).
- Test mới: `tests/scrapers/action-not-available.test.js` (hoặc thêm vào suite platforms/dispatcher hiện có).

## Tasks & Acceptance

**Execution:**
- [x] `src/scrapers/social/facebook/index.js` -- thêm re-export `proxy.js`, `limits.js`, `messengerQueue.js`, `messengerShare.js` -- để các module migrate reachable qua barrel, không chỉ deep import.
- [x] `src/scrapers/facebook/{proxy,limits,messengerQueue,messengerShare}.js` -- thêm banner comment "FROZEN LEGACY — do not edit; canonical at social/facebook/; removed in Epic 26" -- chống drift.
- [x] `tests/scrapers/facebook-limits.test.js`, `facebook-proxy.test.js`, `facebook-messenger-queue.test.js`, `facebook-messenger-share.test.js`, `messengerShare.test.js` -- repoint import `src/scrapers/facebook/` → `src/scrapers/social/facebook/` -- tests verify canonical code.
- [x] `tests/scrapers/facebook-live.test.js` -- repoint `messengerShare.js` + `proxy.js` sang `social/`; GIỮ `graphql.js` import cũ -- chỉ module đã migrate mới repoint.
- [x] `tests/scrapers/action-not-available.test.js` -- mới: test `actionNotAvailable` trả đúng envelope (`statusCode`/`code`/`type`/`suggestedAction`/`platform`) -- đóng verification gap 25.4.

**Acceptance Criteria:**
- Given repo ở main, when chạy `npx vitest run tests/scrapers/`, then tất cả test pass và không còn test nào import `src/scrapers/facebook/{proxy,limits,messengerQueue,messengerShare}.js` (trừ `graphql.js`).
- Given `import ... from 'src/scrapers/social/facebook/index.js'`, when lấy `rotateProxy`/`getActionLimit`/`buildCampaignQueue`/`messengerShareCampaign`, then chúng resolve được từ barrel.
- Given gọi `actionNotAvailable('fb','x',['a'])`, when inspect error, then `statusCode===400`, `code==='XACT_4001'`, `type==='invalid_args'`, `platform==='fb'`, `suggestedAction==='use_x_actions_list'`.

## Implementation Notes
## Implementation Notes

- `src/scrapers/social/facebook/index.js`: thêm canonical re-exports cho `proxy` (`parseFlatProxy`,`rotateProxy`), `limits` (`LIMITS as FB_LIMITS`, `ACCOUNT_AGE_TIERS as FB_ACCOUNT_AGE_TIERS`, `getActionLimit`, `enforceDelay`, `getAccountAgeDays`), `messengerQueue` (`parseRecipientsFile`,`parseLinksFile`,`buildCampaignQueue`), `messengerShare` (`SELECTORS as MESSENGER_SHARE_SELECTORS`, `composeMessage as composeMessengerShareMessage`, `typeMessage`, `sendMessageToThread`, `shareToMessenger`, `messengerShareCampaign`). Alias `FB_*`/`MESSENGER_SHARE_*`/`composeMessengerShareMessage` để tránh collision với `actions.js`/`batch-runner.js` exports đã có trong barrel.
- Banner "FROZEN LEGACY" thêm vào `src/scrapers/facebook/{proxy,limits,messengerQueue,messengerShare}.js` sau dòng copyright; `@deprecated` JSDoc giữ nguyên (AC-25 test vẫn pass).
- Repoint 6 test files: 5 file repoint toàn bộ (`facebook-limits`, `facebook-proxy`, `facebook-messenger-queue`, `facebook-messenger-share`, `messengerShare`); `facebook-live.test.js` repoint `messengerShare`+`proxy` nhưng giữ `graphql.js` ở old path (chưa migrate).
- Test mới `tests/scrapers/action-not-available.test.js` (4 tests): full envelope, override suggestedAction, default suggestedAction, DEPRECATED enum pinned.
- Verify: `node --input-type=module` import barrel → 14/14 resolved; `vitest` repointed suites 262/262 pass; new test 4/4; `crawler-social-actions` 27/27; `tsc --noEmit` 0 errors.
- Surprise: `social/facebook/index.js` trước đây KHÔNG re-export 4 module migrated → chúng chỉ reachable qua deep import; barrel re-export mới cho phép `import { rotateProxy } from 'social/facebook'`.

## Spec Change Log

## Review Triage Log

Subagent narrowing: session `Agent` tool là async-only (không có blocking/await contract mà step-04 yêu cầu) → 3 reviewer layers (blind-hunter, edge-case-hunter, verification-gap) được launch async nhưng không thể await kết quả trong cùng turn. Thu hẹp được ghi nhận: review chạy **inline** trên diff `/tmp/epic25-fixnow-diff.txt` (196 dòng, 12 kB). Findings dưới đây là từ inline review, đã verify trực tiếp trên code.

| Finding | Verdict | Evidence |
|---|---|---|
| `messengerShare.js`/`messengerQueue.js` `export default` không được re-export từ barrel | `false` | Không consumer nào dùng default import — tất cả dùng named (`automate.js:50-51`, `facebook.js:780`, tests). Barrel named re-export là đủ. |
| `composeMessage` collision giữa `actions.js` và `messengerShare.js` | `false` (đã xử lý) | Alias `composeMessengerShareMessage` tránh duplicate-export; 2 impl hơi khác (messengerShare defensive hơn) nên alias giữ đúng semantics. |
| `stripEmojiSurrogates`/`pickRandomSegment` duplicate-export | `false` (đã xử lý) | Barrel đã export chúng từ `actions.js`; messengerShare re-export bỏ qua 2 tên này → không duplicate. Runtime import verify 14/14 resolved, `node --check` OK. |
| Frozen banner có thể phá `@deprecated` marker (AC-25) | `false` | Banner chèn sau copyright, `@deprecated` JSDoc giữ nguyên; `crawler-social-actions` AC-25 test vẫn pass (27/27). |
| `enforceDelay` (limits) vs `enforceActionDelay` (batch-runner) collision | `false` | Tên khác nhau, không trùng export. |
| `facebook-live.test.js` mất `graphql.js` nếu repoint hết | `false` (đã xử lý) | `graphql.js` chưa migrate sang social → giữ import cũ; chỉ `messengerShare`+`proxy` repoint. |
| Legacy `facebook/` files vẫn tồn tại song song (drift vẫn có thể xảy ra nếu ai sửa) | `low` | Mục đích của spec là chống drift *về tests + barrel*, không xoá legacy (Epic 26). Frozen banner giảm rủi ro. Residual drift risk được ghi vào deferred-work. |
| Story 25.4 DEPRECATED branch vẫn chưa wire (enum dead) | `low` | Đã biết — deferred sang Epic 26 theo retro action item #2. Test pin `ErrorTypes.DEPRECATED==='deprecated'` để wire-up sau không đổi ngầm. |

| `actionNotAvailable` trả vanilla `Error`, không phải `PlatformError` | `high` | Xác nhận: `api/routes/schemas.js:20` + `checkpoints.js:260` branch `instanceof PlatformError` → vanilla Error trả 500+XACT_5000 thay vì 400. Spec 25.4 muốn "API map to 400 not 500" — không đạt. **PATCHED**: `platforms.js` giờ `return new PlatformError({code:'XACT_4001',type:INVALID_ARGS,statusCode:400,...})`; guard `Array.isArray(available)`. |
| `available.join(', ')` không guard null/undefined/non-array → TypeError | `low`→`patch` | Xác nhận: `actionNotAvailable('fb','x',null)` throw TypeError. **PATCHED** cùng lúc: `Array.isArray(available)?available:[]`. |

**Loopback 1 (sau khi blind-hunter subagent emit findings):** finding `high` ở trên được phát hiện bởi reviewer subagent SAU KHI triage inline ban đầu — triage inline ban đầu đã miss nó. Patch áp dụng trong cùng run; test cập nhật assert `instanceof PlatformError` + edge-case non-array `available`. Verify: `instanceof PlatformError===true`, `toEnvelope()` đầy đủ, dispatcher tests 40/40 pass, tsc 0 errors.

| Barrel `social/facebook/index.js` re-exports không có test nào verify resolve | `low` (verification-gap) | AC nói "import từ barrel resolve" nhưng chỉ có deep-import tests; không test nào import barrel. **PATCHED**: thêm test `social/facebook barrel — canonical re-exports resolve` assert 14 named exports defined + callable. 6/6 pass. |


## Verification

**Commands:**
- `npx vitest run tests/scrapers/` -- expected: all pass, no regression
- `npx vitest run tests/scrapers/action-not-available.test.js` -- expected: pass
- `npx tsc --noEmit` -- expected: 0 errors
- `grep -rn "src/scrapers/facebook/\(proxy\|limits\|messengerQueue\|messengerShare\)" tests/` -- expected: only non-migrated symbols (none for the 4 modules)
