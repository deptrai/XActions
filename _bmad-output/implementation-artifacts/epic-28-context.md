# Epic 28 Context: Schema Drift & Selector Resilience

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 28 hardens scraper data quality and selector resilience across supported social platforms (Twitter/X, Facebook, YouTube, Threads). It wraps existing crawlers with runtime schema validation, automated drift classification (`complete`, `degraded`, `corrupted`), proactive periodic DOM probing, and assisted selector re-discovery. This ensures scrapers fail fast on corrupted contracts, flag partial degradation transparently, and surface UI structural changes before silent data loss affects downstream consumers.

## Stories

- Story 28.1: SchemaDriftGuard — Runtime Contract Validation & Completeness Classification
- Story 28.2: SelectorCanary — Periodic DOM Probe & Drift Alert
- Story 28.3: AutoSelectorFallback — Assisted Selector Re-Discovery

## Requirements & Constraints

- **Runtime Contract Validation:** Every crawler item (`PostItem`, `ProfileItem`, `CommentItem`) must be validated against its registered schema during `validateItem()`.
- **Completeness Classification:** Scraper output must be classified into three distinct health tiers:
  - `complete`: all required fields present, zero type errors, quality score >= 95.
  - `degraded`: all required fields present, quality score >= 70, but missing optional fields or non-critical values. Items are stored with metadata `dataQuality: { score, missingFields }`.
  - `corrupted`: missing any required field or quality score < 70. Processing must abort by throwing `PlatformError` with `ErrorTypes.DEGRADED_DATA` and suggested action `RETRY_WITH_DIFFERENT_ACCOUNT`.
- **Zero New Dependencies:** Validation must reuse the existing ESM `validateSchemaNode` engine in `src/core/metadata-schema-registry.js`. No third-party schema validation libraries (Zod, Ajv).
- **Proactive DOM Canary:** A scheduled background job periodically probes live DOM selectors against public test targets (Twitter/X, Facebook, YouTube, Threads) defined in configuration.
- **Drift Alerting & Governor Integration:** If a platform's canary success rate drops below 80% across two consecutive runs, trigger an alert via existing notification channels and expose drift status via `AdaptiveRateGovernor.getStatus()` and `status-api`.
- **Assisted Selector Re-Discovery:** When DOM drift occurs, provide an automated heuristic analyzer to inspect live page snapshots, match elements against expected output shapes, and rank candidate replacement selectors.
- **Selector Priority:** Heuristic selector generation must prioritize stable identifiers (`data-testid` -> `role`/`aria-*` -> semantic HTML structure) and strictly discard obfuscated or hash-only class names.

## Technical Decisions

- **Quality Score Formula:**
  `Score = max(0, 100 - (missingRequired * 35) - (typeErrors * 15) - (missingOptional * 5))`
  Classification thresholds:
  - `corrupted`: `missingRequired > 0` or `Score < 70`
  - `complete`: `missingRequired === 0` and `typeErrors === 0` and `Score >= 95`
  - `degraded`: otherwise (`missingRequired === 0` and `Score >= 70`)
- **Error Envelope Standardization:** Add `DEGRADED_DATA: 'degraded_data'` to `ErrorTypes` in `src/core/error-envelope.js`.
- **Guard Architecture & File Location:** Implement `SchemaDriftGuard` at `src/core/schema-drift-guard.js`, integrating directly with `src/core/base-crawler.js` (`AbstractCrawler.validateItem`).
- **Canary Service & Target Configuration:**
  - Background worker located at `src/services/selector-canary.js`, running as a Bull repeatable job (via `api/services/jobQueue.js`) or fallback `setInterval` when Redis is unavailable.
  - Public test URLs configured in `config/canary-targets.json` covering public profiles and feeds for Twitter, Facebook, YouTube, and Threads.
  - State exposed via `governor.getStatus()` under `platformDrift[platform] = { alert, successRate, lastProbe }`.
- **Selector Re-Discovery Engine & CLI Wiring:**
  - Core engine located at `src/core/auto-selector-fallback.js` using heuristic tree search, element shape matching, and Levenshtein/substring similarity.
  - Exposed via Commander CLI command in `src/cli/commands/tools.js` (or `src/cli/commands/schema.js`):
    `xactions tools suggest-selector --platform <platform> --url <url> --field <field>`
- **Type Definitions:** Update `types/core.d.ts` to export TypeScript definitions for `SchemaDriftGuard`, `DriftClassification`, and `SelectorCanaryResult`.

## UX & Interaction Patterns

- **Admin Dashboard Indicator:**
  - `dashboard/admin.html` displays a per-platform drift status badge/indicator (green OK / red drift alert) within the existing status / stream views.
- **CLI Feedback:**
  - `xactions tools suggest-selector` outputs ranked candidate selectors with confidence scores (0.0–1.0) and selector stability rationale.

## Cross-Story Dependencies

- **Story 28.1 (SchemaDriftGuard)** is foundational. It establishes `ErrorTypes.DEGRADED_DATA` and item validation contracts required across all scrapers before runtime alerts or fallbacks can properly classify payload states.
- **Story 28.2 (SelectorCanary)** relies on fallback selector chains documented in `docs/agents/selectors.md` and feeds drift status into `AdaptiveRateGovernor` and admin dashboards.
- **Story 28.3 (AutoSelectorFallback)** operates on top of flagged drifts detected by `SelectorCanary`, assisting developers in finding replacement selectors and updating target configs.
- **Downstream Epic Compatibility:** Provides guaranteed schema and selector integrity required by upcoming push-based adapters in Epic 29 (Real-Time Social Event Streaming) and cross-platform publishers in Epic 30.
