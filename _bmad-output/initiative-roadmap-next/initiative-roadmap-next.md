---
id: 1
type: initiative
title: Ship the roadmap's Next
parent:
covers: []
sources:
  - ROADMAP.md
  - SECURITY.md
companions:
  - docs/architecture.md
  - docs/FEATURE_INVENTORY.md
  - _bmad-output/backlog/story-multiplatform-account-vault-plan.md
after: []
assignee:
refined: true
hitl: false
risk: medium
---

# Ship the roadmap's Next

## Description

ROADMAP.md names eleven capabilities the project wants built, ordered by how
much they change what people can do, in four themes: survive X changing its
mind, make an account last, close the gap between "scrapes X" and "runs your
presence", and meet people where they already are. This initiative turns that
section into ordered epics so agents can build them against tickets instead of
against the prose.

## Outcome

A user keeps working automations as x.com changes underneath them, keeps their
account unsuspended, runs their whole cross-platform presence from one tool,
and installs it without a terminal.

## Requirements

- R1 (Next — Survive X changing its mind): reads and writes agree with whatever
  method X currently wants per endpoint, verified by a scheduled job against
  the live site rather than by a user's bug report.
- R2 (Next — Survive X changing its mind): a scheduled canary runs the real
  read paths against x.com daily and opens an issue on its own when one breaks.
- R3 (Next — Survive X changing its mind): TLS fingerprint impersonation is
  available as an option for accounts X rate-limits harder.
- R4 (Next — Make an account last): one on-disk rate ledger governs the HTTP
  account pool's `x-rate-limit-*` windows, the `action-caps` daily budget, and
  the browser-side quota supervisor — surviving restarts.
- R5 (Next — Make an account last): every destructive bulk action supports
  dry-run, on by default, showing what it would do without doing it.
- R6 (Next — Close the gap): a real scheduling queue — durable drafts,
  timezone handling, thread scheduling, fan-out to the existing Bluesky and
  Mastodon clients — that needs neither Premium nor a browser.
- R7 (Next — Close the gap): users can read and export their own XChat
  conversations before the legacy DM endpoints go dark.
- R8 (Next — Close the gap): a follower audit scores an entire follower list
  (real, inactive, automated) and exports the segments.
- R9 (Next — Meet people where they already are): the MV3 extension is listed
  on the Chrome Web Store and Edge Add-ons (no Firefox build).
- R10 (Next — Meet people where they already are): XActions installs without a
  Node toolchain — Homebrew tap and release binaries.
- R11 (Next — Meet people where they already are): an optional official-API
  lane over OAuth2 PKCE exists for users who would rather pay X than risk a
  suspension.

## Constraints

- C1 (ROADMAP — Deliberately not building; SECURITY): no auto-DM campaigns, no
  engagement pods or reply rings, no follower/view purchasing, no
  auto-retweet-everything. X's rules prohibit them and enforcement ends in
  suspension.
- C2 (SECURITY; ROADMAP — Deliberately not building): never a hosted service
  scraping X on other people's behalf — the client runs on the user's machine
  with their own session (cease-and-desist precedent, August 2026).
- C3 (SECURITY — credentials): sessions and stored credentials stay local and
  owner-only (`0600`/`0700`); nothing leaves the machine except what a
  user-configured feature was told to send.
- C4 (Next — Meet people): the official-API lane is optional — never the
  default, never required; the no-key lane remains the primary path.
- C5 (SECURITY — anti-bot reality): new write paths keep the pacing, jitter and
  backoff defaults; anything faster stays labelled risky where it is offered.
- C6 (ROADMAP — Contributing): a change that ships a Next item moves it to
  "Shipped" and updates ROADMAP.md in the same PR.

## Done when

- [ ] A scheduled job exercises real read paths against x.com on a daily
      cadence and opens an issue unattended when one breaks.
- [ ] One on-disk ledger governs HTTP-pool and browser-side action budgets
      across a process restart; a destructive bulk command run without flags
      performs a dry-run.
- [ ] A thread scheduled with a timezone is delivered to X and to Bluesky and
      Mastodon without a browser or Premium.
- [ ] A user reads and exports their own DMs through the XChat path.
- [ ] A fresh machine installs XActions and the extension without a Node
      toolchain or "load unpacked".

## Boundaries

- **Not**: auto-DM campaigns; engagement pods/reply rings; follower/view
  purchasing; hosted scraping service; auto-retweet-everything (the source's
  not-building list). A Firefox extension build. XChat *sending* — reading and
  exporting your own conversations only.
- **Tracer path**: the resilient-transport epic opens — every later epic builds
  on the layer it hardens.
- **Touch points** (consumed or configured, not re-implemented):
  `accountPool.js`/`accounts.db` — rate-ledger and vault work read it, owner
  epic-one-rate-ledger; Bluesky/Mastodon scraper clients — the scheduling
  fan-out calls them, owner epic-scheduling-queue; the GitHub release pipeline
  — configured by epic-distribution; `x_detect_bots` heuristics — reused by
  epic-follower-audit; `src/mcp/server.js`, `local-tools.js`,
  `tool-groups.js` — the MCP registration surface epics 3, 4, 5 and 7 all
  append tool entries to; append-only, shared by convention not by `after`.

## References

- `architecture — docs/architecture.md` — current module layout and boundaries.
- `inventory — docs/FEATURE_INVENTORY.md` — what already ships; the extend-vs-build
  baseline for every epic.
- `plan — _bmad-output/backlog/story-multiplatform-account-vault-plan.md` —
  the account vault, adopted as standalone backlog work that feeds the
  scheduling and API-lane epics.

## Notes

- Assumption (2026-11-19): the whole "Next" section is in scope, kept in the
  source's impact order; the request named no subset.
- Assumption (2026-11-19): SECURITY.md is a source — its credential and
  hosting rules land as Constraints, not Requirements.
- Open question: TLS fingerprinting approach — a detailed unimplemented plan
  exists at `prompts/builds/08-TLS-BYPASS.md` (CycleTLS/NativeTls adapter on
  the `options.fetch` seam); adopt or re-derive when epic-resilient-transport
  is refined.
- Open question: the XChat protocol is undocumented — expect a spike as
  epic-xchat-export's first entry. Audit confirms: zero crypto in repo,
  encrypted conversations explicitly excluded (`dm_secret_conversations_
  enabled: 'false'`).
- Verified (2026-11-19, 7-agent codebase audit): all eleven capabilities are
  partial — foundations exist, none shipped as described. Per-item evidence
  in each epic's Notes; one roadmap inaccuracy recorded as `Source conflict:`
  in epic-one-rate-ledger; audit also surfaced a live bug filed to backlog as
  `bug-x-schedule-add-broken`.
- Decision (2026-11-19): the account vault is adopted as standalone backlog
  ticket `story-multiplatform-account-vault`, not an epic entry — it is
  already fully planned, ships alone, and feeds two epics.
- Decision (2026-11-19): the source's four themes slice to seven epics —
  "Close the gap" holds three uncoupled capabilities (queue, XChat, audit),
  and "Meet people" splits release work (stores, binaries) from the API lane.
