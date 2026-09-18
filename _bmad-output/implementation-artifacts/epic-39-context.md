# Epic 39 Context: GitOps Selector Healing Assistant (Rescoped)

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Provide a GitOps-driven selector healing pipeline that detects DOM drift via `SelectorCanary`, investigates replacement candidates via `AutoSelectorFallback`, validates them in a sandbox, and generates a `unified-diff` patch delivered as a GitHub Draft PR for human review — strictly prohibiting runtime hot-patching of selectors into Redis or in-memory config.

## Stories

- Story 39.1: Canary targets config expansion + `expectedShape` fields. ✅ **Done** — config-only update.
- Story 39.2: GitOps Patch Assistant CLI (`xactions canary heal`) — net-new implementation.

## Requirements & Constraints

- **Invariant #4 (GitOps-Driven DOM Drift Healing)**: Selectors remain immutable in source control (`canary-targets.json`, `selectors.md`). When drift is detected, the healing flow produces a Draft PR — never auto-heals or injects code at runtime.
- **Manual Trigger Only**: `xactions canary heal` is a manual CLI command. Auto-heal on drift detection is prohibited to prevent unverified selector changes.
- **Sandbox Validation Mandatory**: Every candidate selector must be validated in an isolated page context against `expectedShape` before being included in a patch.
- **Unified-Diff Output**: Patches are generated as `unified-diff` format for `canary-targets.json` — either written to a `.patch` file or delivered via GitHub Draft PR (`gh` CLI).
- **Human Review Gate**: The final step is always a Draft PR requiring human merge — no direct commits to main.
- **No New Dependencies**: Uses existing `commander`, `child_process`, `puppeteer`/`playwright`, and Node.js built-ins only.

## Technical Decisions

- **Separation of Concerns**: Detection (`SelectorCanary`), Investigation (`AutoSelectorFallback`), Validation (`SelectorSandbox`), and Patching (`CanaryHealer` + CLI) are distinct layers.
- **Rescope Justification**: ~70% of original Epic 39 was already implemented in Stories 28.2 (`SelectorCanary`) and 28.3 (`AutoSelectorFallback`). Only the GitOps orchestration layer is net-new.
- **CLI Structure**: `xactions canary {status|probe|heal}` with `--preview` and `--output` flags for dry-run and patch-file workflows.
- **Fallback Strategy**: If `gh` CLI is unavailable or fails, output a `.patch` file with instructions for manual PR creation.

## Cross-Story Dependencies

- **Epic 28.2** provides `SelectorCanary` drift detection (done).
- **Epic 28.3** provides `AutoSelectorFallback` candidate generation (done).
- **Epic 39.1** provides `expectedShape` in canary targets config (done — config expansion).
- **Epic 39.2** is the only remaining net-new work.

## Consolidation Note (2026-09-18)

Original Epic 39 scope included re-implementing `SelectorCanary` and `AutoSelectorFallback`. After duplication review, these were found complete in Stories 28.2/28.3. Epic 39 rescoped to **GitOps healing orchestration only** — the CLI + service layer that wires detection → investigation → validation → patch → PR.
