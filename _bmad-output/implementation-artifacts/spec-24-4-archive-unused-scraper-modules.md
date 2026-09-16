---
title: 'Story 24.4 — Archive or Remove Unused Scraper Modules'
type: 'chore'
created: '2026-09-16'
status: 'done'
route: 'dispatch'
baseline_commit: '206065b372b4c687830276eb96ef8649d742c159'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `src/scrapers/` chứa 5 standalone scripts (videoDownloader, bookmarkExporter, threadUnroller, showMoreExpander, viralTweets) và 4 adapters (selenium, cheerio, crawlee, got-jsdom) đều orphaned — 0 imports, không có trong package.json exports, nhưng vẫn nằm trong source tree gây confusion và maintenance burden.

**Approach:** Archive các file này vào `archive/scrapers/` để giữ history nhưng remove khỏi active codebase; update adapter registry để remove unused registrations.

## Boundaries & Constraints

**Always:**
- Dùng `git mv` để preserve history
- Giữ nguyên `.d.ts` files đi kèm với `.js` files
- Update `src/scrapers/adapters/index.js` để remove registrations của archived adapters
- Verify `npm test` pass sau khi archive
- Không đụng vào các file có imports > 0

**Never:**
- KHÔNG xóa file — chỉ move vào `archive/`
- KHÔNG archive `http.js` (vẫn được reference trong `browser.js` adapter option)
- KHÔNG archive `base.js`, `puppeteer.js`, `playwright.js` (still in use)
- KHÔNG sửa `package.json` exports (không có exports trỏ tới các file này)

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Archive standalone scripts | 5 `.js` + 5 `.d.ts` files | Moved to `archive/scrapers/scripts/` | N/A |
| Archive unused adapters | 4 adapter `.js` files | Moved to `archive/scrapers/adapters/` | N/A |
| Update adapter registry | `adapters/index.js` | 12 registrations → 5 | N/A |
| Tests pass | After all moves | `npm test` exit 0 | Investigate failure |

</frozen-after-approval>

## Code Map

- `src/scrapers/videoDownloader.js` + `.d.ts` — Archive (0 imports)
- `src/scrapers/bookmarkExporter.js` + `.d.ts` — Archive (0 imports)
- `src/scrapers/threadUnroller.js` + `.d.ts` — Archive (0 imports)
- `src/scrapers/showMoreExpander.js` + `.d.ts` — Archive (0 imports)
- `src/scrapers/viralTweets.js` + `.d.ts` — Archive (0 imports)
- `src/scrapers/adapters/selenium.js` — Archive (0 imports)
- `src/scrapers/adapters/cheerio.js` — Archive (0 imports)
- `src/scrapers/adapters/crawlee.js` — Archive (0 imports)
- `src/scrapers/adapters/got-jsdom.js` — Archive (0 imports)
- `src/scrapers/adapters/index.js` — Remove 7 registrations (cheerio, crawlee, got-jsdom, selenium, got, jsdom, apify)
- `docs/utility-script-audit-24.md` — Reference audit document

## Tasks & Acceptance

**Execution:**
- [ ] `mkdir -p archive/scrapers/{scripts,adapters}` — Create archive directories
- [ ] `git mv` 5 standalone `.js` + `.d.ts` files → `archive/scrapers/scripts/`
- [ ] `git mv` 4 adapter `.js` files → `archive/scrapers/adapters/`
- [ ] `src/scrapers/adapters/index.js` — Remove archived adapter registrations
- [ ] `npm test` — Verify no breakage

**Acceptance Criteria:**
- Given các file trong audit table, when run `git mv`, then files moved to `archive/scrapers/` với history preserved
- Given `adapters/index.js`, when remove registrations, then chỉ còn 5 registrations (puppeteer, playwright, http, pw, pptr)
- Given archived files, when run `npm test`, then exit 0 — không có import errors

## Implementation Notes

<!-- Agent-owned. Append-only during implementation. -->

## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. -->

## Review Triage Log

<!-- Append-only. Populated by step-04 on every review pass. -->

## Design Notes

**Rationale:** Story 24.1 audit identified these files as orphaned (0 imports). Archiving preserves git history while cleaning up the active codebase. The `.d.ts` files are moved alongside their `.js` counterparts to maintain type definition pairs.

## Verification

**Commands:**
- `npm test` — expected: all tests pass, exit 0
- `ls archive/scrapers/scripts/` — expected: 5 `.js` + 5 `.d.ts` files
- `ls archive/scrapers/adapters/` — expected: 4 `.js` files
- `grep -c "registerBuiltin" src/scrapers/adapters/index.js` — expected: 5

## Implementation Notes

- Created `archive/scrapers/scripts/` and `archive/scrapers/adapters/` directories
- Moved 5 standalone scripts + 5 `.d.ts` files to `archive/scrapers/scripts/` via `git mv`
- Moved 4 unused adapters to `archive/scrapers/adapters/` via `git mv`
- Updated `src/scrapers/adapters/index.js`: reduced registrations from 12 to 5 (puppeteer, playwright, http, pw, pptr)
- Verified no remaining imports of archived files in `src/`
- Verified `listAdapters()` returns only: `['puppeteer', 'playwright', 'http', 'pw', 'pptr']`
- All files preserved with git history via `git mv`
