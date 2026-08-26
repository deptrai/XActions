# ATDD Checklist — Story 13.4: Facebook Browser-as-Signer Integration

**Story ID:** `13.4`  
**Story Key:** `13-4-facebook-browser-as-signer-bridge`  
**Epic:** 13 (Tiered Hybrid Signer & Facebook Hybrid Scraper Engine)  
**Phase:** Red Phase Scaffold  
**Date:** 2026-08-26  
**Author:** Master Test Architect  

---

## 1. Acceptance Criteria Mapping & Test Status

| AC | Requirement Description | Test File & Test Description | Target Phase | Status |
|---|---|---|---|---|
| **AC-1** | `FacebookClient` accepts `tokenRing`, `signerPool`, `browserBridge`, `cdpUrl`, `launchChrome`, `adapterName`, `headless`, `userDataDir`, `profileDir`, `httpFallback` and exposes `close()` | `tests/scrapers/social/facebook/client-signer.test.js` > `[P0] should accept browser bridge and tiered signer dependencies in constructor` | Unit / Contract | 🔴 RED |
| **AC-2** | Browser token extraction via `FacebookBrowserBridge` (evaluates `lsd`, `jazoest`, `dtsg`, `spin_r`, `spin_t`, `hsi`, `__rev`, `c_user`) with timeout, retry, and compound key caching | `tests/scrapers/social/facebook/client-signer.test.js` > `[P0] should extract Facebook tokens via FacebookBrowserBridge and evaluate live page context` | Integration | 🔴 RED |
| **AC-3** | `requestGraphQl()` consumes tokens produced by browser bridge for form-urlencoded payload | `tests/scrapers/social/facebook/client-signer.test.js` > `[P0] should dispatch requestGraphQl using tokens extracted by browser bridge` | Integration | 🔴 RED |
| **AC-4** | CDP attach & launch mode reuses Chrome when available or auto-launches | `tests/scrapers/social/facebook/client-signer.test.js` > `[P1] should attach to existing Chrome via CDP or auto-launch when configured` | Integration | 🔴 RED |
| **AC-5** | Playwright is the default browser adapter for CDP attach (`XACTIONS_SCRAPER_ADAPTER` fallback) | `tests/scrapers/social/facebook/client-signer.test.js` > `[P0] should default to PlaywrightAdapter for CDP attach when adapter is unspecified` | Contract | 🔴 RED |
| **AC-6** | Per-account profile (`.data/facebook-profiles/<c_user>`) and sticky proxy anti-leak isolation | `tests/scrapers/social/facebook/client-signer.test.js` > `[P1] should isolate user data directory by c_user and apply anti-leak proxy args` | Integration | 🔴 RED |
| **AC-7** | HTTP extraction fallback when browser bridge is not configured or fails | `tests/scrapers/social/facebook/client-signer.test.js` > `[P0] should fallback to HTTP token extraction when browser bridge is unconfigured or fails with httpFallback` | Fallback | 🔴 RED |
| **AC-8** | Token refresh before expiry (30s pre-expiry window) and deduplicated in-flight fetches | `tests/scrapers/social/facebook/client-signer.test.js` > `[P1] should refresh tokens when within 30s pre-expiry window and deduplicate concurrent calls` | Lifecycle | 🔴 RED |
| **AC-9** | `PreSignedTokenRing` refill with `lsd` string and O(1) allocation in `buildGraphQlBody` | `tests/scrapers/social/facebook/client-signer.test.js` > `[P0] should refill PreSignedTokenRing with lsd and use tokenRing.next() in buildGraphQlBody` | Contract | 🔴 RED |
| **AC-10**| `FacebookCrawler` actions & normalization preserved; `cleanup()` calls `client.close()` | `tests/scrapers/social/facebook/client-signer.test.js` > `[P1] should preserve FacebookCrawler actions and close browser bridge during cleanup()` | Integration | 🔴 RED |
| **AC-11**| `cdp-launcher.js` proxy and anti-leak arguments support | `tests/scrapers/social/facebook/client-signer.test.js` > `[P1] should build Chrome args with proxy and anti-leak options in cdp-launcher` | Unit | 🔴 RED |
| **AC-12**| No-mock compliance with local HTTP server and live adapters | All tests in `tests/scrapers/social/facebook/client-signer.test.js` | Quality Gate | 🔴 RED |
| **AC-13**| Deprecation plan updated for HTTP-only extraction path | `docs/deprecation-plan.md` tracker review | Documentation | 🔴 RED |

---

## 2. Test Execution Commands

```bash
# Run Story 13.4 signer bridge test suite
npm test -- tests/scrapers/social/facebook/client-signer.test.js

# Run full Facebook regression test suite
npm test -- tests/scrapers/social/facebook/

# Typecheck validation
npm run typecheck
```

---

## 3. Red Phase Verification Sign-off

- [x] Test scaffolds created with deterministic assertions and realistic local test server.
- [x] Zero mocks / stubs / fakes used (strictly complies with `AGENTS.md` and `CLAUDE.md`).
- [x] All 7 test cases in `client-signer.test.js` intentionally fail with `ERR_MODULE_NOT_FOUND` or missing methods before Story 13.4 implementation begins.
