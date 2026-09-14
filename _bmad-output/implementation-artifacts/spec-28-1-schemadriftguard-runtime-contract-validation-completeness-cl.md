---
title: 'Story 28.1 — SchemaDriftGuard: Runtime Contract Validation & Completeness Classification'
type: 'feature'
created: '2026-09-13'
status: 'done'
route: 'dispatch'
baseline_commit: 'c44265ed'
review_loop_iteration: 1
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Crawler XActions hiện chỉ kiểm tra tối thiểu `id`/`platform`/`category` trong `AbstractCrawler.validateItem` — một item thiếu trường bắt buộc (`authorId`, `content`) hoặc sai kiểu (`likesCount` là string) vẫn được lưu xuống store, khiến downstream nhận dữ liệu rỗng/malformed một cách âm thầm.

**Approach:** Thêm `SchemaDriftGuard` (`src/core/schema-drift-guard.js`) — validate runtime item `PostItem`/`ProfileItem`/`CommentItem` theo JSON Schema, chấm điểm completeness `[0,100]` deterministic và phân loại `complete | degraded | corrupted`. `degraded` lưu kèm `dataQuality` metadata; `corrupted` ném `PlatformError` mới `ErrorTypes.DEGRADED_DATA`. Wire vào `AbstractCrawler.validateItem` — tái dùng `validateSchemaNode` engine có sẵn, **zero new dependencies**.

**Decisions (đã chốt trong spec):**
- **Score formula (capped):** `score = max(0, 100 − 35×missingRequired − 15×typeErrors − min(20, 5×missingOptional))`. `corrupted` khi `missingRequired > 0` hoặc `typeErrors > 0` hoặc `score < 70`. `complete` khi `missingRequired=0 ∧ typeErrors=0 ∧ missingOptional=0`. Còn lại → `degraded`. **Cap `missingOptional` ở 20 điểm** vì PostItem có 11+ optional field — thiếu optional một mình KHÔNG BAO GIỜ được kéo score <70 (tránh false-corrupted cho crawler không populate engagement metrics).
- **Item-type inference (sửa blocker B1):** `validateItem(item)` không có action context → guard suy type bằng discriminator, KHÔNG dùng truthiness `content` (media-only post có `content===''`):
  - `postId` present (own prop) → `comment-item`
  - `authorId` present OR `category` present → `post-item` (PostItem required `authorId`+`category`; ProfileItem không có cả hai)
  - còn lại → `profile-item`
  Subclass override qua `getItemSchemaType(item)`. **Lý do:** PostItem thiếu `content` vẫn có `authorId`+`category` → vẫn bị bắt đúng, không lọt sang ProfileItem.
- **Validation engine & error counting (sửa blocker B4):** export `validateSchemaNode` từ `metadata-schema-registry.js`. Đã verify: emit `"<path>.<field> is required"` cho required vắng; optional vắng **không** emit lỗi. Guard đếm: `missingRequired` = số lỗi match `/\.([^.]+) is required$/` **(loại các lỗi này khỏi typeErrors để tránh double-count)**; `missingOptional` = optional `properties` key vắng trong data; `typeErrors` = mọi lỗi còn lại (`must be of type`, `must be one of`, `must match pattern`, `>=`/`<=`).
- **Schema lookup resolution (sửa blocker B5):** guard resolve schema theo thứ tự `${platform}:${schemaType}` → fallback `items:${schemaType}`. Chỉ no-op `complete` khi **cả hai** đều vắng. Vì `items:*` luôn tồn tại sau khi load, no-op chỉ xảy ra khi `schemaType` không map tới schema nào — AC "platform chưa có schema" test bằng platform chưa override + schemaType lạ.
- **Schema type unions (sửa blocker B3):** item schemas khai `crawledAt`/`publishedAt` dạng `"type": ["object","string"]` (Date là object, chấp nhận cả ISO string); `authorAvatar`/`publishedAt` nullable → `"type": ["string","null"]` / `["object","string","null"]`. Không dùng `"type":"string"` đơn cho timestamp/avatar — `typeof new Date() === 'object'` sẽ fail mọi item hợp lệ.
- **API (sửa concern):** guard expose `validate(platform,item,{schemaType})` → `{classification,score,missingFields,typeErrors}` (pure, không throw) VÀ `validateOrThrow(...)` → ném `PlatformError` khi `corrupted`. `base-crawler.validateItem` gọi **`validateOrThrow`**.
- **Item-level schemas mới:** `schemas/items/{post-item,profile-item,comment-item}.json` — canonical contract cho 3 item types (không phải metadata). Load qua `loadSchemasFromDisk` có sẵn; registry key dạng `items:post-item`.
- **New error enums:** thêm `ErrorTypes.DEGRADED_DATA = 'degraded_data'` và `SuggestedActions.RETRY_WITH_DIFFERENT_ACCOUNT = 'retry_with_different_account'` vào `error-envelope.js`.
- **Degraded metadata:** gắn `item.dataQuality = { score, missingFields, classification: 'degraded' }` trước khi lưu.

## Boundaries & Constraints

**Always:**
- Score `[0,100]` deterministic theo formula capped đã chốt (`missingOptional` ≤20). `corrupted` khi `missingRequired>0 ∨ typeErrors>0 ∨ score<70`; `complete` khi `missingRequired=0 ∧ typeErrors=0 ∧ missingOptional=0`; còn lại `degraded`.
- `corrupted` → `validateOrThrow` ném `PlatformError` `{ type: ErrorTypes.DEGRADED_DATA, suggestedAction: SuggestedActions.RETRY_WITH_DIFFERENT_ACCOUNT, platform: this.name, details: { score, missingFields, typeErrors } }`.
- `degraded` → gắn `item.dataQuality = { score, missingFields, classification:'degraded' }`, KHÔNG ném — item vẫn lưu.
- Guard no-op `complete` chỉ khi cả `${platform}:${type}` lẫn `items:${type}` đều vắng — backward compatible.
- Giữ nguyên validation hiện có của `validateItem` (id/platform/category) — guard chạy SAU các check đó.
- Item schemas phải dùng union types cho `Date`/nullable fields (`crawledAt`,`publishedAt`,`authorAvatar`) — `typeof Date==='object'`.
- Test real impl — no mocks/stubs/fakes. TypeScript strict — update `types/core.d.ts`.

**Never:**
- Không thêm Zod/Ajv hay bất kỳ dependency schema-validation nào — tái dùng `validateSchemaNode`.
- Không sửa `MetadataSchemaRegistry` internals ngoài việc `export` thêm `validateSchemaNode` (và export named `MetadataSchemaRegistry` class nếu cần type).
- Không thay đổi `validateSchemaNode` signature/semantics — guard wrap nó, không viết lại.
- Không gọi network/external service trong `validate()`. Không migrate hay đổi schema `metadata` platform-level hiện có.
- Không để `corrupted` item lọt vào store — throw trước `storeBatch`. **Fail-fast:** `validateItem` ném trong vòng lặp persist → abort cả batch (đúng intent AC: một item hỏng = contract drift, không im lặng lưu phần còn lại). Caller muốn skip-từng-item phải tự catch — không phải trách nhiệm của guard.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output | Error Handling |
|----------|--------------|-----------------|----------------|
| COMPLETE | PostItem đủ required + đủ optional, đúng type | `complete`, score 100, lưu bình thường | N/A |
| DEGRADED | PostItem thiếu 2 optional (`authorAvatar`,`postUrl`) | score 90 → `degraded`, `dataQuality` gắn | vẫn lưu |
| OPT_MANY_MISSING | PostItem thiếu 8 optional, 0 required/type err | missingOptional cap 20 → score 80 → `degraded`, KHÔNG corrupted | vẫn lưu |
| CORRUPTED_REQUIRED | PostItem thiếu `authorId` (required) | missingRequired≥1 → `corrupted`, throw `DEGRADED_DATA` | PlatformError, không lưu |
| CORRUPTED_TYPE | `likesCount` là string | typeErrors≥1 → `corrupted`, throw | PlatformError |
| MISSING_CONTENT_POST | PostItem `content:''`, có `authorId`+`category` | infer → `post-item` (đúng), KHÔNG rơi sang profile | N/A |
| NULLABLE_FIELD | `authorAvatar:null`, `publishedAt:null` | union `["string","null"]`/`["object","string","null"]` → hợp lệ | N/A |
| DATE_FIELD | `crawledAt:new Date()` | union `["object","string"]` → hợp lệ, không typeError | N/A |
| NO_SCHEMA | schemaType lạ + platform chưa override | `complete` no-op | N/A |
| OVERRIDE | subclass `getItemSchemaType` trả `profile-item` | validate theo profile schema | N/A |

</frozen-after-approval>

## Code Map

- `src/core/schema-drift-guard.js` **(mới)** — `SchemaDriftGuard` class + `globalSchemaDriftGuard`. `registerItemSchema(type,schema)`; `validate(platform,item,{schemaType})` → `{classification,score,missingFields,typeErrors}` (pure); `validateOrThrow(...)` → ném `PlatformError` khi `corrupted`. Resolve schema `${platform}:${type}` → `items:${type}`; đếm `missingRequired` từ `/ is required$/` (loại khỏi typeErrors), `missingOptional` từ optional `properties` vắng; infer type qua `postId`→comment, `authorId`/`category`→post, else→profile.
- `src/core/error-envelope.js` — **chỉ thêm** `DEGRADED_DATA:'degraded_data'` vào `ErrorTypes` và `RETRY_WITH_DIFFERENT_ACCOUNT:'retry_with_different_account'` vào `SuggestedActions`. KHÔNG thêm vào `RETRYABLE_TYPES` (corrupted không retry auto — cần account/schema khác).
- `src/core/metadata-schema-registry.js` — thêm `export` cho `validateSchemaNode` (hiện private ở line 34) và export named `MetadataSchemaRegistry`. Giữ `export default metadataSchemaRegistry`.
- `schemas/items/post-item.json`, `profile-item.json`, `comment-item.json` **(mới)** — canonical item contracts. Required: post `id,platform,externalId,authorId,category,content`; comment `id,platform,externalId,postId,authorId,content`; profile `id,platform,externalId`. Type checks `likesCount:number`, `mediaUrls:array`; **union types** `crawledAt`/`publishedAt` `["object","string"]`(+`"null"` cho publishedAt), `authorAvatar`/`postUrl`/`authorUrl` `["string","null"]`.
- `src/core/base-crawler.js` — trong `validateItem(item)`: sau các check hiện có, gọi `this.driftGuard.validateOrThrow(this.name, item, { schemaType: this.getItemSchemaType(item) })` và gán `item.dataQuality` khi `degraded`. Thêm `this.driftGuard = deps.driftGuard || globalSchemaDriftGuard` vào constructor + hook `getItemSchemaType(item)` (default infer, overridable).
- `src/core/index.js` — export `SchemaDriftGuard` + `globalSchemaDriftGuard`.
- `types/core.d.ts` — types `DriftClassification`, `DriftValidationResult`, `SchemaDriftGuard`; thêm `DEGRADED_DATA`/`RETRY_WITH_DIFFERENT_ACCOUNT` vào enum declarations. **Đồng bộ drift sẵn có:** d.ts ErrorTypes đang thiếu `NOT_FOUND`/`TARGET_NOT_FOUND`/`DEPRECATED`, SuggestedActions thiếu `RATE_LIMIT_BACKOFF`/`VERIFY_URL` so với runtime `error-envelope.js` — bổ sung để d.ts khớp runtime (typecheck strict hiện vẫn pass vì PlatformError.type là `string`).
- `tests/core/schema-drift-guard.test.js` **(mới)** — score formula, classification thresholds, type inference, required/optional split, no-schema no-op, corrupted throw shape.
- `tests/core/base-crawler-drift.test.js` **(mới)** — integration: feed PostItem thiếu required → `validateItem` throw `DEGRADED_DATA`; degraded → `dataQuality` gắn; corrupted không lọt `storeBatch`.
- `docs/stealth-scraping.md` hoặc `docs/architecture.md` — ghi `SchemaDriftGuard` API + classification + `dataQuality` contract.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/error-envelope.js` — thêm 2 enum mới — nền tảng error contract.
- [x] `src/core/metadata-schema-registry.js` — export `validateSchemaNode` + `MetadataSchemaRegistry` — cho guard tái dùng.
- [x] `schemas/items/*.json` — 3 canonical item schemas — contract định nghĩa complete/required.
- [x] `src/core/schema-drift-guard.js` — score + classify + validate — trái tim story.
- [x] `src/core/base-crawler.js` — wire guard vào `validateItem` + `getItemSchemaType` hook + `dataQuality` — điểm tích hợp.
- [x] `src/core/index.js` — export — public surface.
- [x] `types/core.d.ts` — types — typecheck strict.
- [x] `tests/core/schema-drift-guard.test.js` — unit: score/classify/infer — AC coverage.
- [x] `tests/core/base-crawler-drift.test.js` — integration: validateItem throw + dataQuality — AC coverage.
- [x] `docs/` — document guard API — Epic 28 DoD.

**Acceptance Criteria:**
- Given PostItem đầy đủ hợp lệ, when `validateItem`, then classification `complete`, score 100, lưu bình thường.
- Given PostItem thiếu ≥1 required field HOẶC có typeError, when `validateItem`, then ném `PlatformError` type `DEGRADED_DATA`, `suggestedAction` `retry_with_different_account`, `details` chứa `score`/`missingFields`/`typeErrors`, và item KHÔNG được persist.
- Given PostItem thiếu ≥8 optional nhưng 0 required/typeError, when `validateItem`, then `degraded` (missingOptional cap 20 → score ≥70, KHÔNG corrupted) và `item.dataQuality={score,missingFields,classification:'degraded'}` được set, item vẫn lưu.
- Given PostItem `content:''` có `authorId`+`category`, when `validateItem`, then infer `post-item` (không lọt sang profile); thiếu required `authorId` → `corrupted`.
- Given item có `postId`, when `validateItem`, then validate theo `comment-item` schema.
- Given `crawledAt:new Date()` hoặc `authorAvatar:null`, when `validateItem`, then union type chấp nhận — không typeError.
- Given `schemaType` không resolve được schema (platform chưa override + `items:*` vắng), when `validateItem`, then no-op `complete` — không phá crawler cũ.
- `npm run typecheck` 0 errors + `vitest run` pass, no regression.

## Implementation Notes

- Added `ErrorTypes.DEGRADED_DATA = 'degraded_data'` and `SuggestedActions.RETRY_WITH_DIFFERENT_ACCOUNT = 'retry_with_different_account'` to `src/core/error-envelope.js`.
- Exported `validateSchemaNode` function and `MetadataSchemaRegistry` class from `src/core/metadata-schema-registry.js`.
- Created canonical contracts in `schemas/items/{post-item,comment-item,profile-item}.json` with union types for date/string and nullable fields.
- Implemented `SchemaDriftGuard` and `globalSchemaDriftGuard` in `src/core/schema-drift-guard.js`:
  - Deterministic capped completeness score: `max(0, 100 - 35*missingRequired - 15*typeErrors - min(20, 5*missingOptional))`.
  - Classification: `complete` (100 score, no missing, no type errors), `degraded` (missing optional capped <=20, score >=70), `corrupted` (missing required, type error, or score <70).
  - Schema resolution: `${platform}:${schemaType}` -> fallback `items:${schemaType}` -> no-op `complete` if both absent.
  - Type discriminator inference: `postId` -> `comment-item`, `authorId` or `category` -> `post-item` (handling media-only posts with empty string content), else `profile-item`.
  - Split APIs: `validate` (pure evaluation) and `validateOrThrow` (throws `PlatformError` with `DEGRADED_DATA` when corrupted).
- Integrated into `AbstractCrawler`: added `driftGuard` property and `getItemSchemaType(item)` hook; in `validateItem(item)`, calls `driftGuard.validateOrThrow(...)` and attaches `item.dataQuality` when degraded.
- Exported `SchemaDriftGuard` and `globalSchemaDriftGuard` from `src/core/index.js`.
- Updated `types/core.d.ts` with all types and synchronized missing ErrorTypes/SuggestedActions.
- Documented `SchemaDriftGuard` in `docs/stealth-scraping.md`.
- Implemented 18 unit tests in `tests/core/schema-drift-guard.test.js` and 10 integration tests in `tests/core/base-crawler-drift.test.js`.
- All tests pass (297 tests in tests/core) and `npm run typecheck` passes with 0 errors.

## Spec Change Log

## Review Triage Log

Pre-implementation adversarial review (subagent) — 5 blockers + concerns, all patched:
- [x] [B1 blocker] Item-type inference dùng `content` truthiness → PostItem thiếu/`''` content lọt sang ProfileItem pass sai. Fixed: infer qua `postId`/`authorId`/`category` discriminator (types.js:14,20,51-65). KEEP rule này.
- [x] [B2 blocker] `missingOptional` không cap → 7+ optional vắng kéo score <70 → false-corrupted trên crawler tối giản. Fixed: `min(20, 5×missingOptional)` + `typeErrors>0`/`missingRequired>0` cũng trigger corrupted.
- [x] [B3 blocker] `Date`/nullable bị reject (`typeof Date==='object'`). Fixed: union types `["object","string"]` cho timestamp, `["string","null"]` cho nullable (types.js:17,27-28).
- [x] [B4 blocker] `missingRequired` double-counted vào typeErrors. Fixed: lọc `/\.([^.]+) is required$/` khỏi typeErrors.
- [x] [B5 blocker] `validate(this.name,…)` vs `items:*` lookup mâu thuẫn. Fixed: resolve `${platform}:${type}` → `items:${type}`; no-op chỉ khi cả hai vắng.
- [x] [Concern] `validate` vs `validateOrThrow` API — split rõ: `validate` pure, `validateOrThrow` ném; validateItem gọi `validateOrThrow`.
- [x] [Concern] batch-abort blast radius — intended fail-fast (đã ghi Boundaries); caller skip-item phải tự catch.
- [x] [Concern] `types/core.d.ts` drift sẵn có (thiếu NOT_FOUND/TARGET_NOT_FOUND/DEPRECATED/RATE_LIMIT_BACKOFF/VERIFY_URL) — đồng bộ luôn.

Implementation review pass (Edge Case Hunter + Verification Gap Reviewer):
- [x] [Review][Patch] `validate` with non-object/null falsely returned complete score 100 [<src/core/schema-drift-guard.js:118>] — applied: non-object guard returns corrupted score 0; 7 new tests pass
- [x] [Review][Patch] `postId: undefined` inferred as comment-item [<src/core/schema-drift-guard.js:94>] — applied: check `rec.postId !== undefined`; tested
- [x] [Review][Patch] `category: 'profile'` mis-inferred as post-item [<src/core/schema-drift-guard.js:98>] — applied: `rec.category !== 'profile'` keeps ProfileItem as profile; tested
- [x] [Review][Patch] `item.dataQuality` assigned to non-extensible/frozen item [<src/core/base-crawler.js:266>] — applied: added `Object.isExtensible(item)` guard
- [x] [Review][Patch] Item schemas rejected `metadata: null` [<schemas/items/{post,comment,profile}-item.json:33>] — applied: union type `["object", "null"]`
- [x] [Review][Patch] `ThreadsCrawler` swallows `PlatformError(DEGRADED_DATA)` [<src/scrapers/social/threads/crawler.js:1121>] — applied (2026-09-13): 4 silent `catch {}` blocks now catch `err` and `console.warn` when `err.type === ErrorTypes.DEGRADED_DATA`, so contract drift is surfaced instead of silently dropped (still skip-per-item, never aborts batch)
- [x] [Review][Patch] Non-post entities (comments, profiles) bypass validateItem in YouTube/Zalo [<src/scrapers/social/youtube/crawler.js:283>] — applied (2026-09-13): `validateItem` wired into YouTube `#persistPosts`/`#persistProfiles`/`#persistComments` and Zalo `#persistProfiles`; corrupted items dropped with warn log
- [x] [Review][Patch] 11 vertical crawlers do not adopt validateItem [<src/scrapers/recruitment/linkedin/crawler.js:121>] — applied (2026-09-13): new `AbstractCrawler.filterValidItems` helper wired before every `storeBatch`/`savePosts`/`saveComments` across LinkedIn, VietnamWorks, TopCV, Batdongsan, Chotot, Shopee, TikTok-Shop, MaSoThue, Automotive, BlueSky, Mastodon; verified normalized items satisfy post/comment/profile contracts (no false-corrupted)
- [x] [Review][Patch] Downstream store persistence adapter testing for item.dataQuality [<src/core/base-crawler.js:266>] — applied (2026-09-13): added `base-crawler-drift.test.js` test asserting `item.dataQuality` survives a JSON store round-trip. NOTE: whether Prisma needs a dedicated `dataQuality` column vs. folding into `metadata` remains an open mapping decision (still tracked in deferred-work.md)

Second adversarial review pass (Blind Hunter, Acceptance Auditor, Edge Case Hunter, Verification Gap Reviewer):
- [x] [Review][Patch] Unguarded `validateItem` loop in `YouTubeVNCrawler` batch actions (`search`, `trendingVn`, `channelVideos`) crashes whole crawl [<src/scrapers/social/youtube/crawler.js:350>] — applied: replaced raw loop with `this.filterValidItems(posts)` and wired to `#persistPosts`/`#persistProfiles`/`#persistComments`.
- [x] [Review][Patch] Unguarded `validateItem` loop in `ZaloCrawler` batch actions (`oaPosts`, `marketplaceProducts`) crashes whole crawl [<src/scrapers/social/zalo/crawler.js:321>] — applied: replaced raw loop with `this.filterValidItems(posts)` and wired to `#persistPosts`/`#persistProfiles`.
- [x] [Review][Patch] `BlueskyCrawler.getProfile` and `MastodonCrawler.getProfile` bypass `validateItem` on converted `postItem` before `store.storeContent` [<src/scrapers/social/bluesky/crawler.js:220>, <src/scrapers/social/mastodon/crawler.js:230>] — applied: added `this.validateItem(profile)` and `this.validateItem(postItem)` prior to persistence.
- [x] [Review][Patch] `LinkedInCrawler` single-item actions (`companyProfile`, `leadProfile`) return unvalidated items [<src/scrapers/recruitment/linkedin/crawler.js:199, 230>] — applied: validated `company` and `lead` via `this.validateItem(...)`.
- [x] [Review][Patch] Missing unit test coverage for `AbstractCrawler.filterValidItems` [<tests/core/base-crawler-drift.test.js:210>] — applied: added comprehensive unit tests for non-array handling, dropping corrupted items with warn log, and attaching `dataQuality`.
- [x] [Review][Defer] Downstream content store persistence and Prisma column mapping for `item.dataQuality` [<src/core/base-crawler.js:266>] — deferred: pre-existing architectural choice regarding dedicated SQL column vs JSON metadata field.

## Design Notes

- **Inference:** `validateItem` không có action context. CommentItem có `postId`+`content`; PostItem có `authorId`+`category` (không `postId`); ProfileItem không có cả ba. Rule `postId`→comment, `authorId`/`category`→post, else→profile bắt đúng cả PostItem thiếu/`''` content (media-only). Override qua `getItemSchemaType`.
- **Error counting:** `validateSchemaNode` trả `string[]` phẳng; `"… is required"` = missingRequired (lọc khỏi typeErrors), còn lại = typeErrors; `missingOptional` = optional `properties` key vắng (không emit lỗi). `missingRequired`/`typeErrors` >0 → corrupted ngay, không cần đợi score.
- **missingOptional cap 20:** PostItem ~11 optional; crawler tối giản (realestate/recruitment/ecom) không populate engagement → cap ngăn optional-only kéo score <70.
- **Schema lookup:** `${platform}:${type}` → `items:${type}`. Item schemas ở `schemas/items/` auto-load thành `items:*` (platform=`items`). Guard lookup trực tiếp, không qua `validateMetadata` (chỉ nhắm `metadata`, return valid khi thiếu schema).
- `DEGRADED_DATA` KHÔNG retryable: corrupted do contract/data — retry cùng account vô ích.

## Verification

**Commands:**
- `npm run typecheck` — 0 errors strict.
- `vitest run tests/core/schema-drift-guard.test.js tests/core/base-crawler-drift.test.js` — pass (incl. `dataQuality` JSON store round-trip).
- `vitest run` (14 patched crawlers' suites: youtube, zalo, threads, bluesky, mastodon, shopee, tiktok-shop, linkedin, vietnamworks, topcv, batdongsan, chotot, masothue, automotive) — pass, no regression.
- `vitest run` — full suite no regression.
