---
baseline_commit: 9822fe2164d14c007f8514b0fe2389a70ae70ea7
---

# Story 6.4: Navigator Properties Override

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer using the Facebook automation scraper,
I want to override `navigator` automation indicators via `page.evaluateOnNewDocument` using the session fingerprint's hardware config,
so that Facebook does not detect `navigator.webdriver`, mismatched `navigator.platform`, or missing `navigator.plugins` (per ADR-013, FR3).

## Acceptance Criteria

1. **AC1 — `applyNavigatorOverrides(page, fingerprint)` exists and is pure-in-scope**
   - **Given** the new function `applyNavigatorOverrides` exported from `src/scrapers/facebook/fingerprint.js`
   - **When** it is imported
   - **Then** it is a callable async function
   - **And** it does NOT import puppeteer (pure module — receives `page` as parameter, same as `applyFingerprint`)
   - **And** it accepts `(page, fingerprint)` where `fingerprint` is the object from `generateFingerprint()`

2. **AC2 — `navigator.webdriver` is set to `undefined`**
   - **Given** a page (real or fake) with `evaluateOnNewDocument` method
   - **When** `applyNavigatorOverrides(page, fp)` is called
   - **Then** `page.evaluateOnNewDocument` is called with a function that sets `navigator.webdriver = undefined`
   - **And** the override is applied BEFORE any page navigation (evaluateOnNewDocument runs on every new document)

3. **AC3 — `navigator.hardwareConcurrency` matches fingerprint**
   - **Given** a fingerprint with `hardwareConcurrency: 8` (or 4, or 6)
   - **When** `applyNavigatorOverrides(page, fp)` is called
   - **Then** the injected script sets `navigator.hardwareConcurrency` to `fp.hardwareConcurrency`
   - **And** the value is one of `[4, 6, 8]` (from `HARDWARE_CONCURRENCY_POOL`)

4. **AC4 — `navigator.deviceMemory` matches fingerprint**
   - **Given** a fingerprint with `deviceMemory: 8` (or 2, or 4)
   - **When** `applyNavigatorOverrides(page, fp)` is called
   - **Then** the injected script sets `navigator.deviceMemory` to `fp.deviceMemory`
   - **And** the value is one of `[2, 4, 8]` (from `DEVICE_MEMORY_POOL`)

5. **AC5 — `navigator.platform` matches fingerprint**
   - **Given** a fingerprint with `platform: 'Win32'` (or 'MacIntel', or 'Linux x86_64')
   - **When** `applyNavigatorOverrides(page, fp)` is called
   - **Then** the injected script sets `navigator.platform` to `fp.platform`
   - **And** the platform is consistent with the UA (already enforced by `derivePlatform` in Story 6.2)

6. **AC6 — `navigator.plugins.length` > 0**
   - **Given** a page after `applyNavigatorOverrides` runs
   - **When** `navigator.plugins` is inspected in-page
   - **Then** `navigator.plugins.length` is greater than 0
   - **And** the plugins array contains realistic Chrome plugin entries (e.g., PDF Viewer, Chrome PDF Viewer)
   - **Note:** puppeteer-extra-plugin-stealth already handles this (AR1 — reuse, don't re-implement). This AC verifies the stealth plugin is active, not that we inject our own plugins.

7. **AC7 — `createPage()` calls `applyNavigatorOverrides` after `applyFingerprint`**
   - **Given** a browser instance
   - **When** `createPage(browser)` is called
   - **Then** `applyFingerprint(page, fp)` is called first (UA + viewport)
   - **And** `applyNavigatorOverrides(page, fp)` is called second (navigator properties)
   - **And** the page is returned with `page._fingerprint` set
   - **And** `page.evaluateOnNewDocument` has been called at least once

8. **AC8 — Session reuse preserves navigator overrides**
   - **Given** a fingerprint `fp` from a previous `createPage` call
   - **When** `createPage(browser, { fingerprint: fp })` is called
   - **Then** `applyNavigatorOverrides(page, fp)` is called with the SAME fingerprint
   - **And** the navigator properties match the first page (same hardwareConcurrency, deviceMemory, platform)

9. **AC9 — No regression in existing `createPage` callers**
   - **Given** existing callers that call `createPage(browser)` with no options
   - **When** the new navigator override logic runs
   - **Then** no caller breaks (backward-compatible — `options` is optional)
   - **And** all existing tests in `tests/scrapers/facebook-index.test.js` still pass
   - **And** all existing tests in `tests/scrapers/facebook-fingerprint.test.js` still pass

10. **AC10 — Error handling preserves NFR4 (no fingerprint leak)**
    - **Given** `applyNavigatorOverrides(page, fp)` is called and `page.evaluateOnNewDocument` throws
    - **When** the error is caught
    - **Then** a generic error `'❌ Failed to apply navigator overrides'` is thrown
    - **And** the original error is preserved via `cause` (same pattern as `applyFingerprint`)
    - **And** the error message does NOT contain fingerprint fields (UA, platform, hardwareConcurrency, deviceMemory)

11. **AC11 — Page cleanup on navigator override failure**
    - **Given** `createPage(browser)` is called and `applyNavigatorOverrides` throws
    - **When** the error propagates
    - **Then** the page is closed (no resource leak)
    - **And** the error is re-thrown (caller sees the failure)
    - **Note:** Same pattern as Story 6.2 review patch for `applyFingerprint` failure

## Tasks / Subtasks

- [x] **Task 1: Add `applyNavigatorOverrides(page, fingerprint)` to `src/scrapers/facebook/fingerprint.js`** (AC: #1, #2, #3, #4, #5, #10)
  - [x] 1.1 Add new exported async function `applyNavigatorOverrides(page, fingerprint)`
  - [x] 1.2 Call `page.evaluateOnNewDocument()` with a script that:
    - Sets `navigator.webdriver = undefined` (delete or override via `Object.defineProperty`)
    - Sets `navigator.hardwareConcurrency` to `fingerprint.hardwareConcurrency` via `Object.defineProperty`
    - Sets `navigator.deviceMemory` to `fingerprint.deviceMemory` via `Object.defineProperty`
    - Sets `navigator.platform` to `fingerprint.platform` via `Object.defineProperty`
  - [x] 1.3 Use `Object.defineProperty` with `get` accessor (not direct assignment) — direct assignment to navigator props is silently ignored in modern Chrome
  - [x] 1.4 Wrap in try/catch — throw generic error with `cause` on failure (NFR4)
  - [x] 1.5 Update module header comment to document the new export

- [x] **Task 2: Integrate `applyNavigatorOverrides` into `createPage()` in `src/scrapers/facebook/index.js`** (AC: #7, #8, #11)
  - [x] 2.1 Import `applyNavigatorOverrides` from `./fingerprint.js`
  - [x] 2.2 In `createPage()`, call `applyNavigatorOverrides(page, fingerprint)` AFTER `applyFingerprint(page, fingerprint)`
  - [x] 2.3 Extend the try/catch to cover both `applyFingerprint` and `applyNavigatorOverrides` — close page on either failure
  - [x] 2.4 Update JSDoc for `createPage()` to mention navigator overrides are applied

- [x] **Task 3: Write tests for `applyNavigatorOverrides` in `tests/scrapers/facebook-fingerprint.test.js`** (AC: #1-#5, #10)
  - [x] 3.1 Test: `applyNavigatorOverrides` is an async function (AC1)
  - [x] 3.2 Test: calls `page.evaluateOnNewDocument` exactly once (AC1)
  - [x] 3.3 Test: injected script sets `navigator.webdriver = undefined` (AC2)
  - [x] 3.4 Test: injected script sets `navigator.hardwareConcurrency` to `fp.hardwareConcurrency` (AC3)
  - [x] 3.5 Test: injected script sets `navigator.deviceMemory` to `fp.deviceMemory` (AC4)
  - [x] 3.6 Test: injected script sets `navigator.platform` to `fp.platform` (AC5)
  - [x] 3.7 Test: does NOT call `page.setUserAgent` or `page.setViewport` (not its scope)
  - [x] 3.8 Test: throws generic error with `cause` when `evaluateOnNewDocument` fails (AC10)
  - [x] 3.9 Test: error message does NOT contain fingerprint fields (NFR4)

- [x] **Task 4: Update `createPage` integration tests in `tests/scrapers/facebook-index.test.js`** (AC: #7, #8, #9, #11)
  - [x] 4.1 Test: `createPage` calls `evaluateOnNewDocument` at least once (AC7)
  - [x] 4.2 Test: `createPage` calls `applyFingerprint` before `applyNavigatorOverrides` (AC7 — verify call order)
  - [x] 4.3 Test: `createPage(browser, { fingerprint })` reuses fingerprint for navigator overrides (AC8)
  - [x] 4.4 Test: page is closed when `applyNavigatorOverrides` throws (AC11)
  - [x] 4.5 Verify all existing createPage tests still pass (AC9 — no regression)

- [x] **Task 5: Run full test suite + verify no regressions** (AC: #9)
  - [x] 5.1 Run `vitest run tests/scrapers/facebook-fingerprint.test.js` — all pass (48/48)
  - [x] 5.2 Run `vitest run tests/scrapers/facebook-index.test.js -t "createPage"` — all pass (10/10)
  - [x] 5.3 Run `vitest run tests/scrapers/` — no NEW failures

- [x] **Task 6: Real-cookie smoke test** (AC: #2, #3, #4, #5, #6)
  - [x] 6.1 Update `test-fingerprint-real.mjs` to verify navigator properties in-page
  - [x] 6.2 Verify `navigator.webdriver === undefined` in-page
  - [x] 6.3 Verify `navigator.hardwareConcurrency === fp.hardwareConcurrency` in-page
  - [x] 6.4 Verify `navigator.deviceMemory === fp.deviceMemory` in-page
  - [x] 6.5 Verify `navigator.platform === fp.platform` in-page
  - [x] 6.6 Verify `navigator.plugins.length > 0` in-page (stealth plugin — 5 plugins)
  - [x] 6.7 Run the updated test — all pass (27/27)

## Dev Notes

### Architecture Compliance (ADR-013 — binding)

- `fingerprint.js` remains a **pure module** — no puppeteer import (AC1 from Story 6.2 still holds)
- `applyNavigatorOverrides` uses `page.evaluateOnNewDocument` — this is the Puppeteer-recommended way to override navigator properties BEFORE page load
- The fingerprint object from `generateFingerprint()` is the single source of truth for all navigator properties (NFR2: centralized config)
- `createPage()` calls `applyFingerprint` (UA + viewport) THEN `applyNavigatorOverrides` (navigator props) — order matters because some navigator checks happen during navigation

### What changes vs. what stays the same

| Component | Story 6.2/6.3 (done) | Story 6.4 (this story) |
|---|---|---|
| `applyFingerprint()` | UA + viewport only | Unchanged |
| `applyNavigatorOverrides()` | Does not exist | **NEW — webdriver, hardwareConcurrency, deviceMemory, platform** |
| `createPage()` | Calls applyFingerprint | Calls applyFingerprint THEN applyNavigatorOverrides |
| `generateFingerprint()` | Returns full shape | Unchanged (already has hardwareConcurrency, deviceMemory, platform) |
| `UA_POOL`, `VIEWPORT_LIST` | 21 UAs, 6 viewports | Unchanged |
| `derivePlatform()` | Exists | Unchanged (already provides platform for navigator override) |
| `deriveDeviceScaleFactor()` | Exists (6.3) | Unchanged |
| `puppeteer-extra-plugin-stealth` | Already active | Already active — handles `navigator.plugins`, `navigator.languages`, `window.chrome`, etc. |

### Why `Object.defineProperty` instead of direct assignment?

Modern Chrome (since ~v90) silently ignores direct assignment to navigator properties:
```javascript
navigator.webdriver = undefined; // ❌ silently ignored — still true
Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); // ✅ works
```

The injected script MUST use `Object.defineProperty` with a `get` accessor for each property.

### What stealth plugin already handles (AR1 — reuse, don't re-implement)

`puppeteer-extra-plugin-stealth` (already active via `puppeteer.use(StealthPlugin())` in `index.js`) handles:
- `navigator.webdriver` → `undefined` (via stealth's `webdriver` evasion)
- `navigator.plugins` → realistic array (via stealth's `plugins` evasion)
- `navigator.languages` → `['en-US', 'en']` (via stealth's `languages` evasion)
- `window.chrome` → runtime object (via stealth's `chrome.runtime` evasion)
- `navigator.permissions` → fixed query API (via stealth's `permissions` evasion)

**This story adds overrides for properties that stealth does NOT handle or that need session-specific values:**
- `navigator.hardwareConcurrency` → needs to match the fingerprint (stealth doesn't randomize this)
- `navigator.deviceMemory` → needs to match the fingerprint (stealth doesn't randomize this)
- `navigator.platform` → needs to match the UA (stealth doesn't sync this with custom UA)

**IMPORTANT:** We still set `navigator.webdriver = undefined` in our override even though stealth handles it — this is a **defense-in-depth** approach. If stealth plugin is ever disabled or fails, our override still works. The override is idempotent (setting `webdriver = undefined` when it's already `undefined` is a no-op).

### Scope Boundaries (STRICT)

- **In scope:** `applyNavigatorOverrides(page, fp)` function, `createPage()` integration, tests
- **Out of scope:**
  - WebRTC leak prevention (Story 6.5)
  - Canvas/WebGL/AudioContext fingerprinting (future story)
  - Timezone/geolocation (Story 6.16)
  - Persistent profiles (Story 6.17)
  - Behavioral simulation (Stories 6.9-6.12)
  - Replacing stealth plugin (AR1 — reuse existing)

### Injected Script Pattern

The script passed to `evaluateOnNewDocument` runs in the page context BEFORE any page JavaScript. It should:

```javascript
await page.evaluateOnNewDocument((fp) => {
  // webdriver — defense-in-depth (stealth also handles this)
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
    configurable: true,
  });
  // hardwareConcurrency — session-specific (stealth doesn't handle)
  Object.defineProperty(navigator, 'hardwareConcurrency', {
    get: () => fp.hardwareConcurrency,
    configurable: true,
  });
  // deviceMemory — session-specific (stealth doesn't handle)
  Object.defineProperty(navigator, 'deviceMemory', {
    get: () => fp.deviceMemory,
    configurable: true,
  });
  // platform — must match UA (stealth doesn't sync with custom UA)
  Object.defineProperty(navigator, 'platform', {
    get: () => fp.platform,
    configurable: true,
  });
}, fingerprint);
```

**Note:** The fingerprint object is passed as an argument to `evaluateOnNewDocument` — it's serialized and sent to the page context. This is the Puppeteer-recommended pattern (not string interpolation, which risks injection).

### Test Strategy

- **Unit tests** (pure module — fake page): All tests use `makeFakePage()` which records `evaluateOnNewDocument` calls. Verify the injected function source contains the expected `Object.defineProperty` calls.
- **Integration tests** (fake browser): The `createPage` tests in `facebook-index.test.js` use `makeFakeBrowser()` — verify `evaluateOnNewDocument` is called.
- **Real-cookie smoke test**: `test-fingerprint-real.mjs` verifies navigator properties in-page with a real browser.

### NFR Compliance

- **NFR2 (centralized config):** All navigator override logic stays in `fingerprint.js` — no duplication
- **NFR4 (no fingerprint leak):** Error messages in `applyNavigatorOverrides` are generic — same pattern as `applyFingerprint`
- **NFR1 (performance):** `evaluateOnNewDocument` is called once per page — no per-navigation overhead

### Key Files

- [Source: src/scrapers/facebook/fingerprint.js] — Add `applyNavigatorOverrides` export
- [Source: src/scrapers/facebook/index.js] — Integrate `applyNavigatorOverrides` into `createPage()`
- [Source: tests/scrapers/facebook-fingerprint.test.js] — Add navigator override tests
- [Source: tests/scrapers/facebook-index.test.js] — Update createPage integration tests
- [Source: tests/helpers/fake-page.js] — Already supports `evaluateOnNewDocument` (no changes needed)
- [Source: test-fingerprint-real.mjs] — Add navigator property verification
- [Reference: _bmad-output/planning-artifacts/epics-full.md] — Epic 6, Story 6.4 spec
- [Reference: _bmad-output/planning-artifacts/architecture.md] — ADR-013 (navigator override via evaluateOnNewDocument)

## Dev Agent Record

### Agent Model Used

GLM-5.2 High (Devin CLI)

### Debug Log References

- `vitest run tests/scrapers/facebook-fingerprint.test.js` → 48/48 pass (was 35 in 6.3, +13 new tests)
- `vitest run tests/scrapers/facebook-index.test.js -t "createPage"` → 10/10 pass (was 7 in 6.3, +3 new tests)
- `node test-fingerprint-real.mjs` → 27/27 pass (was 22 in 6.3, +5 navigator property checks)
- Real browser verified: navigator.webdriver=undefined, hardwareConcurrency=8, deviceMemory=4, platform="MacIntel", plugins.length=5

### Completion Notes List

- ✅ Added `applyNavigatorOverrides(page, fingerprint)` to `fingerprint.js` — pure module, no puppeteer import
- ✅ Uses `Object.defineProperty` with `get` accessors for all 4 navigator properties (webdriver, hardwareConcurrency, deviceMemory, platform)
- ✅ Fingerprint passed as argument to `evaluateOnNewDocument` (not string interpolation — avoids injection)
- ✅ Defense-in-depth: `navigator.webdriver = undefined` set even though stealth plugin handles it
- ✅ Session-specific: `hardwareConcurrency`, `deviceMemory`, `platform` match fingerprint (stealth doesn't sync these)
- ✅ `createPage()` calls `applyFingerprint` THEN `applyNavigatorOverrides` — order matters for navigator checks during navigation
- ✅ Page cleanup on `applyNavigatorOverrides` failure (same pattern as 6.2 review patch)
- ✅ NFR4: error message `'❌ Failed to apply navigator overrides'` — no fingerprint fields leaked, `cause` preserved
- ✅ 13 new unit tests (48 total): async function, evaluateOnNewDocument call, webdriver/hardwareConcurrency/deviceMemory/platform overrides, Object.defineProperty × 4, fingerprint-as-arg, no setUserAgent/setViewport, error handling, NFR4
- ✅ 3 new integration tests (10 total): evaluateOnNewDocument called, call order, session reuse with navigator overrides, page cleanup on failure
- ✅ 5 new real-cookie checks (27 total): webdriver=undefined, hardwareConcurrency match, deviceMemory match, platform match, plugins.length>0
- ✅ Real browser: stealth plugin provides 5 plugins, our overrides provide session-specific navigator values
- ✅ No regression in existing tests (all 6.2 + 6.3 tests still pass)

### File List

- `src/scrapers/facebook/fingerprint.js` (MODIFIED) — Added `applyNavigatorOverrides` export, updated header comment
- `src/scrapers/facebook/index.js` (MODIFIED) — Imported `applyNavigatorOverrides`, integrated into `createPage()`, updated JSDoc
- `tests/scrapers/facebook-fingerprint.test.js` (MODIFIED) — Added 13 navigator override tests (48 total), updated import
- `tests/scrapers/facebook-index.test.js` (MODIFIED) — Updated createPage tests (10 total), removed "does NOT call evaluateOnNewDocument" test (now it DOES), added 3 new tests
- `test-fingerprint-real.mjs` (MODIFIED) — Added Test 9 (navigator property verification), updated header + success message

## Change Log

- 2026-08-12: Story 6.4 implemented — Navigator Properties Override. Added `applyNavigatorOverrides(page, fp)` using `Object.defineProperty` via `evaluateOnNewDocument` for webdriver, hardwareConcurrency, deviceMemory, platform. Integrated into `createPage()` after `applyFingerprint`. 48 unit tests + 10 integration tests + 27 real-cookie tests, all passing. Defense-in-depth with stealth plugin. NFR4 compliant.
