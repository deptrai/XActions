# Story 5.2: Messenger share automation (CORE)

Status: ready-for-dev

<!-- Port from SST_TOOL_FB Main.cs:Post() 582-799 → XActions. Plan: facebook-messenger-port-plan.md (Epic 5, Story 5.2). -->

## Story

As a multi-account operator using XActions,
I want to share a Facebook post to target Pages via Messenger with a dry-run preview,
so that I can run share campaigns at scale with safety guardrails.

This is the **CORE** story of the Messenger Port — the net-new capability C# has that XActions didn't. It consolidates:
- **(a) Share post → page via Messenger** (find share button, click "via Messenger", select target)
- **(b) Compose & send message** (random `**` segments, line-by-line Shift+Enter, emoji strip, detect blocked)
- **(c) Batch campaign entry point** (`messengerShareCampaign` routing through `runGuardedBatch`)

## Context — C# source (Main.cs:Post() 582-799)

The C# flow for a single share:
1. Navigate to the post link (from `txtlinkss.txt`)
2. Find share button: `div[role='button']:has(div[data-ad-rendering-role='share_button'])` → xpath fallbacks
3. Click share → dialog opens
4. Find "via Messenger" button: `div[role='button'][aria-label*='Messenger']` → xpath fallbacks → iterate all matching by aria-label, dedup via clickedList
5. If "More share options" visible: click it, re-find Messenger buttons
6. Target page selected (via the Messenger recipient dialog)
7. Type message into `div[contenteditable="true"][style*="font-size: 15px"]` — line-by-line with Shift+Enter, strip emoji surrogates `\p{Cs}`
8. If `**` delimiter in content: split, pick random segment
9. Click send: xpath or JS fallback (`document.querySelectorAll('i[data-visualcompletion="css-img"]')` → last icon → parent button click)
10. Wait configurable delay; detect `span:has-text('Couldn\'t send')` → mark "Bị Chặn" (blocked)

## Acceptance Criteria

**AC1 — Single-share helper (DOM write)**
1. `shareToMessenger(page, postUrl, targetPageId, message, options)` is the internal DOM helper. Navigates to postUrl, finds share button (fallback chain), clicks "via Messenger", selects target page, composes message, sends.
2. Returns `{ shared: boolean, blocked: boolean }`. `blocked: true` when "Couldn't send" detected.
3. Selector fallback chain documented in `docs/agents/selectors-facebook.md` new section "Messenger Share" — all UNVERIFIED until live-tested.
4. Message composition: supports `**`-delimited random segment selection (pick one); types line-by-line using Shift+Enter for newlines; strips emoji surrogates regex `\p{Cs}`.

**AC2 — Batch campaign entry point (REUSE-FIRST)**
5. `messengerShareCampaign(page, targets, options)` exported from `api/services/facebookAutomation.js`. `targets` = array of `{ targetPageId, postUrl, message }`.
6. Routes through `runGuardedBatch(targets, shareFn, options)` — **NO custom loop** (ADR-012, REUSE-FIRST mandate).
7. `dryRun` defaults `true` (inherited from runGuardedBatch strict gate). Only explicit `dryRun: false` enables real shares.
8. **ADR-012 delay**: messenger-share uses a HIGHER delay floor than like/comment (min 5s, jitter up to 15s) — NOT the default 1-3s. Pass custom `delay` config to `runGuardedBatch`.
9. ToS/account-risk warning fires before EVERY real batch (inherited from guardrail + additional Messenger-specific warning per ADR-012).

**AC3 — Message composition helpers (pure, testable)**
10. `pickRandomSegment(text)` — split on `**`, pick random segment, trim. If no `**` → return full text. Pure, exported.
11. `stripEmojiSurrogates(text)` — remove chars matching `\p{Cs}` (or equivalent Unicode surrogate regex). Pure, exported.
12. `typeMessage(page, text)` — types text line-by-line (split on `\n`) with Shift+Enter between lines. Injectable `delay` seam between lines.

**AC4 — Integration with Story 5.1 (pre-share checks)**
13. Before sharing, call `checkMessengerCTA(targetPageId, uid, tokens)` (from `graphql.js`) to verify target eligibility. Skip ineligible targets (mark in result as `{ skipped: true, reason: 'CTA ineligible' }`).
14. Tokens obtained via `getFacebookTokens(cookie)` once per session (not per-target).

**AC5 — Safety (ADR-012, NFR3)**
15. No DOM write under `dryRun=true` — tests verify no `page.click` / `page.keyboard` in dry-run.
16. Cookie/token values never logged (NFR3).
17. `shareFn` injectable via `options.shareFn` (DI seam for browser-free tests — same pattern as `likeFn` in Story 2.2).
18. Detect "Couldn't send" → `{ shared: false, blocked: true }`. Do NOT retry blocked targets.

**AC6 — Tests**
19. Browser-free tests via `options.shareFn` spy:
    - dry-run → no shareFn invocation, preview returned
    - `dryRun: false` → shareFn invoked per target with higher delay
    - blocked target → `shared: false, blocked: true`, no retry
    - over-maxBatch → throws (inherited)
    - CTA ineligible → skipped
20. Pure function tests: `pickRandomSegment`, `stripEmojiSurrogates` (fixture-based).
21. Integration: `messengerShareCampaign` calls `checkMessengerCTA` before `runGuardedBatch` (mock both via seams).

## Tasks / Subtasks

- [ ] **Task 1: Message composition helpers** (AC3)
  - [ ] `export function pickRandomSegment(text)` — split on `**`, random pick, trim. Return full text if no delimiter.
  - [ ] `export function stripEmojiSurrogates(text)` — regex `/[\uD800-\uDFFF]/g` or `\p{Cs}` (Node 18+ with `/u` flag).
  - [ ] `async function typeMessage(page, text, options)` — split `\n`, Shift+Enter between lines, injectable delay seam between lines.
- [ ] **Task 2: shareToMessenger DOM helper** (AC1)
  - [ ] Navigate to postUrl, `randomDelay`
  - [ ] Share button fallback chain: `[data-ad-rendering-role='share_button']` parent button → aria-label fallback → xpath
  - [ ] "via Messenger" button: `[aria-label*='Messenger']` → "More share options" fallback
  - [ ] Target page selection in Messenger dialog (search/click target)
  - [ ] Compose: `pickRandomSegment` → `stripEmojiSurrogates` → `typeMessage` into contenteditable
  - [ ] Send button: aria-label or JS fallback (last icon parent)
  - [ ] Detect "Couldn't send" → return `{ shared: false, blocked: true }`
  - [ ] Document all selectors in `docs/agents/selectors-facebook.md` "Messenger Share" section (UNVERIFIED)
- [ ] **Task 3: messengerShareCampaign entry point** (AC2, AC4, AC5)
  - [ ] `export async function messengerShareCampaign(page, targets, options = {})`
  - [ ] Pre-share: `getFacebookTokens` once → for each target `checkMessengerCTA` → filter eligible
  - [ ] Build `shareFn` wrapping `shareToMessenger` (or `options.shareFn` DI)
  - [ ] Call `runGuardedBatch(eligibleTargets, shareFn, { ...options, delay: messengerDelay })` where `messengerDelay` = 5-15s jitter (ADR-012)
  - [ ] Add to `api/services/facebookAutomation.js` default export
- [ ] **Task 4: Tests** (AC6)
  - [ ] `pickRandomSegment` + `stripEmojiSurrogates` unit tests (pure)
  - [ ] `messengerShareCampaign` browser-free via `shareFn` spy + `fetchImpl` stub for CTA
  - [ ] Verify: dry-run no DOM, blocked no retry, CTA skip, delay ≥ 5s assertion
  - [ ] Run `npx vitest run tests/services/facebook-automation.test.js`

## Dev Notes

### CRITICAL — this is the highest-risk write in the entire project (ADR-012)

- **ADR-012 is non-negotiable**: Messenger mass-share = spam pattern. Delay floor 5-15s jitter (NOT the default 1-3s). ToS warning on every surface. Dry-run absolute default.
- **ADR-011 dependency**: Story 5.1 is DONE. `getFacebookTokens`, `getPagesFromCookie`, `checkMessengerCTA`, `buildCookieString` all available from `src/scrapers/facebook/graphql.js`. Import and use — do NOT re-implement.
- **Selectors are ALL UNVERIFIED**: This story's DOM selectors have NEVER been tested on a live Facebook page. Document them in selectors-facebook.md but do NOT claim they work. Dev must note which selectors were tested live vs assumed from C#.

### Previous Story Intelligence (Story 5.1 — done)

- `src/scrapers/facebook/graphql.js` provides: `getFacebookTokens(cookie)` → tokens, `checkMessengerCTA(pageId, actorId, tokens)` → `{ eligible }`, `buildCookieString({c_user, xs})` → cookie string.
- `fetchImpl` seam pattern proven — reuse for any HTTP needs in this story.
- `buildCookieString` encodes values with `;`/`=` (review fix from 5.1).
- All functions return graceful fallbacks (null/false/[]) on failure — check return values.

### REUSE-FIRST — what you inherit for free

| Infrastructure | Source | What it gives you |
|---|---|---|
| `runGuardedBatch` | `api/services/facebookAutomation.js` | dry-run gate, delay seam, bounded batch, shouldStop, onProgress, account-risk warning |
| `likeFacebookPosts` pattern | same file | DI pattern: `options.shareFn` injectable, `capturedResults` Map for per-target metadata |
| `loginWithCookie` | `src/scrapers/facebook/index.js` | cookie auth |
| Puppeteer + Stealth | `createBrowser`/`createPage` | anti-detection browser |
| `NON_PROFILE_SEGMENTS` | `src/scrapers/facebook/index.js` | shared constant for link-filtering (if needed for target search) |

### C# selector chain — port reference (ALL UNVERIFIED)

```
Share button:
  1. div[role='button']:has(div[data-ad-rendering-role='share_button'])
  2. xpath: //div[@data-ad-rendering-role='share_button']/..
  
"via Messenger" button:
  1. div[role='button'][aria-label*='Messenger']
  2. xpath fallbacks (multiple, dedup by aria-label via clickedList)
  3. "More share options" span → click → re-find Messenger buttons

Message input:
  div[contenteditable="true"][style*="font-size: 15px"]

Send button:
  1. xpath send icon
  2. JS: document.querySelectorAll('i[data-visualcompletion="css-img"]') → last → parent.click()

Blocked detection:
  span:has-text('Couldn\'t send')
```

### Messenger delay config (ADR-012)

```js
// Custom delay for messenger-share — NOT the default 1-3s from like/comment
const messengerDelay = (min = 5000, max = 15000) => randomDelay(min, max);
// Pass to runGuardedBatch: { delay: messengerDelay }
```

### Message composition — port logic

```
1. Read message from options.message (or targets[i].message)
2. If contains "**" → split("**"), pick random segment (Math.random)
3. Strip emoji surrogates: text.replace(/[\uD800-\uDFFF]/g, '') or /\p{Cs}/gu
4. Split on "\n" → type each line, Shift+Enter between
5. Final Enter or click send button
```

### Lessons from all previous reviews — apply ALL

- **Delay seam MANDATORY** (1.3 BLOCKER): `options.delay` default to `messengerDelay`.
- **Test mocks exercise REAL logic** (1.4 BLOCKER): spy `shareFn`, don't mock `runGuardedBatch`.
- **Injectable DI for DOM fn** (2.2 pattern): `options.shareFn = shareToMessenger` default, tests pass spy.
- **null-guard** (2.1/2.2 class): `shareFn ?? shareToMessenger` (nullish-coalesce, not destructuring default).
- **blocked = no retry** (new): `shouldStop` check or filter blocked targets before next iteration.
- **Selector docs honest** (all of Epic 1): UNVERIFIED = UNVERIFIED. Period.

### Project Structure Notes

- UPDATE: `api/services/facebookAutomation.js` — add `messengerShareCampaign`, `shareToMessenger`, `pickRandomSegment`, `stripEmojiSurrogates`, `typeMessage`. Follow existing pattern (likeFacebookPosts → internal helper + exported entry point).
- UPDATE: `docs/agents/selectors-facebook.md` — new section "Messenger Share" with C# selector chain, UNVERIFIED.
- UPDATE: `tests/services/facebook-automation.test.js` — add messenger tests.
- IMPORT from `src/scrapers/facebook/graphql.js`: `getFacebookTokens`, `checkMessengerCTA`, `buildCookieString`.
- No new files needed (fits within existing service module).

### Critical context

- Node.js, ESM, Puppeteer (server-side for real runs; tests are browser-free via shareFn spy).
- Never log cookies/tokens (NFR3).
- `dryRun` strict gate (only `=== false` enables real) — already enforced by runGuardedBatch.
- This story DOES need a live Facebook session to verify selectors — mark all as UNVERIFIED until tested.

### Testing standards

- Vitest 4.x. Browser-free via `shareFn` spy + `fetchImpl` stub (for CTA mock). Pure function tests for composition helpers. Delay assertion: verify `options.delay` passed to runGuardedBatch is ≥ 5000ms min.

### References

- [Source: _bmad-output/planning-artifacts/facebook-messenger-port-plan.md#Epic 5, Story 5.2]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.2]
- [Source: _bmad-output/planning-artifacts/architecture.md#Addendum C, ADR-011/ADR-012]
- [Source: SST_TOOL_FB/Main.cs:582-799 — share button + Messenger + compose + send flow]
- [Source: api/services/facebookAutomation.js — runGuardedBatch + likeFacebookPosts DI pattern]
- [Source: src/scrapers/facebook/graphql.js — getFacebookTokens/checkMessengerCTA (Story 5.1)]
- [Source: docs/agents/selectors-facebook.md — existing selector sections + verify checklist]
- [Source: _bmad-output/implementation-artifacts/5-1-graphql-layer.md — previous story review lessons]

## Dev Agent Record

### Agent Model Used

(to be filled by dev agent)

### Debug Log References

### Completion Notes List

### File List
