---
baseline_commit: bacb3b1e4beb5ba8c184f45536793c2cb767b4f7
---

# Story 4.6: Scrape Facebook group members

Status: review

<!-- Epic 4 (Facebook Growth Automation, Cluster 1 — medium risk). Source: epics.md#Story 4.6 + PRD prd-XActions-2026-06-10-epic4 FR-20. READ-ONLY scrape — NOT a batch write. -->

## Story

As a growth marketer using XActions,
I want to scrape the member list of a Facebook group,
so that I can understand group composition for targeting.

## Context — what this story builds

Story 4.6 adds `scrapeGroupMembers(page, groupUrl, options)` — a **read-only scrape** function that scrolls a group's member list and extracts normalized member data. This is fundamentally different from Stories 4.4/4.5 (batch writes):

- **NOT a `runGuardedBatch` case** — FR-20 is a read, not a write; NFR-7 (runGuardedBatch mandatory) lists only FR-18/19/21/22 (writes). Do NOT route through `runGuardedBatch`.
- **NO account-risk warning** — NFR-8 lists only FR-18/19/21/22/23. Scraping members is not a social write.
- **NO delay floor** — NFR-6 applies only to write actions. Standard scrape delay 1-3s (NFR1) applies.
- **NFR-11 is the critical constraint** — phone numbers and emails MUST NEVER be collected even if visible in the DOM. This filter must be in the normalizer, not the caller.

Pattern-wise this mirrors Epic 1's `scrapeFollowers` (src/scrapers/facebook/index.js:492): navigate → bounded scroll loop (1-3s delay, stall detection) → extract + normalize per-member data → return array or `{ note }` on restriction.

## Acceptance Criteria

**AC1 — `scrapeGroupMembers` entry + return shape**
1. `scrapeGroupMembers(page, groupUrl, options = {})` exported from `src/scrapers/facebook/index.js` (the Facebook scrape adapter — NOT `api/services/facebookAutomation.js` which is for writes). Add to the dispatcher so `scrape('facebook', 'group-members', { page, groupUrl, limit })` works (or wire at a later surface story — document the choice).
2. Returns an array of `{ name: string, username?: string, profileUrl: string, platform: 'facebook' }`. `username` is optional because Facebook doesn't always expose it for group members.
3. `options.limit` bounds the collection (default e.g. 100). Once `limit` reached or content exhausted → return what was collected.

**AC2 — Group not accessible → `{ note }` (not throw)**
4. If the group does NOT expose its member list (private group, account not a member, member list disabled by admin), return an object `{ note: '<explanation>', platform: 'facebook' }` — do NOT throw an error. Mirror `scrapeFollowers`'s fallback pattern (story 1.4).
5. Detect restriction by: absence of expected member-list DOM elements after navigation + waitForSelector timeout. Do not confuse "empty group" (0 members) with "list restricted" — an empty list returns `[]`, a restricted list returns `{ note }`.

**AC3 — NFR-11: NO phone/email collection (normalizer filter)**
6. The extraction/normalization logic MUST explicitly exclude phone numbers and email addresses even if the DOM displays them. Implement as a normalizer-level filter (not a caller responsibility): any field value matching a phone/email pattern is stripped/nullified BEFORE being added to the return array.
7. Add a dedicated test asserting that DOM text containing phone/email is NOT present in the normalized output.

**AC4 — Bounded scroll + 1-3s delay (NFR1)**
8. Scroll loop: `window.scrollTo(0, document.body.scrollHeight)` + `randomDelay(1000, 3000)` (reuse from `facebookAutomation.js` or the local `sleep` + random) between scrolls. Bounded by: `limit` reached OR stall detection (N consecutive scrolls yield no new members → stop). Max stalls default 5.
9. Injectable `delay` seam so tests don't sleep real seconds (same discipline as 4.3/4.4).

**AC5 — URL validation**
10. Validate `groupUrl` before navigation: `assertFacebookUrl(groupUrl, 'scrapeGroupMembers: groupUrl')` — reuse the shared SSRF guard. Import from `api/services/facebookAutomation.js` or inline (the scraper module doesn't currently import from the automate service — check dependency direction and pick the cleanest path; if circular, duplicate the guard locally with a comment referencing the source).

**AC6 — Selectors (UNVERIFIED + documented)**
11. Member-list selectors (member name, profile link, role/badge) are UNVERIFIED — wrap in a fallback chain + PII-free throw if the member-list container is not found. Document in `docs/agents/selectors-facebook.md` under a "Groups — Members (FR-20)" section, marked UNVERIFIED + verify-checklist.

**AC7 — Tests (browser-free, no mocks/stubs/fakes)**
12. Tests in `tests/scrapers/` (mirror Epic 1's test layout, not `tests/services/`):
    - happy path: fake page with DOM fixture → returns normalized array with name/profileUrl/platform
    - limit respected: fixture has 10 members, limit=5 → returns 5
    - restricted group (member list not found) → returns `{ note, platform }`
    - NFR-11: fixture DOM includes phone/email text → normalized output does NOT contain them
    - invalid/non-facebook groupUrl → throws before navigation
    - bounded scroll: stall detection → stops (injectable delay seam, never sleeps real)
13. Vitest 4.x, `npx vitest run <file>`. Browser-free via fake page + injectable delay. No real network.

## Tasks / Subtasks

- [x] **Task 1: `scrapeGroupMembers` function** (AC1, AC4)
  - [x] Export from `src/scrapers/facebook/index.js`; navigate to group members page; bounded scroll loop with 1-3s delay + stall detection; collect up to `limit` members
  - [x] Injectable `delay` seam (default `randomDelay` or local sleep+random)
- [x] **Task 2: NFR-11 normalizer filter** (AC3)
  - [x] Strip phone/email from extracted fields (regex pattern match); apply at normalizer level (before adding to return array); dedicated test
- [x] **Task 3: Restricted-group fallback** (AC2)
  - [x] Detect restricted list (member container absent after wait) → `{ note, platform }` not throw
  - [x] Distinguish empty-group ([] array) from restricted ({ note })
- [x] **Task 4: URL validation** (AC5)
  - [x] `assertFacebookUrl` guard before navigation; resolve import direction (no circular dep)
- [x] **Task 5: Selectors doc** (AC6)
  - [x] Add "Groups — Members (FR-20)" to selectors-facebook.md, UNVERIFIED + verify-checklist
- [x] **Task 6: Tests** (AC7)
  - [x] All AC7 cases: happy path, limit, restricted, NFR-11, invalid URL, stall detection
  - [x] `npx vitest run <file>` green

## Dev Notes

### REUSE-FIRST — this is a scrape, NOT a write

- **Clone `scrapeFollowers` (Story 1.4)** as the structural template: navigate → waitForSelector (member container) → bounded scroll loop → extract → normalize → return array or `{ note }`. [Source: src/scrapers/facebook/index.js#scrapeFollowers:492-580]
- **DO NOT use `runGuardedBatch`** — FR-20 is explicitly a read (NFR-7/8 lists are writes only). No account-risk warning needed. No delay floor. Standard 1-3s scrape delay via `randomDelay` or local sleep. [Source: prd §7 NFR-6/7/8 — FR-20 absent from all three]
- **Reuse `assertFacebookUrl`** for groupUrl validation (SSRF guard). Imported from `api/services/facebookAutomation.js` OR duplicated locally if importing creates a circular dependency (scraper → automate → scraper). If duplicating, add `// synced from api/services/facebookAutomation.js#assertFacebookUrl` comment. [Source: api/services/facebookAutomation.js#assertFacebookUrl]
- **Reuse the scroll pattern** from `scrapeFollowers`/`scrapeTweets`: `window.scrollTo(0, document.body.scrollHeight)` + sleep 1-3s + stall detection (height unchanged N times → break). [Source: src/scrapers/facebook/index.js:566, 660, 775]
- **Reuse the normalized output shape** from `scrapeFollowers`: `{ name, username?, profileUrl, platform: 'facebook' }`. [Source: src/scrapers/facebook/index.js:553]
- **NFR-11 filter is in the normalizer** — not a caller option. Pattern: after extracting raw text from DOM, apply a regex strip/nullify before pushing to the result array. This is a defense-in-depth rule (epics + PRD §7 NFR-10): "Bộ lọc extract loại trừ tường minh ở tầng normalizer, không phụ thuộc vào filter ở caller."

### Lessons applied (Epic 1 + Epic 4 stories)

- **`{ note }` not throw for restricted data** (Story 1.4) — scrapeFollowers returns `{ note }` when Facebook doesn't expose the list. Same posture here.
- **Injectable `delay` seam** (4.3/4.4) — scroll loop must be testable without real sleep.
- **UNVERIFIED selectors = live-verify item** (4.2/4.4) — the member-list selectors need a live session. Track in selectors doc. Story can reach review with unit tests green via fixture; live-DOM correctness is a separate verify pass.
- **Validate URL before browser** (4.2/4.3/4.4) — SSRF guard up front.
- **Don't confuse empty with restricted** (1.4 lesson) — a group with 0 members is valid (return `[]`); a group where the member list is hidden/unavailable is a different signal (`{ note }`). The detection heuristic matters.

### Project Structure Notes

- MODIFY: `src/scrapers/facebook/index.js` (add `scrapeGroupMembers` export), `docs/agents/selectors-facebook.md` (Members section).
- NEW: test file under `tests/scrapers/` (mirror Epic 1 test layout: `tests/scrapers/facebook-group-members.test.js` or similar).
- The function lives in the **scraper module** (read-only data), NOT in `api/services/facebookAutomation.js` (write actions). This is architecturally important: ADR-006 says "Facebook scrape đi qua adapter pattern", ADR-007 says "Facebook automate tách khỏi scrape". [Source: epics.md Additional Requirements; architecture.md ADR-006/007]
- No Prisma model, no Operation record (pure scrape — ephemeral result). No CLI/MCP/REST wiring this story.
- Consider wiring into the dispatcher (`scrape('facebook', 'group-members', opts)`) if straightforward; if not, document that wiring is deferred.

### Critical context

- Node.js, ESM. `// by nichxbt`; emoji log prefixes.
- Tests: Vitest 4.x, Node env, **no mocks/stubs/fakes** — fake page (DOM fixture) + injectable delay seam. The NFR-11 test is P0 (phone/email never leak).
- `tests/x402-integration.test.js` ECONNREFUSED failures are pre-existing/unrelated.
- This is the ONLY Epic 4 story that is a pure read — every other story (4.1-4.5, 4.7-4.9) is a write. Don't let write-story muscle memory bleed in (no runGuardedBatch, no warning, no floor).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.6: Scrape Facebook group members]
- [Source: _bmad-output/planning-artifacts/prds/prd-XActions-2026-06-10-epic4/prd.md#FR-20, §7 NFR-10/NFR-11 (no PII)]
- [Source: src/scrapers/facebook/index.js#scrapeFollowers (clone template), #scrapeTweets/#searchTweets (scroll pattern)]
- [Source: api/services/facebookAutomation.js#assertFacebookUrl (SSRF guard to reuse/import)]
- [Source: _bmad-output/implementation-artifacts/1-4-scrape-followers.md (restricted-group { note } pattern)]
- [Source: docs/agents/selectors-facebook.md (section template + verify-checklist)]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- Added `scrapeGroupMembers(page, groupUrl, options)` exported from `src/scrapers/facebook/index.js` — read-only scrape, NOT via runGuardedBatch (FR-20 is a read; NFR-7/8 apply only to writes).
- Added `assertFacebookUrlLocal` — duplicate of `assertFacebookUrl` from `api/services/facebookAutomation.js` to avoid circular dependency (automate.js already imports from this file). Comment marks sync source.
- Added `normalizeGroupMember` with NFR-11 PII filter (`stripPii`): strips phone numbers and email addresses from all text fields at normalizer level before returning to caller.
- Navigate to `{groupUrl}/members`, `waitForSelector` (8s) for member container. Restricted/private group → `waitForSelector` throws → returns `{ note, platform }` (NOT throw). Empty group returns `[]` — distinct from restricted.
- Bounded scroll loop: `window.scrollTo(0, document.body.scrollHeight)` + injectable `delay` seam (default `randomDelay` 1-3s) + stall detection (N consecutive scrolls with no new members → stop, default maxStalls=5). Dedupes by profileUrl via Map.
- Default export updated to include `scrapeGroupMembers`.
- Dispatcher wiring (`scrape('facebook', 'group-members', ...)`) deferred to a surface story — no REST/CLI/MCP surface this story.
- 28 browser-free tests (fake page + DOM fixtures + injectable delay seam): happy path, limit, restricted, NFR-11 PII, URL validation (SSRF guard), stall detection.
- `docs/agents/selectors-facebook.md` extended: Groups — Members (FR-20) section + 5 verify-checklist items (UNVERIFIED).
- Schedule test flakiness in full-suite runs is pre-existing database contention — not caused by 4.6 changes (confirmed: passes in isolation and with 4.6 tests together).

**TEA automate (coverage expansion) — 2026-06-16:**
- Added `tests/scrapers/facebook-group-members-edge.test.js` (22 edge tests): default-export identity, URL-validation edges (http://, faux-suffix host, m.facebook.com subdomain, null/number input, query-string URL), normalizer edges (null name, undefined username, plain-text preserved, phone-only/email-only → null), onProgress callback, scroll/limit/dedup edges, restricted-group no-scroll.
- **SECURITY FIX (HIGH)**: edge test caught a faux-suffix SSRF bypass in `assertFacebookUrlLocal`. The duplicated guard used `host.endsWith('facebook.com')`, which accepts `notfacebook.com`. Synced to the original `assertFacebookUrl` logic: `host !== 'facebook.com' && !host.endsWith('.facebook.com')`. This divergence had been introduced when the guard was duplicated to avoid the circular dependency.
- Full scrapers suite green (285 passed) after the fix.

### File List

- `src/scrapers/facebook/index.js` — added `assertFacebookUrlLocal`, `stripPii`, `normalizeGroupMember`, `scrapeGroupMembers`; updated default export; **fixed faux-suffix SSRF bypass in `assertFacebookUrlLocal`**
- `tests/scrapers/facebook-group-members.test.js` — new test file (28 tests)
- `tests/scrapers/facebook-group-members-edge.test.js` — new edge test file (22 tests, TEA automate)
- `docs/agents/selectors-facebook.md` — added Groups — Members (FR-20) section + verify-checklist items

## Change Log

- 2026-06-16: Story 4.6 created (context engine). Status → ready-for-dev. (Luisphan)
- 2026-06-16: Implementation complete. Added `scrapeGroupMembers` with NFR-11 PII filter, restricted-group fallback, bounded scroll, SSRF guard. 28 tests. Status → review. (claude-sonnet-4-6)
- 2026-06-16: TEA automate coverage expansion — +22 edge tests (50 total for 4.6). Caught + fixed faux-suffix SSRF bypass in `assertFacebookUrlLocal`. Scrapers suite green (285 passed). (claude-opus-4-8)
