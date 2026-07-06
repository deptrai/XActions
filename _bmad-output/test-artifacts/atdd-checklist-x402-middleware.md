---
story_key: x402-middleware
module: api/middleware/x402.js
mutation_score_before: 1.34
survived_before: 295
killed_before: 4
stepsCompleted: [1, 1a, 1b, 1c, 2, 3, 4]
lastStep: 5
lastSaved: 2026-07-06
---

# ATDD Checklist — x402 Payment Middleware

> Test-first skeleton targeting 295 survived mutants in `api/middleware/x402.js`.
> **CRITICAL**: existing test file uses a MOCK middleware — all tests below must
> import and exercise the REAL `x402Middleware` export. No mocks per project rules.

## Root cause of 1.34% mutation score

The existing `tests/x402-middleware.test.js` defines its own `mockX402Middleware`
(line 17-78) and never imports `x402Middleware` from `api/middleware/x402.js`.
Stryker mutates the real file but no test calls it → 295/299 mutants survive.

## Survived mutant distribution (targeting priorities)

| Mutator | Count | Anti-pattern | Priority |
|---------|-------|-------------|----------|
| ConditionalExpression | 92 | P3 Happy Path Only | P0/P1 |
| StringLiteral | 55 | P1 Mirror / P5 Error Msg | P1 |
| OptionalChaining | 32 | P3 boundary (null/undefined) | P0 |
| LogicalOperator | 31 | P3 boundary (\|\|/&&) | P0 |
| BlockStatement | 27 | P2 Under-Testing (catch blocks) | P0 |
| ObjectLiteral | 17 | P1 Mirror (return shape) | P1 |
| BooleanLiteral | 15 | P3 boundary (true/false flip) | P0 |
| EqualityOperator | 12 | P3 boundary (==/!=) | P0 |
| Regex | 6 | P1 Mirror (extractOperation) | P1 |
| ArrowFunction | 5 | P2 Under-Testing | P1 |
| MethodExpression | 2 | P6 Real-Service | P0 |
| ArrayDeclaration | 1 | P1 Mirror | P1 |

---

## Test descriptions (titles only — no bodies)

### describe('x402Middleware — path filtering')

#### Pattern 1: Mirror Test — verify exact path filtering logic

- it('should call next() for paths not starting with /api/ai/ or /api/scripts/')
- it('should NOT call next() for paths starting with /api/ai/')
- it('should NOT call next() for paths starting with /api/scripts/')
- it('should call next() for /api/ai/health (free endpoint)')
- it('should call next() for /api/ai/pricing (free endpoint)')
- it('should call next() for /api/ai/action/validate-session (free endpoint)')
- it('should call next() for /api/scripts (free endpoint)')
- it('should call next() for /api/scripts/ (free endpoint, trailing slash)')
- it('should NOT call next() for /api/ai/scrape/profile (paid endpoint)')
- it('should NOT call next() for /api/scripts/run (paid endpoint)')
- it('should NOT call next() for /api/scripts/automation/foo.js (paid script download)')

#### Pattern 3: Happy Path Only — boundary cases for path matching

- it('should treat /api/ai/health exactly as free — /api/ai/health/sub should NOT be free')
- it('should treat /api/scripts exactly as free — /api/scripts/foo should NOT be free')
- it('should handle path with query string /api/ai/scrape/profile?limit=100 as paid')
- it('should handle path with trailing slash /api/ai/scrape/profile/ as paid')

### describe('x402Middleware — config validation')

#### Pattern 3: Boundary — NODE_ENV branches

- it('should pass through without x402 config in development (NODE_ENV=development)')
- it('should return 500 when x402 not configured in production (NODE_ENV=production)')
- it('should return 500 with error message "Payment system not configured" in production')

### describe('x402Middleware — lazy initialization')

#### Pattern 2: Under-Testing — init failure paths

- it('should initialize middleware on first request and cache it for subsequent requests')
- it('should not re-initialize if _middleware is already set')
- it('should set _initFailed=true and not retry if initialization throws')
- it('should not retry initialization after _initFailed is true')
- it('should pass through in development when _middleware is null after init failure')
- it('should return 503 with error "Payment system unavailable" in production when _middleware is null')
- it('should log error message containing "x402 initialization failed" on init failure')
- it('should log install hint "npm install @x402/core @x402/evm @x402/express" on init failure')

#### Pattern 3: Boundary — concurrency during init

- it('should handle concurrent requests during initialization without double-init (reuse _initPromise)')
- it('should clear _initPromise after initialization completes (successful or failed)')

### describe('x402Middleware — delegation')

#### Pattern 6: Real-Service — verify real middleware is called

- it('should delegate to the initialized @x402/express middleware when _middleware is set')
- it('should pass req, res, next to the delegated middleware')

### describe('buildRouteConfig — route mapping')

#### Pattern 1: Mirror — verify exact route structure

- it('should map each AI_OPERATION_PRICES entry to a route key "POST /api/ai/{category}/{action}"')
- it('should set price, network, and payTo for each AI operation route')
- it('should map each SCRIPT_PRICES entry to a route key "GET /api/scripts/{scriptPath}"')
- it('should add a "POST /api/scripts/run" route with SCRIPT_RUN_PRICE')
- it('should use NETWORK from config for all routes')
- it('should use PAY_TO_ADDRESS from config for all routes')

#### Pattern 4: Arithmetic — verify exact prices

- it('should set scrape:profile route price to exactly $0.001')
- it('should set action:unfollow-non-followers route price to exactly $0.05')
- it('should set script:run route price to exactly SCRIPT_RUN_PRICE value')

#### Pattern 3: Boundary — operation name splitting

- it('should split operation "scrape:profile" into category "scrape" and action "profile"')
- it('should split operation "action:unfollow-non-followers" into category "action" and action "unfollow-non-followers"')
- it('should handle operation with multiple colons correctly (e.g., "analytics:health-score" → category="analytics", action="health-score")')

### describe('extractOperation — resource URL parsing')

#### Pattern 1: Mirror — verify exact regex matching

- it('should return "unknown" when requirements is null')
- it('should return "unknown" when requirements.resource is undefined')
- it('should extract "scrape:profile" from resource "/api/ai/scrape/profile"')
- it('should extract "action:unfollow-non-followers" from resource "/api/ai/action/unfollow-non-followers"')
- it('should extract "script:run" from resource "/api/scripts/run"')
- it('should extract "script:download:automation/foo.js" from resource "/api/scripts/automation/foo.js"')
- it('should extract "script:download:src/bar.js" from resource "/api/scripts/src/bar.js"')

#### Pattern 3: Boundary — edge cases for regex

- it('should return "unknown" for resource "/api/ai/" (no category/action)')
- it('should return "unknown" for resource "/api/ai/scrape/" (action missing)')
- it('should return "unknown" for resource "/api/scripts/other/path" (not automation/ or src/)')
- it('should handle resource with query string "/api/ai/scrape/profile?limit=100" → "scrape:profile"')
- it('should handle resource with trailing slash "/api/ai/scrape/profile/" → "scrape:profile"')

### describe('x402HealthCheck — response shape')

#### Pattern 1: Mirror — verify exact response fields

- it('should return service field as "XActions AI API"')
- it('should return status "operational" when x402 is configured')
- it('should return status "degraded" when x402 is not configured')
- it('should return timestamp as a valid ISO string')
- it('should return x402.enabled matching isX402Configured()')
- it('should return x402.available as false when _initFailed is true')
- it('should return x402.available as true when _initFailed is false and configured is true')
- it('should return x402.version as 2')
- it('should return x402.facilitator matching FACILITATOR_URL')
- it('should return x402.payTo as PAY_TO_ADDRESS when configured')
- it('should return x402.payTo as null when not configured')

#### Pattern 3: Boundary — networks

- it('should include testnet networks when NODE_ENV is not production')
- it('should exclude testnet networks when NODE_ENV is production')
- it('should return networks.supported as an array with network, name, usdc, gasCost, recommended, testnet fields')
- it('should set recommended: true for the network marked recommended in config')
- it('should set recommended: false for networks not marked recommended')
- it('should set testnet: true for testnet networks')
- it('should set testnet: false for mainnet networks')
- it('should return networks.recommended as the recommended network ID')
- it('should return networks.recommendedName as the recommended network name')
- it('should return networks.defaultNetwork as NETWORK from config')
- it('should fall back to networks[0] when no network is marked recommended')
- it('should return networks.recommended as undefined when networks array is empty')

#### Pattern 1: Mirror — pricing + endpoints

- it('should return pricing matching AI_OPERATION_PRICES from config')
- it('should return endpoints as an array with operation, name, path, price fields')
- it('should map each endpoint.operation to "category:action" format')
- it('should map each endpoint.path to "/api/ai/{category}/{action}"')
- it('should map each endpoint.price to the corresponding AI_OPERATION_PRICES value')

### describe('x402Pricing — response shape')

#### Pattern 1: Mirror — verify exact response fields

- it('should return currency as "USDC"')
- it('should return networks as an array with network, name, usdc, gasCost, recommended fields')
- it('should return networks WITHOUT testnet field (unlike healthCheck)')
- it('should set recommended: true for the recommended network')
- it('should set recommended: false for non-recommended networks')
- it('should return recommendedNetwork as the recommended network ID')
- it('should return recommendedNetwork as undefined when no networks exist')
- it('should return pricing matching AI_OPERATION_PRICES')

#### Pattern 3: Boundary — testnet filtering

- it('should include testnet networks when NODE_ENV is not production')
- it('should exclude testnet networks when NODE_ENV is production')
- it('should fall back to networks[0] when no network has recommended: true')

### describe('initializeMiddleware — network registration')

#### Pattern 2: Under-Testing — registration failure

- it('should register NETWORK and all accepted networks for the current environment')
- it('should include testnet networks when NODE_ENV is not production')
- it('should exclude testnet networks when NODE_ENV is production')
- it('should silently ignore already-registered network errors (catch block)')
- it('should silently ignore unsupported network errors (catch block)')

### describe('initializeMiddleware — settlement hooks')

#### Pattern 2: Under-Testing — onAfterSettle hook

- it('should log settlement message containing price and operation on successful settlement')
- it('should log audit JSON when X402_DEBUG is "true"')
- it('should NOT log audit JSON when X402_DEBUG is not "true"')
- it('should emit "x402:payment" event via global.io when global.io exists')
- it('should NOT crash when global.io is undefined')
- it('should call recordPayment with operation, price, network, paymentId, payerAddress')
- it('should extract payerAddress from paymentPayload.payload.authorization.from')
- it('should default payerAddress to "unknown" when authorization.from is missing')
- it('should call notifyPaymentSettled with price, operation, payerAddress, network, transactionHash')
- it('should not throw when notifyPaymentSettled rejects (non-blocking .catch)')

#### Pattern 2: Under-Testing — onSettleFailure hook

- it('should log error message containing "Settlement FAILED" and operation name')
- it('should log error message containing the error message when error is provided')
- it('should call notifyPaymentFailed with price, operation, payerAddress, network')
- it('should not throw when notifyPaymentFailed rejects (non-blocking .catch)')
- it('should extract price from requirements.maxAmountRequired first')
- it('should fall back to requirements.price when maxAmountRequired is missing')
- it('should default price to "unknown" when neither maxAmountRequired nor price is set')

#### Pattern 2: Under-Testing — onVerifyFailure hook

- it('should log warning message containing "Verification failed" and operation name')
- it('should call notifyPaymentFailed with "Verification failed:" prefix in error message')
- it('should default price to "unknown" when requirements.maxAmountRequired is missing')

#### Pattern 5: Error Msg — exact log messages

- it('should log "💰 x402: Settled {price} for {operation}" on settlement')
- it('should log "🚨 x402: Settlement FAILED for {operation}: {error}" on settle failure')
- it('should log "⚠️  x402: Verification failed for {operation}: {error}" on verify failure')

### describe('initializeMiddleware — startup logging')

#### Pattern 5: Error Msg — exact startup messages

- it('should log "✅ x402 payment middleware ready" on successful init')
- it('should log payTo address with "💰 Pay to:" prefix')
- it('should log network name with "🌐 Network:" prefix')
- it('should log "Base Mainnet" when NETWORK is "eip155:8453"')
- it('should log "Base Sepolia Testnet" when NETWORK is "eip155:84532"')
- it('should log facilitator URL with "🔗 Facilitator:" prefix')
- it('should log protected operations count with "📋 Protected operations:" prefix')

### describe('x402Middleware — P0 billing safety')

#### P0: Double-charge prevention

- it('should not allow bypassing payment by sending empty X-PAYMENT header')
- it('should not allow bypassing payment by sending malformed X-PAYMENT header')
- it('should not allow bypassing payment by sending X-PAYMENT with whitespace only')

#### P0: Session/cookie leak prevention

- it('should not leak PAY_TO_ADDRESS in error responses when x402 is not configured')
- it('should not log session cookies or payment signatures in any output')

#### P0: Data integrity

- it('should return JSON content-type for all error responses (500, 503)')
- it('should return JSON content-type for all 402 responses')

---

## Test level assignments

| describe block | Level | Why |
|---------------|-------|-----|
| x402Middleware — path filtering | Unit | Pure function logic, no external deps |
| x402Middleware — config validation | Unit | Env var branching, no real payment |
| x402Middleware — lazy initialization | Unit | Module state, no real @x402/express needed |
| x402Middleware — delegation | Integration | Needs real @x402/express middleware |
| buildRouteConfig | Unit | Pure function, config only |
| extractOperation | Unit | Pure function, regex parsing |
| x402HealthCheck | Unit | Express res object, config only |
| x402Pricing | Unit | Express res object, config only |
| initializeMiddleware — network registration | Integration | Needs @x402/core, @x402/evm |
| initializeMiddleware — settlement hooks | Integration | Needs facilitator, real settlement |
| initializeMiddleware — startup logging | Unit | Console output capture |
| x402Middleware — P0 billing safety | Integration | Full Express app with real middleware |

## Priority assignments

| Priority | Test descriptions | Why |
|----------|------------------|-----|
| P0 | path filtering, config validation, lazy init failure, delegation, extractOperation boundary, P0 billing safety | Billing bypass, crash on init failure, wrong operation extraction |
| P1 | buildRouteConfig, healthCheck, pricing, settlement hooks, startup logging | Wrong pricing, wrong network info, missing analytics |
| P2 | startup logging exact messages | Cosmetic, but helps debugging |

## Red phase confirmation

Every test description above MUST fail before implementation:
- Path filtering tests: will fail because current test uses mock, not real middleware
- Config validation tests: will fail because no test sets NODE_ENV=production
- Lazy init tests: will fail because no test exercises init failure path
- extractOperation tests: will fail because function is not exported or not tested
- HealthCheck/Pricing tests: will fail because response shape is not verified against real function
- Settlement hook tests: will fail because hooks are not exercised

## Implementation constraint (test-first)

When implementing test bodies:
1. Import the REAL `x402Middleware`, `x402HealthCheck`, `x402Pricing` from `api/middleware/x402.js`
2. Do NOT read the implementation to write assertions — use the spec (this checklist + x402-config.js)
3. Do NOT use `vi.mock`, `vi.fn`, `jest.fn`, or any mock/stub/fake
4. For integration tests: use real Express app, real config, real @x402/express (if installed)
5. For unit tests of `extractOperation` and `buildRouteConfig`: these are not exported — consider testing via the public API or requesting export
6. Use `supertest` with a real Express app that mounts the real middleware

## Next step

After test bodies are implemented, run:
```bash
npm run mutation:x402
```
Target: mutation score ≥ 60%, 0 P0 survived. If not, return to this checklist for more descriptions targeting remaining survived mutants.
