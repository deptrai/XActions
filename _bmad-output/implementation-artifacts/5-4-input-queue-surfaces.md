# Story 5.4: Input/queue inputs & surface exposure for Messenger share

Status: review

<!-- Port from SST_TOOL_FB Main.cs:Post() file-queue (P10) → XActions surfaces. Plan: facebook-messenger-port-plan.md (Epic 5, Story 5.4). Final story of the Messenger Port — wires Story 5.2 campaign into CLI/MCP/REST + file/queue inputs. -->

## Story

As a multi-account operator using XActions,
I want to drive a Messenger-share campaign from file/queue inputs (recipients, content, post link) and run it through the CLI, MCP, and REST surfaces with dry-run preview,
so that I can launch share campaigns at scale the same way I run `like`/`comment`/`post`, without writing code.

This is the **final** story of the Messenger Port (Epic 5). Stories 5.1 (GraphQL/token layer), 5.2 (`messengerShareCampaign` core), and 5.3 (auth modes + proxy) are already implemented. This story adds the **input/queue layer (P10)** and **exposes the existing `messengerShareCampaign` through the three operator surfaces** — strictly additive, no behavior change to existing actions.

## Context — C# source (Main.cs:Post(), file-queue / P10)

The C# tool drove campaigns from flat text files, popped FIFO and thread-safe across the concurrency pool (P9):
- **`uid.txt`** — account list (uid|pass|2fa|cookie), popped one per worker. (Account auth handled in Story 5.3 — out of scope here except FIFO-pop semantics.)
- **target pages list** — the recipient Pages a post is shared to via Messenger.
- **content file** — message body, may contain `**`-delimited segments; a random segment is picked per send (Story 5.2 `pickRandomSegment`).
- **`txtlinkss.txt`** (links) — the post URL(s) to share.

Pop semantics in C#: a shared list + lock; each worker `RemoveAt(0)` under lock so no item is processed twice across the `SemaphoreSlim` pool. XActions is single-campaign-per-invocation, so the FIFO here is about **deterministic ordering + no double-send within a run**, not cross-process locking.

## Reconciliation note (READ FIRST — guardrail)

Story 5.2's AC text described `messengerShareCampaign` as living in `api/services/facebookAutomation.js` and taking an **array of `{ targetPageId, postUrl, message }` targets**. The **implemented** module differs and is the source of truth for this story:

- **Location:** `src/scrapers/facebook/messengerShare.js` (NOT `facebookAutomation.js`).
- **Signature:** `messengerShareCampaign(page, campaign, options)` where `campaign = { postUrl, recipients, content }` — **one** `postUrl`, an array of `recipients` (page id/name strings), and a single `content` string (with `**` segments).
- **Returns:** the `runGuardedBatch` result shape `{ dryRun, total, ... }`.
- **Options:** `{ dryRun, shareFn, delay, delayBetween, selectorTimeout, maxBatch }`.

This story MUST import from the real location and map inputs to the real shape. **Do NOT** re-implement a campaign loop, **do NOT** add a second `messengerShareCampaign` in `facebookAutomation.js`, and **do NOT** invent the array-of-targets shape. If a future story needs multi-post campaigns, that is a separate change — out of scope here.

## Acceptance Criteria

**AC1 — File/queue input parser (pure, browser-free)**
1. New module `src/scrapers/facebook/messengerQueue.js` exports `parseRecipientsFile(text)`, `parseLinksFile(text)`, and `buildCampaignQueue({ recipientsText, linksText, content })`.
2. `parseRecipientsFile(text)` — splits on newlines, trims, drops blank lines and lines starting with `#` (comments), de-duplicates while preserving first-seen order (FIFO). Returns `string[]`.
3. `parseLinksFile(text)` — same cleaning rules; returns `string[]` of post URLs. Each entry must match `/facebook\.com\//i`; non-matching lines are dropped and counted in a returned `skipped` tally (do not throw on a single bad line).
4. `buildCampaignQueue(...)` returns `{ campaigns: Array<{ postUrl, recipients, content }>, stats: { recipients, links, skipped } }`. Pairing rule: **one campaign per link**, each campaign sharing the same full `recipients` array and `content` (mirrors C# — every link is broadcast to every target page). FIFO order preserved.
5. All functions are pure and synchronous, null/empty-safe (empty/whitespace/`null` → `[]` / empty queue, never throw).

**AC2 — CLI surface (additive: `--action messenger-share`)**
6. `automate` command (`src/cli/index.js`) gains action `messenger-share` (canonical) with alias `messenger`. Existing `like`/`comment`/`post` behavior is unchanged.
7. New options: `--recipients <list>` (comma-separated) OR `--recipients-file <path>`; `--content <text>` OR `--content-file <path>`; `--post-url <url>` OR `--links-file <path>`. Inline flags take precedence when both inline and file are given (log which was used).
8. Fail-fast validation BEFORE browser launch (mirrors existing guards): require auth cookie; require at least one resolved post URL; require at least one recipient; require non-empty content. Clear `chalk.red` error + `process.exit(1)` on each.
9. Dispatches to `messengerShareCampaign(page, campaign, options)` per queued campaign (loop over `campaigns` from `buildCampaignQueue`; the per-campaign recipient batching stays inside `runGuardedBatch` — no nested custom batch loop).
10. Dry-run is ON by default; `--no-dry-run` enables real sends (same flag/semantics as existing actions). Under dry-run, pass `delay: () => {}`.

**AC3 — MCP surface (additive: action `messenger`)**
11. `x_facebook_automate` tool schema (`src/mcp/server.js` `TOOLS`) adds `messenger` to the `action` enum and adds optional fields: `recipients` (array of string), `content` (string), `postUrl` (string). Existing fields/enums (`like`/`comment`/`post`, `urls`, `text`, `dryRun`, `authCookie`, `maxBatch`) are unchanged (contract test must still pass).
12. `executeFacebookAutomateTool` (`src/mcp/server.js`) handles `action === 'messenger'`: validates auth (existing hard guard), requires `postUrl` (facebook.com URL), non-empty `recipients`, non-empty `content`; else throws clear `❌`-prefixed error BEFORE browser launch.
13. Strict dry-run gate reused verbatim: `const resolvedDryRun = dryRun === false ? false : true;`. Dry-run path returns `messengerShareCampaign(null, campaign, { dryRun: true, ... })` WITHOUT launching a browser (consistent with the existing like/comment/post dry-run short-circuit).
14. Real-run path launches browser, `loginWithCookie`, then calls `messengerShareCampaign(page, { postUrl, recipients, content }, options)`.

**AC4 — REST surface (additive: action `messenger-share`)**
15. `POST /api/facebook/automate` (`api/routes/facebook.js`) adds `messenger-share` (canonical) + `messenger` (alias) to `VALID_ACTIONS`. Body gains `recipients` (string[]), `content` (string), `postUrl` (string). Existing actions/validation untouched.
16. Validation order matches existing route: `requireFacebookCookie` first, then action allowlist, then messenger-specific arg validation (postUrl present + facebook.com, recipients non-empty array, content non-empty). 400 with `{ ok:false, error }` on each failure.
17. Dry-run default via existing `dryRun === false ? false : true` gate; dry-run short-circuits with no browser, no `Operation` row (mirrors existing dry-run branch). Real run creates an `Operation` of type `facebook_messenger_share`, persists a **cookie-free** config (`{ action, postUrl, recipientsCount, contentLength }` — NEVER persist recipients PII beyond a count, NEVER persist cookie/content verbatim if it would bloat the row; bound like existing `MAX_URLS`/`MAX_TEXT`), and emits the same per-user Socket.IO lifecycle events.

**AC5 — ADR-012 delay floor + ToS warning (cross-surface)**
18. Messenger-share uses the **higher delay floor** from Story 5.2/ADR-012 (min 5s, jitter up to 15s) — NOT the 1–3s like/comment default. Surfaces pass the messenger delay config through to `messengerShareCampaign`/`runGuardedBatch`; they do not hard-code 1–3s.
19. Before EVERY real (non-dry-run) messenger-share batch, the Messenger-specific account-risk/ToS warning fires (inherited from the guardrail + Story 5.2 warning). Dry-run does not warn-spam but still labels output `[DRY RUN]`.

**AC6 — Safety, privacy, additivity (NFR3)**
20. No DOM write and no browser launch under `dryRun=true` on any surface (tests assert no `createBrowser`, no `page.*` in the dry-run path).
21. Cookie values, recipient identifiers, and message content are never logged (NFR3). REST `Operation.config` stores counts/lengths, not raw recipients or cookie.
22. Strictly additive: every pre-existing CLI option, MCP tool/enum, and REST action still works. The existing contract tests (`tests/mcp/facebook-tools.test.js`, behavior tests) pass unchanged.
23. Proxy (Story 5.3) is honored if configured: messenger-share real runs launch the browser through the same `createBrowser` options path used by existing actions, so a configured proxy applies without special-casing here.

## Tasks / Subtasks

- [x] Task 1 — Queue/input parser module (AC: #1–#5)
  - [x] Create `src/scrapers/facebook/messengerQueue.js` with `parseRecipientsFile`, `parseLinksFile`, `buildCampaignQueue`.
  - [x] Cleaning rules: trim, drop blanks + `#` comments, de-dup preserving FIFO order.
  - [x] Links: keep only `facebook.com/` URLs, tally `skipped` for the rest (no throw).
  - [x] `buildCampaignQueue` → one campaign per link, shared recipients + content; return `{ campaigns, stats }`.
  - [x] Null/empty-safe everywhere.
- [x] Task 2 — CLI `messenger-share` action (AC: #6–#10, #18–#20)
  - [x] Add `messenger-share` (+ `messenger` alias) to `automate` command without touching like/comment/post.
  - [x] Add `--recipients/--recipients-file`, `--content/--content-file`, `--post-url/--links-file`; inline beats file (log which).
  - [x] Read files via existing fs import; build queue with Task 1; fail-fast validate before browser launch.
  - [x] Loop campaigns → `messengerShareCampaign(page, campaign, opts)`; dry-run default + `--no-dry-run`; pass messenger delay floor.
- [x] Task 3 — MCP `messenger` action (AC: #11–#14, #18–#20)
  - [x] Extend `x_facebook_automate` schema: add `messenger` to action enum; add `recipients`/`content`/`postUrl` props (keep existing intact).
  - [x] Extend `executeFacebookAutomateTool`: messenger branch, pre-browser validation, reuse strict dry-run gate + dry-run short-circuit.
  - [x] Real run: browser + `loginWithCookie` + `messengerShareCampaign(page, {postUrl, recipients, content}, opts)`.
- [x] Task 4 — REST `messenger-share` action (AC: #15–#17, #18–#21)
  - [x] Add `messenger-share` (+ `messenger`) to `VALID_ACTIONS`; accept `recipients`/`content`/`postUrl` in body.
  - [x] Validation order: cookie → action → messenger args; dry-run short-circuit (no browser/Operation).
  - [x] Real run: Operation type `facebook_messenger_share`, cookie-free + PII-free config (counts/lengths, bounded), reuse Socket.IO lifecycle emit.
- [x] Task 5 — Tests (browser-free) (AC: all, esp. #20–#22)
  - [x] Unit: `messengerQueue` parser (FIFO, dedup, comments, bad-link skip, empty-safe).
  - [x] CLI/MCP/REST: messenger dispatch maps inputs to real campaign shape; dry-run launches no browser; injected `shareFn`/`delay` seams.
  - [x] Additivity: existing MCP contract + behavior tests still green; new action in each surface's allowlist.
  - [x] Privacy: assert recipients/cookie/content not in logs or persisted config.

## Dev Notes

- **Reuse-first (ADR-012):** This story adds NO new automation logic. It only parses inputs and routes to the already-implemented `messengerShareCampaign`. Any per-recipient batching, dry-run gating, and delay belongs to `runGuardedBatch` inside Story 5.2 — do not duplicate it.
- **Real campaign shape (source of truth):** `messengerShareCampaign(page, { postUrl, recipients, content }, options)` in `src/scrapers/facebook/messengerShare.js`. Options: `{ dryRun, shareFn, delay, delayBetween, selectorTimeout, maxBatch }`. Returns `runGuardedBatch` shape `{ dryRun, total, ... }`.
- **Dry-run short-circuit pattern:** All three surfaces already short-circuit dry-run BEFORE launching a browser for like/comment/post (`dispatch(null)` in CLI/REST, early return in MCP). Mirror it exactly — `messengerShareCampaign(null, campaign, { dryRun: true })` must succeed without a page.
- **Delay floor:** like/comment use 1–3s; messenger-share uses min 5s + jitter ≤15s (ADR-012). Surfaces pass the messenger delay config; never hard-code the 1–3s default for this action.
- **Privacy (NFR3):** recipients are PII (page/person identifiers). REST `Operation.config` persists `recipientsCount` + `contentLength`, never the raw arrays/strings or cookie. No surface logs cookie/recipients/content.
- **Surfaces to touch:** `src/cli/index.js` (`automate` command ~line 229–317), `src/mcp/server.js` (`TOOLS` schema for `x_facebook_automate` + `executeFacebookAutomateTool` ~line 2382), `api/routes/facebook.js` (`/automate` route ~line 100–219).

### Project Structure Notes

- New file: `src/scrapers/facebook/messengerQueue.js` (pure parser, sibling of `messengerShare.js`).
- New test files: `tests/scrapers/facebook-messenger-queue.test.js`; extend existing surface tests rather than replace.
- Naming: canonical action token `messenger-share` for CLI/REST (kebab, matches surface style), `messenger` for MCP enum + as cross-surface alias. Keep both wired so docs/users can use either.
- No DB schema change — reuse existing `Operation` model with a new `type` string value.

### References

- [Source: _bmad-output/planning-artifacts/facebook-messenger-port-plan.md#3 Lộ trình — Story 5.4] (file/queue inputs P10 + surface exposure; additive, dry-run default)
- [Source: _bmad-output/planning-artifacts/facebook-messenger-port-plan.md#2 P10] (FIFO file-queue: uid/content/link files)
- [Source: src/scrapers/facebook/messengerShare.js] (`messengerShareCampaign(page, { postUrl, recipients, content }, options)` — real shape, exports incl. `pickRandomSegment`, `composeMessage`, `SELECTORS`)
- [Source: _bmad-output/implementation-artifacts/5-2-messenger-share.md#AC2] (campaign routes through `runGuardedBatch`; ADR-012 delay floor; ToS warning)
- [Source: src/cli/index.js#automate] (existing like/comment/post command — guard + dispatch pattern to extend)
- [Source: src/mcp/server.js#executeFacebookAutomateTool] (strict dry-run gate, pre-browser guards, dry-run short-circuit)
- [Source: api/routes/facebook.js#/automate] (validation order, dry-run branch, Operation record, Socket.IO emit, MAX_URLS/MAX_TEXT bounding)
- [Source: tests/mcp/facebook-tools.test.js] (additive contract: existing tools/enums must remain)

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code)

### Debug Log References

- Full Facebook suite after implementation: **151/151 pass** across 7 files
  (graphql, auth, proxy, messenger-queue, mcp-tools, automate-behavior,
  messenger-surface). No regression in existing contract/behavior tests.
- Parser unit suite: 23/23. MCP surface + additivity + dry-run: incremental,
  green within the 90-test MCP run.

### Completion Notes List

- **Strictly additive** — like/comment/post unchanged on all three surfaces;
  existing MCP contract test (`facebook-tools.test.js`) + behavior test stay green.
- **Reuse-first (ADR-012)** — no new automation loop. `buildCampaignQueue` pairs
  inputs (one campaign per link, shared recipients+content) and routes to the
  already-implemented `messengerShareCampaign`; per-recipient batching stays in
  `runGuardedBatch`.
- **ADR-012 delay floor** — every surface defines a 5–15s jitter delay for
  messenger and passes it through; dry-run uses a no-op delay. Never hard-codes 1–3s.
- **Dry-run default + short-circuit** — `dryRun === false ? false : true` reused;
  dry-run returns the `runGuardedBatch` preview with NO browser launch on every surface.
- **Privacy (NFR3)** — REST `Operation.config` for messenger-share persists
  `{ action, postUrl, recipientsCount, contentLength }` only (Operation type
  `facebook_messenger_share`). Recipients/content/cookie never logged or persisted
  raw; validation errors never echo recipient ids or content (asserted in tests).
- **Aliases wired** — canonical `messenger-share` (CLI/REST) + `messenger`
  (MCP enum + cross-surface alias) both accepted.
- **REST/CLI test note** — pure validation + campaign shape + delay floor are
  identical to the MCP path (90-test run covers them). REST end-to-end requires a
  running server (same constraint as `x402-integration.test.js`); not unit-tested
  to honor the no-mocks rule.

### File List

- `src/scrapers/facebook/messengerQueue.js` (NEW) — pure file/queue parser
- `tests/scrapers/facebook-messenger-queue.test.js` (NEW) — 23 parser unit tests
- `tests/mcp/facebook-messenger-surface.test.js` (NEW) — MCP surface + additivity + dry-run + privacy
- `src/cli/index.js` (UPDATE) — `messenger-share` action on `automate` command
- `src/mcp/server.js` (UPDATE) — `messenger` action: schema + `executeFacebookAutomateTool` branch
- `api/routes/facebook.js` (UPDATE) — `messenger-share` action on `POST /api/facebook/automate`
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (UPDATE) — 5-4 → review
