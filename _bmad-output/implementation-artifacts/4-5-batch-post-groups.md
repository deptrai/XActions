---
baseline_commit: 049741e4de072e6afd9610df6d3a326447c51722
---

# Story 4.5: Batch post to multiple groups (dry-run default)

Status: ready-for-dev

<!-- Epic 4 (Facebook Growth Automation, Cluster 1 — medium risk). Source: epics.md#Story 4.5 + PRD prd-XActions-2026-06-10-epic4 FR-19. Realizes UJ-6. -->

## Story

As a multi-group operator using XActions,
I want to post one content to multiple Facebook groups in a batch,
so that I can distribute content efficiently with spam-safe delays.

## Context — what this story builds

Story 4.5 adds `postToFacebookGroups(page, input, options)` to `api/services/facebookAutomation.js`. It is the SECOND Cluster-1 batch write and a near-twin of Story 4.4's `joinFacebookGroups`: same `runGuardedBatch` routing, same 30s delay floor (`GROUP_ACTION_DELAY_FLOOR_MS`, NFR-6), same mandatory account-risk warning (NFR-8), same capture-Map status merge. The differences from 4.4:
- **Per-item action posts content into a group** (navigate group → locate composer → type → submit) instead of clicking Join. The group-composer DOM is close to the home-feed composer reused by `createSinglePost` (Story 2.4) but on a group page — selectors are UNVERIFIED, fallback chain + PII-free throw.
- **`batchLimit = 10` with an explicit `force=true` override** (FR-19): more than 10 groups requires `force: true`, otherwise throw. This is stricter than runGuardedBatch's default `maxBatch=20` — 4.5 sets the effective cap to 10 unless forced.
- **A failed group does NOT abort the batch** (FR-19) — already guaranteed by `runGuardedBatch`'s per-item try; just confirm + test it.

Almost everything is reuse. The only genuinely new pieces are the group-composer post action and the `batchLimit`/`force` gate.

## Acceptance Criteria

**AC1 — `postToFacebookGroups` entry (clone joinFacebookGroups shape)**
1. `postToFacebookGroups(page, input, options = {})` exported from `api/services/facebookAutomation.js` + added to default export.
2. `input = { groupUrls: string[], content: string, mediaUrls?: string[] }`. Validate: `groupUrls` non-empty array, each `assertFacebookUrl(u, 'postToFacebookGroups: groupUrl')`; reject duplicate group URLs (Map-collision guard, like 4.2); `content` non-empty string (reuse the `createFacebookPost` guard) — ALL before any browser action.
3. Routes through `runGuardedBatch(groupUrls, actionFn, guardedOptions)` — NO custom mutate loop (NFR-7). `dryRun` defaults true (strict `=== false` gate).
4. Injectable `postFn` seam (default `postToSingleGroup`), nullish-coalesce so explicit `postFn: null` falls back (same guard as joinFn/shareFn).

**AC2 — `batchLimit=10` + `force` override (FR-19)**
5. Default effective batch cap is **10** (`GROUP_POST_BATCH_LIMIT = 10` named constant). If `groupUrls.length > 10` AND `options.force !== true` → throw a clear error instructing the user to pass `force: true` or split the batch. With `force: true`, allow up to `runGuardedBatch`'s `maxBatch` (still capped at 20 unless `maxBatch` is also raised).
6. The cap is enforced BEFORE the browser opens (in dry-run too — preview must reflect the real constraint, mirroring runGuardedBatch's maxBatch-in-dry-run behavior).

**AC3 — 30s delay floor (NFR-6, reuse 4.4)**
7. Inter-post delay floored at `GROUP_ACTION_DELAY_FLOOR_MS` (30s), default 30s/90s, clamped UP — a user CANNOT configure below 30s. Reuse the exact clamp from `joinFacebookGroups`: `delayMin = max(GROUP_ACTION_DELAY_FLOOR_MS, opt ?? floor)`.

**AC4 — Per-group post action**
8. Internal `postToSingleGroup(page, groupUrl, content)`: navigate to the group, locate the group post composer (locale-aware, UNVERIFIED — reuse/adapt the `createSinglePost` composer selectors `[aria-label*="Write something"]`/`[aria-label*="Viết"]` + group-specific fallbacks), type `content`, submit, return `{ posted: boolean }`. Clear PII-free throw if composer/submit not found.
9. Document group-composer selectors in `docs/agents/selectors-facebook.md` under the Groups section (extend 4.4's), marked UNVERIFIED + verify-checklist.

**AC5 — Failed group does not abort batch (FR-19)**
10. A group where posting fails (not a member, posting restricted, composer not found) is recorded as `{ target, ok:false, error }` and the batch CONTINUES to the remaining groups (guaranteed by runGuardedBatch per-item try — add a test that asserts one failing group does not stop the rest).
11. Single aggregated result with per-group progress (the runGuardedBatch result IS the aggregate; `attempted/succeeded/failed` + per-group `results`).

**AC6 — Result shape + safety**
12. Dry-run: preview `{ target: groupUrl, action: 'pending' }` per group + the content echoed once in the return (e.g. top-level `content` field or a `previewContent`); NO browser opened in dry-run.
13. Real run: `results` entries `{ target: groupUrl, ok, error? }`.
14. Account-risk warning fires before first real post (inherited; NFR-8 — FR-19 is in the list; do NOT suppress). No real post under dryRun.
15. `mediaUrls` accepted but text-only post in MVP is acceptable if media upload is out of scope — if so, document mediaUrls as reserved/not-yet-implemented (mirror scheduleFacebookPost's mediaUrls posture). Do not silently drop without noting.

**AC7 — Tests (browser-free, no mocks/stubs/fakes)**
16. `postToFacebookGroups` tests (fake page + injected `postFn` seam + `delay` spy):
    - dry-run: preview of group URLs + content echoed, no `postFn`/browser call
    - real: `postFn` called once per group with `(page, groupUrl, content)`; all ok → succeeded == N
    - **batchLimit**: 11 groups without `force` → throws; 11 with `force:true` → proceeds (≤20)
    - **delay floor**: `delayMin: 5000` → spy receives `>= 30000`
    - duplicate group URLs → throws before browser
    - empty `content` → throws before browser
    - one failing group (postFn throws for one URL) → that entry `ok:false`, others succeed, batch NOT aborted (maxRetry:0)
    - invalid/non-facebook group URL → throws before browser
17. Vitest 4.x, `npx vitest run <file>`. Browser-free via injected `postFn` seam; delay spy records args, never sleeps. Re-run 4.2/4.3/4.4 + Epic 2 suites — must stay green (no shared-helper regression; 4.5 only ADDS, but it touches the same file).

## Tasks / Subtasks

- [ ] **Task 1: `postToFacebookGroups` entry + validation** (AC1, AC2)
  - [ ] Export + default export; clone `joinFacebookGroups` shape; `postFn` nullish-coalesce seam
  - [ ] Validate groupUrls (assertFacebookUrl + dedupe) + non-empty content before browser
  - [ ] `GROUP_POST_BATCH_LIMIT=10`; >10 without `force:true` → throw (enforced in dry-run too)
- [ ] **Task 2: delay floor + batch routing** (AC3, AC5, AC6)
  - [ ] Reuse 30s clamp from joinFacebookGroups; route through runGuardedBatch; per-group try guarantees no-abort
  - [ ] Dry-run preview + content echo; real results `{target,ok,error?}`
- [ ] **Task 3: `postToSingleGroup` action** (AC4)
  - [ ] Navigate group → composer (reuse/adapt createSinglePost selectors + group fallbacks) → type → submit → `{posted}`; PII-free throw if not found
  - [ ] Document group-composer selectors in selectors-facebook.md (UNVERIFIED + verify-checklist)
- [ ] **Task 4: Tests** (AC7)
  - [ ] All AC7 cases with injected postFn + delay spy; one-failing-group no-abort test
  - [ ] `npx vitest run` new file + regression on 4.2/4.3/4.4 + Epic 2

## Dev Notes

### REUSE-FIRST (this story is ~90% reuse)

- **Clone `joinFacebookGroups` (Story 4.4) almost verbatim** — same option destructuring (`postFn`/`delayMin`/`delayMax`/`...rest`), same 30s floor clamp (`Math.max(GROUP_ACTION_DELAY_FLOOR_MS, opt ?? floor)`), same `runGuardedBatch` routing, same capture-Map (here capturing `{posted}` instead of `{status}`, though a simple ok/fail may not even need the merge). Swap the per-item action (post instead of join) and add the batchLimit/force gate. [Source: api/services/facebookAutomation.js#joinFacebookGroups, lines ~1239-1314]
- **Reuse the constants** `GROUP_ACTION_DELAY_FLOOR_MS` (30s) and `GROUP_ACTION_DELAY_MAX_MS` (90s) already defined for 4.4 — do NOT redefine. [Source: api/services/facebookAutomation.js:1116-1117]
- **Reuse `assertFacebookUrl`** for group URL validation (shared SSRF guard from 4.2/4.3). [Source: api/services/facebookAutomation.js#assertFacebookUrl]
- **Reuse the composer approach from `createSinglePost` (Story 2.4)** — it already finds the home-feed composer (`[aria-label*="What's on your mind"]`/`[aria-label*="Bạn đang nghĩ gì"]`), types, and submits. The group composer is the same widget on a group page; adapt the selectors (group composer prompt text differs: "Write something..."/"Viết gì đó...") + fallback chain. Reuse the non-empty-content guard verbatim. [Source: api/services/facebookAutomation.js#createSinglePost / createFacebookPost:625-671; 2-4-create-post.md]
- **Reuse the duplicate-URL dedupe guard** added in 4.2's shareFacebookPosts (`new Set(urls).size !== urls.length`). [Source: api/services/facebookAutomation.js#shareFacebookPosts]

### Lessons applied (Stories 4.1–4.4)

- **runGuardedBatch owns no-abort** — its per-item try/catch already continues past a failing item (4.1 P4 lesson baked in). Don't re-implement; just test it (FR-19 "nhóm thất bại không abort batch").
- **batchLimit > maxBatch semantics** — runGuardedBatch's `maxBatch` default is 20; FR-19 wants a STRICTER 10-group default with explicit `force` to exceed. Enforce the 10-cap in `postToFacebookGroups` BEFORE delegating; do not weaken runGuardedBatch's 20-cap. With `force:true` you still can't exceed 20 unless `maxBatch` is also raised — document this.
- **30s floor is a non-tunable invariant** (NFR-6) — clamp up, never down, same as 4.4. SM-C3 counter-metric: don't speed up group posting under throughput pressure.
- **UNVERIFIED selectors = real-path is a live-verify item** — like 4.2's share-to-Feed and 4.4's join button, the group composer selectors need a live session. Track in selectors-facebook.md; tests use injected `postFn` so they don't depend on real selectors. The story can reach `review` with unit tests green; live-DOM correctness is a separate verify pass.
- **No silent success** (4.2 review) — `postToSingleGroup` should confirm the post fired (or at least throw on composer-not-found); don't return `{posted:true}` unconditionally. Note the `createFacebookPost` deferred caveat: Facebook composer submits via XHR without navigation, so a post-success confirmation selector is itself UNVERIFIED — tie to the live-verify item, do not fake metrics.
- **Account-risk warning mandatory + non-suppressible** for FR-19 (NFR-8) — comes from runGuardedBatch; never add a silence flag.

### Project Structure Notes

- MODIFY: `api/services/facebookAutomation.js` (add `postToSingleGroup` + `postToFacebookGroups` + `GROUP_POST_BATCH_LIMIT` + default-export entry), `docs/agents/selectors-facebook.md` (extend Groups section with composer selectors).
- NEW: test file under `tests/services/` mirroring the 4.4 join-groups test layout.
- No CLI/MCP/REST surface this story. No Prisma model. Reuses existing `Operation` only if the dev wants progress tracking (optional, injectable seam like 4.1/4.3 — not required by FR-19 ACs).
- ⚠️ Same shared-file caution as 4.4: 4.5 adds to `facebookAutomation.js`. Run the full automate suite to confirm no regression (though 4.5 is purely additive, not modifying runGuardedBatch).

### Critical context

- Node.js, ESM. `// by nichxbt`; emoji log prefixes.
- Tests: Vitest 4.x, Node env, **no mocks/stubs/fakes** — fake page + injected `postFn`/`delay`-spy seams. Delay spy records args; tests never sleep 30s.
- `tests/x402-integration.test.js` ECONNREFUSED failures are pre-existing/unrelated.
- Cluster-1 medium risk: dryRun default true, mandatory warning, 30s floor, batchLimit 10. Mass group posting is a prime spam-detection trigger — the 10-cap + 30s floor are safety invariants.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.5: Batch post to multiple groups]
- [Source: _bmad-output/planning-artifacts/prds/prd-XActions-2026-06-10-epic4/prd.md#FR-19, §7 NFR-6/NFR-7/NFR-8, §8 SM-7/SM-C3, UJ-6]
- [Source: api/services/facebookAutomation.js#joinFacebookGroups (clone template), #createFacebookPost/createSinglePost (composer reuse), #assertFacebookUrl, #GROUP_ACTION_DELAY_FLOOR_MS]
- [Source: _bmad-output/implementation-artifacts/4-4-join-groups.md (delay floor + capture-Map + UNVERIFIED-selector posture), 4-2-auto-share-post.md (dedupe guard), 2-4-create-post.md (composer + content guard + postUrl caveat)]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

- 2026-06-16: Story 4.5 created (context engine). Status → ready-for-dev. (Luisphan)
