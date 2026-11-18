---
id: 1
type: epic
title: Survive X changing its mind
parent: initiative-roadmap-next
covers: [1, 2, 3]
sources: []
companions: []
after: []
assignee:
refined: false
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
- GitHub issue #42 — the canary tracking issue.

## Notes

- Open question (from initiative): TLS fingerprinting approach — dedicated
  impersonation client vs patching the existing fetch stack. Settle at
  refinement.
- Decision (2026-11-19): opens the initiative as the platform-baseline epic —
  epics 2–5 share its code (`src/scrapers/twitter/http/`) and declare `after`.
