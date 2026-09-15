---
title: 'Story 14.4: Real-Time N-Gram Keyword & Hashtag Frequency Analytics Engine'
type: 'feature'
created: '2026-09-15'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: 'e24ebd4df5d3f15c2510e8d8d7fd335e80f51797'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Crawlers extract `PostItem[]`/`CommentItem[]` but there is no built-in text analytics to surface trending keywords and hashtags. Callers must implement their own tokenization or wait for downstream NLP pipelines.

**Approach:** Build `src/analytics/word-frequency.js` — a pure, dependency-free N-gram frequency analyzer with Vietnamese compound-word support via bigram-of-syllables fallback, Unicode-aware hashtag extraction, and surfaces via MCP tool `x_analytics_buzzwords`, CLI `xactions analytics buzzwords`, and opt-in `includeBuzzwords` on `AbstractCrawler` that injects `summary.buzzwords` into crawl results.

## Boundaries & Constraints

**Always:**
- Zero external NLP dependencies — pure JavaScript.
- Vietnamese: NFC-normalize + lowercase tokens; bigram-of-syllables fallback for compound words.
- Bigrams never span stopwords, punctuation, or item boundaries.
- Hashtag regex: `#(?=[\p{L}])[\p{L}\p{N}_]+` — Unicode-aware, excludes `#123` and URL fragments.
- Deterministic sort: `count` desc, then `term` asc.
- `includeBuzzwords` opt-in (default off) in `AbstractCrawler` deps; when on, `summary.buzzwords` = `extractKeywordFrequency` on first 500 items; empty result object when no text.
- Clamps: `minLength >= 1`; `topN = max(0, floor(topN ?? 10))`; invalid/empty input returns `{ unigrams: [], bigrams: [], hashtags: [], totalTokens: 0, lang }` without throwing.
- Stopwords from `src/analytics/stopwords/vi.txt` and `en.txt` into `Set`; unsupported langs skip filtering.
- MCP tool accepts `{ items? | filePath? }`; CLI accepts `--file <path>` or stdin. No `scrapeId` — Post/Comment models lack a `scrapeId`/`runId` field.
- No mocks in tests.

**Never:**
- No external NLP library, no new `package.json` deps.
- No `AbstractCrawler` constructor signature change — `includeBuzzwords` in existing `deps`.
- No changes to `sentiment.js` tokenizer, `envelope.js`, or Redis/streaming code.
- No Prisma schema changes.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected Output |
|----------|-------|-----------------|
| English posts | `[{content:"Hello world #tech"},{content:"Hello again #tech"}]` | `unigrams` has `{term:"hello",count:2}`; `hashtags` has `{tag:"tech",count:2}` |
| Vietnamese | `[{content:"thị trường chứng khoán tăng"}]` | `bigrams` has `{term:"thị trường",count:1}` |
| EN stopwords | `[{content:"the quick brown fox"}]`, `lang:"en"` | `"the"` removed; bigrams are `"quick brown"`,`"brown fox"` |
| VI stopwords | `[{content:"của tôi là đây"}]`, `lang:"vi"` | `"của"`,`"tôi"`,`"là"` removed |
| Hashtag edges | `"Check #CàPhê and #123 and https://ex.com#frag"` | Only `"càphê"` extracted |
| Empty/null items | `[]` or `null` | Zero-result object, no throw |
| Missing content | `[{id:"x"},{content:42},{content:"ok"}]` | Only `"ok"` processed |
| minLength clamp | `minLength: 0` or `-5` | Clamped to `>= 1` |
| topN clamp | `topN: null` or `-3` | `topN = 0` → empty arrays |
| Buzzwords off | `{ includeBuzzwords: false }` | No `summary.buzzwords` |
| Buzzwords on, no text | `{ includeBuzzwords: true }`, 0 text items | `summary.buzzwords` = zero-result |
| Buzzwords on, 600 items | `{ includeBuzzwords: true }`, 500 text items | Computed on first 500 only |

</frozen-after-approval>

## Code Map

- `src/core/base-crawler.js` — Constructor `deps` ~L96-140: add `includeBuzzwords`. `execute()` ~L436: `result = await entry.handler(...)` → inject buzzwords → `return result` ~L437.
- `src/core/types.js` — `PostItem` ~L10, `CommentItem` ~L29 both have `content: string`. Add `KeywordFrequencyResult` typedef.
- `src/analytics/index.js` — Barrel file; add `export { extractKeywordFrequency }`.
- `src/mcp/server.js` — `executeTool()` ~L3088; analytics condition at ~L3111 (`x_analyze_sentiment` etc.) — add `x_analytics_buzzwords`. `executeAnalyticsTool()` ~L4859 — add case. `TOOLS` array ~L2754+ — add schema.
- `src/cli/commands/analytics.js` — `program.command()` pattern; add `buzzwords` subcommand.
- `src/scrapers/index.js` — `scrape()` ~L253 returns `crawler.start()` result. No changes needed.
- `tests/analytics/` — Vitest, `describe`/`it`, no mocks.
- `src/analytics/stopwords/` — Does not exist. Create `vi.txt`, `en.txt`.

## Tasks & Acceptance

**Execution:**
- [ ] `src/analytics/stopwords/vi.txt` — ~100-200 Vietnamese stopwords (của, và, là, có, được, một, các, trong, cho, với, không, này, đó, đã, sẽ, đang, bị, từ, đến, trên, dưới, nhưng, hoặc, nếu, vì, khi, thì, mà, để, theo, như, về, tại, bởi, cũng, rất, quá, nên, phải, chỉ, còn, đây, kia, ai, gì, nào, bao, nhiêu, sao, thế, vậy, ...)
- [ ] `src/analytics/stopwords/en.txt` — ~150-200 English stopwords
- [ ] `src/analytics/word-frequency.js` — `extractKeywordFrequency(items, { minLength, topN, lang, removeStopwords })`. NFC + lowercase → syllable tokens → filter stopwords via `Set` → unigrams + bigrams (no spanning) → hashtags via `/#(?=[\p{L}])[\p{L}\p{N}_]+/gu` on raw text → deterministic sort → clamp params → edge cases.
- [ ] `src/analytics/index.js` — Add export.
- [ ] `src/core/types.js` — Add `KeywordFrequencyResult` typedef.
- [ ] `src/core/base-crawler.js` — `deps.includeBuzzwords` → `this.includeBuzzwords` (default `false`). In `execute()` between ~L436-437: if `this.includeBuzzwords`, extract items from `result.posts||result.comments||result.items||[]`, lazy-import `extractKeywordFrequency`, set `result.summary = {...result.summary, buzzwords: extractKeywordFrequency(items.slice(0,500))}`.
- [ ] `src/mcp/server.js` — (a) Add `x_analytics_buzzwords` to analytics condition ~L3111. (b) Add case in `executeAnalyticsTool()` ~L4859: `{ items?, filePath?, minLength?, topN?, lang?, removeStopwords? }` → return `KeywordFrequencyResult`. `filePath` reads JSON array via `fs.readFile`. (c) Register tool schema in TOOLS array.
- [ ] `src/cli/commands/analytics.js` — `buzzwords` subcommand: `[--file <path>] [--min-length <n>] [--top-n <n>] [--lang <lang>] [--no-stopwords]`. Reads JSON array from file/stdin, calls `extractKeywordFrequency`, prints table.
- [ ] `tests/analytics/word-frequency.test.js` — Cover: vi+en stopword removal, bigram boundary rules, hashtag case-fold + URL exclusion, empty/invalid → zero-result, deterministic sort, clamping, Vietnamese compound recovery, `includeBuzzwords` integration.

**Acceptance Criteria:**
- Given `PostItem[]`/`CommentItem[]`, when `extractKeywordFrequency(items, {lang:'vi'})` is called, then returns `{unigrams,bigrams,hashtags,totalTokens,lang}` with vi stopwords removed and compound words as bigrams.
- Given `includeBuzzwords:true`, when crawl returns `{posts:[...]}`, then `result.summary.buzzwords` has frequency analysis of first 500 items.
- Given `includeBuzzwords:false` (default), then `result.summary` has no `buzzwords` key.
- Given MCP `x_analytics_buzzwords` with `{items:[...]}`, returns `KeywordFrequencyResult`.
- Given `xactions analytics buzzwords --file posts.json`, prints top keywords/hashtags.
- Given hashtags `#CàPhê`,`#Tech_VN`,`#123`,`https://ex.com#frag`, only `càphê` and `tech_vn` appear (lowercased, NFC).
- Given `npm test -- tests/analytics/word-frequency.test.js`, all pass, no mocks.
- Given `npm run typecheck`, `tsc --noEmit` exits 0.

## Implementation Notes

## Design Notes

### Vietnamese Tokenization

Whitespace-split on NFC-normalized lowercase text → syllable stream. Bigrams-of-syllables recover compounds (`thị`+`trường`→`thị trường`). No external segmenter — bigram fallback suffices for frequency counting. Stopwords break the bigram chain.

### `includeBuzzwords` Integration Point

`AbstractCrawler.execute()` ~L436-437:
```js
result = await entry.handler(finalArgs, session);
// Inject here:
if (this.includeBuzzwords && result && typeof result === 'object') { ... }
return result;
```

### `scrapeId` Removal

Post/Comment models lack `scrapeId`/`runId`; `Operation.result` is opaque JSON. MCP/CLI accept `items` (inline array) or `filePath` (disk read) only.

## Verification

**Commands:**
- `npm test -- tests/analytics/word-frequency.test.js` — all pass
- `npm run typecheck` — exits 0
- `node -e "import('./src/analytics/word-frequency.js').then(m=>console.log(m.extractKeywordFrequency([{content:'hello world #test'}])))"` — prints result
