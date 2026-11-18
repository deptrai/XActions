---
id: 2
type: epic
title: Make an account last
parent: initiative-roadmap-next
covers: [4, 5]
sources: []
companions: []
after: ["epic-resilient-transport"]
assignee:
refined: false
hitl: false
risk: medium
---

# Make an account last

## Description

Three ledgers count the same budget today: the HTTP `accountPool` tracks
`x-rate-limit-*` windows, `action-caps.js` holds the daily budget, and the
browser-side `quotaSupervisor.js` counts in-process and restarts at zero — so
automation restarted by the browser can burn an account the HTTP side already
knows is nearly out. One on-disk ledger feeds all three. Separately, every
destructive bulk action gains a dry-run, on by default.

## Outcome

A browser restart mid-window does not reset the count. Nothing destructive
runs without the operator seeing the plan first.

## Done when

- [ ] One on-disk ledger serves the HTTP pool, the action-caps budget and the
      browser-side supervisor; a restart mid-window keeps the counts.
- [ ] Each destructive bulk action performs a dry-run unless explicitly told
      to execute.

## Boundaries

- **Not**: re-tuning pacing policy — the ledger records; jitter/backoff
  defaults stay (initiative C5).
- **Touch points**: `accountPool.js`/`accounts.db` is the persistence surface;
  `action-caps.js` and the browser-side supervisor become readers/writers of
  the shared ledger.

## References

- `parent — _bmad-output/initiative-roadmap-next/initiative-roadmap-next.md` — R4, R5.
- `architecture — docs/architecture.md` — where the three counters live.

## Notes

- Waits on epic-resilient-transport: both touch the HTTP pool's request layer.
- Small epic — two requirements; keep it that way rather than folding it into
  epic 1 (different outcome, different verification).
- Source conflict (2026-11-19): the roadmap says the browser-side supervisor
  "restarts at zero" — actually `quotaSupervisor.js` persists in
  `localStorage` and survives browser restarts; it resets only on a new
  profile/cleared storage. The real gap is wider, not wrong: there are *three*
  browser-side counters (`xactions_quota_state`, `xactions_ratelimit`, the
  extension service-worker flag) and no fs→page bridge — browser JS cannot
  read `~/.xactions/`. The Node side already has two on-disk ledgers
  (`accounts.db` rate_limits, `action-ledger.json`).
- Verified (2026-11-19): `x_unfollow_all` and `x_clear_bookmarks` have no
  `dryRun` parameter; mass block/unlike/delete exist *only* as console
  scripts — R5 first needs CLI/MCP surfaces for actions that have none.
