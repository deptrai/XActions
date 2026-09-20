---
epic: 35
story: 35.5
status: ready-for-dev
created: '2026-09-19'
updated: '2026-09-19'
baseline_commit: ace25a82
resolves_action_item: epic-35-retro-item-4
---

# Story 35.5: Instagram Session Persistence — Live Verification (≥10 requests)

## Epic
Epic 35: Reddit, Medium & Instagram Scraper Expansion

## Goal
Live-verify rằng `InstagramClient` duy trì session ≥10 requests liên tiếp không nhận challenge/checkpoint dưới stable residential proxy — đóng action item `epic-35-retro-item-4` và xác nhận success metric Epic 35.

## FRs Covered
- FR-110 (Instagram Session Stability Verification)

## NFRs Covered
- NFR-20 (real implementations, no mocks)
- NFR-13 (self-healing / proxy stability)

## Story

As an XActions operator,
I want live evidence that Instagram sessions persist across ≥10 requests under a stable proxy,
So that the Epic 35 success metric is verified before Nowing relies on it in production.

## Background / Problem

Epic 35 retro (2026-09-12, verdict `accepted-with-open-items`) ghi nhận:
> `InstagramClient` session ≥10 requests without challenge under stable proxy — **⚠️ unverified** — no live Instagram run evidence in this epic's record.

`ensureSession`/`saveSession`/`loadSession` + `SocialAccount` persist đã được implement (`src/scrapers/social/instagram/client.js:318-430`), nhưng chưa có chạy thật trên public Instagram để chứng minh session không bị challenge sau N requests.

**Đây là verification story** — không viết feature mới; chỉ chạy, đo, và ghi nhận kết quả.

## Acceptance Criteria

### AC-1: Test account + proxy prerequisites
**Given** a real Instagram test account (owner-provided, non-production)
**And** a stable residential proxy (`country-us` hoặc tương đương, not `country-vn`)
**When** credentials are supplied via env (`IG_TEST_SESSIONID`/`IG_TEST_USER`/`IG_TEST_PASS`, `PROXY_URL`)
**Then** they are loaded from env/local config only — never committed to git

### AC-2: Session establishment
**Given** valid credentials
**When** `client.ensureSession(accountId)` runs
**Then** a session is established via cookie (`sessionid`/`ds_user_id`/`csrftoken`) or username/password login
**And** `saveSession` persists to `SessionManager` + `SocialAccount` (encrypted)

### AC-3: ≥10 sequential requests without challenge
**Given** an established session + stable proxy
**When** 10+ sequential scrape calls run (mix of `user`, `hashtag`, `post` actions, 1–3s gaussian delay between each)
**Then** all return valid data (no `PlatformError` type `BOT_CHALLENGE`/`CHECKPOINT`/`RateLimitError`)
**And** session cookie remains valid across all requests (no forced re-login)
**And** request count and per-request status are logged to a verification report

### AC-4: Session reload without re-login
**Given** a previously saved session in `SocialAccount`
**When** `loadSession(accountId)` is called in a fresh process
**Then** session restores without re-login
**And** a subsequent request succeeds (session still valid)

### AC-5: Verification report + retro closure
**Given** the live run completes
**When** results are recorded
**Then** a verification note is appended to `epic-35-retro-2026-09-12.md` (or a new verification doc) confirming the metric PASS/FAIL with evidence (request count, timestamps, challenge count)
**And** `sprint-status.yaml` action item `epic-35-retro-item-4` flips `in-progress → done`

### AC-6: Fail-path documentation
**Given** a challenge/checkpoint IS encountered
**When** it occurs at request N
**Then** the failure is recorded with the exact response/error
**And** a contingency recommendation is written (e.g. longer delays, different proxy tier, instagrapi bridge fallback already documented in story 35-3)

## Files to Create/Modify
- `scripts/verify-instagram-session.mjs` — new (live verification runner, env-driven)
- `_bmad-output/implementation-artifacts/instagram-session-verify-report.md` — new (results)
- `epic-35-retro-2026-09-12.md` — append verification outcome note
- `sprint-status.yaml` — action item → done

## Out of Scope
- New Instagram features or client changes
- Automated CI for live verify (needs real credentials — manual/operator run)
- Fixing session bugs found (open a follow-up story if live run fails)

## Open Questions
- OQ-1: Which test account? → Owner (Luis) provides a non-production IG account + residential proxy endpoint.
- OQ-2: Pass threshold — 10 requests or stricter (e.g. 15)? → Spec metric is ≥10; run 12 to have margin.

## Dev Notes
- Reuse existing `InstagramClient` — do NOT modify client code unless live run reveals a bug (then file a bug story).
- Keep delays human-like (1–3s gaussian jitter) — do not hammer.
- Capture raw request log for evidence.
- **Env → credentials mapping (client reads these, NOT `IG_TEST_*`):**
  - `InstagramClient` does NOT read `IG_TEST_*` env vars. Feed credentials via the `session`/credentials object: `{ sessionid, ds_user_id, csrftoken }` (cookie path) or `{ username, password }` (login path).
  - Existing env the client DOES honor: `INSTAGRAM_TRANSPORT` (`puppeteer`|`instagrapi`), `INSTAGRAM_USER_AGENT`, `INSTAGRAM_GRAPHQL_BASE`, `INSTAGRAPI_BIN`/`INSTAGRAPI_URL`, and the shared `PROXY_URL`/`ProxyProvider` for proxy injection.
  - The verify script (`scripts/verify-instagram-session.mjs`) should read `IG_TEST_SESSIONID`/`IG_TEST_USER`/`IG_TEST_PASS` from env and **translate** them into the credentials object the client expects — keep test-only vars out of the client.
  - Precedent: env-driven live runners exist at `scripts/test-fb-*.mjs`, `scripts/audit-instagram*.mjs` — mirror that pattern.
