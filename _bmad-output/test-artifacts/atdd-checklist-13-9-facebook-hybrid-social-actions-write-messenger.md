---
storyId: "13.9"
storyKey: "13-9-facebook-hybrid-social-actions-write-messenger"
storyFile: "_bmad-output/implementation-artifacts/13-9-facebook-hybrid-social-actions-write-messenger.md"
atddChecklistPath: "_bmad-output/test-artifacts/atdd-checklist-13-9-facebook-hybrid-social-actions-write-messenger.md"
stepsCompleted:
  - 'step-01-preflight-and-context'
  - 'step-02-generation-mode'
  - 'step-03-test-strategy'
  - 'step-04-generate-tests'
  - 'step-05-validate-and-complete'
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-08-27'
generatedTestFiles:
  - "tests/scrapers/social/facebook/crawler-actions.test.js"
inputDocuments:
  - "_bmad-output/implementation-artifacts/13-9-facebook-hybrid-social-actions-write-messenger.md"
  - "_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md"
  - "src/scrapers/social/facebook/crawler.js"
  - "src/scrapers/social/facebook/client.js"
  - "src/scrapers/social/facebook/signer-bridge.js"
---

# ATDD Checklist — Story 13.9: Facebook Hybrid Social Actions (Write & Messenger)

## Test Scenarios & Acceptance Criteria Mapping

| ID | Category | Scenario Description | Priority | Test File | Target AC |
|---|---|---|:---:|---|:---:|
| **TS-13.9-01** | ActionRegistry | Register all 8 write actions (`like`, `comment`, `post`, `share`, `messenger_share`, `share_link_uid`, `join_group`, `send_friend_request`) with `requiresAuth: true` | P0 | `tests/scrapers/social/facebook/crawler-actions.test.js` | AC-1 |
| **TS-13.9-02** | Velocity | `FacebookActionVelocityTracker` enforces sliding window per-action limits (`like ≤ 30/hr`, `comment ≤ 10/hr`, `post ≤ 5/hr`, `send_friend_request ≤ 20/day`) | P0 | `tests/scrapers/social/facebook/crawler-actions.test.js` | AC-2, AC-10 |
| **TS-13.9-03** | Batch Runner | `runGuardedActionBatch` checks governor per item and enforces delay jitter | P0 | `tests/scrapers/social/facebook/crawler-actions.test.js` | AC-2, AC-10 |
| **TS-13.9-04** | Like | `like` action validates Facebook post URL (rejects non-FB URL with `XACT_4001`) and defaults to `dryRun: true` | P0 | `tests/scrapers/social/facebook/crawler-actions.test.js` | AC-3, AC-10 |
| **TS-13.9-05** | Comment | `comment` action rejects empty text or >8000 chars and defaults to `dryRun: true` | P0 | `tests/scrapers/social/facebook/crawler-actions.test.js` | AC-4 |
| **TS-13.9-06** | Post | `post` action validates group/profile targets, rejects non-FB group URLs, and defaults to `dryRun: true` | P0 | `tests/scrapers/social/facebook/crawler-actions.test.js` | AC-5 |
| **TS-13.9-07** | Share | `share` action validates post URL and defaults to `dryRun: true` | P1 | `tests/scrapers/social/facebook/crawler-actions.test.js` | AC-6 |
| **TS-13.9-08** | Messenger | `messenger_share` handles multiple recipient UIDs; `share_link_uid` serves as single-recipient alias | P0 | `tests/scrapers/social/facebook/crawler-actions.test.js` | AC-7 |
| **TS-13.9-09** | Join Group | `join_group` resolves group ID and rejects invalid group URLs with `XACT_4001` | P1 | `tests/scrapers/social/facebook/crawler-actions.test.js` | AC-8 |
| **TS-13.9-10** | Friend Request | `send_friend_request` validates profile URLs/UIDs and defaults to `dryRun: true` | P1 | `tests/scrapers/social/facebook/crawler-actions.test.js` | AC-9 |
| **TS-13.9-11** | Auth Gate | Reject write execution without authenticated account session (`XACT_4010`) | P0 | `tests/scrapers/social/facebook/crawler-actions.test.js` | AC-11 |
| **TS-13.9-12** | Deprecation | Legacy write modules in `src/scrapers/facebook/` are marked `@deprecated` | P2 | `tests/scrapers/social/facebook/crawler-actions.test.js` | AC-12 |

## Red-Phase Execution Status

- **Status:** Scaffolded & Ready for Red Phase Verification
- **Test File:** `tests/scrapers/social/facebook/crawler-actions.test.js`
- **Expected Outcome:** Tests fail before implementation (missing modules / actions in `crawler.js` and `actions.js`).
