---
title: 'Narrative Clustering & Rotation Detection'
type: 'feature'
created: '2026-10-06'
status: 'done'
baseline_revision: 'ef24f042991be43100be832f9c71b171abb322f9'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: []
deferred:
  - 'Include prev24h-only narratives with mindsharePct:0 + negative delta24h when hours<24 (triage finding #12, medium) — semantics refinement for short windows'
---

<intent-contract>

## Intent

**Problem:** jev-trading cần phát hiện luân chuyển narrative sớm (vd "AI agents → DeSci → memecoins") thay vì chỉ tracking từng token — parity Kaito Narrative Mindshare — nhưng `token_mentions` hiện không lưu text nên không có corpus để cluster.

**Approach:** Thêm `src/analytics/narrativeTracker.js` — classify mỗi mention-post vào narrative label (JevBrain `batchDecide` typed-choice, fallback keyword-taxonomy deterministic), persist assignment classify-once, tính `narrative_mindshare`/`narrative_delta`/`emerging_narratives` theo window 24h/7d; gắn `narrativeId`+`narrativeDelta` vào token_mindshare response; expose `x_token_narratives` + `GET /api/analytics/narratives`. Mở rộng `token_mentions` schema thêm cột `content` để pipeline bắt đầu lưu text.

## Boundaries & Constraints

**Always:**
- DI seams như 54.4: `createNarrativeTracker(opts)` nhận `{db, healthFn, classifyFn, now, watchlist, taxonomy, hours mặc định, minBaselineDays=3, emergentMinShare, emergentMinPosts}`; mọi dependency injectable, no-mock test bằng seam.
- Degraded contract AD-3: `degraded`, `degradedSince`, `consecutiveEmptyBatches`, `generatedAt` passthrough đầy đủ trên CẢ REST và MCP (bài học triage 54.4 — không drop field).
- `classifyFn` fallback: khi JevBrain degraded/error → keyword-taxonomy matching deterministic (không block, không throw); `via` field ghi 'jev'|'keyword'.
- Classify-once: assignment `source_id → narrative_id` persist bảng `narrative_assignments` — post đã classify không classify lại.
- Taxonomy configurable: `config/narrative-taxonomy.json` `[{id, label, keywords[]}]`, injectable qua seam; emergent label format `emerging:<keyword>`.
- `token_mindshare` thêm `narrativeId`,`narrativeDelta` per token row — chỉ khi có mapping; thiếu → omit field (không null).
- `narrative_*` compute dùng weighted volume giống mindshare (reuse `followerWeight`/`engagementScore` — export từ mindshare.js nếu cần).
- Empty-string/whitespace tokenId và null options guard tại mọi surface (bài học 54.4).

**Never:**
- Không gọi JevBrain trực tiếp trong tracker — qua `classifyFn` seam (default impl wrap `jevBrain.batchDecide` lazy-import).
- Không classify lại post đã có assignment; không sửa semantics `mindsharePct`/`delta*` hiện có của 54.4.
- Không block pipeline khi Jev degraded — keyword fallback luôn hoạt động offline.
- Không filter bot ra khỏi narrative corpus (share-of-voice raw — precedent 54.4 Design Note 2).
- Không ALTER TABLE phá schema cũ — chỉ `ADD COLUMN` idempotent; rows cũ `content IS NULL` bị exclude khỏi corpus.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH | 10 posts trong 24h: 5 AI-agent, 3 meme, 2 DeSci (classifyFn stub) | `narratives[]` shares 50/30/20 (±1pt), sorted desc, `degraded:false` | No error |
| JEV_DEGRADED | classifyFn trả `{degraded:true}` hoặc throw | fallback keyword-taxonomy chạy, `via:'keyword'`, pipeline không block | classify fail → keyword path |
| KEYWORD_FALLBACK | taxonomy `[{id:'ai-agent',keywords:['ai agent','gpt','llm']}]`, post "new ai agent launch" | assign narrative `ai-agent` không cần Jev | No error |
| EMERGING | cluster `__other__` ≥`emergentMinPosts` và share ≥`emergentMinShare`, top bigram "restaking summer" | label mới `emerging:restaking summer` persist vào `narrative_labels`, xuất hiện trong `narratives[]` | No error |
| ROTATION_DELTA | narrative A share 40%→15% qua 2 window | `delta24h`/`delta7d` âm đúng chênh lệch (±1pt) | baseline thiếu → `null` + `insufficientHistory:true` |
| GROWTH_3SIGMA | narrative có baseline 7d mean 10% σ2%, hiện tại 20% | entry có `emerging:true` (share > mean+3σ) | σ=0 hoặc baseline <minBaselineDays → không flag |
| CLASSIFY_ONCE | post đã có assignment trong `narrative_assignments` | không gọi classifyFn lại cho source_id đó | No error |
| CONTENT_NULL | rows cũ `content IS NULL` | exclude khỏi corpus, không crash | No error |
| EMPTY_CORPUS | window không có post nào | `narratives:[]`, `degraded` theo healthFn | No error |
| TOKEN_NARRATIVE_MAP | token X có 80% weighted volume thuộc narrative N trong window | `token_mindshare` row token X có `narrativeId:'N'`, `narrativeDelta` = delta của N | không có mapping → omit 2 field |
| INGEST_DEGRADED | healthFn `{degraded:true, consecutiveEmptyBatches:3}` | envelope `degraded:true` + passthrough cả 2 field trên REST+MCP | No error |
| MCP_ACTION | `x_analytics {action:'token_narratives'}` | `{narratives:[{id,label,mindsharePct,delta24h,delta7d,emerging?}], degraded, scope:'watchlist'}` | No error |
| REST_ENDPOINT | `GET /api/analytics/narratives?hours=` Bearer key / anonymous | 200 shape trên; không auth → theo `eitherAuth` lane | err → 500 `{error}` |

</intent-contract>

## Code Map

- `src/analytics/narrativeTracker.js` — **FILE MỚI**: `createNarrativeTracker(opts)` + `getDefaultNarrativeTracker`/`resetDefaultNarrativeTracker` singleton; ensureSchema tạo `narrative_assignments(source_id TEXT PK, narrative_id TEXT, ts INTEGER, via TEXT)` + `narrative_labels(narrative_id TEXT PK, label TEXT, keywords TEXT, emergent INTEGER, created_at INTEGER)` + `ALTER TABLE token_mentions ADD COLUMN content TEXT` (idempotent qua `PRAGMA table_info`).
- `src/analytics/tokenMentionPipeline.js` — **EXTEND**: upsert ghi thêm `content` (truncate ~2000 chars) — đoạn `upsertStmt.run` ~line 414; ensureSchema ~line 184 giữ nguyên (column migration nằm ở tracker để không phá CREATE TABLE IF NOT EXISTS).
- `src/analytics/mindshare.js` — **EXTEND nhỏ**: export `followerWeight`/`engagementScore`/`computeRowWeight` cho tracker reuse; `computeMindshare` thêm seam `narrativesFn` (default: lazy `getDefaultNarrativeTracker().tokenNarratives()`), merge `narrativeId`/`narrativeDelta` vào token rows.
- `src/agents/jevBrain.js` — read-only: `batchDecide(requests, {concurrency, timeoutMs})` line 393; `decide(state, questions)` typed-choice schema line 115 (choice → `criteria` map); `_fallbackDecision` trả `meta.degraded`.
- `config/narrative-taxonomy.json` — **FILE MỚI**: seed taxonomy `[{id:'ai-agent',label:'AI Agents',keywords:[...]}, meme-dog, desci, rwa, l2, defi, nft-gaming...]`.
- `api/routes/analytics.js` — **EXTEND**: `router.get('/narratives', eitherAuth, handler)` + alias `/token-narratives` trước `router.use(authenticate)` (line ~76), copy pattern `handleTokenMindshare` (lines 85-108).
- `src/mcp/server.js` — **EXTEND**: enum `token_narratives` (~line 3796), `DOMAIN_DISPATCH_MAP` `token_narratives:{targetTool:'x_token_narratives',requiredArgs:[]}` (~line 4251), `executeAnalyticsTool` case (~line 6830), gate list (~line 4591).
- `src/analytics/index.js`/`index.d.ts` — barrel exports.
- `tests/analytics/narrativeTracker.test.js`, `tests/api/token-narratives.test.js`, `tests/mcp/token-narratives-dispatch.test.js` — **FILE MỚI** vitest + in-memory better-sqlite3, afterAll cleanup cho test ghi DB thật (bài học 54.4).

## Tasks & Acceptance

**Execution:**
- `src/analytics/tokenMentionPipeline.js` — ghi `content` vào upsert (truncate 2000 chars) — corpus source cho narratives.
- `config/narrative-taxonomy.json` — seed taxonomy 6-10 labels phổ biến crypto — default configurable taxonomy.
- `src/analytics/narrativeTracker.js` — core: ensureSchema (2 bảng mới + ALTER content column), corpus query `SELECT DISTINCT source_id, content, ts, followers, engagement FROM token_mentions WHERE content IS NOT NULL AND ts>=? AND ts<?`, classify-missing-via-classifyFn (batch), emergent promotion, `computeNarratives({hours=24})` → `{narratives[], degraded, scope:'watchlist', generatedAt,...}`, `tokenNarratives({hours})` → `Map<tokenId,{narrativeId,narrativeDelta}>` (plurality weighted volume), `emergingNarratives()`.
- `src/analytics/mindshare.js` — export weight helpers + seam `narrativesFn` merge narrativeId/narrativeDelta.
- `api/routes/analytics.js` + `src/mcp/server.js` + barrels — dual surfaces.
- `tests/` — 3 test files phủ toàn bộ I/O matrix.

**Acceptance Criteria:**
- Given classifyFn stub + seeded corpus, when `computeNarratives({hours:24})`, then shares khớp corpus (±1pt) và assignments persist (lần gọi 2 không gọi classifyFn cho posts cũ).
- Given JevBrain unavailable (classifyFn throw/degraded), when classify chạy, then keyword fallback gán đúng label theo taxonomy, `via:'keyword'`.
- Given `__other__` cluster vượt threshold, when compute, then label `emerging:<top-bigram>` được tạo và persist.
- Given Bearer service key, when `GET /api/analytics/narratives`, then 200 `{narratives:[…], scope:'watchlist'}`; không auth → 401.
- Given token có narrative plurality, when `GET /api/analytics/mindshare`, then row có `narrativeId`+`narrativeDelta`; không có → field vắng mặt.

## Spec Change Log

## Review Triage Log

| # | Finding | Source(s) | Verdict | Route | Disposition |
|---|---------|-----------|---------|-------|-------------|
| 1 | `optsFactory` undeclared at mindshare.js:483 — `typeof optsFactory.narrativesFn` throws ReferenceError (member access on undeclared var), swallowed by outer catch → lazy `getDefaultNarrativeTracker` fallback NEVER runs → `narrativesMap` always null in default config → `narrativeId`/`narrativeDelta` never merged | blind#1, edge-other, verif-other | high | patch | Remove dead `optsFactory` branch; keep `opts.narrativesFn` → `options?.narrativesFn` → lazy fallback chain |
| 2 | `loadDefaultTaxonomy()` reads `parsed?.categories` but `config/narrative-taxonomy.json` is a root array → default taxonomy always `[]` → keywordMatch/JevBrain candidates empty → everything `__other__` in production; tests inject taxonomy so undetected | blind#2, edge#3, verif#1, intent | high | patch | `Array.isArray(parsed) ? parsed : (parsed?.categories || [])` + API test asserting real category (e.g. `meme-dog`) surfaces |
| 3 | Case mismatch: `tokenNarratives` Map keys lowercased (`token:sym:bonk`) but `tok.token` in mindshare keeps canonical case (`token:sym:BONK`) → merge never matches | blind#3, verif#2 | high | patch | Lowercase lookup at merge site (`narrativesMap.get(String(tok.token).toLowerCase())`) + narrativesFn integration test in mindshare.test.js |
| 4 | No `source_id` dedup in narrative corpus — multi-token post weighted N× (spec Design Note 1 requires DISTINCT source_id) | blind#4, verif#3 | high | patch | Dedup by source_id in queryMentions/aggregation + multi-token-post test |
| 5 | `tokenMentionPipeline.ensureSchema` lacks `content` column → fresh DB where pipeline runs before tracker silently drops all content | blind#11, edge#4, verif#4 | high | patch | Add `content TEXT` to pipeline CREATE TABLE + test asserting content persisted |
| 6 | `scope:'narratives'` in impl+d.ts+tests vs spec `scope:'watchlist'` | blind#6, edge#2, intent | medium | patch | spec wins: change impl/d.ts/tests to `scope:'watchlist'` |
| 7 | Default classifyFn persists `__other__` via='jev' when JevBrain returns degraded `answers:null` (only exception path triggers keyword fallback) | blind#7 | medium | patch | Treat empty/null answers as unusable → throw → keyword path; classify-once must not persist degraded results |
| 8 | σ=0: `share > mean+3*0` flags emerging on any share>mean — spec: σ=0 → no flag | blind#8, edge#1 | medium | patch | Require `bStat.sigma > 0` for the flag |
| 9 | Emergent id `emerging:restaking-summer` (dash) vs spec `emerging:restaking summer` (space) | blind#9 | low | patch | Keep raw bigram in id |
| 10 | Closed interval `ts <= end` counts boundary posts in both adjacent windows — spec requires `[start, end)` | blind#5 | medium | patch | `ts < ?` in queryMentions |
| 11 | `x_token_narratives` absent from standalone TOOLS list | blind#10 | false | reject | AD-6 dispatcher-actions-only design; `executeTool` internal dispatch still resolves the target tool — consistent with all other `x_token_*` surfaces |
| 12 | hours<24: narratives present in prev24h but silent in active window vanish instead of `mindsharePct:0` + negative delta | blind#12 | medium | defer | Include-prev24h-zero-share entries is a semantics refinement; deferred to follow-up (recorded in `deferred:`) |

Deferred (`deferred:`): include prev24h-only narratives with mindsharePct:0 for short windows (finding #12, medium).

## Design Notes

1. **Corpus = distinct posts có content trong token_mentions** — post mention nhiều token vẫn đếm 1 lần trong narrative corpus (dedup `DISTINCT source_id`); rows cũ không có content bị exclude (migration chỉ ghi từ đây trở đi — documented gap, không backfill).
2. **Emergent promotion**: posts classify ra `__other__`/không match → tokenize content, group theo top bigram tần suất; cluster có `share ≥ emergentMinShare` (default 0.05) **và** `count ≥ emergentMinPosts` (default 10) → tạo `narrative_labels` row `emerging:<bigram>` và re-assign. Baseline 7d cho `emerging:true` flag: share_now > mean(daily shares)+3σ khi đủ `minBaselineDays`.
3. **token→narrative = plurality vote** trên weighted volume của mentions token đó trong window hiện tại; `narrativeDelta` = delta24h của narrative plurality đó.
4. **`content` column migration ở tracker; pipeline CREATE TABLE cũng chứa `content`** — pipeline `CREATE TABLE IF NOT EXISTS` không tự ALTER bảng cũ; tracker `PRAGMA table_info(token_mentions)` check + `ALTER TABLE` một lần cho DB legacy. Post-review (triage #5): pipeline ensureSchema bổ sung `content TEXT` vào CREATE TABLE để DB mới có cột ngay. Test UNINITIALIZED-style: thiếu bảng/bảng thiếu cột đều graceful (bài học 54.4 blind#7).

## Verification

**Commands:**
- `npx vitest run tests/analytics/narrativeTracker.test.js` — expected: all tests pass.
- `npx vitest run tests/analytics/` — expected: không regression (310+ hiện tại).
- `npx vitest run tests/mcp/token-narratives-dispatch.test.js tests/api/token-narratives.test.js` — expected: all pass.
- `npx vitest run tests/api/token-mindshare.test.js` — expected: pass (mindshare merge narrative fields không phá tests cũ).
- `node -e "import('./src/analytics/narrativeTracker.js').then(m=>console.log(typeof m.createNarrativeTracker, typeof m.getDefaultNarrativeTracker))"` — expected: `function function`.

**Manual checks (if no CLI):**
- `x_analytics {action:'token_narratives'}` trả `{narratives:[…]}` qua MCP inspector.
- `curl -H "Authorization: Bearer <key>" /api/analytics/narratives` → 200 `{narratives:[…], scope:'watchlist'}`.

## Auto Run Result

- **Baseline revision:** `ef24f042991be43100be832f9c71b171abb322f9` (sprint-status 54-4→done commit).
- **Files changed:** tạo `src/analytics/narrativeTracker.js` (~33KB engine), `src/analytics/narrativeTracker.d.ts`, `config/narrative-taxonomy.json`, `tests/analytics/narrativeTracker.test.js` (15 tests), `tests/api/token-narratives.test.js` (5), `tests/mcp/token-narratives-dispatch.test.js` (4); sửa `src/analytics/mindshare.js` + `.d.ts` (factoryNarrativesFn seam + merge narrativeId/narrativeDelta), `src/analytics/tokenMentionPipeline.js` (content TEXT trong CREATE TABLE), `src/analytics/index.js`/`.d.ts` (barrel), `api/routes/analytics.js` (route `/narratives` + alias `/token-narratives`, eitherAuth), `src/mcp/server.js` (enum + dispatch map + gate + case `x_token_narratives`), `src/mcp/jevBrain.d.ts`.
- **Review:** 4 layers (blind-hunter 12, edge-case 4, verification-gap 4, intent-alignment 1) → triage 12 rows: 10 patch + 1 defer (hours<24 prev24h-only narratives → `deferred:`) + 1 reject (TOOLS-list không có x_token_narratives — đúng AD-6). Patch áp dụng: P1 optsFactory ReferenceError → narrativesMap luôn null; P2 taxonomy loader nhận root-array; P3 merge lookup lowercase key; P4 dedupMentionsBySource DISTINCT source_id; P5 content col trong pipeline schema; P6 scope:'watchlist'; P7 degraded Jev answers throw → keyword fallback; P8 sigma>0 guard; P9 raw bigram id; P10 `[start,end)` half-open. Worker subagent abort lúc ~59min — hoàn tất thủ công các test T2–T5 còn thiếu + 2 fail: (a) NARRATIVE_MERGE — `options` param shadow factory options trong computeMindshare → thêm `factoryNarrativesFn` closure; (b) ROTATION_3SIGMA — baseline σ≈0 hợp lệ theo P8 → seed baseline có variance ([5,10,15,20]/30 mỗi ngày).
- **Verification:** `tests/analytics/` 337/337 pass (18 files); `tests/api/token-narratives.test.js` 5/5; `tests/mcp/token-narratives-dispatch.test.js` 4/4; `tests/api/token-mindshare.test.js` 7/7; `node -e` smoke → `function function`. LSP clean trên file sửa. 1 fail pre-existing không liên quan: `tests/mcp/mcp-bridge.test.js` (GET /mcp dashboard 404 — xác nhận trên baseline stash, không phải regression 54-5).
- **Follow-up:** `followup_review_recommended: true` — 9 medium findings đã patch (engine math + envelope + schema), risk tập trung ở dedup/half-open-interval và narrative merge path; deferred: prev24h-only narratives khi hours<24.
