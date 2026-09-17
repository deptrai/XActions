# Epic 38 Context: Crawler Lifecycle Unification & CloudEvents Standardization

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Eliminate split-brain stream publishing technical debt across all crawlers by establishing `AbstractCrawler.execute()` as the single, authoritative point of event emission to Redis Streams. This deprecates the temporary `__streamEmitted` hack flag, enforces zero-duplicate streaming across all 15 platforms, and standardizes all emitted events to the CloudEvents v1.0 specification with deterministic idempotency keys for downstream consumers (Nowing AI Lead Hub and ChainLens Research).

## Stories

- Story 38.1: Eradication of `__streamEmitted` & Template Method Refactoring
- Story 38.2: CloudEvents v1.0 Compliance & Outbound Schema Standardization

## Requirements & Constraints

- **Single Point of Emission**: Subclasses of `AbstractCrawler` must not import or invoke `RedisStreamPublisher` or call `publisher.publish()` directly. All stream publishing is orchestrated exclusively by the `AbstractCrawler.execute()` template method.
- **Zero Domain Payload Pollution**: The `__streamEmitted` property and any internal telemetry flags must be completely removed from crawler return values and domain items (`PostItem`, `ProfileItem`, `CommentItem`).
- **Stream Deduplication Invariant**: The base execution lifecycle must maintain a session-scoped `Set<string> emittedItemIds` based on item ID and storage reference to guarantee that no duplicate stream events are emitted within a run.
- **CloudEvents v1.0 Compliance**: Stream payloads must strictly adhere to the CloudEvents v1.0 JSON format (`specversion: "1.0"`, `type: "org.xactions.scrape.completed"`, `source`, `id`, `time`, `datacontenttype: "application/json"`, and `data`).
- **Deterministic Idempotency Key**: Every emitted event must include an `idempotencyKey` computed from `sha256(platform + entityId + timestamp_bucket)` to allow safe idempotent ingestion by Redis Stream consumers.
- **Testing Standard**: Integration tests for stream publishing must verify the single-emission invariant across platform crawlers without mocks, utilizing real local Redis or loopback test harnesses, and honoring `XACTIONS_TEST_FAST_DELAYS=1`.

## Technical Decisions

- **Template Method Pattern**: `AbstractCrawler.execute()` defines the strict lifecycle sequence: `beforeExecute()` -> `runCrawl()` -> `normalizeItems()` -> `emitStreamBatch()` -> `afterExecute()`.
- **Subclass Responsibility**: Platform crawlers focus purely on data extraction and store persistence, returning raw domain items. They delegate streaming entirely to the base class.
- **Envelope Standardization (AD-41)**: Unifies previous ad-hoc thin events into a formal CloudEvents v1.0 envelope, keeping payload shape consistent for multi-consumer ecosystems.

## Cross-Story Dependencies

- **Story 38.1** blocks **Story 38.2**: The crawler lifecycle refactoring and removal of `__streamEmitted` must be completed and verified before upgrading the stream serialization layer to CloudEvents v1.0.
- **Epic 38** unblocks **Epic 36**: Downstream person OSINT harvesting relies on a clean, duplicate-free streaming pipeline for profile event propagation.
