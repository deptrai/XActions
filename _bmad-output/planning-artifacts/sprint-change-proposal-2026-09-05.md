---
title: "Sprint Change Proposal — Post-Backlog Expansion: Gap-Validated Resilience, Streaming & Operator Tooling"
date: 2026-09-05
status: draft
scope: major
---

# Sprint Change Proposal

**Date:** 2026-09-05  
**Project:** XActions  
**Triggering issue:** Sau khi hoàn thành Epic 23 (Bluesky & Mastodon Integration) và các epic 10–19, XActions cần lộ trình mới ngoài backlog hiện tại (Epics 20, 24–26). Trước khi lên kế hoạch, đã audit toàn bộ code/docs để xác định chính xác những gì đã implement, đang partial, và còn thiếu.

---

## Section 1 — Issue Summary

### Problem statement
1. **Backlog hiện tại đang cạn:** Epic 20, 24, 25, 26 là cleanup/consolidation, không cung cấp giá trị business mới trực tiếp.
2. **Cạnh tranh anti-bot ngày càng khắc nghiệt:** X/Twitter, Threads, Facebook liên tục cập nhật bot detection (TLS fingerprinting, DOM drift, challenge pages). XActions cần tự động hóa resilience.
3. **Silent data degradation:** Selector DOM thay đổi → payload rỗng/thiếu field mà không cảnh báo.
4. **Thiếu real-time event pipeline:** Consumer phải polling định kỳ, tốn tài nguyên.
5. **Cross-platform duplication:** Người dùng cần đăng bài/tương tác đồng thời trên nhiều nền tảng.

### Evidence (audit đã xác minh)
- `src/core/adaptive-governor.js` — **đã có** `hibernateAccount`, `recordRateLimit`, `recordBotChallenge`, `consumerQuotas` (chainlens/nowing/internal), `throttleLevel`, `getStatus()`.
- `src/core/account-pool.js` — **đã có** `registerAccounts`, `getNextAvailable`, `markUnavailable`, `markAvailable`, `hibernatingUntil`.
- `src/agents/antiDetection.js` — **đã có** `generateFingerprint`, `gaussianRandom`, `generateBezierPath`, `humanClick`, `humanType`, `humanScroll`.
- `src/scraping/stealthBrowser.js` — **đã có** `launchStealthBrowser`, `createStealthPage`, `stealthClick`, `stealthType`.
- `src/proxy/proxy-pool.js` — **đã có** `quarantine`, `stickyMap`, `dual-pool` (realtime 30% / bulk 70%), `antiLeakFlags`.
- `src/streaming/streamManager.js` — **đã có** Bull queue polling, Redis state, pause/resume, dedup, Socket.IO emit.
- `src/scheduler/webhookTrigger.js` — **đã có** `POST /api/webhooks/trigger/:jobName`, `POST /api/webhooks/ingest`.
- `src/mcp/local-tools.js` — **đã có** `x_get_profile_multiplatform`, `x_get_tweets_multiplatform`, `x_search_tweets_multiplatform`, `x_get_followers_multiplatform`, `x_get_following_multiplatform`, `x_post_tweet`, `x_post_thread`, `x_like`, `x_retweet`, `x_reply`, `x_download_video`.
- `src/scrapers/social/twitter/normalize-media.js` — **đã có** HLS `.m3u8` fallback, bitrate selection, `parseMediaEntity`, `tweetMediaToPostItem`.
- `src/core/metadata-schema-registry.js` — **đã có** `MetadataSchemaRegistry`, `validateSchemaNode` (JSON Schema-like validation).
- `src/core/types.js` — **đã có** `PostItem`, `CommentItem`, `ProfileItem`, `GovernorStatus`, `ConsumerQuotaConfig`, `ThinEvent`, `StreamMetrics`.
- `dashboard/platform.html` — **đã có** `requiresAccount`, `buildActionCard`, `renderQuickActions` với `🔑` badge.
- `dashboard/admin.html` — **đã có** `healthy-proxies-count`, `hibernating` badge, `governor/status` fetch.
- `dashboard/monitor.html` — **đã có** `health-bar`, `rate-limit-bar`, `quota-bar`, `reset-timer`.
- `docs/dom-selectors.md` + `docs/case-studies/robust-dom-extraction.md` — **đã có** fallback selector pattern.
- `src/a2a/streaming.js` — **đã có** SSE `StreamManager`, `Stream`, `bridgeTaskStream`.
- `src/core/cdp-launcher.js` — **đã có** CDP attach mode.
- `nowing/_bmad-output/planning-artifacts/epics.md` — Nowing đã làm `24.8` (CDP operator) và `21.5`/`21.13` (CRM/Google Sheets sync).

---

## Section 2 — Impact Analysis

### Epic impact (post-audit)
| Epic | Impact | Required change |
|------|--------|-----------------|
| **Epic 27** | **Major** | `Anti-Detection & Session Resilience` — **nâng cấp**, không mới hoàn toàn. |
| **Epic 28** | **Major** | `Schema Drift & Selector Resilience` — **nâng cấp**, fallback đã có. |
| **Epic 29** | **Major** | `Real-Time Event Streaming` — **nâng cấp**, polling đã có. |
| **Epic 30** | **Moderate** | `Cross-Platform Action Sync` — **mới**, chưa có unified write dispatcher. |
| **Epic 31** | **Moderate** | `Universal Media Extraction` — **nâng cấp**, Twitter-only downloader đã có. |
| **Epic 32** | **Moderate** | `Rate-Budget & Queue Governance` — **nâng cấp**, governor đã có. |

### Story impact (gap-validated)
| Story | Audit status | True gap |
|-------|--------------|----------|
| **27.1** FingerprintManager + TLS/JA4 spoofing | 🟡 Partial | Chỉ có browser-level UA/viewport randomization; chưa có TLS/JA4, geo-consistent profile binding. |
| **27.2** Session Health Score + Circuit Breaker | 🟡 Partial | `hibernateAccount`/`isHibernating` đã có; chưa có continuous health score, circuit-breaker auto-recovery probe. |
| **28.1** Schema Drift Guard + Canary | 🟡 Partial | Fallback selector chain đã có; chưa có canary job, runtime `Zod`/`JSON-Schema` validation, `Complete/Degraded/Corrupted` classification. |
| **29.1** Jetstream/SSE/CDC adapters | ❌ Missing | `streamManager` chỉ polling; chưa có WebSocket/SSE adapter cho Bluesky Jetstream, Mastodon SSE, hoặc generic CDC. |
| **29.2** Outbound Webhook Dispatcher | ❌ Missing | Chỉ có inbound `webhookTrigger`; chưa có outbound HMAC-signed dispatcher. |
| **30.1** Universal Action Dispatcher | ❌ Missing | `x_post_tweet`/`x_like` chỉ cho X; chưa có `post --sync-all` hay `UniversalActionDispatcher` cho cross-platform write. |
| **31.1** Universal Media Pipeline | 🟡 Partial | `videoDownloader` + `normalize-media` chỉ Twitter; chưa có pipeline chuẩn hóa cho audio/carousel/HLS trên mọi nền tảng. |
| **32.1** Visual Rate-Budget Dashboard | 🟡 Partial | `governor` metrics đã có; chưa có dashboard gauge, drag-drop queue, panic stop UI. |
| **32.2** Distributed Token Bucket | 🟡 Partial | `consumerQuotas` in-memory đã có; chưa có Redis-distributed token bucket + header parsing. |

### Artifact conflicts
| Artifact | Conflict / update needed |
|----------|--------------------------|
| **PRD** `prd.md` | Cập nhật FRs: chỉ giữ gap thực sự, thêm FR cho `FingerprintManager`, `SessionHealthScore`, `SchemaDriftGuard`, `JetstreamAdapter`, `OutboundWebhookDispatcher`, `UniversalActionDispatcher`, `UniversalMediaPipeline`, `RateBudgetDashboard`, `DistributedTokenBucket`. |
| **Architecture Spine** `ARCHITECTURE-SPINE.md` | Thêm ADs cho các component trên. |
| **Epics** `epics.md` | Append Epic 27–32 với story breakdown đã điều chỉnh. |

---


---

## Changes from Initial Proposal (Post-Audit)

This proposal was rewritten after a full code/docs audit. The following stories were **rescoped** because the underlying capability already exists:

| Original proposal | Audit result | Action |
|-------------------|--------------|--------|
| Epic 27.1 — FingerprintManager | Browser-level fingerprint exists (`src/agents/antiDetection.js`, `src/scraping/stealthBrowser.js`) | Kept, but scope narrowed to TLS/JA4 + geo-consistency |
| Epic 27.2 — Session Health Orchestrator | `hibernateAccount`, `recordRateLimit`, `recordBotChallenge` exist | Kept, but narrowed to health score + circuit breaker |
| Epic 27.3 — ChallengeSignatureDetector | `isBotChallenge` exists in `AbstractPlatformResponseValidator` + platform validators | Kept, but narrowed to standalone auto-trigger detector |
| Epic 28.1 — Schema Drift Guard | `MetadataSchemaRegistry` + `validateSchemaNode` exist | Kept, but narrowed to runtime validation + `Complete/Degraded/Corrupted` |
| Epic 28.2 — SelectorCanary | Fallback selector chain documented | Kept, but narrowed to periodic canary + alert |
| Epic 28.3 — AutoSelectorFallback | Manual fallback chains exist | Kept, but narrowed to assisted re-discovery |
| Epic 29.1 — Jetstream/SSE/CDC | `streamManager` polling exists | Kept, but narrowed to push-based adapters only |
| Epic 29.2 — Outbound Webhook | Only inbound `webhookTrigger` exists | Kept as true gap |
| Epic 30.1 — Universal Action Dispatcher | `x_post_tweet`/`x_like` are X-only | Kept as true gap |
| Epic 31.1 — Universal Media Pipeline | `videoDownloader` + `normalize-media` are Twitter-only | Kept, but narrowed to multi-platform |
| Epic 32.1 — RateBudgetDashboard | `governor` metrics + `dashboard/admin.html` exist | Kept, but narrowed to visual allocator + panic stop |
| Epic 32.2 — DistributedTokenBucket | `consumerQuotas` are in-memory sliding-window | Kept, but narrowed to Redis-backed token bucket |

**Dropped / not proposed:** full CDC pipeline, full decommissioning, CRM sync, CDP operator, lead scoring — these belong to **Nowing** or are already implemented.

## Section 3 — Recommended Approach

**Direct Adjustment** — cập nhật PRD, architecture, và thêm stories vào backlog; không rollback.

**Rationale:**
- Nhiều tính năng đã có nền tảng (governor, account pool, stealth, streaming, webhook inbound, schema registry). Việc viết lại từ đầu sẽ tốn effort và rủi ro hồi quy.
- Các gap còn lại là incremental: TLS/JA4, health score, circuit breaker, canary, outbound webhook, cross-platform write, universal media, UI dashboard, distributed token bucket.
- XActions giữ scope Producer/Scraping Engine; không đè lên Nowing (CDP operator, CRM) hay ChainLens (deep research).

**Effort estimate:**
- Epic 27: 2–3 sprints (TLS fingerprinting + health orchestrator).
- Epic 28: 1–2 sprints (canary + runtime validation).
- Epic 29: 2 sprints (Jetstream/SSE + outbound webhook).
- Epic 30: 2 sprints (unified write dispatcher + content transformer).
- Epic 31: 1–2 sprints (multi-platform media pipeline).
- Epic 32: 1–2 sprints (dashboard UI + Redis token bucket).

**Risk:** Low–Medium — chủ yếu là integration và testing, không phải greenfield.

---

## Section 4 — Detailed Change Proposals

### Epic 27 — Anti-Detection & Session Resilience (nâng cấp)
- **Story 27.1** `FingerprintManager` + TLS/JA4 spoofing + geo-consistent profile binding to proxy.
- **Story 27.2** `SessionHealthOrchestrator` — continuous health score, circuit-breaker, auto-recovery probe.
- **Story 27.3** `ChallengeSignatureDetector` — detect Cloudflare/Arkose challenge pages, auto-hibernate.

### Epic 28 — Schema Drift & Selector Resilience (nâng cấp)
- **Story 28.1** `SchemaDriftGuard` — runtime validation (`Zod`/`JSON-Schema`), `Complete/Degraded/Corrupted` classification.
- **Story 28.2** `SelectorCanary` — periodic DOM probe, alert on drift.
- **Story 28.3** `AutoSelectorFallback` — machine-assisted fallback selector generation.

### Epic 29 — Real-Time Event Streaming (nâng cấp)
- **Story 29.1** `JetstreamAdapter` — Bluesky Jetstream, Mastodon SSE, generic CDC adapters.
- **Story 29.2** `OutboundWebhookDispatcher` — HMAC-signed, retry with backoff, dead-letter queue.
- **Story 29.3** `StreamReplay` — replay missed events from Redis stream history.

### Epic 30 — Cross-Platform Action Sync (mới)
- **Story 30.1** `UniversalActionDispatcher` — `post --sync-all`, `like`, `follow`, `reply` across X/Bluesky/Mastodon/Threads.
- **Story 30.2** `ContentTransformer` — thread splitter, media format adapter, character limit handler.

### Epic 31 — Universal Media Extraction (nâng cấp)
- **Story 31.1** `UniversalMediaPipeline` — normalize audio/carousel/HLS across platforms, dedup, storage adapter.

### Epic 32 — Rate-Budget & Queue Governance (nâng cấp)
- **Story 32.1** `RateBudgetDashboard` — gauge, drag-drop queue priority, panic stop UI.
- **Story 32.2** `DistributedTokenBucket` — Redis-backed, header-aware (X-RateLimit-*), multi-instance sync.

---

## Section 5 — Implementation Handoff

- **Scope:** **Major** — cần backlog reorganization và architecture update.
- **Route to:** Product Owner + Developer agents.
- **Deliverables:** Updated PRD, updated architecture spine, approved story breakdown in `epics.md`.
- **Success criteria:**
  - Mỗi story có acceptance criteria rõ ràng.
  - Không duplicate các tính năng đã có (audit-verified).
  - Không đè lên scope Nowing/ChainLens.
  - Tất cả implementation mới phải có test coverage.

---

## Section 6 — Action Items

| # | Item | Owner | Priority |
|---|------|-------|----------|
| 1 | ✅ `epics.md` updated with Epic 27–32 (gap-validated stories) | PO | Done |
| 2 | Update `prd.md` with new FRs (only true gaps) | PM | High |
| 3 | Update `ARCHITECTURE-SPINE.md` with new ADs | Architect | High |
| 4 | Review and approve Epic 27–32 story breakdown in `epics.md` | PO | High |
| 5 | Write tests for new components | QA | Medium |
| 6 | Update `sprint-status.yaml` after epics are approved | PO | Medium |
| 7 | Reactivate Epic 21–22 in `epics.md` + update `backlog-epics-21-22.md` status | PO | High |
| 8 | Add Epic 33 (Zalo + YouTube VN) to `epics.md` | PO | High |
| 9 | Add FR-94→97 + NFR-19 to `prd.md` | PM | High |
| 10 | Update `FUTURE-WORK.md` (remove Epic 21–22, add Zalo Personal + YT Advanced deferred) | PM | High |
| 11 | Add VN proxy/geo AD to `ARCHITECTURE-SPINE.md` | Architect | Medium |
| 12 | Research Zalo OA API endpoints + YouTube Data API v3 quota | Dev | Medium |

---

**Note:** Proposal này đã được audit kỹ code/docs trước khi viết. Các story chỉ bao gồm gap thực sự, không duplicate implementation hiện có.

---

## Section 7 — Vietnam Market Pivot Addendum (2026-09-05)

### Trigger
Luisphan confirmed strategic pivot: XActions should prioritize the Vietnam market for Nowing AI Lead Hub. Existing VN coverage (Epic 15–18) covers 7 platforms but misses high-value VN-specific sources.

### Epic impact

| Epic | Change | Rationale |
|------|--------|-----------|
| **Epic 21** | 🔄 Reactivate (backlog → Phase A) | Spec sẵn, feasibility verified, direct Nowing B2B lead value |
| **Epic 22** | 🔄 Reactivate (backlog → Phase A) | Spec sẵn, feasibility verified, F&B/health/legal lead value |
| **Epic 33** | ➕ Net-new | Zalo OA + YouTube VN — largest uncovered VN platforms |
| **Epic 20** | ⬇️ Reorder → Phase D | Decommission can wait until VN crawlers stable |
| **Epic 24** | ⬇️ Reorder → Phase D | Lower priority than VN market coverage |
| **Epic 25–26** | ⬇️ Reorder → Phase D | Dispatcher finalization after all platforms added |
| **Epic 27–32** | ⬇️ Reorder → Phase B/C | Infrastructure hardening after VN crawlers proven |

### New FR/NFR additions (PRD)

| FR/NFR | Description | Epic |
|--------|-------------|------|
| FR-94 | Vietnam B2B Registry & Tender Crawler | 21.1 |
| FR-95 | Vietnam Automotive Market Crawler | 21.2 |
| FR-96 | Vietnam F&B, Healthcare & Legal Crawler | 22.1–22.3 |
| FR-97 | Zalo OA & YouTube VN Crawler | 33 |
| NFR-19 | Vietnam Geo-Consistent Proxy & Locale | All VN epics |

### Revised roadmap

```
Phase A — Vietnam Core (NEXT):
  Epic 21 → B2B tender, company registry, automotive
  Epic 22 → F&B, healthcare, legal/IP
  Epic 33 → Zalo OA + YouTube VN

Phase B — Infrastructure Hardening:
  Epic 27 → Anti-detection & session resilience
  Epic 28 → Schema drift & selector resilience
  Epic 29 → Real-time streaming & webhooks

Phase C — Advanced Features:
  Epic 30 → Cross-platform action sync
  Epic 31 → Universal media pipeline
  Epic 32 → Rate budget & queue governance

Phase D — Finalization:
  Epic 20 → Nowing cutover & decommission
  Epic 24 → Utility/adapters migration
  Epic 25 → Unified dispatcher final
  Epic 26 → Legacy removal
```

### Audit verification (VN platform coverage)

| Platform | Status | Evidence |
|----------|--------|----------|
| MaSoThue | 📋 Spec ready | `backlog-epics-21-22.md` Story 21.1 + live probe 200 OK |
| HoSoCongTy | 📋 Spec ready | `backlog-epics-21-22.md` Story 21.1 |
| MuaSamCong | 📋 Spec ready | `backlog-epics-21-22.md` Story 21.1 |
| Oto.com.vn | 📋 Spec ready | `backlog-epics-21-22.md` Story 21.2 + live probe 200 OK |
| Bonbanh | 📋 Spec ready | `backlog-epics-21-22.md` Story 21.2 |
| ChototXe | 📋 Spec ready | `backlog-epics-21-22.md` Story 21.2 (extends existing Chotot crawler) |
| PasGo | 📋 Spec ready | `backlog-epics-21-22.md` Story 22.1 + live probe 200 OK |
| Foody | 📋 Spec ready | `backlog-epics-21-22.md` Story 22.1 |
| Riviu | 📋 Spec ready | `backlog-epics-21-22.md` Story 22.1 |
| Medpro | 📋 Spec ready | `backlog-epics-21-22.md` Story 22.2 |
| YouMed | 📋 Spec ready | `backlog-epics-21-22.md` Story 22.2 + live probe 200 OK |
| Thuocsi | 📋 Spec ready | `backlog-epics-21-22.md` Story 22.2 |
| IP Vietnam | 📋 Spec ready | `backlog-epics-21-22.md` Story 22.3 |
| **Zalo OA** | ❌ Net-new | No code, no spec — Epic 33.1 |
| **Zalo Personal** | 🔮 Deferred | `FUTURE-WORK.md` — needs mobile API reverse engineering |
| **YouTube VN** | ❌ Net-new | No code, no spec — Epic 33.2 |
| Lazada/Tiki/Sendo | 🔮 Deferred | Low priority vs Shopee/TikTok Shop already done |
| Google Maps VN | 🔮 Deferred | Needs Places API key + local scraping strategy |

### Scope boundary (VN pivot does NOT change)

- **XActions** = scraping/data engine. Nowing = CRM/lead scoring/operator. ChainLens = deep research.
- Zalo OA API covers business content only — Zalo personal messaging is deferred.
- YouTube uses official API v3 first; InnerTube/yt-dlp is fallback only.
- All VN crawlers reuse `AbstractCrawler` + `AbstractApiClient` + `ProxyIpPool` + `PrismaStore` + `RedisStreamPublisher` — no new core infrastructure needed.

---

## Appendix A — Implementation Audit Matrix (per-story)

### Epic 27 — Anti-Detection & Session Resilience

| Story | Proposed feature | Audit finding | Evidence | Status |
|-------|-----------------|---------------|----------|--------|
| 27.1 | `FingerprintManager` + TLS/JA4 spoofing | Browser-level fingerprint exists (UA pool, viewport, timezone, Bezier, WebGL). **No TLS/JA4/JA3 spoofing, no geo-consistent profile binding to proxy region.** | `src/agents/antiDetection.js`, `src/scraping/stealthBrowser.js`, `docs/stealth-scraping.md` | 🟡 Partial |
| 27.2 | `SessionHealthOrchestrator` + circuit breaker | `hibernateAccount`, `recordRateLimit`, `recordBotChallenge`, `wakeAccount`, `isHibernating` exist. **No continuous health score, no auto-recovery probe, no circuit-breaker state machine.** | `src/core/adaptive-governor.js`, `src/core/account-pool.js`, `src/core/status-api.js` | 🟡 Partial |
| 27.3 | `ChallengeSignatureDetector` | `isBotChallenge` exists in `AbstractPlatformResponseValidator` + platform validators (Twitter, Facebook, Bluesky, Mastodon, TikTok). **Missing:** standalone detector that auto-triggers `recordBotChallenge` on detection. | `src/core/platform-validator.js`, `src/scrapers/social/*/validator.js` | 🟢 Mostly implemented |

### Epic 28 — Schema Drift & Selector Resilience

| Story | Proposed feature | Audit finding | Evidence | Status |
|-------|-----------------|---------------|----------|--------|
| 28.1 | `SchemaDriftGuard` + runtime validation | `MetadataSchemaRegistry` + `validateSchemaNode` exist (JSON Schema-like). **No Zod/JSON-Schema runtime validation wired into crawler output, no `Complete/Degraded/Corrupted` classification.** | `src/core/metadata-schema-registry.js` | 🟡 Partial |
| 28.2 | `SelectorCanary` | Fallback selector chain documented (`docs/dom-selectors.md`, `docs/case-studies/robust-dom-extraction.md`). **No periodic canary job, no automated drift alert.** | `docs/dom-selectors.md` | 🟡 Partial |
| 28.3 | `AutoSelectorFallback` | Manual fallback chains exist. **No machine-assisted fallback generation or self-healing selector.** | `src/utils/core.js` `queryAll` | 🟡 Partial |

### Epic 29 — Real-Time Event Streaming

| Story | Proposed feature | Audit finding | Evidence | Status |
|-------|-----------------|---------------|----------|--------|
| 29.1 | `JetstreamAdapter` (Bluesky/Mastodon) | `streamManager` uses Bull polling only. `a2a/streaming.js` is SSE for A2A tasks, not social events. **No Jetstream/SSE/CDC adapters for social platforms.** | `src/streaming/streamManager.js`, `src/a2a/streaming.js`, `api/routes/streams.js` | ❌ Missing |
| 29.2 | `OutboundWebhookDispatcher` | Only inbound `POST /api/webhooks/trigger/:jobName` + `POST /api/webhooks/ingest`. **No outbound HMAC-signed dispatcher, no retry/DLQ.** | `src/scheduler/webhookTrigger.js` | ❌ Missing |
| 29.3 | `StreamReplay` | `getStreamHistory` exists for polling streams (Bull/Redis). **Missing:** replay from `stream:social:raw_posts` Redis Stream or missed-event recovery for real-time adapters. | `src/streaming/streamManager.js`, `src/utils/redis-stream-publisher.js` | ❌ Missing |

### Epic 30 — Cross-Platform Action Sync

| Story | Proposed feature | Audit finding | Evidence | Status |
|-------|-----------------|---------------|----------|--------|
| 30.1 | `UniversalActionDispatcher` | `x_get_profile_multiplatform` etc. are read-only. `x_post_tweet`, `x_like`, `x_retweet`, `x_reply` are X-only. **No unified write dispatcher across platforms.** | `src/mcp/local-tools.js`, `src/scrapers/social/*/crawler.js` | ❌ Missing |
| 30.2 | `ContentTransformer` | No thread splitter, media format adapter, or character-limit handler for cross-platform publishing. | N/A | ❌ Missing |

### Epic 31 — Universal Media Extraction

| Story | Proposed feature | Audit finding | Evidence | Status |
|-------|-----------------|---------------|----------|--------|
| 31.1 | `UniversalMediaPipeline` | `videoDownloader` + `normalize-media` are Twitter-only (HLS `.m3u8` fallback). **No pipeline for audio/carousel/multi-platform media.** | `src/scrapers/videoDownloader.js`, `src/scrapers/social/twitter/normalize-media.js`, `src/mcp/local-tools.js` `x_download_video` | 🟡 Partial |

### Epic 32 — Rate-Budget & Queue Governance

| Story | Proposed feature | Audit finding | Evidence | Status |
|-------|-----------------|---------------|----------|--------|
| 32.1 | `RateBudgetDashboard` | `governor` metrics exist (`healthyProxyCount`, `hibernatingAccounts`, `consumerQuotas`, `throttleLevel`). `dashboard/admin.html` + `monitor.html` show some health. **No dedicated visual budget allocator, drag-drop queue, or panic-stop UI.** | `src/core/adaptive-governor.js`, `src/core/status-api.js`, `dashboard/admin.html`, `dashboard/monitor.html` | 🟡 Partial |
| 32.2 | `DistributedTokenBucket` | `consumerQuotas` are in-memory sliding-window (60s). **Missing:** Redis-backed token bucket (not sliding-window), `X-RateLimit-*` header parsing, multi-instance sync. | `src/core/adaptive-governor.js` | 🟡 Partial |

---

## Appendix B — What is already implemented (do not re-propose)

| Feature | Evidence |
|---------|----------|
| Adaptive rate governor | `src/core/adaptive-governor.js` |
| Account pool + rotation | `src/core/account-pool.js` |
| Browser stealth / anti-detection | `src/agents/antiDetection.js`, `src/scraping/stealthBrowser.js`, `docs/stealth-scraping.md` |
| Proxy pool + quarantine + dual-pool | `src/proxy/proxy-pool.js` |
| Polling stream manager | `src/streaming/streamManager.js`, `api/routes/streams.js` |
| Inbound webhook triggers | `src/scheduler/webhookTrigger.js` |
| Twitter media downloader | `src/scrapers/videoDownloader.js`, `src/scrapers/social/twitter/normalize-media.js` |
| Checkpoint / pause / resume | `src/cli/commands/checkpoints.js`, `src/core/base-store.js`, `src/scraping/paginationEngine.js` |
| Multi-platform read tools | `src/mcp/local-tools.js` `*_multiplatform` |
| JSON Schema validation (custom impl) | `src/core/metadata-schema-registry.js` — `validateSchemaNode` is a custom JSON Schema-like validator, not Zod. Can be reused or replaced by Zod/JSON-Schema. |
| Core types | `src/core/types.js` |
| Platform response validators | `src/scrapers/social/*/validator.js` |
| Session manager | `src/core/session-manager.js` |
| Status API | `src/core/status-api.js`, `api/routes/admin.js` |
| Dashboard account health | `dashboard/admin.html`, `dashboard/monitor.html` |
| Account health browser script | `src/accountHealthMonitor.js` — **browser-only IIFE**, not a Node.js module; cannot be reused by `SessionHealthOrchestrator` |
| Fallback selector pattern | `docs/dom-selectors.md`, `docs/case-studies/robust-dom-extraction.md` |

---

## Appendix C — Non-goal / scope boundary

- **Nowing** owns: CDP browser operator, CRM sync, Google Sheets/Lark integration, lead scoring, outbound. Do not re-propose.
- **ChainLens** owns: deep research, market intelligence, synthesis. Do not re-propose.
- **XActions** owns: scraping engine, anti-detection, session resilience, streaming, cross-platform action, media extraction, rate governance, operator dashboard.

---

## Appendix D — No-Duplication Guarantee

The proposed Epic 27–32 do **not** overlap with the following backlog items:

| Existing backlog | Scope | No overlap with Epic 27–32 because |
|------------------|-------|--------------------------------------|
| **Epic 20** (Nowing cutover & legacy decommission) | Decommission old code | Epic 27–32 add new infrastructure, not migration. |
| **Epic 21–22** (B2B, F&B, healthcare, legal crawlers) | New vertical scrapers | Epic 27–32 are infrastructure; new verticals would benefit but not duplicate. |
| **Epic 24** (Utility scripts migration) | Move scripts to adapters | Epic 27–32 are new components, not script migration. |
| **Epic 25** (Unified dispatcher) | API consolidation | Epic 30 adds cross-platform write; Epic 25 is read/dispatch only. |
| **Epic 26** (Final decommission) | Remove legacy | Epic 27–32 are new features; they depend on stable `AbstractCrawler` which Epic 26 completes. |
| **Epic 23** (Bluesky/Mastodon) | Platform integration | Epic 27–32 apply to all platforms, not just Bluesky/Mastodon. |
| **Epic 15, 16, 17, 18** (Threads, TikTok, Shopee, etc.) | Specific platforms | Epic 27–32 are cross-platform infrastructure. |
| **Epic 19** (Dashboard/CLI/observability) | Admin UI | Epic 32.1 adds a new budget UI, not a duplicate of existing admin dashboard. |
| **Epic 10–14** (Foundation, proxy, auth, hybrid, MCP) | Core architecture | Epic 27–32 build on top, not replace. |

---

## Appendix E — Dependency Order

Epic 27–32 should start **after** Epic 20 (Nowing cutover) and Epic 25 (unified dispatcher) are stable, because they assume:

- `AbstractCrawler` + `AbstractApiClient` are the only crawler contract.
- `AdaptiveRateGovernor` + `AccountPool` are stable.
- `src/scrapers/social/` is the canonical platform directory.
- `scrape()` dispatcher is the only entry point.

If Epic 27–32 are started before Epic 20/25, they will be built on top of legacy code and may need rework.

**Recommended sequence:**
1. Finish Epic 20, 24, 25, 26 (cleanup/consolidation).
2. Start Epic 27.1 + 27.2 (session resilience).
3. Start Epic 28.1 + 28.2 (drift detection).
4. Start Epic 29.1 + 29.2 (real-time streaming).
5. Start Epic 30.1 + 30.2 (cross-platform write).
6. Start Epic 31.1 (universal media).
7. Start Epic 32.1 + 32.2 (rate-budget UI + distributed token bucket).
