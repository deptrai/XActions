---
title: 'Story 42.8 — jev-cognitive-unfollow: Relationship Preservation & Audience Pruning'
type: 'feature'
created: '2026-09-22'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '5d6b7e68'
context: []
---

## Intent

Trước khi `unfollowNonFollowers` unfollow một account không follow-back, gọi Jev `Choice` phân loại mối quan hệ (`unfollow_dead` | `unfollow_spam` | `keep_high_value_influencer` | `keep_active_peer`). Chỉ unfollow khi verdict là `unfollow_*` với confidence ≥ threshold; mọi trường hợp còn lại (keep_*, degraded, low-conf, error) → **giữ lại** — fail-safe về phía preservation. Không thay đổi semantic của `unfollowEveryone` (op khác, cố ý unfollow cả followers).

## Boundaries & Constraints

- Jev đi qua `JevBrain` (`src/agents/jevBrain.js`) — không fetch `api.typesafe.ai` trực tiếp, không đưa Jev vào `llmBrain`.
- Unfollow gần-như-irreversible → polarity fail-safe: chưa chắc = giữ. Kill-switch `JEV_COGNITIVE_UNFOLLOW` (0/false/off/no) bypass hoàn toàn → behavior gốc.
- Không persist: verdict chỉ sống trong scope job, trả về qua result object (`keptByJev`, `failed`, `unfollowed`). Không ghi DB/log bio.
- Paid-call budget: chỉ evaluate `nonFollowers.slice(0, limit)` — tối đa `limit` calls (default cap 300 bởi `maxUnfollows`), concurrency `p-limit(8)`.
- Backward-compat: config field mới optional; `dryRun` giữ nguyên semantics (không unfollow, nhưng vẫn evaluate để preview verdicts).

## I/O & Edge-Case Matrix

| Input | Expected |
|---|---|
| nonFollower `unfollow_spam` conf 0.9 | unfollow + log verdict |
| nonFollower `keep_high_value_influencer` conf ≥0.7 | skip, vào `keptByJev[]` |
| verdict `unfollow_*` nhưng conf < 0.7 | keep (fail-safe), vào `keptByJev[]` |
| Jev degraded / throw / no API key | keep account đó; `stats.jevDegraded++`; job vẫn hoàn tất |
| `JEV_COGNITIVE_UNFOLLOW=0` | không evaluate; unfollow tất cả nonFollowers (behavior gốc) |
| user thiếu bio/username | vẫn evaluate với fields có sẵn (state rỗng phần thiếu); không skip evaluation |
| `dryRun:true` (browser path) | evaluate + trả preview verdicts; KHÔNG gọi `unfollowUser`. **Pre-existing gap:** executor hiện bỏ qua `dryRun` hoàn toàn → story này thêm handling luôn tại hook site |
| API path (`processUnfollowNonFollowers`) | fused loop (followsBack check → inline `client.delete` :76-84) — hook **inline per-user**, không phải batch pre-pass; cần `user.fields` mở rộng `description,verified,public_metrics` để có bio |

## Code Map

- `api/services/operations/puppeteer/unfollowNonFollowers.js` — browser executor (session auth): `nonFollowers` tính ở :50, loop unfollow :69-89. **Hook:** pre-pass evaluate ngay sau :67 (`total`), slice `nonFollowers.slice(0, limit)` → `kept` set → loop skip khi `kept.has(username)`. `getFollowing` đã trả `{username, name, bio, verified, followsBack}` (browserAutomation.js:1114-1127) — đủ state, không cần scrape thêm. **Thêm `config.dryRun` handling** (pre-existing gap: route truyền `dryRun` :976 nhưng executor không đọc — queued dry-run vẫn unfollow thật): `dryRun` → evaluate + return `{success:true, dryRun:true, verdicts:[{username, choice, confidence}], wouldUnfollow, keptByJev}` trước loop, không gọi `unfollowUser`.
- `api/services/operations/unfollowNonFollowers.js` — API executor (oauth), **fused loop**: :59-92 mỗi iteration gọi `followers` API → `if (!followsBack)` :76 → `client.delete` :80 inline. **Hook:** inline trong `if (!followsBack)` trước `:80` — `evaluateUnfollowTargets([user])` 1-user; giữ cấu trúc fused (không restructure). `user.fields: 'username'` :44 → mở rộng `'username,name,description,verified,public_metrics'`; map `description→bio`, `public_metrics.followers_count→followersCount`. `dryRun` API path đã đúng (:79 chỉ delete khi !dryRun) — hook vẫn chạy để preview không cần.
- **Field drift (ghi nhận, KHÔNG fix):** route truyền `maxUnfollows`/`minDaysSinceFollow`/`skipVerified` nhưng browser executor đọc `config.limit`/`config.maxUsers` — operative cap là `config.limit`. Spec chỉ động vào guard wiring + dryRun.
- `src/automation/jevUnfollowGuard.js` — NEW: `evaluateUnfollowTargets(users, opts)` → `{verdicts: Map<username,{choice,confidence}>, degraded}`; lazy shared JevBrain (mirror `jev-bio-matcher.js` singleton + late-key rebuild); `p-limit(8)` + `allSettled`; bio truncate ≤500 chars.
- `src/agents/jevBrain.js` — thêm `unfollow: 0.70` vào `confidenceThresholds` defaults (:71-80).
- `api/routes/ai/jev.js` — `JEV_THRESHOLD_UNFOLLOW` passthrough conditional-spread + clamp [0,1] (pattern đã chuẩn hóa).
- `.env.example` — `JEV_COGNITIVE_UNFOLLOW=1`, `JEV_THRESHOLD_UNFOLLOW=0.70`, `JEV_UNFOLLOW_MAX_EVALS=300`.
- `vitest.config.js` env — `JEV_COGNITIVE_UNFOLLOW: '0'` (test-safe default; wiring test override bằng module mock).
- `api/services/jobQueue.js` — chỉ đọc: `unfollowNonFollowers` dispatch :287-300 (session→browser, else→API). Không sửa.
- `x_smart_unfollow` (server.js:5013) — **out of scope**: localTools path, user objects thiếu bio đáng tin; ghi deferred nếu cần.

## Tasks & Acceptance

**Execution:**
- [x] `src/automation/jevUnfollowGuard.js` — NEW: env resolvers + `evaluateUnfollowTargets(users, {brain, threshold, maxEvals, pLimit})` → `{verdicts, degraded}`; state = `{username, name, bio(≤500), verified, followersCount?}`; question `verdict: Choice(4)` criteria cố định.
- [x] `api/services/operations/puppeteer/unfollowNonFollowers.js` — wire: evaluate trước loop; skip `keep_*`/low-conf/degraded; `result.keptByJev`, `result.jevDegraded` count; **thêm `config.dryRun` branch** (preview verdicts, không `unfollowUser`) — fix pre-existing gap.
- [x] `api/services/operations/unfollowNonFollowers.js` — expand `user.fields` :44 + **inline** guard trong `if (!followsBack)` trước `client.delete` :80 (fused loop, không pre-pass); skip delete khi verdict không phải confident `unfollow_*`.
- [x] `jevBrain.js` + `api/routes/ai/jev.js` + `.env.example` + `vitest.config.js` — `unfollow` threshold default/env/docs/test-guard.
- [x] `tests/automation/jevUnfollowGuard.test.js` — NEW: verdict matrix, fail-safe polarity, degraded, kill-switch, cap, bio bound.
- [x] `tests/automation/unfollowNonFollowers.jev.test.js` — NEW: `vi.mock` browserAutomation (createPage/getFollowing/getFollowers/unfollowUser) → assert VIP verdict không bị `unfollowUser`, spam verdict bị unfollow, degraded→keep.
- [x] `sprint-status.yaml` — tracking.

**Acceptance Criteria:**
- Given nonFollower bio "crypto airdrop farmer 🚀DM for promo" và Jev trả `unfollow_spam` conf 0.9, thì account bị `unfollowUser`.
- Given nonFollower bio "CEO @ BigCo, 500k followers" và Jev trả `keep_high_value_influencer` conf 0.9, thì account KHÔNG bị unfollow, xuất hiện trong `keptByJev`.
- Given Jev degraded toàn bộ, thì `unfollowed:[]`, `keptByJev` = toàn bộ candidates, `jevDegraded: N`, job success.
- Given `JEV_COGNITIVE_UNFOLLOW=0`, thì không `decide` call nào — behavior giống hệt pre-story.
- Given browser executor `config.dryRun=true`, thì không `unfollowUser` call nào và result chứa `dryRun:true` + verdicts preview (fix pre-existing gap).
- Given `npx vitest run tests/automation/` thì pass, kể cả kill-switch off.

## Implementation Notes

- Implemented 2026-09-22. `evaluateUnfollowTargets` returns `{verdicts: Map<username,{choice,confidence}>, degraded: number}`; verdicts map contains raw Jev answers for all non-degraded evaluated candidates (including `keep_*`/low-conf) so callers can preview the full matrix — qualify rule is `isConfidentUnfollowVerdict` (strict membership in `['unfollow_dead','unfollow_spam']` && confidence >= threshold), never `brain.gate()`. Candidates need a non-empty username (filtered before eval — an '' key would govern every nameless candidate).
- Budget semantics (post-review): `JEV_UNFOLLOW_MAX_EVALS` bounds paid decide calls per run; candidates BEYOND the budget are KEPT (deferred to a later run), never unfollowed unevaluated — browser path caps the operative slice at `min(limit, maxEvals)`, API path sets `jevKeep` once `jevEvaluated >= jevBudget`. `<=0` with the guard enabled → nothing is unfollowed; full bypass requires `JEV_COGNITIVE_UNFOLLOW=0`.
- Browser executor reads `config.limit ?? config.maxUnfollows` (routes send `maxUnfollows` — operative cap now honors the route field). Early return + dryRun branch return the full result shape (`verdicts`, `wouldUnfollow`, `keptByJev`, `unfollowed`, `failed`, `totalProcessed`); `totalProcessed` includes kept accounts; kept accounts still honor the every-10 safety pause.
- API path collects per-user `verdicts` preview entries (dryRun parity) and caps scanning at `nonFollowers.length >= maxUnfollows` since kept accounts no longer advance `unfollowedCount`.
- `src/types/twitter.d.ts`: added `description`/`verified` to `TwitterApiUser` to match the expanded `user.fields`. `src/automation/jevUnfollowGuard.d.ts` declares the public surface (src/automation convention).

## Spec Change Log

## Review Triage Log

3 layers (blind B1-12, edge E1-12, verification-gap V1-3 + 3 other) — ~27 findings, dedupe thành patch-groups; 0 intent_gap, 0 bad_spec:

| # | Findings | Verdict | Root-cause fix |
|---|----------|---------|----------------|
| P1 | B1, B2 | low | Xóa `options.threshold` khỏi JSDoc (dead — qualify sống ở `isConfidentUnfollowVerdict`) + bỏ `confidenceThresholds:{unfollow}` trong `resolveBrain` (guard không gọi `gate()`). GIỮ `unfollow` default trong JevBrain + route passthrough — public contract cho `/decide` gate callers |
| P2 | B3 | medium | Browser path không có `followersCount` (`getFollowing` :1118-1126 không trả) nhưng question bảo Jev judge "follower count" → reword criteria không hinge trên signal vắng ("follower count when present"); field optional giữ nguyên cho API path |
| P3 | B4 | medium | `config.limit ?? config.maxUnfollows` — route gửi `maxUnfollows` nhưng executor chỉ đọc `limit` → hiện unfollow tới `nonFollowers.length` (≤1000). Cùng class với dryRun drift đã fix |
| P4 | B5, E6 | medium | API fused-loop: `break` thêm `nonFollowers.length >= maxUnfollows` — keep-verdicts không đếm vào `unfollowedCount` nên scan cũ chạy ~1000 iterations (mỗi cái 1 followers-call + 500ms) |
| P5 | B6, V-other-3 | low | API path surface per-user `verdicts` trong result (asymmetry với browser dryRun); dryRun vẫn evaluate (preview kinh tế có chủ đích — spec đã chốt) |
| P6 | B7 (+V verify) | medium | checkJs errors MỚI trong files của diff: `keptByJev.push` string\|undefined, `state.followersCount` literal-type, `maxEvals` narrowing, TS1127 em-dash trong JSDoc :204-207 → ASCII. jev.js env-parse class pre-existing (commit 42.4/42.5) — chỉ fix line mới của mình |
| P7 | B8, E7 | medium | `''`-key collision: candidates thiếu username share key `''` → 1 verdict chi phối tất cả + `kept.has('')` global. Guard filter `username` truthy; executor loop skip `''`; API path chỉ push `keptByJev` khi username truthy |
| P8 | B9 | low | Positional-cap coupling: guard filter non-object trước khi slice nhưng caller slice raw `candidates` — caller áp cùng filter trước `slice(0, maxEvals)` |
| P9 | E10 (claim), V2 | medium | **Beyond-cap semantics**: khi Jev ON, candidates ngoài eval-budget phải **keep** (defer sang run sau), không "proceed unevaluated → unfollow" — AC "degraded → keptByJev = toàn bộ" chỉ đúng ≤300. Browser: `slice(0, min(limit, maxEvals))`; API: `jevEvaluated >= jevBudget` → `jevKeep=true` |
| P10 | B10, E4 | low | Early return `nonFollowers.length===0` thiếu `dryRun:true`/`verdicts`/`keptByJev` — shape lệch khi dryRun + list rỗng |
| P11 | E5 | low | dryRun return thiếu `unfollowed:[]`/`failed:[]`/`totalProcessed:0` — consumers đọc field chuẩn được undefined |
| P12 | E3 | low | `continue` của kept bỏ qua `(i+1)%10` pause check → pause bị skip khi kept rơi đúng vị trí chẵn — move pause check trước kept-continue |
| P13 | E8 | low | `choice.startsWith('unfollow_')` chấp nhận hallucinated verdict ngoài criteria → strict membership `['unfollow_dead','unfollow_spam']` |
| P14 | E9 | low | `_sharedBrain` rebuild chỉ khi key empty→set; key rotation non-empty→non-empty giữ stale → rebuild khi `apiKey !== env` |
| P15 | B11 | low | `totalProcessed` chỉ đếm unfollowed+failed → cộng `keptByJev.length` |
| P16 | B12a | low | `.d.ts` sibling convention thật (mọi module trong src/automation đều có) → thêm `jevUnfollowGuard.d.ts` |
| P17 | B12c, E11 | low | `.env.example` wording: "matches maxUnfollows cap" sai trên browser path + thiếu ceiling/<=0 semantics |
| P18 | V1, V2, V3 | medium | Tests: API-path `dryRun:true` (0 deletes + `dryRun:true`); beyond-budget → kept (cả 2 paths, sau P9); `/status` assert `unfollow:0.70` + bonus `like:0.6`/`reply:0.85`/`safeToSend:0.8` (G5 keys đã fix) |
| P19 | E1 | low | `pLimitFactory(EVAL_CONCURRENCY)` throw → sync-throw phá never-throws contract → wrap try/catch |
| **Defer** | V-other-1 | — | `socketHandler.js:600` `unfollowNonFollowersOp` = executor thứ 3 (page-context, không reach JevBrain) — pre-existing sibling surface, seam khác |
| **Defer** | V-other-2 | — | `actions.js:141` queue `unfollowNonFollowers` thiếu `userId`/`authMethod` → prisma undefined pre-existing, diff không đụng |
| **Reject** | E12 | false | Kill-switch+dryRun "khác pre-story": pre-story dryRun **là bug** (unfollow thật) — fix có chủ đích, không phải defect |
| **Reject** | B12d | false | sprint-status flipped sớm = tracking-only, sync cuối workflow |

## Design Notes

- **Fail-safe polarity:** unfollow_* cần conf ≥ threshold MỚI unfollow; mọi outcome khác → keep. Đảo ngược hướng so với "Jev quyết định có act không" thông thường — ở đây Jev quyết định có **cho phép** act không, và nghiêng về giữ quan hệ.
- **Pre-pass batch (browser) vs inline (API):** browser path có `nonFollowers[]` sẵn trước loop → batch evaluate p-limit(8), tách paid calls khỏi pacing browser (delay 3-7s + pause 15-30s/10). API path là fused loop (mỗi user 1 followers-call + inline delete) → guard gọi per-candidate ngay trước `client.delete`; cùng module, `evaluateUnfollowTargets([u])` cho mảng 1 phần tử.
- **dryRun gap (browser path):** route đã truyền `dryRun` nhưng executor không đọc — pre-existing safety bug (queued dry-run unfollow thật). Fix tại hook site vì story này cần preview-verdicts path anyway.
- **API path best-effort:** `processUnfollowNonFollowers` hiện chỉ request `user.fields: username` — phải mở rộng fields hoặc Jev chỉ có username (yếu). Nếu user object thiếu bio hoàn toàn, Jev vẫn chạy với username+name nhưng confidence thấp → keep (an toàn).
- **Không gọi `brain.gate()`:** qualify trực tiếp `choice.startsWith('unfollow_') && confidence >= threshold` — gate() confidence-only không phân biệt keep vs unfollow verdict (finding #2 từ live verify 42.5).

## Verification

**Commands:**
- `npx vitest run tests/automation/ tests/api/jev-lead-icp.test.js` — **44/44 pass** (post-review).
- `JEV_COGNITIVE_UNFOLLOW=0 npx vitest run tests/automation/ tests/api/ tests/mcp/` — **594/594 pass**, no regression.
- `node -e "import('./src/automation/jevUnfollowGuard.js').then(m => console.log(typeof m.evaluateUnfollowTargets))"` — `function`.
- `npx tsc --noEmit` — baseline-parity: 11 pre-existing `jev.js` env-parse/`_brain` errors (committed 42.4/42.5), **0 new** in diff files.

**Manual checks:**
- `grep -rn 'api.typesafe.ai' src/automation/` → **0 hits**.
- `git diff api/services/operations/` → additive wiring + user.fields expansion + post-review keep/budget semantics.
