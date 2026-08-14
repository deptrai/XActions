# XActions — System-Level Test Design: QA Strategy

**Purpose:** Test execution recipe. Defines HOW to test, what scenarios to cover, and execution strategy. Cross-references Architecture doc for risk rationale.

**Project:** XActions | **Mode:** System-Level | **Date:** 2026-08-12 | **Author:** Murat (TEA)

---

## Executive Summary

**Risk Summary:** 15 risks identified — 1 CRITICAL (R1: DOM selector breakage, score 9), 5 HIGH (score 6). See `test-design-architecture.md` for full risk register and mitigation plans.

**Coverage Summary:** 61 test scenarios across 4 priority tiers — P0: 10, P1: 25, P2: 21, P3: 5. 42 scenarios are NEW; 19 exist and need verification/maintenance. 14 new scenarios belong to Epic 6 (Anti-Detection).

**Test Stack:** Vitest (unit/integration), fake-page.js (browser mock), Stryker (mutation), no Playwright/Cypress E2E framework yet.

---

## Dependencies and Test Blockers

### Backend/Architecture Dependencies

| Dependency | Needed For | Status | Owner |
|---|---|---|---|
| CI workflow in `.github/workflows/ci.yml` | P1-1, P1-2 (CI integration) | NOT STARTED | Maintainer |
| Playwright or Puppeteer smoke test infra | P0-1, P0-2 (selector smoke) | NOT STARTED | Maintainer |
| Epic 6 implementation (13 stories) | P1-13 through P1-22, P2-11 through P2-16 | IN PROGRESS | Maintainer |
| Security test suite scaffolding | P0-3 (cookie leak detection) | NOT STARTED | Maintainer |

### QA Infrastructure Setup

| Item | Purpose | Status |
|---|---|---|
| `tests/helpers/fake-page.js` | Configurable Puppeteer page mock | EXISTS — extend for new scenarios |
| `tests/helpers/noDelay.js` pattern | Injectable delay seam for fast tests | EXISTS — reuse for Epic 6 behavioral tests |
| Vitest config (`vitest.config.js`) | Test runner, v8 coverage, forks pool | EXISTS — no changes needed |
| Stryker configs (6) | Mutation testing | EXISTS — add Epic 6 config when implemented |
| Prisma test seed | Test data for DB-dependent tests | MISSING — create `prisma/seed.test.js` |

### Code Example: Injectable Delay Pattern (existing)

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { likeFacebookPosts } from '../../api/services/facebookAutomation.js';

const noDelay = () => {};

describe('likeFacebookPosts — real stack integration', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('navigates to post URL and clicks Like button', async () => {
    const page = makeRealPage({ likedSelector: '[aria-label="Like"]' });
    const promise = likeFacebookPosts(page, [url], { dryRun: false, delay: noDelay });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.results[0]).toMatchObject({ target: url, ok: true });
  });
});
```

---

## Risk Assessment (Brief — See Architecture Doc for Details)

### High-Priority Risks (Score >= 6)

| ID | Category | Description | Score | QA Test Coverage |
|---|---|---|---|---|
| R1 | TECH | DOM selector breakage | 9 | P0-1, P0-2 (selector smoke tests) |
| R2 | SEC | Cookie/token leakage | 6 | P0-3 (leak-detection test) |
| R3 | BUS | Account ban risk | 6 | P1-17, P1-18 (velocity limits, account age) |
| R4 | SEC | Checkpoint detection untested | 6 | P0-10 (checkpoint detection test) |
| R5 | SEC | WebRTC IP leak | 6 | P1-15 (WebRTC override test) |
| R9 | OPS | No CI test execution | 6 | P1-1, P1-2 (CI workflow integration) |

### Medium/Low-Priority Risks

| ID | Category | Description | Score | QA Test Coverage |
|---|---|---|---|---|
| R6 | TECH | Fingerprint inconsistency | 4 | P1-19 (fingerprint consistency test) |
| R7 | TECH | Logic drift across surfaces | 4 | P3-5 (cross-surface shape consistency) |
| R8 | TECH | Mutation score regression | 4 | P1-2 (CI mutation gate) |
| R10 | PERF | Snapshot table growth | 4 | Deferred — post-MVP |
| R13 | TECH | GraphQL doc_id fallback | 4 | P1-23 (fallback path test) |
| R15 | BUS | Mass-share delay aggressive | 4 | P2-17 (mass-share delay test) |
| R11 | OPS | Plugin failure crashes startup | 3 | Deferred — FYI |
| R12 | SEC | Dashboard client-side auth | 2 | P3-1 (dashboard HTML load test) |
| R14 | PERF | Scheduler throughput cap | 2 | P1-25 (scheduler cap test) |

---

## Test Coverage Plan

> **Note:** P0/P1/P2/P3 = priority and risk level, NOT execution timing. Execution strategy is defined separately below.

### P0 — Gate Blockers

**Criteria:** Blocks core functionality + high risk (score >= 6) + no workaround

| Test ID | Requirement | Test Level | Risk Link | Notes |
|---|---|---|---|---|
| P0-1 | X/Twitter core selectors valid against live DOM | E2E (browser) | R1 | NEW — gated by session cookie |
| P0-2 | Facebook core selectors valid against live DOM | E2E (browser) | R1 | NEW — gated by session cookie |
| P0-3 | Cookie/token never in logs, console, or API responses | Unit + Integration | R2 | NEW — security test suite |
| P0-4 | Dry-run default on every mutate function, all surfaces | Unit | R7 | PARTIAL — fb-automation only, extend to MCP/CLI/API |
| P0-5 | loginWithCookie sets c_user + xs, rejects missing | Unit | — | EXISTS |
| P0-6 | Dispatcher registers facebook/fb correctly | Unit | — | EXISTS |
| P0-7 | runGuardedBatch enforces batch/retry/stop | Unit | R3 | EXISTS |
| P0-8 | Normalized shape: profile/posts correct fields + platform | Unit | R7 | EXISTS |
| P0-9 | x402 payment middleware: 228 tests pass | Unit + Integration | — | EXISTS |
| P0-10 | Checkpoint detection: alert + halt on 'confirm that you' | Unit | R4 | NEW |

### P1 — Critical Paths

**Criteria:** Critical user journeys + medium/high risk + common workflows

| Test ID | Requirement | Test Level | Risk Link | Notes |
|---|---|---|---|---|
| P1-1 | CI workflow runs npm test on every PR | CI/OPS | R9 | NEW |
| P1-2 | CI runs mutation gate on P0/P1 code | CI/OPS | R8 | NEW |
| P1-3 | MCP tool schema stability — no breaking changes | Unit | R7 | NEW |
| P1-4 | REST API /api/facebook/scrape returns normalized | Integration | R7 | NEW |
| P1-5 | CLI --platform facebook dispatches correctly | Unit | R7 | NEW |
| P1-6 | likeFacebookPosts: EN+VI like, already-liked, not-found | Unit (fake-page) | — | EXISTS |
| P1-7 | commentOnFacebookPosts: text pass-through, dry-run | Unit (fake-page) | — | EXISTS |
| P1-8 | createFacebookPost: dry-run preview, real execution | Unit (fake-page) | — | EXISTS |
| P1-9 | scheduleFacebookPost: Schedule record + worker execute | Integration | — | NEW |
| P1-10 | shareLinkByUid v2: navigate, paste, per-recipient | Unit (fake-page) | — | EXISTS |
| P1-11 | headless param: true=networkidle2/30s, false=domloaded/60s | Unit | — | EXISTS |
| P1-12 | createBrowser auto-resolves Chrome executablePath | Unit | — | EXISTS |
| P1-13 | Epic 6: UA pool 20+ real Chrome UAs, random/consistent | Unit | R3 | NEW |
| P1-14 | Epic 6: Viewport randomized matching UA platform | Unit | R3 | NEW |
| P1-15 | Epic 6: WebRTC leak prevention | Unit | R5 | NEW |
| P1-16 | Epic 6: Navigator overrides (webdriver, CPU, memory, platform) | Unit | — | NEW |
| P1-17 | Epic 6: Velocity limits (likes/comments/friend req) | Unit | R3 | NEW |
| P1-18 | Epic 6: Account age awareness (<7d=50%, 1-4wk=80%) | Unit | R3 | NEW |
| P1-19 | Epic 6: Fingerprint consistency per session | Unit | R6 | NEW |
| P1-20 | Epic 6: Bezier mouse movement < 2s | Unit (injectable delay) | — | NEW |
| P1-21 | Epic 6: Injectable delay seam on all behavioral functions | Unit | — | NEW |
| P1-22 | Epic 6: Session warming sequence | Integration (fake-page) | — | NEW |
| P1-23 | GraphQL doc_id fallback graceful, no throw | Unit | R13 | NEW |
| P1-24 | Friend request delay hardcoded 60-180s, no override | Unit | — | NEW |
| P1-25 | Scheduler throughput cap <=5 posts/hr/user | Unit | — | NEW |

### P2 — Secondary Flows

**Criteria:** Secondary features + low/medium risk + edge cases

| Test ID | Requirement | Test Level | Notes |
|---|---|---|---|
| P2-1 | scrapeFollowers: restricted list returns note | Unit | EXISTS |
| P2-2 | searchTweets: pagination, bounded retry | Unit | EXISTS |
| P2-3 | joinFacebookGroups: batch <=20, delay 60-180s | Unit (fake-page) | NEW |
| P2-4 | postToFacebookGroups: batch post | Unit (fake-page) | NEW |
| P2-5 | scrapeGroupMembers: member list extraction | Unit (fake-page) | NEW |
| P2-6 | sendFriendRequests: batch <=20, conservative delay | Unit (fake-page) | NEW |
| P2-7 | cancelPendingFriendRequests: cancel sent | Unit (fake-page) | NEW |
| P2-8 | warmupScrollFeed: scroll for account warming | Unit (fake-page) | NEW |
| P2-9 | shareFacebookPosts: share via runGuardedBatch | Unit (fake-page) | NEW |
| P2-10 | scrapeMarketplace: multi-currency parsing | Unit | NEW |
| P2-11 | Epic 6: Human click simulation (hover 100-400ms) | Unit (injectable delay) | NEW |
| P2-12 | Epic 6: Typing simulation (typo 1-2%, variable speed) | Unit | NEW |
| P2-13 | Epic 6: Natural scrolling (variable, momentum, overshoot) | Unit | NEW |
| P2-14 | Epic 6: Timezone override matches proxy | Unit | NEW |
| P2-15 | Epic 6: Geolocation override matches proxy | Unit | NEW |
| P2-16 | Epic 6: Persistent browser profiles (userDataDir) | Integration | NEW |
| P2-17 | Messenger mass-share conservative delay | Unit | NEW |
| P2-18 | FB delay floor > Twitter delay floor | Unit | NEW |
| P2-19 | Fingerprint config centralized in single module | Static analysis | NEW |
| P2-20 | A2A server, taskManager, agentCard, bridge, skillRegistry | Unit | EXISTS |
| P2-21 | Plugin loader, Google Sheets, Excel export | Unit | EXISTS |

### P3 — Nice-to-Have / Exploratory

**Criteria:** Nice-to-have, exploratory, benchmarks

| Test ID | Requirement | Test Level | Notes |
|---|---|---|---|
| P3-1 | Dashboard HTML pages load without JS errors | E2E (browser) | NEW |
| P3-2 | Extension manifest V3 validity, content script injection | E2E (browser) | NEW |
| P3-3 | Load test: x402 middleware under high throughput | Performance | EXISTS |
| P3-4 | Selector resilience: fallback selector chains | Exploratory | NEW |
| P3-5 | Cross-surface shape consistency (CLI vs MCP vs API) | Contract | NEW |

---

## NFR Test Coverage Plan

| NFR Category | Requirement/Threshold | Planned Validation | Tool/Level | Evidence Artifact | Priority |
|---|---|---|---|---|---|
| Security | No cookie/token in logs/responses (NFR4) | P0-3 leak-detection test | Unit + Integration | Test report + grep audit | P0 |
| Security | WebRTC disabled/overridden (FR42) | P1-15 WebRTC override test | Unit | Test pass | P1 |
| Security | Checkpoint detection (AR7) | P0-10 checkpoint test | Unit | Test pass | P0 |
| Performance | Bezier mouse < 2s (NFR1) | P1-20 benchmark + injectable delay | Unit | Benchmark report | P1 |
| Performance | Scheduler cap <=5 posts/hr (NFR9) | P1-25 rate limiter test | Unit | Test pass | P1 |
| Performance | x402 load test | P3-3 load test | k6/Performance | Load test report | P3 |
| Reliability | GraphQL doc_id fallback (NFR7) | P1-23 fallback test | Unit | Test pass | P1 |
| Reliability | Friend req delay 60-180s (NFR10) | P1-24 delay immutability test | Unit | Test pass | P1 |
| Reliability | Mass-share conservative delay (NFR8) | P2-17 delay floor test | Unit | Test pass | P2 |
| Reliability | FB delay > Twitter (NFR5) | P2-18 delay comparison test | Unit | Test pass | P2 |
| Maintainability | Fingerprint centralized (NFR2) | P2-19 module structure check | Static analysis | Structure report | P2 |
| Maintainability | Mutation score >= 80% | P1-2 CI mutation gate | Stryker | Mutation report | P1 |
| Testability | Injectable delay seam (NFR3) | P1-21 delay seam test | Unit | Test pass | P1 |
| Safety | Dry-run default all surfaces (NFR6) | P0-4 default param test | Unit | Test pass | P0 |

**Missing thresholds:** None — all NFR thresholds extracted from PRD/epics/ADRs.
**Missing evidence sources:** All Epic 6 NFRs — evidence will be available after implementation. Deferred to `nfr-assess` post-implementation.

---

## Execution Strategy

**Philosophy:** Run everything in PRs if < 15 min. Defer only expensive/long-running suites to nightly/weekly.

| Tier | Cadence | Suites | Est. Duration |
|---|---|---|---|
| **PR** | Every push/PR | All P0 + P1 unit/integration tests (Vitest, fake-page) | ~8-12 min |
| **Nightly** | Once/day | Mutation gates (6 Stryker configs) + P2 tests | ~30-45 min |
| **Weekly** | Once/week | Selector smoke tests (live DOM, gated by env) + P3 exploratory + load tests | ~60-90 min |
| **Pre-release** | Manual trigger | Full suite + NFR evidence collection for `nfr-assess` | ~2-3 hrs |

**Selector smoke test gating:** P0-1, P0-2 require valid session cookies. Skip in CI if `X_SESSION_COOKIE` or Facebook cookies not available. Run manually or weekly with credentials.

---

## QA Effort Estimate

| Priority | Scenario Count | New Scenarios | Est. Effort |
|---|---|---|---|
| P0 | 10 | 4 | ~30-50 hours |
| P1 | 25 | 20 | ~60-100 hours |
| P2 | 21 | 18 | ~25-50 hours |
| P3 | 5 | 5 | ~5-10 hours |
| **Total** | **61** | **42** | **~120-210 hours** |

**Timeline:** ~4-8 weeks (parallel with Epic 6 development)

---

## Implementation Planning Handoff

| Task | Owner | Target | Notes |
|---|---|---|---|
| CI workflow setup | Maintainer | Immediate | Wire `npm test` into ci.yml |
| Selector smoke test suite | Maintainer | Pre-release | Puppeteer headless against live DOM |
| Security test suite (cookie leak) | Maintainer | Pre-release | P0-3 |
| Epic 6 test scenarios (14) | Maintainer | Epic 6 completion | P1-13 through P1-22, P2-11 through P2-16 |
| Contract tests (cross-surface) | Maintainer | Post-design | P3-5 |
| Mutation gate CI integration | Maintainer | CI setup | Nightly Stryker job |

---

## Appendix A: Code Examples and Tagging

### Injectable Delay Pattern (existing — reuse for Epic 6)

```javascript
const noDelay = () => {};
const result = await likeFacebookPosts(page, urls, { dryRun: false, delay: noDelay });
```

### Fake Page Pattern (existing — extend for new scenarios)

```javascript
import { makeFakePage } from '../helpers/fake-page.js';
const page = makeFakePage({
  dom: { '[aria-label="Like"]': { click: vi.fn() } },
  currentUrl: 'https://www.facebook.com/post/1',
});
```

### Test Tagging Convention (recommended)

```javascript
describe('P0 — Cookie leak detection', { tags: ['@P0', '@security'] }, () => { ... });
describe('P1 — Epic 6 velocity limits', { tags: ['@P1', '@epic6', '@safety'] }, () => { ... });
```

---

## Appendix B: Knowledge Base References

| Fragment | Tier | Used For |
|---|---|---|
| `risk-governance.md` | core | Risk scoring matrix, gate decision rules |
| `test-levels-framework.md` | core | Unit/integration/E2E selection |
| `test-quality.md` | core | Test DoD: deterministic, isolated, <1.5min, <300 lines |
| `nfr-criteria.md` | extended | NFR status definitions |
| `adr-quality-readiness-checklist.md` | extended | 8-category 29-criteria testability framework |
