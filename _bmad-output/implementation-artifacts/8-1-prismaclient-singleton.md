---
baseline_commit: bc06cd84ca8dd1bfbb0277b99c3955c9b4946317
---

# Story 8.1: PrismaClient Singleton Refactor

Status: ready-for-dev

## Story

As a system operator,
I want a single `PrismaClient` instance shared across the API,
So that database connection pool is not fragmented and performance remains stable.

## Context

- **Source:** PCR2 in `_bmad-output/planning-artifacts/sprint-change-proposal-2026-08-14.md`
- **Deferred from:** Epic 3 retrospective
- **Problem:** Every API route, service, middleware, and some `src/` entry points call `new PrismaClient()` at module load. In a single Node process this creates many independent connection pools and connection counts scale with route count.
- **Scope:** Create `api/lib/prisma.js` singleton and migrate all runtime `api/` and `src/` modules to import it. Tests can keep their own clients for isolation.

## Acceptance Criteria

**AC1 — Singleton module exists**
1. `api/lib/prisma.js` exports a single `PrismaClient` instance.
2. The instance is created on first import and reused on subsequent imports.
3. The module attaches a `process.on('beforeExit', ...)` or `process.on('SIGINT', ...)` handler that calls `prisma.$disconnect()` gracefully.
4. The singleton does not log sensitive data and does not change Prisma log level unless configured by env.

**AC2 — Runtime modules use the singleton**
5. All `api/routes/*.js` and `api/services/*.js` (and `api/middleware/auth.js`, `api/realtime/socketHandler.js`) replace `import { PrismaClient } from '@prisma/client'` and `const prisma = new PrismaClient()` with `import prisma from '../lib/prisma.js'` (or appropriate relative path).
6. `src/mcp/server.js`, `src/cli/index.js`, and `src/workflows/store.js` that need DB in the same process also import from `api/lib/prisma.js`.
7. After the refactor, the number of live `PrismaClient` instances in the API process does not scale with the number of route/service files.

**AC3 — No behavior regressions**
8. All existing queries, transactions, and `prisma.$queryRaw` calls continue to work without code changes beyond the import.
9. No migration or schema change is required.
10. All existing tests pass (`vitest run`). Tests that need their own `PrismaClient` for setup/teardown can keep creating one.

## Tasks / Subtasks

- [ ] **Task 1: Create `api/lib/prisma.js` singleton**
  - [ ] `import { PrismaClient } from '@prisma/client'`
  - [ ] `const prisma = new PrismaClient()` guarded by module-level memoization
  - [ ] `export default prisma`
  - [ ] Add graceful `$disconnect` on process exit signals

- [ ] **Task 2: Migrate `api/` modules**
  - [ ] `api/routes/*.js` (22 files)
  - [ ] `api/services/*.js` and `api/services/operations/*.js` (15 files)
  - [ ] `api/middleware/auth.js`
  - [ ] `api/realtime/socketHandler.js`

- [ ] **Task 3: Migrate `src/` entry points**
  - [ ] `src/mcp/server.js`
  - [ ] `src/cli/index.js`
  - [ ] `src/workflows/store.js`

- [ ] **Task 4: Verification**
  - [ ] Run `vitest run` and ensure 0 failures
  - [ ] Spot-check a few API endpoints that the singleton is used
  - [ ] Verify `prisma.$disconnect` is called on process exit

## Dev Agent Record

### Agent Model Used

(To be filled after implementation)

### Completion Notes List

(To be filled after implementation)

## Implementation Notes

### Files with `new PrismaClient()` (runtime, non-test)

| Directory | Count | Files |
|---|---|---|
| `api/routes/` | 22 | `auth.js`, `bookmarks.js`, `creator.js`, `discovery.js`, `engagement.js`, `facebook.js`, `facebookAccounts.js`, `messages.js`, `operations.js`, `posting.js`, `profile.js`, `session-auth.js`, `settings.js`, `spaces.js`, `tweetSchedule.js`, `twitter.js`, `unfollowers.js`, `user.js` |
| `api/services/` | 15 | `analyticsDashboard.js`, `facebookAccountPool.js`, `facebookAuth.js`, `facebookAutomation.js`, `facebookHealth.js`, `facebookScheduler.js`, `followerScanner.js`, `jobQueue.js`, `licenseManager.js`, `monitoring.js`, `operations/autoComment.js`, `operations/autoLike.js`, `operations/detectUnfollowers.js`, `operations/followEngagers.js`, `operations/keywordFollow.js`, `operations/unfollowEveryone.js`, `operations/unfollowNonFollowers.js`, `stripeService.js`, `tweetScheduler.js`, `tweetScheduling.js`, `unfollowerAlerts.js`, `unfollowerScheduler.js` |
| `api/middleware/` | 1 | `auth.js` |
| `api/realtime/` | 1 | `socketHandler.js` |
| `src/` | 3 | `cli/index.js`, `mcp/server.js`, `workflows/store.js` |

**Total runtime files to migrate: 47**

### Singleton pattern

```js
// api/lib/prisma.js
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__prisma = prisma;
}

const disconnect = async () => {
  try {
    await prisma.$disconnect();
  } catch (err) {
    console.error('Prisma disconnect error:', err.message);
    process.exitCode = 1;
  }
};

process.on('beforeExit', disconnect);
process.on('SIGINT', () => { disconnect().finally(() => process.exit(0)); });
process.on('SIGTERM', () => { disconnect().finally(() => process.exit(0)); });

export default prisma;
```

> Note: Use `globalThis` memoization to ensure the same instance is reused across hot-reloads in development. In production each process gets one instance anyway.

### Replacement pattern

Old:
```js
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
```

New:
```js
import prisma from '../lib/prisma.js';
```

### Test considerations

- Tests in `tests/services/*.test.js` and `tests/api/*.test.js` that create `new PrismaClient()` for test setup can keep doing so; they run in a separate process context.
- `prisma/seed.js` and `check-fb-cookies.mjs` are one-off scripts and can keep their own client or be migrated if they run in the same process.
- `archive/` and `_bmad-output/` files are out of scope.

## Review Findings

(To be filled after code review)
