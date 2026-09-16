# Utility Script & Adapter Audit — Epic 24

**Date:** 2026-09-16  
**Story:** 24.1 — Inventory & Deprecation Decision for Standalone Scripts  
**Auditor:** Claude (BMAD workflow)

---

## Executive Summary

| Category | Total Files | Keep | Convert-to-Action | Archive | Delete |
|----------|-------------|------|-------------------|---------|--------|
| Standalone scripts (`src/scrapers/*.js`) | 9 | 5 | 3 | 1 | 0 |
| Adapters (`src/scrapers/adapters/*.js`) | 9 | 4 | 0 | 5 | 0 |

**Key finding:** Most standalone browser scripts are orphaned (0 imports). Adapter layer is over-provisioned — 5 of 9 adapters have zero usage.

---

## Standalone Scripts Audit

### Files to KEEP (still in use)

| File | Purpose | Context | Imports | Decision |
|------|---------|---------|---------|----------|
| `browser.js` | Shared browser utilities (`createBrowser`, `createPage`, `loginWithCookie`, `exportToJSON/CSV`) | Node.js library | 4+ (index.js, deprecation-proxy.js, b2b-registry-extended, medium/bridge.js) | ✅ **keep** — core utility |
| `platforms.js` | Platform registry + `actionNotAvailable` helper | Node.js | 6+ (descriptor files, index.js) | ✅ **keep** — Story 25.1 infrastructure |
| `deprecation-proxy.js` | Legacy platform re-exports with deprecation warnings | Node.js | 1 (platforms.js) | ✅ **keep** — backward compat layer |
| `index.js` | Main dispatcher | Node.js | — | ✅ **keep** — Story 25.1 dispatcher |
| `index.d.ts` | TypeScript declarations | Types | — | ✅ **keep** — types |

### Files to CONVERT-TO-ACTION (useful features, orphaned)

| File | Purpose | Context | Imports | Decision | Target Story |
|------|---------|---------|---------|----------|--------------|
| `videoDownloader.js` | Download X/Twitter videos | Browser console | 0 | 🔄 **convert-to-action** | 24.2 → `TwitterCrawler.download_video()` |
| `bookmarkExporter.js` | Export bookmarks to JSON/CSV | Browser console | 0 | 🔄 **convert-to-action** | 24.2 → `TwitterCrawler.export_bookmarks()` |
| `threadUnroller.js` | Save thread as clean text/markdown | Browser console | 0 | 🔄 **convert-to-action** | 24.2 → `TwitterCrawler.unroll_thread()` |

### Files to ARCHIVE (orphaned, no conversion needed)

| File | Purpose | Context | Imports | Decision |
|------|---------|---------|---------|----------|
| `showMoreExpander.js` | Click "Show more" to expand tweet text | Browser console | 0 | 📦 **archive** — superseded by hybrid crawler |
| `viralTweets.js` | Find top tweets by keyword/account | Browser console | 0 | 📦 **archive** — superseded by `search` action |

### Files to DELETE (none identified)

| File | Reason |
|------|--------|
| — | All files either in use or worth archiving |

---

## Adapter Layer Audit

### Current State

| Adapter | Purpose | Registered | Imports | Used By |
|---------|---------|------------|---------|---------|
| `base.js` | BaseAdapter contract | — | 22 | All adapters, medium/bridge.js |
| `puppeteer.js` | Puppeteer adapter | `puppeteer`, `pptr` | 1 | `cdp-launcher.js` (default), `browser.js` |
| `playwright.js` | Playwright adapter | `playwright`, `pw` | 0 | — |
| `http.js` | HTTP-only adapter | `http` | 0 | Referenced in docs/comments only |
| `selenium.js` | Selenium adapter | `selenium` | 0 | — |
| `cheerio.js` | Cheerio adapter | `cheerio` | 0 | — |
| `crawlee.js` | Crawlee adapter | `crawlee`, `apify` | 0 | — |
| `got-jsdom.js` | Got+JSDOM adapter | `got-jsdom`, `got`, `jsdom` | 0 | — |

### Recommended Consolidation

| Decision | Adapters | Rationale |
|----------|----------|-----------|
| **Keep** | `base.js`, `puppeteer.js`, `playwright.js` | `base.js` is the contract; `puppeteer` is default; `playwright` is the modern alternative |
| **Keep** | `http.js` | Referenced in `browser.js` adapter option (`adapter: 'http'`) — may be used by consumers |
| **Archive** | `selenium.js`, `cheerio.js`, `crawlee.js`, `got-jsdom.js` | Zero imports, no registered usage |
| **Delete** | — | None — archive preserves history |

### Adapter Registry Cleanup

```javascript
// Current (12 registrations)
registerBuiltin('puppeteer', () => import('./puppeteer.js'));
registerBuiltin('playwright', () => import('./playwright.js'));
registerBuiltin('cheerio', () => import('./cheerio.js'));
registerBuiltin('crawlee', () => import('./crawlee.js'));
registerBuiltin('got-jsdom', () => import('./got-jsdom.js'));
registerBuiltin('selenium', () => import('./selenium.js'));
registerBuiltin('http', () => import('./http.js'));
registerBuiltin('pw', () => import('./playwright.js'));
registerBuiltin('pptr', () => import('./puppeteer.js'));
registerBuiltin('got', () => import('./got-jsdom.js'));
registerBuiltin('jsdom', () => import('./got-jsdom.js'));
registerBuiltin('apify', () => import('./crawlee.js'));

// Recommended (5 registrations)
registerBuiltin('puppeteer', () => import('./puppeteer.js'));
registerBuiltin('playwright', () => import('./playwright.js'));
registerBuiltin('http', () => import('./http.js'));
registerBuiltin('pw', () => import('./playwright.js'));
registerBuiltin('pptr', () => import('./puppeteer.js'));
```

---

## Migration Plan

### Phase 1: Archive Orphaned Files (Story 24.4)

```bash
# Create archive directory
mkdir -p archive/scrapers/{scripts,adapters}

# Move standalone scripts
git mv src/scrapers/videoDownloader.js archive/scrapers/scripts/
git mv src/scrapers/bookmarkExporter.js archive/scrapers/scripts/
git mv src/scrapers/threadUnroller.js archive/scrapers/scripts/
git mv src/scrapers/showMoreExpander.js archive/scrapers/scripts/
git mv src/scrapers/viralTweets.js archive/scrapers/scripts/
git mv src/scrapers/videoDownloader.d.ts archive/scrapers/scripts/
git mv src/scrapers/bookmarkExporter.d.ts archive/scrapers/scripts/
git mv src/scrapers/threadUnroller.d.ts archive/scrapers/scripts/
git mv src/scrapers/showMoreExpander.d.ts archive/scrapers/scripts/
git mv src/scrapers/viralTweets.d.ts archive/scrapers/scripts/

# Move unused adapters
git mv src/scrapers/adapters/selenium.js archive/scrapers/adapters/
git mv src/scrapers/adapters/cheerio.js archive/scrapers/adapters/
git mv src/scrapers/adapters/crawlee.js archive/scrapers/adapters/
git mv src/scrapers/adapters/got-jsdom.js archive/scrapers/adapters/
```

### Phase 2: Convert Features to Actions (Story 24.2)

Add to `TwitterCrawler` in `src/scrapers/social/twitter/crawler.js`:

```javascript
// Action: download_video
this.registerAction({
  action: 'download_video',
  description: 'Download video from tweet',
  requiredArgs: ['tweetId'],
  optionalArgs: ['quality'],
  handler: (args) => this.downloadVideo(args),
});

// Action: export_bookmarks
this.registerAction({
  action: 'export_bookmarks',
  description: 'Export user bookmarks',
  requiredArgs: ['username'],
  optionalArgs: ['limit', 'format'],
  handler: (args) => this.exportBookmarks(args),
});

// Action: unroll_thread
this.registerAction({
  action: 'unroll_thread',
  description: 'Unroll tweet thread to text/markdown',
  requiredArgs: ['tweetId'],
  optionalArgs: ['format'],
  handler: (args) => this.unrollThread(args),
});
```

### Phase 3: Adapter Consolidation (Story 24.3)

Update `src/scrapers/adapters/index.js`:

```javascript
// Remove registrations for archived adapters
registerBuiltin('puppeteer', () => import('./puppeteer.js'));
registerBuiltin('playwright', () => import('./playwright.js'));
registerBuiltin('http', () => import('./http.js'));
registerBuiltin('pw', () => import('./playwright.js'));
registerBuiltin('pptr', () => import('./puppeteer.js'));
```

---

## Open Questions

1. **Is `http.js` adapter actually used at runtime?** — Referenced in `browser.js` (`adapter: 'http'`) but no direct imports found. May be used by external consumers via `createBrowser({ adapter: 'http' })`.
2. **Should we keep `browser.js` in `src/scrapers/`?** — It's a utility, not a scraper. Consider moving to `src/utils/browser.js` in future refactor.
3. **Deprecation timeline for archived scripts?** — Recommend keeping in `archive/` for 1 release cycle, then delete.

---

## Approval

| Role | Name | Decision | Date |
|------|------|----------|------|
| Platform Engineer | — | ☐ Approve | — |
| Codebase Maintainer | — | ☐ Approve | — |

---

**Next:** Story 24.4 (archive) → Story 24.2 (convert) → Story 24.3 (consolidate)
