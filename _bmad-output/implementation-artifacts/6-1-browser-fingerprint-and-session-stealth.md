# Story 6.1: Browser Fingerprint & Session Stealth

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an Account Farmer / Warming Specialist,
I want the browser to present a consistent, realistic fingerprint per session and prevent WebRTC/Navigator leaks,
so that my accounts are less likely to be flagged as automation.

## Acceptance Criteria

1. **Consistent session fingerprint (FR-52, NFR-2)**
   - **Given** a new browser session is created
   - **When** `createPage()` is called
   - **Then** the system generates exactly ONE fingerprint object (`{ ua, viewport, deviceScaleFactor, hardwareConcurrency, deviceMemory, platform }`)
   - **And** the same fingerprint is reused for every page/tab in that session
   - **And** the fingerprint does NOT change mid-session

2. **User-Agent pool & viewport randomization (FR-40, FR-41)**
   - **Given** the fingerprint module is loaded
   - **When** `generateFingerprint()` is called
   - **Then** it picks one UA from a pool of ≥20 real Chrome UAs (Chrome 146-152, Windows/macOS/Linux)
   - **And** it picks one viewport from a list of 6+ realistic desktop viewports including 2560×1440
   - **And** `deviceScaleFactor` matches the UA platform (macOS → 2, Windows/Linux → 1)

3. **Navigator automation indicators overridden (FR-43)**
   - **Given** a page is created with a fingerprint
   - **When** `applyNavigatorOverrides(page, fingerprint)` runs via `page.evaluateOnNewDocument`
   - **Then** `navigator.webdriver` returns `undefined`
   - **And** `navigator.hardwareConcurrency` matches `fingerprint.hardwareConcurrency` (one of [4, 6, 8])
   - **And** `navigator.deviceMemory` matches `fingerprint.deviceMemory` (one of [2, 4, 8])
   - **And** `navigator.platform` matches `fingerprint.platform` (Win32 / MacIntel / Linux x86_64)

4. **WebRTC leak prevention (FR-42)**
   - **Given** a browser is launched with a proxy
   - **When** `createBrowser()` builds launch args and `createPage()` applies overrides
   - **Then** the launch args include `--disable-webrtc`
   - **And** `applyWebRTCOverride(page)` overrides `window.RTCPeerConnection`, `window.webkitRTCPeerConnection`, and nullifies `navigator.mediaDevices.getUserMedia`
   - **And** no STUN/TURN requests leak the real IP outside the proxy

5. **Timezone & geolocation match proxy location (FR-49, FR-50)**
   - **Given** `createPage(browser, { proxyLocation })` is called with a valid `{ timezone, latitude, longitude }`
   - **When** the page initializes
   - **Then** `page.emulateTimezone(timezone)` is called
   - **And** `page.setGeolocation({ latitude, longitude, accuracy? })` is called
   - **And** `page.browserContext().overridePermissions('https://www.facebook.com', ['geolocation'])` grants permission
   - **And** if `proxyLocation` is missing or invalid, the system skips silently (no guessing, no throw)

6. **Persistent browser profiles (FR-51)**
   - **Given** `createBrowser({ userDataDir: './profiles/fb-{c_user}/' })` is called
   - **When** the browser launches
   - **Then** the profile directory is auto-created if it does not exist
   - **And** the profile is passed to Puppeteer as a launch option (not a raw `--user-data-dir` arg)
   - **And** any `--incognito` flag is stripped when `userDataDir` is set
   - **And** cookies + localStorage persist across sessions with the same `userDataDir`

7. **No fingerprint or cookie leakage (NFR-4)**
   - **Given** any error path in fingerprint, navigator, WebRTC, or proxy-location code
   - **When** an error is thrown
   - **Then** the error message does NOT contain UA, viewport, `hardwareConcurrency`, `deviceMemory`, `platform`, timezone, coordinates, `c_user`, `xs`, or cookie values
   - **And** the original error is preserved via `cause` for debugging

## Tasks / Subtasks

- [ ] **Task 1: Verify umbrella integration of fingerprint + navigator + WebRTC + timezone/geo + persistent profiles in `createPage` / `createBrowser`** (AC: #1, #2, #3, #4, #5, #6)
  - [ ] 1.1 Confirm `createPage()` calls `applyFingerprint` → `applyNavigatorOverrides` → `applyWebRTCOverride` → `applyProxyLocation` in that order
  - [ ] 1.2 Confirm `createPage(browser, { fingerprint })` reuses the provided fingerprint and still applies WebRTC + proxy-location
  - [ ] 1.3 Confirm `page._fingerprint` is attached after all overrides succeed
  - [ ] 1.4 Confirm `createBrowser({ userDataDir })` passes `userDataDir` as a Puppeteer launch option, auto-creates the directory, and strips `--incognito`
  - [ ] 1.5 Confirm failure in any override closes the page and re-throws a generic error

- [ ] **Task 2: Verify centralized fingerprint module meets Epic 6 spec** (AC: #1, #2, #3, #4, #7)
  - [ ] 2.1 Confirm `src/scrapers/facebook/fingerprint.js` is a pure module (no `puppeteer` import)
  - [ ] 2.2 Confirm exports: `UA_POOL`, `VIEWPORT_LIST`, `generateFingerprint`, `applyFingerprint`, `applyNavigatorOverrides`, `applyWebRTCOverride`
  - [ ] 2.3 Confirm `UA_POOL` has ≥20 unique real Chrome UAs covering Windows, macOS, and Linux
  - [ ] 2.4 Confirm `VIEWPORT_LIST` has ≥6 desktop viewports and includes 2560×1440
  - [ ] 2.5 Confirm `deviceScaleFactor` is derived from platform, not random
  - [ ] 2.6 Confirm injected navigator override uses `Object.defineProperty` with `get` accessors
  - [ ] 2.7 Confirm WebRTC override throws when `RTCPeerConnection` is called and disables `getUserMedia`

- [ ] **Task 3: Verify `createBrowser` anti-detection launch configuration** (AC: #4, #6)
  - [ ] 3.1 Confirm stealth args include `--no-sandbox`, `--disable-setuid-sandbox`, `--disable-blink-features=AutomationControlled`, `--disable-webrtc`
  - [ ] 3.2 Confirm proxy is injected via `--proxy-server=${proxy}` when `proxy` option is provided
  - [ ] 3.3 Confirm `puppeteer-extra-plugin-stealth` is configured globally without `iframe.contentWindow` evasion (ADR-016 persistent-profile trade-off)
  - [ ] 3.4 Confirm `executablePath` resolution order: explicit option → `PUPPETEER_EXECUTABLE_PATH` env → system Chrome path

- [ ] **Task 4: Run regression & integration tests for the full stealth stack** (AC: all)
  - [ ] 4.1 Run `npx vitest run tests/scrapers/facebook-fingerprint.test.js` — all pass
  - [ ] 4.2 Run `npx vitest run tests/scrapers/facebook-index.test.js -t "createPage"` — all pass
  - [ ] 4.3 Run `npx vitest run tests/scrapers/facebook-auth.test.js` — all pass
  - [ ] 4.4 Run `npx vitest run tests/scrapers/facebook-*.test.js` — no NEW failures
  - [ ] 4.5 Optional: run `node test-fingerprint-real.mjs` (or equivalent real-browser smoke test) if available

- [ ] **Task 5: Documentation & status update** (AC: all)
  - [ ] 5.1 Verify this umbrella story cross-references the detailed sub-story files (6-2, 6-3, 6-4, 6-5, 6-16, 6-17)
  - [ ] 5.2 Update `sprint-status.yaml` if not already updated: set `epic-6` to `in-progress`, set `6-1-browser-fingerprint-and-session-stealth` to `ready-for-dev`, update `last_updated`
  - [ ] 5.3 Record any gaps or deviations found in the Dev Agent Record below

## Dev Notes

### Architecture Compliance

- **ADR-013 — Fingerprint randomization layer (binding)**
  - `src/scrapers/facebook/fingerprint.js` is the single, centralized fingerprint module (NFR-2).
  - `generateFingerprint()` returns `{ ua, viewport, deviceScaleFactor, hardwareConcurrency, deviceMemory, platform }`.
  - `applyFingerprint(page, fingerprint)` applies only UA + viewport.
  - `applyNavigatorOverrides(page, fingerprint)` applies `navigator.webdriver`, `hardwareConcurrency`, `deviceMemory`, `platform` via `page.evaluateOnNewDocument` using `Object.defineProperty`.
  - `applyWebRTCOverride(page)` disables `RTCPeerConnection`, `webkitRTCPeerConnection`, and `navigator.mediaDevices.getUserMedia`.
  - `createPage()` is the orchestration point: it calls the three apply helpers in order, then `applyProxyLocation`.

- **ADR-016 — Session lifecycle (binding)**
  - `createBrowser({ userDataDir })` supports persistent profiles.
  - `createPage(browser, { proxyLocation })` applies timezone + geolocation + permission override when a valid proxy location is supplied.
  - `loginWithCookie()` calls `warmSession(page)` after successful login to avoid cold-session-immediate-action detection.
  - The `iframe.contentWindow` stealth evasion is disabled globally for Facebook because it conflicts with persistent profiles.

### Sub-Stories Already Implemented

This umbrella story groups the following detailed stories. Their production code and tests are already in place; do **not** re-implement them. Use them as the source of truth for implementation details and review findings:

| Sub-Story | Focus | Key File(s) | Status |
|---|---|---|---|
| 6-2 Consistent Session Fingerprint | `generateFingerprint`, `applyFingerprint`, `page._fingerprint` | `src/scrapers/facebook/fingerprint.js`, `src/scrapers/facebook/index.js` | done |
| 6-3 User-Agent Pool & Viewport Randomization | 20+ UA pool, 6 viewports, platform-aware `deviceScaleFactor` | `src/scrapers/facebook/fingerprint.js` | done |
| 6-4 Navigator Properties Override | `navigator.webdriver`, `hardwareConcurrency`, `deviceMemory`, `platform` | `src/scrapers/facebook/fingerprint.js` | done |
| 6-5 WebRTC Leak Prevention | `--disable-webrtc`, JS override | `src/scrapers/facebook/fingerprint.js`, `src/scrapers/facebook/index.js` | done |
| 6-16 Timezone & Geolocation Override | `emulateTimezone`, `setGeolocation`, `overridePermissions` | `src/scrapers/facebook/index.js` | done |
| 6-17 Persistent Browser Profiles | `userDataDir`, profile auto-creation, strip `--incognito` | `src/scrapers/facebook/index.js`, `api/services/facebookAutomation.js` | done |

### File Locations & Existing Code

| File | Role | What to verify |
|---|---|---|
| `src/scrapers/facebook/fingerprint.js` | Pure fingerprint module | Exports, UA pool, viewports, `generateFingerprint`, `applyFingerprint`, `applyNavigatorOverrides`, `applyWebRTCOverride` |
| `src/scrapers/facebook/index.js` | Browser/page orchestration | `createBrowser`, `createPage`, `applyProxyLocation`, launch args, `userDataDir` handling |
| `src/scrapers/facebook/human.js` | Behavioral simulation | `humanMoveMouse`, `humanClick`, `humanType`, `humanScroll` (used by warming and actions) |
| `src/scrapers/facebook/limits.js` | Velocity & account-age config | `LIMITS`, `ACCOUNT_AGE_TIERS`, `getActionLimit`, `enforceDelay` |
| `src/scrapers/facebook/warmup.js` | Session warming | `warmSession` called after `loginWithCookie` |
| `tests/scrapers/facebook-fingerprint.test.js` | Pure module tests | Covers UA pool, viewports, fingerprint shape, apply helpers, WebRTC, navigator overrides |
| `tests/scrapers/facebook-index.test.js` | createPage integration | Covers fingerprint reuse, call order, timezone/geo, page cleanup |
| `tests/scrapers/facebook-auth.test.js` | createBrowser tests | Covers `--disable-webrtc`, `userDataDir`, proxy args |
| `tests/helpers/fake-page.js` | Fake Puppeteer page | State-machine fake with `setUserAgent`, `setViewport`, `evaluateOnNewDocument`, `emulateTimezone`, `setGeolocation`, `overridePermissions` recorders |
| `package.json` | Dependency versions | `puppeteer ^24.34.0`, `puppeteer-extra ^3.3.6`, `puppeteer-extra-plugin-stealth ^2.11.2` |

### Key Implementation Details (from existing code)

- `createPage()` order (do not change):
  1. `browser.newPage()`
  2. `page.authenticate(proxyAuth)` if credentials are provided
  3. `applyFingerprint(page, fingerprint)`
  4. `applyNavigatorOverrides(page, fingerprint)`
  5. `applyWebRTCOverride(page)`
  6. `applyProxyLocation(page, options.proxyLocation)`
  7. Attach `page._fingerprint = fingerprint`
  8. On any failure, `page.close()` and re-throw.

- `createBrowser()` current behavior:
  - Stealth args always include `--disable-webrtc`.
  - Proxy injected as `--proxy-server=${proxy}`.
  - `userDataDir` is resolved, validated (must be inside CWD), auto-created with `fs.mkdirSync(..., { recursive: true })`, and passed as a Puppeteer launch option.
  - `--incognito` is stripped when `userDataDir` is set.
  - `puppeteer-extra` is configured with `StealthPlugin({ enabledEvasions: facebookEvasions })` where `iframe.contentWindow` is excluded.

- `fingerprint.js` current behavior:
  - `UA_POOL` has 21 unique UAs (7 Chrome versions × 3 platforms, versions 146-152).
  - `VIEWPORT_LIST` has 6 viewports: 1920×1080, 1536×864, 1440×900, 1366×768, 1280×800, 2560×1440.
  - `deriveDeviceScaleFactor(platform)`: `MacIntel` → 2, everything else → 1.
  - `applyNavigatorOverrides` passes the fingerprint object as an argument to `evaluateOnNewDocument` (not string interpolation).
  - `applyWebRTCOverride` takes only `page` (global, session-independent).

### Testing Standards

- Framework: **Vitest 4.x** (`package.json` devDependency).
- Run commands:
  - `npx vitest run tests/scrapers/facebook-fingerprint.test.js`
  - `npx vitest run tests/scrapers/facebook-index.test.js -t "createPage"`
  - `npx vitest run tests/scrapers/facebook-auth.test.js`
  - `npx vitest run tests/scrapers/facebook-*.test.js`
- `tests/helpers/fake-page.js` is a state-machine fake, not a mock; extend it if new assertions are needed.
- Real-browser smoke tests (e.g., `test-fingerprint-real.mjs`) are optional and should skip gracefully if no browser/cookie is available.

### Constraints & Anti-Patterns to Avoid

- Do **not** add new dependencies; use existing `puppeteer`, `puppeteer-extra`, `puppeteer-extra-plugin-stealth`.
- Do **not** import `puppeteer` into `fingerprint.js`, `human.js`, or `limits.js` (pure modules).
- Do **not** randomize fingerprint mid-session; one fingerprint per session is the core invariant.
- Do **not** log UA, viewport, `c_user`, `xs`, `userDataDir`, or `proxyLocation` values in errors or API responses (NFR-4).
- Do **not** pass `userDataDir` as a raw `--user-data-dir=...` launch arg; use the Puppeteer `userDataDir` launch option.
- Do **not** re-enable the `iframe.contentWindow` stealth evasion; it breaks persistent profiles.
- Do **not** guess timezone/geolocation when `proxyLocation` is missing or partial; skip silently.

### Project Conventions

- ESM only (`import`/`export`), no `require`.
- `const` over `let`, async/await.
- BSL 1.1 copyright header + `// by nichxbt` author credit in new/modified files.
- Error messages use emoji prefixes: ❌ error, ⚠️ warning, ✅ success.
- Document language is Vietnamese; code identifiers and AC bullets may be English.

## References

- [Source: _bmad-output/planning-artifacts/epics-full.md#Epic 6: Facebook Anti-Detection & Bot Countermeasures] — Epic 6 overview and Story 6.1 AC
- [Source: _bmad-output/planning-artifacts/prd-facebook-epics-5-6-2026-08-21.md#4.3 Epic 6 — Anti-Detection & Bot Countermeasures] — FR-40..FR-54, NFR-1..NFR-10
- [Source: _bmad-output/planning-artifacts/architecture.md#D.3 ADR-013] — Fingerprint randomization layer decision
- [Source: _bmad-output/planning-artifacts/architecture.md#D.4 ADR-014] — Behavioral simulation utilities
- [Source: _bmad-output/planning-artifacts/architecture.md#D.5 ADR-015] — Velocity & account-age config
- [Source: _bmad-output/planning-artifacts/architecture.md#D.6 ADR-016] — Session lifecycle (warming, timezone/geo, persistent profiles)
- [Source: _bmad-output/implementation-artifacts/6-2-consistent-fingerprint.md] — Detailed sub-story for consistent session fingerprint
- [Source: _bmad-output/implementation-artifacts/6-3-ua-pool-viewport.md] — Detailed sub-story for UA pool & viewport randomization
- [Source: _bmad-output/implementation-artifacts/6-4-navigator-override.md] — Detailed sub-story for navigator override
- [Source: _bmad-output/implementation-artifacts/6-5-webrtc-leak-prevention.md] — Detailed sub-story for WebRTC leak prevention
- [Source: _bmad-output/implementation-artifacts/6-16-timezone-geolocation.md] — Detailed sub-story for timezone & geolocation override
- [Source: _bmad-output/implementation-artifacts/6-17-persistent-profiles.md] — Detailed sub-story for persistent browser profiles
- [Source: src/scrapers/facebook/fingerprint.js] — Fingerprint module implementation
- [Source: src/scrapers/facebook/index.js] — `createBrowser`, `createPage`, `applyProxyLocation`
- [Source: src/scrapers/facebook/human.js] — Behavioral simulation utilities
- [Source: src/scrapers/facebook/limits.js] — Velocity limits & account-age tiers
- [Source: src/scrapers/facebook/warmup.js] — Session warming sequence
- [Source: package.json] — Dependency versions
- [Source: tests/scrapers/facebook-fingerprint.test.js] — Fingerprint module tests
- [Source: tests/scrapers/facebook-index.test.js] — `createPage` integration tests
- [Source: tests/scrapers/facebook-auth.test.js] — `createBrowser` tests
- [Source: tests/helpers/fake-page.js] — Fake page helper

## Dev Agent Record

### Agent Model Used

Devin CLI (subagent) — story file generation and status update.

### Debug Log References

- `npx vitest run tests/scrapers/facebook-fingerprint.test.js` → 59/59 pass (duration 382ms)

### Completion Notes List

- [x] Created umbrella story file `_bmad-output/implementation-artifacts/6-1-browser-fingerprint-and-session-stealth.md`
- [x] Referenced and synthesized sub-stories 6-2, 6-3, 6-4, 6-5, 6-16, 6-17 (no verbatim copy)
- [x] Mapped Epic 6 FR-40, FR-41, FR-42, FR-43, FR-49, FR-50, FR-51, FR-52 and NFR-2, NFR-4 to AC
- [x] Documented existing code in `src/scrapers/facebook/fingerprint.js`, `index.js`, `human.js`, `limits.js`, `warmup.js`
- [x] Listed test commands and fake-page helper
- [x] Updated `sprint-status.yaml`: `epic-6` → `in-progress`, `6-1-browser-fingerprint-and-session-stealth` → `ready-for-dev`, `last_updated` → `2026-08-20T22:41:11.000Z`
- [x] Ran `npx vitest run tests/scrapers/facebook-fingerprint.test.js` — 59/59 pass

### File List

- `_bmad-output/implementation-artifacts/6-1-browser-fingerprint-and-session-stealth.md` (NEW)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (MODIFIED)
