# Sprint Change Proposal — Multi-Consumer Scraping Platform Architecture

**Ngày:** 2026-09-15
**Trigger:** Nowing `XACTIONS-REQUIREMENTS-2026-09-13.md` — kiến trúc kết nối thay đổi từ custom adapter sang MCP `x_scrape` + Redis Stream (control plane + data plane)
**Người tạo:** Claude (Correct Course workflow)
**Reviewers:** Winston (Architecture), Dev Agent, QA Agent, UX/DX Agent, PM Agent
**Trạng thái:** Approved — incorporates all review amendments

---

## 1. Issue Summary

Epic 20 giả định Nowing sẽ gọi XActions MCP Daemon trực tiếp qua HTTP/SSE port 3001 thông qua custom `adapter.py`. Thực tế Nowing đã wire phía mình (`XActionsMcpClient` streamable-http + Celery beat + stream consumer) theo kiến trúc **service-to-service contract** mới:

- **Control plane:** MCP tool `x_scrape` (generic, gọi `scrape()` dispatcher)
- **Data plane:** Redis Stream `stream:social:raw_posts` (thin events, fan-out)
- **Discovery:** `x_actions_list` trả `ActionDescriptor` cho mọi platform

Vấn đề: **XActions thiếu 4 thứ** (REQ-X1..X4) — Nowing bị block, không phải chờ Nowing code.

### Evidence
- `x_scrape` không tồn tại trong `TOOLS` của `src/mcp/server.js`
- `x_actions_list` chỉ enumerate 18/24 platforms — thiếu fnb, healthcare, legal, vehicles/automotive, b2b-registry-extended, **tiktokShop**
- `AbstractCrawler` **không có `storeBatch()`** — stream-publish hook phải đặt sau `entry.handler()` trong `start()`, không phải sau storeBatch
- `formatPayload()` trong `redis-stream-publisher.js` **hardcode camelCase** — cần sửa sang snake_case
- `extractRecords()` trong `envelope.js` chỉ nhận `comments/posts/items/data` — không nhận `listings`, `products`, `jobs` → VN crawlers sẽ trả envelope sai
- Nowing `PLATFORM_TOOL_MAP` gọi `x_scrape` cho 9 loại VN target → tất cả fail `tool_not_found`

---

## 2. Impact Analysis

### Epic Impact

| Epic | Impact | Chi tiết |
|------|--------|----------|
| **Epic 20** | **Restructure** | Story 20.1 outdated (giả định chỉ sửa Nowing adapter). Cần rewrite thành XActions-side implementation + Nowing shadow-run |
| Epic 14 | Không đổi | Analytics engine đã done, stream events bổ sung data source cho nó |
| Epic 25 | Không đổi | `scrape()` dispatcher đã done — REQ-X1 chỉ expose nó qua MCP |
| Epic 29 | Liên quan | Webhook dispatcher (29.2) sẽ subscribe cùng Redis Stream — không conflict |

### Story Impact

| Story | Change | Detail |
|-------|--------|--------|
| 20.1 | **Rewrite** | Từ "update Nowing adapter.py" → "implement service contract trong XActions" |
| 20.2 | **Rewrite** | Từ "xóa legacy code" → thêm stream-publish hook + giữ decommission ở story sau |
| _(new)_ | **20.3 + 20.4** | External milestones — track ở Nowing repo, KHÔNG block Epic 20 |

### Artifact Conflicts

| Artifact | Update needed |
|----------|---------------|
| `epics.md` Epic 20 | Rewrite stories |
| `prd.md` FR-84 | Update mô tả — thêm multi-consumer contract |
| Architecture docs | Thêm AD cho MCP `x_scrape` + Redis Stream pattern |
| `sprint-status.yaml` | Update epic-20 stories |

### Technical Impact

| Area | Change | Severity |
|------|--------|----------|
| `src/mcp/server.js` | Thêm `x_scrape` tool definition + handler | Core |
| `src/scrapers/social/actions-list.js` | Mở rộng enumeration → toàn bộ 24 platform descriptors; bổ sung loaders cho 6 platforms thiếu | Core |
| `src/core/base-crawler.js` | Thêm universal stream-publish hook sau `entry.handler()` trong `start()` + `mapToThinEvent(item, context)` | Core |
| `src/utils/redis-stream-publisher.js` | **BẮT BUỘC SỬA** — `formatPayload()` đang hardcode camelCase; phải map snake_case + hỗ trợ `content_snippet`, `target_id`, `workspace_id`, `schema_version` | Core |
| `src/mcp/envelope.js` | **BẮT BUỘC SỬA** — `extractRecords()` thêm `listings`, `products`, `jobs` vào key list | Core |
| `src/scrapers/social/facebook/crawler.js` | Gỡ bỏ `#saveCheckpoint`/direct `xAdd` → delegate sang base hook (tránh double emission) | Core |
| `docs/canonical-action-matrix.md` + `.json` | Generated doc — auto-generated qua `npm run docs:matrix` | Docs |

---

## 3. Recommended Approach

**Direct Adjustment** — Modify stories within Epic 20. Không cần rollback.

**Rationale:**
- 80% infrastructure đã có sẵn (dispatcher, publisher, platform registry, crawlers)
- Không có completed work nào cần revert
- Kiến trúc mới strict-superset của cũ

**Effort estimate (revised từ Dev review):** 4-5 dev days (không phải 2-3)
**Risk:** Low-Medium — tất cả building blocks đã tested, nhưng có breaking change trên stream schema

---

## 4. Detailed Change Proposals

### Change 1: Rewrite Epic 20 — Stories (2 XActions stories + 2 external milestones)

**OLD Epic 20:**
```
20.1 — Nowing Shadow-Run Adapter (update adapter.py trong Nowing)
20.2 — Legacy Scraper Code Decommissioning (xóa code cũ cả 2 repos)
```

**NEW Epic 20 (XActions scope only — 20.3/20.4 là Nowing external milestones):**

```
20.1 — Multi-Consumer Service Contract (REQ-X1 + X3 + X4)
       Expose scrape() dispatcher thành service-to-service contract:

       x_scrape MCP tool:
         • Input: platform (required), action (required), args: object
           (nested, NOT flat), context: { targetId?, workspaceId?, ...open }
         • context is Record<string, unknown> — mở cho consumer khác
           (traceId, jobId, campaignId...)
         • accountId: string?, proxyUrl: string?, dryRun: boolean? (default false)
         • artifactFormat: 'jsonl'|'csv'?
         • Forward args → scrape(platform, action, args) qua descriptor.mapArgs
           (đảm bảo alias resolution như taxCode → q)
         • Response: UNIFIED ENVELOPE — cùng shape cả stream và non-stream:
           {
             success: true,
             mode: 'stream' | 'direct',
             metadata: { platform, action, durationMs, totalRecords },
             stream: { enabled: true, name: 'stream:social:raw_posts',
                       cursor: lastEventId },
             preview: [...first N items],
             data: [...]  // only when mode === 'direct'
           }
         • Khi REDIS_STREAM_ENABLED=true → mode='stream', preview ≤ 10 items
         • Khi REDIS_STREAM_ENABLED=false → mode='direct', data = full result
         • dryRun=true → KHÔNG emit stream (guard in base hook)
         • workspaceId validation: khi stream enabled, warn nếu
           context.workspaceId missing (Nowing consumer drop silent)
         • Error handling: "Did You Mean?" suggestion khi action sai
           (dùng DEPRECATED_ACTIONS + availableActions trong XACT_4001)
         • Pre-validate requiredArgs → trả XACT_4002 + missing[] + example

       x_actions_list mở rộng:
         • Enumerate toàn bộ 24 DESCRIPTORS registry
           (thêm fnb, healthcare, legal, automotive, b2b-registry-extended,
           tiktokShop)
         • Verify mỗi platform có Crawler class với listActions() —
           platform nào chưa có → flag "no_crawler" trong output,
           KHÔNG silent-skip
         • Lọc bỏ checkpointResolver khỏi ActionDescriptor trước khi trả
           (function reference, không serialize được)
         • Bổ sung optionalArgs/argTypes nếu có
         • Filter theo category + detailLevel: 'summary'|'full'

       Canonical action/arg matrix doc:
         • Auto-generated qua `npm run docs:matrix` từ x_actions_list
         • Output: docs/canonical-action-matrix.md (human) +
           docs/canonical-action-matrix.json (machine-readable cho
           Nowing CI validation)

       Envelope fix:
         • extractRecords() thêm 'listings', 'products', 'jobs' vào
           key list — fix VN crawler envelope (Chotot→listings,
           Shopee→products, TopCV→jobs)

       Files: src/mcp/server.js, src/scrapers/social/actions-list.js,
              src/mcp/envelope.js, docs/canonical-action-matrix.md,
              docs/canonical-action-matrix.json
       ~2 days

20.2 — Universal Stream-Publish Hook (REQ-X2)
       Thêm stream-publish vào AbstractCrawler SAU entry.handler() trong
       start() (KHÔNG phải sau storeBatch — AbstractCrawler không có
       storeBatch).

       Schema normalization (snake_case — normalized in BASE hook,
       NOT per-crawler):
         • Event schema: { id, platform, external_post_id, category,
           author_id, author_name, post_url, crawled_at, storage_ref,
           scraper_id, content_snippet, target_id, workspace_id,
           schema_version }
         • schema_version: 1 — bump khi breaking change
         • Facebook hiện emit camelCase — migrate sang snake_case
         • Dual-emit transition: giữ cả camelCase fields + snake_case
           fields trong 1 sprint để existing consumers không break
         • formatPayload() trong redis-stream-publisher.js phải sửa —
           hiện hardcode camelCase whitelist

       mapToThinEvent(item, context) — per-category field mapping:
         • PostItem → content_snippet = text (truncate ≤4000),
           author_id = authorId, post_url = url
         • ProductItem → content_snippet = title + description,
           author_id = shop_id, post_url = productUrl
         • CompanyItem → content_snippet = name + industry + address,
           author_id = taxCode, post_url = detailUrl
         • JobItem → content_snippet = title + company + location,
           author_id = companyId, post_url = jobUrl
         • ListingItem → content_snippet = title + price + area,
           author_id = sellerId, post_url = listingUrl
         • content_snippet BẮT BUỘC — Nowing drop nếu thiếu
         • target_id/workspace_id từ session.context — forward
           nguyên vẹn (workspace_id dùng ?? không ||, vì 0 là falsy)

       Context propagation:
         • AbstractCrawler.start() accept command.context
         • x_scrape truyền context vào CrawlerCommand
         • context.workspaceId → event.workspace_id (integer, NOT NULL)
         • context.targetId → event.target_id (string)
         • Thiếu workspace_id + REDIS_STREAM_ENABLED → WARN log
           [StreamPublisher:MissingWorkspaceId]

       Stream cursor:
         • Base hook lưu lastEventId → result.__streamCursor
         • x_scrape đọc __streamCursor → trả trong response.stream.cursor

       Decommission per-crawler emit:
         • Gỡ bỏ FacebookCrawler.#saveCheckpoint direct xAdd
         • Gỡ bỏ ThreadsCrawler, Medium, Reddit, YouTube, Zalo
           #emitCheckpointAndStream → delegate sang base hook

       Failure resilience:
         • Nếu Redis publish fail → log warn, KHÔNG crash crawler
         • Nếu stream enabled nhưng publish fail → x_scrape response
           include stream_delivery: 'failed' flag (không silent-drop)

       Gate: REDIS_STREAM_ENABLED, MAXLEN ~1M (khuyến nghị hạ xuống
       ~200K nếu content_snippet làm event tăng ~4KB mỗi cái).

       Files: src/core/base-crawler.js,
              src/utils/redis-stream-publisher.js,
              src/scrapers/social/facebook/crawler.js (remove direct emit),
              src/scrapers/social/*/crawler.js (remove #emitCheckpointAndStream)
       ~2 days
```

**External milestones (NOT tracked in XActions sprint-status):**

```
20.3 — [EXTERNAL — Nowing repo] Nowing Shadow-Run Validation
       Nowing chạy shadow-run dùng x_scrape + stream consumer.
       ≥99% field parity trong 7 ngày liên tiếp.
       Parity metric: (fields_matched / total_fields) trên matched records.
       Volatile fields (likesCount, viewsCount, publishedAt, crawledAt)
       excluded from parity check.
       Blocking: Story 20.4 decommission.

20.4 — [EXTERNAL — Nowing repo] Legacy Scraper Decommissioning
       Xóa legacy modules sau khi 20.3 đạt parity.
       Nowing repo: xóa 20+ scraper dirs, gỡ Chromium/Selenium khỏi Dockerfile.
       XActions repo: đã clean trong Epic 26.
```

### Change 2: Update PRD FR-84

**OLD:**
> FR-84: Nâng cấp adapter bên Nowing kết nối sang XActions MCP/Redis Stream và gỡ bỏ hoàn toàn 20+ scraper cũ cùng browser dependencies khỏi Nowing backend.

**NEW:**
> FR-84: Biến `scrape()` dispatcher thành service-to-service contract cho multi-consumer (Nowing, ChainLens, AI agents). Control plane qua MCP `x_scrape` tool, data plane qua Redis Stream `stream:social:raw_posts` (snake_case ThinEvent schema), discovery qua `x_actions_list`. Gỡ bỏ hoàn toàn 20+ scraper cũ cùng browser dependencies khỏi Nowing backend sau khi shadow-run đạt ≥99% field parity.

### Change 3: Architecture Decision Record

```
AD-NEW: Multi-Consumer Service Contract
- scrape() dispatcher exposed via MCP x_scrape tool (control plane)
- Thin events published to Redis Stream stream:social:raw_posts (data plane)
- Event schema: snake_case ThinEvent — normalized in AbstractCrawler
  via mapToThinEvent(item, context), NOT per-crawler
- Dual-emit camelCase + snake_case during transition period
- x_actions_list enumerates all 24 platform descriptors for consumer
  auto-discovery; ActionDescriptor excludes internal function refs
  (checkpointResolver)
- context envelope Record<string, unknown> forwarded to stream events
  (multi-tenant: targetId, workspaceId, traceId...)
- Unified response envelope: same shape for stream and non-stream modes
- When REDIS_STREAM_ENABLED=true, x_scrape returns preview + stream cursor;
  full data flows through stream only
- dryRun=true never emits to stream
- No new REST endpoints — MCP + Redis Stream only
```

---

## 5. Implementation Handoff

**Change scope:** Moderate — backlog reorganization + implementation

**Handoff to:** Developer agent

**Implementation order:**
1. **Story 20.1** (service contract) — x_scrape + x_actions_list + matrix doc + envelope fix
2. **Story 20.2** (stream hook) — **BẮT BUỘC release đồng thời với 20.1** (atomic release — nếu 20.1 release trước 20.2, `x_scrape` trả preview rỗng cho platforms chưa có stream hook)
3. **Story 20.3** (Nowing validation) — external milestone, Nowing repo
4. **Story 20.4** (decommission) — external milestone, Nowing repo

**Success criteria:**
- `x_scrape('masothue','search',{taxCode:...})` trả envelope thành công (taxCode→q alias resolution hoạt động)
- `x_scrape('chotot','search_listings',{...})` chạy được
- `scrape('shopee','search_products',...)` với `REDIS_STREAM_ENABLED` emit thin event đủ schema (snake_case, content_snippet populated)
- `x_actions_list` trả actions cho tất cả 24 platforms
- `x_scrape` với `REDIS_STREAM_ENABLED=true` trả `mode:'stream'` + preview ≤10 + stream cursor
- `x_scrape` với `dryRun=true` không emit stream events
- `x_scrape` trả `XACT_4002` + `missing[]` + `example` khi thiếu requiredArgs
- `x_scrape` trả "Did You Mean?" suggestion khi action không tồn tại
- Nowing `PLATFORM_TOOL_MAP` gọi `x_scrape` thành công cho 9 loại VN target

**Test cases required:**
| Test | File | Mục tiêu |
|------|------|----------|
| Contract discovery | `tests/mcp/actions-list-complete.test.js` | Assert 24 platforms, no silent-skip |
| x_scrape validation | `tests/mcp/x-scrape-tool.test.js` | InputSchema, context forward, preview/direct mode, dryRun no-emit |
| Stream normalization | `tests/core/thin-event-normalization.test.js` | mapToThinEvent cho PostItem/ProductItem/CompanyItem/JobItem/ListingItem, snake_case, content_snippet ≤4000 |
| Stream resilience | `tests/store/redis-stream-resilience.test.js` | Redis down → crawler completes, warn logged, no crash |
| Crawler integrity | `tests/scrapers/crawler-instantiation.test.js` | All 24 DESCRIPTORS → instantiate → listActions() non-empty |

---

## 6. Dependency Graph

```
20.1 (service contract) ──┐
                           ├──→ 20.3 [EXTERNAL: Nowing shadow-run] ──→ 20.4 [EXTERNAL: decommission]
20.2 (stream hook) ───────┘
       ↑
   BẮT BUỘC atomic release với 20.1
```

---

## 7. Review Amendments Applied

### Winston (Architecture)
| # | Amendment | Áp dụng |
|---|-----------|---------|
| 1 | Base hook normalize snake_case + `mapToThinEvent(item)` per-category | Story 20.2 |
| 2 | `x_scrape` response shape clarify: preview mode khi stream enabled | Story 20.1 |
| 3 | Verify tất cả 24 platforms có crawler class trước khi enumerate | Story 20.1 |

### Dev Agent
| # | Finding | Áp dụng |
|---|---------|---------|
| 1 | `AbstractCrawler` không có `storeBatch` — hook đặt sau `entry.handler()` trong `start()` | Story 20.2 |
| 2 | `redis-stream-publisher.js` `formatPayload()` hardcode camelCase — phải sửa | Story 20.2 |
| 3 | Facebook `#saveCheckpoint` sẽ double-emit nếu không gỡ bỏ | Story 20.2 |
| 4 | `envelope.js` `extractRecords` thiếu `listings/products/jobs` | Story 20.1 |
| 5 | Input contract cần hỗ trợ cả flat và nested args | Story 20.1 |
| 6 | `stream cursor` = lastEventId từ Redis xAdd, lưu vào `result.__streamCursor` | Story 20.2 |
| 7 | Thiếu `tiktokShop` trong actions-list (24 platforms total, không phải 23) | Story 20.1 |
| 8 | Thiếu test strategy | Success criteria + test matrix |
| 9 | MAXLEN ~1M quá lớn khi có content_snippet 4KB — khuyến nghị ~200K | Story 20.2 |
| 10 | Effort revise: 4-5 dev days | Section 3 |

### QA Agent
| # | Finding | Áp dụng |
|---|---------|---------|
| 1 | `storeBatch` không ở `AbstractCrawler` — hook vào `start()` hoặc `store-with-redis.js` | Story 20.2 |
| 2 | Data loss khi stream enabled + publish fail → cần `stream_delivery` flag | Story 20.2 |
| 3 | Schema breaking change → dual-emit transition | Story 20.2 |
| 4 | `dryRun` phải suppress stream emission | Story 20.1 + 20.2 |
| 5 | Non-social items thiếu `author_id`/`post_url` — cần per-category mapping | Story 20.2 mapToThinEvent |
| 6 | `b2b-registry-extended` không có `crawler.js` — loader cần dùng `index.js` | Story 20.1 |
| 7 | `workspace_id: 0` là falsy — dùng `??` không `\|\|` | Story 20.2 |
| 8 | Preview limit, stream cursor chưa định nghĩa | Story 20.1 (preview ≤10, cursor = lastEventId) |
| 9 | Shadow-run parity cần exclude volatile fields | Story 20.3 external |
| 10 | Crawler silent-skip → test assert đủ 24 platforms | Test matrix |

### UX/DX Agent
| # | Finding | Áp dụng |
|---|---------|---------|
| 1 | `workspaceId` missing → silent drop — cần WARN | Story 20.2 |
| 2 | `dryRun: true` default → đổi sang `false` | Story 20.1 |
| 3 | `ActionDescriptor` thiếu argTypes/optionalArgs | Story 20.1 |
| 4 | `checkpointResolver` rò rỉ ra public contract — lọc bỏ | Story 20.1 |
| 5 | Split-brain response → unified envelope | Story 20.1 |
| 6 | "Did You Mean?" cho action sai | Story 20.1 |
| 7 | `context` nên là `Record<string, unknown>` mở | Story 20.1 |
| 8 | Canonical matrix doc nên auto-generated (`.md` + `.json`) | Story 20.1 |

### PM Agent
| # | Finding | Áp dụng |
|---|---------|---------|
| 1 | Effort 2-3d → thực tế 4-5d (XActions only) + 7-14d (Nowing validation) | Section 3 |
| 2 | Story 20.3/20.4 là Nowing work → move ra external milestones | Section 4 |
| 3 | 20.1+20.2 phải atomic release | Section 5 |
| 4 | Ưu tiên P0 — Nowing bị block, vượt trước backlog epics | Confirmed |
| 5 | Control plane = multi-consumer; data plane = Nowing-optimized (single consumer for now) | AD-NEW |
| 6 | `dryRun: true` default → đổi `false` | Story 20.1 |
| 7 | Story 17.1 sprint-status desync — cần update | Separate fix |

---

*Generated by Correct Course workflow — XActions BMAD. Multi-agent review complete.*
