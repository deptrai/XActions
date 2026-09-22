---
title: 'Story 42.5 — jev-osint-bio-matcher: Semantic Bio Matching for EntityResolver'
type: 'feature'
created: '2026-09-22'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'c755decb79f8ecfd94958336a7ac1adfad54f5b3'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `EntityResolver` chỉ match bằng tín hiệu cứng (username exact, Jaro-Winkler tên, avatar pHash, cross-link literal). Hai profile cùng một người ở 2 platform khác nhau nhưng viết bio khác câu chữ — "Building AI tools @ XActions" vs "Founder, dev tools. Prev: Cognition" — không có signal nào chạm ngưỡng merge (≥40), cluster tách thành 2 identity khác nhau.

**Approach:** Thêm Jev semantic second-opinion cho bio pairs: async pre-pass `prefetchBioScores()` trước `resolveIdentities` (cùng seam `prefetchAvatarHashes` của Story 41.3 — `scorePair` sync không gọi được Jev), qua `JevBioMatcher` mới: `decide({bio1,bio2}, {samePerson: Score(0-3)})`. Cặp đạt `score ≥ 2 && confidence ≥ 0.85` được `scorePair` cộng **+35 signal `bio_semantic`**. Strict Option D (AD-45): mọi tính toán in-memory per-request, không persist bio/cluster.

**Decisions (delegated):**
- **Pre-pass seam thay vì literal "trong `scorePair()`"** — `scorePair`/`resolveIdentities` sync trong O(n²) loop (thiết kế cố ý Story 41.3: async pre-pass → `Map`). Cơ chế đổi, AC outcome giữ nguyên.
- **Candidate gating trước khi gọi Jev:** chỉ cặp (a) khác `platform`, (b) cả hai có `bio` trim ≥ 20 ký tự, (c) `username_exact` miss, (d) cheap-signal score hiện có < `MERGE_THRESHOLD` (đã merge bằng tín hiệu miễn phí → không tốn Jev call). Ước lượng cheap score bằng chính `scorePair()` hiện tại.
- **Cap spend:** tối đa `JEV_OSINT_BIO_MAX_PAIRS` cặp/run (default 30) — sắp xếp candidate theo **cheap `scorePair` score giảm dần** (đã tính sẵn ở bước gating; cặp 30-39 — thiếu 1 signal — là Jev-candidate giá trị nhất; `jaroWinkler` module-private nên không dùng trực tiếp). Deterministic: tie-break theo `pairKey` alphabet.
- **Env:** kill-switch `JEV_OSINT_BIO_MATCH` (default ON; `0|false|off|no` tắt — polarity giống `JEV_CHALLENGE_DIAG`), `JEV_THRESHOLD_SAMEPERSON` (default 0.85, clamp [0,1]), `JEV_OSINT_BIO_MAX_PAIRS` (default 30, int; ≤0 → disabled).
- **Score legend 0–3:** 0=khác người rõ rệt, 1=không đủ evidence, 2=có khả năng cùng người, 3=rất chắc cùng người.

## Boundaries & Constraints

**Always:**
- Mọi Jev call đi qua `JevBrain.decide()` — không fetch `api.typesafe.ai` trực tiếp.
- `meta.degraded` → không signal, không +35. `confidence < threshold` hoặc `score < 2` → không +35.
- Option D (AD-45): không persist bio/pair-score/cluster vào DB/file — `Map` sống trong scope request, GC theo response.
- Signal name `bio_semantic`, bonus **+35** (cộng vào `MAX_SCORE=100` cap sẵn có).
- Pre-pass never-throws (mirror `prefetchAvatarHashes`: `Promise.allSettled`, per-call JevBrain timeout 5s).
- Env flags resolve lazy per-call (`.env` post-import hoạt động); thresholds clamp [0,1].
- Backward-compatible: `scorePair`/`resolveIdentities` param mới optional — caller cũ không đổi behavior.

**Never:**
- Không đổi `scorePair` thành async, không đưa Jev vào O(n²) loop.
- Không Jev-call khi cặp đã đủ merge bằng tín hiệu miễn phí, same-platform, bio thiếu/ngắn, hoặc `username_exact` hit.
- Không gửi gì ngoài 2 bio text (không envelope, không metadata.raw — đã học từ 42.4 E1).
- Không dependency mới, không đổi error taxonomy, không sửa signals hiện có.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_MERGE | 2 profiles khác platform, bio khác câu chữ cùng entity, Jev score=3 conf=0.9 | `bioScoreMap` có pair → `scorePair` +35 `bio_semantic`; nếu tổng ≥40 → union | N/A |
| BELOW_SCORE | Jev score=1 conf=0.9 | Không entry trong map, không signal | N/A |
| BELOW_CONF | Jev score=3 conf=0.7 (< 0.85) | Không entry, không signal | N/A |
| DEGRADED | Jev trả `meta.degraded=true` | Pair skip, log 1 line | N/A — never throw |
| JEV_ERROR | brain.decide rejects | `allSettled` nuốt, pair vắng trong map | log, tiếp tục |
| SAME_PLATFORM | a.platform === b.platform | Không candidate, 0 Jev calls | N/A |
| NO_BIO | một/both bio thiếu hoặc <20 chars | Không candidate | N/A |
| ALREADY_MERGED | cheap scorePair ≥ 40 (vd name_similar+avatar_match) | Không candidate — tiết kiệm call | N/A |
| CAP_HIT | 45 candidates, MAX_PAIRS=30 | 30 cặp JW-cao nhất được chấm; phần dư skip + log | N/A |
| KILL_SWITCH | `JEV_OSINT_BIO_MATCH=0` | `prefetchBioScores` → Map rỗng, 0 calls, flow y hệt trước story | N/A |
| NO_API_KEY | thiếu `TYPESAFE_API_KEY` | brain degraded → Map rỗng, resolver chạy bình thường | N/A |
| MISSING_ID | profile thiếu `id` | `pairKey` fallback `${platform}:${username\|\|name\|\|profileUrl}` | N/A |
| LEGACY_CALLER | `scorePair(a,b)` / `resolveIdentities(p,q)` không map | Behavior giữ nguyên — không `bio_semantic` | N/A |

</frozen-after-approval>

## Code Map

- `src/osint/jev-bio-matcher.js` — **NEW**. Mirror `src/core/jev-challenge-diagnoser.js` pattern: lazy `JevBrain` (`_injectedBrain` cho tests), `isJevOsintBioMatchEnabled()` default-ON, `resolveSamePersonThreshold()` clamp [0,1], `resolveMaxPairs()`. Export `prefetchBioScores(profiles, {avatarHashMap, brain, phashEnabled, phashThreshold})` → `Map<pairKey, {score,confidence}>` chỉ chứa cặp qualify. `phashEnabled`/`phashThreshold` optional — default resolve qua `isAvatarPHashEnabled()`/`getAvatarPHashThreshold()` từ `src/osint/phash.js` (:177/:187), giống default-param của `scorePair` (:165). Candidate filter (gọi `scorePair` cho cheap score — reuse export) + rank-by-cheap-score-desc + cap + `p-limit(8)` dynamic-import + `allSettled` (pattern `prefetchAvatarHashes` :343-373 — `p-limit` đã là dep, dynamic import :358). Question `SAME_PERSON_QUESTION`: `type:'score'`, instructions so khớp 2 bio (career/employer/interests/self-identifiers — không dựa tên/username vì signal đó có riêng), legend 0-3.
- `src/mcp/entity-resolver.js` — **EDIT**: (1) export `bioPairKey(a, b)` — `${idA}||${idB}` sorted, fallback khi thiếu `id`; (2) `scorePair(a,b,avatarHashMap,phashEnabled,phashThreshold,bioScoreMap)` — param optional cuối; map-hit → `score += 35; signals.push('bio_semantic')` trước cap :210; (3) `resolveIdentities(profiles,query,avatarHashMap,bioScoreMap)` — pass-through :274.
- `src/mcp/osint-find-profiles.js` — **EDIT** :654-655: sequential — `const avatarHashMap = await prefetchAvatarHashes(...)` (giữ nguyên) → `const bioScoreMap = await prefetchBioScores(profiles, {avatarHashMap, brain})` → `resolveIdentities(profiles, query, avatarHashMap, bioScoreMap)`. Sequential bắt buộc (xem Design Notes — candidate gating cần avatarHashMap).
- `src/agents/jevBrain.js` — **EDIT nhỏ**: `confidenceThresholds` defaults (:71-81) thêm `samePerson: 0.85`.
- `api/routes/ai/jev.js` — **EDIT nhỏ**: conditional-spread `JEV_THRESHOLD_SAMEPERSON` (pattern G5 của 42.4 — không poison undefined).
- `.env.example` — **EDIT**: section JEV (:224-239) thêm 3 vars mới.
- `vitest.config.js` — **EDIT**: test env (:42) thêm `JEV_OSINT_BIO_MATCH: '0'` — chặn paid-call ngẫu nhiên như `JEV_CHALLENGE_DIAG`.
- `tests/osint/jev-bio-matcher.test.js` — **NEW**: inject fake brain; cover mọi matrix row.
- `tests/mcp/entity-resolver.test.js` — **EDIT**: `bio_semantic` +35 qua injected map (pure, không Jev); `bioPairKey` fallback; legacy-caller regression.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `42-5` → done.

## Tasks & Acceptance

**Execution:**
- [x] `src/osint/jev-bio-matcher.js` — module mới: env resolvers + `prefetchBioScores` (candidate gating → rank-by-cheap-score-desc → cap → parallel decide → qualify map).
- [x] `src/mcp/entity-resolver.js` — `bioPairKey` + `bio_semantic` signal trong `scorePair` + param `resolveIdentities`.
- [x] `src/mcp/osint-find-profiles.js` — wire pre-pass vào caller chain.
- [x] `src/agents/jevBrain.js` + `api/routes/ai/jev.js` + `.env.example` + `vitest.config.js` — threshold default, env passthrough, docs, test-env guard.
- [x] `tests/osint/jev-bio-matcher.test.js` + `tests/mcp/entity-resolver.test.js` — vitest no-network, cover matrix.
- [x] `sprint-status.yaml` — tracking.

**Acceptance Criteria:**
- Given 2 profile khác platform có bio cùng entity mà username/avatar/crosslink miss, khi Jev `samePerson ≥2` conf ≥0.85, thì cluster merge (score ≥40 nhờ +35) thay vì tách đôi.
- Given Jev degraded / below-threshold / score<2 / kill-switch off / thiếu API key, thì `identityClusters` giống hệt pre-story output, không Jev call nào lọt (kill-switch) hoặc không side-effect.
- Given 45 candidate pairs và cap 30, thì đúng 30 cặp cheap-score cao nhất được Jev chấm — đếm fake-brain call count = 30.
- Given same-platform pair hoặc cặp đã merge bằng cheap signals, thì không Jev call cho pair đó.
- Given `npx vitest run tests/osint/ tests/mcp/entity-resolver.test.js`, thì pass — kể cả dưới `JEV_OSINT_BIO_MATCH=0`.

## Implementation Notes

- **Session 1 (implementation subagent):** module `src/osint/jev-bio-matcher.js` (~210 lines) + `bioPairKey`/`bio_semantic` trong `entity-resolver.js` + wiring sequential `prefetchAvatarHashes → prefetchBioScores → resolveIdentities` trong `osint-find-profiles.js` + threshold `samePerson: 0.85` trong `jevBrain.js` + env passthrough `jev.js` + `.env.example` + `vitest.config` kill-switch + 2 test files. 50/50 targeted, 394/394 regression.
- **Session 1 (review):** 3 layers → ~29 findings → triage **15 patch-groups, 0 intent-gap, 0 loopback** (log bên dưới). Tất cả patch đã apply trong session này; thêm fix test-isolation phát hiện khi chạy verify.
- **Post-patch fixes bổ sung (verify-time):**
  - `tests/api/jev-lead-icp.test.js`: `vi.resetModules()` trong `beforeEach` — `_brain` singleton trong `jev.js` bị poison khi test `degraded` (xóa `TYPESAFE_API_KEY`) chạy trước do `sequence.shuffle`; mỗi test giờ có router + brain riêng. Đây là isolation bug có sẵn, test `/status` mới chỉ đổi seed lộ ra.
  - Wiring test `osint-find-profiles.test.js`: `vi.mock` toàn module `jev-bio-matcher` → canned `Map` → assert `bio_semantic` trong `matchedSignals` của merged cluster + assert `+35` đơn độc không merge (35 < 40).
  - `tests/osint/jev-bio-matcher.test.js`: thêm deterministic bio-order assert (`bio1 <= bio2`), dropped-pair assert trong cap test (`pa_p1..p3` bị drop), `_sharedBrain` no-key path test (production call không truyền brain).
- **Verify cuối:** 88/88 targeted (4 files) · 396/396 `tests/mcp/ + tests/osint/` dưới `JEV_OSINT_BIO_MATCH=0` · smoke `function` · `grep api.typesafe.ai src/osint/` → 0 hits.

## Spec Change Log

## Review Triage Log

3 layers (blind B1-15, edge E1-12, verification-gap V1-2 + 2 other) — dedupe thành root-cause groups; tất cả **patch** (không intent_gap, không loopback):

| # | Findings | Verdict | Root-cause fix |
|---|----------|---------|----------------|
| P1 | B1, E5 | medium | `prefetchBioScores` nhận `timeoutMs` (deadline bail giữa các batch); caller truyền `callerTimeout ?? undefined` như prefetchAvatarHashes |
| P2 | B2 | medium | Xóa block mutate `confidenceThresholds.samePerson` (:230-238) — qualify dùng local `threshold`, `decide()`/`gate()` không đọc — dead code mutate shared singleton |
| P3 | B3 | medium | Dedupe candidates theo `pairKey` trước rank/cap — duplicate `id` profiles không burn 2 paid calls + cap slots |
| P4 | B4 | low | Xóa username_exact gate hand-rolled — `cheap >= MERGE_THRESHOLD` đã cover (+40 ≥ 40); tránh drift khỏi `norm()` |
| P5 | B7, E7 | medium | `resolveMaxPairs`: `Number()` thay `parseInt` ('1e2'→100, '0.5'→0.5→floor 0 là ý đồ rõ) + clamp trần (≤500) — fat-finger env không mở flood paid calls |
| P6 | B8, E6 | medium | `_sharedBrain` rebuild khi `apiKey` rỗng mà env `TYPESAFE_API_KEY` đã có — post-import key không bị freeze-degrade cả process |
| P7 | E1, E2, V-other-1 | high | Never-throws boundary: try/catch `import('p-limit')`; guard `avatarHashMap?.get` function-check; try/catch quanh gating-loop `scorePair` (getter có thể throw) |
| P8 | E3, V-other-2 | medium | Degenerate `pairKey` (`platform:` rỗng identity): `profilePairId` trả `''` khi thiếu mọi định danh → prefetch skip, `scorePair` check truthy key trước `has()` — +35 không leak cross-pair |
| P9 | E4 | low | Platform compare normalize `trim().toLowerCase()` — 'GitHub'/'github' không lọt candidate gate |
| P10 | B10, E8 | low | `phashEnabled` override parse đúng string 'false'/'0' — consistent với kill-switch polarity |
| P11 | B9 | low | Per-pair degraded/skip logs → 1 summary line (đếm); pairKey chứa `platform:username` không spam 30 dòng PII vào log |
| P12 | B12 | medium | Truncate bio ≤500 chars trước khi gửi decide — bio multi-KB không inflate token (mirror 42.4 snippet bound) |
| P13 | E9, V2 | medium | Route `JEV_THRESHOLD_SAMEPERSON` clamp [0,1] trong spread — env '1.5' không poison gate |
| P14 | B14, V1 | high | Tests: wiring test `osint-find-profiles.test.js` (vi.mock jev-bio-matcher → canned Map → assert `bio_semantic` trong `identityClusters`); `/status` assert `samePerson===0.85`; assert bio1/bio2 sorted-order; cap test assert pair bị drop đúng |
| P15 | B15 | low | Spec Verification `...` placeholder → path thật `src/osint/jev-bio-matcher.js` |

**Rejected:** B5 (shape `Map<pairKey,{score,conf}>` là spec-mandated — giữ values cho observability) · B6 (scorePair trust input contract — map chỉ do prefetch nội bộ tạo) · B11 (phash-override divergence — không caller nào override thật; resolveIdentities tự derive env consistent) · B13 (double O(n²) cheap compute — CPU-trivial, intentional; ghi Design Notes) · E10 (env flip mid-request — unreachable) · B15a (sprint-status done sớm — tracking-only, workflow sync cuối).

## Design Notes

- **Vì sao pre-pass, không phải literal "trong scorePair()":** `scorePair` sync trong O(n²) loop — Story 41.3 đã chốt seam: async prefetch → `Map` → `scorePair` tra map (`avatarHashMap` pattern). `bioScoreMap` đi đúng rãnh đó; AC outcome (Jev quyết định +35) không đổi.
- **Chicken-egg avatarHashMap:** candidate gating cần cheap score = `scorePair()` có avatar → cần `avatarHashMap` trước. Wiring: `prefetchAvatarHashes` chạy xong → truyền map vào `prefetchBioScores` (sequential, KHÔNG Promise.all) — bio prefetch còn phải gọi scorePair để loại already-merged. Latency: avatar ~≤3s + bio ≤30 calls/8-concurrency ≈ +4-20s trên request đã multi-second.
- **Tại sao +35 không phải +40:** mirror epic AC đúng số; +35 + `name_similar`(+30) = 65 đủ merge khi Jev chắc; +35 đơn độc < 40 → không tự merge một mình (cần ≥1 signal phụ) — tránh cluster lởm từ bio "chung vib".
- **pairKey:** `${idA}||${idB}` sort-joined — `id` = `${platform}:${externalId}` unique-per-profile từ normalize; fallback khi id vắng. Deterministic → pre-pass và scorePair đồng nhất key mà không cần index.
- **PII transit:** bio text gửi TypeSafe API = computation, không phải persistence — AD-45 chỉ cấm persist. Cùng đường 42.4 (snippet → Jev). Không gửi `metadata.raw`.

## Verification

**Commands:**
- `npx vitest run tests/osint/jev-bio-matcher.test.js tests/mcp/entity-resolver.test.js` — expected: all pass, cover matrix rows.
- `JEV_OSINT_BIO_MATCH=0 npx vitest run tests/mcp/ tests/osint/` — expected: all pass, no regression.
- `node -e "import('./src/osint/jev-bio-matcher.js').then(m => console.log(typeof m.prefetchBioScores))"` — expected: `function`, no throw without `TYPESAFE_API_KEY`.

**Manual checks:**
- `grep -rn 'api.typesafe.ai' src/osint/` → 0 hits (gateway qua JevBrain only).
- `git diff src/mcp/entity-resolver.js` → `scorePair`/`resolveIdentities` signatures additive-optional; no existing call sites broken.
