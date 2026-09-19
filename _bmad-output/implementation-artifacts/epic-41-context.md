# Epic 41 Context: OSINT Enhancement — Developer Registries & Entity Resolution (Rescoped)

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Extend the `x_social_find_profiles` OSINT harvester in two ways: (1) add two zero-auth, direct-fetch developer/identity registries — GitHub (username queryType) and Gravatar (email queryType) — to the platform matrix, since these are the richest open metadata sources and cost no proxy; and (2) upgrade the tool's output from a flat `profiles[]` list to consolidated identity clusters with confidence scores, so callers can tell which profiles across platforms belong to the same real person. Live verification with a real query exposed both gaps.

## Stories

- Story 41.1: GitHub + Gravatar adapters — public API zero-auth, register in `PROFILE_ACTION_MAP`, rate limit via `DistributedTokenBucket`
- Story 41.2: `EntityResolver` (Jaro-Winkler + confidence scoring) — merge fan-out results into `identityClusters[]`, added to `x_social_find_profiles` output (backward compatible)

## Requirements & Constraints

- GitHub adapter fetches `https://api.github.com/users/{username}` and returns name, bio, avatar, company, location, public repos; supports the `username` queryType.
- Gravatar adapter fetches `https://api.gravatar.com/v3/profiles/{sha256(email)}` resolving email to avatar plus linked accounts; supports the `email` queryType.
- Both sources are direct fetches: no proxy, no new crawler — only an adapter plus registration in `PROFILE_ACTION_MAP`.
- GitHub unauthenticated rate limit (60 req/h) must be enforced through `DistributedTokenBucket`; an optional `GITHUB_TOKEN` env var raises it to 5000 req/h.
- Entity resolution must produce `identityClusters[]` with a confidence score in the 0.0–1.0 range. Scoring signals: exact username match (+40), display-name similarity > 0.85 (+30), avatar URL/pHash match (+30), cross-link in bio (+20).
- Output contract is additive: `identityClusters[]` appears alongside the unchanged flat `profiles[]` (backward compatible).
- Privacy (Option D): no PII persistence, no PersonEntity tables in Prisma — entity resolution is computed in-memory per request only.
- Tests: no mocks/stubs for network calls in integration tests; unit tests must stay under 1.5s with fast-delay support.

## Technical Decisions

- Only the Jaro-Winkler algorithm is ported (from Mr.Holmes' entity resolver) — as pure JS, not ported Python code. The `EntityResolver` is a pure JS module.
- Out of scope (belongs to Mr.Holmes' investigation domain — orchestrate via its MCP instead of duplicating in XActions): Google/Yandex dorking, breach/leak checks (HIBP, Shodan, etc.), BFS recursive profiling, mindmap/LLM reports, Maigret-style 2500-site scans.
- No PII persistence (Option D — in-memory per-request only).
- Adapters follow the existing registry pattern: register in `PROFILE_ACTION_MAP` rather than building new crawler infrastructure.

## Cross-Story Dependencies

- Story 41.2's `EntityResolver` consumes the fan-out output that `x_social_find_profiles` (including 41.1's new adapters) produces; the clusters feature is only meaningful once the enriched profile set exists.
- Both stories build on the Epic 36 `x_social_find_profiles` tool and its existing `PROFILE_ACTION_MAP` / `DistributedTokenBucket` infrastructure.
