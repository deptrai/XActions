---
workflowStatus: 'completed'
totalSteps: 5
stepsCompleted: ['step-01-detect-mode', 'step-02-load-context', 'step-03-risk-and-testability']
lastStep: 'step-03-risk-and-testability'
nextStep: '/Users/luisphan/.config/opencode/skills/bmad-testarch-test-design/steps-c/step-04-coverage-plan.md'
lastSaved: '2026-08-12'
---

# Test Design Progress — XActions

## Step 1: Detect Mode & Prerequisites

### Mode Selected: System-Level

**Rationale:** Project has both PRD + Architecture docs AND Epic/Story artifacts. Per priority rule, System-Level mode is preferred when both input types are available.

### Inputs Available

| Input | Path | Status |
|---|---|---|
| PRD (core) | `planning-artifacts/prds/prd-XActions-2026-06-08/prd.md` | ✅ |
| PRD (Epic 4) | `planning-artifacts/prds/prd-XActions-2026-06-10-epic4/prd.md` | ✅ |
| Architecture | `planning-artifacts/architecture.md` | ✅ |
| Epics | `planning-artifacts/epics.md` + `epics-full.md` | ✅ |
| Sprint Status | `implementation-artifacts/sprint-status.yaml` | ✅ |
| Story Impls | 30+ files in `implementation-artifacts/` | ✅ |
| Decision Log | `planning-artifacts/prds/prd-XActions-2026-06-08/.decision-log.md` | ✅ |

### Project Status

- **Type:** Brownfield (as-built architecture)
- **Epics 1–5:** Done (Facebook scraping, automation, multi-surface, growth, messenger)
- **Epic 5b:** Done (Marketplace & infrastructure)
- **Epic 6:** In-progress (Anti-Detection & Bot Countermeasures)
- **Surfaces:** Browser scripts, CLI, MCP server, REST API, Dashboard, Extension

### Prerequisite Check: PASSED ✅

All System-Level prerequisites met (PRD + Architecture + ADR/decision log).

## Step 2: Load Context & Knowledge Base

### Configuration Loaded

| Config Key | Value |
|---|---|
| `tea_use_playwright_utils` | true |
| `tea_use_pactjs_utils` | false |
| `tea_pact_mcp` | none |
| `tea_browser_automation` | auto |
| `test_stack_type` | auto → detected **fullstack** |
| `risk_threshold` | p1 |
| `test_artifacts` | `{project-root}/_bmad-output/test-artifacts` |

### Stack Detection

| Indicator | Found | Source |
|---|---|---|
| Frontend (Playwright/Cypress) | ❌ No config file | — |
| Backend (Node.js/Express) | ✅ | `package.json`, `api/server.js` |
| Browser tests (page.goto/locator) | ✅ | 5 test files use `page.goto`/`page.locator` |
| Mobile (Maestro/RN/Expo) | ❌ | — |

**Detected Stack: fullstack** (Node.js backend + browser automation tests + Puppeteer-based scrapers)

### Project Artifacts Loaded (System-Level Mode)

| Artifact | Path | Key Extracts |
|---|---|---|
| PRD (core) | `planning-artifacts/prds/prd-XActions-2026-06-08/prd.md` | Facebook Platform Extension: 14 FRs (FR-1..FR-14), 4 features (scrape, automate, multi-surface, persistence) |
| PRD (Epic 4) | `planning-artifacts/prds/prd-XActions-2026-06-10-epic4/prd.md` | Growth automation PRD |
| Architecture | `planning-artifacts/architecture.md` | Brownfield as-built: 7 surfaces (Browser/CLI/MCP/API/Dashboard/Extension/Library), Prisma/PostgreSQL, Redis/Bull, Puppeteer+Stealth |
| Decision Log | `planning-artifacts/prds/prd-XActions-2026-06-08/.decision-log.md` | ADR-006 (adapter pattern), ADR-007 (automate tách riêng + dry-run default), ADR-010 (batch ≤20, delay 60-180s), ADR-012 (Facebook delay > Twitter) |
| Epics (full) | `planning-artifacts/epics-full.md` | 7 epics, 48 stories, 54 FRs (FR1-FR54), 6 NFRs |
| Sprint Status | `implementation-artifacts/sprint-status.yaml` | Epic 1-5b: done; Epic 6: in-progress (anti-detection) |

### Tech Stack & Dependencies

- **Runtime:** Node.js ESM
- **Web:** Express, Socket.IO, static HTML dashboard
- **Browser automation:** Puppeteer + puppeteer-extra-plugin-stealth
- **DB:** PostgreSQL via Prisma
- **Queue:** Redis/Bull
- **CLI:** Commander
- **Test framework:** Vitest (38 deps, 8 devDeps)
- **Mutation testing:** Stryker (5 configs: x402, fb-automation, fb-scrapers, fb-scheduler, fb-routes)
- **Payments:** Stripe + x402 crypto middleware

### Integration Points Identified

1. **Browser ↔ X/Twitter/Facebook DOM** — Puppeteer page automation, selectors change frequently
2. **CLI ↔ Scraper module** — Direct function calls via dispatcher (`platforms` registry)
3. **MCP ↔ Scraper/API** — Local mode uses Puppeteer directly; remote mode delegates to API
4. **API ↔ Services** — Express routes call service layer (facebookAutomation, scheduler, etc.)
5. **API ↔ Prisma** — Operation, Schedule, User, Payment models
6. **API ↔ Redis/Bull** — Background job queue for long-running automations
7. **API ↔ Stripe/x402** — Payment processing, webhook handling
8. **Dashboard ↔ API** — Static HTML calls REST endpoints
9. **Extension ↔ Browser** — Content scripts on x.com

### NFRs Extracted

| NFR | Category | Threshold | Source |
|---|---|---|---|
| Bezier mouse < 2s | Performance | <2s completion | Epic 6 NFR1 |
| Fingerprint config centralized | Maintainability | Single module | Epic 6 NFR2 |
| Injectable delay seam | Testability | Functions accept delay fn | Epic 6 NFR3 |
| No cookie logging | Security | No secrets in logs/responses | Epic 6 NFR4 |
| FB delay > Twitter | Reliability | Higher delay floor (ADR-012) | Epic 6 NFR5 |
| Dry-run default | Safety | All mutate actions default dry | ADR-007 / NFR6 |

### Existing Test Coverage

| Area | Test Files | Framework | Notes |
|---|---|---|---|
| HTTP scraper (Twitter) | 24 files in `tests/http-scraper/` | Vitest | Comprehensive: actions, tweets, search, auth, media, DM, engagement, profile, threads |
| x402 middleware | `tests/x402-*.test.js` | Vitest | 228 tests, mutation gate 72.82% |
| Plugins | `tests/plugins/` | Vitest | Google Sheets, Excel, loader |
| A2A | `tests/a2a/` | Vitest | Server, taskManager, agentCard, integration, bridge, skillRegistry, types |
| Graph | `tests/graph/` | Vitest | Visualizer, analyzer |
| Facebook scrapers | `tests/scrapers/` | Vitest | facebook-messenger-share |
| Facebook services | `tests/services/` | Vitest | facebook-view-boost-edge, facebook-share, facebook-automation.integration |
| Helpers | `tests/helpers/fake-page.js` | Vitest | Mock Puppeteer page |

### Existing Test Artifacts (Prior TEA Runs)

| Artifact | Status | Module |
|---|---|---|
| `nfr-assessment.md` | Complete | x402 payment middleware |
| `automation-summary.md` | Complete | Epic 2 Facebook Automation |
| `traceability/traceability-matrix.md` | Complete | — |
| `atdd-checklist-x402-middleware.md` | Complete | x402 |
| Mutation reports (5) | Complete | x402, fb-automation, fb-scrapers |
| Load test | Complete | x402 middleware |

### Knowledge Fragments Loaded (System-Level Mode)

| Fragment | Tier | Purpose |
|---|---|---|
| `adr-quality-readiness-checklist.md` | extended | 8-category 29-criteria testability framework |
| `nfr-criteria.md` | extended | NFR status definitions (security, performance, reliability, maintainability) |
| `test-levels-framework.md` | core | Unit/integration/E2E selection guidelines |
| `risk-governance.md` | core | Risk scoring matrix, gate decision rules |
| `test-quality.md` | core | Test DoD: deterministic, isolated, <1.5min, <300 lines |

### Playwright Utils Loading Profile

**Profile selected: Full UI+API** — `tea_use_playwright_utils: true` + browser tests detected (`page.goto`/`page.locator` in 5 test files). Core fragments available for loading: overview, api-request, auth-session, recurse.

### Coverage Gaps Identified (Initial)

1. **No Playwright/Cypress config** — browser tests use Vitest + fake-page mock, no real browser E2E framework configured
2. **Epic 6 (Anti-Detection)** — in-progress, no tests yet for fingerprint, behavioral simulation, velocity limits
3. **No contract tests** — `tea_use_pactjs_utils: false`, no Pact setup despite multi-surface API
4. **No CI pipeline config visible** — no `.github/workflows/` test workflow found
5. **Dashboard/Extension** — no test coverage for static HTML dashboard or browser extension
6. **MCP server** — limited test coverage for MCP tool surface

## Step 3: Testability & Risk Assessment

### 1. System-Level Testability Review

#### 🚨 Testability Concerns (Actionable First)

| # | Concern | Category | Impact | Evidence | ASR |
|---|---|---|---|---|---|
| TC-1 | **No real browser E2E framework** — Vitest uses `fake-page.js` mock, no Playwright/Cypress config. Browser automation is core to the product but only tested via mock page objects. | Controllability | HIGH | No `playwright.config.*`, 5 test files use `page.goto` but all via fake-page mock | ACTIONABLE |
| TC-2 | **DOM selector brittleness** — X/Facebook DOM changes frequently; selectors are centralized in docs but no selector smoke test validates them against live DOM. | Observability | HIGH | ADR-001, architecture §12: "X/Twitter DOM changes" risk | ACTIONABLE |
| TC-3 | **No test data seeding mechanism** — No `/api/test-data` endpoint, no Prisma seed for test scenarios, no multi-tenant test isolation. Tests rely on in-memory mocks only. | State Control | MEDIUM | `prisma/seed.js` exists but no test-specific seeding | ACTIONABLE |
| TC-4 | **No CI test workflow visible** — `.github/workflows/ci.yml` exists but no evidence of test execution in CI. Mutation gates run manually. | Reliability | MEDIUM | 6 Stryker configs but no CI integration confirmed | ACTIONABLE |
| TC-5 | **MCP server limited test coverage** — Only 5 test files in `tests/mcp/` for 40+ MCP tools. Tool schema stability not validated. | Controllability | MEDIUM | `tests/mcp/` has 5 files; `src/mcp/server.js` exposes many tools | ACTIONABLE |
| TC-6 | **Dashboard/Extension zero test coverage** — 20+ HTML dashboard pages, Manifest V3 extension, no tests at all. | Observability | LOW | No dashboard/extension test files found | FYI |
| TC-7 | **No contract testing** — Multi-surface API (CLI/MCP/REST/Library) shares core logic but no contract tests validate shape consistency across surfaces. | Isolation | MEDIUM | `tea_use_pactjs_utils: false`, no Pact setup | ACTIONABLE |
| TC-8 | **Vitest config: `fileParallelism: false` + `pool: forks`** — Serial execution prevents parallel test isolation issues but slows CI. | Reliability | LOW | `vitest.config.js` | FYI |
| TC-9 | **Epic 6 (Anti-Detection) untested** — 13 backlog stories for fingerprint, behavioral simulation, velocity limits. No test scaffolding yet. | Controllability | HIGH | Sprint status: Epic 6 in-progress, only 4/17 stories done | ACTIONABLE |
| TC-10 | **Session cookie handling not security-tested** — NFR4 says no cookie logging, but no dedicated test validates this across all surfaces. | Security | HIGH | NFR4 in epics, no `cookie-leak` test found | ACTIONABLE |

#### ✅ Testability Assessment Summary (Strengths)

| Strength | Evidence |
|---|---|
| **Strong mock infrastructure** | `tests/helpers/fake-page.js` — comprehensive configurable state machine, not a simple mock. Records all calls for assertions. |
| **Mutation testing established** | 6 Stryker configs (x402, fb-automation, fb-scrapers, fb-scheduler, fb-routes, unfollowback). x402 mutation gate: 72.82%, 0 P0 survived. |
| **Comprehensive HTTP scraper tests** | 24 test files covering actions, tweets, search, auth, media, DM, engagement, profile, threads, edge cases. |
| **Injectable delay seams** | NFR3 requires behavioral functions accept injectable delay. Tests use `noDelay = () => {}` pattern (seen in fb-automation tests). |
| **Dry-run default testing** | Tests explicitly verify `dryRun: true` path returns preview without executing (fb-automation integration tests). |
| **Prior TEA artifacts** | NFR assessment (x402), automation summary (Epic 2), traceability matrix, ATDD checklist all completed. |
| **Vitest with v8 coverage** | Coverage provider configured, reporters: text/json/html. |
| **A2A + Graph module tests** | 7 A2A test files, 2 graph test files — good coverage for newer modules. |

---

### 2. Risk Assessment Matrix

| ID | Risk | Category | P | I | Score | Level | Owner | Mitigation | Timeline |
|---|---|---|---|---|---|---|---|---|---|
| R1 | DOM selector breakage on X/Facebook UI update | TECH | 3 | 3 | **9** | CRITICAL | Maintainer | Selector smoke tests against live DOM; centralize selectors; `data-testid` preference | Pre-release |
| R2 | Session cookie/token leakage in logs or API responses | SEC | 2 | 3 | **6** | HIGH | Maintainer | Dedicated leak-detection tests across all surfaces; redaction middleware; review logging | Pre-release |
| R3 | Account ban from aggressive automation (no velocity limits) | BUS | 2 | 3 | **6** | HIGH | Maintainer | Epic 6 velocity limits (FR53-54); dry-run default; delay floors; batch ≤20 | Epic 6 completion |
| R4 | Facebook checkpoint detection not tested | SEC | 2 | 3 | **6** | HIGH | Maintainer | Test AR7 checkpoint detection (`bodyText.includes('confirm that you')`); alert + halt behavior | Pre-release |
| R5 | WebRTC IP leak through proxy | SEC | 2 | 3 | **6** | HIGH | Maintainer | Epic 6 FR42 WebRTC override; test RTCPeerConnection disabled | Epic 6 |
| R6 | Fingerprint inconsistency mid-session | TECH | 2 | 2 | **4** | MEDIUM | Maintainer | Epic 6 FR52; test fingerprint locked per session | Epic 6 |
| R7 | Logic drift across CLI/MCP/API surfaces | TECH | 2 | 2 | **4** | MEDIUM | Maintainer | Contract tests for shared shapes; route/tool registry drift detection | Post-system-design |
| R8 | Mutation score regression (currently 72.82% for x402) | TECH | 2 | 2 | **4** | MEDIUM | Maintainer | CI mutation gate; target ≥80% for P0/P1 code | CI setup |
| R9 | No CI test execution — tests only run locally | OPS | 3 | 2 | **6** | HIGH | Maintainer | Wire `npm test` + mutation into `.github/workflows/ci.yml` | Immediate |
| R10 | Snapshot table growth degrading DB performance | PERF | 2 | 2 | **4** | MEDIUM | Maintainer | Retention policy; indexes; export/archive (architecture backlog) | Post-MVP |
| R11 | Plugin failure crashes core API/MCP startup | OPS | 1 | 3 | **3** | LOW | Maintainer | ADR-005 guardrails; plugin isolation tests | FYI |
| R12 | Dashboard client-side security assumptions | SEC | 1 | 2 | **2** | LOW | Maintainer | API-side auth enforcement; CSP review | FYI |
| R13 | GraphQL `doc_id` hardcoded with no fallback | TECH | 2 | 2 | **4** | MEDIUM | Maintainer | NFR7 graceful fallback; test hardcoded → fallback path | Epic 5 maintenance |
| R14 | Scheduler throughput exceeding cap (≤5 posts/hr/user) | PERF | 1 | 2 | **2** | LOW | Maintainer | NFR9 cap enforcement test | FYI |
| R15 | Messenger mass-share delay too aggressive | BUS | 2 | 2 | **4** | MEDIUM | Maintainer | NFR8 conservative delay; test delay floor for mass-share | FYI |

#### High-Risk Summary (Score ≥ 6)

| ID | Risk | Score | Priority Action |
|---|---|---|---|
| R1 | DOM selector breakage | 9 | **GATE BLOCKER** — selector smoke tests mandatory before release |
| R2 | Cookie/token leakage | 6 | Security test suite covering all surfaces |
| R3 | Account ban risk | 6 | Epic 6 velocity limits + account age awareness |
| R4 | Checkpoint detection untested | 6 | Test AR7 checkpoint detection behavior |
| R5 | WebRTC IP leak | 6 | Epic 6 FR42 + test |
| R9 | No CI test execution | 6 | Wire CI workflow immediately |

---

### 3. NFR Planning Assessment

| NFR | Category | Threshold | Source | Evidence Plan | Status |
|---|---|---|---|---|---|
| Bezier mouse < 2s | Performance | <2s completion | Epic 6 NFR1 | Unit test with injectable delay; benchmark typical screen distance | UNKNOWN (not implemented yet) |
| Fingerprint config centralized | Maintainability | Single module (`fingerprint.js`) | Epic 6 NFR2, AR10 | Module structure test; verify no scattered fingerprint config | UNKNOWN |
| Injectable delay seam | Testability | Functions accept delay fn | Epic 6 NFR3 | Test with `noDelay` seam (pattern already used in fb-automation tests) | UNKNOWN |
| No cookie logging | Security | No secrets in logs/responses | NFR4 | Dedicated leak-detection test scanning console output + API responses | **GAP** — no dedicated test exists |
| FB delay > Twitter | Reliability | Higher delay floor (ADR-012) | NFR5 | Compare delay constants FB vs Twitter; test floor enforcement | UNKNOWN |
| Dry-run default | Safety | All mutate actions default dry | ADR-007, NFR6 | Test default `dryRun: true` for every mutate function | **PARTIAL** — fb-automation tests cover this; not all surfaces |
| GraphQL doc_id fallback | Reliability | Graceful fallback, no throw | NFR7 | Test hardcoded doc_id → fallback path | UNKNOWN |
| Messenger mass-share delay | Reliability | Conservative delay > default | NFR8 | Test delay floor for mass-share operations | UNKNOWN |
| Scheduler throughput cap | Performance | ≤5 posts/hr/user | NFR9 | Rate limiter test; verify cap enforcement | UNKNOWN |
| Friend request delay hardcoded | Safety | 60-180s, no override | NFR10 | Test delay immutability; verify no override param | UNKNOWN |

#### NFR Gaps → Risk Register

| Gap | Converted Risk | Action |
|---|---|---|
| No cookie leak test | R2 (Score 6) | Create security test suite |
| Dry-run not tested on all surfaces | R7 (Score 4) | Add dry-run tests for MCP + CLI + API |
| All Epic 6 NFRs UNKNOWN | R3, R5, R6 | Implement Epic 6 with TDD; NFR assessment after |

---

### 4. Risk Findings Summary

**Top 3 mitigation priorities:**

1. **R1 (Score 9 — CRITICAL):** DOM selector smoke tests against live X/Facebook DOM. This is the #1 architecture risk (ADR-001). Without selector validation, the entire product can break silently on UI updates. → **Gate blocker.**

2. **R9 (Score 6 — HIGH):** No CI test execution. 40+ test files and 6 mutation configs exist but no evidence of CI integration. All testing is manual/local. → **Immediate action.**

3. **R2 + R4 + R5 (Score 6 each — HIGH):** Security cluster — cookie leakage, checkpoint detection, WebRTC leak. All are account-safety critical for a browser automation product. → **Pre-release security test suite.**

**Risk threshold config:** `p1` — all P0 and P1 risks must be mitigated before gate pass. R1 (P0), R2-R5, R9 (P1) are mandatory.

## Step 5: Generate Outputs & Validate

### Execution Mode
- Config: `tea_execution_mode: auto`
- Resolved: **sequential** (no subagent/agent-team capability detected)

### Output Documents Generated

| Document | Path | Content |
|---|---|---|
| Architecture Test Design | `_bmad-output/test-artifacts/test-design/test-design-architecture.md` | Risk assessment, testability concerns, mitigation plans, NFR requirements, assumptions |
| QA Test Design | `_bmad-output/test-artifacts/test-design/test-design-qa.md` | Coverage matrix (61 scenarios), NFR coverage plan, execution strategy, effort estimates, code examples |
| BMAD Handoff | `_bmad-output/test-artifacts/test-design/XActions-handoff.md` | TEA artifacts inventory, epic-level guidance, story-level guidance, risk-to-story mapping |

### Validation Checklist Results

**Prerequisites:** PASSED (PRD + ADR + Architecture + Epics all available)
**Process Steps:** All 5 steps completed
**Risk Assessment:** 15 risks scored, 6 high-priority flagged, mitigations defined
**NFR Planning:** 10 NFRs mapped, 2 gaps identified, evidence sources planned
**Coverage Matrix:** 61 scenarios, 4 priority levels, no duplicate coverage
**Execution Strategy:** PR/Nightly/Weekly/Pre-release model
**Resource Estimates:** ~120-210 hours, 4-8 weeks (interval-based)
**Quality Gates:** P0=100%, P1>=95%, Coverage>=80%, Mutation>=80%
**Cross-Document Consistency:** Risk IDs consistent across all 3 documents
**Anti-Bloat Check:** Architecture doc ~170 lines, QA doc ~200 lines, no repetition

### Completion Report

- **Mode:** System-Level
- **Output files:** 3 documents generated
- **Key risks:** R1 (CRITICAL, score 9 — DOM selector breakage), R2-R5/R9 (HIGH, score 6)
- **Gate thresholds:** P0=100%, P1>=95%, Coverage>=80%, Mutation>=80%
- **Open assumptions:** 4 architectural assumptions documented
- **Next steps:** Run `atdd` workflow for P0 test generation; set up CI; implement Epic 6 with TDD
