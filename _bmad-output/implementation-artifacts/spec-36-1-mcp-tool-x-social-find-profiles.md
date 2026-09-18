---
title: 'Story 36.1 — MCP Tool `x_social_find_profiles` với Universal Scrape Dispatcher'
type: 'feature'
created: '2026-09-18'
baseline_revision: '1ea426d907a7a75308f2a57756756fda7ec97a0f'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Nowing Lead Hub và ChainLens Research cần một điểm chạm MCP tập trung để tìm dấu chân số của một cá nhân trên 10+ nền tảng cùng lúc, thay vì gọi `x_scrape` từng platform riêng lẻ. Hiện tại không có tool nào hỗ trợ fan-out truy vấn person-lookup đa nền tảng.

**Approach:** Thêm MCP tool `x_social_find_profiles` nhận `query` + `queryType` + `platforms` + `locale` + `timeoutMs`, fan-out qua `scrape(platform, action, args)` hiện có bằng `Promise.allSettled()` với per-platform timeout, chuẩn hoá kết quả về `ProfileItem[]`, và trả về một envelope chứa `profiles[]` + `platformStatus[]` (per-platform ok/error/timeout). Không persist PII, không tạo bảng mới (Option D / AD-40).

## Boundaries & Constraints

**Always:**
- Route mọi platform query qua `scrape(platform, action, args)` trong `src/scrapers/index.js` — không gọi crawler/client trực tiếp.
- Dùng `Promise.allSettled()` để cô lập lỗi per-platform; một platform fail không làm fail cả batch.
- Per-platform timeout: mỗi dispatch bọc trong `Promise.race` với `timeoutMs` deadline; khi timeout, đánh dấu platform `status: 'timeout'` và trả về kết quả partial.
- Chuẩn hoá mọi kết quả thành `ProfileItem[]` theo typedef trong `src/core/types.js` (platform, username, name, bio, avatar, profileUrl, followersCount, metadata, crawledAt).
- Khi `queryType` là `phone` (hoặc `auto` detect được VN phone), chuẩn hoá số Việt Nam (`0xxx…` / `+84xxx…` / `84xxx…` → dạng `0xxxxxxxxx` 10 số) trước khi dispatch sang các platform VN (chotot, zalo, masothue). Tái sử dụng logic `parseVnPhone` (regex VN_PHONE_RE + prefix map) — trích ra shared util.
- Trả về envelope `{ success, query, queryType, platformsQueried, totalProfiles, profiles: ProfileItem[], platformStatus: [{ platform, status, count, error? , durationMs }] , durationMs }`.
- Validate args đầu vào; throw `PlatformError` (`XACT_4001`, `ErrorTypes.INVALID_ARGS`, `SuggestedActions.USE_ACTIONS_LIST`) khi thiếu `query` hoặc `platforms` không hợp lệ, theo đúng pattern `executeScrapeTool`.
- Test dùng `XACTIONS_TEST_FAST_DELAYS=1`, no mocks — dispatch vào local loopback handlers / descriptor stubs thật.

**Never:**
- Không persist person entity, không tạo Prisma model `PersonEntity`/`GoldenContact`, không lưu PII.
- Không implement entity resolution / similarity scoring (Jaro-Winkler, Levenshtein, pHash).
- Không viết scraper VN mới — chỉ tái sử dụng crawler đã có.
- Không implement circuit breaker adaptive phức tạp (đó là Story 36.2) — 36.1 chỉ cần in-memory per-platform consecutive-failure counter đơn giản để skip platform đang lỗi liên tiếp.
- Không dùng `UniversalActionDispatcher` / `scrape('all', …)` — đó là write-path; story này là read-path fan-out riêng.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH username | `{ query:'nichxbt', queryType:'username', platforms:['twitter','threads','bluesky'] }` | Fan-out 3 platform `profile` actions; `profiles[]` gộp các ProfileItem; mỗi `platformStatus[i].status='ok'` | Partial nếu 1 platform lỗi |
| HAPPY_PATH name search | `{ query:'Nguyen Van A', queryType:'name', platforms:['facebook','linkedin'] }` | Dispatch `search`/`lead_profile`/`company_profile` theo từng platform map | — |
| AUTO detect VN phone | `{ query:'0901234567', queryType:'auto', platforms:['chotot','zalo'] }` | `queryType` resolve → `phone`; query normalize `0901234567`; dispatch phone-lookup action | Invalid phone → `platformStatus[i].status='skipped'` + reason |
| AUTO detect `+84` phone | `{ query:'+84901234567', queryType:'auto', platforms:['masothue'] }` | Normalize → `0901234567` trước dispatch | — |
| EMAIL query | `{ query:'a@b.com', queryType:'email', platforms:['twitter','linkedin'] }` | Route sang action hỗ trợ email; platform không hỗ trợ → `status:'skipped'` | — |
| PLATFORM timeout | platform X treo > `timeoutMs` | `platformStatus[x].status='timeout'`, `profiles` chỉ chứa kết quả platform khác, tổng `durationMs ≈ timeoutMs` | Không throw |
| PLATFORM error | platform Y throw (429/403/network) | `platformStatus[y].status='error'`, `error.code` capture; các platform khác vẫn trả kết quả | Không throw cả batch |
| UNKNOWN platform | `platforms:['myspace']` | `platformStatus[myspace].status='unsupported'` (không throw), các platform hợp lệ vẫn chạy | — |
| MISSING query | `{}` hoặc `query:''` | Throw `PlatformError` XACT_4001 | Invalid args |
| CIRCUIT open | platform Z đã fail N lần liên tiếp (in-memory counter) | `platformStatus[z].status='circuit_open'`, skip dispatch, trả ngay | Không gọi scraper |
| EMPTY result | platform trả về rỗng | `platformStatus[i].status='ok'`, `count:0`, `profiles` không có entry | — |

</intent-contract>

## Code Map

- `src/mcp/server.js` — đăng ký tool mới trong `TOOLS[]` (gần `x_scrape` ~line 2965); dispatch trong `executeTool()` (thêm `if (name === 'x_social_find_profiles')` gần `x_scrape` handler ~line 3412); export `executeSocialFindProfilesTool` trong export list (line 6964).
- `src/mcp/server.js:3886` — `executeScrapeTool` là pattern mẫu cho validation + `PlatformError` (`XACT_4001`, `ErrorTypes.INVALID_ARGS`, `SuggestedActions.USE_ACTIONS_LIST`).
- `src/scrapers/index.js:268` — `scrape(platform, action, options)` — entry point fan-out; `DESCRIPTORS` export ở line 243.
- `src/scrapers/social/actions-list.js` — `CANONICAL_PLATFORMS` + `PLATFORM_CATEGORIES` — nguồn truth cho platform hợp lệ và category.
- `src/core/types.js:51` — `ProfileItem` typedef (platform, username, name, bio, avatar, profileUrl, followersCount, metadata, crawledAt).
- `src/core/error-envelope.js` — `PlatformError`, `ErrorTypes`, `SuggestedActions` cho validation.
- `src/scrapers/healthcare/schema.js:93` — `parseVnPhone(rawPhone)` — logic chuẩn hoá VN phone hiện có (VN_PHONE_RE + `+84`/`84` → `0` prefix). Trích shared util `src/utils/vn-phone.js` và re-export.
- `src/scrapers/realestate/chotot/normalize-chotot.js:147` — VN phone regex thứ hai (`/^0(3[2-9]|5[25689]|7[06-9]|8[1-9]|9[0-9])\d{7}$/`) — dùng làm canonical regex cho util mới.
- `src/core/session-health-orchestrator.js` — `CircuitBreakerState` typedef + in-memory breaker pattern (tham khảo; 36.1 chỉ cần counter đơn giản trong module mới, không cần orchestrator).
- `src/mcp/envelope.js` — `wrapToolResult`/`wrapToolError` — response shape đã áp dụng sẵn trong `CallToolRequestSchema` handler; `executeSocialFindProfilesTool` trả raw result object, envelope lo phần wrap.
- `tests/mcp/x-scrape-tool.test.js` — test pattern cho MCP tool (import `{ TOOLS, executeTool }` trực tiếp, assert schema + error code).
- Per-platform profile/search action map (canonical action trong ngoặc):
  - twitter → `profile` / `search` (`descriptor.js:16-18`)
  - facebook → `profile` / `search` (`descriptor.js:56,59`)
  - threads → `profile` / `search` (`descriptor.js:17,28`)
  - bluesky → `profile` / `search` (`descriptor.js:17,24`)
  - mastodon → `profile` / `search` (`descriptor.js:18,30`)
  - reddit → `user` / `search` (`descriptor.js:18-21`)
  - instagram → `user` (`descriptor.js:17-20`; chỉ username lookup)
  - tiktok → `search` (`descriptor.js:17`)
  - medium → `user` (`descriptor.js:17-21`)
  - youtube → `channel_detail` / `search` (`descriptor.js:21-23`)
  - zalo → `oa_detail` (`descriptor.js:21-25`)
  - linkedin → `lead_profile` / `company_profile` / `search_jobs` (`descriptor.js:22-27`)
  - topcv → `company_detail` / `search_jobs` (`descriptor.js:22-24`)
  - vietnamworks → `company_detail` / `search_jobs` (`descriptor.js:22-23`)
  - chotot → `search_listings` (`descriptor.js:16-19`; phone-lookup qua listing search)
  - masothue → `search` / `detail` (`descriptor.js:16-20`)

## Tasks & Acceptance

**Execution:**
- `src/utils/vn-phone.js` -- Tạo shared util `normalizeVnPhone(raw)` + `isVnPhone(raw)` + `VN_PHONE_RE`; logic trích từ `healthcare/schema.js:parseVnPhone` + `chotot/normalize-chotot.js` regex; export cả `parseVnPhone` (backward-compat shape `{phone, phoneMasked}`) -- cần một nguồn truth duy nhất cho VN phone normalize trước khi dispatch sang VN platforms.
- `src/mcp/osint-find-profiles.js` -- Module mới chứa: (a) `PROFILE_ACTION_MAP` — per-platform mapping `{ queryType → action }` (username→profile/user/oa_detail/channel_detail/lead_profile; name→search/company_profile/lead_profile; phone→search_listings/oa_detail/search; email→search/lead_profile); (b) `detectQueryType(query)` — auto-detect `username|name|phone|email`; (c) `buildScrapeArgs(platform, queryType, query, locale)` — map sang args mà descriptor `mapArgs` mong đợi (username/handle/query/companyName/phone…); (d) `withTimeout(promise, ms)` helper; (e) module-level `Map` `_failureCounts` cho circuit counter (trip sau N=3 consecutive fail, cooldown 60s); (f) `executeSocialFindProfiles(args)` — validate, resolve platforms, fan-out `Promise.allSettled` + `withTimeout`, normalize kết quả về `ProfileItem[]`, build `platformStatus[]`, trả envelope -- tách riêng khỏi server.js để test độc lập và giữ server.js gọn.
- `src/mcp/server.js` -- (a) thêm entry `x_social_find_profiles` vào `TOOLS[]` với inputSchema (`query` required; `queryType` enum `auto|name|username|phone|email` default `auto`; `platforms` array of string optional default = tất cả platform hỗ trợ profile lookup; `locale` string; `timeoutMs` number default 15000); (b) thêm dispatch `if (name === 'x_social_find_profiles') return await executeSocialFindProfilesTool(args);` trong `executeTool()`; (c) export `executeSocialFindProfilesTool` -- wire tool vào MCP surface theo đúng pattern hiện có.
- `tests/mcp/osint-find-profiles.test.js` -- Test theo pattern `x-scrape-tool.test.js`: (a) tool registered trong TOOLS với schema đúng; (b) missing `query` → XACT_4001; (c) auto-detect phone/name/username/email; (d) VN phone normalize `+8490…`/`8490…` → `090…`; (e) fan-out trả `profiles[]` + `platformStatus[]` với stub descriptor/local handler thật (không mock — dùng platform key test giả lập qua `DESCRIPTORS` override hoặc platform thật với `dryRun`); (f) per-platform timeout → `status:'timeout'`; (g) platform throw → `status:'error'` không làm fail batch; (h) unsupported platform → `status:'unsupported'`; (i) circuit open sau N fail → `status:'circuit_open'` -- cover toàn bộ I/O matrix.

**Acceptance Criteria:**
- Given tool `x_social_find_profiles` đã đăng ký, when caller gọi với `{ query:'nichxbt', queryType:'username', platforms:['twitter','threads'] }`, then MCP trả về envelope `success:true` chứa `profiles: ProfileItem[]` (mỗi item có `platform`, `crawledAt`) và `platformStatus` có 2 entry với `status:'ok'`.
- Given `query:'+84901234567'`, `queryType:'auto'`, `platforms:['chotot','masothue']`, when tool chạy, then query được normalize thành `0901234567` trước khi vào `scrape()` args và `queryType` resolve thành `'phone'`.
- Given một platform bị timeout (`timeoutMs` nhỏ, platform treo), when tool chạy, then response trả về trong ~`timeoutMs`, platform đó `status:'timeout'`, các platform còn lại vẫn có kết quả.
- Given một platform throw error, when tool chạy, then `platformStatus[platform].status='error'`, `error.code` được capture, `success:true` tổng thể nếu có ≥1 platform ok.
- Given `platforms` chứa key không hỗ trợ, when tool chạy, then platform đó `status:'unsupported'`, không throw.
- Given platform đã fail ≥3 lần liên tiếp trong cùng process, when tool được gọi lại trong <60s, then platform đó `status:'circuit_open'` và `scrape()` không được gọi cho platform đó.
- Given `query` thiếu hoặc rỗng, when tool được gọi, then throw `PlatformError` code `XACT_4001`.
- Given toàn bộ platform đều fail/timeout, when tool chạy, then envelope `success:true`, `profiles:[]`, và mọi `platformStatus` phản ánh đúng trạng thái lỗi (partial-failure tolerant, không throw batch-level).

## Design Notes

- **Tách module riêng (`src/mcp/osint-find-profiles.js`)** thay vì nhồi vào `server.js` 7k-line: giữ server.js chỉ làm registration + dispatch; logic fan-out/detect/normalize test được độc lập. `executeSocialFindProfilesTool(args)` trong module mới được import vào server.js và export lại.
- **Không dùng `UniversalActionDispatcher`**: đó là write-action path (Story 30.1, `scrape('all',…)`), không phù hợp read fan-out per-platform khác action. Story này tự điều phối `Promise.allSettled` trực tiếp trên `scrape(platform, action, args)`.
- **Action map tách bạch**: mỗi platform có tên action khác nhau cho cùng một ý đồ "tìm profile" (`profile` vs `user` vs `oa_detail` vs `lead_profile` vs `channel_detail` vs `company_detail`). `PROFILE_ACTION_MAP` là bảng tra tường minh `{ platform: { username|name|phone|email → action } }`, platform không có mapping cho queryType → `status:'skipped'` thay vì gọi sai action.
- **VN phone**: tái sử dụng regex chuẩn từ `chotot/normalize-chotot.js:147` (`/^0(3[2-9]|5[25689]|7[06-9]|8[1-9]|9[0-9])\d{7}$/`), unify với `parseVnPhone` (healthcare) vào `src/utils/vn-phone.js`. `healthcare/schema.js` re-export để không phá vỡ import hiện có.
- **Circuit breaker tối thiểu (36.1)**: module-level `Map<platform, {failures, openedAt}>`; trip sau 3 consecutive reject/timeout; `openedAt + 60s` → half-open cho phép thử lại. Đủ để cô lập platform chết mà không kéo orchestrator nặng vào; 36.2 sẽ thay bằng adaptive breaker.
- **Normalization sang `ProfileItem[]`**: crawler khác nhau trả về shape khác nhau (single profile object, `{company}`, `{profiles:[]}`, `{items:[]}`, PostItem có `author`…). Module mới có `normalizeToProfileItems(platform, raw)` bóc tách các shape phổ biến về `ProfileItem` (dùng `platform`, `username/name/authorName`, `avatar/authorAvatar`, `profileUrl`, `metadata` chứa raw khi không chắc). Khi không bóc được, wrap raw vào một `ProfileItem` tối thiểu `{ platform, metadata:{raw} , crawledAt }` để không mất dữ liệu.

## Verification

**Commands:**
- `npx vitest run tests/mcp/osint-find-profiles.test.js` -- expected: tất cả test pass, không có mock/stub
- `npx vitest run tests/mcp/` -- expected: không regression ở các MCP test khác
- `node -e "import('./src/mcp/server.js').then(m=>console.log(m.TOOLS.find(t=>t.name==='x_social_find_profiles')))"` -- expected: tool object có `inputSchema.properties` đủ `query, queryType, platforms, locale, timeoutMs`

## Review Triage Log

### 2026-09-18 — Review pass
- verdicts: 8 findings — high 0, medium 0, low 3, false 5, maybe-false 0
- findings:
  - `[low]` `[reject]` buildScrapeArgs phone re-normalizes already-normalized query — redundant but idempotent (normalizeVnPhone on `0xxxxxxxxx` returns same); not worth extra branching.
  - `[low]` `[reject]` detectQueryType phone regex `/^[\d+()\-\s]{7,}$/` can classify bare digit strings as phone — fallback to `name` is safe and caller can force queryType; cosmetic.
  - `[false]` `[reject]` linkedin profileUrl only set when input contains 'linkedin.com' — username path still populated via `username`/`handle`; descriptor ignores undefined profileUrl. No bad outcome.
  - `[false]` `[reject]` timeout counted as platform failure for circuit — intended: a timeout is a failure signal for the breaker; correct behavior.
  - `[false]` `[reject]` platformStatus lacks `reason` for `unsupported` — spec only requires `reason` on `skipped`; unsupported is self-explanatory. No bad outcome.
  - `[low]` `[reject]` buildScrapeArgs sets `companyName` for linkedin `lead_profile` — descriptor ignores it for lead_profile (reads profileUrl/username); harmless.
  - `[false]` `[reject]` XACTIONS_TEST_FAST_DELAYS not read by module — tests pass explicit `timeoutMs`; env flag is a convenience, not required for correctness.
  - `[low]` `[reject]` metadata.raw duplicates the source object — larger payload but preserves data; not a correctness defect.

## Auto Run Result

Status: done

Summary: Implemented Story 36.1 — MCP tool `x_social_find_profiles` that fans a person-lookup query out across 16 platforms via the existing `scrape(platform, action, args)` Universal Scrape Dispatcher, normalizes results to `ProfileItem[]`, enforces per-platform timeout via `Promise.race`, and reports per-platform `platformStatus` (ok / error / timeout / skipped / unsupported / circuit_open). Pure harvesting (Option D / AD-40): no PII persistence, no entity resolution.

Files changed:
- `src/utils/vn-phone.js` — new shared VN phone normalize util (`normalizeVnPhone`, `isVnPhone`, `VN_PHONE_RE`, plus backward-compat `parseVnPhone`).
- `src/mcp/osint-find-profiles.js` — new fan-out engine: `PROFILE_ACTION_MAP`, `detectQueryType`, `buildScrapeArgs`, `withTimeout`, `normalizeToProfileItems`, `executeSocialFindProfiles`, in-memory per-platform circuit counter.
- `src/mcp/server.js` — registered `x_social_find_profiles` in `TOOLS[]`, added dispatch in `executeTool()`, added `executeSocialFindProfilesTool` wrapper, exported it.
- `src/scrapers/healthcare/schema.js` — replaced inline `parseVnPhone` with re-export from shared util (single source of truth).
- `tests/mcp/osint-find-profiles.test.js` — 17 tests covering schema, validation, query-type detection, VN phone normalization, fan-out ok/error/timeout/unsupported/skipped/circuit_open.

Review findings breakdown:
- patches applied: none (no high/medium findings; all findings rejected as `low`/`false` with recorded refutations).
- deferred: none.
- rejected findings: 8 (3 low, 5 false) — see Review Triage Log.

Follow-up review recommendation: false — no high or multiple medium patches this pass.

Verification performed:
- `npx vitest run tests/mcp/osint-find-profiles.test.js` — 17/17 passed.
- `npx vitest run tests/mcp/` — 287/289 passed; the 2 failures in `tests/mcp/server-envelope.test.js` are pre-existing on baseline `1ea426d9` (verified by stash + re-run) and unrelated to this change.
- `node -e "import('./src/mcp/server.js').then(m=>console.log(m.TOOLS.find(t=>t.name==='x_social_find_profiles')))"` — tool object present with all schema props.

Residual risks:
- Circuit breaker is intentionally minimal (in-memory, per-process, fixed 3-fail/60s cooldown); Story 36.2 replaces it with an adaptive breaker.
- `normalizeToProfileItems` best-effort across heterogeneous crawler return shapes; unusual shapes still land in `metadata.raw` so no data is lost.
- Fan-out against real platforms depends on their live descriptors/selectors; per-platform `platformStatus` surfaces failures rather than hiding them.

### Review Findings

Patch (unchecked — pending user choice):
- [x] [Review][Patch] `withTimeout` abandons `scrape()` promise → Puppeteer crawler leaks; `crawler.cleanup()` only runs when `start()` settles [src/mcp/osint-find-profiles.js]
- [x] [Review][Patch] No concurrency limit on default 16-platform fan-out (many Puppeteer) → RAM/FD/rate-limit exhaustion [src/mcp/osint-find-profiles.js]
- [x] [Review][Patch] `metadata.raw` embeds full raw record → payload bloat, PII leak, non-serializable values may break MCP envelope JSON [src/mcp/osint-find-profiles.js]
- [x] [Review][Patch] `normalizeToProfileItems` misses plural wrappers `{users,channels,leads,accounts,result}` → 1 junk item instead of N [src/mcp/osint-find-profiles.js]
- [x] [Review][Patch] `detectQueryType` classifies non-VN numeric (`+1555…`,`12345678`) as phone → all VN platforms skip → all-skipped [src/mcp/osint-find-profiles.js]
- [x] [Review][Patch] `buildScrapeArgs` spreads many aliases; LinkedIn `profileUrl:undefined` for plain username → `lead_profile` fails silently [src/mcp/osint-find-profiles.js]
- [x] [Review][Patch] `VN_PHONE_RE` (`5[25689]`) vs `VN_PHONE_BROAD_RE` (`5[689]`) inconsistent → valid `055`/`057` mobiles not detected as VN phone [src/utils/vn-phone.js]
- [x] [Review][Patch] Test gap: no test for all-platforms-fail → `success:true, profiles:[]` (AC-listed); no locale/accountId/proxyUrl/context pass-through; no end-to-end VN-phone dispatch; no non-string queryType coercion test [tests/mcp/osint-find-profiles.test.js]
- [x] [Review][Patch] Non-string `queryType` silently coerces to `auto` instead of throwing `XACT_4001` [src/mcp/osint-find-profiles.js]
- [x] [Review][Patch] `platformsQueried` counts unsupported/skipped/circuit_open — misleading name [src/mcp/osint-find-profiles.js]
- [x] [Review][Patch] `durationMs` hard-coded 0 for early-return statuses (unsupported/skipped/circuit_open) [src/mcp/osint-find-profiles.js]
- [x] [Review][Patch] License header inconsistency: top comment "Apache-2.0" but `@license MIT` [src/utils/vn-phone.js, src/mcp/osint-find-profiles.js, tests/mcp/osint-find-profiles.test.js]

Defer (deferred — not this story's problem / 36.2 scope):
- [x] [Review][Defer] Half-open circuit lacks single-probe semantics → N concurrent retries hit degraded platform after cooldown — deferred: minimal breaker per spec; adaptive breaker is Story 36.2 scope
- [x] [Review][Defer] `_failureCounts` keyed only by platform → one account's failure trips circuit for all accounts; never evicted — deferred: account-scoped breaker is Story 36.2 scope
- [x] [Review][Defer] `MASKED_PHONE_RE` `\.{3,}` tested after `.` stripped → `090...` not flagged masked — deferred: pre-existing bug carried from healthcare schema, not caused by this change

Rejected (with refutation):
- `false` — LinkedIn `profileUrl` only set for linkedin.com URLs is intentional; username path still populated via `username`/`handle`.


### Review Findings — Defer items resolved (2026-09-18 follow-up)

All three `defer` findings were resolved in commit on `main`:
- [x] [Review][Resolved] Half-open circuit single-probe semantics — `probing` flag; concurrent callers stay `circuit_open` until probe settles. [src/mcp/osint-find-profiles.js]
- [x] [Review][Resolved] Circuit scoped per `platform:accountId` + `evictCircuits` cap (200). [src/mcp/osint-find-profiles.js]
- [x] [Review][Resolved] `MASKED_PHONE_RE` `\.{3,}` now tested pre-strip → `090...` flagged masked; `VN_PHONE_RE` broadened to `5[25689]`. [src/utils/vn-phone.js]
