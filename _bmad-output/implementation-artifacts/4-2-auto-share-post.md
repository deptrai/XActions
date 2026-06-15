---
baseline_commit: f776adf9e01a1819135e7e3417fb10e66a47d54a
---

# Story 4.2: Auto-share Facebook post (dry-run default)

Status: review

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

## Review Findings

> Code review 2026-06-15 (3-layer adversarial: blind / edge-case / acceptance-auditor). Implementation = commit 2a0f23b. Verified against diff + `messengerShare.js` (live-VERIFIED 2026-06) + `runGuardedBatch` source before triage. Test assertions confirmed to match runGuardedBatch's real preview/result/error shapes.

### Decision needed

- [ ] [Review][Decision][CRITICAL] **Wrong dialog — the reused `share_button` selector opens the Messenger recipient dialog, NOT a Feed-share menu with a "Share now" item.** `messengerShare.js` (VERIFIED live 2026-06, lines 32–52) documents that clicking `div[data-ad-rendering-role="share_button"]` opens an in-page dialog of *Messenger recipient avatars* — there is NO `[role="menuitem"]` "Share now → Feed" item in that dialog. So `shareSinglePost`'s entire second phase (`shareNowSelectors` + the `evaluateHandle` text fallback) can never match → the real DOM path always throws `"Share now" action not found`. The story spec flagged the "Share now" *selector* as UNVERIFIED, but the deeper issue is the *entry point*: share-to-own-timeline is a different Facebook surface (likely the post `…` overflow menu, or the share dialog's "Share to Feed" tab) than the Messenger quick-send dialog. This cannot be resolved from code — it needs a live Facebook session to find the correct entry point + selectors. **Options:** (1) defer the live-DOM correctness to a verify pass (track in `selectors-facebook.md`, keep story in-progress until verified) — matches how `messengerShare.js` itself was verified later; (2) re-investigate the correct entry point now on a live session before merging; (3) accept the code as scaffold with UNVERIFIED selectors and a known-throws real path. The patchable code-quality findings below are independent of this and can be fixed regardless. [api/services/facebookAutomation.js#shareSinglePost; src/scrapers/facebook/messengerShare.js:32-52]

### Patch

- [ ] [Review][Patch][HIGH] `JSHandle.click()` throws TypeError on the text-fallback path — `page.evaluateHandle(...)` returns a `JSHandle`, which has no `.click()` (that's an `ElementHandle` method). When the aria selectors miss and the text fallback resolves, `await shareNowEl.click()` throws `TypeError: shareNowEl.click is not a function` → every URL in the batch fails. Fix: `const el = shareNowEl.asElement(); if (!el) throw ...; await el.click();` (or `await page.evaluate((n) => n.click(), shareNowEl)`). [api/services/facebookAutomation.js#shareSinglePost ~line 106]
- [ ] [Review][Patch][HIGH] `[aria-label*="Share"]` / `[aria-label*="Chia sẻ"]` fallbacks over-match — substring match hits "Share to Story", "Share to Reel", header-nav Share, "Chia sẻ lên Tin", etc. The combined `waitForSelector` resolves on the first match and `page.$` may click the wrong button → silent no-op share. Fix: drop these fallbacks (the `data-ad-rendering-role` selectors are precise + verified) or scope them to the post action-bar container. [api/services/facebookAutomation.js#shareSinglePost ~lines 37-38]
- [ ] [Review][Patch][HIGH] Silent success — `shareSinglePost` returns `{ shared: true }` immediately after `click()` + `sleep(500)` with no verification; a Facebook error toast (rate-limit, already-shared, session expired) is reported as success (same class as story 4.1 P2). Fix: after click, race a success vs error indicator (best-effort) and throw on detected error; at minimum `console.warn` on unknown outcome. NOTE: the success/error selectors are themselves UNVERIFIED → couple this fix with the live-verify defer. [api/services/facebookAutomation.js#shareSinglePost ~line 109]
- [ ] [Review][Patch][MEDIUM] `alreadyShared` is dead code on the real path — `shareSinglePost` never returns `alreadyShared`, so the capture-Map merge (`captured.alreadyShared !== undefined`) never fires in production; the passing test only exercises the injected fake. Fix: either implement real detection (mirror `findLikeButton`'s already-liked check — look for a "Remove Share"/shared-state indicator) and tie to the live-verify defer, OR remove the dead merge + drop `alreadyShared` from the return type and the test until detection exists. [api/services/facebookAutomation.js#shareFacebookPosts ~lines 154-162]
- [ ] [Review][Patch][MEDIUM] `evaluateHandle` text fallback over-matches — node set includes `div[role="none"] span` and the condition uses `t.includes(l)`, so it can return a non-interactive inner span or a superset-text container (e.g. "Don't Share now") → no-op click. Fix: strict equality `t === l` only, and narrow the query to `[role="menuitem"], [role="button"]`. [api/services/facebookAutomation.js#shareSinglePost ~lines 87-92]
- [ ] [Review][Patch][MEDIUM] Duplicate URLs collide in `capturedResults` Map — keyed by URL string, so `['…/p/1','…/p/1']` loses the first result (last-write-wins) and both result rows read the second's capture. Fix: dedup `postUrls` up front (`if (new Set(postUrls).size !== postUrls.length) throw`) or key the Map by index. [api/services/facebookAutomation.js#shareFacebookPosts ~lines 142-162]
- [ ] [Review][Patch][MEDIUM] No URL scheme/host validation (AC4.10 gap + SSRF) — `postUrls` entries pass the `typeof string` check then go straight to `page.goto`, so `file:///…`, `http://169.254.169.254/…`, `javascript:…` all navigate. AC4.10 also wants malformed-but-string URLs recorded as failed items, not crashes. Fix: per-entry `new URL(u)` in try/catch, require `https?:` scheme + `*.facebook.com` host, reject otherwise (before browser). [api/services/facebookAutomation.js#shareFacebookPosts ~lines 129-134]
- [ ] [Review][Patch][MEDIUM] Swallowed catch hides frame-destroyed/navigation errors — the `catch (_) {}` around the "Share now" `waitForSelector` swallows ALL errors (including "Execution context was destroyed" from a redirect), then falls through to a misleading generic throw. Fix: only swallow Puppeteer `TimeoutError`; re-throw others. [api/services/facebookAutomation.js#shareSinglePost ~line 77]
- [ ] [Review][Patch][LOW] Misleading `if (shareNowEl)` guard — comment acknowledges `evaluateHandle` returns a JSHandle-wrapping-null (never falsy), yet guards the null-check behind `if (shareNowEl)`. Works today only via the `.catch(() => true)`, but fragile. Fix: drop the `if` wrapper, always run the null-evaluate. [api/services/facebookAutomation.js#shareSinglePost ~lines 96-99]

### Deferred

- [x] [Review][Defer][HIGH] Live-DOM verification of the share-to-Feed flow — the correct entry point + "Share now"/success/error/already-shared selectors all require a live Facebook session to confirm. Already tracked in `docs/agents/selectors-facebook.md` verify-checklist ("Share now → Feed … UNVERIFIED"). Couples with the decision above and the silent-success + alreadyShared patches. — deferred, needs live session (matches the messengerShare.js verify-later pattern)
- [x] [Review][Defer][LOW] `likeFacebookPosts` shares the same duplicate-URL Map-collision latent bug and lacks the up-front `postUrls` validation the new `shareFacebookPosts` adds. Pre-existing, not caused by this change. — deferred, pre-existing; fix the family together later.

### Dismissed (verified within tolerance / by design)

- Test "no mocks" concern → `makeFakePage`/`makeShareFn` are hand-written data seams, explicitly sanctioned by AC7.15 (same pattern as like/comment tests). Not a violation.
- runGuardedBatch shape assertions (preview `{target,action:'pending'}`, `exceeds maxBatch`, `platform:'facebook'`) → all verified against source, correct.
- "shared page race on navigation timeout" → runGuardedBatch processes items sequentially with per-item try; a timeout is recorded and the next `goto` re-navigates. Within tolerance.

## Tasks / Subtasks

- [x] **Task 1: `shareSinglePost` helper** (AC2, AC4)
  - [x] Navigate to postUrl, locate Share button (reuse `messengerShare.js` verified selector + aria-label fallbacks), click
  - [x] Locate + click "Share now"/"Chia sẻ ngay" (UNVERIFIED — fallback chain by text+role), return `{ shared, alreadyShared? }`
  - [x] Combined single `waitForSelector`; clear throw if not found
- [x] **Task 2: `shareFacebookPosts` entry** (AC1, AC3)
  - [x] Export + add to default export; `shareFn` nullish-coalesce seam; route through `runGuardedBatch`
  - [x] Capture-Map for `alreadyShared` → merge into real-run results (copy `likeFacebookPosts` post-process block)
- [x] **Task 3: Input validation** (AC4)
  - [x] Reject non-array/empty `postUrls` and non-string entries before the batch
- [x] **Task 4: Selector docs** (AC6)
  - [x] Add Share section to `docs/agents/selectors-facebook.md` (VERIFIED vs UNVERIFIED + verify-checklist)
- [x] **Task 5: Tests** (AC7)
  - [x] Browser-free unit tests (fake page + `shareFn` seam) covering all AC7 cases
  - [x] `npx vitest run <new test file>` green

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

claude-opus-4-8 (BMAD dev-story workflow)

### Debug Log References

- Test ban đầu giả định bad URL chỉ gọi `shareFn` 1 lần → fail (`maxRetry` mặc định của `runGuardedBatch` = 1 nên bad item được retry → 4 calls cho 3 URL). Sửa test: pass `maxRetry: 0` để khẳng định "một call/URL, batch không abort". Đây là hành vi guardrail ĐÚNG, không phải bug code.
- Module `facebookAutomation.js` import PrismaClient ở top-level (từ Story 4.1) → test cần `DATABASE_URL` để instantiate dù share test thuần browser-free; inject từ `.env` repo gốc khi chạy vitest.

### Completion Notes List

- **AC1–AC3 (`shareFacebookPosts`)**: clone gần như verbatim `likeFacebookPosts` — route `postUrls[]` qua `runGuardedBatch` (single chokepoint, KHÔNG custom loop). `shareFn` seam nullish-coalesce (`shareFn: null` vẫn fallback default — bài học story 2.4 HIGH). Capture-Map merge `alreadyShared` vào real-run results (copy pattern `alreadyLiked`). Dry-run default true → preview `{target, action:'pending'}`, không chạm browser.
- **AC2 (`shareSinglePost`)**: navigate → combined `waitForSelector` cho Share button (VERIFIED `div[data-ad-rendering-role="share_button"]` reuse từ messengerShare.js + aria fallbacks) → click → chờ dialog → "Share now"/"Chia sẻ ngay" (UNVERIFIED: aria selectors trước, rồi text-match fallback qua `evaluateHandle`). Throw rõ ràng PII-free nếu không thấy button hoặc action.
- **AC4 (validation)**: reject non-array/empty `postUrls` + non-string/blank entries TRƯỚC khi mở browser. Malformed URL trong batch → recorded as failed item (runGuardedBatch per-item try), không crash.
- **AC5 (safety)**: dry-run không goto/click (test khẳng định); account-risk warning + maxBatch 20 + delay seam đều inherit từ `runGuardedBatch`, không reimplement.
- **AC6 (docs)**: thêm section "Share / Auto-share (FR-16) — Epic 4" vào `selectors-facebook.md` (VERIFIED share button vs UNVERIFIED share-now) + verify-checklist item "Automate / Growth".
- **AC7 (tests)**: 10/10 pass (`tests/services/facebook-share.test.js`), no-mock (plain recording fns + injected shareFn). Full suite: 1321 pass, chỉ 9 fail pre-existing trong `x402-integration.test.js` (ECONNREFUSED — không liên quan).

### File List

- MODIFIED: `api/services/facebookAutomation.js` — thêm `shareSinglePost` + `shareFacebookPosts` + default-export entry
- MODIFIED: `docs/agents/selectors-facebook.md` — section Share/Auto-share + verify-checklist
- NEW: `tests/services/facebook-share.test.js` — 10 browser-free unit tests (AC7)

## Change Log

- 2026-06-15: Story 4.2 created (context engine). Status → ready-for-dev. (Luisphan)
- 2026-06-15: Story 4.2 implemented — `shareFacebookPosts` + `shareSinglePost` (clone của likeFacebookPosts, share-to-Feed DOM flow), input validation, selector docs, 10 browser-free tests. Status → review. (dev-story / claude-opus-4-8)
