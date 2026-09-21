---
title: 'Story 42.4: jev-challenge-diagnostics'
type: 'feature'
created: '2026-09-22'
status: 'done'
baseline_commit: 'f58f4bf5eb59943db8d66b7a5376bd19f916a810'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '_bmad-output/implementation-artifacts/epic-42-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Scraper nhận HTTP 200 nhưng body là checkpoint/soft-block (captcha, "Just a moment", login wall) hoặc trích xuất 0 records → hiện chỉ có regex tĩnh (`ChallengeSignatureDetector`, per-platform validators) bắt được pattern đã biết; challenge mới/biến thể đi qua như "thành công rỗng", account cứ retry vào tường → bot-like pattern + mất thời gian.

**Approach:** Thêm Jev semantic second-opinion: khi response 200 nghi ngờ (validator flags false-200/checkpoint mà static detector không bắt) hoặc scrape trả 0 records → lấy ≤500 ký tự text của response body → `jevBrain.decide(snippet, {pageStatus: Choice})`. Verdict `bot_challenge`|`login_wall` với confidence ≥ ngưỡng (mặc định 0.8) → throw `BotChallengeError` + `AdaptiveRateGovernor.recordBotChallenge()` (hibernate) như luồng static-detector hiện có.

## Boundaries & Constraints

**Always:**
- Jev chỉ là **second opinion** — static `ChallengeSignatureDetector` chạy trước như hiện tại; Jev chỉ gọi khi detector KHÔNG detect nhưng response vẫn nghi ngờ (validator flags) hoặc 0-records. Không gọi Jev trên mọi request (hot path).
- Escalation mirror đúng luồng hiện có: `accountPool.markUnavailable('bot_challenge')` + `governor.recordBotChallenge()` + `healthOrchestrator.recordBotChallenge()` (pattern base-client.js:1012-1025) rồi mới throw — không bỏ sót nhánh notify nào.
- Contract theo từng hook: `AbstractApiClient.request()` → **throw** `BotChallengeError` (giống :1058); `AbstractCrawler.start()` 0-records → **throw** tương tự (trước `return result`).
- Degrade an toàn: `jevBrain.decide()` không throw; `meta.degraded` hoặc confidence < threshold → KHÔNG escalate (không hibernate/throw trên degraded data). Chỉ log/telemetry.
- Threshold load từ config/env `JEV_THRESHOLD_PAGESTATUS` (default 0.8) — không hardcode. Kill-switch `JEV_CHALLENGE_DIAG` — **default ON**, chỉ tắt khi env ∈ `0|false|off|no` (KHÔNG dùng `isEnvTruthy` — polarity ngược: unset → false sẽ làm feature tắt mặc định).
- Snippet = ≤500 ký tự text: HTML → strip tags + collapse whitespace; object → JSON.stringify rồi slice.
- Choice criteria `pageStatus`: `ok` | `bot_challenge` | `login_wall` | `rate_limited`. Chỉ `bot_challenge`/`login_wall` escalate; `rate_limited` chỉ log (static detector/rate-limit path đã xử lý riêng).
- Dùng `jev.gate(answer, {action:'pageStatus'})` để quyết verdict — `act` → escalate, `review` → warn-log only, `skip` → nothing. Thêm `pageStatus` vào `confidenceThresholds` của JevBrain (config override được như các action khác).

**Never:**
- Không xóa/vô hiệu `ChallengeSignatureDetector`, `platform-validator.js`, hay per-platform validators — chúng vẫn là first-line (story chỉ GIẢM phụ thuộc, không rip-out).
- Không đụng `python/xeepy`, `api/routes/ai/scrape.js` (Puppeteer path riêng), hay `xspace-agents`.
- Không gọi `api.typesafe.ai` trực tiếp — mọi Jev call qua `jevBrain` (sole gateway, AC 42.1).
- Không thay đổi `BotChallengeError`/`PlatformError` defaults, không đổi code/behavior của các error class hiện có.
- Không hibernate khi Jev degraded, khi conf < threshold, hoặc khi verdict là `ok`/`rate_limited` — empty result thật (feed rỗng hợp lệ) phải trả về bình thường như hiện tại.
- Không thêm dependency mới vào `package.json`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_EMPTY | 200, body JSON `{"items":[]}`, validator flag false_200, Jev → `ok` conf 0.9 | Trả data rỗng như hiện tại; 1 Jev call; không notify/throw | N/A |
| JEV_CHALLENGE | 200, body HTML captcha variant (detector miss), validator flag, Jev → `bot_challenge` conf 0.92 | Throw `BotChallengeError`; pool+governor+orchestrator notified; hibernate ~20min | BotChallengeError retryable (ROTATE_PROXY) |
| JEV_LOGIN_WALL | 200, body redirect-login HTML, Jev → `login_wall` conf 0.85 | Như trên — escalate | Idem |
| MID_CONF | Jev → `bot_challenge` conf 0.7 (<0.8) | Không throw/hibernate; `console.warn` + telemetry ghi `pageStatus` verdict | N/A |
| DEGRADED | Thiếu TYPESAFE_API_KEY / API lỗi | `meta.degraded` → bỏ qua hoàn toàn, flow y như cũ | Không side-effect |
| RATE_LIMITED | Jev → `rate_limited` conf 0.9 | Log only — không escalate (governor đã có rate-limit path riêng) | N/A |
| CRAWLER_0_RECORDS | `AbstractCrawler.start()` handler trả result `extractItemCount===0` (null/empty-array/count-0), `this.client.lastResponseSnippet` có sẵn | Diagnose snippet; escalate nếu verdict hợp lệ | Không snippet → skip Jev, log only |
| VALIDATOR_LOGIN_WALL | 200, `isLoginWall`=true (validator) nhưng `isBotChallenge`=false + detector miss | Jev chạy (isCheckpoint flag) → verdict `login_wall` conf≥0.8 → escalate — **behavior change mới**: login wall hôm nay qua lặng, giờ thành BotChallengeError | BotChallengeError |
| KILL_SWITCH | `JEV_CHALLENGE_DIAG=0` | Không Jev call nào ở mọi hook; flow legacy | N/A |
| SNIPPET_EDGE | body non-UTF8/empty/`<500 chars` | extractSnippet trả text ngắn/rỗng → rỗng thì skip Jev | N/A |

**Decision (delegated, verified vs docs+code):** `BotChallengeError` code = **`XACT_4030`** — consistent với mọi bot-challenge throw hiện có (8+ sites: base-client ×3, zalo/youtube/threads/tiktok/b2b/tiktok-shop). Epic's `XACT_5030` là doc-stale (code đó đang là PROXY_EXHAUSTED ở 10 sites); docs/architecture.md:170 + AD-42 ghi "XACT_5030 or HTTP 403" trước khi taxonomy đổi — story là drop-in replacement nên cùng class cùng code, consumer contract không đổi.

</frozen-after-approval>

## Code Map

- `src/core/jev-challenge-diagnoser.js` — **NEW**. Lazy `JevBrain` singleton; `extractSnippet(body)` (≤500 chars); `diagnose({snippet, platform, accountId})` → `decide(snippet, {pageStatus: Choice})` + `gate()`; trả `{verdict, confidence, degraded}` hoặc null. Honor `JEV_CHALLENGE_DIAG` + `JEV_THRESHOLD_PAGESTATUS`. Export qua `src/core/index.js` barrel (pattern :39).
- `src/core/base-client.js` — **EDIT** `request()` 2xx branch (:1028-1073). Lưu ý scope: `isFalse200`/`isCheckpoint` ở :883-911 nằm trong telemetry closure — **không in-scope** ở đây; recompute inline qua `this.responseValidator` (pattern sẵn có :1041). Thêm: (1) stash `this.lastResponseSnippet = extractSnippet(response?.data || response)` đầu 2xx branch trước throw-site; (2) sau block `(challengeResult?.detected || isValidatorChallenge)` thất bại — nếu `isFalse200 || isCheckpoint` (recomputed) → `diagnose()` → escalate→throw theo notify-trio :1049-1057.
- `src/core/base-crawler.js` — **EDIT** `start()` **giữa :758 và :806** (post-handler, TRƯỚC `return result` — `extractItemCount` call ở :825 nằm trong `finally`, chỉ telemetry). `this.client` available (:784/:814). `count===0` + `this.client?.lastResponseSnippet` → diagnose → escalate (throw như client path).
- `src/agents/jevBrain.js` — **EDIT nhỏ**: thêm `pageStatus` key vào `confidenceThresholds` defaults (:71-80) + cho phép env/config override (pattern hiện có).
- `api/routes/ai/jev.js` — **EDIT nhỏ**: passthrough `JEV_THRESHOLD_PAGESTATUS` vào `getBrain()` (:27-31 pattern).
- `src/core/index.js` — **EDIT**: export `JevChallengeDiagnoser` + global singleton (pattern :39).
- `.env.example` — **EDIT**: document `JEV_CHALLENGE_DIAG`, `JEV_THRESHOLD_PAGESTATUS` (section TYPESAFE/JEV — hiện chưa có section này, thêm mới).
- `tests/core/jev-challenge-diagnoser.test.js` — **NEW**: inject fake jev (constructor param, repo convention fakes-at-IO-boundary); cover I/O matrix rows.
- `tests/core/base-client-challenge-detector.test.js` — **EDIT**: thêm case Jev-escalate (validator-flagged + detector-negative + fake brain verdict).
- `src/scrapers/index.js:214-241` — context only: 26 descriptors ("26 platforms").
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — **EDIT**: `42-4` → in-progress → done.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/jev-challenge-diagnoser.js` — tạo module (lazy brain, extractSnippet, diagnose, env flags) — core của story.
- [x] `src/agents/jevBrain.js` — thêm `pageStatus` threshold default + override — gate() dùng được.
- [x] `src/core/base-client.js` — stash snippet + Jev hook trong 2xx suspicious path — hook chính cho 25/26 platform HTTP.
- [x] `src/core/base-crawler.js` — 0-records trigger post-handler — cover crawler-level empty-result trên HTTP-engine crawlers.
- [x] `src/core/index.js` + `api/routes/ai/jev.js` + `.env.example` — export, env passthrough, docs.
- [x] `tests/core/jev-challenge-diagnoser.test.js` + sửa `tests/core/base-client-challenge-detector.test.js` — vitest, no-network (inject fake brain/governor/pool), cover mọi row matrix.
- [x] `sprint-status.yaml` — cập nhật tracking.

**Acceptance Criteria:**
- Given 200 response validator-flagged mà static detector miss, khi Jev verdict `bot_challenge`/`login_wall` conf ≥ threshold, thì `BotChallengeError` thrown + notify-trio chạy đúng thứ tự trước throw.
- Given Jev verdict `ok` hoặc conf < threshold hoặc degraded, thì response trả về bình thường, không side-effect nào ngoài log/telemetry.
- Given `AbstractCrawler` handler trả 0 items và có `lastResponseSnippet`, khi Jev verdict escalate, thì `BotChallengeError` thrown từ `start()`.
- Given validator `isLoginWall`=true + detector miss + Jev `login_wall` conf≥0.8, thì `BotChallengeError` thrown (login wall escalation — behavior change có chủ đích so với hiện tại qua lặng).
- Given `JEV_CHALLENGE_DIAG=0` hoặc thiếu `TYPESAFE_API_KEY`, thì mọi hook no-op và flow giống hệt trước story.
- Given `npx vitest run tests/core/`, thì các test challenge-detector pass kể cả case mới.

## Implementation Notes

- Implemented 2026-09-22. `JevChallengeDiagnoser` injects brain via constructor `options.brain` (fakes-at-IO-boundary); global singleton `globalJevChallengeDiagnoser` lazily constructs `JevBrain` on first `diagnose()`. Tests force `enabled`/inject fake brain so they pass under `JEV_CHALLENGE_DIAG=0` env runs. Escalation hibernation = `20 * 60 * 1000` inline, mirroring `AdaptiveRateGovernor.recordBotChallenge` default.
- Post-review hardening (G1-G14): snippet chỉ từ `response.data`/Buffer body (envelope+headers không bao giờ rời process); stash gated trên `!isRaw && enabled`; `lastResponseSnippet`/`_lastJevDiag` cleared mỗi attempt + trước mọi BotChallengeError throw; dedupe keyed-by-snippet giữa client/crawler hook; dedicated-path ownership (`isRateLimit` → XACT_4290, authed `isLoginWall` → XACT_4010 — Jev không preempt); `enabled`/`threshold` resolve lazy per-call (`.env` post-import hoạt động); threshold clamp [0,1]; `quarantineProxy` khi escalate; sentinel `guest`/`default` filtered; dry-run guard.
- **3xx scope:** hook chạy trên `status >= 200 && < 400` (success branch hiện có) — review giữ nguyên: 3xx bị validator flag cũng là evidence hợp lệ cho Jev.
- **Telemetry:** MID_CONF `console.warn` carry platform+verdict+conf là record chính; crawler no-snippet skip = 1-line `console.log`; field `pageStatus` riêng trong telemetry pipeline = deferred (schema change ngoài scope).

## Spec Change Log

## Review Triage Log

3 layers (blind B1-11, edge E1-14, verification-gap V1-11) — dedupe thành root-cause groups, tất cả **patch** (không intent_gap, không loopback):

| # | Findings | Verdict | Root-cause fix |
|---|----------|---------|----------------|
| G1 | E1(HIGH), E2, B4, B11 | patch | Snippet chỉ từ `response.data` (Buffer body → utf8); **không bao giờ stringify envelope** (headers/set-cookie leak); skip stash khi `isRaw` hoặc diagnoser disabled; bound input trước regex (≤64KB); stringify-fail → `''`; HTML test siết `/<[a-zA-Z!/][^>]*>/` |
| G2 | B3, E4, B2, E6, B10 | patch | Clear `lastResponseSnippet` đầu mỗi request attempt + đầu crawler `start()` + trước cả 2 BotChallengeError throw sites; dedupe qua `client._lastJevDiag` keyed-by-snippet (crawler reuse, không paid-call lần 2) |
| G3 | B1, E8 | patch | `validateResponse()` trong inner try riêng — flags đã collect không bị veto |
| G4 | E7, V1 | patch | Dedicated-path ownership: skip Jev khi `isRateLimit` (path :1183 owns) hoặc `isLoginWall && effectiveRequiresAuth` (XACT_4010 owns) |
| G5 | B5, V3, E10b | patch | `jev.js` pageStatus conditional-spread + finite guard (key absent khi unset/NaN → default 0.8 đứng; pre-existing like/reply/safeToSend bug giữ nguyên — out of scope) |
| G6 | E5 | patch | Crawler hook guard `!this._currentDryRun` |
| G7 | B6 | patch | Sentinel filter `guest`/`default` → null trước notify (mirror :736-738) |
| G8 | B9, E9 | patch | `enabled`/`threshold` resolve lazy trong `diagnose()` — `.env` qua dotenv + runtime override hoạt động |
| G9 | E10a | patch | Clamp `resolvePageStatusThreshold` về [0,1] |
| G10 | E11 | patch | `quarantineProxy(proxy, hibernationMs)` trong escalate block khi proxy có sẵn |
| G11 | B7, V8 | patch | Apply threshold override lên injected brain (`confidenceThresholds.pageStatus`) |
| G12 | E14 | patch | `opts.enabled` string → normalize qua `isJevChallengeDiagEnabled` |
| G13 | V4, E13 | patch-lite | Crawler skip + Jev verdict ghi 1-line log; telemetry field riêng = deferred (warn đã carry verdict+conf) |
| G14 | V2, V5, V6, V10, V11 + new-behavior | patch | Tests: crawler notify-trio reachable, client HAPPY_EMPTY/RATE_LIMITED, detector-positive no-Jev, dry-run, stale-snippet clear, dedupe, auth-owned XACT_4010, isRateLimit không bị preempt, envelope-leak, notify ordering |

**Rejected/skipped:** V9 (non-UTF8 buffer — trivia), B8 (3xx scope — giữ `<400`, ghi Implementation Notes), pre-existing `undefined`-spread của like/reply/safeToSend (42.1 behavior, out of scope).

## Design Notes

- **Vì sao second-opinion chứ không thay thế:** static detector rẻ, chạy mọi response, bắt ~known-good patterns. Jev chỉ tốn call trên nhánh nghi ngờ (rare) — vừa giảm regex-dependency (challenge mới không cần signature mới) vừa giữ cost ~0.
- **0-records snippet source:** crawler không giữ raw body → `AbstractApiClient` stash `lastResponseSnippet` (500 chars, mutable, per-request overwrite — best-effort attribution: snippet của response 2xx cuối cùng trước khi handler trả). Không snippet → skip, không phán đoán trên thiếu evidence.
- **Browser path deferred:** `detectChallengeOnPage`/`detectFromHtml` là dead seam hôm nay (0 callers; spine không giữ `page` — page access nằm trong per-platform handlers như facebook `pagePosts`). Jev-ize nó = dead code; wire per-platform = phẫu thuật từng crawler → ghi deferred-work. Scope thật: HTTP spine (25/26 platforms qua AbstractApiClient) + crawler 0-records trên crawler có HTTP client.
- **`extractItemCount` semantics:** object non-empty không có array-key (`items/posts/data/records/results`) đếm = 1 → trigger chỉ fire trên null / array rỗng / count=0 — list-type results. Single-object scrapes không trigger (đúng ý).
- **Rate-limited không escalate:** static detector + `recordRateLimit` đã có path riêng; Jev chỉ label để observability — tránh double-punish (hibernate chồng rate-limit).

## Verification

**Commands:**
- `npx vitest run tests/core/jev-challenge-diagnoser.test.js tests/core/base-client-challenge-detector.test.js` -- expected: all pass, no network.
- `node -e "import('./src/core/jev-challenge-diagnoser.js').then(m=>console.log(Object.keys(m)))"` -- expected: exports ra được (diagnoser + singleton), không crash thiếu TYPESAFE_API_KEY.
- `JEV_CHALLENGE_DIAG=0 npx vitest run tests/core/` -- expected: kill-switch path vẫn pass.

**Manual checks:**
- `git diff src/core/base-client.js` — notify-trio thứ tự đúng như block :1012-1025 hiện có; không Jev call trên detector-positive path.
- `.env.example` có section JEV mới với 2 vars.
