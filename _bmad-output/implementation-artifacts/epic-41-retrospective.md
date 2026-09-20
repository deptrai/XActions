# Epic 41 Retrospective — OSINT Enhancement: Developer Registries & Entity Resolution (Rescoped)

**Date:** 2026-09-19  
**Epic Status:** Done  
**Stories Delivered:**
- `41-1-github-gravatar-adapters`: Done
- `41-2-entity-resolver-identity-clusters`: Done  

---

## Phase 1 — Gather

### Evidence Inventory
- **Git Commits:**
  - `5ed66d2f` — docs(planning): Add Epic 41 — OSINT Enhancement (Registries + Entity Resolution)
  - `9bc77044` — test(e2e): Add live OSINT verification for deptraidapxichlo query
  - `688b7256` — feat(osint): Add GitHub + Gravatar identity adapters (Epic 41, Story 41.1)
  - `86a778f8` — feat(osint): Add EntityResolver for identityClusters[] (Epic 41, Story 41.2)
  - `0e44ecf4` — docs(architecture): Update architecture.md to v4.1.0 (Epic 41 sync)
- **Code Artifacts:**
  - `src/scrapers/identity/github/` (`client.js`, `crawler.js`, `descriptor.js`, `index.js`) — 425 lines
  - `src/scrapers/identity/gravatar/` (`client.js`, `crawler.js`, `descriptor.js`, `index.js`) — 370 lines
  - `src/mcp/entity-resolver.js` — 307 lines
  - `src/mcp/osint-find-profiles.js` — 665 lines (wired identityClusters & action map)
  - `src/scrapers/index.js` — updated with github & gravatar descriptors
- **Tests & Verification:**
  - `tests/mcp/osint-github-gravatar.test.js` — 18 tests passing
  - `tests/mcp/entity-resolver.test.js` — 15 tests passing
  - `tests/mcp/osint-find-profiles.test.js` — 30 tests passing (zero regression)
  - Total automated suite: 63/63 passing.
- **E2E & Live Pilots:**
  - Live query `sindresorhus` multi-platform merge (GitHub + Mastodon clustered with 0.9 confidence).
  - Live query `deptraidapxichlo` verification (LinkedIn match + graceful 404 on GitHub).
- **Architecture & Planning:**
  - `docs/architecture.md` updated to v4.1.0 (AD-45 added, Invariant #2 refined).
  - Spec documents `spec-41-1-github-gravatar-adapters.md` and `spec-41-2-entity-resolver-identity-clusters.md` marked done.

---

## Phase 2 — Analyze

### Aggregate Views & Architecture Delta
- **Platform Expansion:** Platform descriptors grew from 24 to 26 with the addition of zero-auth Tier-0 registries (`github` and `gravatar`).
- **Rescoped Boundary Enforcement (vs Mr.Holmes):**
  - Strictly ported only the pure-JS Jaro-Winkler algorithm, leaving investigation orchestration (Google/Yandex Dorking, breach data, recursive profiling) in Mr.Holmes domain.
- **Refinement of Invariant #2 (Option D Identity Cleanliness):**
  - Clarified that in-memory clustering on demand (`identityClusters[]`) is fully compliant with Option D, provided no PII or `PersonEntity` records are written to disk or Prisma database tables.

### Diff-Scope & Edge Case Review
1. **HTTP 404 Graceful Degradation:**
   - In `AbstractApiClient`, non-2xx/3xx responses default to throwing `PlatformError`. Both `GitHubClient` and `GravatarClient` catch `404` errors and safely resolve to `null`, ensuring unregistered handles do not trigger circuit breakers.
2. **Rate Limit Gating:**
   - `GitHubClient` consumes from `globalDistributedTokenBucket` (`osint:github`) with 60 req/h (unauth) and 5000 req/h (with `GITHUB_TOKEN`).
3. **Additive Output Envelope:**
   - The returned JSON payload adds `identityClusters` without altering `profiles[]` or `platformStatus[]`, protecting backward compatibility for downstream MCP callers.

### Behavior Check & Verification Summary
- **Live Upstream Validation:**
  - Live API fetch for `matt@mullenweg.com` on Gravatar succeeded (retrieving avatar URL and username `matt230816`).
  - Live API fetch for `sindresorhus` clustered GitHub and Mastodon profiles with confidence `0.9` and matched signals `[username_exact, name_similar, crosslink_bio]`.

---

## Phase 4 — Decide

### Acceptance Verdict

**Criteria from Epic 41 & Specs:**
- ✅ GitHub adapter (zero-auth public API, username queryType) — **PASS**
- ✅ Gravatar adapter (zero-auth SHA-256 email lookup, email queryType) — **PASS**
- ✅ Rate limiting via `DistributedTokenBucket` (60 req/h unauth, 5000 req/h with token) — **PASS**
- ✅ Pure JS `EntityResolver` implementing Jaro-Winkler + weighted confidence scoring — **PASS**
- ✅ Multi-signal matching (username, name similarity > 0.85, avatar match, bio cross-links) — **PASS**
- ✅ Additive output contract (`identityClusters[]` alongside `profiles[]`) — **PASS**
- ✅ Option D in-memory PII boundary preserved (zero DB persistence) — **PASS**
- ✅ 100% test pass rate with zero regression across 63 tests — **PASS**

**Verdict:** **accepted**

---

## Phase 5 — Finalize

### Action Items
1. **Optional Avatar pHash Upgrade (Future):**
   - For Epic 42+, evaluate client-side perceptual hashing (`pHash`) for avatar comparison if avatar URLs change across CDNs (owner: dev, status: open).

### Sprint Status Update
- Epic 41 marked as completed in planning and documentation.

---

## Post-Retrospective Addendum (2026-09-19)

Action Item #1 (Avatar pHash Upgrade) được promote thành story trong chính epic này thay vì Epic 42 riêng:
- **Story 41.3** — Avatar Perceptual Hashing (`src/osint/phash.js` + `EntityResolver` async avatar signal), `ready-for-dev`, resolves Action Item #1.

Epic 41 status flipped `done → in-progress` until 41.3 completes.
