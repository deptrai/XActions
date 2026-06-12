# Epic 5 Retrospective: Facebook Messenger Port (SST_TOOL_FB → XActions)

Status: done
Date: 2026-06-12

## Summary

Epic 5 ported the Facebook Messenger-share flow from the legacy C# `SST_TOOL_FB` tool into XActions as browser-free helpers, guarded browser automation, auth/proxy support, and operator-facing CLI/MCP/REST surfaces.

The Epic is complete across four stories:

| Story | Status | Outcome |
|---|---|---|
| 5.1 GraphQL layer | done | Token scraper, page list, Messenger CTA eligibility helpers |
| 5.2 Messenger share | done | `messengerShareCampaign` core via `runGuardedBatch` |
| 5.3 Auth + proxy | done | Cookie/password/TOTP auth + proxy provider rotation |
| 5.4 Input/queue surfaces | done | File/queue parser + CLI/MCP/REST exposure |

Final verification after Story 5.4: **151/151 Facebook tests passed** across 7 suites:

- `tests/scrapers/facebook-graphql.test.js`
- `tests/scrapers/facebook-auth.test.js`
- `tests/scrapers/facebook-proxy.test.js`
- `tests/scrapers/facebook-messenger-queue.test.js`
- `tests/mcp/facebook-tools.test.js`
- `tests/mcp/facebook-automate-behavior.test.js`
- `tests/mcp/facebook-messenger-surface.test.js`

## What Went Well

1. **Reuse-first architecture held up**
   - Story 5.4 did not reimplement Messenger automation.
   - It only parses inputs and routes to the Story 5.2 `messengerShareCampaign` shape:
     `{ postUrl, recipients, content }`.
   - Per-recipient batching remains centralized in `runGuardedBatch`.

2. **Port parity improved through review**
   - Story 5.1 review found and fixed GraphQL payload/session gaps and EAAG token parsing issues.
   - The later merge from `develop` preserved security hardening:
     - cookie delimiter injection protection in `buildCookieString`
     - broader EAAG token regex supporting base64-ish characters

3. **Automation safety stayed explicit**
   - Dry-run remains default (`dryRun === false ? false : true`).
   - Dry-run short-circuits avoid browser launch wherever supported.
   - Messenger-specific ADR-012 delay floor (5–15s jitter) is preserved on CLI/MCP/REST surfaces.

4. **NFR3/privacy guardrails were applied consistently**
   - Cookies are never logged.
   - REST `Operation.config` for messenger-share stores counts/lengths, not raw recipients/content.
   - MCP validation tests assert sensitive recipients/content are not echoed in errors.

5. **Test coverage stayed browser-free where possible**
   - Queue parser is fully pure and covered by 23 unit tests.
   - MCP dry-run verifies no-browser preview behavior without mocks/stubs.
   - Existing MCP contract tests stayed additive-safe and passed.

## What Was Difficult

1. **Legacy C# shape vs. XActions runtime shape**
   - The story text initially referenced an older/incorrect `facebookAutomation.js` campaign shape.
   - Story 5.4 needed an explicit reconciliation note to avoid inventing a second campaign loop.

2. **Delay semantics are split across layers**
   - `runGuardedBatch` defaults to 1–3s delay.
   - Messenger needs a higher 5–15s floor.
   - Surfaces must consciously pass the Messenger delay seam to avoid silently falling back to the generic default.

3. **REST end-to-end testing is constrained by existing harness**
   - `/api/facebook/automate` depends on Express auth context, Prisma, and `global.io`.
   - Because project rules prohibit mocks/stubs/fakes, REST coverage was kept to syntax + shared pure logic + MCP-equivalent dry-run/validation behavior rather than synthetic route mocks.

4. **Worktree had branch-status drift**
   - `sprint-status.yaml` lagged behind implemented code for Stories 5.1–5.3.
   - A reconciliation commit was needed before closing Epic 5.

## Key Decisions

1. **Canonical action names**
   - CLI/REST canonical: `messenger-share`
   - MCP canonical: `messenger`
   - CLI/REST also accept `messenger` as an alias.

2. **Campaign queue pairing rule**
   - One campaign per link.
   - Each campaign shares the same full recipients list and content.
   - This mirrors the C# file queue behavior: every link is broadcast to every target page.

3. **Operation privacy model**
   - For `facebook_messenger_share`, persist:
     `{ action, postUrl, recipientsCount, contentLength, maxBatch }`
   - Never persist:
     - `authCookie`
     - raw `recipients`
     - raw `content`

4. **No new automation loop**
   - Story 5.4 surfaces loop over campaigns only because file/links input can create multiple campaigns.
   - Each campaign still delegates recipient batching to `messengerShareCampaign` → `runGuardedBatch`.

## Follow-up Recommendations

1. **Run one manual live-session smoke test before release**
   - Use a test Facebook account.
   - Start with dry-run on all surfaces.
   - Then run a tiny real batch (`maxBatch=1`) to validate selectors and Messenger dialog behavior.

2. **Add live selector notes after smoke test**
   - Update `docs/agents/selectors-facebook.md` with any verified Messenger dialog selector changes.

3. **Consider adding a real REST integration harness later**
   - A future test harness could run against an actual local server + test DB to avoid mocks while covering `/api/facebook/automate` end-to-end.

4. **Keep ADR-012 visible for future write actions**
   - Messenger-share is the highest-risk automation in this Epic.
   - Future mass-DM/share style features should reuse the 5–15s delay floor and privacy pattern.

## Final State

- Epic 5 status: **done**
- All four stories: **done**
- Retrospective: **done**
- Working tree expected after commit: clean
