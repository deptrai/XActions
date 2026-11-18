---
id: 4
type: epic
title: XChat read and export
parent: initiative-roadmap-next
covers: [7]
sources: []
companions: []
after: ["epic-resilient-transport"]
assignee:
refined: false
hitl: false
risk: high
---

# XChat read and export

## Description

X is migrating DMs to XChat, its encrypted system, and the legacy endpoints
`src/scrapers/twitter/http/dm.js` targets go dark as that completes (issue
#37). This epic gives users read and export of their own conversations over
the new path before the old one dies.

## Outcome

A user's own DM history — on the XChat side — is readable and exportable
before the legacy endpoints disappear.

## Done when

- [ ] Own XChat conversations can be listed and read.
- [ ] An export produces the user's own conversation history in a documented
      format.

## Boundaries

- **Not**: sending anything — read and export only (initiative C1 makes
  automated sending a permanent non-goal; the source scopes this to reading
  your own conversations).
- **Open question**: the XChat protocol is undocumented — expect a spike as
  the first entry.

## References

- `parent — _bmad-output/initiative-roadmap-next/initiative-roadmap-next.md` — R7.
- GitHub issue #37 — legacy DM endpoint deprecation.

## Notes

- Waits on epic-resilient-transport: new endpoints land on the hardened
  dispatch, not beside it.
- Verified (2026-11-19): zero crypto in the repo for XChat — no key exchange,
  enrollment or ratchet; encrypted conversations are explicitly excluded
  today (`INBOX_PARAMS` sends `dm_secret_conversations_enabled: 'false'`).
  Three DM stacks all ride the legacy/DOM surface (`http/dm.js` +
  `client/api/dms.js` on `/1.1/dm/*`, MCP DOM scrapers, console scripts) —
  the spike must answer protocol, not just endpoints.
