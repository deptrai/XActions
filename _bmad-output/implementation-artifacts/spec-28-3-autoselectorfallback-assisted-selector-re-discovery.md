---
title: 'AutoSelectorFallback — Assisted Selector Re-Discovery'
type: 'feature'
created: '2026-09-14'
status: 'done'
route: 'dispatch'
baseline_commit: '19f3ae09'
review_loop_iteration: 0
context:
  - '_bmad-output/implementation-artifacts/epic-28-context.md'
  - '_bmad-output/implementation-artifacts/spec-28-2-selectorcanary-periodic-dom-probe-drift-alert.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When `SelectorCanary` (Story 28.2) flags a DOM drift, a developer still has to open DevTools and hand-inspect the changed page to find a replacement selector. There is no automated way to map "the element that used to match `tweet_text`" onto the current live DOM.

**Approach:** `AutoSelectorFallback` (`src/core/auto-selector-fallback.js`) loads a live page snapshot via `createStealthPage` (Obscura primary, Chrome fallback — same pattern as 28.2), walks the DOM for elements whose text/attribute/child structure matches a declared `expectedShape`, ranks candidate selectors by stability heuristic (`data-testid` → `role`/`aria-*` → semantic tag+structure, rejecting hash-only classnames), and returns a ranked list with `confidenceScore` ∈ [0,1]. Exposed via `xactions tools suggest-selector --platform <p> --url <u> --field <f>`.

## Boundaries & Constraints

**Always:**
- Reuse `launchStealthBrowser({ backend:'obscura', fallbackBackend:'chrome' })` + `createStealthPage` + `closeStealthBrowser` from `src/scraping/stealthBrowser.js` — no direct Puppeteer launch.
- Browser lifecycle: one `createStealthPage` per `investigate()` call; in `finally` wrap `await page.close()` in its own try/catch so a page-close throw cannot prevent `await closeStealthBrowser(browser)` — no leaked processes/tabs.
- Public unauthenticated targets only (`requiresAuth:false`) so the Obscura guard never trips.
- `expectedShape` is a plain object: `{ text?: string|{ source:string, flags?:string }, attributes?: Record<string,string|{ source:string, flags?:string }>, childSelectors?: string[], tagName?: string, minChildren?: number }` — `tagName` comparison is case-insensitive (`el.tagName.toLowerCase() === shape.tagName.toLowerCase()`) — a candidate element must satisfy ALL provided predicates. RegExp predicates are passed as `{source,flags}` plain objects (serialized before `page.evaluate`, reconstructed inside).
- Selector generation heuristic, in strict priority order:
  1. `data-testid="…"` exact attribute — values escaped via `CSS.escape()` or equivalent before embedding in selector strings
  2. `role="…"` or `aria-label="…"`/`aria-*` attribute
  2b. `id="…"` attribute (stable non-hash ids only)
  3. Semantic tag + stable structural hint (e.g. `article > div:nth-of-type(2)`, `main [role="main"] h1`) — guard `element.parentElement === null` before ancestor/nth-of-type traversal
  - REJECT any selector whose only discriminating token is an obfuscated/hash-only class (regex `/^(?:css-|_?[a-z0-9]*[0-9][a-z0-9]{4,}(?:_[a-z0-9]+)*$)/i` on each class segment (requires ≥1 digit — semantic classes like `sidebar`/`wrapper` are NOT rejected), or class length ≥ 8 with no vowels/`[a-z]{3,}` word boundary).
- `confidenceScore` ∈ [0,1]: `data-testid` hit = 0.95 base, `role`/`aria-*` = 0.80, semantic = 0.60; −0.05 per extra predicate matched loosely (RegExp or non-exact substring match, as opposed to exact equality), +0.03 when `childSelectors` corroborate (childSelectors is a mandatory filter AND a corroboration boost — element must have the children AND it lifts score). Clamp [0,1], sort desc.
- Return type `SelectorCandidate[]` = `{ selector: string, confidenceScore: number, strategy: 'data-testid'|'aria'|'semantic'|'id', matchedOn: string, snippet: string }` (`matchedOn` = the attribute name or predicate key that produced this candidate, e.g. `'data-testid'`/`'role'`/`'tagName'`; `snippet` = outerHTML truncated 200 chars).
- Cap results at 10 candidates; dedupe identical selectors.
- ESM only, `const` over `let`, emoji-prefixed `console.log`, `// by nichxbt` credit, 1–3s `page` delay after `goto` before DOM walk.

- CLI `--field <name>` resolves via built-in `FIELD_SHAPES[platform][field]` map; when the platform or field isn't in the table, treat it as a literal `data-testid` value → `{ attributes:{'data-testid': field} }`. (Decision: Option A — built-in field→shape table, no inline-JSON input, no canary-config coupling.)

**Never:**
- No new npm dependencies (no cheerio/jsdom/fuse.js — use in-page `document.querySelectorAll` via `page.evaluate`).
- No writes to `config/canary-targets.json` — this tool SUGGESTS, a human applies.
- No changes to `SelectorCanary`, `SchemaDriftGuard`, `AdaptiveRateGovernor`, or `alerting.js`.
- No authenticated probing, no DB writes, no Bull jobs.
- No `vi.mock` in tests — real injected page/browser harnesses only (precedent: `tests/scraping/stealth-browser-fingerprint.test.js`, `tests/services/selector-canary.test.js`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH | page loads; ≥1 element matches `expectedShape` | Ranked `SelectorCandidate[]`, top hit has `confidenceScore ≥ 0.6`, strategy reflects the attribute actually used | N/A |
| TESTID_PREFERRED | element has both `data-testid` and `role` | `data-testid` candidate ranks above `role` candidate | N/A |
| HASH_CLASS_REJECTED | candidate only identifiable by `class="css-1a2b3c"` style hash | No candidate emitted for that path; if hash is the ONLY discriminator element is skipped | N/A |
| NO_MATCH | `expectedShape` satisfied by zero elements | Empty array `[]`, `investigate()` returns normally | N/A |
| BROWSER_FAILS | `launchStealthBrowser` obscura+chrome both throw | `PlatformError` (`ErrorTypes.SCRAPE_FAILED` or generic) propagates; browser cleanup still runs | try/finally guaranteed |
| PAGE_GOTO_FAILS | `page.goto` throws/timeout | Same as above — error propagates after `page.close()`+`closeStealthBrowser()` | try/finally guaranteed |
| INVALID_SHAPE | `expectedShape` missing/not-an-object, OR `platform`/`pageUrl` non-string/unparseable/empty (`{}`) | `PlatformError(ErrorTypes.INVALID_ARGS)` thrown synchronously before any browser launch — also rejects empty `{}` (would match every element) | early validation |
| CLI_MISSING_ARGS | `suggest-selector` invoked without `--platform`/`--url`/`--field` | Commander `.requiredOption` rejects with usage error | Commander default |

</frozen-after-approval>


## Code Map

- `src/core/auto-selector-fallback.js` **(new)** — `AutoSelectorFallback` class + `globalAutoSelectorFallback`. `investigate(platform, pageUrl, expectedShape, opts?)` → `SelectorCandidate[]`. Accepts `{ browserFactory, createPage, closeBrowser, delayMs }` DI harnesses (precedent: `SelectorCanary`). Exports `FIELD_SHAPES` map + `suggestSelectors(platform, pageUrl, shapeOrFieldName, opts)` convenience wrapper — resolves a string `shapeOrFieldName` via `FIELD_SHAPES[platform]` (or literal `data-testid` fallback) then delegates to `globalAutoSelectorFallback.investigate(platform, pageUrl, shape, opts)`.
- `src/scraping/stealthBrowser.js` — **reuse** `launchStealthBrowser` (line ~57), `createStealthPage` (line ~212), `closeStealthBrowser` (line ~198). Do NOT modify.
- `src/cli/commands/schema.js` **or new** `src/cli/commands/tools.js` — register `xactions tools suggest-selector --platform <p> --url <u> --field <f> [--backend obscura|chrome] [--json]`. Wire in `src/cli/index.js` (precedent: `registerSchemaCommand`, `registerBenchmarkCommand`). Use `printCliError` from `src/cli/shared.js`.
- `src/core/index.js` — export `AutoSelectorFallback` + `globalAutoSelectorFallback` + `FIELD_SHAPES` (precedent: `SelectorCanary` export at line 50).
- `types/core.d.ts` — add `SelectorCandidate`, `SelectorStrategy`, `ExpectedShape`, `AutoSelectorFallback`, `globalAutoSelectorFallback`, `FIELD_SHAPES`, `suggestSelectors` declarations.
- `tests/core/auto-selector-fallback.test.js` **(new)** — DI-harness unit tests: happy path, testid>aria preference, aria strategy, semantic strategy, hash-class rejection, no-match, browser-launch-fail, page-goto-fail cleanup (page.close + closeStealthBrowser both called), invalid-shape throw (sync, before browserFactory), empty-shape `{}` throw, multi-predicate filter (text/tagName/minChildren/childSelectors), dedupe+cap-10, CLI registration smoke test, CLI required-option rejection, FIELD_SHAPES field resolution, suggestSelectors wrapper delegation.
- `tests/core/index.test.js` — add `AutoSelectorFallback`/`globalAutoSelectorFallback`/`FIELD_SHAPES` export assertions (precedent: lines 157–163; `FIELD_SHAPES` must be an object with `twitter`/`facebook`/`youtube`/`threads` keys).
- `docs/agents/selectors.md` — append short section documenting `suggest-selector` CLI usage (Epic 28 DoD "document the feature").

## Tasks & Acceptance

**Execution:**
- [x] `src/core/auto-selector-fallback.js` — `AutoSelectorFallback` + `globalAutoSelectorFallback` + `FIELD_SHAPES` — core engine
- [x] `src/core/index.js` — export the three symbols — public surface
- [x] `types/core.d.ts` — `SelectorCandidate`, `ExpectedShape`, `AutoSelectorFallback` typedefs — strict typecheck
- [x] `src/cli/commands/tools.js` + `tools.d.ts` — `registerToolsCommand(program)` with `suggest-selector` — CLI surface + types
- [x] `src/cli/index.js` — `registerToolsCommand(program)` — wiring
- [x] `tests/core/auto-selector-fallback.test.js` — DI-harness unit tests — coverage
- [x] `tests/core/index.test.js` — export assertions — prevent regression
- [x] `docs/agents/selectors.md` — document `xactions tools suggest-selector` — DoD docs

**Acceptance Criteria:**
- Given a live page where an element carries `data-testid="tweetText"`, when `investigate('twitter', url, { attributes:{'data-testid':'tweetText'} })` runs, then a `SelectorCandidate` with `selector='[data-testid="tweetText"]'`, `strategy='data-testid'`, `confidenceScore ≥ 0.9` is returned first.
- Given a candidate element only identifiable by `class="css-1x2y3z4"` (hash), when candidate generation runs, then that element yields NO selector candidate.
- Given `expectedShape` matches zero elements, when `investigate()` completes, then it returns `[]` without throwing.
- Given `launchStealthBrowser` throws for both backends, when `investigate()` is called, then the error propagates AND `page.close()`/`closeStealthBrowser()` are not leaked.
- Given `--field tweet_text` passed to `xactions tools suggest-selector`, when CLI parses it, then `FIELD_SHAPES['twitter']['tweet_text']` (or a `data-testid` fallback) is used as `expectedShape`.
- Given ≥ 10 distinct matching elements, when candidates are emitted, then at most 10 are returned, deduped, sorted by `confidenceScore` descending.
- Given an element with both `data-testid` and `role`, when candidates are ranked, then the `data-testid` candidate sorts above the `role` candidate (TESTID_PREFERRED).
- Given an element matching `role="main"` or `aria-label`, when candidates are emitted, then `strategy: 'aria'` with base confidence ~0.80 is produced.
- Given an element matching a semantic tag only (e.g. `h1`), when candidates are emitted, then `strategy: 'semantic'` with base confidence ~0.60 is produced.
- Given `expectedShape` is `{}`, `null`, or a non-object, when `investigate()` is called, then `PlatformError(ErrorTypes.INVALID_ARGS)` throws synchronously before `browserFactory()` is invoked.
- Given `page.goto` rejects (timeout/network), when `investigate()` is called, then `page.close()` and `closeStealthBrowser()` are both called and the navigation error propagates.
- Given `suggestSelectors(platform, url, fieldName)` is called, when `fieldName` resolves via `FIELD_SHAPES`, then it delegates to `investigate()` with the resolved shape.
- `npx vitest run tests/core/auto-selector-fallback.test.js` → all pass; `npm run typecheck` → 0 NEW errors beyond baseline.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Evidence / Resolution |
|---|---------|---------|----------------------|
| 1 | `suggestSelectors` signature underspecified (missing platform) | medium | Fixed: `(platform, pageUrl, shapeOrFieldName, opts)`. |
| 2 | "matched loosely" undefined | medium | Fixed: RegExp/non-exact vs exact equality. |
| 3 | `tools.d.ts` missing from tasks | low | Fixed: added. |
| 4 | RegExp in expectedShape can't survive `page.evaluate` serialization | high | Fixed: RegExp → `{source,flags}` plain object contract. |
| 5 | Hash regex rejects semantic classnames (no digit required) | high | Fixed: regex requires ≥1 digit. |
| 6 | `id` attribute not in strategy enum | medium | Fixed: added `'id'` as tier 2b. |
| 7 | `page.close()` throw blocks `closeStealthBrowser` | high | Fixed: page.close wrapped in own try/catch inside finally. |
| 8 | Unknown platform → `FIELD_SHAPES[platform]` TypeError | medium | Fixed: optional-chaining fallback to literal testid. |
| 9 | `childSelectors` mandatory vs boost ambiguous | medium | Fixed: mandatory filter AND corroboration boost. |
| 10 | Empty `{}` expectedShape matches every element → CPU exhaustion | high | Fixed: INVALID_SHAPE guard rejects empty shape. |
| 11 | Unescaped quotes in attribute values → querySelector SyntaxError | medium | Fixed: `CSS.escape()` in selector generation. |
| 12 | `FIELD_SHAPES`/`suggestSelectors` missing from `types/core.d.ts` | medium | Fixed: added to types task. |
| 13 | `matchedOn` format undefined | low | Fixed: defined as attribute name or predicate key. |
| 14 | Non-string `platform`/`pageUrl` reaches browser launch | medium | Fixed: synchronous type validation before launch. |
| 15 | `tagName` case mismatch (`h1` vs `H1`) | medium | Fixed: case-insensitive comparison. |
| 16 | `element.parentElement === null` → TypeError on structural hint | medium | Fixed: null guard before ancestor traversal. |
| 17 | `--json` flag missing for machine-readable CLI output | low | Fixed: added `[--json]` option. |
| 18 | PAGE_GOTO_FAILS cleanup untested (verification-gap) | high | Fixed: added test case. |
| 19 | CLI required-option + field-resolution untested (verification-gap) | high | Fixed: added Commander unit tests. |
| 20 | INVALID_SHAPE missing from ACs (verification-gap) | high | Fixed: added AC. |
| 21 | aria/semantic strategies + TESTID_PREFERRED unverified (verification-gap) | high | Fixed: added ACs. |
| 22 | FIELD_SHAPES export unverified (verification-gap) | medium | Fixed: added export assertion. |
| 23 | `suggestSelectors` omitted from tasks/ACs/tests (verification-gap) | medium | Fixed: added to all three. |
| 24 | Multi-predicate expectedShape filter unverified (verification-gap) | high | Fixed: added test case + AC. |

## Design Notes

- **In-page DOM walk:** run candidate discovery inside `page.evaluate(fn, shape)` so it executes in the live V8 context — no HTML serialization round-trip, works identically on Obscura and Chrome.
- **FIELD_SHAPES (starter seed):** for each platform in `config/canary-targets.json`, map common field names to their expected selector predicates:
  - `twitter`: `tweet_text → { attributes:{'data-testid':'tweetText'} }`, `user_name → { attributes:{'data-testid':'UserName'} }`, `like_button → { attributes:{'data-testid':'like'} }`
  - `facebook`: `profile_name → { tagName:'h1' }`, `main → { attributes:{role:'main'} }`
  - `youtube`: `channel_name → { tagName:'ytd-channel-name' }`, `channel_header → { attributes:{id:'channel-header'} }`
  - `threads`: `main → { attributes:{role:'main'} }`, `header → { tagName:'header' }`
  - Fallback: when `field` isn't in `FIELD_SHAPES[platform]`, treat it as a literal `data-testid` value → `{ attributes:{'data-testid': field} }`.
- **Confidence scoring:** base score per strategy tier, small adjustments for corroborating predicates; keeps the ranking human-readable, not a black-box score.
- **Why no HTML serialization:** `page.content()` → parse loses live `data-testid` context and breaks the no-dependency constraint. `page.evaluate` keeps it dependency-free and accurate.

## Verification

**Commands:**
- `npx vitest run tests/core/auto-selector-fallback.test.js` — expected: all pass
- `npx vitest run tests/core/index.test.js` — expected: export assertions pass
- `npm run typecheck` — expected: 0 NEW errors beyond baseline (57 pre-existing in `signer-bridge.js`)
- `xactions tools suggest-selector --platform twitter --url https://x.com/nasa --field tweet_text` — expected: prints ranked `SelectorCandidate[]` (live run; requires reachable x.com)

**Manual checks:**
- `xactions tools suggest-selector --help` shows `suggest-selector` with required `--platform`/`--url`/`--field`.
- Live run on `https://x.com/nasa` returns ≥1 candidate for `tweet_text` with `data-testid` strategy.
