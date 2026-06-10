# Story 5.1: Facebook GraphQL/HTTP layer

Status: ready-for-dev

<!-- Port from SST_TOOL_FB (C# WinForms) → XActions. Plan: facebook-messenger-port-plan.md (Epic 5, Story 5.1). -->

## Story

As a developer building Facebook GraphQL features in XActions,
I want a GraphQL/HTTP helper layer (token scraper + page-list + Messenger CTA check) in `src/scrapers/facebook/graphql.js`,
so that the Messenger share campaign (Story 5.2) has the tokens, page list, and CTA-eligibility checks it depends on.

This story consolidates 3 HTTP/parse-only port features (browser-free, low risk):
- **(a) Token scraper** — fb_dtsg, lsd, jazoest, hsi, __spin_r, __spin_t (C# Main.cs:217-249)
- **(b) Page list** — ad account → `facebook_pages` via Graph API (C# getPage.cs:GetPagesFromCookie)
- **(c) Messenger CTA check** — GraphQL doc_id eligibility (C# Main.cs:558-581)

## Context — what (a) token scraper ports

C# `Main.cs:Post()` 217–249 scrapes tokens from `facebook.com` HTML via raw `.Split()`:
- `fb_dtsg` = `"NAf" + html.split('{"token":"NAf')[1].split('"')[0]`
- `lsd` = `html.split('["LSD",[],{"token":"')[1].split('"')[0]`
- `jazoest` = `html.split('&jazoest=')[1].split('"')[0]`
- `hsi` = `html.split('"hsi":"')[1].split('"')[0]`
- `__spin_t` = `html.split('"__spin_t":')[1].split(',')[0]`
- `__spin_r` = `html.split('"__spin_r":')[1].split(',')[0]`

Tokens are sent as `fb_dtsg`/`lsd`/`x-fb-lsd` in GraphQL bodies/headers (Main.cs:576).

## Acceptance Criteria

**AC1 — Pure token parser (browser-free, the core)**
1. `parseFacebookTokens(html)` is exported from a NEW file `src/scrapers/facebook/graphql.js`. Pure function: takes the raw HTML string, returns `{ fb_dtsg, lsd, jazoest, hsi, spin_r, spin_t }`.
2. Use ANCHORED REGEX, not raw `.split()` (the C# split chain is fragile — lesson from Story 1.2/1.3 reviews). Each token regex anchored to its surrounding JSON key.
3. `fb_dtsg` keeps the `NAf` prefix (matches C# behavior + what Facebook expects in the body).
4. Any token not found → that field is `null` (not undefined, not a throw). Caller decides if a missing token is fatal.

**AC2 — Fetcher (live, thin wrapper)**
5. `getFacebookTokens(cookie, options)` fetches `https://www.facebook.com/` with the cookie, then returns `parseFacebookTokens(html)`. HTTP via the already-present `axios` (or Node global `fetch`) — do NOT add a new HTTP dependency.
6. Cookie accepted as a **full cookie string** (`"c_user=12345; xs=abc; datr=...; ..."`). Also export a utility `buildCookieString({ c_user, xs })` that converts the adapter's object convention into the string form — so callers (and Story 5.2) don't need manual conversion. `uid` is parsed from `c_user` field (it IS the numeric UID).
7. Includes realistic browser headers (User-Agent, sec-ch-ua, viewport-width) mirroring C# xNet headers. Copy pattern from `src/scrapers/twitter/http/client.js`.
8. `fetchImpl` signature: `(url: string, init: { method?, headers?, body? }) => Promise<{ status: number, text(): Promise<string> }>` — fetch-API-compatible shape. Default wraps `axios`; tests pass a stub returning fixture HTML.

**AC3 — Security + robustness (NFR3)**
8. Cookie value NEVER logged or echoed in errors/return (NFR3 — same as loginWithCookie).
9. If the fetch fails or returns a logged-out page (no tokens parseable), return the token object with `null` fields + do not throw on a normal logged-out response; throw only on network/HTTP error with a generic message.

**AC4 — Token tests (browser-free)**
10. Unit tests for `parseFacebookTokens` using a representative HTML FIXTURE containing the token markers: assert all 6 fields extracted; assert `fb_dtsg` has `NAf` prefix; assert missing-token → `null`; assert no cookie value appears in any output.
11. No real network call in tests — `getFacebookTokens` HTTP is mocked/injected (accept an `options.fetchImpl` seam defaulting to the real fetcher, so tests pass a stub returning fixture HTML).

**AC5 — Page list (b)**
12. `getPagesFromCookie(cookie, options)` exported. `uid` is extracted from the `c_user` value in the cookie string (same numeric UID). Flow (3 sequential requests, each may fail independently):
    - Step 1: GET `adsmanager.facebook.com/adsmanager/manage/all` → scrape `act=` param for ad-account ID. If 403/redirect → fallback Step 1b.
    - Step 1b: GET `business.facebook.com/billing_hub/payment_activity` → scrape ad-account ID from there.
    - Step 2: GET billing page for that account → extract `EAAG...` token from HTML.
    - Step 3: GET `graph.facebook.com/${GRAPH_API_VERSION}/${uid}?fields=facebook_pages.limit(2000){access_token,additional_profile_id,name}&access_token=${eaagToken}`.
    - `GRAPH_API_VERSION` = named constant (default `'v19.0'`), overridable via `options.graphVersion` (Facebook depreciates versions ~2 years).
13. Returns normalized array `[{ pageId, name, accessToken }]`; empty array (not throw) on: no pages, not eligible, adsmanager 403, billing redirect, EAAG not found, Graph API error response. Log generic warning (no secrets) on unexpected response shape.
14. Page `accessToken` values treated as sensitive — not logged. `fetchImpl` seam reused for tests (multi-step fixture: stub returns different HTML per URL).

**AC6 — Messenger CTA check (c)**
15. `checkMessengerCTA(pageId, actorId, tokens, options)` exported. POST body is **URL-encoded form** (not JSON), matching C# Main.cs:558-581:
    ```
    fb_dtsg={tokens.fb_dtsg}&lsd={tokens.lsd}&jazoest={tokens.jazoest}
    &doc_id={MESSENGER_CTA_DOC_ID}
    &variables={"page_id":"{pageId}","actor_id":"{actorId}"}
    &fb_api_caller_class=RelayModern&fb_api_req_friendly_name=MWChatBusinessCTAAdsSenderMutation
    ```
    Returns `{ eligible: boolean }` based on presence of `messenger_business_ads_sender` in response.
16. `MESSENGER_CTA_DOC_ID = '29460155383630960'` — named constant with comment: `// ⚠️ Facebook may rotate this doc_id without notice. If response shape is unexpected, this is the first suspect.`
    On unexpected shape → `{ eligible: false }` + `console.warn('⚠️ Messenger CTA doc_id may be rotated — response shape unexpected for page ${pageId}')` (no token/cookie values in message).
17. `fetchImpl` seam reused; test with eligible + non-eligible + malformed fixture responses.

## Tasks / Subtasks

- [ ] **Task 1: Pure parser** (AC1)
  - [ ] Create `src/scrapers/facebook/graphql.js`
  - [ ] `export function parseFacebookTokens(html)` — 6 anchored regexes, return object, `null` for misses
  - [ ] fb_dtsg regex captures the `NAf...` token; keep prefix
- [ ] **Task 2: Fetcher with seam** (AC2, AC3)
  - [ ] `export async function getFacebookTokens(cookie, options = {})` — `const { fetchImpl = defaultFetch } = options`
  - [ ] Build `Cookie` header from cookie string; set User-Agent + sec-ch-ua headers (copy from C# / existing adapter UA)
  - [ ] Fetch facebook.com, pass body to `parseFacebookTokens`; never log cookie
  - [ ] Logged-out page → null-field object (no throw); network error → throw generic message
- [ ] **Task 3: Token tests** (AC4)
  - [ ] `tests/scrapers/facebook-graphql.test.js`: parser fixture tests + getFacebookTokens with `fetchImpl` stub returning fixture
  - [ ] Run `npx vitest run tests/scrapers/facebook-graphql.test.js`
- [ ] **Task 4: Page list (b)** (AC5)
  - [ ] `export async function getPagesFromCookie(cookie, options = {})` — same `fetchImpl` seam
  - [ ] Scrape ad-account id (adsmanager → billing fallback), extract EAAG token, GET graph.facebook.com facebook_pages
  - [ ] Normalize to `[{ pageId, name, accessToken }]`; empty array when none; never log accessToken/cookie
  - [ ] Tests: fixture JSON via `fetchImpl` stub
- [ ] **Task 5: Messenger CTA check (c)** (AC6)
  - [ ] `export async function checkMessengerCTA(pageId, actorId, tokens, options = {})` — `fetchImpl` seam
  - [ ] `const MESSENGER_CTA_DOC_ID = '29460155383630960'` with rotation-warning comment
  - [ ] POST graphql, return `{ eligible }`; unexpected shape → `{ eligible: false }` + console.warn (no secrets)
  - [ ] Tests: eligible + non-eligible fixture responses

## Dev Notes

### REUSE-FIRST (port mandate)

- This is a NEW capability (XActions had no internal-GraphQL token layer) — but it must NOT duplicate HTTP infra. Use `axios` (already in package.json) or Node 18+ global `fetch`. No new dep.
- Cookie string shape: the adapter elsewhere uses `{ c_user, xs }` for Playwright `setCookie`. Here the input is the FULL cookie string (many pairs) because token scraping needs the whole session. Accept a string; document it.
- Pattern to mirror: `src/scrapers/twitter/http/` already does cookie-string → header HTTP scraping in XActions — look at `client.js`/`auth.js` there for the header/cookie pattern before inventing one.

### Lessons applied (from Facebook Extension reviews)

- **Anchored regex over `.split()`** (1.2/1.3): the C# split chain breaks if any marker shifts. Use `/"__spin_t":(\d+)/` style anchored patterns with a capture group.
- **null-not-throw for missing data** (1.4 fallback pattern): a logged-out page legitimately has no tokens → return nulls, let caller decide.
- **Injectable seam for tests** (delay seam / likeFn lesson): `options.fetchImpl` so tests are browser-free and network-free.
- **NFR3**: never log/echo cookie — verified by a test asserting the secret isn't in output.

### Regex hints (port of the C# markers)

```
fb_dtsg : /\{"token":"(NAf[^"]+)"/        → group1 (already includes NAf)
lsd     : /\["LSD",\[\],\{"token":"([^"]+)"/
jazoest : /&jazoest=(\d+)/   (or "jazoest":"([^"]+)")
hsi     : /"hsi":"([^"]+)"/
spin_t  : /"__spin_t":(\d+)/
spin_r  : /"__spin_r":(\d+)/
```
Verify against a real fixture; Facebook markup shifts, so keep them anchored and tolerant.

### Project Structure Notes

- NEW: `src/scrapers/facebook/graphql.js` (parser + fetcher + page-list + CTA check + `buildCookieString` utility).
- NEW: `tests/scrapers/facebook-graphql.test.js` + `tests/scrapers/fixtures/` (HTML + JSON fixtures).
- No change to dispatcher/login/automation this story — pure additive helper. Story 5.2 (Messenger share) will consume `getFacebookTokens` + `getPagesFromCookie` + `checkMessengerCTA`.
- Do NOT wire into `scrape()` dispatcher in this story — no user-facing action yet (per port-plan, surfaces land in Story 5.4).

### Critical context

- Node.js, ESM. Browser-free tests (fixture + fetchImpl stub).
- Tokens are session-scoped secrets adjacent to cookies — treat the whole return as sensitive; do not persist.
- Facebook HTML shape differs logged-in vs logged-out — fixture should represent logged-in; add a logged-out fixture for the null case.

### How to create test fixtures (#2 review finding)

Dev MUST create fixtures in `tests/scrapers/fixtures/`:
- `facebook-home-loggedin.html` — curl `https://www.facebook.com/` with a real session cookie, save the HTML. Extract only the relevant 50-100 lines containing the token markers (fb_dtsg, LSD, jazoest, hsi, __spin_t, __spin_r). Do NOT commit the full page (too large + contains PII).
- `facebook-home-loggedout.html` — curl without cookie; should lack all 6 markers.
- `facebook-pages-response.json` — a synthetic Graph API response with 2-3 pages.
- `facebook-cta-eligible.json` / `facebook-cta-ineligible.json` — synthetic graphql responses.

If no real session available: write synthetic HTML containing the marker patterns from the Regex hints section. Clearly comment it as synthetic.

### Integration between (a), (b), (c) (#12 review finding)

The 3 functions share a data flow. Verify shapes match:
- `getFacebookTokens(cookie)` → returns `{ fb_dtsg, lsd, jazoest, hsi, spin_r, spin_t }` — this exact object is the `tokens` param for `checkMessengerCTA`.
- `getPagesFromCookie(cookie)` → returns `[{ pageId, name, accessToken }]` — `pageId` is the `pageId` param for `checkMessengerCTA`; `uid` (from `c_user` in cookie) is the `actorId` param.
- Add ONE integration test that chains: `getFacebookTokens` → take `.fb_dtsg`/`.lsd` → `checkMessengerCTA(pageId, uid, tokens)` — verify the shapes wire together without runtime TypeError. Browser-free (all via fetchImpl stubs).

### Testing standards

- Vitest 4.x, `npx vitest run tests/scrapers/facebook-graphql.test.js`. `parseFacebookTokens` pure & exported. `getFacebookTokens` tested via injected `fetchImpl`. No real network.

### References

- [Source: _bmad-output/planning-artifacts/facebook-messenger-port-plan.md#Epic 5, Story 5.1]
- [Source: SST_TOOL_FB/Main.cs:217-249 — token scrape markers (C# split chain)]
- [Source: SST_TOOL_FB/Main.cs:576 — x-fb-lsd header usage downstream]
- [Source: src/scrapers/twitter/http/client.js, auth.js — existing cookie-string HTTP pattern to mirror]
- [Source: src/scrapers/facebook/index.js#loginWithCookie — NFR3 cookie-handling precedent]

## Dev Agent Record

### Agent Model Used

(to be filled by dev agent)

### Debug Log References

### Completion Notes List

### File List
