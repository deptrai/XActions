---
id: 7
type: epic
title: Optional official-API lane
parent: initiative-roadmap-next
covers: [11]
sources: []
companions: []
after: []
assignee:
refined: false
hitl: false
risk: medium
---

# Optional official-API lane

## Description

For users who would rather pay X than risk a suspension: an OAuth2 PKCE lane
over the official API, alongside — never replacing — the no-key scraping lane
that is the project's reason to exist.

## Outcome

A user can authenticate with OAuth2 PKCE and run operations through the
official API, with docs that make clear it is opt-in and stays that way.

## Done when

- [ ] OAuth2 PKCE login produces working official-API credentials stored
      locally.
- [ ] At least the read surface runs through the official lane.
- [ ] Docs and UX mark the lane optional — never default, never required
      (initiative C4).

## Boundaries

- **Not**: making the official lane primary, required, or feature-gating the
  no-key lane; chasing paid-tier features beyond what a user's own key
  unlocks.
- **Touch points**: the backlog `story-multiplatform-account-vault` is the
  natural home for OAuth tokens when built — adopt, don't duplicate.

## References

- `parent — _bmad-output/initiative-roadmap-next/initiative-roadmap-next.md` — R11, C4.
- `plan — _bmad-output/backlog/story-multiplatform-account-vault-plan.md` —
  credential storage to adopt for OAuth tokens.

## Notes

- Independent of epics 1–5: the official transport shares nothing with the
  scraping transport. Runs last only because the source ranks it last.
