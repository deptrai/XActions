---
title: 'Token Mindshare Engine — Share-of-Voice % + Delta 24h/7d'
type: 'feature'
created: '2026-10-06'
status: 'done'
baseline_revision: 'dd00d73843afce5c629bd835bb4109ce57c657e8'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: []
deferred:
  - summary: >-
      healthFn default stub () => ({degraded:false}) is never wired to live tokenMentionPipeline runtime health, so `degraded` never triggers in production
    evidence: |-
      Intent-alignment audit: getDefaultMindshare() passes no healthFn; same deferred gap exists in 54.2/54.3 (DI seam settled by spec design). Wiring belongs to a future integration story.
    location: >-
      src/analytics/mindshare.js createMindshareEngine default options
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Story 54.2–54.3 đã có normalized `token_mentions` stream và authenticity metrics, nhưng chưa có metric nào cho biết mỗi token chiếm bao nhiêu % tổng cuộc hội thoại đang theo dõi và attention đang tăng/giảm — đây là `Mindshare %` / `Mindshare Delta` mà Cookie Pro bán $19.99/tháng và jev-trading cần trên watchlist riêng.

**Approach:** Thêm `src/analytics/mindshare.js` — read-path metric engine trên `token_mentions` (watchlist-scope share theo AD-7): weighted-mention volume per token ÷ total weighted volume across watchlist, delta vs trailing baseline 24h/7d, top voices ranking; expose qua `x_analytics` action `token_mindshare` + REST `GET /api/analytics/mindshare` trả schema provider-compatible `{token, mindsharePct, delta24h, delta7d, topVoices[], degraded}`.

## Boundaries & Constraints

**Always:**
- Mindshare là **watchlist-scope share** (AD-7): `weighted_volume(token) / total_weighted_volume(watchlist)` — KHÔNG phải global share như Cookie; schema field-compatible, semantic khác phải documented trong response (`scope:'watchlist'`).
- Weighted mention volume = `followers_percentile_weight + engagement_weight` per mention — weights configurable qua opts (default followers-percentile band + engagement `likes*0.5/retweets*0.3/replies*0.2` reuse DEFAULT_WEIGHTS của pipeline).
- `mindshare_delta(token, 24h)` = share trong 24h hiện tại − share trong trailing 24h trước đó (tức window `[now-48h, now-24h)`); `mindshare_delta(token, 7d)` = share trong 7d hiện tại − share trong 7d trước đó. Trả `null` + `insufficientHistory:true` khi baseline window không có đủ data (quy ước <3 distinct days trong 7d baseline, nhất quán `minBaselineDays=3` của 54.3).
- `top_voices(token)` = top N authors (default 10) theo weighted mentions của token trong window hiện tại; author null/absent thì bỏ qua.
- Degraded contract (AD-3): `healthFn()` degraded → envelope `degraded:true`, KHÔNG compute trên window rỗng; `degradedSince`/`consecutiveEmptyBatches` pass-through khi có.
- Dual surfaces (AD-5/AD-6): MCP `x_analytics` action `token_mindshare` (`targetTool:'x_token_mindshare'`, `requiredArgs:[]`) + REST `GET /api/analytics/mindshare` mount TRƯỚC `router.use(authenticate)` với `eitherAuth` (precedent token-hype route, analytics.js:53).
- DI seams `{db, healthFn, watchlist, now, topN, minBaselineDays, weights}` nhất quán 54.3; `getDefaultMindshare()` singleton giữ shared state giống `getDefaultHypeAuthenticity()`.

**Never:**
- Không ghi DB — read-only trên `token_mentions` (append-only owned by 54.2 pipeline); không tạo table mới.
- Không gọi external resolver/Dexscreener — mindshare chỉ cần mention stream; liquidity nằm ở 54.3.
- Không thêm standalone MCP tool mới — Epic 52 consolidation: chỉ actions trong `x_analytics` dispatcher.
- Không đổi signature/schema của `token_mentions`, `getRollups`, hypeAuthenticity, alerts.js — additive only.
- Không narrative clustering/rotation (54.5 gated), không Telegram (54.6 gated).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH | token_mentions seeded 3 tokens với weighted volume 50/30/20 trong 24h | `mindsharePct` ≈ 50/30/20 (±1pt), `degraded:false`, `topVoices` sorted desc | No error |
| DELTA_RISE | token A share 10% trong trailing 24h, 40% trong current 24h | `delta24h` ≈ +30pt | No error |
| DELTA_7D | token A share 5% trong trailing 7d, 20% trong current 7d | `delta7d` ≈ +15pt | No error |
| INSUFFICIENT_HISTORY | token chỉ có data trong 1 ngày của 7d baseline window | `delta7d:null`, `insufficientHistory:true`; `delta24h` vẫn tính nếu trailing 24h có data | No error |
| EMPTY_WATCHLIST | watchlist rỗng/missing config | `{tokens:[], degraded:false, warning:'watchlist empty'}` | No error |
| ZERO_MENTIONS | window hiện tại không có mention nào | `mindsharePct:0` mọi token (hoặc `tokens:[]` với warning), `degraded` theo healthFn | No error |
| TOKEN_FILTER | query `tokenId` cụ thể | chỉ token đó trong `tokens[]`, `mindsharePct` vẫn tính trên toàn watchlist universe | No error |
| UNKNOWN_TOKEN | `tokenId` không trong watchlist & không có mentions | `tokens:[]` + warning naming tokenId | No error |
| BOT_HEAVY | is_bot=1 mentions chiếm đa số | vẫn đếm vào weighted volume (bot filtering là việc của 54.3 hype_score, không phải mindshare) — documented | No error |
| DEGRADED | `healthFn()` trả `{degraded:true, consecutiveEmptyBatches:N}` | envelope `degraded:true`, `consecutiveEmptyBatches` passthrough, `tokens:[]` hoặc last-good kèm flag | No error |
| NON_STRING_TOKENID | `?tokenId=a&tokenId=b` (array) | bỏ qua filter, trả full watchlist (precedent 54.3 `typeof === 'string'` guard) | No error |
| MCP_ACTION | `x_analytics` `{action:'token_mindshare'}` | `{tokens:[{token,mindsharePct,delta24h,delta7d,topVoices,degraded}], degraded}` | unknown tokenId → warning, không throw |
| REST_ENDPOINT | `GET /api/analytics/mindshare?tokenId=&hours=` Bearer service key | 200 `{tokens:[…], scope:'watchlist'}`; không auth → 401 | err → 500 `{error}` |

</intent-contract>

## Code Map

- `src/analytics/mindshare.js` — **FILE MỚI**, core engine. Export `createMindshareEngine(opts)` → `{computeMindshare, getDefaultMindshare}` (hoặc factory trả `{computeMindshare}` + module-level `getDefaultMindshare()` singleton như 54.3).
- `tests/analytics/mindshare.test.js` — **FILE MỚI**, vitest + in-memory better-sqlite3, seed `token_mentions` fixtures tay (same `ensureSchema` shape), no-mock DI pattern 54.1/54.2/54.3.
- `src/analytics/tokenMentionPipeline.js` — **REUSE-READ**: `token_mentions` schema (lines ~184-201): `token_id, source_id, platform, author, followers, engagement JSON {likes,retweets,replies,quotes}, ts, sentiment, is_bot, first_seen, last_seen`; DEFAULT_WEIGHTS `{likes:0.5, retweets:0.3, replies:0.2}` (line ~49). Query trực tiếp bằng `db.prepare` trên cùng `getDb()` — KHÔNG dùng `getRollups` cho baseline windows (rolling-24h only, precedent 54.3 Design Note 1).
- `src/analytics/hypeAuthenticity.js` — **REUSE patterns**: `canonicalIdFor(token)` normalization (EVM 0x lowercase — copy helper hoặc extract shared, không import nếu chưa export), `loadDefaultWatchlist()` (`config/token-watchlist.json`), singleton `getDefault*` pattern, watchlist-union-with-mentions token universe, `typeof === 'string'` guards.
- `src/analytics/historyStore.js` — **REUSE** `getDb()`/`getDatabase()` → cùng `analytics.db` connection, đọc `token_mentions`.
- `src/analytics/index.js` — barrel thêm `createMindshareEngine, getDefaultMindshare` (+ `.d.ts` stub theo convention repo).
- `src/mcp/server.js` — **EXTEND**: `DOMAIN_DISPATCH_MAP.x_analytics` thêm `token_mindshare: {targetTool:'x_token_mindshare', requiredArgs:[]}` (~line 4247 sau `token_hype`); tool description enum thêm `'token_mindshare'` (~line 3796-3817, params `tokenId`/`hours` reuse); `executeAnalyticsTool` thêm `case 'x_token_mindshare'` sau `x_token_hype` (~line 6812) lazy-import `getDefaultMindshare`; line 4587 tool-name list thêm `x_token_mindshare`.
- `api/routes/analytics.js` — **EXTEND**: `router.get('/mindshare', eitherAuth, handler)` mount trước `router.use(authenticate)` (line 76), ngay sau token-hype route (line 53-74) — copy pattern: `typeof === 'string'` guard, `getDefaultMindshare()` shared instance, `res.json`.
- `api/middleware/serviceAuth.js` — **REUSE** `eitherAuth` (đã export).
- `config/token-watchlist.json` — **REUSE** watchlist universe (tokens[].symbol/contract/chain → canonicalIdFor).
- `_bmad-output/implementation-artifacts/epic-54-context.md` — AD-7 watchlist-scope share, AD-5 dual-auth, AD-6 dispatcher-actions-only, degraded contract AD-3.

## Tasks & Acceptance

**Execution:**
- `src/analytics/mindshare.js` — implement `createMindshareEngine(opts)` factory với injectable seams `{db, healthFn, watchlist, now, topN=10, minBaselineDays=3, weights={likes:0.5,retweets:0.3,replies:0.2}, followerBands}`; `computeMindshare(tokenId?, {hours=24})` → `{tokens:[{token, mindsharePct, delta24h, delta7d, topVoices[], degraded, insufficientHistory?}], degraded, scope:'watchlist', warning?}`; weighted volume per mention = `followerWeight(followers) + engagementScore(engagement)`; baseline queries `SELECT date(ts/1000,'unixepoch') d, … FROM token_mentions WHERE ts>? GROUP BY d` cho 7d trailing window; `getDefaultMindshare()` singleton.
- `src/analytics/index.js` — barrel `createMindshareEngine, getDefaultMindshare`; `index.d.ts` + `mindshare.d.ts` stub theo convention.
- `src/mcp/server.js` — `DOMAIN_DISPATCH_MAP.x_analytics.token_mindshare = {targetTool:'x_token_mindshare', requiredArgs:[]}`; enum/description thêm action; `case 'x_token_mindshare'` gọi `getDefaultMindshare().computeMindshare(tokenId,{hours})`; thêm `'x_token_mindshare'` vào analytics tool-name gate list (line ~4587).
- `api/routes/analytics.js` — `GET /mindshare` với `eitherAuth` trước global `authenticate`; query `tokenId`/`hours`, call `getDefaultMindshare().computeMindshare` → `res.json({tokens, scope:'watchlist', degraded, warning?})`.
- `tests/analytics/mindshare.test.js` — cover toàn bộ I/O matrix + synthetic 3-token corpus expected %±1pt + delta fire + insufficientHistory + degraded passthrough.
- `tests/mcp/token-mindshare-dispatch.test.js` + `tests/api/token-mindshare.test.js` — MCP dispatch row + REST row (precedent: `token-hype-dispatch.test.js`, `token-hype.test.js`).

**Acceptance Criteria:**
- Given `token_mentions` seeded 3 tokens với weighted volume tỉ lệ 50/30/20 trong 24h, when `computeMindshare()`, then `mindsharePct` ≈ 50/30/20 ±1pt và `topVoices` sorted theo weighted contribution.
- Given token A 10% share trailing 24h và 40% current 24h, when compute, then `delta24h` ≈ +30; tương tự `delta7d` trên 7d windows.
- Given token có <3 distinct days trong 7d baseline, when compute, then `delta7d:null` + `insufficientHistory:true`.
- Given `healthFn()` trả `{degraded:true}`, when compute, then envelope `degraded:true` và không compute trên window rỗng.
- Given `x_analytics` `{action:'token_mindshare'}`, when dispatch, then `{tokens:[…]}` không error với schema `{token, mindsharePct, delta24h, delta7d, topVoices[], degraded}` per row.
- Given Bearer service key, when `GET /api/analytics/mindshare`, then 200 `{tokens:[…], scope:'watchlist'}`; không auth → 401; `?tokenId=a&tokenId=b` array không crash.
- Given synthetic corpus với shares đã biết, when unit test chạy, then reproduce expected %±1pt (parity check theo epic AC).

## Spec Change Log

## Review Triage Log

### 2026-10-06 — Review pass
- verdicts: 27 findings — high 0, medium 17, low 9, false 1, maybe-false 0
- findings:
  - `[medium]` `[patch]` (blind#1) `getEngineConfig()` declared in mindshare.d.ts but `createMindshareEngine` returned only `{computeMindshare}` — verified; runtime TypeError for TS callers → implemented `getEngineConfig()` returning resolved `{topN, minBaselineDays, weights, followerBands}`.
  - `[medium]` `[patch]` (blind#2) `MindshareComputeResult` missing `windowHours`/`generatedAt` — verified → added to interface.
  - `[medium]` `[patch]` (blind#3) empty-string `?tokenId=` treated as unknown-token — verified at api/routes/analytics.js and src/mcp/server.js → both surfaces now treat empty/whitespace as no filter; engine also trims.
  - `[medium]` `[patch]` (blind#4) degraded contract fields dropped (REST missing `degradedSince`; MCP missing all three) — AD-3 violation, verified → all fields now passthrough on both surfaces.
  - `[medium]` `[patch]` (blind#5) topVoices author not normalized — verified `row.author.trim()` only → normalized `.trim().replace(/^@/,'').toLowerCase()`.
  - `[low]` `[patch]` (blind#6) `aggregateWindow` materialized whole window via `.all()` → switched to `.iterate()` streaming.
  - `[medium]` `[patch]` (blind#7) no `ensureSchema` fallback → SqliteError 500 on fresh env — verified → wrapped computeMindshare so missing `token_mentions` returns graceful empty+warning.
  - `[medium]` `[patch]` (blind#8) `insufficientHistory` set when `totalCurr7dVol===0` despite adequate baseline — spec: insufficiency = <3 distinct baseline days → removed `|| totalCurr7dVol === 0` term.
  - `[low]` `[patch]` (blind#9) dead `let filterWarning` never assigned — deleted.
  - `[low]` `[patch]` (blind#10) diff contained 4 unrelated data/*.json runtime artifacts — excluded from feature commit; committed separately as chore (precedent dd00d73).
  - `[medium]` `[patch]` (blind#11) API tests never hit canonical `/api/analytics/mindshare` alias; loose `[200,401]` anonymous assertion — verified → added alias test, Bearer service-key test, `?hours=12` test.
  - `[medium]` `[patch]` (blind#12) API/MCP tests wrote to real `~/.xactions/analytics.db` without cleanup → added afterAll DELETE hooks for seeded source_ids.
  - `[medium]` `[patch]` (blind#13) missing unit tests NON_STRING_TOKENID/singleton/hours → added (NON_STRING_TOKENID, SINGLETON, HOURS_FILTER, AUTHOR_AGGREGATION, CONFIG_AND_EDGE_CASES, UNINITIALIZED_TABLE).
  - `[low]` `[patch]` (blind#14) `followerBands: []` truthy past `||` → TypeError → Array.isArray+length>0 guard.
  - `[false]` `[reject]` (blind#15) Spec Change Log / Review Triage Log empty — disproven: populated by this review pass (this entry); not a code defect.
  - `[low]` `[patch]` (edge#1) dup of blind#14 — grouped.
  - `[low]` `[patch]` (edge#2) `computeMindshare(tokenId, null)` TypeError → `options || {}` guard.
  - `[low]` `[patch]` (edge#3) `topN:0`/`minBaselineDays:0` overridden by falsy defaults → typeof-number guards honor explicit 0.
  - `[medium]` `[patch]` (edge#4) dup of blind#1 — grouped.
  - `[low]` `[patch]` (edge#5) `URL.pathname` breaks on Windows → `fileURLToPath(new URL(...))`.
  - `[medium]` `[patch]` (edge#6) dup of blind#3 — grouped.
  - `[medium]` `[patch]` (vg#1, pre-verified) canonical `/api/analytics/mindshare` untested — grouped with blind#11.
  - `[medium]` `[patch]` (vg#2, pre-verified) no Bearer service-key test despite AC — grouped with blind#11.
  - `[medium]` `[patch]` (vg#3, pre-verified) `hours` param untested at all layers — grouped with blind#13.
  - `[medium]` `[patch]` (vg#4, pre-verified) `getEngineConfig` unimplemented+untested — grouped with blind#1.
  - `[medium]` `[patch]` (vg#5, pre-verified) degraded envelope passthrough untested + fields missing — grouped with blind#4.
  - `[low]` `[patch]` (vg#6, pre-verified) Top Voices same-author multi-mention aggregation untested → added AUTHOR_AGGREGATION test.

Deferred (noted from intent-alignment descriptive report):
- `healthFn` default stub `() => ({degraded:false})` not wired to live `tokenMentionPipeline` runtime health — spec-settled DI seam matching 54.2/54.3 precedent; live wiring belongs to a future integration story.

## Design Notes

1. **Baseline windows query trực tiếp `token_mentions`, không qua `getRollups`** — `getRollups` chỉ rolling-24h (ROLLUP_WINDOW_MS hardcoded); delta cần trailing windows `[now-48h,now-24h)` và `[now-14d,now-7d)` → per-day `GROUP BY` query riêng trên cùng `getDb()` (precedent 54.3 Design Note 1).
2. **Weighted volume = followers + engagement, KHÔNG có bot-exclusion** — mindshare là share-of-voice raw (Cookie parity); authenticity/bot-discount là layer 54.3 `hype_score` riêng. `is_bot` không filter — bot mentions vẫn đếm voice (documented; nếu muốn bot-adjusted mindshare thì đó là deferred enhancement, không phải scope này).
3. **followers percentile weight** — mention weight gồm `followerWeight(followers)` theo bands (configurable, default vd. <1k→1, 1k–10k→1.5, 10k–100k→2, >100k→3) + `engagementScore` từ DEFAULT_WEIGHTS pipeline. Followers null/absent → band thấp nhất (absence-is-signal precedent 54.3).
4. **Token universe = watchlist ∪ mentions** — giống 54.3: explicit `tokenId` filter chỉ filter output rows, denominator `total weighted volume` LUÔN trên toàn watchlist universe (mindshare là share — lọc denominator sẽ sai semantic).
5. **MCP/REST mount points** — copy verbatim pattern token-hype: `case 'x_token_mindshare'` gọi `getDefaultMindshare().computeMindshare(args.tokenId guard, {hours guard})` trả `{tokens, degraded, scope, warning?}`; REST route trước `router.use(authenticate)`.
6. **`scope:'watchlist'` field trong response** — AD-7 documented: field-compatible Cookie `{mindsharePct, delta24h, delta7d, topVoices}` nhưng semantic là share-in-watchlist; `scope` field báo cho consumer biết.

## Verification

**Commands:**
- `npx vitest run tests/analytics/mindshare.test.js` — expected: all tests pass.
- `npx vitest run tests/analytics/` — expected: không regression suite analytics (289+ hiện tại).
- `npx vitest run tests/mcp/token-mindshare-dispatch.test.js tests/api/token-mindshare.test.js` — expected: all pass.
- `node -e "import('./src/analytics/mindshare.js').then(m=>console.log(typeof m.createMindshareEngine, typeof m.getDefaultMindshare))"` — expected: `function function`.

**Manual checks (if no CLI):**
- `x_analytics` `{action:'token_mindshare'}` trả `{tokens:[…]}` trong MCP inspector (cần session X live).
- `curl -H "Authorization: Bearer <key>" /api/analytics/mindshare` → 200 JSON với `scope:'watchlist'`.

## Auto Run Result

- **Summary:** `src/analytics/mindshare.js` — read-path Token Mindshare Engine trên `token_mentions` (watchlist-scope share-of-voice % theo AD-7): weighted-mention volume (`followerWeight` bands + `engagementScore`) ÷ total watchlist-universe volume; delta 24h `[now-48h,now-24h)` + delta 7d `[now-14d,now-7d)`; `insufficientHistory` khi baseline <3 distinct days; topVoices top-N normalized authors; dual surfaces AD-5/AD-6: REST `GET /api/analytics/mindshare` (+ alias `/token-mindshare`) `eitherAuth` pre-authenticate, MCP `x_analytics` action `token_mindshare` → `x_token_mindshare`.
- **Files changed:**
  - `src/analytics/mindshare.js` (new, ~500 lines) — `createMindshareEngine(opts)` DI seams {db, healthFn, watchlist, now, topN, minBaselineDays, weights, followerBands}, `computeMindshare`, `getEngineConfig`, `getDefaultMindshare`/`resetDefaultMindshare` singleton.
  - `src/analytics/mindshare.d.ts` (new) — typed public contract.
  - `src/analytics/index.js` + `index.d.ts` — barrel exports.
  - `src/analytics/hypeAuthenticity.d.ts` — HypeEngine interface typing fix (incidental, same pattern).
  - `api/routes/analytics.js` — `handleTokenMindshare` on `/mindshare` + `/token-mindshare` alias, `eitherAuth`, full degraded-envelope passthrough.
  - `src/mcp/server.js` — enum `token_mindshare`, `DOMAIN_DISPATCH_MAP` entry, `executeAnalyticsTool` case, tool-name gate list.
  - `tests/analytics/mindshare.test.js` (new, 18 tests), `tests/api/token-mindshare.test.js` (new, 7), `tests/mcp/token-mindshare-dispatch.test.js` (new, 5).
  - `data/*.json` runtime test artifacts — excluded from feature commit, committed as separate chore.
- **Review findings:** 27 findings — high 0, medium 17, low 9, false 1. All 26 true findings patched (see Review Triage Log); 1 rejected (blind#15 — log sections, populated by this pass); 1 defer noted (healthFn live-wiring, frontmatter `deferred`).
- **Follow-up review recommendation:** `true` — ≥2 medium entries patched this pass. Named unverified risk: patches touched filtering (empty-tokenId), degraded passthrough, and `insufficientHistory` condition — a follow-up pass should confirm the patched condition logic and surface envelopes still satisfy the spec matrix rows INSUFFICIENT_HISTORY / DEGRADED / TOKEN_FILTER end-to-end.
- **Verification performed:** `npx vitest run tests/analytics/mindshare.test.js tests/api/token-mindshare.test.js tests/mcp/token-mindshare-dispatch.test.js` → 30/30 pass; `npx vitest run tests/analytics/` → 310/310 pass (no regression); `node -e import` → `function function`.
- **Residual risks:** aggregateWindow still does per-row JSON.parse (iterate caps memory but CPU cost remains at very high mention volume); `degraded` flag never fires in production until healthFn is wired to live pipeline (deferred); MCP/REST envelope is XActions-internal, provider-compat only at token-row level (spec-settled).
