# ATDD Checklist — 34-D3 Atomic Credit Debit + Admission Gate (Per-Query Billing, Race-Safe)

Source: `_bmad-output/implementation-artifacts/stories/34-D3-atomic-debit-admission-gate.md`  
Priority: **P0** (apps/api/src/billing, apps/api/src/common/guards, packages/db)

---

## AC-1 — Credit Admission Guard Before LLM/Search Execution

Given an authenticated request to a billable endpoint (`v1/search`, `v1/agent/runs`).  
When `CreditAdmissionGuard.canActivate()` executes before the controller handler and third-party API calls.  
Then it gates the request based on user plan and credit balance, returning HTTP 402 if credits are insufficient or HTTP 429 if subscription daily quota is exceeded.

### Pattern 1 (Mirror)
- [ ] should return HTTP 402 with exact body `{ error: 'insufficient_credit', balance, required, currency, requestId }` when pay-as-you-go user balance < required mode cost
- [ ] should NOT return 402 when user is subscription (`plan: 'free' | 'pro' | 'max'`) and has remaining quota
- [ ] should return HTTP 429 with `{ error: 'quota_exceeded', limit, used, reset_at }` when subscription user exceeds daily limit on billable routes
- [ ] should return `true` immediately when route is decorated with `@Public()`
- [ ] should return `true` immediately when endpoint is already guarded by `QuotaGuard` (`crawl`, `media`)

### Pattern 2 (Over-Mocking)
- [ ] should handle `PricingCatalogService.getCatalog` throwing `NotFoundException` by defaulting to fallback mode cost or rejecting with 400
- [ ] should handle `CreditBalanceService.getBalance` database failure by propagating 500 error
- [ ] should handle `BillingService.checkAndIncrementQuota` throwing exception without swallowing failure

### Pattern 3 (Edge cases)
- [ ] Boundary: should allow request when `balance === required` (exact balance boundary allows execution)
- [ ] Boundary: should reject request with 402 when `balance === required - 1` (1 cent-credit short)
- [ ] Null/empty: should bypass guard (return `true`) when `req.user` is undefined/null (deferred to auth guards)
- [ ] Bypass: should bypass guard (return `true`) when `req.user.id === MCP_SERVICE_USER_ID` (service account bypass)
- [ ] Fallback: should default mode to `'search'` when mode is missing in request body/query

### Pattern 4 (Arithmetic)
- [ ] should assert required cost is exactly `25` for `speed`, `70` for `ask`, `90` for `reason`, `150` for `research`, `240` for `deep`
- [ ] should assert `balance` in 402 error payload matches exact current integer cent-credit balance

### Pattern 5 (Error message)
- [ ] should throw `HttpException` with status 402 and payload containing `error: 'insufficient_credit'`
- [ ] should throw `HttpException` with status 429 and payload containing `error: 'quota_exceeded'`
- [ ] should include `requestId` string in 402 response body

### Pattern 6 (SQL — integration)
- [ ] should execute `CreditAdmissionGuard` in NestJS request pipeline against real Postgres database
- [ ] should verify admission check executes before search provider API call in integration test

---

## AC-2 — Atomic Credit Debit at Request Completion

Given a billable request completing successfully (`status = 'completed'`).  
When `UsageLedgerService.recordCompletion()` is invoked.  
Then it atomically commits `usage_ledger`, `billing_outbox`, and `credit_ledger` (with `credit_balances` decrement) inside a single transaction boundary.

### Pattern 1 (Mirror)
- [ ] should insert `credit_ledger` row with exact fields `{ userId, type: 'usage_deduction', amount: -cost, referenceId: usageLedgerId, currency: 'USD', catalogVersion }`
- [ ] should decrement `credit_balances.balance` by exact `cost` amount
- [ ] should NOT insert `credit_ledger` deduction when request status is not `'completed'` (e.g. failed/cancelled)

### Pattern 2 (Over-Mocking)
- [ ] should handle `CreditBalanceService.recordDeduction` execution within caller's provided transaction (`dbOrTx`)
- [ ] should roll back entire transaction if database disconnects mid-completion

### Pattern 3 (Edge cases)
- [ ] Idempotency: duplicate `recordCompletion` with same `(requestId, messageId, billableEventType)` does NOT double-debit balance
- [ ] Idempotency: duplicate `credit_ledger` insert on `(userId, referenceId, type)` is ignored via `onConflictDoNothing`
- [ ] Zero cost: should handle zero-cost requests (`cost = 0`) without inserting negative ledger entries

### Pattern 4 (Arithmetic)
- [ ] should record deduction amount as strictly negative integer (e.g. `-25`, `-70`, `-150`)
- [ ] should verify new balance equals exactly `initialBalance - cost`

### Pattern 5 (Error message)
- [ ] should log warning with message containing `duplicate` when duplicate completion event is received

### Pattern 6 (SQL — integration)
- [ ] should execute `recordCompletion` against real Postgres and verify `usage_ledger`, `credit_ledger`, and `credit_balances` all reflect consistent state in single commit

---

## AC-3 — Race-Safe Concurrency & Non-Negative Balance Guard

Given multiple concurrent requests for the same user with total cost exceeding available balance.  
When concurrent debits execute simultaneously.  
Then only requests with sufficient balance succeed; remaining requests never drive balance negative, emit rollback metric, and commit with `usage_ledger.status = 'completed_unbilled'`.

### Pattern 1 (Mirror)
- [ ] should update `usage_ledger.status` to `'completed_unbilled'` when conditional credit decrement returns 0 rows
- [ ] should NOT insert a negative `credit_ledger` row when race occurs
- [ ] should increment Prometheus/OTel counter `credit_race_rollback_total` on race detection

### Pattern 2 (Over-Mocking)
- [ ] should handle conditional decrement returning empty rows without throwing unhandled exception to the HTTP caller
- [ ] should deliver response to user even when race rollback marks request as `completed_unbilled` (bounded accepted race cost)

### Pattern 3 (Edge cases)
- [ ] Concurrency: 10 parallel requests with balance = `2 * cost` -> exactly 2 requests debited, exactly 8 requests marked `completed_unbilled`, final balance = `0`
- [ ] Concurrency: parallel debit and top-up operations execute without lost updates or deadlock

### Pattern 4 (Arithmetic)
- [ ] should execute conditional SQL update: `UPDATE credit_balances SET balance = balance + $1 WHERE user_id = $2 AND currency = $3 AND balance + $1 >= 0`
- [ ] should guarantee `credit_balances.balance >= 0` invariant at all times across all threads

### Pattern 5 (Error message)
- [ ] should throw internal `InsufficientCreditError` inside `CreditBalanceService` when conditional update returns 0 rows
- [ ] should log info/warn containing `credit_race_rollback` with `userId` and `requestId`

### Pattern 6 (SQL — integration)
- [ ] should run parallel Postgres worker threads debiting the same user and assert `balance` is never negative and `credit_balances_balance_check` DB constraint is never violated

---

## AC-4 — Seamless Coexistence with Subscription Plans & QuotaGuard

Given subscription users (`plan: 'free' | 'pro' | 'max'`).  
When querying billable endpoints.  
Then existing `QuotaGuard` on legacy endpoints (`crawl`, `media`) continues functioning identically without regressions.

### Pattern 1 (Mirror)
- [ ] should preserve existing `QuotaGuard` logic on `crawl` and `media` controllers
- [ ] should NOT modify `quota.guard.ts` core behavior or breaking interfaces
- [ ] should delegate subscription quota checks to `BillingService.checkAndIncrementQuota`

### Pattern 2 (Over-Mocking)
- [ ] should handle subscription user without credit record by relying exclusively on subscription quota counters
- [ ] should handle pay-as-you-go user on legacy `QuotaGuard` route gracefully

### Pattern 3 (Edge cases)
- [ ] User transitioning from `free` subscription to `credits` pay-as-you-go plan
- [ ] Subscription user with remaining quota and 0 credit balance (allowed on subscription endpoints)

### Pattern 4 (Arithmetic)
- [ ] should assert daily quota counters increment by exactly 1 for subscription requests

### Pattern 5 (Error message)
- [ ] should return standard 429 response structure matching `quota.guard.ts` specification

### Pattern 6 (SQL — integration)
- [ ] should verify `query_usage` table updates correctly for subscription users alongside `credit_ledger` for credit users in real DB

---

## AC-5 — Price Resolution from Catalog & Reconciliation

Given a billable request with a specified mode.  
When admission check or completion debit executes.  
Then cost is dynamically resolved from `PricingCatalogService.getCatalog(mode)` using `getActiveVersion()`, defaulting currency to `'USD'`.

### Pattern 1 (Mirror)
- [ ] should resolve cost using `PricingCatalogService.getCatalog(mode)`
- [ ] should record `catalog_version` in `credit_ledger` matching `getActiveVersion()`
- [ ] should default `currency` to `'USD'`

### Pattern 2 (Over-Mocking)
- [ ] should handle unknown query mode by mapping aliases (`deep-research` -> `deep`, `deep-reasoning` -> `reason`)
- [ ] should handle catalog service caching during high-throughput admission checks

### Pattern 3 (Edge cases)
- [ ] Mixed-case mode strings (`SPEED`, `Ask`, `Research`) normalized consistently
- [ ] Mode aliases properly resolved during both admission and debit phases

### Pattern 4 (Arithmetic)
- [ ] should ensure admission cost check and completion debit amount are identical for the same mode and catalog version

### Pattern 5 (Error message)
- [ ] should throw `NotFoundException` if an invalid mode string with no alias or fallback is provided

### Pattern 6 (SQL — integration)
- [ ] should query `price_catalog` on real DB and assert resolved price matches database seed values

---

## AC-6 — Test-First ATDD & Mutation Gate Verification

Given P0 billing components (`credit-admission.guard.ts`, `credit-balance.service.ts`, `usage-ledger.service.ts`).  
When tests are authored.  
Then comprehensive unit and integration test suites cover all 6 anti-patterns, followed by Stryker mutation testing achieving ≥ 80% mutation score.

### Pattern 1 (Mirror)
- [ ] `credit-admission.guard.spec.ts` covers all admission branches (402, 429, 200, bypass)
- [ ] `credit-balance.service.spec.ts` covers conditional decrement, transaction propagation, and error handling
- [ ] `usage-ledger.service.spec.ts` covers completion debit, idempotency, and race rollback

### Pattern 2 (Over-Mocking)
- [ ] mocks assert exception paths and transaction rollback behavior

### Pattern 3 (Edge cases)
- [ ] boundary tests assert exact `balance === cost` and `balance === cost - 1`

### Pattern 4 (Arithmetic)
- [ ] arithmetic assertions verify exact cent-credit values, not loose `expect(val).toBeGreaterThan(0)`

### Pattern 5 (Error message)
- [ ] error assertions check exact HTTP status codes and regex message patterns

### Pattern 6 (SQL — integration)
- [ ] `usage-ledger.service.integration.spec.ts` verifies real PostgreSQL transaction boundaries and race condition handling

---

*Generated 2026-08-20 as part of Story 34-D3 test-first ATDD gate.*
