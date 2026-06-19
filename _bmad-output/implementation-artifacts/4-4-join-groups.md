---
baseline_commit: dfe17ad902d871423d6951d09f1b9834e2c7b3da
---

# Story 4.4: Join Facebook groups (dry-run default)

Status: done

<!-- Code-review patches applied (5 fixed + 1 defer). Held at in-progress — NOT done — pending live-DOM verification of join/pending selectors (see Review Findings → Deferred + selectors-facebook.md verify-checklist). -->

<!-- Epic 4 (Facebook Growth Automation, Cluster 1 — medium risk). Source: epics.md#Story 4.4 + PRD prd-XActions-2026-06-10-epic4 FR-18. FIRST Cluster-1 write story. -->

## Story

As a multi-group operator using XActions,
I want to join Facebook groups automatically by URL or keyword search,
so that I can expand my group reach with safety controls.

## Context — what this story builds

Story 4.4 adds `joinFacebookGroups(page, input, options)` to `api/services/facebookAutomation.js`. It is a **Cluster-1 batch write** → it MUST route through `runGuardedBatch` (NFR-7) and MUST surface the non-suppressible account-risk warning (NFR-8). Two input modes:
- **URL mode**: `{ groupUrls: string[] }` — join each given group.
- **Keyword mode**: `{ keyword, limit }` — search groups by keyword, then join up to `limit` results.

**THE central task — extend `runGuardedBatch` with a configurable delay range (resolves PRD Open Question #1).** Right now `runGuardedBatch` hard-codes `await delay(1000, 3000)` between items (line ~170). Cluster-1 group actions require **30–90s** between joins (NFR-6/NFR-7), and Cluster-2 later needs 60–180s. So `runGuardedBatch` must accept `delayMin`/`delayMax` options, **defaulting to the current 1000/3000** so the existing like/comment/share callers (Stories 2.2–2.4, 4.2) keep their exact current behavior with zero changes. Story 4.4 passes `delayMin: 30000, delayMax: 90000`.

This is the highest-risk story so far: it both touches a shared chokepoint (regression surface) AND performs a social write that commonly triggers checkpoints.

## Acceptance Criteria

**AC1 — Extend `runGuardedBatch` with a configurable, floor-clamped delay range (NFR-6/NFR-7)**
1. `runGuardedBatch` accepts `options.delayMin` and `options.delayMax` (ms). The inter-item delay becomes `await delay(delayMin, delayMax)` instead of the hard-coded `delay(1000, 3000)`.
2. Defaults are `delayMin = 1000`, `delayMax = 3000` — so EVERY existing caller (likeFacebookPosts, commentOnFacebookPosts, createFacebookPost, shareFacebookPosts) behaves EXACTLY as before with no code change. (Verify: existing Epic 2 + 4.2 tests still pass unchanged.)
3. Validation: `delayMin`/`delayMax` must be finite numbers, `0 <= delayMin <= delayMax`; otherwise throw a clear error (mirror the existing `maxBatch`/`maxRetry` validation style).
4. No floor logic inside `runGuardedBatch` itself (it stays generic). The 30s floor (NFR-6) is enforced by the CALLER — see AC2.

**AC2 — `joinFacebookGroups` entry + NFR-6 delay floor (caller-enforced)**
5. `joinFacebookGroups(page, input, options = {})` exported from `api/services/facebookAutomation.js` and added to default export.
6. Routes through `runGuardedBatch(groups, actionFn, guardedOptions)` — NO custom mutate loop (NFR-7).
7. The caller passes `delayMin`/`delayMax` defaulting to **30000 / 90000**, and CLAMPS any caller-supplied value up to the 30s floor: `delayMin = max(30000, options.delayMin ?? 30000)` — a user CANNOT configure a group-join delay below 30s (NFR-6: "Không giảm dưới ngưỡng sàn này dù người dùng cấu hình"). Document the floor with a named constant `GROUP_ACTION_DELAY_FLOOR_MS = 30000`.
8. `dryRun` defaults to `true`; only explicit `dryRun: false` sends real join requests (strict `=== false` gate, inherited from runGuardedBatch).

**AC3 — Input modes (URL + keyword)**
9. URL mode: `input = { groupUrls: string[] }` → the batch items are the group URLs. Validate each is a non-empty string + `new URL()`-parseable + `facebook.com`/`*.facebook.com` host (reuse Story 4.2's URL guard / the shared `assertFacebookUrl` helper if 4.3 extracted it; otherwise inline the same check) BEFORE any browser action.
10. Keyword mode: `input = { keyword: string, limit: number }` → navigate `https://www.facebook.com/search/groups/?q=<encoded keyword>`, scroll-collect up to `limit` group URLs (bounded scroll + 1–3s delay, reuse the scroll pattern), then those URLs become the batch items. Empty search results → return a dry-run-style empty result (no throw).
11. Mode is selected by input shape: `groupUrls` present → URL mode; else `keyword` present → keyword mode; neither → throw a clear error.

**AC4 — Per-group join action + pending-approval is NOT a failure (FR-18)**
12. Internal `joinSingleGroup(page, groupUrl)`: navigate to the group, find + click the Join button (locale-aware, UNVERIFIED selectors — fallback chain + clear PII-free throw if not found), return `{ joined: boolean, status: 'joined' | 'pending' }`.
13. A group requiring admin approval → return `status: 'pending'` with `ok: true` (surfaced via the capture-Map merge pattern from 4.2). Pending is NOT an error and does NOT mark the item failed (FR-18 consequence).
14. Join button + "Requested"/pending indicator selectors documented in `docs/agents/selectors-facebook.md` under a Groups section, marked UNVERIFIED + verify-checklist.

**AC5 — Result shape**
15. Dry-run: preview entries `{ target: groupUrl, action: 'pending' }` (runGuardedBatch shape); in keyword mode the preview lists the resolved-then-would-join URLs. No DOM write in dry-run; in URL mode no browser opened at all in dry-run; keyword mode MAY still need to search to resolve URLs — if so, document that dry-run in keyword mode performs the read-only search but no joins (or defer the search too — pick one and state it).
16. Real run: `results` entries `{ target: groupUrl, ok, error?, status? }` where `status` is `joined`/`pending`.

**AC6 — Safety (NFR-7/8/9, ADR-007)**
17. Account-risk warning fires before the first real join (inherited from `runGuardedBatch` — do NOT reimplement, do NOT suppress; NFR-8). FR-18 IS in the NFR-8 mandatory-warning list.
18. No real join under `dryRun=true` (test asserts no join-click in dry-run).
19. `maxBatch` applies (default 20 from runGuardedBatch); document that group joins are bounded.

**AC7 — Tests (browser-free, no mocks/stubs/fakes)**
20. `runGuardedBatch` delay-range tests: default (no delayMin/Max) still delays via the seam with (1000,3000); explicit delayMin/Max are passed to the seam; invalid ranges throw. Use an injected `delay` spy that records its `(min,max)` args — assert the args, never actually sleep.
21. **Regression check**: re-run the existing like/comment/share test suites — they MUST still pass unchanged (proves the delay-range extension is backward compatible).
22. `joinFacebookGroups` tests (fake page + injected `joinFn` seam + injected `delay` spy):
    - URL-mode dry-run: preview of group URLs, no join, no browser
    - URL-mode real: `joinFn` called once per URL; `status:'joined'` → ok; `status:'pending'` → ok with `status:'pending'` (NOT failed)
    - keyword-mode: injected search seam returns N URLs → those become batch items (dry-run lists them)
    - delay floor: caller passes `delayMin: 5000` → the spy receives `>= 30000` (floor enforced)
    - invalid input (neither groupUrls nor keyword) → throws
    - invalid/non-facebook group URL → throws before browser
    - a join that throws (button not found) → `ok:false`, PII-free error, batch continues
23. Vitest 4.x, `npx vitest run <file>`. Browser-free; the search step + join step are injectable seams so no real network/DOM.

## Tasks / Subtasks

- [x] **Task 1: Extend `runGuardedBatch` (delay range)** (AC1, AC7.20-21)
  - [x] Add `delayMin=1000`/`delayMax=3000` options + finite/0<=min<=max validation; replace hard-coded `delay(1000,3000)` with `delay(delayMin, delayMax)`
  - [x] Confirm all existing callers unchanged; run Epic 2 + 4.2 suites green (regression gate)
- [x] **Task 2: `joinFacebookGroups` entry + delay floor** (AC2, AC6)
  - [x] Export + default export; route through `runGuardedBatch`; `GROUP_ACTION_DELAY_FLOOR_MS=30000`; clamp caller delay up to floor; default 30000/90000
  - [x] dryRun default true; account-risk warning inherited (not suppressed)
- [x] **Task 3: Input modes** (AC3)
  - [x] URL mode: validate group URLs (reuse 4.2/4.3 facebook.com guard); keyword mode: search + bounded-scroll collect up to `limit` URLs via injectable search seam; mode select by shape; clear throw if neither
- [x] **Task 4: `joinSingleGroup` + pending** (AC4)
  - [x] Navigate + locale-aware Join button (fallback chain, UNVERIFIED, PII-free throw); detect pending-approval → `status:'pending'` ok (capture-Map merge like 4.2 alreadyShared)
  - [x] Document Groups selectors in `docs/agents/selectors-facebook.md` (UNVERIFIED + verify-checklist)
- [x] **Task 5: Tests** (AC7)
  - [x] runGuardedBatch delay-range + regression; joinFacebookGroups URL/keyword/pending/floor/invalid cases; injected `joinFn`/`searchFn`/`delay` seams
  - [x] `npx vitest run` for the new file + the existing automate suites green

## Review Findings

> Code review 2026-06-16 (3-layer adversarial: blind / edge-case / acceptance-auditor). Implementation = commit 0764f7f. Edge-case layer RAN the full services suite: **100/100 pass — NO shared-chokepoint regression** from the runGuardedBatch delay-range extension (the #1 risk). Acceptance audit: 19 MET, 4 PARTIAL (3 are doc-only gaps + 1 runtime-evidence note), 0 MISSING/VIOLATED.

### Patch

- [x] [Review][Patch][MEDIUM] FIXED — Keyword-mode dry-run no longer drives the browser. Option A applied: if `dryRun !== false` return an empty preview + warning "keyword-mode dry-run does not resolve group URLs (search would drive the browser)". Search only runs on explicit real run. Tests updated: keyword dry-run asserts empty preview + warning; keyword real-run asserts resolved URLs become batch items. [api/services/facebookAutomation.js#joinFacebookGroups]
- [x] [Review][Patch][MEDIUM] FIXED — NaN floor bypass. `Number.isFinite` + `>= 0` guard wraps both `delayMinOpt` and `delayMaxOpt` before `Math.max` — NaN/Infinity/negative fallback to the floor/max constant instead of propagating and throwing from the wrong layer. [api/services/facebookAutomation.js#joinFacebookGroups]
- [x] [Review][Patch][MEDIUM] FIXED — Query-string group URLs. Regex now tests `h.split('?')[0]` (strip query first) so `?ref=search_result` links match correctly. [api/services/facebookAutomation.js#defaultGroupSearch]
- [x] [Review][Patch][LOW] FIXED — `delayMin: null` in spread. `runGuardedBatch` now destructures as `delayMinRaw`/`delayMaxRaw` then applies `?? 1000`/`?? 3000` — null falls back to default (not throw). Genuinely invalid values (NaN, string, negative) still throw. [api/services/facebookAutomation.js#runGuardedBatch]
- [x] [Review][Patch][LOW] FIXED — Doc: `joinFacebookGroups` JSDoc updated with keyword-mode dry-run note + `@param maxBatch=20` bound + limit/maxBatch interaction warning. [api/services/facebookAutomation.js#joinFacebookGroups JSDoc]

### Deferred

- [x] [Review][Defer][MEDIUM] Post-click pending detection uses `sleep(800)` + point-in-time `page.$()` rather than `waitForSelector` — on a slow/throttled render a group requiring admin-approval can be mis-reported as `status:'joined'` instead of `'pending'`. Fix is a second short `waitForSelector` for the pending/joined indicators after the click. DEFERRED because the join + pending selectors are themselves UNVERIFIED (need a live Facebook session) — couple this timing fix with the live-DOM verify pass; fixing the wait against unverified selectors is premature. [api/services/facebookAutomation.js#joinSingleGroup ~L124-131] — deferred, needs live session (same posture as 4.2 share-to-Feed)

### Dismissed (verified)

- Shared-chokepoint regression → edge layer ran 100/100 services tests green; no existing caller passes delayMin/delayMax; defaults 1000/3000 are byte-identical to the old hard-coded delay. NOT a regression.
- delay-floor math producing an invalid min>max pair → every combination yields delayMin>=30000, delayMax>=delayMin; the runGuardedBatch min>max throw is unreachable from joinFacebookGroups (except via the NaN path, captured as a patch above).
- SSRF in keyword search → keyword is `encodeURIComponent`'d into a fixed facebook.com search URL; resolved URLs are `assertFacebookUrl`-validated post-fetch. Safe.
- delayMin/delayMax validation order (before maxBatch) → harmless; no current caller hits both.
- AC7.21 "regression evidence only in dev record" → edge layer independently re-ran the suite (100/100). Resolved.

## Dev Notes

### REUSE-FIRST + the regression hazard (read before coding)

- **Extend, don't fork, `runGuardedBatch`.** The delay-range is the ONLY change to the shared helper. Keep defaults at 1000/3000 so likeFacebookPosts/commentOnFacebookPosts/createFacebookPost/shareFacebookPosts are byte-for-byte unaffected. This is PRD Open Question #1 being resolved — do it in the shared helper, not by copying the loop. [Source: api/services/facebookAutomation.js#runGuardedBatch line ~170 hard-coded `delay(1000,3000)`; prd §9 Open Question #1]
- **NFR-6 floor lives in the CALLER, not the helper.** `runGuardedBatch` stays generic (any min/max); `joinFacebookGroups` clamps up to 30s. This keeps the floor a Cluster-1 policy, reusable by Cluster-2 (60-180s) without baking group-specific numbers into the generic chokepoint. [Source: prd §7 NFR-6]
- **Clone `shareFacebookPosts` (Story 4.2) shape** for the batch + per-item seam + capture-Map (`status:'pending'` here plays the role `alreadyShared` did): `const { joinFn: jOpt, ...guarded } = options; const joinFn = jOpt ?? joinSingleGroup;` then `runGuardedBatch(groupUrls, actionFn, guarded)` with a Map capturing per-URL `{status}`. [Source: api/services/facebookAutomation.js#shareFacebookPosts]
- **Reuse the URL guard** added in 4.2 (and possibly extracted as `assertFacebookUrl` in 4.3). If the helper exists, call it; if not, inline `new URL()` + `http(s)` + `facebook.com` host check. Do NOT write a third copy — if 4.3 didn't extract it, extract it now and have 4.2/4.3/4.4 share it. [Source: api/services/facebookAutomation.js#shareFacebookPosts URL validation]
- **Reuse the scroll-collect pattern** (viralTweets.js / twitter index.js / Story 4.3) for keyword-mode group search: bounded scroll + 1-3s delay + dedupe collected URLs until `limit` or exhausted. Make the search an injectable seam (`options.searchFn`) so tests don't hit the network. [Source: src/scrapers/viralTweets.js:107-119]

### Lessons applied (Stories 4.1–4.3)

- **Strict `dryRun === false` gate** — inherited from runGuardedBatch; null/undefined stays dry-run.
- **Validate before browser** (4.2/4.3) — URL + mode validation before any `page.*`; SSRF-safe.
- **Injectable seams for tests** (4.1 now/postExecutor, 4.2 shareFn, 4.3 delay/now) — here: `joinFn`, `searchFn`, and a `delay` spy that records `(min,max)` so the 30s floor is unit-testable without sleeping.
- **pending ≠ failure** — mirror 4.2's `alreadyShared` capture-Map: a `pending` join is `ok:true` with `status:'pending'`, surfaced via the post-batch merge, not recorded as failed (FR-18).
- **No silent success** (4.2 review) — `joinSingleGroup` must distinguish actually-clicked-join vs already-member vs pending; don't return `{joined:true}` blindly. Join-button/pending selectors are UNVERIFIED → real-path correctness is a live-verify item (track in selectors doc, same posture as 4.2's share-to-Feed).
- **Account-risk warning is mandatory + non-suppressible** for FR-18 (NFR-8) — it comes free from runGuardedBatch; never add a flag to silence it.

### Project Structure Notes

- MODIFY: `api/services/facebookAutomation.js` (extend `runGuardedBatch` delay range; add `joinFacebookGroups` + `joinSingleGroup` + `GROUP_ACTION_DELAY_FLOOR_MS` + default-export entry; reuse/extract `assertFacebookUrl`), `docs/agents/selectors-facebook.md` (Groups section).
- NEW: test file under `tests/services/` mirroring 4.1/4.2 layout.
- No CLI/MCP/REST surface this story. No Prisma model (group joins are ephemeral; if Operation tracking is wanted, reuse the existing `Operation` model via an injectable seam like 4.1/4.3 — but NOT required by FR-18 ACs).
- ⚠️ Backward-compat is an acceptance gate: the delay-range extension must not change any existing caller's behavior. Run the full automate suite, not just the new tests.

### Critical context

- Node.js, ESM. `// by nichxbt`; emoji log prefixes.
- Tests: Vitest 4.x, Node env, **no mocks/stubs/fakes** — fake page + injected `joinFn`/`searchFn`/`delay`-spy seams. The delay spy records args; tests never sleep 30s.
- `tests/x402-integration.test.js` ECONNREFUSED failures are pre-existing/unrelated.
- Cluster-1 medium risk: keep `dryRun` default true, mandatory warning, conservative delays. Join-spam is a top checkpoint trigger — the 30s floor is a safety invariant, not a tunable.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.4: Join Facebook groups]
- [Source: _bmad-output/planning-artifacts/prds/prd-XActions-2026-06-10-epic4/prd.md#FR-18, §7 NFR-6/NFR-7/NFR-8, §9 Open Question #1 (delayRange)]
- [Source: api/services/facebookAutomation.js#runGuardedBatch (extend delay), #shareFacebookPosts (clone shape + URL guard + capture-Map)]
- [Source: src/scrapers/viralTweets.js, src/scrapers/twitter/index.js — scroll-collect for keyword group search]
- [Source: _bmad-output/implementation-artifacts/4-2-auto-share-post.md (capture-Map/pending pattern, UNVERIFIED-selector posture), 4-3-view-boost.md (assertFacebookUrl extraction, seam discipline)]

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (BMAD dev-story workflow)

### Debug Log References

- Regression gate (AC7.21) chạy NGAY sau khi extend `runGuardedBatch` delay range, TRƯỚC khi viết `joinFacebookGroups`: services suite 127/127 pass → xác nhận default `delayMin=1000`/`delayMax=3000` giữ backward-compat byte-for-byte cho mọi caller (like/comment/post/share). Full suite cuối: services+mcp 216/216, tổng 1355 pass, chỉ `x402-integration.test.js` fail (ECONNREFUSED pre-existing).

### Completion Notes List

- **AC1 (extend `runGuardedBatch`)**: thêm `delayMin`/`delayMax` options (default 1000/3000 → backward-compat tuyệt đối), validation finite + `0 <= delayMin <= delayMax` (mirror style maxBatch/maxRetry), thay hard-coded `delay(1000,3000)` → `delay(delayMin, delayMax)`. Helper VẪN generic — KHÔNG nhúng floor 30s vào đây (floor là policy của caller).
- **AC2 (`joinFacebookGroups` + floor)**: route qua `runGuardedBatch` (NFR-7), `GROUP_ACTION_DELAY_FLOOR_MS = 30000` (exported const). Clamp UP: `delayMin = max(30000, opt ?? 30000)` — user KHÔNG thể đặt dưới 30s (NFR-6). Default 30000/90000. dryRun default true; account-risk warning inherit từ runGuardedBatch (không suppress, NFR-8).
- **AC3 (2 mode)**: URL mode validate mỗi URL qua `assertFacebookUrl` (shared helper từ 4.3) trước browser. Keyword mode: `searchFn` seam (default `defaultGroupSearch` — `/search/groups/?q=`, bounded scroll-collect `a[href*="/groups/"]` dedupe tới `limit`), URL resolved cũng validate. Mode select theo shape; empty search → empty result KHÔNG throw; neither → throw rõ ràng.
- **AC4 (`joinSingleGroup` + pending)**: combined `waitForSelector` (pending + join list, UNVERIFIED locale-aware en/vi). Pending indicator trước → `status:'pending'` không click. Else click Join → check pending lại (admin-approval) → `joined`/`pending`. PII-free throw nếu không thấy. Pending là `ok:true` (KHÔNG failed) qua capture-Map merge (giống 4.2 alreadyShared). Groups selectors + verify-checklist đã ghi vào `selectors-facebook.md` (UNVERIFIED).
- **AC5–AC6 (result + safety)**: dry-run preview `{target, action:'pending'}` (URL mode không mở browser); real results `{target, ok, error?, status?}`. maxBatch 20 inherit. dryRun không join (test khẳng định).
- **AC7 (tests)**: 15/15 pass (`tests/services/facebook-join-groups.test.js`), browser-free, no-mock (delay-spy ghi `(min,max)` không sleep thật; injected `joinFn`/`searchFn`). Bao gồm delay-range default/explicit/invalid, floor enforcement (delayMin 5000 → spy nhận ≥30000), pending≠failed, keyword empty, URL guard SSRF, batch-continue-on-throw.

### File List

- MODIFIED: `api/services/facebookAutomation.js` — extend `runGuardedBatch` (delayMin/delayMax + validation) + `joinFacebookGroups` + `joinSingleGroup` + `defaultGroupSearch` + `GROUP_ACTION_DELAY_FLOOR_MS` + default-export entries
- MODIFIED: `docs/agents/selectors-facebook.md` — Groups/Join section (UNVERIFIED) + verify-checklist items
- NEW: `tests/services/facebook-join-groups.test.js` — 15 browser-free unit tests (AC7)

## Change Log

- 2026-06-15: Story 4.4 created (context engine). Status → ready-for-dev. (Luisphan)
- 2026-06-16: Story 4.4 implemented — extend runGuardedBatch with configurable delayMin/delayMax (default 1000/3000, backward-compat verified), joinFacebookGroups (URL + keyword modes, 30s delay floor, pending≠failure), Groups selector docs, 15 browser-free tests. Status → review. (dev-story / claude-opus-4-8)
