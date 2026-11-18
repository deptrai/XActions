---
id: 5
type: epic
title: Whole-list follower audit
parent: initiative-roadmap-next
covers: [8]
sources: []
companions: []
after: ["epic-resilient-transport"]
assignee:
refined: false
hitl: false
risk: medium
---

# Whole-list follower audit

## Description

`x_detect_bots` scores one visible page at a time. This epic audits the entire
follower list — real, inactive, automated — and exports the segments so they
can feed the CRM and cleanup tooling that already exists.

## Outcome

A full-list score with exportable segments, not a per-page heuristic.

## Done when

- [ ] An audit run covers the whole follower list, not the visible page.
- [ ] Each follower lands in a scored segment (real / inactive / automated).
- [ ] Segments export in a format the existing CRM/cleanup tooling consumes.

## Boundaries

- **Not**: acting on the results — unfollow/block automation already exists
  and keeps its own caps; the audit produces data.
- **Touch points**: reuses the scoring signals behind `x_detect_bots`; the
  full-list scan rides the hardened pagination from epic-resilient-transport.

## References

- `parent — _bmad-output/initiative-roadmap-next/initiative-roadmap-next.md` — R8.

## Notes

- Waits on epic-resilient-transport: whole-list pagination is exactly the
  surface that breaks when X changes a method.
