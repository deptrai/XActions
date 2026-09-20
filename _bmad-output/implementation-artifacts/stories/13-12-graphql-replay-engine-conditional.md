---
epic: 13
story: 13.12
status: backlog-blocked
created: '2026-09-19'
gated: true
activation_conditions:
  - "Story 5.1 (GraphQL Layer) & 7.1 (Health/Pool/Hydration) stable"
  - ">=80% doc_id mapping stable over 30 days on production-like traffic"
  - "Replay cache storage (redis/sqlite) available"
  - "Product Council approves Phase 3 scope"
---

# Story 13.12: GraphQL Replay Engine — doc_id capture + replay cache + rotation fallback

## Epic
Epic 13: High-Throughput Hybrid Scraping Engine

## Status: `backlog-blocked` — DO NOT start until activation conditions confirmed.

## Goal
Build a capture→cache→replay engine so Facebook (and eventually universal) GraphQL `doc_id` requests can be replayed via pure HTTP client — bypassing headless browser entirely for read paths.

## FRs Covered
- FR-112 (GraphQL Replay Engine — conditional)

## Story
As an XActions operator, I want to capture `doc_id` + auth tokens from a Puppeteer session and replay GraphQL calls via `undici`/`got-scraping` with a replay cache, so that read scraping avoids holding browser tabs and runs 10–50x faster than DOM scroll.

## Scope Sketch (to be refined on activation)
- Puppeteer request interceptor: capture `api/graphql` POST bodies → extract `doc_id`, `fb_dtsg`, `lsd`, `__dyn`, `__csr`, `fb_api_req_friendly_name`.
- `GraphQLReplayStore` (redis/sqlite): persist `doc_id` → query-shape mapping + tokens with TTL.
- `replayGraphQL(docId, variables)` in `AbstractApiClient`/`FacebookClient`: replay via HTTP, fallback DOM/hydration on rotate.
- Rotation detector: flag when a doc_id returns GraphQL schema errors → invalidate cache entry, re-capture.

## Activation Conditions (from FUTURE-WORK.md)
1. Story 5.1 & 7.1 stable.
2. ≥80% `doc_id` mapping ổn định 30 ngày trên production-like traffic.
3. Replay cache storage (`redis`/`sqlite`) sẵn sàng.
4. Product Council approve Phase 3 scope.

## Impact when implemented
- Giảm RAM (không giữ browser tab trong replay).
- 10x–50x tốc độ scrape comments/search so với DOM scroll.

## Out of Scope
- Write mutations replay (read-only first).
- Re-implementing `FacebookClient.requestGraphQl` (đã replay qua HTTP — this story adds capture+cache+rotation).

## Dev Notes
- `FacebookClient.requestGraphQl()`/`buildGraphQlBody()` already exist (`client.js:462-663`) — replay path partially present; the net-new work is **capture hook + persistent cache + rotation fallback**.
