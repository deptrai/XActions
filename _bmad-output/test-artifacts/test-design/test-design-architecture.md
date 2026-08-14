# XActions — System-Level Test Design: Architecture

**Purpose:** Contract between Test Architecture and Development teams. Defines WHAT must be testable and WHY, based on risk. Does NOT contain test implementation code.

**Project:** XActions | **Mode:** System-Level | **Date:** 2026-08-12 | **Author:** Murat (TEA)

---

## Executive Summary

XActions is a brownfield multi-platform social automation toolkit (Node.js ESM, Express, Puppeteer+Stealth, Prisma/PostgreSQL, Redis/Bull). Seven epics span Facebook scraping, automation, multi-surface exposure, growth, Messenger, marketplace, and anti-detection. Epics 1–5b are done; Epic 6 (Anti-Detection) is in-progress.

**Scope:** Full system — 7 surfaces (Browser/CLI/MCP/API/Dashboard/Extension/Library), 54 FRs, 10 NFRs, 15 identified risks.

**Key Finding:** 1 CRITICAL risk (DOM selector breakage, score 9) and 5 HIGH risks (score 6) demand immediate action. The product's core dependency on browser automation against frequently-changing DOMs is the dominant architectural risk.

---

## Quick Guide

### BLOCKERS — Team Must Decide

| # | Item | Impact | Owner | Timeline |
|---|---|---|---|---|
| B1 | No selector smoke tests against live X/Facebook DOM | Product breaks silently on UI updates | Maintainer | Pre-release |
| B2 | No CI test execution — 40+ tests exist but run only locally | Regressions ship undetected | Maintainer | Immediate |
| B3 | No cookie/token leak detection test across surfaces | Account compromise risk | Maintainer | Pre-release |
| B4 | Epic 6 anti-detection features untested (13 backlog stories) | Account ban risk for users | Maintainer | Epic 6 completion |

### HIGH PRIORITY — Team Should Validate

| # | Item | Recommendation |
|---|---|---|
| H1 | No contract tests for cross-surface shape consistency | Add contract tests comparing CLI/MCP/API output shapes |
| H2 | Mutation score 72.82% for x402 (target ≥80%) | Tighten mutation gate; add cases for survived mutants |
| H3 | Checkpoint detection (AR7) not tested | Add test for `bodyText.includes('confirm that you')` alert+halt |
| H4 | WebRTC leak prevention (FR42) not implemented/tested | Implement + test as part of Epic 6 |
| H5 | GraphQL doc_id hardcoded with no fallback test (NFR7) | Add fallback path test |

### INFO ONLY — Solutions Provided

| # | Item | Status |
|---|---|---|
| I1 | Vitest config uses `fileParallelism: false` + `pool: forks` | Acceptable for FFI safety; document rationale |
| I2 | Dashboard/Extension have zero test coverage | P3 priority; low risk since API-side auth enforced |
| I3 | `fake-page.js` is a configurable state machine, not a simple mock | Strength — continue pattern for new browser tests |

---

## Risk Assessment

**Total risks identified:** 15 | **CRITICAL (9):** 1 | **HIGH (6):** 5 | **MEDIUM (4):** 6 | **LOW (1-2):** 3

**Risk category legend:** TECH = Architecture/integration | SEC = Security | PERF = Performance | DATA = Data integrity | BUS = Business/revenue | OPS = Deployment/operations

### High-Priority Risks (Score >= 6)

| ID | Category | Description | P | I | Score | Mitigation | Owner | Timeline |
|---|---|---|---|---|---|---|---|---|
| R1 | TECH | DOM selector breakage on X/Facebook UI update | 3 | 3 | **9** | Selector smoke tests against live DOM; centralize selectors; prefer `data-testid` | Maintainer | Pre-release |
| R2 | SEC | Session cookie/token leakage in logs or API responses | 2 | 3 | **6** | Dedicated leak-detection tests; redaction middleware; logging review | Maintainer | Pre-release |
| R3 | BUS | Account ban from aggressive automation (no velocity limits) | 2 | 3 | **6** | Epic 6 velocity limits (FR53-54); dry-run default; delay floors; batch <=20 | Maintainer | Epic 6 |
| R4 | SEC | Facebook checkpoint detection not tested | 2 | 3 | **6** | Test AR7 checkpoint detection; alert + halt behavior | Maintainer | Pre-release |
| R5 | SEC | WebRTC IP leak through proxy | 2 | 3 | **6** | Epic 6 FR42 WebRTC override; test RTCPeerConnection disabled | Maintainer | Epic 6 |
| R9 | OPS | No CI test execution — tests only run locally | 3 | 2 | **6** | Wire `npm test` + mutation into `.github/workflows/ci.yml` | Maintainer | Immediate |

### Medium-Priority Risks (Score 3-4)

| ID | Category | Description | P | I | Score | Mitigation | Owner | Timeline |
|---|---|---|---|---|---|---|---|---|
| R6 | TECH | Fingerprint inconsistency mid-session | 2 | 2 | **4** | Epic 6 FR52; test fingerprint locked per session | Maintainer | Epic 6 |
| R7 | TECH | Logic drift across CLI/MCP/API surfaces | 2 | 2 | **4** | Contract tests for shared shapes; registry drift detection | Maintainer | Post-design |
| R8 | TECH | Mutation score regression (72.82% for x402) | 2 | 2 | **4** | CI mutation gate; target >=80% for P0/P1 | Maintainer | CI setup |
| R10 | PERF | Snapshot table growth degrading DB performance | 2 | 2 | **4** | Retention policy; indexes; export/archive | Maintainer | Post-MVP |
| R13 | TECH | GraphQL doc_id hardcoded with no fallback | 2 | 2 | **4** | NFR7 graceful fallback; test fallback path | Maintainer | Epic 5 maint |
| R15 | BUS | Messenger mass-share delay too aggressive | 2 | 2 | **4** | NFR8 conservative delay; test delay floor | Maintainer | FYI |

### Low-Priority Risks (Score 1-2)

| ID | Category | Description | P | I | Score | Mitigation |
|---|---|---|---|---|---|---|
| R11 | OPS | Plugin failure crashes core startup | 1 | 3 | **3** | ADR-005 guardrails; plugin isolation tests |
| R12 | SEC | Dashboard client-side security assumptions | 1 | 2 | **2** | API-side auth; CSP review |
| R14 | PERF | Scheduler throughput exceeding cap | 1 | 2 | **2** | NFR9 cap enforcement test |

---

## Testability Concerns and Architectural Gaps

### ACTIONABLE CONCERNS

#### Blockers to Fast Feedback

| Concern | Impact | Owner | Timeline |
|---|---|---|---|
| No real browser E2E framework — Vitest uses fake-page mock only | Browser automation is core product but never tested against real browser | Maintainer | Pre-release |
| No test data seeding mechanism — no `/api/test-data`, no test-specific Prisma seed | Long setup times; inability to test edge cases | Maintainer | Post-MVP |
| Epic 6 (Anti-Detection) untested — 13 backlog stories, no test scaffolding | Account safety features ship without validation | Maintainer | Epic 6 |

#### Architectural Improvements Needed

| Improvement | Rationale | Owner | Timeline |
|---|---|---|---|
| Add Playwright or Puppeteer-based selector smoke test suite | R1 (score 9) — DOM changes are #1 risk | Maintainer | Pre-release |
| Wire CI workflow to run `npm test` on every PR | R9 (score 6) — regressions ship undetected | Maintainer | Immediate |
| Create security test suite for cookie/token leak detection | R2 (score 6) — account compromise | Maintainer | Pre-release |
| Add contract tests for cross-surface shape consistency | R7 — logic drift between CLI/MCP/API | Maintainer | Post-design |

### Testability Assessment Summary (FYI)

**What Works Well:**
- `fake-page.js` — comprehensive configurable state machine for browser function testing
- Mutation testing established (6 Stryker configs, x402 gate at 72.82%)
- 24 HTTP scraper test files covering comprehensive Twitter scraping scenarios
- Injectable delay seams (`noDelay` pattern) already used in fb-automation tests
- Dry-run default testing pattern established for Facebook automation
- Prior TEA artifacts: NFR assessment, automation summary, traceability matrix

**Accepted Trade-offs:**
- `fileParallelism: false` + `pool: forks` — serial execution for FFI safety (Stryker/Pact compatibility)
- Static HTML dashboard over framework — simpler deployment, limited testability

---

## Risk Mitigation Plans (High-Priority, Score >= 6)

### R1: DOM Selector Breakage (Score 9 — CRITICAL)

1. Create selector smoke test suite using Puppeteer headless against live X/Facebook DOM
2. Centralize all selectors in `docs/agents/selectors.md` and `docs/agents/selectors-facebook.md`
3. Prefer `data-testid` selectors; document fallback chains
4. Run smoke tests weekly + pre-release (gated by session cookie availability)
- **Owner:** Maintainer | **Timeline:** Pre-release | **Status:** NOT STARTED
- **Verification:** Smoke test suite passes against current live DOM

### R2: Cookie/Token Leakage (Score 6)

1. Create dedicated leak-detection test scanning console output, API responses, and error messages
2. Add redaction middleware for known sensitive field names (`c_user`, `xs`, `auth_token`, `JWT_SECRET`)
3. Audit all `console.log`/`console.error` calls in scraper and service files
- **Owner:** Maintainer | **Timeline:** Pre-release | **Status:** NOT STARTED
- **Verification:** Leak-detection test passes; grep audit finds zero unredacted secrets

### R3: Account Ban Risk (Score 6)

1. Implement Epic 6 velocity limits (FR53: likes <=30/hr, comments <=10/hr, friend req <=20/day)
2. Implement account age awareness (FR54: <7d=50%, 1-4wk=80%)
3. Enforce dry-run default on all mutate functions across all surfaces
4. Maintain delay floors: FB > Twitter (ADR-012), friend request 60-180s (NFR10)
- **Owner:** Maintainer | **Timeline:** Epic 6 completion | **Status:** IN PROGRESS
- **Verification:** Velocity limit tests pass; account age scaling tests pass

### R4: Checkpoint Detection (Score 6)

1. Implement test for AR7: `bodyText.includes('confirm that you') && bodyText.includes('human')`
2. Test alert + halt behavior on checkpoint detection
3. Test graceful error message to user
- **Owner:** Maintainer | **Timeline:** Pre-release | **Status:** NOT STARTED
- **Verification:** Checkpoint detection test passes

### R5: WebRTC IP Leak (Score 6)

1. Implement Epic 6 FR42: disable/override RTCPeerConnection
2. Test that WebRTC is disabled in browser context
3. Test STUN server override if using proxy
- **Owner:** Maintainer | **Timeline:** Epic 6 | **Status:** NOT STARTED
- **Verification:** WebRTC leak test passes

### R9: No CI Test Execution (Score 6)

1. Wire `npm test` into `.github/workflows/ci.yml` on PR trigger
2. Wire mutation gates (6 Stryker configs) into nightly job
3. Add coverage report upload as CI artifact
4. Add P0/P1 pass rate gate to block merges
- **Owner:** Maintainer | **Timeline:** Immediate | **Status:** NOT STARTED
- **Verification:** CI runs tests on PR; merge blocked on P0 failure

---

## NFR Testability Requirements

| NFR | Category | Threshold | Planned Evidence | Status |
|---|---|---|---|---|
| Bezier mouse < 2s | Performance | <2s | Unit test with injectable delay + benchmark | UNKNOWN |
| Fingerprint centralized | Maintainability | Single module | Module structure test | UNKNOWN |
| Injectable delay seam | Testability | Functions accept delay fn | Test with noDelay seam | UNKNOWN |
| No cookie logging | Security | No secrets in logs/responses | Leak-detection test + grep audit | GAP |
| FB delay > Twitter | Reliability | Higher delay floor | Delay constant comparison test | UNKNOWN |
| Dry-run default | Safety | All mutate default dry | Default param test per surface | PARTIAL |
| GraphQL doc_id fallback | Reliability | Graceful, no throw | Fallback path test | UNKNOWN |
| Mass-share conservative delay | Reliability | > default delay | Delay floor test | UNKNOWN |
| Scheduler cap | Performance | <=5 posts/hr/user | Rate limiter test | UNKNOWN |
| Friend req delay hardcoded | Safety | 60-180s, no override | Delay immutability test | UNKNOWN |

---

## Assumptions and Dependencies

### Architectural Assumptions

1. Session cookies (`c_user` + `xs` for Facebook, `auth_token` for Twitter) remain the primary auth mechanism — no migration to OAuth expected.
2. Puppeteer + Stealth remains the browser automation engine — no migration to Playwright for core scraping.
3. PostgreSQL via Prisma remains the durable datastore — no migration to another DB.
4. X/Facebook DOM will continue changing — selector maintenance is an ongoing operational cost.

### Dependencies

| Dependency | Required By | Required Date |
|---|---|---|
| CI workflow setup (`.github/workflows/ci.yml`) | R9 mitigation, all PR tests | Immediate |
| Epic 6 implementation (13 backlog stories) | R3, R5, R6 mitigation, P1-13 through P1-22 | 4-8 weeks |
| Playwright or Puppeteer smoke test infrastructure | R1 mitigation, P0-1, P0-2 | Pre-release |
| Security test suite scaffolding | R2 mitigation, P0-3 | Pre-release |

### Risks to Plan

| Risk | Impact if Delayed | Contingency |
|---|---|---|
| CI setup delayed | Regressions continue shipping undetected | Manual test runs pre-release |
| Epic 6 delayed | Account ban risk remains unmitigated | Reduce default velocity limits as interim measure |
| Selector smoke tests delayed | Silent breakage on next X/Facebook UI update | Manual selector verification pre-release |
