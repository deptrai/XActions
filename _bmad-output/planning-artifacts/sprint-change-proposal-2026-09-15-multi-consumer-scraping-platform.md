# Sprint Change Proposal — Multi-Consumer Scraping Platform Architecture

**Ngày:** 2026-09-15
**Trigger:** Nowing `XACTIONS-REQUIREMENTS-2026-09-13.md` — kiến trúc kết nối thay đổi từ custom adapter sang MCP `x_scrape` + Redis Stream (control plane + data plane)
**Người tạo:** Claude (Correct Course workflow)
**Architecture review:** Winston — approved với 3 amendments
**Trạng thái:** Approved

---

## 1. Issue Summary

Epic 20 giả định Nowing sẽ gọi XActions MCP Daemon trực tiếp qua HTTP/SSE port 3001 thông qua custom `adapter.py`. Thực tế Nowing đã wire phía mình (`XActionsMcpClient` streamable-http + Celery beat + stream consumer) theo kiến trúc **service-to-service contract** mới:

- **Control plane:** MCP tool `x_scrape` (generic, gọi `scrape()` dispatcher)
- **Data plane:** Redis Stream `stream:social:raw_posts` (thin events, fan-out)
- **Discovery:** `x_actions_list` trả `ActionDescriptor` cho mọi platform

Vấn đề: **XActions thiếu 4 thứ** (REQ-X1..X4) — Nowing bị block, không phải chờ Nowing code.

### Evidence
- `x_scrape` không tồn tại trong `TOOLS` của `src/mcp/server.js`
- `x_actions_list` chỉ enumerate 18/23+ platforms — thiếu fnb, healthcare, legal, vehicles/automotive, b2b-registry-extended
- `base-crawler.js` không có stream-publish hook — chỉ `facebook/crawler.js` xAdd vào `stream:social:raw_posts`, tất cả 15+ non-social/VN crawler emit 0 event
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
| _(new)_ | **20.3 + 20.4** | Shadow-run validation + decommission |

### Artifact Conflicts

| Artifact | Update needed |
|----------|---------------|
| `epics.md` Epic 20 | Rewrite stories |
| `prd.md` FR-84 | Update mô tả — thêm multi-consumer contract |
| Architecture docs | Thêm AD cho MCP `x_scrape` + Redis Stream pattern |

### Technical Impact

| Area | Change |
|------|--------|
| `src/mcp/server.js` | Thêm `x_scrape` tool definition + handler |
| `src/scrapers/social/actions-list.js` | Mở rộng enumeration sang toàn bộ `DESCRIPTORS` registry |
| `src/core/base-crawler.js` | Thêm stream-publish hook sau `storeBatch` + `mapToThinEvent(item)` |
| `src/utils/redis-stream-publisher.js` | Có sẵn — không cần thay đổi |
| 15+ non-social crawlers | Tự động emit khi base hook được thêm — zero per-crawler code |
| `docs/canonical-action-matrix.md` | Generated doc mới |

---

## 3. Recommended Approach

**Direct Adjustment** — Modify stories within Epic 20. Không cần rollback. Kiến trúc mới strict-superset của cũ: `scrape()` dispatcher, `RedisStreamPublisher`, `x_actions_list` đều đã tồn tại — chỉ cần wire chúng lại.

**Rationale:**
- 80% infrastructure đã có sẵn (dispatcher, publisher, platform registry, crawlers)
- Không có completed work nào cần revert
- Effort nhỏ hơn nhiều so với viết custom adapter từ đầu

**Effort estimate:** 2-3 dev days
**Risk:** Low — tất cả building blocks đã tested (Epic 25 dispatcher, Epic 14.3 Redis Stream, Epic 35 crawlers)

---

## 4. Detailed Change Proposals

### Change 1: Rewrite Epic 20 — Stories (4 stories)

**OLD Epic 20:**
```
20.1 — Nowing Shadow-Run Adapter (update adapter.py trong Nowing)
20.2 — Legacy Scraper Code Decommissioning (xóa code cũ cả 2 repos)
```

**NEW Epic 20:**

```
20.1 — Multi-Consumer Service Contract (REQ-X1 + X3 + X4)
       Expose scrape() dispatcher thành service-to-service contract:
         • x_scrape MCP tool — generic scrape(platform, action, args) với
           context envelope { targetId?, workspaceId? }, accountId/proxyUrl,
           dryRun, artifactFormat
         • Response shape: khi REDIS_STREAM_ENABLED=true → trả execution
           metadata + data preview (first N items) + stream cursor;
           khi disabled → trả full result như hiện tại
         • x_actions_list mở rộng — enumerate toàn bộ DESCRIPTORS registry
           (thêm fnb, healthcare, legal, automotive, b2b-registry-extended)
         • Verify tất cả 23+ platforms có Crawler class với listActions()
           trước khi enumerate — platform nào chưa có crawler thì flag
           trong doc chứ không silent-skip
         • Canonical action/arg matrix doc — derive từ x_actions_list,
           nguồn truth cho mọi consumer
       Files: src/mcp/server.js, src/scrapers/social/actions-list.js,
              docs/canonical-action-matrix.md
       ~1.5 days

20.2 — Universal Stream-Publish Hook (REQ-X2)
       Thêm stream-publish vào AbstractCrawler sau storeBatch.
       
       Schema normalization (Amendment 1):
         • Base hook chịu trách nhiệm normalize sang snake_case ThinEvent —
           KHÔNG để per-crawler tự emit schema riêng
         • Facebook hiện emit camelCase (externalId, authorId, crawledAt) —
           phải migrate sang snake_case cho nhất quán
         • Event schema: { id, platform, external_post_id, category,
           author_id, author_name, post_url, crawled_at, storage_ref,
           scraper_id, content_snippet, target_id, workspace_id,
           schema_version }
       
       Field mapping (Amendment 2):
         • Base hook định nghĩa mapToThinEvent(item) — mỗi crawler override
           nếu item type khác PostItem
         • PostItem → content_snippet = text (truncate ≤4000)
         • ProductItem → content_snippet = title + description
         • CompanyItem → content_snippet = name + address/industry
         • JobItem → content_snippet = title + company + location
         • content_snippet BẮT BUỘC — Nowing consumer drop nếu thiếu
       
       Gate: REDIS_STREAM_ENABLED, MAXLEN ~1M.
       15+ crawlers tự động emit — zero per-crawler code.
       Files: src/core/base-crawler.js, src/utils/redis-stream-publisher.js
       ~1 day

20.3 — Nowing Shadow-Run Validation
       Nowing chạy shadow-run dùng x_scrape + stream consumer.
       ≥99% field parity trong 7 ngày liên tiếp.
       Nơi: Nowing repo (validation, không phải XActions code)

20.4 — Legacy Scraper Decommissioning
       Xóa legacy modules sau khi 20.3 đạt parity.
       (Giữ nguyên từ cũ 20.2)
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
- Event schema: snake_case ThinEvent — normalized in AbstractCrawler base
  hook via mapToThinEvent(item), NOT per-crawler
- x_actions_list enumerates all platforms for consumer auto-discovery
- context envelope { targetId, workspaceId } forwarded to stream events
  (multi-tenant)
- No new REST endpoints — MCP + Redis Stream only
- When REDIS_STREAM_ENABLED=true, x_scrape returns execution metadata +
  data preview; full data flows through stream only
```

---

## 5. Implementation Handoff

**Change scope:** Moderate — backlog reorganization + implementation

**Handoff to:** Developer agent

**Implementation order:**
1. **Story 20.1** (service contract) — x_scrape + x_actions_list + matrix doc
2. **Story 20.2** (stream hook) — có thể song song với 20.1
3. **Story 20.3** (Nowing validation) — external, cần 20.1 + 20.2
4. **Story 20.4** (decommission) — sau 20.3

**Success criteria:**
- `x_scrape('masothue','search',{taxCode:...})` trả envelope thành công
- `x_scrape('chotot','search_listings',{...})` chạy được
- `scrape('shopee','search_products',...)` với `REDIS_STREAM_ENABLED` emit thin event đủ schema (snake_case, content_snippet populated)
- `x_actions_list` trả actions cho tất cả 23+ platforms
- Nowing `PLATFORM_TOOL_MAP` gọi `x_scrape` thành công cho 9 loại VN target
- `x_scrape` với `REDIS_STREAM_ENABLED=true` trả preview + stream cursor, không trả full dataset

---

## 6. Dependency Graph

```
20.1 (service contract) ──┐
                           ├──→ 20.3 (Nowing shadow-run) ──→ 20.4 (decommission)
20.2 (stream hook) ───────┘
```

20.1 và 20.2 có thể làm song song. 20.3 cần cả hai. 20.4 cuối cùng.

---

## 7. Architecture Review Notes (Winston)

| # | Amendment | Áp dụng vào |
|---|-----------|-------------|
| 1 | Base hook normalize schema sang snake_case + `mapToThinEvent(item)` per-category | Story 20.2 |
| 2 | `x_scrape` response shape clarify: preview mode khi stream enabled | Story 20.1 |
| 3 | Verify tất cả 23+ platforms có crawler class trước khi enumerate | Story 20.1 |

**Trade-off noted:** `x_scrape` trả preview khi stream enabled tạo 2 response shapes (stream vs non-stream). Chấp nhận được vì consumer phải opt-in qua env var — không breaking change cho existing callers.

---

*Generated by Correct Course workflow — XActions BMAD. Architecture review by Winston.*
