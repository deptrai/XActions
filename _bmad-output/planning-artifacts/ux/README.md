---
status: final
created: 2026-08-27
canonical: true
purpose: canonical index for UX design documents in XActions
---

# XActions UX Document Index

This folder contains the user-experience design artifacts for the XActions Internal Operator Dashboard and CLI surfaces.

## Canonical UX Documents

| Document | Purpose | Status |
| --- | --- | --- |
| `DESIGN.md` | Design system tokens (colors, typography, spacing, components) and dashboard UI component specs. | final |
| `EXPERIENCE.md` | Core user experience flows for the operator dashboard (jobs, checkpoints, proxies, accounts, streams). | final |
| `EXPERIENCE-UNIVERSAL-2026-08-21.md` | Extended universal-scraping experience flows and cross-platform operator journeys (supplemental to `EXPERIENCE.md`). | final |

## How to Use

- **UI implementers** start with `DESIGN.md` for tokens and components, then read `EXPERIENCE.md` for flows.
- **UX reviewers** focus on `EXPERIENCE.md` as the canonical flow document; use `EXPERIENCE-UNIVERSAL-2026-08-21.md` only when a flow explicitly references it.
- **CLI authors** refer to `EXPERIENCE.md` for admin CLI command flows; note that CLI wireframes are not yet detailed here and should be added under Epic 19 as stories are implemented.

## Boundaries

- Dashboard UI is in `dashboard/`.
- Admin CLI is `xactions admin ...` (Epic 19).
- MCP/AI Agent surfaces are documented in `epics.md` Story 19.10 and `src/mcp/`.

## Canonical Pointer

This `README.md` is the canonical register for UX documents. The canonical PRD (`../prd.md`) references this file in section 7.5.
