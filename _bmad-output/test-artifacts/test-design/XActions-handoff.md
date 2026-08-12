# XActions — Test Design Handoff for Epic/Story Workflow

**Purpose:** Bridge between system-level test design and epic/story implementation. Provides risk context, critical test scenarios, and quality gates for downstream BMAD workflows.

**Project:** XActions | **Date:** 2026-08-12 | **Source:** `test-design-architecture.md` + `test-design-qa.md`

---

## TEA Artifacts Inventory

| Artifact | Path | Status |
|---|---|---|
| Test Design Progress | `_bmad-output/test-artifacts/test-design/test-design-progress.md` | Complete (Steps 1-5) |
| Architecture Test Design | `_bmad-output/test-artifacts/test-design/test-design-architecture.md` | Complete |
| QA Test Design | `_bmad-output/test-artifacts/test-design/test-design-qa.md` | Complete |
| NFR Assessment (x402) | `_bmad-output/test-artifacts/nfr-assessment.md` | Complete (prior run) |
| Automation Summary (Epic 2) | `_bmad-output/test-artifacts/automation-summary.md` | Complete (prior run) |
| Traceability Matrix | `_bmad-output/test-artifacts/traceability/traceability-matrix.md` | Complete (prior run) |
| ATDD Checklist (x402) | `_bmad-output/test-artifacts/atdd-checklist-x402-middleware.md` | Complete (prior run) |
| Mutation Reports (5) | `_bmad-output/test-artifacts/mutation-*.json` | Complete (prior runs) |

---

## Epic-Level Integration Guidance

### P0/P1 Risks for Epic Planning

| Risk ID | Score | Risk | Affected Epics | Mitigation Timeline |
|---|---|---|---|---|
| R1 | 9 | DOM selector breakage | All browser automation epics | Pre-release |
| R2 | 6 | Cookie/token leakage | Epic 1, 2, 3, 5 (all surfaces handling cookies) | Pre-release |
| R3 | 6 | Account ban risk | Epic 4, 6 (growth + anti-detection) | Epic 6 completion |
| R4 | 6 | Checkpoint detection untested | Epic 1, 2, 4 (all FB automation) | Pre-release |
| R5 | 6 | WebRTC IP leak | Epic 6 | Epic 6 |
| R9 | 6 | No CI test execution | All epics | Immediate |

### Epic-Specific Test Guidance

| Epic | Status | New Tests Needed | Priority Focus |
|---|---|---|---|
| Epic 1 (Data Reading) | Done | P0-2 (selector smoke FB), P0-3 (cookie leak) | Regression + security |
| Epic 2 (Automation) | Done | P0-4 (dry-run all surfaces) | Extend existing dry-run tests |
| Epic 3 (Multi-Surface) | Done | P1-3 (MCP schema), P1-4 (API), P1-5 (CLI) | Contract tests |
| Epic 4 (Growth) | Done | P2-3 through P2-9 (group automation) | Backfill missing tests |
| Epic 5 (Messenger) | Done | P1-23 (GraphQL fallback), P2-17 (mass-share delay) | Reliability |
| Epic 5b (Marketplace) | Done | P2-10 (marketplace parsing) | Backfill |
| Epic 6 (Anti-Detection) | In-Progress | P1-13 through P1-22, P2-11 through P2-16 (14 scenarios) | TDD — write tests first |

---

## Story-Level Integration Guidance

### Critical Test Scenarios for Story Implementation

| Test ID | Priority | Scenario | Related Stories | Test Level |
|---|---|---|---|---|
| P0-3 | P0 | Cookie leak detection | All stories handling cookies | Unit + Integration |
| P0-4 | P0 | Dry-run default all surfaces | 2-1, 2-2, 2-3, 2-4, 4-1 through 4-9 | Unit |
| P0-10 | P0 | Checkpoint detection | Any FB automation story | Unit |
| P1-13 | P1 | UA pool 20+ Chrome UAs | 6-2 (consistent fingerprint) | Unit |
| P1-15 | P1 | WebRTC leak prevention | 6-3 (UA pool/viewport) | Unit |
| P1-17 | P1 | Velocity limits | 6-4 (velocity limits) | Unit |
| P1-18 | P1 | Account age awareness | 6-4 (velocity limits) | Unit |
| P1-21 | P1 | Injectable delay seam | All Epic 6 behavioral stories | Unit |
| P1-23 | P1 | GraphQL doc_id fallback | 5-1 (GraphQL layer) | Unit |

### TDD Recommendation for Epic 6

Epic 6 stories should follow TDD: write P1-13 through P1-22 tests BEFORE implementation. Use injectable delay seam pattern (`noDelay`) from existing fb-automation tests.

---

## Risk-to-Story Mapping

| Risk ID | Score | Related Stories | Test Scenarios |
|---|---|---|---|
| R1 | 9 | All browser automation stories | P0-1, P0-2 |
| R2 | 6 | 1-1, 1-2, 2-1, 3-2, 3-3, 5-3 | P0-3 |
| R3 | 6 | 4-7, 4-9, 6-4 | P1-17, P1-18 |
| R4 | 6 | 1-1, 2-1, 4-1 | P0-10 |
| R5 | 6 | 6-3 | P1-15 |
| R6 | 4 | 6-2 | P1-19 |
| R7 | 4 | 3-1, 3-2, 3-3 | P1-3, P1-4, P1-5, P3-5 |
| R9 | 6 | All | P1-1, P1-2 |
| R13 | 4 | 5-1 | P1-23 |

---

## Recommended Workflow Sequence

1. **Immediate:** Set up CI workflow (R9 mitigation) — wire `npm test` into `.github/workflows/ci.yml`
2. **Pre-release:** Create selector smoke test suite (R1) + security test suite (R2, R4)
3. **Epic 6 development:** TDD with P1-13 through P1-22 tests written first
4. **Post-Epic 6:** Run `nfr-assess` workflow for Epic 6 NFR evidence
5. **Ongoing:** Run `atdd` workflow for P0 test generation (separate workflow, not auto-run)

---

## Phase Transition Quality Gates

| Gate | Criteria | Workflow |
|---|---|---|
| System Design → Epic Implementation | R1, R9 mitigations started; P0 tests defined | This handoff |
| Epic Implementation → Story Dev | Story acceptance criteria mapped to test scenarios | `create-epics-and-stories` |
| Story Dev → Review | P0 tests pass; P1 >= 95%; coverage >= 80% | `dev-story` + `code-review` |
| Review → Release | All high-risk mitigations complete; NFR evidence collected | `nfr-assess` + `gate` |
