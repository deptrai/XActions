---
title: 'Story 42.3: jev-verify-regression-guard'
type: 'feature'
created: '2026-09-22'
status: 'done'
baseline_commit: '67d4ccc2322594a4c263cc527f955598144a6c4f'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '_bmad-output/implementation-artifacts/epic-42-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `scripts/jev-verify/` là harness ad-hoc chạy tay — in accuracy ra stdout rồi thôi, không có gate nào. Jev (`jev-latest`) là model bên thứ ba có thể drift khi provider update; corpus 40 items chưa đủ cover (thiếu self-promo — crack đã biết; thiếu nhiều vi/mixed edge-case), và không có cơ chế nào báo khi accuracy tụt.

**Approach:** Nâng harness thành CI regression guard: mở rộng corpus ≥50 items, thêm `--ci` mode enforce accuracy floor (vi≥85%, spam≥95%, relevance≥0.75) với exit code + GitHub annotations, baseline-drift warning (>5đ so với `baseline.json`), workflow mới chạy theo path-trigger + weekly cron + dispatch. Refactor `verify.mjs` export pure functions để vitest cover logic evaluate/floor-check không cần API.

## Boundaries & Constraints

**Always:**
- Harness vẫn chạy độc lập: `node scripts/jev-verify/verify.mjs` (không flag) giữ behavior cũ — in per-item + tổng hợp, exit 0 khi có kết quả.
- `--ci` = strict mode: so sánh metrics với `floors.json`; breach → `::error::` annotation + exit 1; drift `baseline - current >= driftWarnDelta` → `::warning::` (không fail).
- `verify.mjs` export `buildQuestions`, `evaluate`, `summarize`, `checkFloors` và chỉ chạy main khi là entry point (`import.meta.url` check) — vitest import được mà không gọi API.
- **`isSpam` parity rule:** instruction string `isSpam` phải byte-identical ở 4 chỗ (verify.mjs + thoughtLeaderAgent ×2 + algorithmBuilder) — đây là shared spam-detection contract. (Question set tổng thể KHÔNG verbatim: prod `action`/`relevance` wording khác harness theo thiết kế hiện có — chỉ `isSpam` và `replyWorthy` trùng; không "đồng bộ" các câu hỏi khác.)
- **Decision (human-approved):** nới `isSpam` instruction đồng bộ cả 4 chỗ thành đúng literal `'This post is spam, bait, scam, or airdrop-farming — not mere self-promotion'` (giữ prefix "This post is", bỏ "low-effort promotion"), và thêm ~4 self-promo corpus items `truth.spam=0` để pin crack đã biết.
- Corpus items mới phải có ground truth hợp lý (`truth.relevant|spam|replyWorthy` ∈ {0,1}) và `_note` cập nhật số lượng.
- Workflow skip bằng `::warning::` notice khi `TYPESAFE_API_KEY` vắng (fork PRs) — không bao giờ đỏ CI vì thiếu secret.
- ESM, `const`, emoji logs, `// by nichxbt`, JSDoc — theo style repo.

**Never:**
- Không route harness qua `JevBrain.decide()` — degrade/fallback sẽ che mất API failure mà regression guard phải bắt được. Giữ direct `fetch` (harness hiện zero-dependency, chạy cả khi chưa `npm ci`).
- Không unhandled crash: mọi failure path đều kết thúc bằng exit code có chủ đích. Per-item API errors → `::warning::` + loại khỏi metrics; error-rate = `errors / corpus.items.length` > `maxItemErrorRate` → `::error::` run-invalid + exit 1 (đây là cách `--ci` báo API outage — KHÔNG tính floors trên sample thiếu).
- `floors.json`/`baseline.json` thiếu hoặc malformed: `--ci` → `::error::` + exit 1 (gate hỏng phải báo to, không được âm thầm pass); mode thường → warn + tiếp tục không floor-check.
- Không đụng `LLMBrain`, `jevBrain.js` internals, `DistributedTokenBucket`.
- Không thêm dependency mới vào `package.json` (harness dùng native `fetch`, Node 20).
- Không floor `byLang.en`/`mixed` trong `floors.json` mặc định (en hiện 79% — margin quá mỏng, sẽ flaky); chỉ floor theo AC + relevance overall.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path — local | `node verify.mjs` + key set, API ok | Per-item log + RESULT summary, exit 0 | Không lỗi |
| CI pass | `--ci`, mọi metric ≥ floor | Exit 0, in metrics + "✅ floors pass" | Không lỗi |
| Floor breach — spam | `--ci`, spam acc 0.93 < 0.95 | `::error::spam accuracy 93% < floor 95%` + exit 1 | Exit 1 |
| Floor breach — vi | `--ci`, vi acc 0.80 < 0.85 | `::error::` + exit 1 | Exit 1 |
| Drift warning | `--ci`, relevance 0.80 vs baseline 0.85 (Δ≥5đ) nhưng ≥ floor | `::warning::relevance drifted -5đ vs baseline` + exit 0 | Không fail |
| Corpus dưới min | `--ci`, `corpus.items.length < 50` | `::error::corpus below minimum (N < 50)` + exit 1 | Exit 1 |
| Config hỏng | `--ci`, floors.json/baseline.json thiếu/malformed | `::error::` + exit 1 | Exit 1 |
| Missing key — CI | `TYPESAFE_API_KEY` vắng | Workflow step echo `::warning::skipped — no TYPESAFE_API_KEY` + exit 0 | Skip sạch |
| Missing key — local | Không key, không `--mock` | `❌ TYPESAFE_API_KEY not set` + exit 1 (giữ behavior cũ) | Exit 1 |
| Per-item API error | 1 item trả HTTP 500 | `::warning::` (ở --ci) + `❌ {id}` log, item loại khỏi metrics; errors/items >0.2 → run invalid | `--ci` exit 1 |
| `--mock` | Flag `--mock` | In request shape, không tính floors | Exit 0 |
| `--out` | `--out results.json` | Ghi `{date, metrics, byLang, tokens, cost, perItem}` ra file TRƯỚC khi exit (kể cả floor breach) | Lỗi ghi → warn, không crash |

</frozen-after-approval>

## Code Map

- `scripts/jev-verify/verify.mjs` -- TARGET: refactor export functions + main guard; thêm `--ci`, `--out <path>`, floor-check sau summary; giữ `callJev` direct-fetch.
- `scripts/jev-verify/corpus.json` -- TARGET: +≥10 items (t41+): ~4 self-promo `truth.spam=0` (pin crack), thêm vi/mixed/edge-case (hashtag-only, tweet dài, mention legit, thread marker, emoji-heavy non-spam).
- `scripts/jev-verify/floors.json` -- NEW: `{"overall":{"relevance":0.75,"spam":0.95},"byLang":{"vi":0.85},"driftWarnDelta":0.05,"maxItemErrorRate":0.2}`.
- `scripts/jev-verify/baseline.json` -- NEW: seed bằng verified metrics cũ `{relevance:0.85, spam:0.98, vi:0.92, mixed:1.0, en:0.79}`; SAU first successful `--ci` run trên corpus mới → ghi đè metrics mới (re-baseline, vì corpus+isSpam đổi trong chính story này).
- `.github/workflows/jev-regression.yml` -- NEW: `on: push/PR→main` paths `scripts/jev-verify/**`, `src/agents/jevBrain.js`, `src/agents/thoughtLeaderAgent.js`, `src/algorithmBuilder.js`, `tests/scripts/**`, `.github/workflows/jev-regression.yml`; `schedule: '0 3 * * 1'` (chỉ default branch); `workflow_dispatch`. `concurrency` group theo kiểu ci.yml; `timeout-minutes: 10`. Secret promote qua job-level `env: TYPESAFE_API_KEY: ${{ secrets.TYPESAFE_API_KEY }}` (mirror deploy-railway.yml:40) — KHÔNG dùng `secrets` trong `jobs.if` (parse error); step check shell `[ -z "$TYPESAFE_API_KEY" ]` → `::warning::` skip + exit 0, ngược lại chạy `--ci --out` + `actions/upload-artifact@v4` với `if: always()`, `if-no-files-found: warn`, retention 14d.
- `dashboard/jev-test.html` -- OUT-OF-SCOPE: isSpam question riêng (`'Is this post spam, scam, crypto-farming, or engagement bait?'`) — test page, divergent by design, không đồng bộ.
- `package.json` -- sửa: thêm `"verify:jev": "node scripts/jev-verify/verify.mjs"`, `"verify:jev:mock": "node scripts/jev-verify/verify.mjs --mock"`.
- `tests/scripts/jev-verify.test.js` -- NEW: vitest (`vitest.config.js` include `tests/**/*.test.js`), explicit imports `describe/it/expect/vi` + fixtures → cover `evaluate` (score≥2, spam≥0.6, `answers` undefined/partial → null preds không throw), `summarize` (acc + byLang combined-hit), `checkFloors` (pass/breach/drift≥delta/error-rate/corpus<50).
- `src/agents/thoughtLeaderAgent.js` (dòng ~275, ~390) + `src/algorithmBuilder.js` (dòng ~328) -- 3 prod sites: đổi literal `isSpam` sang `'This post is spam, bait, scam, or airdrop-farming — not mere self-promotion'` byte-identical với verify.mjs (decision đã duyệt).
- `.github/workflows/ci.yml` -- READ-ONLY reference: job/env/step style; KHÔNG sửa (workflow mới tách riêng).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` -- cập nhật `42-3-...: done` sau verify.

## Tasks & Acceptance

**Execution:**
- [x] `scripts/jev-verify/verify.mjs` -- refactor: export `buildQuestions`/`evaluate`/`summarize`/`checkFloors` (evaluate nhận `answers ?? {}` → null preds, không throw), main-guard; flags `--ci` (validate config → corpus≥50 check → floors + drift-warn + error-rate → `::error::/::warning::` + exit code), `--out <path>` ghi TRƯỚC exit, `--mock` giữ nguyên; update `isSpam` literal mới -- CI-mode core.
- [x] `scripts/jev-verify/corpus.json` -- mở rộng ≥50 items: ~4 self-promo `truth.spam=0` + vi/en/mixed + edge-cases -- corpus floor + crack pin.
- [x] `scripts/jev-verify/floors.json` + `scripts/jev-verify/baseline.json` -- tạo config floors theo AC + seed baseline metrics cũ; sau first verified `--ci` run trên corpus ≥50 → update baseline.json theo metrics mới -- gate config + re-baseline.
- [x] `tests/scripts/jev-verify.test.js` -- unit-test pure functions bằng fixtures (no API) -- harness regression.
- [x] `.github/workflows/jev-regression.yml` -- workflow mới: path-filter (gồm self + tests/scripts), weekly cron, dispatch, concurrency group, secret→env promotion, shell key-check skip-warn, run `--ci`, artifact `if: always()` -- CI wiring.
- [x] `package.json` -- thêm `verify:jev`/`verify:jev:mock` scripts -- DX.
- [x] `src/agents/thoughtLeaderAgent.js` + `src/algorithmBuilder.js` -- đổi literal `isSpam` ở 3 prod sites → byte-identical với verify.mjs (4 chỗ tổng) -- crack fix.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- `42-3-jev-verify-regression-guard-...: done` -- tracking sync.

**Acceptance Criteria:**
- Given `TYPESAFE_API_KEY` set, when `node scripts/jev-verify/verify.mjs` chạy, thì corpus ≥50 items được evaluate và summary in relevance/spam/byLang/tokens/cost như hiện tại.
- Given `verify.mjs --ci` với mọi metric ≥ floor, thì exit 0; given spam acc < 0.95 hoặc vi acc < 0.85 hoặc relevance acc < 0.75, thì `::error::` annotation + exit 1.
- Given metric tụt ≥5đ so `baseline.json` nhưng vẫn ≥ floor, thì `::warning::` drift annotation + exit 0 (áp cho mọi metric có trong baseline: relevance/spam/vi/mixed/en).
- Given `corpus.items.length < 50` trong `--ci`, thì `::error::` + exit 1 trước khi gọi API.
- Given `floors.json`/`baseline.json` thiếu/malformed trong `--ci`, thì `::error::` + exit 1; mode thường → warn + chạy tiếp.
- Given >20% items bị API error trong `--ci` (errors/total corpus items), thì exit 1 với `::error::` run-invalid (không tính floors trên sample thiếu).
- Given không có `TYPESAFE_API_KEY`, thì workflow step skip bằng `::warning::` notice, exit 0.
- Given PR không đụng paths liên quan, thì `jev-regression` không chạy; given push đụng `scripts/jev-verify/**` hoặc `src/agents/jevBrain.js`, thì chạy.
- Given `npx vitest run tests/scripts/jev-verify.test.js`, thì pass (evaluate/summarize/checkFloors coverage, no network).
- Given `--mock`, thì in request shape, exit 0, không đọc floors.
- Given first `--ci` run thành công trên corpus mới, thì `baseline.json` được update theo metrics mới (re-baseline một lần trong story này).

## Implementation Notes

- `verify.mjs` rewrite: exports `buildQuestions`/`evaluate`/`summarize`/`checkFloors` + entry-guard; `--ci` validate config → corpus≥50 → floors/drift/error-rate; `--out` ghi trước exit; top-level catch → exit 1 có chủ đích.
- Corpus 52 items (t41–t52): 4 self-promo pin crack, hashtag-bait spam, long-form, legit mention, thread marker, emoji non-spam, vi spam, meta/edge.
- Real `--ci` run (52/52, 0 errors): relevance 84.6% / spam 100% / vi 94.1% / mixed 100% / en 77.4% → floors pass; `baseline.json` re-baselined theo metrics này. Self-promo items đều spam 0.15–0.21 → crack fix verified live.
- en 77.4% unfloored by design (margin mỏng); drift-warn sẽ bắt nếu en tụt ≥5đ.
- Verify: 22/22 vitest pass; 4 chỗ isSpam byte-identical, 0 old literal; `--mock` exit 0 (52 shapes).
- **Review pass 1 (3 layers, 31 findings):** 26 patch — `main()` return-code + `--out` mọi exit path, `AbortSignal.timeout(30s)`, strict `parseFlags`/gate-config/corpus-schema validation, missing-`answers`→item-error, `--validate` offline mode (workflow chạy trước secret-check → fork PRs vẫn được validate), annotation sanitize + 1-decimal pct, `TYPESAFE_API_ENDPOINT` honored, realpath entry-check, audit metadata trong payload; tests +19 (boundary exit/annotations, real config files, prod `decide()` literal assertions); `t39.text` `""`→`"."` (schema mới cấm empty). 3 false (B2/B3 — scope by design), 2 low-rejected (B14/B17/B18). Post-patch: 34/34 jev-verify tests + 53/53 total, real `--ci` run identical baseline, `--validate`/`--mock` exit 0.

## Spec Change Log

## Review Triage Log

**Pass 1 (2026-09-22) — 3 layers: blind-hunter, edge-case-hunter, verification-gap**

- E1 `verify.mjs` parseFlags: `--out --ci` writes file literally named `--ci`; `--out=`/trailing `--out` silently ignored — **low**, verified (parseFlags:250-258, no flag-value validation).
- E2 `--out` never written on early exits (config-error/corpus<50/missing-key/no-results at :288-332) — artifact absent exactly on failure runs — **medium**, verified.
- E3 `callJev` no timeout — hung socket eats 10-min CI job, no exit code/artifact — **medium**, verified (fetch at :63-67 has no AbortSignal).
- E4 `--mock`+`--out` → requested file silently never written — **low**, verified (mock early-returns at :271-279).
- E5 `floors.overall` keys other than relevance/spam never enforced — checkFloors hardcodes `['relevance','spam']` loop — **low**, verified.
- E6 baseline metric absent from `summary.byLang` (all its items errored) → drift check silently skipped — **low**, verified (`metricValue`→undefined→continue).
- E7 symlinked `argv[1]` → `invokedAsEntry` false → main never runs, silent exit 0 — **low**, verified (no `realpathSync` on argv[1]).
- V1 `--ci` breach→`::error::`→exit-1 translation has no automated test — only pure `checkFloors` covered; gate could be bypassed while unit tests stay green — **medium**, verified (test file imports pure fns only; no main/exit boundary test).
- V2 isSpam parity checked as source-text scan only — no runtime assertion that prod `decide()` calls carry the literal — **low**, verified (test reads prod source; agent tests mock decide without asserting questions arg).
- V3 missing-secret workflow path does zero offline validation — fork PR with broken corpus/gate JSON merges green — **medium**, verified (workflow exits before parsing any gate input).
- V4 `baseline.json` accepts `{foo:1}` (only `some(numeric)` required); non-numeric floor values inert — malformed config silently disables drift/floor checks — **medium**, verified (loadGateConfig:235-241).
- V5 `--out` not honored on total API outage (exits at :329-332 before writer) — same defect as E2 — **medium**, verified.
- B1 missing `answers` → `evaluate` null preds; truth=0 items score as hits + 200-without-answers not counted as error — silent accuracy inflation, the exact thing the guard exists to catch — **medium**, verified (`evaluate` `a??{}`, main:316 doesn't check `res.answers`). Fix keeps frozen null-safe semantics: treat missing-answers response as item error in main loop.
- B2 relevance floor (score≥2 vs truth) ≠ prod consumption (jevFilter gates on `rel.confidence≥0.7`) — **false**: harness measures model accuracy vs human truth; prod confidence gate is a separate policy layer. Different metrics by design — spec scope is model regression, not gate-policy equivalence.
- B3 harness sends 4 questions+author; prod sends subsets/omits author — **false**: deliberate scope — frozen spec pins isSpam-parity contract and documents prod subsets by design.
- B4 guard hardcodes endpoint+`jev-latest` vs prod envs — **partially verified**: `TYPESAFE_API_ENDPOINT` honored at jevBrain.js:65, harness hardcodes endpoint → config-drift risk — **low** (endpoint only; `JEV_MODEL` env claim false — jevBrain:66 has no model env).
- B5 dup of E3 (fetch timeout) — **medium**, carried.
- B6 dup of E1 (+unknown flags silently accepted) — **low**, carried.
- B7 dup of E2 (--out on all-fail) — **medium**, carried.
- B8 dup of V4 (config validation weak) — **medium**, carried.
- B9 corpus validation stops at `items.length` — invalid truth/text/dup-ids/mistyped lang silently corrupt metrics or burn API calls; no per-lang minimum (1-item `vi` bucket satisfies the vi floor) — **medium**, verified (:290 only checks count).
- B10 pre-API check hardcodes `MIN_CORPUS_ITEMS=50` while `checkFloors` honors `floors.minItems` — configured min>50 detected only after paying API run; <50 never effective — **low**, verified (:290 vs checkFloors minItems).
- B11 `process.exit(1)` immediately after `console.log` — piped CI stdout can truncate, losing `::error::`/`::warning::` annotations — **medium**, verified (exits at :288-397; Node truncates pending piped writes).
- B12 workflow-command interpolation unsanitized — `%`/CR/LF in `e.message`/`item.id` can split or inject GHA commands — **low**, verified (:324 interpolates raw API error text).
- B13 dup of V3 — **medium**, carried.
- B14 self-referential gate: PR can weaken `floors.json` itself — **low, rejected**: identical exposure as every test file in repo (any PR can weaken tests); fix = base-ref comparison/CODEOWNERS governance machinery, beyond a direct correction.
- B15 `--out` payload lacks audit metadata (model, endpoint, SHA, counts, errorRate, verdict) — **low**, verified (payload :369-377).
- B16 annotations round whole % → "85% < floor 85%" (vi 84.6% vs floor 85%) — **low**, verified (`toFixed(0)` at pct).
- B17 `replyWorthy` requested+labeled but never converted to pred/hit/metric — **low, rejected**: per-item `reply=` is diagnostic output by design; frozen spec bounds metrics to relevance/spam; question kept for prod-bank parity (~$0.0006/run cost is negligible).
- B18 parity test won't discover new prod isSpam sites or differently-formatted literals — **low, rejected**: speculative (4 sites total, rare surface); repo-wide scanning is more than a direct correction; gate still catches accuracy drift.
- B19 tests duplicate `FLOORS` fixture instead of loading real `floors.json`/`baseline.json`; `parseFlags`/`loadGateConfig`/truth=0-miss paths uncovered — **low**, verified (test:35-41 constants).

## Design Notes

- **Hai tầng alert:** floor breach (hard-fail, AC) ≠ baseline drift (soft-warn khi `baseline - current >= driftWarnDelta`). `baseline.json` seed bằng metrics cũ rồi re-baseline sau first run corpus mới — corpus+isSpam đổi trong story này nên mốc cũ không còn đại diện. Lưu ý spam-band dead (baseline 0.98 − 0.05 = 0.93 < floor 0.95 → drift-warn spam không bao giờ chạm trước khi floor bắt; chấp nhận — floor là gate thật).
- **isSpam parity only:** chỉ `isSpam` (và `replyWorthy` tình cờ trùng) là verbatim giữa harness↔prod; `action`/`relevance` instructions khác nhau by design (prod dùng subset riêng). Không "đồng bộ" các câu hỏi khác — scope đã duyệt chỉ gồm `isSpam`. `byLang.vi` = combined accuracy per-lang (relevant&&spam hit, impl hiện có); baseline flat keys map: `relevance`/`spam`→overall, `vi`/`mixed`/`en`→byLang.
- **Workflow tách file** khỏi `ci.yml`: trigger khác (path-filter + cron), cost = API thật, không cần postgres/redis — job nhẹ, timeout 10 phút (~50 calls × ~300ms + retry headroom).

## Verification

**Commands:**
- `node scripts/jev-verify/verify.mjs --mock` -- expected: in request shape, exit 0.
- `node scripts/jev-verify/verify.mjs --ci --mock` -- expected: mock path, không floor-check, exit 0.
- `npx vitest run tests/scripts/jev-verify.test.js` -- expected: all pass.
- `TYPESAFE_API_KEY=... node scripts/jev-verify/verify.mjs --ci --out /tmp/jev-results.json` -- expected: real run ≥50 items, floors pass → exit 0, results JSON written.
- `npx --yes js-yaml .github/workflows/jev-regression.yml` -- expected: parse ra YAML/JSON không lỗi (không có yaml dep trong repo — npx fetch on-demand).
- `node -e "const c=require('./scripts/jev-verify/corpus.json'); if(c.items.length<50) process.exit(1)"` -- expected: exit 0.

**Manual checks:**
- `git diff` 4 chỗ `isSpam` instruction — literal `'This post is spam, bait, scam, or airdrop-farming — not mere self-promotion'` byte-identical.
- `baseline.json` sau re-baseline khớp metrics của run đã verify.
