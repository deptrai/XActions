---
stepsCompleted:
  - 'step-01-preflight-and-context'
  - 'step-02-generation-mode'
  - 'step-03-test-strategy'
  - 'step-04-generate-tests'
  - 'step-05-validate-and-complete'
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-08-29'
storyId: '15.1.1'
storyKey: '15-1-1-threads-hybrid-profile-followers-following'
storyFile: '_bmad-output/implementation-artifacts/15-1-1-threads-hybrid-profile-followers-following.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-15-1-1-threads-hybrid-profile-followers-following.md'
generatedTestFiles:
  - 'tests/scrapers/social/threads/profile.test.js'
inputDocuments:
  - '_bmad-output/implementation-artifacts/15-1-1-threads-hybrid-profile-followers-following.md'
  - 'src/scrapers/social/threads/crawler.js'
  - 'src/scrapers/social/threads/client.js'
  - 'src/scrapers/social/facebook/normalize-profile.js'
  - 'tests/scrapers/social/facebook/crawler-profile.test.js'
---

# ATDD Checklist: Story 15.1.1 — Threads Hybrid Profile & Followers/Following

## 1. Context & Preflight Summary

- **Story ID:** 15.1.1
- **Story Key:** `15-1-1-threads-hybrid-profile-followers-following`
- **Detected Stack:** Backend (Node.js / Vitest / Hybrid GraphQL & SSR Scraper)
- **Test Framework:** Vitest (`vitest run`)
- **Key Constraints:**
  - Zero mocks / stubs / fakes. Use real `http.createServer` for test responses.
  - Re-use `Post` table via `profileItemToPostItem` conversion.
  - Public-list limitation fallback (return counts + note if list unavailable).
  - Checkpoint and Redis Stream thin event emission (`storageRef`).
  - TypeScript strict mode compliance.

## 2. Generation Mode

- **Selected Mode:** AI Generation (Backend / Protocol & Parser scaffolding)
- **Rationale:** Stack là Node.js backend & hybrid HTTP/GraphQL scraping engine, các scenarios kiểm thử bao gồm action registration, GraphQL parsing, SSR fallback, storage adapter conversion và streaming telemetry. Không yêu cầu browser recording.

## 3. Test Strategy & Acceptance Criteria Mapping

| ID | Acceptance Criterion | Test Scenario | Level | Priority | Red Phase Status |
|---|---|---|---|---|---|
| **SCN-1** | AC-1: Action Registration | `ThreadsCrawler` registers `profile`, `followers`, and `following` actions with descriptors | Unit / Contract | **P0** | 🔴 Scaffolded |
| **SCN-2** | AC-5 & AC-6: Normalization | `normalizer.js` functions convert raw GraphQL/SSR payloads to `ProfileItem` and `PostItem` | Unit | **P0** | 🔴 Scaffolded |
| **SCN-3** | AC-2: Profile GraphQL | `profile` action via GraphQL returns normalized `ProfileItem`, saves checkpoint & emits thin event | Integration | **P0** | 🔴 Scaffolded |
| **SCN-4** | AC-2 / AC-4: Profile SSR Fallback | `profile` action falls back to SSR HTML parsing when GraphQL `doc_id` is null | Integration | **P0** | 🔴 Scaffolded |
| **SCN-5** | AC-3: Followers & Following GraphQL | `followers`/`following` actions query GraphQL, paginate, and return normalized connection profiles | Integration | **P1** | 🔴 Scaffolded |
| **SCN-6** | AC-4: Public List Fallback | `followers`/`following` return `{ profiles: [], counts, note }` gracefully when lists are restricted | Integration | **P1** | 🔴 Scaffolded |
| **SCN-7** | AC-2 / Edge: 404 Not Found | `profile` throws `XACT_4041` when account does not exist or is suspended | Integration / Negative | **P2** | 🔴 Scaffolded |

## 4. Generated Test Scaffolds

- **Test File:** `tests/scrapers/social/threads/profile.test.js`
- **Total Test Cases:** 8 scenarios across 6 test suites
- **Mocking Policy:** 100% Mock-free (using Node.js `http.createServer` for realistic GraphQL & SSR endpoints).

## 5. Next Steps for Implementation (Handoff to Dev Story)

1. Run `/bmad-dev-story 15.1.1` to execute the implementation tasks.
2. Implement `src/scrapers/social/threads/normalizer.js` (T2).
3. Extend `ThreadsCrawler` with `profile`, `followers`, `following` action registration and handlers (T1, T3, T4).
4. Update `schemas/threads/social.json` to accept profile metadata properties (T5).
5. Verify test pass in green phase (`npx vitest run tests/scrapers/social/threads/profile.test.js`).
