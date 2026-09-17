---
title: 'Story 38.2: CloudEvents v1.0 Compliance & Outbound Schema Standardization'
type: 'feature'
created: '2026-09-17'
status: 'done'
baseline_revision: '3673757ad366e7ad54e2edb719afbf013706d921'
review_loop_iteration: 1
followup_review_recommended: false
context:
  - _bmad-output/implementation-artifacts/epic-38-context.md
  - src/utils/redis-stream-publisher.js
  - src/core/base-crawler.js
  - src/core/types.js
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Outbound stream messages currently use an ad-hoc thin event format with mixed snake_case and camelCase keys that lacks standard metadata headers (specification version, event source URI, event type, RFC 3339 timestamps) and does not provide a deterministic idempotency key for downstream event ingestion. This creates ingestion drift and requires custom parsing logic in consumers like Nowing AI Lead Hub and ChainLens Research.

**Approach:** Upgrade `RedisStreamPublisher` and `AbstractCrawler` to format outbound stream events in full compliance with the CloudEvents v1.0 specification (`specversion`, `id`, `source`, `type`, `time`, `datacontenttype`, `data`, and `idempotencykey`), compute a deterministic SHA-256 idempotency key per event, provide a `validateCloudEvent` utility, while preserving dual-emit flat fields for 100% backward compatibility with existing consumers.

## Boundaries & Constraints

**Always:**
- Ensure all emitted events include mandatory CloudEvents v1.0 attributes: `specversion: "1.0"`, `id`, `source` (e.g. `org.xactions.crawler.{platform}`), `type` (e.g. `org.xactions.scrape.completed`), `time` (RFC 3339 ISO string), and `datacontenttype: "application/json"`.
- Generate a deterministic `idempotencyKey` computed from `sha256(`${platform}:${entityId}:${timestampBucket}`)` where `timestampBucket` defaults to hourly resolution (`YYYY-MM-DDTHH`).
- Provide string-serialized CloudEvents `data` payload for Redis Stream `XADD` storage alongside flat backward-compatible fields (`externalId`, `storageRef`, `workspace_id`, etc.).
- Maintain zero-exception, non-blocking delivery in `RedisStreamPublisher.publish()`.
- Ensure all tests run with `XACTIONS_TEST_FAST_DELAYS=1` and complete in < 2 seconds.

**Never:**
- NEVER remove legacy flat fields (`platform`, `externalId`, `authorId`, `storageRef`, `content_snippet`, `workspace_id`) that existing consumers and CDC adapters rely on.
- NEVER throw unhandled exceptions during payload formatting or stream emission.
- NEVER use external network mocks or stubs.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Standard CloudEvents formatting | `ThinEvent` object with `id: 'facebook:123'`, `platform: 'facebook'`, `externalId: '123'` | `formatPayload` returns object containing `specversion: '1.0'`, `source: 'org.xactions.crawler.facebook'`, `type: 'org.xactions.scrape.completed'`, `time`, `datacontenttype: 'application/json'`, `data` JSON string, and deterministic `idempotencyKey` | Falsy input returns empty record `{}` |
| Deterministic idempotency hash | Two items with same platform, externalId, and crawledAt within same hour | Both produce identical `idempotencyKey` | Missing externalId falls back to item id |
| Custom timestamp bucket | Item specifies custom `timestamp_bucket: '2026-09-17'` | `idempotencyKey` incorporates custom bucket | Falls back to ISO hour slice |
| CloudEvents validation | Valid CloudEvents record passed to `validateCloudEvent(event)` | Returns `true` | Missing required CloudEvents attribute returns `false` with reason |
| Backward-compatible flat consumption | Consumer accesses `event.platform`, `event.externalId`, `event.storageRef` | All flat properties populated as string values | Preserved via dual-emit |

</intent-contract>

## Code Map

- `src/utils/redis-stream-publisher.js` -- Implement `computeIdempotencyKey()`, `validateCloudEvent()`, and extend `formatPayload()` with CloudEvents v1.0 attributes (`specversion`, `source`, `type`, `time`, `datacontenttype`, `data`, `idempotencyKey`).
- `src/core/types.js` -- Add JSDoc `@typedef {Object} CloudEventEnvelope` and extend `ThinEvent` with CloudEvents fields.
- `src/core/base-crawler.js` -- Ensure `mapToThinEvent` populates source URI and CloudEvents type metadata.
- `tests/store/redis-stream-publisher.test.js` -- Update and expand unit tests asserting CloudEvents v1.0 attributes, idempotency key generation, and string-valued XADD formatting.
- `tests/core/cloudevents-compliance.test.js` -- New comprehensive test suite asserting CloudEvents v1.0 compliance across platform crawlers and idempotency deduplication.

## Tasks & Acceptance

**Execution:**
- `src/utils/redis-stream-publisher.js` -- Implement `computeIdempotencyKey()`, `validateCloudEvent()`, and integrate CloudEvents v1.0 attributes in `formatPayload()` -- Standardize stream emission contract.
- `src/core/types.js` -- Define `CloudEventEnvelope` TypeScript JSDoc types -- Provide typing for CloudEvents consumers.
- `src/core/base-crawler.js` -- Add CloudEvents metadata defaults (`source`, `type`) to `mapToThinEvent()` -- Propagate CloudEvents schema from crawlers.
- `tests/store/redis-stream-publisher.test.js` -- Update test assertions for CloudEvents formatted payload -- Maintain 100% test coverage.
- `tests/core/cloudevents-compliance.test.js` -- Author contract test suite validating CloudEvents v1.0 envelope, idempotency key determinism, and CDC compatibility -- Guarantee downstream ingestion readiness.

**Acceptance Criteria:**
- Given any item passed to `RedisStreamPublisher.formatPayload()`, when formatted for Redis XADD, then the returned record contains `specversion: "1.0"`, `source: "org.xactions.crawler.<platform>"`, `type: "org.xactions.scrape.completed"`, `datacontenttype: "application/json"`, and a 64-character hex `idempotencyKey`.
- Given two events with the same platform and externalId crawled within the same hour bucket, when `computeIdempotencyKey()` is evaluated, then both produce the exact same SHA-256 hash.
- Given an event emitted by `AbstractCrawler.execute()`, when validated with `validateCloudEvent()`, then validation passes `true`.
- Given `vitest run tests/store/redis-stream-publisher.test.js tests/core/`, when executed, then 100% of tests pass.

## Spec Change Log

## Review Triage Log

- **Iteration 1 (2026-09-17):**
  - Finding 1 (Blind Hunter / Edge Case Hunter): `computeIdempotencyKey` produced differing hashes when `item.id` was passed as `platform:id` vs when `item.externalId` was passed without prefix.
    - *Resolution:* Patched `computeIdempotencyKey` in `src/utils/redis-stream-publisher.js` to strip leading `${platform}:` prefix from `entityId` when present, ensuring deterministic hashes.
  - Finding 2 (Edge Case Hunter): `validateCloudEvent` MIME check did not handle case-insensitivity or MIME parameters (e.g. `application/json; charset=utf-8`).
    - *Resolution:* Lowercased `datacontenttype` before parsing check in `validateCloudEvent`.
  - Finding 3 (Verification Gap Reviewer): Missing assertions for CloudEvents v1.0 attributes directly on `crawler.mapToThinEvent()` in `tests/core/base-crawler-stream.test.js`.
    - *Resolution:* Added explicit assertions for `specversion`, `source`, `type`, `time`, `datacontenttype`, `data`, and `idempotencyKey` in `tests/core/base-crawler-stream.test.js`.
  - Finding 4 (Verification Gap Reviewer): Weak assertion `expect(parsedData).toBeDefined()` in `tests/core/cloudevents-compliance.test.js`.
    - *Resolution:* Replaced with domain assertions asserting `text`, `authorName`, and `url` retention in serialized `data`.
  - Finding 5 (Contract/Types): Added type declarations for `computeIdempotencyKey` and `validateCloudEvent` in `types/core.d.ts`.
  - Verification: Ran `XACTIONS_TEST_FAST_DELAYS=1 npx vitest run tests/store/redis-stream-publisher.test.js tests/core/cloudevents-compliance.test.js tests/core/base-crawler-lifecycle.test.js tests/core/base-crawler-stream.test.js` (54 tests passed) and full `tests/core/` (402 tests passed). All acceptance criteria verified.

## Design Notes

CloudEvents v1.0 specification defines required fields:
- `specversion`: MUST be "1.0".
- `id`: Unique identifier (string). Defaults to `${platform}:${externalId}` or item id.
- `source`: URI-reference describing event source. Defaults to `org.xactions.crawler.${platform}`.
- `type`: Reverse-DNS type. Defaults to `org.xactions.scrape.completed`.
- `datacontenttype`: Content type of the data field ("application/json").
- `time`: RFC 3339 timestamp.
- `data`: JSON string representation of the event payload.

Idempotency key formula:
`sha256(`${platform}:${entityId}:${timestampBucket}`)`
where `timestampBucket` is `crawledAt.slice(0, 13)` (e.g. `2026-09-17T17`), grouping events within the same UTC hour.

## Verification

**Commands:**
- `npx vitest run tests/store/redis-stream-publisher.test.js` -- expected: All publisher unit tests pass
- `npx vitest run tests/core/cloudevents-compliance.test.js` -- expected: All CloudEvents compliance tests pass
- `npx vitest run tests/core/base-crawler-lifecycle.test.js` -- expected: All lifecycle tests pass
- `npx vitest run tests/core/base-crawler-stream.test.js` -- expected: All stream tests pass
