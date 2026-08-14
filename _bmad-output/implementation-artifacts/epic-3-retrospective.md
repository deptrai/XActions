# Epic 3 Retrospective: Facebook Multi-Surface & Persistence

Status: done
Date: 2026-08-14

## Summary

Epic 3 mở rộng XActions từ Twitter-only sang multi-surface Facebook: CLI platform support, MCP tool registration, REST API endpoints, và operation persistence. Đây là epic đầu tiên expose Facebook capabilities qua 3 surface (CLI/MCP/REST) và là foundation cho mọi Facebook feature sau này (Epic 4, 5, 5b, 6, 7).

Epic complete across five stories (4 original + 1 extension):

| Story | Status | Outcome |
|---|---|---|
| 3.1 CLI Platform Support | done | `xactions scrape` + `xactions automate` commands, `--auth-cookie` flag, `--platform facebook` routing |
| 3.2 MCP Facebook Tools | done | 5 scrape tool platform enums widened, `x_facebook_automate` tool, 30 contract tests |
| 3.2.1 MCP Tool Surface Extension | done | 3 new MCP tools: `x_facebook_group_members`, `x_facebook_marketplace`, `x_facebook_list_accounts` |
| 3.3 REST API | done | `POST /api/facebook/scrape` + `POST /api/facebook/automate`, JWT auth, rate limiting, dashboard UI |
| 3.4 Operation Persistence | done | Prisma `Operation` lifecycle, Socket.IO realtime updates, per-user room isolation |

Final verification: **113/113 Facebook tests pass** (at time of Epic 3 completion). Extension story 3.2.1: **140/140 MCP tests pass**.

## What Went Well

1. **Three-surface pattern established early**
   - CLI (3.1), MCP (3.2), REST (3.3) all follow same safety pattern:
     - Hard auth guard (reject missing `--auth-cookie` / `authCookie` up front)
     - Strict `dryRun === false` gate (ADR-007) — dry-run is default
     - Fail-fast validation before browser launch
     - Cookie values never logged (NFR3)
   - This pattern was reused verbatim in Epic 4, 5, 7 — zero drift.

2. **Additive-only MCP schema (AC1.2) held**
   - 3.2 widened 5 existing tool enums to include `facebook` — no tool renamed/removed.
   - 3.2.1 added 3 new tools — no existing tool schema changed.
   - 30 + 18 contract tests assert additive safety.
   - **Lesson:** Additive-only constraint forced clean separation and prevented breaking Claude Desktop / AI agent integrations.

3. **Operation persistence design (3.4) was minimal and correct**
   - Reused existing `Operation` Prisma model — no migration needed.
   - Operation created only for real writes (`resolvedDryRun === false`), not dry-runs.
   - `operationId` in response JSON (null for dry-run) — clean contract.
   - `authCookie` never in `config` field — NFR3 compliant.

4. **Code review caught critical bugs in every story**
   - 3.1: `automate` command missing hard auth guard (HIGH) — ran unauthenticated, every action failed with confusing selector errors.
   - 3.2: Unknown action launched browser + login before throwing (HIGH) — wasted account risk.
   - 3.3: `/scrape` passed key `target` but dispatcher reads `url`/`query` (HIGH) — endpoint fully broken.
   - 3.4: Orphaned Operation — `createBrowser` outside try, launch failure left Operation stuck at `running` forever (HIGH).
   - 3.4: `global.io.emit` broadcast operation events to ALL clients — cross-user info leak (HIGH).
   - **Lesson:** 3-layer adversarial review (Blind Hunter, Edge Case Hunter, Acceptance Auditor) caught bugs that manual review missed.

5. **Socket.IO per-user room isolation (3.4 patch)**
   - Original code broadcast `operationId`, `userId`, `type`, `error` to ALL connected clients.
   - Patch: `io.to(\`user:${req.user.id}\`)` — only the owning user receives updates.
   - Follow-up verified the realtime layer joins `user:${userId}` room on connect (resolved in deferred-cleanup pass 2026-06-10).

## What Was Difficult

1. **`/scrape` target key mismatch (3.3)**
   - Route passed `{ target: ... }` but dispatcher reads `{ url }` / `{ query }` per action.
   - Every scrape action threw 500 — endpoint was fully broken until review patch.
   - **Root cause:** Route author assumed dispatcher key name without reading `src/scrapers/index.js`.
   - **Lesson:** Always read the dispatcher signature before writing route handlers.

2. **Dry-run still launched browser + login (3.2, 3.3)**
   - Both MCP and REST dry-run paths launched Puppeteer + `loginWithCookie` before dispatching.
   - Account risk for zero benefit — dry-run should never touch browser.
   - Fixed in both: dry-run dispatches with `page=null`, no browser/login.
   - **Lesson:** Dry-run must short-circuit BEFORE browser launch, not after.

3. **Numeric `c_user` crashed `.trim()` (3.2, 3.3)**
   - `authCookie.c_user.trim()` threw TypeError if c_user was numeric (Prisma returns BigInt-like).
   - Opaque 500 instead of clean 400 auth error.
   - Fixed: `String(authCookie?.c_user ?? '').trim()` coercion.
   - **Lesson:** Always coerce cookie values to string before string methods.

4. **`new PrismaClient()` per route module (3.3, 3.4)**
   - Each route module creates its own PrismaClient — connection-pool fragmentation under load.
   - Project-wide convention (auth/bookmarks/creator/discovery all do this).
   - A facebook-only change would be inconsistent — needs cross-cutting refactor.
   - **Status:** Still deferred — not fixed in Epic 3 or any subsequent epic.

5. **3.2.1 marketplace real run returned `[]`**
   - Smoke test: dry-run preview URL works, but real run returns empty array.
   - Needs scraper verification (selector/location/FB result load).
   - **Status:** Resolved in Epic 7.4 real cookie test — marketplace now returns 3 listings with images.

## Key Decisions

1. **Canonical action names per surface**
   - CLI/REST: `like`, `comment`, `post` (short form)
   - MCP: `like`, `comment`, `post` (same)
   - Both accept aliases where practical.

2. **`dryRun = options.dryRun !== false` (safe default)**
   - Commander `--no-dry-run` sets `dryRun=false` explicitly.
   - `undefined`/`true` → dry-run (safe default).
   - Consistent across CLI/MCP/REST — no surface has a different default.

3. **Operation persistence only for real writes**
   - Dry-runs don't create Operation records.
   - `operationId: null` in dry-run response — clean signal for dashboard.
   - Operation lifecycle: `running` → `completed` / `failed`.

4. **Socket.IO per-user room (not broadcast)**
   - `io.to(\`user:${req.user.id}\`)` — only owning user receives updates.
   - Connection handler joins `user:${userId}` room on connect.
   - Prevents cross-user info leak (operationId, userId, type, error).

5. **3.2.1 Extension story added retroactively**
   - Original Epic 3 had 4 stories (3.1-3.4).
   - `scrapeGroupMembers`, `scrapeMarketplace`, `FacebookAccount` persistence were implemented in Epic 4/5b but not exposed via MCP.
   - 3.2.1 added as extension to close the surface gap — no new scraper logic, only MCP tool registration.
   - **Lesson:** When scrapers exist but aren't exposed, add an extension story rather than a new epic.

## Follow-up Recommendations

1. **`new PrismaClient()` per route module — still deferred**
   - Project-wide convention; needs cross-cutting refactor to shared singleton.
   - Affects auth/bookmarks/creator/discovery + facebook routes.
   - **Action:** Schedule a dedicated Prisma singleton refactor pass.

2. **Live selector verification — still blocked**
   - DOM-accuracy items from Epic 1-4 reviews (1.3 texts[0], 1.4 follower name, 2.2 Like selector, 2.4 postUrl, 4.2 share-to-Feed, 4.4 join pending, 4.8 request-age) cannot be fixed blind.
   - **Action:** Resolve when a test Facebook account is available. Track in `docs/agents/selectors-facebook.md`.

3. **`tests/mcp/server.test.js` fails under Vitest — pre-existing**
   - Uses `node:test` imports, not Vitest.
   - Not a Facebook regression; flagged for separate cleanup.
   - **Action:** Convert to Vitest or exclude from Vitest config.

4. **3.2.1 deferred items**
   - Tests hit real database without isolation.
   - No error handling for dynamic import failures.
   - `accountId` could list another user's accounts (authorization concern).
   - No automated smoke test for AC5.21.
   - **Action:** Triage in MCP cleanup pass.

5. **REST end-to-end testing is constrained**
   - `/api/facebook/automate` depends on Express auth context, Prisma, and `global.io`.
   - Project rules prohibit mocks/stubs/fakes.
   - REST coverage was kept to syntax + shared pure logic + MCP-equivalent dry-run/validation behavior.
   - **Action:** Consider a real REST integration harness (local server + test DB) in a future pass.

## Final State

- Epic 3 status: **done**
- All five stories: **done** (3.1, 3.2, 3.2.1, 3.3, 3.4)
- Retrospective: **done**
- Three-surface pattern (CLI/MCP/REST) established and reused in Epic 4, 5, 7
- Working tree: clean
