---
name: api-test
description: Generate and run real HTTP API acceptance tests for XActions Express routes using supertest and a live test database.
code: AT
added: 2026-08-28
type: prompt
---

# API Test — Generate or Verify an Express Route

The outcome is a passing, no-mock Vitest test file at `{project-root}/tests/api/{route}-test.test.js` that exercises an XActions Express route against the real app and a real test database, and that a future developer can trust to catch regressions.

The consumer is a human or AI developer who will run `vitest run tests/api/{route}-test.test.js` and expect it to fail if the route breaks. The bar: every assertion maps to an acceptance criterion, uses real `supertest` calls, seeds real rows through `prisma` or helpers, and asserts standard error envelopes (`success`, `error.code`).

## Before testing

Confirm the target. Ask or infer from context:
- Which route under `api/routes/`? (e.g., `checkpoints.js`, `operations.js`)
- Which acceptance criteria or stories? (e.g., AC1-AC5 for checkpoints)
- Authentication scheme: JWT cookie, Bearer token, A2A API key, A2A Bearer, or none?
- What Prisma models does it touch? Load `prisma/schema.prisma` and any seed fixtures.
- Does it return `{ success, data }`, `{ success, error }`, or raw data?

Look at `tests/api/` for existing patterns. The suite typically imports:
- the Express app from `api/server.js` (relative from the test file)
- `request` from `supertest`
- `prisma` and `cleanupTestDatabase` from the shared test client under `tests/store/`
- `generateApiKey` and `generateToken` from `src/a2a/auth.js` for A2A auth
- `jwt` and `bcryptjs` for user tokens

## Test design rules

- One `describe` per story or concern; one `it` per observable behavior.
- Use `beforeAll`/`afterAll` for user/seed setup and teardown, `beforeEach` to reset tables touched by the test.
- Generate unique IDs with `Date.now()` + random to avoid collisions in repeated runs.
- Assert status **and** error code when testing failures (e.g., `XACT_4001`, `XACT_4003`, `XACT_4041`, `XACT_4002`).
- Test the success shape: `res.body.success === true`, payload fields exist and match expected types.
- Test auth boundaries: 401 unauthenticated, 403 forbidden, 200/201 with right role or A2A scope.
- Test pagination, filtering, and lifecycle transitions if the route supports them.
- Do not mock the database or the app. Use the real Prisma client and real server instance.

## After writing

Run `vitest run tests/api/{route}-test.test.js`. If it fails, inspect the failure, fix the test or the route, and rerun until green. Then run `npx tsc --noEmit` if the test adds TS types. Update the story file and sprint status if this is part of an active story.
