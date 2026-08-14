---
baseline_commit: 191dd7f46eb8eb6b26d9c4e1061b11543743a705
---

# Story 6.2: Consistent Session Fingerprint

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer using the Facebook automation scraper,
I want each automation session to generate ONE fingerprint object (UA + viewport + hardware config) and reuse it for every page/tab/navigation in that session,
so that Facebook does not detect fingerprint changes mid-session (a primary bot-detection signal per ADR-013).

## Acceptance Criteria

1. **AC1 — Fingerprint module exists and is pure**
   - **Given** the new module `src/scrapers/facebook/fingerprint.js`
   - **When** it is imported
   - **Then** it exports `UA_POOL`, `VIEWPORT_LIST`, `generateFingerprint`, `applyFingerprint`
   - **And** the module does NOT import `puppeteer` or `puppeteer-extra` (pure module per ADR-013/D.2)

2. **AC2 — `generateFingerprint()` returns a complete fingerprint object**
   - **Given** `generateFingerprint()` is called with no args
   - **When** it returns
   - **Then** the result is `{ ua, viewport, deviceScaleFactor, hardwareConcurrency, deviceMemory, platform }`
   - **And** `ua` is a non-empty string picked from `UA_POOL`
   - **And** `viewport` is `{ width, height }` picked from `VIEWPORT_LIST` (width/height are positive integers)
   - **And** `deviceScaleFactor` is one of `[1, 2]`
   - **And** `hardwareConcurrency` is one of `[4, 6, 8]`
   - **And** `deviceMemory` is one of `[2, 4, 8]`
   - **And** `platform` is derived from the chosen `ua` (`Win32` for Windows UA, `MacIntel` for macOS UA, `Linux x86_64` for Linux UA)
   - **And** two consecutive calls return DIFFERENT fingerprints with high probability (randomization works)

3. **AC3 — `applyFingerprint(page, fingerprint)` applies UA + viewport only**
   - **Given** a page object (real or fake) with `setUserAgent` and `setViewport` methods, and a fingerprint object
   - **When** `applyFingerprint(page, fp)` is called
   - **Then** `page.setUserAgent(fp.ua)` is called exactly once with `fp.ua`
   - **And** `page.setViewport({ width, height, deviceScaleFactor })` is called exactly once
   - **And** the function does NOT call `page.evaluateOnNewDocument` (navigator overrides are Story 6.4, NOT this story)
   - **And** the function does NOT touch WebRTC (Story 6.5)

4. **AC4 — `createPage()` generates and applies a fingerprint**
   - **Given** a browser instance
   - **When** `createPage(browser)` is called with no options
   - **Then** a fingerprint is generated via `generateFingerprint()`
   - **And** `applyFingerprint(page, fp)` is called before the page is returned
   - **And** the page is returned (existing contract preserved)

5. **AC5 — `createPage()` accepts an explicit fingerprint for session reuse**
   - **Given** a browser instance and a previously generated fingerprint `fp`
   - **When** `createPage(browser, { fingerprint: fp })` is called
   - **Then** `generateFingerprint()` is NOT called (the provided fingerprint is reused)
   - **And** `applyFingerprint(page, fp)` is called with the SAME fingerprint object
   - **And** the page is returned

6. **AC6 — Session context exposes the fingerprint for cross-tab reuse**
   - **Given** a page created by `createPage(browser, options)`
   - **When** the caller inspects the result
   - **Then** the fingerprint is retrievable (e.g., `page._fingerprint` or returned in a wrapper — see Dev Notes for the chosen mechanism)
   - **And** a second `createPage(browser, { fingerprint: firstFp })` call produces a page with the SAME `ua` and `viewport` as the first

7. **AC7 — No regression in existing `createPage` callers**
   - **Given** existing callers that call `createPage(browser)` with no options
   - **When** the new fingerprint logic runs
   - **Then** no caller breaks (the function signature is backward-compatible — `options` is optional)
   - **And** existing tests in `tests/scrapers/facebook-index.test.js` still pass

8. **AC8 — Fingerprint is never logged**
   - **Given** any code path in `fingerprint.js` or the modified `createPage`
   - **When** an error occurs or a response is built
   - **Then** the fingerprint seed/UA/viewport is NOT included in error messages or API responses (NFR4)

## Tasks / Subtasks

- [x] **Task 1: Create `src/scrapers/facebook/fingerprint.js`** (AC: #1, #2, #3, #8)
  - [x] 1.1 Add BSL 1.1 copyright header + `// by nichxbt` author credit (match `proxy.js` header style)
  - [x] 1.2 Define `UA_POOL` — seed with 5 real Chrome UAs (current stable versions, verified Aug 2026):
    - Windows Chrome (2 variants — different minor versions)
    - macOS Chrome (2 variants)
    - Linux Chrome (1 variant)
    - **Note:** Story 6.3 will expand this to 20+. Do NOT do that here.
  - [x] 1.3 Define `VIEWPORT_LIST` — seed with 5 realistic desktop viewports:
    - `{ width: 1920, height: 1080 }`, `{ width: 1536, height: 864 }`, `{ width: 1440, height: 900 }`, `{ width: 1366, height: 768 }`, `{ width: 1280, height: 800 }`
  - [x] 1.4 Implement `generateFingerprint()`:
    - Pick random `ua` from `UA_POOL`
    - Pick random `viewport` from `VIEWPORT_LIST`
    - Pick random `deviceScaleFactor` from `[1, 2]`
    - Pick random `hardwareConcurrency` from `[4, 6, 8]`
    - Pick random `deviceMemory` from `[2, 4, 8]`
    - Derive `platform` from `ua`: `Win32` if UA contains `Windows`, `MacIntel` if `Mac OS X`, `Linux x86_64` if `Linux`
    - Return `{ ua, viewport, deviceScaleFactor, hardwareConcurrency, deviceMemory, platform }`
  - [x] 1.5 Implement `applyFingerprint(page, fingerprint)`:
    - `await page.setUserAgent(fingerprint.ua)`
    - `await page.setViewport({ width: fingerprint.viewport.width, height: fingerprint.viewport.height, deviceScaleFactor: fingerprint.deviceScaleFactor })`
    - **Do NOT** add `evaluateOnNewDocument`, WebRTC, or navigator overrides (those are Stories 6.4 and 6.5)
  - [x] 1.6 Export all four symbols via `export`

- [x] **Task 2: Extend `createPage()` in `src/scrapers/facebook/index.js`** (AC: #4, #5, #6, #7, #8)
  - [x] 2.1 Add import: `import { generateFingerprint, applyFingerprint } from './fingerprint.js';`
  - [x] 2.2 Change signature from `createPage(browser)` to `createPage(browser, options = {})`
  - [x] 2.3 Inside `createPage`:
    - `const fingerprint = options.fingerprint ?? generateFingerprint();`
    - `await applyFingerprint(page, fingerprint);`
    - Attach fingerprint to page for caller retrieval: `page._fingerprint = fingerprint;`
    - Return `page` (preserve existing return contract)
  - [x] 2.4 REMOVE the existing hardcoded UA (`Chrome/120.0.0.0`) and the inline `setViewport`/`setUserAgent` calls — they are now handled by `applyFingerprint`
  - [x] 2.5 Preserve all other behavior in `createPage` (no other changes)

- [x] **Task 3: Tests — `tests/scrapers/facebook-fingerprint.test.js`** (AC: #1, #2, #3, #8)
  - [x] 3.1 Test `UA_POOL` is a non-empty array of strings, all containing `Chrome/` and `Mozilla/5.0`
  - [x] 3.2 Test `VIEWPORT_LIST` is a non-empty array of `{ width, height }` with positive integer width/height
  - [x] 3.3 Test `generateFingerprint()` returns the exact shape `{ ua, viewport, deviceScaleFactor, hardwareConcurrency, deviceMemory, platform }`
  - [x] 3.4 Test `generateFingerprint()` returns `ua` from `UA_POOL`
  - [x] 3.5 Test `generateFingerprint()` returns `viewport` from `VIEWPORT_LIST`
  - [x] 3.6 Test `deviceScaleFactor` ∈ `[1, 2]`, `hardwareConcurrency` ∈ `[4, 6, 8]`, `deviceMemory` ∈ `[2, 4, 8]`
  - [x] 3.7 Test `platform` derivation: Windows UA → `Win32`, Mac UA → `MacIntel`, Linux UA → `Linux x86_64`
  - [x] 3.8 Test two consecutive `generateFingerprint()` calls differ in at least one field (run 20 iterations, assert at least 2 distinct `ua` values appear)
  - [x] 3.9 Test `applyFingerprint(fakePage, fp)` calls `setUserAgent` once with `fp.ua` and `setViewport` once with `{ width, height, deviceScaleFactor }`
  - [x] 3.10 Test `applyFingerprint` does NOT call `evaluateOnNewDocument` (assert the method is not invoked)

- [x] **Task 4: Extend `tests/helpers/fake-page.js`** (AC: #3, #4, #5)
  - [x] 4.1 Add `setUserAgent` and `setViewport` methods to the fake page that record calls in `calls.setUserAgent` / `calls.setViewport` arrays
  - [x] 4.2 Add `evaluateOnNewDocument` to `calls` recorder (so tests can assert it is NOT called)
  - [x] 4.3 Preserve all existing fake-page behavior (no regression)

- [x] **Task 5: Update `tests/scrapers/facebook-index.test.js`** (AC: #4, #5, #6, #7)
  - [x] 5.1 Add test: `createPage(browser)` calls `setUserAgent` and `setViewport` (via fake browser/page)
  - [x] 5.2 Add test: `createPage(browser, { fingerprint: fp })` reuses the provided fingerprint (does not call `generateFingerprint` — verify by checking `setUserAgent` received `fp.ua`)
  - [x] 5.3 Add test: `page._fingerprint` is set and matches the applied UA
  - [x] 5.4 Add test: existing `createPage(browser)` callers still work (backward compat — no options arg)

- [x] **Task 6: Run test suite and verify** (AC: all)
  - [x] 6.1 Run `vitest run tests/scrapers/facebook-fingerprint.test.js` — all pass (20/20)
  - [x] 6.2 Run `vitest run tests/scrapers/facebook-index.test.js` — all pass (no regression; 14 pre-existing failures in scrapeProfile/loginWithCookie/scrapeGroupMembers unrelated to fingerprint)
  - [x] 6.3 Run `vitest run tests/scrapers/` — all Facebook scraper tests pass (21 pre-existing failures, 0 new failures)
  - [x] 6.4 Run `vitest run` — full suite green (or only pre-existing failures remain)

## Dev Notes

### Architecture Compliance (ADR-013 — binding)

This story implements the **foundation** of ADR-013. Read `architecture.md` Addendum D, section D.3 ADR-013 before coding. Key invariants:

- `fingerprint.js` is a **pure module** — it MUST NOT import `puppeteer`, `puppeteer-extra`, or any browser library. It receives `page` as a parameter to `applyFingerprint`. This makes it unit-testable without a real browser (matches the pattern in `proxy.js` which is also pure-ish and tested via `tests/scrapers/facebook-proxy.test.js`).
- `generateFingerprint()` returns the EXACT shape `{ ua, viewport, deviceScaleFactor, hardwareConcurrency, deviceMemory, platform }` — Stories 6.4 (navigator override) and 6.5 (WebRTC) will consume this same object. Do not add or rename fields.
- One fingerprint per session, reused across tabs — do NOT randomize mid-session. The consistency mechanism is the whole point of this story.

### Scope Boundaries — STRICT (do NOT cross)

| In scope (Story 6.2) | Out of scope (later stories) |
|---|---|
| `fingerprint.js` module skeleton + 4 exports | UA pool expansion to 20+ (Story 6.3) |
| Seed `UA_POOL` with ~5 real UAs | Viewport randomization logic refinement (Story 6.3) |
| Seed `VIEWPORT_LIST` with 5 viewports | `navigator.webdriver`/`hardwareConcurrency`/`deviceMemory`/`platform`/`plugins` overrides via `evaluateOnNewDocument` (Story 6.4) |
| `generateFingerprint()` returns full object shape | WebRTC leak prevention / `--disable-webrtc` (Story 6.5) |
| `applyFingerprint()` applies UA + viewport only | Bezier mouse, human click, typing, scrolling (Stories 6.9–6.12) |
| `createPage()` accepts optional `fingerprint` | Velocity limits, account age, warming, timezone/geo, profiles (Stories 6.13–6.17) |
| Session context: `page._fingerprint` | — |

**Why the boundary:** Story 6.4 (navigator overrides) consumes the `platform`/`hardwareConcurrency`/`deviceMemory` fields this story generates, but applies them via `page.evaluateOnNewDocument`. If you apply them here, you will collide with 6.4 and break the dev agent for that story. Generate the values; do not apply them to the navigator yet.

### File Structure Requirements

| File | Action | Purpose |
|---|---|---|
| `src/scrapers/facebook/fingerprint.js` | NEW | Pure fingerprint module (ADR-013/D.2) |
| `src/scrapers/facebook/index.js` | UPDATE | Extend `createPage()` to use fingerprint (lines ~70-83 today) |
| `tests/scrapers/facebook-fingerprint.test.js` | NEW | Pure-module tests for fingerprint.js |
| `tests/scrapers/facebook-index.test.js` | UPDATE | Add createPage fingerprint integration tests |
| `tests/helpers/fake-page.js` | UPDATE | Add `setUserAgent`/`setViewport`/`evaluateOnNewDocument` recorders |

### Current State of `createPage()` (must replace, not duplicate)

The current `createPage(browser)` in `src/scrapers/facebook/index.js` (around lines 70-83) hardcodes:
```js
await page.setViewport({ width: 1280 + Math.floor(Math.random() * 100), height: 800 });
await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) ... Chrome/120.0.0.0 Safari/537.36');
```
This is the anti-pattern ADR-013 calls out: a single hardcoded UA + near-fixed viewport, randomized per page load (which means fingerprint CHANGES across tabs in the same session — exactly what Facebook detects). Replace both lines with the `applyFingerprint` call. Do not leave the old lines in place.

### Library / Framework Requirements

- **No new dependencies.** This story uses only built-in Node.js (`Math.random`) and the existing Puppeteer page API (`setUserAgent`, `setViewport`).
- **Stealth plugin:** already wired in `index.js` (`puppeteer.use(StealthPlugin())`). Do NOT reconfigure it — Story 6.4 will handle navigator overrides that complement stealth. This story does not touch stealth config.
- **ESM only** — `import`/`export`, no `require` (per `CLAUDE.md`).
- **`const` over `let`**, async/await, no `any`/`@ts-ignore` (per mandatory rules).

### Testing Standards

- Framework: **Vitest 4.x** (config in `vitest.config.js`). Run: `vitest run tests/scrapers/`.
- **No mocks/stubs/fakes that lie** — but `tests/helpers/fake-page.js` is a real state-machine fake (per project convention), not a mock. Extend it honestly.
- `fingerprint.js` is pure → testable without Puppeteer. `generateFingerprint` tests need no fake page. `applyFingerprint` tests need a fake page with `setUserAgent`/`setViewport`.
- Timeouts: 30s per test (per `CLAUDE.md`).
- Test file naming: `*.test.js` (matches existing `facebook-*.test.js` pattern in `tests/scrapers/`).

### Session Context Mechanism — Decision

Use `page._fingerprint = fingerprint` (attach to the page object). Rationale:
- Simplest backward-compatible approach — `createPage` still returns a `Page`, no wrapper type to introduce across all callers.
- Callers that want cross-tab reuse read `page._fingerprint` and pass it as `{ fingerprint }` to the next `createPage` call.
- The underscore prefix signals "internal/extension" — matches Puppeteer's own convention for non-public properties.
- Alternative considered: returning `{ page, fingerprint }` — rejected because it changes the return type and breaks every existing caller (`loginWithCookie`, `scrapeProfile`, `scrapeFollowers`, etc. all do `const page = await createPage(browser)`).

### Privacy (NFR4 — binding)

- Never log the fingerprint object, UA, or viewport in error messages.
- Never include fingerprint fields in API responses or operation results.
- If `applyFingerprint` throws, the error message must be generic (e.g., `"❌ Failed to apply fingerprint"`) — no `fp.ua` in the message.

### Project Context

- Author credit: `// by nichxbt` (mandatory per `AGENTS.md`).
- BSL 1.1 copyright header (match `src/scrapers/facebook/proxy.js` header style).
- Error messages use emoji prefixes: ❌ error, ✅ success (per `CLAUDE.md`).
- Vietnamese is the communication language; document output language is Vietnamese. Code comments and identifiers remain in English (matches existing codebase).

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#D.3 ADR-013] — Fingerprint randomization layer decision (binding)
- [Source: _bmad-output/planning-artifacts/architecture.md#D.2] — Code boundaries for new modules
- [Source: _bmad-output/planning-artifacts/epics-full.md#Story 6.2] — Story AC source
- [Source: _bmad-output/planning-artifacts/epics-full.md#Story 6.3] — UA pool expansion (next story, out of scope)
- [Source: _bmad-output/planning-artifacts/epics-full.md#Story 6.4] — Navigator overrides (out of scope, consumes this story's output)
- [Source: src/scrapers/facebook/index.js#createPage] — Current implementation to replace (lines ~70-83)
- [Source: src/scrapers/facebook/proxy.js] — Pattern reference for pure module + BSL header
- [Source: tests/helpers/fake-page.js] — Fake page to extend
- [Source: tests/scrapers/facebook-index.test.js] — Test pattern reference

## Dev Agent Record

### Agent Model Used

GLM-5.2 High (Devin CLI)

### Debug Log References

- `vitest run tests/scrapers/facebook-fingerprint.test.js` → 20/20 pass
- `vitest run tests/scrapers/facebook-index.test.js -t "createPage"` → 6/6 pass
- `vitest run tests/scrapers/` → 640 pass, 21 pre-existing failures (0 new)
- Pre-existing failures confirmed by stashing changes and re-running on baseline commit 191dd7f — same 14 failures in facebook-index.test.js + 7 in facebook-profile.test.js, all in scrapeProfile/loginWithCookie/scrapeGroupMembers (unrelated to fingerprint)

### Completion Notes List

- ✅ Created `src/scrapers/facebook/fingerprint.js` — pure module (no puppeteer import), exports `UA_POOL`, `VIEWPORT_LIST`, `generateFingerprint`, `applyFingerprint`
- ✅ `UA_POOL` seeded with 5 real Chrome UAs (Chrome 150-152, Windows/macOS/Linux variants)
- ✅ `VIEWPORT_LIST` seeded with 5 realistic desktop viewports (1920x1080, 1536x864, 1440x900, 1366x768, 1280x800)
- ✅ `generateFingerprint()` returns full shape `{ ua, viewport, deviceScaleFactor, hardwareConcurrency, deviceMemory, platform }` — platform derived from UA
- ✅ `applyFingerprint(page, fp)` applies ONLY setUserAgent + setViewport (scope boundary: no evaluateOnNewDocument, no WebRTC, no navigator overrides — those are Stories 6.4/6.5)
- ✅ `createPage(browser, options)` extended — generates fingerprint if not provided, reuses if passed via `options.fingerprint`, attaches `page._fingerprint` for cross-tab reuse
- ✅ Removed hardcoded `Chrome/120.0.0.0` UA and inline viewport randomization from `createPage` (replaced by `applyFingerprint`)
- ✅ NFR4 compliance: `applyFingerprint` catches errors and throws generic message without leaking fingerprint fields
- ✅ Extended `tests/helpers/fake-page.js` with `setUserAgent`, `setViewport`, `evaluateOnNewDocument`, `emulateTimezone`, `setGeolocation` recorders
- ✅ 20 new tests in `facebook-fingerprint.test.js` (pure module tests — no Puppeteer needed)
- ✅ 6 new tests in `facebook-index.test.js` (createPage integration with fake browser)
- ✅ Backward compatibility verified — `createPage(browser)` with no options still works
- ✅ Scope boundary enforced — `evaluateOnNewDocument` NOT called (asserted in tests)

### File List

- `src/scrapers/facebook/fingerprint.js` (NEW) — Pure fingerprint module (ADR-013)
- `src/scrapers/facebook/index.js` (MODIFIED) — Extended `createPage()` to use fingerprint, added import
- `tests/scrapers/facebook-fingerprint.test.js` (NEW) — 20 pure-module tests
- `tests/scrapers/facebook-index.test.js` (MODIFIED) — Added 6 createPage integration tests
- `tests/helpers/fake-page.js` (MODIFIED) — Added setUserAgent/setViewport/evaluateOnNewDocument/emulateTimezone/setGeolocation recorders

## Change Log

- 2026-08-12: Story 6.2 implemented — Consistent Session Fingerprint (ADR-013 foundation). Created pure `fingerprint.js` module, extended `createPage()` for session-consistent fingerprint generation and reuse, added 26 tests (all passing). No regressions introduced.

### Review Findings

- [x] [Review][Patch] Generic error swallows debugging context in applyFingerprint [src/scrapers/facebook/fingerprint.js:129-132] — catch block throws generic `Error('❌ Failed to apply fingerprint')` losing original error type/stack. Fix: use `Error` cause (`new Error('❌ Failed to apply fingerprint', { cause: err })`) to preserve debugging context without leaking fingerprint fields (NFR4 compliant).
- [x] [Review][Patch] Page leaked if applyFingerprint fails in createPage [src/scrapers/facebook/index.js:85-91] — if `applyFingerprint` throws after `browser.newPage()` succeeds, the page is never closed (resource leak). Also causes partial-fingerprint state if setUserAgent succeeds but setViewport fails. Fix: wrap in try-catch, call `page.close()` on failure before rethrowing.
