---
title: 'Multi-Consumer Service Contract (x_scrape + x_actions_list + Action Matrix)'
type: 'feature'
created: '2026-09-15'
status: 'ready-for-dev'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '4a6db23c168ad39bde0fdc3e90eafccc57285bfd'
context:
  - _bmad-output/implementation-artifacts/epic-20-context.md
  - _bmad-output/planning-artifacts/sprint-change-proposal-2026-09-15-multi-consumer-scraping-platform.md
---

# Spec — Story 20.1: Multi-Consumer Service Contract

> **Story:** `20-1-multi-consumer-service-contract-x-scrape-x-actions-list-action-matrix`
> **Status:** `draft`
> **Epic:** Epic 20 — Multi-Consumer Scraping Platform Service Contract
> **Effort:** ~2 dev days
> **Author:** Claude (bmad-build workflow)
> **Date:** 2026-09-15

---

## User Intent

Expose `scrape()` dispatcher (Epic 25) thành service-to-service contract cho multi-consumer qua MCP `x_scrape` tool, mở rộng `x_actions_list` cho toàn bộ 24 platforms, fix `envelope.js` extractRecords cho VN crawlers, và generate canonical action matrix doc.

Nowing đã wire phía mình (`XActionsMcpClient` + Celery beat + stream consumer) theo REQ-X1..X4 nhưng bị block vì `x_scrape` không tồn tại và `x_actions_list` thiếu 6 platforms.

<frozen-after-approval>
**Scope cốt lõi (REQ-X1 + X3 + X4):**
1. `x_scrape` MCP tool — generic scrape(platform, action, args) với context envelope, unified response envelope
2. `x_actions_list` mở rộng — enumerate toàn bộ 24 DESCRIPTORS registry
3. `envelope.js` `extractRecords()` — thêm `listings`, `products`, `jobs`
4. Canonical action/arg matrix doc — auto-generated `.md` + `.json`
</frozen-after-approval>

---

## Code Map

### Files to Modify

| File | Change | Lines |
|------|--------|-------|
| `src/mcp/server.js` | Thêm `x_scrape` tool definition trong `TOOLS` + `executeScrapeTool` handler + export | TOOLS array (~2788), handler section (~3600), exports (~6437) |
| `src/scrapers/social/actions-list.js` | Thêm 6 crawler loaders (fnb, healthcare, legal, automotive, b2b-registry-extended, tiktokShop); filter `checkpointResolver`; add `category` + `detailLevel` filters; add `no_crawler` flag | Lines 19-65 |
| `src/mcp/envelope.js` | `extractRecords()` — thêm `'listings'`, `'products'`, `'jobs'` vào key list | Line 117 |

### Files to Create

| File | Purpose |
|------|---------|
| `scripts/generate-action-matrix.js` | Script generate `docs/canonical-action-matrix.md` + `.json` từ `x_actions_list` |
| `docs/canonical-action-matrix.md` | Human-readable action/arg matrix (auto-generated) |
| `docs/canonical-action-matrix.json` | Machine-readable action/arg matrix (auto-generated, cho Nowing CI) |

### Key Symbols to Reuse

| Symbol | Location | Reuse for |
|--------|----------|-----------|
| `scrape(platform, action, options)` | `src/scrapers/index.js:253` | Core dispatcher — `x_scrape` calls this |
| `actionNotAvailable(platform, action, available)` | `src/scrapers/platforms.js:155` | "Did You Mean?" error |
| `DEPRECATED_ACTIONS` | `src/scrapers/platforms.js:168` | Deprecated action suggestions |
| `wrapToolResult(result)` | `src/mcp/envelope.js:173` | Unified response envelope |
| `executeActionListTool(options)` | `src/scrapers/social/actions-list.js:19` | Action discovery — extend |
| `consumerContextStorage` | `src/mcp/consumer-context.js` | Multi-tenant context (AsyncLocalStorage) |
| `isEnvTruthy(val)` | `src/utils/redis-stream-publisher.js` | `REDIS_STREAM_ENABLED` check |
| `PlatformError`, `ErrorTypes`, `SuggestedActions` | `src/core/error-envelope.js` | Error types |

### What NOT to Change

| File | Why |
|------|-----|
| `src/core/base-crawler.js` | Story 20.2 scope — stream hook belongs there, not here |
| `src/utils/redis-stream-publisher.js` | Story 20.2 scope — formatPayload snake_case fix |
| `src/scrapers/social/facebook/crawler.js` | Story 20.2 scope — remove direct emit |
| `src/scrapers/index.js` | `scrape()` signature unchanged — only called by `x_scrape` |
| `src/scrapers/platforms.js` | `DEPRECATED_ACTIONS`/`actionNotAvailable` unchanged — reused as-is |

---

## Implementation Tasks

### Task 1: Add `x_scrape` MCP tool definition + handler

**File:** `src/mcp/server.js`

1.1. Add `x_scrape` to `TOOLS` array (after `x_actions_list`, before `x_crawl_post`):

```javascript
{
  name: 'x_scrape',
  description: 'Generic scrape dispatcher — calls scrape(platform, action, args). Use x_actions_list to discover available platforms/actions/args. Data flows through Redis Stream when REDIS_STREAM_ENABLED=true (returns preview only).',
  inputSchema: {
    type: 'object',
    properties: {
      platform: {
        type: 'string',
        description: 'Canonical platform key from DESCRIPTORS (e.g. masothue, chotot, shopee, facebook). Run x_actions_list to discover.',
      },
      action: {
        type: 'string',
        description: 'Canonical action name from ActionDescriptor. Run x_actions_list to discover.',
      },
      args: {
        type: 'object',
        description: 'Action arguments as nested object (NOT flat). Forwarded to scrape(platform, action, args) via descriptor.mapArgs.',
      },
      context: {
        type: 'object',
        description: 'Multi-tenant context envelope forwarded to stream events. Recommended: { targetId, workspaceId }. Additional keys (traceId, jobId...) allowed.',
      },
      accountId: { type: 'string', description: 'Account ID for session resolution' },
      proxyUrl: { type: 'string', description: 'Proxy URL for request routing' },
      dryRun: {
        type: 'boolean',
        description: 'Preview mode — do NOT emit stream events or persist data (default: false)',
        default: false,
      },
      artifactFormat: {
        type: 'string',
        enum: ['jsonl', 'csv'],
        description: 'Artifact format when totalRecords > 100 (default: jsonl)',
      },
    },
    required: ['platform', 'action', 'args'],
  },
},
```

1.2. Add `executeScrapeTool` handler (near `executeCrawlPostTool`):

```javascript
/**
 * Execute the x_scrape tool.
 * Generic dispatcher — calls scrape(platform, action, args).
 * @param {Record<string, unknown>} args
 * @returns {Promise<unknown>}
 */
async function executeScrapeTool(args) {
  const { platform, action, args: actionArgs, context, accountId, proxyUrl, dryRun, artifactFormat } = args;

  if (!platform || typeof platform !== 'string') {
    throw new PlatformError({
      code: 'XACT_4001', type: ErrorTypes.INVALID_ARGS,
      message: 'x_scrape requires a platform argument',
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }
  if (!action || typeof action !== 'string') {
    throw new PlatformError({
      code: 'XACT_4001', type: ErrorTypes.INVALID_ARGS,
      message: 'x_scrape requires an action argument',
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }

  const { scrape } = await import('../scrapers/index.js');
  const { isEnvTruthy } = await import('../utils/redis-stream-publisher.js');
  const streamEnabled = isEnvTruthy(process.env.REDIS_STREAM_ENABLED);

  // Merge execution opts into the flat options scrape() expects
  const scrapeOptions = {
    ...(actionArgs && typeof actionArgs === 'object' ? actionArgs : {}),
    ...(accountId ? { accountId } : {}),
    ...(proxyUrl ? { proxyUrl } : {}),
    ...(dryRun != null ? { dryRun } : {}),
    ...(artifactFormat ? { artifactFormat } : {}),
    ...(context && typeof context === 'object' ? { context } : {}),
  };

  // Workspace validation warning when stream enabled
  if (streamEnabled && context && typeof context === 'object') {
    if (context.workspaceId === undefined || context.workspaceId === null) {
      console.warn('[StreamPublisher:MissingWorkspaceId] x_scrape called without context.workspaceId — Nowing consumer will drop stream events.');
    }
  }

  const result = await scrape(String(platform), String(action), scrapeOptions);

  // Wrap in unified envelope
  const envelope = wrapToolResult(result, { artifactFormat });

  // Add stream metadata when enabled
  if (streamEnabled) {
    envelope.mode = 'stream';
    envelope.stream = {
      enabled: true,
      name: 'stream:social:raw_posts',
      cursor: result?.__streamCursor || null,
    };
    // Truncate data to preview when stream enabled
    if (envelope.data && envelope.data.length > 10) {
      envelope.preview = envelope.data.slice(0, 10);
      envelope.data = envelope.preview;
    }
  } else {
    envelope.mode = 'direct';
    envelope.stream = { enabled: false };
  }

  return envelope;
}
```

1.3. Add to `executeTool` dispatch (near `x_actions_list` handler):

```javascript
if (name === 'x_scrape') {
  return await executeScrapeTool(args);
}
```

1.4. Export `executeScrapeTool` in module exports (line ~6437).

### Task 2: Extend `x_actions_list` for all 24 platforms

**File:** `src/scrapers/social/actions-list.js`

2.1. Add 6 missing crawler loaders to `crawlerLoaders` array (in category order):

```javascript
// After existing loaders (tiktok, youtube, zalo):
() => import("../ecom/tiktok-shop/crawler.js").then((m) => new m.TikTokShopCrawler()),
() => import("../fnb/merchant/crawler.js").then((m) => new m.FnbMerchantCrawler()),
() => import("../healthcare/crawler.js").then((m) => new m.HealthcareCrawler()),
() => import("../legal/ip-trademark/crawler.js").then((m) => new m.IpTrademarkCrawler()),
() => import("../vehicles/automotive/crawler.js").then((m) => new m.AutomotiveCrawler()),
() => import("../procurement/b2b-registry-extended/index.js").then((m) => new m.B2BRegistryExtendedCrawler()),
```

**Note:** `b2b-registry-extended` uses `index.js` not `crawler.js` — loader must handle this.

2.2. Add `no_crawler` flag + filter `checkpointResolver` + `category`/`detailLevel` filters:

```javascript
// After collecting allActions:
const allDescriptors = Object.keys(DESCRIPTORS); // or from platforms registry
const loadedPlatforms = new Set(allActions.map(a => a.platform));

// Flag platforms with no crawler
const platforms = require('./platforms.js').platforms; // or import
for (const key of allDescriptors) {
  const canonical = /* resolve canonical name from alias */;
  if (!loadedPlatforms.has(canonical)) {
    allActions.push({
      platform: canonical,
      action: null,
      no_crawler: true,
      description: 'Platform registered in DESCRIPTORS but no Crawler class available',
    });
  }
}

// Filter checkpointResolver (function ref, not serializable)
for (const action of allActions) {
  delete action.checkpointResolver;
}

// Filter by category
if (opts.category) {
  allActions = allActions.filter(a => a.category === opts.category);
}

// detailLevel
if (opts.detailLevel === 'summary') {
  allActions = allActions.map(({ platform, action, description, requiredArgs, no_crawler }) => 
    ({ platform, action, description, requiredArgs, no_crawler }));
}
```

2.3. Update `x_actions_list` tool inputSchema in `server.js`:

```javascript
// Add to properties:
category: {
  type: 'string',
  description: 'Filter by category: social, ecom, recruitment, realestate, procurement, legal, fnb, healthcare, vehicles',
},
detailLevel: {
  type: 'string',
  enum: ['summary', 'full'],
  description: 'Detail level (default: full)',
},
```

### Task 3: Fix `extractRecords()` for VN crawlers

**File:** `src/mcp/envelope.js` (line 117)

```javascript
// Change:
for (const key of ['comments', 'posts', 'items', 'data']) {
// To:
for (const key of ['comments', 'posts', 'items', 'data', 'listings', 'products', 'jobs']) {
```

### Task 4: Generate canonical action matrix doc

**File:** `scripts/generate-action-matrix.js` (new)

```javascript
#!/usr/bin/env node
/**
 * Generate canonical action/arg matrix from x_actions_list.
 * Usage: npm run docs:matrix
 * Output: docs/canonical-action-matrix.md + docs/canonical-action-matrix.json
 */

import { executeActionListTool } from '../src/scrapers/social/actions-list.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const actions = await executeActionListTool({ detailLevel: 'full' });

// Generate JSON
const matrix = {
  generated: new Date().toISOString(),
  platforms: {},
};

for (const action of actions) {
  const platform = action.platform;
  if (!matrix.platforms[platform]) {
    matrix.platforms[platform] = {
      category: action.category || 'unknown',
      no_crawler: action.no_crawler || false,
      actions: [],
    };
  }
  matrix.platforms[platform].actions.push({
    action: action.action,
    description: action.description,
    requiredArgs: action.requiredArgs || [],
    optionalArgs: action.optionalArgs || [],
    example: action.example || {},
    outputType: action.outputType,
    requiresAuth: action.requiresAuth || false,
  });
}

// Write JSON
writeFileSync(
  join(process.cwd(), 'docs/canonical-action-matrix.json'),
  JSON.stringify(matrix, null, 2)
);

// Write Markdown
let md = '# Canonical Action/Arg Matrix\n\n';
md += `> Auto-generated ${new Date().toISOString()}. Do not edit manually.\n\n`;
md += '| Platform | Category | Action | Required Args | Optional Args | Example |\n';
md += '|----------|----------|--------|---------------|---------------|---------|\n';

for (const [platform, info] of Object.entries(matrix.platforms)) {
  for (const action of info.actions) {
    md += `| ${platform} | ${info.category} | ${action.action || '—'} | ${(action.requiredArgs || []).join(', ') || '—'} | ${(action.optionalArgs || []).join(', ') || '—'} | \`${JSON.stringify(action.example)}\` |\n`;
  }
}

writeFileSync(join(process.cwd(), 'docs/canonical-action-matrix.md'), md);
console.log(`Generated action matrix: ${Object.keys(matrix.platforms).length} platforms, ${actions.length} actions`);
```

**File:** `package.json` — add script:

```json
"docs:matrix": "node scripts/generate-action-matrix.js"
```

### Task 5: Export `executeScrapeTool` + add to dispatch

**File:** `src/mcp/server.js` (line ~6437)

Add `executeScrapeTool` to exports:

```javascript
export { TOOLS, main, createMcpServer, initializeBackend, executeTool, executeFacebookAutomateTool, executeFacebookEpic4Tool, executeFacebookScrapeTool, executeFacebookListAccounts, executeActionListTool, executeCrawlPostTool, executeCrawlCommentsTreeTool, executeScrapeTool, startHttpTransport };
```

Add to `executeTool` dispatch (near line 3206):

```javascript
if (name === 'x_scrape') {
  return await executeScrapeTool(args);
}
```

---

## Acceptance Criteria

### AC-1: `x_scrape` tool registered and callable

- **Given** MCP server running
- **When** `x_scrape('masothue', 'search', { args: { taxCode: '0123456789' } })` called
- **Then** `scrape('masothue', 'search', { taxCode: '0123456789' })` invoked → descriptor.mapArgs resolves `taxCode → q` → envelope returned

### AC-2: Unified response envelope

- **Given** `REDIS_STREAM_ENABLED=true`
- **When** `x_scrape` called
- **Then** response has `mode: 'stream'`, `stream: { enabled: true, name: 'stream:social:raw_posts', cursor: lastEventId }`, `preview: [...≤10 items]`
- **Given** `REDIS_STREAM_ENABLED=false`
- **When** `x_scrape` called
- **Then** response has `mode: 'direct'`, `data: [...full result]`

### AC-3: `dryRun` suppresses stream emission

- **Given** `x_scrape` called with `dryRun: true`
- **When** crawl completes
- **Then** `REDIS_STREAM_ENABLED` check in base hook (Story 20.2) prevents stream emission — `x_scrape` response has `mode: 'direct'` regardless of env var

### AC-4: `x_actions_list` covers all 24 platforms

- **Given** `x_actions_list` called
- **Then** response includes actions for all 24 platforms: twitter, bluesky, mastodon, threads, facebook, tiktok, tiktokshop, reddit, medium, instagram, youtube, zalo, shopee, topcv, vietnamworks, linkedin, chotot, batdongsan, masothue, b2b_registry_extended, automotive, fnb, healthcare, ipvietnam/legal
- **And** platforms without crawler → `no_crawler: true` flag
- **And** `checkpointResolver` filtered out from all ActionDescriptors

### AC-5: "Did You Mean?" suggestion on wrong action

- **Given** `x_scrape('chotot', 'posts', {...})` called (wrong action)
- **Then** error `XACT_4001` with `availableActions: ['search_listings', 'listing_detail']` + suggestion

### AC-6: `envelope.js` extractRecords supports VN crawlers

- **Given** `scrape('chotot', 'search_listings', {...})` returns `{ listings: [...] }`
- **When** `wrapToolResult` processes it
- **Then** `extractRecords` returns the `listings` array (not wrapping `{listings}` as single record)

### AC-7: `context` envelope forwarded to stream

- **Given** `x_scrape` called with `context: { targetId: 't1', workspaceId: 42 }`
- **When** crawl emits to Redis Stream (Story 20.2)
- **Then** events have `target_id: 't1'`, `workspace_id: 42`

### AC-8: Missing `workspaceId` warning

- **Given** `x_scrape` called without `context.workspaceId` and `REDIS_STREAM_ENABLED=true`
- **Then** WARN log `[StreamPublisher:MissingWorkspaceId]` emitted

### AC-9: Canonical action matrix generated

- **Given** `npm run docs:matrix` executed
- **Then** `docs/canonical-action-matrix.md` + `docs/canonical-action-matrix.json` generated with all 24 platforms' actions

### AC-10: `b2b-registry-extended` loader works

- **Given** `b2b-registry-extended` uses `index.js` not `crawler.js`
- **When** `x_actions_list` runs
- **Then** `B2BRegistryExtendedCrawler` instantiated successfully (via `index.js` import)

---

## Edge Cases & Error Handling

| Case | Expected Behavior |
|------|-------------------|
| `platform` not in DESCRIPTORS | `XACT_4001` with `available` list |
| `action` not in platform's actionMap | `XACT_4001` with `availableActions` + `suggestedAction` |
| `args` missing requiredArgs | `XACT_4002` with `missing[]` + `example` |
| `context.workspaceId = 0` | Forward `0` as-is (dùng `??` không `\|\|`) |
| `b2b-registry-extended` no crawler.js | Loader uses `index.js` — no silent skip |
| Platform fails to import | Flag `no_crawler: true` in output |
| `dryRun: true` + `REDIS_STREAM_ENABLED=true` | No stream emission, `mode: 'direct'` |
| `args` not an object | `XACT_4001` — args must be object |
| `context` not an object | Ignored — no context forwarding |

---

## Out of Scope (Story 20.2)

- Stream-publish hook in `AbstractCrawler.start()` → `mapToThinEvent()`
- `redis-stream-publisher.js` `formatPayload()` snake_case fix
- Per-crawler direct emit removal (Facebook, Threads, etc.)
- `schema_version` field in stream events
- `content_snippet` field mapping per category
- Dual-emit camelCase + snake_case transition

---

## Test Plan

| Test | File | Coverage |
|------|------|----------|
| `x_scrape` tool registration | `tests/mcp/x-scrape-tool.test.js` | Tool in TOOLS array, inputSchema valid, handler dispatch |
| `x_scrape` platform validation | `tests/mcp/x-scrape-tool.test.js` | `XACT_4001` when platform missing/invalid |
| `x_scrape` action validation | `tests/mcp/x-scrape-tool.test.js` | `XACT_4001` when action missing/invalid, availableActions listed |
| `x_scrape` requiredArgs validation | `tests/mcp/x-scrape-tool.test.js` | `XACT_4002` + `missing[]` + `example` |
| `x_scrape` envelope shape | `tests/mcp/x-scrape-tool.test.js` | Unified envelope: `mode`, `stream`, `preview`, `data` |
| `x_scrape` context forwarding | `tests/mcp/x-scrape-tool.test.js` | `context` → `scrapeOptions.context` |
| `x_actions_list` 24 platforms | `tests/mcp/actions-list-complete.test.js` | All 24 platforms enumerated, `no_crawler` flag, `checkpointResolver` filtered |
| `extractRecords` VN keys | `tests/mcp/envelope.test.js` | `listings`, `products`, `jobs` extracted correctly |
| Action matrix generation | `tests/docs/matrix-generation.test.js` | `npm run docs:matrix` generates `.md` + `.json` |
| `b2b-registry-extended` loader | `tests/scrapers/crawler-instantiation.test.js` | `B2BRegistryExtendedCrawler` instantiated via `index.js` |

---

## Dependencies

| Dependency | Status | Notes |
|------------|--------|-------|
| `scrape()` dispatcher | ✅ Done (Epic 25) | `src/scrapers/index.js:253` |
| `wrapToolResult` | ✅ Done | `src/mcp/envelope.js:173` |
| `actionNotAvailable` | ✅ Done | `src/scrapers/platforms.js:155` |
| `DEPRECATED_ACTIONS` | ✅ Done | `src/scrapers/platforms.js:168` |
| `RedisStreamPublisher` | ✅ Done | `src/utils/redis-stream-publisher.js` |
| `isEnvTruthy` | ✅ Done | `src/utils/redis-stream-publisher.js` |
| `consumerContextStorage` | ✅ Done | `src/mcp/consumer-context.js` |
| Story 20.2 (stream hook) | 📋 Backlog | **BẮT BUỘC atomic release với 20.1** |
