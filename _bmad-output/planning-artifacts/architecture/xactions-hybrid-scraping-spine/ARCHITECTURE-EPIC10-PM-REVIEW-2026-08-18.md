# Epic 10 PM Review — Product Readiness & Story Slicing

**Persona:** John / Product Manager  
**Scope:** `epics.md` Epic 10, `sprint-status.yaml`, `ARCHITECTURE-SPINE.md` AD-1 → AD-14, `ARCHITECTURE-EPIC10-REVIEW-2026-08-18.md`, and current `src/core/` stubs.  
**Date:** 2026-08-18  
**Verdict:** 🟢 **Epic 10 is product-ready to start, but 3 story ACs need tightening and the sprint tracker must reflect reality before we commit engineering capacity.**

---

## 1. Executive Summary

Epic 10 has a clear product thesis: *build a single, namespaced, queryable storage layer and the core contracts that every downstream platform crawler will use*. The recent split of Story 10.2 into 10.2/10.4/10.5 significantly improves deliverability. However, **sprint-status still shows every story as `backlog` even though 10.0 is functionally done and 10.1 stubs exist**, and a few acceptance criteria are either untestable or mix implementation with behavior.

---

## 2. Product Goal Assessment

| Criteria | Assessment |
|---|---|
| **Customer problem is clear** | ✅ Yes — Nowing/AI consumers need consistent crawl results and discoverable actions; operators need resume/pause observability. |
| **Epic goal is one sentence** | ✅ "Unified PostgreSQL storage + core interfaces for all future platform crawlers." |
| **Downstream value is explicit** | ✅ Epics 11–19 all depend on 10.x; the roadmap is downstream-driven. |
| **Out-of-scope is defined** | ⚠️ Partial — Instagram/Amazon/etc. are deferred in spine, but 10.5 Metadata Schema Registry could drift into "define every future schema" if not bounded. |

---

## 3. Story-by-Story PM Review

### Story 10.0 — Dev Blocker Prep & Core Scaffold
* **Status vs. reality mismatch:** Code already scaffolded and pushed (`src/core/`, `src/proxy/`, `src/store/`, Prisma schema, MCP daemon). `sprint-status.yaml` still says `backlog`.
* **AC quality:** Good — all acceptance criteria are pass/fail and tied to file existence / validation commands.
* **Recommendation:** Mark as `done` in `sprint-status.yaml`.

### Story 10.1 — Core Domain Interfaces & Error Hierarchy Definition
* **Status vs. reality mismatch:** Stubs pushed but not fully implemented. Should be `in-progress` or `ready-for-dev`, not `backlog`.
* **AC problem 1 — `errors.js` no longer exists:** AC line 81 mentions `src/core/errors.js` but only `error-envelope.js` is in the repo.
* **AC problem 2 — "Zero-Dependency" is misleading:** `AbstractCrawler` imports `action-registry.js`, `error-envelope.js`, and `types.js` (all internal), but the phrase "Zero-Dependency" can be read as "no npm dependencies". Clarify to "no external npm dependencies".
* **AC problem 3 — `signer-pool.js` and `qrcode.js` in 10.1:** These feel like stubs for Epics 11/12. If they are in 10.1, accept as "stubs only"; otherwise move to Epics 11/12.
* **Recommendation:**
  - Remove `errors.js` from AC.
  - Clarify "Zero-Dependency".
  - Mark 10.1 as `ready-for-dev` or `in-progress`.

### Story 10.2 — Prisma Post & Comment Schema with Namespaced ID, JSONB GIN & Batch Chunking
* **AC quality:** Much improved after the split. Now focused on schema + `PrismaStore`.
* **Untestable AC:** "cho phép Nowing query lọc giá/sđt/lương trong <10ms" is a performance claim, not a story-level AC. It belongs in NFR or a benchmark story.
* **Upsert vs. createMany language:** AC says "insert ... hỗ trợ upsert qua option" — good. But `PrismaStore` currently takes `opts.upsert`. Should the default be `createMany`? Yes, per AC. Good.
* **Recommendation:** Move the <10ms query claim to NFR or Story 10.2 acceptance as "GIN and expression indexes exist; benchmark to be measured in Story X".

### Story 10.3 — AI Dataset Export Utility
* **AC quality:** Strong. Filter, format, stream, sanitize, backpressure are all clear.
* **Open question:** Who decides the `keyword` filter? Is it full-text search on `content` or a metadata field? Need clarification before dev.
* **Recommendation:** Add a note: `keyword` filter uses `content` ILIKE unless a `metadata` schema field is specified.

### Story 10.4 — CrawlCheckpoint Operational API (new)
* **Product fit:** Good. Separates the operational surface from the storage layer.
* **Missing PM detail:** Who is authorized to pause/resume/retry? Admin only or any operator? This affects auth middleware.
* **Recommendation:** Add AC: "Only authenticated operators with `checkpoint:manage` scope can pause/resume/retry" (or similar, aligned with existing auth model).

### Story 10.5 — Metadata Schema Contract & Registry for Consumers
* **Product fit:** Important for Nowing integration.
* **Scope risk:** "mỗi platform/category có file schema" could mean 5 platforms × 5 categories = 25 files in one story. That is too much.
* **Recommendation:** Bound 10.5 to a **pilot schema** (e.g., `twitter/social.json`, `shopee/ecom.json`) plus the registry machinery. Other schemas are follow-up stories per platform.

---

## 4. Dependency & Sequencing Risk

```
10.0 (done) ──> 10.1 (interfaces) ──> 10.2 (schema/store) ──> 10.3 (exporter)
                                      │                       │
                                      ├──> 10.4 (checkpoint API)
                                      │
                                      └──> 10.5 (metadata registry)
```

* **10.1 is on the critical path for every other Epic.** Delaying 10.1 blocks 13–19.
* **10.2 is on the critical path for 10.3, 10.4, 10.5.** Do not start 10.3/10.4/10.5 until 10.2 is merged.
* **10.4 depends on auth model.** Clarify authorization before dev.
* **10.5 depends on 10.2 metadata column and 10.1 category validation.** Good sequencing.

---

## 5. Sprint-Status Accuracy

Current `sprint-status.yaml`:
* `10-0-...: backlog` — **should be `done`**.
* `10-1-...: backlog` — **should be `ready-for-dev` or `in-progress`**.
* `epic-10: backlog` — **should be `in-progress`** since work has started and 10.0 is done.

---

## 6. Open Questions for Stakeholders

1. **Metadata schema ownership:** Does XActions own all JSON schemas, or does Nowing contribute schemas for its own categories?
2. **Checkpoint authorization:** Who can pause/resume/retry checkpoints? Admin, operator, or the crawl job owner?
3. **30-day retention policy:** Is this a legal/compliance requirement or a cost optimization? If legal, do we need audit logging?
4. **Category taxonomy:** Is `b2b` a separate category, or a sub-classification of `recruitment`? The schema currently allows 5 distinct values.
5. **Query <10ms NFR:** Is this a contractual SLA to Nowing, or an internal target? If SLA, which specific queries must meet it?

---

## 7. Recommended Immediate Actions

1. **Update `sprint-status.yaml`**:
   - `epic-10`: `in-progress`
   - `10-0-dev-blocker-prep-core-scaffold`: `done`
   - `10-1-core-domain-interfaces-error-hierarchy-definition`: `ready-for-dev`
2. **Edit `epics.md` Story 10.1 AC**:
   - Remove `src/core/errors.js`.
   - Change "Zero-Dependency" to "no external npm dependencies".
3. **Edit `epics.md` Story 10.2 AC**:
   - Move "<10ms" query claim to NFR or a benchmark note.
4. **Edit `epics.md` Story 10.4 AC**:
   - Add authorization clause.
5. **Edit `epics.md` Story 10.5 AC**:
   - Bound to pilot schemas (e.g., `twitter/social`, `shopee/ecom`).

---

## 8. Release Readiness Summary

| Item | Ready? |
|---|---|
| Epic 10 goal | ✅ |
| Story slicing | ✅ after 10.2 split |
| AC clarity | ⚠️ needs 4 quick edits |
| Dependencies mapped | ✅ |
| Sprint tracker accuracy | ❌ needs update |
| Stakeholder open questions | ⚠️ 5 questions outstanding |

**Go/No-Go:** Go for Epic 10, provided the 4 AC edits and sprint-status update are done first.

---

*Review by John — product perspective on scope, story slicing, acceptance criteria, and roadmap sequencing.*
