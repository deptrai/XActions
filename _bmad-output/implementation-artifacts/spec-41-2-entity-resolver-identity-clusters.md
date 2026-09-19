---
title: 'Story 41.2 — EntityResolver + identityClusters[]'
type: 'feature'
created: '2026-09-19'
baseline_revision: '688b7256'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** `x_social_find_profiles` trả về danh sách phẳng `profiles[]` — caller không biết profile nào trên platform nào thuộc cùng một người thật. Fan-out đa platform (Epic 36 + 41.1) cần gộp kết quả thành identity clusters có confidence.

**Approach:** Thêm module `EntityResolver` (pure JS, không port Python) implement Jaro-Winkler similarity + confidence scoring, gộp `profiles[]` thành `identityClusters[]`. Mở rộng output `executeSocialFindProfiles` thêm `identityClusters[]` cạnh `profiles[]` (backward compatible). In-memory per-request only — không persist PII.

## Boundaries & Constraints

**Always:**
- Pure JS module `src/mcp/entity-resolver.js` (hoặc `src/osint/entity-resolver.js`) — no Node-only deps ngoài stdlib, no network, no I/O.
- Jaro-Winkler similarity implement đúng chuẩn (Jaro + Winkler prefix boost, scaling factor 0.1, max prefix 4).
- Scoring signals (per epic): exact username match +40, display-name JW-similarity >0.85 +30, avatar URL match +30, cross-link in bio +20. Confidence = clamp(score/100, 0, 1).
- Clustering: union-find / greedy merge — 2 profiles merge vào cùng cluster khi pairwise score >= threshold (đề xuất >=40, tức có ít nhất exact-username match hoặc tổ hợp đủ điểm). Single-member clusters allowed.
- Output mỗi cluster: `{ clusterId, confidence, profiles: ProfileItem[], matchedSignals: string[], primaryProfile }`.
- `identityClusters[]` thêm vào return của `executeSocialFindProfiles` — `profiles[]` giữ nguyên (backward compat). Không đổi `platformStatus`.
- `metadata.raw` của mỗi profile trong cluster vẫn sanitize-safe (đã qua normalizeToProfileItems).
- ESM, `// by nichxbt` credit, real implementations only, no mocks.
- Tests: unit tests <1.5s, no network.

**Never:**
- Không persist PersonEntity/PII vào Prisma (Option D — in-memory per-request).
- Không port code Python từ Mr.Holmes — chỉ port thuật toán Jaro-Winkler.
- Không làm dorking/breach-check/BFS/mindmap (ngoài scope Epic 41).
- Không thay đổi shape `profiles[]` hay `platformStatus[]` (backward compat).
- Không gọi network trong EntityResolver (pure function).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Same username across platforms | github+twitter cùng `nichxbt` | 1 cluster, confidence>=0.4 (exact username +40) | none |
| Distinct people | `nichxbt` vs `totally_diff` | 2 clusters riêng | none |
| Empty profiles[] | [] | identityClusters=[] | none |
| Single profile | 1 item | 1 cluster, confidence = base (self-match) | none |
| Name sim >0.85 no username | `Nich` vs `Nicholas` diff username | merge nếu tổng>=threshold | none |
| Avatar URL match | cùng avatar_url | +30 signal | none |
| Cross-link bio | bio chứa link tới profile kia | +20 | none |
| Missing username+name | profile chỉ có externalId | singleton cluster | không crash |

</intent-contract>

## Code Map

- `src/mcp/osint-find-profiles.js` — `executeSocialFindProfiles` return object (line ~648): thêm `identityClusters` field. `profiles` array đã normalize sẵn → feed vào resolver.
- `src/core/types.js` — `ProfileItem` typedef (username/name/avatar/profileUrl/externalId/metadata).
- NEW `src/mcp/entity-resolver.js` — `resolveIdentities(profiles, query)` → `identityClusters[]`; export `jaroWinkler(a,b)` + `clusterProfiles(profiles)` + `scorePair(a,b)`.
- `tests/mcp/osint-github-gravatar.test.js` — reference test style (real objects, no mocks).
- NEW `tests/mcp/entity-resolver.test.js` — unit tests.

## Tasks & Acceptance

**Execution:**
- `src/mcp/entity-resolver.js` — implement `jaroWinkler(s1,s2)` (Jaro similarity + Winkler prefix boost 0.1, prefix<=4); `scorePair(a,b)` → `{score, signals[]}` theo 4 signals; `resolveIdentities(profiles, query)` → union-find merge, return `identityClusters[]` với confidence=clamp(score/100,0,1), clusterId stable (`cluster-<i>` hoặc hash của member ids), `primaryProfile` = member có followersCount cao nhất hoặc nhiều field nhất.
- `src/mcp/osint-find-profiles.js` — import `resolveIdentities`; sau khi build `profiles`, gọi `resolveIdentities(profiles, query)` và thêm `identityClusters` vào return object. Giữ `profiles` nguyên.
- `tests/mcp/entity-resolver.test.js` — unit tests: jaroWinkler known vectors (MARTHA/MARHTA≈0.961, DIXON/DICKSONX≈0.813), exact-username clustering, distinct→separate, empty/single, confidence clamp 0-1, cross-link bio signal, integration: executeSocialFindProfiles output có identityClusters cùng profiles.

**Acceptance Criteria:**
- Given 2 profiles cùng username khác platform, when resolveIdentities, then 1 cluster confidence>=0.4 và matchedSignals chứa 'username_exact'.
- Given profiles[] trong output, when tool returns, then `identityClusters` là array cùng `profiles`, mỗi cluster có clusterId+confidence+profiles+matchedSignals.
- Given empty profiles, then identityClusters=[] và không throw.
- Given `name` JW-sim>0.85 nhưng username khác hẳn, then merge chỉ khi tổng score>=threshold.
- Given backward compat, then `profiles[]` và `platformStatus[]` không đổi shape.

## Spec Change Log

## Review Triage Log

### 2026-09-19 — Review pass (self-review, no subagents per user directive)
- verdicts: 4 findings — high 0, medium 0, low 2, false 1, maybe-false 1
- findings:
  - `[false]` `[reject]` singleton confidence=0.5 "arbitrary" — spec defines singleton base 0.5 (self-evidence); deterministic, documented, test-locked.
  - `[low]` `[reject]` `query` param unused in resolveIdentities — reserved for future query-anchored scoring; documented param, harmless.
  - `[maybe-false]` `[defer]` transitive-merge edge (A-B merge, B-C merge → A,C in same cluster despite A-C below threshold) — inherent to union-find clustering; if it ever over-merges the fix would be complete-linkage, but that needs a real over-merge report to justify.
  - `[low]` `[reject]` O(n²) pairwise scoring — profile sets are small (<=~30 platforms); acceptable for per-request in-memory use.

## Auto Run Result

**Summary:** Implemented Story 41.2 — `EntityResolver` (pure-JS Jaro-Winkler + additive confidence scoring + union-find clustering) producing `identityClusters[]` added to `executeSocialFindProfiles` output alongside unchanged `profiles[]` (backward compatible). In-memory per-request; no PII persistence.

**Files changed:**
- `src/mcp/entity-resolver.js` — NEW: `jaroWinkler`, `scorePair` (4 signals), `resolveIdentities` (union-find), `MERGE_THRESHOLD=40`.
- `src/mcp/osint-find-profiles.js` — import + call `resolveIdentities(profiles, query)`, add `identityClusters` to return.
- `tests/mcp/entity-resolver.test.js` — NEW: 15 tests (JW vectors, signals, clustering, integration).

**Review findings:** 0 patched, 1 deferred (transitive-merge note), 3 rejected (1 false, 2 low). No high/medium.

**Verification:**
- `vitest run tests/mcp/entity-resolver.test.js` → 15/15 pass (incl. live integration: github+platx same-username clustered).
- `vitest run osint-find-profiles + osint-github-gravatar` → 48/48 pass, no regression.
- Live E2E `nichxbt` on github+reddit+medium+mastodon+bluesky: github ok→1 profile→`cluster-0` singleton conf 0.5; `identityClusters` present in real output.

**Residual risks:** Jaro-Winkler verified against standard vectors; cross-platform merge quality depends on upstream metadata richness (only verified live on github singleton — multi-platform same-person merge verified via injected descriptors, not a live 2-platform hit).

## Design Notes

Jaro-Winkler: Jaro(s1,s2) = (m/|s1| + m/|s2| + (m-t)/m)/3 với m=matching chars (window max(|s1|,|s2|)/2-1), t=transpositions/2. Winkler = jaro + l*p*(1-jaro), l=common prefix len (max 4), p=0.1.

scorePair signals (cộng dồn, cap 100):
- username_exact: lowercase(a.username)===lowercase(b.username) && non-empty → +40
- name_similar: jaroWinkler(normName(a),normName(b))>0.85 → +30
- avatar_match: a.avatar===b.avatar && non-empty → +30
- crosslink_bio: a.bio chứa b.username/profileUrl-host, hoặc metadata.verifiedAccounts link tới b.platform → +20

Merge threshold: score>=40 (ít nhất exact username, hoặc name_sim+avatar, hoặc name_sim+crosslink... ). Union-find trên indices. Confidence của cluster = max pairwise score /100, clamp [0,1]; singleton = 0.5 base (self-evidence) trừ khi không có identifying info → thấp hơn.

## Verification

**Commands:**
- `npx vitest run tests/mcp/entity-resolver.test.js` — expected: all pass <1.5s
- `npx vitest run tests/mcp/osint-find-profiles.test.js tests/mcp/osint-github-gravatar.test.js` — expected: no regression
