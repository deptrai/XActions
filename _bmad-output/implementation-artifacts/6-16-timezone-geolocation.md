---
baseline_commit: 6c6821fcb1ada62d0712e124d00df6320ebf665e
---

# Story 6.16: Timezone & Geolocation Override

Status: done

## Story

As a developer,
I want timezone and geolocation matching proxy location,
So that Facebook doesn't detect IP-timezone-geo mismatch.

## Acceptance Criteria

1. **AC1 — `createPage` accepts `proxyLocation` and applies timezone**
   - **Given** `createPage(browser, { proxyLocation })` is called
   - **When** `proxyLocation.timezone` is a valid IANA timezone string (e.g. `'America/New_York'`)
   - **Then** `page.emulateTimezone(proxyLocation.timezone)` is called before the page is returned
   - **And** `Intl.DateTimeFormat().resolvedOptions().timeZone` inside the page evaluates to the same timezone

2. **AC2 — `createPage` applies geolocation matching proxy**
   - **Given** `proxyLocation` contains numeric `latitude` and `longitude` (or `lat`/`lng` aliases)
   - **When** `createPage` runs
   - **Then** `page.setGeolocation({ latitude, longitude, accuracy? })` is called with Puppeteer-compatible keys
   - **And** `page.browserContext().overridePermissions('https://www.facebook.com', ['geolocation'])` is called to grant geolocation permission

3. **AC3 — Skip when proxy location is missing**
   - **Given** `createPage(browser)` is called with no `proxyLocation`
   - **When** session initializes
   - **Then** `emulateTimezone`, `setGeolocation`, and `overridePermissions` are NOT called
   - **And** the page is returned normally without throwing

4. **AC4 — Skip on partial/malformed `proxyLocation` without guessing or throwing**
   - **Given** `proxyLocation` is missing `timezone`, `latitude`, or `longitude` (or has non-numeric coordinates)
   - **When** `createPage` runs
   - **Then** it logs a warning and skips all timezone/geo overrides
   - **And** it does NOT throw or abort page creation

5. **AC5 — `lat`/`lng` aliases normalized to `latitude`/`longitude`**
   - **Given** `proxyLocation` uses `lat` and `lng` keys instead of `latitude`/`longitude`
   - **When** `createPage` applies geolocation
   - **Then** `page.setGeolocation` receives `{ latitude, longitude }` (with optional `accuracy`)

6. **AC6 — `createPage` closes page and throws on geo override failure**
   - **Given** `page.emulateTimezone`, `page.setGeolocation`, or `overridePermissions` throws
   - **When** `createPage` runs
   - **Then** it closes the page and throws a generic `Failed to apply proxy location` error
   - **And** the original `proxyLocation` values are NOT echoed in the error message

7. **AC7 — `proxyLocation` values are never logged**
   - **Given** `proxyLocation` contains coordinates and timezone
   - **When** warnings or errors occur
   - **Then** no `proxyLocation` fields (timezone, latitude, longitude, accuracy) are logged or included in error messages (NFR4)

8. **AC8 — No regression in existing tests**
   - **Given** all changes are applied
   - **When** the full Facebook test suite runs
   - **Then** all existing tests pass (`facebook-index`, `facebook-fingerprint`, `facebook-auth`, `facebook-human`, `facebook-limits`, `facebook-automation-batch`)

## Tasks / Subtasks

- [x] **Task 1: Implement `applyProxyLocation` helper in `src/scrapers/facebook/index.js`** (AC: #1, #2, #4, #5, #6, #7)
  - [x] 1.1 Export an internal helper `applyProxyLocation(page, proxyLocation)` (or keep it local if tests only need `createPage`)
  - [x] 1.2 If `proxyLocation` is falsy, return immediately — no guessing
  - [x] 1.3 Normalize `lat`/`lng` aliases to `latitude`/`longitude`; preserve optional `accuracy` if present
  - [x] 1.4 Validate that `timezone` is a non-empty string and `latitude`/`longitude` are finite numbers; if not, warn and skip
  - [x] 1.5 Call `await page.emulateTimezone(timezone)`
  - [x] 1.6 Build geolocation object `{ latitude, longitude }`; add `accuracy` only if it is a finite number; call `await page.setGeolocation(geo)`
  - [x] 1.7 Call `await page.browserContext().overridePermissions('https://www.facebook.com', ['geolocation'])` to grant permission
  - [x] 1.8 On any Puppeteer error, throw `new Error('❌ Failed to apply proxy location', { cause: err })` — do NOT echo `proxyLocation` values

- [x] **Task 2: Integrate `applyProxyLocation` into `createPage`** (AC: #1, #2, #3, #6)
  - [x] 2.1 Destructure `proxyLocation` from `createPage(browser, options = {})` options
  - [x] 2.2 Add `await applyProxyLocation(page, proxyLocation)` after `applyWebRTCOverride(page)` and before `page._fingerprint = fingerprint`
  - [x] 2.3 Keep it inside the existing `try` block so a failure triggers `page.close()` and rethrows, matching the `applyFingerprint` / `applyNavigatorOverrides` / `applyWebRTCOverride` behavior
  - [x] 2.4 Update `createPage` JSDoc to document `options.proxyLocation`

- [x] **Task 3: Update `tests/helpers/fake-page.js` to support permission assertions** (AC: #2)
  - [x] 3.1 Add `overridePermissions: []` to the `calls` recorder
  - [x] 3.2 Add `browserContext()` method to the fake page returning an object with `overridePermissions: async (origin, permissions) => { calls.overridePermissions.push({ origin, permissions }); }`
  - [x] 3.3 Keep `emulateTimezone` and `setGeolocation` recorders as-is (they already exist)

- [x] **Task 4: Write `createPage` timezone/geolocation tests in `tests/scrapers/facebook-index.test.js`** (AC: #1, #2, #3, #4, #5, #6, #8)
  - [x] 4.1 Add a new `describe('createPage — timezone & geolocation (Story 6.16)', ...)` block after the existing `createPage` describe
  - [x] 4.2 Test: `emulateTimezone` is called with `America/New_York` when `proxyLocation` provides it
  - [x] 4.3 Test: `setGeolocation` is called with `{ latitude, longitude }` matching `proxyLocation`
  - [x] 4.4 Test: `page.browserContext().overridePermissions` is called for origin `https://www.facebook.com` with `['geolocation']`
  - [x] 4.5 Test: when no `proxyLocation` is passed, none of the three methods are called
  - [x] 4.6 Test: when `proxyLocation` is partial (e.g. only `latitude`), the methods are not called and `createPage` does not throw
  - [x] 4.7 Test: `lat`/`lng` aliases are normalized to `latitude`/`longitude` before `setGeolocation`
  - [x] 4.8 Test: optional `accuracy` is forwarded to `setGeolocation` when present
  - [x] 4.9 Test: if `emulateTimezone` throws, `createPage` rejects with `/Failed to apply proxy location/` and closes the page
  - [x] 4.10 Test: existing `createPage` tests still pass without `proxyLocation` (regression guard)

- [x] **Task 5: Write optional real-browser smoke test `test-timezone-geolocation-real.mjs`** (AC: #1)
  - [x] 5.1 Follow the pattern of `test-session-warming-real.mjs` (live account optional)
  - [x] 5.2 Launch a real browser with `createBrowser({ headless: process.env.PUPPETEER_HEADLESS !== 'false' })`
  - [x] 5.3 Call `createPage(browser, { proxyLocation: { timezone: 'America/New_York', latitude: 40.7128, longitude: -74.0060 } })`
  - [x] 5.4 Evaluate `Intl.DateTimeFormat().resolvedOptions().timeZone` in the page and assert it equals `America/New_York`
  - [x] 5.5 Close the browser
  - [x] 5.6 Skip gracefully (exit 0 or process.exit(2)) if no real browser is available

- [x] **Task 6: Run full test suite and verify no regressions** (AC: #8)
  - [x] 6.1 Run `npx vitest run tests/scrapers/facebook-index.test.js`
  - [x] 6.2 Run `npx vitest run tests/scrapers/facebook-*.test.js`
  - [x] 6.3 Run `npx vitest run tests/services/facebook-automation-batch.test.js`
  - [x] 6.4 Optionally run `node test-timezone-geolocation-real.mjs`

## Dev Notes

### Architecture Compliance (Binding ADRs)

- **ADR-016: Session lifecycle** — `createPage()` must accept `proxyLocation` from options and apply `page.emulateTimezone(tz)` + `page.setGeolocation({ lat, lng })` + grant permissions. If the proxy does not return location, skip without guessing. Source: `_bmad-output/planning-artifacts/architecture.md` lines 752-768.
- **ADR-013: Consistent fingerprint** — `createPage` already applies fingerprint, navigator, and WebRTC overrides in a single `try` block. The new geo override should be the fourth step in that same block so a failure closes the page and does not leak a half-configured session. Source: `architecture.md` lines 700-713 and `src/scrapers/facebook/fingerprint.js`.
- **NFR4** — Never log `proxyLocation`, cookies, tokens, or account metadata. Error messages must be generic; pass the original error as `cause` only where the platform supports it.

### Latest Puppeteer API (verified 2026-08-13)

- `page.emulateTimezone(timezoneId?: string): Promise<void>` — valid `timezoneId` values are IANA timezone strings such as `America/New_York`. Passing `null` disables emulation. [Source: pptr.dev `Page.emulateTimezone()`]
- `page.setGeolocation(options: { latitude: number, longitude: number, accuracy?: number }): Promise<void>` — Puppeteer requires the keys `latitude` and `longitude`, NOT `lat` and `lng`. [Source: pptr.dev `Page.setGeolocation()`]
- `browserContext.overridePermissions(origin: string, permissions: Permission[]): Promise<void>` — must be called for `https://www.facebook.com` with `['geolocation']` so Facebook's JS can read the mocked location. [Source: pptr.dev `BrowserContext.overridePermissions()`]

### `proxyLocation` Contract

```js
{
  timezone: 'America/New_York',  // IANA timezone string
  latitude: 40.7128,             // number, -90..90
  longitude: -74.0060,           // number, -180..180
  accuracy: 100,                 // optional, non-negative number
}
```

- The implementation must also accept `lat` and `lng` as aliases for `latitude` and `longitude` and normalize them before calling Puppeteer.
- If `proxyLocation` is missing, `null`, or has missing/non-numeric fields, the helper must **skip silently with a warning** — do not guess, do not throw, and do not fail page creation.

### Module Boundaries

| File | Action | Reason |
|---|---|---|
| `src/scrapers/facebook/index.js` | **UPDATE** | Add `applyProxyLocation` helper and integrate into `createPage` per ADR-016 |
| `tests/helpers/fake-page.js` | **UPDATE** | Add `browserContext()` and `overridePermissions` call recorder so tests can assert permission grants |
| `tests/scrapers/facebook-index.test.js` | **UPDATE** | Add `createPage` timezone/geo unit tests |
| `test-timezone-geolocation-real.mjs` | **NEW (optional)** | Real-browser smoke test for `Intl.DateTimeFormat().resolvedOptions().timeZone` |

### What Story 6.15 Already Built

- `createPage` uses a single `try` block for fingerprint, navigator, and WebRTC overrides; on any failure it closes the page and rethrows.
- `loginWithCookie` triggers `warmSession(page)` after successful login.
- `warmSession` is a pure module in `src/scrapers/facebook/warmup.js`.
- The test suite uses `makeFakeBrowser`/`makeFakePage` as configurable state machines, not mocks.

### Implementation Notes

- **Order of overrides in `createPage`:** `applyFingerprint` → `applyNavigatorOverrides` → `applyWebRTCOverride` → `applyProxyLocation`. This keeps the session setup sequential and deterministic.
- **Optional chaining for `browserContext()`:** Real Puppeteer pages always have `page.browserContext()`, but `makeFakePage` did not. Add it to the fake helper. In production code, calling `page.browserContext()` directly is fine; do not wrap in extra defensive checks that could hide integration issues.
- **No new dependencies:** Do NOT install a geo-IP or timezone-lookup library. The architecture explicitly says the proxy provider returns location and we skip if it doesn't.
- **No changes to `proxy.js` in this story:** `rotateProxy` returns a network proxy descriptor; the caller is responsible for resolving a separate `proxyLocation` object and passing it to `createPage`. Future orchestration can combine these, but that is out of 6.16 scope.
- **`loginWithCookie` does not apply geo:** `loginWithCookie` receives an already-configured page. It must not re-apply `proxyLocation`.
- **Real-browser timezone check:** `page.emulateTimezone` changes the environment so `Intl.DateTimeFormat().resolvedOptions().timeZone` reflects the chosen timezone. In unit tests, simply assert `emulateTimezone` was called with the right argument.

### Testing Standards

- Use `tests/helpers/fake-page.js` for unit tests; it is a state machine, not a mock, satisfying the "no mocks" rule in `CLAUDE.md`.
- Use `vi.fn()` only for injectable seams, not for faking browser behavior.
- Keep the existing `createPage` fingerprint tests intact and green; add the new `timezone & geolocation` describe block immediately after them.
- For real-browser tests, follow the live-account pattern and use `process.exit(0|1|2)` for pass/fail/fatal.

### Common LLM Mistakes to Prevent

- Do NOT use `lat`/`lng` directly with `page.setGeolocation` — Puppeteer will reject it. Normalize to `latitude`/`longitude`.
- Do NOT throw when `proxyLocation` is missing or partial — skip with a warning.
- Do NOT add geo-IP lookup libraries or guess coordinates from the proxy string.
- Do NOT forget `browserContext().overridePermissions`; without it, Facebook's geolocation API will not read the mocked location.
- Do NOT break the existing `createPage` failure-cleanup pattern; keep `applyProxyLocation` inside the existing `try` block.
- Do NOT leak `proxyLocation` values in error or warning messages.

### References

- Story spec: `_bmad-output/planning-artifacts/epics-full.md` lines 880-893
- ADR-016 (session lifecycle): `_bmad-output/planning-artifacts/architecture.md` lines 752-768
- ADR-013 (fingerprint): `_bmad-output/planning-artifacts/architecture.md` lines 700-713
- Existing `createPage` implementation: `src/scrapers/facebook/index.js` lines 91-105
- Fake page helper: `tests/helpers/fake-page.js`
- Latest Puppeteer `emulateTimezone`: https://pptr.dev/api/puppeteer.page.emulatetimezone
- Latest Puppeteer `setGeolocation`: https://pptr.dev/api/puppeteer.page.setgeolocation
- Latest Puppeteer `overridePermissions`: https://pptr.dev/api/puppeteer.browsercontext.overridepermissions

## Dev Agent Record

### Agent Model Used

Devin CLI / SWE-1.7 Max

### Debug Log References

- `npx vitest run tests/scrapers/facebook-index.test.js` → 11/11 Story 6.16 tests pass
- `npx vitest run tests/scrapers/facebook-*.test.js` → 808 passed, 14 skipped (re-run after patches: green)
- `npx vitest run tests/services/facebook-automation-batch.test.js` → 94 passed
- `node test-timezone-geolocation-real.mjs` → passed (real Puppeteer, timezone `America/New_York`)

### Completion Notes List

- [x] `applyProxyLocation` implemented and integrated into `createPage`
- [x] `tests/helpers/fake-page.js` extended with `browserContext().overridePermissions`
- [x] Unit tests added to `facebook-index.test.js` (11 Story 6.16 tests + range/accuracy validation)
- [x] Optional real-browser smoke test `test-timezone-geolocation-real.mjs` added
- [x] Full Facebook test suite passes

### File List

- `src/scrapers/facebook/index.js` — UPDATE
- `tests/helpers/fake-page.js` — UPDATE
- `tests/scrapers/facebook-index.test.js` — UPDATE
- `test-timezone-geolocation-real.mjs` — NEW (optional)

## Review Findings

### Summary

- **0** decision-needed
- **5** patch
- **2** defer
- **10+** dismissed as noise / false positive

### Patch Findings

- [x] [Review][Patch] Validate latitude/longitude range in `applyProxyLocation` before calling Puppeteer `src/scrapers/facebook/index.js:98-99`
  - Out-of-range coordinates are now treated as malformed and fall through to the warning/skip path instead of throwing.

- [x] [Review][Patch] Validate `accuracy` is non-negative in `applyProxyLocation` `src/scrapers/facebook/index.js:110-112`
  - Negative accuracy is ignored; only non-negative `accuracy` values are forwarded to `setGeolocation`.

- [x] [Review][Patch] Fix NFR4 test that passes silently if no error is thrown `tests/scrapers/facebook-index.test.js`
  - The AC7 test now asserts the caught error is an `Error` before checking the message, preventing a vacuous pass.

- [x] [Review][Patch] Handle `createBrowser` failures gracefully in `test-timezone-geolocation-real.mjs`
  - Real-browser test now wraps `createBrowser` and exits with code `2` when the browser cannot be launched.

- [x] [Review][Patch] Add tests for `setGeolocation` and `overridePermissions` throwing `tests/scrapers/facebook-index.test.js`
  - Added explicit tests for `overridePermissions` failure and a range/accuracy validation test; the AC7 test already covers `setGeolocation` failure.

### Defer Findings

- [x] [Review][Defer] `err.cause` may leak proxyLocation values from Puppeteer's native error message `src/scrapers/facebook/index.js:117`
  - The thrown error message is generic, but `{ cause: err }` attaches the original Puppeteer error, which *could* include the invalid timezone string if `emulateTimezone` throws. This mirrors the existing `applyFingerprint` pattern. Defer pending a project-wide decision on whether `cause` chains violate NFR4.

- [x] [Review][Defer] Missing test for `lat`/`lng` alias normalization when `latitude`/`longitude` are absent and `timezone` is also missing `tests/scrapers/facebook-index.test.js:1368-1383`
  - Partial `proxyLocation` with only `lat`/`lng` and no `timezone` correctly falls through to the warning/skip path, but there is no test specifically for that alias-only partial scenario. Coverage gap, not a functional defect.
