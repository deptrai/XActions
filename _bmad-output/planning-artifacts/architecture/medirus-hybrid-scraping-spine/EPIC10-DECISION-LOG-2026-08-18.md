# Epic 10 Decision Log — Product/Architecture Resolutions

**Date:** 2026-08-18  
**Decider:** John / PM, with Amelia / Architect input  
**Basis:** `prd.md` data-retention section, `src/a2a/auth.js` permission model, `ARCHITECTURE-SPINE.md` AD-18, `ARCHITECTURE-SPINE.md` open questions, `epics.md` taxonomy.

---

## 1. Metadata Schema Ownership

**Question:** Does XActions own all JSON schemas, or does Nowing contribute schemas for its own categories?

**Decision:** **XActions owns and publishes all `metadata` JSON schemas.**

**Rationale:**
- `ARCHITECTURE-SPINE.md` AD-18 Rule 1 states: *"Mỗi platform/category phải publish JSON Schema cho `metadata` tại `schemas/<platform>/<category>.json`"* and binds `src/scrapers/**`, `src/store/**`, `src/mcp/**`, `src/api/**`.
- The platform scraper is the source of truth for the shape of raw data it produces.
- Nowing can **suggest** schema changes via the integration contract, but XActions is the publisher.

**Impact:** Story 10.5 scope remains XActions-side; Nowing consumes via `GET /schemas/:platform/:category`.

---

## 2. Checkpoint Authorization

**Question:** Who can pause/resume/retry checkpoints?

**Decision:** **Any authenticated identity with permission `checkpoint:manage` or the `admin` permission.**

**Rationale:**
- `src/a2a/auth.js` already has a string-based permission system: `checkPermission(auth, requiredPermission)` returns true if `auth.permissions.includes('admin')` or `auth.permissions.includes(requiredPermission)`.
- The existing `PERMISSIONS` array did not include a checkpoint scope. We added `'checkpoint:manage'` to `PERMISSIONS` and to the `standard` preset, so operators can manage checkpoints without being full `admin`.

**Impact:** Story 10.4 implementation uses `checkPermission(req.agent, 'checkpoint:manage')` and is aligned with existing A2A auth.

---

## 3. 30-Day Retention Policy

**Question:** Is this a legal/compliance requirement or a cost optimization?

**Decision:** **Cost optimization to keep the XActions raw-data DB under 5GB; not a legal/compliance requirement.**

**Rationale:**
- `prd.md` section 5 explicitly states: *"Lưu trữ tạm thời với Hot Cache TTL: 30 ngày"* and *"Tự động dọn dẹp sau 30 ngày (Giữ DB < 5GB)"*.
- Nowing is the permanent store for enriched leads, vector embeddings, and CRM data.

**Impact:** No audit logging required for raw-data cleanup. Retention can be adjusted based on storage cost. Cleanup job is a background operational concern, not a compliance audit trail.

---

## 4. Category Taxonomy: `b2b` vs `recruitment`

**Question:** Is `b2b` a separate category, or a sub-classification of `recruitment`?

**Decision:** **`b2b` is a separate category for B2B lead data** (e.g., LinkedIn company profiles, decision-maker posts). It is **not** a sub-class of `recruitment`.

**Rationale:**
- PRD groups "Tuyển Dụng & B2B Leads" under Epic 18, but the data shapes differ: job posts have `salary`, `skills`, etc.; B2B lead posts focus on company, decision-maker, industry.
- `ARCHITECTURE-SPINE.md` section 5 explicitly defers **public-procurement B2B** (`Mua Sắm Công, Mã Số Thuế`) out of Epics 10–18. The `b2b` category in the schema refers to **B2B lead scraping** (LinkedIn), not public procurement.
- We updated `src/core/types.js` and `prisma/schema.prisma` comments to clarify this distinction.

**Impact:** Epic 18 can produce both `recruitment` and `b2b` posts from LinkedIn; public-procurement B2B remains a future epic.

---

## 5. `<10ms` Query Performance

**Question:** Is this a contractual SLA to Nowing or an internal target?

**Decision:** **Internal performance target, not a contractual SLA.**

**Rationale:**
- The PRD NFRs (NFR-11 to NFR-16) do not list a `<10ms` query SLA.
- NFR-12 focuses on crawl throughput (>500 requests/sec), not consumer query latency.
- The `<10ms` claim was originally in Story 10.2 but has been moved to an NFR/benchmark note.

**Impact:** Story 10.2 only needs to ensure GIN and expression indexes exist; a separate benchmark story/NFR will measure `metadata->>'price'`/`phone`/`salary` query latency at scale.

---

## 6. `keyword` Filter in Dataset Export (Story 10.3)

**Question:** What does `keyword` filter mean — full-text search or metadata field?

**Decision:** **Default `keyword` filter is full-text `ILIKE` on `Post.content` and `Comment.content`.** Advanced metadata-field filtering is out of scope for Story 10.3.

**Rationale:**
- The simplest, most useful interpretation for an AI/DS export is text matching.
- Metadata schema validation belongs to Story 10.5; until then, filtering by arbitrary metadata keys is undefined.

**Impact:** `epics.md` Story 10.3 AC updated with this default behavior.

---

## 7. Intent Tagging (AD-SOC-5)

**Question:** Who assigns `intent_tag` (`sell`, `buy`, `hiring`, `seeking`) — XActions or Nowing?

**Decision:** **Nowing owns intent classification.**

**Rationale:**
- `ARCHITECTURE-SPINE.md` AD-SOC-5 is an inherited invariant and is still listed as an open question.
- XActions is a raw-data scraper; intent classification is an AI/NLP enrichment task better suited to Nowing.
- XActions sends Thin Event with `content` and `metadata`; Nowing computes `intent_tag` and stores it permanently.

**Impact:** No `Post.intentTag` field added to XActions schema. Nowing integration contract must document that intent tags are enriched downstream.

---

## 8. MCP over HTTP/SSE Auth

**Question:** What auth method between Nowing and XActions daemon — Bearer token, mTLS, or network isolation only?

**Decision:** **Bearer token via `Authorization: Bearer <token>` for MVP, using existing `src/a2a/auth.js` token validation.** mTLS is a future hardening item.

**Rationale:**
- `ARCHITECTURE-SPINE.md` AD-7 Rule 2 already mentions *"auth qua header `Authorization: Bearer <token>` hoặc mTLS"*.
- `src/a2a/auth.js` has JWT/Bearer token validation and API key support; no need to introduce mTLS for MVP.
- Network isolation can be added at infrastructure level.

**Impact:** Nowing client sends `Authorization: Bearer <xactions-token>` to `http://xactions:3001/mcp`. mTLS to be revisited before production hardening.

---

## 9. Action Items

| # | Action | Owner | Status |
|---|---|---|---|
| 1 | Add `'checkpoint:manage'` to `PERMISSIONS` and `standard` preset | Engineering | ✅ Done |
| 2 | Clarify `b2b` category in `types.js` and `schema.prisma` comments | Engineering | ✅ Done |
| 3 | Update Story 10.3 `keyword` filter AC | PM | ✅ Done |
| 4 | Move `<10ms` to NFR/benchmark story | PM | ✅ Done |
| 5 | Document Nowing owns `intent_tag` in integration contract | PM/Architect | 🔄 Pending |
| 6 | mTLS hardening ticket for MCP daemon | Architect | 🔄 Backlog |

---

*Decision log drives Epic 10 from product ambiguity to implementation-ready contracts.*
