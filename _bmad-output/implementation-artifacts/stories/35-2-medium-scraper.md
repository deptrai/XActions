---
epic: 35
story: 35.2
status: draft
created: '2026-09-09'
updated: '2026-09-09'
---

# Story 35.2: Medium Scraper (Client + Crawler + Validator + Tests)

## Epic
Epic 35: Reddit, Medium & Instagram Scraper Expansion

## Goal
Deliver a working Medium scraper that can collect public posts via RSS feed and HTML rendering without authentication.

## FRs Covered
- FR-99 (Medium RSS/HTML Scraper)

## NFRs Covered
- NFR-1 (1–3s delays between actions)
- NFR-2 (rate limit handling)
- NFR-4 (real implementations only in tests)

## Story

As an XActions user,
I want to scrape Medium posts by user, publication, or tag,
So that I can gather long-form content for analysis.

## Acceptance Criteria

### AC-1: MediumClient fetches RSS feed
**Given** a public Medium username `@username`  
**When** `crawl({ action: 'user', args: { username: 'username', limit: 25 } })` is called  
**Then** it fetches `https://medium.com/@username/feed`  
**And** returns `PostItem[]` with `id`, `platform: 'medium'`, `title`, `link`, `pubDate`, `creator`, `categories`

### AC-2: MediumClient fallback HTML scraping
**Given** Medium RSS feed returns 403 or empty  
**When** `crawl` falls back to HTML mode  
**Then** it fetches `https://medium.com/@username`  
**And** parses public post cards via `cheerio`  
**And** returns `PostItem[]` with title, link, and snippet

### AC-3: MediumClient fetches publication
**Given** a Medium publication slug `publication-name`  
**When** `crawl({ action: 'publication', args: { slug: 'publication-name', limit: 25 } })` is called  
**Then** it fetches `https://medium.com/feed/publication-name` (or HTML fallback)  
**And** returns `PostItem[]`

### AC-4: MediumClient fetches tag
**Given** a Medium tag `tag-name`  
**When** `crawl({ action: 'tag', args: { tag: 'tag-name', limit: 25 } })` is called  
**Then** it fetches `https://medium.com/tag/tag-name` HTML  
**And** returns `PostItem[]`

### AC-5: MediumClient normalizes RSS item
**Given** an RSS `<item>` with `guid`, `title`, `link`, `pubDate`, `dc:creator`, `category[]`, `content:encoded`  
**When** `normalizeMediumRss(item)` is called  
**Then** it returns `PostItem` with `id` = `medium:${guid}`, `content` extracted from `content:encoded`

### AC-6: Medium validation
**Given** a raw Medium post or RSS item  
**When** `MediumValidator.validatePost(raw)` is called  
**Then** it throws `ValidationError` if `guid`, `title`, or `link` is missing  
**And** it returns `true` for valid items

### AC-7: Rate limiting and delays
**Given** a sequence of Medium requests  
**When** multiple requests are made  
**Then** each request is spaced 1–3s apart  
**And** `429` responses trigger exponential backoff

### AC-8: Tests
**Given** no mocks or stubs  
**When** `vitest run tests/scrapers/medium` is executed  
**Then** all client, crawler, normalizer, and validator tests pass

## Files to Create/Modify
- `src/scrapers/social/medium/client.js`
- `src/scrapers/social/medium/crawler.js`
- `src/scrapers/social/medium/normalizer.js`
- `src/scrapers/social/medium/validator.js`
- `src/scrapers/social/medium/index.js`
- `tests/scrapers/medium/client.test.js`
- `tests/scrapers/medium/crawler.test.js`
- `tests/scrapers/medium/normalizer.test.js`
- `tests/scrapers/medium/validator.test.js`
- `src/scrapers/social/index.js` (add export)

## Out of Scope
- Medium member-only content
- Medium publishing or interaction (clap, comment)
- Official Medium API (deprecated)

## Open Questions
- OQ-1: Should we cache `feed` XML for 5 minutes to reduce repeated requests?
- OQ-2: Should HTML fallback use Puppeteer if `cheerio` fails?
