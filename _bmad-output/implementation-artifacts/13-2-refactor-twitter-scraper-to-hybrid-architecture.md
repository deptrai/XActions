# Story 13.2 — Refactor Twitter Scraper to Hybrid Architecture

**Story ID:** 13.2  
**Epic:** 13 — High-Throughput Hybrid Scraping Engine (Twitter & Facebook Refactor)  
**Status:** ready-for-dev  
**Owner:** DEV  
**Source:** `epics.md` Story 13.2, `ARCHITECTURE-SPINE.md` AD-2 / AD-3 / AD-4, PRD FR-71 / NFR-11 / NFR-12.

---

## Story

As a **Twitter Growth Marketer**,  
I want **scrape Twitter profiles, timeline tweets, and search results at high speed**,  
so that **I can collect thousands of tweets in seconds with minimal RAM usage**.

---

## Acceptance Criteria

### AC-1: Hybrid client dispatch

* **Given** `TwitterCrawler` extends `AbstractCrawler` in `src/scrapers/social/twitter/index.js`
* **When** `search(query)` or `getTimeline(username)` is called
* **Then** the crawler uses `TwitterHttpClient` combined with `SignerPagePool` to fetch GraphQL data
* **And** each dynamic-signature request is wrapped in `Promise.race()` with a 3,000ms timeout

### AC-2: Namespaced model persistence

* **Given** a successful GraphQL response
* **When** the crawler normalizes the payload
* **Then** it produces `PostItem` / `ProfileItem` with namespaced IDs (`twitter:${tweetId}` or `twitter:${userId}`)
* **And** it writes normalized items to `PrismaStore` in chunked PostgreSQL transactions

### AC-3: Legacy deprecation marker

* **Given** the new `TwitterCrawler` is registered
* **When** a legacy module is still present in the source tree
* **Then** the following files are marked with `@deprecated` and added to `docs/deprecation-plan.md`:
  * `src/client/Scraper.js`
  * `src/scrapers/twitter/http/index.js`
  * `src/scrapers/twitter/index.js` (legacy)
* **And** `docs/deprecation-plan.md` lists which legacy features are replaced by Story 13.2 and which by Stories 13.2.1–13.2.12

### AC-4: Rate-limit & hibernation integration

* **Given** a request returns 429, 403, or a bot-challenge payload
* **When** `PlatformResponseValidator` detects the condition
* **Then** the crawler throws `RateLimitError` / `BotChallengeError` and the pipeline quarantines the proxy and/or hibernates the account via `AdaptiveRateGovernor`

---

## Notes

* This is the foundation story for all 13.2.x Twitter sub-threads.
* Follow `src/scrapers/social/twitter/core.js` for the entry point; split actions into `src/scrapers/social/twitter/actions/`.
* Dry-run gate defaults to `dryRun=true` for all write-like actions.
