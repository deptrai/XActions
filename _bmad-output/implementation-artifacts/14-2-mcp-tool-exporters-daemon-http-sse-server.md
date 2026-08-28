---
story_id: "14.2"
epic: 14
story_key: "14-2-mcp-tool-exporters-daemon-http-sse-server"
status: "ready-for-dev"
phase: "Phase 2"
created: 2026-08-27
updated: 2026-08-27
owner: "DEV"
reviewed: "Pending"
baseline_commit: 9c40ce3f
---

# Story 14.2: MCP Tool Exporters & Daemon HTTP/SSE Server

<!-- Note: Context engine analysis completed 2026-08-27. Ready for dev-story / bmad-dev-auto. -->

## Story

As an **AI Agent (Claude / Antigravity / Cursor)**,  
I want **XActions MCP Server chạy thường trực dạng Daemon HTTP/SSE (Port 3001) trả về 3-Layer JSON Envelope và tự động xuất File Artifact khi dữ liệu >100 records**,  
so that **Nowing và AI Agent có thể gọi tool với độ trễ <2ms mà không phải spawn subprocess `node`**.

[Source: `_bmad-output/planning-artifacts/epics.md` — Epic 14, Story 14.2]  
[Architecture: `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` — AD-7, AD-11, AD-14]

## Acceptance Criteria

### AC-1: MCP Daemon HTTP/SSE Server vẫn hoạt động trên cổng 3001
- **Given** `src/mcp/server.js` đã có HTTP transport trên port 3001 với `/health` endpoint
- **When** bổ sung 3-Layer JSON Envelope, action discovery, và auto-artifact vào cùng một server
- **Then** không tạo thêm daemon process riêng; `src/mcp/server.js` tiếp tục lắng nghe trên `http://localhost:3001/mcp` và `GET /health` vẫn trả về 200
- **And** script `npm run mcp:daemon` khởi động HTTP transport khi `MCP_TRANSPORT=http` (đã có trong `package.json:46`)
- **And** MCP `StreamableHTTPServerTransport` vẫn sinh/maintain `mcp-session-id` theo cách cũ; không phá vỡ kết nối SSE của Claude Desktop / Cursor

### AC-2: 3-Layer JSON Envelope cho mọi tool trả về
- **Given** Daemon MCP Server đang chạy ở chế độ `http`
- **When** AI Agent hoặc Nowing gọi tool `x_crawl_post`, `x_crawl_comments_tree`, hoặc bất kỳ tool scrape/social nào qua HTTP/SSE
- **Then** response trả về JSON Envelope chuẩn:

```ts
{
  success: boolean,
  platform: string,              // 'facebook' | 'twitter' | 'threads' | ... | 'unknown'
  meta: {
    tool: string,
    durationMs: number,
    totalRecords: number,
    datasetArtifactPath?: string, // chỉ khi totalRecords > 100
  },
  data: any[],                   // top 20-30 records (cắt từ result)
  summary: {
    count: number,
    hasMore: boolean,
    sampleIds?: string[],
  },
  error?: {                      // chỉ khi success === false
    code: string,
    type: string,
    message: string,
    retryAfter?: number,
    suggestedAction: string,
    accountId?: string,
    platform?: string,
  },
}
```

- **And** độ trễ phản hồi (không tính thời gian cào) < 2ms cho wrap/envelope/discovery
- **And** envelope nhận diện được `platform` từ: `args.platform`, kết quả `.platform`, tool name prefix (`x_facebook_*`, `x_twitter_*`), hoặc fallback `'unknown'`

### AC-3: Auto-Artifact khi payload >100 records
- **Given** tool trả về danh sách records (array trực tiếp hoặc thuộc tính `comments`/`posts`/`items`/`data`)
- **When** tổng số records > 100
- **Then** tự động lưu toàn bộ dataset ra file `jsonl` (mặc định) vào thư mục `XACTIONS_ARTIFACT_DIR` hoặc `_bmad-output/datasets/`
- **And** đường dẫn file được trả về trong `meta.datasetArtifactPath`
- **And** `data` trong envelope chỉ giữ tối đa 30 records đầu tiên (preview) để tránh payload quá lớn qua SSE
- **And** dữ liệu JSONL tuân thủ AD-9 Rule 3: sanitize newline (`\r\n|\r|\n`) trong `content` trước khi ghi
- **And** nếu caller truyền `format: 'csv'` và result là array đồng nhất, artifact có thể xuất CSV thay vì JSONL

### AC-4: Action Discovery (`x_actions_list`)
- **Given** `AbstractCrawler.listActions()` đã tồn tại và trả về `ActionDescriptor[]`
- **When** gọi MCP tool `x_actions_list` hoặc CLI `xactions actions list`
- **Then** trả về danh sách descriptor, mỗi entry chứa đầy đủ trường `ActionDescriptor` theo AD-11 và bổ sung `platform` để phân biệt nguồn:

```ts
{
  action: string,
  description: string,
  requiredArgs: string[],
  optionalArgs: string[],
  example: object,
  outputType: string,
  requiresAuth: boolean,        // giá trị đã phân giải theo AD-11 rule 3
  platform: string,             // bổ sung từ MCP/CLI discovery, không thay đổi AbstractCrawler.listActions
}
```

- **And** `x_actions_list` chấp nhận tham số `platform` tùy chọn để lọc (không truyền = all platforms)
- **And** kết quả bao gồm các action của `FacebookCrawler` hiện có (do đã triển khai ở các story 13.x)
- **And** `requiresAuth` phải là giá trị boolean rõ ràng (`descriptor.requiresAuth ?? crawler.requiresAuth`)

### AC-5: Error Envelope chuẩn hóa
- **Given** bất kỳ tool nào gặp lỗi (bao gồm lỗi validation, auth, rate-limit, internal)
- **When** hệ thống trả response
- **Then** error envelope chuẩn hóa: `{ code, type, message, retryAfter, suggestedAction, accountId?, platform }`
- **And** `type` thuộc tập: `rate_limit`, `bot_challenge`, `auth_expired`, `proxy_exhausted`, `hibernation`, `invalid_args`, `internal`
- **And** `suggestedAction` thuộc tập: `retry_after_delay`, `rotate_proxy`, `rotate_account`, `hibernate_account`, `relogin`, `wait`, `reduce_rate`, `contact_support`, `use_x_actions_list`
- **And** nếu lỗi là `PlatformError` từ `src/core/error-envelope.js`, trích xuất các trường trực tiếp; nếu là `Error` thường, map thành `type: 'internal'` với `code: 'XACT_5000'`

### AC-6: CLI daemon commands
- **Given** CLI `xactions` và legacy `unfollowx`
- **When** gọi `xactions daemon status/start/stop`
- **Then** CLI quản lý vòng đời daemon MCP:
  - `xactions daemon start` — chạy `MCP_TRANSPORT=http PORT=3001 node src/mcp/server.js` (spawn) hoặc `pm2`-style; trả về URL `http://localhost:3001/mcp` và `GET /health`
  - `xactions daemon status` — kiểm tra daemon có đang chạy bằng cách gọi `GET /health`; trả về `{ running: boolean, url, tools, sessions }`
  - `xactions daemon stop` — kill process daemon (nếu tự quản lý) hoặc trả về hướng dẫn
- **And** legacy CLI commands `unfollowx` được map vào `CrawlerCommand` với `platform: 'twitter'` hoặc trả error `suggestedAction: 'use_x_actions_list'` nếu không hỗ trợ

### AC-7: Generic `x_crawl_post` và `x_crawl_comments_tree`
- **Given** MCP daemon chạy ổn định
- **When** gọi `x_crawl_post({ platform, url, postId, limit })` hoặc `x_crawl_comments_tree({ platform, url, postId, maxDepth, maxComments })`
- **Then** tool dispatch đến `scrape(platform, action, args)` với action tương ứng:
  - `x_crawl_post` → thử `scrape(platform, 'post_detail', { url, limit })` nếu action `post_detail` có trong `listActions()` của crawler; nếu không thì fallback `scrape(platform, 'posts', { url, limit })` (với Facebook sẽ map thành `page_posts`/`group_posts` dựa trên URL)
  - `x_crawl_comments_tree` → `scrape(platform, 'get_comments', { postId, maxDepth, maxComments })` nếu crawler có action `get_comments` (hiện tại chỉ `FacebookCrawler`)
- **And** kết quả được bọc trong 3-Layer JSON Envelope và auto-artifact nếu >100 records
- **And** nếu platform chưa hỗ trợ action đó, trả error `XACT_4001` với `suggestedAction: 'use_x_actions_list'`

### AC-8: Kiểm thử thực (No Mocks)
- **Given** test suite `tests/mcp/server-envelope.test.js`, `tests/mcp/server-action-discovery.test.js`, `tests/cli/daemon.test.js`
- **When** chạy `npm test`
- **Then** không sử dụng `vi.fn`, mock, stub, fake
- **And** dùng real `http.createServer` hoặc spawn `node src/mcp/server.js` với `MCP_TRANSPORT=http` cho HTTP tests
- **And** chạy `npm run typecheck` pass

## Tasks / Subtasks

- [ ] T1: Tạo/wrap 3-Layer JSON Envelope (AC-2, AC-5)
  - [ ] T1.1: Tạo `src/mcp/envelope.js` với `wrapToolResult(toolName, rawResult, startedAt)` và `wrapToolError(error, toolName)`
  - [ ] T1.2: Tích hợp wrapper vào `src/mcp/server.js` `createMcpServer()` `CallToolRequestSchema` handler
  - [ ] T1.3: Đảm bảo `stdio` transport vẫn hoạt động (envelope cũng áp dụng, hoặc giữ backward compatible)
  - [ ] T1.4: Map `PlatformError` sang error envelope chuẩn
- [ ] T2: Auto-Artifact khi >100 records (AC-3)
  - [ ] T2.1: Tạo `src/mcp/artifact-exporter.js` hoặc sử dụng/mở rộng `src/utils/exporter.js`
  - [ ] T2.2: Phát hiện record count từ các dạng kết quả: array, `{ comments: [...] }`, `{ posts: [...] }`, `{ items: [...] }`, `{ data: [...] }`
  - [ ] T2.3: Ghi JSONL (và CSV nếu yêu cầu) tuân thủ AD-9 Rule 3
  - [ ] T2.4: Trả về `meta.datasetArtifactPath` và preview `data` max 30 records
- [ ] T3: Action Discovery (AC-4)
  - [ ] T3.1: Đảm bảo `AbstractCrawler.listActions()` trả về `requiresAuth` đã phân giải (đã làm; verify)
  - [ ] T3.2: Thêm MCP tool `x_actions_list` vào `TOOLS` trong `src/mcp/server.js`
  - [ ] T3.3: Thêm handler `executeActionListTool(args)` dùng `globalActionRegistry` / instantiate `FacebookCrawler` (và các crawler có sẵn) để lấy descriptors
  - [ ] T3.4: Đảm bảo `requiredArgs`, `optionalArgs`, `example`, `outputType`, `requiresAuth` đầy đủ
  - [ ] T3.5: Tạo `src/cli/commands/actions.js` với `xactions actions list [--platform <platform>]`
  - [ ] T3.6: Register `actions` command trong `src/cli/index.js`
- [ ] T4: Generic `x_crawl_post` & `x_crawl_comments_tree` (AC-7)
  - [ ] T4.1: Thêm tool definitions vào `TOOLS`
  - [ ] T4.2: Thêm handlers dispatch đến `scrape()` với action mapping
  - [ ] T4.3: Wrap kết quả qua 3-Layer Envelope
- [ ] T5: CLI daemon commands (AC-6)
  - [ ] T5.1: Tạo `src/cli/commands/daemon.js` với `status`, `start`, `stop`
  - [ ] T5.2: Register command trong `src/cli/index.js`
  - [ ] T5.3: Lưu PID/process info vào `CONFIG_DIR/daemon.json` để `status`/`stop` quản lý
  - [ ] T5.4: Legacy `unfollowx` mapping hoặc error `use_x_actions_list` trong `bin/unfollowx` hoặc `src/cli/commands/compat.js`
- [ ] T6: Tests (AC-8)
  - [ ] T6.1: `tests/mcp/server-envelope.test.js` — kiểm tra envelope shape, `success`, `meta.totalRecords`, `data` preview
  - [ ] T6.2: `tests/mcp/server-artifact.test.js` — >100 records trigger artifact path, file tồn tại, JSONL valid
  - [ ] T6.3: `tests/mcp/server-action-discovery.test.js` — `x_actions_list` trả về `ActionDescriptor[]` với `requiresAuth`
  - [ ] T6.4: `tests/cli/daemon.test.js` — `xactions daemon status/start/stop` (có thể skip nếu khó chạy thực)
  - [ ] T6.5: `tests/cli/actions.test.js` — `xactions actions list` trả về descriptors
  - [ ] T6.6: Chạy `npm run typecheck` và `npm test -- tests/mcp/`

## Dev Notes

### Project Structure Notes

- **Target folder mới:** `src/mcp/envelope.js`, `src/mcp/artifact-exporter.js` (hoặc mở rộng `src/utils/exporter.js`)
- **Update folder:** `src/mcp/server.js`, `src/cli/index.js`, `src/cli/commands/daemon.js` (mới)
- **Legacy `bin/unfollowx`:** file hiện tại chỉ in thông báo. Cần map hoặc trả error theo AC-6.
- **Conflict / variance:**
  - `epics.md` AC dùng tool names `x_crawl_post`, `x_crawl_comments_tree`. Hệ thống hiện có `x_facebook_post_comments`, `x_facebook_posts`, `x_get_tweets`, v.v. Story 14.2 bổ sung các generic tool này như wrapper trên `scrape()`; không xóa tool cũ.
  - Auto-artifact chỉ kích hoạt khi total records > 100. Các tool hiện có vẫn hoạt động bình thường nếu kết quả nhỏ.

### Core Code State to Preserve

- `AbstractCrawler.listActions()` tại `src/core/base-crawler.js:106-117` trả về `ActionDescriptor[]` đã có `requiresAuth`.
- `AbstractCrawler.start()` tại `src/core/base-crawler.js:151-252` resolve `actionRequiresAuth = entry.descriptor.requiresAuth ?? this.requiresAuth`.
- `globalActionRegistry` tại `src/core/action-registry.js` — đăng ký action khi `registerAction()` được gọi. Không phải lúc nào cũng có sẵn data nếu crawler chưa được khởi tạo.
- `src/mcp/server.js:startHttpTransport()` tại `src/mcp/server.js:5097-5170` đã tạo Express app với `/health` và `/mcp` endpoint.
- `src/mcp/server.js:createMcpServer()` tại `src/mcp/server.js:4893-4985` xử lý `CallToolRequestSchema` và `ListToolsRequestSchema`.
- `executeTool()` tại `src/mcp/server.js:2694-2805` dispatch theo tool name. Khi thêm `x_actions_list`, `x_crawl_post`, `x_crawl_comments_tree`, cần thêm nhánh tại đây (hoặc dùng prefix routing).
- `package.json` đã có script `mcp:daemon` tại dòng 46: `"mcp:daemon": "MCP_TRANSPORT=http PORT=3001 node src/mcp/server.js"`.
- `src/utils/exporter.js` cung cấp streaming JSONL/CSV từ PostgreSQL, nhưng auto-artifact ở đây cần ghi từ in-memory array, do đó có thể tạo helper riêng hoặc mở rộng.

### 3-Layer Envelope Behavior

- **Platform detection:** thử theo thứ tự ưu tiên:
  1. `args.platform`
  2. `rawResult.platform`
  3. tool name prefix (`x_facebook_*` → `facebook`, `x_twitter_*` → `twitter`, `x_threads_*` → `threads`, ...)
  4. fallback `'unknown'`
- **Record extraction:**
  - Nếu `rawResult` là array → `records = rawResult`
  - Nếu `rawResult` có thuộc tính array `comments`/`posts`/`items`/`data` → `records = rawResult[key]`
  - Nếu `rawResult` là object đơn (không có array) → `records = [rawResult]`, `totalRecords = 1`
- **Data preview:** `data = records.slice(0, 30)`
- **Summary:** `{ count: totalRecords, hasMore: totalRecords > 30 }`, `sampleIds` từ 5 id đầu nếu records có `id`
- **Artifact threshold:** `totalRecords > 100`
- **Error wrapping:** bắt mọi exception trong `executeTool`, chuyển sang `success: false`, `error: { ... }`, vẫn trả về qua MCP `content: [{ type: 'text', text: JSON.stringify(envelope) }]`

### Action Discovery Implementation Strategy

- Cách 1 (khuyến nghị): instantiate `FacebookCrawler` với `createFacebookClient()` + `createFacebookCrawler()` từ `src/scrapers/index.js`, gọi `.listActions()`, sau đó `.cleanup()`.
- Cách 2 (nếu global registry đã populate): dùng `globalActionRegistry.listByPlatform(platform)`.
- Đối với `x_actions_list` không truyền `platform`, cần instantiate tất cả crawler khả dụng trong `src/scrapers/social/*/crawler.js` để collect actions. Hiện tại chỉ `FacebookCrawler` và `ThreadsCrawler` (nếu đã migrate) là sẵn sàng.
- Trả về `ActionDescriptor[]` với thêm trường `platform` để AI agent phân biệt.

### Auto-Artifact File Convention

- Directory: `process.env.XACTIONS_ARTIFACT_DIR` hoặc `_bmad-output/datasets/`
- Filename: `{tool}-{platform}-{timestamp}-{uuid}.jsonl` (hoặc `.csv`)
- Nội dung: mỗi dòng là một JSON object, sanitize newlines trong `content` trước khi ghi
- Xóa file artifact sau test? Tạo `cleanup()` trong test hoặc dùng `tmp` dir

### Error Handling

- `PlatformError` từ `src/core/error-envelope.js` có sẵn `code`, `type`, `suggestedAction`, `accountId`, `platform`, `retryAfterMs`.
- Map `retryAfterMs` → `retryAfter` (giây) trong envelope.
- Các `Error` thường: `code: 'XACT_5000'`, `type: 'internal'`, `message: error.message`, `suggestedAction: 'contact_support'`.
- Validation lỗi do `inputSchema` đã được MCP SDK validate, nhưng nếu cần thêm validation nội bộ thì trả `XACT_4001`.

## Technical Requirements

- **Language & Runtime:** ESM Node.js >= 18, JSDoc + `npm run typecheck` (`tsc --noEmit`).
- **MCP SDK:** `@modelcontextprotocol/sdk` `^1.30.0` (đã có).
- **Express:** `express` (đã có).
- **Transport:** `StreamableHTTPServerTransport` đã được dùng cho `/mcp`.
- **HTTP Client:** không cần thêm HTTP client; sử dụng `scrape()` dispatcher.
- **File I/O:** `node:fs`, `node:path`, `node:stream` cho artifact.
- **CLI:** `commander` đã dùng trong `src/cli/index.js`.

## Architecture Compliance

| AD | Rule | Implementation |
|----|------|----------------|
| AD-7 | Daemon MCP over HTTP/SSE trên port 3001 | Giữ `startHttpTransport()` hiện có, không tạo process riêng |
| AD-11 | `ActionDescriptor` shape với `requiresAuth` | `listActions()`/`x_actions_list` trả về đủ trường, `requiresAuth` phân giải |
| AD-14 | Error envelope chuẩn | `src/mcp/envelope.js` map mọi lỗi sang `{ code, type, message, retryAfter, suggestedAction, accountId?, platform }` |
| AD-14 | Legacy CLI mapping | `bin/unfollowx` hoặc `src/cli/commands/compat.js` map lệnh cũ sang `CrawlerCommand` hoặc trả `use_x_actions_list` |
| AD-9 Rule 3 | JSONL sanitize newline | `artifact-exporter` gọi `sanitizeContent()` trước khi ghi |

## Library & Framework Requirements

| Package | Version | Purpose |
|---------|---------|---------|
| `@modelcontextprotocol/sdk` | `^1.30.0` | MCP Server/Transport. [Source: `package.json:101`] |
| `express` | existing | HTTP server. [Source: `package.json`] |
| `uuid` | existing | `randomUUID()` đã dùng cho session id |

## File Structure Requirements

### CREATE

| File | Description |
|------|-------------|
| `src/mcp/envelope.js` | 3-Layer JSON Envelope builder + error wrapper |
| `src/mcp/artifact-exporter.js` | Ghi artifact JSONL/CSV khi >100 records |
| `src/cli/commands/daemon.js` | CLI `xactions daemon status/start/stop` |
| `src/cli/commands/actions.js` | CLI `xactions actions list [--platform <p>]` |
| `tests/mcp/server-envelope.test.js` | Test envelope shape, platform detection, error wrap |
| `tests/mcp/server-artifact.test.js` | Test auto-artifact >100 records |
| `tests/mcp/server-action-discovery.test.js` | Test `x_actions_list` trả về descriptors có `requiresAuth` |
| `tests/cli/daemon.test.js` | Test daemon CLI lifecycle |
| `tests/cli/actions.test.js` | Test `xactions actions list` |

### UPDATE

| File | Description |
|------|-------------|
| `src/mcp/server.js` | Bọc `CallToolRequestSchema` handler bằng envelope; thêm `x_actions_list`, `x_crawl_post`, `x_crawl_comments_tree` |
| `src/cli/index.js` | Register `daemon` command group |
| `bin/unfollowx` | Map legacy commands hoặc trả error `use_x_actions_list` |
| `_bmad-output/implementation-artifacts/sprint-status.yaml` | Cập nhật `14-2` status thành `ready-for-dev` |

### NO TOUCH

| File | Reason |
|------|--------|
| `src/core/base-crawler.js` | `listActions()` đã có `requiresAuth`; chỉ dùng, không sửa logic |
| `src/core/types.js` | `ActionDescriptor` typedef đã có `requiresAuth` |
| `src/scrapers/social/facebook/crawler.js` | Chỉ dùng qua `scrape()` hoặc `listActions()` |

## Testing Requirements

- **Framework:** Vitest, `*.test.js`, `npm test`.
- **No mocks:** Không `vi.fn`, `mock`, `stub`, `fake`.
- **Real HTTP:** Dùng `node:http` để gọi `GET /health`, hoặc spawn `node src/mcp/server.js MCP_TRANSPORT=http` trong test.
- **Real files:** Test artifact thực sự ghi ra `_bmad-output/datasets/` (hoặc `tmp/` trong test), kiểm tra file tồn tại và nội dung.
- **Coverage tối thiểu:**
  - 3-Layer Envelope cho kết quả array, object, object chứa array `comments`/`posts`
  - Error envelope cho `PlatformError` và `Error` thường
  - `x_actions_list` trả về `ActionDescriptor[]` với `requiresAuth` boolean
  - Auto-artifact kích hoạt khi >100 records, `data` preview ≤ 30 records
  - `xactions daemon status` gọi `/health` và parse JSON
  - `npm run typecheck` pass

## Previous Story Intelligence

### Story 14.1 — Hierarchical Comment Tree Extraction (Done, baseline `923466f9`)

- Đã tạo `CommentTreeExtractor` tại `src/scrapers/social/comment-tree.js`.
- `FacebookCrawler` đã đăng ký action `get_comments` với `requiredArgs: ['postId']`.
- Kết quả `get_comments` trả về `{ comments: CommentItem[], pageInfo }` hoặc tương tự.
- Story 14.2 dùng `x_crawl_comments_tree` để wrap kết quả này.

### Story 13.10 — Facebook Hybrid Integration Caller Migration (Done, baseline `9c40ce3f`)

- `scrape('facebook', action, options)` dispatcher (`src/scrapers/index.js:439-494`) gọi `dispatchFacebookHybrid`.
- `FacebookCrawler` đã đăng ký đầy đủ actions: `page_posts`, `group_posts`, `post_comments`, `profile`, `followers`, `search`, `marketplace`, `like`, `comment`, `share`, `join_group`, `send_friend_request`, `messenger_share`, `warmup_scroll`, `warmup_account`, `cancel_friend_requests`.
- `x_facebook_post_comments`, `x_facebook_group_comments`, `x_facebook_posts`, `x_facebook_search`, `x_facebook_group_posts` đã được MCP route qua `executeFacebookScrapeTool`.

## Git Intelligence

Recent commits (gần nhất trước story này):
- `9c40ce3f feat: migrate facebook warmup and cancel actions to hybrid FacebookCrawler`
- `be9a2856 docs(triage): clarify warmup/cancel/schedule legacy path and defer to Epic 20.2`
- `b14acedb refactor(facebook): resolve 13.10 deferred review items and close caller migration gap`

Patterns:
- Commit messages theo format `type(scope): description`.
- Không dùng mock trong tests.
- `src/mcp/server.js` đang trong giai đoạn refactor chuyển tool sang `scrape()`.

## Latest Tech Information

- `@modelcontextprotocol/sdk` `^1.30.0` hỗ trợ `StreamableHTTPServerTransport` cho HTTP/SSE MCP.
- `StreamableHTTPServerTransport` sinh `mcp-session-id` và xử lý POST (messages), GET (SSE stream), DELETE (session close) trên cùng endpoint `/mcp`.
- JSONL là định dạng phù hợp cho streaming large dataset; cần sanitize ký tự xuống dòng trong text.
- Express `app.all('/mcp', ...)` đã xử lý multiple HTTP methods cho MCP session lifecycle.

## Project Context Reference

- Epic 14: `_bmad-output/planning-artifacts/epics.md#epic-14-deep-conversation-scraper-mcp-daemon-nowing-event-stream`
- Architecture AD-7 / AD-11 / AD-14: `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md`
- Sprint change proposal 2026-08-27: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-08-27.md` (T6: verify MCP `x_actions_list` surface trường `requiresAuth`)
- `AbstractCrawler.listActions()`: `src/core/base-crawler.js:106-117`
- `AbstractCrawler.start()`: `src/core/base-crawler.js:151-252`
- `globalActionRegistry`: `src/core/action-registry.js`
- `PlatformError`: `src/core/error-envelope.js`
- `src/mcp/server.js:startHttpTransport()`: `src/mcp/server.js:5097-5170`
- `src/mcp/server.js:createMcpServer()`: `src/mcp/server.js:4893-4985`
- `src/mcp/server.js:executeTool()`: `src/mcp/server.js:2694-2805`
- `scrape()` dispatcher: `src/scrapers/index.js:439-494`
- `src/utils/exporter.js`: streaming JSONL/CSV reference

## Edge Cases & Validation Notes

- **Empty result:** Nếu tool trả về `[]` hoặc object rỗng, envelope vẫn `success: true`, `totalRecords: 0`, `data: []`, không tạo artifact.
- **Non-array result:** Nếu tool trả về `{ dryRun: true, preview: {...} }`, `records = [rawResult]`, `totalRecords = 1`, không cần artifact.
- **HUGE records (> 100k):** Artifact ghi streaming từng dòng, không giữ toàn bộ in memory. Nếu dùng `JSON.stringify` cho toàn bộ array sẽ OOM; phải dùng `for...of` + `writeWithDrain`.
- **Platform unknown:** Nếu không detect được platform, trả `platform: 'unknown'` nhưng vẫn `success: true` nếu result hợp lệ.
- **Artifact directory missing:** Tự động `mkdir` recursive với `fs.mkdirSync(dir, { recursive: true })`.
- **Concurrent sessions:** Envelope stateless, không dùng session state. Artifact path unique theo `timestamp + uuid`.
- **Error in artifact writer:** Nếu ghi artifact lỗi, trả `success: false` với `code: 'XACT_5002'` và vẫn giữ `data` preview.
- **CLI daemon process reuse:** `xactions daemon start` không khởi động nhiều instance — check `CONFIG_DIR/daemon.json` trước spawn.

### Review Findings

- [x] [Review][Patch] Envelope shape sai spec AC-2: `returnedCount` phải là `count`, thiếu `sampleIds`, thiếu `meta.totalRecords` [`src/mcp/envelope.js:137-160`]
- [x] [Review][Patch] Artifact export failure crash tool — thiếu try/catch quanh `exportArtifact()`, spec yêu cầu graceful degradation `XACT_5002` [`src/mcp/envelope.js:152`]
- [x] [Review][Patch] Artifact exporter không stream — `records.map().join()` sẽ OOM cho >100k records; spec yêu cầu `for...of` + `writeWithDrain` [`src/mcp/artifact-exporter.js:48-58`]
- [x] [Review][Patch] `structuredClone` crash cho un-cloneable objects (functions, class instances) — cần try/catch fallback [`src/mcp/artifact-exporter.js:50`]
- [x] [Review][Patch] CSV `buildCsvHeader` chỉ lấy keys từ record[0] — records có sparse keys sẽ mất cột [`src/mcp/artifact-exporter.js:70`]
- [x] [Review][Patch] Daemon start: orphan process khi `waitForHealth` timeout — không kill spawned child [`src/cli/commands/daemon.js:73-76`]
- [x] [Review][Patch] PID file write không atomic — risk corruption nếu CLI crash mid-write [`src/cli/commands/daemon.js:68`]
- [x] [Review][Patch] `isProcessAlive` trả false sai khi EPERM (process owned by root) [`src/cli/commands/daemon.js:184-189`]
- [x] [Review][Patch] PID reuse risk — `daemon stop` nên verify command trước khi kill [`src/cli/commands/daemon.js:106`]
- [x] [Review][Patch] Crawl fallback string matching fragile — `err.message.includes('not available')` quá rộng [`src/mcp/server.js:3039-3041`]
- [x] [Review][Defer] `extractRecords` heuristic ưu tiên `comments` over `posts` khi object có cả hai — deferred, pre-existing design choice
- [x] [Review][Defer] `x_actions_list` chỉ cover Facebook + Threads — deferred, spec ghi rõ skip platform chưa migrate

## Outstanding Items (Dev Agent Owned)

- Quyết định cách triển khai `xactions daemon start/stop` — dùng `child_process.spawn` + lưu PID, `pm2`, hay chỉ in command hướng dẫn.
- Quyết định cắt `data` preview xuống 20 hay 30 records (AC ghi 20-30); khuyến nghị 30.
- Xác định chính xác mapping `x_crawl_post` cho từng platform (ví dụ Facebook dùng `posts` hoặc `post_detail`; Twitter chưa có `post_detail` đến khi Story 13.2 hoàn thành).
- Nếu `ThreadsCrawler` chưa hoàn thiện, `x_actions_list` chỉ liệt kê `FacebookCrawler` actions và skip các platform chưa migrate.
- Nếu `x_crawl_comments_tree` gọi Facebook `get_comments` mà `doc_id` xoay, `scrape()` sẽ throw `PlatformError`; envelope phải giữ `suggestedAction`.

## File List

### New files
- `src/mcp/envelope.js` — 3-Layer JSON Envelope builder.
- `src/mcp/artifact-exporter.js` — JSONL/CSV artifact writer for >100 records.
- `src/cli/commands/daemon.js` — CLI daemon lifecycle commands.
- `src/cli/commands/actions.js` — CLI action discovery.
- `tests/mcp/server-envelope.test.js`
- `tests/mcp/server-artifact.test.js`
- `tests/mcp/server-action-discovery.test.js`
- `tests/cli/daemon.test.js`
- `tests/cli/actions.test.js`

### Updated files
- `src/mcp/server.js` — tool handlers, envelope wrap.
- `src/cli/index.js` — register `daemon` and `actions` command groups.
- `bin/unfollowx` — legacy CLI mapping / error.
