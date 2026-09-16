---
title: 'Story 20.2 — Universal Stream-Publish Hook'
type: 'feature'
created: '2026-09-16'
status: 'done'
route: 'dispatch'
baseline_commit: '206065b372b4c687830276eb96ef8649d742c159'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Chỉ có Facebook crawler emit stream events; 15+ non-social/VN crawlers emit 0 events vì `AbstractCrawler` không có stream-publish hook. Nowing consumer bị block vì không nhận được data từ các platform như chotot, masothue, batdongsan, etc.

**Approach:** Thêm universal stream-publish hook vào `AbstractCrawler` sau `entry.handler()` trong `start()` — normalize sang snake_case `ThinEvent` schema, per-category `mapToThinEvent()` mapping, dual-emit transition (camelCase + snake_case) để không break existing consumers.

## Boundaries & Constraints

**Always:**
- Hook nằm trong `AbstractCrawler.start()` SAU `entry.handler()` — KHÔNG phải sau `storeBatch` (base crawler không có storeBatch)
- Schema chuẩn snake_case: `{ id, platform, external_post_id, category, author_id, author_name, post_url, crawled_at, storage_ref, scraper_id, content_snippet, target_id, workspace_id, schema_version }`
- `schema_version: 1` — bump khi breaking change
- `content_snippet` BẮT BUỘC — Nowing drop nếu thiếu
- `target_id`/`workspace_id` forward từ `session.context`
- Gate: `REDIS_STREAM_ENABLED`, MAXLEN ~1M
- Dual-emit: giữ cả camelCase fields + snake_case fields trong 1 sprint

**Never:**
- KHÔNG sửa per-crawler — base hook tự động emit cho tất cả
- KHÔNG xóa Facebook `#saveCheckpoint` — chỉ delegate sang base hook (tránh double emission)
- KHÔNG hardcode camelCase whitelist trong `formatPayload()`

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| PostItem → stream | `PostItem` với `text`, `authorId`, `url` | `content_snippet` = text (≤4000), `author_id` = authorId, `post_url` = url | N/A |
| ProductItem → stream | `ProductItem` với `title`, `description`, `shop_id`, `productUrl` | `content_snippet` = title + description, `author_id` = shop_id, `post_url` = productUrl | N/A |
| CompanyItem → stream | `CompanyItem` với `name`, `industry`, `address`, `taxCode`, `detailUrl` | `content_snippet` = name + industry + address, `author_id` = taxCode, `post_url` = detailUrl | N/A |
| JobItem → stream | `JobItem` với `title`, `company`, `location`, `companyId`, `jobUrl` | `content_snippet` = title + company + location, `author_id` = companyId, `post_url` = jobUrl | N/A |
| ListingItem → stream | `ListingItem` với `title`, `price`, `area`, `sellerId`, `listingUrl` | `content_snippet` = title + price + area, `author_id` = sellerId, `post_url` = listingUrl | N/A |
| Missing content_snippet | Item không có `content_snippet` field | Nowing drop event | Log warning |
| Stream disabled | `REDIS_STREAM_ENABLED=false` | Không emit event | Skip silently |
| dryRun=true | `dryRun=true` trong args | KHÔNG emit event | Skip silently |
| Missing workspace_id | `session.context.workspaceId` undefined | Nowing drop event | Log warning |

</frozen-after-approval>

## Open Questions

1. **Facebook dual-emit transition:** Facebook hiện emit camelCase qua `#saveCheckpoint` + direct `xAdd`. Khi base hook emit snake_case, Facebook sẽ emit 2 events (camelCase + snake_case) hoặc chỉ snake_case? Options: (a) giữ dual-emit 1 sprint để consumers migrate, (b) chỉ snake_case ngay — breaking change.

2. **content_snippet truncation:** Truncate ở base hook hay để per-crawler quyết định? Options: (a) base hook truncate ≤4000 chars, (b) per-crawler tự truncate — base hook chỉ validate.

3. **mapToThinEvent signature:** `mapToThinEvent(item, context)` hay `mapToThinEvent(item, { platform, action, context })`? Options: (a) đơn giản `item, context`, (b) thêm platform/action để per-crawler có thể override theo action.

## Code Map

- `src/core/base-crawler.js` — `AbstractCrawler` class, `start()` method (line ~500), `entry.handler()` call site
- `src/utils/redis-stream-publisher.js` — `RedisStreamPublisher`, `formatPayload()` (line ~200), `publish()` (line ~200)
- `src/scrapers/social/facebook/crawler.js` — `#saveCheckpoint` (line ~2870), existing stream publish (line ~2900)
- `src/core/types.js` — `ThinEvent` typedef (line ~215), `PostItem`, `ProductItem`, `CompanyItem`, `JobItem`, `ListingItem`
- `src/scrapers/index.js` — `scrape()` dispatcher, `DESCRIPTORS` registry

## Tasks & Acceptance

**Execution:**
- [x] `src/core/base-crawler.js` — Thêm `mapToThinEvent(item, context)` method + stream-publish hook sau `entry.handler()` trong `start()` — normalize snake_case ThinEvent, dual-emit camelCase + snake_case
- [x] `src/utils/redis-stream-publisher.js` — Sửa `formatPayload()` — map snake_case fields, hỗ trợ `content_snippet`, `target_id`, `workspace_id`, `schema_version`
- [x] `src/scrapers/social/facebook/crawler.js` — Delegate `#saveCheckpoint` stream publish sang base hook — tránh double emission
- [x] `src/core/types.js` — Cập nhật `ThinEvent` typedef — thêm snake_case fields, `content_snippet`, `target_id`, `workspace_id`, `schema_version`
- [x] `tests/core/base-crawler-stream.test.js` — Unit test cho `mapToThinEvent` per item type + stream publish hook
- [x] `tests/utils/redis-stream-publisher.test.js` — Unit test cho `formatPayload` snake_case mapping

**Acceptance Criteria:**
- Given `REDIS_STREAM_ENABLED=true` và crawler chạy `search_listings`, when `entry.handler()` returns `PostItem[]`, then base hook emit snake_case ThinEvent với `content_snippet` = text (≤4000), `author_id` = authorId, `post_url` = url, `schema_version` = 1.
- Given `dryRun=true`, when crawler chạy bất kỳ action nào, then KHÔNG emit stream event.
- Given `session.context.workspaceId` undefined, when crawler emit event, then log warning `[StreamPublisher:MissingWorkspaceId]` và Nowing consumer drop event.
- Given `item` không có `content_snippet`, when base hook map, then log warning và Nowing consumer drop event.

## Implementation Notes

- Added `mapToThinEvent(item, context)` method to `AbstractCrawler` with per-type field mapping:
  - PostItem: `content_snippet` = text, `author_id` = authorId, `post_url` = url
  - ProductItem: `content_snippet` = title + description, `author_id` = shop_id, `post_url` = productUrl
  - CompanyItem: `content_snippet` = name + industry + address, `author_id` = taxCode, `post_url` = detailUrl
  - JobItem: `content_snippet` = title + company + location, `author_id` = companyId, `post_url` = jobUrl
  - ListingItem: `content_snippet` = title + price + area, `author_id` = sellerId, `post_url` = listingUrl
- Added `#emitStreamEvents(result, session, args)` private method — checks `REDIS_STREAM_ENABLED`, `session.dryRun`, `args.dryRun`
- Added `extractItems(result)` helper — extracts flat array from `{items, posts, data, listings, products, jobs, comments}`
- Hook called in `start()` after `entry.handler()` returns result
- Updated `formatPayload()` in `redis-stream-publisher.js` to output snake_case fields + dual-emit camelCase
- Updated `ThinEvent` typedef with snake_case canonical fields + camelCase legacy fields
- Removed direct `xAdd` from Facebook `#saveCheckpoint` — base hook now handles all stream emission
- Fixed `dryRun` check — was checking `session.dryRun`, now checks `session.dryRun || args.dryRun`



## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. -->

## Review Triage Log

<!-- Append-only. Populated by step-04 on every review pass. -->

## Design Notes

**Schema normalization (snake_case):**
```javascript
// Base hook normalize sang snake_case — KHÔNG để per-crawler tự emit schema riêng
const thinEvent = {
  id: item.id,
  platform: this.name,
  external_post_id: item.externalId,
  category: item.category || this.category,
  author_id: item.authorId,
  author_name: item.authorName,
  post_url: item.url,
  crawled_at: toIsoDate(item.crawledAt),
  storage_ref: item.storageRef || item.id,
  scraper_id: this.scraperId,
  content_snippet: this.extractContentSnippet(item),
  target_id: context?.targetId,
  workspace_id: context?.workspaceId,
  schema_version: 1,
  // Dual-emit: giữ camelCase fields cho backward compatibility
  externalId: item.externalId,
  authorId: item.authorId,
  crawledAt: toIsoDate(item.crawledAt),
};
```

**mapToThinEvent per item type:**
```javascript
// Per-category field mapping — override trong subclass nếu cần
mapToThinEvent(item, context) {
  const base = {
    id: item.id,
    platform: this.name,
    external_post_id: item.externalId,
    category: item.category || this.category,
    author_id: item.authorId,
    author_name: item.authorName,
    post_url: item.url,
    crawled_at: toIsoDate(item.crawledAt),
    storage_ref: item.storageRef || item.id,
    scraper_id: this.scraperId,
    target_id: context?.targetId,
    workspace_id: context?.workspaceId,
    schema_version: 1,
  };
  
  // Per-type content_snippet
  if (item.text) base.content_snippet = item.text.slice(0, 4000);
  else if (item.title && item.description) base.content_snippet = `${item.title} ${item.description}`.slice(0, 4000);
  else if (item.name && item.industry) base.content_snippet = `${item.name} ${item.industry}`.slice(0, 4000);
  
  return base;
}
```

## Verification

**Commands:**
- `npm test tests/core/base-crawler-stream.test.js` — expected: all tests pass
- `npm test tests/utils/redis-stream-publisher.test.js` — expected: all tests pass
- `npm run typecheck` — expected: 0 errors

**Manual checks:**
- Start MCP server với `REDIS_STREAM_ENABLED=true`, call `x_scrape` với platform=chotot, action=search_listings, verify stream event emitted với snake_case schema
- Verify Facebook không double-emit (chỉ 1 event per item)
