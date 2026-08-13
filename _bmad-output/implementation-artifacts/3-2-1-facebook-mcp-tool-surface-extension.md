# Story 3.2.1: MCP Facebook Tool Surface Extension

---
baseline_commit: a2a9c7a
---

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Change Log

- 2026-08-13: Created story to expose `scrapeGroupMembers`, `scrapeMarketplace`, and stored `FacebookAccount` listing via new MCP tools.

## Story

As an AI agent using the XActions MCP server,
I want additional Facebook MCP tools for group-member scraping, marketplace search, and account listing,
so that I can reach all Facebook capabilities already implemented in the codebase without platform-specific workarounds.

## Acceptance Criteria

**AC1 — `x_facebook_group_members` MCP tool**
1. A new MCP tool `x_facebook_group_members` is registered in `src/mcp/server.js` `TOOLS` array.
2. Input schema: `{ groupUrl: string, limit?: number, authCookie: FACEBOOK_AUTH_COOKIE_SCHEMA }`.
3. `authCookie` accepts either `{ c_user, xs }` or `{ accountId }`, resolved via `resolveMcpFacebookAuth`.
4. Handler dispatches to `scrapeGroupMembers(page, groupUrl, { limit })` from `src/scrapers/facebook/index.js`.
5. Returns normalized member list `{ name, username?, profileUrl, platform: 'facebook' }` or `{ note }` when private/restricted.
6. Cookie values never appear in responses or logs (NFR3).

**AC2 — `x_facebook_marketplace` MCP tool**
7. A new MCP tool `x_facebook_marketplace` is registered in `src/mcp/server.js` `TOOLS` array.
8. Input schema: `{ query: string, location?: string, limit?: number, minPrice?: number, maxPrice?: number, category?: string, dryRun?: boolean, authCookie: FACEBOOK_AUTH_COOKIE_SCHEMA }`.
9. `dryRun` defaults to `true` and previews the search URL + filters without launching a browser.
10. Real run resolves `authCookie` via `resolveMcpFacebookAuth`, logs in, and calls `scrapeMarketplace(page, query, { limit, location, minPrice, maxPrice, category })`.
11. Returns normalized listings `{ id, title, price, location, image, listingUrl, platform: 'facebook', source: 'marketplace' }` with PII stripped by `normalizeMarketplaceListing`.
12. Cookie values never appear in responses or logs (NFR3).

**AC3 — `x_facebook_list_accounts` MCP tool**
13. A new MCP tool `x_facebook_list_accounts` is registered in `src/mcp/server.js` `TOOLS` array.
14. Input schema accepts `userId?: string` OR `authCookie.accountId?: string`. At least one must be provided.
15. Queries `FacebookAccount` from Prisma and returns `{ id, label, userId, createdAt }` for each account belonging to the resolved user.
16. Never returns `c_user`, `xs`, `encryptedCookie`, or any other secret.
17. Cookie/session values never appear in responses or logs.

**AC4 — Contract tests**
18. `tests/mcp/facebook-epic4-tools.test.js` is updated to include `x_facebook_group_members` and `x_facebook_marketplace` in auth-guard and dry-run test suites.
19. A new test file `tests/mcp/facebook-mcp-account-tools.test.js` (or extension) verifies `x_facebook_list_accounts` schema and DB-only behavior without a real browser.
20. `npx vitest run tests/mcp/` passes.

**AC5 — Smoke test**
21. `mcp_call_tool` with `x_facebook_marketplace` and `x_facebook_group_members` using `authCookie.accountId` returns structured data without leaking cookies.

## Tasks / Subtasks

- [ ] **Task 1: Add `x_facebook_group_members` tool** (AC: 1)
  - [ ] Add tool definition to `TOOLS` in `src/mcp/server.js`
  - [ ] Add dispatch branch in `executeFacebookEpic4Tool`
  - [ ] Import and call `scrapeGroupMembers` from `src/scrapers/facebook/index.js`
  - [ ] Reuse `resolveMcpFacebookAuth` for `accountId` support
  - [ ] Add dry-run preview path (validate URL, return `{ groupUrl, limit }` without browser)
- [ ] **Task 2: Add `x_facebook_marketplace` tool** (AC: 2)
  - [ ] Add tool definition to `TOOLS` in `src/mcp/server.js`
  - [ ] Add dispatch branch in `executeFacebookEpic4Tool`
  - [ ] Import and call `scrapeMarketplace` from `src/scrapers/facebook/index.js`
  - [ ] Build search URL preview in dry-run mode
  - [ ] Reuse `runWithFacebookBrowser` for real run
- [ ] **Task 3: Add `x_facebook_list_accounts` tool** (AC: 3)
  - [ ] Add tool definition to `TOOLS` in `src/mcp/server.js`
  - [ ] Add handler (separate from `executeFacebookEpic4Tool` because no browser needed)
  - [ ] Query `FacebookAccount` via Prisma for the resolved `userId`
  - [ ] Redact `encryptedCookie` from output
- [ ] **Task 4: Update tests** (AC: 4)
  - [ ] Update `tests/mcp/facebook-epic4-tools.test.js` TOOL_NAMES list
  - [ ] Add dry-run tests for `x_facebook_group_members` and `x_facebook_marketplace`
  - [ ] Add `x_facebook_list_accounts` tests in `tests/mcp/` (schema/DB mocks or direct Prisma query)
  - [ ] Run `npx vitest run tests/mcp/`
- [ ] **Task 5: Smoke test** (AC: 5)
  - [ ] Call `x_facebook_marketplace` via `mcp_call_tool` with `accountId`
  - [ ] Call `x_facebook_group_members` via `mcp_call_tool` with `accountId`
  - [ ] Call `x_facebook_list_accounts` via `mcp_call_tool`
- [ ] **Task 6: Commit/push**
  - [ ] `git add src/mcp/server.js tests/mcp/ _bmad-output/implementation-artifacts/3-2-1-facebook-mcp-tool-surface-extension.md`
  - [ ] Run `git commit` and `git push`

## Dev Notes

### Apply previous MCP lessons

- **Additive schema only** (Story 3.2 AC4): add new tools and enum values; do not rename or remove existing tool names, schemas, or required fields.
- **No cookie values in responses** (NFR3, FR-10): `resolveMcpFacebookAuth` returns raw `c_user`/`xs` only to the handler; the MCP response must never echo them.
- **dryRun default for mutating tools** (ADR-007, SM-2): `x_facebook_marketplace` is a search/read tool but still supports `dryRun` for consistency. `x_facebook_group_members` also supports `dryRun` for URL/preview validation. `x_facebook_list_accounts` is DB-only and does not need `dryRun`.
- **Hard auth guard** (Story 3.2 AC3): `x_facebook_group_members` and `x_facebook_marketplace` require `authCookie` containing either raw cookie or `accountId`. Mirror existing `resolveMcpFacebookAuth` error messages.

### Reuse, don't duplicate

- `resolveMcpFacebookAuth` in `src/mcp/facebook-auth.js` already supports `{ c_user, xs }` and `{ accountId }`, and loads `dotenv` for `DATABASE_URL`/`SESSION_SECRET`/`JWT_SECRET`.
- `runWithFacebookBrowser` in `src/mcp/server.js` handles browser launch, login, and cleanup for the new browser-based tools.
- `scrapeGroupMembers` and `scrapeMarketplace` in `src/scrapers/facebook/index.js` are fully implemented and return normalized data. Do NOT reimplement the scraping logic.
- `FacebookAccount` Prisma model already exists; `x_facebook_list_accounts` queries it directly.

### MCP server structure

- Tool definitions live in the `TOOLS` array in `src/mcp/server.js`.
- `executeTool(name, args)` dispatches by name to `executeFacebookAutomateTool` and `executeFacebookEpic4Tool`.
- `executeFacebookEpic4Tool(name, args)` is the natural place for `x_facebook_group_members` and `x_facebook_marketplace` because they follow the `authCookie` + `dryRun` + optional browser pattern.
- `x_facebook_list_accounts` should be handled in the main `executeTool` switch or a dedicated `executeFacebookAccountTool` because it does not launch a browser.

### Required input validation

- `x_facebook_group_members`: validate `groupUrl` is a non-empty `facebook.com/groups/` URL before browser launch (SSRF guard — `assertFacebookUrlLocal` already exists in `src/scrapers/facebook/index.js`).
- `x_facebook_marketplace`: validate `query` is non-empty; `limit` clamped to a sensible max (default 50, max 200) to avoid long runs.
- `x_facebook_list_accounts`: require either `userId` or `authCookie.accountId`. If `accountId` is provided, resolve the owning `userId` via `resolveMcpFacebookAuth` or a direct `prisma.facebookAccount.findUnique` lookup.

### Marketplace scope note

- Epic 4 PRD originally listed Marketplace as out-of-scope, but Epic 5b story `5b-1-marketplace-scraper` is done and `scrapeMarketplace` exists. Exposing it via MCP is a surface gap, not new functionality.
- If PO decides to keep Marketplace out-of-scope, this story must remove the `x_facebook_marketplace` AC and leave the scraper unused.

### Security / Privacy

- `scrapeMarketplace` already calls `normalizeMarketplaceListing` which strips phone/email via `stripPii`.
- `x_facebook_list_accounts` must not return `encryptedCookie` — even if it is decryptable server-side. Only `id`, `label`, `userId`, `createdAt` are exposed.

### Project Structure Notes

- **UPDATE:** `src/mcp/server.js` — add 3 tool definitions, update dispatch, reuse `executeFacebookEpic4Tool` and `runWithFacebookBrowser`.
- **NEW:** `tests/mcp/facebook-mcp-account-tools.test.js` (or extend existing mcp tests) for `x_facebook_list_accounts`.
- **UPDATE:** `tests/mcp/facebook-epic4-tools.test.js` for new epic4-style tools.
- **No scraper changes:** `src/scrapers/facebook/index.js` and `api/services/facebookAutomation.js` already have the needed functions.

### Testing standards

- Vitest 4.x, 30s timeout, Node environment, ESM.
- No mocks unless absolutely required for DB-free wiring tests. For `x_facebook_list_accounts`, use an in-memory/Prisma test database if available or a schema-only contract test.
- Browser-free contract tests for tool schemas and dry-run dispatch.

### References

- [Source: _bmad-output/planning-artifacts/epics-full.md#Epic 3 Extension: MCP Facebook Tool Surface]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-08-13-facebook-mcp-tools.md]
- [Source: src/mcp/server.js — TOOLS array and executeFacebookEpic4Tool]
- [Source: src/mcp/facebook-auth.js — resolveMcpFacebookAuth]
- [Source: src/scrapers/facebook/index.js — scrapeGroupMembers, scrapeMarketplace, normalizeMarketplaceListing, assertFacebookUrlLocal]
- [Source: src/scrapers/index.js — unified scrape() dispatcher with facebook actions]
- [Source: prisma/schema.prisma — FacebookAccount model]
- [Source: tests/mcp/facebook-epic4-tools.test.js — dispatch and dry-run test patterns]

## Dev Agent Record

### Agent Model Used

sonnet-4.6

### Debug Log References

- Verified `src/mcp/server.js` already supports `accountId` resolution via `resolveMcpFacebookAuth`.
- Verified `scrapeGroupMembers` and `scrapeMarketplace` are exported from `src/scrapers/facebook/index.js`.
- Verified `FacebookAccount` model in `prisma/schema.prisma`.

### Completion Notes List

_To be filled by dev agent after implementation._

### File List

- src/mcp/server.js
- tests/mcp/facebook-epic4-tools.test.js
- tests/mcp/facebook-mcp-account-tools.test.js (new)
- _bmad-output/implementation-artifacts/3-2-1-facebook-mcp-tool-surface-extension.md
