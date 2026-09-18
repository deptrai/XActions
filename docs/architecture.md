# XActions — System Architecture

> **Version:** 4.0.0 (September 2026)  
> **Status:** Production / Distributed Multi-Platform Autonomous Scraping & Syndication Engine  
> **Author:** nich (@nichxbt) & DeepMind Advanced Agentic Coding Team  

---

## 1. Executive Architectural Overview

**XActions** is an enterprise-grade, distributed scraping, interaction, and content syndication platform designed for both human operators and autonomous AI agents (via Model Context Protocol - MCP).

Originally started as a Twitter/X browser automation utility, XActions has evolved through 35 Epics and 112 Stories into a **universal 24-platform scraping and cross-platform write syndication engine**. It combines stealth headless browser automation (Puppeteer/Playwright/CDP) with direct reverse-engineered internal APIs (GraphQL, AT Protocol, REST, SSE, JetStream) and resilient governance infrastructure (Adaptive Rate Governor, Distributed Token Bucket, Proxy Dual-Pool, Schema Drift Canary, and Outbound Webhooks).

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
│ 24 Canonical Platform Descriptors:│       │ • AdaptiveRateGovernor (Velocity/Backpress)│
│ • Social: Twitter, Bluesky, Masto,│       │ • DistributedTokenBucket (Redis Lua Script)│
│   Threads, Facebook, TikTok, Insta│       │ • ProxyIpPool (Realtime vs Bulk Dual-Pool) │
│ • Video/Audio: YouTube VN, Spaces │       │ • SessionHealthOrchestrator (Circuit Break)│
│ • E-Commerce: Shopee, TikTokShop  │       │ • SchemaDriftGuard & SelectorCanary        │
│ • Local: Zalo OA, TopCV, Masothue │       │ • AutoSelectorFallback (Heuristic Discovery│
│ • B2B / Realestate: Batdongsan... │       │ • 3-Layer ErrorEnvelope (XACT_4xxx/5xxx)   │
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
3. **Canonical Supported Platforms (24 platforms)**:
   - **Social Networks**: Twitter/X, Bluesky (AT Protocol), Mastodon (ActivityPub REST), Threads (Barcelona GraphQL/SSR), Facebook (GraphQL/CDP), Reddit, Medium, Instagram.
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

### 2.5. Streaming & Event Lifecycle (Epic 29)
- **Unified Redis Streams**: Publishes events into tenant-isolated Redis streams (`xact:stream:{workspaceId}`).
- **Push Consumers**: Connectors for JetStream (NATS/AT Protocol Firehose), Server-Sent Events (SSE), and PostgreSQL CDC (Logical Replication).
- **Outbound Webhooks**: HMAC-SHA256 signature generation, exponential backoff retries, dead-letter queues (DLQ), and consumer lag monitoring.
- **Stream Replay (`src/streaming/stream-replay.js`)**: Cursor-based recovery (`XRANGE`) for missed events with sequence number deduplication.

### 2.6. Model Context Protocol (MCP) Server (`src/mcp/server.js`)
- Full compliance with `@modelcontextprotocol/sdk`.
- Over 50 registered tools including `x_scrape`, `x_actions_list`, `x_publish_all`, `x_like_all`, `x_follow_all`, `x_download_media`, `x_crawl_post`, etc.
- Multi-consumer quota gate (AD-20) protecting shared resources from AI agent runaway loops.
- Exposes structured resources (`xactions://platforms`, `xactions://actions`, `xactions://system/status`).

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
| **AI Integration** | OpenRouter API / Anthropic / OpenAI | Persona generation, voice analysis, tweet rewriting |
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
├── src/                                # Core Engine Source Code
│   ├── core/                           # Foundation classes & Resiliency
│   │   ├── base-crawler.js             # AbstractCrawler with ActionRegistry
│   │   ├── base-client.js              # AbstractApiClient with proxy & retry
│   │   ├── adaptive-governor.js        # Velocity throttling, panic stop, queue priority
│   │   ├── distributed-token-bucket.js # Redis Lua token bucket & header parsing
│   │   ├── session-manager.js          # Multi-account session lifecycle
│   │   ├── error-envelope.js           # 3-Layer ErrorEnvelope standard
│   │   └── schema-drift-guard.js       # DOM selector mutation detection
│   ├── mcp/                            # Model Context Protocol implementation
│   │   ├── server.js                   # MCP server entry (Tools, Resources, Prompts)
│   │   └── local-tools.js              # In-process tool bindings
│   ├── scrapers/                       # Unified Scraper Spine
│   │   ├── index.js                    # scrape() universal dispatcher
│   │   ├── adapters/                   # Puppeteer / Playwright / Cheerio adapters
│   │   ├── videoDownloader.js          # Media downloader delegate
│   │   └── social/                     # Social network scrapers & syndication
│   │       ├── dispatcher.js           # UniversalActionDispatcher (parallel writes)
│   │       ├── content-transformer.js  # Thread splitter, media adapter, limits
│   │       ├── media-pipeline.js       # UniversalMediaPipeline (MP4/HLS/Audio)
│   │       ├── twitter/                # Twitter hybrid crawler & GraphQL client
│   │       ├── bluesky/                # Bluesky XRPC crawler & client
│   │       ├── mastodon/               # Mastodon REST crawler & client
│   │       ├── threads/                # Threads Barcelona crawler & client
│   │       ├── facebook/               # Facebook hybrid CDP/GraphQL crawler
│   │       ├── reddit/                 # Reddit JSON/Listing crawler
│   │       ├── tiktok/                 # TikTok video & music crawler
│   │       └── ...                     # Remaining 17 platform modules
│   ├── streaming/                      # Event Streaming & Ingestion
│   │   ├── outbound-webhook-dispatcher.js # HMAC signing, retries, DLQ
│   │   ├── stream-replay.js            # Missed event recovery via XRANGE
│   │   └── push-consumers/             # JetStream, SSE, Postgres CDC
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

- [x] All 24 canonical scraping platform descriptors active and registered.
- [x] Universal Cross-Platform Write Actions (`post`, `like`, `reply`, `repost`, `follow`, `unfollow`) verified.
- [x] Dynamic Thread Splitter with token boundary protection and media chunking active.
- [x] Universal Media Pipeline supporting MP4 bitrate selection and HLS playlists.
- [x] Real-time Rate Budget Dashboard with Panic Stop and Drag-and-Drop Queue Priorities.
- [x] Distributed Token Bucket with Redis Lua script atomic execution.
- [x] 100% of all 112 sprint stories marked done and verified.

---

## 13. Phase 7 Architecture Decisions & Core Invariants (Epics 36–40)

### 13.1. Five Core Architectural Invariants

1. **Template Method for Streaming (Zero `__streamEmitted`):**
   `AbstractCrawler.execute()` is the **Single Source of Truth** for event streaming to Redis Streams. Subclasses are strictly forbidden from directly importing or invoking `publisher.publish()`, and must never attach arbitrary status flags (such as `__streamEmitted`) to domain payloads.
2. **Option D Identity Cleanliness (Strict PII Boundary):**
   XActions operates purely as a **Stateless Data Harvester**. It returns platform-native raw `ProfileItem[]` via `x_social_find_profiles`. It must never create identity tables (`PersonEntity`, `GoldenContact`), nor perform fuzzy entity resolution (Jaro-Winkler, pHash) in Node.js.
3. **Platform-Static HTTP Routing (No Sequential Escalation Loops):**
   Lightweight public domains (e.g., Masothue, Batdongsan, RSS) route directly through Tier 0 (`got-jsdom`), while bot-protected social platforms route directly to Tier 1 (CDP / Stealth Browser). Sequential 3-tier trial-and-error escalation that induces up to 16s latency is rejected.
4. **GitOps-Driven DOM Drift Healing (No Runtime Code Injection):**
   Selectors remain immutable in source control (`selectors.json`, `selectors.md`). When `SelectorCanary` detects drift, `AutoSelectorFallback` produces an AST-validated `unified-diff` and automatically generates a GitHub Draft PR. Direct runtime hot-patching of unverified selectors into Redis is rejected.
5. **No Mocks in Integration & Zero Delay in Test:**
   Testing Tier 0 HTTP engines must use in-process Local Ephemeral Servers (`127.0.0.1:0` with HTTP/2 and TLS) instead of external mocks or internet endpoints. All delay/jitter utilities must check `process.env.XACTIONS_TEST_FAST_DELAYS === '1'` to ensure unit tests finish in <1.5s.

### 13.2. Architecture Decision Records (Phase 7)

- **AD-40 (Person OSINT Tool Boundary):** `x_social_find_profiles` wraps `UniversalScrapeDispatcher` with `Promise.allSettled()` and per-platform deadlines (4s for HTTP, 10s for Browser). Downstream consumers (Nowing/ChainLens) handle clustering and persistence.
- **AD-41 (CloudEvents v1.0 Envelope):** All stream items pushed to Redis Streams must comply with the CloudEvents 1.0 JSON format and include an `idempotencyKey` computed from `sha256(platform + entityId + timestamp_bucket)`.
- **AD-42 (Cost-Aware Proxy Escalation):** `ProxyIpPool` nodes carry `tier: 'free' | 'datacenter' | 'residential' | 'mobile_4g'`. Requests default to `datacenter` and only escalate to `residential` upon receiving explicit bot challenges (`XACT_5030` or HTTP 403). Daily budget ceilings are atomically governed by `DistributedTokenBucket`.
- **AD-43 (Zero-Browser Engine Invariant):** Lightweight platforms (Masothue, Batdongsan, Chotot, TopCV, VietnamWorks, Shopee) are HTTP-first by design. Their `DESCRIPTORS` map to `AbstractApiClient`-based clients using `got`/`undici` — no Chromium process is spawned. Engine metadata (`engineUsed`, `durationMs`, `platform`, `action`) is injected into `_metadata` on every `AbstractCrawler.start()` result so downstream consumers can observe transport choice and latency without inspecting client classes.
- **AD-44 (GitOps Selector Healing — No Runtime Injection):** Selector drift healing follows a strict GitOps pipeline: `SelectorCanary` detects drift → `AutoSelectorFallback.investigate()` generates ranked candidates → `SelectorSandbox` validates candidates against `expectedShape` → `CanaryHealer` produces a `unified-diff` for `canary-targets.json` → GitHub Draft PR is created for human review. Runtime hot-patching of selectors into Redis or in-memory config is strictly rejected. The `xactions canary heal` CLI orchestrates this flow manually; auto-heal on detection is prohibited.
