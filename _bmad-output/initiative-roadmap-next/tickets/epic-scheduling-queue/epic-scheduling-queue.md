---
id: 3
type: epic
title: A real scheduling queue
parent: initiative-roadmap-next
covers: [6]
sources: []
companions: []
after: ["epic-resilient-transport"]
assignee:
refined: false
hitl: false
risk: medium
---

# A real scheduling queue

## Description

`x_schedule_post` today drives X's own compose UI — it needs Premium and a
live browser. This epic replaces that with a durable queue: drafts that
survive restarts, timezone handling, thread scheduling, and fan-out to the
Bluesky and Mastodon clients that already exist in `src/scrapers/`.

## Outcome

A thread scheduled for a time in a timezone is delivered to X and to Bluesky
and Mastodon, unattended, without a browser.

## Done when

- [ ] Queued items survive a process restart and fire on schedule.
- [ ] A scheduled multi-post thread delivers in order to X, Bluesky and
      Mastodon.
- [ ] Scheduling no longer requires Premium or a browser session.

## Boundaries

- **Not**: engagement automation — the queue schedules the user's own content,
  nothing that reacts or engages (initiative C1).
- **Touch points**: the backlog ticket `story-multiplatform-account-vault`
  (already planned) is consumed here for stored Bluesky/Mastodon credentials
  when built; the platform scraper clients are called, not modified.

## References

- `parent — _bmad-output/initiative-roadmap-next/initiative-roadmap-next.md` — R6.
- `plan — _bmad-output/backlog/story-multiplatform-account-vault-plan.md` —
  credential source for the fan-out.

## Notes

- Waits on epic-resilient-transport: the queue invokes the write paths it
  hardens.
- Verified (2026-11-19): `src/scheduler/scheduler.js` is already a durable
  job store (`~/.xactions/scheduler.json`, retry/history/webhooks) but
  schedules shell commands, not posts — and its entry points are broken
  today (see backlog `bug-x-schedule-add-broken`). Bluesky `createAgent`
  authenticates but has no `post()`; Mastodon `createClient` holds a token
  with GETs only — both are small additions. `http/actions.js schedulePost`
  is an HTTP (non-browser) X scheduling path worth checking for callers.
