# Epic 28 Context: Schema Drift & Selector Resilience

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 28 hardens scraper data quality and selector resilience across supported platforms. It wraps existing crawlers with runtime schema validation, automated drift classification (`complete`, `degraded`, `corrupted`), proactive periodic DOM probing via lightweight browser backend (Obscura with Chrome fallback), and assisted selector re-discovery. This ensures scrapers fail fast on corrupted contracts, flag partial degradation transparently, and surface UI structural changes before silent data loss affects downstream consumers.

## Stories

- Story 28.1: SchemaDriftGuard — Runtime Contract Validation & Completeness Classification (Status: done)
- Story 28.2: SelectorCanary — Periodic DOM Probe & Drift Alert (Status: in-progress)
- Story 28.3: AutoSelectorFallback — Assisted Selector Re-Discovery (Status: backlog)

## Requirements & Constraints

- **Runtime Contract Validation (28.1):** Every crawler item (`PostItem`, `ProfileItem`, `CommentItem`) must be validated against its registered schema during `validateItem()`.
- **Completeness Classification (28.1):** Scraper output is classified into three distinct health tiers:
  - `complete`: all required fields present, zero type errors, quality score === 100.
  - `degraded`: all required fields present, zero type errors, missing optional fields (capped at 20 deduction, score >= 70). Items are stored with metadata `dataQuality: { score, missingFields, classification: 'degraded' }`.
  - `corrupted`: missing any required field, any type error, or quality score < 70. Throws `PlatformError(ErrorTypes.DEGRADED_DATA)` with suggested action `RETRY_WITH_DIFFERENT_ACCOUNT`.
- **Zero New Dependencies:** Validation reuses the existing ESM `validateSchemaNode` engine in `src/core/metadata-schema-registry.js`. No third-party schema validation libraries (Zod, Ajv).
- **Proactive DOM Canary (28.2):** A scheduled background job periodically probes live DOM selectors against public test targets defined in configuration.
  - **Browser Backend:** Leverages pluggable stealth browser with Obscura as primary engine (`{ backend: 'obscura', fallbackBackend: 'chrome' }`) for minimal resource footprint (~30MB RAM), falling back to Chrome if Obscura fails.
  - **Target Selection:** Focuses on platforms with live DOM extraction requirements (Twitter/X, Facebook guest/mbasic, and web scrapers) configured in `config/canary-targets.json`.
- **Drift Alerting & Governor Integration (28.2):** If a platform's canary success rate drops below 80% across two consecutive runs, trigger an alert via existing notification channels and expose drift status via `AdaptiveRateGovernor.getStatus()` and `status-api`.
- **Assisted Selector Re-Discovery (28.3):** When DOM drift occurs, provide an automated heuristic analyzer to inspect live page snapshots, match elements against expected output shapes, and rank candidate replacement selectors.
  - Snapshot extraction works via DOM serialization / `page.content()` compatible with both Obscura and Chrome.
- **Selector Priority (28.3):** Heuristic selector generation must prioritize stable identifiers (`data-testid` -> `role`/`aria-*` -> semantic HTML structure) and strictly discard obfuscated or hash-only class names.

## Technical Decisions

- **Quality Score Formula (Finalized in 28.1):**
  `Score = max(0, 100 - (missingRequired * 35) - (typeErrors * 15) - min(20, missingOptional * 5))`
  Classification thresholds:
  - `corrupted`: `missingRequired > 0` or `typeErrors > 0` or `Score < 70`
  - `complete`: `missingRequired === 0` and `typeErrors === 0` and `missingOptional === 0` (Score === 100)
  - `degraded`: `missingRequired === 0` and `typeErrors === 0` and `missingOptional > 0` (Score in [80, 95])
- **Discriminator-based Item Type Inference:**
  - `postId` present -> `comment-item`
  - `authorId` present OR (`category` present and !== 'profile') -> `post-item`
  - otherwise -> `profile-item`
- **Error Envelope Standardization:** Added `DEGRADED_DATA: 'degraded_data'` to `ErrorTypes` and `RETRY_WITH_DIFFERENT_ACCOUNT` to `SuggestedActions` in `src/core/error-envelope.js`.
- **Canary Service & Target Configuration (28.2):**
  - Background worker located at `src/services/selector-canary.js`, running as a Bull repeatable job (via `api/services/jobQueue.js`) or fallback `setInterval` when Redis is unavailable.
  - Browser instantiation via `createStealthBrowser({ backend: 'obscura', fallbackBackend: 'chrome' })`.
  - Public test URLs configured in `config/canary-targets.json`.
  - State exposed via `governor.getStatus()` under `platformDrift[platform] = { alert, successRate, lastProbe, lastWorkingSelector }`.
- **Selector Re-Discovery Engine & CLI Wiring (28.3):**
  - Core engine located at `src/core/auto-selector-fallback.js` using heuristic tree search, element shape matching, and Levenshtein/substring similarity.
  - Exposed via Commander CLI command in `src/cli/commands/tools.js` (or `src/cli/commands/schema.js`):
    `xactions tools suggest-selector --platform <platform> --url <url> --field <field> [--backend <obscura|chrome>]`
- **Type Definitions:** Export TypeScript definitions for `SchemaDriftGuard`, `DriftClassification`, `SelectorCanaryResult`, and `CanaryTargetConfig` in `types/core.d.ts`.

## UX & Interaction Patterns

- **Admin Dashboard Indicator:**
  - `dashboard/admin.html` displays a per-platform drift status badge/indicator (green OK / red drift alert) within the existing status / stream views.
- **CLI Feedback:**
  - `xactions tools suggest-selector` outputs ranked candidate selectors with confidence scores (0.0–1.0) and selector stability rationale.

## Cross-Story Dependencies

- **Story 28.1 (SchemaDriftGuard - DONE):** Established `ErrorTypes.DEGRADED_DATA`, canonical schemas, and item validation contracts across all crawlers.
- **Story 28.2 (SelectorCanary):** Relies on fallback selector chains documented in `docs/agents/selectors.md` and pluggable stealth browser (Obscura + Chrome) to feed drift status into `AdaptiveRateGovernor` and admin dashboards.
- **Story 28.3 (AutoSelectorFallback):** Operates on top of flagged drifts detected by `SelectorCanary`, assisting developers in finding replacement selectors and updating target configs.
