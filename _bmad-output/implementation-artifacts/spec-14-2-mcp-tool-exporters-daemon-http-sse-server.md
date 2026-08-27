---
title: 'Story 14.2: MCP Tool Exporters & Daemon HTTP/SSE Server'
type: 'feature'
created: '2026-08-27'
status: 'done'
baseline_revision: 272e17b8
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings:
  - oversized
---

<intent-contract>

## Intent

**Problem:** The MCP server returns raw tool results of varying shapes over stdio and HTTP/SSE, and there is no unified action discovery, no automatic artifact export for large payloads, and no CLI lifecycle control for the persistent HTTP daemon on port 3001.

**Approach:** Wrap every tool result in a stable 3-Layer JSON Envelope, auto-export to JSONL/CSV when total records exceed 100, expose `x_actions_list` and CLI `xactions actions list`, add generic `x_crawl_post` and `x_crawl_comments_tree` tools, and add `xactions daemon start/status/stop` while reusing the existing `src/mcp/server.js` HTTP transport.

## Boundaries & Constraints

**Always:**
- `src/mcp/server.js` is the single daemon process; it listens on `PORT` (default 3001) at `/mcp` and `GET /health` returns 200.
- `StreamableHTTPServerTransport` session-id generation and SSE lifecycle remain unchanged.
- Every tool call returns the 3-Layer JSON Envelope stringified inside MCP `content[0].text`.
- Platform detection order: `args.platform`, then `rawResult.platform`, then tool-name prefix (`x_facebook_*`, `x_twitter_*`, ...), then `'unknown'`.
- Record extraction order: direct array, then `comments`, `posts`, `items`, `data`; single non-array objects become `[rawResult]` with `totalRecords: 1`.
- `data` preview is capped at 30 records; artifact generation only triggers when `totalRecords > 100`.
- JSONL/CSV artifact content sanitizes `\r\n|\r|\n` in the `content` field before writing (AD-9 Rule 3).
- All errors resolve to `{ code, type, message, retryAfter, suggestedAction, accountId?, platform }`.

**Block If:**
- A second long-lived daemon process or a separate Express app is requested.
- `AbstractCrawler.listActions()` or the `ActionDescriptor` shape in `src/core/types.js` needs to change.
- Any new tool would remove or break existing `x_facebook_*` MCP tool contracts.

**Never:**
- Spawn `node src/mcp/server.js` per tool call; MCP must use the already-running daemon or stdio transport.
- Use mocks, stubs, or fakes in the new tests.
- Return raw crawler results without the envelope for scrape/social tools.
- Persist daemon PID or state outside `CONFIG_DIR` (`~/.xactions`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH_SMALL | `x_crawl_post({ platform: 'facebook', url: '...', limit: 5 })` | Envelope `success:true`, `data` has 5 posts, `summary.hasMore:false`, no artifact | None |
| HAPPY_PATH_LARGE | `x_facebook_post_comments({ url, limit: 200 })` returns >100 comments | Envelope `data` has 30 comment preview, `meta.datasetArtifactPath` set, full JSONL artifact written | None |
| DISCOVERY_ALL | `x_actions_list({})` | Array of `ActionDescriptor` with added `platform` field for every action from available crawlers | None |
| DISCOVERY_FILTER | `x_actions_list({ platform: 'facebook' })` | Only Facebook action descriptors | None |
| STDIO_COMPAT | `MCP_TRANSPORT=stdio`, call `x_get_tweets` | Same 3-Layer envelope shape as HTTP (stringified JSON) | Does not break stdio clients |
| ERROR_UNKNOWN_ACTION | `x_crawl_comments_tree({ platform: 'twitter' })` when `get_comments` is not in `listActions()` | Envelope `success:false`, `error.code:XACT_4001`, `suggestedAction:'use_x_actions_list'` | Returns envelope, does not throw uncaught |

</intent-contract>

## Code Map

- `src/mcp/server.js:83-2646` — `TOOLS` array; append `x_actions_list`, `x_crawl_post`, `x_crawl_comments_tree` definitions here.
- `src/mcp/server.js:2694-2811` — `executeTool()` dispatch switch; integrate envelope wrapping and add branches for generic tools before Facebook-specific checks.
- `src/mcp/server.js:4893-4985` — `createMcpServer()`; `CallToolRequestSchema` handler returns envelope-wrapped `content` and sets `isError` only when `success === false`.
- `src/mcp/server.js:5097-5172` — `startHttpTransport()`; Express app with `/health` and `/mcp`; preserves `StreamableHTTPServerTransport` session lifecycle.
- `src/mcp/server.js:5178-5186` — `startStdioTransport()`; same envelope must apply to stdio output.
- `src/core/base-crawler.js:106-117` — `AbstractCrawler.listActions()` returns resolved `ActionDescriptor[]` including `requiresAuth`.
- `src/core/base-crawler.js:151-252` — `AbstractCrawler.start()` resolves `actionRequiresAuth = entry.descriptor.requiresAuth ?? this.requiresAuth`.
- `src/core/action-registry.js:12-77` — `ActionRegistry` with `listAll`, `listByPlatform`, `get`; `globalActionRegistry` is only populated after crawler instantiation.
- `src/core/error-envelope.js:48-99` — `PlatformError` with `toEnvelope()` and `retryAfter` getter; use directly or map plain errors.
- `src/core/error-envelope.js:10-30` — `ErrorTypes` and `SuggestedActions` constants.
- `src/scrapers/index.js:234-437` — `dispatchFacebookHybrid()` and `scrape()`; generic tools dispatch through `scrape(platform, action, options)`.
- `src/scrapers/index.js:512-533` — `actionMap` and `platformActionMap` used for legacy Twitter platforms; `post_detail` is not currently registered anywhere.
- `src/scrapers/social/facebook/crawler.js:300-419` — `FacebookCrawler` registers `page_posts`, `group_posts`, `get_comments`, `post_comments`, etc.; `listActions()` returns descriptors used by discovery.
- `src/scrapers/social/threads/crawler.js:71-97` — `ThreadsCrawler` registers `get_user_feed`, `search`, `get_post_comments`.
- `src/utils/exporter.js:65-67` — `sanitizeContent()` for JSONL/CSV newline sanitization.
- `src/utils/exporter.js:74-132` — `escapeCsvCell()` and `formatCsvRow()` for CSV artifact support.
- `src/utils/exporter.js:173-452` — `exportDataset()` streams from PostgreSQL; the new artifact exporter should reuse `sanitizeContent` and CSV helpers for in-memory arrays.
- `src/cli/index.js:16-116` — registers command modules; add `registerDaemonCommand` and `registerActionsCommand`.
- `src/cli/commands/scrape.js:17-104` — pattern for a dispatch command with `ora` and JSON output.
- `src/cli/commands/compat.js:12-80` — `xactions compat` group pattern.
- `src/cli/shared.js:19-34` — `CONFIG_DIR` (`~/.xactions`) and `loadConfig`/`saveConfig` helpers for daemon state persistence.
- `bin/unfollowx:1-9` — legacy entry point; currently uses `require` and only prints a message; must be mapped to `CrawlerCommand` or return the standard error envelope.
- `package.json:46` — `mcp:daemon` script sets `MCP_TRANSPORT=http PORT=3001 node src/mcp/server.js`.

## Tasks & Acceptance

**Execution:**
- [ ] `src/mcp/envelope.js` — create `wrapToolResult(toolName, rawResult, startedAt)` and `wrapToolError(error, toolName)` with platform detection, record extraction, 30-record preview, and artifact path injection.
- [ ] `src/mcp/artifact-exporter.js` — create `exportArtifact(records, { tool, platform, format })` that writes JSONL (default) or CSV to `XACTIONS_ARTIFACT_DIR` or `_bmad-output/datasets/` with sanitized content and returns the file path.
- [ ] `src/mcp/server.js:83-2646` — add `x_actions_list`, `x_crawl_post`, `x_crawl_comments_tree` to `TOOLS` with input schemas matching AC-4 and AC-7.
- [ ] `src/mcp/server.js:2694-2811` — integrate `wrapToolResult`/`wrapToolError` into `executeTool()`; add branches for `x_crawl_post` and `x_crawl_comments_tree` before Facebook-specific checks.
- [ ] `src/mcp/server.js:4893-4985` — update `CallToolRequestSchema` handler to wrap the final result and set `isError` based on `success`.
- [ ] `src/mcp/server.js:5097-5172` — preserve `GET /health` 200 and `/mcp` SSE/session semantics; do not add a second daemon.
- [ ] `src/mcp/server.js:5178-5186` — ensure stdio transport still works; the same envelope wrapper applies.
- [ ] `src/mcp/server.js` — add `executeActionListTool(args)` that instantiates `FacebookCrawler` and `ThreadsCrawler` (and any other available `src/scrapers/social/*/crawler.js`), calls `.listActions()`, appends `platform`, and calls `.cleanup()`.
- [ ] `src/cli/commands/daemon.js` — create `xactions daemon start/status/stop`; `start` spawns `MCP_TRANSPORT=http PORT=3001 node src/mcp/server.js`; `status` calls `/health`; `stop` kills the stored PID or prints guidance.
- [ ] `src/cli/index.js:26-116` — register `registerDaemonCommand(program)` and `registerActionsCommand(program)`.
- [ ] `src/cli/commands/actions.js` — create `xactions actions list [--platform <p>]` that invokes `executeActionListTool({ platform })` and prints JSON.
- [ ] `bin/unfollowx` — rewrite to ESM; parse `process.argv`, map known legacy commands to `CrawlerCommand` with `platform: 'twitter'`, and return the standard error envelope for unsupported commands.
- [ ] `tests/mcp/server-envelope.test.js` — test envelope shape, platform detection, `data` preview cap, and error wrapping.
- [ ] `tests/mcp/server-artifact.test.js` — test >100 records triggers artifact, JSONL/CSV validity, and `meta.datasetArtifactPath`.
- [ ] `tests/mcp/server-action-discovery.test.js` — test `x_actions_list` returns descriptors with `requiresAuth` and `platform`.
- [ ] `tests/cli/daemon.test.js` — test `xactions daemon start/status/stop` with real process spawn and `/health` check.
- [ ] `tests/cli/actions.test.js` — test `xactions actions list` output shape and `--platform` filtering.

**Acceptance Criteria:**
- Given `src/mcp/server.js` is running with `MCP_TRANSPORT=http` on port 3001, when `GET /health` is called, then it returns 200 and the server continues to listen on `/mcp` with `mcp-session-id` management intact.
- Given any scrape/social tool is called, when the result is returned, then it is wrapped in the 3-Layer JSON Envelope with `success`, `platform`, `meta`, `data`, `summary`, and optional `error`, and the wrap/envelope/discovery latency (excluding scraping) is below 2ms.
- Given a tool result with `totalRecords > 100`, when the envelope is built, then a JSONL artifact is written, `meta.datasetArtifactPath` is returned, and `data` contains at most the first 30 records.
- Given `x_actions_list` or `xactions actions list` is called, when the action registry is queried, then it returns `ActionDescriptor[]` with `requiresAuth` resolved and an added `platform` field.
- Given any error thrown by a tool, when the response is returned, then it is mapped to the standard error envelope with `type` and `suggestedAction` from the allowed sets, and `PlatformError` fields are propagated unchanged.
- Given `xactions daemon start`, when the command runs, then it spawns `MCP_TRANSPORT=http PORT=3001 node src/mcp/server.js` and prints the `/mcp` and `/health` URLs.
- Given `x_crawl_post({ platform, url, postId, limit })`, when the tool is called, then it attempts `scrape(platform, 'post_detail', ...)` and falls back to `scrape(platform, 'posts', ...)` (Facebook maps `posts` to `page_posts` or `group_posts` based on the URL).
- Given `x_crawl_comments_tree({ platform, postId, maxDepth, maxComments })`, when the tool is called, then it dispatches to `scrape(platform, 'get_comments', ...)` if the crawler has that action, otherwise returns `XACT_4001` with `suggestedAction: 'use_x_actions_list'`.
- Given legacy `unfollowx` commands, when they are run, then they are mapped to `CrawlerCommand` with `platform: 'twitter'` or return an error envelope with `suggestedAction: 'use_x_actions_list'`.
- Given `npm test` is run, when the new MCP and CLI tests execute, then they use real `http.createServer` or spawned server processes (no mocks), and `npm run typecheck` passes.

## Spec Change Log

## Review Triage Log

## Design Notes

- **Envelope as a pure transform.** `wrapToolResult` and `wrapToolError` must be called inside `executeTool` or the `CallToolRequestSchema` handler so HTTP, stdio, and future transports share the same response shape. Keep the wrapper synchronous except for artifact I/O.
- **Platform detection priority:** `args.platform` first, then `rawResult.platform`, then tool-name prefix, then `'unknown'`. For `x_crawl_*` tools, the caller-supplied `platform` is authoritative.
- **Record extraction:** the wrapper must handle four container shapes from existing crawlers: direct array, `{ comments: [...] }`, `{ posts: [...] }`, `{ items: [...] }`, and `{ data: [...] }`. A single non-array object becomes a one-item array and `totalRecords = 1`.
- **Action discovery implementation:** do not rely on `globalActionRegistry` alone because it is only populated after a crawler is constructed. Instantiate each available crawler under `src/scrapers/social/*/crawler.js` (currently `FacebookCrawler` and `ThreadsCrawler`), call `.listActions()`, append `platform`, and call `.cleanup()`. Do not modify `AbstractCrawler.listActions`.
- **Generic `x_crawl_post` mapping:** no crawler currently registers `post_detail`, so the tool must try it first and fall back to `scrape(platform, 'posts', { url, limit })`. `dispatchFacebookHybrid` already maps `posts` to `page_posts`/`group_posts` based on the URL.
- **Generic `x_crawl_comments_tree` mapping:** only `FacebookCrawler` currently registers `get_comments`. Other crawlers should return `PlatformError` with `code: 'XACT_4001'`, `type: 'invalid_args'`, `suggestedAction: 'use_x_actions_list'`.
- **Artifact file convention:** directory is `process.env.XACTIONS_ARTIFACT_DIR ?? '_bmad-output/datasets/'`; filename is `{tool}-{platform}-{timestamp}-{uuid}.{jsonl|csv}`. Reuse `sanitizeContent` from `src/utils/exporter.js` for JSONL; for CSV use `escapeCsvCell` and write a header when records are homogeneous. Tests should clean up generated artifacts.
- **Error mapping:** if `error` is a `PlatformError`, copy its `toEnvelope()` fields and convert `retryAfterMs` to `retryAfter` seconds. For plain `Error` objects, produce `code: 'XACT_5000'`, `type: 'internal'`, `message: error.message`, `suggestedAction: 'contact_support'`.
- **CLI daemon lifecycle:** store PID and URL in `CONFIG_DIR/daemon.json` (`~/.xactions/daemon.json`, following `src/cli/shared.js`). `start` uses `child_process.spawn`; `status` fetches `http://localhost:3001/health`; `stop` kills the stored PID if still running.
- **Legacy `unfollowx` mapping:** the existing file uses CommonJS `require` and only prints a static message. Rewrite it as ESM so it can import `src/scrapers/index.js` and `src/core/error-envelope.js`; map known legacy commands to the equivalent `scrape('twitter', action, args)` call, and return the standard error envelope for unsupported commands.
- **Latency guard:** measure the wrap/envelope/discovery path in tests with `process.hrtime.bigint()` or `Date.now()` assertions. The 2ms budget excludes network and scrape time.

## Verification

**Commands:**
- `MCP_TRANSPORT=http PORT=3001 node src/mcp/server.js` — expected: server starts, `GET http://localhost:3001/health` returns `200 { status: 'ok', transport: 'http', tools: <n>, sessions: 0 }`, and `/mcp` accepts POST initialize and GET SSE.
- `npm test -- tests/mcp/` — expected: new envelope, artifact, and action-discovery tests pass with no mocks.
- `npm test -- tests/cli/` — expected: new daemon and actions tests pass.
- `npm run typecheck` — expected: `tsc --noEmit` exits 0.

**Manual checks (if no CLI):**
- Call `x_actions_list` over MCP HTTP and verify every descriptor has `requiresAuth` and `platform`.
- Call `x_crawl_post` with `limit: 5` and verify `data` length is 5 and the envelope fields are present.
- Trigger a result with >100 records and verify the artifact file exists and contains valid JSONL with no embedded newlines in the `content` field.
