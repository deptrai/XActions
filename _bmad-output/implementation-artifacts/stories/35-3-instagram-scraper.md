---
epic: 35
story: 35.3
status: draft
created: '2026-09-09'
updated: '2026-09-09'
---

# Story 35.3: Instagram Scraper (Client + Crawler + Session/Proxy + Tests)

## Epic
Epic 35: Reddit, Medium & Instagram Scraper Expansion

## Goal
Deliver an Instagram scraper that can collect public profile and media data via Puppeteer or a private API bridge, with mandatory proxy and session management.

## FRs Covered
- FR-100 (Instagram Hybrid Scraper)

## NFRs Covered
- NFR-1 (1–3s delays between actions)
- NFR-2 (rate limit handling)
- NFR-3 (proxy rotation and session persistence)
- NFR-4 (real implementations only in tests)

## Story

As an XActions user,
I want to scrape Instagram profiles, media, and hashtags,
So that I can analyze visual social content and influencer data.

## Acceptance Criteria

### AC-1: InstagramClient Puppeteer path
**Given** a valid `sessionid` cookie or `username`/`password`  
**When** `InstagramClient` is constructed with `{ transport: 'puppeteer' }`  
**Then** it launches a browser context with `ProxyProvider`  
**And** navigates to `https://www.instagram.com/username/`  
**And** extracts profile and media data from HTML/GraphQL

### AC-2: InstagramClient private API bridge path
**Given** `instagrapi` Python bridge is configured (optional)  
**When** `InstagramClient` is constructed with `{ transport: 'instagrapi' }`  
**Then** it spawns a Python subprocess or calls an internal service  
**And** returns `PostItem[]` via bridge serialization (JSON over stdio or HTTP)

### AC-3: InstagramClient session persistence
**Given** a successful login  
**When** `client.saveSession(path)` is called  
**Then** session cookies/settings are persisted to encrypted storage  
**And** `client.loadSession(path)` restores session without re-login

### AC-4: InstagramClient proxy injection
**Given** a `ProxyProvider` in options  
**When** the client makes a request  
**Then** it uses a stable proxy for the account  
**And** it does not rotate proxy mid-session unless quarantined

### AC-5: InstagramClient fetches user profile
**Given** `InstagramClient` is logged in  
**When** `crawl({ action: 'user', args: { username: 'natgeo', limit: 25 } })` is called  
**Then** it returns `{ profile: ProfileItem, posts: PostItem[] }`  
**And** `ProfileItem` contains `id`, `username`, `fullName`, `bio`, `followerCount`, `followingCount`

### AC-6: InstagramClient fetches hashtag
**Given** `InstagramClient` is logged in  
**When** `crawl({ action: 'hashtag', args: { tag: 'travel', limit: 25 } })` is called  
**Then** it returns `PostItem[]`  
**And** each post has `media[]` with image/video URLs

### AC-7: InstagramClient normalizes media
**Given** a raw Instagram media object  
**When** `normalizeInstagramMedia(media)` is called  
**Then** it returns `PostItem` with `id`, `platform: 'instagram'`, `author`, `caption`, `takenAt`, `likeCount`, `commentCount`, `media[]`

### AC-8: Instagram validation
**Given** a raw Instagram media/user/comment object  
**When** `InstagramValidator.validatePost(raw)` is called  
**Then** it throws `ValidationError` if `pk`, `code`, `taken_at`, or `caption` is missing  
**And** it returns `true` for valid objects

### AC-9: Challenge and rate-limit handling
**Given** Instagram returns a challenge, 429, or suspicious login email  
**When** the client detects the response  
**Then** it pauses and logs an alert  
**And** it does not retry automatically more than 3 times

### AC-10: Tests
**Given** no mocks or stubs  
**When** `vitest run tests/scrapers/instagram` is executed  
**Then** all client, crawler, normalizer, and validator tests pass  
**And** tests use a real test account with stable proxy or a public profile

## Files to Create/Modify
- `src/scrapers/social/instagram/client.js`
- `src/scrapers/social/instagram/crawler.js`
- `src/scrapers/social/instagram/normalizer.js`
- `src/scrapers/social/instagram/validator.js`
- `src/scrapers/social/instagram/index.js`
- `src/scrapers/social/instagram/bridge.py` (optional, for instagrapi bridge)
- `tests/scrapers/instagram/client.test.js`
- `tests/scrapers/instagram/crawler.test.js`
- `tests/scrapers/instagram/normalizer.test.js`
- `tests/scrapers/instagram/validator.test.js`
- `src/scrapers/social/index.js` (add export)

## Out of Scope
- Instagram posting, DM, or interaction actions
- Private accounts (unless authenticated session has access)
- Instagram Graph API official (limited scope)

## Open Questions
- OQ-1 (RESOLVED): Primary transport is `puppeteer` (public web scraping). `instagrapi` Python bridge is optional advanced path — implement only if private API features are required later.
- OQ-2 (RESOLVED): New `SocialAccount` table will be created for generic social platform sessions (Reddit, Medium, Instagram). Reuses `SessionManager` in-memory cache + `encryptedCookie`/`encryptedProxy` pattern from `FacebookAccount`.
- OQ-3 (RESOLVED): Default proxy for Instagram is `country-us` residential via `ProxyProvider`; `country-vn` is only for Vietnam platforms. Proxy fallback to `PROXY_URL` env if no provider injected.
