# Epic 27 Context: Anti-Detection & Session Resilience

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Harden XActions' anti-detection and session-resilience layers so scraping is proactive, continuous, and self-healing rather than reactive. This epic builds on `AdaptiveRateGovernor`, `AccountPool`, `ProxyIpPool`, and `StealthBrowser`: fingerprints must be geo-consistent and stable per account, dying/challenged sessions must be pulled from rotation before they poison data, bot challenges must be detected by signature (not just status code), and public/guest scraping must be able to run on a lighter browser backend without weakening post-auth automation.

## Stories

- Story 27.1: FingerprintManager — TLS/JA4 Spoofing & Geo-Consistent Profiles
- Story 27.2: SessionHealthOrchestrator — Continuous Health Score & Circuit Breaker
- Story 27.3: ChallengeSignatureDetector — Automated Bot Detection Page Detection
- Story 27.4: Obscura Browser Backend — Public-Scraping Transport & Watch/Promote Gate

## Requirements & Constraints

- Fingerprints are complete and geo-consistent: UA, viewport, timezone, locale, colorDepth, platform, WebGL vendor/renderer, fonts, `navigator.hardwareConcurrency`, `navigator.deviceMemory`; derived proxy region must match timezone/locale. Persisted per account to avoid rotation that triggers re-auth.
- `launchStealthBrowser()` consumes `FingerprintManager.getForAccount(accountId)` so fingerprint + proxy + timezone stay consistent per account.
- Session health is a continuous score with a circuit breaker and recovery probe; a challenged/dying account leaves rotation before poisoning downstream data.
- Bot challenges are detected by page signature (ChallengeSignatureDetector), feeding `governor.recordBotChallenge()`.
- **Pluggable browser backend (AD-23, FR-102):** `chrome` is the default and the only allowed backend for post-auth automation; `obscura` is opt-in for public/guest-visible scraping only. Backend resolution lives at the adapter layer (`PuppeteerAdapter.launch/connect`) and `launchStealthBrowser`, sharing the `options.backend`/`XACTIONS_BROWSER_BACKEND` contract. Post-auth (`requiresAuth===true`) must reject `obscura` with a typed `PlatformError` — no silent fallback.

## Technical Decisions

- **Backend entry point = adapter layer, not only `stealthBrowser`.** Public scraper bridges (reddit/medium/instagram/facebook/tiktok) get a browser via `BaseAdapter.launch()` → `PuppeteerAdapter`. `launchStealthBrowser` has only one direct caller; thread `backend`/`requiresAuth` through `adapter.launch()`.
- **Obscura connect-only via CDP:** `puppeteer-core.connect({ browserWSEndpoint })` to `ws://127.0.0.1:9222` (`obscura serve --stealth` runs out-of-process). Never spawn/manage the binary in the library; `disconnect()` (not `close()`) on teardown — teardown reads `browser.__backend` (`obscura`→`disconnect()`, `chrome`→`close()`).
- **`waitUntil:'networkidle0'` only on Obscura** (0.2.x hangs `networkidle2`); `domcontentloaded`/`load`/`networkidle0` are fine.
- **Guard reuses resolved `requiresAuth`** (`base-crawler.js:177`, `base-client.js:711`) — no separate `AUTH_REQUIRED_ACTIONS` registry.
- **Primary/fallback:** `XACTIONS_BROWSER_BACKEND` (primary) + `XACTIONS_BROWSER_BACKEND_FALLBACK` (default `chrome`). `obscura→chrome` always allowed; `chrome→obscura` only on public-scraping path (post-auth still throws).
- **Per-backend telemetry:** `XACTIONS_BROWSER_BACKEND_METRICS=1` tags real browser launches with `browserBackend` in Epic-34 `emitRun`; per-backend comparison via `scripts/obscura-spike.mjs BACKEND=both`. `CanaryRunner` (HTTP probe) is unchanged.
- **`userDataDir`→`--storage-dir`** mapping is documented, not silently dropped (different persistence semantics).
- **Watch → Verify → Promote gate:** no auto-update; `obscura-for-auth` opens only after spike-verify (`/home` mounts `data-testid`) + change request + human approve. Tracked issues: #531 (SPA hydration), #886/#643/#683 (network-idle), #817/#866 (SPA).
- Keep `puppeteer` + `puppeteer-extra` + stealth plugin as default; `puppeteer-core` promoted to a direct dependency; zero other new deps.

## Cross-Story Dependencies

- Story 27.4 reuses `browser.__fingerprint` attached by Story 27.1 (`FingerprintManager`) — `createStealthPage` reads it regardless of backend.
- Story 27.4 depends on `PlatformError`/`ErrorTypes.INVALID_ARGS` (Story 28.1 territory, `src/core/error-envelope.js`) and the `requiresAuth` resolution already in `base-crawler`/`base-client`.
- Story 27.4 guard/fallback must not regress Story 27.2 health scoring or Story 27.3 challenge detection — `obscura` failures still surface as `PlatformError`/bot-challenge signals.
- `facebook-gateway` invariant: only `SessionFactory` may launch a browser — if Obscura is used there it must go through `SessionFactory.createBrowser`.
