# Agent Troubleshooting Guide

Common issues agents encounter when working on XActions and how to resolve them.

---

## Tests

### Tests fail with "Task not found: undefined"
**Cause:** `TaskStore` methods are async — calling `store.create()` without `await` returns a Promise, not a task object. Passing the Promise as a task ID fails.
**Fix:** Add `await` to all `store.create()`, `store.get()`, `store.transition()`, `store.list()` calls. Make test callbacks `async`.

### Integration test worker crashes / times out
**Cause:** Usually an infinite pagination loop. `scrapeUserList` loops `while (seen.size < limit)`. If the mock always returns the same response with a cursor and `seen.size` never reaches `limit`, it loops forever.
**Fix:** Use a call counter in the mock. Return a no-cursor response after the first call per endpoint:
```js
let callCount = 0;
const fetchMock = vi.fn(async (url) => {
  if (url.includes('Followers')) {
    callCount++;
    if (callCount > 1) return mockResponse({}); // no cursor → terminates
    return mockResponse(graphqlBody(FOLLOWERS_RESPONSE));
  }
});
```

### x402-integration tests fail with 429 instead of 402
**Cause:** These tests require a running API server. Without the server, they hit a different endpoint.
**Fix:** Start the server first: `npm run dev`. Then run: `npx vitest run tests/x402-integration.test.js`.

### Mutation mock returns wrong shape
**Cause:** For GraphQL **queries**, `client.graphql()` wraps the response as `{ data: json, cursor }`. For **mutations** (`mutation: true`), it returns the raw JSON directly.
**Fix:** For mutation mocks, pass the full fixture *with* the `data` wrapper: `mockResponse(TWEET_CREATE_RESPONSE)`, not `mockResponse(graphqlBody(TWEET_CREATE_RESPONSE))`.

### Media upload test: "Cannot read properties of undefined (reading 'processing_info')"
**Cause:** `MEDIA_FINALIZE_RESPONSE` includes `processing_info`, which triggers a STATUS poll call. The mock has no response for this extra call, so it returns `undefined`.
**Fix:** Add a STATUS mock after FINALIZE: `.mockResolvedValueOnce({})`. The `pollProcessingStatus` function returns immediately when `processing_info` is absent.

---

## MCP Server

### MCP server crashes on startup
1. Check `XACTIONS_SESSION_COOKIE` is set in environment
2. Verify Node.js version ≥ 18: `node --version`
3. Check import errors: `node src/mcp/server.js` directly
4. Review `docs/mcp-setup.md` for full setup

### MCP tool returns "not authenticated"
**Cause:** Session cookie expired or missing.
**Fix:** Get a fresh `auth_token` cookie from DevTools → Application → Cookies → `auth_token` on x.com. Set as `XACTIONS_SESSION_COOKIE`.

### MCP tool times out
**Cause:** Puppeteer can't launch (missing Chrome/Chromium) or x.com is blocking automation.
**Fix:**
```bash
npx puppeteer browsers install chrome
# Or set PUPPETEER_HEADLESS=false to debug visually
```

---

## Browser Scripts

### "No unfollow buttons found" or script finds nothing
1. Verify you're on the correct page (`x.com/USERNAME/following`, not `/followers`)
2. Check selectors in `docs/agents/selectors.md` — X changes DOM frequently
3. Try scrolling manually first to trigger lazy loading
4. Use `data-testid` selectors — most stable

### Script stops after ~20 actions
**Cause:** X rate limit triggered.
**Fix:** Wait 30–60 minutes. Reduce actions per session. Increase delays (1–3s minimum between actions).

### "core.js not defined" errors
**Cause:** Scripts in `src/automation/` require `src/automation/core.js` to be pasted first.
**Fix:** Copy and paste `src/automation/core.js` into DevTools, then paste the automation script.

---

## CLI

### `xactions` command not found after install
```bash
npm install -g xactions
# Or from source:
npm link
```

### CLI persona commands fail
1. Check `XACTIONS_SESSION_COOKIE` env var
2. For LLM features: check `OPENROUTER_API_KEY`
3. Run `xactions persona list` to verify setup

---

## Selector Drift & Canary (Epic 39)

### Selectors stopped working after an X/Twitter DOM change
1. Run `xactions canary status` — shows per-platform `successRate`, `consecutiveFailures`, and the last working selector
2. Run `xactions canary probe` — one probe cycle across all targets in `config/canary-targets.json`
3. Run `xactions canary heal --platform twitter --preview` — prints the unified-diff without touching anything
4. Review the diff, then run without `--preview` to create a GitHub **Draft PR** (branch `canary-heal/<platform>-<target>-<ts>`)
5. Merge the PR — selectors live in source control, never hot-patched at runtime (AD-44)

### `canary heal` reports "No valid replacement selectors found"
**Cause:** `AutoSelectorFallback` produced no candidates that passed `SelectorSandbox` validation against the target's `expectedShape`.
**Fix:** Inspect the live page in DevTools, update `selectorChain`/`expectedShape` in `config/canary-targets.json` manually, and file/track the issue (the healer files one automatically when it fails).

### `canary-targets.json not found or invalid`
**Fix:** The config must exist at `config/canary-targets.json` with a `{ platform: [{ name, url, selectorChain, expectedShape }] }` shape. Validate the JSON parses: `node -e "JSON.parse(require('fs').readFileSync('config/canary-targets.json'))"`.

---

## Proxy Tiers & Daily Budget (Epic 40)

### Requests fail with `BUDGET_CEILING_REACHED`
**Cause:** The daily proxy spend ceiling (`PROXY_DAILY_BUDGET_USD`, default $50) is exhausted. This is **soft degradation** — callers receive a degraded result, not a thrown `PROXY_EXHAUSTED`.
**Fix:** Wait for the daily bucket to reset (key `proxy:budget:YYYY-MM-DD` auto-expires via 24h TTL) or raise `PROXY_DAILY_BUDGET_USD` in `.env`.

### `PROXY_EXHAUSTED` (XACT_5030) instead of budget error
**Cause:** Different failure — no proxy node of the requested tier could serve the request (all quarantined or none configured).
**Fix:** Check `xactions governor status` for proxy health; add proxies of the needed tier (`free | datacenter | residential | mobile_4g`) or set `requiresProxy: false` where a direct connection is acceptable.

### Paid-tier costs appear even though I only use free proxies
**Cost model:** `ProxyBudgetGovernor` estimates ~50MB per request × tier rate (datacenter $0.5/GB, residential $8/GB, mobile_4g $15/GB; free = $0). Verify proxy records carry the right `tier` — the deprecated `residential: true` boolean maps to `tier: 'residential'`, so migrate proxy configs to the explicit `tier` field.

---

## OSINT Find Profiles (Epic 36)

### `x_social_find_profiles` returns `status: 'circuit_open'` for a platform
**Cause:** 3 consecutive failures tripped the per-`platform:accountId` circuit breaker (60s half-open cooldown, single probe).
**Fix:** Wait ~60s for the half-open probe, or fix the underlying cause (check the `error.category` in `platformStatus`: `RATE_LIMITED`, `BOT_BLOCKED`, `AUTH_REQUIRED`).

### A platform returns `status: 'timeout'`
**Cause:** Per-platform tiered deadline hit — Tier 0 lightweight platforms get 4–6s, Tier 1 browser platforms get 15s (`PLATFORM_TIMEOUTS_MS`).
**Fix:** Pass an explicit `timeoutMs` to override, or check whether the platform is genuinely slow/down. The timeout only abandons the caller-side wait; the crawler finishes in the background.

### A platform returns `status: 'account_sick'`
**Cause:** The supplied `accountId` is hibernating (rate-limited or panic-stopped via the Adaptive Rate Governor).
**Fix:** Check `xactions governor status` for hibernation state and wait out the hibernation window, or supply a different `accountId`.

---

## Database / API Server

### Prisma errors on startup
```bash
npx prisma migrate dev    # Apply pending migrations
npx prisma db push        # Push schema changes without migration
```

### "Cannot connect to database"
1. Verify PostgreSQL is running
2. Check `DATABASE_URL` in `.env`
3. For local dev: `docker-compose up -d postgres redis`

### "Cannot connect to Redis"
1. Verify Redis is running
2. Check `REDIS_HOST` and `REDIS_PORT` in `.env`
3. Bull job queue requires Redis — MCP server works without it

---

## Performance (Codespace)

If tests are slow or the codespace is unresponsive:

```bash
# Kill resource hogs
pkill -f "tsgo --noEmit"    # TypeScript checker (~500% CPU)
pkill -f "vitest"            # Leftover test workers
```

Run tests one file at a time rather than the full suite when memory is constrained:
```bash
npx vitest run tests/specific/test.js
```

---

## Common Gotchas

| Issue | Root cause | Fix |
|-------|-----------|-----|
| `require` is not defined | ESM-only project (`"type":"module"` in package.json) | Use `import`/`export` only |
| `window` is not defined | Browser script running in Node.js | Browser scripts are console-only; Node.js alternatives are in `src/scrapers/` |
| Selector stopped working | X/Twitter changed DOM | Run `xactions canary status` / `canary heal --preview`; check `docs/agents/selectors.md` |
| Rate limit after few actions | No delay between actions | Add `await sleep(1000 + Math.random() * 2000)` between each action |
| `BUDGET_CEILING_REACHED` | Daily proxy budget exhausted | Wait for daily reset (TTL) or raise `PROXY_DAILY_BUDGET_USD` |
| `circuit_open` in OSINT results | 3 consecutive platform failures | Wait 60s half-open cooldown; fix root cause in `error.category` |
| Puppeteer hangs | Headless Chrome issue | Set `PUPPETEER_HEADLESS=false` to debug; check `docs/troubleshooting.md` |
