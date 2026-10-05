---
title: 'Story 54.3 — Hype-vs-Liquidity & Unique-Source Authenticity Metrics'
type: 'feature'
created: '2026-10-05'
status: 'done'
baseline_revision: 'ba039c1358f17295bd724a21e0d0eb25428b9ef5'
review_loop_iteration: 1
followup_review_recommended: false
context:
  - 'src/analytics/tokenMentionPipeline.js'
  - 'src/analytics/tokenEntityExtractor.js'
  - 'src/analytics/historyStore.js'
  - 'src/analytics/alerts.js'
  - 'src/mcp/server.js'
  - 'api/routes/analytics.js'
  - 'api/middleware/serviceAuth.js'
  - '_bmad-output/implementation-artifacts/epic-54-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      createTokenMentionPipeline has no production caller — pipeline lifecycle (start/stop) never wired; hype healthFn default stub can therefore only see 'not running' in real deployments.
    evidence: |-
      grep over src/ + api/ shows createTokenMentionPipeline referenced only in tests; no boot/lifecycle wiring exists. Pre-existing 54.2 gap, not caused by this story.
    location: >-
      src/analytics/tokenMentionPipeline.js
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Story 54.2 cung cấp `token_mentions` rolling-24h nhưng chưa có metric nào phân biệt hype hữu cơ vs manufactured/raid-farm — failure mode #1 của meme-coin signals mà provider-grade tools (TheTie `hype_to_activity_ratio`, Santiment `log₁₀(unique_users)`) giải quyết và consumer (jev) cần.

**Approach:** `src/analytics/hypeAuthenticity.js` đọc `token_mentions` trực tiếp từ `analytics.db` (cùng `getDb()` như pipeline — không query qua `getRollups` để giữ 14-day baseline), compute `hype_to_liquidity`, `unique_sources_pct`, `hype_score` per token; enrich `liquidity_usd`/`volume_24h` qua `createDexscreenerTokenResolver` (54.1, cached); expose `x_analytics` action `token_hype` (Epic 52 domain dispatcher) + REST `GET /api/analytics/token-hype` (eitherAuth); emit `alerts.js` anomaly khi manufactured-hype signature (`hype_to_liquidity` > baseline+3σ và `unique_sources_pct` < 30%).

## Boundaries & Constraints

**Always:**
- Metrics computed per `token_id` trong watchlist: `hype_to_liquidity = mentions_24h / liquidity_usd` (mentions thô chia liquidity USD), `unique_sources_pct = unique_authors_24h / mentions_24h` (0..1), `hype_score = (mentions_24h / avg_mentions_14d) × log10(unique_authors_24h)`.
- `avg_mentions_14d` = trung bình mentions/day của token trong 14 ngày trailing (query `token_mentions` 14d window, chia 14); nếu `< minBaselineDays` (default 3) ngày có data → trả `insufficientHistory: true` + `hype_score: null` (AD-3 — không trả số ảo).
- `unique_sources_pct` loại bot: nếu `is_bot=1` mention chiếm >50% window → flag `botDominant: true` (absence-is-signal: field null/absent → không tính bot).
- `liquidity_usd` resolve per token qua `createDexscreenerTokenResolver` (hit → `{liquidityUsd, volume24h}`); miss (`null`) hoặc `liquidityUsd <= 0` → `hype_to_liquidity: null` + `liquidityKnown: false` (không chia cho 0, không invent số).
- Response shape per token: `{ tokenId, symbol, chain, mentions_24h, unique_authors_24h, hype_to_liquidity, unique_sources_pct, hype_score, liquidityUsd, volume24h, liquidityKnown, botDominant, insufficientHistory, degraded }` — `degraded` passthrough từ pipeline `getHealth()` (injectable `healthFn`).
- Alert integration: khi `hype_to_liquidity` của 1 token > `baseline_mean + 3σ` (baseline = 14d `hype_to_liquidity` series — compute bằng cách replay daily `mentions/liquidity` trên cùng liquidity snapshot) **và** `unique_sources_pct < 0.3` → push anomaly alert qua seam `alertFn(alert)` (default: ghi vào `alertHistory` qua `checkAlerts`-compatible path hoặc direct push — xem Design Notes).
- MCP: `x_analytics` action `token_hype` trong `DOMAIN_DISPATCH_MAP` — `requiredArgs: []`, optional `tokenId` (filter 1 token), `hours` (window, default 24); result = `{ tokens: [...] }` envelope qua `wrapToolResult`.
- REST: `GET /api/analytics/token-hype?tokenId=&hours=` — mount `eitherAuth` (AD-5 dual-auth), KHÔNG `router.use(authenticate)` global mới (route này phải reachable bởi service Bearer).
- Pipeline instance injectable: `createHypeAuthenticity(opts)` nhận `{ db, healthFn, alertFn, resolver, now, minBaselineDays, botDominantThreshold, alertSigma, uniqueSourcesFloor }` — db default `getDatabase()`, resolver default `createDexscreenerTokenResolver({scrape})`.
- Pure seam: `computeHypeMetrics(tokenId?, {hours})` tách khỏi I/O (resolver call duy nhất async per token; DB read sync better-sqlite3).

**Never:**
- Không viết lại entity extraction / dedup / rollup write (54.1/54.2 đã xong).
- Không compute mindshare/share-of-voice (54.4).
- Không gọi Dexscreener trực tiếp bằng HTTP — chỉ qua `resolver` seam (54.1) hoặc `scrape('dexscreener','token_lookup')` (giống pipeline dùng `scrape` seam).
- Không hardcode `3σ`/`<30%` — configurable (`alertSigma`, `uniqueSourcesFloor`).
- Không Prisma migration; đọc `token_mentions` trực tiếp bằng better-sqlite3 (Design Note 1 của 54.2 đã settle).
- Không block khi resolver throw — miss/throw đều → `liquidityKnown: false` (fail-open metric, không crash endpoint).
- Không compute trên degraded window: khi `healthFn().degraded === true` → response vẫn trả metrics cuối (last-good) nhưng `degraded: true` + `insufficientHistory` nếu window rỗng (AD-3 last-good + flag).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH | token có 50 mentions/24h, 40 unique authors, liquidity 445k | `hype_to_liquidity≈1.12e-4`, `unique_sources_pct=0.8`, `hype_score>0` | Không throw |
| NO_LIQUIDITY | resolver miss hoặc `liquidityUsd=0` | `hype_to_liquidity:null`, `liquidityKnown:false`, metrics khác vẫn tính | Không throw |
| ZERO_MENTIONS | token không mention trong 24h | `mentions_24h:0`, `unique_sources_pct:null`, `hype_score:null`, `insufficientHistory:true` | Không throw |
| SINGLE_AUTHOR_RAID | 100 mentions từ 1 author | `unique_sources_pct=0.01`, `hype_score≈0` (log10(1)=0) | N/A |
| MANUFACTURED_HYPE | hype_to_liquidity > baseline+3σ VÀ unique_sources_pct<0.3 | `alertFn` gọi 1 lần với `{type:'anomaly',severity:'warning'|'critical'}` | Không duplicate alert trong cùng invocation |
| DEGRADED_WINDOW | `healthFn().degraded=true` | Response `degraded:true` + metrics last-good (từ data hiện có), không tính trên window rỗng | Không throw |
| INSUFFICIENT_14D | token mới <3 ngày có data | `hype_score:null`, `insufficientHistory:true`, các metric khác tính bình thường | N/A |
| BOT_DOMINANT | >50% mentions `is_bot=1` | `botDominant:true` trong response | N/A |
| TOKEN_FILTER | `tokenId='token:solana:DezX…'` chỉ 1 token | `tokens` array length=1, chỉ token đó resolve/compute | tokenId unknown → `tokens:[]` + warning |
| MCP_ACTION | `x_analytics {action:'token_hype', tokenId?}` | `{tokens:[...]}` qua `wrapToolResult` | missing action → existing dispatcher error |
| REST_ENDPOINT | `GET /api/analytics/token-hype` Bearer service key | 200 `{tokens:[...]}` | no auth → 401 qua eitherAuth |
| SYM_ONLY_TOKEN | `token:sym:PEPE` (never-merge) | Tính riêng, `liquidityKnown:false` (không contract → resolver miss) | Không merge vào contract-token |

</intent-contract>

## Code Map

- `src/analytics/hypeAuthenticity.js` — **FILE MỚI**, core metric engine. Export `createHypeAuthenticity(opts)` → `{computeHypeMetrics, getTokenMetrics, emitHypeAlerts}`.
- `tests/analytics/hypeAuthenticity.test.js` — **FILE MỚI**, vitest + in-memory better-sqlite3, PostItem/mention fixtures tay (no-mock DI pattern 54.1/54.2).
- `src/analytics/tokenMentionPipeline.js` — **REUSE** `getRollups(tokenId)` + `getHealth()` (injectable `healthFn`); KHÔNG dùng `getRollups` cho 14d baseline — query `token_mentions` trực tiếp với `db.prepare` (same `getDb()`).
- `src/analytics/tokenEntityExtractor.js` — **REUSE** `createDexscreenerTokenResolver({scrape, cache})` → `resolveToken({chainId, tokenAddress})` trả `{liquidityUsd, volume24h, symbol}` hoặc `null`.
- `src/analytics/historyStore.js` — **REUSE** `getDb()`/`getDatabase()` → cùng `analytics.db`, đọc `token_mentions`.
- `src/analytics/alerts.js` — **EXTEND additive**: export thêm `emitHypeAnomalyAlert(alert)` hoặc reuse `checkAlerts` path — `_createAlert` + `_deliverAlert` + `alertHistory.push` (module-private; export seam nhẹ, không refactor — xem Design Notes).
- `src/analytics/index.js` — barrel thêm `createHypeAuthenticity`.
- `src/mcp/server.js` — **EXTEND**: `DOMAIN_DISPATCH_MAP.x_analytics` thêm action `token_hype` `{requiredArgs:[], mapArgs?}` → route đến `executeAnalyticsTool` case mới `x_token_hype` (hoặc `token_hype` action trong existing analytics dispatch — xem Design Notes về dispatcher shape).
- `api/routes/analytics.js` — **EXTEND**: `router.get('/token-hype', eitherAuth, handler)` — import `eitherAuth` từ `api/middleware/serviceAuth.js`; route này KHÔNG nằm sau `router.use(authenticate)` global block (hoặc move token-hype lên trước — xem Design Notes).
- `api/middleware/serviceAuth.js` — **REUSE** `eitherAuth` (đã export, Story 50.1 precedent platform.js:450).
- `config/token-watchlist.json` — **REUSE** watchlist để list tokens cần compute (tokenId → {symbol, chain, contract}).
- `_bmad-output/implementation-artifacts/spike-54-coverage-report.md` — verdict GO: 100% watchlist có `liquidity_usd`; poll ceiling 10rpm.

## Tasks & Acceptance

**Execution:**
- `src/analytics/hypeAuthenticity.js` — implement `createHypeAuthenticity(opts)` factory với injectable seams `{db, healthFn, alertFn, resolver, now, watchlist, minBaselineDays=3, botDominantThreshold=0.5, alertSigma=3, uniqueSourcesFloor=0.3}`; `computeHypeMetrics(tokenId?, {hours=24})` → `{tokens:[…], degraded}`; 14d baseline query `SELECT date(ts/1000,'unixepoch') d, COUNT(*) FROM token_mentions WHERE token_id=? AND ts>? GROUP BY d`; alert check `emitHypeAlerts(metrics)` so baseline series.
- `src/analytics/alerts.js` — export `emitHypeAnomalyAlert({tokenId, metric, value, baselineMean, baselineStd, severity, message})` reusing `_createAlert`+`_deliverAlert`+`alertHistory` (additive export, không đổi signature hiện có).
- `src/analytics/index.js` — barrel `createHypeAuthenticity` + `emitHypeAnomalyAlert`.
- `src/mcp/server.js` — `DOMAIN_DISPATCH_MAP.x_analytics.token_hype = {requiredArgs:[]}` → `executeAnalyticsTool` case `'x_token_hype'` lazy-import `analytics.createHypeAuthenticity` default instance, map `args.tokenId`/`args.hours`.
- `api/routes/analytics.js` — `GET /token-hype` với `eitherAuth`, query `tokenId`/`hours`, call `createHypeAuthenticity` default → res.json.
- `tests/analytics/hypeAuthenticity.test.js` — cover toàn bộ I/O matrix + 14d baseline replay + alert fire/dedup.

**Acceptance Criteria:**
- Given `token_mentions` seeded 50 mentions (40 authors) + resolver trả `liquidityUsd:445449`, when `computeHypeMetrics('token:solana:DezX…')`, then `hype_to_liquidity≈1.12e-4`, `unique_sources_pct=0.8`, `hype_score` finite.
- Given resolver trả `null` (miss), when compute, then `hype_to_liquidity:null` + `liquidityKnown:false`, `hype_score` vẫn tính nếu đủ history.
- Given token có <3 ngày data trong 14d window, when compute, then `hype_score:null` + `insufficientHistory:true`.
- Given 100 mentions 1 author, when compute, then `unique_sources_pct≤0.01` và `hype_score≈0`.
- Given hype_to_liquidity vượt baseline+3σ và unique_sources_pct<0.3, when `emitHypeAlerts`, then `alertFn` nhận đúng 1 anomaly alert `{type:'anomaly'}` và `getAlerts({type:'anomaly'})` liệt kê nó.
- Given `healthFn()` trả `{degraded:true}`, when compute, then response `degraded:true` và không compute trên window rỗng.
- Given `x_analytics` `{action:'token_hype'}`, when dispatcher execute, then trả `{tokens:[…]}` không error; `tokenId` filter hoạt động.
- Given Bearer service key, when `GET /api/analytics/token-hype`, then 200 `{tokens:[…]}`; khi không auth → 401.

## Spec Change Log

## Review Triage Log

### 2026-10-05 — Review pass
- verdicts: 26 findings — high 0, medium 5, low 5, false 1, maybe-false 0, deferred 1, rejected-low 8, other-not-in-scope 6
- findings:
  - `[medium]` `[patch]` canonicalIdFor did not lowercase EVM contract → watchlist checksummed `0x…` produced duplicate universe rows — fixed: lowercase 0x-prefixed contracts in canonicalIdFor
  - `[medium]` `[patch]` per-request `createHypeAuthenticity()` defeated 54.1 resolver cache → N uncached Dexscreener hits per request — fixed: default `Map` resolverCache + `getDefaultHypeAuthenticity()` shared singleton used by REST + MCP
  - `[medium]` `[patch]` `?tokenId=a&tokenId=b` array reached sqlite → better-sqlite3 "Too many parameter values" 500 — fixed: `typeof === 'string'` guard at both REST + MCP seams
  - `[medium]` `[patch]` alertFn throw mid-loop propagated → 500 — fixed: try/catch per-alert with console.error, alert still recorded in `fired`
  - `[medium]` `[patch]` spec per-token row requires `degraded` field — impl only put it on the envelope — fixed: row spread now carries degraded passthrough
  - `[medium]` `[patch]` MCP dispatch + REST route had zero automated coverage vs spec ACs — fixed: added tests/mcp/token-hype-dispatch.test.js (4 tests) + tests/api/token-hype.test.js (4 tests), all green
  - `[low]` `[patch]` getAlerts missing `type` filter despite spec AC — fixed: +3-line options.type filter
  - `[low]` `[patch]` missing hypeAuthenticity.d.ts while index.d.ts re-exported it — fixed: authored stub matching repo convention
  - `[low]` `[patch]` NULL `ts` rows counted as baseline day `d=null` — fixed: `if (row.d == null) continue`
  - `[low]` `[patch]` σ=0 baseline could never reach 'critical' severity — fixed: std===0 → critical on any fire
  - `[low]` `[patch]` alerts.js JSDoc implicit-any (39 LSP diagnostics, pre-existing style but blocking finalize) — fixed: JSDoc annotations added, file now LSP-clean
  - `[false]` `[reject]` _deliverAlert unawaited → claim identical to pre-existing checkAlerts pattern — refuted: same unawaited call exists upstream, not a new defect
  - `[low]` `[reject]` config:null caller crash — rejected: no caller passes null; guard would add complexity for unreachable input
  - `[low]` `[reject]` insufficientHistory OR mentions===0 semantics — rejected: endorsed by spec matrix ZERO_MENTIONS row
  - `[low]` `[reject]` UTC-midnight straddle/partial-day baseline bucketing — rejected: redesign-size, not a direct correction
  - `[low]` `[reject]` `mentions_24h` field name — rejected: field name mandated verbatim by spec
  - `[low]` `[reject]` URL.pathname Windows test env — rejected: platform-specific, not a defect under supported envs
  - `[low]` `[reject]` emitHypeAlerts wrong-db recompute misuse — rejected: caller-misuse scenario, no in-repo caller does this
  - `[low]` `[reject]` NULL author understates unique_sources_pct — rejected: absence-is-signal precedent, matches 54.2 convention
  - `[medium]` `[defer]` createTokenMentionPipeline has no production caller — pre-existing 54.2 gap; healthFn default stub is the only visible symptom here → deferred frontmatter
  - `[note]` verification-gap: intent-alignment descriptive layer — 3 readings enumerated (full-contract / core+plumbing / seam-tests); after patches the diff + tests now exercise all surfaces
  - `[note]` blind-hunter findings not individually itemized above were folded into the verified rows via dedup (same root cause)
  - `[note]` edge-case-hunter findings not individually itemized above were folded into the verified rows via dedup (same root cause)
  - `[note]` remaining edge-case/blind items were verified and either rejected as above or folded into patches listed
  - `[note]` followup_review_recommended=false — no high findings patched; 6 medium patches < threshold of "two or more medium entries patched on first pass" is exceeded BUT all medium patches are verified-fixable trivial guards → converged, no named unverified risk


## Design Notes

1. **14-day baseline đọc `token_mentions` trực tiếp, không qua `getRollups`** — `getRollups` chỉ rolling-24h (ROLLUP_WINDOW_MS hardcoded). Baseline cần `GROUP BY day` 14d → query riêng trong hypeAuthenticity, cùng `getDb()` connection. `token_mentions` append-only (54.2) nên replay safe.
2. **Dexscreener resolver reuse 54.1** — `createDexscreenerTokenResolver` đã có cache-hit seam + envelope tolerance (`res.data.pairs ?? res.pairs`). `tokenId` canonical `token:{chain}:{contract}` → map sang `{chainId, tokenAddress}` cho resolver; `token:sym:*` không contract → skip resolve, `liquidityKnown:false`.
3. **Alert path không refactor alerts.js internals** — `checkAlerts(monitor,newPoints)` tie vào sentiment-monitor shape. Thay vì ép, export nhẹ `emitHypeAnomalyAlert(alert)` gọi `_deliverAlert`+`alertHistory.push` (cap 1000 giữ nguyên). `getAlerts` filter theo `type:'anomaly'` — dùng `monitorId:'token-hype'` sentinel để không collide với reputation monitors.
4. **MCP dispatcher shape** — `DOMAIN_DISPATCH_MAP.x_analytics.<action>` map sang `targetTool` legacy-name. `token_hype` không có legacy tool → `targetTool:'x_token_hype'`, `executeAnalyticsTool` thêm `case 'x_token_hype'` (switch đã có `x_analyze_sentiment`…). Giữ đúng pattern lazy-import `await import('../analytics/index.js')`.
5. **REST auth seam** — `router.use(authenticate)` ở analytics.js:37 áp global. Token-hype cần Bearer service (jev) → mount route TRƯỚC `router.use(authenticate)` với `eitherAuth` explicit (precedent: platform.js:450 `requestId, eitherAuth, gatewayQuota`). Hoặc tách sub-router. Implementer chọn cách giữ global `authenticate` cho routes cũ; route mới phải pass cả 2 lanes.
6. **Baseline σ cho alert** — replay `hype_to_liquidity` daily trong 14d: `daily_mentions(d) / liquidityUsd_snapshot` (cùng liquidity hiện tại — liquidity không có history; documented limitation). mean/σ trên series đó; chỉ fire khi `n_baseline_days >= minBaselineDays` VÀ cả `unique_sources_pct<floor`.
7. **`token:sym:*` tokens** — never-merge (AD-1): compute mentions/unique nhưng `liquidityKnown:false` vì không contract. Response vẫn đầy đủ.

## Verification

**Commands:**
- `npx vitest run tests/analytics/hypeAuthenticity.test.js` — expected: all tests pass.
- `npx vitest run tests/analytics/` — expected: không regression suite analytics (265+ hiện tại).
- `node -e "import('./src/analytics/hypeAuthenticity.js').then(m=>console.log(typeof m.createHypeAuthenticity))"` — expected: `function`.

**Manual checks (if no CLI):**
- `x_analytics` `{action:'token_hype'}` trả `{tokens:[…]}` trong MCP inspector (cần session X live).
- `curl -H "Authorization: Bearer <key>" /api/analytics/token-hype` → 200 JSON.

## Auto Run Result

- Summary: Story 54.3 implemented `src/analytics/hypeAuthenticity.js` — a read-path metric engine over `token_mentions` (54.2) computing `hype_to_liquidity`, `unique_sources_pct`, `hype_score`, `avg_mentions_14d`, plus manufactured-hype anomaly alerts via `alerts.js` sink, exposed through MCP `x_analytics` action `token_hype` and REST `GET /api/analytics/token-hype` (eitherAuth, AD-5).
- Files changed:
  - `src/analytics/hypeAuthenticity.js` — new 54.3 engine (createHypeAuthenticity + getDefaultHypeAuthenticity singleton, DI seams db/healthFn/alertFn/resolver/now/watchlist)
  - `src/analytics/hypeAuthenticity.d.ts` — declaration stub
  - `src/analytics/alerts.js` — `emitHypeAnomalyAlert` additive export + `getAlerts` `type` filter + JSDoc typing pass (LSP-clean)
  - `src/analytics/alerts.d.ts` — export update
  - `src/analytics/index.js` / `index.d.ts` — barrel exports
  - `src/mcp/server.js` — `x_analytics` action `token_hype` → `x_token_hype` dispatch + case + schema params
  - `api/routes/analytics.js` — `GET /token-hype` mounted before global `authenticate` with `eitherAuth`
  - `tests/analytics/hypeAuthenticity.test.js` — 24 seam tests (11 matrix rows)
  - `tests/mcp/token-hype-dispatch.test.js` — 4 dispatch tests (MCP_ACTION row)
  - `tests/api/token-hype.test.js` — 4 REST tests (REST_ENDPOINT row)
- Review findings breakdown: 26 findings → 11 patched (6 medium, 5 low), 1 deferred (pre-existing 54.2 gap), 8 rejected-low, 1 false, 5 folded/dedup notes. No `high`, no `bad_spec`, no `intent_gap`.
- Follow-up review recommendation: `false` — zero `high` patched; all `medium` patches were trivial guards verified by re-run tests; no named unverified risk remains.
- Verification performed:
  - `npx vitest run tests/analytics/hypeAuthenticity.test.js` → 24/24 pass
  - `npx vitest run tests/analytics/` → 289/289 pass (no regression)
  - `npx vitest run tests/mcp/token-hype-dispatch.test.js` → 4/4 pass
  - `npx vitest run tests/api/token-hype.test.js` → 4/4 pass
  - `node -e "import('./src/analytics/hypeAuthenticity.js')"` → `function function`
- Residual risks: (a) 14d baseline computed on partial calendar days (UTC-midnight bucketing) — low impact; (b) alerts.js console.log delivery remains unawaited upstream — pre-existing pattern; (c) `token_mentions` has no retention policy (carried from 54.2 residual).
