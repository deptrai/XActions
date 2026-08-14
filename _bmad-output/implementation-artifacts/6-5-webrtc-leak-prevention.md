---
baseline_commit: 044d237
---

# Story 6.5: WebRTC Leak Prevention

Status: done

## Story

As a developer using the Facebook automation scraper with a proxy,
I want WebRTC disabled or overridden so that the real IP address doesn't leak via STUN servers,
so that Facebook cannot correlate the proxy IP with the machine's real public IP (per ADR-013, FR3).

## Acceptance Criteria

1. **AC1 — `applyWebRTCOverride(page)` exists and is pure-in-scope**
   - **Given** the new function `applyWebRTCOverride` exported from `src/scrapers/facebook/fingerprint.js`
   - **When** it is imported
   - **Then** it is a callable async function
   - **And** it does NOT import puppeteer (pure module — receives `page` as parameter, same as `applyFingerprint` and `applyNavigatorOverrides`)
   - **And** it accepts `(page)` — no fingerprint parameter needed (WebRTC override is global, not session-specific)

2. **AC2 — `RTCPeerConnection` is overridden via `evaluateOnNewDocument`**
   - **Given** a page (real or fake) with `evaluateOnNewDocument` method
   - **When** `applyWebRTCOverride(page)` is called
   - **Then** `page.evaluateOnNewDocument` is called with a function that overrides `window.RTCPeerConnection`
   - **And** the override prevents STUN/TURN requests from reaching the network

3. **AC3 — `--disable-webrtc` launch arg added to `createBrowser()`**
   - **Given** `createBrowser()` is called
   - **When** the browser launches
   - **Then** the launch args include `--disable-webrtc`
   - **And** the arg is added to the `stealthArgs` array (always present, not optional)

4. **AC4 — `createPage()` calls `applyWebRTCOverride` after navigator overrides**
   - **Given** a browser instance
   - **When** `createPage(browser)` is called
   - **Then** `applyFingerprint(page, fp)` is called first (UA + viewport)
   - **And** `applyNavigatorOverrides(page, fp)` is called second (navigator properties)
   - **And** `applyWebRTCOverride(page)` is called third (WebRTC leak prevention)
   - **And** the page is returned with `page._fingerprint` set

5. **AC5 — Session reuse preserves WebRTC override**
   - **Given** a fingerprint `fp` from a previous `createPage` call
   - **When** `createPage(browser, { fingerprint: fp })` is called
   - **Then** `applyWebRTCOverride(page)` is called (WebRTC override is always applied, regardless of fingerprint reuse)

6. **AC6 — No regression in existing `createPage` callers**
   - **Given** existing callers that call `createPage(browser)` with no options
   - **When** the new WebRTC override logic runs
   - **Then** no caller breaks (backward-compatible — `options` is optional)
   - **And** all existing tests in `tests/scrapers/facebook-index.test.js` still pass
   - **And** all existing tests in `tests/scrapers/facebook-fingerprint.test.js` still pass
   - **And** all existing tests in `tests/scrapers/facebook-auth.test.js` still pass

7. **AC7 — Error handling preserves NFR4 (no fingerprint leak)**
   - **Given** `applyWebRTCOverride(page)` is called and `page.evaluateOnNewDocument` throws
   - **When** the error is caught
   - **Then** a generic error `'❌ Failed to apply WebRTC override'` is thrown
   - **And** the original error is preserved via `cause` (same pattern as `applyFingerprint` and `applyNavigatorOverrides`)

8. **AC8 — Page cleanup on WebRTC override failure**
   - **Given** `createPage(browser)` is called and `applyWebRTCOverride` throws
   - **When** the error propagates
   - **Then** the page is closed (no resource leak)
   - **And** the error is re-thrown (caller sees the failure)
   - **Note:** Same pattern as Story 6.2/6.4 review patch for `applyFingerprint`/`applyNavigatorOverrides` failure

9. **AC9 — `createBrowser` tests verify `--disable-webrtc` arg**
   - **Given** `createBrowser()` is called with `launchImpl` seam
   - **When** the launch options are captured
   - **Then** `capturedOpts.args` contains `--disable-webrtc`
   - **And** the arg is present alongside existing stealth args (`--no-sandbox`, `--disable-setuid-sandbox`, `--disable-blink-features=AutomationControlled`)

## Tasks / Subtasks

- [x] **Task 1: Add `applyWebRTCOverride(page)` to `src/scrapers/facebook/fingerprint.js`** (AC: #1, #2, #7)
  - [x] 1.1 Add new exported async function `applyWebRTCOverride(page)`
  - [x] 1.2 Call `page.evaluateOnNewDocument()` with a script that:
    - Overrides `window.RTCPeerConnection` to a no-op function (prevents STUN/TURN)
    - Also overrides `window.webkitRTCPeerConnection` (Chrome prefix, for older versions)
    - Also nullifies `navigator.mediaDevices.getUserMedia` (prevents media device enumeration that can leak IP via ICE candidates)
  - [x] 1.3 Wrap in try/catch — throw generic error with `cause` on failure (NFR4)
  - [x] 1.4 Update module header comment to document the new export

- [x] **Task 2: Add `--disable-webrtc` to `createBrowser()` stealth args in `src/scrapers/facebook/index.js`** (AC: #3, #9)
  - [x] 2.1 Add `'--disable-webrtc'` to the `stealthArgs` array in `createBrowser()`
  - [x] 2.2 Update JSDoc for `createBrowser()` to mention WebRTC prevention

- [x] **Task 3: Integrate `applyWebRTCOverride` into `createPage()` in `src/scrapers/facebook/index.js`** (AC: #4, #5, #8)
  - [x] 3.1 Import `applyWebRTCOverride` from `./fingerprint.js`
  - [x] 3.2 In `createPage()`, call `applyWebRTCOverride(page)` AFTER `applyNavigatorOverrides(page, fingerprint)`
  - [x] 3.3 Extend the try/catch to cover all three: `applyFingerprint`, `applyNavigatorOverrides`, `applyWebRTCOverride` — close page on any failure
  - [x] 3.4 Update JSDoc for `createPage()` to mention WebRTC override

- [x] **Task 4: Write tests for `applyWebRTCOverride` in `tests/scrapers/facebook-fingerprint.test.js`** (AC: #1, #2, #7)
  - [x] 4.1 Test: `applyWebRTCOverride` is an async function (AC1)
  - [x] 4.2 Test: calls `page.evaluateOnNewDocument` exactly once (AC1)
  - [x] 4.3 Test: injected script overrides `window.RTCPeerConnection` (AC2)
  - [x] 4.4 Test: injected script overrides `window.webkitRTCPeerConnection` (AC2)
  - [x] 4.5 Test: injected script nullifies `navigator.mediaDevices.getUserMedia` (AC2)
  - [x] 4.6 Test: does NOT call `page.setUserAgent` or `page.setViewport` (not its scope)
  - [x] 4.7 Test: does NOT call `page.emulateTimezone` or `page.setGeolocation` (out of scope)
  - [x] 4.8 Test: throws generic error with `cause` when `evaluateOnNewDocument` fails (AC7)
  - [x] 4.9 Test: error message does NOT contain fingerprint fields (NFR4)

- [x] **Task 5: Update `createBrowser` tests in `tests/scrapers/facebook-auth.test.js`** (AC: #3, #9)
  - [x] 5.1 Test: `createBrowser` includes `--disable-webrtc` in launch args (AC3, AC9)
  - [x] 5.2 Test: `--disable-webrtc` is present alongside existing stealth args (AC9)
  - [x] 5.3 Verify all existing createBrowser tests still pass (AC6 — no regression)

- [x] **Task 6: Update `createPage` integration tests in `tests/scrapers/facebook-index.test.js`** (AC: #4, #5, #6, #8)
  - [x] 6.1 Test: `createPage` calls `evaluateOnNewDocument` at least twice (once for navigator, once for WebRTC) (AC4)
  - [x] 6.2 Test: `createPage(browser, { fingerprint })` still applies WebRTC override (AC5)
  - [x] 6.3 Test: page is closed when `applyWebRTCOverride` throws (AC8)
  - [x] 6.4 Verify all existing createPage tests still pass (AC6 — no regression)

- [x] **Task 7: Run full test suite + verify no regressions** (AC: #6)
  - [x] 7.1 Run `vitest run tests/scrapers/facebook-fingerprint.test.js` — all pass
  - [x] 7.2 Run `vitest run tests/scrapers/facebook-index.test.js -t "createPage"` — all pass
  - [x] 7.3 Run `vitest run tests/scrapers/facebook-auth.test.js` — all pass
  - [x] 7.4 Run `vitest run tests/scrapers/` — no NEW failures

- [x] **Task 8: Real-cookie smoke test** (AC: #2, #3, #4)
  - [x] 8.1 Update `test-fingerprint-real.mjs` to verify WebRTC override in-page
  - [x] 8.2 Verify `window.RTCPeerConnection` is overridden (not the native function) in-page
  - [x] 8.3 Verify `navigator.mediaDevices.getUserMedia` is nullified in-page
  - [x] 8.4 Run the updated test — all pass

## Dev Notes

### Architecture Compliance (ADR-013 — binding)

- `fingerprint.js` remains a **pure module** — no puppeteer import (AC1 from Story 6.2 still holds)
- `applyWebRTCOverride` uses `page.evaluateOnNewDocument` — same pattern as `applyNavigatorOverrides`
- WebRTC override is global (not session-specific) — no fingerprint parameter needed
- `createBrowser()` adds `--disable-webrtc` to stealth args — defense-in-depth (launch arg + JS override)
- `createPage()` calls `applyFingerprint` → `applyNavigatorOverrides` → `applyWebRTCOverride` — order matters

### Why both `--disable-webrtc` AND JS override?

**Defense-in-depth** — two layers of protection:

1. **`--disable-webrtc` launch arg** — disables WebRTC at the Chromium level. This is the strongest protection but:
   - May not work in all Chrome versions (Google has been making it harder to disable WebRTC)
   - Some Chrome builds ignore this flag in certain contexts (e.g., extensions)

2. **JS override via `evaluateOnNewDocument`** — overrides `RTCPeerConnection` in the page context. This is the fallback:
   - Works even if the launch arg is ignored
   - Prevents any JS library (including Facebook's) from creating RTCPeerConnection objects
   - Also prevents `getUserMedia` which can leak device info

**If either layer fails, the other still protects.** This is the same defense-in-depth approach used for `navigator.webdriver` (stealth plugin + our override).

### What the injected script does

```javascript
await page.evaluateOnNewDocument(() => {
  // Override RTCPeerConnection — prevents STUN/TURN requests that leak real IP
  window.RTCPeerConnection = function() {
    throw new Error('WebRTC is disabled');
  };
  // Chrome-prefixed version (older Chrome)
  window.webkitRTCPeerConnection = function() {
    throw new Error('WebRTC is disabled');
  };
  // Nullify getUserMedia — prevents media device enumeration
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia = undefined;
  }
});
```

**Note:** Unlike `applyNavigatorOverrides`, this function takes NO arguments — the WebRTC override is the same for all sessions (global disable, not session-specific).

### What stealth plugin does NOT handle

`puppeteer-extra-plugin-stealth` does NOT handle WebRTC leak prevention. This is a known gap — stealth focuses on navigator properties, plugins, and chrome runtime, but NOT WebRTC. This story fills that gap.

### Scope Boundaries (STRICT)

- **In scope:** `applyWebRTCOverride(page)` function, `--disable-webrtc` launch arg, `createPage()` integration, tests
- **Out of scope:**
  - Canvas/WebGL/AudioContext fingerprinting (future story)
  - Timezone/geolocation (Story 6.16)
  - Persistent profiles (Story 6.17)
  - Behavioral simulation (Stories 6.9-6.12)
  - Proxy credential injection (already handled by `page.authenticate` in callers)

### Key Files

- [Source: src/scrapers/facebook/fingerprint.js] — Add `applyWebRTCOverride` export
- [Source: src/scrapers/facebook/index.js] — Add `--disable-webrtc` to stealth args, integrate `applyWebRTCOverride` into `createPage()`
- [Source: tests/scrapers/facebook-fingerprint.test.js] — Add WebRTC override tests
- [Source: tests/scrapers/facebook-auth.test.js] — Update createBrowser tests for `--disable-webrtc`
- [Source: tests/scrapers/facebook-index.test.js] — Update createPage integration tests
- [Source: tests/helpers/fake-page.js] — Already supports `evaluateOnNewDocument` (no changes needed)
- [Source: test-fingerprint-real.mjs] — Add WebRTC property verification
- [Reference: _bmad-output/planning-artifacts/epics-full.md] — Epic 6, Story 6.5 spec
- [Reference: _bmad-output/planning-artifacts/architecture.md] — ADR-013 (WebRTC override via evaluateOnNewDocument + --disable-webrtc)

## Dev Agent Record

### Agent Model Used

GLM-5.2 High (Devin CLI)

### Debug Log References

- Unit tests: `npx vitest run tests/scrapers/facebook-fingerprint.test.js tests/scrapers/facebook-auth.test.js` → 78/78 pass
- createPage tests: `npx vitest run tests/scrapers/facebook-index.test.js -t "createPage"` → 12/12 pass
- Real-cookie test: `node test-fingerprint-real.mjs` → 31/31 pass (account 61590577116318, no checkpoint)
- Pre-existing failures: 14 tests in facebook-index.test.js (scrapeProfile/loginWithCookie/scrapeGroupMembers) — confirmed present on baseline commit 044d237, NOT regressions from Story 6.5

### Completion Notes List

- All 9 ACs satisfied
- Defense-in-depth: `--disable-webrtc` launch arg + JS override (2 layers)
- WebRTC override is global (no fingerprint param) — unlike applyNavigatorOverrides
- 3 things overridden: RTCPeerConnection, webkitRTCPeerConnection, getUserMedia
- Real browser confirms: `new RTCPeerConnection()` throws "WebRTC is disabled" — STUN/TURN blocked
- Real browser confirms: `navigator.mediaDevices.getUserMedia` is undefined — nullified
- Updated Story 6.4 session-reuse test to expect 2 evaluateOnNewDocument calls (was 1)

### File List

- `src/scrapers/facebook/fingerprint.js` — Added `applyWebRTCOverride(page)` export
- `src/scrapers/facebook/index.js` — Added `--disable-webrtc` to stealth args, integrated `applyWebRTCOverride` into `createPage()`
- `tests/scrapers/facebook-fingerprint.test.js` — Added 11 WebRTC override tests
- `tests/scrapers/facebook-auth.test.js` — Updated stealth args test, added 2 new `--disable-webrtc` tests
- `tests/scrapers/facebook-index.test.js` — Updated createPage tests (2→evaluateOnNewDocument count, WebRTC failure cleanup)
- `test-fingerprint-real.mjs` — Added 4 WebRTC verification checks in real browser

## Change Log
