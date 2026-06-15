---
baseline_commit: f776adf9e01a1819135e7e3417fb10e66a47d54a
---

# Story 4.2: Auto-share Facebook post (dry-run default)

Status: ready-for-dev

<!-- Epic 4 (Facebook Growth Automation, Cluster 3 — low risk). Source: epics.md#Story 4.2 + PRD prd-XActions-2026-06-10-epic4 FR-16. -->

## Story

As a growth marketer using XActions,
I want to auto-share one or more post URLs to my timeline,
so that I can amplify content reach with batch control.

## Context — what this story builds

Story 4.2 adds `shareFacebookPosts(page, postUrls, options)` — a near-clone of the existing `likeFacebookPosts`/`commentOnFacebookPosts` shape. It routes a list of post URLs through `runGuardedBatch`, navigating to each post and clicking Share → "Share now/Chia sẻ ngay" to repost to the operator's own timeline. NO new infra: the batch chokepoint, dry-run default, delay seam, and account-risk warning all come from `runGuardedBatch` (Story 2.1).

The one genuinely new piece is the **share DOM flow + its selectors**. Story 5.2 (`messengerShare.js`) already verified the post Share *button* selector live (`div[data-ad-rendering-role="share_button"]`), but it then routes into the *Messenger* dialog. This story needs the *other* branch of the same dialog — the "Share to Feed / Share now" action — which is NOT yet verified. Treat those selectors as UNVERIFIED with a fallback chain (NFR4) and document them in `docs/agents/selectors-facebook.md`.

## Acceptance Criteria

**AC1 — `shareFacebookPosts` entry point (mirror likeFacebookPosts)**
1. `shareFacebookPosts(page, postUrls, options = {})` is exported from `api/services/facebookAutomation.js` and added to its default export.
2. Routes through `runGuardedBatch(postUrls, actionFn, guardedOptions)` — the single batch chokepoint. NO custom mutate loop (NFR7/NFR-7).
3. `dryRun` defaults to `true` (inherited from `runGuardedBatch`); only explicit `dryRun: false` performs DOM shares (SM-4 / ADR-007).
4. Injectable `shareFn` seam (default `shareSinglePost`), applied with nullish-coalesce so an explicit `shareFn: null` still falls back to the default — same guard as `likeFn`/`commentFn`/`createPostFn` (story 2.4 HIGH finding). `const { shareFn: shareFnOpt, ...guardedOptions } = options; const shareFn = shareFnOpt ?? shareSinglePost;`

**AC2 — Single-share helper (the DOM write)**
5. Internal `shareSinglePost(page, postUrl)` async function: navigates to `postUrl` (`waitUntil:'networkidle2', timeout:30000`), opens the Share dialog, clicks the "Share now"/"Chia sẻ ngay" (share-to-Feed) action, returns `{ shared: boolean, alreadyShared?: boolean }`. Mirror `likeSinglePost`'s structure (navigate → small `sleep` → locate → act → brief `sleep`).
6. Selector strategy uses a combined `waitForSelector` (ONE wait for any locale, not 5s×N — the findLikeButton/findCommentInput lesson). Share button reuses the verified selector from `messengerShare.js`: `div[data-ad-rendering-role="share_button"]` (+ aria-label fallbacks `[aria-label*="Share"]`, `[aria-label*="Chia sẻ"]`). Then the "Share now" menu/dialog item by visible text (EN `Share now` / VI `Chia sẻ ngay`) + role fallback. These are UNVERIFIED — wrap in a fallback chain and a clear throw if none resolve.
7. If the share button or the "Share now" action is not found → throw a clear, PII-free error (`runGuardedBatch` catches + records it; the batch is NOT aborted — story 4.1 P4 lesson is built into runGuardedBatch's per-item try).

**AC3 — Result shape (dry-run preview + real)**
8. Dry-run preview entries: `{ target: postUrl, action: 'pending' }` (match like/comment preview shape) — no DOM interaction, browser is touched ONLY in the real branch.
9. Real-run `results` entries: `{ target: postUrl, ok, error?, alreadyShared? }`. `ok: true` means the share action fired. If the post was already shared / share unavailable, set `alreadyShared: true` via the same capture-Map pattern `likeFacebookPosts` uses for `alreadyLiked` (closure Map → merge into `results` after the batch).

**AC4 — Input validation (fail before browser)**
10. Validate `postUrls` is a non-empty array of strings before opening anything; reject an invalid/empty `postUrl` with a clear error BEFORE navigation (FR-16 consequence: "Nếu postUrl không hợp lệ hoặc post bị xóa: trả về lỗi rõ ràng trước khi mở browser"). A malformed URL inside the batch is recorded as a failed item, not a crash.

**AC5 — Safety (FR-9, NFR-6/8, ADR-007)**
11. No DOM write occurs under `dryRun=true` — assert in tests that `page.goto`/`page.click` are NOT called in dry-run.
12. Account-risk warning fires before the first real batch (inherited from `runGuardedBatch` — do not reimplement, do not suppress: NFR-8).
13. Default `maxBatch` from `runGuardedBatch` (20) applies; 1-3s delay between shares via the inherited `delay` seam (NFR-6/NFR1).

**AC6 — Selectors documented (NFR4)**
14. Add a "Share / Auto-share (FR-16) — Epic 4" section to `docs/agents/selectors-facebook.md` listing the share-button + "Share now" selectors, marked VERIFIED (share button, from Story 5.2) vs UNVERIFIED (share-now action — needs live confirm), with the verify-checklist entry.

**AC7 — Tests (browser-free, real implementations — no mocks/stubs/fakes)**
15. Unit tests in `tests/scrapers/` (or `tests/services/`) following the existing Facebook automate test style (fake `page` + injected `shareFn` seam; NO `vi.mock`):
    - dry-run returns preview entries (`action:'pending'`), invokes neither `shareFn` nor `page.goto`
    - `dryRun:false` calls `shareFn` once per URL with `(page, postUrl)`; success → `ok:true`
    - a share that throws (button not found) → `ok:false` with PII-free error, batch continues to remaining URLs
    - `alreadyShared` surfaces into the matching result entry
    - empty/invalid `postUrls` → throws before any navigation
    - batch over `maxBatch` is bounded (inherited guardrail behavior holds)
16. Vitest 4.x, `npx vitest run <file>`. Browser-free via injected `shareFn`. No real network.

## Tasks / Subtasks

- [ ] **Task 1: `shareSinglePost` helper** (AC2, AC4)
  - [ ] Navigate to postUrl, locate Share button (reuse `messengerShare.js` verified selector + aria-label fallbacks), click
  - [ ] Locate + click "Share now"/"Chia sẻ ngay" (UNVERIFIED — fallback chain by text+role), return `{ shared, alreadyShared? }`
  - [ ] Combined single `waitForSelector`; clear throw if not found
- [ ] **Task 2: `shareFacebookPosts` entry** (AC1, AC3)
  - [ ] Export + add to default export; `shareFn` nullish-coalesce seam; route through `runGuardedBatch`
  - [ ] Capture-Map for `alreadyShared` → merge into real-run results (copy `likeFacebookPosts` post-process block)
- [ ] **Task 3: Input validation** (AC4)
  - [ ] Reject non-array/empty `postUrls` and non-string entries before the batch
- [ ] **Task 4: Selector docs** (AC6)
  - [ ] Add Share section to `docs/agents/selectors-facebook.md` (VERIFIED vs UNVERIFIED + verify-checklist)
- [ ] **Task 5: Tests** (AC7)
  - [ ] Browser-free unit tests (fake page + `shareFn` seam) covering all AC7 cases
  - [ ] `npx vitest run <new test file>` green

## Dev Notes

### REUSE-FIRST mandate (do NOT reinvent)

- **Clone `likeFacebookPosts` almost verbatim** — same `postUrls[]` → `runGuardedBatch` shape, same `shareFn`/`likeFn` seam, same capture-Map for the `alreadyShared`/`alreadyLiked` field. The diff is only the per-URL DOM action (share instead of like). [Source: api/services/facebookAutomation.js#likeFacebookPosts / likeSinglePost]
- **Reuse the verified Share button selector** from `messengerShare.js`: `div[data-ad-rendering-role="share_button"]`. Do NOT invent a new one for the button itself. The "Share now → Feed" menu item is the only new selector to discover. [Source: src/scrapers/facebook/messengerShare.js#SELECTORS.shareButton]
- **`runGuardedBatch` owns** dry-run default, per-item try/catch (one bad URL doesn't abort the batch), delay seam, maxBatch, and the account-risk warning. Do NOT add your own loop, retry, or warning. [Source: api/services/facebookAutomation.js#runGuardedBatch]
- **Combined `waitForSelector`** for locale-aware lookups — one 5s wait for the joined selector list, never 5s×N sequential (the findLikeButton / findCommentInput fix). [Source: api/services/facebookAutomation.js#findLikeButton:220-226]

### Lessons applied (from Stories 2.2–2.4, 4.1)

- **Nullish-coalesce the injected fn** (`shareFn ?? shareSinglePost`) — destructuring defaults only catch `undefined`, so `shareFn: null` would otherwise NPE every item (story 2.4 HIGH).
- **Result-shape awareness** (story 4.1 P2) — a per-URL action that *returns* a failure instead of throwing must be reflected as `ok:false`. Here `shareSinglePost` should THROW on not-found (runGuardedBatch records it); don't return a silent success object.
- **PII-free errors** — never echo cookie/URL secrets in thrown messages or results (NFR3). Share errors are about DOM state, keep them generic.
- **alreadyShared, like alreadyLiked** — a post already shared (or share disabled) is NOT a failure; surface it as `alreadyShared:true` with `ok:true`, via the closure-Map merge.

### Project Structure Notes

- MODIFY: `api/services/facebookAutomation.js` (add `shareSinglePost` + `shareFacebookPosts` + default-export entry), `docs/agents/selectors-facebook.md` (Share section).
- NEW: test file under `tests/` mirroring `2-2-auto-like` test layout.
- No CLI/MCP/REST surface in THIS story (FR-16 is the service function). A surface can be a follow-up; if added, keep dry-run default and delegate to the service.
- This is purely additive to the automate service — no change to scrape dispatcher, login, or scheduler.

### Critical context

- Node.js, ESM. Author credit `// by nichxbt`; emoji log prefixes (❌ ⚠️ ✅ 🔄).
- Tests: Vitest 4.x, Node env, 30s timeouts. **No mocks/stubs/fakes** — real functions + injected `shareFn` data seam. `tests/x402-integration.test.js` ECONNREFUSED failures are pre-existing and unrelated.
- Share-to-timeline is a lighter-risk action than friend requests, but it is still a write → dry-run default + account-risk warning are mandatory (NFR-8).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.2: Auto-share Facebook post]
- [Source: _bmad-output/planning-artifacts/prds/prd-XActions-2026-06-10-epic4/prd.md#FR-16, §7 NFR-6/NFR-8, §8 SM-4]
- [Source: api/services/facebookAutomation.js#likeFacebookPosts, likeSinglePost, runGuardedBatch — the clone template]
- [Source: src/scrapers/facebook/messengerShare.js#SELECTORS.shareButton — verified Share button selector]
- [Source: docs/agents/selectors-facebook.md#Automate selectors (FR-6,7,8) — Epic 2 — selector doc pattern]
- [Source: _bmad-output/implementation-artifacts/2-2-auto-like.md — like automation precedent + test layout]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

- 2026-06-15: Story 4.2 created (context engine). Status → ready-for-dev. (Luisphan)
