---
type: bug
slug: x-schedule-add-broken
status: backlog
severity: P2
---

# `x_schedule_add` and `xactions schedule add` always throw

Both entry points pass `action` to `Scheduler.addJob`, which requires
`command` — every attempt to add a scheduled job through the MCP tool or the
CLI throws before persisting. `src/scheduler/scheduler.js` itself is a sound
durable store (`~/.xactions/scheduler.json`); only the adapters are wrong.

Found by the 2026-11-19 codebase audit that verified the roadmap "Next"
items. Standalone bug — filed to the backlog rather than folded into
epic-scheduling-queue, which builds a *post* queue on top of this store.

## Evidence

- `xactions schedule add ...` (CLI) → throws; nothing written to
  `~/.xactions/scheduler.json`.
- `x_schedule_add` (MCP) → same throw.
- Workaround until fixed: none through the shipped surfaces.

## Verify

- `xactions schedule add "node -e 'console.log(1)'" --every day` creates a
  job visible in `xactions schedule list` and in `scheduler.json`.
- `x_schedule_add` through MCP does the same.
