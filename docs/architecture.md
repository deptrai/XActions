# XActions — System Architecture

> **Version:** 4.2.0 (September 2026)  
> **Status:** Production / Distributed Multi-Platform Autonomous Scraping & Syndication Engine  
> **Author:** nich (@nichxbt) & DeepMind Advanced Agentic Coding Team  

---

## 1. Executive Architectural Overview

**XActions** is an enterprise-grade, distributed scraping, interaction, and content syndication platform designed for both human operators and autonomous AI agents (via Model Context Protocol - MCP).

Originally started as a Twitter/X browser automation utility, XActions has evolved through 41 Epics (including Phase 7: OSINT Find Profiles, Distributed Token Bucket, Account Pool & Health Guard, GitOps Selector Healing, Cost-Aware Proxy Escalation, and Epic 41: Developer Registries & Entity Resolution) into a **universal 26-platform scraping and cross-platform write syndication engine**. It combines stealth headless browser automation (Puppeteer/Playwright/CDP) with direct reverse-engineered internal APIs (GraphQL, AT Protocol, REST, SSE, JetStream) and resilient governance infrastructure (Adaptive Rate Governor, Distributed Token Bucket, Proxy Dual-Pool, Schema Drift Canary, and Outbound Webhooks).

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   CLIENT & AGENT SURFACES                              │
├───────────────────┬───────────────────┬────────────────────┬───────────────────────────┤
│  AI Agents (MCP)  │   CLI (Terminal)  │  Admin Dashboard   │   REST API / Webhooks     │
│  xactions-mcp     │   bin/unfollowx   │  dashboard/*.html  │   api/server.js (port 3001)│
└─────────┬─────────┴─────────┬─────────┴──────────┬─────────┴─────────────┬─────────────┘
          │                   │                    │                       │
          ▼                   ▼                    ▼                       ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        ORCHESTRATION & DISPATCH GATEWAY                                │
├────────────────────────────────────────────────────────────────────────────────────────┤
│  • Multi-Consumer Quota Gate (AD-20: ChainLens, Nowing AI, Internal)                   │
│  • UniversalActionDispatcher (Parallel Multi-Platform Write with Fault Isolation)      │
│  • ContentTransformer (Platform Character Limits, Dynamic Thread Splitter, Media Batch)│
│  • UniversalMediaPipeline (MP4/HLS/DASH/Audio Extraction across 6 Platforms)           │
└───────────────────────────────────┬────────────────────────────────────────────────────┘
                                    │
          ┌─────────────────────────┴─────────────────────────┐
          ▼                                                   ▼
┌───────────────────────────────────┐       ┌────────────────────────────────────────────┐
│      UNIVERSAL SCRAPER SPINE      │       │          CORE RESILIENCY & GOVERNANCE      │
├───────────────────────────────────┤       ├────────────────────────────────────────────┤
│ 26 Canonical Platform Descriptors:│       │ • AdaptiveRateGovernor (Velocity/Backpress)│
│ • Social: Twitter, Bluesky, Masto,│       │ • DistributedTokenBucket (Redis Lua Script)│
│   Threads, Facebook, TikTok, Insta│       │ • ProxyIpPool (Realtime vs Bulk Dual-Pool) │
│ • Identity: GitHub, Gravatar      │       │ • SessionHealthOrchestrator (Circuit Break)│
│   (zero-auth OSINT registries)    │       │ • SchemaDriftGuard & SelectorCanary        │
│ • Video/Audio: YouTube VN, Spaces │       │ • AutoSelectorFallback (Heuristic Discovery│
│ • E-Commerce: Shopee, TikTokShop  │       │ • 3-Layer ErrorEnvelope (XACT_4xxx/5xxx)   │
│ • Local: Zalo OA, TopCV, Masothue │       │ • EntityResolver (in-mem identity cluster) │
│ • B2B / Realestate: Batdongsan... │       │                                            │
└─────────────────┬─────────────────┘       └─────────────────────┬──────────────────────┘
                  │                                               │
                  ▼                                               ▼
┌───────────────────────────────────┐       ┌────────────────────────────────────────────┐
│      MULTI-FRAMEWORK ADAPTERS     │       │          STREAMING & DATA LIFECYCLE        │
├───────────────────────────────────┤       ├────────────────────────────────────────────┤
│ • Puppeteer + Stealth Plugin      │       │ • Redis Stream Publisher (Tenant Isolated) │
│ • Playwright Adapter (Chromium)   │       │ • JetStream, SSE & Postgres CDC Consumers │
│ • Direct HTTP (GraphQL/AT Protocol│       │ • Outbound Webhook Dispatcher (HMAC/Retry) │
│ • Browser-as-Signer (CDP Bridge)  │       │ • Stream Replay & Cursor Recovery (XRANGE) │
└─────────────────┬─────────────────┘       └─────────────────────┬──────────────────────┘
                  │                                               │
                  └─────────────────────────┬─────────────────────┘
                                            ▼
                            ┌───────────────────────────────┐
                            │    STORAGE & STATE LAYER      │
                            ├───────────────────────────────┤
                            │ • PostgreSQL (Prisma ORM)     │
                            │ • Redis (Streams/Queue/Bucket)│
                            │ • Datasets (JSON/CSV Export)  │
                            └───────────────────────────────┘
```

---

## 2. Core Architectural Subsystems

### 2.1. Universal Scraper Spine (`src/scrapers/`)
Every platform in XActions implements a standard contract conforming to `AbstractCrawler` and `descriptor.js` (Story 25.1):
1. **Single Entry Point**: `scrape(platform, action, options)`
   - Dispatches via descriptor lookup (`DESCRIPTORS[platform]`).
   - Supports `platform: 'all'` or arrays of platforms via `UniversalActionDispatcher`.
2. **Action Registry**: Each crawler constructor registers typed actions with `requiredArgs`, `optionalArgs`, `outputType`, `example`, and `checkpointResolver`.
3. **Canonical Supported Platforms (26 descriptors)**:
   - **Social Networks**: Twitter/X, Bluesky (AT Protocol), Mastodon (ActivityPub REST), Threads (Barcelona GraphQL/SSR), Facebook (GraphQL/CDP), Reddit, Medium, Instagram.
   - **Identity Registries (Epic 41, zero-auth)**: GitHub (`api.github.com/users/{u}`), Gravatar (`api.gravatar.com/v3/profiles/{sha256(email)}`).
   - **Vietnam Local Ecosystem**: Zalo OA, YouTube VN, TopCV, VietnamWorks, Chotot, Batdongsan, MaSoThue, B2B Registry Extended, Foody/Pasgo, Medpro/LongChau.
   - **E-Commerce & Video**: Shopee, TikTok, TikTok Shop.

### 2.2. Cross-Platform Action Syndication & Transformation (Epic 30)
- **`UniversalActionDispatcher` (`src/scrapers/social/dispatcher.js`)**:
  - Executes mutations (`post`, `like`, `reply`, `retweet`/`repost`, `follow`, `unfollow`) across platforms simultaneously using `Promise.allSettled`.
  - **Fault Isolation**: Failure on one platform (e.g. rate limit on Twitter) does not block or fail others (e.g. Bluesky and Mastodon succeed).
  - Credentials auto-resolution with environment variable fallbacks and per-call overrides.
- **`ContentTransformer` (`src/scrapers/social/content-transformer.js`)**:
  - Enforces platform-specific character limits (`twitter: 280`, `bluesky: 300`, `mastodon: 500`, `threads: 500`).
  - **Smart Thread Splitter**: Hierarchical tokenization (paragraphs $\to$ sentences $\to$ words) while strictly preserving atomic tokens (URLs, `@mentions`, `#hashtags`).
  - **Sequential Thread Chaining**: Automatically chains multi-part threads via `post` $\to$ `reply` $\to$ `reply` referencing preceding tweet/URI/status IDs.
  - **Media Adapter**: Enforces per-platform attachment limits (4 images on X/Bluesky/Mastodon, 10 on Threads) and batches surplus media across thread parts.

### 2.3. Universal Media Pipeline (`src/scrapers/social/media-pipeline.js`, Epic 31)
- Standardized `MediaObject` model: `{ type, url, thumbnailUrl, width, height, durationMs, bitrate, contentType, variants[] }`.
- Multi-platform extraction:
  - **Twitter/X**: Highest bitrate MP4 selection, HLS `.m3u8` fallback, Spaces audio streams.
  - **Bluesky**: AT Protocol `app.bsky.embed.images` and `app.bsky.embed.video`.
  - **Mastodon**: Media attachments (photo, video, animated gifv, audio).
  - **Threads**: Multi-item carousels, video versions, and candidate images.
  - **TikTok & Facebook**: Watermarked/unwatermarked direct MP4 and audio tracks.
- Public MCP Tool: `x_download_media`.

### 2.4. Resilience, Rate Governance & Distributed Quotas (Epic 20, 28, 32)
- **`AdaptiveRateGovernor` (`src/core/adaptive-governor.js`)**:
  - Dynamic RPM throttling based on healthy proxy ratios and Redis consumer lag.
  - 4-Tier Throttle Levels: `NORMAL`, `REDUCED`, `BACKPRESSURE`, `CRITICAL`.
  - **🛑 Panic Stop (Story 32.1)**: Emergency halt mechanism that hibernates all accounts for a target platform and forces critical throttle level.
  - **Queue Priority Allocator**: Re-orders execution priorities for `chainlens`, `nowing`, and `internal` consumers.
- **`DistributedTokenBucket` (`src/core/distributed-token-bucket.js`, Story 32.2)**:
  - Redis Lua script (`TOKEN_BUCKET_LUA`) executing atomic sliding-window token refill and consumption.
  - Transparent fallback to in-memory sliding token bucket when Redis is disconnected.
  - HTTP header parser (`parseRateLimitHeaders`) synchronizing bucket state from `X-RateLimit-*` and RFC 6585 headers.
- **`ProxyIpPool` (`src/proxy/proxy-pool.js`)**:
  - **Dual-Pool Partitioning**: Separates high-priority `realtime` proxies from bulk batch operations.
  - Automated quarantine with exponential backoff on detection/captcha.
- **`SchemaDriftGuard` & `AutoSelectorFallback` (Epic 28)**:
  - Automated detection of social network DOM mutations.
  - Canary monitoring and heuristic selector healing based on semantic roles and accessibility trees.

### 2.5. Phase 7 Subsystems (Epics 36–41)

#### OSINT Find Profiles (`src/mcp/osint-find-profiles.js`, Epic 36 + 41)
- **`x_social_find_profiles` MCP tool**: fan-out people search across up to 18 platforms via `UniversalScrapeDispatcher` with `Promise.allSettled()` and a bounded concurrency pool (`MAX_CONCURRENT_PLATFORMS`).
- **Query typing**: `detectQueryType()` auto-classifies queries as `username | name | phone | email`; VN phone numbers are normalized (`0xxxxxxxxx`) for `chotot`/`zalo`/`masothue`. Non-VN phone queries degrade to `name`.
- **Developer/Identity registries (Epic 41.1)**: `github` (username) and `gravatar` (email) are registered in `PROFILE_ACTION_MAP` as zero-auth Tier-0 direct fetches. GitHub rate limit is enforced via `DistributedTokenBucket` — 60 req/h unauthenticated, 5000 req/h with `GITHUB_TOKEN`. 404 responses degrade to graceful empty (`count=0`), not errors.
- **Tiered per-platform deadlines (`PLATFORM_TIMEOUTS_MS`, Story 36.2)**: Tier 0 lightweight REST platforms (masothue, chotot, topcv, vietnamworks, github, gravatar = 4s; reddit, medium = 5s; bluesky, mastodon = 6s) vs Tier 1 browser/anti-bot platforms (twitter, facebook, threads, instagram, tiktok, youtube, linkedin = 15s). Caller `timeoutMs` overrides per-platform defaults; each dispatch receives an `AbortSignal` so cooperative crawlers stop early.
- **Per-platform status**: every response includes a `platformStatus[]` array with `status` of `ok | error | timeout | skipped | unsupported | circuit_open | account_sick`, plus `count`, `durationMs`, and a classified `error` (`RATE_LIMITED`, `BOT_BLOCKED`, `AUTH_REQUIRED`, `PLATFORM_TIMEOUT`).
- **Adaptive rate governor integration**: hibernating accounts short-circuit to `account_sick`; per-`platform:accountId` circuit breakers (3 consecutive failures, 60s half-open cooldown with single-probe semantics) short-circuit to `circuit_open`.
- **In-memory identity resolution (Epic 41.2 / Option D refined)**: returns both the raw `ProfileItem[]` **and** an `identityClusters[]` array computed per-request by `EntityResolver`. No identity tables, no PII persistence — clustering is computed in-process and discarded.

#### EntityResolver — Identity Clustering (`src/mcp/entity-resolver.js`, Epic 41.2)
- **Pure-JS, zero-I/O module**: groups flat `profiles[]` into `identityClusters[]` — sets of cross-platform profiles likely belonging to the same real person.
- **Jaro-Winkler similarity** (`jaroWinkler`): standard Jaro + Winkler prefix boost (scaling 0.1, max prefix 4), verified against published reference vectors.
- **Additive confidence model** (`scorePair`): `username_exact` +40, `name_similar` (JW > 0.85) +30, `avatar_match` +30, `crosslink_bio` +20 → capped at 100, confidence = score/100.  `avatar_match` is being upgraded (Story 41.3 / AD-46) from URL-string-equality to **async perceptual hashing** — URL-exact stays the fast-path; on miss, `src/osint/phash.js` fetches+decodes the avatar and compares Hamming distance ≤ 10.
- **Union-find clustering** (`resolveIdentities`): two profiles merge when pairwise score ≥ `MERGE_THRESHOLD` (40); each cluster carries `clusterId`, `confidence`, `profiles[]`, `matchedSignals[]`, and `primaryProfile` (highest-followers member).
- **Backward compatible**: `identityClusters[]` is additive — `profiles[]` and `platformStatus[]` shapes are unchanged.
- **PII boundary preserved**: this is *in-memory* resolution only — no `PersonEntity`/`GoldenContact` Prisma models, no persistence (the rescoped Option D; see AD-45).

#### Distributed Token Bucket (`src/core/distributed-token-bucket.js`, Epic 37)
- Redis Lua script (`TOKEN_BUCKET_LUA`) for atomic multi-process token refill/consume; transparent in-memory sliding-window fallback when Redis is offline.
- `consume(key, tokens, { capacity, refillRate, ttlSeconds })` and `canConsume()` (non-spending check).
- `parseRateLimitHeaders()` synchronizes bucket state from `X-RateLimit-*` and RFC 6585 headers.
- Also backs the daily proxy budget bucket (`proxy:budget:YYYY-MM-DD`, TTL 24h — see AD-42).

#### Account Pool & Health Guard (`src/core/account-pool.js`, Epic 38)
- **`AccountPool`** (`globalAccountPool`): multi-account rotation per platform with round-robin over healthy accounts only.
- **Health Guard**: rate-limited or failing accounts are marked unavailable and hibernated (default 15 min) via `AdaptiveRateGovernor.hibernateAccount()`; hibernation auto-expires and accounts wake to `active`.
- Composite `platform:accountId` keys, per-account local velocity timestamps, and `listAccountDetails()` observability (status, `hibernatingUntil`, velocity, assigned proxy).
- Exposed through MCP tools (`x_account_list`, `x_account_get`, `x_account_release`) and consumed by the OSINT fan-out (`account_sick` status).

#### GitOps Selector Healing (Epic 39)
Pipeline (strictly manual-trigger; auto-heal on detection is prohibited per AD-44):
```
SelectorCanary (drift detection, successRate < 0.8 for 2 runs → alert)
  → AutoSelectorFallback.investigate() (ranked candidates)
  → SelectorSandbox.validate() (expectedShape check in isolated page)
  → CanaryHealer (unified-diff for config/canary-targets.json)
  → GitHub Draft PR (branch canary-heal/{platform}-{target}-{ts})
```
- Components: `src/services/selector-canary.js` (probes + alert dispatcher), `src/services/selector-sandbox.js`, `src/services/canary-healer.js`.
- CLI: `xactions canary status | probe | heal` (`src/cli/commands/canary.js`); targets configured in `config/canary-targets.json`.
- `heal` modes: `--preview` (print diff), `--output <path>` (patch file), default Draft PR; `--platform`/`--target` scope; `--json` structured output.

#### Cost-Aware Proxy Escalation (Epic 40)
- **`ProxyTier` enum (`src/proxy/providers.js`)**: `free | datacenter | residential | mobile_4g` (`PROXY_TIERS`). `normalizeProxy()` maps the deprecated `residential: true` boolean to `tier: 'residential'`; explicit `tier` always wins.
- **Escalation**: requests default to `datacenter`; `AbstractApiClient` escalates to `residential` only on explicit bot challenges (`XACT_5030` / HTTP 403). `ProxyIpPool.getNext(requiresResidential, tier)` filters by tier.
- **`ProxyBudgetGovernor` (`src/core/proxy-budget-governor.js`)**: daily spend ceiling via `DistributedTokenBucket` key `proxy:budget:YYYY-MM-DD` (TTL auto-reset). Cost model: fixed ~50MB/request × tier rate (`TIER_COST_USD_PER_GB`: datacenter $0.5, residential $8, mobile_4g $15 per GB). API: `canAfford(tier)` pre-flight, `consume(tier, bytes)` debit, `checkRemaining()`.
- **Budget ceiling**: `PROXY_DAILY_BUDGET_USD` env var (default 50). When exhausted, `BUDGET_CEILING_REACHED` soft degradation returns a degraded result instead of throwing `PROXY_EXHAUSTED` (error type registered in `src/core/error-envelope.js`).

### 2.6. Streaming & Event Lifecycle (Epic 29)
- **Unified Redis Streams**: Publishes events into tenant-isolated Redis streams (`xact:stream:{workspaceId}`).
- **Push Consumers**: Connectors for JetStream (NATS/AT Protocol Firehose), Server-Sent Events (SSE), and PostgreSQL CDC (Logical Replication).
- **Outbound Webhooks**: HMAC-SHA256 signature generation, exponential backoff retries, dead-letter queues (DLQ), and consumer lag monitoring.
- **Stream Replay (`src/streaming/stream-replay.js`)**: Cursor-based recovery (`XRANGE`) for missed events with sequence number deduplication.

### 2.7. Model Context Protocol (MCP) Server (`src/mcp/server.js`)
- Full compliance with `@modelcontextprotocol/sdk`.
- Over 190 registered tools including `x_scrape`, `x_actions_list`, `x_publish_all`, `x_like_all`, `x_follow_all`, `x_download_media`, `x_crawl_post`, and the OSINT fan-out tool `x_social_find_profiles` (Epic 36), plus account-pool management tools (`x_account_list`, `x_account_get`, `x_account_release`).
- Multi-consumer quota gate (AD-20) protecting shared resources from AI agent runaway loops.
- Exposes structured resources (`xactions://platforms`, `xactions://actions`, `xactions://system/status`).

### 2.8. Agentic Decision Plane — Jev (`src/agents/jevBrain.js`, Epic 42)

The agentic subsystems (`src/agents/`, `src/algorithmBuilder.js`, `src/personaEngine.js`, `xspace-agents`, `python/xeepy/ai/`) currently make every judgment through generative LLMs (`LLMBrain`, `callLLM`) or bare heuristics (`Math.random()`, magic-number thresholds like `score>60`). This conflates two distinct concerns:

- **Generation** (prose: replies, tweets, threads) — stays on generative LLMs.
- **Decision** (judgment: relevant? act? safe? spam?) — moved to a dedicated typed-decision plane powered by **TypeSafe Jev**, a *System One* model that returns `{choice|score|noul, probabilities, confidence}` instead of generated text.

```
 tweet / DM / notif / follower / transcript  (text-only state)
        |
        v
  JevBrain.systemOne({ state, questions })
        |   { choice|score|noul, probabilities, confidence }
        v
  Confidence Gate   (per-action, user-tunable thresholds)
        |   conf >= hi -> act | mid -> queue review | lo -> skip
        v
  needs prose? --yes--> LLMBrain (mid/smart) --> JevBrain safety Noul --> execute
        |no
        v
     execute / log
```

- **Boundary rule:** Jev evaluates *text state only* (no media/avatar/rate-limit signal) and answers *judgment questions* — it never generates prose and never sits in deterministic critical-path logic (see §5 invariant 4).
- **Volume-reducer effect:** gating on calibrated confidence cuts low-value actions, yielding fewer bot-like patterns and lower X flag exposure (the dominant failure mode is behavioral/tempo flagging, not content quality).
- **Primitives used:** `Choice` -> action router (ignore/like/bookmark/reply/quote/follow); `Score` -> `scoreRelevance`, spam/quality scoring, `xspace DecisionEngine`; `Noul` -> `checkPersonaConsistency`, pre-write safety gate, `replyWorthy`. One `systemOne` call can mix all three against one `state`; questions evaluate in parallel at near-constant latency.
- **Verified (40-item corpus, `scripts/jev-verify/`):** relevance 85%, spam 98%, vi 92% / mixed 100% / en 79%; ~$0.024/1000 tweets, ~300ms/call. `action`(Choice) proved more reliable than `relevance`(Score) — the router leads, score assists.
- **Fallback:** `LLMBrain` remains the fallback decision path when `TYPESAFE_API_KEY` is unset or Jev errors — the plane degrades, it never hard-fails.
- **Cost model:** ~$42/B input tokens; `DistributedTokenBucket` can meter `jev:*` keys alongside the proxy budget (AD-42) if spend governance is needed.

---

## 3. Technology Stack Matrix

| Layer | Primary Technology | Purpose |
|---|---|---|
| **Runtime** | Node.js >= 18 (ESM) | Native ES Modules, Async/Await, Web Standards |
| **Automation** | Puppeteer Stealth & Playwright | Headless browser execution, CDP session hijacking |
| **Direct Protocols** | Axios, Fetch, AT Protocol XRPC | Direct API calls without browser overhead |
| **API Server** | Express.js, Helmet, Morgan, CORS | REST API gateway, SSE stream endpoints |
| **Database** | PostgreSQL + Prisma ORM | Durable storage for accounts, sessions, jobs, posts |
| **Job Queue & Cache** | Redis + Bull MQ + Redis Streams | Distributed token buckets, pub/sub, message queuing |
| **Realtime** | Socket.IO | Web dashboard real-time metrics and event streaming |
| **AI Integration** | OpenRouter API / Anthropic / OpenAI | Persona generation, voice analysis, tweet rewriting (prose) |
| **Decision Engine** | TypeSafe **Jev** (`/v1/systemone`) | Typed decisions + calibrated confidence: relevance, action routing, spam, safety (Epic 42) |
| **Audio/Voice Agents**| `@deepgram/sdk`, ElevenLabs, Groq | Real-time X Spaces AI voice agents (`xspace-agents`) |
| **Testing** | Vitest 4.x | Fast unit, integration, and concurrency testing |

---

## 4. Directory & Module Map

```
XActions/
├── api/                                # Express.js REST API server & routes
│   ├── routes/                         # REST endpoints (auth, governor, webhooks...)
│   ├── services/                       # Background services & scraper bridges
│   └── middleware/                     # Auth JWT, rate limits, consumer context
├── dashboard/                          # Static Web Dashboard (HTML5/CSS3/Vanilla JS)
│   ├── admin.html                      # Rate Budget, Governor Gauge, Panic Stop, Proxies
│   └── *.html                          # Feature dashboards (analytics, scheduler, etc.)
├── prisma/                             # Database schema and migrations
│   └── schema.prisma                   # Account, Session, Job, Post models
├── config/                             # Agent configs, persona templates, canary-targets.json
├── src/                                # Core Engine Source Code
│   ├── services/                       # Selector canary, sandbox, GitOps healer (Epic 39)
│   ├── core/                           # Foundation classes & Resiliency
│   │   ├── base-crawler.js             # AbstractCrawler with ActionRegistry
│   │   ├── base-client.js              # AbstractApiClient with proxy & retry
│   │   ├── adaptive-governor.js        # Velocity throttling, panic stop, queue priority
│   │   ├── distributed-token-bucket.js # Redis Lua token bucket & header parsing
│   │   ├── proxy-budget-governor.js    # Daily proxy spend ceiling (Epic 40 / AD-42)
│   │   ├── account-pool.js             # Multi-account rotation & health guard (Epic 38)
│   │   ├── session-manager.js          # Multi-account session lifecycle
│   │   ├── error-envelope.js           # 3-Layer ErrorEnvelope standard
│   │   └── schema-drift-guard.js       # DOM selector mutation detection
│   ├── mcp/                            # Model Context Protocol implementation
│   │   ├── server.js                   # MCP server entry (Tools, Resources, Prompts)
│   │   ├── local-tools.js              # In-process tool bindings
│   │   ├── osint-find-profiles.js      # x_social_find_profiles fan-out engine (Epic 36)
│   │   └── entity-resolver.js          # Jaro-Winkler + identityClusters[] (Epic 41.2)
│   ├── osint/                          # OSINT helpers (Epic 41.3)
│   │   ├── phash.js                    # Avatar perceptual hashing (dHash/aHash + Hamming)
│   │   └── image-decode.js             # Minimal PNG/JPEG/GIF → RGBA decode for pHash
│   ├── scrapers/                       # Unified Scraper Spine
│   │   ├── index.js                    # scrape() universal dispatcher + DESCRIPTORS
│   │   ├── adapters/                   # Puppeteer / Playwright / Cheerio adapters
│   │   └── (videoDownloader.js archived → Epic 24; use crawler action download_video)
│   │   ├── social/                     # Social network scrapers & syndication
│   │   │   ├── dispatcher.js           # UniversalActionDispatcher (parallel writes)
│   │   │   ├── content-transformer.js  # Thread splitter, media adapter, limits
│   │   │   ├── media-pipeline.js       # UniversalMediaPipeline (MP4/HLS/Audio)
│   │   │   ├── twitter/                # Twitter hybrid crawler & GraphQL client
│   │   │   ├── bluesky/                # Bluesky XRPC crawler & client
│   │   │   ├── mastodon/               # Mastodon REST crawler & client
│   │   │   ├── threads/                # Threads Barcelona crawler & client
│   │   │   ├── facebook/               # Facebook hybrid CDP/GraphQL crawler
│   │   │   ├── reddit/                 # Reddit JSON/Listing crawler
│   │   │   ├── medium/                 # Medium RSS/HTML crawler
│   │   │   ├── instagram/              # Instagram crawler
│   │   │   ├── tiktok/                 # TikTok video & music crawler
│   │   │   ├── youtube/                # YouTube VN channel crawler
│   │   │   └── zalo/                   # Zalo OA crawler
│   │   ├── identity/                   # Zero-auth OSINT identity registries (Epic 41)
│   │   │   ├── github/                 # GitHub REST adapter (rate-limited via bucket)
│   │   │   └── gravatar/               # Gravatar v3 adapter (sha256 email lookup)
│   │   ├── ecom/                       # E-commerce scrapers (shopee, tiktok-shop)
│   │   ├── procurement/                # masothue, b2b-registry-extended
│   │   ├── recruitment/                # topcv, vietnamworks, linkedin
│   │   ├── realestate/                 # chotot, batdongsan
│   │   ├── vehicles/                   # automotive
│   │   ├── fnb/                        # merchant (Foody/Pasgo)
│   │   ├── healthcare/                 # Medpro/LongChau/YouMed
│   │   └── legal/                      # ip-trademark (ipvietnam)
│   ├── streaming/                      # Event Streaming & Ingestion
│   │   ├── outbound-webhook-dispatcher.js # HMAC signing, retries, DLQ
│   │   ├── stream-replay.js            # Missed event recovery via XRANGE
│   │   └── push-consumers/             # JetStream, SSE, Postgres CDC
│   ├── services/                       # Selector canary, sandbox, GitOps healer (Epic 39)
│   ├── graph/                          # Network graph algorithms (PageRank, community)
│   ├── a2a/                            # Agent-to-Agent protocol bridge & discovery
│   ├── portability/                    # Account archive export/import/diff
│   ├── benchmark/                      # Epic 34 reliability scoring & canary config
│   ├── proxy/                          # ProxyIpPool, providers, tier escalation (Epic 40)
│   ├── plugins/                        # Plugin system + excel/google-sheets connectors
│   ├── automation/                     # Browser automation scripts (paste-in-console)
│   ├── agents/                         # Thought-leader agent, persona engine
│   ├── ai/                             # LLM integrations (content, voice, optimize)
│   ├── scheduler/                      # Post scheduling & webhook triggers
│   ├── spaces/                         # X Spaces AI voice agent
│   ├── scraping/                       # stealthBrowser, paginationEngine, proxyManager
│   └── utils/                          # Shared logging, dates, stream publishers
├── tests/                              # Comprehensive Vitest Test Suite
└── docs/                               # Architectural and technical documentation
```

---

## 5. Architectural Invariants & Non-Negotiable Rules

1. **Deterministic Error Handling (AD-11 / 3-Layer Envelope)**:
   - All errors thrown by scrapers or dispatchers must be wrapped in `PlatformError` with standard codes (`XACT_4xxx` for caller errors, `XACT_5xxx` for system errors) and an actionable `suggestedAction`.
2. **Fault-Isolated Cross-Platform Execution**:
   - Universal dispatchers (`UniversalActionDispatcher`) must never let a failure on one network abort execution on another. Parallel execution via `Promise.allSettled` is mandatory.
3. **Dry-Run Simulation Guarantee**:
   - Every write action must support `dryRun: true`, producing synthetic identifiers and realistic previews without touching live network state or mutating external databases.
4. **No LLM in Critical Path Logic**:
   - Thread splitting, character truncation, and rate calculation must be 100% deterministic algorithms (regex/tokens), never dependent on external AI latency or non-determinism.
   - **Jev corollary:** decision questions (relevance/action/safety) may consult the Jev plane, but the *execution* of a chosen action and all rate/timing math remain deterministic. Jev is advisory to the control flow, never a blocking dependency of it.
6. **Jev Plane Isolation (AD-48)**:
   - All Jev calls route through `src/agents/jevBrain.js`. No module calls `api.typesafe.ai` directly. On `TYPESAFE_API_KEY` absence or error, the plane degrades to `LLMBrain` judgment — never hard-fails. Confidence thresholds are configurable per action, never hardcoded.
5. **No Secret Leaks**:
   - Webhook secrets, session cookies (`c_user`, `auth_token`), and passwords must be strictly redacted in API outputs and logging (`redactSecret()`).

---

## 6. Technical Debt Audit & Modernization Roadmap

Following our full audit of the repository, the following technical debt items and architectural improvements have been identified:

### 6.1. Identified Technical Debt (TD)

| ID | Component | Severity | Description & Impact |
|---|---|---|---|
| **TD-1** | Root `src/*.js` | **Medium** | ~60 legacy standalone browser scripts remain in `src/` root (e.g. `unfollowEveryone.js`, `detectUnfollowers.js`). They duplicate functionality already implemented inside `src/scrapers/social/twitter/` and lack standard `PlatformError` envelopes. |
| **TD-2** | Dispatcher Circularity | **Low** | `src/scrapers/index.js` dynamically imports `dispatcher.js`, while `dispatcher.js` imports `scrape` from `../index.js`. While valid in ESM, decoupling via an orchestration layer improves clarity and tree-shaking. |
| **TD-3** | In-Memory Account State | **Medium** | Account hibernation (`#hibernatingAccounts`) and per-account sliding timestamps in `AdaptiveRateGovernor` are still held in Node.js process memory. In multi-pod deployments, hibernation on Pod A does not automatically pause Pod B unless synced via Redis. |
| **TD-4** | Test Suite Duration | **Low** | Running the complete test suite spans multiple minutes due to live Puppeteer browser launches in certain older tests and synthetic timeout simulation delays (`gaussianDelay`). |
| **TD-5** | CLI Command Monolith | **Medium** | `src/cli/index.js` is over 2,900 lines in a single file. Subcommands should be split into individual command action files under `src/cli/commands/`. |

### 6.2. Strategic Modernization Recommendations

1. **Consolidate Root Scripts into `AbstractCrawler` Actions**:
   - Deprecate loose files in `src/*.js` by migrating their remaining logic into the `TwitterCrawler` and `UniversalActionDispatcher` actions, transforming the root scripts into simple CLI wrappers.
2. **Cluster-Wide Account Hibernation (Redis-Backed)**:
   - Extend `DistributedTokenBucket` to also maintain an atomic Redis set `xact:hibernating_accounts:{platform}` with TTL, allowing any worker process to instantly observe hibernated credentials.
3. **Modularize CLI Entry Point**:
   - Refactor `src/cli/index.js` into modular sub-command handlers (`src/cli/commands/*.js`), keeping the CLI entry point under 200 lines.
4. **Fast-Mock Flag for Unit Testing**:
   - Introduce `XACTIONS_TEST_FAST_DELAYS=1` to bypass `gaussianDelay()` during local unit test runs, reducing test suite execution time by over 70%.

---

## 7. Operational Readiness Checklist

- [x] All 26 canonical scraping platform descriptors active and registered.
- [x] Universal Cross-Platform Write Actions (`post`, `like`, `reply`, `repost`, `follow`, `unfollow`) verified.
- [x] Dynamic Thread Splitter with token boundary protection and media chunking active.
- [x] Universal Media Pipeline supporting MP4 bitrate selection and HLS playlists.
- [x] Real-time Rate Budget Dashboard with Panic Stop and Drag-and-Drop Queue Priorities.
- [x] Distributed Token Bucket with Redis Lua script atomic execution.
- [x] 100% of all sprint stories through Phase 7 (Epics 36–41) marked done and verified.
- [x] OSINT `x_social_find_profiles` with tiered deadlines, platform status, and circuit breakers.
- [x] GitHub + Gravatar zero-auth identity adapters registered (Epic 41.1), GitHub rate-limited via `DistributedTokenBucket`.
- [x] `EntityResolver` producing `identityClusters[]` in-memory alongside `profiles[]` (Epic 41.2).
- [ ] **Post-retro appended stories (2026-09-19):** Story 41.3 avatar pHash (Epic 41), Story 35.5 IG session live-verify (Epic 35), Story 13.11 marketplace filters (Epic 13) — `ready-for-dev`, Epics flipped back to `in-progress`. Gated: 13.12, 27.5, 33.3, 33.4 (`backlog-blocked` pending activation).
- [x] Distributed Token Bucket (Redis Lua) backing both consumer quotas and the daily proxy budget.
- [x] Account Pool health guard with hibernation synced to the Adaptive Rate Governor.
- [x] GitOps selector healing via `xactions canary status | probe | heal` (Draft PR output only).
- [x] Cost-aware proxy escalation with `PROXY_DAILY_BUDGET_USD` ceiling and `BUDGET_CEILING_REACHED` soft degradation.

---

## 13. Phase 7 Architecture Decisions & Core Invariants (Epics 36–41)

### 13.1. Five Core Architectural Invariants

1. **Template Method for Streaming (Zero `__streamEmitted`):**
   `AbstractCrawler.execute()` is the **Single Source of Truth** for event streaming to Redis Streams. Subclasses are strictly forbidden from directly importing or invoking `publisher.publish()`, and must never attach arbitrary status flags (such as `__streamEmitted`) to domain payloads.
2. **Option D Identity Cleanliness (Strict PII Boundary — rescoped by Epic 41):**
   XActions operates purely as a **Stateless Data Harvester** with respect to persistence: `x_social_find_profiles` returns platform-native `ProfileItem[]` and an `identityClusters[]` array computed **in-memory per request** by `EntityResolver` (Jaro-Winkler + additive confidence scoring). It must never create identity tables (`PersonEntity`, `GoldenContact`) or persist resolved PII in Node.js/Prisma. Entity resolution is allowed only as a **pure, stateless, per-request computation** — persistence remains prohibited.
3. **Platform-Static HTTP Routing (No Sequential Escalation Loops):**
   Lightweight public domains (e.g., Masothue, Batdongsan, RSS) route directly through Tier 0 (`got-jsdom`), while bot-protected social platforms route directly to Tier 1 (CDP / Stealth Browser). Sequential 3-tier trial-and-error escalation that induces up to 16s latency is rejected.
4. **GitOps-Driven DOM Drift Healing (No Runtime Code Injection):**
   Selectors remain immutable in source control (`selectors.json`, `selectors.md`). When `SelectorCanary` detects drift, `AutoSelectorFallback` produces an AST-validated `unified-diff` and automatically generates a GitHub Draft PR. Direct runtime hot-patching of unverified selectors into Redis is rejected.
5. **No Mocks in Integration & Zero Delay in Test:**
   Testing Tier 0 HTTP engines must use in-process Local Ephemeral Servers (`127.0.0.1:0` with HTTP/2 and TLS) instead of external mocks or internet endpoints. All delay/jitter utilities must check `process.env.XACTIONS_TEST_FAST_DELAYS === '1'` to ensure unit tests finish in <1.5s.

### 13.2. Architecture Decision Records (Phase 7)

- **AD-40 (Person OSINT Tool Boundary):** `x_social_find_profiles` wraps `UniversalScrapeDispatcher` with `Promise.allSettled()` and per-platform deadlines (4s for HTTP, 10s for Browser). Downstream consumers (Nowing/ChainLens) handle clustering and persistence.
- **AD-41 (CloudEvents v1.0 Envelope):** All stream items pushed to Redis Streams must comply with the CloudEvents 1.0 JSON format and include an `idempotencyKey` computed from `sha256(platform + entityId + timestamp_bucket)`.
- **AD-42 (Cost-Aware Proxy Escalation):** `ProxyIpPool` nodes carry `tier: 'free' | 'datacenter' | 'residential' | 'mobile_4g'`. Requests default to `datacenter` and only escalate to `residential` upon receiving explicit bot challenges (`XACT_5030` or HTTP 403). Daily budget ceilings are atomically governed by `DistributedTokenBucket`. [Rescoped 2026-09-18] Migration: `residential: boolean` → `tier` enum; backward compat `residential: true` → `tier: 'residential'`. `ProxyBudgetGovernor` enforces `PROXY_DAILY_BUDGET_USD` ceiling; `BUDGET_CEILING_REACHED` soft degradation returns degraded result instead of throwing `PROXY_EXHAUSTED`.
- **AD-43 (Zero-Browser Engine Invariant):** Lightweight platforms (Masothue, Batdongsan, Chotot, TopCV, VietnamWorks, Shopee) are HTTP-first by design. Their `DESCRIPTORS` map to `AbstractApiClient`-based clients using `got`/`undici` — no Chromium process is spawned. Engine metadata (`engineUsed`, `durationMs`, `platform`, `action`) is injected into `_metadata` on every `AbstractCrawler.start()` result so downstream consumers can observe transport choice and latency without inspecting client classes.
- **AD-44 (GitOps Selector Healing — No Runtime Injection):** Selector drift healing follows a strict GitOps pipeline: `SelectorCanary` detects drift → `AutoSelectorFallback.investigate()` generates ranked candidates → `SelectorSandbox` validates candidates against `expectedShape` → `CanaryHealer` produces a `unified-diff` for `canary-targets.json` → GitHub Draft PR is created for human review. Runtime hot-patching of selectors into Redis or in-memory config is strictly rejected. The `xactions canary heal` CLI orchestrates this flow manually; auto-heal on detection is prohibited.
- **AD-45 (In-Memory Identity Resolution — Epic 41, rescopes Option D):** `x_social_find_profiles` may compute `identityClusters[]` in-memory via `EntityResolver` (Jaro-Winkler similarity + additive confidence scoring over 4 signals: exact-username +40, name-similarity>0.85 +30, avatar-match +30, cross-link-in-bio +20, merged by union-find at threshold ≥40). This refines the earlier "no entity resolution" reading of AD-40: the prohibition is on **persistence** (`PersonEntity`/`GoldenContact` tables, stored PII), not on stateless per-request clustering. Zero-auth identity registries (`github` → username, `gravatar` → email) are registered in `PROFILE_ACTION_MAP`; GitHub's 60 req/h (5000 with `GITHUB_TOKEN`) budget is enforced via `DistributedTokenBucket`. Out of scope (Mr.Holmes domain): dorking, breach/leak checks, BFS recursive profiling, Maigret-style mass scans.
- **AD-46 (Avatar Perceptual Hashing — Story 41.3, Epic 41):** `EntityResolver`'s `avatar_match` signal is upgraded from URL-string-equality to **perceptual hashing** (`src/osint/phash.js`, pure JS, zero-dep): dHash/aHash over decoded RGBA + Hamming distance on a 64-bit hash, threshold ≤ 10. This closes the CDN-rotation gap where the same avatar served from `fbcdn.net` vs `cdninstagram.com` vs `avatars.githubusercontent.com` produces different URLs. URL-exact match remains the fast-path; pHash fetch+decode only runs on URL miss, is async, and respects Option D — no hash or PII is persisted (in-memory per-request).
- **AD-48 (Agentic Decision Plane — Jev, Epic 42):** Typed-decision model `jev-latest` is introduced as a dedicated plane for *judgment* (relevance, action routing, spam/safety), distinct from generative *content* LLMs. Contract: `POST /v1/systemone { state: string|object|array, questions: {id: Choice|Score|Noul} }` -> `{choice|score|noul, probabilities, confidence}`. Constraints: text-only state; English-primary (verified strong on vi/mixed corpus); Noul carries no `confidence` field. Routing: `jevBrain.js` sole gateway; confidence-gated action; `LLMBrain` fallback. Verified corpus: `scripts/jev-verify/`.
- **AD-47 (GraphQL Replay Engine — Story 13.12, Epic 13, conditional):** When activated, captured Facebook `doc_id` + tokens (`fb_dtsg`, `lsd`, `__dyn`, `__csr`) are replayed via the HTTP client with a replay cache (`redis`/`sqlite`) and a DOM/hydration fallback on doc_id rotation. Gated on ≥80% doc_id stability over 30 days of production-like traffic.
