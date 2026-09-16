---
title: 'Story 29.2 — Outbound Webhook Dispatcher with HMAC Signing & Retry'
type: 'feature'
created: '2026-09-16'
status: 'done'
route: 'dispatch'
baseline_commit: '0e22a72b'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Only inbound webhooks exist (`webhookTrigger.js` for scheduler jobs, `a2a/push.js` for agent callbacks). External consumers like Nowing need to subscribe to real-time `ThinEvent` streams via webhooks with guaranteed delivery.

**Approach:** Build `src/streaming/outbound-webhook-dispatcher.js` — a standalone dispatcher that consumes `ThinEvent` from the Redis Stream (`stream:social:raw_posts`), matches events to registered webhook subscriptions, signs POST bodies with HMAC-SHA256, delivers with retry, and persists delivery metrics.

## Boundaries & Constraints

**Always:**
- Consume `ThinEvent` from `stream:social:raw_posts` via consumer group (not polling)
- HMAC-SHA256 signature in `X-XActions-Signature` header — same pattern as `a2a/push.js`
- Exponential backoff retry: 3 attempts (1s → 2s → 4s), then dead-letter
- Dead-letter queue: Redis list `xactions:webhook:dlq`
- Delivery metrics persisted to Redis hash `xactions:webhook:metrics:{subscriptionId}`
- Subscription store: Redis hash `xactions:webhook:subscriptions` (JSON per subscription)
- Registration fields: `url`, `events[]` (platform filter or `*` for all), `secret`, `active`, `description`
- Admin auth required for management endpoints (reuse `authenticateToken`)

**Never:**
- KHÔNG modify `webhookTrigger.js` (inbound) or `a2a/push.js` (A2A callbacks) — this is a new outbound dispatcher
- KHÔNG use Bull queue for delivery — use Redis consumer group for real-time processing
- KHÔNG store webhook secrets in plaintext logs
- KHÔNG block the main event loop — async delivery with `Promise.allSettled`
- KHÔNG retry on 4xx (permanent failure → straight to DLQ)

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Register subscription | `POST /api/admin/webhooks/subscriptions` `{ url, events, secret, description }` | `{ id, url, events, active: true }` | 400 on invalid URL |
| List subscriptions | `GET /api/admin/webhooks/subscriptions` | Array of subscription objects | N/A |
| Update subscription | `PATCH /api/admin/webhooks/subscriptions/:id` `{ active: false }` | Updated subscription | 404 if not found |
| Delete subscription | `DELETE /api/admin/webhooks/subscriptions/:id` | `{ deleted: true }` | 404 if not found |
| Delivery logs | `GET /api/admin/webhooks/delivery-logs?subscriptionId=X&limit=50` | Array of delivery attempts | N/A |
| Event dispatch | ThinEvent arrives on `stream:social:raw_posts` | Match subscriptions by `events[]` filter → POST each | Non-matching → skip |
| Successful delivery | POST to webhook URL returns 2xx | Record success metric + delivery log | N/A |
| Retry on 5xx | POST returns 500 | Retry with backoff (1s→2s→4s), then DLQ if all fail | Log each attempt |
| Permanent failure | POST returns 400/401/404 | Straight to DLQ (no retry) | Log + DLQ |
| Timeout | POST takes >10s | Abort, retry as 5xx | Fetch timeout |
| HMAC signing | Subscription has `secret` | `X-XActions-Signature: sha256=<hex>` header | Missing secret → no sig |
| DLQ inspection | `GET /api/admin/webhooks/dlq` | Array of failed deliveries with original payload | N/A |
| DLQ retry | `POST /api/admin/webhooks/dlq/:id/retry` | Re-attempt delivery | Re-add to queue |
| Consumer group lag | Many events, slow delivery | Consumer group tracks pending, XAUTOCLAIM for stalled | Metrics show lag |
| Graceful shutdown | `dispatcher.stop()` | Finish in-flight deliveries, XACK pending | 5s grace period |

</frozen-after-approval>

## Code Map

- `src/streaming/outbound-webhook-dispatcher.js` — **NEW**: Main dispatcher class
- `src/streaming/webhook-subscription-store.js` — **NEW**: Redis-backed subscription CRUD
- `api/routes/webhook-admin.js` — **NEW**: Admin API routes for subscription/delivery management
- `api/server.js` — MODIFY: Mount webhook admin routes
- `src/streaming/index.js` — MODIFY: Export dispatcher
- `tests/streaming/webhook-dispatcher.test.js` — **NEW**: Tests

## Tasks & Acceptance

**Execution:**
- [x] `src/streaming/webhook-subscription-store.js` — `WebhookSubscriptionStore` with CRUD, Redis hash persistence
- [x] `src/streaming/outbound-webhook-dispatcher.js` — `OutboundWebhookDispatcher` class
- [x] `api/routes/webhook-admin.js` — REST endpoints for subscription + delivery log management
- [x] `api/server.js` — Mount webhook admin routes
- [x] `src/streaming/index.js` — Export dispatcher
- [x] `tests/streaming/webhook-dispatcher.test.js` — Tests for signing, retry, DLQ, subscription matching

**Acceptance Criteria:**
- Given subscription `{ url, events: ['bluesky'] }`, when bluesky ThinEvent published, then POST to url with signed body
- Given subscription `{ url, events: ['*'] }`, when any ThinEvent published, then POST to url
- Given delivery fails with 500, when retried, then backoff 1s→2s→4s, then move to DLQ
- Given delivery fails with 404, when received, then straight to DLQ (no retry)
- Given admin API auth, when `POST /api/admin/webhooks/subscriptions`, then create subscription
- Given `GET /api/admin/webhooks/delivery-logs`, then return recent delivery attempts with status/latency

## Implementation Notes

<!-- Populated during implementation -->

## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. -->

## Review Triage Log


- **patch / high** — `_emitEvent`-class HMAC `createSignature(undefined)` TypeError — guarded stringify. Evidence: `createSignature` now coalesces null/undefined to `''`.
- **patch / medium** — `verifySignature` swap when secret starts with `sha256=` — now requires full `sha256=<64hex>`.
- **patch / high** — `deliverToSubscription` null input TypeError — early return `{ success: false }`.
- **patch / medium** — unconsumed fetch body socket leak — drain/cancel response body.
- **patch / medium** — HTTP 429/408 treated as permanent 4xx — now retryable.
- **patch / high** — DLQ retry duplicates on failure — `skipDlq: true` on re-attempt.
- **patch / medium** — metrics RMW race — `HINCRBY` when available; counts `attempts`.
- **false** — consume loop NOGROUP tight spin — `start()` always `initGroup()` first; loop sleeps 1s on error.
- **false** — ACK-on-throw discards events — `#processMessage` ACKs in `finally` after catch; spec: attempt all deliveries then ACK.
- **patch / low** — `stop()` uncleared timeout — `clearTimeout` in `finally`.
- **patch / medium** — `dispatchReplay(null)` TypeError — empty-array guard.
- **patch / medium** — `WebhookSubscriptionStore.delete` returns true on Redis fail — now returns `deleted` only.
- **defer / medium** — SSRF private IPs — loopback blocked in production; broader DNS-rebinding not in scope.
- **patch / high** — plaintext secrets in GET subscriptions — `redactSecret` / `hasSecret`.
- **defer / medium** — HOL blocking of consumer loop during backoff — architectural; would need job queue (spec forbids Bull).
- **defer / low** — correlation ID per attempt — delivery IDs already unique; receivers can use event id.
- **patch / medium** — NaN `limit` on logs/DLQ — `Number.isFinite` guard.
- **patch (VG)** — `parseStreamPayload` untested — unit tests added.
- **patch (VG)** — admin GET-by-id / metrics / lag untested — tests added.
- **patch (VG)** — `dispatchReplay` unused by replay — `getStreamReplay` now delegates.
- **defer (VG)** — consumer `start()`/`XACK` loop untested — needs live Redis group; covered by parse + deliver tests.
- **defer (VG)** — `api/server.js` mount untested vs isolated router — router tests cover handlers; smoke list is optional.
- **defer (VG)** — abort/timeout hanging endpoint test — AbortError path exists; 5xx retry already covered.


## Design Notes

**Consumer group pattern:**
```
XGROUP CREATE stream:social:raw_posts webhook-dispatcher $ MKSTREAM
XREADGROUP GROUP webhook-dispatcher dispatcher-1 COUNT 10 BLOCK 5000 STREAMS stream:social:raw_posts >
XACK stream:social:raw_posts webhook-dispatcher <id>
```

**Delivery flow:**
1. `XREADGROUP` from `stream:social:raw_posts` (consumer group `webhook-dispatcher`)
2. Parse `ThinEvent` fields
3. Load all active subscriptions, filter by `events[]` (platform match or `*`)
4. For each matching subscription: sign body with HMAC-SHA256 → POST → record result
5. `XACK` the stream entry after all deliveries attempted

**Retry policy:**
- Attempt 1: immediate
- Attempt 2: +1s
- Attempt 3: +2s
- Attempt 4 (final): +4s → if still fails → DLQ

**DLQ format:**
```json
{
  "id": "dlq_<uuid>",
  "subscriptionId": "sub_xxx",
  "url": "https://...",
  "payload": { ...ThinEvent },
  "lastError": "HTTP 500",
  "attempts": 4,
  "failedAt": "2026-09-16T12:00:00Z"
}
```

**Metrics per subscription:**
```
HSET xactions:webhook:metrics:{subId}
  totalAttempts 42
  totalSuccess 38
  totalFailures 4
  avgLatencyMs 245
  lastDeliveryAt "2026-09-16T12:00:00Z"
  lastStatus "success"
```

## Verification

**Commands:**
- `node --check src/streaming/outbound-webhook-dispatcher.js` — expected: no syntax errors
- `node --check api/routes/webhook-admin.js` — expected: no syntax errors
- `npm run typecheck` — expected: 0 errors in new files
- `vitest run tests/streaming/webhook-dispatcher.test.js` — expected: all tests pass
