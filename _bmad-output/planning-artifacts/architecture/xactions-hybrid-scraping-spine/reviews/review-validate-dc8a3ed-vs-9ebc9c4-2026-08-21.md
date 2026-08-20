---
title: "Architecture Validation Report — dc8a3ed vs 9ebc9c4"
date: 2026-08-21
intent: validate
---

# Architecture Validation Report

## Target

- **Spine:** `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md`
- **Commits evaluated:**
  - `dc8a3ed` (main) — `docs(planning): remediate 5 critical implementation readiness issues`
  - `9ebc9c4` (backup branch `pre-reset-readiness-2026-08-21`) — `docs: canonicalize architecture and add UX remediation mapping`
- **Scope:** Evaluate architecture-related changes in the last two commits touching the spine.

---

## Verdict

**APPROVED with minor notes.**

The `dc8a3ed` architecture changes are a sound post-reset re-expression of `9ebc9c4`. The spine is now canonical, supersedes the old `architecture.md`, and explicitly absorbs all 10 UX findings from `ARCHITECTURE-UX-REVIEW-2026-08-18.md`.

---

## Mechanical Lint

`lint_spine.py` run on current `ARCHITECTURE-SPINE.md`:

```json
{
  "ok": false,
  "total_findings": 4,
  "by_severity": { "low": 4 },
  "findings": [
    { "detail": "possible unfilled template token (verify): '{domain}'", "location": "line 38" },
    { "detail": "possible unfilled template token (verify): '{platform}'", "location": "line 38" },
    { "detail": "possible unfilled template token (verify): '{platform}'", "location": "line 156" },
    { "detail": "possible unfilled template token (verify): '{platform}'", "location": "line 156" }
  ]
}
```

**Analysis:** The flagged tokens are **false positives**. Lines 38 and 156 use `{domain}` and `{platform}` as example route/path variables inside prose (e.g. `GET /schemas/:platform/:category`, `schemas/<platform>/<category>`). They are not unfilled template tokens. No high-severity findings.

---

## Diff Review

### `dc8a3ed` (main) vs `9ebc9c4` (pre-reset)

| Aspect | `9ebc9c4` | `dc8a3ed` | Assessment |
|---|---|---|---|
| Spine status | `status: canonical` | `status: final` + `canonical: true` | ✅ Improved — `canonical: true` is explicit, `final` matches BMad convention. |
| Supersedes | `replaces: architecture.md` | `supersedes:` list | ✅ Better — `supersedes` is the canonical pattern used elsewhere. |
| UX review links | none | `ux_review:` frontmatter | ✅ Good — makes review lineage explicit. |
| `architecture.md` | not touched | marked `status: deprecated` + `supersededBy` | ✅ Completes canonicalization. |
| Section 8 | not present | Added `## 8. UX Remediation Alignment` | ✅ Excellent — in-spine proof that F1–F10 were adopted into AD-14..AD-19. |
| `ARCHITECTURE-UX-REMEDIATION` | `status: canonical-input`, simpler table | `status: approved`, detailed per-finding, AC | ✅ More rigorous and actionable. |

### Architectural Invariants Changed

1. **AD-4 — PostgreSQL `Post`/`Comment` Storage**
   - Added Rule 6: Metadata Schema Contract for consumers.
   - **Verdict:** Correct. Prevents `metadata` from being a black box for Nowing consumers.

2. **AD-5 — Terminal QR & CDP Attach**
   - Updated Rule 1: Non-TTY fallback (URL + short code / push / webhook).
   - **Verdict:** Correct. Closes F2 operational gap.

3. **AD-7 — MCP HTTP/SSE Daemon + Redis Stream**
   - Added Rule 5: Startup & Operational UX (`xactions daemon start/status/stop`, dashboard tile).
   - **Verdict:** Correct. Closes F1.

4. **AD-8 — Multi-Domain Expansion Blueprint**
   - Scope changed from Epics 10–18 to Epics 10–20.
   - **Verdict:** Correct. Now includes Nowing Cutover (Epic 20) and Operator Dashboard (Epic 19).

5. **Section 8 — UX Remediation Alignment**
   - New table mapping F1–F10 → ADs → adopted status.
   - **Verdict:** Correct. Provides traceability between UX review, architecture, and implementation.

---

## Rubric Walker Findings

### ✅ What the spine does well

1. **Fixes real divergence points:**
   - `AbstractCrawler.listActions()` prevents each platform from inventing its own action API.
   - `AbstractErrorEnvelope.toEnvelope()` prevents AI agents from receiving inconsistent errors.
   - `GovernorStatusApi` shape prevents dashboards/CLI from diverging on metric fields.

2. **Every AD has Binds / Prevents / Rule.**
3. **No contradictory inherited ADs.** The spine inherits from Nowing parent spine and does not weaken any `AD-SOC`.
4. **Named tech is specific:** PostgreSQL, Prisma, Redis, `got-scraping`, `undici`, `qrcode-terminal`, Puppeteer/Playwright.
5. **Operational envelope present:** Deployment via Docker, admin CLI, dashboard, MCP, Redis Stream, retention.

### ⚠️ Findings to consider

| # | Finding | Severity | Recommendation |
|---|---|---|---|
| 1 | `ARCHITECTURE-UX-REMEDIATION-2026-08-21.md` maps F1–F10 to **stories**, but some story ACs in `epics.md` may not yet include the UX-specific AC. | Medium | Reconcile each F# with `epics.md` story ACs before dev starts. |
| 2 | `AD-5` Rule 1 mentions `qrcode-terminal` package, but does not specify fallback to **no external display** on non-TTY beyond URL/short code. | Low | Consider adding a `webhook`/`push` provider hook (AD-level optional) so non-TTY flows don't hard-code a mechanism. |
| 3 | `AD-7` Rule 5 adds daemon CLI commands, but does not bind them to `src/cli/index.js` or specify how they differ from `npm run mcp:daemon`. | Low | Add a `Binds` line for `src/cli/index.js` and a note on lifecycle. |
| 4 | `AD-8` says scope is Epics 10–20, but `src/scrapers/realestate/` only lists Chợ Tốt and Batdongsan. If more real-estate platforms are added, the rule may need `Deferred` expansion. | Low | Already covered by "giới hạn trong phạm vi Epics 10–20"; no action needed unless new platform requested. |

---

## Adversarial Check

**Construct two units one level down that obey every AD yet build incompatibly:**

- **Case A:** Two crawlers implement `AbstractCrawler.listActions()` and return `{ action, description, requiredArgs, example, category }` vs `{ action, description, args, example }`. The AD says `ActionDescriptor[]` but does not pin field names in the Rule.
  - **Finding:** `AD-11` Rule should explicitly list `ActionDescriptor` fields to prevent `args` vs `requiredArgs` drift.

- **Case B:** `PlatformError.toEnvelope()` could return `{ code, type, message }` in one unit and `{ code, type, message, retryAfter, suggestedAction }` in another.
  - **Finding:** `AD-14` Rule already lists the full envelope shape. Good.

- **Case C:** Dashboard and CLI both call `GET /governor/status`, but one expects `healthyProxyCount` and another expects `healthyProxyTotal`.
  - **Finding:** `AD-13` Rule lists the shape. Good.

**Result:** Only one adversarial hole found: `AD-11` action descriptor field names are not pinned. Minor.

---

## Final Recommendation

- **Accept the architecture changes.** They are mechanically sound, fix the UX-to-architecture traceability gap, and properly canonicalize the spine.
- **Optional update:** Tighten `AD-11` Rule to pin `ActionDescriptor` field names (`action`, `description`, `requiredArgs`, `example`, `category`).
- **Optional follow-up:** Reconcile `ARCHITECTURE-UX-REMEDIATION` mapping with `epics.md` story ACs.

---

*Report by BMad Architecture Reviewer, 2026-08-21.*
