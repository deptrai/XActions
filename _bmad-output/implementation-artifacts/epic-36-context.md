# Epic 36 Context: Unified Person OSINT & Identity Harvesting Dispatcher

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Provide a unified, single-endpoint data harvesting capability for personal reconnaissance across 10+ social, professional, and regional platforms without persisting PII or building stateful person entities. Following Architectural Decision AD-40 (Option D: Clean Separation of Concerns), XActions functions strictly as an ephemeral harvester returning raw normalized profiles (`ProfileItem[]`) to downstream consumers like Nowing AI Lead Hub and ChainLens Research.

## Stories

- Story 36.1: Implement MCP Tool `x_social_find_profiles` with Universal Scrape Dispatcher Integration
- Story 36.2: Platform Fault Isolation, Timeout Management, and Circuit Breaker Integration

## Requirements & Constraints

- **Pure Harvesting Model (AD-40 / Option D)**: XActions must not store person entities, resolve cross-platform identities, compute similarity scores (Jaro-Winkler, Levenshtein, pHash), or modify Prisma schema to persist PII.
- **Unified Query Surface**: Provide the MCP tool `x_social_find_profiles` accepting structured inputs: `query` (name, username, phone, email), `queryType` (`auto`, `name`, `username`, `phone`, `email`), `platforms` (array of target platforms), `locale` (e.g. `vi_VN`, `en_US`), and `timeoutMs`.
- **Automatic Vietnam Phone Sanitization**: Automatically normalize Vietnamese phone numbers (`0xxxxxxxxx` / `+84xxxxxxxxx` -> standardized 10-digit format) before dispatching to Vietnam-specific platforms (Chợ Tốt, Zalo, Masothue).
- **Concurrency & Fault Isolation**: Dispatch queries in parallel via `Promise.allSettled()` with strict per-platform deadline enforcement (`timeoutMs`), ensuring slow or failing platforms do not degrade overall response times.
- **Circuit Breaker Integration**: Isolate failing platforms that experience consecutive network or challenge errors, returning partial results and clear diagnostic statuses per platform.
- **No External Mocking**: Tests must execute against real implementations, utilizing local loopback handlers and adhering to `XACTIONS_TEST_FAST_DELAYS=1`.

## Technical Decisions

- **Dispatcher Integration**: Route profile queries directly through the Universal Scrape Dispatcher (`scrape(platform, action, args)` in `src/scrapers/index.js`), leveraging existing crawlers (`twitter`, `facebook`, `linkedin`, `instagram`, `threads`, `tiktok`, `reddit`, `medium`, `topcv`, `vietnamworks`, `chotot`).
- **Normalized Return Contract**: Profile search results are normalized into `ProfileItem[]` schema, including platform, username, displayName, bio, avatar, profileUrl, and metadata.
- **Circuit Breaker Mechanics**: Track platform error counters in-memory; temporarily trip circuit for platforms returning persistent 429, 403, or connection timeouts.

## Cross-Story Dependencies

- **Epic 38 Completion**: Epic 38 (Stream Unification & CloudEvents v1.0) provides clean event serialization and deduplication if profile events are streamed.
- **Story 36.1 precedes Story 36.2**: Basic tool contract and fan-out dispatching in 36.1 must be established before layering advanced fault isolation and adaptive circuit breakers in 36.2.
