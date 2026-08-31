---
story_id: '13.2'
epic: 13
story_key: '13-2-refactor-twitter-scraper-to-hybrid-architecture'
status: "done"
phase: "Phase 2"
created: 2026-08-27
updated: 2026-08-31
last_updated: 2026-08-31
owner: "DEV"
reviewed: "approved"
---

# Story 13.2 — Refactor Twitter Scraper to Hybrid Architecture

**Story ID:** 13.2  
**Epic:** 13 — High-Throughput Hybrid Scraping Engine (Twitter & Facebook Refactor)  
**Status:** done  
**Owner:** DEV  
**Source:** `epics.md` Story 13.2, `ARCHITECTURE-SPINE.md` AD-2 / AD-3 / AD-4, PRD FR-71 / NFR-11 / NFR-12.

---

### Senior Developer Review (AI)

**Review Outcome:** Approved (Umbrella Story Completed)  
**Date:** 2026-08-31  
**Summary:**
- Umbrella refactor Story 13.2 đã hoàn thành trọn vẹn thông qua toàn bộ 12 sub-stories 13.2.1 → 13.2.12.
- `TwitterCrawler` extends `AbstractCrawler`, `TwitterClient` extends `AbstractApiClient`, `TwitterPlatformResponseValidator` extends `AbstractPlatformResponseValidator`.
- Đăng ký và xử lý đầy đủ 31 hybrid actions (Search, Trending, Thread, Likes, Bookmarks, Profile, Followers, Following, Media, Post, Schedule, DM, Lists...).
- Toàn bộ unit/integration test suites đã được triển khai và pass 100%.

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
* **Then** the files are marked with `@deprecated` and added to `docs/deprecation-plan.md`

### AC-4: Rate-limit & hibernation integration
* **Given** a request returns 429, 403, or a bot-challenge payload
* **When** `PlatformResponseValidator` detects the condition
* **Then** the crawler throws `RateLimitError` / `BotChallengeError` and the pipeline quarantines the proxy and/or hibernates the account via `AdaptiveRateGovernor`
