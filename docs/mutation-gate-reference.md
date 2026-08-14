# Mutation Gate Reference — XActions

> Authority document for `bmad-xactions-mutation-gate`. The 6 anti-patterns, Stryker setup, and CI gate live here.

## Stryker Setup (already configured)

### Installed
- `@stryker-mutator/core`
- `@stryker-mutator/vitest-runner`

### Config files
- `stryker.config.js` — base config (mutates `src/**/*.js`)
- `stryker.unfollowback.config.js` — P0 rate-limit module
- `stryker.x402-middleware.config.js` — P0 billing module

### Run
```bash
npm run mutation                              # base config
npm run mutation:unfollowback                 # P0 rate-limit
npm run mutation:x402                         # P0 billing
npx stryker run stryker.{module}.config.js    # custom module
```

### Output
- `reports/mutation/html/index.html` — readable report
- `reports/mutation/mutation.json` (or `.stryker-tmp`) — machine-readable for the gate skill
- Console: clear-text table with mutation score

### Thresholds (aligned with gate verdict)
- `high: 80` → PASS
- `low: 60` → PASS_WITH_WARNINGS
- `break: 60` → CI fails below this

## The 6 Anti-Pattern Checklist

| # | Anti-Pattern | Mutant signal | Real bug if lapsed (XActions) | Test description that kills it |
|---|--------------|---------------|-------------------------------|--------------------------------|
| 1 | Mirror Test | `ObjectLiteral` return survived, `StringLiteral` survived | Scraper returns wrong fields, CLI output shape broken, MCP tool response malformed | "should return exactly fields X, Y, Z" + "should not return field W" |
| 2 | Over-Mocking / Under-Testing | `BlockStatement` catch survived, error branch `NoCoverage` | Rate-limit hit crashes automation, session expiry unhandled, Puppeteer launch failure unhandled | "should handle {real service failure} and still {graceful behavior}" — test against REAL failure state, not mock |
| 3 | Happy Path Only | `>` → `>=` survived, `&&` → `\|\|` survived, `if(x)` → `if(true)` survived | Ban risk (rate-limit bypass), security bypass (auth guard), infinite loop | boundary (exact limit), below, above + null/empty + concurrent double-submit |
| 4 | Arithmetic Not Asserted | `+` → `-` survived, `*1000` → `/1000` survived | Wrong follower diff, wrong pagination offset, wrong rate-limit counter | "should compute {result} as {exact value} when inputs are {specific values}" |
| 5 | Error Msg Not Asserted | `StringLiteral` in throw → `""` survived | User can't diagnose session expiry, rate-limit, or selector failure | "should throw {ErrorType} with message containing {key phrase}" |
| 6 | Real-Service Not Executed | `sql\`\`` survived, `page.$()` survived, `fetch(...)` survived | Prod query/automation fails or returns wrong data | Integration test "should execute real {Puppeteer/HTTP/DB} and return {expected}" |

## XActions P0 Modules (gate applies)

| Module | P0 area | Config | Why P0 |
|--------|---------|--------|--------|
| `src/unfollowback.js` | Rate-limit / ban-risk | `stryker.unfollowback.config.js` | Missing guard = account banned |
| `src/unfollowEveryone.js` | Rate-limit / ban-risk | (create per-module config) | Mass action = ban risk |
| `src/detectUnfollowers.js` | Data integrity | (create per-module config) | Follower history corruption |
| `api/middleware/x402.js` | Billing / payments | `stryker.x402-middleware.config.js` | Double-charge, fraud |
| `src/mcp/server.js` | MCP tool contracts | (create per-module config) | AI agents call broken tools |
| `src/scrapers/twitter/**` | Session / selector | (create per-module config) | Session leak, silent selector fail |

## CI Gate

Add to CI (e.g., `.github/workflows/quality.yml`):

```yaml
- name: Mutation gate (P0 modules)
  run: |
    npm run mutation:unfollowback
    npm run mutation:x402
    npm run mutation:fb-scheduler
    npm run mutation:fb-scrapers
    npm run mutation:fb-automation
  # Stryker exits non-zero if score < break threshold (60)
```

## Facebook Modules Mutation Scores (Round 3 — 2026-07-06)

| Module | Config | Total % | Covered % | Survived | NoCoverage | Δ from R1 | Notes |
|--------|--------|---------|-----------|----------|------------|-----------|-------|
| `facebookScheduler.js` | `stryker.fb-scheduler.config.js` | 71.74% | 85.71% | 22 | 30 | +22% | Pass threshold |
| `facebookAccounts.js` | `stryker.fb-routes.config.js` | 32.54% | 97.14% | 2 | 139 | +6% | 3 equivalent disabled |
| `facebook.js` | `stryker.fb-routes.config.js` | 24.39% | 86.88% | 21 | 410 | +24% | Integration tests bypass auth |
| `graphql.js` | `stryker.fb-scrapers.config.js` | **82.10%** | 90.82% | 19 | 22 | +41% | Pass threshold 🎉 |
| `index.js` | `stryker.fb-scrapers.config.js` | 40.79% | 80.16% | 97 | 472 | +3% | Browser functions NoCov |
| `messengerQueue.js` | `stryker.fb-scrapers.config.js` | **98.15%** | 98.15% | 1 | 0 | +4% | 1 equivalent |
| `messengerShare.js` | `stryker.fb-scrapers.config.js` | 41.50% | 76.80% | 45 | 165 | +11% | Browser functions NoCov |
| `proxy.js` | `stryker.fb-scrapers.config.js` | **75.16%** | 85.21% | 21 | 19 | +35% | Pass threshold 🎉 |
| `facebookAutomation.js` | `stryker.fb-automation.config.js` | 47.47% | 79.44% | 214 | 701 | +1% | Browser functions NoCov |

### Key findings
- **Covered score** (killed / (killed + survived)) is high across all modules (76-98%)
- **3 modules pass threshold 60%**: graphql.js (82%), messengerQueue.js (98%), proxy.js (75%), facebookScheduler.js (72%)
- **NoCoverage** is the primary score drag — browser automation functions (page.evaluate, page.keyboard, page.goto) require Puppeteer page objects
- **Equivalent mutants** marked with `// Stryker disable next-line MutatorName: reason` comments
- **Fake page helper** at `tests/helpers/fake-page.js` provides configurable DI for browser functions
- **Integration tests** at `tests/api/facebook-routes-integration.test.js` bypass auth with real DB user + JWT
- **Test counts**: graphql 118, proxy 99, messengerShare 66, index 111, automation-batch 88, scheduler 43

## Common Stryker Failures & Fixes

| Failure | Cause | Fix |
|---------|-------|-----|
| `Cannot find vitest config` | `vitest.configFile` path wrong | Verify `vitest.config.js` exists at root |
| ESM import errors | Stryker doesn't handle `import` | Ensure `tsconfigFile: null` in config (pure JS) |
| Timeout | Puppeteer/DB tests slow | Increase `timeoutMS`, reduce `concurrency` to 1 |
| `No tests found` | `testFile` path wrong | Verify test file path in per-module config |
| Too many mutants | `mutate` glob too broad | Narrow `mutate` to specific files in per-module config |

## Creating a new per-module config

```bash
# 1. Copy template
cp stryker.unfollowback.config.js stryker.{module}.config.js

# 2. Edit: change mutate + testFiles (TOP-LEVEL, not inside vitest)
# mutate: ['src/{module}.js']
# testFiles: ['tests/{category}/{module}.test.js']

# 3. Add npm script
# "mutation:{module}": "stryker run stryker.{module}.config.js"

# 4. Run
npm run mutation:{module}
```

### Config schema notes (Stryker 9.x + vitest-runner 9.x)

- `vitest.configFile` — path to vitest config (allowed inside `vitest`)
- `vitest.dir` — `--dir` option (allowed inside `vitest`)
- `vitest.related` — use vitest-related mode (allowed inside `vitest`, default true)
- `testFiles` — **top-level** option to narrow which test files run (NOT inside `vitest`)
- `mutate` — **top-level** option, glob of files to mutate
- Do NOT put `testFile`/`testFiles` inside `vitest.*` — schema rejects it with "additional properties" error
