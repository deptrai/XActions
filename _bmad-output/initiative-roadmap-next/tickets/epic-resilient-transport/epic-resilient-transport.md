---
id: 1
type: epic
title: Survive X changing its mind
parent: initiative-roadmap-next
covers: [1, 2, 3]
sources: []
companions:
  - prompts/builds/08-TLS-BYPASS.md
after: []
assignee:
refined: true
hitl: false
risk: high
---

# Survive X changing its mind

## Description

X changes what its internal endpoints require without notice, and today the
project learns about it from user bug reports. This epic hardens the transport
layer — reads and writes agree with whatever method x.com currently wants per
endpoint — and proves it continuously with a scheduled canary that exercises
the real read paths daily and opens an issue on its own when one breaks.
`scripts/verify-live.mjs` is the seed; GitHub issue #42 tracks the goal.

## Outcome

A breakage at x.com surfaces as an issue the project filed itself, before a
user's automation fails. Accounts X rate-limits harder get a TLS fingerprint
impersonation option.

## Requirements

- R1 (parent R1): reads and writes agree with whatever method X currently
  wants per endpoint, verified by a scheduled job against the live site
  rather than by a user's bug report.
- R2 (parent R2): a scheduled canary runs the real read paths against x.com
  daily and opens an issue on its own when one breaks.
- R3 (parent R3): TLS fingerprint impersonation is available as an option
  for accounts X rate-limits harder.

## Done when

- [ ] A scheduled job exercises real read paths against x.com on a daily
      cadence and opens an issue unattended when one breaks.
- [ ] Each live endpoint's call method is verified against the live site by
      the job, not asserted from code.
- [ ] TLS fingerprint impersonation is available as an opt-in.

## Boundaries

- **Not**: changing *which* endpoints or data are used — only *how* they are
  called. No proxy rotation or IP strategy (the user's own setup, per
  SECURITY's anti-bot notes).
- **Tracer path**: canary first — it is the detection surface every other
  check hangs off.
- **Touch points**: every scraper transport call in `src/scrapers/` is
  consumed by the hardened layer; later epics (ledger, scheduling, XChat,
  audit) build on it — that is why it opens the initiative.

## References

- `parent — _bmad-output/initiative-roadmap-next/initiative-roadmap-next.md` — R1, R2, R3.
- `architecture — docs/architecture.md` — transport module layout.
- `prompts/builds/08-TLS-BYPASS.md` — adopted companion: the TLS
  impersonation design (adapter on the `options.fetch` seam, JA3 profiles,
  CycleTLS/NativeTls options).
- GitHub issue #42 — the canary tracking issue.

## Notes

- Verified (2026-11-19, codebase audit): `verify-live.mjs` exists but is not
  scheduled anywhere (no cron workflow, no npm script, badge JSONs only — no
  issue creation) and was last run 2026-08-27; it covers 2 read paths.
  `check-endpoints.mjs` treats any non-404 as valid, so a wrong HTTP method
  passes silently. `POST_QUERY_OPERATIONS` in `endpoints.js` is hand-maintained
  and was last touched by a bug-fix commit — the exact failure mode R1
  targets.
- Verified (2026-11-19): zero TLS-impersonation code, but a detailed plan
  exists at `prompts/builds/08-TLS-BYPASS.md` (CycleTLS/NativeTls adapter
  behind the existing `options.fetch` + undici-dispatcher seam).
- Decision (2026-11-19): opens the initiative as the platform-baseline epic —
  epics 2–5 share its code (`src/scrapers/twitter/http/`) and declare `after`.
- Decision (2026-11-19, refinement): the scheduler is a GitHub Actions
  `schedule:` workflow — the repo already runs Actions; no new infra.
- Decision (2026-11-19, refinement): method-mismatch detection extends
  `check-endpoints.mjs` to flag non-404 method failures instead of building
  a second prober — it already exercises every tracked op live.
- Decision (2026-11-19, refinement): two-tier canary — a guest-token tier
  that always runs, and an authenticated tier enabled only when a session
  secret exists (POST reads such as SearchTimeline/Followers likely need
  auth; which ops run guest-only is a story-level finding).
- Decision (2026-11-19, refinement): TLS adopts Track 08 — an optional
  adapter on the `options.fetch` seam, opt-in per account, never the
  default lane. Binary choice and packaging stay at story level.
- Decision (2026-11-19, refinement): on breakage the job opens an issue —
  auto-repair of `POST_QUERY_OPERATIONS`/the methods table is deferred
  scope, not this epic.
- Open question (needs the user, not a story): an authenticated canary tier
  wants a session cookie in repo secrets — only the user can add it; the
  workflow must skip the auth tier cleanly when absent.
