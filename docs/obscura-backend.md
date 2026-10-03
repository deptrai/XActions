# Obscura Browser Backend — Public Scraping Only

> Opt-in CDP backend for `launchStealthBrowser`. **Guest-visible scraping only** — keep Chrome for post-auth automation.

[Obscura](https://github.com/h4ckf0r0day/obscura) is a headless browser engine in Rust that speaks the Chrome DevTools Protocol. XActions connects to it over `puppeteer-core` instead of launching Chrome.

## Why

| Metric | Obscura | Headless Chrome |
|---|---|---|
| Memory | ~30 MB | 200+ MB |
| Startup | instant | ~2 s |
| Binary | ~70 MiB | 300+ MB |
| Anti-detect | built-in `--stealth` | `puppeteer-extra-plugin-stealth` |

## Hard limits (Obscura 0.2.2 — verified by spike)

- **No post-auth React hydration.** `/home`, `/explore` return large bodies but `data-testid` never mounts → automation that clicks/likes/DMs will miss elements. **Do not use for post-auth.**
- **`waitUntil:'networkidle2'` hangs.** Use `networkidle0` (or `load`/`domcontentloaded`) only.
- **`userDataDir` ≠ Chrome profile.** Obscura persists via `--storage-dir` (cookie/storage dump), different semantics.

## Use

```bash
obscura serve --port 9222 --stealth          # separate process
export XACTIONS_BROWSER_BACKEND=obscura
export OBSCURA_WS_ENDPOINT=ws://127.0.0.1:9222
```

```js
const browser = await launchStealthBrowser({ backend: 'obscura' });   // or env
const page = await createStealthPage(browser, { fingerprint });
await page.goto(url, { waitUntil: 'networkidle0' });                  // never networkidle2
await closeStealthBrowser(browser);                                  // disconnect() on obscura, close() on chrome
```

## Backend fit matrix

| Use case | Backend |
|---|---|
| Guest profile / tweet / search scraping | `obscura` ✅ |
| Threads/TikTok/Shopee/Chotot/Reddit/Medium public | `obscura` ✅ |
| Post / like / reply / DM / Spaces (post-auth) | `chrome` ✅ (obscura blocked by guard) |
| `puppeteer-extra` stealth plugin | `chrome` only |

## Teardown contract

- `obscura` → `browser.disconnect()` (preserves external shared `obscura serve` daemon).
- `chrome` → `browser.close()` (terminates child process).
- Use `closeStealthBrowser(browser)` or `adapter.closeBrowser(browser)` to automatically dispatch based on `browser.__backend`.

## Env vars

- `XACTIONS_BROWSER_BACKEND` (`chrome` | `obscura`, default `chrome`): primary browser backend.
- `XACTIONS_BROWSER_BACKEND_FALLBACK` (`chrome` | `obscura` | `none`, default `chrome`): secondary fallback backend on launch failure. Note: `obscura -> chrome` fallback is always allowed; `chrome -> obscura` is strictly restricted to public scraping paths (`requiresAuth === false`).
- `OBSCURA_WS_ENDPOINT` (default `ws://127.0.0.1:9222`): WebSocket endpoint of the running Obscura server.
- `OBSCURA_STORAGE_DIR`: Directory for Obscura cookie/storage persistence (mapped from `userDataDir`).
- `XACTIONS_BROWSER_BACKEND_METRICS` (`1` or `0`, default `0`): When `1`, attaches `browserBackend` to telemetry runs.
- `OBSCURA_BIN` (spike auto-spawn only), `PROXY_SERVER`, `HEADFUL=1`, `SHOTS=1`.

## Sharded Fleet & BrowserPool (Story 53.4)

When pooled scraping is enabled (`XACTIONS_BROWSER_POOL_SIZE > 0`), Obscura shards across an external fleet of `obscura serve` processes rather than scaling page connections on a single process.

### Configuration

| Variable | Scope | Default | Description |
|---|---|---|---|
| `OBSCURA_WS_ENDPOINTS` | obscura | unset | Comma-separated list of external WebSocket endpoints (e.g. `ws://127.0.0.1:9222,ws://127.0.0.1:9223`). Takes precedence over `OBSCURA_WS_ENDPOINT`. |
| `OBSCURA_WS_ENDPOINT` | obscura | `ws://127.0.0.1:9222` | Single WebSocket endpoint fallback when `OBSCURA_WS_ENDPOINTS` is unset. |
| `XACTIONS_BROWSER_PAGES_PER_PROCESS` | obscura | `3` | Maximum concurrent CDP page connections per serve process (headroom ceiling, min 1). |
| `XACTIONS_BROWSER_CONTEXTS_PER_BROWSER` | chrome | `5` | Isolated-context ceiling per Chrome browser instance (clamped to `[4, 6]`). |
| `OBSCURA_BIN` / `OBSCURA_PORT_BASE` | obscura | unset / `9222` | Optional dev auto-spawn: consulted only when no endpoint environment variables are set. |

### Fleet Ownership & Drain Semantics

- **External ownership:** The Obscura fleet processes are managed by external supervisors/operators. On pool `drain()`, XActions issues `browser.disconnect()` to close CDP connections without terminating the external daemons (per AD-23).
- **Dev auto-spawn exception:** If processes are spawned locally via `OBSCURA_BIN`, `drain()` automatically sends `SIGTERM` to clean up child processes.

## Verify

```bash
BACKEND=both node scripts/obscura-spike.mjs   # side-by-side Chrome vs Obscura
```

See `docs/obscura-watch.md` for the release-watch & promote gate.
