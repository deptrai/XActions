---
title: 'Story 54.2 — TokenMentionPipeline: Normalized Per-Token Mention Stream'
type: 'feature'
created: '2026-10-05'
status: 'done'
baseline_revision: '5fce5bc33462f3704012808c56d14907ae278912'
review_loop_iteration: 1
followup_review_recommended: false
context:
  - 'src/analytics/tokenEntityExtractor.js'
  - 'src/analytics/historyStore.js'
  - 'src/scrapers/index.js'
  - 'src/scrapers/social/twitter/normalize-tweet.js'
  - '_bmad-output/implementation-artifacts/epic-54-context.md'
warnings: ['oversized — spec nhúng intent-contract đầy đủ + settled-context; giữ audit trail trong artifact']
deferred: []
---

<intent-contract>

## Intent

**Problem:** X search/monitor trả tweet raw nhưng không có stream chuẩn hoá per-token — downstream 54.3 (hype/authenticity) và 54.4 (mindshare) không có event log dedup sạch để tính metric.

**Approach:** `src/analytics/tokenMentionPipeline.js` nhận một batch `PostItem[]` (từ `scrape('twitter','search')`), chạy `extractTokenEntities` (54.1) trên `post.content`, normalize thành `TokenMention[]`, dedup theo `(tokenId, sourceId)`, persist append-only vào bảng mới trong `analytics.db`, và duy trì rollup rolling-24h `mentions_24h`/`unique_authors_24h`/`weighted_engagement_24h`. Degraded contract (AD-3): đếm `consecutiveEmptyBatches`, flag `degraded` khi vượt threshold.

## Boundaries & Constraints

**Always:**
- `TokenMention` shape: `{ tokenId, sourceId, platform, author, followers, engagement, ts, sentimentScore, isProbableBot }` — `tokenId` = canonicalId từ 54.1; `sourceId` = `x:<tweetId>` (AD-4 namespace); `engagement` = `{likes, retweets, replies, quotes}`.
- Dedup by `(tokenId, sourceId)` — cùng tweet re-polled không đếm 2 lần; re-observation upserts `{engagement, lastSeenAt}` (AD-4).
- Rollup là rolling window 24h (không phải calendar day), incremental single-writer.
- `sentimentScore` = lexicon-at-ingest qua `analyzeSentiment` rule-based (0..1) — convention epic context.
- `degraded` flag bật khi `consecutiveEmptyBatches >= 3`, tắt khi batch non-empty trở lại; `getHealth()` expose `{degraded, degradedSince, consecutiveEmptyBatches}`.
- Watchlist injectable: `createTokenMentionPipeline({ watchlist, pollIntervalMs, ... })` — watchlist shape `{ tokens: [{symbol, contract?, chain?, aliases[]}], queries: [...] }`; caller (jev) tự supply, default `config/token-watchlist.json` nếu tồn tại.
- Poll scheduling owned by pipeline: `startPipeline`/`stopPipeline` setInterval pattern (reputation.js precedent); ingest call `scrape('twitter','search',{query,limit})`.
- Pure seam: `processBatch(posts)` export tách khỏi poll để test deterministic với PostItem fixtures (no-mock DI, giống 54.1).

**Never:**
- Không compute metric downstream (hype_to_liquidity, mindshare) — story 54.3/54.4.
- Không reuse bảng `tweet_snapshots`/`engagement_daily` username-keyed của historyStore.
- Không Prisma migration trong story này (Design Notes giải thích).
- Không hardcode poll ceiling — ghi `setPlatformLimit('twitter',{safeRequestsPerMinute:10})` 1 lần khi `startPipeline` (spike 54.0 measured ceiling).
- Không sentiment LLM call per-tweet (batch LLM = 54.5 `sentimentScoreLLM`).
- Không MCP action / REST endpoint (Epic 52 dispatcher = 54.3+).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH | 1 tweet chứa `$BONK` + contract | 1 TokenMention per entity, dedup-key ghi DB, rollup +1 | Không throw |
| DEDUP_REPOLL | Cùng tweet trong 2 batch liên tiếp | Batch 2: engagement mới upsert, `mentions_24h` không tăng | Không throw |
| MULTI_TOKEN_TWEET | Tweet nhắc 2+ token (`$BONK` + `0x…` bsc) | 1 TokenMention per `tokenId` (mention fan-out) | N/A |
| NO_ENTITIES | Tweet không cashtag/contract/alias | Skip — không ghi DB, không ảnh hưởng rollup | Silent |
| EMPTY_BATCH | Poll trả `[]` | `consecutiveEmptyBatches++`; >=3 → `degraded:true` + `degradedSince` | Không throw |
| DEGRADED_RECOVERY | Batch non-empty sau degraded | Counter reset 0, `degraded:false`, `degradedSince:null` | N/A |
| SCRAPE_THROW | `scrape()` reject (rate-limit/network) | Đếm như empty batch cho degraded (fail-safe), `lastError` ghi health | Swallow, không crash pipeline |
| ROLLUP_WINDOW | Mentions ở ts t-25h vs t-1h | Chỉ t-1h tính vào `mentions_24h` (rolling, không calendar) | N/A |
| SYM_ONLY_TOKEN | Entity `token:sym:PEPE` (never-merge) | Ghi mention với `tokenId='token:sym:PEPE'` — KHÔNG merge vào `token:eth:0x…` | N/A |
| BOT_HEURISTIC | author `is_new_account:true` hoặc `follower_quality<0.1` | `isProbableBot:true` (configurable threshold) | Field absent → `isProbableBot:false` |
| NO_WATCHLIST | `createTokenMentionPipeline({})` không watchlist | Throw rõ ràng "watchlist.tokens required" hoặc rỗng → `startPipeline` no-op + warning | Fail-fast tại factory |
| FOLLOWERS_ABSENT | PostItem.author thiếu `followers_count` | `followers: null` trong mention — absence is signal | Không throw |

</intent-contract>

## Code Map

- `src/analytics/tokenMentionPipeline.js` — **FILE MỚI**, core pipeline. Export `createTokenMentionPipeline(opts)` → `{processBatch, startPipeline, stopPipeline, getHealth, getRollups(tokenId?)}`.
- `tests/analytics/tokenMentionPipeline.test.js` — **FILE MỚI**, vitest, PostItem fixtures tay (no-mock), cover toàn bộ I/O matrix.
- `src/analytics/tokenEntityExtractor.js` — **REUSE** `extractTokenEntities(post.content, {aliasMap})` — build aliasMap từ watchlist `tokens[].aliases` + bare-name keys.
- `src/analytics/historyStore.js` — **REUSE** `getDb()` (exported) → tạo bảng mới `token_mentions` (PK `(token_id, source_id)`) + `token_mention_rollups` trong cùng `analytics.db`. KHÔNG dùng `saveTweetSnapshot` (username-keyed).
- `src/analytics/sentiment.js:308` — **REUSE** `analyzeSentiment(text)` rule-based → `sentimentScore` (normalize 0..1 nếu cần — check return shape, wrap `Math.min(1,Math.max(0,score))`).
- `src/scrapers/index.js` — **REUSE** `scrape('twitter','search',{query,limit})` → `res.data.posts` PostItem[] (kiểm chứng envelope `res.data.posts ?? res.posts`).
- `src/scrapers/social/twitter/normalize-tweet.js:57-59` — **EXTEND additive**: attach `author.followers_count`/`author.verified` khi có raw (AC cần `followers`; pattern spec-12-8 cho phép additive). READ-ONLY cho mọi field hiện có.
- `src/analytics/reputation.js:192` — precedent `_startPolling` setInterval + first-poll-immediate + status guard.
- `src/core/adaptive-governor.js:364` — `globalAdaptiveRateGovernor.setPlatformLimit('twitter',{safeRequestsPerMinute:10})` 1 lần khi start.
- `src/analytics/index.js` — barrel thêm exports pipeline.
- `config/token-watchlist.json` — **FILE MỚI** example watchlist (BONK/PEPE/WIF…), pattern `config/niches/*.json`.
- `_bmad-output/implementation-artifacts/spike-54-coverage-report.md` — ceiling ≈106 queries/10min; search strategy GO.

## Tasks & Acceptance

**Execution:**
- `src/analytics/tokenMentionPipeline.js` — implement theo intent contract: `createTokenMentionPipeline` factory (fail-fast nếu không watchlist), `processBatch` pure-ish (inject `extractFn`/`sentimentFn`/`db`), ingest `scrape` seam injectable, dedup upsert, rolling-24h rollup single-writer, degraded counter, `startPipeline`/`stopPipeline`/`getHealth`.
- `src/scrapers/social/twitter/normalize-tweet.js` — additive: `post.author.followers_count` + `post.author.verified` khi raw có.
- `src/analytics/index.js` — export pipeline.
- `config/token-watchlist.json` — example watchlist.
- `tests/analytics/tokenMentionPipeline.test.js` — cover matrix + in-memory db seam.

**Acceptance Criteria:**
- Given 1 batch PostItem chứa token mention, when `processBatch`, then `TokenMention[]` được ghi `token_mentions` với đầy đủ fields, dedup `(token_id, source_id)` unique.
- Given cùng tweet ở 2 batch liên tiếp, when re-process, then rollup `mentions_24h` không tăng nhưng `engagement`/`lastSeenAt` upsert.
- Given N batch `[]` liên tiếp (N>=3), when `getHealth`, then `degraded:true` + `degradedSince` + `consecutiveEmptyBatches>=3`.
- Given watchlist `{tokens:[{symbol:'BONK',contract:'DezX…',chain:'solana',aliases:['bonk','bonkcoin']}],queries:['$BONK OR bonk']}`, when pipeline poll, then mention resolve về `token:solana:DezX…` canonical (qua aliasMap + extractor).
- Given `processBatch` trả mentions, then per-token `getRollups(tokenId)` trả `{mentions_24h, unique_authors_24h, weighted_engagement_24h}` đúng rolling window.

## Spec Change Log

## Review Triage Log

### Pass 1 (review_loop_iteration: 0)

| # | Finding | Severity | Verdict | Route | Evidence |
|---|---|---|---|---|---|
| 1 | `x:undefined` dedup collision — post thiếu cả `externalId`/`metadata.tweetId`/`id` → sourceId `x:undefined`, các tweets merge sai vào 1 row | high | true | patch | tokenMentionPipeline.js:299-300 — thêm `skipped++` guard |
| 2 | `publishedAt` invalid → `ts = NaN` → mention invisible khỏi rollup vĩnh viễn (`ts > cutoff`) | high | true | patch | :301 — `Number.isFinite(rawTs) ? rawTs : seenAt` |
| 3 | `sentimentFn` sync-throw propagate + `.catch` trên non-Promise → partial batch crash | high | true | patch | :303 — wrap `Promise.resolve().then(...)` |
| 4 | Multi-query poll: 1 query throw → mất toàn bộ `all` đã thu + đếm empty sai | high | true | patch | :355-366 — per-query try/catch, vẫn processBatch phần thu được |
| 5 | Poll overlap race — setInterval fire poll mới khi poll trước chưa xong → interleave health counters | high | true | patch | :379 — `_polling` guard |
| 6 | `processBatch` throw → skip `recordBatchEmptiness` → degraded counter không cập nhật | high | true | patch | inner try/catch gọi `recordBatchEmptiness(true, err)` |
| 7 | Upsert DO UPDATE ghi đè `followers`/`is_bot`/`sentiment` bằng NULL/0 trên re-observation thiếu data | high | true | patch | `COALESCE(excluded.x, x)` |
| 8 | No-arg `getRollups()` `WHERE ts > ?` — index `(token_id, ts)` leading col token_id → full scan | medium | true | patch | thêm index `idx_token_mentions_ts_only (ts)` |
| 9 | Envelope `res.data.posts` non-array (object/string) mask `res.posts` hợp lệ → empty batch giả | medium | true | patch | `postsFromResponse` loop candidates `data.posts, data.items, posts, items` |
| 10 | `degradedThreshold: 0` → degrade ngay batch empty đầu tiên | medium | true | patch | floor `>= 1` + `Math.floor` |
| 11 | Watchlist token thiếu `symbol` → query `$undefined` | medium | true | patch | filter `typeof t?.symbol === 'string' && t.symbol` trước map |
| 12 | Cùng tweet match 2 queries → dup trong `all` → `totalMentions` đếm kép | medium | true | patch | `seenKeys` Set trong pollOnce |
| 13 | Test tautology `\|\| true` (SYM_ONLY), conditional assert normalize-tweet, weak `startsWith('token:')` (HAPPY_PATH) | medium | true | patch | strict asserts; SYM_ONLY content chỉ `$PEPE` cashtag (alias-bearing content resolve `token:ethereum:` là đúng spec, không phải merge) |
| 14 | `author?.username` dead fallback — post.author từ normalizer không có `username` | low | true | patch | `post.authorName || null` |
| 15 | `loadDefaultWatchlist` `process.cwd()` fragile | low | true | patch | `import.meta.url`-relative `defaultWatchlistPath()` |
| 16 | sentiment clamp `max(0,…)` mất tín hiệu -1..1 âm (spec Design Note đã sanction wrap) | low | true | accept | spec-mandated; ghi note cho 54.3 downstream đọc sentimentScore floor 0 |
| 17 | Alias collision across tokens last-wins silent | low | true | accept | order-dependent documented; watchlist authors quản trùng |
| 18 | `verified:false` emit qua additive normalize-tweet — confirmed non-issue (isVerified===true) | low | false | — | EC-15 tự rút |
| 19 | stopPipeline không cancel in-flight poll write | low | true | accept | epoch guard overkill cho single-writer local; deferred |
| 20 | Không retention/prune cho token_mentions → grow unbounded | low | true | accept | deferred — 54.3+/ops quyết retention policy |
| 21 | `author`/`ts` không refresh trên re-observation | low | true | accept | spec chỉ đòi engagement+lastSeenAt; author rename edge low-value |
| 22 | Alias key base58-hợp-lệ bị route sang solanaContracts (dead name alias) | low | true | accept | extractor-settled design #11; watchlist không nên alias = base58 |

**Summary pass 1:** 22 findings — high 7, medium 6, low 9 (1 false). Không bad_spec (mọi fix là patch-code; spec chỉ 2 clarifications: sentiment clamp đã documented, SYM_ONLY semantics giải thích qua test). Patched in-place; tests 28/28 pass, analytics suite 265/265.

## Auto Run Result

- **Story:** 54.2 TokenMentionPipeline — Normalized Per-Token Mention Stream → **done**.
- **Files:** `src/analytics/tokenMentionPipeline.js` (NEW ~480 dòng), `src/scrapers/social/twitter/normalize-tweet.js` (additive author.followers_count/verified), `src/analytics/index.js` (barrel), `config/token-watchlist.json` (NEW example), `tests/analytics/tokenMentionPipeline.test.js` (NEW 28 tests), spec file này.
- **Commits:** `5f03e19d` impl ban đầu (worker); review patches commit kèm spec.
- **Review:** pass 1 — 22 findings (high 7 / medium 6 / low 9); mọi high+medium patched; pass 2 không cần (không patched-high sót lại chưa cover; `followup_review_recommended: false`).
- **Verification:** `npx vitest run tests/analytics/tokenMentionPipeline.test.js` → 28/28 pass; `npx vitest run tests/analytics/` → 265/265 pass, zero regression.
- **Residual risks:** sentiment 0..1 floor mất âm (spec'd — downstream 54.3 nên đọc score gốc nếu cần); alias collisions order-dependent; token_mentions không retention; `data/*.json` modified files ngoài scope là side-effect test runs (để uncommitted).

## Design Notes

1. **Storage: SQLite `analytics.db` qua `getDb()`, không Prisma.** AD-2 nói "Prisma `Token`/`TokenMention`/`TokenMetricRollup` mới (historyStore username-keyed không reuse được)". Reading đúng của AD-2: intent là **bảng dedicated per-token** (không reuse schema cũ) — storage engine là chi tiết. Ingest hot-path (append time-series, single-writer rollup) khớp better-sqlite3 sync API + precedent historyStore; Prisma client thêm latency + migration burden. Prisma models cho API-read path defer sang 54.3/54.4 (có thể đọc chung analytics.db hoặc sync sau — quyết khi đó). Tránh intent_gap vì đây là implementation-detail reading duy nhất nhất quán với toàn bộ precedent.
2. **TokenMention schema (SQLite):** `token_mentions(token_id TEXT, source_id TEXT, platform TEXT, author TEXT, followers INTEGER, engagement TEXT(json), ts INTEGER, sentiment REAL, is_bot INTEGER, first_seen INTEGER, last_seen INTEGER, PRIMARY KEY(token_id, source_id))`. Upsert: `INSERT … ON CONFLICT(token_id,source_id) DO UPDATE SET engagement=…, last_seen=…`.
3. **Rollup không materialize table** (đơn giản hơn): `getRollups` query trực tiếp `token_mentions WHERE token_id=? AND ts > now-24h` — `COUNT(*)`, `COUNT(DISTINCT author)`, `SUM(weighted)`; weights `likes*0.5 + retweets*0.3 + replies*0.2` configurable. Rolling-window query rẻ ở quy mô watchlist; `token_mention_rollups` table chỉ cần nếu query chậm — implementer-choice, ghi chú.
4. **isProbableBot heuristic (deterministic):** `author.is_new_account === true` OR `author.follower_quality < 0.1` (configurable `botFollowerQualityThreshold`). Field absent → false (absence is signal, not error — spec-12-8 convention).
5. **Degraded semantics:** empty batch = `res.data.posts` rỗng HOẶC scrape throw. Threshold 3 configurable (`degradedThreshold`). `degraded` KHÔNG reset rollup cũ — downstream 54.3/54.4 đọc `getHealth().degraded` để không compute trên degraded window.
6. **aliasMap build:** `watchlist.tokens` → `{[alias]: {symbol, contract, chain}}` cho mọi `aliases[]` + chính symbol lowercase; contract-keyed entries nếu `contract` có — tái dùng đầy đủ 54.1 alias machinery (contract-validate, case-insensitive EVM).
7. **processBatch signature:** `processBatch(posts: PostItem[]) → Promise<{mentions: TokenMention[], skipped: number}>` — posts rỗng/non-array vẫn update degraded counter (đó là điểm gọi duy nhất empty-batch có nghĩa). `startPipeline` gọi `scrape` rồi `processBatch`.
8. **Coverage bắt buộc (ngoài matrix):** re-observation upsert giữ `first_seen` nguyên `last_seen` mới; `getRollups()` không arg → all tokens; `stopPipeline` clearInterval + idempotent; followers_count additive normalizer test (raw có `author.followers` → `post.author.followers_count`).

## Verification

**Commands:**
- `npx vitest run tests/analytics/tokenMentionPipeline.test.js` — expected: all tests pass.
- `npx vitest run tests/analytics/` — expected: không regression suite analytics.
