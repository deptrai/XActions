# Shard Policy — per-backend shard mechanics (Story 53.4)

Companion of `SPEC.md`. Holds the load-bearing per-backend shard rules that the
five-field kernel cites but cannot hold in-line.

## Shard unit by backend

| Backend | Bottleneck | Shard unit | Ceiling per unit | Spawn/rotate next unit when |
|---|---|---|---|---|
| `chrome` | context-create serialization (spike knee @ N=8) | isolated `browserContext` | `contextsPerBrowser` ≈ 4–6 | all existing browsers hit context ceiling → spawn browser N+1 |
| `obscura` | nav/render inside the serve process | `obscura serve` **process** (external fleet) | `pagesPerProcess` ≈ 2–4 CDP page connections | all endpoints at page ceiling → acquire queues (bounded by `acquireTimeoutMs`) |

Spike-verified (scripts/browser-pool-spike-results): on ONE obscura process,
isolated-context navMs ~6.3s vs shared ~3.9s (32 jobs, poolSize 16) — context
overhead exists and in-process nav/render still serializes. Only additional
*processes* scale throughput.

## Fleet endpoint rotation (obscura)

- `OBSCURA_WS_ENDPOINTS` — comma-separated ws list = fleet mode. Non-empty
  wins over every other obscura-endpoint source.
- `OBSCURA_WS_ENDPOINT` (singular) — fallback when plural unset/empty/
  whitespace-only = fleet of 1; today's behavior is a degenerate case.
- `OBSCURA_BIN` auto-spawn (dev nicety, optional): only consulted when NO
  endpoint env is configured; spawns `OBSCURA_BIN serve --port <base+i>`
  children (`OBSCURA_PORT_BASE`, default 9222). Spawned children are killed
  in `drain()`; fleet mode only `disconnect()`s.
- Parse rules: trim each entry; dedupe after URL normalization
  (`new URL().href`); malformed entry → pool init throws loudly (no silent
  skip); duplicate URLs count once.
- Pool keeps one CDP connection entry per endpoint in `_browsers[]`;
  `pagesPerProcess` is the per-entry ceiling for obscura, counting
  `(livePages + pending)` reservations.
- Pick policy: **first-fit by headroom** — the endpoint entry with the most
  free capacity gets the next lease. No round-robin index: a free-entry
  ordering already emerges from the existing `_obtainContext` scan shape.
- Connect is lazy per entry — first acquire needing that entry opens the
  connection (matches existing lazy `_spawnBrowser`); connect is serialized
  through the spawn-lock so concurrent acquires never double-connect.
- Connect failure on entry E → skip E for this acquire, try the next entry
  with headroom; all entries failed → wrapped error (respawn/health-check =
  Story 53.5, out of scope here).
- `drain()` during an in-flight connect → post-connect `_draining` re-check
  → `disconnect()` + `PoolDrainingError`; no orphaned CDP connection.
- Fleet membership is read once at pool construction; changing endpoints
  requires `drain()` + rebuild.
- Effective capacity = `min(size, N_endpoints × pagesPerProcess)`; clamp
  slot ceiling to capacity and expose `stats().capacity` so `size` beyond
  the fleet is visible, not silently starving.

## Context isolation inside an obscura process (CAP-3)

Obscura implements `createBrowserContext` with real cookie/storage isolation
(spike probe: `isolatedContextLeak: false`, `sharedContextLeak: false`).
Each job still acquires `context + page` — the process is the throughput
shard unit; the context remains the privacy boundary per job. A context
create that returns null/throws reuses `_obtainContext`'s existing wrap —
never falls back to the shared default context.

## SharedContextPool scope

Fleet rotation applies to `BrowserPool` (isolated mode). `SharedContextPool`
stays pinned to endpoint[0] — anonymous public scraping keeps single-process
behavior; rotating shared mode is out of scope.

## Stats shape (obscura fleet)

`stats()` gains, for `backend === 'obscura'`:

```js
{
  size, active, queued, draining,
  capacity,                    // min(size, endpoints.length * pagesPerProcess)
  endpoints: [{ endpoint, pages, pending }]
}
```

`acquire()` result gains `endpoint` (string) so 53.6 can dim `poolEndpoint`
without schema guesswork. Chrome pools keep the existing `{browsers}` count.

## Chrome path (unchanged mechanics)

- `contextsPerBrowser` default 5 (within AD-24's 4–6 band).
- Second browser spawns only when every existing browser is at ceiling.
- Ceiling knobs are per-backend — one shared knob name across backends is a
  spec violation because the units differ.

## Config surface (proposed keys)

| Key | Surface | Scope | Default | Meaning |
|---|---|---|---|---|
| `MEDIRUS_BROWSER_POOL_SIZE` | env | both | 0 (off) | total acquire slots |
| `contextsPerBrowser` / `MEDIRUS_BROWSER_CONTEXTS_PER_BROWSER` | option + env | chrome | 5 | isolated contexts per chrome browser |
| `pagesPerProcess` / `MEDIRUS_BROWSER_PAGES_PER_PROCESS` | option + env | obscura | 3 | CDP page connections per serve process |
| `OBSCURA_WS_ENDPOINTS` | env | obscura | unset | external fleet (comma list) — wins when non-empty |
| `OBSCURA_WS_ENDPOINT` | env | obscura | `ws://127.0.0.1:9222` | single-endpoint fallback |
| `OBSCURA_BIN` / `OBSCURA_PORT_BASE` | env | obscura | unset / 9222 | optional dev auto-spawn (only when no endpoints env) |

## Failure semantics deferred to 53.5

Dead-endpoint health-checking, respawn, and Bull re-queue belong to Story
53.5. This story's contract: a failed connect surfaces a normal wrapped
error (as `_ensureBrowser` already does) after trying remaining endpoints —
not a silent stall or hang.
