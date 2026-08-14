---
baseline_commit: 191dd7f
---

# Story 5.6: Facebook Marketplace Scraper + Headless Mode + Share-Link-UID V2

Status: done

<!-- New features added 2026-08-12: Marketplace scraper, headless mode for all Facebook endpoints, share-link-uid rewritten to use direct Messenger URL approach. -->

## Story

As a growth marketer using XActions,
I want to scrape Facebook Marketplace listings and control browser visibility during automation,
so that I can research products/prices and debug automation with a visible browser.

## Acceptance Criteria

**AC1 — Marketplace Scraper**
1. `POST /api/facebook/scrape` accepts `action: "marketplace"` with `query` parameter
2. Returns array of `{ id, title, price, location, image, listingUrl, platform, source }`
3. Supports pagination via scroll (stall detection)
4. Handles price parsing: `$115,000`, `CA$50,000`, `ETB28,000`, `₹25,000`
5. Handles title extraction from concatenated text (camelCase splitting)
6. Handles location extraction (trailing capitalized word heuristics)

**AC2 — Headless Mode**
7. All Facebook endpoints accept `headless` boolean parameter
8. `headless: true` (default) — invisible browser, faster execution
9. `headless: false` — visible browser window, longer delays for monitoring
10. `loginWithCookie` uses appropriate timeout/wait strategy based on headless mode
11. Response includes `headless: true/false` confirming the mode used

**AC3 — Share-Link-UID V2 (Direct Messenger URL)**
12. `POST /api/facebook/automate` with `action: "share-link-uid"` accepts `recipientUid` or `recipientUids[]`
13. Flow: navigate to `messages/t/{uid}` → paste URL via clipboard → Enter to send
14. Works without display names (UID-based)
15. Doesn't require recipients to be in share dialog's friend list
16. Returns per-recipient results: `{ uid, ok, sharesSent, method }`

**AC4 — Chrome executablePath**
17. `createBrowser` resolves executablePath: explicit option → env var → system Chrome
18. Fixes "Could not find Chrome" errors on machines with system Chrome installed

## Tasks / Subtasks

- [x] Task 1 — Marketplace Scraper (AC1)
  - [x] Add `scrapeMarketplace(page, query, options)` to `src/scrapers/facebook/index.js`
  - [x] Register `marketplace: 'scrapeMarketplace'` in `src/scrapers/index.js` action map
  - [x] Add `marketplace` to valid actions in `api/routes/facebook.js` scrape endpoint
  - [x] Parse concatenated price+title+location text from listing cards

- [x] Task 2 — Headless Mode (AC2)
  - [x] Add `headless` parameter to `/api/facebook/automate` route
  - [x] Pass `headless` to `createBrowser()` and `loginWithCookie()`
  - [x] Use `domcontentloaded` + longer timeouts when `headless: false`
  - [x] Use `networkidle2` + shorter delays when `headless: true`
  - [x] Wrap messenger-share `createBrowser` to pass headless option

- [x] Task 3 — Share-Link-UID V2 (AC3)
  - [x] Rewrite `src/scrapers/facebook/shareLinkByUid.js` with direct Messenger URL approach
  - [x] Add `sendUrlToUid(page, recipientUid, postUrl, delay, headless)` helper
  - [x] Update `api/routes/facebook.js` share-link-uid path to support `recipientUid`/`recipientUids[]`
  - [x] Add dry-run support for share-link-uid (no browser launch)

- [x] Task 4 — Chrome executablePath (AC4)
  - [x] Update `createBrowser()` to resolve system Chrome path
  - [x] Support `executablePath` option and `PUPPETEER_EXECUTE_PATH` env var

## Dev Notes

### Marketplace Scrapers
- Facebook Marketplace card text concatenates price + title + location without separators
- Price is always first (currency symbol + digits)
- Title follows price (product name, may contain emoji)
- Location is trailing capitalized word(s) — city names like "Jijiga", "Harar", "Dire Dawa"
- CamelCase splitting: insert space before uppercase letters following lowercase/digits

### Headless Mode Implementation
- `headless: true` → `networkidle2`, delays 5-8s
- `headless: false` → `domcontentloaded`, delays 8-12s, console logging of actions
- `loginWithCookie`: 30s timeout (headless) vs 60s timeout (visible)

### Share-Link-UID V2 vs V1
- V1: Click share button → click "via Messenger" → click recipient avatars (share dialog)
- V2: Navigate to `messages/t/{uid}` → paste URL → Enter (direct)
- V2 is more reliable: works with UIDs, no friend list requirement, one-click send

### File List
- `src/scrapers/facebook/index.js` (UPDATED) — scrapeMarketplace, createBrowser executablePath, loginWithCookie headless
- `src/scrapers/facebook/shareLinkByUid.js` (REWRITTEN) — direct Messenger URL approach
- `src/scrapers/index.js` (UPDATED) — marketplace action mapping
- `api/routes/facebook.js` (UPDATED) — marketplace action, headless mode, share-link-uid v2
- `docs/agents/facebook-api.md` (NEW) — complete Facebook API reference
- `docs/agents/selectors-facebook.md` (UPDATED) — marketplace selectors
- `docs/README.md` (UPDATED) — Facebook doc links

## Completion Notes

- **Marketplace**: VERIFIED 2026-08-12 — 50 listings extracted per query, price/title/location parsing working
- **Headless Mode**: VERIFIED 2026-08-12 — both modes work, visible mode shows console logs
- **Share-Link-UID V2**: VERIFIED 2026-08-12 — direct Messenger URL approach working with UIDs
- **Chrome Fix**: VERIFIED 2026-08-12 — system Chrome resolved correctly

### Test Results
```
✅ action=marketplace + headless=true  → 50 listings
✅ action=marketplace + headless=false → 50 listings (browser visible)
✅ share-link-uid single recipient     → successCount: 1/1
✅ share-link-uid multiple recipients  → successCount: 2/2
✅ share-link-uid headless=false      → browser visible, console logs shown
```
