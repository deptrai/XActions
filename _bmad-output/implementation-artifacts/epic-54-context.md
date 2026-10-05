# Epic 54 Context: Token Sentiment Intelligence Layer

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Build **coverage-gap metrics** cho crypto social sentiment: những tín hiệu mà provider trả phí (DexCheck Free + Cookie Pro $19.99/th là baseline buy) **không phủ** — KOL watchlist riêng của jev, VN crypto Twitter, token quá nhỏ chưa được index. KHÔNG replicate provider-grade bot filtering (Kaito Bittensor NLP, TheTie 7yr clean data là moat nhiều năm). Origin: jev-trading research Recommendation #3 — "giữ XActions MCP làm lớp ingestion dự phòng cho các tín hiệu provider không phủ".

## Stories

- Story 54.0: Ingestion Coverage Spike — X Search & Dexscreener validation (PREREQUISITE, GO/REDESIGN gate)
- Story 54.1: TokenEntityExtractor — cashtag/contract/name → canonical token ID
- Story 54.2: TokenMentionPipeline — normalized per-token mention stream + daily rollups
- Story 54.3: Hype-vs-Liquidity & unique-source authenticity metrics
- Story 54.4: Token Mindshare Engine — share-of-voice % + delta 24h/7d
- Story 54.5: Narrative Clustering & Rotation Detection (GATED — post-ship-gate)
- Story 54.6: Telegram Crypto Channel Crawler (GATED — post-ship-gate + Product Council)

## Requirements & Constraints

- **Degraded contract là mandatory, không optional**: nếu X search trả `[]` liên tục (session cookie chết — precedent jev `searchTwitter()` trả rỗng khi thiếu `XACTIONS_SESSION_COOKIE`), mọi metric phải flag `degraded: true` + `degradedSince` + `consecutiveEmptyBatches`; baselines loại degraded windows khỏi tính toán; trả `insufficientHistory` thay vì số ảo.
- **54.0 là MVP-blocking**: verdict GO/REDESIGN per story. Fork quyết định đã spec: contract-address search mù → 54.2 đổi sang "KOL-timeline monitor + token extraction"; cashtag coverage <30% → mindshare scope về "watched-token share".
- **Ship gate**: pipeline chạy liên tục 7 ngày trên watchlist ≥10 token; `degraded` time <10%; mindshare ranking phản ánh đúng 1 sự kiện viral đã biết.
- Response schema của 54.4 phải **provider-compatible** `{token, mindsharePct, delta24h, delta7d, topVoices[], degraded}` để jev hot-swap XActions↔Cookie.

## Technical Decisions

Spine `xactions-token-sentiment-epic54/ARCHITECTURE-SPINE.md` (status: final) — paradigm **Hexagonal Analytics Layer**:

- **AD-1 canonicalId grammar**: `token:{chain}:{contract}` (định danh duy nhất) | `token:sym:{SYMBOL}` (ambiguous, never-merge). TokenRegistry owns resolution.
- **AD-2 storage**: Prisma `Token`/`TokenMention`/`TokenMetricRollup` mới (historyStore hiện tại username-keyed, không reuse được). Rollup = incremental single-writer (pipeline), `rebuildRollups()` repair script.
- **AD-3 degraded contract**: last-good + degradedSince + consecutiveEmptyBatches + insufficientHistory flag.
- **AD-4 dedup**: key `(canonicalId, platform, platformId)`; source-id namespace `x:<tweetId>` / `tg:<channelId>:<msgId>`; re-observation upserts `{engagement, lastSeenAt}`.
- **AD-5 auth**: dual-auth lanes (`authenticate` user-JWT | `serviceAuth` Bearer→consumer_id) trên `/api/analytics/token-*` — composite `anyAuth` middleware, KHÔNG sequential `router.use` (precedent: jev-cant-call failure khi chỉ có user-JWT).
- **AD-6 MCP**: dispatcher-actions-only (Epic 52 consolidation: 224 tools→10 dispatchers) — `x_token_hype`, `x_token_mindshare`, `x_token_narratives` là ACTIONS của `x_analytics`; telegram actions đi qua `x_scrape` (platform descriptor).
- **AD-7 mindshare = watchlist-scope share** (không phải global share như Cookie — field-compatible nhưng semantic khác, documented).
- **AD-8 single global TokenRegistry**; per-consumer scoping là query filter, không phải per-consumer registry.
- **AD-9 telegram relay** = `services/telegram-relay` standalone service sau seam `options.transport` trong `src/scrapers/social/telegram/` skeleton (Story 50.8 đã để `TELEGRAM_TRANSPORTS=['mtproto','bot','web']`); GramJS `telegram@2.26.22`, StringSession, mmomarket pattern; error taxonomy copy nguyên (FLOOD_WAIT_N→cooldownUntil+5s, SESSION_BANNED→permanently_unhealthy).
- **Rate limiting**: governor (`src/core/adaptive-governor.js`) đã meter mọi request end-to-end — 54.2 chỉ sở hữu poll SCHEDULING; ceiling từ spike 54.0 ghi vào `setPlatformLimit('twitter',...)`, không hardcode.
- **Conventions**: `sentimentScore` = lexicon-at-ingest (0..1), `sentimentScoreLLM` = 54.5 batch; `engagement` Json `{likes,retweets,replies,quotes}`; weights `0.5/0.3/0.2` configurable owned by tokenRegistry; `TELEGRAM_SESSION` = dedicated SIM org-owned disposable (OQ-1 resolved), `SocialAccount{platform:'telegram'}`.

## Cross-Story Dependencies

- 54.0 spike là blocker: kết quả quyết định strategy của 54.2 (search-based vs KOL-timeline) và scope của 54.4.
- 54.1 → 54.2 → {54.3, 54.4} sequential: extractor → pipeline → metrics.
- 54.5 gated sau ship gate + cần JevBrain batch classify (Epic 42/45) — fallback keyword-taxonomy deterministic.
- 54.6 gated sau ship gate + Product Council; phụ thuộc governor (Epic 11), AccountPool (Epic 38), skeleton 50.8.
- Reuse sẵn có: `x_scrape`/`x_monitor_keyword`/`x_search_tweets`, `x_dexscreener_*` suite (Epic 51), `historyStore` pattern, `alerts.js` anomaly, `entity-resolver.js` (persons-only — không extend, viết riêng), `jevViralMiner` classify infra (45.x), `priceCorrelation.js` (deferred S5 KOL tracker).
- Epic 35 (35-5) + Epic 53 (53-2..6) đang in-flight — orthogonal, không conflict.
