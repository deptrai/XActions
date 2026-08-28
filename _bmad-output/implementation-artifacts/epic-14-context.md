# Epic 14 Context: Deep Conversation Scraper, MCP Daemon & Nowing Event Stream

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic turns the shared scraping foundation into a multi-channel microservice surface. It builds deep conversation harvesting (nested comment trees), upgrades the MCP server into a long-running HTTP/SSE daemon, and wires every completed batch into a Redis thin-event stream for Nowing. The payoff is that AI agents and downstream consumers can request and receive rich social conversations in near-real time without spawning Node processes, while Nowing’s NLP workers ingest lightweight pointers instead of raw payloads.

## Stories

- Story 14.1: Hierarchical Comment Tree Extraction with Topological Sort
- Story 14.2: MCP Tool Exporters & Daemon HTTP/SSE Server
- Story 14.3: Realtime Thin Event Redis Stream for Nowing AI Lead Hub

## Requirements & Constraints

- Extract nested comment trees up to `maxDepth: 3` and `maxComments: 500` per post, with recursive pagination into sub-replies.
- Prevent circular references: a reply must not reference itself or any ancestor, and parent identifiers must be validated before insertion.
- Persist comments in depth order (roots first, then level 1, level 2, etc.) to avoid foreign-key violations and database deadlocks.
- Run the MCP surface as a persistent HTTP/SSE daemon on port 3001, reusing the existing `src/mcp/server.js` HTTP transport; do not introduce a second daemon process and keep `GET /health` returning 200.
- Envelope all daemon responses in a 3-Layer JSON Envelope that separates result/summary data, metadata, and an optional artifact reference; keep MCP call latency under 2 ms.
- Auto-export to a JSONL/CSV file artifact whenever a tool result exceeds 100 records, returning the artifact path so the consumer can fetch the full dataset.
- Expose action discovery with a stable descriptor shape: action, description, requiredArgs, optionalArgs, example, outputType, and resolved requiresAuth.
- Return a single error envelope shape across MCP, HTTP, and CLI: code, type, message, retryAfter, suggestedAction, plus optional accountId and platform.
- Map legacy `unfollowx` commands to `CrawlerCommand` actions; unsupported legacy commands return an error envelope with `suggestedAction: 'use_x_actions_list'`.
- Emit thin event pointers to `stream:social:raw_posts` after each batch is persisted; payload only includes id, platform, externalId, category, authorId, crawledAt, and a storage reference.
- Cap the Redis stream with `MAXLEN ~ 1,000,000` or `MINID` time-based eviction, configurable at runtime.
- Expose `GET /metrics/stream` showing eventsPerSecond, pendingMessages, consumerLag, droppedEvents, lastAckTime, maxLen, and minId.
- Alert when `pendingMessages > 50,000` or `lastAckTime > 60 s` via webhook or email.
- Enable Redis streaming behind `REDIS_STREAM_ENABLED=true`; when consumer lag is high the governor must log `throttle_reason: redis_lag` and slow bulk throughput.
- 3-tier incremental crawl: read checkpoint, crawl delta, write checkpoint, then emit event; raw crawl data TTL 30 days.

## Technical Decisions

- Comments live in the same PostgreSQL schema as Posts, with namespaced IDs (`${platform}:${externalId}` for posts and `${platform}:${postExternalId}:${commentExternalId}` for comments) and a `depth` field used for topological insertion.
- Batch writes use 500-record chunks with `createMany` + `skipDuplicates`; optional upsert is available but must be benchmarked.
- The comment model uses a self-referential `CommentReplies` relation with cascade delete and an index on `(postId, parentCommentId)`.
- Crawlers do not call platform methods directly; all calls go through `CrawlerCommand` resolved by the platform `ActionRegistry`, and `listActions()` returns resolved `requiresAuth` per action.
- The daemon, API, and CLI share one error envelope implementation so AI agents and operators see the same actionable information.
- MCP `x_actions_list` and CLI `xactions actions --platform <p>` both consume `AbstractCrawler.listActions()`.
- Redis streams carry thin pointers, not raw data; durability is guaranteed by persisting to `CrawlCheckpoint` before `XADD` and by Nowing’s consumer group issuing `XACK`.
- On-demand MCP traffic and background bulk crawls are separated by a dual proxy pool (30 % realtime / 70 % bulk) so interactive calls are not starved.
- Backpressure is explicit: pending messages above 10,000 reduce bulk crawl rate to 25 %; alerts fire at the higher 50,000 / 60 s thresholds.

## UX & Interaction Patterns

- AI agents discover actions with `x_actions_list`, call a crawl tool, and receive a 3-Layer JSON Envelope; large results are replaced by an artifact reference.
- Error responses include a typed `suggestedAction` so the agent can decide to wait, rotate proxy, rotate account, hibernate, relogin, or ask the user.
- The CLI supports `xactions daemon start/status/stop` with clear output showing the daemon URL and health endpoint.
- The operator dashboard and CLI display stream metrics and fire alerts; `xactions stream metrics` and `xactions stream alerts` give terminal access to the same data.
- Legacy CLI users hitting an obsolete `unfollowx` command are redirected toward `x_actions_list` instead of failing silently.

## Cross-Story Dependencies

- Story 14.2 (MCP daemon) and Story 14.3 (Redis stream) depend on Story 14.1’s Post/Comment model, `PrismaStore`, and topological insertion logic.
- Epic 14 depends on Epic 10 (core abstractions, Prisma schema, `ActionRegistry`, error envelopes), Epic 11 (proxy pool, adaptive governor), and Epic 12 (login/session helpers are available but not required for no-auth actions).
- Epic 19 (operator dashboard/admin CLI) consumes stream metrics and daemon status introduced here.
- Epic 20 (Nowing cutover) relies on 14.2 for the MCP client adapter and 14.3 for the Redis ingest stream.
