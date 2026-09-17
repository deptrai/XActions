---
name: 'Unified Person OSINT — Hybrid Architecture (XActions + ChainLens + Nowing)'
type: architecture-proposal
status: draft-v2
created: '2026-09-16'
author: 'Winston (System Architect)'
audience: 'XActions + ChainLens + Nowing dev teams'
source_project: 'Mr.Holmes — Person OSINT (Epics 8-9, v2.1)'
supersedes: 'PROPOSAL-person-reconnaissance-osint-v1-xactions-only.md'
decision: 'Option D — Hybrid layered architecture'
---

# Proposal: Unified Person OSINT — Hybrid Architecture

## 1. Executive Summary

Sau khi phân tích kiến trúc cả 3 repo, kết luận thay đổi so với v1: **không nên đặt toàn bộ Person OSINT vào XActions** vì:

- **XActions** = scraping microservice thuần (I/O intensive, anti-bot, proxy). Nhồi Entity Resolution + Golden Record storage + LLM synthesis vào XActions vi phạm Single Responsibility.
- **ChainLens-Research** = deep-research engine có sẵn multi-step pipeline + citations, stateless. Đúng chỗ để làm narrative synthesis + web recon.
- **Nowing** = end-user product với PostgreSQL CRM, đã có sẵn `verified_contacts` + `enrichment_requests` + `social_posts` + multi-tenancy workspace + PII HMAC. Đúng chỗ để lưu Golden Record + orchestrate + UI.

→ **Chọn Option D — Hybrid layered architecture**, mỗi service giữ đúng vai trò cốt lõi.

### Bản đồ trách nhiệm

```
[Nowing Web UI / Client]
         │
         ▼
[Nowing Backend (Python FastAPI + Celery)]
  ├── Quản lý Workspace / Tenancy / PII Audit
  ├── Lưu trữ Golden Record → verified_contacts + leads
  ├── Entity Resolution: Jaro-Winkler (jellyfish) + pHash (imagehash)
  │        │                               │
  │        │ (1) MCP Call: Raw Profiles    │ (2) REST/SSE: Web Recon + Synthesis
  ▼        ▼                               ▼
[XActions Engine]                  [ChainLens-Research]
  ├── Multi-platform Crawling        ├── Deep Web Recon (news, blogs, Google)
  ├── Proxy & Anti-bot Bypass        ├── Fact Extraction & Source Citations
  └── Raw Social Data Extraction     └── Narrative Profile Synthesis (LLM)
```

---

## 2. Phân chia trách nhiệm rõ ràng

| Tầng | Service | Trách nhiệm | Không làm |
|---|---|---|---|
| **Data Harvesting** | XActions | Crawl profiles từ các platform, trả raw `ProfileItem[]` | Không merge, không synthesis, không lưu golden record |
| **Semantic Synthesis** | ChainLens | Web recon (news/blogs), entity extraction từ text, LLM narrative + citations | Không cào social, không lưu entity dài hạn |
| **Orchestration + Persistence** | Nowing | Celery orchestration, Jaro-Winkler + pHash merge, write `verified_contacts`, UI | Không crawl trực tiếp, không LLM synthesis |

---

## 3. Component Design per Layer

### 3.1. XActions — chỉ thêm MCP tool `x_social_find_profiles`

```javascript
// src/mcp/tools/findProfiles.js

{
  name: 'x_social_find_profiles',
  description:
    'Find social media profiles matching a person identifier (username, email, ' +
    'phone, name). Returns raw ProfileItem[] from each platform — NO merging, ' +
    'NO entity resolution. Caller is responsible for deduplication.',
  inputSchema: {
    type: 'object',
    properties: {
      query:     { type: 'string', description: 'Username, email, phone, or name' },
      platforms: {
        type: 'array',
        items: { type: 'string' },
        description: 'Platform whitelist. Default: auto-routed.',
      },
    },
    required: ['query'],
  },
}

// Implementation: thin wrapper over dispatchScrape + Promise.allSettled
// Returns: { profiles: ProfileItem[], failures: [{platform, reason}] }
// Each ProfileItem keeps its platform-native shape — no normalization to a
// shared "person" schema. Nowing will merge.
```

**Rationale:** XActions chỉ làm điều nó làm tốt nhất — fan-out scrapers + trả raw data. Không thêm bảng `PersonEntity`/`IdentifiedProfile`/`InvestigationReport` vào Prisma (giữ schema gọn). Không cần Jaro-Winkler + pHash — Nowing sẽ làm.

### 3.2. ChainLens-Research — extend search pipeline với `category: 'person'`

```typescript
// apps/api/src/search/researcher/actions/personSearch.ts (NEW)

export async function personSearch(
  query: PersonSearchQuery,
  ctx: ResearchContext,
): Promise<PersonResearchResult> {
  // 1. Fan-out song song:
  //    - XActionsClient.findProfiles(query) — social profiles
  //    - Web providers (Tavily, Bing, SearxNG) — news, blogs, documents
  const [socialResults, webResults] = await Promise.all([
    ctx.providers.xactions.findProfiles(query),
    ctx.providers.web.search(query, { category: 'people' }),
  ]);

  // 2. ChainLens extract facts với citations từ web results
  const extractedFacts = await ctx.factExtractor.run(webResults);

  // 3. LLM Writer tổng hợp tiểu sử có citations
  const narrative = await ctx.writer.synthesize({
    subject: query.seed,
    facts: extractedFacts,
    socialProfiles: socialResults.profiles,
  });

  return {
    socialProfiles: socialResults.profiles,   // raw — Nowing sẽ merge
    narrative,                                 // markdown với citations
    facts: extractedFacts,
    sources: extractedFacts.flatMap(f => f.citations),
  };
}
```

**Route:** `POST /api/v1/search` với `{ query, category: 'person' }` — ChainLens classifier đã có pattern này.

### 3.3. Nowing — Entity Resolution + Golden Record + UI

```python
# nowing_backend/app/services/osint/person_investigator.py

from jellyfish import jaro_winkler_similarity
from imagehash import phash
from PIL import Image
import asyncio, httpx

class PersonInvestigator:
    """Orchestrates XActions + ChainLens, runs entity resolution, persists."""

    async def investigate(self, seed: str, workspace_id: str) -> PersonEntity:
        # 1. Parallel calls
        async with asyncio.TaskGroup() as tg:
            social_task = tg.create_task(
                self.xactions_client.call_tool('x_social_find_profiles', {'query': seed})
            )
            research_task = tg.create_task(
                self.chainlens_client.search(
                    query=seed,
                    category='person',
                    mode='balanced',
                )
            )

        profiles = (await social_task).get('profiles', [])
        research = await research_task

        # 2. Entity resolution (Nowing Python — best fit for imagehash/jellyfish)
        golden = await self._resolve(profiles)

        # 3. Persist
        entity = await self._persist(golden, research, workspace_id)

        # 4. Return for UI
        return entity

    async def _resolve(self, profiles: list[ProfileItem]) -> GoldenRecord:
        """Jaro-Winkler + pHash merge — runs in Celery worker, not API thread."""
        # Group by Jaro-Winkler ≥ 0.85 on display name
        clusters = cluster_by_name(profiles, threshold=0.85)
        # Within each cluster, boost confidence if avatar pHash matches
        for cluster in clusters:
            phashes = await fetch_and_phash([p.avatar_url for p in cluster])
            cluster.merged = merge_cluster(cluster, phashes)
        return pick_best_cluster(clusters)
```

**Data model (already exists in Nowing):**
- `verified_contacts` — dedup by `value_hmac` (HMAC of normalized email/phone)
- `enrichment_requests` — tracks each investigation run
- `social_posts` — links posts back to entity
- `leads` — final CRM record

**New code needed:**
- `nowing_backend/app/services/osint/person_investigator.py`
- `nowing_backend/app/tasks/person_osint.py` (Celery task)
- `POST /api/v1/workspaces/{workspace_id}/osint/investigate-person` endpoint
- `apps/web` UI page showing entity tree + confidence + sources

---

## 4. So sánh 4 Phương án (summary từ agent analysis)

| Tiêu chí | A: XActions-only | B: ChainLens-only | C: Nowing-only | **D: Hybrid** ✅ |
|---|---|---|---|---|
| Scraping | XActions | XActions | XActions | XActions |
| Entity Resolution | XActions (Node.js) | ChainLens (NestJS) | Nowing (Python) | **Nowing (Python)** |
| LLM Synthesis | ❌ | ChainLens ✅ | Nowing DIY | **ChainLens** ✅ |
| Golden Record storage | XActions DB | ChainLens (stateless) | Nowing `verified_contacts` | **Nowing** |
| UI | — | ChainLens Web | Nowing Web | **Nowing Web** |
| SoC violation | **Cao** — biến scraper thành identity processor | Trung bình | Trung bình | **Tối ưu** |
| Maintenance | Cao | Trung bình | Cao | **Thấp** (mỗi service làm đúng việc) |

**Rejected options:**
- **A** — XActions không nên chứa identity domain + PII storage + merge logic
- **B** — ChainLens stateless, không quản lý CRM/lifecycle của person entity
- **C** — Nowing tự làm LLM synthesis lãng phí pipeline sẵn có của ChainLens

---

## 5. Data Flow (Hybrid)

```
User/Agent → Nowing API
    │ POST /workspaces/{id}/osint/investigate-person {seed: "nguyen_van_a"}
    ▼
Nowing Celery task (async)
    ├─► XActions MCP: x_social_find_profiles(query)
    │     ├─► twitter.profile, facebook.profile, instagram.user,
    │     │   threads.profile, bluesky.profile, mastodon.profile,
    │     │   reddit.user, linkedin.lead_profile, tiktok.search,
    │     │   chotot.search_listings, masothue.search, ...
    │     └─► Returns ProfileItem[] (raw, unmerged)
    │
    └─► ChainLens REST: POST /api/v1/search {category: 'person'}
          ├─► Web providers (news, blogs, Google)
          ├─► XActions provider (social profiles — same data)
          └─► LLM synthesizer → narrative + citations
    ▼
Nowing Entity Resolution (Python, Celery worker):
    ├─► jellyfish.jaro_winkler_similarity on names (≥0.85)
    ├─► imagehash.phash on avatars (Hamming ≤ 10)
    ├─► cluster + merge → GoldenRecord
    ▼
Nowing PostgreSQL:
    ├─► verified_contacts (dedup by value_hmac)
    ├─► enrichment_requests (audit trail)
    ├─► social_posts (link posts → entity)
    └─► leads (final CRM record)
    ▼
Nowing Web UI: entity profile page + confidence + sources + narrative
```

---

## 6. XActions-side Changes (minimal)

Chỉ cần **1 MCP tool mới**, không cần schema changes:

```javascript
// src/mcp/tools/findProfiles.js — register in TOOLS array

{
  name: 'x_social_find_profiles',
  description: '...',
  inputSchema: { /* ... */ },
}

// In server.js dispatch:
case 'x_social_find_profiles': {
  const results = await Promise.allSettled(
    (args.platforms ?? DEFAULT_PROFILE_PLATFORMS).map(p =>
      dispatchScrape(p, pickAction(p, args), { query: args.query })
    )
  );
  return wrapToolResult('x_social_find_profiles', {
    profiles: results.filter(r => r.status === 'fulfilled').map(r => r.value),
    failures: results.map((r, i) =>
      r.status === 'rejected' ? { platform: args.platforms[i], reason: r.reason.message } : null
    ).filter(Boolean),
  });
}
```

**Không cần:**
- ❌ `PersonEntity` / `IdentifiedProfile` / `InvestigationReport` models trong Prisma
- ❌ EntityResolver, DorkGenerator, ProfileEntity classes
- ❌ pHash / Jaro-Winkler trong Node.js
- ❌ Investigation persistence layer

→ XActions effort giảm từ **10-12 dev-days** xuống **1-2 dev-days** (chỉ add MCP tool + platform routing).

---

## 7. ChainLens-side Changes

- Thêm `category: 'person'` vào query classifier
- Thêm `personSearch.ts` action — orchestrate `xactions.findProfiles` + web search
- LLM synthesis prompt template cho person profile
- Không cần schema changes — output là Chunk[] như hiện tại

**Effort:** ~2-3 dev-days.

---

## 8. Nowing-side Changes

- `person_investigator.py` service
- Celery task `investigate_person_task`
- `jellyfish` + `imagehash` integration (đã có sẵn trong Python ecosystem)
- REST endpoint + Web UI page
- Reuse `verified_contacts` + `enrichment_requests` tables (đã tồn tại)

**Effort:** ~4-5 dev-days.

---

## 9. Total Effort Estimate

| Layer | Scope | Effort |
|---|---|---|
| XActions | 1 MCP tool + routing | 1-2 days |
| ChainLens | `person` category + action + prompt | 2-3 days |
| Nowing | Service + Celery + ER + endpoint + UI | 4-5 days |
| **Total** | | **7-10 dev-days** |

So với Option A (XActions-only): **giảm ~30% effort** vì không cần re-implement Python algorithms (jellyfish, imagehash) trong Node.js, không cần thêm 3 Prisma tables, không cần mới entity resolution trong JS.

---

## 10. Decision Rationale

**Why Hybrid wins:**

1. **SoC preserved** — mỗi service giữ đúng vai trò: XActions scrape, ChainLens synthesize, Nowing persist + UI
2. **Best tool for each job** — Python (Nowing) cho entity resolution + image processing mạnh hơn Node.js; ChainLens LLM pipeline sẵn có cho synthesis; XActions scrapers cho raw data
3. **Data locality** — Golden Record sống ở `verified_contacts` trong Nowing, nơi nó được dùng (CRM, lead gen)
4. **No PII leak** — XActions/ChainLens không cần biết "person" là ai; chúng chỉ trả raw profiles hoặc synthesized narrative
5. **Reusability** — `x_social_find_profiles` là generic tool, bất kỳ consumer nào (không chỉ Nowing) cũng dùng được

---

## 11. Implementation Order

1. **Phase 1 (XActions):** `x_social_find_profiles` MCP tool — returns raw `ProfileItem[]`
2. **Phase 2 (Nowing):** `person_investigator.py` + Celery task + `verified_contacts` write
3. **Phase 3 (ChainLens):** `person` category + `personSearch` action + LLM synthesis
4. **Phase 4 (Nowing UI):** investigation detail page

Mỗi phase độc lập — có thể ship Phase 1 + 2 trước để có MVP (XActions returns profiles, Nowing merges vào `verified_contacts`), sau đó thêm ChainLens synthesis.

---

## 12. References

- **Superseded v1 (XActions-only):** `PROPOSAL-person-reconnaissance-osint-v1-xactions-only.md`
- **XActions scraping spine:** `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md`
- **Mr.Holmes engine (Python):** `Core/engine/entity_resolver.py`, `Core/engine/autonomous_agent.py`
- **Nowing schema:** `nowing_backend/app/models/leads/enrichment.py` (`verified_contacts`)
- **ChainLens XActions client:** `apps/api/src/search/providers/xactions/xactions.client.ts`
