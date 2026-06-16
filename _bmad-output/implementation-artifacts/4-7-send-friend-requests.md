---
baseline_commit: 81a7efcf2a44e9c7ecfcb7f80ac8ac1c33436b9d
---

# Story 4.7: Send friend requests automatically (dry-run default)

Status: ready-for-dev

<!-- Epic 4 (Facebook Growth Automation, Cluster 2 — MEDIUM-HIGH risk). Source: epics.md#Story 4.7 + PRD prd-XActions-2026-06-10-epic4 FR-21. HIGHEST account-risk story in Epic 4. -->

## Story

As a growth hacker using XActions,
I want to send friend requests by UID list, suggestions, or location filter,
so that I can build a targeted network with conservative rate limits.

## Context — what this story builds

Story 4.7 adds `sendFriendRequests(page, input, options)` to `api/services/facebookAutomation.js`. It is the FIRST **Cluster-2** batch write — the highest account-risk action in Epic 4. Key differences vs. Cluster 1 (4.4/4.5):

- **Delay floor is 60s** (not 30s) — `FRIEND_REQUEST_DELAY_FLOOR_MS = 60000`. NFR-6: "friend requests delay 60–180s." This is DOUBLE the group-action floor.
- **batchLimit ≤ 20/session** (matches runGuardedBatch's default maxBatch — no stricter FR-19-style cap; but PRD says ≤20, so do NOT raise maxBatch above 20 for this action).
- **3 input modes** (more complex than 4.4's 2): `uid_list` (array of profile URLs/UIDs), `suggestions` (Facebook's "People You May Know" surface), `location` (filter suggestions by publicly self-declared location).
- **NFR-11** (no PII): phone numbers NEVER scraped in ANY mode — normalizer filter (same as 4.6).
- **"Already friend" / "pending" / "not found" → skip** — NOT fail (same pattern as 4.4's pending-approval capture-Map). Batch continues.
- **Non-suppressible warning** (NFR-8): FR-21 IS in the mandatory-warning list. The warning text should additionally note: "friend-request spam is the top cause of checkpoint" (per epics AC).

Pattern: clone `joinFacebookGroups` (4.4) — same `runGuardedBatch` routing, same delay-floor clamp, same capture-Map for per-item status; swap the per-item action (click "Add Friend" instead of "Join group") and raise the floor to 60s.

## Acceptance Criteria

**AC1 — `sendFriendRequests` entry + routing (NFR-7/8)**
1. `sendFriendRequests(page, input, options = {})` exported from `api/services/facebookAutomation.js` + added to default export.
2. Routes through `runGuardedBatch(targets, actionFn, guardedOptions)` — NO custom mutate loop (NFR-7).
3. `dryRun` defaults to `true` (strict `=== false` gate, inherited from runGuardedBatch).
4. Account-risk warning fires before first real request (inherited from runGuardedBatch; NFR-8 — FR-21 IS in the list). Do NOT add a separate warning that suppresses or duplicates the inherited one.

**AC2 — 60-180s delay floor (NFR-6 Cluster 2)**
5. `FRIEND_REQUEST_DELAY_FLOOR_MS = 60000` named constant (exported). Default `delayMin = 60000`, `delayMax = 180000`. Floor clamp: `Math.max(FRIEND_REQUEST_DELAY_FLOOR_MS, safeMinOpt)` — same Number.isFinite guard pattern as 4.4. A user CANNOT configure below 60s for friend requests. Document the floor in JSDoc.
6. `batchLimit` ≤ 20/session — this matches runGuardedBatch's default `maxBatch=20`; no separate cap constant needed (unlike 4.5's GROUP_POST_BATCH_LIMIT=10). If a caller passes `maxBatch > 20`, let runGuardedBatch validate (it will throw if items.length > maxBatch).

**AC3 — Input modes (3)**
7. `input = { mode: 'uid_list' | 'suggestions' | 'location', targets?: string[], location?: string, limit?: number }`.
8. **uid_list mode**: `input.targets` is a non-empty array of profile URLs or UIDs. Each validated via `assertFacebookUrl` (or a facebook.com/profile URL check). These become the batch items directly.
9. **suggestions mode**: navigate to Facebook's "People You May Know" surface (`/friends/suggestions`), scroll-collect up to `input.limit` profile URLs (bounded scroll + 1-3s delay, injectable `searchFn` seam). Collected URLs become batch items. Dry-run in suggestions mode: same decision as 4.4 keyword-mode — do NOT drive browser in dry-run; return empty preview + warning.
10. **location mode**: same as suggestions but additionally filter by `input.location` — only collect profiles whose publicly self-declared location CONTAINS `input.location` (case-insensitive substring match on the visible location text). The location field is extracted from the DOM text near the profile card. NFR-11: NEVER extract phone/email even if visible.
11. Mode selected by `input.mode` value (explicit — not inferred from shape like 4.4). Missing/invalid mode → throw clear error.

**AC4 — Per-profile friend request + skip states (FR-21)**
12. Internal `sendSingleFriendRequest(page, profileUrl)`: navigate to profile, find + click "Add Friend" button (locale-aware, UNVERIFIED selectors — fallback chain + PII-free throw if not found), return `{ sent: boolean, status: 'sent' | 'already_friend' | 'pending' | 'not_found' }`.
13. Status detection:
    - Already a friend (e.g. "Friends" / "Bạn bè" button visible) → `status: 'already_friend'`, `sent: false`, `ok: true` (skip, NOT fail).
    - Pending request already sent (e.g. "Cancel request" / "Requested" / "Đã yêu cầu" visible) → `status: 'pending'`, `sent: false`, `ok: true` (skip, NOT fail).
    - Profile not found / blocked / deactivated → throw PII-free error (runGuardedBatch records it as `ok: false`).
    - "Add Friend" clicked successfully → `status: 'sent'`, `sent: true`.
14. Surface per-profile `status` via capture-Map merge (same pattern as 4.4's joined/pending). All skip states are `ok: true` (do NOT count as failed — batch.failed stays 0 for skipped items).

**AC5 — NFR-11: no PII collection**
15. In suggestions/location modes, the scroll-collect phase extracts ONLY `{ name, profileUrl, location? }` per profile card. Phone numbers and email addresses are NEVER collected even if visible in DOM — normalizer filter (same rule as 4.6). The `location` field uses only the publicly self-declared location text (not inference/enrichment from other sources).
16. Dedicated test: fixture DOM with phone/email visible → normalized output does NOT contain them.

**AC6 — Selectors documented (UNVERIFIED + verify-checklist)**
17. Document in `docs/agents/selectors-facebook.md` under a "Friends — Send Request (FR-21)" section: "Add Friend" button, "Friends" indicator, "Cancel request" / pending indicator, People You May Know surface selectors. All marked UNVERIFIED + verify-checklist entries.

**AC7 — Tests (browser-free, no mocks/stubs/fakes)**
18. Tests with injected `requestFn` seam + `searchFn` seam + `delay` spy:
    - uid_list dry-run: preview of targets, no browser, no requests
    - uid_list real: `requestFn` called per target; `status:'sent'` → ok; `status:'already_friend'`/`'pending'` → ok (NOT failed); throw → ok:false, batch continues
    - suggestions dry-run: empty preview + warning (no browser navigation)
    - suggestions real: injected searchFn returns N URLs → those become batch items
    - location mode: injected searchFn returns profiles with location → filter applied → only matching profiles become batch items
    - delay floor: `delayMin: 10000` → spy receives `>= 60000`
    - invalid mode → throws
    - invalid / non-facebook target URL → throws before browser
    - NFR-11: fixture with phone/email → NOT in output
    - batchLimit: 21 targets → runGuardedBatch throws maxBatch (inherited)
19. Vitest 4.x, `npx vitest run <file>`. Browser-free via injected seams. No real network.

## Tasks / Subtasks

- [ ] **Task 1: `sendFriendRequests` entry + delay floor** (AC1, AC2)
  - [ ] Export + default export; route through `runGuardedBatch`; `FRIEND_REQUEST_DELAY_FLOOR_MS=60000`; clamp up to 60s; default 60000/180000
  - [ ] dryRun default true; account-risk warning inherited (do not duplicate/suppress)
- [ ] **Task 2: Input modes** (AC3)
  - [ ] uid_list: validate targets (assertFacebookUrl), these become batch items
  - [ ] suggestions: injectable searchFn for "/friends/suggestions" scroll-collect; dry-run = empty preview + warning (no browser)
  - [ ] location: same as suggestions + substring filter on publicly self-declared location text; NFR-11 normalizer
  - [ ] Mode select by `input.mode` (explicit); invalid → clear throw
- [ ] **Task 3: `sendSingleFriendRequest` + skip states** (AC4)
  - [ ] Navigate profile; detect already-friend / pending / not-found BEFORE clicking; click "Add Friend"; return `{sent, status}`
  - [ ] Capture-Map merge (status → ok:true for skips, same as 4.4)
  - [ ] PII-free throws; UNVERIFIED selectors + fallback chain
- [ ] **Task 4: NFR-11 normalizer** (AC5)
  - [ ] Strip phone/email from suggestions/location collected data (regex filter at normalizer level)
  - [ ] Dedicated test with fixture containing PII → output clean
- [ ] **Task 5: Selector docs** (AC6)
  - [ ] Add "Friends — Send Request (FR-21)" to selectors-facebook.md (UNVERIFIED + verify-checklist)
- [ ] **Task 6: Tests** (AC7)
  - [ ] All AC7 cases with injected requestFn + searchFn + delay spy
  - [ ] `npx vitest run <file>` green + regression suite

## Dev Notes

### REUSE-FIRST — this is structurally a clone of 4.4 with higher delay

- **Clone `joinFacebookGroups` (4.4)** as structural template — same option destructuring, same `runGuardedBatch` routing, same capture-Map for per-item status, same Number.isFinite guard on delayMin/delayMax. Swap: `joinFn` → `requestFn`; `joinSingleGroup` → `sendSingleFriendRequest`; floor 30s → 60s; joined/pending → sent/already_friend/pending/not_found. [Source: api/services/facebookAutomation.js#joinFacebookGroups]
- **Reuse `assertFacebookUrl`** for uid_list URL validation. [Source: api/services/facebookAutomation.js#assertFacebookUrl]
- **Reuse the NFR-11 normalizer pattern** from Story 4.6 (phone/email regex strip at extraction level). If 4.6 is implemented by now, import/call its normalizer; if not, implement inline with the same regex. [Source: 4-6-scrape-group-members.md AC3]
- **Reuse the "dry-run does NOT drive browser in search/suggestions mode"** decision from 4.4 review (Patch P1: keyword-mode dry-run returns empty preview + warning). Apply the same posture for suggestions/location modes. [Source: 4.4 review patch P1]
- **Reuse the `GROUP_ACTION_DELAY_FLOOR_MS` clamp pattern** — same `Math.max(FLOOR, safeMinOpt)` with `Number.isFinite` guard; just use a different constant (60s instead of 30s). [Source: api/services/facebookAutomation.js#joinFacebookGroups delay-floor block]

### Key differences from 4.4 (do not auto-pilot the clone)

- **60s floor** (not 30s) — the FRIEND_REQUEST_DELAY_FLOOR_MS constant is a distinct safety invariant for Cluster 2. Do NOT accidentally reuse GROUP_ACTION_DELAY_FLOOR_MS (30s).
- **3 modes** (vs 4.4's 2) — mode is EXPLICITLY selected by `input.mode` string (not inferred from shape). This is deliberate: uid_list/suggestions/location have overlapping field names (both suggestions and location use a scroll-collect surface) so shape-inference would be ambiguous.
- **4 skip states** (vs 4.4's 2) — already_friend, pending, not_found, sent. All non-error states (already_friend, pending) are `ok:true` + NOT counted as `failed`. Only a throw (profile unreachable / selector not found) is a batch failure.
- **Highest-risk action in Epic 4** — the PRD AC explicitly says "friend-request spam is the top cause of checkpoint". Do NOT lower the 60s floor or raise maxBatch above 20 under any pressure. SM-C3 counter-metric applies.

### Lessons applied (Stories 4.1–4.6)

- **Number.isFinite guard on delay** (4.4 review P2) — NaN/Infinity fallback to constant.
- **Dry-run does NOT drive browser in scroll-collect modes** (4.4 review P1) — suggestions/location dry-run returns empty preview + warning.
- **catch only swallow timeout** (4.2/4.5 review) — waitForSelector catch should only swallow timeout, re-throw frame-destroyed.
- **Skip states are ok:true** (4.4 pending) — already_friend/pending do NOT count as failures, do NOT abort batch.
- **NFR-11 at normalizer level** (4.6) — not a caller option.
- **No silent success** — `sendSingleFriendRequest` should detect the post-click state (did "Add Friend" change to "Cancel request"/"Requested"?) to confirm the request was actually sent. UNVERIFIED selectors → tied to live-verify (same posture as 4.2/4.4/4.5).

### Project Structure Notes

- MODIFY: `api/services/facebookAutomation.js` (add `sendSingleFriendRequest` + `sendFriendRequests` + `FRIEND_REQUEST_DELAY_FLOOR_MS` + default-export entry), `docs/agents/selectors-facebook.md` (Friends section).
- NEW: test file under `tests/services/`.
- No CLI/MCP/REST surface this story. No Prisma model (Operation tracking optional via injectable seam like 4.3 — not required by FR-21 ACs, but nice-to-have for progress visibility).
- Same shared-file (facebookAutomation.js) as 4.4/4.5 — purely additive, run full suite after.

### Critical context

- Node.js, ESM. `// by nichxbt`; emoji log prefixes.
- Tests: Vitest 4.x, Node env, **no mocks/stubs/fakes** — injected `requestFn`/`searchFn`/`delay`-spy seams. Delay spy records args; tests never sleep 60s.
- `tests/x402-integration.test.js` ECONNREFUSED failures are pre-existing/unrelated.
- **Cluster-2 HIGHEST risk**: dryRun default true, mandatory warning (non-suppressible), 60s floor, batchLimit 20. Friend-request spam = top checkpoint trigger. The 60s floor and 20-batch cap are safety INVARIANTS, not tunables.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.7: Send friend requests automatically]
- [Source: _bmad-output/planning-artifacts/prds/prd-XActions-2026-06-10-epic4/prd.md#FR-21, §4.3 Cluster 2, §7 NFR-6/NFR-7/NFR-8/NFR-10, §8 SM-C3]
- [Source: api/services/facebookAutomation.js#joinFacebookGroups (clone template), #GROUP_ACTION_DELAY_FLOOR_MS (pattern), #assertFacebookUrl]
- [Source: _bmad-output/implementation-artifacts/4-4-join-groups.md (delay floor + capture-Map + NaN guard + dry-run-no-browser), 4-6-scrape-group-members.md (NFR-11 normalizer)]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

- 2026-06-16: Story 4.7 created (context engine). Status → ready-for-dev. (Luisphan)
