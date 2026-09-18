# Technical Specification: Epic 39 (Rescoped) — GitOps Selector Healing Assistant

**Epic:** 39 — Heuristic Selector Drift Canary & GitOps Assistant  
**Stories:** 39.1 (done — config expansion only), 39.2 (rescoped — net-new implementation)  
**Author:** Winston (System Architect)  
**Status:** in-progress  
**Date:** 2026-09-18  
**Scope:** Rescoped after duplication review — ~70% of original Epic 39 was already implemented in Stories 28.2/28.3.

---

## 1. Duplication Review Findings

### 1.1. What Already Exists (No Action Needed)

| Component | Location | Status |
|---|---|---|
| `SelectorCanary` periodic DOM probe | `src/services/selector-canary.js` (442 lines) | ✅ Complete |
| Drift detection (successRate < 0.8, 2 consecutive) | `selector-canary.js:330-350` | ✅ Complete |
| Governor integration (`setPlatformDrift`) | `adaptive-governor.js:792-816` | ✅ Complete |
| Alert dispatch on drift | `selector-canary.js:355-370` | ✅ Complete |
| `AutoSelectorFallback.investigate()` heuristic | `src/core/auto-selector-fallback.js` (682 lines) | ✅ Complete |
| Accessibility/ARIA selector re-discovery | `auto-selector-fallback.js:280-340` | ✅ Complete |
| CLI `tools suggest-selector` manual command | `src/cli/commands/tools.js` | ✅ Complete |
| Canary targets config | `config/canary-targets.json` | ✅ Complete |
| Type definitions (`PlatformDriftStatus`, `SelectorCandidate`) | `types/core.d.ts:894-989` | ✅ Complete |

### 1.2. What Is Actually New (Story 39.2 Scope)

| Component | Purpose | Status |
|---|---|---|
| `xactions canary heal` CLI | Orchestrate healing workflow | 🔲 Net-new |
| `CanaryHealer` service | Detect → Investigate → Validate → Patch → PR | 🔲 Net-new |
| `SelectorSandbox` | Validate candidates in isolated page | 🔲 Net-new |
| Unified-diff generation | Patch file for `canary-targets.json` | 🔲 Net-new |
| GitHub Draft PR creation | Via `gh` CLI or REST API | 🔲 Net-new |
| `expectedShape` in canary targets | Enable sandbox validation | 🔲 Config update |

---

## 2. Architecture Decision

### 2.1. Invariant #4 Compliance

Per `docs/architecture.md` §13.1 Invariant 4 (GitOps-Driven DOM Drift Healing):

> Selectors remain immutable in source control. When `SelectorCanary` detects drift, `AutoSelectorFallback` produces an AST-validated `unified-diff` and automatically generates a GitHub Draft PR. **Direct runtime hot-patching of unverified selectors into Redis is rejected.**

Therefore, the healing flow is strictly:

```
Drift Detected (alert) → Manual `xactions canary heal` → 
Investigate candidates → Sandbox validate → Generate diff → 
Create Draft PR → Human review → Merge → Deploy
```

**Rejected:** Auto-heal on detection (too risky for production).

### 2.2. Separation of Concerns

| Layer | Responsibility | Existing / New |
|---|---|---|
| Detection | Probe, flag drift, alert | ✅ `SelectorCanary` (existing) |
| Investigation | Find candidate selectors | ✅ `AutoSelectorFallback` (existing) |
| Validation | Test candidates in sandbox | 🔲 `SelectorSandbox` (new) |
| Patching | Generate diff + PR | 🔲 `CanaryHealer` + CLI (new) |
| Review | Human merge decision | 🔲 GitHub PR workflow (new) |

---

## 3. Story 39.2 Rescoped Implementation Plan

### 3.1. New Files

```
src/cli/commands/canary.js          # CLI: xactions canary {status|probe|heal}
src/services/canary-healer.js       # Orchestration service
src/services/selector-sandbox.js    # Candidate validation sandbox
src/utils/unified-diff.js           # Diff generation for JSON configs
tests/services/canary-healer.test.js
tests/services/selector-sandbox.test.js
tests/utils/unified-diff.test.js
```

### 3.2. Modified Files

```
src/cli/index.js                    # Add registerCanaryCommand(program)
config/canary-targets.json          # Add expectedShape per target
types/core.d.ts                     # Add HealingResult, PatchCandidate types
docs/architecture.md                # AD-44: GitOps healing flow details
```

### 3.3. CLI Commands

```bash
xactions canary status              # Show platformDrift status from governor
xactions canary probe               # Run manual probe (dry-run, no alert)
xactions canary heal                # Full healing workflow
xactions canary heal --preview      # Show diff without creating PR
xactions canary heal --platform twitter --target twitter-profile
xactions canary heal --output patch.patch  # Write patch file instead of PR
```

### 3.4. CanaryHealer Service

```javascript
export class CanaryHealer {
  /**
   * Full healing workflow for a drifted platform target.
   * @param {string} platform
   * @param {string} targetName
   * @param {Object} opts
   * @param {boolean} opts.preview - Generate diff only, no PR
   * @param {string} opts.output - Write patch to file instead of PR
   * @returns {Promise<HealingResult>}
   */
  async heal(platform, targetName, opts = {}) {
    // 1. Load target config + expectedShape from canary-targets.json
    // 2. Run AutoSelectorFallback.investigate() → ranked candidates
    // 3. For each candidate: SelectorSandbox.validate(url, selector, expectedShape)
    // 4. Pick first validated candidate (or fail with "no valid replacement")
    // 5. Generate unified-diff for canary-targets.json
    // 6. If opts.output → write .patch file
    // 7. Else → create GitHub Draft PR via `gh` CLI
    // 8. Return { healed, patchPath, prUrl, candidates }
  }
}
```

### 3.5. SelectorSandbox

```javascript
export class SelectorSandbox {
  /**
   * Validate a candidate selector against a live page.
   * @param {string} url
   * @param {string} selector
   * @param {ExpectedShape} expectedShape
   * @returns {Promise<{valid: boolean, extractedSample?: string, error?: string}>}
   */
  async validate(url, selector, expectedShape) {
    // Launch headless page
    // await page.goto(url)
    // Try page.$(selector)
    // Verify extracted content matches expectedShape (tagName, attributes, text)
    // Return validation result
  }
}
```

### 3.6. Unified-Diff Generation

```javascript
/**
 * Generate unified-diff for a JSON config file update.
 * @param {string} filePath
 * @param {Object} originalJson
 * @param {Object} patchedJson
 * @returns {string} unified-diff formatted string
 */
export function generateJsonUnifiedDiff(filePath, originalJson, patchedJson) {
  // Line-by-line diff for JSON
  // Format: --- a/path\n+++ b/path\n@@ -start,count +start,count @@\n context\n-removed\n+added
}
```

### 3.7. GitHub PR Creation

```javascript
async function createDraftPR(branchName, title, body, patchPath) {
  // Try `gh pr create --draft --title "${title}" --body "${body}"`
  // Fallback: write patch file + instructions for manual PR
}
```

---

## 4. Config Schema Update

`config/canary-targets.json` adds `expectedShape` per target:

```json
{
  "twitter": [
    {
      "name": "twitter-profile",
      "url": "https://x.com/nasa",
      "selectorChain": ["[data-testid=\"UserName\"]", "..."],
      "expectedShape": {
        "tagName": "div",
        "attributes": { "data-testid": "UserName" }
      }
    }
  ]
}
```

The `expectedShape` is optional — if absent, sandbox validation falls back to "element exists" check only.

---

## 5. Acceptance Criteria (Story 39.2)

- [ ] AC-1: `xactions canary status` displays current drift status for all platforms.
- [ ] AC-2: `xactions canary heal --platform twitter --target twitter-profile` runs full workflow.
- [ ] AC-3: `--preview` flag outputs unified-diff without creating PR.
- [ ] AC-4: `--output` flag writes `.patch` file instead of PR.
- [ ] AC-5: Sandbox validation rejects candidates that don't match `expectedShape`.
- [ ] AC-6: If no valid candidate found, healer creates GitHub Issue (not PR) with investigation details.
- [ ] AC-7: All new code has unit tests (no mocks — use local ephemeral server for sandbox tests).

---

## 6. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Selector candidate extracts wrong data | Mandatory `expectedShape` validation in sandbox |
| `gh` CLI not installed | Fallback to `.patch` file output with instructions |
| Heal triggered on false-positive drift | Require `consecutiveFailures >= 2` + manual confirmation |
| PR created with bad patch | Sandbox validation + human review before merge |

---

## 7. Out of Scope (Explicitly Rejected)

- Auto-heal on drift detection (violates Invariant #4)
- LLM-based selector generation (non-deterministic)
- Redis hot-patching of selectors (runtime injection rejected)
- Multi-file diff (only `canary-targets.json` for now)
- Rollback mechanism (git revert handles this)

---

## 8. Dependencies

- `AutoSelectorFallback` (existing) — for candidate generation
- `SelectorCanary` (existing) — for drift status
- `commander` (existing) — CLI framework
- `child_process` (Node.js built-in) — for `gh` CLI execution
- `puppeteer`/`playwright` (existing) — for sandbox validation

No new npm dependencies required.
