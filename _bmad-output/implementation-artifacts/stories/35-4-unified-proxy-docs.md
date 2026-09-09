---
epic: 35
story: 35.4
status: draft
created: '2026-09-09'
updated: '2026-09-09'
---

# Story 35.4: Unified ProxyProvider Injection + Docs & Selector Registry

## Epic
Epic 35: Reddit, Medium & Instagram Scraper Expansion

## Goal
Ensure all new scrapers (Reddit, Medium, Instagram) can inject `ProxyProvider` uniformly, and update documentation/selector registry for future maintenance.

## FRs Covered
- FR-98, FR-99, FR-100 (all new platforms require proxy support)

## NFRs Covered
- NFR-3 (proxy rotation and session persistence)
- NFR-5 (ESM imports, `const` over `let`, emoji-prefixed errors)

## Story

As an XActions maintainer,
I want all new social scrapers to support `ProxyProvider` injection,
So that proxy management is consistent across platforms and easy to configure.

## Acceptance Criteria

### AC-1: ProxyProvider injection in RedditClient
**Given** `RedditClient` is constructed with `{ proxyProvider: pool }`  
**When** `client.fetch(url)` is called  
**Then** it uses the proxy from `pool.getProxy()` or `pool.getStickyProxy(accountId)`  
**And** falls back to `process.env.PROXY_URL` if no provider is set

### AC-2: ProxyProvider injection in MediumClient
**Given** `MediumClient` is constructed with `{ proxyProvider: pool }`  
**When** `client.fetch(url)` is called  
**Then** it uses the proxy for HTTP requests  
**And** RSS feed requests also route through the proxy

### AC-3: ProxyProvider injection in InstagramClient
**Given** `InstagramClient` is constructed with `{ proxyProvider: pool }`  
**When** the client launches browser or private API session  
**Then** it uses the proxy for all network traffic  
**And** sticky proxy is maintained per session

### AC-4: Proxy fallback and error handling
**Given** a proxy request fails with connection refused/timeout  
**When** the error is detected  
**Then** the client logs an error and can fall back to direct connection  
**And** `ProxyIpPool` quarantines the failing proxy for 5 minutes

### AC-5: Country and geo-targeting
**Given** `options.proxy` includes `{ country: 'us' }` or `country: 'gb'`  
**When** the client requests a proxy  
**Then** `ProxyProvider` returns a US/GB residential proxy if available  
**And** `country-vn` is only used for Vietnam-specific platforms

### AC-6: Documentation update
**Given** the new scrapers are implemented  
**When** `docs/agents/selectors.md` and `docs/agents/contributing-features.md` are updated  
**Then** they include Reddit, Medium, Instagram selectors and patterns  
**And** they reference the new `ProxyProvider` usage

### AC-7: Integration test
**Given** all three new scrapers are built  
**When** `vitest run tests/scrapers/proxy-injection` is executed  
**Then** each client successfully routes requests through `ProxyIpPool`  
**And** fallback to `PROXY_URL` works when no provider is injected

### AC-8: SocialAccount schema and migration
**Given** `prisma/schema.prisma` is updated with `SocialAccount`/`SocialAccountHealth`  
**When** `npx prisma migrate dev --name add_social_account` is run  
**Then** migration creates tables without errors  
**And** `SocialAccount` can store encrypted session data for Reddit, Medium, Instagram

## Files to Create/Modify
- `src/scrapers/social/reddit/client.js` (add proxy support)
- `src/scrapers/social/medium/client.js` (add proxy support)
- `src/scrapers/social/instagram/client.js` (add proxy support)
- `docs/agents/selectors.md` (add new platform selectors)
- `docs/agents/contributing-features.md` (add platform template)
- `tests/scrapers/proxy-injection.test.js`

## Out of Scope
- Refactoring existing scrapers (Twitter, Facebook, etc.) — only new platforms get `ProxyProvider` injection in this story.
- Proxy health dashboard or admin UI.

## Open Questions
- OQ-1 (RESOLVED): `ProxyProvider` is optional in constructor; if absent, fall back to `process.env.PROXY_URL` / `PROXY_URLS`. `ProxyIpPool` handles quarantine/sticky/round-robin automatically.
- OQ-2 (RESOLVED): Yes — create `SocialAccount` table in Prisma schema to store generic social platform sessions (Reddit, Medium, Instagram). Reuses `SessionManager` + `encryptedCookie`/`encryptedProxy` pattern.
