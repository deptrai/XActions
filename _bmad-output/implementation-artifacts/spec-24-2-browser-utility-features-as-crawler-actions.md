---
title: 'Story 24.2 — Browser Utility Features as Crawler Actions'
type: 'feature'
created: '2026-09-16'
status: 'done'
route: 'dispatch'
baseline_commit: '07a3ab45'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 24.1 audit identified 3 useful browser scripts (videoDownloader, bookmarkExporter, threadUnroller) that were archived but contain valuable features not yet exposed as `CrawlerCommand` actions.

**Approach:** Add `export_bookmarks` and `unroll_thread` actions to `TwitterCrawler` — `download_video` already exists. These actions leverage existing `bookmarks()` and `thread()` methods but return formatted output (JSON/CSV/markdown) instead of raw PostItem[].

## Boundaries & Constraints

**Always:**
- Reuse existing `this.bookmarks()` and `this.thread()` methods — don't reimplement scraping logic
- Return formatted output: `export_bookmarks` → `{ posts, json?, csv?, destPath? }`, `unroll_thread` → `{ posts, text?, markdown?, json?, destPath? }`
- Keep existing `bookmarks` and `thread` actions unchanged — new actions are convenience wrappers
- All new actions must have `requiresAuth: true` (bookmarks/thread need auth for full data)
- `unroll_thread` uses `conversation` array (ordered thread), not `posts` (unordered)
- Validate `format` arg: export_bookmarks accepts 'json'|'csv'|'both', unroll_thread accepts 'text'|'markdown'|'json'
- `destPath` optional — if provided, write formatted output to file (matches `download_video` pattern)

**Never:**
- KHÔNG thêm `download_video` — đã tồn tại
- KHÔNG modify existing `bookmarks`/`thread` action signatures
- KHÔNG duplicate scraping logic — delegate to existing methods
- KHÔNG dùng `posts` array cho unroll_thread — dùng `conversation` (ordered)

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| export_bookmarks json | `{ format: 'json' }` | `{ posts: PostItem[], json: string }` | N/A |
| export_bookmarks csv | `{ format: 'csv' }` | `{ posts: PostItem[], csv: string }` | N/A |
| export_bookmarks both | `{ format: 'both' }` | `{ posts: PostItem[], json: string, csv: string }` | N/A |
| export_bookmarks destPath | `{ format: 'csv', destPath: '/tmp/out.csv' }` | `{ posts, csv, destPath }` | Write file, return path |
| unroll_thread markdown | `{ tweetId: '123', format: 'markdown' }` | `{ posts: PostItem[], markdown: string }` | N/A |
| unroll_thread text | `{ tweetId: '123', format: 'text' }` | `{ posts: PostItem[], text: string }` | N/A |
| unroll_thread json | `{ tweetId: '123', format: 'json' }` | `{ posts: PostItem[], json: string }` | N/A |
| unroll_thread destPath | `{ tweetId: '123', format: 'markdown', destPath: '/tmp/thread.md' }` | `{ posts, markdown, destPath }` | Write file, return path |
| Invalid format | `{ format: 'xml' }` | `XACT_4001` error | Return error envelope |
| Missing tweetId | `{ format: 'markdown' }` | `XACT_4001` error | Return error envelope |
| Auth required | No session/cookies | `XACT_4010` auth error | Return error envelope |

</frozen-after-approval>

## Code Map

- `src/scrapers/social/twitter/crawler.js` — Add `export_bookmarks` and `unroll_thread` actions + handler methods
- `src/scrapers/social/twitter/normalize-bookmarks.js` — `normalizeBookmarksResponse` already exists
- `src/scrapers/social/twitter/normalize-thread.js` — `normalizeThreadResponse` returns `{ posts, rootTweet, authorReplies, conversation, pageInfo }`
- `archive/scrapers/scripts/bookmarkExporter.js` — Reference for CSV format
- `archive/scrapers/scripts/threadUnroller.js` — Reference for markdown format

## Tasks & Acceptance

**Execution:**
- [x] `src/scrapers/social/twitter/crawler.js` — Add `export_bookmarks` action + `exportBookmarks()` method
- [x] `src/scrapers/social/twitter/crawler.js` — Add `unroll_thread` action + `unrollThread()` method
- [x] `src/scrapers/social/twitter/crawler.js` — Add `formatBookmarksAsCSV()`, `formatBookmarksAsJSON()`, `formatThreadAsMarkdown()`, `formatThreadAsText()` helpers
- [x] `src/scrapers/social/twitter/crawler.js` — Add `writeFormattedOutput()` helper for destPath support
- [x] `npm test` — Verify no breakage

**Acceptance Criteria:**
- Given `export_bookmarks` với `format: 'json'`, when gọi action, then trả `{ posts, json }` với valid JSON string
- Given `export_bookmarks` với `format: 'csv'`, when gọi action, then trả `{ posts, csv }` với CSV headers
- Given `export_bookmarks` với `format: 'csv'` + `destPath`, when gọi action, then write file và trả `{ posts, csv, destPath }`
- Given `unroll_thread` với `format: 'markdown'`, when gọi action, then trả `{ posts, markdown }` với markdown formatted thread
- Given `unroll_thread` với `format: 'markdown'` + `destPath`, when gọi action, then write file và trả `{ posts, markdown, destPath }`
- Given invalid `format`, when gọi action, then trả `XACT_4001` error
- Given missing `tweetId`, when gọi `unroll_thread`, then trả `XACT_4001` error

## Implementation Notes

- Added `export_bookmarks` action to `TwitterCrawler` delegating to `this.bookmarks()` and formatting output as JSON, CSV, or both.
- Added `unroll_thread` action to `TwitterCrawler` delegating to `this.thread()` with `conversation` ordering, formatting output as markdown, text, or JSON.
- Supported optional `destPath` parameter to write formatted content to disk via `writeFormattedOutput()`.
- Added strict argument validation throwing `XACT_4001` for invalid formats or missing `tweetId`.
- Enforced authentication check throwing `XACT_4010` when no authenticated session is provided.
- Updated `src/scrapers/social/twitter/descriptor.js` to include action aliases and map `options.format`.
- Re-exported formatting and extraction helpers in `src/scrapers/social/twitter/index.js`.
- Added test suite `tests/scrapers/social/twitter/crawler-export-bookmarks-unroll-thread.test.js` covering all 11 scenarios in the I/O & Edge-Case matrix.


## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. -->

## Review Triage Log

<!-- Append-only. Populated by step-04 on every review pass. -->

## Design Notes

**CSV Format** (from archived bookmarkExporter):
```csv
Handle,DisplayName,Text,URL,Time,Likes,Retweets,Replies,Views
"@handle","Display Name","Tweet text...","https://...","2026-09-16",100,50,20,5000
```

**Markdown Format** (from archived threadUnroller):
```markdown
# Thread by @username

> 5 tweets | 9/16/2026

---

**1/5**

Tweet content text...

![Image](https://...)

---

**2/5**
...

[Original Thread](https://twitter.com/user/status/123)
```

**destPath behavior** (matches `download_video`):
- If `destPath` provided → write formatted output to file, return `{ posts, ..., destPath }`
- If not provided → return formatted string only

## Verification

**Commands:**
- `npm test` — expected: all tests pass
- `node --check src/scrapers/social/twitter/crawler.js` — expected: no syntax errors
- `grep -c "action: 'export_bookmarks'" src/scrapers/social/twitter/crawler.js` — expected: 1
- `grep -c "action: 'unroll_thread'" src/scrapers/social/twitter/crawler.js` — expected: 1
- `grep -c "destPath" src/scrapers/social/twitter/crawler.js` — expected: ≥3

## Implementation Notes

- Added `export_bookmarks` action — wraps existing `bookmarks()` method, formats output as JSON/CSV/both
- Added `unroll_thread` action — wraps existing `thread()` method, uses `conversation` array for ordered output
- Added helper functions: `formatBookmarksAsCSV()`, `formatBookmarksAsJSON()`, `formatThreadAsMarkdown()`, `formatThreadAsText()`, `formatThreadAsJSON()`, `writeFormattedOutput()`
- Both actions support `destPath` for writing output to file (matches `download_video` pattern)
- `unroll_thread` uses `conversation` array (ordered) not `posts` (unordered) — prepends `rootTweet` if not in conversation
- `export_bookmarks` inherits `checkpointResolver` from `bookmarks` action
- Both actions require auth (`requiresAuth: true`) — returns `XACT_4010` if no session
- Format validation: `export_bookmarks` accepts 'json'|'csv'|'both', `unroll_thread` accepts 'text'|'markdown'|'json'
