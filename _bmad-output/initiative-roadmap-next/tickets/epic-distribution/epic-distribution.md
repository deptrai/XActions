---
id: 6
type: epic
title: Meet people where they are
parent: initiative-roadmap-next
covers: [9, 10]
sources: []
companions: []
after: []
assignee:
refined: false
hitl: false
risk: low
---

# Meet people where they are

## Description

Installing XActions means a Node toolchain for the CLI and "load unpacked"
for the MV3 extension. This epic ships the release surface: Chrome Web Store
and Edge Add-ons listings for the extension, and a Homebrew tap plus release
binaries for the CLI — so nothing needs to be built from source.

## Outcome

A fresh machine installs the CLI with `brew install` (or a downloaded binary)
and the extension from a store listing. No Node, no developer mode.

## Done when

- [ ] The extension installs from Chrome Web Store and Edge Add-ons listings.
- [ ] `brew install` from the tap produces a working `xactions`.
- [ ] Release binaries exist for the supported platforms and are produced by
      automation.

## Boundaries

- **Not**: a Firefox build (source names it for a later date); changing what
  the extension or CLI does — packaging only.
- **Independent**: shares no code with epics 1–5 — it is release engineering
  and can run in parallel.

## References

- `parent — _bmad-output/initiative-roadmap-next/initiative-roadmap-next.md` — R9, R10.
- `extension/` — the MV3 manifest this packages.

## Notes

- hitl expectation: store submissions need human-owned developer accounts —
  entries carrying that step should be marked `hitl` at planning.
